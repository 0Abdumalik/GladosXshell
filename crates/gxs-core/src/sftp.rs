//! File operations and transfers over one shared SFTP session per connection.

use std::io::SeekFrom;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use russh_sftp::client::SftpSession;
use russh_sftp::client::error::Error as SftpError;
use russh_sftp::protocol::{FileAttributes, FileType, OpenFlags, StatusCode};
use serde::Serialize;
use tokio::io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt};
use tokio::sync::Semaphore;
use tokio::task::JoinSet;
use tokio_util::sync::CancellationToken;

use crate::error::{Error, Result};
use crate::local_path::sanitize_name;

pub const CHUNK: usize = 256 * 1024;
pub const MAX_CONCURRENT_TRANSFERS: usize = 3;
const PROGRESS_EVERY: Duration = Duration::from_millis(100);
pub const PART_SUFFIX: &str = ".gxspart";
/// Smaller uploads are written in place; larger ones go through a resumable remote part file.
pub const RESUME_MIN: u64 = 1024 * 1024;
/// How much of a remote part file's tail must match the local file before an upload resumes.
const VERIFY_TAIL: u64 = 64 * 1024;

/// What a transfer does with a target file that already exists.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Existing {
    Replace,
    /// Skip targets whose size and mtime match the source. mtime has one-second resolution, so
    /// this is wrong for files that may change twice within a second (editor saves).
    SkipIdentical,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum EntryKind {
    Dir,
    File,
    Symlink,
    Other,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub name: String,
    pub path: String,
    pub kind: EntryKind,
    pub size: u64,
    /// Permission bits only (`& 0o7777`).
    pub mode: u32,
    /// `ls -l` style, e.g. `drwxr-xr-x`.
    pub perms: String,
    pub uid: Option<u32>,
    pub gid: Option<u32>,
    pub owner: Option<String>,
    pub group: Option<String>,
    pub mtime: Option<u64>,
    pub link_target: Option<String>,
    pub target_is_dir: bool,
}

impl Entry {
    fn new(name: String, path: String, attrs: &FileAttributes) -> Self {
        let raw = attrs.permissions.unwrap_or(0);
        let kind = match attrs.file_type() {
            FileType::Dir => EntryKind::Dir,
            FileType::File => EntryKind::File,
            FileType::Symlink => EntryKind::Symlink,
            FileType::Other => EntryKind::Other,
        };
        Entry {
            name,
            path,
            kind,
            size: attrs.size.unwrap_or(0),
            mode: raw & 0o7777,
            perms: mode_string(raw),
            uid: attrs.uid,
            gid: attrs.gid,
            owner: attrs.user.clone(),
            group: attrs.group.clone(),
            mtime: attrs.mtime.map(u64::from),
            link_target: None,
            target_is_dir: kind == EntryKind::Dir,
        }
    }
}

/// Renders a full `st_mode` the way `ls -l` does, including setuid/setgid/sticky.
pub fn mode_string(mode: u32) -> String {
    let kind = match mode & 0o170000 {
        0o040000 => 'd',
        0o120000 => 'l',
        0o020000 => 'c',
        0o060000 => 'b',
        0o010000 => 'p',
        0o140000 => 's',
        _ => '-',
    };
    let mut s = String::with_capacity(10);
    s.push(kind);
    let special = [(0o4000, 's'), (0o2000, 's'), (0o1000, 't')];
    for (i, shift) in [6u32, 3, 0].into_iter().enumerate() {
        let bits = (mode >> shift) & 0o7;
        s.push(if bits & 4 != 0 { 'r' } else { '-' });
        s.push(if bits & 2 != 0 { 'w' } else { '-' });
        let (flag, letter) = special[i];
        let exec = bits & 1 != 0;
        s.push(match (mode & flag != 0, exec) {
            (true, true) => letter,
            (true, false) => letter.to_ascii_uppercase(),
            (false, true) => 'x',
            (false, false) => '-',
        });
    }
    s
}

/// Joins a remote directory and a single name with exactly one `/`.
pub fn join_remote(dir: &str, name: &str) -> String {
    if dir.ends_with('/') {
        format!("{dir}{name}")
    } else {
        format!("{dir}/{name}")
    }
}

/// A name the server returned that can be used as one path component.
fn usable_name(name: &str) -> bool {
    !name.is_empty() && name != "." && name != ".." && !name.contains('/')
}

pub fn base_name(path: &str) -> String {
    let trimmed = path.trim_end_matches('/');
    match trimmed.rsplit_once('/') {
        Some((_, name)) if !name.is_empty() => name.to_owned(),
        _ if trimmed.is_empty() => "/".to_owned(),
        _ => trimmed.to_owned(),
    }
}

trait At<T> {
    fn at(self, path: &str) -> Result<T>;
}

impl<T> At<T> for std::result::Result<T, SftpError> {
    fn at(self, path: &str) -> Result<T> {
        self.map_err(|e| match &e {
            SftpError::Status(s) if s.status_code == StatusCode::NoSuchFile => Error::NotFound(path.to_owned()),
            SftpError::Status(s) if s.status_code == StatusCode::PermissionDenied => {
                Error::PermissionDenied(path.to_owned())
            }
            _ => Error::Sftp(e),
        })
    }
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    pub bytes_done: u64,
    pub bytes_total: u64,
    pub files_done: u32,
    pub files_total: u32,
    /// Part of `bytes_done` that was not sent again: resumed partials and skipped identical files.
    pub bytes_resumed: u64,
}

struct Reporter<F> {
    progress: Progress,
    last: Option<Instant>,
    sink: F,
}

impl<F: FnMut(Progress)> Reporter<F> {
    fn new(sink: F) -> Self {
        Reporter {
            progress: Progress::default(),
            last: None,
            sink,
        }
    }

    fn emit(&mut self, force: bool) {
        if force || self.last.is_none_or(|t| t.elapsed() >= PROGRESS_EVERY) {
            (self.sink)(self.progress);
            self.last = Some(Instant::now());
        }
    }

    fn bytes(&mut self, n: usize) {
        self.progress.bytes_done += n as u64;
        self.emit(false);
    }

    fn resumed(&mut self, n: u64) {
        self.progress.bytes_done += n;
        self.progress.bytes_resumed += n;
        self.emit(false);
    }

    fn file_done(&mut self) {
        self.progress.files_done += 1;
        self.emit(false);
    }
}

enum Step<L, R> {
    Dir(L),
    /// `size` and `mtime` describe the source file.
    File {
        from: R,
        to: L,
        size: u64,
        mtime: Option<u32>,
    },
}

fn unix_secs(t: SystemTime) -> Option<u32> {
    t.duration_since(UNIX_EPOCH)
        .ok()
        .and_then(|d| u32::try_from(d.as_secs()).ok())
}

fn local_mtime(meta: &std::fs::Metadata) -> Option<u32> {
    meta.modified().ok().and_then(unix_secs)
}

/// A local file that already matches the source by size and mtime.
async fn same_local(path: &Path, size: u64, mtime: Option<u32>) -> bool {
    let Some(mtime) = mtime else { return false };
    tokio::fs::metadata(path)
        .await
        .is_ok_and(|m| m.is_file() && m.len() == size && local_mtime(&m) == Some(mtime))
}

async fn read_local_at(path: &Path, at: u64, len: usize) -> std::io::Result<Vec<u8>> {
    let mut file = tokio::fs::File::open(path).await?;
    file.seek(SeekFrom::Start(at)).await?;
    let mut buf = vec![0u8; len];
    file.read_exact(&mut buf).await?;
    Ok(buf)
}

fn part_path(path: &Path) -> PathBuf {
    let mut name = path.file_name().unwrap_or_default().to_os_string();
    name.push(PART_SUFFIX);
    path.with_file_name(name)
}

async fn cancellable<T>(cancel: &CancellationToken, fut: impl Future<Output = Result<T>>) -> Result<T> {
    tokio::select! {
        biased;
        _ = cancel.cancelled() => Err(Error::Cancelled),
        r = fut => r,
    }
}

fn too_large(path: &str, limit: usize) -> Error {
    let path = crate::i18n::ltr(path);
    Error::invalid(crate::tr!(
        "{path} 超过 {limit} 字节的上限",
        "{path} is larger than the limit of {limit} bytes",
        "{path} {limit} بايتلىق چەكتىن ئېشىپ كەتتى"
    ))
}

#[derive(Clone)]
pub struct Sftp {
    session: Arc<SftpSession>,
    slots: Arc<Semaphore>,
}

impl Sftp {
    pub(crate) fn new(session: SftpSession) -> Self {
        Sftp {
            session: Arc::new(session),
            slots: Arc::new(Semaphore::new(MAX_CONCURRENT_TRANSFERS)),
        }
    }

    pub async fn home(&self) -> Result<String> {
        self.realpath(".").await
    }

    pub async fn realpath(&self, path: &str) -> Result<String> {
        self.session.canonicalize(path).await.at(path)
    }

    /// Follows symlinks.
    pub async fn stat(&self, path: &str) -> Result<Entry> {
        let attrs = self.session.metadata(path).await.at(path)?;
        Ok(Entry::new(base_name(path), path.to_owned(), &attrs))
    }

    pub async fn list(&self, dir: &str) -> Result<Vec<Entry>> {
        let mut entries: Vec<Entry> = self
            .session
            .read_dir(dir)
            .await
            .at(dir)?
            .filter(|e| usable_name(&e.file_name()))
            .map(|e| {
                let name = e.file_name();
                let path = join_remote(dir, &name);
                Entry::new(name, path, &e.metadata())
            })
            .collect();

        // Resolve symlinks concurrently: the requests pipeline over the one SFTP channel.
        let mut links = JoinSet::new();
        for (i, entry) in entries.iter().enumerate() {
            if entry.kind == EntryKind::Symlink {
                let session = self.session.clone();
                let path = entry.path.clone();
                links.spawn(async move {
                    let target = session.read_link(path.as_str()).await.ok();
                    let is_dir = session.metadata(path).await.is_ok_and(|m| m.is_dir());
                    (i, target, is_dir)
                });
            }
        }
        while let Some(joined) = links.join_next().await {
            if let Ok((i, target, is_dir)) = joined {
                entries[i].link_target = target;
                entries[i].target_is_dir = is_dir;
            }
        }
        Ok(entries)
    }

    pub async fn mkdir(&self, path: &str) -> Result<()> {
        self.session.create_dir(path).await.at(path)
    }

    /// Creates an empty file; fails if something already exists at `path`.
    pub async fn create_file(&self, path: &str) -> Result<()> {
        let file = self
            .session
            .open_with_flags(path, OpenFlags::CREATE | OpenFlags::EXCLUDE | OpenFlags::WRITE)
            .await
            .at(path)?;
        file.close().await?;
        Ok(())
    }

    pub async fn rename(&self, from: &str, to: &str) -> Result<()> {
        self.session.rename(from, to).await.at(from)
    }

    /// Deletes a file, a symlink (never its target) or a whole directory tree.
    pub async fn remove(&self, path: &str) -> Result<()> {
        if path.trim_end_matches('/').is_empty() {
            return Err(Error::invalid("refusing to delete the root directory"));
        }
        let attrs = self.session.symlink_metadata(path).await.at(path)?;
        if !attrs.is_dir() {
            return self.session.remove_file(path).await.at(path);
        }
        // Depth-first without recursion: children first, then each directory bottom-up.
        let mut dirs = vec![path.to_owned()];
        let mut pending = vec![path.to_owned()];
        while let Some(dir) = pending.pop() {
            for entry in self.session.read_dir(dir.as_str()).await.at(&dir)? {
                let name = entry.file_name();
                if !usable_name(&name) {
                    continue;
                }
                let child = join_remote(&dir, &name);
                if entry.file_type() == FileType::Dir {
                    dirs.push(child.clone());
                    pending.push(child);
                } else {
                    self.session.remove_file(child.as_str()).await.at(&child)?;
                }
            }
        }
        // `dirs` is in discovery order, so every parent precedes its children.
        for dir in dirs.iter().rev() {
            self.session.remove_dir(dir.as_str()).await.at(dir)?;
        }
        Ok(())
    }

    /// Sets permission bits. Recursion never follows symlinks.
    pub async fn chmod(&self, path: &str, mode: u32, recursive: bool) -> Result<()> {
        if mode > 0o7777 {
            return Err(Error::invalid(format!("invalid mode {mode:o}")));
        }
        let mut pending = vec![path.to_owned()];
        let mut first = true;
        while let Some(current) = pending.pop() {
            let attrs = FileAttributes {
                permissions: Some(mode),
                ..FileAttributes::empty()
            };
            self.session.set_metadata(current.as_str(), attrs).await.at(&current)?;
            let descend = recursive
                && (if first {
                    self.session
                        .symlink_metadata(current.as_str())
                        .await
                        .at(&current)?
                        .is_dir()
                } else {
                    true
                });
            first = false;
            if !descend {
                continue;
            }
            for entry in self.session.read_dir(current.as_str()).await.at(&current)? {
                let name = entry.file_name();
                if !usable_name(&name) {
                    continue;
                }
                let child = join_remote(&current, &name);
                match entry.file_type() {
                    FileType::Dir => pending.push(child),
                    FileType::Symlink => {}
                    _ => {
                        let attrs = FileAttributes {
                            permissions: Some(mode),
                            ..FileAttributes::empty()
                        };
                        self.session.set_metadata(child.as_str(), attrs).await.at(&child)?;
                    }
                }
            }
        }
        Ok(())
    }

    /// Downloads a remote file or directory tree to exactly `local`. Remote names below the top
    /// level are sanitised one component at a time, so the server cannot write outside `local`.
    pub async fn download(
        &self,
        remote: &str,
        local: &Path,
        existing: Existing,
        cancel: &CancellationToken,
        progress: impl FnMut(Progress),
    ) -> Result<Progress> {
        let _slot = cancellable(cancel, async { Ok(self.slots.acquire().await.ok()) }).await?;
        let mut rep = Reporter::new(progress);

        let steps = cancellable(cancel, self.plan_download(remote, local, &mut rep.progress)).await?;
        rep.emit(true);
        for step in steps {
            match step {
                Step::Dir(dir) => tokio::fs::create_dir_all(&dir).await?,
                Step::File { from, to, size, mtime } => {
                    if existing == Existing::SkipIdentical && same_local(&to, size, mtime).await {
                        rep.resumed(size);
                    } else {
                        // The part file is kept on failure so the next attempt can resume it.
                        let part = part_path(&to);
                        cancellable(cancel, self.download_file(&from, &part, size, mtime, &mut rep)).await?;
                        tokio::fs::rename(&part, &to).await?;
                    }
                    rep.file_done();
                }
            }
        }
        rep.emit(true);
        Ok(rep.progress)
    }

    /// Whether the last bytes before `len` are the same in the local and the remote file.
    async fn same_prefix(&self, local: &Path, remote: &str, len: u64) -> bool {
        let tail = len.min(VERIFY_TAIL);
        let at = len - tail;
        let Ok(mine) = read_local_at(local, at, tail as usize).await else {
            return false;
        };
        let Ok(mut file) = self.session.open(remote).await else {
            return false;
        };
        let mut theirs = vec![0u8; tail as usize];
        let read = file.seek(SeekFrom::Start(at)).await.is_ok() && file.read_exact(&mut theirs).await.is_ok();
        let _ = file.close().await;
        read && theirs == mine
    }

    async fn plan_download(
        &self,
        remote: &str,
        local: &Path,
        totals: &mut Progress,
    ) -> Result<Vec<Step<PathBuf, String>>> {
        let top = self.session.metadata(remote).await.at(remote)?;
        let mut steps = Vec::new();
        if !top.is_dir() {
            totals.bytes_total += top.len();
            totals.files_total += 1;
            steps.push(Step::File {
                from: remote.to_owned(),
                to: local.to_path_buf(),
                size: top.len(),
                mtime: top.mtime,
            });
            return Ok(steps);
        }
        steps.push(Step::Dir(local.to_path_buf()));
        let mut pending = vec![(remote.to_owned(), local.to_path_buf())];
        while let Some((dir, local_dir)) = pending.pop() {
            for entry in self.session.read_dir(dir.as_str()).await.at(&dir)? {
                let name = entry.file_name();
                if !usable_name(&name) {
                    continue;
                }
                let from = join_remote(&dir, &name);
                let to = local_dir.join(sanitize_name(&name));
                let attrs = match entry.file_type() {
                    // Symlinked files are fetched; symlinked directories are skipped (cycles).
                    FileType::Symlink => match self.session.metadata(from.as_str()).await {
                        Ok(target) if !target.is_dir() => target,
                        _ => continue,
                    },
                    _ => entry.metadata(),
                };
                match attrs.file_type() {
                    FileType::Dir => {
                        steps.push(Step::Dir(to.clone()));
                        pending.push((from, to));
                    }
                    FileType::File => {
                        totals.bytes_total += attrs.len();
                        totals.files_total += 1;
                        steps.push(Step::File {
                            from,
                            to,
                            size: attrs.len(),
                            mtime: attrs.mtime,
                        });
                    }
                    _ => {}
                }
            }
        }
        Ok(steps)
    }

    async fn download_file<F: FnMut(Progress)>(
        &self,
        remote: &str,
        part: &Path,
        size: u64,
        mtime: Option<u32>,
        rep: &mut Reporter<F>,
    ) -> Result<()> {
        let have = tokio::fs::metadata(part).await.map_or(0, |m| m.len());
        let resume = have > 0 && have <= size && self.same_prefix(part, remote, have).await;
        let mut src = self.session.open(remote).await.at(remote)?;
        let mut dst = if resume {
            let mut file = tokio::fs::OpenOptions::new().write(true).open(part).await?;
            file.seek(SeekFrom::Start(have)).await?;
            src.seek(SeekFrom::Start(have)).await?;
            rep.resumed(have);
            file
        } else {
            tokio::fs::File::create(part).await?
        };
        let mut buf = vec![0u8; CHUNK];
        loop {
            let n = src.read(&mut buf).await?;
            if n == 0 {
                break;
            }
            dst.write_all(&buf[..n]).await?;
            rep.bytes(n);
        }
        dst.flush().await?;
        let _ = src.close().await;
        if let Some(secs) = mtime {
            let file = dst.into_std().await;
            let _ = file.set_modified(UNIX_EPOCH + Duration::from_secs(secs.into()));
        }
        Ok(())
    }

    /// Uploads a local file or directory tree to exactly `remote`. Existing remote files are
    /// overwritten and identical ones (size and mtime) skipped. Small files that fail midway are
    /// deleted; large ones leave a part file that the next upload resumes.
    pub async fn upload(
        &self,
        local: &Path,
        remote: &str,
        existing: Existing,
        cancel: &CancellationToken,
        progress: impl FnMut(Progress),
    ) -> Result<Progress> {
        let _slot = cancellable(cancel, async { Ok(self.slots.acquire().await.ok()) }).await?;
        let mut rep = Reporter::new(progress);

        let steps = cancellable(cancel, plan_upload(local, remote, &mut rep.progress)).await?;
        rep.emit(true);
        for step in steps {
            match step {
                Step::Dir(dir) => {
                    let exists = self.session.metadata(dir.as_str()).await.is_ok_and(|m| m.is_dir());
                    if !exists {
                        self.session.create_dir(dir.as_str()).await.at(&dir)?;
                    }
                }
                Step::File { from, to, size, mtime } => {
                    if existing == Existing::SkipIdentical && self.same_remote(&to, size, mtime).await {
                        rep.resumed(size);
                        rep.file_done();
                        continue;
                    }
                    // Writing through a symlink keeps the link; a rename would replace it.
                    let direct = size < RESUME_MIN
                        || self
                            .session
                            .symlink_metadata(to.as_str())
                            .await
                            .is_ok_and(|m| m.is_symlink());
                    let result = if direct {
                        cancellable(cancel, self.upload_direct(&from, &to, &mut rep)).await
                    } else {
                        cancellable(cancel, self.upload_resumable(&from, &to, size, &mut rep)).await
                    };
                    if let Err(e) = result {
                        if direct {
                            let _ = self.session.remove_file(to.as_str()).await;
                        }
                        return Err(e);
                    }
                    if let Some(secs) = mtime {
                        let attrs = FileAttributes {
                            atime: Some(secs),
                            mtime: Some(secs),
                            ..FileAttributes::empty()
                        };
                        let _ = self.session.set_metadata(to.as_str(), attrs).await;
                    }
                    rep.file_done();
                }
            }
        }
        rep.emit(true);
        Ok(rep.progress)
    }

    /// A remote regular file that already matches the source by size and mtime.
    async fn same_remote(&self, path: &str, size: u64, mtime: Option<u32>) -> bool {
        let Some(mtime) = mtime else { return false };
        self.session
            .symlink_metadata(path)
            .await
            .is_ok_and(|m| m.file_type() == FileType::File && m.len() == size && m.mtime == Some(mtime))
    }

    async fn upload_direct<F: FnMut(Progress)>(&self, local: &Path, remote: &str, rep: &mut Reporter<F>) -> Result<()> {
        let mut src = tokio::fs::File::open(local).await?;
        let mut dst = self.session.create(remote).await.at(remote)?;
        copy_up(&mut src, &mut dst, rep).await?;
        dst.close().await?;
        Ok(())
    }

    /// Writes to `remote` + [`PART_SUFFIX`], continuing a verified earlier part, then renames it
    /// into place. The part survives failures and cancellation.
    async fn upload_resumable<F: FnMut(Progress)>(
        &self,
        local: &Path,
        remote: &str,
        size: u64,
        rep: &mut Reporter<F>,
    ) -> Result<()> {
        let part = format!("{remote}{PART_SUFFIX}");
        let have = match self.session.symlink_metadata(part.as_str()).await {
            Ok(m) if m.file_type() == FileType::File => m.len(),
            _ => 0,
        };
        let resume = have > 0 && have <= size && self.same_prefix(local, &part, have).await;
        let mut src = tokio::fs::File::open(local).await?;
        let mut dst = if resume {
            let mut file = self
                .session
                .open_with_flags(part.as_str(), OpenFlags::WRITE)
                .await
                .at(&part)?;
            file.seek(SeekFrom::Start(have)).await?;
            src.seek(SeekFrom::Start(have)).await?;
            rep.resumed(have);
            file
        } else {
            self.session.create(part.as_str()).await.at(&part)?
        };
        copy_up(&mut src, &mut dst, rep).await?;
        dst.close().await?;

        // SFTP v3 rename refuses an existing target. Keep the old file's permission bits.
        if let Ok(old) = self.session.symlink_metadata(remote).await {
            if let Some(mode) = old.permissions.filter(|_| old.file_type() == FileType::File) {
                let attrs = FileAttributes {
                    permissions: Some(mode & 0o7777),
                    ..FileAttributes::empty()
                };
                let _ = self.session.set_metadata(part.as_str(), attrs).await;
            }
            self.session.remove_file(remote).await.at(remote)?;
        }
        self.session.rename(part.as_str(), remote).await.at(remote)
    }

    /// Reads a whole file into memory; fails with `Invalid` when it is larger than `limit`.
    pub async fn read_all(&self, path: &str, limit: usize) -> Result<Vec<u8>> {
        let attrs = self.session.metadata(path).await.at(path)?;
        if attrs.is_dir() {
            let path = crate::i18n::ltr(path);
            return Err(Error::invalid(crate::tr!(
                "{path} 是文件夹",
                "{path} is a folder",
                "{path} بىر قىسقۇچ"
            )));
        }
        if attrs.len() > limit as u64 {
            return Err(too_large(path, limit));
        }
        let mut file = self.session.open(path).await.at(path)?;
        let mut data = Vec::new();
        let mut buf = vec![0u8; CHUNK];
        loop {
            let n = file.read(&mut buf).await?;
            if n == 0 {
                break;
            }
            // The file may have grown since the stat.
            if data.len() + n > limit {
                let _ = file.close().await;
                return Err(too_large(path, limit));
            }
            data.extend_from_slice(&buf[..n]);
        }
        let _ = file.close().await;
        Ok(data)
    }

    /// Creates or truncates `path` and writes `data` to it.
    pub async fn write_all(&self, path: &str, data: &[u8]) -> Result<()> {
        let mut file = self.session.create(path).await.at(path)?;
        file.write_all(data).await?;
        file.close().await?;
        Ok(())
    }
}

async fn copy_up<F: FnMut(Progress)>(
    src: &mut tokio::fs::File,
    dst: &mut russh_sftp::client::fs::File,
    rep: &mut Reporter<F>,
) -> Result<()> {
    let mut buf = vec![0u8; CHUNK];
    loop {
        let n = src.read(&mut buf).await?;
        if n == 0 {
            return Ok(());
        }
        dst.write_all(&buf[..n]).await?;
        rep.bytes(n);
    }
}

async fn plan_upload(local: &Path, remote: &str, totals: &mut Progress) -> Result<Vec<Step<String, PathBuf>>> {
    let top = tokio::fs::metadata(local).await?;
    let mut steps = Vec::new();
    if !top.is_dir() {
        totals.bytes_total += top.len();
        totals.files_total += 1;
        steps.push(Step::File {
            from: local.to_path_buf(),
            to: remote.to_owned(),
            size: top.len(),
            mtime: local_mtime(&top),
        });
        return Ok(steps);
    }
    steps.push(Step::Dir(remote.to_owned()));
    let mut pending = vec![(local.to_path_buf(), remote.to_owned())];
    while let Some((dir, remote_dir)) = pending.pop() {
        let mut read = tokio::fs::read_dir(&dir).await?;
        while let Some(entry) = read.next_entry().await? {
            let name = entry.file_name().to_string_lossy().into_owned();
            let from = entry.path();
            let to = join_remote(&remote_dir, &name);
            let mut meta = tokio::fs::symlink_metadata(&from).await?;
            if meta.file_type().is_symlink() {
                match tokio::fs::metadata(&from).await {
                    Ok(target) if target.is_file() => meta = target,
                    _ => continue,
                }
            }
            if meta.is_dir() {
                steps.push(Step::Dir(to.clone()));
                pending.push((from, to));
            } else if meta.is_file() {
                totals.bytes_total += meta.len();
                totals.files_total += 1;
                steps.push(Step::File {
                    from,
                    to,
                    size: meta.len(),
                    mtime: local_mtime(&meta),
                });
            }
        }
    }
    Ok(steps)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mode_strings_match_ls() {
        assert_eq!(mode_string(0o040755), "drwxr-xr-x");
        assert_eq!(mode_string(0o100644), "-rw-r--r--");
        assert_eq!(mode_string(0o120777), "lrwxrwxrwx");
        assert_eq!(mode_string(0o104755), "-rwsr-xr-x");
        assert_eq!(mode_string(0o102644), "-rw-r-Sr--");
        assert_eq!(mode_string(0o041777), "drwxrwxrwt");
        assert_eq!(mode_string(0o041776), "drwxrwxrwT");
        assert_eq!(mode_string(0o020620), "crw--w----");
    }

    #[test]
    fn remote_paths_join_and_split() {
        assert_eq!(join_remote("/", "etc"), "/etc");
        assert_eq!(join_remote("/etc", "hosts"), "/etc/hosts");
        assert_eq!(join_remote("/etc/", "hosts"), "/etc/hosts");
        assert_eq!(base_name("/etc/hosts"), "hosts");
        assert_eq!(base_name("/etc/"), "etc");
        assert_eq!(base_name("/"), "/");
        assert_eq!(base_name("rel"), "rel");
    }

    #[test]
    fn unusable_names_are_filtered() {
        for bad in ["", ".", "..", "a/b", "../x"] {
            assert!(!usable_name(bad), "{bad:?}");
        }
        assert!(usable_name(".bashrc"));
        assert!(usable_name("..."));
    }

    #[test]
    fn part_file_sits_next_to_target() {
        let p = part_path(Path::new(r"C:\dl\a.tar.gz"));
        assert_eq!(p, Path::new(r"C:\dl\a.tar.gz.gxspart"));
    }

    #[test]
    fn progress_is_throttled_but_forced_emits_always_land() {
        let mut seen = Vec::new();
        let mut rep = Reporter::new(|p| seen.push(p));
        rep.progress.bytes_total = 10;
        rep.emit(true);
        for _ in 0..10 {
            rep.bytes(1);
        }
        rep.emit(true);
        assert!(seen.len() <= 4, "{}", seen.len());
        assert_eq!(seen.last().unwrap().bytes_done, 10);
    }
}
