//! Saved connections and their groups. Secrets are stored sealed (DPAPI, or the master password's
//! key) and never leave this module in any form the UI can see: views only carry `hasSecret`.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, PoisonError};

use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;
use zeroize::Zeroizing;

use crate::error::{Error, Result};
use crate::forward::{ForwardSpec, MAX_SAVED_FORWARDS};
use crate::fsutil::{self, now_secs};
use crate::known_hosts::HostKeyPolicy;
use crate::serial::SerialSettings;
use crate::passphrase::{Cost, MasterKey, MasterLock, check_password};
use crate::secret::{Sealed, Vault};
use crate::transport::ProxyKind;

mod portable;

pub use portable::{
    MAX_PORTABLE_SERVERS, MergeReport, PortableProfiles, PortableSecret, PortableSecrets, PortableServer,
};

const STORE_VERSION: u32 = 1;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Group {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AuthMethod {
    Password,
    KeyFile,
    KeyboardInteractive,
    /// Keys held by Pageant or the OpenSSH agent.
    Agent,
}

impl AuthMethod {
    /// Whether a stored secret (password or key passphrase) means anything for this method.
    fn keeps_secret(self) -> bool {
        matches!(self, Self::Password | Self::KeyFile)
    }
}

/// The proxy password is stored sealed next to the server, not in here.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ProxySettings {
    pub kind: ProxyKind,
    pub host: String,
    pub port: u16,
    pub user: String,
}

impl ProxySettings {
    pub fn enabled(&self) -> bool {
        self.kind != ProxyKind::None
    }

    fn validate(&self) -> Result<()> {
        if !self.enabled() {
            return Ok(());
        }
        validate_host(self.host.trim()).map_err(|_| {
            Error::invalid(crate::tr!(
                "代理地址不能为空，也不能包含空格",
                "The proxy address cannot be empty or contain spaces",
                "ۋاكالەتچى ئادرېسى بوش ياكى بوشلۇق بار بولسا بولمايدۇ"
            ))
        })?;
        if self.port == 0 {
            return Err(Error::invalid(crate::tr!(
                "代理端口必须是 1-65535",
                "The proxy port must be 1-65535",
                "ۋاكالەتچى ئېغىزى 1-65535 بولۇشى كېرەك"
            )));
        }
        if self.user.len() > 255 || self.user.chars().any(char::is_control) {
            return Err(Error::invalid(crate::tr!(
                "代理用户名最多 255 字节",
                "The proxy user name can be 255 bytes at most",
                "ۋاكالەتچى ئىشلەتكۈچى ئاتى ئەڭ كۆپ 255 بايت بولىدۇ"
            )));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Protocol {
    #[default]
    Ssh,
    Telnet,
    Serial,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Advanced {
    pub protocol: Protocol,
    /// Only used by serial connections, which have no host or port.
    pub serial: SerialSettings,
    pub policy: HostKeyPolicy,
    pub connect_timeout_secs: u32,
    /// 0 disables keepalives.
    pub keepalive_secs: u32,
    pub term: String,
    pub startup_command: String,
    pub initial_dir: String,
    pub monitor: bool,
    pub proxy: ProxySettings,
    /// Saved server to tunnel through. Exclusive with `proxy`; the jump server may have its own.
    pub jump_id: Option<String>,
    pub agent_forward: bool,
    /// Started with every connection.
    pub forwards: Vec<ForwardSpec>,
    pub auto_reconnect: bool,
}

impl Default for Advanced {
    fn default() -> Self {
        Self {
            protocol: Protocol::Ssh,
            serial: SerialSettings::default(),
            policy: HostKeyPolicy::Prompt,
            connect_timeout_secs: 10,
            keepalive_secs: 30,
            term: "xterm-256color".into(),
            startup_command: String::new(),
            initial_dir: String::new(),
            monitor: true,
            proxy: ProxySettings::default(),
            jump_id: None,
            agent_forward: false,
            forwards: Vec::new(),
            auto_reconnect: false,
        }
    }
}

impl Advanced {
    pub fn validate(&self) -> Result<()> {
        if !(1..=120).contains(&self.connect_timeout_secs) {
            return Err(Error::invalid("connect timeout must be 1-120 seconds"));
        }
        if self.keepalive_secs > 3600 {
            return Err(Error::invalid("keepalive interval must be 0-3600 seconds"));
        }
        let term_ok = !self.term.is_empty()
            && self.term.len() <= 64
            && self
                .term
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"-_.+".contains(&b));
        if !term_ok {
            return Err(Error::invalid(
                "terminal type may only contain letters, digits and -_.+",
            ));
        }
        if self.startup_command.len() > 4096 || self.initial_dir.len() > 4096 {
            return Err(Error::invalid("startup command or initial directory is too long"));
        }
        self.proxy.validate()?;
        match self.protocol {
            Protocol::Ssh => {}
            Protocol::Telnet if self.jump_id.is_some() => {
                return Err(Error::invalid(crate::tr!(
                    "Telnet 连接不能经过跳板机，可以改用代理",
                    "Telnet connections cannot go through a jump host. Use a proxy instead",
                    "Telnet ئۇلىنىشى ئۆتكۈنچى مۇلازىمېتىردىن ئۆتەلمەيدۇ، ئۇنىڭ ئورنىغا ۋاكالەتچى ئىشلىتىڭ"
                )));
            }
            Protocol::Telnet => {}
            Protocol::Serial => return self.serial.validate(),
        }
        if self.proxy.enabled() && self.jump_id.is_some() {
            return Err(Error::invalid(crate::tr!(
                "代理和跳板机只能选一个；需要两者时，请给跳板机配置代理",
                "Choose either a proxy or a jump host. To use both, set the proxy on the jump host",
                "ۋاكالەتچى بىلەن ئۆتكۈنچى مۇلازىمېتىردىن پەقەت بىرىنىلا تاللىغىلى بولىدۇ؛ ئىككىلىسى كېرەك بولسا، ئۆتكۈنچى مۇلازىمېتىرغا ۋاكالەتچى سەپلەڭ"
            )));
        }
        if self.forwards.len() > MAX_SAVED_FORWARDS {
            return Err(Error::invalid(crate::tr!(
                "最多保存 {MAX_SAVED_FORWARDS} 条端口转发",
                "At most {MAX_SAVED_FORWARDS} port forwards can be saved",
                "ئەڭ كۆپ {MAX_SAVED_FORWARDS} ئېغىز يوللاش ساقلىغىلى بولىدۇ"
            )));
        }
        self.forwards.iter().try_for_each(ForwardSpec::validate)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredAuth {
    method: AuthMethod,
    user: String,
    #[serde(default)]
    key_path: String,
    /// Password for `password`, key passphrase for `keyFile`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    secret: Option<Sealed>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredServer {
    id: String,
    name: String,
    group_id: Option<String>,
    host: String,
    port: u16,
    #[serde(default)]
    note: String,
    auth: StoredAuth,
    #[serde(default)]
    advanced: Advanced,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    proxy_secret: Option<Sealed>,
    #[serde(default)]
    last_connected_at: Option<u64>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct StoreFile {
    version: u32,
    groups: Vec<Group>,
    servers: Vec<StoredServer>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    master: Option<MasterLock>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MasterStatus {
    pub enabled: bool,
    pub unlocked: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthView {
    pub method: AuthMethod,
    pub user: String,
    pub key_path: String,
    pub has_secret: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerView {
    pub id: String,
    pub name: String,
    pub group_id: Option<String>,
    pub host: String,
    pub port: u16,
    pub note: String,
    pub auth: AuthView,
    pub advanced: Advanced,
    pub has_proxy_secret: bool,
    pub last_connected_at: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Profiles {
    pub groups: Vec<Group>,
    pub servers: Vec<ServerView>,
}

#[derive(Deserialize)]
#[serde(tag = "action", rename_all = "camelCase")]
pub enum SecretUpdate {
    Keep,
    Clear,
    Set { value: Zeroizing<String> },
}

impl SecretUpdate {
    fn seal(&self, vault: &Vault) -> Result<Option<Sealed>> {
        match self {
            Self::Set { value } if !value.is_empty() => Sealed::seal(value, vault).map(Some),
            _ => Ok(None),
        }
    }

    fn apply(self, sealed: Option<Sealed>, previous: Option<Sealed>) -> Option<Sealed> {
        match self {
            Self::Set { .. } => sealed,
            Self::Clear => None,
            Self::Keep => previous,
        }
    }
}

fn keep() -> SecretUpdate {
    SecretUpdate::Keep
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthInput {
    pub method: AuthMethod,
    pub user: String,
    #[serde(default)]
    pub key_path: String,
    pub secret: SecretUpdate,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerInput {
    /// `None` creates a new server.
    pub id: Option<String>,
    pub name: String,
    pub group_id: Option<String>,
    pub host: String,
    pub port: u16,
    #[serde(default)]
    pub note: String,
    pub auth: AuthInput,
    #[serde(default)]
    pub advanced: Advanced,
    #[serde(default = "keep")]
    pub proxy_secret: SecretUpdate,
}

/// Everything needed to connect, with secrets decrypted. Lives only inside the backend.
pub struct Resolved {
    pub view: ServerView,
    pub secret: Option<Zeroizing<String>>,
    pub proxy_secret: Option<Zeroizing<String>>,
}

impl StoredServer {
    fn view(&self) -> ServerView {
        ServerView {
            id: self.id.clone(),
            name: self.name.clone(),
            group_id: self.group_id.clone(),
            host: self.host.clone(),
            port: self.port,
            note: self.note.clone(),
            auth: AuthView {
                method: self.auth.method,
                user: self.auth.user.clone(),
                key_path: self.auth.key_path.clone(),
                has_secret: self.auth.secret.is_some(),
            },
            advanced: self.advanced.clone(),
            has_proxy_secret: self.proxy_secret.is_some(),
            last_connected_at: self.last_connected_at,
        }
    }
}

pub fn validate_host(host: &str) -> Result<()> {
    if host.is_empty() || host.len() > 253 || host.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return Err(Error::invalid("host must be a hostname or IP address without spaces"));
    }
    Ok(())
}

fn validate_input(input: &ServerInput, groups: &[Group], servers: &[StoredServer]) -> Result<()> {
    if input.name.trim().chars().count() > 128 || input.note.chars().count() > 2000 {
        return Err(Error::invalid("name or note is too long"));
    }
    let protocol = input.advanced.protocol;
    if protocol != Protocol::Serial {
        validate_host(input.host.trim())?;
        if input.port == 0 {
            return Err(Error::invalid("port must be 1-65535"));
        }
    }
    let user = input.auth.user.trim();
    if user.len() > 128 || user.chars().any(char::is_control) {
        return Err(Error::invalid("user name is too long"));
    }
    if protocol == Protocol::Ssh {
        if user.is_empty() {
            return Err(Error::invalid("user name is required"));
        }
        if input.auth.method == AuthMethod::KeyFile && input.auth.key_path.trim().is_empty() {
            return Err(Error::invalid("private key file is required"));
        }
    }
    if let Some(group) = &input.group_id
        && !groups.iter().any(|g| &g.id == group)
    {
        return Err(Error::NotFound("group".into()));
    }
    if let Some(jump) = &input.advanced.jump_id {
        if input.id.as_ref() == Some(jump) {
            return Err(Error::invalid(crate::tr!(
                "跳板机不能是这台服务器自己",
                "A server cannot be its own jump host",
                "مۇلازىمېتىر ئۆزىنىڭ ئۆتكۈنچى مۇلازىمېتىرى بولالمايدۇ"
            )));
        }
        if !servers.iter().any(|s| &s.id == jump) {
            return Err(Error::NotFound(crate::tr!("跳板机", "jump host", "ئۆتكۈنچى مۇلازىمېتىر")));
        }
    }
    input.advanced.validate()
}

fn validate_group_name(name: &str) -> Result<String> {
    let name = name.trim();
    if name.is_empty() || name.chars().count() > 64 {
        return Err(Error::invalid("group name must be 1-64 characters"));
    }
    Ok(name.to_owned())
}

pub struct ImportEntry {
    /// `id`, `group_id` and `advanced.jump_id` are ignored, and so is `proxy_secret`.
    pub input: ServerInput,
    /// Group name, created when no group has it.
    pub group: Option<String>,
    pub jump: Option<JumpRef>,
}

pub enum JumpRef {
    /// Index of another entry in the same batch.
    Batch(usize),
    /// Id of a server that is already saved.
    Saved(String),
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportReport {
    pub added: usize,
    pub failed: Vec<ImportFailure>,
    /// Servers that came in with their saved password.
    pub secrets: usize,
    /// Saved passwords that could not be read and were left out.
    pub secrets_unreadable: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportFailure {
    pub name: String,
    pub reason: String,
}

fn group_named(data: &mut StoreFile, name: String) -> String {
    if let Some(group) = data.groups.iter().find(|g| g.name == name) {
        return group.id.clone();
    }
    let id = new_id(|id| data.groups.iter().any(|g| g.id == id));
    data.groups.push(Group { id: id.clone(), name });
    id
}

static ID_COUNTER: AtomicU32 = AtomicU32::new(0);

fn new_id(taken: impl Fn(&str) -> bool) -> String {
    loop {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_or(0, |d| d.as_nanos());
        let id = format!("{nanos:x}{:04x}", ID_COUNTER.fetch_add(1, Ordering::Relaxed) & 0xffff);
        if !taken(&id) {
            return id;
        }
    }
}

/// The derived key, paired with the lock it came from so a key is never used after the master
/// password it belongs to has been changed or removed.
type Unlocked = Option<(MasterLock, Arc<MasterKey>)>;

fn no_master() -> Error {
    Error::invalid(crate::tr!(
        "没有设置主密码",
        "No master password is set",
        "ئاساسىي ئىم تەڭشەلمىگەن"
    ))
    .on("master")
}

async fn blocking<T: Send + 'static>(work: impl FnOnce() -> Result<T> + Send + 'static) -> Result<T> {
    tokio::task::spawn_blocking(work)
        .await
        .map_err(|e| {
            Error::Secret(crate::tr!(
                "密钥派生中断：{e}",
                "Key derivation was interrupted: {e}",
                "ئاچقۇچ ھاسىل قىلىش ئۈزۈلۈپ قالدى: {e}"
            ))
        })?
}

pub struct ProfileStore {
    path: PathBuf,
    data: Mutex<StoreFile>,
    key: std::sync::Mutex<Unlocked>,
    cost: Cost,
}

impl ProfileStore {
    /// Missing file: empty store. Corrupt file: error, so a damaged file is never overwritten.
    pub async fn open(path: impl Into<PathBuf>) -> Result<Self> {
        let path = path.into();
        let data = match fsutil::read_optional(&path).await? {
            None => StoreFile {
                version: STORE_VERSION,
                ..StoreFile::default()
            },
            Some(bytes) => {
                let file: StoreFile = serde_json::from_slice(&bytes).map_err(|e| Error::Profile(e.to_string()))?;
                if file.version != STORE_VERSION {
                    return Err(Error::Profile(format!("unsupported version {}", file.version)));
                }
                file
            }
        };
        Ok(Self {
            path,
            data: Mutex::new(data),
            key: std::sync::Mutex::new(None),
            cost: Cost::DEFAULT,
        })
    }

    fn vault(&self, data: &StoreFile) -> Vault {
        let Some(lock) = &data.master else {
            return Vault::Dpapi;
        };
        match &*self.key.lock().unwrap_or_else(PoisonError::into_inner) {
            Some((unlocked, key)) if unlocked == lock => Vault::Master(key.clone()),
            _ => Vault::Locked,
        }
    }

    fn set_key(&self, key: Unlocked) {
        *self.key.lock().unwrap_or_else(PoisonError::into_inner) = key;
    }

    pub async fn master_status(&self) -> MasterStatus {
        let data = self.data.lock().await;
        MasterStatus {
            enabled: data.master.is_some(),
            unlocked: matches!(self.vault(&data), Vault::Master(_)),
        }
    }

    pub async fn unlock(&self, password: Zeroizing<String>) -> Result<()> {
        let lock = self
            .data
            .lock()
            .await
            .master
            .clone()
            .ok_or_else(no_master)?;
        let checking = lock.clone();
        let key = blocking(move || checking.unlock(&password)).await?;
        let data = self.data.lock().await;
        if data.master.as_ref() != Some(&lock) {
            return Err(Error::invalid(crate::tr!(
                "主密码刚被修改，请重新输入",
                "The master password was just changed. Enter it again",
                "ئاساسىي ئىم ھازىرلا ئۆزگەرتىلدى، قايتا كىرگۈزۈڭ"
            ))
            .on("master"));
        }
        self.set_key(Some((lock, Arc::new(key))));
        Ok(())
    }

    /// Forgets the key; saved secrets need the master password again.
    pub fn lock(&self) {
        self.set_key(None);
    }

    /// Sets, changes or (`next: None`) removes the master password. `current` is required
    /// whenever one is set. Every saved secret is resealed in the same write.
    pub async fn set_master(&self, current: Option<Zeroizing<String>>, next: Option<Zeroizing<String>>) -> Result<()> {
        if let Some(next) = &next {
            check_password(next)?;
        }
        let existing = self.data.lock().await.master.clone();
        if existing.is_none() && next.is_none() {
            return Err(no_master());
        }
        let cost = self.cost;
        let checking = existing.clone();
        let (old_key, created) = blocking(move || {
            let old = match &checking {
                None => None,
                Some(lock) => {
                    let current = current
                        .filter(|c| !c.is_empty())
                        .ok_or_else(|| {
                            Error::invalid(crate::tr!(
                                "请输入当前的主密码",
                                "Enter the current master password",
                                "نۆۋەتتىكى ئاساسىي ئىمنى كىرگۈزۈڭ"
                            ))
                            .on("master")
                        })?;
                    Some(Arc::new(lock.unlock(&current)?))
                }
            };
            let created = next.map(|next| MasterLock::create(&next, cost)).transpose()?;
            Ok((old, created))
        })
        .await?;
        let old_vault = old_key.map_or(Vault::Dpapi, Vault::Master);
        let created = created.map(|(lock, key)| (lock, Arc::new(key)));
        let new_vault = created
            .as_ref()
            .map_or(Vault::Dpapi, |(_, key)| Vault::Master(key.clone()));
        let new_lock = created.as_ref().map(|(lock, _)| lock.clone());
        self.mutate(|data| {
            if data.master != existing {
                return Err(Error::invalid(crate::tr!(
                    "主密码刚被修改，请重试",
                    "The master password was just changed. Try again",
                    "ئاساسىي ئىم ھازىرلا ئۆزگەرتىلدى، قايتا سىناڭ"
                ))
                .on("master"));
            }
            for server in &mut data.servers {
                let reseal = |slot: &mut Option<Sealed>| -> Result<()> {
                    if let Some(sealed) = slot {
                        let plain = sealed.open(&old_vault).map_err(|_| {
                            let name = &server.name;
                            Error::Data(crate::tr!(
                                "无法解开“{name}”保存的密码，请先在它的设置里重新填写或清除",
                                "Cannot unlock the password saved for \"{name}\". Enter it again or clear it in that server's settings first",
                                "«{name}» دا ساقلانغان ئىمنى ئاچالمىدى، ئالدى بىلەن ئۇنىڭ تەڭشىكىدە قايتا تولدۇرۇڭ ياكى تازىلاڭ"
                            ))
                        })?;
                        *sealed = Sealed::seal(&plain, &new_vault)?;
                    }
                    Ok(())
                };
                let (mut secret, mut proxy) = (server.auth.secret.take(), server.proxy_secret.take());
                reseal(&mut secret)?;
                reseal(&mut proxy)?;
                server.auth.secret = secret;
                server.proxy_secret = proxy;
            }
            data.master = new_lock;
            Ok(())
        })
        .await?;
        self.set_key(created);
        Ok(())
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub async fn list(&self) -> Profiles {
        let data = self.data.lock().await;
        Profiles {
            groups: data.groups.clone(),
            servers: data.servers.iter().map(StoredServer::view).collect(),
        }
    }

    /// Applies `f` to a copy, persists it, and only then makes it current.
    async fn mutate<T>(&self, f: impl FnOnce(&mut StoreFile) -> Result<T>) -> Result<T> {
        let mut data = self.data.lock().await;
        let mut next = data.clone();
        let out = f(&mut next)?;
        let body = serde_json::to_vec_pretty(&next).map_err(|e| Error::Profile(e.to_string()))?;
        fsutil::write_atomic(&self.path, body).await?;
        *data = next;
        Ok(out)
    }

    pub async fn save_server(&self, input: ServerInput) -> Result<ServerView> {
        self.mutate(move |data| {
            validate_input(&input, &data.groups, &data.servers)?;
            let vault = self.vault(data);
            let sealed = input.auth.secret.seal(&vault)?;
            let proxy_sealed = input.proxy_secret.seal(&vault)?;
            let existing = match &input.id {
                Some(id) => Some(
                    data.servers
                        .iter()
                        .position(|s| &s.id == id)
                        .ok_or_else(|| Error::NotFound("server".into()))?,
                ),
                None => None,
            };
            let previous = existing.map(|i| &data.servers[i]);
            // A password must never be reused as a key passphrase or vice versa.
            let kept = previous
                .filter(|p| p.auth.method == input.auth.method)
                .and_then(|p| p.auth.secret.clone());
            let secret = input
                .auth
                .secret
                .apply(sealed, kept)
                .filter(|_| input.auth.method.keeps_secret());
            let proxy_secret = input
                .proxy_secret
                .apply(proxy_sealed, previous.and_then(|p| p.proxy_secret.clone()))
                .filter(|_| input.advanced.proxy.enabled() && !input.advanced.proxy.user.trim().is_empty());
            let mut advanced = input.advanced;
            advanced.proxy.host = advanced.proxy.host.trim().to_owned();
            advanced.proxy.user = advanced.proxy.user.trim().to_owned();
            let host = input.host.trim().to_owned();
            let name = match input.name.trim() {
                "" => host.clone(),
                name => name.to_owned(),
            };
            let server = StoredServer {
                id: match previous {
                    Some(p) => p.id.clone(),
                    None => new_id(|id| data.servers.iter().any(|s| s.id == id)),
                },
                name,
                group_id: input.group_id,
                host,
                port: input.port,
                note: input.note,
                auth: StoredAuth {
                    method: input.auth.method,
                    user: input.auth.user.trim().to_owned(),
                    key_path: input.auth.key_path.trim().to_owned(),
                    secret,
                },
                advanced,
                proxy_secret,
                last_connected_at: previous.and_then(|p| p.last_connected_at),
            };
            let view = server.view();
            match existing {
                Some(i) => data.servers[i] = server,
                None => data.servers.push(server),
            }
            Ok(view)
        })
        .await
    }

    pub async fn delete_server(&self, id: &str) -> Result<()> {
        self.mutate(|data| {
            let before = data.servers.len();
            if let Some(user) = data.servers.iter().find(|s| s.advanced.jump_id.as_deref() == Some(id)) {
                let name = &user.name;
                return Err(Error::invalid(crate::tr!(
                    "“{name}”把这台服务器用作跳板机，请先在它的设置里取消",
                    "\"{name}\" uses this server as its jump host. Remove it in that server's settings first",
                    "«{name}» بۇ مۇلازىمېتىرنى ئۆتكۈنچى مۇلازىمېتىر قىلىپ ئىشلىتىۋاتىدۇ، ئالدى بىلەن ئۇنىڭ تەڭشىكىدە بىكار قىلىڭ"
                )));
            }
            data.servers.retain(|s| s.id != id);
            if data.servers.len() == before {
                return Err(Error::NotFound("server".into()));
            }
            Ok(())
        })
        .await
    }

    pub async fn duplicate_server(&self, id: &str) -> Result<ServerView> {
        self.mutate(|data| {
            let source = data
                .servers
                .iter()
                .find(|s| s.id == id)
                .ok_or_else(|| Error::NotFound("server".into()))?;
            let mut copy = source.clone();
            copy.id = new_id(|id| data.servers.iter().any(|s| s.id == id));
            copy.name = format!("{} (copy)", source.name);
            copy.last_connected_at = None;
            let view = copy.view();
            let at = data
                .servers
                .iter()
                .position(|s| s.id == id)
                .map_or(data.servers.len(), |i| i + 1);
            data.servers.insert(at, copy);
            Ok(view)
        })
        .await
    }

    pub async fn move_servers(&self, ids: &[String], group_id: Option<String>) -> Result<()> {
        self.mutate(|data| {
            if let Some(group) = &group_id
                && !data.groups.iter().any(|g| &g.id == group)
            {
                return Err(Error::NotFound("group".into()));
            }
            for server in data.servers.iter_mut().filter(|s| ids.contains(&s.id)) {
                server.group_id = group_id.clone();
            }
            Ok(())
        })
        .await
    }

    pub async fn save_group(&self, id: Option<String>, name: &str) -> Result<Group> {
        let name = validate_group_name(name)?;
        self.mutate(|data| match id {
            Some(id) => {
                let group = data
                    .groups
                    .iter_mut()
                    .find(|g| g.id == id)
                    .ok_or_else(|| Error::NotFound("group".into()))?;
                group.name = name;
                Ok(group.clone())
            }
            None => {
                let group = Group {
                    id: new_id(|id| data.groups.iter().any(|g| g.id == id)),
                    name,
                };
                data.groups.push(group.clone());
                Ok(group)
            }
        })
        .await
    }

    /// Servers in the group become ungrouped; they are never deleted with it.
    pub async fn delete_group(&self, id: &str) -> Result<()> {
        self.mutate(|data| {
            let before = data.groups.len();
            data.groups.retain(|g| g.id != id);
            if data.groups.len() == before {
                return Err(Error::NotFound("group".into()));
            }
            for server in data.servers.iter_mut().filter(|s| s.group_id.as_deref() == Some(id)) {
                server.group_id = None;
            }
            Ok(())
        })
        .await
    }

    /// Adds servers in one write. Groups are matched by name and created when missing; an entry
    /// that fails validation is reported and the rest still go in. A login secret set on an
    /// entry is sealed like one typed in; with the master password locked nothing is written.
    pub async fn import(&self, entries: Vec<ImportEntry>) -> Result<ImportReport> {
        self.mutate(|data| {
            let vault = self.vault(data);
            if matches!(vault, Vault::Locked) && entries.iter().any(|e| matches!(e.input.auth.secret, SecretUpdate::Set { .. })) {
                return Err(Error::Locked);
            }
            let mut report = ImportReport::default();
            let mut ids: Vec<Option<String>> = Vec::with_capacity(entries.len());
            let mut jumps = Vec::new();
            for (index, entry) in entries.into_iter().enumerate() {
                let ImportEntry { mut input, group, jump } = entry;
                input.id = None;
                input.group_id = None;
                input.advanced.jump_id = None;
                let label = match input.name.trim() {
                    "" => input.host.trim().to_owned(),
                    name => name.to_owned(),
                };
                let checked = validate_input(&input, &data.groups, &data.servers).and_then(|()| {
                    group
                        .as_deref()
                        .map(|name| validate_group_name(name).map(|name| group_named(data, name)))
                        .transpose()
                });
                let group_id = match checked {
                    Ok(group_id) => group_id,
                    Err(error) => {
                        report.failed.push(ImportFailure {
                            name: label,
                            reason: error.to_string(),
                        });
                        ids.push(None);
                        continue;
                    }
                };
                let secret = if input.auth.method.keeps_secret() {
                    input.auth.secret.seal(&vault)?
                } else {
                    None
                };
                if secret.is_some() {
                    report.secrets += 1;
                }
                let id = new_id(|id| data.servers.iter().any(|s| s.id == id));
                let mut advanced = input.advanced;
                advanced.proxy.host = advanced.proxy.host.trim().to_owned();
                advanced.proxy.user = advanced.proxy.user.trim().to_owned();
                data.servers.push(StoredServer {
                    id: id.clone(),
                    name: label,
                    group_id,
                    host: input.host.trim().to_owned(),
                    port: input.port,
                    note: input.note,
                    auth: StoredAuth {
                        method: input.auth.method,
                        user: input.auth.user.trim().to_owned(),
                        key_path: input.auth.key_path.trim().to_owned(),
                        secret,
                    },
                    advanced,
                    proxy_secret: None,
                    last_connected_at: None,
                });
                if let Some(target) = jump {
                    jumps.push((index, target));
                }
                ids.push(Some(id));
                report.added += 1;
            }
            for (index, target) in jumps {
                let jump = match target {
                    JumpRef::Batch(i) => ids.get(i).cloned().flatten(),
                    JumpRef::Saved(id) => data.servers.iter().any(|s| s.id == id).then_some(id),
                };
                let (Some(id), Some(jump)) = (&ids[index], jump) else {
                    continue;
                };
                if *id == jump {
                    continue;
                }
                if let Some(server) = data.servers.iter_mut().find(|s| &s.id == id)
                    && !server.advanced.proxy.enabled()
                {
                    server.advanced.jump_id = Some(jump);
                }
            }
            Ok(report)
        })
        .await
    }

    pub async fn touch(&self, id: &str) -> Result<()> {
        self.mutate(|data| {
            if let Some(server) = data.servers.iter_mut().find(|s| s.id == id) {
                server.last_connected_at = Some(now_secs());
            }
            Ok(())
        })
        .await
    }

    pub async fn resolve(&self, id: &str) -> Result<Resolved> {
        let (server, vault) = {
            let data = self.data.lock().await;
            let server = data
                .servers
                .iter()
                .find(|s| s.id == id)
                .cloned()
                .ok_or_else(|| Error::NotFound("server".into()))?;
            (server, self.vault(&data))
        };
        let secret = server.auth.secret.as_ref().map(|s| s.open(&vault)).transpose()?;
        let proxy_secret = server.proxy_secret.as_ref().map(|s| s.open(&vault)).transpose()?;
        Ok(Resolved {
            view: server.view(),
            secret,
            proxy_secret,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input(name: &str, secret: SecretUpdate) -> ServerInput {
        ServerInput {
            id: None,
            name: name.into(),
            group_id: None,
            host: " 10.0.0.1 ".into(),
            port: 22,
            note: String::new(),
            auth: AuthInput {
                method: AuthMethod::Password,
                user: "root".into(),
                key_path: String::new(),
                secret,
            },
            advanced: Advanced::default(),
            proxy_secret: SecretUpdate::Keep,
        }
    }

    fn set(value: &str) -> SecretUpdate {
        SecretUpdate::Set {
            value: Zeroizing::new(value.into()),
        }
    }

    async fn store() -> (tempfile::TempDir, ProfileStore) {
        let dir = tempfile::tempdir().unwrap();
        let store = ProfileStore::open(dir.path().join("connections.json")).await.unwrap();
        (dir, store)
    }

    #[tokio::test]
    async fn telnet_and_serial_servers_need_no_user_and_serial_no_host() {
        let (_dir, store) = store().await;
        let mut telnet = input("switch", SecretUpdate::Keep);
        telnet.auth.user.clear();
        telnet.port = 23;
        telnet.advanced.protocol = Protocol::Telnet;
        assert_eq!(store.save_server(telnet).await.unwrap().advanced.protocol, Protocol::Telnet);

        let mut serial = input("console", SecretUpdate::Keep);
        serial.auth.user.clear();
        serial.host.clear();
        serial.port = 0;
        serial.advanced.protocol = Protocol::Serial;
        assert!(store.save_server(serial).await.is_err(), "a serial server needs a port name");
        let mut serial = input("console", SecretUpdate::Keep);
        serial.host.clear();
        serial.port = 0;
        serial.advanced.protocol = Protocol::Serial;
        serial.advanced.serial.port = "COM3".into();
        let saved = store.save_server(serial).await.unwrap();
        assert_eq!(saved.advanced.serial.baud, 115_200);

        let mut ssh = input("plain", SecretUpdate::Keep);
        ssh.auth.user.clear();
        assert!(store.save_server(ssh).await.is_err(), "SSH still needs a user");
        let old: Advanced = serde_json::from_str(r#"{"term":"vt100"}"#).unwrap();
        assert_eq!(old.protocol, Protocol::Ssh, "servers saved before protocols existed are SSH");
    }

    #[tokio::test]
    async fn import_creates_groups_wires_jumps_and_reports_failures() {
        let (_dir, store) = store().await;
        let existing = store.save_group(None, "生产").await.unwrap();
        let saved = store.save_server(input("old", SecretUpdate::Keep)).await.unwrap();
        let entry = |name: &str, group: Option<&str>, jump: Option<JumpRef>| ImportEntry {
            input: input(name, SecretUpdate::Keep),
            group: group.map(str::to_owned),
            jump,
        };
        let mut bad = entry("bad", None, None);
        bad.input.auth.user.clear();
        let mut proxied = entry("proxied", None, Some(JumpRef::Batch(0)));
        proxied.input.advanced.proxy = ProxySettings {
            kind: ProxyKind::Socks5,
            host: "p".into(),
            port: 1080,
            user: String::new(),
        };
        let report = store
            .import(vec![
                entry("bastion", Some(" 生产 "), None),
                entry("a", Some("新组"), Some(JumpRef::Batch(0))),
                entry("b", Some("新组"), Some(JumpRef::Saved(saved.id.clone()))),
                bad,
                entry("c", None, Some(JumpRef::Batch(3))),
                proxied,
            ])
            .await
            .unwrap();
        assert_eq!(report.added, 5);
        assert_eq!(report.failed.len(), 1);
        assert_eq!(report.failed[0].name, "bad");
        let listed = store.list().await;
        assert_eq!(listed.groups.len(), 2);
        let fresh = listed.groups.iter().find(|g| g.name == "新组").unwrap();
        let by_name = |name: &str| listed.servers.iter().find(|s| s.name == name).unwrap();
        let bastion = by_name("bastion");
        assert_eq!(bastion.group_id.as_ref(), Some(&existing.id));
        assert_eq!(by_name("a").group_id.as_ref(), Some(&fresh.id));
        assert_eq!(by_name("b").group_id.as_ref(), Some(&fresh.id));
        assert_eq!(by_name("a").advanced.jump_id.as_ref(), Some(&bastion.id));
        assert_eq!(by_name("b").advanced.jump_id.as_ref(), Some(&saved.id));
        assert_eq!(by_name("c").advanced.jump_id, None);
        assert_eq!(by_name("proxied").advanced.jump_id, None);
        assert!(listed.servers.iter().all(|s| !s.auth.has_secret));
    }

    #[tokio::test]
    async fn import_seals_passwords_and_refuses_while_locked() {
        let (_dir, store) = store().await;
        let store = reopen(&store).await;
        store.set_master(None, pw("correct horse")).await.unwrap();
        let entry = |name: &str, secret| ImportEntry {
            input: input(name, secret),
            group: None,
            jump: None,
        };
        let mut agent = entry("agent", set("never-stored"));
        agent.input.auth.method = AuthMethod::Agent;
        let report = store
            .import(vec![entry("with", set("imp0rted-Secret")), entry("without", SecretUpdate::Keep), agent])
            .await
            .unwrap();
        assert_eq!((report.added, report.secrets), (3, 1));
        let raw = std::fs::read_to_string(store.path()).unwrap();
        assert!(!raw.contains("imp0rted-Secret") && !raw.contains("never-stored"));
        let listed = store.list().await;
        let with = listed.servers.iter().find(|s| s.name == "with").unwrap();
        assert_eq!(store.resolve(&with.id).await.unwrap().secret.unwrap().as_str(), "imp0rted-Secret");
        assert!(listed.servers.iter().filter(|s| s.name != "with").all(|s| !s.auth.has_secret));

        store.lock();
        assert!(matches!(store.import(vec![entry("late", set("x"))]).await, Err(Error::Locked)));
        assert_eq!(store.list().await.servers.len(), 3, "nothing written while locked");
        assert_eq!(store.import(vec![entry("plain", SecretUpdate::Keep)]).await.unwrap().added, 1);
    }

    #[tokio::test]
    async fn saved_server_survives_reopen() {
        let (_dir, store) = store().await;
        let group = store.save_group(None, " 生产 ").await.unwrap();
        assert_eq!(group.name, "生产");
        let mut new = input("router", SecretUpdate::Clear);
        new.group_id = Some(group.id.clone());
        new.advanced.startup_command = "uptime".into();
        let view = store.save_server(new).await.unwrap();
        assert_eq!(view.host, "10.0.0.1");
        assert!(!view.auth.has_secret);

        let reopened = ProfileStore::open(store.path()).await.unwrap();
        let listed = reopened.list().await;
        assert_eq!(listed.groups, vec![group.clone()]);
        assert_eq!(listed.servers, vec![view]);
        assert_eq!(listed.servers[0].group_id.as_deref(), Some(group.id.as_str()));
        assert_eq!(listed.servers[0].advanced.startup_command, "uptime");
    }

    #[tokio::test]
    async fn empty_name_defaults_to_host() {
        let (_dir, store) = store().await;
        assert_eq!(
            store.save_server(input("  ", SecretUpdate::Keep)).await.unwrap().name,
            "10.0.0.1"
        );
    }

    fn pw(value: &str) -> Option<Zeroizing<String>> {
        Some(Zeroizing::new(value.into()))
    }

    async fn reopen(store: &ProfileStore) -> ProfileStore {
        let mut store = ProfileStore::open(store.path()).await.unwrap();
        store.cost = crate::passphrase::TEST_COST;
        store
    }

    #[tokio::test]
    async fn master_password_locks_saved_secrets() {
        let (_dir, store) = store().await;
        let store = reopen(&store).await;
        assert!(store.set_master(None, None).await.is_err());
        assert!(store.set_master(None, pw("short")).await.is_err());
        store.set_master(None, pw("correct horse")).await.unwrap();
        let status = store.master_status().await;
        assert!(status.enabled && status.unlocked);

        let view = store.save_server(input("r", set("pa55-word-XYZ"))).await.unwrap();
        let raw = std::fs::read_to_string(store.path()).unwrap();
        assert!(raw.contains("\"m1:") && !raw.contains("pa55-word-XYZ"));
        assert_eq!(
            store.resolve(&view.id).await.unwrap().secret.unwrap().as_str(),
            "pa55-word-XYZ"
        );

        store.lock();
        assert!(!store.master_status().await.unlocked);
        assert!(matches!(store.resolve(&view.id).await, Err(Error::Locked)));
        assert!(matches!(store.export(true).await, Err(Error::Locked)));
        assert!(store.export(false).await.is_ok());
        let plain = store.save_server(input("no secret", SecretUpdate::Keep)).await.unwrap();
        assert!(store.resolve(&plain.id).await.is_ok(), "nothing to unlock");
        let mut rename = input("renamed", SecretUpdate::Keep);
        rename.id = Some(view.id.clone());
        assert!(store.save_server(rename).await.unwrap().auth.has_secret);
        assert!(matches!(
            store.save_server(input("new", set("x"))).await,
            Err(Error::Locked)
        ));
        let wrong = store.unlock(Zeroizing::new("wrong horse".into())).await.unwrap_err();
        assert_eq!((wrong.kind(), wrong.field()), ("invalid", Some("master")));

        let store = reopen(&store).await;
        assert!(store.master_status().await.enabled);
        assert!(matches!(store.resolve(&view.id).await, Err(Error::Locked)));
        store.unlock(Zeroizing::new("correct horse".into())).await.unwrap();
        assert_eq!(
            store.resolve(&view.id).await.unwrap().secret.unwrap().as_str(),
            "pa55-word-XYZ"
        );

        assert!(
            store.set_master(None, pw("battery staple")).await.is_err(),
            "needs the current one"
        );
        assert!(store.set_master(pw("wrong horse"), pw("battery staple")).await.is_err());
        store
            .set_master(pw("correct horse"), pw("battery staple"))
            .await
            .unwrap();
        assert!(store.master_status().await.unlocked);
        let store = reopen(&store).await;
        assert!(store.unlock(Zeroizing::new("correct horse".into())).await.is_err());
        store.unlock(Zeroizing::new("battery staple".into())).await.unwrap();
        assert_eq!(
            store.resolve(&view.id).await.unwrap().secret.unwrap().as_str(),
            "pa55-word-XYZ"
        );
    }

    #[cfg(windows)]
    #[tokio::test]
    async fn turning_master_on_and_off_reseals_existing_secrets() {
        let (_dir, store) = store().await;
        let store = reopen(&store).await;
        let view = store.save_server(input("r", set("dpapi-first"))).await.unwrap();
        assert!(!std::fs::read_to_string(store.path()).unwrap().contains("m1:"));
        store.set_master(None, pw("correct horse")).await.unwrap();
        assert!(std::fs::read_to_string(store.path()).unwrap().contains("m1:"));
        let store = reopen(&store).await;
        assert!(matches!(store.resolve(&view.id).await, Err(Error::Locked)));
        store.set_master(pw("correct horse"), None).await.unwrap();
        let raw = std::fs::read_to_string(store.path()).unwrap();
        assert!(!raw.contains("m1:") && !raw.contains("\"master\""));
        let store = reopen(&store).await;
        let status = store.master_status().await;
        assert!(!status.enabled && !status.unlocked);
        assert_eq!(
            store.resolve(&view.id).await.unwrap().secret.unwrap().as_str(),
            "dpapi-first"
        );
    }

    #[cfg(windows)]
    #[tokio::test]
    async fn password_is_sealed_on_disk_and_resolvable() {
        let (_dir, store) = store().await;
        let view = store.save_server(input("r", set("pa55-word-XYZ"))).await.unwrap();
        assert!(view.auth.has_secret);
        let raw = std::fs::read_to_string(store.path()).unwrap();
        assert!(!raw.contains("pa55-word-XYZ"));
        let listed = serde_json::to_string(&store.list().await).unwrap();
        assert!(!listed.contains("pa55") && !listed.contains("secret\""));
        assert_eq!(
            store.resolve(&view.id).await.unwrap().secret.unwrap().as_str(),
            "pa55-word-XYZ"
        );
    }

    #[cfg(windows)]
    #[tokio::test]
    async fn secret_keep_clear_and_method_change() {
        let (_dir, store) = store().await;
        let view = store.save_server(input("r", set("one"))).await.unwrap();

        let mut edit = input("renamed", SecretUpdate::Keep);
        edit.id = Some(view.id.clone());
        let kept = store.save_server(edit).await.unwrap();
        assert_eq!(kept.name, "renamed");
        assert!(kept.auth.has_secret);
        assert_eq!(store.resolve(&view.id).await.unwrap().secret.unwrap().as_str(), "one");

        let mut to_key = input("renamed", SecretUpdate::Keep);
        to_key.id = Some(view.id.clone());
        to_key.auth.method = AuthMethod::KeyFile;
        to_key.auth.key_path = r"C:\keys\id_ed25519".into();
        assert!(!store.save_server(to_key).await.unwrap().auth.has_secret);

        let mut clear = input("renamed", set("two"));
        clear.id = Some(view.id.clone());
        assert!(store.save_server(clear).await.unwrap().auth.has_secret);
        let mut clear = input("renamed", SecretUpdate::Clear);
        clear.id = Some(view.id.clone());
        assert!(!store.save_server(clear).await.unwrap().auth.has_secret);
        assert!(store.resolve(&view.id).await.unwrap().secret.is_none());
    }

    #[tokio::test]
    async fn deleting_group_ungroups_its_servers() {
        let (_dir, store) = store().await;
        let group = store.save_group(None, "g").await.unwrap();
        let mut a = input("a", SecretUpdate::Keep);
        a.group_id = Some(group.id.clone());
        let a = store.save_server(a).await.unwrap();
        store.delete_group(&group.id).await.unwrap();
        let listed = store.list().await;
        assert!(listed.groups.is_empty());
        assert_eq!(listed.servers[0].id, a.id);
        assert_eq!(listed.servers[0].group_id, None);
    }

    #[tokio::test]
    async fn move_duplicate_delete_and_touch() {
        let (_dir, store) = store().await;
        let g = store.save_group(None, "g").await.unwrap();
        let a = store.save_server(input("a", SecretUpdate::Keep)).await.unwrap();
        let copy = store.duplicate_server(&a.id).await.unwrap();
        assert_ne!(copy.id, a.id);
        assert_eq!(copy.name, "a (copy)");
        store
            .move_servers(&[a.id.clone(), copy.id.clone()], Some(g.id.clone()))
            .await
            .unwrap();
        assert!(
            store
                .list()
                .await
                .servers
                .iter()
                .all(|s| s.group_id.as_deref() == Some(g.id.as_str()))
        );
        assert!(
            store
                .move_servers(std::slice::from_ref(&a.id), Some("nope".into()))
                .await
                .is_err()
        );
        store.touch(&a.id).await.unwrap();
        assert!(store.resolve(&a.id).await.unwrap().view.last_connected_at.is_some());
        store.delete_server(&copy.id).await.unwrap();
        assert!(matches!(store.delete_server(&copy.id).await, Err(Error::NotFound(_))));
        assert_eq!(store.list().await.servers.len(), 1);
    }

    #[tokio::test]
    async fn invalid_input_is_rejected_without_writing() {
        let (_dir, store) = store().await;
        let mut bad = input("x", SecretUpdate::Keep);
        bad.host = "has space".into();
        assert!(matches!(store.save_server(bad).await, Err(Error::Invalid(_))));
        let mut bad = input("x", SecretUpdate::Keep);
        bad.port = 0;
        assert!(store.save_server(bad).await.is_err());
        let mut bad = input("x", SecretUpdate::Keep);
        bad.auth.method = AuthMethod::KeyFile;
        assert!(store.save_server(bad).await.is_err());
        let mut bad = input("x", SecretUpdate::Keep);
        bad.advanced.term = "xterm; rm -rf /".into();
        assert!(store.save_server(bad).await.is_err());
        let mut bad = input("x", SecretUpdate::Keep);
        bad.group_id = Some("missing".into());
        assert!(store.save_server(bad).await.is_err());
        assert!(store.save_group(None, "   ").await.is_err());
        assert!(!store.path().exists());
    }

    #[tokio::test]
    async fn corrupt_file_is_an_error() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("connections.json");
        std::fs::write(&path, b"{ nope").unwrap();
        assert!(matches!(ProfileStore::open(&path).await, Err(Error::Profile(_))));
    }

    #[tokio::test]
    async fn older_files_missing_optional_fields_load_with_defaults() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("connections.json");
        let body = serde_json::json!({
            "version": 1,
            "groups": [],
            "servers": [{ "id": "s1", "name": "n", "groupId": null, "host": "h", "port": 22,
                          "auth": { "method": "password", "user": "u" } }]
        });
        std::fs::write(&path, serde_json::to_vec(&body).unwrap()).unwrap();
        let store = ProfileStore::open(&path).await.unwrap();
        let server = &store.list().await.servers[0];
        assert_eq!(server.advanced, Advanced::default());
        assert!(!server.auth.has_secret);
        assert!(!server.has_proxy_secret);
    }

    #[test]
    fn partial_advanced_keeps_other_defaults() {
        let parsed: Advanced = serde_json::from_value(serde_json::json!({
            "monitor": false,
            "proxy": { "kind": "socks5", "host": "p", "port": 1080 },
            "forwards": [{ "kind": "dynamic", "bindPort": 1081 }]
        }))
        .unwrap();
        assert!(!parsed.monitor);
        assert_eq!(parsed.term, "xterm-256color");
        assert_eq!(parsed.proxy.kind, ProxyKind::Socks5);
        assert_eq!(parsed.proxy.user, "");
        assert_eq!(parsed.forwards[0].bind_host, "127.0.0.1");
        assert!(parsed.validate().is_ok());
    }

    #[tokio::test]
    async fn agent_auth_needs_no_key_and_keeps_no_secret() {
        let (_dir, store) = store().await;
        let mut agent = input("a", set("ignored"));
        agent.auth.method = AuthMethod::Agent;
        let view = store.save_server(agent).await.unwrap();
        assert_eq!(view.auth.method, AuthMethod::Agent);
        assert!(!view.auth.has_secret);
    }

    #[tokio::test]
    async fn proxy_and_forward_settings_are_validated() {
        let (_dir, store) = store().await;
        let mut bad = input("x", SecretUpdate::Keep);
        bad.advanced.proxy = ProxySettings {
            kind: ProxyKind::Http,
            host: String::new(),
            port: 8080,
            user: String::new(),
        };
        assert!(store.save_server(bad).await.is_err());
        let mut bad = input("x", SecretUpdate::Keep);
        bad.advanced.proxy.kind = ProxyKind::Socks5;
        bad.advanced.proxy.host = "p".into();
        assert!(store.save_server(bad).await.is_err(), "port 0");
        let mut bad = input("x", SecretUpdate::Keep);
        bad.advanced.forwards = vec![
            ForwardSpec {
                kind: crate::forward::ForwardKind::Local,
                bind_host: "127.0.0.1".into(),
                bind_port: 8080,
                dest_host: String::new(),
                dest_port: 80,
                label: String::new(),
            };
            1
        ];
        assert!(
            store.save_server(bad).await.is_err(),
            "local forward without destination"
        );
        // An unused proxy may hold leftovers from the form.
        let mut off = input("x", SecretUpdate::Keep);
        off.advanced.proxy.host = "has space".into();
        assert!(store.save_server(off).await.is_ok());
    }

    #[tokio::test]
    async fn jump_host_must_exist_and_not_be_itself() {
        let (_dir, store) = store().await;
        let jump = store.save_server(input("jump", SecretUpdate::Keep)).await.unwrap();
        let mut missing = input("t", SecretUpdate::Keep);
        missing.advanced.jump_id = Some("nope".into());
        assert!(matches!(store.save_server(missing).await, Err(Error::NotFound(_))));

        let mut target = input("t", SecretUpdate::Keep);
        target.advanced.jump_id = Some(jump.id.clone());
        let target = store.save_server(target).await.unwrap();
        assert_eq!(target.advanced.jump_id.as_deref(), Some(jump.id.as_str()));

        let mut both = input("t", SecretUpdate::Keep);
        both.id = Some(target.id.clone());
        both.advanced.jump_id = Some(jump.id.clone());
        both.advanced.proxy = ProxySettings {
            kind: ProxyKind::Socks5,
            host: "p".into(),
            port: 1080,
            user: String::new(),
        };
        assert!(store.save_server(both).await.is_err());

        let mut own = input("j", SecretUpdate::Keep);
        own.id = Some(jump.id.clone());
        own.advanced.jump_id = Some(jump.id.clone());
        assert!(store.save_server(own).await.is_err());

        let err = store.delete_server(&jump.id).await.unwrap_err();
        assert!(err.to_string().contains("跳板机"), "{err}");
        store.delete_server(&target.id).await.unwrap();
        store.delete_server(&jump.id).await.unwrap();
    }

    #[cfg(windows)]
    #[tokio::test]
    async fn proxy_password_is_sealed_and_dropped_without_proxy_user() {
        let (_dir, store) = store().await;
        let mut with_proxy = input("p", SecretUpdate::Keep);
        with_proxy.advanced.proxy = ProxySettings {
            kind: ProxyKind::Socks5,
            host: "proxy".into(),
            port: 1080,
            user: "pu".into(),
        };
        with_proxy.proxy_secret = set("proxy-pa55");
        let view = store.save_server(with_proxy).await.unwrap();
        assert!(view.has_proxy_secret);
        assert!(!std::fs::read_to_string(store.path()).unwrap().contains("proxy-pa55"));
        let resolved = store.resolve(&view.id).await.unwrap();
        assert_eq!(resolved.proxy_secret.unwrap().as_str(), "proxy-pa55");
        assert!(resolved.secret.is_none());

        let mut no_user = input("p", SecretUpdate::Keep);
        no_user.id = Some(view.id.clone());
        no_user.advanced.proxy.kind = ProxyKind::Socks5;
        no_user.advanced.proxy.host = "proxy".into();
        no_user.advanced.proxy.port = 1080;
        assert!(!store.save_server(no_user).await.unwrap().has_proxy_secret);
    }
}
