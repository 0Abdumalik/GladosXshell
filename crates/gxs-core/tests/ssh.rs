use std::borrow::Cow;
use std::future::Future;
use std::pin::Pin;
use std::collections::HashSet;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use gxs_core::known_hosts::{HostKeyPolicy, HostKeyPrompter, KnownHosts, UnknownHostKey};
use gxs_core::forward::{Forward, ForwardKind, ForwardSpec};
use gxs_core::ssh::{self, ConnectOptions, KbdRequest, KeyboardInteractive, SshAuth, SshClient, Via};
use gxs_core::transport::{Proxy, ProxyKind};
use gxs_core::{Error, PumpConfig};
use zeroize::Zeroizing;
use russh::keys::ssh_key::LineEnding;
use russh::keys::{Algorithm, PrivateKey, PublicKey};
use russh::server::{self, Auth, ChannelOpenHandle, Msg, Response, Session};
use russh::{Channel, ChannelId, ChannelOpenFailure};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::mpsc;

#[derive(Clone)]
struct TestHandler {
    client_key: PublicKey,
    password_enabled: bool,
    channels: Arc<Mutex<Vec<Channel<Msg>>>>,
    /// Forwarding channels of this connection, whose data must not reach the shell echo.
    tunnels: Arc<Mutex<HashSet<ChannelId>>>,
}

impl server::Handler for TestHandler {
    type Error = russh::Error;

    async fn auth_password(&mut self, user: &str, password: &str) -> Result<Auth, Self::Error> {
        Ok(if self.password_enabled && user == "gxs" && password == "secret" {
            Auth::Accept
        } else {
            Auth::reject()
        })
    }

    async fn auth_publickey(&mut self, user: &str, key: &PublicKey) -> Result<Auth, Self::Error> {
        Ok(if user == "gxs" && key.key_data() == self.client_key.key_data() {
            Auth::Accept
        } else {
            Auth::reject()
        })
    }

    async fn auth_keyboard_interactive<'a>(
        &'a mut self,
        user: &str,
        _submethods: &str,
        response: Option<Response<'a>>,
    ) -> Result<Auth, Self::Error> {
        match response {
            None => Ok(Auth::Partial {
                name: Cow::Borrowed("gxs"),
                instructions: Cow::Borrowed(""),
                prompts: Cow::Owned(vec![(Cow::Borrowed("Password: "), false)]),
            }),
            Some(mut answers) => {
                let ok = user == "gxs" && answers.next().as_deref() == Some(b"secret".as_slice());
                Ok(if ok { Auth::Accept } else { Auth::reject() })
            }
        }
    }

    async fn channel_open_session(
        &mut self,
        channel: Channel<Msg>,
        reply: ChannelOpenHandle,
        _session: &mut Session,
    ) -> Result<(), Self::Error> {
        self.channels.lock().unwrap().push(channel);
        reply.accept().await;
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    async fn pty_request(
        &mut self,
        channel: ChannelId,
        term: &str,
        cols: u32,
        rows: u32,
        _: u32,
        _: u32,
        _: &[(russh::Pty, u32)],
        session: &mut Session,
    ) -> Result<(), Self::Error> {
        session.data(channel, format!("pty:{term}:{cols}x{rows}\r\n").into_bytes())?;
        session.channel_success(channel)
    }

    async fn shell_request(&mut self, channel: ChannelId, session: &mut Session) -> Result<(), Self::Error> {
        session.data(channel, b"welcome\r\n".to_vec())?;
        session.channel_success(channel)
    }

    async fn data(&mut self, channel: ChannelId, data: &[u8], session: &mut Session) -> Result<(), Self::Error> {
        if self.tunnels.lock().unwrap().contains(&channel) {
            return Ok(());
        }
        if data == b"exit\r" {
            session.exit_status_request(channel, 42)?;
            session.eof(channel)?;
            return session.close(channel);
        }
        if let Some(n) = data.strip_prefix(b"flood ") {
            let n: usize = std::str::from_utf8(n).unwrap().trim().parse().unwrap();
            for i in 0..n {
                session.data(channel, format!("flood-{i:06}\r\n").into_bytes())?;
            }
            return Ok(());
        }
        session.data(channel, [b"echo:".as_slice(), data].concat())
    }

    async fn window_change_request(
        &mut self,
        channel: ChannelId,
        cols: u32,
        rows: u32,
        _: u32,
        _: u32,
        session: &mut Session,
    ) -> Result<(), Self::Error> {
        session.data(channel, format!("resize:{cols}x{rows}\r\n").into_bytes())
    }

    async fn exec_request(
        &mut self,
        channel: ChannelId,
        data: &[u8],
        session: &mut Session,
    ) -> Result<(), Self::Error> {
        session.channel_success(channel)?;
        session.data(channel, [b"ran:".as_slice(), data].concat())?;
        session.exit_status_request(channel, 7)?;
        session.eof(channel)?;
        session.close(channel)
    }

    async fn channel_open_direct_tcpip(
        &mut self,
        channel: Channel<Msg>,
        host: &str,
        port: u32,
        _originator_address: &str,
        _originator_port: u32,
        reply: ChannelOpenHandle,
        _session: &mut Session,
    ) -> Result<(), Self::Error> {
        match TcpStream::connect((host, port as u16)).await {
            Ok(mut socket) => {
                self.tunnels.lock().unwrap().insert(channel.id());
                reply.accept().await;
                tokio::spawn(async move {
                    let mut stream = channel.into_stream();
                    let _ = tokio::io::copy_bidirectional(&mut socket, &mut stream).await;
                });
            }
            Err(_) => reply.reject(ChannelOpenFailure::ConnectFailed).await,
        }
        Ok(())
    }

    async fn tcpip_forward(&mut self, address: &str, port: &mut u32, session: &mut Session) -> Result<bool, Self::Error> {
        let Ok(listener) = TcpListener::bind(("127.0.0.1", *port as u16)).await else {
            return Ok(false);
        };
        *port = u32::from(listener.local_addr().unwrap().port());
        let (address, bound, handle) = (address.to_owned(), *port, session.handle());
        let tunnels = self.tunnels.clone();
        tokio::spawn(async move {
            while let Ok((mut socket, from)) = listener.accept().await {
                let Ok(channel) = handle
                    .channel_open_forwarded_tcpip(address.clone(), bound, "127.0.0.1", u32::from(from.port()))
                    .await
                else {
                    continue;
                };
                tunnels.lock().unwrap().insert(channel.id());
                tokio::spawn(async move {
                    let mut stream = channel.into_stream();
                    let _ = tokio::io::copy_bidirectional(&mut socket, &mut stream).await;
                });
            }
        });
        Ok(true)
    }

    async fn cancel_tcpip_forward(&mut self, _: &str, _: u32, _: &mut Session) -> Result<bool, Self::Error> {
        Ok(true)
    }
}

struct TestServer {
    port: u16,
    host_key: PublicKey,
    client_key: PrivateKey,
}

async fn start_server(password_enabled: bool) -> TestServer {
    start_server_with_key(
        PrivateKey::random(&mut rand::rng(), Algorithm::Ed25519).unwrap(),
        password_enabled,
    )
    .await
}

async fn start_server_with_key(host_key: PrivateKey, password_enabled: bool) -> TestServer {
    let client_key = PrivateKey::random(&mut rand::rng(), Algorithm::Ed25519).unwrap();
    let config = Arc::new(server::Config {
        keys: vec![host_key.clone()],
        auth_rejection_time: Duration::from_millis(0),
        auth_rejection_time_initial: Some(Duration::from_millis(0)),
        ..server::Config::default()
    });
    let handler = TestHandler {
        client_key: client_key.public_key().clone(),
        password_enabled,
        channels: Arc::default(),
        tunnels: Arc::default(),
    };
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    tokio::spawn(async move {
        while let Ok((socket, _)) = listener.accept().await {
            let config = config.clone();
            let handler = TestHandler {
                tunnels: Arc::default(),
                ..handler.clone()
            };
            tokio::spawn(async move {
                if let Ok(session) = server::run_stream(config, socket, handler).await {
                    let _ = session.await;
                }
            });
        }
    });
    TestServer {
        port,
        host_key: host_key.public_key().clone(),
        client_key,
    }
}

async fn store() -> (tempfile::TempDir, Arc<KnownHosts>) {
    let dir = tempfile::tempdir().unwrap();
    let store = KnownHosts::open(dir.path().join("known_hosts.json")).await.unwrap();
    (dir, Arc::new(store))
}

fn options(server: &TestServer, known_hosts: Arc<KnownHosts>, policy: HostKeyPolicy, auth: SshAuth) -> ConnectOptions {
    ConnectOptions {
        host: "127.0.0.1".into(),
        port: server.port,
        user: "gxs".into(),
        auth,
        policy,
        known_hosts,
        prompter: None,
        connect_timeout: Duration::from_secs(5),
        keepalive_interval: None,
        via: ssh::Via::Direct,
        agent_forward: false,
    }
}

fn password() -> SshAuth {
    SshAuth::Password(Zeroizing::new("secret".into()))
}

async fn connect_ok(server: &TestServer, known_hosts: Arc<KnownHosts>, policy: HostKeyPolicy) -> SshClient {
    ssh::connect(options(server, known_hosts, policy, password()))
        .await
        .unwrap()
}

struct FixedPrompter {
    answer: bool,
    seen: Mutex<Vec<UnknownHostKey>>,
}

impl HostKeyPrompter for FixedPrompter {
    fn confirm(&self, key: UnknownHostKey) -> Pin<Box<dyn Future<Output = bool> + Send + '_>> {
        self.seen.lock().unwrap().push(key);
        Box::pin(std::future::ready(self.answer))
    }
}

#[tokio::test]
async fn tofu_records_key_then_strict_accepts_it() {
    let server = start_server(true).await;
    let (_dir, known) = store().await;
    connect_ok(&server, known.clone(), HostKeyPolicy::Tofu)
        .await
        .disconnect()
        .await;

    let hosts = known.list().await;
    assert_eq!(hosts.len(), 1);
    assert_eq!(hosts[0].port, server.port);
    assert_eq!(
        hosts[0].fingerprint,
        gxs_core::known_hosts::fingerprint(&server.host_key)
    );
    assert!(hosts[0].fingerprint.starts_with("SHA256:"));

    let reopened = Arc::new(KnownHosts::open(known.path()).await.unwrap());
    connect_ok(&server, reopened, HostKeyPolicy::Strict)
        .await
        .disconnect()
        .await;
}

#[tokio::test]
async fn strict_rejects_unknown_host() {
    let server = start_server(true).await;
    let (_dir, known) = store().await;
    let err = ssh::connect(options(&server, known.clone(), HostKeyPolicy::Strict, password()))
        .await
        .err()
        .unwrap();
    assert!(matches!(err, Error::HostKeyRejected { .. }), "{err}");
    assert!(known.list().await.is_empty());
}

#[tokio::test]
async fn changed_key_is_rejected_under_every_policy() {
    let original = start_server(true).await;
    let (_dir, known) = store().await;
    connect_ok(&original, known.clone(), HostKeyPolicy::Tofu)
        .await
        .disconnect()
        .await;

    // Same host:port, new host key: simulate by pointing the stored entry at a new server's port.
    let imposter = start_server(true).await;
    let stored = known.list().await.remove(0);
    let file = known.path().to_path_buf();
    let body = serde_json::json!({
        "version": 1,
        "hosts": [{ "host": "127.0.0.1", "port": imposter.port, "key": stored.key,
                    "fingerprint": stored.fingerprint, "addedAt": stored.added_at }]
    });
    std::fs::write(&file, serde_json::to_vec(&body).unwrap()).unwrap();
    let known = Arc::new(KnownHosts::open(&file).await.unwrap());

    for policy in [HostKeyPolicy::Strict, HostKeyPolicy::Tofu, HostKeyPolicy::Prompt] {
        let prompter = Arc::new(FixedPrompter {
            answer: true,
            seen: Mutex::default(),
        });
        let mut opts = options(&imposter, known.clone(), policy, password());
        opts.prompter = Some(prompter.clone());
        let err = ssh::connect(opts).await.err().unwrap();
        assert!(matches!(err, Error::HostKeyChanged { .. }), "{policy:?}: {err}");
        assert!(
            prompter.seen.lock().unwrap().is_empty(),
            "a changed key must never be offered for approval"
        );
    }
    assert_eq!(known.list().await.len(), 1);
}

#[tokio::test]
async fn prompt_policy_asks_and_respects_answer() {
    let server = start_server(true).await;
    let (_dir, known) = store().await;

    let deny = Arc::new(FixedPrompter {
        answer: false,
        seen: Mutex::default(),
    });
    let mut opts = options(&server, known.clone(), HostKeyPolicy::Prompt, password());
    opts.prompter = Some(deny.clone());
    assert!(matches!(
        ssh::connect(opts).await.err().unwrap(),
        Error::HostKeyRejected { .. }
    ));
    assert_eq!(deny.seen.lock().unwrap().len(), 1);
    assert!(known.list().await.is_empty());

    let allow = Arc::new(FixedPrompter {
        answer: true,
        seen: Mutex::default(),
    });
    let mut opts = options(&server, known.clone(), HostKeyPolicy::Prompt, password());
    opts.prompter = Some(allow.clone());
    ssh::connect(opts).await.unwrap().disconnect().await;
    let seen = allow.seen.lock().unwrap().clone();
    assert_eq!(seen[0].algorithm, "ssh-ed25519");
    assert_eq!(
        seen[0].fingerprint,
        gxs_core::known_hosts::fingerprint(&server.host_key)
    );
    assert_eq!(known.list().await.len(), 1);
}

#[tokio::test]
async fn prompt_policy_without_prompter_rejects() {
    let server = start_server(true).await;
    let (_dir, known) = store().await;
    let err = ssh::connect(options(&server, known, HostKeyPolicy::Prompt, password()))
        .await
        .err()
        .unwrap();
    assert!(matches!(err, Error::HostKeyRejected { .. }));
}

#[tokio::test]
async fn corrupt_store_is_an_error_not_an_empty_store() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("known_hosts.json");
    std::fs::write(&path, b"{ not json").unwrap();
    assert!(matches!(KnownHosts::open(&path).await.err().unwrap(), Error::Store(_)));
}

#[tokio::test]
async fn wrong_password_fails_auth() {
    let server = start_server(true).await;
    let (_dir, known) = store().await;
    let err = ssh::connect(options(
        &server,
        known,
        HostKeyPolicy::Tofu,
        SshAuth::Password(Zeroizing::new("nope".into())),
    ))
    .await
    .err()
    .unwrap();
    assert!(matches!(err, Error::AuthFailed), "{err}");
}

#[tokio::test]
async fn password_falls_back_to_keyboard_interactive() {
    let server = start_server(false).await;
    let (_dir, known) = store().await;
    connect_ok(&server, known, HostKeyPolicy::Tofu).await.disconnect().await;
}

#[tokio::test]
async fn public_key_auth_including_encrypted_key() {
    let server = start_server(false).await;
    let (_dir, known) = store().await;

    let plain = server.client_key.to_openssh(LineEnding::LF).unwrap().to_string();
    let auth = SshAuth::PrivateKey {
        key: Zeroizing::new(plain),
        passphrase: None,
    };
    ssh::connect(options(&server, known.clone(), HostKeyPolicy::Tofu, auth))
        .await
        .unwrap()
        .disconnect()
        .await;

    let encrypted = server
        .client_key
        .encrypt(&mut rand::rng(), "hunter2")
        .unwrap()
        .to_openssh(LineEnding::LF)
        .unwrap()
        .to_string();
    assert!(ssh::key_is_encrypted(&encrypted));
    assert!(!ssh::key_is_encrypted(
        &server.client_key.to_openssh(LineEnding::LF).unwrap()
    ));
    let auth = SshAuth::PrivateKey {
        key: Zeroizing::new(encrypted.clone()),
        passphrase: Some(Zeroizing::new("hunter2".into())),
    };
    ssh::connect(options(&server, known.clone(), HostKeyPolicy::Strict, auth))
        .await
        .unwrap()
        .disconnect()
        .await;

    let auth = SshAuth::PrivateKey {
        key: Zeroizing::new(encrypted),
        passphrase: Some(Zeroizing::new("wrong".into())),
    };
    assert!(matches!(
        ssh::connect(options(&server, known, HostKeyPolicy::Strict, auth))
            .await
            .err()
            .unwrap(),
        Error::Key(_)
    ));
}

struct Kbd;
impl KeyboardInteractive for Kbd {
    fn respond(&self, request: KbdRequest) -> Pin<Box<dyn Future<Output = Option<Vec<String>>> + Send + '_>> {
        assert_eq!(request.prompts[0].prompt, "Password: ");
        assert!(!request.prompts[0].echo);
        Box::pin(std::future::ready(Some(vec!["secret".into()])))
    }
}

#[tokio::test]
async fn keyboard_interactive_auth() {
    let server = start_server(false).await;
    let (_dir, known) = store().await;
    let auth = SshAuth::KeyboardInteractive(Arc::new(Kbd));
    ssh::connect(options(&server, known, HostKeyPolicy::Tofu, auth))
        .await
        .unwrap()
        .disconnect()
        .await;
}

async fn read_until(
    frames: &mut mpsc::UnboundedReceiver<Vec<u8>>,
    handle: &gxs_core::SessionHandle,
    out: &mut String,
    needle: &str,
) {
    tokio::time::timeout(Duration::from_secs(5), async {
        while !out.contains(needle) {
            let frame = frames.recv().await.expect("stream ended before {needle}");
            handle.ack(frame.len() as u64);
            out.push_str(&String::from_utf8_lossy(&frame));
        }
    })
    .await
    .unwrap_or_else(|_| panic!("timed out waiting for {needle:?}; got {out:?}"));
}

#[tokio::test]
async fn interactive_shell_roundtrip_resize_and_exit_status() {
    let server = start_server(true).await;
    let (_dir, known) = store().await;
    let client = connect_ok(&server, known, HostKeyPolicy::Tofu).await;

    let (tx, mut frames) = mpsc::unbounded_channel();
    let spawned = client
        .open_shell("xterm-256color", 100, 30, PumpConfig::default(), move |f| {
            tx.send(f).is_ok()
        })
        .await
        .unwrap();
    let handle = spawned.handle.clone();
    let mut out = String::new();

    read_until(&mut frames, &handle, &mut out, "pty:xterm-256color:100x30").await;
    read_until(&mut frames, &handle, &mut out, "welcome").await;
    handle.write(b"ls".to_vec()).await.unwrap();
    read_until(&mut frames, &handle, &mut out, "echo:ls").await;
    handle.resize(132, 43).await.unwrap();
    read_until(&mut frames, &handle, &mut out, "resize:132x43").await;

    handle.write(b"exit\r".to_vec()).await.unwrap();
    let exit = tokio::time::timeout(Duration::from_secs(5), spawned.exit)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(exit.code, Some(42));
    client.disconnect().await;
}

#[tokio::test]
async fn closing_the_shell_from_our_side_ends_it() {
    let server = start_server(true).await;
    let (_dir, known) = store().await;
    let client = connect_ok(&server, known, HostKeyPolicy::Tofu).await;

    let (tx, mut frames) = mpsc::unbounded_channel();
    let spawned = client
        .open_shell("xterm", 80, 24, PumpConfig::default(), move |f| tx.send(f).is_ok())
        .await
        .unwrap();
    let handle = spawned.handle.clone();
    let mut out = String::new();
    read_until(&mut frames, &handle, &mut out, "welcome").await;

    handle.close().await;
    let exit = tokio::time::timeout(Duration::from_secs(5), spawned.exit)
        .await
        .expect("closing did not end the shell")
        .unwrap();
    assert_eq!(exit.error, None);
    client.disconnect().await;
}

#[tokio::test]
async fn flood_output_is_complete_and_ordered_with_slow_consumer() {
    let server = start_server(true).await;
    let (_dir, known) = store().await;
    let client = connect_ok(&server, known, HostKeyPolicy::Tofu).await;

    let config = PumpConfig {
        window: 16 * 1024,
        ..PumpConfig::default()
    };
    let (tx, mut frames) = mpsc::unbounded_channel();
    let spawned = client
        .open_shell("xterm", 80, 24, config, move |f| tx.send(f).is_ok())
        .await
        .unwrap();
    let handle = spawned.handle.clone();
    let mut out = String::new();
    read_until(&mut frames, &handle, &mut out, "welcome").await;

    let n = 20_000;
    handle.write(format!("flood {n}").into_bytes()).await.unwrap();
    tokio::time::timeout(Duration::from_secs(30), async {
        let last = format!("flood-{:06}\r\n", n - 1);
        while !out.ends_with(&last) {
            let frame = frames.recv().await.unwrap();
            assert!(frame.len() <= config.max_frame + 32 * 1024);
            tokio::time::sleep(Duration::from_micros(200)).await;
            handle.ack(frame.len() as u64);
            out.push_str(&String::from_utf8_lossy(&frame));
        }
    })
    .await
    .expect("flood did not complete");

    let lines: Vec<&str> = out.lines().filter(|l| l.starts_with("flood-")).collect();
    assert_eq!(lines.len(), n);
    for (i, line) in lines.iter().enumerate() {
        assert_eq!(*line, format!("flood-{i:06}"));
    }
    handle.close().await;
    client.disconnect().await;
}

#[tokio::test]
async fn exec_collects_output_and_status() {
    let server = start_server(true).await;
    let (_dir, known) = store().await;
    let client = connect_ok(&server, known, HostKeyPolicy::Tofu).await;
    let out = client.exec("uptime").await.unwrap();
    assert_eq!(out.stdout, b"ran:uptime");
    assert_eq!(out.exit.code, Some(7));
    assert!(!out.truncated);
    let cut = client.exec_limited("uptime", 4).await.unwrap();
    assert_eq!(cut.stdout, b"ran:");
    assert!(cut.truncated);
    client.disconnect().await;
}

#[tokio::test]
async fn ping_measures_round_trip_and_peer_is_recorded() {
    let server = start_server(true).await;
    let (_dir, known) = store().await;
    let client = connect_ok(&server, known, HostKeyPolicy::Tofu).await;
    let peer = client.peer().unwrap();
    assert_eq!(peer.port(), server.port);
    assert!(peer.ip().is_loopback());
    let rtt = client.ping().await.unwrap();
    assert!(rtt < Duration::from_secs(5));
    client.disconnect().await;
}

#[tokio::test]
async fn same_key_on_different_port_is_a_separate_host() {
    let key = PrivateKey::random(&mut rand::rng(), Algorithm::Ed25519).unwrap();
    let a = start_server_with_key(key.clone(), true).await;
    let b = start_server_with_key(key, true).await;
    let (_dir, known) = store().await;
    connect_ok(&a, known.clone(), HostKeyPolicy::Tofu)
        .await
        .disconnect()
        .await;
    let err = ssh::connect(options(&b, known, HostKeyPolicy::Strict, password()))
        .await
        .err()
        .unwrap();
    assert!(matches!(err, Error::HostKeyRejected { .. }));
}

/// A TCP server that answers every chunk with "echo:" + chunk.
async fn echo_server() -> u16 {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    tokio::spawn(async move {
        while let Ok((mut socket, _)) = listener.accept().await {
            tokio::spawn(async move {
                let mut buf = [0u8; 1024];
                while let Ok(n) = socket.read(&mut buf).await {
                    if n == 0 || socket.write_all(&[b"echo:".as_slice(), &buf[..n]].concat()).await.is_err() {
                        break;
                    }
                }
            });
        }
    });
    port
}

async fn roundtrip<S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin>(stream: &mut S, message: &[u8]) {
    stream.write_all(message).await.unwrap();
    let mut got = vec![0u8; message.len() + 5];
    tokio::time::timeout(Duration::from_secs(5), stream.read_exact(&mut got))
        .await
        .expect("no echo")
        .unwrap();
    assert_eq!(got, [b"echo:".as_slice(), message].concat());
}

fn forward_spec(kind: ForwardKind, dest_port: u16) -> ForwardSpec {
    ForwardSpec {
        kind,
        bind_host: "127.0.0.1".into(),
        bind_port: 0,
        dest_host: "127.0.0.1".into(),
        dest_port,
        label: String::new(),
    }
}

#[tokio::test]
async fn local_forward_carries_traffic_and_counts_it() {
    let server = start_server(true).await;
    let (_dir, known) = store().await;
    let client = Arc::new(connect_ok(&server, known, HostKeyPolicy::Tofu).await);
    let echo = echo_server().await;

    let forward = Forward::start(&client, forward_spec(ForwardKind::Local, echo)).await.unwrap();
    let port = forward.view().bound_port;
    assert_ne!(port, 0);
    let mut socket = TcpStream::connect(("127.0.0.1", port)).await.unwrap();
    roundtrip(&mut socket, b"hello").await;
    let view = forward.view();
    assert_eq!((view.active, view.total), (1, 1));
    assert_eq!((view.bytes_up, view.bytes_down), (5, 10));
    drop(socket);

    forward.stop(&client).await;
    assert!(TcpStream::connect(("127.0.0.1", port)).await.is_err(), "listener still open after stop");
    client.disconnect().await;
}

#[tokio::test]
async fn local_forward_reports_unreachable_destination() {
    let server = start_server(true).await;
    let (_dir, known) = store().await;
    let client = Arc::new(connect_ok(&server, known, HostKeyPolicy::Tofu).await);
    let closed = std::net::TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port();

    let forward = Forward::start(&client, forward_spec(ForwardKind::Local, closed)).await.unwrap();
    let mut socket = TcpStream::connect(("127.0.0.1", forward.view().bound_port)).await.unwrap();
    let mut buf = [0u8; 1];
    let read = tokio::time::timeout(Duration::from_secs(5), socket.read(&mut buf)).await.unwrap();
    assert!(matches!(read, Ok(0) | Err(_)), "socket should be closed");
    let error = forward.view().last_error.expect("failure recorded");
    assert!(error.contains("服务器连不上目标"), "{error}");
    client.disconnect().await;
}

#[tokio::test]
async fn dynamic_forward_is_a_socks5_proxy() {
    let server = start_server(true).await;
    let (_dir, known) = store().await;
    let client = Arc::new(connect_ok(&server, known, HostKeyPolicy::Tofu).await);
    let echo = echo_server().await;

    let mut spec = forward_spec(ForwardKind::Dynamic, 0);
    spec.dest_host.clear();
    let forward = Forward::start(&client, spec).await.unwrap();
    let mut socket = TcpStream::connect(("127.0.0.1", forward.view().bound_port)).await.unwrap();
    socket.write_all(&[5, 1, 0]).await.unwrap();
    let mut choice = [0u8; 2];
    socket.read_exact(&mut choice).await.unwrap();
    assert_eq!(choice, [5, 0]);
    let mut request = vec![5, 1, 0, 3, 9];
    request.extend_from_slice(b"localhost");
    request.extend_from_slice(&echo.to_be_bytes());
    socket.write_all(&request).await.unwrap();
    let mut reply = [0u8; 10];
    socket.read_exact(&mut reply).await.unwrap();
    assert_eq!(reply[..2], [5, 0]);
    roundtrip(&mut socket, b"via socks").await;
    client.disconnect().await;
}

#[tokio::test]
async fn remote_forward_brings_server_connections_here() {
    let server = start_server(true).await;
    let (_dir, known) = store().await;
    let client = Arc::new(connect_ok(&server, known, HostKeyPolicy::Tofu).await);
    let echo = echo_server().await;

    let forward = Forward::start(&client, forward_spec(ForwardKind::Remote, echo)).await.unwrap();
    let port = forward.view().bound_port;
    assert_ne!(port, 0);
    let mut socket = TcpStream::connect(("127.0.0.1", port)).await.unwrap();
    roundtrip(&mut socket, b"from the server side").await;
    assert_eq!(forward.view().total, 1);
    forward.stop(&client).await;
    client.disconnect().await;
}

#[tokio::test]
async fn jump_host_tunnels_the_second_connection() {
    let server = start_server(true).await;
    let (_dir, known) = store().await;
    let jump = Arc::new(connect_ok(&server, known.clone(), HostKeyPolicy::Tofu).await);

    let mut opts = options(&server, known.clone(), HostKeyPolicy::Strict, password());
    opts.via = Via::Jump(jump.clone());
    let target = ssh::connect(opts).await.unwrap();
    assert!(target.peer().is_none());
    assert_eq!(target.exec("whoami").await.unwrap().stdout, b"ran:whoami");
    target.disconnect().await;

    let closed = std::net::TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port();
    let mut opts = options(&server, known, HostKeyPolicy::Tofu, password());
    opts.port = closed;
    opts.via = Via::Jump(jump.clone());
    let err = ssh::connect(opts).await.err().unwrap();
    assert!(err.to_string().contains("跳板机无法连接"), "{err}");
    jump.disconnect().await;
}

#[tokio::test]
async fn proxy_failure_names_the_proxy() {
    let server = start_server(true).await;
    let (_dir, known) = store().await;
    let closed = std::net::TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port();
    let mut opts = options(&server, known, HostKeyPolicy::Tofu, password());
    opts.via = Via::Proxy(Proxy {
        kind: ProxyKind::Socks5,
        host: "127.0.0.1".into(),
        port: closed,
        user: String::new(),
        password: None,
    });
    let err = ssh::connect(opts).await.err().unwrap();
    assert!(err.to_string().contains("SOCKS5 代理"), "{err}");
}

#[tokio::test]
async fn ssh_through_our_own_socks_forward() {
    // A dynamic forward on one connection is a working SOCKS5 proxy for the next.
    let server = start_server(true).await;
    let (_dir, known) = store().await;
    let first = Arc::new(connect_ok(&server, known.clone(), HostKeyPolicy::Tofu).await);
    let mut spec = forward_spec(ForwardKind::Dynamic, 0);
    spec.dest_host.clear();
    let socks = Forward::start(&first, spec).await.unwrap();

    let mut opts = options(&server, known, HostKeyPolicy::Strict, password());
    opts.via = Via::Proxy(Proxy {
        kind: ProxyKind::Socks5,
        host: "127.0.0.1".into(),
        port: socks.view().bound_port,
        user: String::new(),
        password: None,
    });
    let second = ssh::connect(opts).await.unwrap();
    assert_eq!(second.exec("id").await.unwrap().stdout, b"ran:id");
    second.disconnect().await;
    first.disconnect().await;
}
