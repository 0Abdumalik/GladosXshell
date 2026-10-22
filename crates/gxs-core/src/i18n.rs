//! Interface language. It is chosen once at startup and fixed for the run; every message the
//! backend shows the user is written in all three languages where it is produced, with [`tr!`].

use std::sync::atomic::{AtomicU8, Ordering};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Lang {
    Zh,
    En,
    Ug,
}

impl Lang {
    pub const ALL: [Lang; 3] = [Lang::Zh, Lang::En, Lang::Ug];

    /// The code the frontend uses, also the one in settings.
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

/// The separator between list items: `a、b` / `a, b` / `a، b`.
pub fn list_sep() -> &'static str {
    list_sep_in(current())
}

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
    fn tags_map_to_the_closest_language() {
        assert_eq!(from_tag("zh_CN.UTF-8"), Lang::Zh);
        assert_eq!(from_tag("ug-CN"), Lang::Ug);
        assert_eq!(from_tag("en_US"), Lang::En);
        assert_eq!(from_tag("de"), Lang::En);
        assert_eq!(from_tag(""), Lang::En);
    }

    #[test]
    fn tr_formats_captures_and_arguments() {
        let name = "web";
        let all: Vec<String> = Lang::ALL
            .into_iter()
            .map(|lang| tr!(@in lang, "已连接 {name}，{}", "Connected to {name}, {}", "{name} غا ئۇلاندى، {}", 3))
            .collect();
        assert_eq!(all, ["已连接 web，3", "Connected to web, 3", "web غا ئۇلاندى، 3"]);
        assert_eq!(current(), Lang::Zh);
        assert_eq!(tr!("就绪", "Ready", "تەييار"), "就绪");
    }

    #[test]
    fn lists_and_ltr_runs_follow_the_language() {
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
}
