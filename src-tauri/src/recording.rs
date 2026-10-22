//! Terminal recordings in asciicast v2. The UI sends what a terminal showed, in batches;
//! this side owns the files, which live in `<work dir>/recordings`.

use std::collections::HashMap;
use std::fs::{File, OpenOptions};
use std::io::{BufWriter, Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use gxs_core::i18n::ltr;
use gxs_core::{Error, tr};
use gxs_core::local_path::sanitize_name;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use tauri::State;
use tokio::sync::Mutex;

use crate::{AppState, Result};

const EXT: &str = ".cast";
const MAX_OPEN: usize = 32;
const MAX_BATCH_BYTES: usize = 8 * 1024 * 1024;
const MAX_FILE_BYTES: u64 = 2 * 1024 * 1024 * 1024;
/// Bigger files are left to asciinema; the player keeps the whole recording in memory.
const MAX_READ_BYTES: u64 = 64 * 1024 * 1024;
const HEAD_BYTES: u64 = 4096;
const TAIL_BYTES: u64 = 64 * 1024;

struct Writer {
    file: BufWriter<File>,
    written: u64,
    name: String,
}

type Shared = Arc<std::sync::Mutex<Writer>>;

#[derive(Default)]
pub(crate) struct Recordings {
    open: Mutex<HashMap<u32, Shared>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CastStart {
    name: String,
    width: u16,
    height: u16,
    #[serde(default)]
    title: String,
    #[serde(default)]
    term: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CastOpened {
    id: u32,
    name: String,
    path: String,
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CastEntry {
    name: String,
    size: u64,
    /// Milliseconds since the epoch.
    modified: u64,
    title: String,
    width: u16,
    height: u16,
    /// Seconds to the last event; missing if the tail can't be read.
    duration: Option<f64>,
}

/// `[seconds, code, data]`, as in the file.
pub type CastEvent = (f64, String, String);

fn header(start: &CastStart, timestamp: u64) -> String {
    let mut header = json!({
        "version": 2,
        "width": start.width.max(1),
        "height": start.height.max(1),
        "timestamp": timestamp,
    });
    let title: String = start.title.chars().filter(|c| !c.is_control()).take(200).collect();
    if !title.is_empty() {
        header["title"] = json!(title);
    }
    let term: String = start.term.chars().filter(|c| c.is_ascii_graphic()).take(64).collect();
    if !term.is_empty() {
        header["env"] = json!({ "TERM": term });
    }
    header.to_string()
}

/// One line per event; only output, resize and marker events, at a sane time.
fn event_lines(events: &[CastEvent], out: &mut String) -> Result<()> {
    for (time, code, data) in events {
        if !time.is_finite() || *time < 0.0 {
            return Err(Error::Invalid(tr!(
                "录像事件的时间不对",
                "A recording event has a wrong time",
                "سىن ھادىسىسىنىڭ ۋاقتى خاتا"
            )));
        }
        if !matches!(code.as_str(), "o" | "r" | "m") {
            let code = ltr(code);
            return Err(Error::Invalid(tr!(
                "不支持的录像事件：{code}",
                "Unsupported recording event: {code}",
                "قوللىمايدىغان سىن ھادىسىسى: {code}"
            )));
        }
        let time = (time * 1_000_000.0).round() / 1_000_000.0;
        out.push_str(&serde_json::to_string(&(time, code, data)).map_err(|e| Error::Invalid(e.to_string()))?);
        out.push('\n');
    }
    Ok(())
}

/// A bare `.cast` file name inside the recordings folder.
fn checked_name(name: &str) -> Result<&str> {
    if name.is_empty() || name != sanitize_name(name) || !name.ends_with(EXT) {
        return Err(Error::Invalid(tr!("录像文件名不对", "The recording file name is not valid", "سىن ھۆججىتىنىڭ نامى توغرا ئەمەس")));
    }
    Ok(name)
}

fn file_name(wanted: &str) -> String {
    let wanted = wanted.trim();
    let wanted = wanted.strip_suffix(EXT).unwrap_or(wanted);
    let stem = sanitize_name(if wanted.is_empty() { "recording" } else { wanted });
    format!("{stem}{EXT}")
}

/// Creates `name`, or `name (2)` and so on if it is taken; never overwrites.
fn create_new(dir: &Path, name: &str) -> std::io::Result<(File, String)> {
    std::fs::create_dir_all(dir)?;
    let stem = name.strip_suffix(EXT).unwrap_or(name);
    for n in 1..=999 {
        let candidate = if n == 1 { name.to_owned() } else { format!("{stem} ({n}){EXT}") };
        match OpenOptions::new().write(true).create_new(true).open(dir.join(&candidate)) {
            Ok(file) => return Ok((file, candidate)),
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(e),
        }
    }
    Err(std::io::Error::other(tr!("同名录像太多", "Too many recordings with this name", "ئوخشاش ناملىق سىن بەك كۆپ")))
}

fn header_info(head: &str) -> Option<(String, u16, u16)> {
    let header: Value = serde_json::from_str(head.lines().next()?).ok()?;
    if header.get("version")?.as_u64()? != 2 {
        return None;
    }
    let size = |key: &str| header.get(key).and_then(Value::as_u64).and_then(|v| u16::try_from(v).ok());
    let title = header.get("title").and_then(Value::as_str).unwrap_or_default().to_owned();
    Some((title, size("width")?, size("height")?))
}

/// The time of the last complete event in the tail of a file.
fn last_time(tail: &str) -> Option<f64> {
    tail.lines().rev().find_map(|line| {
        let event: Value = serde_json::from_str(line).ok()?;
        event.as_array()?.first()?.as_f64()
    })
}

fn read_lossy(file: &mut File, from: u64, len: u64) -> std::io::Result<String> {
    file.seek(SeekFrom::Start(from))?;
    let mut buf = Vec::new();
    file.take(len).read_to_end(&mut buf)?;
    Ok(String::from_utf8_lossy(&buf).into_owned())
}

fn entry(path: &Path, name: String) -> Option<CastEntry> {
    let meta = std::fs::metadata(path).ok()?;
    let modified = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map_or(0, |d| d.as_millis() as u64);
    let mut file = File::open(path).ok()?;
    let (title, width, height) = header_info(&read_lossy(&mut file, 0, HEAD_BYTES).ok()?)?;
    let size = meta.len();
    let tail = read_lossy(&mut file, size.saturating_sub(TAIL_BYTES), TAIL_BYTES).ok();
    Some(CastEntry {
        name,
        size,
        modified,
        title,
        width,
        height,
        duration: tail.as_deref().and_then(last_time),
    })
}

fn io_error(e: tokio::task::JoinError) -> Error {
    Error::Io(std::io::Error::other(e))
}

#[tauri::command]
pub async fn recording_start(state: State<'_, AppState>, start: CastStart) -> Result<CastOpened> {
    let mut open = state.recordings.open.lock().await;
    if open.len() >= MAX_OPEN {
        return Err(Error::Invalid(tr!(
            "最多同时录制 {MAX_OPEN} 个终端",
            "At most {MAX_OPEN} terminals can be recorded at the same time",
            "بىرلا ۋاقىتتا ئەڭ كۆپ بولغاندا {MAX_OPEN} تېرمىنالنى سىنغا ئالغىلى بولىدۇ"
        )));
    }
    let dir = state.settings.recordings_dir().await;
    let timestamp = SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_secs());
    let line = header(&start, timestamp) + "\n";
    let wanted = file_name(&start.name);
    let (writer, name) = tokio::task::spawn_blocking({
        let dir = dir.clone();
        move || -> std::io::Result<(Writer, String)> {
            let (file, name) = create_new(&dir, &wanted)?;
            let mut file = BufWriter::new(file);
            file.write_all(line.as_bytes())?;
            file.flush()?;
            let writer = Writer {
                file,
                written: line.len() as u64,
                name: name.clone(),
            };
            Ok((writer, name))
        }
    })
    .await
    .map_err(io_error)?
    .map_err(|e| {
        let (shown, error) = (ltr(&dir.display().to_string()), ltr(&e.to_string()));
        let text = tr!(
            "无法创建录像 {shown}：{error}",
            "Could not create a recording in {shown}: {error}",
            "{shown} دا سىن قۇرغىلى بولمىدى: {error}"
        );
        Error::Io(std::io::Error::new(e.kind(), text))
    })?;
    let id = state.id();
    open.insert(id, Arc::new(std::sync::Mutex::new(writer)));
    Ok(CastOpened {
        id,
        path: dir.join(&name).to_string_lossy().into_owned(),
        name,
    })
}

/// Appends a batch; a recording that fails or grows too big is closed and reported.
#[tauri::command]
pub async fn recording_write(state: State<'_, AppState>, id: u32, events: Vec<CastEvent>) -> Result<()> {
    let writer = state.recordings.open.lock().await.get(&id).cloned().ok_or(Error::Closed)?;
    let mut text = String::new();
    event_lines(&events, &mut text)?;
    if text.len() > MAX_BATCH_BYTES {
        return Err(Error::Invalid(tr!(
            "一次写入的录像数据太多",
            "Too much recording data in one write",
            "بىر قېتىمدا يېزىلغان سىن سانلىق مەلۇماتى بەك كۆپ"
        )));
    }
    let outcome = tokio::task::spawn_blocking(move || -> std::io::Result<()> {
        let mut w = writer
            .lock()
            .map_err(|_| std::io::Error::other(tr!("录像写入出错", "Writing the recording failed", "سىننى يېزىشتا خاتالىق كۆرۈلدى")))?;
        if w.written + text.len() as u64 > MAX_FILE_BYTES {
            return Err(std::io::Error::other(tr!(
                "录像超过 2 GB，已停止",
                "The recording passed 2 GB and was stopped",
                "سىن 2 GB دىن ئېشىپ كەتتى، توختىتىلدى"
            )));
        }
        w.file.write_all(text.as_bytes())?;
        w.file.flush()?;
        w.written += text.len() as u64;
        Ok(())
    })
    .await
    .map_err(io_error)?;
    if let Err(e) = outcome {
        state.recordings.open.lock().await.remove(&id);
        return Err(Error::Io(e));
    }
    Ok(())
}

#[tauri::command]
pub async fn recording_stop(state: State<'_, AppState>, id: u32) -> Result<()> {
    let Some(writer) = state.recordings.open.lock().await.remove(&id) else {
        return Ok(());
    };
    tokio::task::spawn_blocking(move || {
        if let Ok(mut w) = writer.lock() {
            let _ = w.file.flush();
        }
    })
    .await
    .map_err(io_error)
}

/// Recordings in the folder, newest first.
#[tauri::command]
pub async fn recording_list(state: State<'_, AppState>) -> Result<Vec<CastEntry>> {
    let dir = state.settings.recordings_dir().await;
    tokio::task::spawn_blocking(move || {
        let Ok(read) = std::fs::read_dir(&dir) else {
            return Vec::new();
        };
        let mut list: Vec<CastEntry> = read
            .filter_map(|e| e.ok())
            .filter(|e| e.file_type().is_ok_and(|t| t.is_file()))
            .filter_map(|e| {
                let name = e.file_name().into_string().ok()?;
                checked_name(&name).ok()?;
                entry(&e.path(), name)
            })
            .collect();
        list.sort_by(|a, b| b.modified.cmp(&a.modified).then_with(|| a.name.cmp(&b.name)));
        list
    })
    .await
    .map_err(io_error)
}

#[tauri::command]
pub async fn recording_read(state: State<'_, AppState>, name: String) -> Result<String> {
    let path = state.settings.recordings_dir().await.join(checked_name(&name)?);
    let size = tokio::fs::metadata(&path).await?.len();
    if size > MAX_READ_BYTES {
        let (size, max) = (size / 1024 / 1024, MAX_READ_BYTES / 1024 / 1024);
        return Err(Error::Invalid(tr!(
            "录像有 {size} MB，超过 {max} MB，请用 asciinema 等工具播放",
            "The recording is {size} MB, more than {max} MB. Play it with a tool such as asciinema",
            "سىن {size} MB، {max} MB دىن ئېشىپ كەتتى، asciinema قاتارلىق قورال بىلەن قويۇڭ"
        )));
    }
    let bytes = tokio::fs::read(&path).await?;
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

#[tauri::command]
pub async fn recording_delete(state: State<'_, AppState>, name: String) -> Result<()> {
    let name = checked_name(&name)?;
    for writer in state.recordings.open.lock().await.values() {
        if writer.lock().is_ok_and(|w| w.name == name) {
            return Err(Error::Invalid(tr!(
                "这个录像还在录制，先停止录制",
                "This recording is still running. Stop it first",
                "بۇ سىن تېخى ئېلىنىۋاتىدۇ، ئالدى بىلەن سىن ئېلىشنى توختىتىڭ"
            )));
        }
    }
    let path = state.settings.recordings_dir().await.join(name);
    tokio::fs::remove_file(path).await?;
    Ok(())
}

/// The recordings folder, created on demand so it can be opened in the file manager.
#[tauri::command]
pub async fn recording_dir(state: State<'_, AppState>) -> Result<String> {
    let dir: PathBuf = state.settings.recordings_dir().await;
    tokio::fs::create_dir_all(&dir).await?;
    Ok(dir.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn start(title: &str, term: &str) -> CastStart {
        CastStart {
            name: "x".into(),
            width: 120,
            height: 0,
            title: title.into(),
            term: term.into(),
        }
    }

    #[test]
    fn header_is_asciicast_v2() {
        let line = header(&start("web\u{7}01", "xterm-256color"), 1_700_000_000);
        let value: Value = serde_json::from_str(&line).unwrap();
        assert_eq!(value["version"], 2);
        assert_eq!(value["width"], 120);
        assert_eq!(value["height"], 1);
        assert_eq!(value["timestamp"], 1_700_000_000u64);
        assert_eq!(value["title"], "web01");
        assert_eq!(value["env"]["TERM"], "xterm-256color");
        assert_eq!(header_info(&line), Some(("web01".into(), 120, 1)));
        let bare: Value = serde_json::from_str(&header(&start("", ""), 0)).unwrap();
        assert!(bare.get("title").is_none() && bare.get("env").is_none());
    }

    #[test]
    fn events_become_json_lines() {
        let mut out = String::new();
        let events = vec![
            (0.1234567, "o".to_owned(), "a\"\u{1b}[0m\r\n".to_owned()),
            (2.5, "r".to_owned(), "80x24".to_owned()),
        ];
        event_lines(&events, &mut out).unwrap();
        assert_eq!(out, "[0.123457,\"o\",\"a\\\"\\u001b[0m\\r\\n\"]\n[2.5,\"r\",\"80x24\"]\n");
        assert_eq!(last_time(&out), Some(2.5));
    }

    #[test]
    fn bad_events_are_refused() {
        let mut out = String::new();
        assert!(event_lines(&[(1.0, "x".into(), String::new())], &mut out).is_err());
        assert!(event_lines(&[(-1.0, "o".into(), String::new())], &mut out).is_err());
        assert!(event_lines(&[(f64::NAN, "o".into(), String::new())], &mut out).is_err());
    }

    #[test]
    fn names_stay_inside_the_folder() {
        assert_eq!(file_name("web/01: build"), "web_01_ build.cast");
        assert_eq!(file_name("  "), "recording.cast");
        assert_eq!(file_name("a.cast"), "a.cast");
        assert!(checked_name("a.cast").is_ok());
        assert!(checked_name("../a.cast").is_err());
        assert!(checked_name("a\\b.cast").is_err());
        assert!(checked_name("a.log").is_err());
        assert!(checked_name("").is_err());
    }

    #[test]
    fn last_time_skips_a_cut_off_line() {
        assert_eq!(last_time("[1.5,\"o\",\"a\"]\n[2.0,\"o\",\"b"), Some(1.5));
        assert_eq!(last_time("{\"version\":2}\n"), None);
    }

    #[test]
    fn taken_names_get_a_number() {
        let dir = std::env::temp_dir().join(format!("gx-cast-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let (_, first) = create_new(&dir, "a.cast").unwrap();
        let (_, second) = create_new(&dir, "a.cast").unwrap();
        assert_eq!((first.as_str(), second.as_str()), ("a.cast", "a (2).cast"));
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
