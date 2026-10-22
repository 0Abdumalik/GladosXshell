//! Reads connections saved by other SSH clients (OpenSSH config, Xshell, PuTTY, FinalShell) so
//! they can be reviewed and imported. Settings come across; stored passwords stay behind and are
//! asked for on the first connect, except FinalShell's, which can be carried over when the user
//! opts in. Those stay encrypted in the backend until the moment they are sealed again.

use std::collections::{HashMap, HashSet};
use std::io;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use zeroize::Zeroizing;

use crate::forward::{ForwardKind, ForwardSpec, MAX_SAVED_FORWARDS};
use crate::i18n::ltr;
use crate::known_hosts::HostKeyPolicy;
#[cfg(windows)]
use crate::registry;
use crate::profiles::{
    Advanced, AuthInput, AuthMethod, ImportEntry, JumpRef, Profiles, ProxySettings, SecretUpdate, ServerInput,
};
use crate::transport::ProxyKind;

const MAX_FILE: u64 = 1024 * 1024;
const MAX_DEPTH: usize = 8;
pub const MAX_CANDIDATES: usize = 5000;
const NAME_CHARS: usize = 128;
const GROUP_CHARS: usize = 64;
const NOTE_CHARS: usize = 2000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Source {
    SshConfig,
    Xshell,
    Putty,
    FinalShell,
}

pub const SOURCES: [Source; 4] = [Source::SshConfig, Source::Xshell, Source::Putty, Source::FinalShell];

/// One connection found in another client, shown for review before it is saved.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Candidate {
    pub source: Source,
    pub name: String,
    #[serde(default)]
    pub group: Option<String>,
    pub host: String,
    pub port: u16,
    pub user: String,
    pub method: AuthMethod,
    #[serde(default)]
    pub key_path: String,
    /// Name of another connection from the same source to tunnel through.
    #[serde(default)]
    pub jump: Option<String>,
    #[serde(default)]
    pub note: String,
    #[serde(default)]
    pub advanced: Advanced,
    /// Settings that did not come across.
    #[serde(default)]
    pub warnings: Vec<String>,
    /// Probably not an SSH connection; the preview leaves it unchecked.
    #[serde(default)]
    pub doubtful: bool,
    /// A saved server already has this address and user.
    #[serde(default)]
    pub exists: bool,
    /// Stands for the password the other client saved, which stays in the backend; only this
    /// handle goes to the preview and comes back.
    #[serde(default)]
    pub password_ref: Option<String>,
    #[serde(skip)]
    pub saved_password: Option<SavedPassword>,
}

/// A login password as FinalShell saved it, still encrypted. It is never serialized or printed;
/// [`SavedPassword::decrypt`] is the only way to the plain text.
#[derive(Clone, PartialEq, Eq)]
pub struct SavedPassword(Zeroizing<String>);

impl std::fmt::Debug for SavedPassword {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("SavedPassword(..)")
    }
}

impl SavedPassword {
    pub fn decrypt(&self) -> crate::error::Result<Zeroizing<String>> {
        crate::finalshell::decrypt(&self.0)
    }
}

impl Candidate {
    fn new(source: Source, name: &str, host: &str) -> Self {
        Self {
            source,
            name: clip(name.trim(), NAME_CHARS),
            group: None,
            host: host.trim().to_owned(),
            port: 22,
            user: String::new(),
            method: AuthMethod::Password,
            key_path: String::new(),
            jump: None,
            note: String::new(),
            advanced: Advanced::default(),
            warnings: Vec::new(),
            doubtful: false,
            exists: false,
            password_ref: None,
            saved_password: None,
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceScan {
    pub source: Source,
    /// Where connections were read from, or where they were looked for when none turned up.
    pub paths: Vec<String>,
    pub candidates: Vec<Candidate>,
    /// Entries left out: not SSH (Telnet, serial, RDP…) or without an address.
    pub skipped: usize,
    pub error: Option<String>,
}

/// The folders the default locations hang off.
pub struct Locations {
    pub home: PathBuf,
    pub documents: PathBuf,
    pub desktop: PathBuf,
    /// `%LOCALAPPDATA%`
    pub local_data: PathBuf,
    /// `%APPDATA%`
    pub roaming: PathBuf,
    /// OpenSSH's default for `User`.
    pub local_user: String,
}

/// Reads one source from its usual place, or from `path` when the user picked one.
pub fn scan(source: Source, at: &Locations, path: Option<&Path>) -> SourceScan {
    let mut out = SourceScan {
        source,
        paths: Vec::new(),
        candidates: Vec::new(),
        skipped: 0,
        error: None,
    };
    let result = match source {
        Source::SshConfig => scan_ssh_config(at, path, &mut out),
        Source::Xshell => scan_xshell(at, path, &mut out),
        Source::Putty => scan_putty(&mut out),
        Source::FinalShell => scan_finalshell(at, path, &mut out),
    };
    if let Err(error) = result {
        out.error = Some(error.to_string());
    }
    let mut seen = HashSet::new();
    out.candidates.retain(|c| {
        seen.insert((
            c.group.clone(),
            c.name.clone(),
            c.host.to_ascii_lowercase(),
            c.port,
            c.user.clone(),
        ))
    });
    out.candidates.truncate(MAX_CANDIDATES);
    out
}

pub fn mark_existing(candidates: &mut [Candidate], saved: &Profiles) {
    for c in candidates {
        c.exists = saved.servers.iter().any(|s| {
            s.host.eq_ignore_ascii_case(&c.host) && s.port == c.port && (c.user.is_empty() || s.auth.user == c.user)
        });
    }
}

/// Turns reviewed candidates into store entries. A `jump` name resolves to another candidate
/// from the same source in the batch, then to a saved server with that name. `password` is
/// asked only for password logins, so a saved password never becomes a key passphrase.
pub fn entries(
    candidates: Vec<Candidate>,
    saved: &Profiles,
    mut password: impl FnMut(&Candidate) -> SecretUpdate,
) -> Vec<ImportEntry> {
    let keys: Vec<(Source, String)> = candidates.iter().map(|c| (c.source, c.name.clone())).collect();
    candidates
        .into_iter()
        .map(|c| {
            let jump = c.jump.as_ref().and_then(|name| {
                keys.iter()
                    .position(|(source, n)| *source == c.source && n == name)
                    .map(JumpRef::Batch)
                    .or_else(|| saved.servers.iter().find(|s| &s.name == name).map(|s| JumpRef::Saved(s.id.clone())))
            });
            let secret = if c.method == AuthMethod::Password { password(&c) } else { SecretUpdate::Keep };
            ImportEntry {
                input: ServerInput {
                    id: None,
                    name: c.name,
                    group_id: None,
                    host: c.host,
                    port: c.port,
                    note: c.note,
                    auth: AuthInput {
                        method: c.method,
                        user: c.user,
                        key_path: c.key_path,
                        secret,
                    },
                    advanced: c.advanced,
                    proxy_secret: SecretUpdate::Keep,
                },
                group: c.group.map(|g| clip(g.trim(), GROUP_CHARS)).filter(|g| !g.is_empty()),
                jump,
            }
        })
        .collect()
}

fn clip(text: &str, chars: usize) -> String {
    text.chars().take(chars).collect()
}

fn valid_term(term: &str) -> bool {
    !term.is_empty() && term.len() <= 64 && term.bytes().all(|b| b.is_ascii_alphanumeric() || b"-_.+".contains(&b))
}

fn has_ext(path: &Path, ext: &str) -> bool {
    path.extension().is_some_and(|e| e.eq_ignore_ascii_case(ext))
}

fn read_small(path: &Path) -> io::Result<Vec<u8>> {
    if std::fs::metadata(path)?.len() > MAX_FILE {
        let path = ltr(&path.display().to_string());
        return Err(io::Error::other(crate::tr!("{path} 太大", "{path} is too large", "{path} بەك چوڭ")));
    }
    std::fs::read(path)
}

/// Session files come as UTF-16 (Xshell 6+), UTF-8, or the ANSI code page (GBK on Chinese Windows).
pub fn decode_text(bytes: &[u8]) -> String {
    if let Some(rest) = bytes.strip_prefix(&[0xff, 0xfe]) {
        return utf16(rest, u16::from_le_bytes);
    }
    if let Some(rest) = bytes.strip_prefix(&[0xfe, 0xff]) {
        return utf16(rest, u16::from_be_bytes);
    }
    let bytes = bytes.strip_prefix(&[0xef, 0xbb, 0xbf]).unwrap_or(bytes);
    if bytes.len() >= 4 && bytes.len().is_multiple_of(2) && bytes.iter().skip(1).step_by(2).take(64).all(|&b| b == 0) {
        return utf16(bytes, u16::from_le_bytes);
    }
    match std::str::from_utf8(bytes) {
        Ok(text) => text.to_owned(),
        Err(_) => encoding_rs::GBK.decode(bytes).0.into_owned(),
    }
}

fn utf16(bytes: &[u8], read: fn([u8; 2]) -> u16) -> String {
    let units: Vec<u16> = bytes.chunks_exact(2).map(|p| read([p[0], p[1]])).collect();
    String::from_utf16_lossy(&units)
}

/// Files under `root` that pass `keep`, with their folder names relative to it, in name order.
/// Symlinked folders are not followed.
fn walk(root: &Path, keep: fn(&Path) -> bool) -> io::Result<Vec<(Vec<String>, PathBuf)>> {
    let mut out = Vec::new();
    let mut stack = vec![(Vec::new(), root.to_path_buf())];
    while let Some((folders, dir)) = stack.pop() {
        let read = match std::fs::read_dir(&dir) {
            Ok(read) => read,
            Err(error) if folders.is_empty() => return Err(error),
            Err(_) => continue,
        };
        for entry in read.filter_map(Result::ok) {
            let Ok(kind) = entry.file_type() else { continue };
            let path = entry.path();
            if kind.is_dir() && folders.len() < MAX_DEPTH {
                let mut next = folders.clone();
                next.push(entry.file_name().to_string_lossy().into_owned());
                stack.push((next, path));
            } else if kind.is_file() && keep(&path) && out.len() < MAX_CANDIDATES {
                out.push((folders.clone(), path));
            }
        }
    }
    out.sort();
    Ok(out)
}

/// `*` and `?` wildcards, case-insensitive, as OpenSSH matches host patterns.
fn glob(pattern: &str, text: &str) -> bool {
    let p: Vec<char> = pattern.to_lowercase().chars().collect();
    let t: Vec<char> = text.to_lowercase().chars().collect();
    let (mut pi, mut ti) = (0, 0);
    let mut star: Option<(usize, usize)> = None;
    while ti < t.len() {
        if pi < p.len() && (p[pi] == '?' || p[pi] == t[ti]) {
            pi += 1;
            ti += 1;
        } else if pi < p.len() && p[pi] == '*' {
            star = Some((pi, ti));
            pi += 1;
        } else if let Some((sp, st)) = star {
            pi = sp + 1;
            ti = st + 1;
            star = Some((sp, st + 1));
        } else {
            return false;
        }
    }
    p[pi..].iter().all(|&c| c == '*')
}

/// `port`, `host:port`, `[v6]:port` or `host/port`.
fn host_port(text: &str) -> Option<(Option<String>, u16)> {
    let text = text.trim();
    if let Ok(port) = text.parse::<u16>() {
        return Some((None, port));
    }
    let (host, port) = match text.strip_prefix('[') {
        Some(rest) => {
            let (host, port) = rest.split_once(']')?;
            (host, port.strip_prefix([':', '/'])?)
        }
        None => text.rsplit_once([':', '/'])?,
    };
    Some((Some(host.to_owned()), port.parse().ok()?))
}

fn forward_spec(kind: ForwardKind, bind: &str, dest: Option<&str>) -> Option<ForwardSpec> {
    let (bind_host, bind_port) = host_port(bind)?;
    let (dest_host, dest_port) = match kind {
        ForwardKind::Dynamic => (String::new(), 0),
        _ => {
            let (host, port) = host_port(dest?)?;
            (host?, port)
        }
    };
    let bind_host = match bind_host.as_deref().map(str::trim) {
        None | Some("") => "127.0.0.1".to_owned(),
        Some("*") => "0.0.0.0".to_owned(),
        Some(host) => host.to_owned(),
    };
    let spec = ForwardSpec {
        kind,
        bind_host,
        bind_port,
        dest_host,
        dest_port,
        label: String::new(),
    };
    spec.validate().is_ok().then_some(spec)
}

fn push_forward(c: &mut Candidate, spec: Option<ForwardSpec>, raw: &str) {
    match spec {
        Some(spec) if c.advanced.forwards.len() < MAX_SAVED_FORWARDS => c.advanced.forwards.push(spec),
        Some(_) => {}
        None => {
            let raw = ltr(raw);
            c.warnings.push(crate::tr!(
                "端口转发 {raw} 无法识别，没有导入",
                "Port forward {raw} was not recognized and was not imported",
                "{raw} ئېغىز يوللاش تونۇلمىدى، ئەكىرىلمىدى"
            ));
        }
    }
}

// ---- OpenSSH config ----

fn scan_ssh_config(at: &Locations, path: Option<&Path>, out: &mut SourceScan) -> io::Result<()> {
    let file = path.map_or_else(|| at.home.join(".ssh").join("config"), Path::to_path_buf);
    out.paths.push(file.display().to_string());
    if path.is_none() && !file.is_file() {
        return Ok(());
    }
    let mut lines = Vec::new();
    ssh_config_lines(&file, &at.home, 0, &mut lines)?;
    out.candidates = parse_ssh_config(&lines, &at.home, &at.local_user);
    Ok(())
}

/// The file's lines with `Include`d files spliced in where they appear. After an included file
/// that opened its own blocks, the block the `Include` sat in is reopened, as OpenSSH scopes it.
fn ssh_config_lines(file: &Path, home: &Path, depth: usize, out: &mut Vec<String>) -> io::Result<()> {
    let text = decode_text(&read_small(file)?);
    let mut header: Option<String> = None;
    for line in text.lines() {
        let (key, args, _) = split_line(line);
        if key.eq_ignore_ascii_case("host") || key.eq_ignore_ascii_case("match") {
            header = Some(line.to_owned());
        }
        if !key.eq_ignore_ascii_case("include") {
            out.push(line.to_owned());
            continue;
        }
        if depth >= MAX_DEPTH {
            continue;
        }
        let before = out.len();
        for pattern in &args {
            for path in include_paths(pattern, home) {
                // A missing or unreadable include is skipped, as OpenSSH does.
                let _ = ssh_config_lines(&path, home, depth + 1, out);
            }
        }
        let opened = out[before..].iter().any(|l| {
            let key = split_line(l).0;
            key.eq_ignore_ascii_case("host") || key.eq_ignore_ascii_case("match")
        });
        if opened {
            out.push(header.clone().unwrap_or_else(|| "Match all".into()));
        }
    }
    Ok(())
}

/// Relative includes are under `~/.ssh`; `*` and `?` may appear in the file name.
fn include_paths(pattern: &str, home: &Path) -> Vec<PathBuf> {
    let expanded = expand_home(pattern, home);
    let full = if Path::new(&expanded).is_absolute() {
        PathBuf::from(expanded)
    } else {
        home.join(".ssh").join(expanded)
    };
    let Some(name) = full.file_name().map(|n| n.to_string_lossy().into_owned()) else {
        return Vec::new();
    };
    if !name.contains(['*', '?']) {
        return vec![full];
    }
    let Some(dir) = full.parent() else { return Vec::new() };
    let mut found: Vec<PathBuf> = std::fs::read_dir(dir)
        .into_iter()
        .flatten()
        .filter_map(Result::ok)
        .filter(|e| e.file_type().is_ok_and(|t| t.is_file()) && glob(&name, &e.file_name().to_string_lossy()))
        .map(|e| e.path())
        .collect();
    found.sort();
    found
}

/// `Key value…` or `Key=value…` with double-quoted arguments. Also returns the raw value text,
/// which `RemoteCommand` needs unsplit. Blank and comment lines give an empty key.
fn split_line(line: &str) -> (String, Vec<String>, String) {
    let line = line.trim();
    if line.is_empty() || line.starts_with('#') {
        return (String::new(), Vec::new(), String::new());
    }
    let end = line.find(|c: char| c.is_whitespace() || c == '=').unwrap_or(line.len());
    let rest = line[end..].trim_start();
    let rest = rest.strip_prefix('=').unwrap_or(rest).trim();
    (line[..end].to_owned(), words(rest), rest.to_owned())
}

fn words(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut word = String::new();
    let (mut quoted, mut started) = (false, false);
    for c in text.chars() {
        match c {
            '"' => {
                quoted = !quoted;
                started = true;
            }
            c if c.is_whitespace() && !quoted => {
                if started {
                    out.push(std::mem::take(&mut word));
                    started = false;
                }
            }
            '#' if !quoted && !started => break,
            c => {
                word.push(c);
                started = true;
            }
        }
    }
    if started {
        out.push(word);
    }
    out
}

struct Opt {
    key: String,
    args: Vec<String>,
    raw: String,
}

struct Block {
    /// `None`: every host (top of file, `Match all`). Empty: no host (other `Match` criteria).
    patterns: Option<Vec<String>>,
    options: Vec<Opt>,
}

impl Block {
    fn applies(&self, alias: &str) -> bool {
        let Some(patterns) = &self.patterns else { return true };
        let mut hit = false;
        for pattern in patterns {
            match pattern.strip_prefix('!') {
                Some(negated) if glob(negated, alias) => return false,
                Some(_) => {}
                None => hit |= glob(pattern, alias),
            }
        }
        hit
    }
}

/// One candidate per concrete `Host` alias, with settings taken as OpenSSH would: the first
/// value seen in a matching block wins, forwards add up.
pub fn parse_ssh_config(lines: &[String], home: &Path, local_user: &str) -> Vec<Candidate> {
    let mut blocks = vec![Block {
        patterns: None,
        options: Vec::new(),
    }];
    let mut aliases: Vec<String> = Vec::new();
    for line in lines {
        let (key, args, raw) = split_line(line);
        let key = key.to_ascii_lowercase();
        match key.as_str() {
            "" => {}
            "host" => {
                for alias in &args {
                    if !alias.contains(['*', '?', '!', '%']) && !aliases.iter().any(|a| a.eq_ignore_ascii_case(alias)) {
                        aliases.push(alias.clone());
                    }
                }
                blocks.push(Block {
                    patterns: Some(args),
                    options: Vec::new(),
                });
            }
            "match" => {
                let all = args.len() == 1 && args[0].eq_ignore_ascii_case("all");
                blocks.push(Block {
                    patterns: (!all).then(Vec::new),
                    options: Vec::new(),
                });
            }
            _ if !args.is_empty() => {
                if let Some(block) = blocks.last_mut() {
                    block.options.push(Opt { key, args, raw });
                }
            }
            _ => {}
        }
    }
    let mut candidates: Vec<Candidate> = aliases.iter().map(|a| ssh_host(a, &blocks, home, local_user)).collect();
    resolve_jumps(&mut candidates);
    candidates
}

/// Turns a raw jump (`[user@]host[:port]`, maybe a comma-separated chain) into the name of
/// another candidate, matched by name and then by address. Unknown jumps are dropped with a warning.
fn resolve_jumps(candidates: &mut [Candidate]) {
    let known: Vec<(String, String)> = candidates.iter().map(|c| (c.name.clone(), c.host.clone())).collect();
    for c in candidates.iter_mut() {
        let Some(chain) = c.jump.take() else { continue };
        let hops: Vec<&str> = chain.split(',').map(str::trim).filter(|h| !h.is_empty()).collect();
        let Some(last) = hops.last().copied() else { continue };
        let target = last.rsplit_once('@').map_or(last, |(_, host)| host);
        let target = host_port(target).and_then(|(host, _)| host).unwrap_or_else(|| target.to_owned());
        let found = known
            .iter()
            .find(|(name, _)| name.eq_ignore_ascii_case(&target))
            .or_else(|| known.iter().find(|(_, host)| host.eq_ignore_ascii_case(&target)))
            .map(|(name, _)| name.clone())
            .filter(|name| *name != c.name);
        match found {
            Some(name) => {
                if hops.len() > 1 {
                    let (chain, name) = (ltr(&chain), ltr(&name));
                    c.warnings.push(crate::tr!(
                        "多级跳板 {chain} 只设置了最后一级 {name}",
                        "Jump chain {chain}: only the last hop, {name}, was set",
                        "كۆپ باسقۇچلۇق ئۆتكۈنچى {chain} دا پەقەت ئاخىرقى باسقۇچ {name} لا تەڭشەلدى"
                    ));
                }
                c.jump = Some(name);
            }
            None => {
                let last = ltr(last);
                c.warnings.push(crate::tr!(
                    "跳板机 {last} 不在导入的连接里，没有导入跳板设置",
                    "Jump host {last} is not among the imported connections, so the jump host setting was not imported",
                    "ئۆتكۈنچى مۇلازىمېتىر {last} ئەكىرىلگەن ئۇلىنىشلار ئىچىدە يوق، ئۆتكۈنچى مۇلازىمېتىر تەڭشىكى ئەكىرىلمىدى"
                ));
            }
        }
    }
}

fn expand_home(text: &str, home: &Path) -> String {
    match text.strip_prefix('~') {
        Some("") => home.display().to_string(),
        Some(rest) if rest.starts_with(['/', '\\']) => rest
            .split(['/', '\\'])
            .filter(|part| !part.is_empty())
            .fold(home.to_path_buf(), |path, part| path.join(part))
            .display()
            .to_string(),
        _ => text.to_owned(),
    }
}

/// `%d %h %r %u %%` as OpenSSH expands them in `IdentityFile`, after `~`.
fn expand_tokens(text: &str, home: &Path, host: &str, user: &str, local_user: &str) -> String {
    let text = expand_home(text, home);
    let mut out = String::new();
    let mut chars = text.chars();
    while let Some(c) = chars.next() {
        if c != '%' {
            out.push(c);
            continue;
        }
        match chars.next() {
            Some('d') => out.push_str(&home.display().to_string()),
            Some('h') => out.push_str(host),
            Some('r') => out.push_str(user),
            Some('u') => out.push_str(local_user),
            Some('%') => out.push('%'),
            Some(other) => {
                out.push('%');
                out.push(other);
            }
            None => out.push('%'),
        }
    }
    out
}

fn yes(value: &str) -> bool {
    value.eq_ignore_ascii_case("yes") || value.eq_ignore_ascii_case("true")
}

fn ssh_host(alias: &str, blocks: &[Block], home: &Path, local_user: &str) -> Candidate {
    let mut first: HashMap<&str, &Opt> = HashMap::new();
    let mut forwards = Vec::new();
    for block in blocks.iter().filter(|b| b.applies(alias)) {
        for opt in &block.options {
            match opt.key.as_str() {
                "localforward" | "remoteforward" | "dynamicforward" => forwards.push(opt),
                key => {
                    first.entry(key).or_insert(opt);
                }
            }
        }
    }
    let get = |key: &str| first.get(key).map(|o| o.args[0].as_str());
    let host = get("hostname").map_or_else(|| alias.to_owned(), |h| h.replace("%h", alias).replace("%%", "%"));
    let mut c = Candidate::new(Source::SshConfig, alias, &host);
    if let Some(port) = get("port") {
        match port.parse::<u16>() {
            Ok(port) if port > 0 => c.port = port,
            _ => {
                let port = ltr(port);
                c.warnings.push(crate::tr!(
                    "端口 {port} 无效，用了 22",
                    "Port {port} is not valid; 22 is used instead",
                    "{port} ئېغىزى ئىناۋەتسىز، 22 ئىشلىتىلدى"
                ));
            }
        }
    }
    c.user = get("user").unwrap_or(local_user).to_owned();

    let identity = get("identityfile").filter(|k| !k.eq_ignore_ascii_case("none"));
    let default_key = || {
        ["id_ed25519", "id_ecdsa", "id_rsa"]
            .iter()
            .map(|name| home.join(".ssh").join(name))
            .find(|p| p.is_file())
            .map(|p| p.display().to_string())
    };
    if let Some(key) = identity.map(|k| expand_tokens(k, home, &c.host, &c.user, local_user)).or_else(default_key) {
        c.method = AuthMethod::KeyFile;
        c.key_path = key;
    } else if get("identityagent").is_some_and(|a| !a.eq_ignore_ascii_case("none")) {
        c.method = AuthMethod::Agent;
    }
    if let Some(prefs) = get("preferredauthentications") {
        match prefs.split(',').next().map(str::trim) {
            Some("password") => c.method = AuthMethod::Password,
            Some("keyboard-interactive") => c.method = AuthMethod::KeyboardInteractive,
            _ => {}
        }
    }

    if let Some(jump) = get("proxyjump").filter(|j| !j.eq_ignore_ascii_case("none")) {
        c.jump = Some(jump.to_owned());
    } else if let Some(command) = first.get("proxycommand").filter(|o| !o.args[0].eq_ignore_ascii_case("none")) {
        let command = ltr(&command.raw);
        c.warnings.push(crate::tr!(
            "ProxyCommand {command} 无法导入",
            "ProxyCommand {command} cannot be imported",
            "ProxyCommand {command} نى ئەكىرگىلى بولمايدۇ"
        ));
    }
    if let Some(secs) = get("serveraliveinterval").and_then(|s| s.parse::<u32>().ok()) {
        c.advanced.keepalive_secs = secs.min(3600);
    }
    if let Some(secs) = get("connecttimeout").and_then(|s| s.parse::<u32>().ok()) {
        c.advanced.connect_timeout_secs = secs.clamp(1, 120);
    }
    c.advanced.agent_forward = get("forwardagent").is_some_and(yes);
    if let Some(command) = first.get("remotecommand").filter(|o| !o.args[0].eq_ignore_ascii_case("none")) {
        if command.raw.len() <= 4096 {
            c.advanced.startup_command = command.raw.clone();
        } else {
            c.warnings.push(crate::tr!(
                "RemoteCommand 太长，没有导入",
                "RemoteCommand is too long and was not imported",
                "RemoteCommand بەك ئۇزۇن، ئەكىرىلمىدى"
            ));
        }
    }
    match get("stricthostkeychecking").map(str::to_ascii_lowercase).as_deref() {
        Some("yes") => c.advanced.policy = HostKeyPolicy::Strict,
        Some("accept-new" | "no" | "off") => c.advanced.policy = HostKeyPolicy::Tofu,
        _ => {}
    }
    if first.contains_key("certificatefile") {
        c.warnings.push(crate::tr!(
            "CertificateFile 证书登录不支持，没有导入",
            "Certificate login (CertificateFile) is not supported and was not imported",
            "CertificateFile گۇۋاھنامە بىلەن كىرىش قوللانمايدۇ، ئەكىرىلمىدى"
        ));
    }
    for opt in forwards {
        let (kind, dest) = match opt.key.as_str() {
            "localforward" => (ForwardKind::Local, opt.args.get(1)),
            "remoteforward" => (ForwardKind::Remote, opt.args.get(1)),
            _ => (ForwardKind::Dynamic, None),
        };
        let spec = forward_spec(kind, &opt.args[0], dest.map(String::as_str));
        push_forward(&mut c, spec, &opt.raw);
    }
    c
}

// ---- Xshell ----

/// Section (upper case) → key (lower case) → value. The first value of a key wins.
type Ini = HashMap<String, HashMap<String, String>>;

fn parse_ini(text: &str) -> Ini {
    let mut out: Ini = HashMap::new();
    let mut section = String::new();
    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with([';', '#']) {
            continue;
        }
        if let Some(name) = line.strip_prefix('[').and_then(|l| l.strip_suffix(']')) {
            section = name.trim().to_ascii_uppercase();
        } else if let Some((key, value)) = line.split_once('=') {
            out.entry(section.clone())
                .or_default()
                .entry(key.trim().to_ascii_lowercase())
                .or_insert_with(|| value.trim().to_owned());
        }
    }
    out
}

fn ini_get<'a>(ini: &'a Ini, section: &str, key: &str) -> Option<&'a str> {
    ini.get(section)?.get(key).map(String::as_str).filter(|v| !v.is_empty())
}

fn scan_xshell(at: &Locations, path: Option<&Path>, out: &mut SourceScan) -> io::Result<()> {
    let root = match path {
        Some(path) => path.to_path_buf(),
        None => {
            let mut dirs: Vec<PathBuf> = ["8", "7", "6", "5"]
                .iter()
                .map(|v| at.documents.join("NetSarang Computer").join(v).join("Xshell").join("Sessions"))
                .collect();
            dirs.push(at.documents.join("NetSarang").join("Xshell").join("Sessions"));
            match dirs.iter().find(|d| d.is_dir()) {
                Some(dir) => dir.clone(),
                None => {
                    out.paths = dirs.iter().map(|d| d.display().to_string()).collect();
                    return Ok(());
                }
            }
        }
    };
    out.paths.push(root.display().to_string());
    let files = if root.is_file() {
        vec![(Vec::new(), root)]
    } else {
        walk(&root, |p| has_ext(p, "xsh"))?
    };
    for (folders, file) in files {
        let Ok(bytes) = read_small(&file) else { continue };
        let name = file.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
        match xshell_session(&name, &decode_text(&bytes)) {
            Some(mut c) => {
                c.group = (!folders.is_empty()).then(|| folders.join("/"));
                out.candidates.push(c);
            }
            None => out.skipped += 1,
        }
    }
    Ok(())
}

/// One `.xsh` file; `None` for Telnet, serial and other non-SSH sessions.
pub fn xshell_session(name: &str, text: &str) -> Option<Candidate> {
    const CONN: &str = "CONNECTION";
    const AUTH: &str = "CONNECTION:AUTHENTICATION";
    let ini = parse_ini(text);
    let protocol = ini_get(&ini, CONN, "protocol").unwrap_or("SSH");
    if !protocol.eq_ignore_ascii_case("ssh") && !protocol.eq_ignore_ascii_case("sftp") {
        return None;
    }
    let mut c = Candidate::new(Source::Xshell, name, ini_get(&ini, CONN, "host")?);
    if let Some(port) = ini_get(&ini, CONN, "port").and_then(|p| p.parse::<u16>().ok()).filter(|p| *p > 0) {
        c.port = port;
    }
    c.user = ini_get(&ini, AUTH, "username").unwrap_or("").to_owned();
    let key = ini_get(&ini, AUTH, "userkey");
    let method = ini_get(&ini, AUTH, "method").unwrap_or("0").to_ascii_lowercase();
    match method.as_str() {
        "0" | "password" => {}
        "1" | "publickey" => match key {
            Some(key) if Path::new(key).is_absolute() => {
                c.method = AuthMethod::KeyFile;
                c.key_path = key.to_owned();
            }
            Some(key) => {
                let key = ltr(key);
                c.warnings.push(crate::tr!(
                    "密钥 {key} 存在 Xshell 的用户密钥库里，请从 Xshell 导出后在连接里重新选择，暂时改成了密码登录",
                    "Key {key} is stored in the Xshell user key store. Export it from Xshell and choose it again in the connection. Password login is used for now",
                    "{key} ئاچقۇچى Xshell نىڭ ئىشلەتكۈچى ئاچقۇچ ئامبىرىدا ساقلانغان، Xshell دىن چىقىرىپ ئۇلىنىشتا قايتا تاللاڭ؛ ھازىرچە ئىم بىلەن كىرىشكە ئۆزگەرتىلدى"
                ));
            }
            None => c.warnings.push(crate::tr!(
                "没有找到登录用的密钥，暂时改成了密码登录",
                "The login key was not found. Password login is used for now",
                "كىرىشكە ئىشلىتىدىغان ئاچقۇچ تېپىلمىدى، ھازىرچە ئىم بىلەن كىرىشكە ئۆزگەرتىلدى"
            )),
        },
        "2" | "keyboardinteractive" => c.method = AuthMethod::KeyboardInteractive,
        _ => c.warnings.push(crate::tr!(
            "这种登录方式不支持，改成了密码登录",
            "This login method is not supported, so password login is used",
            "بۇ خىل كىرىش ئۇسۇلى قوللانمايدۇ، ئىم بىلەن كىرىشكە ئۆزگەرتىلدى"
        )),
    }
    if let Some(proxy) = ini_get(&ini, "CONNECTION:PROXY", "proxy") {
        let proxy = ltr(proxy);
        c.warnings.push(crate::tr!(
            "代理 {proxy} 存在 Xshell 的代理列表里，没有导入",
            "Proxy {proxy} is stored in the Xshell proxy list and was not imported",
            "{proxy} ۋاكالەتچىسى Xshell نىڭ ۋاكالەتچى تىزىملىكىدە ساقلانغان، ئەكىرىلمىدى"
        ));
    }
    if let Some(term) = ini_get(&ini, "TERMINAL", "type").filter(|t| valid_term(t)) {
        c.advanced.term = term.to_owned();
    }
    let note = ini_get(&ini, "SESSIONINFO", "description")
        .or_else(|| ini_get(&ini, CONN, "description"))
        .filter(|d| !d.eq_ignore_ascii_case("Xshell session file"));
    if let Some(note) = note {
        c.note = clip(&note.replace("\\n", "\n"), NOTE_CHARS);
    }
    Some(c)
}

// ---- PuTTY ----

pub use crate::registry::RegValue;

fn ansi(bytes: &[u8]) -> String {
    match std::str::from_utf8(bytes) {
        Ok(text) => text.to_owned(),
        Err(_) => encoding_rs::GBK.decode(bytes).0.into_owned(),
    }
}

/// PuTTY saves session names with `%XX` escapes over the ANSI bytes.
pub fn putty_unescape(name: &str) -> String {
    let bytes = name.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        let hex = (bytes[i] == b'%')
            .then(|| bytes.get(i + 1..i + 3))
            .flatten()
            .and_then(|h| u8::from_str_radix(std::str::from_utf8(h).ok()?, 16).ok());
        match hex {
            Some(b) => {
                out.push(b);
                i += 3;
            }
            None => {
                out.push(bytes[i]);
                i += 1;
            }
        }
    }
    ansi(&out)
}

/// One saved session; `values` has lower-case names. `None` for non-SSH sessions.
pub fn putty_session(name: &str, values: &HashMap<String, RegValue>) -> Option<Candidate> {
    let text = |key: &str| match values.get(key) {
        Some(RegValue::Text(t)) if !t.trim().is_empty() => Some(t.trim()),
        _ => None,
    };
    let number = |key: &str| match values.get(key) {
        Some(RegValue::Number(n)) => Some(*n),
        _ => None,
    };
    if !text("protocol").unwrap_or("ssh").eq_ignore_ascii_case("ssh") {
        return None;
    }
    let address = text("hostname")?;
    let (user, host) = address.rsplit_once('@').unwrap_or(("", address));
    let mut c = Candidate::new(Source::Putty, name, host);
    if let Some(port) = number("portnumber").and_then(|p| u16::try_from(p).ok()).filter(|p| *p > 0) {
        c.port = port;
    }
    c.user = text("username").unwrap_or(user).to_owned();
    if let Some(key) = text("publickeyfile") {
        c.method = AuthMethod::KeyFile;
        c.key_path = key.to_owned();
    }
    let proxy_port = |fallback: u16| {
        number("proxyport")
            .and_then(|p| u16::try_from(p).ok())
            .filter(|p| *p > 0)
            .unwrap_or(fallback)
    };
    match (number("proxymethod").unwrap_or(0), text("proxyhost")) {
        (0, _) => {}
        (method @ (2 | 3), Some(host)) => {
            let (kind, port) = if method == 2 { (ProxyKind::Socks5, 1080) } else { (ProxyKind::Http, 8080) };
            c.advanced.proxy = ProxySettings {
                kind,
                host: host.to_owned(),
                port: proxy_port(port),
                user: text("proxyusername").unwrap_or("").to_owned(),
            };
            if !c.advanced.proxy.user.is_empty() {
                c.warnings.push(crate::tr!(
                    "代理密码没有导入，请在连接设置里填写",
                    "The proxy password was not imported. Enter it in the connection settings",
                    "ۋاكالەتچى ئىمى ئەكىرىلمىدى، ئۇلىنىش تەڭشىكىدە تولدۇرۇڭ"
                ));
            }
        }
        (6, Some(host)) => c.jump = Some(host.to_owned()),
        (1, _) => c.warnings.push(crate::tr!(
            "SOCKS4 代理不支持，没有导入",
            "SOCKS4 proxies are not supported, so the proxy was not imported",
            "SOCKS4 ۋاكالەتچىسى قوللانمايدۇ، ئەكىرىلمىدى"
        )),
        _ => c.warnings.push(crate::tr!(
            "这种代理方式不支持，没有导入",
            "This proxy type is not supported and was not imported",
            "بۇ خىل ۋاكالەتچى ئۇسۇلى قوللانمايدۇ، ئەكىرىلمىدى"
        )),
    }
    if let Some(term) = text("terminaltype").filter(|t| valid_term(t)) {
        c.advanced.term = term.to_owned();
    }
    if let Some(secs) = number("pingintervalsecs").filter(|s| *s > 0) {
        c.advanced.keepalive_secs = secs.min(3600);
    }
    c.advanced.agent_forward = number("agentfwd") == Some(1);
    if let Some(command) = text("remotecommand").filter(|t| t.len() <= 4096) {
        c.advanced.startup_command = command.to_owned();
    }
    for item in text("portforwardings").unwrap_or("").split(',').map(str::trim).filter(|i| !i.is_empty()) {
        let spec = item.trim_start_matches(['4', '6']);
        let mut chars = spec.chars();
        let kind = match chars.next().map(|k| k.to_ascii_uppercase()) {
            Some('L') => Some(ForwardKind::Local),
            Some('R') => Some(ForwardKind::Remote),
            Some('D') => Some(ForwardKind::Dynamic),
            _ => None,
        };
        let (bind, dest) = chars.as_str().split_once('=').unwrap_or((chars.as_str(), ""));
        let spec = kind.and_then(|kind| forward_spec(kind, bind, Some(dest).filter(|d| !d.is_empty())));
        push_forward(&mut c, spec, item);
    }
    Some(c)
}

#[cfg(windows)]
fn scan_putty(out: &mut SourceScan) -> io::Result<()> {
    use windows_sys::Win32::System::Registry::HKEY_CURRENT_USER;
    const PATH: &str = r"Software\SimonTatham\PuTTY\Sessions";
    out.paths.push(format!(r"HKEY_CURRENT_USER\{PATH}"));
    let Some(root) = registry::Key::open(HKEY_CURRENT_USER, PATH)? else { return Ok(()) };
    for raw in root.subkeys() {
        let name = putty_unescape(&raw);
        if name == "Default Settings" {
            continue;
        }
        let Ok(Some(key)) = registry::Key::open(root.handle(), &raw) else { continue };
        match putty_session(&name, &key.values()) {
            Some(c) => out.candidates.push(c),
            None => out.skipped += 1,
        }
        if out.candidates.len() >= MAX_CANDIDATES {
            break;
        }
    }
    resolve_jumps(&mut out.candidates);
    Ok(())
}

#[cfg(not(windows))]
fn scan_putty(_out: &mut SourceScan) -> io::Result<()> {
    Err(io::Error::other(crate::tr!(
        "PuTTY 的会话只能在 Windows 上读取",
        "PuTTY sessions can only be read on Windows",
        "PuTTY ئەڭگىمىلىرىنى پەقەت Windows دىلا ئوقۇغىلى بولىدۇ"
    )))
}

// ---- FinalShell ----

/// FinalShell's SSH connection type; others (RDP, VNC…) carry other numbers.
const FINALSHELL_SSH: u64 = 100;

fn json_text<'a>(v: &'a Value, keys: &[&str]) -> Option<&'a str> {
    keys.iter().find_map(|k| v.get(k)?.as_str().map(str::trim).filter(|s| !s.is_empty()))
}

fn json_number(v: &Value, key: &str) -> Option<u64> {
    let v = v.get(key)?;
    v.as_u64().or_else(|| v.as_str()?.trim().parse().ok())
}

/// Folder names FinalShell tends to be unpacked into, under each fixed drive.
const FINALSHELL_PARENTS: &[&str] = &["", "Program Files", "Program Files (x86)", "Programs", "Software", "Soft", "Tools", "Apps"];

/// Where FinalShell may be installed, most likely first. It keeps `conn` inside its install
/// folder, so a copy outside the default is found through its uninstall entry, its shortcuts or
/// the usual folders on other drives.
fn finalshell_homes(at: &Locations) -> (Vec<PathBuf>, Vec<String>) {
    let mut homes = vec![at.local_data.join("finalshell"), at.roaming.join("finalshell")];
    homes.push(at.home.join(".finalshell"));
    homes.push(at.home.join("Library").join("FinalShell"));
    let mut looked = homes[..2].iter().map(|d| d.display().to_string()).collect::<Vec<_>>();
    looked.dedup();
    #[cfg(windows)]
    {
        homes.extend(windows_finds::uninstall_folders().into_iter().map(PathBuf::from));
        homes.extend(windows_finds::shortcut_folders(at));
        let drives = windows_finds::fixed_drives();
        for drive in &drives {
            homes.extend(FINALSHELL_PARENTS.iter().map(|p| Path::new(drive).join(p).join("finalshell")));
        }
        looked.push(crate::tr!(
            "FinalShell 的卸载信息和快捷方式",
            "FinalShell's uninstall entry and shortcuts",
            "FinalShell نىڭ ئۆچۈرۈش ئۇچۇرى ۋە قىسقا يوللىرى"
        ));
        if !drives.is_empty() {
            let names = drives.iter().map(|d| d.trim_end_matches('\\')).collect::<Vec<_>>().join(" ");
            let names = ltr(&names);
            let (plain, program_files) = (ltr("finalshell"), ltr(r"Program Files\finalshell"));
            looked.push(crate::tr!(
                "{names} 盘的 {plain}、{program_files} 等文件夹",
                "Folders such as {plain} and {program_files} on drives {names}",
                "{names} دىسكىلىرىدىكى {plain}، {program_files} قاتارلىق قىسقۇچلار"
            ));
        }
    }
    let mut seen = HashSet::new();
    homes.retain(|h| seen.insert(h.to_string_lossy().to_lowercase()));
    (homes, looked)
}

fn scan_finalshell(at: &Locations, path: Option<&Path>, out: &mut SourceScan) -> io::Result<()> {
    let root = match path {
        Some(path) => path.to_path_buf(),
        None => {
            let (homes, looked) = finalshell_homes(at);
            match homes.iter().map(|h| h.join("conn")).find(|d| d.is_dir()) {
                Some(dir) => dir,
                None => {
                    out.paths = looked;
                    return Ok(());
                }
            }
        }
    };
    // Picking the FinalShell folder itself works too.
    let root = if root.join("conn").is_dir() { root.join("conn") } else { root };
    out.paths.push(root.display().to_string());
    let files = if root.is_file() {
        vec![(Vec::new(), root)]
    } else {
        walk(&root, |p| has_ext(p, "json"))?
    };
    let docs: Vec<(Vec<String>, Value)> = files
        .into_iter()
        .filter_map(|(folders, file)| {
            let text = decode_text(&read_small(&file).ok()?);
            Some((folders, serde_json::from_str(&text).ok()?))
        })
        .collect();
    let (candidates, skipped) = parse_finalshell(&docs);
    out.candidates = candidates;
    out.skipped = skipped;
    Ok(())
}

/// Folder entries name the groups that connections point at with `parent_id`; without them
/// the folders the files sit in are used.
pub fn parse_finalshell(docs: &[(Vec<String>, Value)]) -> (Vec<Candidate>, usize) {
    let is_folder = |v: &Value| v.get("folder").is_some_and(|f| f.as_bool() == Some(true) || f.as_u64() == Some(1));
    let folders: HashMap<&str, (&str, Option<&str>)> = docs
        .iter()
        .filter(|(_, v)| is_folder(v))
        .filter_map(|(_, v)| Some((json_text(v, &["id"])?, (json_text(v, &["name"])?, json_text(v, &["parent_id"])))))
        .collect();
    let group_of = |start: Option<&str>| {
        let mut parent = start.and_then(|p| folders.get_key_value(p)).map(|(k, _)| *k);
        let mut names = Vec::new();
        while let Some((name, up)) = parent.and_then(|p| folders.get(p)) {
            if names.len() >= MAX_DEPTH {
                break;
            }
            names.push(*name);
            parent = *up;
        }
        names.reverse();
        (!names.is_empty()).then(|| names.join("/"))
    };
    let mut candidates = Vec::new();
    let mut skipped = 0;
    for (dirs, v) in docs.iter().filter(|(_, v)| v.is_object() && !is_folder(v)) {
        let Some(host) = json_text(v, &["host", "address"]) else {
            skipped += 1;
            continue;
        };
        if json_number(v, "conection_type").or_else(|| json_number(v, "connection_type")).is_some_and(|t| t != FINALSHELL_SSH) {
            skipped += 1;
            continue;
        }
        let name = json_text(v, &["name"]).unwrap_or(host);
        let mut c = Candidate::new(Source::FinalShell, name, host);
        if let Some(port) = json_number(v, "port").and_then(|p| u16::try_from(p).ok()).filter(|p| *p > 0) {
            c.port = port;
        }
        c.user = json_text(v, &["user_name", "username", "user"]).unwrap_or("").to_owned();
        if json_number(v, "authentication_type") == Some(2) {
            c.warnings.push(crate::tr!(
                "密钥存在 FinalShell 的密钥库里，请导入后在连接里重新选择密钥文件，暂时改成了密码登录",
                "The key is stored in the FinalShell key store. Import it, then choose the key file again in the connection. Password login is used for now",
                "ئاچقۇچ FinalShell نىڭ ئاچقۇچ ئامبىرىدا ساقلانغان، ئەكىرگەندىن كېيىن ئۇلىنىشتا ئاچقۇچ ھۆججىتىنى قايتا تاللاڭ؛ ھازىرچە ئىم بىلەن كىرىشكە ئۆزگەرتىلدى"
            ));
        } else if let Some(saved) = json_text(v, &["password"]) {
            c.saved_password = Some(SavedPassword(Zeroizing::new(saved.to_owned())));
        }
        if let Some(note) = json_text(v, &["description"]) {
            c.note = clip(note, NOTE_CHARS);
        }
        if json_text(v, &["proxy_id"]).is_some_and(|p| p != "0") {
            c.warnings.push(crate::tr!(
                "代理存在 FinalShell 的代理列表里，没有导入",
                "The proxy is stored in the FinalShell proxy list and was not imported",
                "ۋاكالەتچى FinalShell نىڭ ۋاكالەتچى تىزىملىكىدە ساقلانغان، ئەكىرىلمىدى"
            ));
        }
        if v.get("port_forwarding_list").and_then(Value::as_array).is_some_and(|l| !l.is_empty()) {
            c.warnings.push(crate::tr!(
                "端口转发没有导入",
                "Port forwards were not imported",
                "ئېغىز يوللاشلار ئەكىرىلمىدى"
            ));
        }
        c.group = group_of(json_text(v, &["parent_id"])).or_else(|| (!dirs.is_empty()).then(|| dirs.join("/")));
        candidates.push(c);
    }
    (candidates, skipped)
}

/// The folder part of a Windows path; `Path::parent` would not split on `\` elsewhere.
fn windows_parent(path: &str) -> Option<String> {
    let (dir, _) = path.trim_end_matches(['\\', '/']).rsplit_once(['\\', '/'])?;
    let dir = if dir.ends_with(':') { format!("{dir}\\") } else { dir.to_owned() };
    Some(dir)
}

/// The program's folder in an uninstall entry's `DisplayIcon` or `UninstallString`, which may
/// be quoted, carry arguments or end in an icon index.
pub fn exe_folder(command: &str) -> Option<String> {
    let s = command.trim();
    let exe = match s.strip_prefix('"') {
        Some(rest) => rest.split('"').next()?,
        None => match s.to_ascii_lowercase().find(".exe") {
            Some(end) => &s[..end + 4],
            None => s.split(',').next()?,
        },
    };
    windows_parent(exe.trim()).filter(|d| !d.is_empty())
}

/// The folder a `.lnk` shortcut points into: its target's folder, else its working folder.
/// Follows the Shell Link binary format (MS-SHLLINK); anything malformed is `None`.
pub fn shortcut_folder(bytes: &[u8]) -> Option<String> {
    const HAS_ID_LIST: u32 = 0x1;
    const HAS_LINK_INFO: u32 = 0x2;
    const UNICODE: u32 = 0x80;
    let u16_at = |at: usize| Some(usize::from(u16::from_le_bytes(bytes.get(at..at + 2)?.try_into().ok()?)));
    let u32_at = |at: usize| Some(u32::from_le_bytes(bytes.get(at..at + 4)?.try_into().ok()?));
    if u32_at(0)? != 0x4C {
        return None;
    }
    let flags = u32_at(0x14)?;
    let mut at = 0x4C;
    if flags & HAS_ID_LIST != 0 {
        at += 2 + u16_at(at)?;
    }
    if flags & HAS_LINK_INFO != 0 {
        let size = usize::try_from(u32_at(at)?).ok()?;
        let info = bytes.get(at..at.checked_add(size)?)?;
        if let Some(dir) = link_info_path(info).as_deref().and_then(windows_parent) {
            return Some(dir);
        }
        at += size;
    }
    // StringData: name, relative path, then working folder, each a counted string.
    let unicode = flags & UNICODE != 0;
    for bit in [0x4, 0x8, 0x10] {
        if flags & bit == 0 {
            continue;
        }
        let count = u16_at(at)?;
        let len = if unicode { count * 2 } else { count };
        let raw = bytes.get(at + 2..at + 2 + len)?;
        at += 2 + len;
        if bit == 0x10 {
            let dir = if unicode { utf16(raw, u16::from_le_bytes) } else { ansi(raw) };
            return Some(dir).filter(|d| !d.is_empty());
        }
    }
    None
}

/// `LocalBasePath` plus `CommonPathSuffix`, preferring the Unicode copies when present.
fn link_info_path(info: &[u8]) -> Option<String> {
    let u32_at = |at: usize| Some(u32::from_le_bytes(info.get(at..at + 4)?.try_into().ok()?) as usize);
    let narrow = |at: usize| {
        let rest = info.get(at..)?;
        Some(ansi(&rest[..rest.iter().position(|&b| b == 0)?]))
    };
    let wide = |at: usize| {
        let rest = info.get(at..)?;
        let end = rest.chunks_exact(2).position(|p| p == [0, 0])?;
        Some(utf16(&rest[..end * 2], u16::from_le_bytes))
    };
    const VOLUME_AND_LOCAL_PATH: usize = 0x1;
    if u32_at(8)? & VOLUME_AND_LOCAL_PATH == 0 {
        return None;
    }
    let (base, suffix) = if u32_at(4)? >= 0x24 {
        (wide(u32_at(0x1C)?)?, u32_at(0x20).filter(|&o| o != 0).and_then(wide).unwrap_or_default())
    } else {
        (narrow(u32_at(0x10)?)?, u32_at(0x18).filter(|&o| o != 0).and_then(narrow).unwrap_or_default())
    };
    Some(base + &suffix).filter(|p| !p.is_empty())
}

#[cfg(windows)]
mod windows_finds {
    use std::path::{Path, PathBuf};

    use windows_sys::Win32::Storage::FileSystem::{GetDriveTypeW, GetLogicalDrives};
    use windows_sys::Win32::System::Registry::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};

    use super::{Locations, RegValue, exe_folder, has_ext, read_small, shortcut_folder};
    use crate::registry::Key;

    const DRIVE_FIXED: u32 = 3;

    pub fn fixed_drives() -> Vec<String> {
        // SAFETY: no arguments; returns a bitmask of drive letters.
        let mask = unsafe { GetLogicalDrives() };
        (0..26u8)
            .filter(|i| mask & (1 << i) != 0)
            .map(|i| format!("{}:\\", char::from(b'A' + i)))
            .filter(|root| {
                let wide: Vec<u16> = root.encode_utf16().chain(Some(0)).collect();
                // SAFETY: `wide` is a NUL-terminated root path that outlives the call.
                unsafe { GetDriveTypeW(wide.as_ptr()) == DRIVE_FIXED }
            })
            .collect()
    }

    pub fn uninstall_folders() -> Vec<String> {
        const UNINSTALL: &str = r"Software\Microsoft\Windows\CurrentVersion\Uninstall";
        const UNINSTALL_32: &str = r"Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall";
        let mut out = Vec::new();
        for (hive, path) in [(HKEY_CURRENT_USER, UNINSTALL), (HKEY_LOCAL_MACHINE, UNINSTALL), (HKEY_LOCAL_MACHINE, UNINSTALL_32)] {
            let Ok(Some(root)) = Key::open(hive, path) else { continue };
            for name in root.subkeys() {
                let Ok(Some(key)) = Key::open(root.handle(), &name) else { continue };
                let values = key.values();
                let text = |k: &str| match values.get(k) {
                    Some(RegValue::Text(t)) if !t.trim().is_empty() => Some(t.trim().to_owned()),
                    _ => None,
                };
                let named = text("displayname").unwrap_or_else(|| name.clone());
                if !named.to_lowercase().contains("finalshell") {
                    continue;
                }
                let folder = text("installlocation")
                    .map(|d| d.trim_matches('"').to_owned())
                    .or_else(|| text("displayicon").as_deref().and_then(exe_folder))
                    .or_else(|| text("uninstallstring").as_deref().and_then(exe_folder));
                out.extend(folder);
            }
        }
        out
    }

    /// Shortcut folders and how deep to look in each: the desktop's top level, the Start
    /// menu a couple of folders down.
    fn shortcut_places(at: &Locations) -> Vec<(PathBuf, usize)> {
        let env = |k: &str| std::env::var_os(k).map(PathBuf::from);
        let menu = |root: PathBuf| root.join("Microsoft").join("Windows").join("Start Menu").join("Programs");
        let mut places = vec![(at.desktop.clone(), 0), (menu(at.roaming.clone()), 2)];
        places.extend(env("PUBLIC").map(|p| (p.join("Desktop"), 0)));
        places.extend(env("ProgramData").map(|p| (menu(p), 2)));
        places
    }

    pub fn shortcut_folders(at: &Locations) -> Vec<PathBuf> {
        let mut out = Vec::new();
        for (place, depth) in shortcut_places(at) {
            let mut stack = vec![(place, 0)];
            while let Some((dir, level)) = stack.pop() {
                let Ok(read) = std::fs::read_dir(&dir) else { continue };
                for entry in read.filter_map(Result::ok).take(2000) {
                    let path = entry.path();
                    let Ok(kind) = entry.file_type() else { continue };
                    if kind.is_dir() && level < depth {
                        stack.push((path, level + 1));
                    } else if kind.is_file() && has_ext(&path, "lnk") && is_finalshell(&path) {
                        let Ok(bytes) = read_small(&path) else { continue };
                        out.extend(shortcut_folder(&bytes).map(PathBuf::from));
                    }
                }
            }
        }
        out
    }

    fn is_finalshell(path: &Path) -> bool {
        path.file_stem().is_some_and(|s| s.to_string_lossy().to_lowercase().contains("finalshell"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn lines(text: &str) -> Vec<String> {
        text.lines().map(str::to_owned).collect()
    }

    fn ssh(text: &str) -> Vec<Candidate> {
        parse_ssh_config(&lines(text), Path::new("/nonexistent-home"), "me")
    }

    #[test]
    fn glob_matches_like_openssh() {
        assert!(glob("*.example.com", "a.EXAMPLE.com"));
        assert!(glob("web-?", "web-1"));
        assert!(!glob("web-?", "web-10"));
        assert!(glob("*", ""));
        assert!(!glob("db*", "web"));
    }

    #[test]
    fn ssh_config_first_value_wins_and_wildcards_fill_in() {
        let got = ssh(r#"
# comment
Host web web-alias
    HostName 10.0.0.5
    Port 2222
    IdentityFile ~/.ssh/id_web
    LocalForward 8080 localhost:80
    DynamicForward 1080

Host db
    HostName %h.internal
    User postgres
    PreferredAuthentications password

Host * !db
    User deploy
    ServerAliveInterval 15
    ForwardAgent yes

Host *
    User fallback
    Port 9999
"#);
        let names: Vec<&str> = got.iter().map(|c| c.name.as_str()).collect();
        assert_eq!(names, ["web", "web-alias", "db"]);
        let web = &got[0];
        assert_eq!((web.host.as_str(), web.port, web.user.as_str()), ("10.0.0.5", 2222, "deploy"));
        assert_eq!(web.method, AuthMethod::KeyFile);
        assert!(web.key_path.ends_with("id_web"), "{}", web.key_path);
        assert_eq!(web.advanced.keepalive_secs, 15);
        assert!(web.advanced.agent_forward);
        assert_eq!(web.advanced.forwards.len(), 2);
        assert_eq!(web.advanced.forwards[0].dest_port, 80);
        assert_eq!(web.advanced.forwards[1].kind, ForwardKind::Dynamic);
        let db = &got[2];
        assert_eq!((db.host.as_str(), db.port, db.user.as_str()), ("db.internal", 9999, "postgres"));
        assert_eq!(db.method, AuthMethod::Password);
        assert!(!db.advanced.agent_forward);
    }

    #[test]
    fn ssh_config_defaults_and_match_blocks() {
        let got = ssh("Host plain\nMatch host other\n    User nobody\nMatch all\n    Port 2200\n");
        assert_eq!(got.len(), 1);
        assert_eq!((got[0].host.as_str(), got[0].port, got[0].user.as_str()), ("plain", 2200, "me"));
    }

    #[test]
    fn ssh_config_jump_resolves_to_alias_or_address() {
        let got = ssh(
            "Host bastion\n HostName 1.2.3.4\nHost a\n ProxyJump bastion\nHost b\n ProxyJump root@1.2.3.4:22\n\
             Host c\n ProxyJump x,bastion\nHost d\n ProxyJump nowhere\nHost e\n ProxyCommand nc %h %p\n",
        );
        let jump = |name: &str| got.iter().find(|c| c.name == name).unwrap();
        assert_eq!(jump("a").jump.as_deref(), Some("bastion"));
        assert_eq!(jump("b").jump.as_deref(), Some("bastion"));
        assert_eq!(jump("c").jump.as_deref(), Some("bastion"));
        assert_eq!(jump("c").warnings.len(), 1);
        assert_eq!(jump("d").jump, None);
        assert_eq!(jump("d").warnings.len(), 1);
        assert!(jump("e").warnings[0].contains("ProxyCommand"));
    }

    #[test]
    fn ssh_config_quoted_values_and_bad_forwards() {
        let got = ssh("Host=\"q\"\n  RemoteCommand tmux attach -t main\n  LocalForward /tmp/sock /run/x\n  Port abc\n");
        assert_eq!(got[0].name, "q");
        assert_eq!(got[0].advanced.startup_command, "tmux attach -t main");
        assert!(got[0].advanced.forwards.is_empty());
        assert_eq!(got[0].warnings.len(), 2);
        assert_eq!(got[0].port, 22);
    }

    #[test]
    fn ssh_config_include_is_spliced_in_scope() {
        let home = tempfile::tempdir().unwrap();
        let dir = home.path().join(".ssh");
        std::fs::create_dir_all(dir.join("conf.d")).unwrap();
        std::fs::write(dir.join("conf.d").join("a.conf"), "Host inc\n HostName 9.9.9.9\n").unwrap();
        std::fs::write(dir.join("conf.d").join("b.txt"), "Host skipped\n").unwrap();
        std::fs::write(
            dir.join("config"),
            "Host outer\n Include conf.d/*.conf\n User kept\nInclude missing\n",
        )
        .unwrap();
        let mut out = Vec::new();
        ssh_config_lines(&dir.join("config"), home.path(), 0, &mut out).unwrap();
        let got = parse_ssh_config(&out, home.path(), "me");
        let names: Vec<&str> = got.iter().map(|c| c.name.as_str()).collect();
        assert_eq!(names, ["outer", "inc"]);
        assert_eq!(got[0].user, "kept");
        assert_eq!(got[1].host, "9.9.9.9");
        assert_eq!(got[1].user, "me");
    }

    #[test]
    fn text_in_any_session_encoding() {
        let utf16: Vec<u8> = [0xff, 0xfe].into_iter().chain("主机=a".encode_utf16().flat_map(u16::to_le_bytes)).collect();
        assert_eq!(decode_text(&utf16), "主机=a");
        let bare: Vec<u8> = "Host=a".encode_utf16().flat_map(u16::to_le_bytes).collect();
        assert_eq!(decode_text(&bare), "Host=a");
        let gbk = encoding_rs::GBK.encode("生产服务器").0;
        assert_eq!(decode_text(&gbk), "生产服务器");
        assert_eq!(decode_text("\u{feff}ok".as_bytes()), "ok");
    }

    #[test]
    fn xshell_session_file() {
        let text = "[SessionInfo]\nDescription=Xshell session file\n[CONNECTION:AUTHENTICATION]\nUserName=root\n\
                    Method=2\nPassword=secret\n[CONNECTION:PROXY]\nProxy=\n[CONNECTION]\nHost= 10.1.1.1 \nPort=2022\n\
                    Protocol=SSH\n[TERMINAL]\nType=linux\n";
        let c = xshell_session("web", text).unwrap();
        assert_eq!((c.host.as_str(), c.port, c.user.as_str()), ("10.1.1.1", 2022, "root"));
        assert_eq!(c.method, AuthMethod::KeyboardInteractive);
        assert_eq!(c.advanced.term, "linux");
        assert!(c.note.is_empty() && c.warnings.is_empty());

        let keyed = xshell_session("k", "[CONNECTION]\nHost=h\n[CONNECTION:AUTHENTICATION]\nMethod=1\nUserKey=id_rsa_2048\n").unwrap();
        assert_eq!(keyed.method, AuthMethod::Password);
        assert_eq!(keyed.warnings.len(), 1);
        assert!(xshell_session("t", "[CONNECTION]\nHost=h\nProtocol=TELNET\n").is_none());
        assert!(xshell_session("t", "[CONNECTION]\nProtocol=SSH\n").is_none());
    }

    #[test]
    fn xshell_folders_become_groups() {
        let root = tempfile::tempdir().unwrap();
        let sub = root.path().join("生产").join("db");
        std::fs::create_dir_all(&sub).unwrap();
        std::fs::write(root.path().join("top.xsh"), "[CONNECTION]\nHost=1.1.1.1\n").unwrap();
        let utf16: Vec<u8> = [0xff, 0xfe]
            .into_iter()
            .chain("[CONNECTION]\r\nHost=2.2.2.2\r\n".encode_utf16().flat_map(u16::to_le_bytes))
            .collect();
        std::fs::write(sub.join("主库.xsh"), utf16).unwrap();
        std::fs::write(sub.join("serial.xsh"), "[CONNECTION]\nHost=x\nProtocol=SERIAL\n").unwrap();
        std::fs::write(sub.join("notes.txt"), "ignored").unwrap();
        let at = Locations {
            home: root.path().into(),
            documents: root.path().into(),
            desktop: root.path().into(),
            local_data: root.path().into(),
            roaming: root.path().into(),
            local_user: "me".into(),
        };
        let got = scan(Source::Xshell, &at, Some(root.path()));
        assert_eq!(got.error, None);
        assert_eq!(got.skipped, 1);
        let rows: Vec<(Option<&str>, &str)> = got.candidates.iter().map(|c| (c.group.as_deref(), c.name.as_str())).collect();
        assert_eq!(rows, [(None, "top"), (Some("生产/db"), "主库")]);
    }

    #[test]
    fn putty_session_values() {
        let values: HashMap<String, RegValue> = [
            ("hostname", RegValue::Text("admin@example.org".into())),
            ("portnumber", RegValue::Number(2200)),
            ("protocol", RegValue::Text("ssh".into())),
            ("publickeyfile", RegValue::Text(r"C:\keys\me.ppk".into())),
            ("proxymethod", RegValue::Number(2)),
            ("proxyhost", RegValue::Text("proxy.lan".into())),
            ("proxyport", RegValue::Number(0)),
            ("portforwardings", RegValue::Text("L8080=localhost:80,4R2222=localhost:22,D1080,Lbad".into())),
            ("agentfwd", RegValue::Number(1)),
            ("pingintervalsecs", RegValue::Number(0)),
        ]
        .into_iter()
        .map(|(k, v)| (k.to_owned(), v))
        .collect();
        let c = putty_session("my server", &values).unwrap();
        assert_eq!((c.host.as_str(), c.port, c.user.as_str()), ("example.org", 2200, "admin"));
        assert_eq!(c.method, AuthMethod::KeyFile);
        assert_eq!(c.advanced.proxy.kind, ProxyKind::Socks5);
        assert_eq!(c.advanced.proxy.port, 1080);
        assert_eq!(c.advanced.forwards.len(), 3);
        assert_eq!(c.advanced.forwards[1].kind, ForwardKind::Remote);
        assert_eq!(c.warnings.len(), 1);
        assert!(c.advanced.agent_forward);
        assert_eq!(c.advanced.keepalive_secs, Advanced::default().keepalive_secs);

        let telnet: HashMap<String, RegValue> = [("hostname".to_owned(), RegValue::Text("h".into())), ("protocol".to_owned(), RegValue::Text("telnet".into()))].into();
        assert!(putty_session("t", &telnet).is_none());
        assert_eq!(putty_unescape("my%20server%25"), "my server%");
        assert_eq!(putty_unescape("%C9%FA%B2%FA"), "生产");
        assert_eq!(putty_unescape("100%"), "100%");
    }

    #[test]
    fn finalshell_connections_and_folders() {
        let doc = |text: &str| serde_json::from_str::<Value>(text).unwrap();
        let docs = vec![
            (Vec::new(), doc(r#"{"folder":true,"id":"f1","name":"生产","parent_id":"root"}"#)),
            (Vec::new(), doc(r#"{"folder":true,"id":"f2","name":"db","parent_id":"f1"}"#)),
            (
                Vec::new(),
                doc(r#"{"name":"主库","host":"10.0.0.9","port":"2222","user_name":"root","conection_type":100,
                       "parent_id":"f2","authentication_type":2,"password":"enc","proxy_id":"0"}"#),
            ),
            (
                vec!["sub".into()],
                doc(r#"{"name":"x","host":"h","port":22,"user_name":"u","password":"ZDIZA00DC2MH4GUdAJaMl/BGrW/K50wB"}"#),
            ),
            (Vec::new(), doc(r#"{"name":"rdp","host":"h","conection_type":101}"#)),
            (Vec::new(), doc(r#"{"name":"empty"}"#)),
        ];
        let (got, skipped) = parse_finalshell(&docs);
        assert_eq!(skipped, 2);
        assert_eq!(got.len(), 2);
        assert_eq!((got[0].host.as_str(), got[0].port, got[0].user.as_str()), ("10.0.0.9", 2222, "root"));
        assert_eq!(got[0].group.as_deref(), Some("生产/db"));
        assert_eq!(got[0].method, AuthMethod::Password);
        assert_eq!(got[0].warnings.len(), 1);
        assert!(got[0].saved_password.is_none(), "a key login's password field is not a login password");
        assert_eq!(got[1].group.as_deref(), Some("sub"));
        assert_eq!(got[1].saved_password.as_ref().unwrap().decrypt().unwrap().as_str(), "exactly8");
    }

    #[test]
    fn saved_passwords_never_leave_in_json_or_debug() {
        let mut c = Candidate::new(Source::FinalShell, "x", "h");
        c.saved_password = Some(SavedPassword(Zeroizing::new("ZDIZA00DC2MH4GUdAJaMl/BGrW/K50wB".into())));
        c.password_ref = Some("ref-1".into());
        let json = serde_json::to_string(&c).unwrap();
        let debug = format!("{c:?}");
        for text in [&json, &debug] {
            assert!(!text.contains("ZDIZA00") && !text.contains("exactly8"), "{text}");
        }
        assert!(json.contains("\"passwordRef\":\"ref-1\""));
        let back: Candidate = serde_json::from_str(&json).unwrap();
        assert!(back.saved_password.is_none(), "the frontend cannot hand one in");
    }

    #[test]
    fn entries_ask_for_passwords_only_on_password_logins() {
        let saved = Profiles {
            groups: Vec::new(),
            servers: Vec::new(),
        };
        let password = Candidate::new(Source::FinalShell, "pw", "1.1.1.1");
        let mut key = Candidate::new(Source::FinalShell, "key", "2.2.2.2");
        key.method = AuthMethod::KeyFile;
        let mut asked = Vec::new();
        let got = entries(vec![password, key], &saved, |c| {
            asked.push(c.name.clone());
            SecretUpdate::Set {
                value: Zeroizing::new("p".into()),
            }
        });
        assert_eq!(asked, ["pw"]);
        assert!(matches!(got[0].input.auth.secret, SecretUpdate::Set { .. }));
        assert!(matches!(got[1].input.auth.secret, SecretUpdate::Keep));
    }

    #[test]
    fn entries_wire_jumps_within_the_source_then_saved_servers() {
        let mut a = Candidate::new(Source::SshConfig, "a", "1.1.1.1");
        a.jump = Some("bastion".into());
        let bastion = Candidate::new(Source::SshConfig, "bastion", "2.2.2.2");
        let mut other = Candidate::new(Source::Putty, "p", "3.3.3.3");
        other.jump = Some("bastion".into());
        other.group = Some("  组  ".into());
        let saved = Profiles {
            groups: Vec::new(),
            servers: Vec::new(),
        };
        let got = entries(vec![a, bastion, other], &saved, |_| SecretUpdate::Keep);
        assert!(matches!(got[0].jump, Some(JumpRef::Batch(1))));
        assert!(got[1].jump.is_none());
        assert!(got[2].jump.is_none());
        assert_eq!(got[2].group.as_deref(), Some("组"));
    }

    #[test]
    fn exe_folder_from_uninstall_values() {
        assert_eq!(exe_folder(r#""D:\Tools\FinalShell\finalshell.exe",0"#).as_deref(), Some(r"D:\Tools\FinalShell"));
        assert_eq!(exe_folder(r"E:\soft\finalshell\finalshell.exe,0").as_deref(), Some(r"E:\soft\finalshell"));
        assert_eq!(exe_folder(r#""E:\a b\uninst.exe" /S"#).as_deref(), Some(r"E:\a b"));
        assert_eq!(exe_folder(r"E:\a b\Uninstall.EXE /S").as_deref(), Some(r"E:\a b"));
        assert_eq!(exe_folder(r"F:\finalshell.exe").as_deref(), Some(r"F:\"));
        assert_eq!(exe_folder("finalshell.exe"), None);
    }

    /// A header with `flags`, then an empty ID list when asked for.
    fn link_header(flags: u32) -> Vec<u8> {
        let mut out = vec![0u8; 0x4C];
        out[..4].copy_from_slice(&0x4Cu32.to_le_bytes());
        out[0x14..0x18].copy_from_slice(&flags.to_le_bytes());
        if flags & 0x1 != 0 {
            out.extend_from_slice(&4u16.to_le_bytes());
            out.extend_from_slice(&[0, 0, 0, 0]);
        }
        out
    }

    #[test]
    fn shortcut_folder_reads_the_local_target() {
        let path = b"D:\\Tools\\finalshell\\finalshell.exe\0";
        let header = 0x1Cu32;
        let base = header;
        let suffix = base + path.len() as u32;
        let size = suffix + 1;
        let mut info = Vec::new();
        for v in [size, header, 1, header, base, 0, suffix] {
            info.extend_from_slice(&v.to_le_bytes());
        }
        info.extend_from_slice(path);
        info.push(0);
        let mut lnk = link_header(0x1 | 0x2);
        lnk.extend_from_slice(&info);
        assert_eq!(shortcut_folder(&lnk).as_deref(), Some(r"D:\Tools\finalshell"));
    }

    #[test]
    fn shortcut_folder_falls_back_to_the_working_folder() {
        let mut lnk = link_header(0x1 | 0x10 | 0x80);
        let dir: Vec<u16> = r"E:\绿色软件\finalshell".encode_utf16().collect();
        lnk.extend_from_slice(&(dir.len() as u16).to_le_bytes());
        lnk.extend(dir.iter().flat_map(|u| u.to_le_bytes()));
        assert_eq!(shortcut_folder(&lnk).as_deref(), Some(r"E:\绿色软件\finalshell"));
    }

    #[test]
    fn shortcut_folder_rejects_junk() {
        assert_eq!(shortcut_folder(b""), None);
        assert_eq!(shortcut_folder(&[0x4C, 0, 0, 0]), None);
        let mut lnk = link_header(0x2);
        lnk.extend_from_slice(&u32::MAX.to_le_bytes());
        assert_eq!(shortcut_folder(&lnk), None);
    }

    #[test]
    fn finalshell_found_in_a_custom_install_folder() {
        let root = tempfile::tempdir().unwrap();
        let conn = root.path().join("finalshell").join("conn");
        std::fs::create_dir_all(&conn).unwrap();
        std::fs::write(conn.join("a_connect_config.json"), r#"{"name":"a","host":"10.0.0.1","user_name":"root"}"#).unwrap();
        let empty = root.path().join("empty");
        let at = Locations {
            home: empty.clone(),
            documents: empty.clone(),
            desktop: empty.clone(),
            local_data: empty.clone(),
            roaming: empty,
            local_user: "me".into(),
        };
        // Only where it would look: the real defaults may hold someone's connections.
        let (homes, looked) = finalshell_homes(&at);
        assert_eq!(homes[0], at.local_data.join("finalshell"));
        assert_eq!(looked[0], at.local_data.join("finalshell").display().to_string());
        assert_eq!(looked.iter().filter(|l| **l == looked[0]).count(), 1);
        let got = scan(Source::FinalShell, &at, Some(&root.path().join("finalshell")));
        assert_eq!(got.candidates.len(), 1);
        assert_eq!(got.paths, [conn.display().to_string()]);
    }
}
