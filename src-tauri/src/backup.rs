//! Configuration backup: one JSON file holding settings, connections, command favorites and
//! trusted host keys. Passwords stay out unless the user sets an export password; DPAPI blobs only
//! open on this machine, so they are re-locked with that password (Argon2id + AES-256-GCM).

use std::path::PathBuf;

use gxs_core::i18n::ltr;
use gxs_core::known_hosts::{HostsMerge, KnownHost};
use gxs_core::passphrase::Locked;
use gxs_core::profiles::{MAX_PORTABLE_SERVERS, MergeReport, PortableProfiles, PortableSecrets};
use gxs_core::{Error, fsutil, tr};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};
use zeroize::Zeroizing;

use crate::applog::Level;
use crate::commands::{FavoritesFile, merge_favorites};
use crate::settings::{self, Settings, check_path};
use crate::{AppState, Result};

const FORMAT: &str = "gladosxshell-config";
const VERSION: u32 = 1;
const MAX_FILE: u64 = 32 * 1024 * 1024;

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Parts {
    pub settings: bool,
    pub connections: bool,
    pub favorites: bool,
    pub known_hosts: bool,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Bundle {
    format: String,
    version: u32,
    #[serde(default)]
    app_version: String,
    #[serde(default)]
    exported_at: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    settings: Option<Settings>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    custom_css: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    connections: Option<PortableProfiles>,
    /// `PortableSecrets` as JSON, locked with the export password.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    secrets: Option<Locked>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    favorites: Option<FavoritesFile>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    known_hosts: Option<Vec<KnownHost>>,
}

impl Bundle {
    fn parse(bytes: &[u8]) -> Result<Self> {
        let bundle: Self = serde_json::from_slice(bytes).map_err(|e| {
            let e = ltr(&e.to_string());
            Error::Data(tr!(
                "不是有效的配置文件：{e}",
                "Not a valid configuration file: {e}",
                "ئىناۋەتلىك سەپلىمە ھۆججىتى ئەمەس: {e}"
            ))
        })?;
        if bundle.format != FORMAT {
            return Err(Error::Data(tr!(
                "这不是 GladosXshell 导出的配置文件",
                "This is not a configuration file exported by GladosXshell",
                "بۇ GladosXshell چىقارغان سەپلىمە ھۆججىتى ئەمەس"
            )));
        }
        if bundle.version > VERSION {
            return Err(Error::Data(tr!(
                "配置文件来自更新的版本，请先升级 GladosXshell",
                "The configuration file comes from a newer version. Update GladosXshell first",
                "سەپلىمە ھۆججىتى تېخىمۇ يېڭى نەشردىن كەلگەن، ئالدى بىلەن GladosXshell نى يېڭىلاڭ"
            )));
        }
        Ok(bundle)
    }

    /// The secrets in plaintext; empty when the file has none or no password was given.
    async fn unlock(&self, password: Option<Zeroizing<String>>) -> Result<PortableSecrets> {
        let (Some(locked), Some(password)) = (self.secrets.clone(), password.filter(|p| !p.is_empty())) else {
            return Ok(PortableSecrets::new());
        };
        tokio::task::spawn_blocking(move || {
            let plain = locked.unlock(&password)?;
            serde_json::from_slice(&plain).map_err(|_| {
                Error::Data(tr!(
                    "配置文件里的密码部分已损坏",
                    "The password part of the configuration file is damaged",
                    "سەپلىمە ھۆججىتىدىكى ئىم قىسمى بۇزۇلغان"
                ))
            })
        })
        .await
        .map_err(|e| Error::Io(std::io::Error::other(e.to_string())))?
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BundleInfo {
    app_version: String,
    exported_at: u64,
    settings: bool,
    custom_css: bool,
    groups: usize,
    servers: usize,
    secrets: bool,
    favorites: usize,
    known_hosts: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportSummary {
    servers: usize,
    secrets: usize,
    favorites: usize,
    known_hosts: usize,
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Counted {
    added: usize,
    skipped: usize,
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportSummary {
    settings: bool,
    custom_css: bool,
    connections: Option<MergeReport>,
    favorites: Option<Counted>,
    known_hosts: Option<HostsMerge>,
}

async fn read_bundle(path: &str) -> Result<Bundle> {
    let path = PathBuf::from(check_path(
        path,
        &tr!("配置文件路径", "configuration file path", "سەپلىمە ھۆججىتى يولى"),
    )?);
    if tokio::fs::metadata(&path).await?.len() > MAX_FILE {
        return Err(Error::Data(tr!(
            "配置文件超过 32 MB，不像是导出的配置",
            "The configuration file is larger than 32 MB and does not look like an exported configuration",
            "سەپلىمە ھۆججىتى 32 MB دىن ئېشىپ كەتتى، چىقىرىلغان سەپلىمىگە ئوخشىمايدۇ"
        )));
    }
    Bundle::parse(&tokio::fs::read(&path).await?)
}

#[tauri::command]
pub async fn config_export(
    state: State<'_, AppState>,
    path: String,
    parts: Parts,
    password: Option<Zeroizing<String>>,
) -> Result<ExportSummary> {
    let target = PathBuf::from(check_path(&path, &tr!("导出路径", "export path", "چىقىرىش يولى"))?);
    if target.as_os_str().is_empty() {
        return Err(Error::Invalid(tr!(
            "请选择导出位置",
            "Choose where to export to",
            "چىقىرىدىغان ئورۇننى تاللاڭ"
        )));
    }
    let password = password.filter(|p| !p.is_empty() && parts.connections);
    if let Some(password) = &password {
        gxs_core::passphrase::check_password(password)?;
    }
    let mut bundle = Bundle {
        format: FORMAT.into(),
        version: VERSION,
        app_version: env!("CARGO_PKG_VERSION").into(),
        exported_at: fsutil::now_secs(),
        settings: None,
        custom_css: None,
        connections: None,
        secrets: None,
        favorites: None,
        known_hosts: None,
    };
    let mut secrets = 0;
    if parts.settings {
        bundle.settings = Some(state.settings.get().await);
        let css = settings::custom_css_get(state.clone()).await?;
        bundle.custom_css = (!css.trim().is_empty()).then_some(css);
    }
    if parts.connections {
        let (profiles, opened) = state.profiles.export(password.is_some()).await?;
        if let Some(password) = &password {
            secrets = opened.len();
            let plain = Zeroizing::new(serde_json::to_vec(&opened).map_err(|e| Error::Data(e.to_string()))?);
            drop(opened);
            let password = password.clone();
            bundle.secrets = Some(
                tokio::task::spawn_blocking(move || Locked::lock(&password, &plain))
                    .await
                    .map_err(|e| Error::Io(std::io::Error::other(e.to_string())))??,
            );
        }
        bundle.connections = Some(profiles);
    }
    if parts.favorites {
        bundle.favorites = Some(state.favorites.get().await?);
    }
    if parts.known_hosts {
        bundle.known_hosts = Some(state.known_hosts.list().await);
    }
    let summary = ExportSummary {
        servers: bundle.connections.as_ref().map_or(0, |c| c.servers.len()),
        secrets,
        favorites: bundle.favorites.as_ref().map_or(0, |f| f.items.len()),
        known_hosts: bundle.known_hosts.as_ref().map_or(0, Vec::len),
    };
    let body = serde_json::to_vec_pretty(&bundle).map_err(|e| Error::Data(e.to_string()))?;
    fsutil::write_atomic(&target, body).await?;
    let shown = ltr(&target.display().to_string());
    let text = if bundle.secrets.is_some() {
        tr!(
            "已导出配置到 {shown}，含 {secrets} 台服务器的密码（已用导出密码加密）",
            "Exported the configuration to {shown}, with passwords for {secrets} servers (encrypted with the export password)",
            "سەپلىمە {shown} غا چىقىرىلدى، {secrets} مۇلازىمېتىرنىڭ ئىمى بار (چىقىرىش ئىمى بىلەن شىفىرلانغان)"
        )
    } else {
        tr!(
            "已导出配置到 {shown}，不含密码",
            "Exported the configuration to {shown}, without passwords",
            "سەپلىمە {shown} غا چىقىرىلدى، ئىم يوق"
        )
    };
    state.log.add(Level::Info, text).await;
    Ok(summary)
}

#[tauri::command]
pub async fn config_inspect(path: String) -> Result<BundleInfo> {
    let bundle = read_bundle(&path).await?;
    Ok(BundleInfo {
        app_version: bundle.app_version,
        exported_at: bundle.exported_at,
        settings: bundle.settings.is_some(),
        custom_css: bundle.custom_css.is_some(),
        groups: bundle.connections.as_ref().map_or(0, |c| c.groups.len()),
        servers: bundle.connections.as_ref().map_or(0, |c| c.servers.len()),
        secrets: bundle.secrets.is_some(),
        favorites: bundle.favorites.as_ref().map_or(0, |f| f.items.len()),
        known_hosts: bundle.known_hosts.as_ref().map_or(0, Vec::len),
    })
}

/// Settings and custom CSS are replaced; everything else is merged. A wrong password fails the
/// whole import before anything is written.
#[tauri::command]
pub async fn config_import(
    app: AppHandle,
    state: State<'_, AppState>,
    path: String,
    parts: Parts,
    password: Option<Zeroizing<String>>,
) -> Result<ImportSummary> {
    let bundle = read_bundle(&path).await?;
    if bundle
        .connections
        .as_ref()
        .is_some_and(|c| c.servers.len() > MAX_PORTABLE_SERVERS)
    {
        return Err(Error::Data(tr!(
            "一次最多导入 {MAX_PORTABLE_SERVERS} 台服务器",
            "At most {MAX_PORTABLE_SERVERS} servers can be imported at a time",
            "بىر قېتىمدا ئەڭ كۆپ بولغاندا {MAX_PORTABLE_SERVERS} مۇلازىمېتىر ئەكىرگىلى بولىدۇ"
        )));
    }
    let secrets = if parts.connections {
        bundle.unlock(password).await?
    } else {
        PortableSecrets::new()
    };

    let mut summary = ImportSummary::default();
    if parts.settings {
        if let Some(imported) = bundle.settings {
            settings::settings_set(app, state.clone(), imported).await?;
            summary.settings = true;
        }
        if let Some(css) = bundle.custom_css {
            settings::custom_css_set(state.clone(), css).await?;
            summary.custom_css = true;
        }
    }
    if parts.connections
        && let Some(connections) = bundle.connections
    {
        summary.connections = Some(state.profiles.merge(connections, secrets).await?);
    }
    if parts.favorites
        && let Some(favorites) = bundle.favorites
    {
        let (added, skipped) = state
            .favorites
            .update(|file| Ok(merge_favorites(file, favorites)))
            .await?;
        summary.favorites = Some(Counted { added, skipped });
    }
    if parts.known_hosts
        && let Some(hosts) = bundle.known_hosts
    {
        summary.known_hosts = Some(state.known_hosts.merge(hosts).await?);
    }
    let shown = ltr(&path);
    let text = tr!(
        "已从 {shown} 导入配置",
        "Imported the configuration from {shown}",
        "سەپلىمە {shown} دىن ئەكىرىلدى"
    );
    state.log.add(Level::Info, text).await;
    Ok(summary)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn foreign_and_future_files_are_rejected() {
        assert!(Bundle::parse(b"{}").is_err());
        assert!(Bundle::parse(br#"{"format":"other","version":1}"#).is_err());
        assert!(Bundle::parse(br#"{"format":"gladosxshell-config","version":99}"#).is_err());
        let ok = Bundle::parse(br#"{"format":"gladosxshell-config","version":1,"settings":{}}"#).unwrap();
        assert!(ok.settings.is_some() && ok.connections.is_none());
    }

    #[tokio::test]
    async fn secrets_need_the_right_password() {
        let plain = serde_json::to_vec(&PortableSecrets::new()).unwrap();
        let mut bundle = Bundle::parse(br#"{"format":"gladosxshell-config","version":1}"#).unwrap();
        assert!(
            bundle
                .unlock(Some(Zeroizing::new("whatever".into())))
                .await
                .unwrap()
                .is_empty()
        );
        bundle.secrets = Some(Locked::lock("correct horse", &plain).unwrap());
        assert!(bundle.unlock(Some(Zeroizing::new("wrong horse".into()))).await.is_err());
        assert!(bundle.unlock(None).await.unwrap().is_empty());
        assert!(
            bundle
                .unlock(Some(Zeroizing::new("correct horse".into())))
                .await
                .is_ok()
        );
    }

    #[test]
    fn exported_shape_has_no_secret_fields_without_a_password() {
        let bundle = Bundle {
            format: FORMAT.into(),
            version: VERSION,
            app_version: String::new(),
            exported_at: 0,
            settings: Some(Settings::default()),
            custom_css: None,
            connections: Some(PortableProfiles::default()),
            secrets: None,
            favorites: None,
            known_hosts: None,
        };
        let json = serde_json::to_string(&bundle).unwrap();
        assert!(!json.contains("secret"));
        assert!(!json.contains("customCss"));
        let back = Bundle::parse(json.as_bytes()).unwrap();
        assert_eq!(back.settings, Some(Settings::default()));
    }
}
