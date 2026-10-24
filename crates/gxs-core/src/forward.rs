//! Port forwarding over an SSH connection: local (-L), remote (-R) and dynamic SOCKS5 (-D).

use std::collections::HashMap;
use std::net::SocketAddr;
use std::pin::Pin;
use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};
use std::sync::{Arc, Mutex as StdMutex, Weak};
use std::task::{Context, Poll};
use std::time::Duration;

use russh::ChannelOpenFailure;
use russh::client::Msg;
use serde::{Deserialize, Serialize};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt, ReadBuf};
use tokio::net::{TcpListener, TcpStream};
use tokio::task::{JoinHandle, JoinSet};

use crate::error::{Error, Result};
use crate::i18n::ltr;
use crate::profiles::validate_host;
use crate::ssh::{SshClient, endpoint};
use crate::transport::{push_socks_addr, read_socks_addr};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ForwardKind {
    /// Listens here, connects from the server.
    Local,
    /// Listens on the server, connects from here.
    Remote,
    /// A SOCKS5 proxy here whose connections leave from the server.
    Dynamic,
}

fn loopback() -> String {
    "127.0.0.1".into()
}

/// True for the loopback forms a no-auth listener may bind.
fn is_loopback(host: &str) -> bool {
    host.eq_ignore_ascii_case("localhost")
        || host.parse::<std::net::IpAddr>().is_ok_and(|ip| ip.is_loopback())
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ForwardSpec {
    pub kind: ForwardKind,
    #[serde(default = "loopback")]
    pub bind_host: String,
    /// 0 lets the listening side pick a free port.
    pub bind_port: u16,
    #[serde(default)]
    pub dest_host: String,
    #[serde(default)]
    pub dest_port: u16,
    #[serde(default)]
    pub label: String,
}

pub const MAX_SAVED_FORWARDS: usize = 32;

impl ForwardSpec {
    pub fn validate(&self) -> Result<()> {
        validate_host(self.bind_host.trim()).map_err(|_| {
            Error::invalid(crate::tr!(
                "监听地址不能为空，也不能包含空格",
                "The listen address cannot be empty or contain spaces",
                "ئاڭلاش ئادرېسى بوش ياكى بوشلۇق بار بولسا بولمايدۇ"
            ))
        })?;
        // A no-auth SOCKS5 proxy must never listen beyond the loopback: anyone on the LAN
        // could borrow the user's SSH session without any credentials.
        if self.kind == ForwardKind::Dynamic && !is_loopback(self.bind_host.trim()) {
            return Err(Error::invalid(crate::tr!(
                "动态代理（SOCKS5）只能绑定本机回环地址（127.0.0.1）",
                "Dynamic (SOCKS5) forwards can only bind a loopback address (127.0.0.1)",
                "دىنامىك (SOCKS5) يوللاش پەقەت ئۆز قۇرۇلمىسى ئادرېسىغا (127.0.0.1) باغلانالايدۇ"
            )));
        }
        if self.kind != ForwardKind::Dynamic {
            validate_host(self.dest_host.trim()).map_err(|_| {
                Error::invalid(crate::tr!(
                    "目标地址不能为空，也不能包含空格",
                    "The destination address cannot be empty or contain spaces",
                    "نىشان ئادرېسى بوش ياكى بوشلۇق بار بولسا بولمايدۇ"
                ))
            })?;
            if self.dest_port == 0 {
                return Err(Error::invalid(crate::tr!(
                    "目标端口必须是 1-65535",
                    "The destination port must be 1-65535",
                    "نىشان ئېغىزى 1-65535 بولۇشى كېرەك"
                )));
            }
        }
        if self.label.chars().count() > 64 {
            return Err(Error::invalid(crate::tr!(
                "转发名称最多 64 个字符",
                "The forward name can be 64 characters at most",
                "يوللاش نامى ئەڭ كۆپ 64 ھەرپ بولىدۇ"
            )));
        }
        Ok(())
    }
}

#[derive(Default)]
pub(crate) struct Stats {
    active: AtomicU32,
    total: AtomicU64,
    /// Bytes from the local side toward the remote side.
    up: AtomicU64,
    down: AtomicU64,
    last_error: StdMutex<Option<String>>,
}

impl Stats {
    fn fail(&self, message: String) {
        tracing::debug!("forward: {message}");
        *self.last_error.lock().unwrap_or_else(|p| p.into_inner()) = Some(message);
    }

    async fn bridge<R: AsyncRead + AsyncWrite + Unpin>(self: &Arc<Self>, local: TcpStream, mut remote: R) {
        struct Active<'a>(&'a Stats);
        impl Drop for Active<'_> {
            fn drop(&mut self) {
                self.0.active.fetch_sub(1, Ordering::Relaxed);
            }
        }
        self.active.fetch_add(1, Ordering::Relaxed);
        self.total.fetch_add(1, Ordering::Relaxed);
        let _active = Active(self);
        let mut local = Counted {
            inner: local,
            stats: self.clone(),
        };
        let _ = tokio::io::copy_bidirectional(&mut local, &mut remote).await;
    }
}

/// Counts bytes read from (up) and written to (down) the local socket as they flow.
struct Counted<S> {
    inner: S,
    stats: Arc<Stats>,
}

impl<S: AsyncRead + Unpin> AsyncRead for Counted<S> {
    fn poll_read(mut self: Pin<&mut Self>, cx: &mut Context<'_>, buf: &mut ReadBuf<'_>) -> Poll<std::io::Result<()>> {
        let before = buf.filled().len();
        let poll = Pin::new(&mut self.inner).poll_read(cx, buf);
        let read = buf.filled().len() - before;
        self.stats.up.fetch_add(read as u64, Ordering::Relaxed);
        poll
    }
}

impl<S: AsyncWrite + Unpin> AsyncWrite for Counted<S> {
    fn poll_write(mut self: Pin<&mut Self>, cx: &mut Context<'_>, buf: &[u8]) -> Poll<std::io::Result<usize>> {
        let poll = Pin::new(&mut self.inner).poll_write(cx, buf);
        if let Poll::Ready(Ok(n)) = &poll {
            self.stats.down.fetch_add(*n as u64, Ordering::Relaxed);
        }
        poll
    }

    fn poll_flush(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<std::io::Result<()>> {
        Pin::new(&mut self.inner).poll_flush(cx)
    }

    fn poll_shutdown(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<std::io::Result<()>> {
        Pin::new(&mut self.inner).poll_shutdown(cx)
    }
}

/// Where connections to a remote-forwarded port go, keyed by the port the server listens on.
#[derive(Clone)]
pub(crate) struct RemoteTarget {
    host: String,
    port: u16,
    stats: Arc<Stats>,
}

pub(crate) type RemoteForwards = Arc<StdMutex<HashMap<u32, RemoteTarget>>>;

const LOCAL_CONNECT_TIMEOUT: Duration = Duration::from_secs(10);

/// A connection arrived on a remote-forwarded port; connect it to its local destination.
pub(crate) async fn serve_remote(channel: russh::Channel<Msg>, target: RemoteTarget) {
    let dest = ltr(&endpoint(&target.host, target.port));
    let host = target.host.trim_start_matches('[').trim_end_matches(']');
    let socket = match tokio::time::timeout(LOCAL_CONNECT_TIMEOUT, TcpStream::connect((host, target.port))).await {
        Ok(Ok(socket)) => socket,
        Ok(Err(e)) => {
            let e = ltr(&e.to_string());
            target.stats.fail(crate::tr!(
                "服务器转来了连接，但本机无法连接 {dest}：{e}",
                "The server forwarded a connection, but this computer cannot connect to {dest}: {e}",
                "مۇلازىمېتىر بىر ئۇلىنىشنى يوللاپ كەلدى، بىراق بۇ كومپيۇتېر {dest} غا ئۇلىنالمىدى: {e}"
            ));
            let _ = channel.close().await;
            return;
        }
        Err(_) => {
            target.stats.fail(crate::tr!(
                "服务器转来了连接，但连接本机的 {dest} 超时",
                "The server forwarded a connection, but connecting to {dest} on this computer timed out",
                "مۇلازىمېتىر بىر ئۇلىنىشنى يوللاپ كەلدى، بىراق بۇ كومپيۇتېردىكى {dest} غا ئۇلىنىش ۋاقتى ئېشىپ كەتتى"
            ));
            let _ = channel.close().await;
            return;
        }
    };
    let _ = socket.set_nodelay(true);
    target.stats.bridge(socket, channel.into_stream()).await;
}

/// Why the server could not open a forwarding channel, for people.
pub(crate) fn open_failure_text(e: &russh::Error) -> String {
    match e {
        russh::Error::ChannelOpenFailure(ChannelOpenFailure::ConnectFailed) => crate::tr!(
            "服务器连不上目标（目标拒绝连接或不可达）",
            "the server cannot reach the destination (it refused the connection or is unreachable)",
            "مۇلازىمېتىر نىشانغا ئۇلىنالمىدى (نىشان ئۇلىنىشنى رەت قىلدى ياكى ئۇنىڭغا يەتكىلى بولمايدۇ)"
        ),
        russh::Error::ChannelOpenFailure(ChannelOpenFailure::AdministrativelyProhibited) => crate::tr!(
            "服务器禁止了 TCP 转发（sshd 的 AllowTcpForwarding 或 PermitOpen 设置）",
            "the server forbids TCP forwarding (the AllowTcpForwarding or PermitOpen setting of sshd)",
            "مۇلازىمېتىر TCP يوللاشنى چەكلىگەن (sshd نىڭ AllowTcpForwarding ياكى PermitOpen تەڭشىكى)"
        ),
        russh::Error::ChannelOpenFailure(ChannelOpenFailure::ResourceShortage) => {
            crate::tr!("服务器资源不足", "the server is out of resources", "مۇلازىمېتىرنىڭ مەنبەسى يېتىشمىدى")
        }
        russh::Error::ChannelOpenFailure(other) => crate::tr!(
            "服务器拒绝打开通道（{other:?}）",
            "the server refused to open the channel ({other:?})",
            "مۇلازىمېتىر قانال ئېچىشنى رەت قىلدى ({other:?})"
        ),
        other => other.to_string(),
    }
}

fn socks_code(e: &Error) -> u8 {
    match e {
        Error::Ssh(russh::Error::ChannelOpenFailure(ChannelOpenFailure::ConnectFailed)) => 5,
        Error::Ssh(russh::Error::ChannelOpenFailure(ChannelOpenFailure::AdministrativelyProhibited)) => 2,
        _ => 1,
    }
}

/// Reads a SOCKS5 greeting and CONNECT request; only "no authentication" is offered, so the
/// listener should stay on a loopback address.
async fn socks5_accept<S: AsyncRead + AsyncWrite + Unpin>(stream: &mut S) -> std::io::Result<Option<(String, u16)>> {
    let mut head = [0u8; 2];
    stream.read_exact(&mut head).await?;
    if head[0] != 5 {
        return Ok(None);
    }
    let mut methods = vec![0u8; usize::from(head[1])];
    stream.read_exact(&mut methods).await?;
    if !methods.contains(&0) {
        stream.write_all(&[5, 0xff]).await?;
        return Ok(None);
    }
    stream.write_all(&[5, 0]).await?;
    let mut request = [0u8; 4];
    stream.read_exact(&mut request).await?;
    let target = read_socks_addr(stream, request[3]).await?;
    if request[1] != 1 {
        socks5_reply(stream, 7).await?;
        return Ok(None);
    }
    Ok(Some(target))
}

async fn socks5_reply<S: AsyncWrite + Unpin>(stream: &mut S, code: u8) -> std::io::Result<()> {
    let mut reply = vec![5, code, 0];
    let _ = push_socks_addr(&mut reply, "0.0.0.0", 0);
    stream.write_all(&reply).await
}

async fn serve_local(mut socket: TcpStream, from: SocketAddr, client: Arc<SshClient>, spec: Arc<ForwardSpec>, stats: Arc<Stats>) {
    let dynamic = spec.kind == ForwardKind::Dynamic;
    let (host, port) = if dynamic {
        match socks5_accept(&mut socket).await {
            Ok(Some(target)) => target,
            _ => return,
        }
    } else {
        (spec.dest_host.clone(), spec.dest_port)
    };
    let remote = match client.open_direct_tcpip(&host, port, from).await {
        Ok(remote) => remote,
        Err(e) => {
            let reason = match &e {
                Error::Ssh(inner) => open_failure_text(inner),
                other => other.to_string(),
            };
            let target = ltr(&endpoint(&host, port));
            stats.fail(crate::tr!(
                "无法通过服务器连接 {target}：{reason}",
                "Cannot connect to {target} through the server: {reason}",
                "مۇلازىمېتىر ئارقىلىق {target} غا ئۇلىنالمىدى: {reason}"
            ));
            if dynamic {
                let _ = socks5_reply(&mut socket, socks_code(&e)).await;
            }
            return;
        }
    };
    if dynamic && socks5_reply(&mut socket, 0).await.is_err() {
        return;
    }
    stats.bridge(socket, remote).await;
}

async fn listen(listener: TcpListener, client: Weak<SshClient>, spec: Arc<ForwardSpec>, stats: Arc<Stats>) {
    // Dropping the set (when this task is aborted) aborts every open connection with it.
    let mut connections = JoinSet::new();
    loop {
        tokio::select! {
            accepted = listener.accept() => match accepted {
                Ok((socket, from)) => {
                    let Some(client) = client.upgrade() else { break };
                    let _ = socket.set_nodelay(true);
                    connections.spawn(serve_local(socket, from, client, spec.clone(), stats.clone()));
                }
                // Usually running out of sockets; back off instead of spinning.
                Err(_) => tokio::time::sleep(Duration::from_millis(200)).await,
            },
            Some(_) = connections.join_next(), if !connections.is_empty() => {}
        }
    }
}

async fn bind(host: &str, port: u16) -> Result<TcpListener> {
    use std::io::ErrorKind as K;
    let bare = host.trim_start_matches('[').trim_end_matches(']');
    TcpListener::bind((bare, port)).await.map_err(|e| {
        let addr = ltr(&endpoint(host, port));
        Error::Connect(match e.kind() {
            K::AddrInUse => crate::tr!(
                "本机端口 {addr} 已被占用，请换一个端口。",
                "The local port {addr} is in use. Choose another port.",
                "يەرلىك ئېغىز {addr} ئىگىلىۋېلىنغان، باشقا ئېغىز تاللاڭ."
            ),
            K::PermissionDenied => {
                let cmd = ltr("netsh int ipv4 show excludedportrange protocol=tcp");
                crate::tr!(
                    "没有权限监听 {addr}。Windows 会保留部分端口（{cmd} 可查看），请换一个端口。",
                    "No permission to listen on {addr}. Windows reserves some ports (list them with {cmd}). Choose another port.",
                    "{addr} دا ئاڭلاش ھوقۇقى يوق. Windows بەزى ئېغىزلارنى ساقلاپ قويىدۇ ({cmd} ئارقىلىق كۆرگىلى بولىدۇ)، باشقا ئېغىز تاللاڭ."
                )
            }
            K::AddrNotAvailable => {
                let bare = ltr(bare);
                crate::tr!(
                    "本机没有地址 {bare}，无法在上面监听。",
                    "This computer has no address {bare}, so it cannot listen on it.",
                    "بۇ كومپيۇتېردا {bare} ئادرېسى يوق، ئۇنىڭدا ئاڭلىغىلى بولمايدۇ."
                )
            }
            _ => {
                let e = ltr(&e.to_string());
                crate::tr!("无法监听 {addr}：{e}", "Cannot listen on {addr}: {e}", "{addr} دا ئاڭلىيالمىدى: {e}")
            }
        })
    })
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ForwardView {
    pub id: u32,
    pub spec: ForwardSpec,
    /// The port actually listened on; differs from `spec.bindPort` when that was 0.
    pub bound_port: u16,
    pub active: u32,
    pub total: u64,
    pub bytes_up: u64,
    pub bytes_down: u64,
    pub last_error: Option<String>,
}

static FORWARD_IDS: AtomicU32 = AtomicU32::new(1);

/// A running forward. Dropping it stops local listeners; remote ones also need [`Forward::stop`]
/// to tell the server.
pub struct Forward {
    id: u32,
    spec: ForwardSpec,
    bound_port: u16,
    stats: Arc<Stats>,
    task: Option<JoinHandle<()>>,
}

impl Drop for Forward {
    fn drop(&mut self) {
        if let Some(task) = self.task.take() {
            task.abort();
        }
    }
}

impl Forward {
    pub async fn start(client: &Arc<SshClient>, mut spec: ForwardSpec) -> Result<Self> {
        spec.validate()?;
        spec.bind_host = spec.bind_host.trim().to_owned();
        spec.dest_host = spec.dest_host.trim().to_owned();
        spec.label = spec.label.trim().to_owned();
        let stats = Arc::<Stats>::default();
        let (bound_port, task) = match spec.kind {
            ForwardKind::Local | ForwardKind::Dynamic => {
                let listener = bind(&spec.bind_host, spec.bind_port).await?;
                let port = listener.local_addr()?.port();
                let task = tokio::spawn(listen(
                    listener,
                    Arc::downgrade(client),
                    Arc::new(spec.clone()),
                    stats.clone(),
                ));
                (port, Some(task))
            }
            ForwardKind::Remote => {
                let target = RemoteTarget {
                    host: spec.dest_host.clone(),
                    port: spec.dest_port,
                    stats: stats.clone(),
                };
                let port = client.request_remote_forward(&spec.bind_host, spec.bind_port, target).await?;
                (u16::try_from(port).unwrap_or(spec.bind_port), None)
            }
        };
        Ok(Self {
            id: FORWARD_IDS.fetch_add(1, Ordering::Relaxed),
            spec,
            bound_port,
            stats,
            task,
        })
    }

    pub fn id(&self) -> u32 {
        self.id
    }

    pub fn view(&self) -> ForwardView {
        ForwardView {
            id: self.id,
            spec: self.spec.clone(),
            bound_port: self.bound_port,
            active: self.stats.active.load(Ordering::Relaxed),
            total: self.stats.total.load(Ordering::Relaxed),
            bytes_up: self.stats.up.load(Ordering::Relaxed),
            bytes_down: self.stats.down.load(Ordering::Relaxed),
            last_error: self.stats.last_error.lock().unwrap_or_else(|p| p.into_inner()).clone(),
        }
    }

    pub async fn stop(mut self, client: &SshClient) {
        if let Some(task) = self.task.take() {
            task.abort();
            // Waiting lets the listener close before this returns, so the port is free again.
            let _ = task.await;
        }
        if self.spec.kind == ForwardKind::Remote {
            client
                .cancel_remote_forward(&self.spec.bind_host, u32::from(self.bound_port))
                .await;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::duplex;

    fn spec(kind: ForwardKind) -> ForwardSpec {
        ForwardSpec {
            kind,
            bind_host: "127.0.0.1".into(),
            bind_port: 0,
            dest_host: "10.0.0.1".into(),
            dest_port: 80,
            label: String::new(),
        }
    }

    #[test]
    fn validation() {
        assert!(spec(ForwardKind::Local).validate().is_ok());
        let mut bad = spec(ForwardKind::Local);
        bad.dest_port = 0;
        assert!(bad.validate().is_err());
        let mut dynamic = spec(ForwardKind::Dynamic);
        dynamic.dest_host.clear();
        dynamic.dest_port = 0;
        assert!(dynamic.validate().is_ok());
        let mut bad = spec(ForwardKind::Remote);
        bad.bind_host = "a b".into();
        assert!(bad.validate().is_err());
    }

    #[test]
    fn spec_defaults_for_older_files() {
        let parsed: ForwardSpec = serde_json::from_str(r#"{"kind":"dynamic","bindPort":1080}"#).unwrap();
        assert_eq!(parsed.bind_host, "127.0.0.1");
        assert_eq!(parsed.kind, ForwardKind::Dynamic);
    }

    #[tokio::test]
    async fn socks5_server_reads_connect_request() {
        let (mut client, mut server) = duplex(1024);
        let accept = tokio::spawn(async move { socks5_accept(&mut server).await.unwrap() });
        client.write_all(&[5, 1, 0]).await.unwrap();
        let mut choice = [0u8; 2];
        client.read_exact(&mut choice).await.unwrap();
        assert_eq!(choice, [5, 0]);
        let mut request = vec![5, 1, 0];
        push_socks_addr(&mut request, "db.internal", 5432).unwrap();
        client.write_all(&request).await.unwrap();
        assert_eq!(accept.await.unwrap(), Some(("db.internal".to_owned(), 5432)));
    }

    #[tokio::test]
    async fn socks5_server_refuses_auth_only_clients() {
        let (mut client, mut server) = duplex(1024);
        let accept = tokio::spawn(async move { socks5_accept(&mut server).await.unwrap() });
        client.write_all(&[5, 1, 2]).await.unwrap();
        let mut choice = [0u8; 2];
        client.read_exact(&mut choice).await.unwrap();
        assert_eq!(choice, [5, 0xff]);
        assert_eq!(accept.await.unwrap(), None);
    }

    #[tokio::test]
    async fn busy_port_is_explained() {
        let taken = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = taken.local_addr().unwrap().port();
        let err = bind("127.0.0.1", port).await.unwrap_err();
        // The message renders in the current global language, which parallel tests
        // may change at any time, so accept any of the three built-ins.
        let text = err.to_string();
        let markers = ["已被占用", "is in use", "ئىگىلىۋېلىنغان"];
        assert!(markers.iter().any(|m| text.contains(m)), "{err}");
    }
}
