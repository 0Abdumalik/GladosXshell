use std::future::Future;
use std::net::SocketAddr;
use std::pin::Pin;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex as StdMutex};
use std::time::{Duration, Instant};

use bytes::Bytes;
use russh::client::{self, ChannelOpenHandle, KeyboardInteractiveAuthResponse, Msg};
use russh::keys::agent::AgentIdentity;
use russh::keys::{PrivateKeyWithHashAlg, PublicKeyOrCertificate, decode_secret_key};
use russh::{Channel, ChannelMsg, ChannelOpenFailure, ChannelStream, Disconnect};
use russh_sftp::client::SftpSession;
use serde::Serialize;
use zeroize::Zeroizing;
use tokio::net::TcpStream;
use tokio::sync::{OnceCell, mpsc, oneshot};

use crate::agent;
use crate::error::{Error, Result};
use crate::forward::{self, RemoteForwards, RemoteTarget};
use crate::i18n::ltr;
use crate::known_hosts::{HostKeyPolicy, HostKeyPrompter, KnownHosts};
use crate::pump::{self, Credit, PumpConfig};
use crate::session::{COMMAND_QUEUE, Command, OUTPUT_QUEUE, SessionExit, SessionHandle, Spawned};
use crate::sftp::Sftp;
use crate::transport::{self, Proxy, Stream};

#[derive(Debug, Clone, Serialize)]
pub struct KbdPrompt {
    pub prompt: String,
    pub echo: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct KbdRequest {
    pub name: String,
    pub instructions: String,
    pub prompts: Vec<KbdPrompt>,
}

pub trait KeyboardInteractive: Send + Sync {
    /// Returns one answer per prompt, or `None` to abort authentication.
    fn respond(&self, request: KbdRequest) -> Pin<Box<dyn Future<Output = Option<Vec<String>>> + Send + '_>>;
}

pub enum SshAuth {
    /// Falls back to keyboard-interactive (answering every prompt with the password) because
    /// many servers disable the plain password method.
    Password(Zeroizing<String>),
    /// OpenSSH, PKCS#8 or PuTTY (.ppk) private key text.
    PrivateKey {
        key: Zeroizing<String>,
        passphrase: Option<Zeroizing<String>>,
    },
    KeyboardInteractive(Arc<dyn KeyboardInteractive>),
    /// Every key the local SSH agent holds, in its order.
    Agent,
}

/// How the byte stream reaches the server.
#[derive(Default)]
pub enum Via {
    #[default]
    Direct,
    Proxy(Proxy),
    /// Through a direct-tcpip channel of an already authenticated connection.
    Jump(Arc<SshClient>),
}

pub struct ConnectOptions {
    pub host: String,
    pub port: u16,
    pub user: String,
    pub auth: SshAuth,
    pub policy: HostKeyPolicy,
    pub known_hosts: Arc<KnownHosts>,
    pub prompter: Option<Arc<dyn HostKeyPrompter>>,
    pub connect_timeout: Duration,
    pub keepalive_interval: Option<Duration>,
    pub via: Via,
    /// Lets programs on the server use the local agent; only for servers you trust, since
    /// their root can then sign with your keys while you are connected.
    pub agent_forward: bool,
}

struct ClientHandler {
    host: String,
    port: u16,
    policy: HostKeyPolicy,
    known_hosts: Arc<KnownHosts>,
    prompter: Option<Arc<dyn HostKeyPrompter>>,
    rejection: Arc<StdMutex<Option<Error>>>,
    remote_forwards: RemoteForwards,
    agent_forward: bool,
}

impl ClientHandler {
    fn reject(&self, error: Error) -> bool {
        *self.rejection.lock().unwrap_or_else(|p| p.into_inner()) = Some(error);
        false
    }
}

impl client::Handler for ClientHandler {
    type Error = russh::Error;

    async fn check_server_key(&mut self, key: &PublicKeyOrCertificate) -> Result<bool, Self::Error> {
        let PublicKeyOrCertificate::PublicKey { key, .. } = key else {
            return Ok(self.reject(Error::HostKeyCertificate));
        };
        let verdict = self
            .known_hosts
            .verify(&self.host, self.port, key, self.policy, self.prompter.as_deref())
            .await;
        Ok(match verdict {
            Ok(()) => true,
            Err(e) => self.reject(e),
        })
    }

    async fn server_channel_open_forwarded_tcpip(
        &mut self,
        channel: Channel<Msg>,
        _connected_address: &str,
        connected_port: u32,
        _originator_address: &str,
        _originator_port: u32,
        reply: ChannelOpenHandle,
        _session: &mut client::Session,
    ) -> Result<(), Self::Error> {
        let target = self
            .remote_forwards
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .get(&connected_port)
            .cloned();
        match target {
            Some(target) => {
                reply.accept().await;
                tokio::spawn(forward::serve_remote(channel, target));
            }
            None => reply.reject(ChannelOpenFailure::AdministrativelyProhibited).await,
        }
        Ok(())
    }

    async fn server_channel_open_agent_forward(
        &mut self,
        channel: Channel<Msg>,
        reply: ChannelOpenHandle,
        _session: &mut client::Session,
    ) -> Result<(), Self::Error> {
        if !self.agent_forward {
            reply.reject(ChannelOpenFailure::AdministrativelyProhibited).await;
            return Ok(());
        }
        reply.accept().await;
        tokio::spawn(async move {
            match agent::connect().await {
                Ok(agent) => {
                    let mut local = agent.into_inner();
                    let mut remote = channel.into_stream();
                    let _ = tokio::io::copy_bidirectional(&mut local, &mut remote).await;
                }
                Err(e) => {
                    tracing::debug!("agent forwarding: {e}");
                    let _ = channel.close().await;
                }
            }
        });
        Ok(())
    }
}

pub struct SshClient {
    handle: client::Handle<ClientHandler>,
    peer: Option<SocketAddr>,
    sftp: OnceCell<Sftp>,
    remote_forwards: RemoteForwards,
    agent_forward: bool,
    /// The connection this one tunnels through; declared last so it outlives `handle`.
    _jump: Option<Arc<SshClient>>,
}

pub(crate) fn endpoint(host: &str, port: u16) -> String {
    if host.contains(':') {
        format!("[{host}]:{port}")
    } else {
        format!("{host}:{port}")
    }
}

fn timeout_hint() -> String {
    crate::tr!(
        "请检查服务器是否开机、地址和端口是否正确，以及防火墙或安全组是否放行了这个端口。",
        "Check that the server is running, that the address and port are correct, and that the firewall or security group allows this port.",
        "مۇلازىمېتىرنىڭ ئېچىلغان-ئېچىلمىغانلىقىنى، ئادرېس ۋە ئېغىزنىڭ توغرا-خاتالىقىنى، شۇنداقلا مۇداپىئە تامى ياكى بىخەتەرلىك گۇرۇپپىسىنىڭ بۇ ئېغىزغا يول قويغان-قويمىغانلىقىنى تەكشۈرۈڭ."
    )
}

/// Turns a failed TCP connect into a sentence that says what happened and what to check.
fn connect_error(target: &str, e: &std::io::Error) -> Error {
    use std::io::ErrorKind as K;
    let target = ltr(target);
    let hint = timeout_hint();
    Error::Connect(match e.kind() {
        K::ConnectionRefused => crate::tr!(
            "{target} 拒绝了连接：服务器能访问，但这个端口上没有程序在监听。请确认端口号正确、对应的服务（如 sshd、telnetd）已经启动。",
            "{target} refused the connection: the server is reachable, but nothing is listening on this port. Check that the port number is correct and that the service (such as sshd or telnetd) is running.",
            "{target} ئۇلىنىشنى رەت قىلدى: مۇلازىمېتىرنى زىيارەت قىلغىلى بولىدۇ، بىراق بۇ ئېغىزدا ئاڭلاۋاتقان پروگرامما يوق. ئېغىز نومۇرىنىڭ توغرىلىقىنى ۋە مۇناسىۋەتلىك مۇلازىمەتنىڭ (مەسىلەن sshd، telnetd) قوزغىتىلغانلىقىنى جەزملەشتۈرۈڭ."
        ),
        K::TimedOut => crate::tr!(
            "连接 {target} 超时：服务器没有响应。{hint}",
            "Connecting to {target} timed out: the server did not respond. {hint}",
            "{target} غا ئۇلىنىش ۋاقتى ئېشىپ كەتتى: مۇلازىمېتىر جاۋاب قايتۇرمىدى. {hint}"
        ),
        K::HostUnreachable | K::NetworkUnreachable => crate::tr!(
            "无法到达 {target}：网络不通。请检查本机网络、VPN 或代理，以及服务器所在的网络是否可达。",
            "Cannot reach {target}: the network is unreachable. Check this computer's network, VPN or proxy, and whether the server's network can be reached.",
            "{target} غا يەتكىلى بولمىدى: تور ئۇلانمىدى. بۇ كومپيۇتېرنىڭ تورى، VPN ياكى ۋاكالەتچىسىنى، شۇنداقلا مۇلازىمېتىر تۇرۇشلۇق تورغا يەتكىلى بولىدىغان-بولمايدىغانلىقىنى تەكشۈرۈڭ."
        ),
        K::ConnectionReset | K::ConnectionAborted | K::UnexpectedEof => crate::tr!(
            "{target} 中断了连接。可能被防火墙拦截，或服务器限制了来源地址（如 hosts.deny、fail2ban）。",
            "{target} dropped the connection. A firewall may have blocked it, or the server may restrict source addresses (for example hosts.deny or fail2ban).",
            "{target} ئۇلىنىشنى ئۈزۈۋەتتى. مۇداپىئە تامى توسۇۋالغان بولۇشى، ياكى مۇلازىمېتىر مەنبە ئادرېسىنى چەكلىگەن بولۇشى مۇمكىن (مەسىلەن hosts.deny، fail2ban)."
        ),
        K::AddrNotAvailable => crate::tr!(
            "地址 {target} 不可用，请检查主机地址是否正确。",
            "The address {target} is not available. Check that the host address is correct.",
            "{target} ئادرېسىنى ئىشلەتكىلى بولمايدۇ، ئاساسىي ماشىنا ئادرېسىنىڭ توغرىلىقىنى تەكشۈرۈڭ."
        ),
        K::PermissionDenied => {
            let e = ltr(&e.to_string());
            crate::tr!(
                "本机拒绝了到 {target} 的连接，可能被本机防火墙或安全软件拦截（{e}）。",
                "This computer refused the connection to {target}. The local firewall or security software may have blocked it ({e}).",
                "بۇ كومپيۇتېر {target} غا بولغان ئۇلىنىشنى رەت قىلدى، يەرلىك مۇداپىئە تامى ياكى بىخەتەرلىك يۇمشاق دېتالى توسۇۋالغان بولۇشى مۇمكىن ({e})."
            )
        }
        _ => {
            let e = ltr(&e.to_string());
            crate::tr!(
                "无法连接 {target}：{e}",
                "Cannot connect to {target}: {e}",
                "{target} غا ئۇلىنالمىدى: {e}"
            )
        }
    })
}

pub(crate) async fn open_tcp(host: &str, port: u16, limit: Duration) -> Result<TcpStream> {
    let target = endpoint(host, port);
    let attempt = async {
        let addrs: Vec<SocketAddr> = tokio::net::lookup_host((host, port))
            .await
            .map_err(|e| {
                let (host, e) = (ltr(host), ltr(&e.to_string()));
                Error::Connect(crate::tr!(
                    "找不到主机 {host}：域名解析失败（{e}）。请检查主机地址的拼写，以及本机的网络和 DNS 设置。",
                    "Host {host} not found: name resolution failed ({e}). Check the spelling of the host address, and this computer's network and DNS settings.",
                    "{host} ئاساسىي ماشىنىسى تېپىلمىدى: دائىرە نامىنى يېشىش مەغلۇپ بولدى ({e}). ئاساسىي ماشىنا ئادرېسىنىڭ ئىملاسىنى، شۇنداقلا بۇ كومپيۇتېرنىڭ تور ۋە DNS تەڭشىكىنى تەكشۈرۈڭ."
                ))
            })?
            .collect();
        if addrs.is_empty() {
            let host = ltr(host);
            return Err(Error::Connect(crate::tr!(
                "找不到主机 {host}：没有解析到任何地址。请检查主机地址是否正确。",
                "Host {host} not found: it resolved to no addresses. Check that the host address is correct.",
                "{host} ئاساسىي ماشىنىسى تېپىلمىدى: ھېچقانداق ئادرېس يېشىلمىدى. ئاساسىي ماشىنا ئادرېسىنىڭ توغرىلىقىنى تەكشۈرۈڭ."
            )));
        }
        TcpStream::connect(&addrs[..])
            .await
            .map_err(|e| connect_error(&target, &e))
    };
    tokio::time::timeout(limit, attempt).await.unwrap_or_else(|_| {
        let (target, secs, hint) = (ltr(&target), limit.as_secs(), timeout_hint());
        Err(Error::Connect(crate::tr!(
            "连接 {target} 超时：{secs} 秒内没有收到响应。{hint}",
            "Connecting to {target} timed out: no response within {secs} seconds. {hint}",
            "{target} غا ئۇلىنىش ۋاقتى ئېشىپ كەتتى: {secs} سېكۇنت ئىچىدە جاۋاب كەلمىدى. {hint}"
        )))
    })
}

/// Failures between the TCP connect and authentication, worded for people.
fn handshake_error(host: &str, port: u16, e: russh::Error) -> Error {
    use std::io::ErrorKind as K;
    let raw_target = endpoint(host, port);
    let target = ltr(&raw_target);
    let closed = || {
        Error::Connect(crate::tr!(
            "{target} 在握手阶段关闭了连接。可能是服务器限制了来源地址（如 hosts.deny、fail2ban）、连接数已满，或 sshd 配置有误。",
            "{target} closed the connection during the handshake. The server may restrict source addresses (for example hosts.deny or fail2ban), may have too many connections, or sshd may be misconfigured.",
            "{target} قول ئېلىشىش باسقۇچىدا ئۇلىنىشنى ياپتى. مۇلازىمېتىر مەنبە ئادرېسىنى چەكلىگەن (مەسىلەن hosts.deny، fail2ban)، ئۇلىنىش سانى توشۇپ كەتكەن ياكى sshd سەپلىمىسى خاتا بولۇشى مۇمكىن."
        ))
    };
    match e {
        russh::Error::Version => Error::Connect(crate::tr!(
            "{target} 上运行的不是 SSH 服务（没有收到 SSH 协议标识）。请确认端口号是否正确。",
            "{target} is not running an SSH service (no SSH protocol banner was received). Check that the port number is correct.",
            "{target} دا SSH مۇلازىمىتى ئىجرا بولمايۋاتىدۇ (SSH كېلىشىم بەلگىسى تاپشۇرۇۋېلىنمىدى). ئېغىز نومۇرىنىڭ توغرىلىقىنى جەزملەشتۈرۈڭ."
        )),
        russh::Error::Disconnect | russh::Error::HUP => closed(),
        russh::Error::IO(io) if matches!(io.kind(), K::ConnectionReset | K::ConnectionAborted | K::UnexpectedEof) => {
            closed()
        }
        russh::Error::IO(io) => connect_error(&raw_target, &io),
        russh::Error::NoCommonAlgo { kind, .. } => Error::Connect(crate::tr!(
            "无法与 {target} 协商加密方式：双方没有共同支持的 {kind:?} 算法。服务器可能过旧，或只启用了少见的算法。",
            "Could not agree on encryption with {target}: there is no {kind:?} algorithm that both sides support. The server may be too old, or may enable only uncommon algorithms.",
            "{target} بىلەن شىفىرلاش ئۇسۇلىنى كېلىشەلمىدى: ئىككى تەرەپ ئورتاق قوللايدىغان {kind:?} ئالگورىتمى يوق. مۇلازىمېتىر بەك كونا بولۇشى، ياكى پەقەت ئاز ئۇچرايدىغان ئالگورىتملارنىلا قوزغاتقان بولۇشى مۇمكىن."
        )),
        russh::Error::KexInit | russh::Error::Kex => Error::Connect(crate::tr!(
            "与 {target} 的密钥交换失败。",
            "Key exchange with {target} failed.",
            "{target} بىلەن ئاچقۇچ ئالماشتۇرۇش مەغلۇپ بولدى."
        )),
        russh::Error::ConnectionTimeout
        | russh::Error::InactivityTimeout
        | russh::Error::KeepaliveTimeout
        | russh::Error::Elapsed(_) => Error::Connect(crate::tr!(
            "{target} 握手超时：已经建立 TCP 连接，但服务器长时间没有回应 SSH 握手。",
            "The handshake with {target} timed out: the TCP connection is up, but the server did not answer the SSH handshake.",
            "{target} بىلەن قول ئېلىشىش ۋاقتى ئېشىپ كەتتى: TCP ئۇلىنىشى قۇرۇلدى، بىراق مۇلازىمېتىر ئۇزۇن ۋاقىت SSH قول ئېلىشىشىغا جاۋاب قايتۇرمىدى."
        )),
        other => Error::Ssh(other),
    }
}

pub async fn connect(options: ConnectOptions) -> Result<SshClient> {
    let config = Arc::new(client::Config {
        keepalive_interval: options.keepalive_interval,
        keepalive_max: 3,
        nodelay: true,
        ..client::Config::default()
    });

    let remote_forwards = RemoteForwards::default();
    let rejection = Arc::new(StdMutex::new(None));
    let handler = ClientHandler {
        host: options.host.clone(),
        port: options.port,
        policy: options.policy,
        known_hosts: options.known_hosts,
        prompter: options.prompter,
        rejection: rejection.clone(),
        remote_forwards: remote_forwards.clone(),
        agent_forward: options.agent_forward,
    };
    let (host, port, limit) = (options.host.as_str(), options.port, options.connect_timeout);

    let (handshake, peer, jump) = match options.via {
        Via::Direct => {
            let stream = open_tcp(host, port, limit).await?;
            stream.set_nodelay(true)?;
            let peer = stream.peer_addr().ok();
            (handshake(config, stream, handler, &rejection, host, port).await, peer, None)
        }
        Via::Proxy(proxy) => {
            let stream = transport::connect_proxy(&proxy, host, port, limit).await?;
            (handshake(config, stream, handler, &rejection, host, port).await, None, None)
        }
        Via::Jump(jump) => {
            let stream = jump_stream(&jump, host, port, limit).await?;
            (handshake(config, stream, handler, &rejection, host, port).await, None, Some(jump))
        }
    };
    let mut handle = handshake?;

    if !authenticate(&mut handle, &options.user, options.auth).await? {
        let _ = handle.disconnect(Disconnect::ByApplication, "", "English").await;
        return Err(Error::AuthFailed);
    }
    Ok(SshClient {
        handle,
        peer,
        sftp: OnceCell::new(),
        remote_forwards,
        agent_forward: options.agent_forward,
        _jump: jump,
    })
}

async fn handshake<S: Stream + 'static>(
    config: Arc<client::Config>,
    stream: S,
    handler: ClientHandler,
    rejection: &StdMutex<Option<Error>>,
    host: &str,
    port: u16,
) -> Result<client::Handle<ClientHandler>> {
    client::connect_stream(config, stream, handler).await.map_err(|e| {
        let host_key_error = rejection.lock().unwrap_or_else(|p| p.into_inner()).take();
        host_key_error.unwrap_or_else(|| handshake_error(host, port, e))
    })
}

async fn jump_stream(jump: &SshClient, host: &str, port: u16, limit: Duration) -> Result<ChannelStream<Msg>> {
    let target = ltr(&endpoint(host, port));
    if jump.is_closed() {
        return Err(Error::Connect(crate::tr!(
            "跳板机的连接已经断开，无法继续连接 {target}。",
            "The connection to the jump host is closed, so {target} cannot be reached.",
            "ئۆتكۈنچى مۇلازىمېتىرنىڭ ئۇلىنىشى ئۈزۈلدى، {target} غا داۋاملىق ئۇلىنالمايدۇ."
        )));
    }
    let open = jump
        .handle
        .channel_open_direct_tcpip(host, u32::from(port), "127.0.0.1", 0);
    match tokio::time::timeout(limit, open).await {
        Ok(Ok(channel)) => Ok(channel.into_stream()),
        Ok(Err(e)) => {
            let reason = forward::open_failure_text(&e);
            Err(Error::Connect(crate::tr!(
                "跳板机无法连接 {target}：{reason}。",
                "The jump host cannot connect to {target}: {reason}.",
                "ئۆتكۈنچى مۇلازىمېتىر {target} غا ئۇلىنالمىدى: {reason}."
            )))
        }
        Err(_) => {
            let secs = limit.as_secs();
            Err(Error::Connect(crate::tr!(
                "跳板机连接 {target} 超时：{secs} 秒内没有完成。请确认跳板机能访问这个地址。",
                "The jump host timed out connecting to {target}: it did not finish within {secs} seconds. Check that the jump host can reach this address.",
                "ئۆتكۈنچى مۇلازىمېتىرنىڭ {target} غا ئۇلىنىش ۋاقتى ئېشىپ كەتتى: {secs} سېكۇنت ئىچىدە تاماملانمىدى. ئۆتكۈنچى مۇلازىمېتىرنىڭ بۇ ئادرېسنى زىيارەت قىلالايدىغانلىقىنى جەزملەشتۈرۈڭ."
            )))
        }
    }
}

async fn authenticate(handle: &mut client::Handle<ClientHandler>, user: &str, auth: SshAuth) -> Result<bool> {
    match auth {
        SshAuth::Password(password) => {
            if handle.authenticate_password(user, password.as_str().to_owned()).await?.success() {
                return Ok(true);
            }
            let responder = PasswordResponder {
                password,
                answered: AtomicBool::new(false),
            };
            keyboard_interactive(handle, user, &responder).await
        }
        SshAuth::PrivateKey { key, passphrase } => {
            let key = decode_secret_key(&key, passphrase.as_ref().map(|p| p.as_str()))?;
            let hash = handle.best_supported_rsa_hash().await?.flatten();
            let key = PrivateKeyWithHashAlg::new(Arc::new(key), hash);
            Ok(handle.authenticate_publickey(user, key).await?.success())
        }
        SshAuth::KeyboardInteractive(responder) => keyboard_interactive(handle, user, responder.as_ref()).await,
        SshAuth::Agent => agent_auth(handle, user).await,
    }
}

async fn agent_auth(handle: &mut client::Handle<ClientHandler>, user: &str) -> Result<bool> {
    let mut agent = agent::connect().await?;
    let identities = agent
        .request_identities()
        .await
        .map_err(|e| {
            Error::Connect(crate::tr!(
                "无法读取 SSH Agent 里的密钥：{e}",
                "Could not read the keys in the SSH agent: {e}",
                "SSH Agent دىكى ئاچقۇچلارنى ئوقۇيالمىدى: {e}"
            ))
        })?;
    let keys: Vec<_> = identities
        .into_iter()
        .filter_map(|identity| match identity {
            AgentIdentity::PublicKey { key, .. } => Some(key),
            AgentIdentity::Certificate { .. } => None,
        })
        .collect();
    if keys.is_empty() {
        return Err(Error::Connect(crate::tr!(
            "SSH Agent 里没有可用的密钥。请先用 ssh-add 或 Pageant 添加密钥。",
            "The SSH agent has no usable keys. Add a key with ssh-add or Pageant first.",
            "SSH Agent دا ئىشلەتكىلى بولىدىغان ئاچقۇچ يوق. ئالدى بىلەن ssh-add ياكى Pageant ئارقىلىق ئاچقۇچ قوشۇڭ."
        )));
    }
    let rsa_hash = handle.best_supported_rsa_hash().await?.flatten();
    for key in keys {
        let hash = if key.algorithm().is_rsa() { rsa_hash } else { None };
        let result = handle
            .authenticate_publickey_with(user, key, hash, &mut agent)
            .await
            .map_err(|e| {
                Error::Connect(crate::tr!(
                    "SSH Agent 签名失败：{e}",
                    "The SSH agent failed to sign: {e}",
                    "SSH Agent ئىمزا قويالمىدى: {e}"
                ))
            })?;
        if result.success() {
            return Ok(true);
        }
    }
    Ok(false)
}

/// True when the key text parses only with a passphrase, so the UI knows to ask for one.
pub fn key_is_encrypted(key: &str) -> bool {
    matches!(decode_secret_key(key, None), Err(russh::keys::Error::KeyIsEncrypted))
        || (key.trim_start().starts_with("PuTTY-User-Key-File-") && !key.contains("Encryption: none"))
}

struct PasswordResponder {
    password: Zeroizing<String>,
    answered: AtomicBool,
}

impl KeyboardInteractive for PasswordResponder {
    fn respond(&self, request: KbdRequest) -> Pin<Box<dyn Future<Output = Option<Vec<String>>> + Send + '_>> {
        // One round only: a second round means the server wants more than the password
        // (e.g. an OTP), which needs a real prompt.
        let first = !self.answered.swap(true, Ordering::AcqRel);
        let answers = first.then(|| request.prompts.iter().map(|_| self.password.to_string()).collect());
        Box::pin(std::future::ready(answers))
    }
}

const MAX_KBD_ROUNDS: usize = 8;
const SFTP_TIMEOUT_SECS: u64 = 30;
/// `SessionExit.error` when the connection drops without the server ending the shell.
pub const CONNECTION_LOST: &str = "connection lost";

async fn keyboard_interactive(
    handle: &mut client::Handle<ClientHandler>,
    user: &str,
    responder: &dyn KeyboardInteractive,
) -> Result<bool> {
    let mut response = handle.authenticate_keyboard_interactive_start(user, None).await?;
    for _ in 0..MAX_KBD_ROUNDS {
        match response {
            KeyboardInteractiveAuthResponse::Success => return Ok(true),
            KeyboardInteractiveAuthResponse::Failure { .. } => return Ok(false),
            KeyboardInteractiveAuthResponse::InfoRequest {
                name,
                instructions,
                prompts,
            } => {
                let request = KbdRequest {
                    name,
                    instructions,
                    prompts: prompts
                        .into_iter()
                        .map(|p| KbdPrompt {
                            prompt: p.prompt,
                            echo: p.echo,
                        })
                        .collect(),
                };
                let Some(answers) = responder.respond(request).await else {
                    return Ok(false);
                };
                response = handle.authenticate_keyboard_interactive_respond(answers).await?;
            }
        }
    }
    Ok(false)
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ExecOutput {
    pub stdout: Vec<u8>,
    pub stderr: Vec<u8>,
    pub exit: SessionExit,
    pub truncated: bool,
}

impl SshClient {
    pub fn is_closed(&self) -> bool {
        self.handle.is_closed()
    }

    pub async fn disconnect(&self) {
        let _ = self.handle.disconnect(Disconnect::ByApplication, "", "English").await;
    }

    pub fn peer(&self) -> Option<SocketAddr> {
        self.peer
    }

    /// A TCP connection to `host:port` made by the server, as a byte stream.
    pub async fn open_direct_tcpip(&self, host: &str, port: u16, from: SocketAddr) -> Result<ChannelStream<Msg>> {
        let channel = self
            .handle
            .channel_open_direct_tcpip(host, u32::from(port), from.ip().to_string(), u32::from(from.port()))
            .await?;
        Ok(channel.into_stream())
    }

    /// Asks the server to listen on `host:port` (0: any free port) and returns the port it uses.
    pub(crate) async fn request_remote_forward(&self, host: &str, port: u16, target: RemoteTarget) -> Result<u32> {
        let forwards = &self.remote_forwards;
        let lock = || forwards.lock().unwrap_or_else(|p| p.into_inner());
        // Registered first so a connection arriving right after the reply finds its target.
        if port != 0 {
            lock().insert(u32::from(port), target.clone());
        }
        match self.handle.tcpip_forward(host, u32::from(port)).await {
            Ok(chosen) => {
                let bound = if port == 0 { chosen } else { u32::from(port) };
                lock().insert(bound, target);
                Ok(bound)
            }
            Err(e) => {
                lock().remove(&u32::from(port));
                Err(match e {
                    russh::Error::RequestDenied => {
                        let addr = ltr(&endpoint(host, port));
                        Error::Connect(crate::tr!(
                            "服务器拒绝在 {addr} 上监听：端口可能已被占用，或 sshd 禁止了远程转发（AllowTcpForwarding）。",
                            "The server refused to listen on {addr}: the port may be in use, or sshd may forbid remote forwarding (AllowTcpForwarding).",
                            "مۇلازىمېتىر {addr} دا ئاڭلاشنى رەت قىلدى: ئېغىز ئىگىلىۋېلىنغان بولۇشى، ياكى sshd يىراقتىن يوللاشنى چەكلىگەن بولۇشى مۇمكىن (AllowTcpForwarding)."
                        ))
                    }
                    other => Error::Ssh(other),
                })
            }
        }
    }

    pub(crate) async fn cancel_remote_forward(&self, host: &str, port: u32) {
        self.remote_forwards
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .remove(&port);
        let _ = self.handle.cancel_tcpip_forward(host, port).await;
    }

    /// Round-trip time of an SSH keepalive; the server must reply before this returns.
    pub async fn ping(&self) -> Result<Duration> {
        let start = Instant::now();
        self.handle.send_ping().await?;
        Ok(start.elapsed())
    }

    /// The SFTP subsystem, opened on first use and shared by every file operation on this
    /// connection.
    pub async fn sftp(&self) -> Result<Sftp> {
        self.sftp
            .get_or_try_init(|| async {
                let mut channel = self.handle.channel_open_session().await?;
                channel.request_subsystem(true, "sftp").await?;
                // russh only sends the request; the verdict arrives as a channel message.
                let accepted = tokio::time::timeout(Duration::from_secs(SFTP_TIMEOUT_SECS), async {
                    loop {
                        match channel.wait().await {
                            Some(ChannelMsg::Success) => return true,
                            Some(ChannelMsg::Failure | ChannelMsg::Close) | None => return false,
                            Some(_) => {}
                        }
                    }
                })
                .await
                .unwrap_or(false);
                if !accepted {
                    return Err(Error::Unsupported(
                        "the server has no SFTP subsystem (OpenWrt: opkg install openssh-sftp-server)".into(),
                    ));
                }
                let session = SftpSession::new(channel.into_stream()).await?;
                session.set_timeout(SFTP_TIMEOUT_SECS);
                Ok(Sftp::new(session))
            })
            .await
            .cloned()
    }

    /// Runs a non-interactive command and collects its output (used for server status polling).
    pub async fn exec(&self, command: &str) -> Result<ExecOutput> {
        self.exec_limited(command, usize::MAX).await
    }

    /// Like [`exec`](Self::exec), but once stdout and stderr together pass `limit` bytes the
    /// channel is closed and `truncated` is set; the exit code is then unknown.
    pub async fn exec_limited(&self, command: &str, limit: usize) -> Result<ExecOutput> {
        let mut channel = self.handle.channel_open_session().await?;
        channel.exec(true, command).await?;
        let mut out = ExecOutput::default();
        loop {
            // The channel vanishing without CLOSE means the connection went away mid-command.
            let Some(msg) = channel.wait().await else {
                return Err(Error::Closed);
            };
            let room = limit.saturating_sub(out.stdout.len() + out.stderr.len());
            let (sink, data) = match msg {
                ChannelMsg::Data { data } => (&mut out.stdout, data),
                ChannelMsg::ExtendedData { data, .. } => (&mut out.stderr, data),
                ChannelMsg::ExitStatus { exit_status } => {
                    out.exit.code = Some(exit_status);
                    continue;
                }
                ChannelMsg::ExitSignal { signal_name, .. } => {
                    out.exit.signal = Some(format!("{signal_name:?}"));
                    continue;
                }
                ChannelMsg::Close => break,
                _ => continue,
            };
            if data.len() > room {
                sink.extend_from_slice(&data[..room]);
                out.truncated = true;
                let _ = channel.close().await;
                break;
            }
            sink.extend_from_slice(&data);
        }
        Ok(out)
    }

    /// Opens an interactive PTY shell. Output flows through the pump into `sink`.
    pub async fn open_shell<F>(&self, term: &str, cols: u16, rows: u16, config: PumpConfig, sink: F) -> Result<Spawned>
    where
        F: FnMut(Vec<u8>) -> bool + Send + 'static,
    {
        let channel = self.handle.channel_open_session().await?;
        channel
            .request_pty(true, term, u32::from(cols), u32::from(rows), 0, 0, &[])
            .await?;
        if self.agent_forward {
            channel.agent_forward(false).await?;
        }
        channel.request_shell(true).await?;
        let (mut read, write) = channel.split();

        let (cmd_tx, mut cmd_rx) = mpsc::channel::<Command>(COMMAND_QUEUE);
        let (out_tx, out_rx) = mpsc::channel::<Bytes>(OUTPUT_QUEUE);
        let (exit_tx, exit_rx) = oneshot::channel();
        let (done_tx, mut done_rx) = oneshot::channel::<()>();
        // russh forgets a channel once we close it, so the server's CLOSE reply never reaches `read`.
        let (closing_tx, mut closing_rx) = oneshot::channel::<()>();
        let credit = Arc::new(Credit::default());

        // Reader: blocking on `out_tx` when the pump has no credit stops draining the russh
        // channel, which stops window adjustments, which throttles the server.
        let reader = tokio::spawn(async move {
            let mut exit = SessionExit::default();
            let mut closed = false;
            let mut closing_gone = false;
            loop {
                let msg = tokio::select! {
                    msg = read.wait() => msg,
                    res = &mut closing_rx, if !closing_gone => {
                        if res.is_ok() {
                            closed = true;
                            break;
                        }
                        closing_gone = true;
                        continue;
                    }
                };
                let Some(msg) = msg else { break };
                match msg {
                    ChannelMsg::Data { data } | ChannelMsg::ExtendedData { data, .. } => {
                        if out_tx.send(data).await.is_err() {
                            closed = true;
                            break;
                        }
                    }
                    ChannelMsg::ExitStatus { exit_status } => exit.code = Some(exit_status),
                    ChannelMsg::ExitSignal {
                        signal_name,
                        error_message,
                        ..
                    } => {
                        exit.signal = Some(format!("{signal_name:?}"));
                        if !error_message.is_empty() {
                            exit.error = Some(error_message);
                        }
                    }
                    ChannelMsg::Close => {
                        closed = true;
                        break;
                    }
                    _ => {}
                }
            }
            // The channel vanished without the server closing it: transport dropped or keepalive gave up.
            if !closed && exit.code.is_none() && exit.signal.is_none() && exit.error.is_none() {
                exit.error = Some(CONNECTION_LOST.into());
            }
            let _ = done_tx.send(());
            exit
        });

        tokio::spawn(async move {
            loop {
                tokio::select! {
                    cmd = cmd_rx.recv() => match cmd {
                        Some(Command::Write(data)) => {
                            if write.data_bytes(data).await.is_err() {
                                break;
                            }
                        }
                        Some(Command::Resize { cols, rows }) => {
                            let _ = write
                                .window_change(u32::from(cols), u32::from(rows), 0, 0)
                                .await;
                        }
                        Some(Command::Close) | None => {
                            let _ = write.eof().await;
                            let _ = write.close().await;
                            let _ = closing_tx.send(());
                            break;
                        }
                    },
                    _ = &mut done_rx => break,
                }
            }
        });

        let pump_credit = credit.clone();
        tokio::spawn(async move {
            pump::run(out_rx, pump_credit, config, sink).await;
            let exit = reader.await.unwrap_or_else(|e| SessionExit {
                error: Some(e.to_string()),
                ..SessionExit::default()
            });
            let _ = exit_tx.send(exit);
        });

        Ok(Spawned {
            handle: SessionHandle::new(cmd_tx, credit),
            exit: exit_rx,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::AsyncWriteExt;

    fn message(e: Error) -> String {
        assert_eq!(e.kind(), "connect", "{e}");
        e.to_string()
    }

    #[tokio::test]
    async fn refused_port_is_explained() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        drop(listener);
        let err = open_tcp("127.0.0.1", port, Duration::from_secs(5)).await.unwrap_err();
        let text = message(err);
        assert!(text.contains("拒绝了连接"), "{text}");
        assert!(text.contains(&format!("127.0.0.1:{port}")), "{text}");
    }

    #[tokio::test]
    async fn unknown_host_is_explained() {
        let err = open_tcp("no-such-host.invalid", 22, Duration::from_secs(10)).await.unwrap_err();
        let text = message(err);
        assert!(text.contains("找不到主机") || text.contains("超时"), "{text}");
    }

    #[test]
    fn io_kinds_get_hints() {
        let timeout = message(connect_error("h:22", &std::io::ErrorKind::TimedOut.into()));
        assert!(timeout.contains("超时") && timeout.contains("防火墙"), "{timeout}");
        let unreachable = message(connect_error("h:22", &std::io::ErrorKind::HostUnreachable.into()));
        assert!(unreachable.contains("网络不通"), "{unreachable}");
        assert_eq!(endpoint("::1", 22), "[::1]:22");
    }

    #[tokio::test]
    async fn non_ssh_service_is_explained() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let _ = socket.write_all(b"HTTP/1.1 400 Bad Request\r\n\r\n").await;
        });
        let stream = open_tcp("127.0.0.1", port, Duration::from_secs(5)).await.unwrap();
        let handler = ClientHandler {
            host: "127.0.0.1".into(),
            port,
            policy: HostKeyPolicy::Tofu,
            known_hosts: Arc::new(
                KnownHosts::open(std::env::temp_dir().join(format!("gxs-test-kh-{port}")))
                    .await
                    .unwrap(),
            ),
            prompter: None,
            rejection: Arc::new(StdMutex::new(None)),
            remote_forwards: RemoteForwards::default(),
            agent_forward: false,
        };
        let config = Arc::new(client::Config::default());
        let err = match client::connect_stream(config, stream, handler).await {
            Ok(_) => panic!("handshake with an HTTP server succeeded"),
            Err(e) => handshake_error("127.0.0.1", port, e),
        };
        let text = message(err);
        assert!(text.contains("不是 SSH 服务") || text.contains("关闭了连接"), "{text}");
    }
}
