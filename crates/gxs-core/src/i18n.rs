//! Interface language and language packs.
//!
//! Languages use BCP 47 codes written in lower case ("en", "zh-cn", "ug"). English is built in
//! and is the
//! fallback: every message resolves through the current language pack keyed by its English text,
//! and a missing key falls back to English (Cheat Engine style .lng behaviour).
//!
//! Built-in packs (zh-cn, ug) are embedded with include_str!; user packs live in
//! `<data>/Language/{code}.json` and override built-in ones, so a translator can drop a new file
//! in without rebuilding. The language is chosen once at startup and fixed for the run.

use std::collections::HashMap;
use std::path::Path;
use std::sync::atomic::{AtomicU8, Ordering};
use std::sync::RwLock;

use serde::{Deserialize, Serialize};

/// Built-in packs, embedded at compile time. English needs no pack: its text is the key itself.
const BUILTIN: &[(&str, &str)] = &[
    ("en", include_str!("../../../locales/en.json")),
    ("zh-cn", include_str!("../../../locales/zh-cn.json")),
    ("ug", include_str!("../../../locales/ug.json")),
];

/// The three built-in languages, used for "follow the system" and explicit-language messages.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Lang {
    Zh,
    En,
    Ug,
}

impl Lang {
    /// Built-ins in code order (a-z): en, ug, zh-cn. The picker lists them in this order.
    pub const ALL: [Lang; 3] = [Lang::En, Lang::Ug, Lang::Zh];

    /// The lower-case BCP 47 code the frontend uses, also the one in settings.
    pub fn code(self) -> &'static str {
        match self {
            Lang::Zh => "zh-cn",
            Lang::En => "en",
            Lang::Ug => "ug",
        }
    }

    pub fn from_code(code: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|lang| lang.code() == normalize_code(code))
    }
}

/// Fold a user-supplied tag to the closest built-in code: "zh", "zh-cn", "zh_CN" -> "zh-cn";
/// "en-US" -> "en"; "ug", "ug-CN" -> "ug"; anything else is left as-is (an external pack).
pub fn normalize_code(code: &str) -> String {
    let lower = code.to_ascii_lowercase();
    let base = lower.split(['_', '-', '.']).next().unwrap_or_default();
    match base {
        "zh" => "zh-cn".to_string(),
        "en" => "en".to_string(),
        "ug" => "ug".to_string(),
        _ => lower,
    }
}

/// Chinese until startup decides; tests run in it too.
static CURRENT: AtomicU8 = AtomicU8::new(0);
/// The current language pack code; set once at startup with [`set`].
static CODE: RwLock<String> = RwLock::new(String::new());

/// Language packs loaded so far: built-in ones plus any user packs that override or extend them.
static PACKS: RwLock<Option<HashMap<String, Pack>>> = RwLock::new(None);

pub fn set(code: &str) {
    let code = normalize_code(code);
    let lang = Lang::from_code(&code).unwrap_or(Lang::En);
    *CODE.write().expect("i18n code lock") = code;
    CURRENT.store(lang as u8, Ordering::Relaxed);
}

/// The built-in language closest to the current one (an external pack counts as English for the
/// language-dependent behaviours that only have the three built-in variants).
pub fn current() -> Lang {
    match CURRENT.load(Ordering::Relaxed) {
        1 => Lang::En,
        2 => Lang::Ug,
        _ => Lang::Zh,
    }
}

/// The BCP 47 code of the current language pack.
pub fn current_code() -> String {
    CODE.read().expect("i18n code lock").clone()
}

/// The display language of the system, or English when it is none of the three.
pub fn system() -> Lang {
    #[cfg(windows)]
    {
        // SAFETY: no arguments, returns a LANGID.
        let id = unsafe { windows_sys::Win32::Globalization::GetUserDefaultUILanguage() };
        from_primary(id & 0x3ff)
    }
    #[cfg(not(windows))]
    {
        let tag = std::env::var("LC_ALL").or_else(|_| std::env::var("LANG")).unwrap_or_default();
        from_tag(&tag)
    }
}

/// PRIMARYLANGID values: LANG_CHINESE and LANG_UIGHUR.
#[cfg(windows)]
fn from_primary(primary: u16) -> Lang {
    match primary {
        0x04 => Lang::Zh,
        0x80 => Lang::Ug,
        _ => Lang::En,
    }
}

/// `zh_CN.UTF-8`, `ug-CN`, `en_US` and the like.
#[cfg_attr(windows, allow(dead_code))]
fn from_tag(tag: &str) -> Lang {
    let base = tag.split(['_', '-', '.']).next().unwrap_or_default().to_ascii_lowercase();
    match base.as_str() {
        "zh" => Lang::Zh,
        "ug" => Lang::Ug,
        _ => Lang::En,
    }
}

// ---------------------------------------------------------------------------
// Language packs.
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PackMeta {
    pub code: String,
    pub name: String,
    pub native_name: String,
    #[serde(default)]
    pub rtl: bool,
    /// Pack version such as "1.2.0"; empty when the pack carries none.
    #[serde(default)]
    pub version: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Pack {
    pub meta: PackMeta,
    pub translations: HashMap<String, String>,
}

/// One entry of the language picker: a built-in or imported language.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LanguageInfo {
    pub code: String,
    pub name: String,
    pub native_name: String,
    pub rtl: bool,
    pub builtin: bool,
    /// The pack version ("1.2.0"); empty when the pack carries none.
    pub version: String,
}

fn builtin_info() -> Vec<LanguageInfo> {
    Lang::ALL
        .iter()
        .map(|lang| {
            let meta = pack_meta(lang.code());
            LanguageInfo {
                code: lang.code().to_string(),
                name: meta.as_ref().map(|m| m.name.clone()).unwrap_or_else(|| lang.code().to_string()),
                native_name: meta.as_ref().map(|m| m.native_name.clone()).unwrap_or_else(|| lang.code().to_string()),
                rtl: meta.as_ref().is_some_and(|m| m.rtl),
                version: meta.as_ref().map(|m| m.version.clone()).unwrap_or_default(),
                builtin: true,
            }
        })
        .collect()
}

fn pack_meta(code: &str) -> Option<PackMeta> {
    let packs = PACKS.read().expect("i18n packs lock");
    packs.as_ref().and_then(|map| map.get(code)).map(|p| p.meta.clone())
}

/// Built-in languages plus every pack in `<data>/Language`.
pub fn languages(dir: Option<&Path>) -> Vec<LanguageInfo> {
    let mut out = builtin_info();
    let Some(dir) = dir else {
        return out;
    };
    let Ok(entries) = std::fs::read_dir(dir.join("Language")) else {
        return out;
    };
    let mut extra: Vec<LanguageInfo> = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.extension().is_some_and(|e| e == "json") {
            continue;
        }
        let Ok(text) = std::fs::read_to_string(&path) else {
            continue;
        };
        let Ok(pack) = serde_json::from_str::<Pack>(&text) else {
            continue;
        };
        let code = normalize_code(&pack.meta.code);
        if let Some(builtin) = out.iter_mut().find(|b| b.code == code) {
            builtin.name = pack.meta.name.clone();
            builtin.native_name = pack.meta.native_name.clone();
            builtin.rtl = pack.meta.rtl;
            builtin.version = pack.meta.version.clone();
        } else if !extra.iter().any(|e| e.code == code) {
            extra.push(LanguageInfo {
                code,
                name: pack.meta.name.clone(),
                native_name: pack.meta.native_name.clone(),
                rtl: pack.meta.rtl,
                version: pack.meta.version.clone(),
                builtin: false,
            });
        }
    }
    extra.sort_by(|a, b| a.native_name.cmp(&b.native_name));
    out.extend(extra);
    out
}

/// Load the built-in packs and any user packs under `<data>/Language` (user wins on conflict).
/// Called once at startup, after the data folder is known. Idempotent for tests.
pub fn init_packs(dir: Option<&Path>) {
    let mut map: HashMap<String, Pack> = HashMap::new();
    for (code, text) in BUILTIN {
        if let Ok(pack) = serde_json::from_str::<Pack>(text) {
            map.insert(code.to_string(), pack);
        }
    }
    if let Some(dir) = dir {
        let Ok(entries) = std::fs::read_dir(dir.join("Language")) else {
            return;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.extension().is_some_and(|e| e == "json") {
                continue;
            }
            let Ok(text) = std::fs::read_to_string(&path) else {
                continue;
            };
            let Ok(pack) = serde_json::from_str::<Pack>(&text) else {
                continue;
            };
            map.insert(normalize_code(&pack.meta.code), pack);
        }
    }
    *PACKS.write().expect("i18n packs lock") = Some(map);
}

/// The translations of one pack as a JSON object for the frontend (`window.__GX_PACKS__`).
pub fn pack_json(code: &str) -> String {
    let packs = PACKS.read().expect("i18n packs lock");
    let Some(map) = packs.as_ref() else {
        return "{}".into();
    };
    let Some(pack) = map.get(&normalize_code(code)) else {
        return "{}".into();
    };
    serde_json::to_string(&pack.translations).unwrap_or_else(|_| "{}".into())
}

/// Whether the current language is written right to left (from its pack meta).
pub fn is_rtl() -> bool {
    let code = current_code();
    let packs = PACKS.read().expect("i18n packs lock");
    packs.as_ref().and_then(|map| map.get(&code)).is_some_and(|p| p.meta.rtl)
}

/// Resolve a plain (placeholder-free) English text through a pack, or `None` when the message
/// is formatted or has no translation. Formatted messages keep their compile-time templates.
pub fn tr_maybe(code: &str, en: &str) -> Option<String> {
    if en.contains('{') || en.contains('}') {
        return None;
    }
    let packs = PACKS.read().expect("i18n packs lock");
    let map = packs.as_ref()?;
    let pack = map.get(&normalize_code(code))?;
    pack.translations.get(en).cloned()
}

/// Resolve one English text through the given language pack; English is the fallback.
pub fn translate(code: &str, en: &str) -> String {
    let packs = PACKS.read().expect("i18n packs lock");
    let Some(map) = packs.as_ref() else {
        return en.to_string();
    };
    let Some(pack) = map.get(&normalize_code(code)) else {
        return en.to_string();
    };
    pack.translations.get(en).cloned().unwrap_or_else(|| en.to_string())
}

/// A user-facing message in the current language: `tr!("中文", "English", "ئۇيغۇرچە")`.
///
/// Plain messages (no placeholders) resolve through the current language pack keyed by their
/// English text, falling back to the compile-time template of the current built-in language (and
/// therefore to English for imported packs and missing keys). Formatted messages keep their
/// compile-time three-language match: named captures are bound to local variables at compile time
/// and cannot be rebound from a runtime pack, so packs override plain messages only.
#[macro_export]
macro_rules! tr {
    (@in $lang:expr, $zh:literal, $en:literal, $ug:literal $(, $($args:tt)*)?) => {{
        match $crate::i18n::tr_maybe($lang.code(), $en) {
            Some(text) => text,
            None => match $lang {
                $crate::i18n::Lang::Zh => format!($zh $(, $($args)*)?),
                $crate::i18n::Lang::En => format!($en $(, $($args)*)?),
                $crate::i18n::Lang::Ug => format!($ug $(, $($args)*)?),
            },
        }
    }};
    ($zh:literal, $en:literal, $ug:literal $(, $($args:tt)*)?) => {{
        match $crate::i18n::tr_maybe($crate::i18n::current_code().as_str(), $en) {
            Some(text) => text,
            None => match $crate::i18n::current() {
                $crate::i18n::Lang::Zh => format!($zh $(, $($args)*)?),
                $crate::i18n::Lang::En => format!($en $(, $($args)*)?),
                $crate::i18n::Lang::Ug => format!($ug $(, $($args)*)?),
            },
        }
    }};
}

/// The separator between list items: `a、b` / `a, b` / `a، b`.
pub fn list_sep_in(lang: Lang) -> &'static str {
    match lang {
        Lang::Zh => "、", // i18n-ignore: the Chinese list separator itself
        Lang::En => ", ",
        Lang::Ug => "، ",
    }
}

/// Items joined with the separator of the current language.
pub fn join_list<S: AsRef<str>>(items: &[S]) -> String {
    join_list_in(current(), items)
}

pub fn join_list_in<S: AsRef<str>>(lang: Lang, items: &[S]) -> String {
    let parts: Vec<&str> = items.iter().map(AsRef::as_ref).collect();
    parts.join(list_sep_in(lang))
}

/// Keeps a left-to-right run (a path, host:port, a command, a file name) in one piece inside
/// right-to-left text. A no-op in Chinese and English, like `ltr()` in src/i18n.ts.
pub fn ltr(s: &str) -> String {
    ltr_in(current(), s)
}

pub fn ltr_in(lang: Lang, s: &str) -> String {
    if lang == Lang::Ug && !s.is_empty() {
        format!("\u{2066}{s}\u{2069}")
    } else {
        s.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn codes_round_trip() {
        for lang in Lang::ALL {
            assert_eq!(Lang::from_code(lang.code()), Some(lang));
        }
        assert_eq!(Lang::from_code("fr"), None);
    }

    #[test]
    fn codes_normalize_to_builtin() {
        assert_eq!(normalize_code("zh"), "zh-cn");
        assert_eq!(normalize_code("zh-CN"), "zh-cn");
        assert_eq!(normalize_code("zh_cn"), "zh-cn");
        assert_eq!(normalize_code("en-US"), "en");
        assert_eq!(normalize_code("ug-CN"), "ug");
        assert_eq!(normalize_code("fr"), "fr");
    }

    #[test]
    fn tags_map_to_the_closest_language() {
        assert_eq!(from_tag("zh_CN.UTF-8"), Lang::Zh);
        assert_eq!(from_tag("ug-CN"), Lang::Ug);
        assert_eq!(from_tag("en_US"), Lang::En);
        assert_eq!(from_tag("de"), Lang::En);
        assert_eq!(from_tag(""), Lang::En);
    }

    #[test]
    fn tr_resolves_packs_and_falls_back_to_english() {
        init_packs(None);
        set("zh-CN");
        assert_eq!(current(), Lang::Zh);
        assert_eq!(tr!("就绪", "Ready", "تەييار"), "就绪");
        set("en");
        assert_eq!(tr!("就绪", "Ready", "تەييار"), "Ready");
        set("zh-CN");
        assert_eq!(translate("zh-CN", "No such string"), "No such string");
    }

    #[test]
    fn tr_formats_captures_and_arguments() {
        let name = "web";
        let all: Vec<String> = Lang::ALL
            .into_iter()
            .map(|lang| {
                set(lang.code());
                tr!("已连接 {name}，{}", "Connected to {name}, {}", "{name} غا ئۇلاندى، {}", 3)
            })
            .collect();
        // Collected in Lang::ALL order (a-z): en, ug, zh-cn.
        assert_eq!(all, ["Connected to web, 3", "web غا ئۇلاندى، 3", "已连接 web，3"]);
        // Restore the global language so parallel tests see a deterministic state.
        set("en");
    }

    #[test]
    fn lists_and_ltr_runs_follow_the_language() {
        set("zh-CN");
        let items = ["a", "b"];
        assert_eq!(join_list_in(Lang::Zh, &items), "a、b");
        assert_eq!(join_list_in(Lang::En, &items), "a, b");
        assert_eq!(join_list_in(Lang::Ug, &items), "a، b");
        assert_eq!(join_list(&items), "a、b");
        assert_eq!(ltr_in(Lang::Ug, "/etc"), "\u{2066}/etc\u{2069}");
        assert_eq!(ltr_in(Lang::En, "/etc"), "/etc");
        assert_eq!(ltr_in(Lang::Ug, ""), "");
        assert_eq!(ltr("/etc"), "/etc");
    }

    #[test]
    fn user_packs_override_builtin_and_are_listed() {
        init_packs(None);
        set("zh-CN");
        assert_eq!(translate("zh-CN", "Ready"), "就绪");
        assert!(languages(None).iter().any(|l| l.code == "zh-cn" && l.builtin));
    }
}
