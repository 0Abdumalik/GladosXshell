//! SFTP operations against an in-process russh server whose `sftp` subsystem is backed by an
//! in-memory POSIX-like filesystem (so modes, symlinks and hostile names work on Windows).

use std::collections::{BTreeMap, HashMap};
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::{Duration, UNIX_EPOCH};

use gxs_core::Error;
use gxs_core::known_hosts::{HostKeyPolicy, KnownHosts};
use gxs_core::sftp::{EntryKind, Existing, Progress, Sftp};
use gxs_core::ssh::{self, ConnectOptions, SshAuth, SshClient};
use zeroize::Zeroizing;
use russh::keys::{Algorithm, PrivateKey};
use russh::server::{self, Auth, ChannelOpenHandle, Msg, Session};
use russh::{Channel, ChannelId};
use russh_sftp::protocol::{Attrs, Data, File, FileAttributes, Handle, Name, OpenFlags, Status, StatusCode, Version};
use tokio::net::TcpListener;
use tokio_util::sync::CancellationToken;

const HOME: &str = "/home/gxs";
const OLD: u32 = 1_700_000_000;

#[derive(Clone, Debug)]
enum Node {
    Dir { mode: u32 },
    File { data: Vec<u8>, mode: u32, mtime: u32 },
    Link { target: String },
}

#[derive(Default)]
struct Fs {
    nodes: BTreeMap<String, Node>,
    slow: bool,
}

type SharedFs = Arc<Mutex<Fs>>;

fn norm(path: &str) -> String {
    let joined = if path.starts_with('/') {
        path.to_owned()
    } else {
        format!("{HOME}/{path}")
    };
    let mut parts: Vec<&str> = Vec::new();
    for part in joined.split('/') {
        match part {
            "" | "." => {}
            ".." => {
                parts.pop();
            }
            p => parts.push(p),
        }
    }
    format!("/{}", parts.join("/"))
}

fn parent(path: &str) -> String {
    match path.rsplit_once('/') {
        Some(("", _)) | None => "/".into(),
        Some((p, _)) => p.into(),
    }
}

fn child_prefix(dir: &str) -> String {
    if dir == "/" { "/".into() } else { format!("{dir}/") }
}

impl Fs {
    fn with_home() -> Self {
        let mut fs = Fs::default();
        fs.dir("/");
        fs.dir("/home");
        fs.dir(HOME);
        fs
    }

    fn dir(&mut self, path: &str) {
        self.nodes.insert(path.into(), Node::Dir { mode: 0o755 });
    }

    fn file(&mut self, path: &str, data: &[u8]) {
        self.nodes.insert(
            path.into(),
            Node::File {
                data: data.to_vec(),
                mode: 0o644,
                mtime: OLD,
            },
        );
    }

    fn link(&mut self, path: &str, target: &str) {
        self.nodes.insert(path.into(), Node::Link { target: target.into() });
    }

    fn resolve(&self, path: &str) -> Option<(String, Node)> {
        let mut path = norm(path);
        for _ in 0..8 {
            match self.nodes.get(&path)? {
                Node::Link { target } => path = norm(target),
                node => return Some((path, node.clone())),
            }
        }
        None
    }

    fn children(&self, dir: &str) -> Vec<(String, Node)> {
        let prefix = child_prefix(dir);
        self.nodes
            .range(prefix.clone()..)
            .take_while(|(k, _)| k.starts_with(&prefix))
            .filter(|(k, _)| k.len() > prefix.len() && !k[prefix.len()..].contains('/'))
            .map(|(k, v)| (k[prefix.len()..].to_owned(), v.clone()))
            .collect()
    }

    fn mode(&self, path: &str) -> u32 {
        match self.nodes.get(path) {
            Some(Node::Dir { mode } | Node::File { mode, .. }) => *mode,
            other => panic!("{path}: {other:?}"),
        }
    }

    fn mtime(&self, path: &str) -> u32 {
        match self.nodes.get(path) {
            Some(Node::File { mtime, .. }) => *mtime,
            other => panic!("{path}: {other:?}"),
        }
    }

    fn data(&self, path: &str) -> Vec<u8> {
        match self.nodes.get(path) {
            Some(Node::File { data, .. }) => data.clone(),
            other => panic!("{path}: {other:?}"),
        }
    }
}

fn attrs(node: &Node) -> FileAttributes {
    let (kind, mode, size, mtime) = match node {
        Node::Dir { mode } => (0o040000, *mode, 0, OLD),
        Node::File { data, mode, mtime } => (0o100000, *mode, data.len() as u64, *mtime),
        Node::Link { target } => (0o120000, 0o777, target.len() as u64, OLD),
    };
    FileAttributes {
        size: Some(size),
        uid: Some(1000),
        gid: Some(1000),
        permissions: Some(kind | mode),
        atime: Some(mtime),
        mtime: Some(mtime),
        ..FileAttributes::empty()
    }
}

fn ok(id: u32) -> Status {
    Status {
        id,
        status_code: StatusCode::Ok,
        error_message: "Ok".into(),
        language_tag: "en-US".into(),
    }
}

enum Open {
    File(String),
    Dir { path: String, done: bool },
}

struct MemSftp {
    fs: SharedFs,
    handles: HashMap<String, Open>,
    next: u64,
}

impl MemSftp {
    fn handle(&mut self, open: Open) -> String {
        self.next += 1;
        let h = format!("h{}", self.next);
        self.handles.insert(h.clone(), open);
        h
    }

    fn file_path(&self, handle: &str) -> Result<String, StatusCode> {
        match self.handles.get(handle) {
            Some(Open::File(p)) => Ok(p.clone()),
            _ => Err(StatusCode::Failure),
        }
    }

    async fn throttle(&self) {
        let slow = self.fs.lock().unwrap().slow;
        if slow {
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
    }

    fn fs(&self) -> std::sync::MutexGuard<'_, Fs> {
        self.fs.lock().unwrap()
    }
}

impl russh_sftp::server::Handler for MemSftp {
    type Error = StatusCode;

    fn unimplemented(&self) -> Self::Error {
        StatusCode::OpUnsupported
    }

    async fn init(&mut self, _: u32, _: HashMap<String, String>) -> Result<Version, Self::Error> {
        Ok(Version::new())
    }

    async fn open(
        &mut self,
        id: u32,
        filename: String,
        flags: OpenFlags,
        _: FileAttributes,
    ) -> Result<Handle, Self::Error> {
        let path = {
            let mut fs = self.fs();
            let path = norm(&filename);
            match fs.resolve(&path) {
                Some((_, Node::Dir { .. })) => return Err(StatusCode::Failure),
                Some((real, Node::File { mode, mtime, .. })) => {
                    if flags.contains(OpenFlags::EXCLUDE) {
                        return Err(StatusCode::Failure);
                    }
                    if flags.contains(OpenFlags::TRUNCATE) {
                        let data = Vec::new();
                        fs.nodes.insert(real.clone(), Node::File { data, mode, mtime });
                    }
                    real
                }
                Some((_, Node::Link { .. })) => unreachable!(),
                None => {
                    if !flags.contains(OpenFlags::CREATE) {
                        return Err(StatusCode::NoSuchFile);
                    }
                    if !matches!(fs.nodes.get(&parent(&path)), Some(Node::Dir { .. })) {
                        return Err(StatusCode::NoSuchFile);
                    }
                    fs.file(&path, b"");
                    path
                }
            }
        };
        Ok(Handle {
            id,
            handle: self.handle(Open::File(path)),
        })
    }

    async fn close(&mut self, id: u32, handle: String) -> Result<Status, Self::Error> {
        self.handles.remove(&handle);
        Ok(ok(id))
    }

    async fn read(&mut self, id: u32, handle: String, offset: u64, len: u32) -> Result<Data, Self::Error> {
        self.throttle().await;
        let path = self.file_path(&handle)?;
        let data = match self.fs().nodes.get(&path) {
            Some(Node::File { data, .. }) => data.clone(),
            _ => return Err(StatusCode::NoSuchFile),
        };
        let start = offset as usize;
        if start >= data.len() {
            return Err(StatusCode::Eof);
        }
        let end = (start + len as usize).min(data.len());
        Ok(Data {
            id,
            data: data[start..end].to_vec(),
        })
    }

    async fn write(&mut self, id: u32, handle: String, offset: u64, bytes: Vec<u8>) -> Result<Status, Self::Error> {
        self.throttle().await;
        let path = self.file_path(&handle)?;
        let mut fs = self.fs();
        let Some(Node::File { data, .. }) = fs.nodes.get_mut(&path) else {
            return Err(StatusCode::NoSuchFile);
        };
        let end = offset as usize + bytes.len();
        if data.len() < end {
            data.resize(end, 0);
        }
        data[offset as usize..end].copy_from_slice(&bytes);
        Ok(ok(id))
    }

    async fn lstat(&mut self, id: u32, path: String) -> Result<Attrs, Self::Error> {
        let node = self
            .fs()
            .nodes
            .get(&norm(&path))
            .cloned()
            .ok_or(StatusCode::NoSuchFile)?;
        Ok(Attrs {
            id,
            attrs: attrs(&node),
        })
    }

    async fn stat(&mut self, id: u32, path: String) -> Result<Attrs, Self::Error> {
        let (_, node) = self.fs().resolve(&path).ok_or(StatusCode::NoSuchFile)?;
        Ok(Attrs {
            id,
            attrs: attrs(&node),
        })
    }

    async fn fstat(&mut self, id: u32, handle: String) -> Result<Attrs, Self::Error> {
        let path = self.file_path(&handle)?;
        self.stat(id, path).await
    }

    async fn setstat(&mut self, id: u32, path: String, new: FileAttributes) -> Result<Status, Self::Error> {
        let mut fs = self.fs();
        let (real, _) = fs.resolve(&path).ok_or(StatusCode::NoSuchFile)?;
        if let Some(perm) = new.permissions {
            match fs.nodes.get_mut(&real) {
                Some(Node::Dir { mode } | Node::File { mode, .. }) => *mode = perm & 0o7777,
                _ => return Err(StatusCode::Failure),
            }
        }
        if let (Some(time), Some(Node::File { mtime, .. })) = (new.mtime, fs.nodes.get_mut(&real)) {
            *mtime = time;
        }
        Ok(ok(id))
    }

    async fn opendir(&mut self, id: u32, path: String) -> Result<Handle, Self::Error> {
        let real = match self.fs().resolve(&path) {
            Some((real, Node::Dir { .. })) => real,
            Some(_) => return Err(StatusCode::Failure),
            None => return Err(StatusCode::NoSuchFile),
        };
        Ok(Handle {
            id,
            handle: self.handle(Open::Dir {
                path: real,
                done: false,
            }),
        })
    }

    async fn readdir(&mut self, id: u32, handle: String) -> Result<Name, Self::Error> {
        let Some(Open::Dir { path, done }) = self.handles.get_mut(&handle) else {
            return Err(StatusCode::Failure);
        };
        if *done {
            return Err(StatusCode::Eof);
        }
        *done = true;
        let path = path.clone();
        let mut files = vec![
            File::new(".", attrs(&Node::Dir { mode: 0o755 })),
            File::new("..", attrs(&Node::Dir { mode: 0o755 })),
        ];
        files.extend(
            self.fs()
                .children(&path)
                .into_iter()
                .map(|(name, node)| File::new(name, attrs(&node))),
        );
        Ok(Name { id, files })
    }

    async fn remove(&mut self, id: u32, filename: String) -> Result<Status, Self::Error> {
        let mut fs = self.fs();
        let path = norm(&filename);
        match fs.nodes.get(&path) {
            Some(Node::Dir { .. }) => Err(StatusCode::Failure),
            Some(_) => {
                fs.nodes.remove(&path);
                Ok(ok(id))
            }
            None => Err(StatusCode::NoSuchFile),
        }
    }

    async fn mkdir(&mut self, id: u32, path: String, _: FileAttributes) -> Result<Status, Self::Error> {
        let mut fs = self.fs();
        let path = norm(&path);
        if fs.nodes.contains_key(&path) || !matches!(fs.nodes.get(&parent(&path)), Some(Node::Dir { .. })) {
            return Err(StatusCode::Failure);
        }
        fs.dir(&path);
        Ok(ok(id))
    }

    async fn rmdir(&mut self, id: u32, path: String) -> Result<Status, Self::Error> {
        let mut fs = self.fs();
        let path = norm(&path);
        if !matches!(fs.nodes.get(&path), Some(Node::Dir { .. })) || !fs.children(&path).is_empty() {
            return Err(StatusCode::Failure);
        }
        fs.nodes.remove(&path);
        Ok(ok(id))
    }

    async fn realpath(&mut self, id: u32, path: String) -> Result<Name, Self::Error> {
        Ok(Name {
            id,
            files: vec![File::dummy(norm(&path))],
        })
    }

    async fn rename(&mut self, id: u32, old: String, new: String) -> Result<Status, Self::Error> {
        let mut fs = self.fs();
        let (old, new) = (norm(&old), norm(&new));
        if !fs.nodes.contains_key(&old) {
            return Err(StatusCode::NoSuchFile);
        }
        if fs.nodes.contains_key(&new) {
            return Err(StatusCode::Failure);
        }
        let prefix = child_prefix(&old);
        let moved: Vec<String> = fs
            .nodes
            .keys()
            .filter(|k| **k == old || k.starts_with(&prefix))
            .cloned()
            .collect();
        for key in moved {
            let node = fs.nodes.remove(&key).unwrap();
            fs.nodes.insert(format!("{new}{}", &key[old.len()..]), node);
        }
        Ok(ok(id))
    }

    async fn readlink(&mut self, id: u32, path: String) -> Result<Name, Self::Error> {
        match self.fs().nodes.get(&norm(&path)) {
            Some(Node::Link { target }) => Ok(Name {
                id,
                files: vec![File::dummy(target.clone())],
            }),
            _ => Err(StatusCode::Failure),
        }
    }
}

#[derive(Clone)]
struct SshServer {
    fs: SharedFs,
    channels: Arc<Mutex<HashMap<ChannelId, Channel<Msg>>>>,
}

impl server::Handler for SshServer {
    type Error = russh::Error;

    async fn auth_password(&mut self, user: &str, password: &str) -> Result<Auth, Self::Error> {
        Ok(if user == "gxs" && password == "secret" {
            Auth::Accept
        } else {
            Auth::reject()
        })
    }

    async fn channel_open_session(
        &mut self,
        channel: Channel<Msg>,
        reply: ChannelOpenHandle,
        _: &mut Session,
    ) -> Result<(), Self::Error> {
        self.channels.lock().unwrap().insert(channel.id(), channel);
        reply.accept().await;
        Ok(())
    }

    async fn subsystem_request(&mut self, id: ChannelId, name: &str, session: &mut Session) -> Result<(), Self::Error> {
        let channel = self.channels.lock().unwrap().remove(&id);
        match channel {
            Some(channel) if name == "sftp" => {
                session.channel_success(id)?;
                let handler = MemSftp {
                    fs: self.fs.clone(),
                    handles: HashMap::new(),
                    next: 0,
                };
                russh_sftp::server::run(channel.into_stream(), handler).await;
            }
            _ => session.channel_failure(id)?,
        }
        Ok(())
    }
}

struct Fixture {
    fs: SharedFs,
    client: SshClient,
    sftp: Sftp,
    _known: tempfile::TempDir,
}

async fn fixture(seed: impl FnOnce(&mut Fs)) -> Fixture {
    let mut fs = Fs::with_home();
    seed(&mut fs);
    let fs: SharedFs = Arc::new(Mutex::new(fs));
    let config = Arc::new(server::Config {
        keys: vec![PrivateKey::random(&mut rand::rng(), Algorithm::Ed25519).unwrap()],
        auth_rejection_time: Duration::ZERO,
        auth_rejection_time_initial: Some(Duration::ZERO),
        ..server::Config::default()
    });
    let handler = SshServer {
        fs: fs.clone(),
        channels: Arc::default(),
    };
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    tokio::spawn(async move {
        while let Ok((socket, _)) = listener.accept().await {
            let (config, handler) = (config.clone(), handler.clone());
            tokio::spawn(async move {
                if let Ok(session) = server::run_stream(config, socket, handler).await {
                    let _ = session.await;
                }
            });
        }
    });

    let dir = tempfile::tempdir().unwrap();
    let known = Arc::new(KnownHosts::open(dir.path().join("known_hosts.json")).await.unwrap());
    let client = ssh::connect(ConnectOptions {
        host: "127.0.0.1".into(),
        port,
        user: "gxs".into(),
        auth: SshAuth::Password(Zeroizing::new("secret".into())),
        policy: HostKeyPolicy::Tofu,
        known_hosts: known,
        prompter: None,
        connect_timeout: Duration::from_secs(5),
        keepalive_interval: None,
        via: ssh::Via::Direct,
        agent_forward: false,
    })
    .await
    .unwrap();
    let sftp = client.sftp().await.unwrap();
    Fixture {
        fs,
        client,
        sftp,
        _known: dir,
    }
}

fn pattern(len: usize) -> Vec<u8> {
    (0..len).map(|i| (i * 31 % 251) as u8).collect()
}

fn local_files(root: &Path) -> Vec<String> {
    let mut out = Vec::new();
    let mut pending = vec![root.to_path_buf()];
    while let Some(dir) = pending.pop() {
        for entry in std::fs::read_dir(dir).unwrap() {
            let path = entry.unwrap().path();
            out.push(path.strip_prefix(root).unwrap().to_string_lossy().replace('\\', "/"));
            if path.is_dir() {
                pending.push(path);
            }
        }
    }
    out.sort();
    out
}

#[tokio::test]
async fn session_is_cached_and_basic_operations_work() {
    let f = fixture(|fs| {
        fs.file("/home/gxs/a.txt", b"hello");
        fs.dir("/home/gxs/sub");
        fs.file("/home/gxs/sub/b.bin", b"bb");
        fs.link("/home/gxs/link", "/home/gxs/sub");
    })
    .await;
    let s = &f.sftp;
    assert_eq!(s.home().await.unwrap(), HOME);

    let mut list = s.list(HOME).await.unwrap();
    list.sort_by(|a, b| a.name.cmp(&b.name));
    let names: Vec<_> = list.iter().map(|e| e.name.as_str()).collect();
    assert_eq!(names, ["a.txt", "link", "sub"]);
    assert_eq!(list[0].kind, EntryKind::File);
    assert_eq!(list[0].size, 5);
    assert_eq!(list[0].perms, "-rw-r--r--");
    assert_eq!(list[0].path, "/home/gxs/a.txt");
    assert_eq!(list[1].kind, EntryKind::Symlink);
    assert_eq!(list[1].link_target.as_deref(), Some("/home/gxs/sub"));
    assert!(list[1].target_is_dir);
    assert_eq!(list[2].perms, "drwxr-xr-x");
    assert_eq!(list[2].mode, 0o755);

    s.mkdir("/home/gxs/new").await.unwrap();
    s.create_file("/home/gxs/new/empty").await.unwrap();
    assert!(
        s.create_file("/home/gxs/new/empty").await.is_err(),
        "create must not clobber"
    );
    assert_eq!(f.fs.lock().unwrap().data("/home/gxs/new/empty"), b"");

    s.rename("/home/gxs/a.txt", "/home/gxs/renamed.txt").await.unwrap();
    assert_eq!(s.stat("/home/gxs/renamed.txt").await.unwrap().name, "renamed.txt");
    assert!(matches!(
        s.stat("/home/gxs/a.txt").await.unwrap_err(),
        Error::NotFound(p) if p == "/home/gxs/a.txt"
    ));

    s.chmod("/home/gxs/renamed.txt", 0o600, false).await.unwrap();
    s.chmod("/home/gxs/sub", 0o700, true).await.unwrap();
    {
        let fs = f.fs.lock().unwrap();
        assert_eq!(fs.mode("/home/gxs/renamed.txt"), 0o600);
        assert_eq!(fs.mode("/home/gxs/sub"), 0o700);
        assert_eq!(fs.mode("/home/gxs/sub/b.bin"), 0o700);
    }
    assert!(s.chmod(HOME, 0o10000, false).await.is_err());

    // The cached session is reused rather than opening a second subsystem.
    let again = f.client.sftp().await.unwrap();
    assert_eq!(again.home().await.unwrap(), HOME);
    f.client.disconnect().await;
}

#[tokio::test]
async fn directory_upload_and_download_roundtrip() {
    let f = fixture(|_| {}).await;
    let tmp = tempfile::tempdir().unwrap();
    let up = tmp.path().join("up");
    std::fs::create_dir_all(up.join("deep")).unwrap();
    std::fs::create_dir_all(up.join("empty_dir")).unwrap();
    std::fs::write(up.join("x.txt"), b"x marks").unwrap();
    let big = pattern(700 * 1024);
    std::fs::write(up.join("deep").join("y.bin"), &big).unwrap();

    let mut last = None;
    let done = f
        .sftp
        .upload(
            &up,
            "/home/gxs/up",
            Existing::SkipIdentical,
            &CancellationToken::new(),
            |p| last = Some(p),
        )
        .await
        .unwrap();
    assert_eq!(done.files_total, 2);
    assert_eq!(done.files_done, 2);
    assert_eq!(done.bytes_done, done.bytes_total);
    assert_eq!(done.bytes_total, 7 + big.len() as u64);
    assert_eq!(last, Some(done));
    {
        let fs = f.fs.lock().unwrap();
        assert_eq!(fs.data("/home/gxs/up/x.txt"), b"x marks");
        assert_eq!(fs.data("/home/gxs/up/deep/y.bin"), big);
        assert!(matches!(fs.nodes.get("/home/gxs/up/empty_dir"), Some(Node::Dir { .. })));
    }

    // Uploading onto an existing tree overwrites files and reuses directories.
    std::fs::write(up.join("x.txt"), b"v2").unwrap();
    f.sftp
        .upload(
            &up,
            "/home/gxs/up",
            Existing::SkipIdentical,
            &CancellationToken::new(),
            |_| {},
        )
        .await
        .unwrap();
    assert_eq!(f.fs.lock().unwrap().data("/home/gxs/up/x.txt"), b"v2");

    let down = tmp.path().join("down");
    let done = f
        .sftp
        .download(
            "/home/gxs/up",
            &down,
            Existing::SkipIdentical,
            &CancellationToken::new(),
            |_| {},
        )
        .await
        .unwrap();
    assert_eq!(done.files_done, 2);
    assert_eq!(local_files(&down), ["deep", "deep/y.bin", "empty_dir", "x.txt"]);
    assert_eq!(std::fs::read(down.join("deep").join("y.bin")).unwrap(), big);
    assert_eq!(std::fs::read(down.join("x.txt")).unwrap(), b"v2");

    // A single file downloads to exactly the given path.
    let one = tmp.path().join("one.txt");
    f.sftp
        .download(
            "/home/gxs/up/x.txt",
            &one,
            Existing::SkipIdentical,
            &CancellationToken::new(),
            |_| {},
        )
        .await
        .unwrap();
    assert_eq!(std::fs::read(&one).unwrap(), b"v2");
    f.client.disconnect().await;
}

#[tokio::test]
async fn hostile_remote_names_stay_inside_the_target() {
    let f = fixture(|fs| {
        fs.dir("/home/gxs/evil");
        for name in ["CON", "a:b", "...", "trail.", "nul.txt"] {
            fs.file(&format!("/home/gxs/evil/{name}"), name.as_bytes());
        }
        fs.dir("/home/gxs/evil/..."); // a directory literally named "..." is legal on POSIX
        fs.file("/home/gxs/evil/.../inner", b"in");
        fs.link("/home/gxs/evil/loop", "/home/gxs/evil");
    })
    .await;
    let tmp = tempfile::tempdir().unwrap();
    let target = tmp.path().join("mirror");
    f.sftp
        .download(
            "/home/gxs/evil",
            &target,
            Existing::SkipIdentical,
            &CancellationToken::new(),
            |_| {},
        )
        .await
        .unwrap();
    // "..." the file is shadowed by "..." the directory in the fake fs, so only the dir exists.
    assert_eq!(
        local_files(&target),
        ["_CON", "___", "___/inner", "_nul.txt", "a_b", "trail_"]
    );
    assert_eq!(local_files(tmp.path()).len(), 7, "nothing written outside the target");
    f.client.disconnect().await;
}

#[tokio::test]
async fn cancelled_transfers_resume_from_their_part_files() {
    let big = pattern(8 * 1024 * 1024);
    let seed = big.clone();
    let f = fixture(move |fs| {
        fs.file("/home/gxs/big", &seed);
        fs.nodes.insert(
            "/home/gxs/up.bin".into(),
            Node::File {
                data: b"old".to_vec(),
                mode: 0o755,
                mtime: OLD,
            },
        );
        fs.slow = true;
    })
    .await;
    let tmp = tempfile::tempdir().unwrap();
    let slow = |on: bool| f.fs.lock().unwrap().slow = on;
    // Cancel only after at least 1 MiB is on disk, so the part file always exists and is
    // never complete when the token fires. An immediate "any progress" cancel races the
    // transfer-completion edge under heavy parallel load (a completed download has no part).
    let cancel_once_started = || {
        let cancel = CancellationToken::new();
        let token = cancel.clone();
        (cancel, move |p: Progress| {
            if p.bytes_done >= 1024 * 1024 {
                token.cancel();
            }
        })
    };

    // Download: the part file survives cancellation and the next attempt continues it.
    let target = tmp.path().join("big");
    let part = tmp.path().join("big.gxspart");
    let (cancel, sink) = cancel_once_started();
    let err = f
        .sftp
        .download("/home/gxs/big", &target, Existing::SkipIdentical, &cancel, sink)
        .await
        .unwrap_err();
    assert!(matches!(err, Error::Cancelled), "{err}");
    assert!(!target.exists());
    // One in-flight chunk can still land on the part file just after the cancelled call
    // returns; wait until it stops growing before reading the size to resume from.
    let mut kept = std::fs::metadata(&part).unwrap().len();
    for _ in 0..50 {
        tokio::time::sleep(Duration::from_millis(20)).await;
        let now = std::fs::metadata(&part).unwrap().len();
        if now == kept {
            break;
        }
        kept = now;
    }
    assert!(kept > 0 && kept < big.len() as u64, "{kept}");

    slow(false);
    let done = f
        .sftp
        .download(
            "/home/gxs/big",
            &target,
            Existing::SkipIdentical,
            &CancellationToken::new(),
            |_| {},
        )
        .await
        .unwrap();
    assert_eq!(done.bytes_resumed, kept);
    assert_eq!(done.bytes_done, big.len() as u64);
    assert_eq!(std::fs::read(&target).unwrap(), big);
    assert!(!part.exists());
    let modified = std::fs::metadata(&target).unwrap().modified().unwrap();
    assert_eq!(modified, UNIX_EPOCH + Duration::from_secs(OLD.into()));

    // An identical local file (size and mtime) is not fetched again.
    let again = f
        .sftp
        .download(
            "/home/gxs/big",
            &target,
            Existing::SkipIdentical,
            &CancellationToken::new(),
            |_| {},
        )
        .await
        .unwrap();
    assert_eq!(again.bytes_resumed, big.len() as u64);

    // A part file that does not match the remote is discarded.
    let fresh = tmp.path().join("fresh");
    std::fs::write(tmp.path().join("fresh.gxspart"), vec![0xAA; 100_000]).unwrap();
    let done = f
        .sftp
        .download(
            "/home/gxs/big",
            &fresh,
            Existing::SkipIdentical,
            &CancellationToken::new(),
            |_| {},
        )
        .await
        .unwrap();
    assert_eq!(done.bytes_resumed, 0);
    assert_eq!(std::fs::read(&fresh).unwrap(), big);

    // Upload: the old remote file stays intact until the resumed part is renamed over it.
    let local = tmp.path().join("up.bin");
    std::fs::write(&local, &big).unwrap();
    slow(true);
    let (cancel, sink) = cancel_once_started();
    let err = f
        .sftp
        .upload(&local, "/home/gxs/up.bin", Existing::SkipIdentical, &cancel, sink)
        .await
        .unwrap_err();
    assert!(matches!(err, Error::Cancelled), "{err}");
    assert_eq!(f.fs.lock().unwrap().data("/home/gxs/up.bin"), b"old");

    slow(false);
    let done = f
        .sftp
        .upload(
            &local,
            "/home/gxs/up.bin",
            Existing::SkipIdentical,
            &CancellationToken::new(),
            |_| {},
        )
        .await
        .unwrap();
    assert!(done.bytes_resumed > 0, "{done:?}");
    assert_eq!(done.bytes_done, big.len() as u64);
    let local_secs = std::fs::metadata(&local)
        .unwrap()
        .modified()
        .unwrap()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs();
    {
        let fs = f.fs.lock().unwrap();
        assert_eq!(fs.data("/home/gxs/up.bin"), big);
        assert_eq!(fs.mode("/home/gxs/up.bin"), 0o755, "permission bits carried over");
        assert_eq!(u64::from(fs.mtime("/home/gxs/up.bin")), local_secs);
        assert!(!fs.nodes.contains_key("/home/gxs/up.bin.gxspart"));
    }
    let again = f
        .sftp
        .upload(
            &local,
            "/home/gxs/up.bin",
            Existing::SkipIdentical,
            &CancellationToken::new(),
            |_| {},
        )
        .await
        .unwrap();
    assert_eq!(again.bytes_resumed, big.len() as u64);
    let forced = f
        .sftp
        .upload(
            &local,
            "/home/gxs/up.bin",
            Existing::Replace,
            &CancellationToken::new(),
            |_| {},
        )
        .await
        .unwrap();
    assert_eq!(forced.bytes_resumed, 0, "Replace never skips");

    // A token cancelled up front never touches the filesystem.
    let cancel = CancellationToken::new();
    cancel.cancel();
    let err = f
        .sftp
        .download(
            "/home/gxs/big",
            &tmp.path().join("never"),
            Existing::SkipIdentical,
            &cancel,
            |_| {},
        )
        .await
        .unwrap_err();
    assert!(matches!(err, Error::Cancelled));
    assert_eq!(local_files(tmp.path()), ["big", "fresh", "up.bin"]);
    f.client.disconnect().await;
}

#[tokio::test]
async fn recursive_remove_does_not_follow_symlinks() {
    let f = fixture(|fs| {
        fs.dir("/home/gxs/keep");
        fs.file("/home/gxs/keep/k.txt", b"keep me");
        fs.dir("/home/gxs/doomed");
        fs.dir("/home/gxs/doomed/a");
        fs.dir("/home/gxs/doomed/a/b");
        fs.file("/home/gxs/doomed/a/b/c.txt", b"c");
        fs.file("/home/gxs/doomed/top.txt", b"t");
        fs.link("/home/gxs/doomed/lnk", "/home/gxs/keep");
        fs.link("/home/gxs/solo-link", "/home/gxs/keep");
    })
    .await;
    f.sftp.remove("/home/gxs/doomed").await.unwrap();
    f.sftp.remove("/home/gxs/solo-link").await.unwrap();
    {
        let fs = f.fs.lock().unwrap();
        assert!(!fs.nodes.keys().any(|k| k.starts_with("/home/gxs/doomed")));
        assert!(!fs.nodes.contains_key("/home/gxs/solo-link"));
        assert_eq!(fs.data("/home/gxs/keep/k.txt"), b"keep me");
    }
    assert!(matches!(f.sftp.remove("/").await.unwrap_err(), Error::Invalid(_)));
    assert!(matches!(f.sftp.remove("/nope").await.unwrap_err(), Error::NotFound(_)));
    f.client.disconnect().await;
}
