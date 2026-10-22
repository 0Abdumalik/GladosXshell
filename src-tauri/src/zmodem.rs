//! Local file access for ZMODEM transfers; the protocol itself runs in the webview.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, LazyLock};
use std::time::UNIX_EPOCH;

use gxs_core::i18n::ltr;
use gxs_core::{Error, tr};
use gxs_core::local_path::sanitize_name;
use serde::Serialize;
use tauri::ipc::{InvokeBody, Request, Response};
use tokio::io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt};
use tokio::sync::Mutex;

use crate::Result;
use crate::settings::check_path;

const MAX_READ: u32 = 1024 * 1024;

struct Saving {
    file: tokio::fs::File,
    path: PathBuf,
}

static NEXT: AtomicU32 = AtomicU32::new(1);
static SAVES: LazyLock<Mutex<HashMap<u32, Arc<Mutex<Saving>>>>> = LazyLock::new(Mutex::default);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveTarget {
    handle: u32,
    path: String,
}

/// `name (1).ext`, `name (2).ext`, … for the first free spot.
fn numbered(dir: &Path, name: &str, n: u32) -> PathBuf {
    if n == 0 {
        return dir.join(name);
    }
    match name.rfind('.') {
        Some(dot) if dot > 0 => dir.join(format!("{} ({n}){}", &name[..dot], &name[dot..])),
        _ => dir.join(format!("{name} ({n})")),
    }
}

/// Creates a new file for an incoming transfer, never overwriting an existing one.
#[tauri::command]
pub async fn zmodem_save_begin(dir: String, name: String) -> Result<SaveTarget> {
    let dir = check_path(&dir, &tr!("保存目录", "save folder", "ساقلاش قىسقۇچى"))?;
    if dir.is_empty() {
        return Err(Error::Invalid(tr!("没有选择保存目录", "No save folder was chosen", "ساقلاش قىسقۇچى تاللانمىدى")));
    }
    let dir = PathBuf::from(dir);
    let name = sanitize_name(name.rsplit(['/', '\\']).next().unwrap_or_default());
    let name = if name.is_empty() { "download".to_owned() } else { name };
    tokio::fs::create_dir_all(&dir).await?;
    for n in 0..1000 {
        let path = numbered(&dir, &name, n);
        match tokio::fs::OpenOptions::new().write(true).create_new(true).open(&path).await {
            Ok(file) => {
                let handle = NEXT.fetch_add(1, Ordering::Relaxed);
                let shown = path.to_string_lossy().into_owned();
                SAVES
                    .lock()
                    .await
                    .insert(handle, Arc::new(Mutex::new(Saving { file, path })));
                return Ok(SaveTarget { handle, path: shown });
            }
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(e.into()),
        }
    }
    let shown = ltr(&dir.display().to_string());
    Err(Error::Invalid(tr!(
        "{shown} 中同名文件太多",
        "{shown} has too many files with this name",
        "{shown} دا ئوخشاش ناملىق ھۆججەت بەك كۆپ"
    )))
}

/// Appends the raw request body to the file named by the `x-handle` header.
#[tauri::command]
pub async fn zmodem_save_write(request: Request<'_>) -> Result<()> {
    let InvokeBody::Raw(data) = request.body() else {
        return Err(Error::Invalid(tr!("需要二进制数据", "Binary data is required", "ئىككىلىك سانلىق مەلۇمات كېرەك")));
    };
    let handle = request
        .headers()
        .get("x-handle")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse::<u32>().ok())
        .ok_or_else(|| Error::Invalid(tr!("缺少文件编号", "The file handle is missing", "ھۆججەت نومۇرى كەم")))?;
    let data = data.clone();
    let saving = SAVES.lock().await.get(&handle).cloned().ok_or(Error::Closed)?;
    saving.lock().await.file.write_all(&data).await?;
    Ok(())
}

/// Closes the file; an incomplete one (`keep` false) is deleted.
#[tauri::command]
pub async fn zmodem_save_end(handle: u32, keep: bool) -> Result<()> {
    let Some(saving) = SAVES.lock().await.remove(&handle) else {
        return Ok(());
    };
    let mut saving = saving.lock().await;
    let flushed = saving.file.flush().await;
    if !keep {
        let _ = tokio::fs::remove_file(&saving.path).await;
        return Ok(());
    }
    flushed.map_err(Error::from)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalFile {
    path: String,
    name: String,
    size: u64,
    /// Seconds since the epoch.
    mtime: u64,
}

/// Size and name of each file to offer; folders are refused.
#[tauri::command]
pub async fn zmodem_stat(paths: Vec<String>) -> Result<Vec<LocalFile>> {
    let mut out = Vec::with_capacity(paths.len());
    for path in paths {
        let path = check_path(&path, &tr!("文件路径", "file path", "ھۆججەت يولى"))?;
        let meta = tokio::fs::metadata(&path).await?;
        if !meta.is_file() {
            let shown = ltr(&path);
            return Err(Error::Invalid(tr!(
                "{shown} 不是文件，rz 只能发送文件",
                "{shown} is not a file; rz can only send files",
                "{shown} ھۆججەت ئەمەس، rz پەقەت ھۆججەتنىلا يوللىيالايدۇ"
            )));
        }
        let name = Path::new(&path)
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default();
        let mtime = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map_or(0, |d| d.as_secs());
        out.push(LocalFile {
            path,
            name,
            size: meta.len(),
            mtime,
        });
    }
    Ok(out)
}

/// Up to `len` bytes from `offset`; fewer (or none) at the end of the file.
#[tauri::command]
pub async fn zmodem_read(path: String, offset: u64, len: u32) -> Result<Response> {
    let path = check_path(&path, &tr!("文件路径", "file path", "ھۆججەت يولى"))?;
    let mut file = tokio::fs::File::open(&path).await?;
    file.seek(std::io::SeekFrom::Start(offset)).await?;
    let mut buf = Vec::with_capacity(len.min(MAX_READ) as usize);
    file.take(u64::from(len.min(MAX_READ))).read_to_end(&mut buf).await?;
    Ok(Response::new(buf))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn numbered_keeps_the_extension() {
        let dir = Path::new("d");
        assert_eq!(numbered(dir, "a.tar.gz", 0), dir.join("a.tar.gz"));
        assert_eq!(numbered(dir, "a.tar.gz", 2), dir.join("a.tar (2).gz"));
        assert_eq!(numbered(dir, ".bashrc", 1), dir.join(".bashrc (1)"));
        assert_eq!(numbered(dir, "notes", 3), dir.join("notes (3)"));
    }

    #[tokio::test]
    async fn save_never_overwrites_and_partial_files_are_removed() {
        let tmp = tempdir();
        let dir = tmp.to_string_lossy().into_owned();
        std::fs::write(tmp.join("f.txt"), b"old").unwrap();
        let target = zmodem_save_begin(dir.clone(), "../f.txt".into()).await.unwrap();
        assert!(target.path.ends_with("f (1).txt"));
        zmodem_save_end(target.handle, false).await.unwrap();
        assert!(!tmp.join("f (1).txt").exists());
        assert_eq!(std::fs::read(tmp.join("f.txt")).unwrap(), b"old");
        std::fs::remove_dir_all(&tmp).unwrap();
    }

    fn tempdir() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("gx-zmodem-{}", NEXT.fetch_add(1, Ordering::Relaxed)));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }
}
