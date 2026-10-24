//! Files the user picks once and reuses: terminal background images and font files are copied
//! into the config directory, and font names are read from the system and from a fallback folder.

use std::path::{Path, PathBuf};

use gxs_core::{Error, fsutil, tr};
use serde::Serialize;
use tauri::State;
use tauri::ipc::Response;

use crate::settings::{IMAGE_EXTENSIONS, MAX_IMAGE, check_path};
use crate::{AppState, Result};

const BACKGROUNDS: &str = "backgrounds";
const FONTS: &str = "fonts";
/// Only plain sfnt files: the webview's FontFace cannot pick a face out of a collection.
const FONT_EXTENSIONS: &[&str] = &["ttf", "otf"];
const MAX_FONT: u64 = 64 * 1024 * 1024;
const MAX_LIBRARY: usize = 200;
const MAX_FOLDER_FILES: usize = 256;
const MAX_FOLDER_DEPTH: usize = 3;
/// Folder fonts are all loaded into the webview, so their total size is capped.
const MAX_FOLDER_BYTES: u64 = 512 * 1024 * 1024;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryImage {
    path: String,
    name: String,
    size: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FontFamily {
    name: String,
    /// A localized name such as 微软雅黑, when the font has one.
    local_name: Option<String>,
    mono: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FontFile {
    family: String,
    path: String,
    weight: u16,
    italic: bool,
    mono: bool,
    size: u64,
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FontSet {
    fonts: Vec<FontFile>,
    /// Font files left out because of the count or size caps.
    skipped: usize,
}

fn extension(path: &Path) -> String {
    path.extension()
        .and_then(|e| e.to_str())
        .map(str::to_ascii_lowercase)
        .unwrap_or_default()
}

fn absolute(path: &str, what: &str) -> Result<PathBuf> {
    let path = check_path(path, what)?;
    if path.is_empty() {
        return Err(Error::Invalid(tr!("{what}不能为空", "The {what} cannot be empty", "{what} بوش بولسا بولمايدۇ")));
    }
    Ok(PathBuf::from(path))
}

fn safe_stem(path: &Path, fallback: &str) -> String {
    let stem = path.file_stem().map(|s| s.to_string_lossy()).unwrap_or_default();
    let clean: String = stem
        .chars()
        .filter(|c| !c.is_control() && !"<>:\"/\\|?*".contains(*c))
        .take(60)
        .collect();
    let clean = clean.trim().trim_end_matches('.');
    if clean.is_empty() { fallback.to_owned() } else { clean.to_owned() }
}

async fn is_inside(dir: &Path, path: &Path) -> bool {
    let (Ok(dir), Ok(path)) = (tokio::fs::canonicalize(dir).await, tokio::fs::canonicalize(path).await) else {
        return false;
    };
    path.parent() == Some(dir.as_path())
}

/// Copies `source` into `dir`, reusing an identical file and numbering name clashes.
async fn import_file(dir: &Path, source: &Path, max: u64, too_big: &str, fallback: &str) -> Result<PathBuf> {
    let meta = tokio::fs::metadata(source).await?;
    if !meta.is_file() {
        return Err(Error::Invalid(tr!("请选择一个文件", "Choose a file", "بىر ھۆججەت تاللاڭ")));
    }
    if meta.len() > max {
        return Err(Error::Invalid(too_big.into()));
    }
    tokio::fs::create_dir_all(dir).await?;
    if is_inside(dir, source).await {
        return Ok(source.to_path_buf());
    }
    let stem = safe_stem(source, fallback);
    let ext = extension(source);
    let bytes = tokio::fs::read(source).await?;
    for n in 1..100 {
        let name = if n == 1 { format!("{stem}.{ext}") } else { format!("{stem}-{n}.{ext}") };
        let target = dir.join(name);
        match tokio::fs::metadata(&target).await {
            Ok(m) if m.len() == bytes.len() as u64 && tokio::fs::read(&target).await? == bytes => return Ok(target),
            Ok(_) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                fsutil::write_atomic(&target, bytes).await?;
                return Ok(target);
            }
            Err(e) => return Err(e.into()),
        }
    }
    Err(Error::Invalid(tr!(
        "库里同名的文件太多，请先改个文件名",
        "The library has too many files with this name. Rename the file first",
        "ئامباردا ئوخشاش ناملىق ھۆججەت بەك كۆپ، ئالدى بىلەن ھۆججەت نامىنى ئۆزگەرتىڭ"
    )))
}

async fn remove_from(dir: &Path, path: &str) -> Result<()> {
    let path = absolute(path, &tr!("文件路径", "file path", "ھۆججەت يولى"))?;
    if !is_inside(dir, &path).await {
        return Err(Error::Invalid(tr!(
            "只能删除库里的文件",
            "Only files in the library can be deleted",
            "پەقەت ئامباردىكى ھۆججەتلەرنىلا ئۆچۈرگىلى بولىدۇ"
        )));
    }
    tokio::fs::remove_file(&path).await?;
    Ok(())
}

fn to_string(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

fn image_entry(path: &Path, size: u64) -> LibraryImage {
    LibraryImage {
        path: to_string(path),
        name: path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default(),
        size,
    }
}

#[tauri::command]
pub async fn background_list(state: State<'_, AppState>) -> Result<Vec<LibraryImage>> {
    let dir = state.config_dir.join(BACKGROUNDS);
    let mut out = Vec::new();
    let mut entries = match tokio::fs::read_dir(&dir).await {
        Ok(entries) => entries,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(out),
        Err(e) => return Err(e.into()),
    };
    while let Some(entry) = entries.next_entry().await? {
        let path = entry.path();
        let meta = entry.metadata().await?;
        if meta.is_file() && IMAGE_EXTENSIONS.contains(&extension(&path).as_str()) && out.len() < MAX_LIBRARY {
            out.push(image_entry(&path, meta.len()));
        }
    }
    out.sort_by_key(|i| i.name.to_lowercase());
    Ok(out)
}

#[tauri::command]
pub async fn background_import(state: State<'_, AppState>, path: String) -> Result<LibraryImage> {
    let source = absolute(&path, &tr!("图片路径", "image path", "رەسىم يولى"))?;
    if !IMAGE_EXTENSIONS.contains(&extension(&source).as_str()) {
        return Err(Error::Invalid(tr!(
            "只支持 png、jpg、gif、webp、bmp 图片",
            "Only png, jpg, gif, webp and bmp images are supported",
            "پەقەت png، jpg، gif، webp، bmp رەسىملىرىنىلا قوللايدۇ"
        )));
    }
    let dir = state.config_dir.join(BACKGROUNDS);
    let too_big = tr!("背景图片不能超过 20 MB", "The background image cannot be larger than 20 MB", "تەگلىك رەسىمى 20 MB دىن ئېشىپ كەتسە بولمايدۇ");
    let stored = import_file(&dir, &source, MAX_IMAGE, &too_big, "image").await?;
    let size = tokio::fs::metadata(&stored).await?.len();
    Ok(image_entry(&stored, size))
}

#[tauri::command]
pub async fn background_remove(state: State<'_, AppState>, path: String) -> Result<()> {
    remove_from(&state.config_dir.join(BACKGROUNDS), &path).await
}

fn local_name(families: &[(String, fontdb::Language)], primary: &str) -> Option<String> {
    families
        .iter()
        .find(|(name, lang)| *lang != fontdb::Language::English_UnitedStates && name != primary)
        .map(|(name, _)| name.clone())
}

fn system_families() -> Vec<FontFamily> {
    let mut db = fontdb::Database::new();
    db.load_system_fonts();
    let mut out: Vec<FontFamily> = Vec::new();
    for face in db.faces() {
        let Some((name, _)) = face.families.first() else { continue };
        if name.starts_with('.') || name.trim().is_empty() {
            continue;
        }
        match out.iter_mut().find(|f| f.name == *name) {
            Some(family) => {
                family.mono |= face.monospaced;
                if family.local_name.is_none() {
                    family.local_name = local_name(&face.families, name);
                }
            }
            None => out.push(FontFamily {
                name: name.clone(),
                local_name: local_name(&face.families, name),
                mono: face.monospaced,
            }),
        }
    }
    out.sort_by_key(|f| f.name.to_lowercase());
    out
}

fn font_files(dir: &Path, depth: usize, out: &mut Vec<PathBuf>) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    let mut entries: Vec<PathBuf> = entries.flatten().map(|e| e.path()).collect();
    entries.sort();
    for path in entries {
        if out.len() >= MAX_FOLDER_FILES {
            return;
        }
        if path.is_dir() {
            if depth < MAX_FOLDER_DEPTH {
                font_files(&path, depth + 1, out);
            }
        } else if FONT_EXTENSIONS.contains(&extension(&path).as_str()) {
            out.push(path);
        }
    }
}

fn read_fonts(files: &[PathBuf]) -> FontSet {
    let mut set = FontSet::default();
    let mut total = 0;
    for path in files {
        let size = std::fs::metadata(path).map(|m| m.len()).unwrap_or(u64::MAX);
        if size > MAX_FONT || total + size > MAX_FOLDER_BYTES {
            set.skipped += 1;
            continue;
        }
        let mut db = fontdb::Database::new();
        if db.load_font_file(path).is_err() {
            continue;
        }
        let Some(face) = db.faces().next() else { continue };
        let Some((family, _)) = face.families.first() else { continue };
        total += size;
        set.fonts.push(FontFile {
            family: family.clone(),
            path: to_string(path),
            weight: face.weight.0,
            italic: face.style != fontdb::Style::Normal,
            mono: face.monospaced,
            size,
        });
    }
    set
}

fn font_path() -> String {
    tr!("字体文件路径", "font file path", "خەت نۇسخىسى ھۆججىتى يولى")
}

fn font_types() -> String {
    tr!(
        "只支持 .ttf 和 .otf 字体文件",
        "Only .ttf and .otf font files are supported",
        "پەقەت \u{2066}.ttf\u{2069} ۋە \u{2066}.otf\u{2069} خەت نۇسخىسى ھۆججەتلىرىنىلا قوللايدۇ"
    )
}

fn font_too_big() -> String {
    tr!(
        "字体文件不能超过 64 MB",
        "The font file cannot be larger than 64 MB",
        "خەت نۇسخىسى ھۆججىتى 64 MB دىن ئېشىپ كەتسە بولمايدۇ"
    )
}

async fn blocking<T: Send + 'static>(run: impl FnOnce() -> T + Send + 'static) -> Result<T> {
    tokio::task::spawn_blocking(run)
        .await
        .map_err(|e| Error::Io(std::io::Error::other(e.to_string())))
}

/// Installed font families, for the terminal font picker.
#[tauri::command]
pub async fn fonts_system() -> Result<Vec<FontFamily>> {
    blocking(system_families).await
}

/// Every font file in a folder (and up to three levels below it), for the last fallback.
#[tauri::command]
pub async fn fonts_folder(path: String) -> Result<FontSet> {
    let dir = absolute(&path, &tr!("字体文件夹", "font folder", "خەت نۇسخىسى قىسقۇچى"))?;
    if !tokio::fs::metadata(&dir).await?.is_dir() {
        return Err(Error::Invalid(tr!("字体文件夹不存在", "The font folder was not found", "خەت نۇسخىسى قىسقۇچى تېپىلمىدى")));
    }
    blocking(move || {
        let mut files = Vec::new();
        font_files(&dir, 0, &mut files);
        read_fonts(&files)
    })
    .await
}

/// Font files imported into the app.
#[tauri::command]
pub async fn font_library(state: State<'_, AppState>) -> Result<FontSet> {
    let dir = state.config_dir.join(FONTS);
    blocking(move || {
        let mut files = Vec::new();
        font_files(&dir, MAX_FOLDER_DEPTH, &mut files);
        read_fonts(&files)
    })
    .await
}

#[tauri::command]
pub async fn font_import(state: State<'_, AppState>, path: String) -> Result<Vec<FontFile>> {
    let source = absolute(&path, &font_path())?;
    if !FONT_EXTENSIONS.contains(&extension(&source).as_str()) {
        return Err(Error::Invalid(font_types()));
    }
    let dir = state.config_dir.join(FONTS);
    let stored = import_file(&dir, &source, MAX_FONT, &font_too_big(), "font").await?;
    let fonts = blocking(move || read_fonts(std::slice::from_ref(&stored)).fonts).await?;
    if fonts.is_empty() {
        return Err(Error::Invalid(tr!(
            "无法识别这个字体文件",
            "This font file could not be recognized",
            "بۇ خەت نۇسخىسى ھۆججىتىنى تونۇغىلى بولمىدى"
        )));
    }
    Ok(fonts)
}

#[tauri::command]
pub async fn font_remove(state: State<'_, AppState>, path: String) -> Result<()> {
    remove_from(&state.config_dir.join(FONTS), &path).await
}

/// The bytes of a font file, for `new FontFace(...)` in the webview.
#[tauri::command]
pub async fn font_data(path: String) -> Result<Response> {
    let path = absolute(&path, &font_path())?;
    if !FONT_EXTENSIONS.contains(&extension(&path).as_str()) {
        return Err(Error::Invalid(font_types()));
    }
    if tokio::fs::metadata(&path).await?.len() > MAX_FONT {
        return Err(Error::Invalid(font_too_big()));
    }
    Ok(Response::new(tokio::fs::read(&path).await?))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("gx-library-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    #[cfg(windows)]
    fn stems_are_safe_file_names() {
        // Backslash paths are Windows semantics; other platforms skip this.
        assert_eq!(safe_stem(Path::new(r"C:\a\海边 photo.png"), "image"), "海边 photo");
        assert_eq!(safe_stem(Path::new(r"C:\a\...png"), "image"), "image");
        assert_eq!(safe_stem(Path::new(r"C:\a\x?y*.png"), "image"), "xy");
    }

    #[tokio::test]
    async fn import_reuses_identical_files_and_numbers_clashes() {
        let root = temp_dir("import");
        let library = root.join("lib");
        let a = root.join("a");
        std::fs::create_dir_all(&a).unwrap();
        std::fs::write(a.join("bg.png"), b"one").unwrap();
        std::fs::write(root.join("bg.png"), b"two").unwrap();

        let first = import_file(&library, &a.join("bg.png"), 10, "big", "image").await.unwrap();
        assert_eq!(first, library.join("bg.png"));
        let again = import_file(&library, &a.join("bg.png"), 10, "big", "image").await.unwrap();
        assert_eq!(again, first);
        let other = import_file(&library, &root.join("bg.png"), 10, "big", "image").await.unwrap();
        assert_eq!(other, library.join("bg-2.png"));
        let inside = import_file(&library, &other, 10, "big", "image").await.unwrap();
        assert_eq!(inside, other);
        assert!(import_file(&library, &root.join("bg.png"), 2, "big", "image").await.is_err());

        assert!(remove_from(&library, &to_string(&root.join("bg.png"))).await.is_err());
        remove_from(&library, &to_string(&other)).await.unwrap();
        assert!(!other.exists());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn folder_scan_keeps_font_files_only() {
        let root = temp_dir("scan");
        std::fs::create_dir_all(root.join("sub")).unwrap();
        for name in ["a.ttf", "b.OTF", "c.ttc", "d.txt", "sub/e.ttf"] {
            std::fs::write(root.join(name), b"not a font").unwrap();
        }
        let mut files = Vec::new();
        font_files(&root, 0, &mut files);
        let names: Vec<String> = files
            .iter()
            .map(|p| p.strip_prefix(&root).unwrap().to_string_lossy().replace('\\', "/"))
            .collect();
        assert_eq!(names, ["a.ttf", "b.OTF", "sub/e.ttf"]);
        // Unparseable files are dropped, not reported as fonts.
        assert!(read_fonts(&files).fonts.is_empty());
        let _ = std::fs::remove_dir_all(&root);
    }
}
