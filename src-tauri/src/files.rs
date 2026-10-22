//! Remote file browsing, transfers, and edit/preview through a local mirror. Every remote name
//! is untrusted: local paths are built only through `sanitize_name` / `safe_join`.

use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use gxs_core::i18n::ltr;
use gxs_core::{Error, tr};
use gxs_core::local_path::{safe_join, sanitize_name};
use gxs_core::sftp::{Entry, EntryKind, Existing, Progress, Sftp, base_name, join_remote};
use serde::{Deserialize, Serialize};
use tauri::ipc::{Channel, Response};
use tauri::{AppHandle, Manager, State};
use tokio_util::sync::{CancellationToken, DropGuard};

use crate::settings::EditorMode;
use crate::text_codec::{self, Decoded};
use crate::{AppState, Result, open_error};

const MAX_EDIT: u64 = 5 * 1024 * 1024;
const MAX_PREVIEW: u64 = 10 * 1024 * 1024;
const WATCH_EVERY: Duration = Duration::from_secs(1);
const MAX_TARGETS: usize = 1000;
const PACK_PREFIX: &str = "/tmp/gxs-pack-";

/// Extensions Windows would run rather than open; these always go to Notepad instead.
const RUNNABLE: &[&str] = &[
    "bat",
    "cmd",
    "com",
    "cpl",
    "exe",
    "hta",
    "js",
    "jse",
    "lnk",
    "msc",
    "msi",
    "msp",
    "pif",
    "ps1",
    "psm1",
    "reg",
    "scr",
    "url",
    "vbe",
    "vbs",
    "ws",
    "wsf",
    "wsh",
    "appref-ms",
    "application",
    "settingcontent-ms",
];

/// `what` names the field in the current language, lowercase in English: "download folder".
fn absolute(path: &str, what: &str) -> Result<PathBuf> {
    let path = PathBuf::from(path.trim());
    if !path.is_absolute() {
        return Err(Error::Invalid(tr!(
            "{what}必须是绝对路径",
            "The {what} must be an absolute path",
            "{what} چوقۇم مۇتلەق يول بولۇشى كېرەك"
        )));
    }
    Ok(path)
}

/// Where a remote file lives inside the local work directory for this server.
async fn mirror_path(state: &AppState, label: &str, remote: &str) -> Result<PathBuf> {
    let base = state.settings.work_dir().await.join(sanitize_name(label));
    safe_join(&base, remote)
}

async fn fetch_to_mirror(state: &AppState, sftp: &Sftp, label: &str, remote: &str) -> Result<PathBuf> {
    let local = mirror_path(state, label, remote).await?;
    if let Some(parent) = local.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }
    sftp.download(remote, &local, Existing::Replace, &CancellationToken::new(), |_| {}).await?;
    Ok(local)
}

#[tauri::command]
pub async fn sftp_home(state: State<'_, AppState>, session_id: u32) -> Result<String> {
    state.sftp(session_id).await?.0.home().await
}

#[tauri::command]
pub async fn sftp_resolve(state: State<'_, AppState>, session_id: u32, path: String) -> Result<String> {
    state.sftp(session_id).await?.0.realpath(&path).await
}

#[tauri::command]
pub async fn sftp_list(state: State<'_, AppState>, session_id: u32, path: String) -> Result<Vec<Entry>> {
    state.sftp(session_id).await?.0.list(&path).await
}

#[tauri::command]
pub async fn sftp_mkdir(state: State<'_, AppState>, session_id: u32, path: String) -> Result<()> {
    state.sftp(session_id).await?.0.mkdir(&path).await
}

#[tauri::command]
pub async fn sftp_create(state: State<'_, AppState>, session_id: u32, path: String) -> Result<()> {
    state.sftp(session_id).await?.0.create_file(&path).await
}

#[tauri::command]
pub async fn sftp_rename(state: State<'_, AppState>, session_id: u32, from: String, to: String) -> Result<()> {
    state.sftp(session_id).await?.0.rename(&from, &to).await
}

#[tauri::command]
pub async fn sftp_remove(state: State<'_, AppState>, session_id: u32, path: String) -> Result<()> {
    state.sftp(session_id).await?.0.remove(&path).await
}

#[tauri::command]
pub async fn sftp_chmod(
    state: State<'_, AppState>,
    session_id: u32,
    path: String,
    mode: u32,
    recursive: bool,
) -> Result<()> {
    state.sftp(session_id).await?.0.chmod(&path, mode, recursive).await
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompletionEntry {
    name: String,
    is_directory: bool,
}

#[tauri::command]
pub async fn sftp_list_for_completion(
    state: State<'_, AppState>,
    session_id: u32,
    path: String,
) -> Result<Vec<CompletionEntry>> {
    let entries = state.sftp(session_id).await?.0.list(&path).await?;
    Ok(entries
        .into_iter()
        .map(|e| CompletionEntry {
            name: e.name,
            is_directory: matches!(e.kind, EntryKind::Dir) || e.target_is_dir,
        })
        .collect())
}

fn shell_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', r"'\''"))
}

/// Last component of an absolute remote path, refusing anything that would name `/` itself.
fn target_name(path: &str) -> Result<&str> {
    let name = path.trim_end_matches('/').rsplit('/').next().unwrap_or("");
    if !path.starts_with('/') || path.contains('\0') || matches!(name, "" | "." | "..") {
        let path = ltr(path);
        return Err(Error::Invalid(tr!(
            "拒绝处理路径：{path}",
            "Refused to handle the path: {path}",
            "بۇ يولنى بىر تەرەپ قىلىش رەت قىلىندى: {path}"
        )));
    }
    Ok(name)
}

fn check_targets(paths: &[String]) -> Result<()> {
    if paths.is_empty() || paths.len() > MAX_TARGETS {
        return Err(Error::Invalid(tr!(
            "一次最多处理 1000 项",
            "At most 1000 items can be handled at once",
            "بىر قېتىمدا ئەڭ كۆپ 1000 تۈرنى بىر تەرەپ قىلغىلى بولىدۇ"
        )));
    }
    for path in paths {
        target_name(path)?;
    }
    Ok(())
}

async fn run_shell(state: &AppState, session_id: u32, script: &str) -> Result<String> {
    let (client, _) = state.remote(session_id).await?;
    let out = client.exec(&format!("sh -c {}", shell_quote(script))).await?;
    if out.exit.code != Some(0) {
        let stderr = String::from_utf8_lossy(&out.stderr);
        let detail = stderr.trim();
        return Err(Error::Invalid(if detail.is_empty() {
            let code = out.exit.code;
            tr!(
                "远程命令失败（退出码 {code:?}）",
                "The remote command failed (exit code {code:?})",
                "يىراقتىكى بۇيرۇق مەغلۇپ بولدى (چېكىنىش كودى {code:?})"
            )
        } else {
            detail.chars().take(500).collect()
        }));
    }
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}

fn rm_script(paths: &[String]) -> String {
    let quoted: Vec<String> = paths.iter().map(|p| shell_quote(p)).collect();
    format!("rm -rf -- {}", quoted.join(" "))
}

/// Deletes with `rm -rf` on the server: much faster than SFTP for large trees.
#[tauri::command]
pub async fn remote_rm(state: State<'_, AppState>, session_id: u32, paths: Vec<String>) -> Result<()> {
    check_targets(&paths)?;
    run_shell(&state, session_id, &rm_script(&paths)).await.map(|_| ())
}

fn parent_of(path: &str) -> &str {
    let trimmed = path.trim_end_matches('/');
    match trimmed.rfind('/') {
        Some(0) | None => "/",
        Some(i) => &trimmed[..i],
    }
}

/// The tar script and archive file name for items that share one parent directory.
fn pack_script(paths: &[String]) -> Result<(String, String)> {
    check_targets(paths)?;
    let parent = parent_of(&paths[0]);
    let mut names = Vec::with_capacity(paths.len());
    for path in paths {
        if parent_of(path) != parent {
            return Err(Error::Invalid(tr!(
                "只能打包同一目录下的项目",
                "Only items in the same folder can be packed together",
                "پەقەت ئوخشاش قىسقۇچتىكى تۈرلەرنىلا بىرگە بوغچىلىغىلى بولىدۇ"
            )));
        }
        names.push(shell_quote(&format!("./{}", target_name(path)?)));
    }
    let stem = match paths {
        [one] => target_name(one)?,
        _ if parent == "/" => "root",
        _ => target_name(parent)?,
    };
    let archive = format!("{stem}.tar.gz");
    let script = format!(
        "d=$(mktemp -d {PACK_PREFIX}XXXXXX) || exit 1\n\
         if tar -czf \"$d\"/{} -C {} {}; then echo \"$d\"; else rm -rf \"$d\"; exit 1; fi",
        shell_quote(&archive),
        shell_quote(parent),
        names.join(" "),
    );
    Ok((script, archive))
}

fn is_pack_dir(dir: &str) -> bool {
    dir.strip_prefix(PACK_PREFIX)
        .is_some_and(|rest| !rest.is_empty() && rest.chars().all(|c| c.is_ascii_alphanumeric()))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Packed {
    /// Temporary directory to pass to `pack_cleanup` once the download ends.
    dir: String,
    archive: String,
}

/// Packs items into a `.tar.gz` under a fresh temp directory on the server.
#[tauri::command]
pub async fn pack_create(state: State<'_, AppState>, session_id: u32, paths: Vec<String>) -> Result<Packed> {
    let (script, archive) = pack_script(&paths)?;
    let out = run_shell(&state, session_id, &script).await?;
    let dir = out.trim().to_owned();
    if !is_pack_dir(&dir) {
        let dir = ltr(&dir);
        return Err(Error::Data(tr!(
            "打包后返回了意外的目录：{dir}",
            "Packing returned an unexpected folder: {dir}",
            "بوغچىلىغاندىن كېيىن كۈتۈلمىگەن قىسقۇچ قايتۇرۇلدى: {dir}"
        )));
    }
    let archive = join_remote(&dir, &archive);
    Ok(Packed { dir, archive })
}

#[tauri::command]
pub async fn pack_cleanup(state: State<'_, AppState>, session_id: u32, dir: String) -> Result<()> {
    if !is_pack_dir(&dir) {
        return Err(Error::Invalid(tr!(
            "只能清理打包产生的临时目录",
            "Only temporary folders created by packing can be cleaned up",
            "پەقەت بوغچىلاشتا ھاسىل بولغان ۋاقىتلىق قىسقۇچلارنىلا تازىلىغىلى بولىدۇ"
        )));
    }
    run_shell(&state, session_id, &rm_script(&[dir])).await.map(|_| ())
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Direction {
    Download,
    Upload,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferArgs {
    session_id: u32,
    direction: Direction,
    /// Download: destination directory. Upload: the local file or folder.
    local: String,
    /// Download: the remote file or folder. Upload: destination directory.
    remote: String,
    #[serde(default)]
    overwrite: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferStarted {
    id: u32,
    /// Full path of what will be written (local for downloads, remote for uploads).
    target: String,
}

#[derive(Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum TransferEvent {
    Progress { progress: Progress },
    Done { progress: Progress },
    Failed { error: Error },
}

enum Job {
    Download { remote: String, local: PathBuf },
    Upload { local: PathBuf, remote: String },
}

/// Resolves the target up front so an existing file is reported before anything is written.
#[tauri::command]
pub async fn transfer_start(
    app: AppHandle,
    state: State<'_, AppState>,
    args: TransferArgs,
    on_progress: Channel<TransferEvent>,
) -> Result<TransferStarted> {
    let (sftp, _) = state.sftp(args.session_id).await?;
    let (job, target) = match args.direction {
        Direction::Download => {
            let dir = absolute(&args.local, &tr!("下载目录", "download folder", "چۈشۈرۈش قىسقۇچى"))?;
            tokio::fs::create_dir_all(&dir).await?;
            let local = dir.join(sanitize_name(&base_name(&args.remote)));
            if !args.overwrite && tokio::fs::try_exists(&local).await? {
                return Err(Error::Exists(local.to_string_lossy().into_owned()));
            }
            let target = local.to_string_lossy().into_owned();
            (
                Job::Download {
                    remote: args.remote,
                    local,
                },
                target,
            )
        }
        Direction::Upload => {
            let local = absolute(&args.local, &tr!("上传文件", "file to upload", "يۈكلەيدىغان ھۆججەت"))?;
            let name = local
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .ok_or_else(|| {
                    Error::Invalid(tr!(
                        "无法上传驱动器根目录",
                        "Can't upload the root of a drive",
                        "دىسكا يىلتىز قىسقۇچىنى يۈكلىگىلى بولمايدۇ"
                    ))
                })?;
            let remote = join_remote(&args.remote, &name);
            if !args.overwrite && sftp.stat(&remote).await.is_ok() {
                return Err(Error::Exists(remote));
            }
            (
                Job::Upload {
                    local,
                    remote: remote.clone(),
                },
                remote,
            )
        }
    };

    let id = state.id();
    let cancel = CancellationToken::new();
    state.transfers.lock().await.insert(id, cancel.clone());
    tauri::async_runtime::spawn(async move {
        let sink = {
            let channel = on_progress.clone();
            move |progress| {
                let _ = channel.send(TransferEvent::Progress { progress });
            }
        };
        let result = match &job {
            Job::Download { remote, local } => sftp.download(remote, local, Existing::SkipIdentical, &cancel, sink).await,
            Job::Upload { local, remote } => sftp.upload(local, remote, Existing::SkipIdentical, &cancel, sink).await,
        };
        app.state::<AppState>().transfers.lock().await.remove(&id);
        let _ = on_progress.send(match result {
            Ok(progress) => TransferEvent::Done { progress },
            Err(error) => TransferEvent::Failed { error },
        });
    });
    Ok(TransferStarted { id, target })
}

#[tauri::command]
pub async fn transfer_cancel(state: State<'_, AppState>, id: u32) -> Result<()> {
    if let Some(token) = state.transfers.lock().await.get(&id) {
        token.cancel();
    }
    Ok(())
}

/// Remote mtime and size when the local copy was last in sync; used to detect foreign edits.
#[derive(Clone, Copy, PartialEq, Eq)]
struct Stamp {
    mtime: Option<u64>,
    size: u64,
}

impl From<&Entry> for Stamp {
    fn from(e: &Entry) -> Self {
        Stamp {
            mtime: e.mtime,
            size: e.size,
        }
    }
}

pub(crate) struct Edit {
    session_id: u32,
    remote: String,
    local: PathBuf,
    base: Option<Stamp>,
    /// Stops the external-editor watcher when the edit is closed.
    _watch: Option<DropGuard>,
}

#[derive(Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum EditEvent {
    /// The local copy changed on disk (external editor saved it).
    Modified,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EditOpened {
    edit_id: u32,
    local: String,
    /// Present in internal mode.
    text: Option<Decoded>,
}

async fn local_mtime(path: &Path) -> Option<SystemTime> {
    tokio::fs::metadata(path).await.and_then(|m| m.modified()).ok()
}

fn watch(local: PathBuf, events: Channel<EditEvent>) -> DropGuard {
    let cancel = CancellationToken::new();
    let stop = cancel.clone();
    tauri::async_runtime::spawn(async move {
        let mut last = local_mtime(&local).await;
        let mut tick = tokio::time::interval(WATCH_EVERY);
        loop {
            tokio::select! {
                _ = stop.cancelled() => break,
                _ = tick.tick() => {}
            }
            let now = local_mtime(&local).await;
            if now != last {
                last = now;
                if events.send(EditEvent::Modified).is_err() {
                    break;
                }
            }
        }
    });
    cancel.drop_guard()
}

fn open_external(local: &Path, editor: &str) -> Result<()> {
    let runnable = local
        .extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| RUNNABLE.iter().any(|r| r.eq_ignore_ascii_case(e)));
    let program = match editor {
        "" if runnable => Some("notepad.exe"),
        "" => None,
        editor => Some(editor),
    };
    tauri_plugin_opener::open_path(local, program).map_err(open_error)
}

fn already_editing() -> Error {
    Error::Exists(tr!(
        "该文件已在编辑中",
        "This file is already open for editing",
        "بۇ ھۆججەت ئاللىقاچان تەھرىرلىنىۋاتىدۇ"
    ))
}

/// The edit was closed, or never opened.
fn no_edit() -> Error {
    Error::NotFound(tr!("编辑会话", "edit session", "تەھرىرلەش ئەڭگىمىسى"))
}

/// Downloads into the work directory and opens it. Nothing goes back to the server until
/// `edit_upload`.
#[tauri::command]
pub async fn edit_open(
    state: State<'_, AppState>,
    session_id: u32,
    remote: String,
    mode: EditorMode,
    program: Option<String>,
    on_event: Channel<EditEvent>,
) -> Result<EditOpened> {
    let program = match program.as_deref().map(str::trim) {
        None | Some("") => None,
        Some(p) => Some(absolute(p, &tr!("打开程序", "program to open with", "ئاچىدىغان پروگرامما"))?),
    };
    let (sftp, label) = state.sftp(session_id).await?;
    let entry = sftp.stat(&remote).await?;
    if entry.kind != EntryKind::File {
        return Err(Error::Invalid(tr!(
            "只能编辑普通文件",
            "Only regular files can be edited",
            "پەقەت ئادەتتىكى ھۆججەتلەرنىلا تەھرىرلىگىلى بولىدۇ"
        )));
    }
    if mode == EditorMode::Internal && entry.size > MAX_EDIT {
        return Err(Error::Invalid(tr!(
            "文件超过 5 MB，请用外部编辑器或下载后处理",
            "The file is larger than 5 MB. Use an external editor, or download it first",
            "ھۆججەت 5 MB دىن چوڭ، سىرتقى تەھرىرلىگۈچنى ئىشلىتىڭ ياكى چۈشۈرۈپ ئاندىن بىر تەرەپ قىلىڭ"
        )));
    }
    let local = mirror_path(&state, &label, &remote).await?;
    if state.edits.lock().await.values().any(|e| e.local == local) {
        return Err(already_editing());
    }
    let local = fetch_to_mirror(&state, &sftp, &label, &remote).await?;

    let (text, watcher) = match mode {
        EditorMode::Internal => {
            let bytes = tokio::fs::read(&local).await?;
            (Some(text_codec::decode(&bytes, None)?), None)
        }
        EditorMode::External => {
            let editor = match &program {
                Some(p) => p.to_string_lossy().into_owned(),
                None => state.settings.get().await.files.external_editor,
            };
            open_external(&local, &editor)?;
            (None, Some(watch(local.clone(), on_event)))
        }
    };

    let edit_id = state.id();
    let local_str = local.to_string_lossy().into_owned();
    let mut edits = state.edits.lock().await;
    if edits.values().any(|e| e.local == local) {
        return Err(already_editing());
    }
    edits.insert(
        edit_id,
        Edit {
            session_id,
            remote,
            local,
            base: Some(Stamp::from(&entry)),
            _watch: watcher,
        },
    );
    Ok(EditOpened {
        edit_id,
        local: local_str,
        text,
    })
}

async fn edit_local(state: &AppState, edit_id: u32) -> Result<PathBuf> {
    state
        .edits
        .lock()
        .await
        .get(&edit_id)
        .map(|e| e.local.clone())
        .ok_or_else(no_edit)
}

/// Decodes the local copy again with an encoding the user picked.
#[tauri::command]
pub async fn edit_reopen(state: State<'_, AppState>, edit_id: u32, encoding: String) -> Result<Decoded> {
    let bytes = tokio::fs::read(edit_local(&state, edit_id).await?).await?;
    text_codec::decode(&bytes, Some(&encoding))
}

#[tauri::command]
pub async fn edit_save_local(
    state: State<'_, AppState>,
    edit_id: u32,
    text: String,
    encoding: String,
    bom: bool,
) -> Result<()> {
    if text.len() as u64 > MAX_EDIT * 2 {
        return Err(Error::Invalid(tr!("内容过大", "The content is too large", "مەزمۇن بەك چوڭ")));
    }
    let bytes = text_codec::encode(&text, &encoding, bom)?;
    gxs_core::fsutil::write_atomic(edit_local(&state, edit_id).await?, bytes).await
}

/// Uploads the local copy. Without `force`, refuses if the remote changed since download.
#[tauri::command]
pub async fn edit_upload(state: State<'_, AppState>, edit_id: u32, force: bool) -> Result<()> {
    let (session_id, remote, local, base) = {
        let edits = state.edits.lock().await;
        let e = edits.get(&edit_id).ok_or_else(no_edit)?;
        (e.session_id, e.remote.clone(), e.local.clone(), e.base)
    };
    let (sftp, _) = state.sftp(session_id).await?;
    if !force && let Some(base) = base {
        match sftp.stat(&remote).await {
            Ok(current) if Stamp::from(&current) == base => {}
            Ok(_) | Err(Error::NotFound(_)) => return Err(Error::RemoteChanged),
            Err(e) => return Err(e),
        }
    }
    sftp.upload(&local, &remote, Existing::Replace, &CancellationToken::new(), |_| {}).await?;
    let fresh = sftp.stat(&remote).await.ok().map(|e| Stamp::from(&e));
    if let Some(e) = state.edits.lock().await.get_mut(&edit_id) {
        e.base = fresh;
    }
    Ok(())
}

/// Forgets the edit; the local copy stays in the work directory.
#[tauri::command]
pub async fn edit_close(state: State<'_, AppState>, edit_id: u32) -> Result<()> {
    state.edits.lock().await.remove(&edit_id);
    Ok(())
}

/// Downloads into the work directory and returns the raw bytes (arrives as an ArrayBuffer).
#[tauri::command]
pub async fn preview_image(state: State<'_, AppState>, session_id: u32, remote: String) -> Result<Response> {
    let (sftp, label) = state.sftp(session_id).await?;
    let entry = sftp.stat(&remote).await?;
    if entry.kind != EntryKind::File {
        return Err(Error::Invalid(tr!(
            "只能预览普通文件",
            "Only regular files can be previewed",
            "پەقەت ئادەتتىكى ھۆججەتلەرنىلا ئالدىن كۆرگىلى بولىدۇ"
        )));
    }
    if entry.size > MAX_PREVIEW {
        return Err(Error::Invalid(tr!(
            "图片超过 10 MB，请下载后查看",
            "The image is larger than 10 MB. Download it to view it",
            "رەسىم 10 MB دىن چوڭ، چۈشۈرۈپ ئاندىن كۆرۈڭ"
        )));
    }
    let local = fetch_to_mirror(&state, &sftp, &label, &remote).await?;
    Ok(Response::new(tokio::fs::read(&local).await?))
}

/// Where previews and edits of `remote` are mirrored locally.
#[tauri::command]
pub async fn mirror_local(state: State<'_, AppState>, session_id: u32, remote: String) -> Result<String> {
    let (_, label) = state.remote(session_id).await?;
    Ok(mirror_path(&state, &label, &remote)
        .await?
        .to_string_lossy()
        .into_owned())
}

#[tauri::command]
pub async fn reveal_local(path: String) -> Result<()> {
    let path = absolute(&path, &tr!("路径", "path", "يول"))?;
    tauri_plugin_opener::reveal_item_in_dir(path).map_err(open_error)
}

/// Only plain web links go to the browser; anything else could launch a local program.
fn web_url(url: &str) -> Result<&str> {
    let scheme = url.get(..8).unwrap_or(url).to_ascii_lowercase();
    let web = scheme.starts_with("http://") || scheme.starts_with("https://");
    if !web || url.len() > 4096 || url.chars().any(|c| c.is_control() || c.is_whitespace()) {
        return Err(Error::Invalid(tr!(
            "只能打开 http 或 https 链接",
            "Only http and https links can be opened",
            "پەقەت http ياكى https ئۇلانمىسىنىلا ئاچقىلى بولىدۇ"
        )));
    }
    Ok(url)
}

#[tauri::command]
pub async fn open_url(url: String) -> Result<()> {
    tauri_plugin_opener::open_url(web_url(&url)?, None::<&str>).map_err(open_error)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quoting_survives_single_quotes() {
        assert_eq!(shell_quote("a'b"), r"'a'\''b'");
        assert_eq!(rm_script(&["/srv/x y".into()]), "rm -rf -- '/srv/x y'");
    }

    #[test]
    fn root_and_dot_paths_are_refused() {
        for bad in ["/", "//", "/srv/.", "/srv/..", "relative", ""] {
            assert!(target_name(bad).is_err(), "{bad}");
        }
        assert_eq!(target_name("/srv/www/").unwrap(), "www");
    }

    #[test]
    fn packing_needs_one_parent_and_names_the_archive() {
        let (script, archive) = pack_script(&["/srv/-rf".into()]).unwrap();
        assert_eq!(archive, "-rf.tar.gz");
        assert!(script.contains("-C '/srv' './-rf'"));
        let (_, archive) = pack_script(&["/srv/a".into(), "/srv/b".into()]).unwrap();
        assert_eq!(archive, "srv.tar.gz");
        let (_, archive) = pack_script(&["/a".into(), "/b".into()]).unwrap();
        assert_eq!(archive, "root.tar.gz");
        assert!(pack_script(&["/srv/a".into(), "/etc/b".into()]).is_err());
        assert!(is_pack_dir("/tmp/gxs-pack-a1B2c3"));
        for bad in ["/tmp/gxs-pack-", "/tmp/gxs-pack-x/../..", "/etc"] {
            assert!(!is_pack_dir(bad));
        }
    }

    #[test]
    fn only_web_links_open() {
        for ok in ["https://example.com/a?b=1", "HTTP://host:8080/"] {
            assert!(web_url(ok).is_ok(), "{ok}");
        }
        for bad in ["file:///C:/Windows/notepad.exe", "javascript:alert(1)", "ms-settings:", "http://a b", "https://a\n"] {
            assert!(web_url(bad).is_err(), "{bad}");
        }
    }
}
