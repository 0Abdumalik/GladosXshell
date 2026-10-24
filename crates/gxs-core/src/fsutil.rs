use std::path::{Path, PathBuf};

use crate::error::{Error, Result};

/// Write-to-temp, fsync, rename: a crash leaves either the old or the new file, never a torn one.
pub async fn write_atomic(path: impl Into<PathBuf>, body: Vec<u8>) -> Result<()> {
    let path = path.into();
    tokio::task::spawn_blocking(move || write_atomic_blocking(&path, &body))
        .await
        .map_err(|e| Error::Io(std::io::Error::other(e.to_string())))??;
    Ok(())
}

pub fn write_atomic_blocking(path: &Path, body: &[u8]) -> std::io::Result<()> {
    use std::io::Write;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let dir = path
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(|| PathBuf::from("."));
    let name = path.file_name().unwrap_or_default().to_string_lossy().into_owned();
    // A fresh random temp name opened with create_new (O_EXCL) never follows a
    // pre-placed symlink, and two concurrent writers cannot step on the same file.
    loop {
        let nonce: u64 = rand::random();
        let tmp = dir.join(format!("{name}.{}.{nonce}.tmp", std::process::id()));
        match std::fs::OpenOptions::new().write(true).create_new(true).open(&tmp) {
            Ok(mut file) => {
                let result = (|| {
                    file.write_all(body)?;
                    file.sync_all()?;
                    std::fs::rename(&tmp, path)
                })();
                if result.is_err() {
                    let _ = std::fs::remove_file(&tmp);
                }
                return result;
            }
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(e),
        }
    }
}

/// `None` when the file does not exist; other I/O errors propagate.
pub async fn read_optional(path: &Path) -> Result<Option<Vec<u8>>> {
    match tokio::fs::read(path).await {
        Ok(bytes) => Ok(Some(bytes)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.into()),
    }
}

pub fn now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_secs())
}
