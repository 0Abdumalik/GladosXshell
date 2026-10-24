//! UI settings and the user stylesheet. Settings are not precious: a damaged file falls back to
//! defaults (reported to the UI) and is only replaced when the user saves.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use gxs_core::i18n::ltr;
use gxs_core::{Error, fsutil, tr};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};
use tauri::ipc::Response;
use tokio::sync::RwLock;

use crate::applog::Level;
use crate::{AppState, Result, open_error};

const MAX_CSS: usize = 256 * 1024;
const MAX_PATH: usize = 1024;
pub(crate) const MAX_IMAGE: u64 = 20 * 1024 * 1024;
pub(crate) const IMAGE_EXTENSIONS: &[&str] = &["png", "jpg", "jpeg", "gif", "webp", "bmp"];
const MAX_FONTS: usize = 3;
const MAX_FONT_NAME: usize = 100;
const MAX_SHELL_ID: usize = 300;
const MAX_RECENT_KEYS: usize = 16;
const MAX_RECENT: usize = 8;
const MIN_SCALE: u32 = 50;
const MAX_SCALE: u32 = 200;

/// A built-in panel (`status`, `files`, ...) or `plugin.id/panel` for one a plugin contributes.
/// Ids of panels that are not registered right now are kept, so a plugin that is switched off
/// and on again gets its old place back.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct PanelId(String);

impl PanelId {
    fn builtin(id: &str) -> Self {
        Self(id.into())
    }

    fn is_valid(&self) -> bool {
        let id = self.0.as_str();
        !id.is_empty()
            && id.len() <= MAX_ID
            && id.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b"-./".contains(&b))
    }
}

const MAX_ID: usize = 128;
const MAX_PANELS: usize = 64;
const MAX_DISABLED: usize = 256;

/// `author.name`: lowercase letters, digits and dashes on both sides of a single dot.
pub(crate) fn valid_plugin_id(id: &str) -> bool {
    let part = |s: &str| !s.is_empty() && s.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-');
    id.len() <= MAX_ID && id.split_once('.').is_some_and(|(a, b)| part(a) && part(b))
}

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct PluginSettings {
    /// Plugins the user switched off; everything else installed is active.
    pub disabled: Vec<String>,
    /// Plugins that ship switched off and the user turned on.
    pub enabled: Vec<String>,
}

fn plugin_ids(ids: &[String]) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for id in ids {
        if valid_plugin_id(id) && out.len() < MAX_DISABLED && !out.contains(id) {
            out.push(id.clone());
        }
    }
    out
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Region {
    Left,
    Right,
    Bottom,
    Hidden,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PanelPlace {
    pub id: PanelId,
    pub region: Region,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct RegionSizes {
    pub left: u32,
    pub right: u32,
    pub bottom: u32,
}

impl Default for RegionSizes {
    fn default() -> Self {
        Self {
            left: 300,
            right: 380,
            bottom: 280,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Layout {
    /// A built-in preset name, or `custom` once the user rearranges panels.
    pub preset: String,
    /// Order within a region follows the order of this list.
    pub panels: Vec<PanelPlace>,
    pub sizes: RegionSizes,
}

const PRESETS: &[&str] = &["finalshell", "sidebar", "filesRight", "terminal", "custom"];

impl Default for Layout {
    fn default() -> Self {
        Self {
            preset: "finalshell".into(),
            panels: vec![
                PanelPlace {
                    id: PanelId::builtin("status"),
                    region: Region::Left,
                },
                PanelPlace {
                    id: PanelId::builtin("files"),
                    region: Region::Bottom,
                },
                PanelPlace {
                    id: PanelId::builtin("commands"),
                    region: Region::Bottom,
                },
                PanelPlace {
                    id: PanelId::builtin("connections"),
                    region: Region::Hidden,
                },
            ],
            sizes: RegionSizes::default(),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum WidgetId {
    Info,
    Resources,
    Processes,
    Network,
    Latency,
    Disks,
    Connections,
}

const WIDGETS: [WidgetId; 7] = [
    WidgetId::Info,
    WidgetId::Resources,
    WidgetId::Processes,
    WidgetId::Network,
    WidgetId::Latency,
    WidgetId::Disks,
    WidgetId::Connections,
];
const MAX_INTERFACES: usize = 5;
const MAX_INTERFACE_NAME: usize = 64;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WidgetSetting {
    pub id: WidgetId,
    pub enabled: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct StatusSettings {
    pub interval_secs: u32,
    pub widgets: Vec<WidgetSetting>,
    /// Detailed mode shows the extra widgets (network connections).
    pub advanced: bool,
    /// Pixel heights the user dragged widgets to; missing ones size to their content.
    pub widget_heights: BTreeMap<WidgetId, u32>,
    /// Network interfaces drawn in the chart; empty picks the busiest one.
    pub selected_interfaces: Vec<String>,
}

impl Default for StatusSettings {
    fn default() -> Self {
        Self {
            interval_secs: 2,
            widgets: WIDGETS.iter().map(|&id| WidgetSetting { id, enabled: true }).collect(),
            advanced: false,
            widget_heights: BTreeMap::new(),
            selected_interfaces: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct CommandsSettings {
    pub favorites_width: u32,
}

impl Default for CommandsSettings {
    fn default() -> Self {
        Self { favorites_width: 300 }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum EditorMode {
    #[default]
    Internal,
    External,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FilesView {
    /// Folder tree on the left, listing on the right.
    #[default]
    Tree,
    Single,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FileColumnId {
    Name,
    Size,
    Kind,
    Mtime,
    Perms,
    Owner,
    Group,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileColumn {
    pub id: FileColumnId,
    pub visible: bool,
    /// CSS pixels. The name column always fills the spare room and uses this as its minimum.
    pub width: u32,
}

const fn column(id: FileColumnId, visible: bool, width: u32) -> FileColumn {
    FileColumn { id, visible, width }
}

const FILE_COLUMNS: [FileColumn; 7] = [
    column(FileColumnId::Name, true, 200),
    column(FileColumnId::Size, true, 88),
    column(FileColumnId::Kind, true, 112),
    column(FileColumnId::Mtime, true, 152),
    column(FileColumnId::Perms, true, 104),
    column(FileColumnId::Owner, true, 88),
    column(FileColumnId::Group, false, 88),
];
const MIN_COLUMN: u32 = 40;
const MAX_COLUMN: u32 = 1200;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct FileSettings {
    pub view: FilesView,
    pub editor: EditorMode,
    /// Program used for external editing; empty means the system default for the file type.
    pub external_editor: String,
    /// Local mirror for edits and previews; empty means `Documents\GladosXshell`.
    pub work_dir: String,
    /// Download destination; empty means ask every time.
    pub download_dir: String,
    pub show_hidden: bool,
    /// Listing columns, left to right.
    pub columns: Vec<FileColumn>,
}

impl Default for FileSettings {
    fn default() -> Self {
        Self {
            view: FilesView::default(),
            editor: EditorMode::default(),
            external_editor: String::new(),
            work_dir: String::new(),
            download_dir: String::new(),
            show_hidden: false,
            columns: FILE_COLUMNS.to_vec(),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Theme {
    #[default]
    Dark,
    Light,
    Auto,
}

/// The interface language, as a BCP 47 code, or "auto" to follow the system. Read at startup;
/// a change takes effect after a restart. Imported language packs add more codes; English text
/// is always the fallback when a pack misses a key.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct Language(String);

impl Default for Language {
    fn default() -> Self {
        Self(Self::AUTO.into())
    }
}

impl Language {
    pub const AUTO: &str = "auto";

    /// Build from a BCP 47 code (or "auto"); near-miss tags are folded to the closest built-in.
    pub fn new(code: impl Into<String>) -> Self {
        Self(gxs_core::i18n::normalize_code(&code.into()))
    }

    /// The language pack code actually in use: the choice, or the system language for "auto".
    pub fn resolve_code(&self) -> String {
        if self.0 == Self::AUTO {
            gxs_core::i18n::system().code().to_string()
        } else {
            gxs_core::i18n::normalize_code(&self.0)
        }
    }

    /// The built-in language behind the resolved code; kept for tests and callers that
    /// need a `Lang` rather than a pack code.
    #[allow(dead_code)]
    pub fn resolve(&self) -> gxs_core::i18n::Lang {
        use gxs_core::i18n::Lang;
        gxs_core::i18n::Lang::from_code(&self.resolve_code()).unwrap_or(Lang::En)
    }

    /// The stored code ("auto" or a BCP 47 tag).
    #[allow(dead_code)]
    pub fn code(&self) -> &str {
        &self.0
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct UiSettings {
    /// Interface zoom in percent; 0 picks one from the screen size.
    pub scale: u32,
    pub theme: Theme,
    pub language: Language,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CursorStyle {
    #[default]
    Block,
    Bar,
    Underline,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct TerminalSettings {
    /// Up to three family names tried in order; the built-in monospace stack comes last.
    pub fonts: Vec<String>,
    /// Every font file in this folder joins the fallback after the chain; empty for none.
    pub font_folder: String,
    /// The old free-form CSS font list, read once and split into the chain.
    #[serde(skip_serializing)]
    pub font_family: String,
    pub font_size: u32,
    /// Percent of the font size.
    pub line_height: u32,
    pub scrollback: u32,
    pub cursor_style: CursorStyle,
    pub cursor_blink: bool,
    pub copy_on_select: bool,
    /// Command, option and path suggestions while typing at the shell prompt.
    pub suggestions: bool,
    /// Local image shown behind the text; empty for none.
    pub background_image: String,
    /// How strongly the image shows through, in percent.
    pub background_opacity: u32,
    /// Ask before pasting text with line breaks outside bracketed-paste mode.
    pub paste_confirm: bool,
    /// Answer `rz` / `sz` (ZMODEM) in the terminal with a file transfer.
    pub zmodem: bool,
    pub log: LogSettings,
    /// Shell id from `local_shells` for new local terminals; empty for the system default.
    pub default_shell: String,
    /// Reopen the tabs that were open at the last exit.
    pub restore_tabs: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct LogSettings {
    /// Record every new session from the start.
    pub auto: bool,
    /// Empty for `logs` inside the work directory.
    pub dir: String,
    /// Strip colours and other escape sequences.
    pub plain: bool,
}

impl Default for LogSettings {
    fn default() -> Self {
        Self {
            auto: false,
            dir: String::new(),
            plain: true,
        }
    }
}

impl Default for TerminalSettings {
    fn default() -> Self {
        Self {
            fonts: Vec::new(),
            font_folder: String::new(),
            font_family: String::new(),
            font_size: 14,
            line_height: 115,
            scrollback: 10_000,
            cursor_style: CursorStyle::Block,
            cursor_blink: true,
            copy_on_select: false,
            suggestions: true,
            background_image: String::new(),
            background_opacity: 30,
            paste_confirm: true,
            zmodem: true,
            log: LogSettings::default(),
            default_shell: String::new(),
            restore_tabs: true,
        }
    }
}

/// Optional features of the built-in code editors, each switched on or off like a plugin.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct EditorSettings {
    pub line_numbers: bool,
    pub fold: bool,
    pub word_wrap: bool,
    pub whitespace: bool,
    pub active_line: bool,
    pub selection_matches: bool,
    pub close_brackets: bool,
    pub autocomplete: bool,
    pub indent_guides: bool,
    pub lint: bool,
    pub minimap: bool,
    pub format_on_save: bool,
    /// Columns per tab stop and per indent level.
    pub tab_size: u32,
}

impl Default for EditorSettings {
    fn default() -> Self {
        Self {
            line_numbers: true,
            fold: true,
            word_wrap: false,
            whitespace: false,
            active_line: true,
            selection_matches: true,
            close_brackets: true,
            autocomplete: true,
            indent_guides: true,
            lint: true,
            minimap: true,
            format_on_save: false,
            tab_size: 4,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub ui: UiSettings,
    pub layout: Layout,
    pub status: StatusSettings,
    pub commands: CommandsSettings,
    pub terminal: TerminalSettings,
    pub files: FileSettings,
    pub editor: EditorSettings,
    pub plugins: PluginSettings,
    /// Recently used paths per field (workDir, fontFolder, ...), newest first.
    pub recent_paths: BTreeMap<String, Vec<String>>,
}

/// A family name the UI quotes itself, so quotes and separators are not allowed.
fn font_name(name: &str) -> Result<Option<String>> {
    let name = name.trim().trim_matches(|c| c == '\'' || c == '"').trim();
    if name.is_empty() {
        return Ok(None);
    }
    if name.len() > MAX_FONT_NAME || name.chars().any(|c| c.is_control() || "{};<>\"'\\,".contains(c)) {
        return Err(Error::Invalid(tr!(
            "终端字体名称无效",
            "The terminal font name is not valid",
            "تېرمىنال خەت نۇسخىسى نامى ئىناۋەتسىز"
        )));
    }
    Ok(Some(name.to_owned()))
}

fn recent_paths(map: &BTreeMap<String, Vec<String>>) -> BTreeMap<String, Vec<String>> {
    let mut out = BTreeMap::new();
    for (key, paths) in map {
        let valid_key = (1..=32).contains(&key.len()) && key.chars().all(|c| c.is_ascii_alphanumeric());
        if !valid_key || out.len() >= MAX_RECENT_KEYS {
            continue;
        }
        let mut kept: Vec<String> = Vec::new();
        for path in paths {
            let Ok(path) = check_path(path, &tr!("路径", "path", "يول")) else { continue };
            let seen = kept.iter().any(|p| p.eq_ignore_ascii_case(&path));
            if !path.is_empty() && !seen && kept.len() < MAX_RECENT {
                kept.push(path);
            }
        }
        if !kept.is_empty() {
            out.insert(key.clone(), kept);
        }
    }
    out
}

/// `what` names the field in the current language, lowercase in English: "export path".
pub(crate) fn check_path(value: &str, what: &str) -> Result<String> {
    let value = value.trim();
    if value.len() > MAX_PATH || value.chars().any(char::is_control) {
        return Err(Error::Invalid(tr!("{what}无效", "Invalid {what}", "{what} ئىناۋەتسىز")));
    }
    if !value.is_empty() && !Path::new(value).is_absolute() {
        return Err(Error::Invalid(tr!(
            "{what}必须是绝对路径",
            "The {what} must be an absolute path",
            "{what} چوقۇم مۇتلەق يول بولۇشى كېرەك"
        )));
    }
    Ok(value.to_owned())
}

impl Settings {
    /// Fills in anything missing and drops duplicates so the UI can trust the shape.
    fn normalize(mut self) -> Result<Self> {
        if !PRESETS.contains(&self.layout.preset.as_str()) {
            self.layout.preset = "custom".into();
        }
        let mut panels: Vec<PanelPlace> = Vec::new();
        for place in self.layout.panels.iter().take(MAX_PANELS).chain(Layout::default().panels.iter()) {
            if place.id.is_valid() && !panels.iter().any(|p| p.id == place.id) {
                panels.push(place.clone());
            }
        }
        self.layout.panels = panels;
        let sizes = &mut self.layout.sizes;
        sizes.left = sizes.left.clamp(180, 900);
        sizes.right = sizes.right.clamp(180, 900);
        sizes.bottom = sizes.bottom.clamp(120, 900);

        self.status.interval_secs = self.status.interval_secs.clamp(1, 60);
        let mut widgets: Vec<WidgetSetting> = Vec::new();
        let defaults = WIDGETS.iter().map(|&id| WidgetSetting { id, enabled: true });
        for w in self.status.widgets.iter().copied().chain(defaults) {
            if !widgets.iter().any(|x| x.id == w.id) {
                widgets.push(w);
            }
        }
        self.status.widgets = widgets;
        for height in self.status.widget_heights.values_mut() {
            *height = (*height).clamp(48, 2000);
        }
        let mut interfaces: Vec<String> = Vec::new();
        for name in &self.status.selected_interfaces {
            let name = name.trim();
            let valid = !name.is_empty() && name.len() <= MAX_INTERFACE_NAME && !name.chars().any(char::is_control);
            if valid && interfaces.len() < MAX_INTERFACES && !interfaces.iter().any(|n| n == name) {
                interfaces.push(name.to_owned());
            }
        }
        self.status.selected_interfaces = interfaces;
        self.commands.favorites_width = self.commands.favorites_width.clamp(180, 600);

        if self.ui.scale != 0 {
            self.ui.scale = self.ui.scale.clamp(MIN_SCALE, MAX_SCALE);
        }

        let term = &mut self.terminal;
        let legacy = std::mem::take(&mut term.font_family);
        let names: Vec<&str> = if term.fonts.is_empty() {
            legacy.split(',').collect()
        } else {
            term.fonts.iter().map(String::as_str).collect()
        };
        let mut fonts: Vec<String> = Vec::new();
        for name in names {
            if let Some(name) = font_name(name)?
                && fonts.len() < MAX_FONTS
                && !fonts.iter().any(|f| f.eq_ignore_ascii_case(&name))
            {
                fonts.push(name);
            }
        }
        term.fonts = fonts;
        term.font_folder = check_path(&term.font_folder, &tr!("字体文件夹", "font folder", "خەت نۇسخىسى قىسقۇچى"))?;
        term.font_size = term.font_size.clamp(8, 40);
        term.line_height = term.line_height.clamp(100, 200);
        term.scrollback = term.scrollback.clamp(500, 200_000);
        term.background_opacity = term.background_opacity.clamp(5, 100);
        term.background_image = check_path(
            &term.background_image,
            &tr!("终端背景图片路径", "terminal background image path", "تېرمىنال تەگلىك رەسىمى يولى"),
        )?;
        term.log.dir = check_path(&term.log.dir, &tr!("会话日志目录", "session log folder", "ئەڭگىمە خاتىرىسى قىسقۇچى"))?;
        let shell = term.default_shell.trim();
        term.default_shell = if shell.len() <= MAX_SHELL_ID && !shell.chars().any(char::is_control) {
            shell.to_owned()
        } else {
            String::new()
        };

        let files = &mut self.files;
        files.external_editor = check_path(
            &files.external_editor,
            &tr!("外部编辑器路径", "external editor path", "سىرتقى تەھرىرلىگۈچ يولى"),
        )?;
        files.work_dir = check_path(&files.work_dir, &tr!("本地工作目录", "local working folder", "يەرلىك خىزمەت قىسقۇچى"))?;
        files.download_dir = check_path(
            &files.download_dir,
            &tr!("默认下载目录", "default download folder", "كۆڭۈلدىكى چۈشۈرۈش قىسقۇچى"),
        )?;
        let mut columns: Vec<FileColumn> = Vec::new();
        for c in files.columns.iter().chain(FILE_COLUMNS.iter()) {
            if !columns.iter().any(|x| x.id == c.id) {
                columns.push(FileColumn {
                    visible: c.visible || c.id == FileColumnId::Name,
                    width: c.width.clamp(MIN_COLUMN, MAX_COLUMN),
                    ..*c
                });
            }
        }
        files.columns = columns;
        self.editor.tab_size = self.editor.tab_size.clamp(1, 8);
        self.plugins.disabled = plugin_ids(&self.plugins.disabled);
        self.plugins.enabled = plugin_ids(&self.plugins.enabled);
        self.recent_paths = recent_paths(&self.recent_paths);
        Ok(self)
    }
}

pub(crate) struct SettingsStore {
    path: PathBuf,
    css_path: PathBuf,
    default_work_dir: PathBuf,
    data: RwLock<Settings>,
    load_error: RwLock<Option<LoadError>>,
    /// True when settings.json did not exist yet (first run): the system language is pinned then.
    created: bool,
}

/// Why settings.json was not used. Worded on request: the store is opened before the language is
/// known, since the language is one of the settings.
enum LoadError {
    Parse(String),
    Read(String),
}

impl LoadError {
    fn text(&self) -> String {
        match self {
            LoadError::Parse(e) => tr!(
                "settings.json 无法解析，已使用默认设置：{e}",
                "Could not parse settings.json, so the default settings are in use: {e}",
                "settings.json نى تەھلىل قىلغىلى بولمىدى، كۆڭۈلدىكى تەڭشەك ئىشلىتىلىۋاتىدۇ: {e}"
            ),
            LoadError::Read(e) => e.clone(),
        }
    }
}

impl SettingsStore {
    pub async fn open(config_dir: &Path, default_work_dir: PathBuf) -> Self {
        let path = config_dir.join("settings.json");
        let read = fsutil::read_optional(&path).await;
        let created = matches!(&read, Ok(None));
        let (data, load_error) = match read {
            Ok(None) => (Settings::default(), None),
            Ok(Some(bytes)) => match serde_json::from_slice::<Settings>(&bytes)
                .map_err(|e| e.to_string())
                .and_then(|s| s.normalize().map_err(|e| e.to_string()))
            {
                Ok(settings) => (settings, None),
                Err(e) => (Settings::default(), Some(LoadError::Parse(e))),
            },
            Err(e) => (Settings::default(), Some(LoadError::Read(e.to_string()))),
        };
        Self {
            path,
            css_path: config_dir.join("custom.css"),
            default_work_dir,
            data: RwLock::new(data),
            load_error: RwLock::new(load_error),
            created,
        }
    }

    pub async fn load_error(&self) -> Option<String> {
        self.load_error.read().await.as_ref().map(LoadError::text)
    }

    /// True when settings.json did not exist when the store was opened (first run).
    pub async fn created(&self) -> bool {
        self.created
    }

    /// Replaces the saved language, used on first run to pin the detected system language.
    pub async fn set_language(&self, code: String) -> Result<()> {
        let mut data = self.data.write().await;
        data.ui.language = Language::new(code);
        let body = serde_json::to_vec_pretty(&*data).map_err(|e| Error::Invalid(e.to_string()))?;
        fsutil::write_atomic(&self.path, body).await?;
        Ok(())
    }

    pub async fn get(&self) -> Settings {
        self.data.read().await.clone()
    }

    pub async fn work_dir(&self) -> PathBuf {
        match self.data.read().await.files.work_dir.as_str() {
            "" => self.default_work_dir.clone(),
            dir => PathBuf::from(dir),
        }
    }

    pub async fn recordings_dir(&self) -> PathBuf {
        self.work_dir().await.join("recordings")
    }

    pub async fn log_dir(&self) -> PathBuf {
        let dir = self.data.read().await.terminal.log.dir.clone();
        if dir.is_empty() {
            self.work_dir().await.join("logs")
        } else {
            PathBuf::from(dir)
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsView {
    settings: Settings,
    /// Set when the stored file could not be read and defaults are in effect.
    error: Option<String>,
    default_work_dir: String,
}

#[tauri::command]
pub async fn settings_get(state: State<'_, AppState>) -> Result<SettingsView> {
    let store = &state.settings;
    Ok(SettingsView {
        settings: store.get().await,
        error: store.load_error().await,
        default_work_dir: store.default_work_dir.to_string_lossy().into_owned(),
    })
}

#[tauri::command]
pub async fn settings_set(app: AppHandle, state: State<'_, AppState>, settings: Settings) -> Result<Settings> {
    let store = &state.settings;
    let settings = settings.normalize()?;
    let body = serde_json::to_vec_pretty(&settings).map_err(|e| Error::Invalid(e.to_string()))?;
    let mut data = store.data.write().await;
    fsutil::write_atomic(&store.path, body).await?;
    let mut before = std::mem::replace(&mut *data, settings.clone());
    drop(data);
    *store.load_error.write().await = None;
    // Every window (main and the detached status window) mirrors these.
    let _ = app.emit("settings://changed", &settings);
    if before.status.interval_secs != settings.status.interval_secs {
        crate::monitor::restart_all(&state).await;
    }
    // Splitter drags only move sizes; those are not worth a log line.
    before.layout.sizes = settings.layout.sizes;
    if before.layout.preset != settings.layout.preset && settings.layout.preset != "custom" {
        let preset = ltr(&settings.layout.preset);
        let line = tr!(
            "布局已切换为预设 {preset}",
            "Switched the layout to the preset {preset}",
            "ئورۇنلاشتۇرۇش ئالماشتۇرۇلدى، تەييار ئورۇنلاشتۇرۇش: {preset}"
        );
        state.log.add(Level::Info, line).await;
    } else if before != settings {
        state.log.add(Level::Info, tr!("设置已更新", "Settings updated", "تەڭشەك يېڭىلاندى")).await;
    }
    Ok(settings)
}

#[tauri::command]
pub async fn custom_css_get(state: State<'_, AppState>) -> Result<String> {
    let bytes = fsutil::read_optional(&state.settings.css_path)
        .await?
        .unwrap_or_default();
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

#[tauri::command]
pub async fn custom_css_set(state: State<'_, AppState>, css: String) -> Result<()> {
    if css.len() > MAX_CSS {
        return Err(Error::Invalid(tr!(
            "自定义 CSS 不能超过 256 KB",
            "Custom CSS can't be larger than 256 KB",
            "ئىختىيارى CSS نىڭ چوڭلۇقى 256 KB دىن ئېشىپ كەتمەسلىكى كېرەك"
        )));
    }
    let size = css.len();
    fsutil::write_atomic(&state.settings.css_path, css.into_bytes()).await?;
    state
        .log
        .add(
            Level::Info,
            tr!("已保存自定义 CSS（{size} 字节）", "Saved custom CSS ({size} bytes)", "ئىختىيارى CSS ساقلاندى ({size} بايت)"),
        )
        .await;
    Ok(())
}

/// Reads a stylesheet the user picked so it can be merged into custom.css.
#[tauri::command]
pub async fn custom_css_import(path: String) -> Result<String> {
    let path = PathBuf::from(check_path(&path, &tr!("样式表路径", "stylesheet path", "ئۇسلۇب جەدۋىلى يولى"))?);
    let is_css = path.extension().is_some_and(|e| e.eq_ignore_ascii_case("css"));
    if !is_css {
        return Err(Error::Invalid(tr!(
            "只能导入 .css 文件",
            "Only .css files can be imported",
            "پەقەت .css ھۆججىتىنىلا ئەكىرگىلى بولىدۇ"
        )));
    }
    if tokio::fs::metadata(&path).await?.len() > MAX_CSS as u64 {
        return Err(Error::Invalid(tr!(
            "样式表不能超过 256 KB",
            "The stylesheet can't be larger than 256 KB",
            "ئۇسلۇب جەدۋىلىنىڭ چوڭلۇقى 256 KB دىن ئېشىپ كەتمەسلىكى كېرەك"
        )));
    }
    let bytes = tokio::fs::read(&path).await?;
    String::from_utf8(bytes).map_err(|_| {
        Error::Invalid(tr!(
            "样式表不是 UTF-8 编码",
            "The stylesheet is not UTF-8 encoded",
            "ئۇسلۇب جەدۋىلى UTF-8 كودلىنىشىدا ئەمەس"
        ))
    })
}

/// Reads a local picture (the terminal background) for display as a blob URL.
#[tauri::command]
pub async fn local_image(path: String) -> Result<Response> {
    let path = PathBuf::from(check_path(&path, &tr!("图片路径", "image path", "رەسىم يولى"))?);
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .map(str::to_ascii_lowercase)
        .unwrap_or_default();
    if !IMAGE_EXTENSIONS.contains(&ext.as_str()) {
        return Err(Error::Invalid(tr!(
            "只支持 png、jpg、gif、webp、bmp 图片",
            "Only png, jpg, gif, webp and bmp images are supported",
            "پەقەت png، jpg، gif، webp ۋە bmp رەسىملىرىنىلا قوللايدۇ"
        )));
    }
    if tokio::fs::metadata(&path).await?.len() > MAX_IMAGE {
        return Err(Error::Invalid(tr!(
            "背景图片不能超过 20 MB",
            "The background image can't be larger than 20 MB",
            "تەگلىك رەسىمىنىڭ چوڭلۇقى 20 MB دىن ئېشىپ كەتمەسلىكى كېرەك"
        )));
    }
    Ok(Response::new(tokio::fs::read(&path).await?))
}

/// The guide at the top of a new custom.css.
fn css_template() -> String {
    tr!(
        "/* GladosXshell 自定义样式。保存后应用会自动重新载入。\n * 可用的选择器和 --gx-* 变量见 设置 → 外观 → 样式钩子。\n *\n * 例：\n * :root {{ --gx-terminal-bg: #101317; }}\n * .gx-region-tab {{ font-size: 0.8125rem; }}\n */\n",
        "/* GladosXshell custom styles. The app reloads them after you save.\n * The selectors and --gx-* variables you can use are listed in Settings → Appearance → Style hooks.\n *\n * Example:\n * :root {{ --gx-terminal-bg: #101317; }}\n * .gx-region-tab {{ font-size: 0.8125rem; }}\n */\n",
        "/* GladosXshell ئىختىيارى ئۇسلۇبى. ساقلىغاندىن كېيىن ئەپ ئۇنى ئۆزلۈكىدىن قايتا يۈكلەيدۇ.\n * ئىشلەتكىلى بولىدىغان تاللىغۇچ ۋە --gx-* ئۆزگەرگۈچىلەرنى «تەڭشەك ← كۆرۈنۈش ← ئۇسلۇب ئىلمەكلىرى» دىن كۆرۈڭ.\n *\n * مىسال:\n * :root {{ --gx-terminal-bg: #101317; }}\n * .gx-region-tab {{ font-size: 0.8125rem; }}\n */\n"
    )
}

/// Opens custom.css in the system editor, creating it with a short guide first if missing.
#[tauri::command]
pub async fn custom_css_open(state: State<'_, AppState>) -> Result<()> {
    let path = &state.settings.css_path;
    if fsutil::read_optional(path).await?.is_none() {
        tokio::fs::create_dir_all(&state.config_dir).await?;
        fsutil::write_atomic(path, css_template().into_bytes()).await?;
    }
    tauri_plugin_opener::open_path(path, None::<&str>).map_err(open_error)
}

#[tauri::command]
pub async fn open_config_dir(state: State<'_, AppState>) -> Result<()> {
    tokio::fs::create_dir_all(&state.config_dir).await?;
    tauri_plugin_opener::open_path(&state.config_dir, None::<&str>).map_err(open_error)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn language_defaults_to_the_system_and_keeps_a_choice() {
        let s: Settings = serde_json::from_str(r#"{"ui":{"theme":"light"}}"#).unwrap();
        assert_eq!(s.ui.language.code(), Language::AUTO);
        let s: Settings = serde_json::from_str(r#"{"ui":{"language":"ug"}}"#).unwrap();
        assert_eq!(s.ui.language.resolve(), gxs_core::i18n::Lang::Ug);
        // Old "zh" values and standard tags both resolve.
        let s: Settings = serde_json::from_str(r#"{"ui":{"language":"zh"}}"#).unwrap();
        assert_eq!(s.ui.language.resolve_code(), "zh-cn");
        assert_eq!(serde_json::to_value(Language::new("en")).unwrap(), "en");
        assert_eq!(serde_json::to_value(Language::new("fr")).unwrap(), "fr");
    }

    #[test]
    fn partial_settings_are_completed_with_defaults() {
        let s: Settings = serde_json::from_str(
            r#"{"layout":{"preset":"weird","panels":[{"id":"files","region":"right"},{"id":"files","region":"left"}]},
                "status":{"intervalSecs":0,"widgets":[{"id":"disks","enabled":false}]}}"#,
        )
        .unwrap();
        let s = s.normalize().unwrap();
        assert_eq!(s.layout.preset, "custom");
        assert_eq!(s.layout.panels.len(), 4);
        assert_eq!(
            s.layout.panels[0],
            PanelPlace {
                id: PanelId::builtin("files"),
                region: Region::Right
            }
        );
        assert_eq!(s.status.interval_secs, 1);
        assert_eq!(s.status.widgets.len(), 7);
        assert_eq!(
            s.status.widgets[0],
            WidgetSetting {
                id: WidgetId::Disks,
                enabled: false
            }
        );
        assert_eq!(s.layout.sizes, RegionSizes::default());
        assert_eq!(s.terminal, TerminalSettings::default());
        assert_eq!(s.files.view, FilesView::Tree);
    }

    #[test]
    fn scale_and_terminal_values_are_clamped() {
        let s: Settings = serde_json::from_str(
            r#"{"ui":{"scale":20},"terminal":{"fontSize":3,"lineHeight":900,"backgroundOpacity":0}}"#,
        )
        .unwrap();
        let s = s.normalize().unwrap();
        assert_eq!(s.ui.scale, MIN_SCALE);
        assert_eq!((s.terminal.font_size, s.terminal.line_height), (8, 200));
        assert_eq!(s.terminal.background_opacity, 5);
        assert_eq!(Settings::default().normalize().unwrap().ui.scale, 0);
        let s: Settings = serde_json::from_str(r#"{"editor":{"tabSize":0,"wordWrap":true}}"#).unwrap();
        let s = s.normalize().unwrap();
        assert_eq!((s.editor.tab_size, s.editor.word_wrap, s.editor.fold), (1, true, true));
        let mut s = Settings::default();
        s.terminal.fonts = vec!["x; } body { color: red".into()];
        assert!(s.normalize().is_err());
    }

    #[test]
    fn old_font_list_is_split_into_the_chain() {
        let s: Settings = serde_json::from_str(
            r#"{"terminal":{"fontFamily":"'Cascadia Mono', \"Noto Sans SC\", consolas, Consolas, monospace"}}"#,
        )
        .unwrap();
        let s = s.normalize().unwrap();
        assert_eq!(s.terminal.fonts, ["Cascadia Mono", "Noto Sans SC", "consolas"]);
        let json = serde_json::to_string(&s).unwrap();
        assert!(!json.contains("fontFamily"));
        let mut s = Settings::default();
        s.terminal.fonts = vec![" ".into(), "A".into(), "a".into(), "B".into()];
        s.terminal.font_family = "Ignored".into();
        assert_eq!(s.normalize().unwrap().terminal.fonts, ["A", "B"]);
    }

    #[test]
    #[cfg(windows)]
    fn recent_paths_are_bounded_and_deduplicated() {
        // Drives and case folding are Windows path semantics; the Linux build skips this.
        let mut s = Settings::default();
        let many: Vec<String> = (0..20).map(|i| format!(r"D:\dir{i}")).collect();
        let first = vec![r"D:\a".into(), r"d:\A".into(), "relative".into(), String::new()];
        s.recent_paths.insert("workDir".into(), [first, many].concat());
        s.recent_paths.insert("bad key".into(), vec![r"D:\x".into()]);
        s.recent_paths.insert("empty".into(), vec!["relative".into()]);
        let s = s.normalize().unwrap();
        let work = &s.recent_paths["workDir"];
        assert_eq!(work.len(), MAX_RECENT);
        assert_eq!((work[0].as_str(), work[1].as_str()), (r"D:\a", r"D:\dir0"));
        assert_eq!(s.recent_paths.len(), 1);
    }

    #[test]
    fn status_view_fields_survive_and_are_bounded() {
        let s: Settings = serde_json::from_str(
            r#"{"status":{"advanced":true,"widgetHeights":{"network":10,"disks":300,"connections":9000},
                "selectedInterfaces":["eth0"," eth0 ","","a","b","c","d","e"]},
                "commands":{"favoritesWidth":20}}"#,
        )
        .unwrap();
        let s = s.normalize().unwrap();
        assert!(s.status.advanced);
        assert_eq!(s.status.widget_heights[&WidgetId::Network], 48);
        assert_eq!(s.status.widget_heights[&WidgetId::Disks], 300);
        assert_eq!(s.status.widget_heights[&WidgetId::Connections], 2000);
        assert_eq!(s.status.selected_interfaces, ["eth0", "a", "b", "c", "d"]);
        assert_eq!(s.commands.favorites_width, 180);
        let json = serde_json::to_value(&s).unwrap();
        assert_eq!(json["status"]["widgetHeights"]["disks"], 300);
    }

    #[test]
    fn file_columns_are_completed_and_bounded() {
        let s: Settings = serde_json::from_str(
            r#"{"files":{"columns":[{"id":"size","visible":false,"width":5},
                {"id":"name","visible":false,"width":300},{"id":"size","visible":true,"width":90}]}}"#,
        )
        .unwrap();
        let s = s.normalize().unwrap();
        let cols = &s.files.columns;
        assert_eq!(cols.len(), FILE_COLUMNS.len());
        assert_eq!(cols[0], column(FileColumnId::Size, false, MIN_COLUMN));
        assert_eq!(cols[1], column(FileColumnId::Name, true, 300));
        assert_eq!(cols[2].id, FileColumnId::Kind);
        assert!(!cols.iter().find(|c| c.id == FileColumnId::Group).unwrap().visible);
        assert_eq!(Settings::default().files.columns, FILE_COLUMNS);
    }

    #[test]
    fn plugin_panels_are_kept_and_bad_ids_dropped() {
        let s: Settings = serde_json::from_str(
            r#"{"layout":{"panels":[{"id":"author.tool/main","region":"right"},{"id":"Bad Id","region":"left"},
                {"id":"","region":"left"},{"id":"status","region":"bottom"}]},
                "plugins":{"disabled":["author.tool","author.tool","nodot","a.b.c","x.y"],"enabled":["gx.log-highlight"]}}"#,
        )
        .unwrap();
        let s = s.normalize().unwrap();
        let ids: Vec<&str> = s.layout.panels.iter().map(|p| p.id.0.as_str()).collect();
        assert_eq!(ids, ["author.tool/main", "status", "files", "commands", "connections"]);
        assert_eq!(s.layout.panels[1].region, Region::Bottom);
        assert_eq!(s.plugins.disabled, ["author.tool", "x.y"]);
        assert_eq!(s.plugins.enabled, ["gx.log-highlight"]);
        let json = serde_json::to_value(&s).unwrap();
        assert_eq!(json["layout"]["panels"][0]["id"], "author.tool/main");
        assert!(valid_plugin_id("gx.terminal-suggest"));
        assert!(!valid_plugin_id("Gx.files") && !valid_plugin_id(".files") && !valid_plugin_id("gx."));
    }

    #[test]
    #[cfg(windows)]
    fn relative_paths_are_rejected() {
        // Uses a drive path (D:\), so it only runs where backslash is a separator.
        let mut s = Settings::default();
        s.files.work_dir = "relative\\dir".into();
        assert!(s.normalize().is_err());
        let mut s = Settings::default();
        s.files.work_dir = r"D:\work".into();
        assert_eq!(s.normalize().unwrap().files.work_dir, r"D:\work");
    }
}
