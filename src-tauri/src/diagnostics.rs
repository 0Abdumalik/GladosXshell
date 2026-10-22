//! Build info, crash capture and the diagnostics package testers send back. The package holds the
//! app log, crash reports, settings and plugin grants; never connections, keys, history,
//! favorites or anything shown in a terminal.

use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};

use gxs_core::i18n::ltr;
use gxs_core::{Error, fsutil, tr};
use serde::Serialize;
use tauri::State;

use crate::applog::{Level, LogFile};
use crate::settings::check_path;
use crate::{AppState, Result};

const CRASH_LOG: &str = "crash.log";
const CRASH_PENDING: &str = "crash.pending";
const MAX_CRASH_LOG: u64 = 256 * 1024;
const MAX_CLIENT: usize = 64 * 1024;
const MAX_SUMMARY_CHARS: usize = 300;

/// Copied into the package as they are. Nothing that can hold a secret or user input belongs here.
const COPIED: &[&str] = &["settings.json", "plugins.json", CRASH_LOG];

pub fn channel() -> &'static str {
    if cfg!(feature = "debug-build") {
        "debug"
    } else if cfg!(debug_assertions) {
        "dev"
    } else {
        "release"
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildInfo {
    version: &'static str,
    channel: &'static str,
    os: &'static str,
    arch: &'static str,
    devtools: bool,
}

#[tauri::command]
pub fn app_build_info() -> BuildInfo {
    BuildInfo {
        version: env!("CARGO_PKG_VERSION"),
        channel: channel(),
        os: std::env::consts::OS,
        arch: std::env::consts::ARCH,
        devtools: cfg!(any(debug_assertions, feature = "debug-build")),
    }
}

#[tauri::command]
pub fn devtools_open(window: tauri::WebviewWindow) -> Result<()> {
    #[cfg(any(debug_assertions, feature = "debug-build"))]
    {
        window.open_devtools();
        Ok(())
    }
    #[cfg(not(any(debug_assertions, feature = "debug-build")))]
    {
        let _ = window;
        Err(Error::Unsupported(tr!(
            "正式版没有开发者工具",
            "Release builds have no developer tools",
            "رەسمىي نەشرىدە ئاچقۇچىلار قوراللىرى يوق"
        )))
    }
}

/// Release builds abort on panic, so what the hook writes is the only trace a crash leaves.
pub fn install_panic_hook(config_dir: PathBuf) {
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let payload = info
            .payload()
            .downcast_ref::<&str>()
            .map(|s| (*s).to_owned())
            .or_else(|| info.payload().downcast_ref::<String>().cloned())
            .unwrap_or_else(|| tr!("（没有说明）", "(no message)", "(چۈشەندۈرۈش يوق)"));
        let location = info
            .location()
            .map(|l| format!("{}:{}", l.file(), l.line()))
            .unwrap_or_else(|| tr!("未知位置", "unknown location", "نامەلۇم ئورۇن"));
        let location = ltr(&location);
        let thread = std::thread::current();
        let name = match thread.name() {
            Some(name) => ltr(name),
            None => tr!("未命名", "unnamed", "نامسىز"),
        };
        let summary = tr!(
            "线程 {name} 在 {location} 崩溃：{payload}",
            "Thread {name} crashed at {location}: {payload}",
            "{name} تارماق ئېقىنى {location} دا يىمىرىلدى: {payload}"
        );
        let (time, version, channel) = (format_time(fsutil::now_secs(), 0), env!("CARGO_PKG_VERSION"), channel());
        let backtrace = std::backtrace::Backtrace::force_capture();
        let report = tr!(
            "=== {time} GladosXshell {version}（{channel}）\n{summary}\n{backtrace}\n",
            "=== {time} GladosXshell {version} ({channel})\n{summary}\n{backtrace}\n",
            "=== {time} GladosXshell {version} ({channel})\n{summary}\n{backtrace}\n"
        );
        let _ = record_crash(&config_dir, &report, &summary);
        previous(info);
    }));
}

fn record_crash(dir: &Path, report: &str, summary: &str) -> io::Result<()> {
    let path = dir.join(CRASH_LOG);
    let full = fs::metadata(&path).is_ok_and(|m| m.len() > MAX_CRASH_LOG);
    let mut file = fs::OpenOptions::new()
        .create(true)
        .write(true)
        .append(!full)
        .truncate(full)
        .open(path)?;
    file.write_all(report.as_bytes())?;
    let summary: String = summary.chars().take(MAX_SUMMARY_CHARS).collect();
    fs::write(dir.join(CRASH_PENDING), summary)
}

/// The crash from the previous run, once; it also goes into the app log.
#[tauri::command]
pub async fn diagnostics_take_crash(state: State<'_, AppState>) -> Result<Option<String>> {
    let marker = state.config_dir.join(CRASH_PENDING);
    let Some(body) = fsutil::read_optional(&marker).await? else {
        return Ok(None);
    };
    tokio::fs::remove_file(&marker).await?;
    let summary = String::from_utf8_lossy(&body).trim().to_owned();
    state
        .log
        .add(
            Level::Error,
            tr!("上次运行崩溃：{summary}", "The last run crashed: {summary}", "ئالدىنقى قېتىملىق ئىجرا يىمىرىلدى: {summary}"),
        )
        .await;
    Ok(Some(summary))
}

/// `client` is what the window knows about itself (screen, plugins); `tz_offset` is minutes east
/// of UTC, so times in the package read the way the tester saw them.
#[tauri::command]
pub async fn diagnostics_export(
    state: State<'_, AppState>,
    path: String,
    client: String,
    tz_offset: i32,
) -> Result<()> {
    let target = PathBuf::from(check_path(&path, &tr!("导出路径", "export path", "چىقىرىش يولى"))?);
    if target.as_os_str().is_empty() {
        return Err(Error::Invalid(tr!("请选择导出位置", "Choose where to export to", "چىقىرىدىغان ئورۇننى تاللاڭ")));
    }
    if client.len() > MAX_CLIENT || !(-14 * 60..=14 * 60).contains(&tz_offset) {
        return Err(Error::Invalid(tr!(
            "诊断信息无效",
            "The diagnostics information is invalid",
            "دىئاگنوز ئۇچۇرى ئىناۋەتسىز"
        )));
    }
    let log = state.log.snapshot().await;
    let dir = state.config_dir.clone();
    tokio::task::spawn_blocking(move || {
        let info = info_text(tz_offset);
        write_package(&dir, &target, &[
            ("info.txt", info.into_bytes()),
            ("client.json", client.into_bytes()),
            ("app_log.txt", log_text(&log, tz_offset).into_bytes()),
        ])
    })
    .await
    .map_err(|e| Error::Io(io::Error::other(e.to_string())))??;
    let text = tr!("导出了诊断包", "Exported a diagnostics package", "دىئاگنوز بولىقى چىقىرىلدى");
    state.log.add(Level::Info, text).await;
    Ok(())
}

fn write_package(dir: &Path, target: &Path, generated: &[(&str, Vec<u8>)]) -> io::Result<()> {
    let partial = target.with_extension("zip.part");
    let result = (|| {
        let mut zip = zip::ZipWriter::new(fs::File::create(&partial)?);
        let options = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated);
        for (name, body) in generated {
            zip.start_file(*name, options).map_err(io::Error::other)?;
            zip.write_all(body)?;
        }
        for name in COPIED {
            let body = match fs::read(dir.join(name)) {
                Ok(body) => body,
                Err(e) if e.kind() == io::ErrorKind::NotFound => continue,
                Err(e) => return Err(e),
            };
            zip.start_file(*name, options).map_err(io::Error::other)?;
            zip.write_all(&body)?;
        }
        zip.finish().map_err(io::Error::other)?;
        fs::rename(&partial, target)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&partial);
    }
    result
}

fn info_text(tz_offset: i32) -> String {
    let webview = match tauri::webview_version() {
        Ok(version) => ltr(&version),
        Err(e) => {
            let e = ltr(&e.to_string());
            tr!("未知（{e}）", "unknown ({e})", "نامەلۇم ({e})")
        }
    };
    let (version, channel) = (env!("CARGO_PKG_VERSION"), channel());
    let system = ltr(&format!("{} {}", std::env::consts::OS, std::env::consts::ARCH));
    let os = ltr(&os_version());
    let time = ltr(&format_time(fsutil::now_secs(), tz_offset));
    tr!(
        "GladosXshell {version}（{channel}）\n系统：{system}\n系统版本：{os}\nWebView：{webview}\n导出时间：{time}\n",
        "GladosXshell {version} ({channel})\nSystem: {system}\nSystem version: {os}\nWebView: {webview}\nExported at: {time}\n",
        "GladosXshell {version} ({channel})\nسىستېما: {system}\nسىستېما نەشرى: {os}\nWebView: {webview}\nچىقىرىلغان ۋاقىت: {time}\n"
    )
}

fn os_version() -> String {
    #[cfg(windows)]
    let output = {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        std::process::Command::new("cmd")
            .args(["/C", "ver"])
            .creation_flags(CREATE_NO_WINDOW)
            .output()
    };
    #[cfg(not(windows))]
    let output = std::process::Command::new("uname").arg("-sr").output();
    let Ok(out) = output else {
        return tr!("未知", "unknown", "نامەلۇم");
    };
    // `ver` prints in the console code page, so only the version number is taken from it.
    let text = String::from_utf8_lossy(&out.stdout);
    if cfg!(windows) {
        let number = text
            .split(|c: char| !(c.is_ascii_digit() || c == '.'))
            .rfind(|part| part.contains('.'));
        return number.map_or_else(|| tr!("未知", "unknown", "نامەلۇم"), |n| format!("Windows {n}"));
    }
    text.trim().to_owned()
}

fn log_text(log: &LogFile, tz_offset: i32) -> String {
    let mut out = String::new();
    for entry in &log.items {
        let level = match entry.level {
            Level::Info => tr!("信息", "Info", "ئۇچۇر"),
            Level::Warn => tr!("警告", "Warning", "ئاگاھلاندۇرۇش"),
            Level::Error => tr!("错误", "Error", "خاتالىق"),
        };
        out.push_str(&format!(
            "{}\t{level}\t{}\n",
            format_time(entry.at, tz_offset),
            entry.message
        ));
    }
    out
}

/// `YYYY-MM-DD HH:MM:SS` plus the offset, from Unix seconds.
fn format_time(secs: u64, tz_offset: i32) -> String {
    let local = secs as i64 + i64::from(tz_offset) * 60;
    let (days, rest) = (local.div_euclid(86_400), local.rem_euclid(86_400));
    // Civil-from-days, Howard Hinnant's algorithm.
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    let sign = if tz_offset < 0 { '-' } else { '+' };
    let offset = tz_offset.unsigned_abs();
    format!(
        "{year:04}-{month:02}-{day:02} {:02}:{:02}:{:02} UTC{sign}{:02}:{:02}",
        rest / 3600,
        rest % 3600 / 60,
        rest % 60,
        offset / 60,
        offset % 60,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn formats_unix_time_with_offset() {
        assert_eq!(format_time(0, 0), "1970-01-01 00:00:00 UTC+00:00");
        assert_eq!(format_time(1_709_164_800, 480), "2024-02-29 08:00:00 UTC+08:00");
        assert_eq!(format_time(1_709_164_800, -330), "2024-02-28 18:30:00 UTC-05:30");
    }

    #[test]
    fn package_holds_only_the_listed_files() {
        let dir = std::env::temp_dir().join(format!("gx-diag-{}", std::process::id()));
        fs::create_dir_all(dir.join("keys")).unwrap();
        fs::write(dir.join("settings.json"), "{}").unwrap();
        fs::write(dir.join("connections.json"), "secret").unwrap();
        fs::write(dir.join("keys").join("id"), "secret").unwrap();
        let target = dir.join("out.zip");
        write_package(&dir, &target, &[("info.txt", b"x".to_vec())]).unwrap();
        let zip = zip::ZipArchive::new(fs::File::open(&target).unwrap()).unwrap();
        let mut names: Vec<_> = zip.file_names().collect();
        names.sort_unstable();
        assert_eq!(names, ["info.txt", "settings.json"]);
        assert!(!dir.join("out.zip.part").exists());
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn crash_log_starts_over_when_too_large() {
        let dir = std::env::temp_dir().join(format!("gx-crash-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join(CRASH_LOG), vec![b'x'; MAX_CRASH_LOG as usize + 1]).unwrap();
        record_crash(&dir, "report\n", "boom").unwrap();
        assert_eq!(fs::read_to_string(dir.join(CRASH_LOG)).unwrap(), "report\n");
        record_crash(&dir, "again\n", "boom").unwrap();
        assert_eq!(fs::read_to_string(dir.join(CRASH_LOG)).unwrap(), "report\nagain\n");
        assert_eq!(fs::read_to_string(dir.join(CRASH_PENDING)).unwrap(), "boom");
        fs::remove_dir_all(&dir).unwrap();
    }
}
