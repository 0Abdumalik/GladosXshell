use std::fs::{File, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use gxs_core::i18n::ltr;
use gxs_core::{Error, tr};
use gxs_core::local_path::sanitize_name;
use tauri::State;

use crate::{AppState, Result};

/// Where a session's output is copied, if anywhere. Shared with the frame sink.
pub(crate) type LogSlot = Arc<Mutex<Option<SessionLog>>>;

pub(crate) struct SessionLog {
    file: File,
    plain: Option<Plain>,
    buf: Vec<u8>,
    /// A file transfer is running; its bytes are not text.
    paused: bool,
}

impl SessionLog {
    /// Appends one output frame. On a write error the log is dropped by the caller.
    pub fn write(&mut self, frame: &[u8]) -> std::io::Result<()> {
        if self.paused {
            return Ok(());
        }
        match &mut self.plain {
            None => self.file.write_all(frame),
            Some(plain) => {
                self.buf.clear();
                plain.strip(frame, &mut self.buf);
                self.file.write_all(&self.buf)
            }
        }
    }
}

/// Copies a frame into the slot's log; a failing log is closed so it can't fail every frame.
pub(crate) fn record(slot: &LogSlot, frame: &[u8]) {
    let Ok(mut guard) = slot.lock() else { return };
    if let Some(log) = guard.as_mut()
        && let Err(e) = log.write(frame)
    {
        tracing::warn!("session log stopped: {e}");
        *guard = None;
    }
}

#[derive(Clone, Copy, Default, PartialEq, Eq, Debug)]
enum Scan {
    #[default]
    Text,
    Esc,
    Csi,
    /// OSC, DCS, APC, PM and SOS strings, ended by BEL or ST.
    Str,
    StrEsc,
    /// The one byte after `ESC (` and friends.
    Skip,
}

/// Removes escape sequences and control characters, keeping text, tabs and line feeds.
/// Keeps its state between frames, since a sequence can be split across two.
#[derive(Default)]
struct Plain {
    state: Scan,
}

impl Plain {
    fn strip(&mut self, input: &[u8], out: &mut Vec<u8>) {
        for &b in input {
            self.state = match self.state {
                Scan::Text => match b {
                    0x1b => Scan::Esc,
                    b'\n' | b'\t' => {
                        out.push(b);
                        Scan::Text
                    }
                    0x00..=0x1f | 0x7f => Scan::Text,
                    _ => {
                        out.push(b);
                        Scan::Text
                    }
                },
                Scan::Esc => match b {
                    b'[' => Scan::Csi,
                    b']' | b'P' | b'_' | b'^' | b'X' => Scan::Str,
                    b'(' | b')' | b'*' | b'+' | b'#' | b'%' | b' ' => Scan::Skip,
                    _ => Scan::Text,
                },
                Scan::Csi => {
                    if (0x40..=0x7e).contains(&b) {
                        Scan::Text
                    } else {
                        Scan::Csi
                    }
                }
                Scan::Str => match b {
                    0x07 => Scan::Text,
                    0x1b => Scan::StrEsc,
                    _ => Scan::Str,
                },
                Scan::StrEsc => Scan::Text,
                Scan::Skip => Scan::Text,
            };
        }
    }
}

async fn slot(state: &AppState, id: u32) -> Result<LogSlot> {
    state
        .sessions
        .lock()
        .await
        .get(&id)
        .map(|s| s.log.clone())
        .ok_or(Error::Closed)
}

/// Starts (or resumes, after a reconnect) copying a session's output to `<log dir>/<name>`.
/// Returns the file's full path.
#[tauri::command]
pub async fn session_log_start(state: State<'_, AppState>, id: u32, name: String, plain: bool) -> Result<String> {
    let name = sanitize_name(name.trim());
    if name.is_empty() {
        return Err(Error::Invalid(tr!("日志文件名不能为空", "The log file name cannot be empty", "خاتىرە ھۆججىتىنىڭ نامى بوش بولسا بولمايدۇ")));
    }
    let dir = state.settings.log_dir().await;
    let path = dir.join(&name);
    let slot = slot(&state, id).await?;
    let file = tokio::task::spawn_blocking({
        let path = path.clone();
        move || -> std::io::Result<File> {
            std::fs::create_dir_all(&dir)?;
            OpenOptions::new().create(true).append(true).open(path)
        }
    })
    .await
    .map_err(|e| Error::Io(std::io::Error::other(e)))?
    .map_err(|e| {
        let (shown, error) = (ltr(&path.display().to_string()), ltr(&e.to_string()));
        let text = tr!("无法写入日志 {shown}：{error}", "Could not write the log {shown}: {error}", "{shown} خاتىرىسىگە يازغىلى بولمىدى: {error}");
        Error::Io(std::io::Error::new(e.kind(), text))
    })?;
    let log = SessionLog {
        file,
        plain: plain.then(Plain::default),
        buf: Vec::new(),
        paused: false,
    };
    if let Ok(mut guard) = slot.lock() {
        *guard = Some(log);
    }
    Ok(path.to_string_lossy().into_owned())
}

#[tauri::command]
pub async fn session_log_stop(state: State<'_, AppState>, id: u32) -> Result<()> {
    if let Ok(slot) = slot(&state, id).await
        && let Ok(mut guard) = slot.lock()
    {
        *guard = None;
    }
    Ok(())
}

/// Leaves an rz/sz transfer out of the log, with a line in its place.
#[tauri::command]
pub async fn session_log_pause(state: State<'_, AppState>, id: u32, paused: bool) -> Result<()> {
    if let Ok(slot) = slot(&state, id).await
        && let Ok(mut guard) = slot.lock()
        && let Some(log) = guard.as_mut()
    {
        if paused && !log.paused {
            let line = tr!(
                "\n[rz/sz 文件传输，内容未记录]\n",
                "\n[rz/sz file transfer, content not logged]\n",
                "\n[rz/sz ھۆججەت يوللاش، مەزمۇنى خاتىرىلەنمىدى]\n"
            );
            let _ = log.file.write_all(line.as_bytes());
        }
        log.paused = paused;
    }
    Ok(())
}

/// The folder logs go to, created on demand so it can be opened in the file manager.
#[tauri::command]
pub async fn session_log_dir(state: State<'_, AppState>) -> Result<String> {
    let dir: PathBuf = state.settings.log_dir().await;
    tokio::fs::create_dir_all(&dir).await?;
    Ok(dir.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn strip(chunks: &[&[u8]]) -> String {
        let mut plain = Plain::default();
        let mut out = Vec::new();
        for chunk in chunks {
            plain.strip(chunk, &mut out);
        }
        String::from_utf8(out).unwrap()
    }

    #[test]
    fn plain_drops_colours_titles_and_carriage_returns() {
        let raw = b"\x1b]0;user@host: ~\x07\x1b[01;32muser@host\x1b[00m:~$ ls\r\n\x1b(Bfile \xe4\xb8\xad\r\n";
        assert_eq!(strip(&[raw]), "user@host:~$ ls\nfile \u{4e2d}\n");
    }

    #[test]
    fn plain_handles_sequences_split_across_frames() {
        assert_eq!(strip(&[b"a\x1b[3", b"1mb\x1b]7;file://h/", b"tmp\x1b", b"\\c"]), "abc");
    }

    #[test]
    fn plain_keeps_tabs_and_drops_bell_and_backspace() {
        assert_eq!(strip(&[b"x\ty\x07\x08z"]), "x\tyz");
    }
}
