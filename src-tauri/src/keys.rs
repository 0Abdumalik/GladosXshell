//! The key library: SSH key pairs kept in `{config_dir}/keys`, made here or imported from other
//! tools, and installed on servers over a live session. Private key text never leaves Rust.

use std::path::{Path, PathBuf};
use std::time::Duration;

use gxs_core::keys::{self, KeyInfo, KeyType};
use gxs_core::i18n::ltr;
use gxs_core::{Error, fsutil, tr};
use serde::Serialize;
use tauri::State;
use zeroize::Zeroizing;

use crate::settings::check_path;
use crate::{AppState, Result};

const KEYS: &str = "keys";
const MAX_KEY_FILE: u64 = 64 * 1024;
const MAX_KEYS: usize = 200;
const MAX_NAME: usize = 60;
const DEPLOY_TIMEOUT: Duration = Duration::from_secs(20);

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredKey {
    path: String,
    name: String,
    #[serde(flatten)]
    info: KeyInfo,
}

fn invalid(message: impl Into<String>) -> Error {
    Error::Invalid(message.into())
}

fn key_dir(state: &AppState) -> PathBuf {
    state.config_dir.join(KEYS)
}

fn check_name(name: &str) -> Result<&str> {
    let name = name.trim();
    let bad = name.is_empty()
        || name.chars().count() > MAX_NAME
        || name.starts_with('.')
        || name.ends_with('.')
        || name.to_ascii_lowercase().ends_with(".pub")
        || name.chars().any(|c| c.is_control() || "<>:\"/\\|?*".contains(c));
    if bad {
        return Err(invalid(tr!(
            "名称不能为空，最长 60 个字符，不能以点开头或结尾、不能以 .pub 结尾，也不能包含 <>:\"/\\|?*",
            "The name must not be empty, can be up to 60 characters, cannot start or end with a dot or end with .pub, and cannot contain <>:\"/\\|?*",
            "نام بوش بولسا بولمايدۇ، ئەڭ ئۇزۇن بولغاندا 60 ھەرپ، چېكىت بىلەن باشلانسا ياكى ئاخىرلاشسا، \u{2066}.pub\u{2069} بىلەن ئاخىرلاشسا بولمايدۇ، \u{2066}<>:\"/\\|?*\u{2069} نى ئۆز ئىچىگە ئالسا بولمايدۇ"
        ))
        .on("name"));
    }
    Ok(name)
}

fn stored(path: &Path, info: KeyInfo) -> StoredKey {
    StoredKey {
        path: path.to_string_lossy().into_owned(),
        name: path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default(),
        info,
    }
}

async fn read_key(path: &Path) -> Result<Zeroizing<String>> {
    if tokio::fs::metadata(path).await?.len() > MAX_KEY_FILE {
        return Err(invalid(tr!(
            "私钥文件不能超过 64 KB",
            "The private key file cannot be larger than 64 KB",
            "شەخسىي ئاچقۇچ ھۆججىتى 64 KB دىن ئېشىپ كەتسە بولمايدۇ"
        )));
    }
    let bytes = Zeroizing::new(tokio::fs::read(path).await?);
    std::str::from_utf8(&bytes)
        .map(|s| Zeroizing::new(s.to_owned()))
        .map_err(|_| invalid(tr!("私钥文件不是文本", "The private key file is not text", "شەخسىي ئاچقۇچ ھۆججىتى تېكىست ئەمەس")))
}

/// A path the frontend sent back, accepted only if it names a key in the library.
async fn library_key(dir: &Path, path: &str) -> Result<PathBuf> {
    let path = PathBuf::from(check_path(path, &tr!("密钥路径", "key path", "ئاچقۇچ يولى"))?);
    let missing = || invalid(tr!("密钥库里没有这个密钥", "This key is not in the key library", "ئاچقۇچ ئامبىرىدا بۇ ئاچقۇچ يوق"));
    let (Ok(dir), Ok(real)) = (tokio::fs::canonicalize(dir).await, tokio::fs::canonicalize(&path).await) else {
        return Err(missing());
    };
    if real.parent() != Some(dir.as_path()) || real.extension().is_some_and(|e| e.eq_ignore_ascii_case("pub")) {
        return Err(missing());
    }
    Ok(path)
}

async fn blocking<T: Send + 'static>(run: impl FnOnce() -> Result<T> + Send + 'static) -> Result<T> {
    tokio::task::spawn_blocking(run)
        .await
        .map_err(|e| Error::Io(std::io::Error::other(e.to_string())))?
}

/// Writes the private key and its `.pub` next to it; refuses to replace an existing key.
async fn save(dir: &Path, name: &str, private: Zeroizing<String>, info: KeyInfo) -> Result<StoredKey> {
    tokio::fs::create_dir_all(dir).await?;
    let path = dir.join(name);
    if tokio::fs::try_exists(&path).await? {
        let name = ltr(name);
        return Err(Error::Exists(tr!(
            "密钥库里已经有名为 {name} 的密钥",
            "The key library already has a key named {name}",
            "ئاچقۇچ ئامبىرىدا {name} ناملىق ئاچقۇچ ئاللىقاچان بار"
        ))
        .on("name"));
    }
    fsutil::write_atomic(&path, private.as_bytes().to_vec()).await?;
    fsutil::write_atomic(dir.join(format!("{name}.pub")), format!("{}\n", info.public).into_bytes()).await?;
    Ok(stored(&path, info))
}

#[tauri::command]
pub async fn keys_list(state: State<'_, AppState>) -> Result<Vec<StoredKey>> {
    list(&key_dir(&state)).await
}

async fn list(dir: &Path) -> Result<Vec<StoredKey>> {
    let mut out = Vec::new();
    let mut entries = match tokio::fs::read_dir(dir).await {
        Ok(entries) => entries,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(out),
        Err(e) => return Err(e.into()),
    };
    while let Some(entry) = entries.next_entry().await? {
        let path = entry.path();
        let meta = entry.metadata().await?;
        let public = path.extension().is_some_and(|e| e.eq_ignore_ascii_case("pub"));
        if !meta.is_file() || public || meta.len() > MAX_KEY_FILE || out.len() >= MAX_KEYS {
            continue;
        }
        // Anything else dropped in the folder is not a key and stays out of the list.
        let Ok(text) = read_key(&path).await else { continue };
        if let Ok(info) = keys::inspect(&text) {
            out.push(stored(&path, info));
        }
    }
    out.sort_by_key(|k| k.name.to_lowercase());
    Ok(out)
}

#[tauri::command]
pub async fn key_generate(
    state: State<'_, AppState>,
    name: String,
    kind: String,
    bits: Option<u32>,
    comment: String,
    passphrase: Option<String>,
) -> Result<StoredKey> {
    let name = check_name(&name)?.to_owned();
    let kind = KeyType::parse(&kind, bits)?;
    let passphrase = passphrase.map(Zeroizing::new);
    // RSA generation takes seconds; keep it off the async workers.
    let (private, info) = blocking(move || keys::generate(kind, &comment, passphrase.as_deref().map(String::as_str))).await?;
    save(&key_dir(&state), &name, private, info).await
}

#[tauri::command]
pub async fn key_import(
    state: State<'_, AppState>,
    path: String,
    name: String,
    passphrase: Option<String>,
) -> Result<StoredKey> {
    let source = PathBuf::from(check_path(&path, &tr!("私钥路径", "private key path", "شەخسىي ئاچقۇچ يولى"))?);
    let name = check_name(&name)?.to_owned();
    if !tokio::fs::metadata(&source).await?.is_file() {
        return Err(invalid(tr!("请选择一个私钥文件", "Choose a private key file", "بىر شەخسىي ئاچقۇچ ھۆججىتىنى تاللاڭ")));
    }
    let text = read_key(&source).await?;
    let passphrase = passphrase.map(Zeroizing::new);
    let (private, info) = blocking(move || keys::to_openssh(&text, passphrase.as_deref().map(String::as_str))).await?;
    let dir = key_dir(&state);
    for existing in list(&dir).await? {
        if existing.info.fingerprint == info.fingerprint {
            let name = ltr(&existing.name);
            return Err(Error::Exists(tr!(
                "这个密钥已经在密钥库里，名为 {name}",
                "This key is already in the key library, named {name}",
                "بۇ ئاچقۇچ ئاچقۇچ ئامبىرىدا ئاللىقاچان بار، نامى {name}"
            )));
        }
    }
    save(&dir, &name, private, info).await
}

#[tauri::command]
pub async fn key_remove(state: State<'_, AppState>, path: String) -> Result<()> {
    let path = library_key(&key_dir(&state), &path).await?;
    tokio::fs::remove_file(&path).await?;
    let mut public = path.into_os_string();
    public.push(".pub");
    match tokio::fs::remove_file(PathBuf::from(public)).await {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e.into()),
        _ => Ok(()),
    }
}

/// Adds the key's public half to `~/.ssh/authorized_keys` on the session's server.
/// Returns false when the key was already there.
#[tauri::command]
pub async fn key_deploy(state: State<'_, AppState>, session_id: u32, path: String) -> Result<bool> {
    let path = library_key(&key_dir(&state), &path).await?;
    let info = keys::inspect(&read_key(&path).await?)?;
    let command = keys::authorized_keys_command(&info.public)?;
    let (client, _) = state.remote(session_id).await?;
    let out = tokio::time::timeout(DEPLOY_TIMEOUT, client.exec_limited(&command, 64 * 1024))
        .await
        .map_err(|_| {
            invalid(tr!(
                "服务器在 20 秒内没有完成，公钥可能没有装上",
                "The server did not finish within 20 seconds; the public key may not have been installed",
                "مۇلازىمېتىر 20 سېكۇنت ئىچىدە تاماملىمىدى، ئاممىۋى ئاچقۇچ ئورنىتىلمىغان بولۇشى مۇمكىن"
            ))
        })??;
    let stdout = String::from_utf8_lossy(&out.stdout);
    match (out.exit.code, stdout.trim()) {
        (Some(0), "added") => Ok(true),
        (Some(0), "present") => Ok(false),
        _ => {
            let stderr = String::from_utf8_lossy(&out.stderr);
            let detail: String = stderr.trim().chars().take(500).collect();
            Err(invalid(if detail.is_empty() {
                let code = ltr(&format!("{:?}", out.exit.code));
                tr!(
                    "没能写入 ~/.ssh/authorized_keys（退出码 {code}）",
                    "Could not write ~/.ssh/authorized_keys (exit code {code})",
                    "\u{2066}~/.ssh/authorized_keys\u{2069} غا يازغىلى بولمىدى (چېكىنىش كودى {code})"
                )
            } else {
                let detail = ltr(&detail);
                tr!(
                    "没能写入 ~/.ssh/authorized_keys：{detail}",
                    "Could not write ~/.ssh/authorized_keys: {detail}",
                    "\u{2066}~/.ssh/authorized_keys\u{2069} غا يازغىلى بولمىدى: {detail}"
                )
            }))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_are_plain_file_names() {
        assert_eq!(check_name(" id_ed25519 ").unwrap(), "id_ed25519");
        assert!(check_name("工作 服务器").is_ok());
        for bad in ["", ".hidden", "a.", "x.pub", "X.PUB", "a/b", r"a\b", "a:b", "a\nb"] {
            assert!(check_name(bad).is_err(), "{bad:?}");
        }
        assert!(check_name(&"k".repeat(61)).is_err());
    }

    #[tokio::test]
    async fn saves_pairs_and_guards_paths() {
        let dir = std::env::temp_dir().join(format!("gx-keys-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let (private, info) = keys::generate(KeyType::Ed25519, "t", None).unwrap();
        let fingerprint = info.fingerprint.clone();
        let saved = save(&dir, "work", private.clone(), info.clone()).await.unwrap();
        assert_eq!(saved.name, "work");
        let public = std::fs::read_to_string(dir.join("work.pub")).unwrap();
        assert_eq!(public.trim_end(), info.public);
        assert_eq!(keys::inspect(&read_key(&dir.join("work")).await.unwrap()).unwrap().fingerprint, fingerprint);
        let taken = save(&dir, "work", private, info).await.err().unwrap();
        assert_eq!((taken.kind(), taken.field()), ("exists", Some("name")));

        let inside = library_key(&dir, &saved.path).await.unwrap();
        assert_eq!(inside, dir.join("work"));
        assert!(library_key(&dir, &dir.join("work.pub").to_string_lossy()).await.is_err());
        assert!(library_key(&dir, &dir.join("missing").to_string_lossy()).await.is_err());
        let outside = std::env::temp_dir().join(format!("gx-keys-out-{}", std::process::id()));
        std::fs::write(&outside, "x").unwrap();
        assert!(library_key(&dir, &outside.to_string_lossy()).await.is_err());
        let _ = std::fs::remove_file(&outside);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
