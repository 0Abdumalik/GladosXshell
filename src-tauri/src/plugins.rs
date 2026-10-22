//! Third-party plugins: the plugin folder, manifests, permission grants, per-plugin storage, and
//! the `gxplugin` protocol their sandboxed frames load from.

use std::collections::BTreeMap;
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};

use gxs_core::i18n::{Lang, ltr};
use gxs_core::{Error, fsutil, tr};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use tauri::http::{Request, Response, StatusCode, header};
use tauri::{AppHandle, Manager, State};
use tokio::sync::Mutex;

use crate::settings::valid_plugin_id;
use crate::store::JsonStore;
use crate::{AppState, Result, open_error};

/// Plugin API version this build implements.
pub const ENGINE: u32 = 1;
const MANIFEST: &str = "plugin.json";
const MAX_MANIFEST_BYTES: u64 = 256 * 1024;
const MAX_INSTALL_BYTES: u64 = 32 * 1024 * 1024;
const MAX_INSTALL_FILES: usize = 2000;
const MAX_DEPTH: usize = 16;
const MAX_SERVED_BYTES: u64 = 16 * 1024 * 1024;
const MAX_STORAGE_BYTES: usize = 1024 * 1024;
const MAX_KEY: usize = 128;
const MAX_PERMISSIONS: usize = 32;
const MAX_LOCALE_ENTRIES: usize = 500;
const MAX_LOCALE_TEXT: usize = 500;
/// Fields under `contributes` whose text `locales` translates.
const LOCALIZED_FIELDS: &[&str] = &["title", "label", "description", "placeholder"];

const PERMISSIONS: &[&str] = &[
    "sessions.read",
    "sessions.exec",
    "terminal.read",
    "terminal.input",
    "terminal.write",
    "files.read",
    "files.write",
    "profiles.read",
    "profiles.write",
    "clipboard",
];
const CONTRIBUTIONS: &[&str] = &[
    "commands",
    "menus",
    "keybindings",
    "panels",
    "themes",
    "completions",
    "snippets",
    "terminalHighlights",
    "configuration",
    "icons",
];

/// `plugin.json`. Contributions are checked for shape here and interpreted by the frontend.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Manifest {
    pub id: String,
    pub name: String,
    pub version: String,
    pub engine: u32,
    #[serde(default)]
    pub description: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub author: Option<String>,
    /// Script run in the plugin's hidden frame; a plugin without one only declares contributions.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub main: Option<String>,
    #[serde(default)]
    pub permissions: Vec<String>,
    #[serde(default)]
    pub contributes: Map<String, Value>,
    /// The manifest's own text in other languages: language code → original text → translation.
    /// Applied when the manifest is read, so the frontend only sees the current language.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub locales: BTreeMap<String, BTreeMap<String, String>>,
}

fn invalid(message: impl Into<String>) -> Error {
    Error::Invalid(message.into())
}

fn plain_text(value: &str, max: usize) -> bool {
    !value.trim().is_empty() && value.chars().count() <= max && !value.chars().any(char::is_control)
}

/// A file inside the plugin folder: `/`-separated plain names, no dot files, no `..`.
pub(crate) fn valid_rel_path(path: &str) -> bool {
    path.len() <= 256
        && path.split('/').all(|part| {
            !part.is_empty()
                && !part.starts_with('.')
                && part.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-'))
        })
}

fn valid_name(name: &str) -> bool {
    (1..=32).contains(&name.len()) && name.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}

/// `http:<host>` or `http:<host>:<port>`: the one host a plugin may send requests to.
fn valid_http_permission(permission: &str) -> bool {
    let Some(target) = permission.strip_prefix("http:") else { return false };
    let (host, port) = match target.rsplit_once(':') {
        Some((host, port)) => (host, Some(port)),
        None => (target, None),
    };
    let host_ok = (1..=253).contains(&host.len())
        && host.split('.').all(|label| {
            (1..=63).contains(&label.len())
                && !label.starts_with('-')
                && !label.ends_with('-')
                && label.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
        });
    host_ok && port.is_none_or(|p| p.parse::<u16>().is_ok_and(|p| p > 0))
}

pub(crate) fn valid_permission(permission: &str) -> bool {
    PERMISSIONS.contains(&permission) || valid_http_permission(permission)
}

impl Manifest {
    pub fn validate(&self) -> Result<()> {
        if !valid_plugin_id(&self.id) {
            return Err(invalid(tr!(
                "插件 id 必须是 作者.名称 的形式，只能用小写字母、数字和连字符",
                "The plugin id must look like author.name and use only lowercase letters, digits and hyphens",
                "قىستۇرما id سى «ئاپتور.نام» شەكلىدە بولۇشى، پەقەت كىچىك ھەرپ، رەقەم ۋە سىزىقچە ئىشلىتىشى كېرەك"
            )));
        }
        if self.id.starts_with("gx.") {
            return Err(invalid(tr!(
                "gx. 开头的 id 留给内置插件",
                "Ids starting with gx. are reserved for built-in plugins",
                "gx. بىلەن باشلانغان id لار ئىچكى قىستۇرمىلارغا ئاتالغان"
            )));
        }
        if !plain_text(&self.name, 64) {
            return Err(invalid(tr!(
                "插件名称不能为空，最长 64 个字符",
                "The plugin name can't be empty and can be at most 64 characters",
                "قىستۇرما نامى بوش بولسا بولمايدۇ، ئەڭ ئۇزۇن 64 ھەرپ"
            )));
        }
        let version_ok = (1..=32).contains(&self.version.len())
            && self.version.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'-' | b'+'));
        if !version_ok {
            return Err(invalid(tr!(
                "版本号格式不正确",
                "The version number is not valid",
                "نەشر نومۇرىنىڭ فورماتى توغرا ئەمەس"
            )));
        }
        if self.engine == 0 || self.engine > ENGINE {
            let engine = self.engine;
            return Err(invalid(tr!(
                "插件需要接口版本 {engine}，当前软件支持 {ENGINE}，请更新 GladosXshell",
                "The plugin needs API version {engine}, but this GladosXshell supports {ENGINE}. Update GladosXshell",
                "قىستۇرما API نىڭ {engine}-نەشرىنى تەلەپ قىلىدۇ، بۇ GladosXshell پەقەت {ENGINE}-نەشرىنى قوللايدۇ؛ GladosXshell نى يېڭىلاڭ"
            )));
        }
        if self.description.chars().count() > 500 || self.description.chars().any(|c| c.is_control() && c != '\n') {
            return Err(invalid(tr!(
                "插件说明最长 500 个字符",
                "The plugin description can be at most 500 characters",
                "قىستۇرما چۈشەندۈرۈشى ئەڭ ئۇزۇن 500 ھەرپ بولىدۇ"
            )));
        }
        if self.author.as_deref().is_some_and(|a| !plain_text(a, 64)) {
            return Err(invalid(tr!(
                "作者名最长 64 个字符",
                "The author name can be at most 64 characters",
                "ئاپتور نامى ئەڭ ئۇزۇن 64 ھەرپ بولىدۇ"
            )));
        }
        if self.main.as_deref().is_some_and(|m| !valid_rel_path(m) || !m.ends_with(".js")) {
            return Err(invalid(tr!(
                "main 必须是插件目录里的 .js 文件",
                "main must be a .js file inside the plugin folder",
                "main چوقۇم قىستۇرما قىسقۇچىدىكى .js ھۆججىتى بولۇشى كېرەك"
            )));
        }
        if self.permissions.len() > MAX_PERMISSIONS {
            return Err(invalid(tr!(
                "声明的权限太多",
                "The plugin declares too many permissions",
                "ئېلان قىلىنغان ھوقۇق بەك كۆپ"
            )));
        }
        if let Some(bad) = self.permissions.iter().find(|p| !valid_permission(p)) {
            let bad = ltr(bad);
            return Err(invalid(tr!("未知的权限：{bad}", "Unknown permission: {bad}", "نامەلۇم ھوقۇق: {bad}")));
        }
        for (key, value) in &self.contributes {
            if !CONTRIBUTIONS.contains(&key.as_str()) {
                let key = ltr(key);
                return Err(invalid(tr!(
                    "未知的贡献类型：{key}",
                    "Unknown contribution type: {key}",
                    "نامەلۇم تۆھپە تۈرى: {key}"
                )));
            }
            let shape_ok = match key.as_str() {
                "menus" | "completions" | "icons" => value.is_object(),
                _ => value.is_array(),
            };
            if !shape_ok {
                let field = ltr(&format!("contributes.{key}"));
                return Err(invalid(tr!(
                    "{field} 的格式不正确",
                    "{field} has the wrong format",
                    "{field} نىڭ فورماتى توغرا ئەمەس"
                )));
            }
        }
        for (code, table) in &self.locales {
            let text_ok = |text: &str| {
                text.chars().count() <= MAX_LOCALE_TEXT && !text.chars().any(|c| c.is_control() && c != '\n')
            };
            if Lang::from_code(code).is_none() {
                let code = ltr(code);
                return Err(invalid(tr!(
                    "locales 里的语言 {code} 不受支持，只能用 zh、en、ug",
                    "The locales language {code} is not supported; use zh, en or ug",
                    "locales دىكى {code} تىلى قوللانمايدۇ، پەقەت zh، en ۋە ug نى ئىشلىتىڭ"
                )));
            }
            if table.len() > MAX_LOCALE_ENTRIES || !table.iter().all(|(from, to)| text_ok(from) && text_ok(to)) {
                let code = ltr(code);
                return Err(invalid(tr!(
                    "locales.{code} 最多 {MAX_LOCALE_ENTRIES} 条，每段文字最长 {MAX_LOCALE_TEXT} 个字符",
                    "locales.{code} can have up to {MAX_LOCALE_ENTRIES} entries of at most {MAX_LOCALE_TEXT} characters each",
                    "locales.{code} دا ئەڭ كۆپ {MAX_LOCALE_ENTRIES} تۈر بولىدۇ، ھەر بىرى ئەڭ ئۇزۇن {MAX_LOCALE_TEXT} ھەرپ"
                )));
            }
        }
        if let Some(panels) = self.contributes.get("panels").and_then(Value::as_array) {
            for panel in panels {
                let id = panel.get("id").and_then(Value::as_str).unwrap_or_default();
                let page = panel.get("page").and_then(Value::as_str).unwrap_or_default();
                if !valid_name(id) || !valid_rel_path(page) || !page.ends_with(".html") {
                    return Err(invalid(tr!(
                        "面板需要 id（小写字母、数字、连字符）和插件目录里的 .html 页面",
                        "A panel needs an id (lowercase letters, digits and hyphens) and an .html page inside the plugin folder",
                        "تاختىغا id (كىچىك ھەرپ، رەقەم ۋە سىزىقچە) ۋە قىستۇرما قىسقۇچىدىكى .html بەت كېرەك"
                    )));
                }
            }
        }
        Ok(())
    }
}

impl Manifest {
    /// The manifest with its text in `lang` where `locales` has a translation. A translated name
    /// that breaks the name rules keeps the original.
    pub fn localized(mut self, lang: Lang) -> Manifest {
        let locales = std::mem::take(&mut self.locales);
        let Some(table) = locales.get(lang.code()) else { return self };
        if let Some(name) = table.get(&self.name).filter(|name| plain_text(name, 64)) {
            self.name = name.clone();
        }
        if let Some(description) = table.get(&self.description) {
            self.description = description.clone();
        }
        for (kind, value) in &mut self.contributes {
            // Icon and completion data are not interface text.
            if kind != "icons" && kind != "completions" {
                translate_fields(value, table);
            }
        }
        self
    }
}

fn translate_fields(value: &mut Value, table: &BTreeMap<String, String>) {
    match value {
        Value::Object(map) => {
            for (key, item) in map.iter_mut() {
                match item {
                    Value::String(text) if LOCALIZED_FIELDS.contains(&key.as_str()) => {
                        if let Some(translated) = table.get(text.as_str()) {
                            *text = translated.clone();
                        }
                    }
                    _ => translate_fields(item, table),
                }
            }
        }
        Value::Array(items) => items.iter_mut().for_each(|item| translate_fields(item, table)),
        _ => {}
    }
}

fn manifest_missing() -> Error {
    invalid(tr!("没有找到 plugin.json", "plugin.json not found", "plugin.json تېپىلمىدى"))
}

fn read_manifest(dir: &Path) -> Result<Manifest> {
    let path = dir.join(MANIFEST);
    let file = fs::File::open(&path).map_err(|e| match e.kind() {
        std::io::ErrorKind::NotFound => manifest_missing(),
        _ => Error::Io(e),
    })?;
    let mut bytes = Vec::new();
    file.take(MAX_MANIFEST_BYTES + 1).read_to_end(&mut bytes)?;
    if bytes.len() as u64 > MAX_MANIFEST_BYTES {
        return Err(invalid(tr!("plugin.json 太大", "plugin.json is too large", "plugin.json بەك چوڭ")));
    }
    let manifest: Manifest = serde_json::from_slice(&bytes).map_err(|e| {
        let e = ltr(&e.to_string());
        invalid(tr!(
            "plugin.json 无法解析：{e}",
            "Could not parse plugin.json: {e}",
            "plugin.json نى تەھلىل قىلغىلى بولمىدى: {e}"
        ))
    })?;
    manifest.validate()?;
    Ok(manifest.localized(gxs_core::i18n::current()))
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Grants {
    #[serde(default)]
    grants: BTreeMap<String, Vec<String>>,
}

pub(crate) struct Plugins {
    root: PathBuf,
    data: PathBuf,
    grants: JsonStore<Grants>,
    storage: Mutex<()>,
}

impl Plugins {
    pub async fn open(config_dir: &Path) -> (Self, Option<String>) {
        let (grants, problem) = JsonStore::open(config_dir.join("plugins.json"), false).await;
        let plugins = Self {
            root: config_dir.join("plugins"),
            data: config_dir.join("plugin-data"),
            grants,
            storage: Mutex::new(()),
        };
        let problem = problem.map(|p| {
            tr!(
                "{p}，插件授权已重置",
                "{p}; plugin grants were reset",
                "{p}؛ قىستۇرما رۇخسەتلىرى ئەسلىگە قايتۇرۇلدى"
            )
        });
        (plugins, problem)
    }

    fn dir(&self, id: &str) -> Result<PathBuf> {
        plugin_dir(&self.root, id)
    }

    /// Fails unless the installed plugin declares `permission` and the user granted it. The
    /// frontend host checks first; this keeps the backend from trusting it alone.
    pub(crate) async fn require(&self, id: &str, permission: &str) -> Result<()> {
        let manifest = {
            let root = self.root.clone();
            let id = id.to_owned();
            blocking(move || installed_manifest(&root, &id)).await?
        };
        let grants = self.grants.get().await?;
        if holds(&manifest, &grants, permission) {
            Ok(())
        } else {
            let permission = ltr(permission);
            Err(invalid(tr!(
                "插件没有获得权限 {permission}",
                "The plugin has not been granted {permission}",
                "قىستۇرمىغا {permission} ھوقۇقى بېرىلمىگەن"
            )))
        }
    }
}

fn holds(manifest: &Manifest, grants: &Grants, permission: &str) -> bool {
    manifest.permissions.iter().any(|p| p == permission)
        && grants.grants.get(&manifest.id).is_some_and(|g| g.iter().any(|p| p == permission))
}

fn plugin_dir(root: &Path, id: &str) -> Result<PathBuf> {
    if !valid_plugin_id(id) || id.starts_with("gx.") {
        return Err(invalid(tr!("插件 id 不正确", "The plugin id is not valid", "قىستۇرما id سى توغرا ئەمەس")));
    }
    Ok(root.join(id))
}

fn installed_manifest(root: &Path, id: &str) -> Result<Manifest> {
    let manifest = read_manifest(&plugin_dir(root, id)?)?;
    if manifest.id != id {
        return Err(invalid(tr!(
            "plugin.json 里的 id 和目录名不一致",
            "The id in plugin.json does not match the folder name",
            "plugin.json دىكى id قىسقۇچ نامى بىلەن ماس ئەمەس"
        )));
    }
    Ok(manifest)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Installed {
    id: String,
    manifest: Option<Manifest>,
    error: Option<String>,
    granted: Vec<String>,
}

fn list_installed(root: &Path, grants: &Grants) -> Result<Vec<Installed>> {
    let entries = match fs::read_dir(root) {
        Ok(entries) => entries,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(e.into()),
    };
    let mut out = Vec::new();
    for entry in entries {
        let entry = entry?;
        let Ok(id) = entry.file_name().into_string() else { continue };
        // Staging folders and stray files are not plugins.
        if !entry.file_type()?.is_dir() || !valid_plugin_id(&id) || id.starts_with("gx.") {
            continue;
        }
        let (manifest, error) = match installed_manifest(root, &id) {
            Ok(m) => (Some(m), None),
            Err(e) => (None, Some(e.to_string())),
        };
        let declared = manifest.as_ref().map(|m| m.permissions.as_slice()).unwrap_or_default();
        let granted = grants
            .grants
            .get(&id)
            .map(|g| g.iter().filter(|p| declared.contains(p)).cloned().collect())
            .unwrap_or_default();
        out.push(Installed { id, manifest, error, granted });
    }
    out.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(out)
}

static STAGING: AtomicU32 = AtomicU32::new(0);

fn unique(prefix: &str) -> String {
    format!("{prefix}{}-{}", std::process::id(), STAGING.fetch_add(1, Ordering::Relaxed))
}

struct Budget {
    bytes: u64,
    files: usize,
}

impl Budget {
    fn new() -> Self {
        Self { bytes: 0, files: 0 }
    }

    fn add_file(&mut self) -> Result<()> {
        self.files += 1;
        if self.files > MAX_INSTALL_FILES {
            return Err(invalid(tr!(
                "插件文件太多（最多 {MAX_INSTALL_FILES} 个）",
                "The plugin has too many files (at most {MAX_INSTALL_FILES})",
                "قىستۇرما ھۆججىتى بەك كۆپ (ئەڭ كۆپ بولغاندا {MAX_INSTALL_FILES})"
            )));
        }
        Ok(())
    }

    fn remaining(&self) -> u64 {
        MAX_INSTALL_BYTES - self.bytes
    }

    fn add_bytes(&mut self, n: u64) -> Result<()> {
        self.bytes += n;
        if self.bytes > MAX_INSTALL_BYTES {
            let mb = MAX_INSTALL_BYTES / 1024 / 1024;
            return Err(invalid(tr!(
                "插件太大（最多 {mb} MB）",
                "The plugin is too large (at most {mb} MB)",
                "قىستۇرما بەك چوڭ (ئەڭ كۆپ بولغاندا {mb} MB)"
            )));
        }
        Ok(())
    }
}

fn too_deep() -> Error {
    invalid(tr!(
        "插件目录层级太深",
        "The plugin folder is nested too deeply",
        "قىستۇرما قىسقۇچىنىڭ قاتلىمى بەك چوڭقۇر"
    ))
}

fn has_symlink() -> Error {
    invalid(tr!(
        "插件里不能包含符号链接",
        "A plugin can't contain symbolic links",
        "قىستۇرمىدا بەلگە ئۇلانمىسى بولسا بولمايدۇ"
    ))
}

fn copy_tree(from: &Path, to: &Path, depth: usize, budget: &mut Budget) -> Result<()> {
    if depth > MAX_DEPTH {
        return Err(too_deep());
    }
    fs::create_dir_all(to)?;
    for entry in fs::read_dir(from)? {
        let entry = entry?;
        let name = entry.file_name();
        if name.to_string_lossy().starts_with('.') {
            continue;
        }
        let kind = entry.file_type()?;
        if kind.is_symlink() {
            return Err(has_symlink());
        }
        if kind.is_dir() {
            copy_tree(&entry.path(), &to.join(&name), depth + 1, budget)?;
        } else if kind.is_file() {
            budget.add_file()?;
            budget.add_bytes(entry.metadata()?.len())?;
            fs::copy(entry.path(), to.join(&name))?;
        }
    }
    Ok(())
}

fn zip_error(e: zip::result::ZipError) -> Error {
    let e = ltr(&e.to_string());
    invalid(tr!(
        "插件包无法解压：{e}",
        "Could not unpack the plugin package: {e}",
        "قىستۇرما بولىقىنى يېشەلمىدى: {e}"
    ))
}

fn extract_zip(archive: &Path, to: &Path, budget: &mut Budget) -> Result<()> {
    let mut zip = zip::ZipArchive::new(fs::File::open(archive)?).map_err(zip_error)?;
    fs::create_dir_all(to)?;
    for index in 0..zip.len() {
        let mut file = zip.by_index(index).map_err(zip_error)?;
        // enclosed_name rejects absolute paths and `..`, so nothing lands outside `to`.
        let rel = file.enclosed_name().ok_or_else(|| {
            invalid(tr!(
                "插件包里有不安全的路径",
                "The plugin package contains an unsafe path",
                "قىستۇرما بولىقىدا بىخەتەر بولمىغان يول بار"
            ))
        })?;
        if rel.components().count() > MAX_DEPTH {
            return Err(too_deep());
        }
        if file.is_symlink() {
            return Err(has_symlink());
        }
        let target = to.join(rel);
        if file.is_dir() {
            fs::create_dir_all(&target)?;
            continue;
        }
        budget.add_file()?;
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent)?;
        }
        let mut out = fs::File::create(&target)?;
        let written = std::io::copy(&mut (&mut file).take(budget.remaining() + 1), &mut out)?;
        out.flush()?;
        budget.add_bytes(written)?;
    }
    Ok(())
}

/// The folder holding plugin.json: the unpacked root, or its only subfolder.
fn manifest_dir(staging: &Path) -> Result<PathBuf> {
    if staging.join(MANIFEST).is_file() {
        return Ok(staging.to_path_buf());
    }
    let mut dirs = fs::read_dir(staging)?
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_ok_and(|t| t.is_dir()))
        .map(|e| e.path());
    match (dirs.next(), dirs.next()) {
        (Some(only), None) if only.join(MANIFEST).is_file() => Ok(only),
        _ => Err(manifest_missing()),
    }
}

/// Unpacks or copies `source` (a folder or a `.gxplugin`/`.zip` file), checks it, and swaps it in.
fn install(root: &Path, source: &Path) -> Result<Manifest> {
    let meta = fs::metadata(source).map_err(|_| {
        invalid(tr!(
            "找不到要安装的插件",
            "The plugin to install was not found",
            "ئورنىتىدىغان قىستۇرما تېپىلمىدى"
        ))
    })?;
    fs::create_dir_all(root)?;
    let staging = root.join(unique(".staging-"));
    let result = (|| {
        let mut budget = Budget::new();
        if meta.is_dir() {
            copy_tree(source, &staging, 0, &mut budget)?;
        } else {
            extract_zip(source, &staging, &mut budget)?;
        }
        let dir = manifest_dir(&staging)?;
        let manifest = read_manifest(&dir)?;
        if let Some(main) = &manifest.main
            && !dir.join(main).is_file()
        {
            let main = ltr(main);
            return Err(invalid(tr!(
                "找不到入口文件 {main}",
                "Entry file {main} not found",
                "{main} كىرىش ھۆججىتى تېپىلمىدى"
            )));
        }
        let target = root.join(&manifest.id);
        if target.exists() {
            let old = root.join(unique(".old-"));
            fs::rename(&target, &old)?;
            if let Err(e) = fs::rename(&dir, &target) {
                let _ = fs::rename(&old, &target);
                return Err(e.into());
            }
            let _ = fs::remove_dir_all(&old);
        } else {
            fs::rename(&dir, &target)?;
        }
        Ok(manifest)
    })();
    let _ = fs::remove_dir_all(&staging);
    result
}

async fn blocking<T: Send + 'static>(work: impl FnOnce() -> Result<T> + Send + 'static) -> Result<T> {
    tokio::task::spawn_blocking(work)
        .await
        .map_err(|e| Error::Io(std::io::Error::other(e.to_string())))?
}

#[tauri::command]
pub async fn plugins_list(state: State<'_, AppState>) -> Result<Vec<Installed>> {
    let grants = state.plugins.grants.get().await.unwrap_or_default();
    let root = state.plugins.root.clone();
    blocking(move || list_installed(&root, &grants)).await
}

#[tauri::command]
pub async fn plugin_install(state: State<'_, AppState>, path: String) -> Result<Manifest> {
    let root = state.plugins.root.clone();
    let manifest = blocking(move || install(&root, Path::new(&path))).await?;
    // An update may ask for less; grants for permissions it no longer declares are dropped.
    let declared = manifest.permissions.clone();
    let id = manifest.id.clone();
    state
        .plugins
        .grants
        .update(|g| {
            if let Some(list) = g.grants.get_mut(&id) {
                list.retain(|p| declared.contains(p));
            }
            Ok(())
        })
        .await?;
    Ok(manifest)
}

#[tauri::command]
pub async fn plugin_remove(state: State<'_, AppState>, id: String) -> Result<()> {
    let dir = state.plugins.dir(&id)?;
    let data = state.plugins.data.join(format!("{id}.json"));
    blocking(move || {
        match fs::symlink_metadata(&dir) {
            Ok(meta) if meta.is_dir() => fs::remove_dir_all(&dir)?,
            Ok(_) => {
                return Err(invalid(tr!(
                    "插件目录不正确",
                    "The plugin folder is not valid",
                    "قىستۇرما قىسقۇچى توغرا ئەمەس"
                )));
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(e.into()),
        }
        match fs::remove_file(&data) {
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e.into()),
            _ => Ok(()),
        }
    })
    .await?;
    state
        .plugins
        .grants
        .update(|g| {
            g.grants.remove(&id);
            Ok(())
        })
        .await
}

/// Grants permissions the plugin declares; returns everything it now holds.
#[tauri::command]
pub async fn plugin_grant(state: State<'_, AppState>, id: String, permissions: Vec<String>) -> Result<Vec<String>> {
    let manifest = {
        let root = state.plugins.root.clone();
        let id = id.clone();
        blocking(move || installed_manifest(&root, &id)).await?
    };
    if let Some(extra) = permissions.iter().find(|p| !manifest.permissions.contains(p)) {
        let extra = ltr(extra);
        return Err(invalid(tr!(
            "插件没有声明权限 {extra}",
            "The plugin does not declare the permission {extra}",
            "قىستۇرما {extra} ھوقۇقىنى ئېلان قىلمىغان"
        )));
    }
    state
        .plugins
        .grants
        .update(|g| {
            let list = g.grants.entry(id).or_default();
            for permission in permissions {
                if !list.contains(&permission) {
                    list.push(permission);
                }
            }
            Ok(list.clone())
        })
        .await
}

/// Takes back the given permissions, or all of them.
#[tauri::command]
pub async fn plugin_revoke(state: State<'_, AppState>, id: String, permissions: Option<Vec<String>>) -> Result<()> {
    state.plugins.dir(&id)?;
    state
        .plugins
        .grants
        .update(|g| {
            match permissions {
                Some(remove) => {
                    if let Some(list) = g.grants.get_mut(&id) {
                        list.retain(|p| !remove.contains(p));
                    }
                }
                None => {
                    g.grants.remove(&id);
                }
            }
            Ok(())
        })
        .await
}

async fn read_storage(path: &Path) -> Result<Map<String, Value>> {
    Ok(match fsutil::read_optional(path).await? {
        Some(bytes) => serde_json::from_slice(&bytes).unwrap_or_default(),
        None => Map::new(),
    })
}

#[tauri::command]
pub async fn plugin_storage_get(state: State<'_, AppState>, id: String) -> Result<Map<String, Value>> {
    state.plugins.dir(&id)?;
    read_storage(&state.plugins.data.join(format!("{id}.json"))).await
}

/// Sets one key; `null` removes it. The whole store is capped so a plugin cannot fill the disk.
#[tauri::command]
pub async fn plugin_storage_set(
    state: State<'_, AppState>,
    id: String,
    key: String,
    value: Option<Value>,
) -> Result<()> {
    state.plugins.dir(&id)?;
    if !plain_text(&key, MAX_KEY) {
        return Err(invalid(tr!(
            "存储键不能为空，最长 128 个字符",
            "The storage key can't be empty and can be at most 128 characters",
            "ساقلاش ئاچقۇچى بوش بولسا بولمايدۇ، ئەڭ ئۇزۇن 128 ھەرپ"
        )));
    }
    let _guard = state.plugins.storage.lock().await;
    let path = state.plugins.data.join(format!("{id}.json"));
    let mut data = read_storage(&path).await?;
    match value {
        Some(value) if !value.is_null() => {
            data.insert(key, value);
        }
        _ => {
            data.remove(&key);
        }
    }
    let body = serde_json::to_vec(&data).map_err(|e| Error::Data(e.to_string()))?;
    if body.len() > MAX_STORAGE_BYTES {
        return Err(invalid(tr!(
            "插件存储已满（最多 1 MB）",
            "Plugin storage is full (at most 1 MB)",
            "قىستۇرما ساقلىغۇچى توشتى (ئەڭ كۆپ بولغاندا 1 MB)"
        )));
    }
    tokio::fs::create_dir_all(&state.plugins.data).await?;
    fsutil::write_atomic(path, body).await
}

#[tauri::command]
pub async fn plugins_open_dir(state: State<'_, AppState>) -> Result<()> {
    tokio::fs::create_dir_all(&state.plugins.root).await?;
    tauri_plugin_opener::open_path(&state.plugins.root, None::<&str>).map_err(open_error)
}

const SDK: &str = include_str!("../resources/plugin-sdk.js");

/// Everything a plugin frame may load: its own files and the SDK. No network, no nested frames,
/// and `sandbox` again in case a page is ever opened outside its sandboxed iframe.
fn csp(id: &str) -> String {
    let own = |path: &str| format!("http://gxplugin.localhost/{path}/ gxplugin://localhost/{path}/");
    let mine = own(id);
    let sdk = own("__sdk");
    format!(
        "default-src 'none'; script-src {sdk} {mine}; style-src {mine} 'unsafe-inline'; \
         img-src {mine} data: blob:; font-src {mine}; media-src {mine}; connect-src 'none'; \
         frame-src 'none'; worker-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'; \
         sandbox allow-scripts"
    )
}

fn mime(path: &str) -> &'static str {
    match path.rsplit_once('.').map(|(_, ext)| ext.to_ascii_lowercase()).as_deref() {
        Some("html" | "htm") => "text/html; charset=utf-8",
        Some("js" | "mjs") => "text/javascript; charset=utf-8",
        Some("css") => "text/css; charset=utf-8",
        Some("json") => "application/json",
        Some("svg") => "image/svg+xml",
        Some("png") => "image/png",
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("woff2") => "font/woff2",
        Some("woff") => "font/woff",
        Some("txt" | "md") => "text/plain; charset=utf-8",
        _ => "application/octet-stream",
    }
}

fn respond(status: StatusCode, content_type: &str, csp: &str, body: Vec<u8>) -> Response<Vec<u8>> {
    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, content_type)
        .header(header::CONTENT_SECURITY_POLICY, csp)
        .header(header::X_CONTENT_TYPE_OPTIONS, "nosniff")
        .header(header::CACHE_CONTROL, "no-store")
        .body(body)
        .unwrap_or_default()
}

pub(crate) fn not_found() -> Response<Vec<u8>> {
    respond(StatusCode::NOT_FOUND, "text/plain; charset=utf-8", "default-src 'none'", b"not found".to_vec())
}

fn read_capped(path: &Path) -> Option<Vec<u8>> {
    let mut body = Vec::new();
    fs::File::open(path).ok()?.take(MAX_SERVED_BYTES + 1).read_to_end(&mut body).ok()?;
    (body.len() as u64 <= MAX_SERVED_BYTES).then_some(body)
}

/// A file of the plugin, after making sure the resolved path is still inside its folder.
fn plugin_file(root: &Path, id: &str, rel: &str) -> Option<Vec<u8>> {
    if !valid_plugin_id(id) || id.starts_with("gx.") || !valid_rel_path(rel) {
        return None;
    }
    let dir = root.join(id).canonicalize().ok()?;
    let file = dir.join(rel).canonicalize().ok()?;
    if !file.starts_with(&dir) || !file.is_file() {
        return None;
    }
    read_capped(&file)
}

/// The hidden page a plugin's main script runs in.
fn host_page(id: &str, main: &str) -> String {
    format!(
        "<!doctype html><html><head><meta charset=\"utf-8\"><title>{id}</title>\
         <script src=\"/__sdk/gx.js\"></script><script src=\"/{id}/{main}\"></script></head><body></body></html>"
    )
}

pub(crate) fn serve(root: &Path, request: &Request<Vec<u8>>) -> Response<Vec<u8>> {
    if request.method() != tauri::http::Method::GET {
        return not_found();
    }
    let path = request.uri().path().trim_start_matches('/');
    if path == "__sdk/gx.js" {
        let policy = "default-src 'none'";
        return respond(StatusCode::OK, mime(path), policy, SDK.as_bytes().to_vec());
    }
    if let Some(id) = path.strip_prefix("__host/") {
        if !valid_plugin_id(id) || id.starts_with("gx.") {
            return not_found();
        }
        let main = read_manifest(&root.join(id)).ok().filter(|m| m.id == id).and_then(|m| m.main);
        return match main {
            Some(main) => respond(StatusCode::OK, mime("x.html"), &csp(id), host_page(id, &main).into_bytes()),
            None => not_found(),
        };
    }
    let Some((id, rel)) = path.split_once('/') else { return not_found() };
    match plugin_file(root, id, rel) {
        Some(body) => respond(StatusCode::OK, mime(rel), &csp(id), body),
        None => not_found(),
    }
}

pub(crate) fn root(app: &AppHandle) -> Option<PathBuf> {
    app.try_state::<AppState>().map(|state| state.plugins.root.clone())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("gxs-plugins-{name}-{}", unique("")));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn manifest_json(id: &str) -> String {
        format!(
            r#"{{"id":"{id}","name":"Hello","version":"1.0.0","engine":1,"main":"main.js",
               "permissions":["sessions.exec","http:api.example.com:8443"],
               "contributes":{{"commands":[],"panels":[{{"id":"main","page":"panel.html"}}]}}}}"#
        )
    }

    fn write_plugin(dir: &Path, id: &str) {
        fs::create_dir_all(dir).unwrap();
        fs::write(dir.join(MANIFEST), manifest_json(id)).unwrap();
        fs::write(dir.join("main.js"), "gx.ready()").unwrap();
        fs::write(dir.join("panel.html"), "<p>hi</p>").unwrap();
    }

    fn parse(json: &str) -> Result<Manifest> {
        let m: Manifest = serde_json::from_str(json).map_err(|e| invalid(e.to_string()))?;
        m.validate().map(|()| m)
    }

    #[test]
    fn manifests_are_checked() {
        assert!(parse(&manifest_json("author.hello")).is_ok());
        let base = manifest_json("author.hello");
        assert!(parse(&base.replace("author.hello", "gx.files")).is_err());
        assert!(parse(&base.replace("author.hello", "Author.hello")).is_err());
        assert!(parse(&base.replace("\"engine\":1", "\"engine\":2")).is_err());
        assert!(parse(&base.replace("main.js", "../main.js")).is_err());
        assert!(parse(&base.replace("main.js", "/abs.js")).is_err());
        assert!(parse(&base.replace("sessions.exec", "root")).is_err());
        assert!(parse(&base.replace("api.example.com:8443", "API.example.com")).is_err());
        assert!(parse(&base.replace("\"commands\":[]", "\"evil\":[]")).is_err());
        assert!(parse(&base.replace("panel.html", "../panel.html")).is_err());
        assert!(parse(&base.replace("\"commands\":[]", "\"icons\":{\"bell\":\"M0 0Z\"}")).is_ok());
        assert!(parse(&base.replace("\"commands\":[]", "\"icons\":[]")).is_err());
    }

    #[test]
    fn locales_translate_the_manifest_text() {
        let json = r#"{"id":"author.hello","name":"你好","version":"1.0.0","engine":1,"description":"示例",
            "contributes":{"commands":[{"id":"greet","title":"打个招呼"},{"id":"other","title":"别的"}],
                "menus":{"statusbar":[{"label":"打个招呼","command":"greet"}]},
                "icons":{"title":"打个招呼"}},
            "locales":{"en":{"你好":"Hello","示例":"Example","打个招呼":"Say hello"}}}"#;
        let manifest = parse(json).unwrap();
        let en = manifest.clone().localized(Lang::En);
        assert_eq!((en.name.as_str(), en.description.as_str()), ("Hello", "Example"));
        assert_eq!(en.contributes["commands"][0]["title"], "Say hello");
        assert_eq!(en.contributes["commands"][1]["title"], "别的", "untranslated text stays");
        assert_eq!(en.contributes["menus"]["statusbar"][0]["label"], "Say hello");
        assert_eq!(en.contributes["icons"]["title"], "打个招呼", "icons are not text");
        assert!(en.locales.is_empty());
        let ug = manifest.localized(Lang::Ug);
        assert_eq!(ug.name, "你好", "no table for the language");

        assert!(parse(&json.replace(r#""en":"#, r#""fr":"#)).is_err());
        assert!(parse(&json.replace("Say hello", &"x".repeat(MAX_LOCALE_TEXT + 1))).is_err());
        let long = json.replace(r#""你好":"Hello""#, &format!(r#""你好":"{}""#, "x".repeat(65)));
        assert_eq!(parse(&long).unwrap().localized(Lang::En).name, "你好", "names keep their limit");
    }

    #[test]
    fn example_plugins_install() {
        let examples = Path::new(env!("CARGO_MANIFEST_DIR")).join("../examples/plugins");
        let root = temp_dir("examples");
        for (name, id) in [("hello", "gladosx.hello"), ("disk-alert", "gladosx.disk-alert")] {
            let manifest = install(&root, &examples.join(name)).unwrap();
            assert_eq!(manifest.id, id);
        }
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn privileged_calls_need_a_declared_and_granted_permission() {
        let manifest = parse(&manifest_json("author.hello")).unwrap();
        let mut grants = Grants::default();
        assert!(!holds(&manifest, &grants, "sessions.exec"), "declared but not granted");
        grants.grants.insert("author.hello".into(), vec!["sessions.exec".into(), "clipboard".into()]);
        assert!(holds(&manifest, &grants, "sessions.exec"));
        assert!(!holds(&manifest, &grants, "clipboard"), "granted but no longer declared");
        assert!(!holds(&manifest, &grants, "http:api.example.com"), "port must match");
        assert!(!holds(&manifest, &grants, "files.read"));
        grants.grants.insert("author.other".into(), vec!["http:api.example.com:8443".into()]);
        assert!(!holds(&manifest, &grants, "http:api.example.com:8443"), "grants are per plugin");
    }

    #[test]
    fn relative_paths_stay_inside() {
        assert!(valid_rel_path("main.js") && valid_rel_path("ui/panel.html"));
        for bad in ["", "/x", "a//b", "..", "a/../b", ".hidden", "a\\b", "c:x", "a b"] {
            assert!(!valid_rel_path(bad), "{bad}");
        }
        assert!(valid_permission("http:localhost:8080") && !valid_permission("http:-x.com"));
        assert!(!valid_permission("http:a.com:0") && !valid_permission("http:"));
    }

    #[test]
    fn installs_folders_and_replaces_old_versions() {
        let root = temp_dir("root");
        let source = temp_dir("src");
        write_plugin(&source, "author.hello");
        fs::write(source.join(".secret"), "x").unwrap();
        let manifest = install(&root, &source).unwrap();
        assert_eq!(manifest.id, "author.hello");
        assert!(root.join("author.hello/main.js").is_file());
        assert!(!root.join("author.hello/.secret").exists());
        fs::write(source.join("extra.js"), "1").unwrap();
        install(&root, &source).unwrap();
        assert!(root.join("author.hello/extra.js").is_file());
        let leftovers: Vec<_> = fs::read_dir(&root).unwrap().filter_map(|e| e.ok()).collect();
        assert_eq!(leftovers.len(), 1, "staging folders are cleaned up");
        let mut grants = Grants::default();
        grants.grants.insert("author.hello".into(), vec!["sessions.exec".into(), "clipboard".into()]);
        let listed = list_installed(&root, &grants).unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].granted, ["sessions.exec"], "undeclared grants are not reported");
        fs::remove_dir_all(&root).unwrap();
        fs::remove_dir_all(&source).unwrap();
    }

    #[test]
    fn installs_zip_packages_with_a_top_folder() {
        let root = temp_dir("zroot");
        let archive = temp_dir("zsrc").join("hello.gxplugin");
        {
            let mut zip = zip::ZipWriter::new(fs::File::create(&archive).unwrap());
            let options = zip::write::SimpleFileOptions::default();
            zip.start_file("hello/plugin.json", options).unwrap();
            zip.write_all(manifest_json("author.zipped").as_bytes()).unwrap();
            zip.start_file("hello/main.js", options).unwrap();
            zip.write_all(b"1").unwrap();
            zip.finish().unwrap();
        }
        let manifest = install(&root, &archive).unwrap();
        assert_eq!(manifest.id, "author.zipped");
        assert!(root.join("author.zipped/main.js").is_file());
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn zip_slip_is_refused() {
        let root = temp_dir("slip");
        let archive = temp_dir("slipsrc").join("bad.zip");
        {
            let mut zip = zip::ZipWriter::new(fs::File::create(&archive).unwrap());
            let options = zip::write::SimpleFileOptions::default();
            zip.start_file("../escaped.js", options).unwrap();
            zip.write_all(b"1").unwrap();
            zip.finish().unwrap();
        }
        assert!(install(&root, &archive).is_err());
        assert!(!root.parent().unwrap().join("escaped.js").exists());
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn missing_main_is_refused() {
        let root = temp_dir("nomain");
        let source = temp_dir("nomainsrc");
        write_plugin(&source, "author.nomain");
        fs::remove_file(source.join("main.js")).unwrap();
        assert!(install(&root, &source).is_err());
        assert!(!root.join("author.nomain").exists());
    }

    fn get(root: &Path, path: &str) -> Response<Vec<u8>> {
        let request = Request::builder().uri(format!("http://gxplugin.localhost{path}")).body(Vec::new()).unwrap();
        serve(root, &request)
    }

    #[test]
    fn protocol_serves_only_plugin_files() {
        let root = temp_dir("serve");
        write_plugin(&root.join("author.hello"), "author.hello");
        fs::write(root.join("outside.txt"), "secret").unwrap();
        let ok = get(&root, "/author.hello/panel.html");
        assert_eq!(ok.status(), StatusCode::OK);
        let policy = ok.headers()[header::CONTENT_SECURITY_POLICY].to_str().unwrap();
        assert!(policy.contains("connect-src 'none'") && policy.contains("sandbox allow-scripts"));
        assert_eq!(get(&root, "/author.hello/../outside.txt").status(), StatusCode::NOT_FOUND);
        assert_eq!(get(&root, "/author.hello/%2e%2e/outside.txt").status(), StatusCode::NOT_FOUND);
        assert_eq!(get(&root, "/author.hello/missing.js").status(), StatusCode::NOT_FOUND);
        assert_eq!(get(&root, "/gx.core/main.js").status(), StatusCode::NOT_FOUND);
        let host = get(&root, "/__host/author.hello");
        assert_eq!(host.status(), StatusCode::OK);
        let html = String::from_utf8(host.body().clone()).unwrap();
        assert!(html.contains("/__sdk/gx.js") && html.contains("/author.hello/main.js"));
        assert_eq!(get(&root, "/__sdk/gx.js").status(), StatusCode::OK);
        fs::remove_dir_all(&root).unwrap();
    }
}
