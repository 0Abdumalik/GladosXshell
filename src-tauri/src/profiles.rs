use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::PoisonError;
use std::sync::atomic::{AtomicU64, Ordering};

use gxs_core::{Error, tr};
use gxs_core::import::{self, Candidate, Locations, SavedPassword, Source, SourceScan};
use gxs_core::profiles::{Group, ImportReport, MasterStatus, Profiles, SecretUpdate, ServerInput, ServerView};
use tauri::{AppHandle, Manager, State};
use zeroize::Zeroizing;

use crate::applog::Level;
use crate::{AppState, Result};

#[tauri::command]
pub async fn profiles_list(state: State<'_, AppState>) -> Result<Profiles> {
    Ok(state.profiles.list().await)
}

#[tauri::command]
pub async fn profile_save(state: State<'_, AppState>, input: ServerInput) -> Result<ServerView> {
    state.profiles.save_server(input).await
}

#[tauri::command]
pub async fn profile_delete(state: State<'_, AppState>, id: String) -> Result<()> {
    state.profiles.delete_server(&id).await
}

#[tauri::command]
pub async fn profile_duplicate(state: State<'_, AppState>, id: String) -> Result<ServerView> {
    state.profiles.duplicate_server(&id).await
}

#[tauri::command]
pub async fn profiles_move(state: State<'_, AppState>, ids: Vec<String>, group_id: Option<String>) -> Result<()> {
    state.profiles.move_servers(&ids, group_id).await
}

#[tauri::command]
pub async fn group_save(state: State<'_, AppState>, id: Option<String>, name: String) -> Result<Group> {
    state.profiles.save_group(id, &name).await
}

/// Servers in the group move to "ungrouped"; nothing is deleted with it.
#[tauri::command]
pub async fn group_delete(state: State<'_, AppState>, id: String) -> Result<()> {
    state.profiles.delete_group(&id).await
}

#[tauri::command]
pub async fn master_status(state: State<'_, AppState>) -> Result<MasterStatus> {
    Ok(state.profiles.master_status().await)
}

#[tauri::command]
pub async fn master_unlock(state: State<'_, AppState>, password: Zeroizing<String>) -> Result<MasterStatus> {
    state.profiles.unlock(password).await?;
    Ok(state.profiles.master_status().await)
}

#[tauri::command]
pub async fn master_lock(state: State<'_, AppState>) -> Result<MasterStatus> {
    state.profiles.lock();
    Ok(state.profiles.master_status().await)
}

/// Sets, changes or (`next: None`) removes the master password.
#[tauri::command]
pub async fn master_set(
    state: State<'_, AppState>,
    current: Option<Zeroizing<String>>,
    next: Option<Zeroizing<String>>,
) -> Result<MasterStatus> {
    let was = state.profiles.master_status().await.enabled;
    let removing = next.is_none();
    state.profiles.set_master(current, next).await?;
    let what = match (was, removing) {
        (false, _) => tr!(
            "已设置主密码，保存的密码改用主密码加密",
            "Set a master password. Saved passwords are now encrypted with it",
            "ئاساسىي ئىم تەڭشەلدى، ساقلانغان ئىملار ئەمدى ئاساسىي ئىم بىلەن شىفىرلىنىدۇ"
        ),
        (true, false) => tr!("已更换主密码", "Changed the master password", "ئاساسىي ئىم ئالماشتۇرۇلدى"),
        (true, true) => tr!(
            "已取消主密码，保存的密码改回用 Windows 账户加密",
            "Removed the master password. Saved passwords are encrypted with the Windows account again",
            "ئاساسىي ئىم بىكار قىلىندى، ساقلانغان ئىملار يەنە Windows ھېساباتى بىلەن شىفىرلىنىدۇ"
        ),
    };
    state.log.add(Level::Info, what).await;
    Ok(state.profiles.master_status().await)
}

/// Reads connections saved by another client. `path` overrides where it looks.
#[tauri::command]
pub async fn profiles_import_scan(
    app: AppHandle,
    state: State<'_, AppState>,
    source: Source,
    path: Option<PathBuf>,
) -> Result<SourceScan> {
    let paths = app.path();
    let home = paths.home_dir().map_err(|e| Error::Io(std::io::Error::other(e.to_string())))?;
    let at = Locations {
        documents: paths.document_dir().unwrap_or_else(|_| home.join("Documents")),
        desktop: paths.desktop_dir().unwrap_or_else(|_| home.join("Desktop")),
        local_data: paths.local_data_dir().unwrap_or_else(|_| home.join("AppData").join("Local")),
        roaming: paths.data_dir().unwrap_or_else(|_| home.join("AppData").join("Roaming")),
        local_user: std::env::var("USERNAME").or_else(|_| std::env::var("USER")).unwrap_or_default(),
        home,
    };
    let mut scan = tokio::task::spawn_blocking(move || import::scan(source, &at, path.as_deref()))
        .await
        .map_err(|e| Error::Io(std::io::Error::other(e.to_string())))?;
    import::mark_existing(&mut scan.candidates, &state.profiles.list().await);
    if source == Source::FinalShell {
        state.import_passwords.hold(&mut scan.candidates);
    }
    Ok(scan)
}

/// `with_passwords` carries over the passwords FinalShell saved for the chosen connections; they
/// are decrypted here and sealed straight away, never sent back or logged.
#[tauri::command]
pub async fn profiles_import(
    state: State<'_, AppState>,
    candidates: Vec<Candidate>,
    with_passwords: Option<bool>,
) -> Result<ImportReport> {
    if candidates.len() > import::MAX_CANDIDATES {
        let max = import::MAX_CANDIDATES;
        return Err(Error::Invalid(tr!(
            "一次最多导入 {max} 个连接",
            "At most {max} connections can be imported at a time",
            "بىر قېتىمدا ئەڭ كۆپ بولغاندا {max} ئۇلىنىش ئەكىرگىلى بولىدۇ"
        )));
    }
    let held = if with_passwords == Some(true) { state.import_passwords.snapshot() } else { HashMap::new() };
    let mut unreadable = 0;
    let entries = import::entries(candidates, &state.profiles.list().await, |c| {
        let Some(saved) = c.password_ref.as_ref().and_then(|r| held.get(r)) else {
            return SecretUpdate::Keep;
        };
        match saved.decrypt() {
            Ok(value) => SecretUpdate::Set { value },
            Err(_) => {
                unreadable += 1;
                SecretUpdate::Keep
            }
        }
    });
    drop(held);
    // Kept until the import goes through, so unlocking the master password and retrying works.
    let mut report = state.profiles.import(entries).await?;
    if report.failed.is_empty() {
        state.import_passwords.clear();
    }
    report.secrets_unreadable = unreadable;
    if report.secrets > 0 || unreadable > 0 {
        let secrets = report.secrets;
        let what = if unreadable > 0 {
            tr!(
                "从 FinalShell 导入了 {secrets} 个保存的密码，{unreadable} 个无法解密",
                "Imported {secrets} saved passwords from FinalShell; {unreadable} could not be decrypted",
                "FinalShell دىن {secrets} ساقلانغان ئىم ئەكىرىلدى، {unreadable} سىنى شىفىردىن يېشەلمىدى"
            )
        } else {
            tr!(
                "从 FinalShell 导入了 {secrets} 个保存的密码",
                "Imported {secrets} saved passwords from FinalShell",
                "FinalShell دىن {secrets} ساقلانغان ئىم ئەكىرىلدى"
            )
        };
        state.log.add(Level::Info, what).await;
    }
    Ok(report)
}

/// FinalShell passwords from the latest scan, still encrypted, under the handles the preview got.
#[derive(Default)]
pub struct ImportPasswords {
    held: std::sync::Mutex<HashMap<String, SavedPassword>>,
    scans: AtomicU64,
}

impl ImportPasswords {
    fn lock(&self) -> std::sync::MutexGuard<'_, HashMap<String, SavedPassword>> {
        self.held.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// Replaces what an earlier scan left.
    fn hold(&self, candidates: &mut [Candidate]) {
        let scan = self.scans.fetch_add(1, Ordering::Relaxed);
        let mut held = self.lock();
        held.clear();
        for (index, c) in candidates.iter_mut().enumerate() {
            if let Some(saved) = c.saved_password.take() {
                let handle = format!("fs{scan}-{index}");
                c.password_ref = Some(handle.clone());
                held.insert(handle, saved);
            }
        }
    }

    fn snapshot(&self) -> HashMap<String, SavedPassword> {
        self.lock().clone()
    }

    fn clear(&self) {
        self.lock().clear();
    }
}
