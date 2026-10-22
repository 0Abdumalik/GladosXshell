//! Interface language, the same three as the app (crates/gxs-core/src/i18n.rs) without depending
//! on it. Picked once at startup from the system display language; every message the installer
//! shows is written in all three languages where it is produced, with [`tr!`].

#![cfg_attr(not(windows), allow(dead_code))]

use std::sync::atomic::{AtomicU8, Ordering};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Lang {
    Zh,
    En,
    Ug,
}

impl Lang {
    pub const ALL: [Lang; 3] = [Lang::Zh, Lang::En, Lang::Ug];

    /// The code the page reads from `window.__GX_LANG__`, and the one on the command line.
    pub fn code(self) -> &'static str {
        match self {
            Lang::Zh => "zh",
            Lang::En => "en",
            Lang::Ug => "ug",
        }
    }

    pub fn from_code(code: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|lang| lang.code() == code)
    }
}

/// Chinese until startup decides; tests run in it too.
static CURRENT: AtomicU8 = AtomicU8::new(0);

pub fn set(lang: Lang) {
    CURRENT.store(lang as u8, Ordering::Relaxed);
}

pub fn current() -> Lang {
    match CURRENT.load(Ordering::Relaxed) {
        1 => Lang::En,
        2 => Lang::Ug,
        _ => Lang::Zh,
    }
}

/// The display language of the system, or English when it is none of the three.
pub fn system() -> Lang {
    #[cfg(windows)]
    {
        // SAFETY: no arguments, returns a LANGID.
        let id = unsafe { windows::Win32::Globalization::GetUserDefaultUILanguage() };
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

/// A user-facing message in the current language: `tr!("中文", "English", "ئۇيغۇرچە")`.
/// Each text is a `format!` string, so `{name}` captures variables and extra arguments follow.
#[macro_export]
macro_rules! tr {
    (@in $lang:expr, $zh:literal, $en:literal, $ug:literal $(, $($args:tt)*)?) => {
        match $lang {
            $crate::i18n::Lang::Zh => format!($zh $(, $($args)*)?),
            $crate::i18n::Lang::En => format!($en $(, $($args)*)?),
            $crate::i18n::Lang::Ug => format!($ug $(, $($args)*)?),
        }
    };
    ($zh:literal, $en:literal, $ug:literal $(, $($args:tt)*)?) => {
        $crate::tr!(@in $crate::i18n::current(), $zh, $en, $ug $(, $($args)*)?)
    };
}

/// Keeps a left-to-right run (a path, a version, a folder name) in one piece inside
/// right-to-left text. A no-op in Chinese and English, like `ltr()` in installer/ui/main.js.
pub fn ltr(s: &str) -> String {
    ltr_in(current(), s)
}

pub fn ltr_in(lang: Lang, s: &str) -> String {
    if lang == Lang::Ug && !s.is_empty() { format!("\u{2066}{s}\u{2069}") } else { s.to_string() }
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
        assert_eq!(Lang::from_code(""), None);
    }

    #[test]
    fn tags_map_to_the_closest_language() {
        assert_eq!(from_tag("zh_CN.UTF-8"), Lang::Zh);
        assert_eq!(from_tag("zh-Hant-TW"), Lang::Zh);
        assert_eq!(from_tag("UG_cn"), Lang::Ug);
        assert_eq!(from_tag("ug-Arab-CN"), Lang::Ug);
        assert_eq!(from_tag("en_US"), Lang::En);
        assert_eq!(from_tag("de"), Lang::En);
        assert_eq!(from_tag("C"), Lang::En);
        assert_eq!(from_tag(""), Lang::En);
    }

    #[cfg(windows)]
    #[test]
    fn language_ids_map_by_primary_language() {
        // zh-CN, zh-TW, ug-CN, en-US, de-DE, as GetUserDefaultUILanguage returns them.
        let cases =
            [(0x0804u16, Lang::Zh), (0x0404, Lang::Zh), (0x0480, Lang::Ug), (0x0409, Lang::En), (0x0407, Lang::En)];
        for (id, lang) in cases {
            assert_eq!(from_primary(id & 0x3ff), lang, "{id:#06x}");
        }
        assert!(Lang::ALL.contains(&system()));
    }

    #[test]
    fn tr_picks_the_arm_of_each_language() {
        let product = "GladosXshell";
        let all: Vec<String> = Lang::ALL
            .into_iter()
            .map(|lang| tr!(@in lang, "{product} 正在运行，{}", "{product} is running, {}", "{product} ئىجرا بولۇۋاتىدۇ، {}", 3))
            .collect();
        assert_eq!(all, ["GladosXshell 正在运行，3", "GladosXshell is running, 3", "GladosXshell ئىجرا بولۇۋاتىدۇ، 3"]);
        assert_eq!(current(), Lang::Zh);
        assert_eq!(tr!("完成", "Done", "تامام"), "完成");
    }

    #[test]
    fn ltr_runs_are_isolated_only_in_uyghur() {
        assert_eq!(ltr_in(Lang::Ug, r"C:\Apps"), "\u{2066}C:\\Apps\u{2069}");
        assert_eq!(ltr_in(Lang::En, r"C:\Apps"), r"C:\Apps");
        assert_eq!(ltr_in(Lang::Zh, r"C:\Apps"), r"C:\Apps");
        assert_eq!(ltr_in(Lang::Ug, ""), "");
        assert_eq!(ltr("0.1.1"), "0.1.1");
    }
}
