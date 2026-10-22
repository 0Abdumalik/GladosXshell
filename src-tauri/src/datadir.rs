//! Where the app keeps its data: `%USERPROFILE%\.gladosxshell`, or a `data` folder beside the
//! program for a portable copy. Versions before this kept it in `%APPDATA%` (settings, connections,
//! keys) and `%LOCALAPPDATA%` (the WebView profile); those are moved over on first start.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use gxs_core::i18n::{Lang, ltr_in};
use gxs_core::tr;

use crate::applog::Level;

/// A folder with this name beside the program makes it portable.
pub const PORTABLE: &str = "data";
/// The WebView profile (local storage, caches) inside the data folder.
pub const WEBVIEW: &str = "webview";

pub fn folder_name(identifier: &str) -> &'static str {
    if identifier.ends_with(".debug") { ".gladosxshell-debug" } else { ".gladosxshell" }
}

/// Folders older versions used, as Tauri resolves them for this identifier.
pub struct Legacy {
    pub data: Option<PathBuf>,
    pub webview: Option<PathBuf>,
}

pub struct Prepared {
    pub root: PathBuf,
    pub note: Option<(Level, Note)>,
}

/// What happened to the old folders. It is put into words later, once settings have picked the
/// language: the data folder has to be known before settings can be read.
pub struct Note(Vec<Event>);

enum Event {
    Moved { from: PathBuf, to: PathBuf },
    Copied { from: PathBuf, to: PathBuf },
    Failed { to: PathBuf, error: String, using: PathBuf },
    Webview { from: PathBuf, error: String },
}

impl Note {
    pub fn text(&self) -> String {
        self.text_in(gxs_core::i18n::current())
    }

    pub fn text_in(&self, lang: Lang) -> String {
        let path = |p: &Path| ltr_in(lang, &p.display().to_string());
        let sentences: Vec<String> = self
            .0
            .iter()
            .map(|event| match event {
                Event::Moved { from, to } => {
                    let (from, to) = (path(from), path(to));
                    tr!(@in lang, "数据已从 {from} 移到 {to}", "Data moved from {from} to {to}", "سانلىق مەلۇمات {from} دىن {to} غا يۆتكەلدى")
                }
                Event::Copied { from, to } => {
                    let (from, to) = (path(from), path(to));
                    tr!(@in lang,
                        "数据已从 {from} 复制到 {to}，旧文件夹没能删除，确认无误后可以手动删掉",
                        "Data copied from {from} to {to}, but the old folder could not be deleted; once everything checks out, you can delete it by hand",
                        "سانلىق مەلۇمات {from} دىن {to} غا كۆچۈرۈلدى، كونا قىسقۇچنى ئۆچۈرگىلى بولمىدى، خاتالىق يوقلۇقىنى جەزملەشتۈرگەندىن كېيىن ئۇنى قولدا ئۆچۈرسىڭىز بولىدۇ"
                    )
                }
                Event::Failed { to, error, using } => {
                    let (to, using, error) = (path(to), path(using), ltr_in(lang, error));
                    tr!(@in lang,
                        "没能把数据移到 {to}（{error}），这次仍使用 {using}",
                        "Could not move the data to {to} ({error}); this run still uses {using}",
                        "سانلىق مەلۇماتنى {to} غا يۆتكىگىلى بولمىدى ({error})، بۇ قېتىم يەنىلا {using} ئىشلىتىلىدۇ"
                    )
                }
                Event::Webview { from, error } => {
                    let (from, error) = (path(from), ltr_in(lang, error));
                    tr!(@in lang,
                        "界面缓存没能从 {from} 移过来（{error}），收起状态等界面记录会重新开始",
                        "Could not move the interface cache from {from} ({error}); interface records such as collapsed panels start over",
                        "كۆرۈنمە يۈز غەملىكىنى {from} دىن يۆتكەپ كەلگىلى بولمىدى ({error})، يىغىلغان ھالەت قاتارلىق كۆرۈنمە يۈز خاتىرىلىرى قايتىدىن باشلىنىدۇ"
                    )
                }
            })
            .collect();
        let sep = match lang {
            Lang::Zh => "；", // i18n-ignore: the Chinese clause separator
            Lang::En => "; ",
            Lang::Ug => "؛ ",
        };
        sentences.join(sep)
    }
}

pub fn prepare(exe_dir: Option<&Path>, home: &Path, identifier: &str, legacy: &Legacy) -> Prepared {
    if let Some(portable) = exe_dir.map(|d| d.join(PORTABLE)).filter(|d| d.is_dir()) {
        // A portable copy starts on its own; taking the installed copy's data would strand it.
        return Prepared { root: portable, note: None };
    }
    let root = home.join(folder_name(identifier));
    let mut events = Vec::new();
    let mut level = Level::Info;
    if let Some(old) = &legacy.data {
        match adopt(old, &root) {
            Ok(Adopted::Nothing) => {}
            Ok(Adopted::Moved) => events.push(Event::Moved { from: old.clone(), to: root.clone() }),
            Ok(Adopted::Copied) => events.push(Event::Copied { from: old.clone(), to: root.clone() }),
            Err(e) => {
                // Nothing half-copied is left behind; this run keeps using the old folder.
                let failed = Event::Failed { to: root, error: e.to_string(), using: old.clone() };
                return Prepared { root: old.clone(), note: Some((Level::Warn, Note(vec![failed]))) };
            }
        }
    }
    if let Some(old) = &legacy.webview
        && let Err(e) = adopt(old, &root.join(WEBVIEW))
    {
        level = Level::Warn;
        events.push(Event::Webview { from: old.clone(), error: e.to_string() });
    }
    let note = (!events.is_empty()).then_some((level, Note(events)));
    Prepared { root, note }
}

#[derive(Debug, PartialEq)]
enum Adopted {
    Nothing,
    Moved,
    /// Copied because it could not be moved; the old folder is still there.
    Copied,
}

/// Brings `old` to `new` when `new` holds nothing yet.
fn adopt(old: &Path, new: &Path) -> io::Result<Adopted> {
    if !old.is_dir() || is_empty_dir(old) {
        return Ok(Adopted::Nothing);
    }
    if new.exists() {
        if !is_empty_dir(new) {
            return Ok(Adopted::Nothing);
        }
        fs::remove_dir(new)?;
    }
    if let Some(parent) = new.parent() {
        fs::create_dir_all(parent)?;
    }
    if fs::rename(old, new).is_ok() {
        return Ok(Adopted::Moved);
    }
    // Another drive, or something still holds a file: copy and leave the old folder alone.
    if let Err(e) = copy_dir(old, new) {
        let _ = fs::remove_dir_all(new);
        return Err(e);
    }
    Ok(Adopted::Copied)
}

fn is_empty_dir(path: &Path) -> bool {
    fs::read_dir(path).is_ok_and(|mut entries| entries.next().is_none())
}

fn copy_dir(from: &Path, to: &Path) -> io::Result<()> {
    fs::create_dir(to)?;
    for entry in fs::read_dir(from)? {
        let entry = entry?;
        let target = to.join(entry.file_name());
        let kind = entry.file_type()?;
        if kind.is_dir() {
            copy_dir(&entry.path(), &target)?;
        } else if kind.is_file() {
            fs::copy(entry.path(), &target)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("gxs-datadir-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn legacy(base: &Path) -> Legacy {
        let data = base.join("Roaming").join("com.gladosx.shell");
        let webview = base.join("Local").join("com.gladosx.shell");
        fs::create_dir_all(data.join("keys")).unwrap();
        fs::write(data.join("connections.json"), b"{}").unwrap();
        fs::write(data.join("keys").join("id"), b"k").unwrap();
        fs::create_dir_all(webview.join("EBWebView")).unwrap();
        fs::write(webview.join("EBWebView").join("Local State"), b"{}").unwrap();
        Legacy { data: Some(data), webview: Some(webview) }
    }

    #[test]
    fn names_follow_the_flavor() {
        assert_eq!(folder_name("com.gladosx.shell"), ".gladosxshell");
        assert_eq!(folder_name("com.gladosx.shell.debug"), ".gladosxshell-debug");
    }

    #[test]
    fn old_folders_move_into_the_home_folder() {
        let base = temp_dir("move");
        let old = legacy(&base);
        let home = base.join("home");
        let done = prepare(None, &home, "com.gladosx.shell", &old);
        let root = home.join(".gladosxshell");
        assert_eq!(done.root, root);
        assert_eq!(fs::read(root.join("keys").join("id")).unwrap(), b"k");
        assert!(root.join(WEBVIEW).join("EBWebView").join("Local State").is_file());
        assert!(!old.data.as_ref().unwrap().exists());
        assert!(!old.webview.as_ref().unwrap().exists());
        let (level, note) = done.note.as_ref().unwrap();
        assert_eq!(*level, Level::Info);
        let (from, to) = (old.data.as_ref().unwrap().display(), root.display());
        assert_eq!(note.text(), format!("数据已从 {from} 移到 {to}"));
        assert_eq!(note.text_in(Lang::En), format!("Data moved from {from} to {to}"));
        assert!(note.text_in(Lang::Ug).contains(&format!("\u{2066}{to}\u{2069}")));

        // Second start: nothing left to move, nothing said.
        let again = prepare(None, &home, "com.gladosx.shell", &old);
        assert_eq!(again.root, root);
        assert!(again.note.is_none());
        fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn existing_data_is_never_overwritten() {
        let base = temp_dir("keep");
        let old = legacy(&base);
        let root = base.join("home").join(".gladosxshell");
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("connections.json"), b"new").unwrap();
        let done = prepare(None, &base.join("home"), "com.gladosx.shell", &old);
        assert_eq!(done.root, root);
        assert_eq!(fs::read(root.join("connections.json")).unwrap(), b"new");
        assert!(old.data.as_ref().unwrap().join("connections.json").is_file());
        fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn a_data_folder_beside_the_program_wins_and_takes_nothing() {
        let base = temp_dir("portable");
        let old = legacy(&base);
        let exe_dir = base.join("app");
        fs::create_dir_all(exe_dir.join(PORTABLE)).unwrap();
        let done = prepare(Some(&exe_dir), &base.join("home"), "com.gladosx.shell", &old);
        assert_eq!(done.root, exe_dir.join(PORTABLE));
        assert!(done.note.is_none());
        assert!(old.data.as_ref().unwrap().join("connections.json").is_file());
        fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn copy_keeps_the_tree() {
        let base = temp_dir("copy");
        let old = legacy(&base);
        let to = base.join("copy");
        copy_dir(old.data.as_ref().unwrap(), &to).unwrap();
        assert_eq!(fs::read(to.join("keys").join("id")).unwrap(), b"k");
        assert_eq!(fs::read(to.join("connections.json")).unwrap(), b"{}");
        fs::remove_dir_all(&base).unwrap();
    }
}
