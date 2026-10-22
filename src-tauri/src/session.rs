use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;
use std::sync::atomic::{AtomicU32, Ordering};
use std::time::Duration;

use gxs_core::forward::{Forward, ForwardKind, ForwardSpec};
use gxs_core::known_hosts::{HostKeyPolicy, HostKeyPrompter, KnownHost, UnknownHostKey};
use gxs_core::local_path::sanitize_name;
use gxs_core::monitor::MonitorHandle;
use gxs_core::profiles::{Advanced, AuthMethod, Protocol, Resolved, validate_host};
use gxs_core::pty::{self, PtyOptions};
use gxs_core::serial::{self, PortInfo};
use gxs_core::shells::{self, Shell};
use gxs_core::ssh::{self, ConnectOptions, KbdPrompt, KbdRequest, KeyboardInteractive, SshAuth, SshClient, Via};
use gxs_core::telnet::{self, TelnetOptions};
use gxs_core::transport::Proxy;
use gxs_core::i18n::ltr;
use gxs_core::{Error, PumpConfig, SessionExit, SessionHandle, Spawned, bench, tr};
use serde::{Deserialize, Serialize};
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::{Emitter, Manager, State};
use tokio::sync::oneshot;
use zeroize::Zeroizing;

use crate::monitor::{EVENT_ENDED, SharedCache};
use crate::session_log::{self, LogSlot};
use crate::{AppState, Prompts, Result};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct StatusEnded {
    session_id: u32,
}

const HOST_KEY_PROMPT_TIMEOUT: Duration = Duration::from_secs(120);
const INPUT_PROMPT_TIMEOUT: Duration = Duration::from_secs(300);

static PROMPT_IDS: AtomicU32 = AtomicU32::new(1);

pub(crate) struct Session {
    pub handle: SessionHandle,
    pub remote: Option<Remote>,
    pub log: LogSlot,
}

pub(crate) struct Remote {
    pub client: Arc<SshClient>,
    /// Folder name for this server inside the local work directory.
    pub label: String,
    pub monitor: Option<MonitorHandle>,
    pub status: SharedCache,
    /// Dropped with the session, which stops their listeners.
    pub forwards: Vec<Forward>,
}

impl AppState {
    async fn session(&self, id: u32) -> Result<SessionHandle> {
        self.sessions
            .lock()
            .await
            .get(&id)
            .map(|s| s.handle.clone())
            .ok_or(Error::Closed)
    }

    /// The exit notice goes out on the same channel as the output so it can't overtake the last frame.
    async fn register(
        &self,
        spawned: Spawned,
        remote: Option<Remote>,
        log: LogSlot,
        events: Channel<InvokeResponseBody>,
    ) -> u32 {
        let id = self.id();
        self.sessions.lock().await.insert(
            id,
            Session {
                handle: spawned.handle,
                remote,
                log,
            },
        );
        let sessions = self.sessions.clone();
        let app = self.app.clone();
        tauri::async_runtime::spawn(async move {
            let exit = spawned.exit.await.unwrap_or_else(|_| SessionExit {
                error: Some("session ended unexpectedly".into()),
                ..SessionExit::default()
            });
            let removed = sessions.lock().await.remove(&id);
            if let Some(remote) = removed.and_then(|s| s.remote) {
                let _ = app.emit(EVENT_ENDED, StatusEnded { session_id: id });
                app.state::<AppState>().unwatch(id).await;
                remote.client.disconnect().await;
            }
            if let Ok(json) = serde_json::to_string(&exit) {
                let _ = events.send(InvokeResponseBody::Json(json));
            }
        });
        id
    }
}

/// Frames go out as raw bytes so the webview receives an ArrayBuffer, not JSON.
fn frame_sink(events: &Channel<InvokeResponseBody>, log: &LogSlot) -> impl FnMut(Vec<u8>) -> bool + Send + 'static {
    let events = events.clone();
    let log = log.clone();
    move |frame| {
        session_log::record(&log, &frame);
        events.send(InvokeResponseBody::Raw(frame)).is_ok()
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostKeyPromptEvent {
    prompt_id: u32,
    key: UnknownHostKey,
    /// The answer is ignored after this, so the UI drops the dialog then.
    timeout_secs: u64,
}

struct ChannelPrompter {
    channel: Channel<HostKeyPromptEvent>,
    prompts: Prompts<bool>,
}

impl HostKeyPrompter for ChannelPrompter {
    fn confirm(&self, key: UnknownHostKey) -> Pin<Box<dyn Future<Output = bool> + Send + '_>> {
        Box::pin(async move {
            let prompt_id = PROMPT_IDS.fetch_add(1, Ordering::Relaxed);
            let (tx, rx) = oneshot::channel();
            self.prompts.lock().await.insert(prompt_id, tx);
            let sent = self.channel.send(HostKeyPromptEvent {
                prompt_id,
                key,
                timeout_secs: HOST_KEY_PROMPT_TIMEOUT.as_secs(),
            });
            // Anything other than an explicit "accept" (closed window, timeout, send failure) rejects.
            let accepted =
                sent.is_ok() && matches!(tokio::time::timeout(HOST_KEY_PROMPT_TIMEOUT, rx).await, Ok(Ok(true)));
            self.prompts.lock().await.remove(&prompt_id);
            accepted
        })
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InputPromptEvent {
    prompt_id: u32,
    request: KbdRequest,
    timeout_secs: u64,
}

/// Asks the UI for passwords, passphrases and keyboard-interactive answers.
#[derive(Clone)]
struct Asker {
    channel: Channel<InputPromptEvent>,
    prompts: Prompts<Option<Vec<String>>>,
}

impl Asker {
    async fn ask(&self, request: KbdRequest) -> Option<Vec<String>> {
        let expected = request.prompts.len();
        let prompt_id = PROMPT_IDS.fetch_add(1, Ordering::Relaxed);
        let (tx, rx) = oneshot::channel();
        self.prompts.lock().await.insert(prompt_id, tx);
        let sent = self.channel.send(InputPromptEvent {
            prompt_id,
            request,
            timeout_secs: INPUT_PROMPT_TIMEOUT.as_secs(),
        });
        let answers = match sent {
            Ok(()) => tokio::time::timeout(INPUT_PROMPT_TIMEOUT, rx)
                .await
                .ok()
                .and_then(|r| r.ok())
                .flatten(),
            Err(_) => None,
        };
        self.prompts.lock().await.remove(&prompt_id);
        answers.filter(|a| a.len() == expected)
    }

    async fn secret(&self, title: &str, target: &str, prompt: &str) -> Result<String> {
        let request = KbdRequest {
            name: title.to_owned(),
            instructions: target.to_owned(),
            prompts: vec![KbdPrompt {
                prompt: prompt.to_owned(),
                echo: false,
            }],
        };
        let mut answers = self.ask(request).await.ok_or(Error::Cancelled)?;
        Ok(answers.remove(0))
    }
}

impl KeyboardInteractive for Asker {
    fn respond(&self, request: KbdRequest) -> Pin<Box<dyn Future<Output = Option<Vec<String>>> + Send + '_>> {
        Box::pin(self.ask(request))
    }
}

/// Everything needed to open one SSH tab, whether from a saved profile or an ad-hoc form.
struct Target {
    name: String,
    host: String,
    port: u16,
    method: AuthMethod,
    user: String,
    key_path: String,
    secret: Option<Zeroizing<String>>,
    proxy_secret: Option<Zeroizing<String>>,
    advanced: Advanced,
    profile_id: Option<String>,
}

impl Target {
    fn from_profile(resolved: Resolved) -> Self {
        let view = resolved.view;
        Self {
            name: view.name,
            host: view.host,
            port: view.port,
            method: view.auth.method,
            user: view.auth.user,
            key_path: view.auth.key_path,
            secret: resolved.secret,
            proxy_secret: resolved.proxy_secret,
            advanced: view.advanced,
            profile_id: Some(view.id),
        }
    }

    fn title(&self) -> String {
        if !self.name.is_empty() {
            return self.name.clone();
        }
        match self.advanced.protocol {
            Protocol::Serial => self.advanced.serial.port.trim().to_owned(),
            Protocol::Telnet if self.user.is_empty() => self.host.clone(),
            _ => format!("{}@{}", self.user, self.host),
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshOpened {
    id: u32,
    protocol: Protocol,
    title: String,
    profile_id: Option<String>,
    monitor: bool,
    initial_dir: String,
    auto_reconnect: bool,
    /// Saved forwards that could not start; the connection itself is fine.
    forward_errors: Vec<String>,
}

pub(crate) struct Channels {
    events: Channel<InvokeResponseBody>,
    host_key: Channel<HostKeyPromptEvent>,
    prompt: Channel<InputPromptEvent>,
}

const MAX_JUMPS: usize = 8;

/// The saved jump servers `target` goes through, outermost first.
async fn jump_chain(state: &AppState, target: &Target) -> Result<Vec<Target>> {
    let mut chain: Vec<Target> = Vec::new();
    let mut seen: Vec<String> = target.profile_id.iter().cloned().collect();
    let mut next = target.advanced.jump_id.clone();
    while let Some(id) = next {
        if seen.contains(&id) {
            return Err(Error::Connect(tr!(
                "跳板机设置绕成了环（A 经 B、B 又经 A），请检查各服务器的跳板机设置。",
                "The jump host settings form a loop (A goes through B, and B through A). Check the jump host setting of each server.",
                "ئۆتكۈنچى مۇلازىمېتىر تەڭشىكى ئايلانما ھاسىل قىلىپ قالدى (A بولسا B ئارقىلىق، B يەنە A ئارقىلىق ئۆتىدۇ). ھەر بىر مۇلازىمېتىرنىڭ ئۆتكۈنچى مۇلازىمېتىر تەڭشىكىنى تەكشۈرۈڭ."
            )));
        }
        if chain.len() >= MAX_JUMPS {
            return Err(Error::Connect(tr!(
                "跳板机最多串联 {MAX_JUMPS} 层。",
                "At most {MAX_JUMPS} jump hosts can be chained.",
                "ئەڭ كۆپ بولغاندا {MAX_JUMPS} قەۋەت ئۆتكۈنچى مۇلازىمېتىرنى ئۇلاپ ئىشلەتكىلى بولىدۇ."
            )));
        }
        let hop = match state.profiles.resolve(&id).await {
            Ok(resolved) => Target::from_profile(resolved),
            Err(Error::NotFound(_)) => {
                return Err(Error::Connect(tr!(
                    "找不到设置的跳板机，它可能已被删除。请在服务器设置里重新选择。",
                    "The selected jump host was not found; it may have been deleted. Choose it again in the server settings.",
                    "تەڭشەلگەن ئۆتكۈنچى مۇلازىمېتىر تېپىلمىدى، ئۆچۈرۈلگەن بولۇشى مۇمكىن. مۇلازىمېتىر تەڭشىكىدە قايتا تاللاڭ."
                )));
            }
            Err(e) => return Err(e),
        };
        seen.push(id);
        next = hop.advanced.jump_id.clone();
        chain.push(hop);
    }
    chain.reverse();
    Ok(chain)
}

/// Errors from a jump server say which one, since the user asked for a different host.
fn jump_error(title: &str, e: Error) -> Error {
    match e {
        e @ (Error::HostKeyChanged { .. } | Error::HostKeyRejected { .. } | Error::Cancelled) => e,
        Error::AuthFailed => Error::Connect(tr!(
            "跳板机“{title}”认证失败，请检查它的用户名和凭据。",
            "Authentication failed on the jump host \"{title}\". Check its user name and credentials.",
            "«{title}» ئۆتكۈنچى مۇلازىمېتىردا دەلىللەش مەغلۇپ بولدى، ئۇنىڭ ئىشلەتكۈچى ئاتى ۋە ئىسپات ئۇچۇرىنى تەكشۈرۈڭ."
        )),
        e => Error::Connect(tr!(
            "跳板机“{title}”：{e}",
            "Jump host \"{title}\": {e}",
            "«{title}» ئۆتكۈنچى مۇلازىمېتىر: {e}"
        )),
    }
}

/// The target's proxy, asking for its password when one is needed but not saved.
async fn proxy_for(target: &mut Target, asker: &Asker) -> Result<Option<Proxy>> {
    let proxy = &target.advanced.proxy;
    if !proxy.enabled() {
        return Ok(None);
    }
    let user = proxy.user.trim().to_owned();
    let password = match target.proxy_secret.take() {
        Some(password) => Some(password),
        None if !user.is_empty() => {
            let at = ltr(&format!("{user}@{}:{}", proxy.host, proxy.port));
            let prompt = tr!("代理密码：", "Proxy password:", "ۋاكالەتچى ئىمى:");
            Some(Zeroizing::new(asker.secret(&target.title(), &at, &prompt).await?))
        }
        None => None,
    };
    let proxy = &target.advanced.proxy;
    Ok(Some(Proxy {
        kind: proxy.kind,
        host: proxy.host.trim().to_owned(),
        port: proxy.port,
        user,
        password,
    }))
}

/// Authenticates one hop. `via` is ignored in favour of the hop's proxy when it has one.
async fn connect_one(
    state: &AppState,
    target: &mut Target,
    via: Via,
    asker: &Asker,
    host_key: &Channel<HostKeyPromptEvent>,
    agent_forward: bool,
) -> Result<SshClient> {
    let title = target.title();
    let whom = ltr(&format!("{}@{}:{}", target.user, target.host, target.port));
    let auth = match target.method {
        AuthMethod::Password => SshAuth::Password(match target.secret.take() {
            Some(secret) => secret.to_string(),
            None => asker.secret(&title, &whom, &tr!("密码：", "Password:", "ئىم:")).await?,
        }),
        AuthMethod::KeyFile => {
            let key = tokio::fs::read_to_string(&target.key_path).await.map_err(|e| {
                let path = ltr(&target.key_path);
                Error::Io(std::io::Error::new(
                    e.kind(),
                    tr!(
                        "无法读取私钥 {path}：{e}",
                        "Could not read the private key {path}: {e}",
                        "{path} شەخسىي ئاچقۇچىنى ئوقۇغىلى بولمىدى: {e}"
                    ),
                ))
            })?;
            let passphrase = match target.secret.take() {
                Some(secret) => Some(secret.to_string()),
                None if ssh::key_is_encrypted(&key) => {
                    let prompt = tr!("私钥口令：", "Passphrase:", "ئىم ئىبارىسى:");
                    Some(asker.secret(&title, &whom, &prompt).await?)
                }
                None => None,
            };
            SshAuth::PrivateKey { key, passphrase }
        }
        AuthMethod::KeyboardInteractive => SshAuth::KeyboardInteractive(Arc::new(asker.clone())),
        AuthMethod::Agent => SshAuth::Agent,
    };
    let via = match via {
        Via::Direct => match proxy_for(target, asker).await? {
            Some(proxy) => Via::Proxy(proxy),
            None => Via::Direct,
        },
        via => via,
    };
    let advanced = &target.advanced;
    let prompter: Option<Arc<dyn HostKeyPrompter>> = (advanced.policy == HostKeyPolicy::Prompt).then(|| {
        Arc::new(ChannelPrompter {
            channel: host_key.clone(),
            prompts: state.host_key_prompts.clone(),
        }) as Arc<dyn HostKeyPrompter>
    });
    ssh::connect(ConnectOptions {
        host: target.host.clone(),
        port: target.port,
        user: target.user.clone(),
        auth,
        policy: advanced.policy,
        known_hosts: state.known_hosts.clone(),
        prompter,
        connect_timeout: Duration::from_secs(u64::from(advanced.connect_timeout_secs)),
        keepalive_interval: (advanced.keepalive_secs > 0)
            .then(|| Duration::from_secs(u64::from(advanced.keepalive_secs))),
        via,
        agent_forward,
    })
    .await
}

/// Starts the saved forwards; failures are reported, not fatal.
async fn start_saved_forwards(client: &Arc<SshClient>, specs: &[ForwardSpec]) -> (Vec<Forward>, Vec<String>) {
    let mut started = Vec::new();
    let mut errors = Vec::new();
    for spec in specs {
        match Forward::start(client, spec.clone()).await {
            Ok(forward) => started.push(forward),
            Err(e) => {
                let spec = describe_spec(spec);
                errors.push(tr!("{spec}：{e}", "{spec}: {e}", "{spec}: {e}"));
            }
        }
    }
    (started, errors)
}

fn describe_spec(spec: &ForwardSpec) -> String {
    if !spec.label.trim().is_empty() {
        return spec.label.trim().to_owned();
    }
    // In Uyghur the arrow turns round with the reading direction, as in the frontend.
    let bind = ltr(&format!("{}:{}", spec.bind_host, spec.bind_port));
    let dest = ltr(&format!("{}:{}", spec.dest_host, spec.dest_port));
    match spec.kind {
        ForwardKind::Local => tr!(
            "本地转发 {bind} → {dest}",
            "Local forward {bind} → {dest}",
            "يەرلىك يوللاش {bind} ← {dest}"
        ),
        ForwardKind::Remote => tr!(
            "远程转发 {bind} → {dest}",
            "Remote forward {bind} → {dest}",
            "يىراق يوللاش {bind} ← {dest}"
        ),
        ForwardKind::Dynamic => tr!("SOCKS 代理 {bind}", "SOCKS proxy {bind}", "SOCKS ۋاكالەتچى {bind}"),
    }
}

/// Telnet and serial tabs: a plain byte stream with none of the SSH extras.
async fn open_stream(
    state: &AppState,
    mut target: Target,
    cols: u16,
    rows: u16,
    asker: &Asker,
    events: Channel<InvokeResponseBody>,
) -> Result<SshOpened> {
    let title = target.title();
    let protocol = target.advanced.protocol;
    let log = LogSlot::default();
    let sink = frame_sink(&events, &log);
    let spawned = if protocol == Protocol::Serial {
        let settings = target.advanced.serial.clone();
        tokio::task::spawn_blocking(move || serial::open(&settings, PumpConfig::default(), sink))
            .await
            .map_err(|e| Error::Io(std::io::Error::other(e.to_string())))??
    } else {
        let proxy = proxy_for(&mut target, asker).await?;
        let advanced = &target.advanced;
        let options = TelnetOptions {
            host: target.host.clone(),
            port: target.port,
            term: advanced.term.clone(),
            connect_timeout: Duration::from_secs(u64::from(advanced.connect_timeout_secs)),
            keepalive: (advanced.keepalive_secs > 0).then(|| Duration::from_secs(u64::from(advanced.keepalive_secs))),
            proxy,
            cols,
            rows,
        };
        telnet::connect(options, PumpConfig::default(), sink).await?
    };
    if let Some(id) = &target.profile_id {
        let _ = state.profiles.touch(id).await;
    }
    let id = state.register(spawned, None, log, events).await;
    Ok(SshOpened {
        id,
        protocol,
        title,
        profile_id: target.profile_id,
        monitor: false,
        initial_dir: String::new(),
        auto_reconnect: target.advanced.auto_reconnect,
        forward_errors: Vec::new(),
    })
}

async fn open_target(state: &AppState, mut target: Target, cols: u16, rows: u16, ch: Channels) -> Result<SshOpened> {
    let asker = Asker {
        channel: ch.prompt,
        prompts: state.kbd_prompts.clone(),
    };
    if target.advanced.protocol != Protocol::Ssh {
        return open_stream(state, target, cols, rows, &asker, ch.events).await;
    }
    let title = target.title();
    let mut via = Via::Direct;
    for mut hop in jump_chain(state, &target).await? {
        let hop_title = hop.title();
        let client = connect_one(state, &mut hop, via, &asker, &ch.host_key, false)
            .await
            .map_err(|e| jump_error(&hop_title, e))?;
        via = Via::Jump(Arc::new(client));
    }
    let agent_forward = target.advanced.agent_forward;
    let client = Arc::new(connect_one(state, &mut target, via, &asker, &ch.host_key, agent_forward).await?);
    let advanced = target.advanced;
    let log = LogSlot::default();
    let spawned = match client
        .open_shell(
            &advanced.term,
            cols,
            rows,
            PumpConfig::default(),
            frame_sink(&ch.events, &log),
        )
        .await
    {
        Ok(spawned) => spawned,
        Err(e) => {
            client.disconnect().await;
            return Err(e);
        }
    };
    let command = advanced.startup_command.trim();
    if !command.is_empty() {
        let _ = spawned.handle.write(format!("{command}\r").into_bytes()).await;
    }
    if let Some(id) = &target.profile_id {
        let _ = state.profiles.touch(id).await;
    }
    let label = format!(
        "{}_{}_{}",
        sanitize_name(if target.name.is_empty() {
            &target.host
        } else {
            &target.name
        }),
        sanitize_name(&target.host),
        target.port
    );
    let (forwards, forward_errors) = start_saved_forwards(&client, &advanced.forwards).await;
    let remote = Remote {
        client,
        label,
        monitor: None,
        status: SharedCache::default(),
        forwards,
    };
    let id = state.register(spawned, Some(remote), log, ch.events).await;
    if advanced.monitor {
        state.start_monitor(id).await;
    }
    Ok(SshOpened {
        id,
        protocol: Protocol::Ssh,
        title,
        profile_id: target.profile_id,
        monitor: advanced.monitor,
        initial_dir: advanced.initial_dir,
        auto_reconnect: advanced.auto_reconnect,
        forward_errors,
    })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdhocAuth {
    method: AuthMethod,
    user: String,
    #[serde(default)]
    key_path: String,
    #[serde(default)]
    secret: Option<Zeroizing<String>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshOpenArgs {
    #[serde(default)]
    name: String,
    host: String,
    port: u16,
    auth: AdhocAuth,
    #[serde(default)]
    advanced: Advanced,
    #[serde(default)]
    proxy_password: Option<Zeroizing<String>>,
    cols: u16,
    rows: u16,
}

#[tauri::command]
pub async fn local_shells() -> Result<Vec<Shell>> {
    tokio::task::spawn_blocking(shells::detect)
        .await
        .map_err(|e| Error::Io(std::io::Error::other(e.to_string())))
}

#[tauri::command]
pub async fn serial_ports() -> Result<Vec<PortInfo>> {
    tokio::task::spawn_blocking(serial::list_ports)
        .await
        .map_err(|e| Error::Io(std::io::Error::other(e.to_string())))?
}

#[tauri::command]
pub async fn pty_open(
    state: State<'_, AppState>,
    cols: u16,
    rows: u16,
    shell: Option<String>,
    on_event: Channel<InvokeResponseBody>,
) -> Result<u32> {
    let mut options = PtyOptions {
        cols,
        rows,
        ..PtyOptions::default()
    };
    if let Some(id) = shell.filter(|id| !id.is_empty()) {
        let found = tokio::task::spawn_blocking(move || shells::find(&id).ok_or(id))
            .await
            .map_err(|e| Error::Io(std::io::Error::other(e.to_string())))?;
        match found {
            Ok(shell) => shell.apply(&mut options),
            Err(id) => {
                let id = ltr(&id);
                return Err(Error::Data(tr!(
                    "找不到本地终端“{id}”，可能已经卸载。",
                    "The local terminal \"{id}\" was not found; it may have been uninstalled.",
                    "«{id}» يەرلىك تېرمىنالى تېپىلمىدى، ئۆچۈرۈۋېتىلگەن بولۇشى مۇمكىن."
                )));
            }
        }
    }
    let log = LogSlot::default();
    let spawned = pty::spawn(options, PumpConfig::default(), frame_sink(&on_event, &log))?;
    Ok(state.register(spawned, None, log, on_event).await)
}

/// Connects without saving anything ("仅连接").
#[tauri::command]
pub async fn ssh_open(
    state: State<'_, AppState>,
    args: SshOpenArgs,
    on_event: Channel<InvokeResponseBody>,
    on_host_key: Channel<HostKeyPromptEvent>,
    on_prompt: Channel<InputPromptEvent>,
) -> Result<SshOpened> {
    let host = args.host.trim().to_owned();
    let user = args.auth.user.trim().to_owned();
    match args.advanced.protocol {
        Protocol::Serial => {}
        Protocol::Telnet => {
            validate_host(&host)?;
            if args.port == 0 {
                return Err(Error::Invalid(tr!("端口不能为空", "The port can't be empty", "ئېغىز بوش بولسا بولمايدۇ")));
            }
        }
        Protocol::Ssh => {
            validate_host(&host)?;
            if args.port == 0 || user.is_empty() {
                return Err(Error::Invalid(tr!(
                    "端口和用户名不能为空",
                    "The port and user name can't be empty",
                    "ئېغىز ۋە ئىشلەتكۈچى ئاتى بوش بولسا بولمايدۇ"
                )));
            }
        }
    }
    args.advanced.validate()?;
    let target = Target {
        name: args.name.trim().to_owned(),
        host,
        port: args.port,
        method: args.auth.method,
        user,
        key_path: args.auth.key_path.trim().to_owned(),
        secret: args.auth.secret.filter(|s| !s.is_empty()),
        proxy_secret: args.proxy_password.filter(|s| !s.is_empty()),
        advanced: args.advanced,
        profile_id: None,
    };
    let channels = Channels {
        events: on_event,
        host_key: on_host_key,
        prompt: on_prompt,
    };
    open_target(&state, target, args.cols, args.rows, channels).await
}

/// Connects a saved server. The stored secret is decrypted here and never crosses the IPC boundary.
#[tauri::command]
pub async fn ssh_open_profile(
    state: State<'_, AppState>,
    profile_id: String,
    cols: u16,
    rows: u16,
    on_event: Channel<InvokeResponseBody>,
    on_host_key: Channel<HostKeyPromptEvent>,
    on_prompt: Channel<InputPromptEvent>,
) -> Result<SshOpened> {
    let target = Target::from_profile(state.profiles.resolve(&profile_id).await?);
    let channels = Channels {
        events: on_event,
        host_key: on_host_key,
        prompt: on_prompt,
    };
    open_target(&state, target, cols, rows, channels).await
}

#[tauri::command]
pub async fn bench_open(
    state: State<'_, AppState>,
    total_bytes: u64,
    rows: u16,
    on_event: Channel<InvokeResponseBody>,
) -> Result<u32> {
    let log = LogSlot::default();
    let spawned = bench::spawn(total_bytes, rows, PumpConfig::default(), frame_sink(&on_event, &log));
    Ok(state.register(spawned, None, log, on_event).await)
}

#[tauri::command]
pub async fn session_write(state: State<'_, AppState>, id: u32, data: String) -> Result<()> {
    state.session(id).await?.write(data.into_bytes()).await
}

/// Binary input (ZMODEM). The bytes are the raw request body; the session id is the `x-session` header.
#[tauri::command]
pub async fn session_write_bytes(state: State<'_, AppState>, request: tauri::ipc::Request<'_>) -> Result<()> {
    let tauri::ipc::InvokeBody::Raw(data) = request.body() else {
        return Err(Error::Invalid(tr!(
            "需要二进制数据",
            "Binary data is required",
            "ئىككىلىك سانلىق مەلۇمات كېرەك"
        )));
    };
    let id = request
        .headers()
        .get("x-session")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse::<u32>().ok())
        .ok_or_else(|| Error::Invalid(tr!("缺少会话编号", "The session id is missing", "ئەڭگىمە نومۇرى كەم")))?;
    let data = data.clone();
    state.session(id).await?.write(data).await
}

#[tauri::command]
pub async fn session_resize(state: State<'_, AppState>, id: u32, cols: u16, rows: u16) -> Result<()> {
    state.session(id).await?.resize(cols, rows).await
}

#[tauri::command]
pub async fn session_ack(state: State<'_, AppState>, id: u32, bytes: u64) -> Result<()> {
    state.session(id).await?.ack(bytes);
    Ok(())
}

#[tauri::command]
pub async fn session_close(state: State<'_, AppState>, id: u32) -> Result<()> {
    if let Ok(handle) = state.session(id).await {
        handle.close().await;
    }
    Ok(())
}

#[tauri::command]
pub async fn host_key_answer(state: State<'_, AppState>, prompt_id: u32, accept: bool) -> Result<()> {
    if let Some(tx) = state.host_key_prompts.lock().await.remove(&prompt_id) {
        let _ = tx.send(accept);
    }
    Ok(())
}

/// `None` aborts authentication.
#[tauri::command]
pub async fn prompt_answer(state: State<'_, AppState>, prompt_id: u32, answers: Option<Vec<String>>) -> Result<()> {
    if let Some(tx) = state.kbd_prompts.lock().await.remove(&prompt_id) {
        let _ = tx.send(answers);
    }
    Ok(())
}

#[tauri::command]
pub async fn known_hosts_list(state: State<'_, AppState>) -> Result<Vec<KnownHost>> {
    Ok(state.known_hosts.list().await)
}

#[tauri::command]
pub async fn known_hosts_remove(state: State<'_, AppState>, host: String, port: u16) -> Result<usize> {
    state.known_hosts.remove(&host, port).await
}
