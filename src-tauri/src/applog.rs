//! The app log: what the software did (settings, favorites, startup problems) and connection
//! events (connect, disconnect, reconnect, failures). Terminal input and server output never go here.

use gxs_core::{Error, fsutil, tr};
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::store::JsonStore;
use crate::{AppState, Result};

const MAX_ENTRIES: usize = 1000;
const MAX_MESSAGE_CHARS: usize = 2000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Level {
    Info,
    Warn,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Entry {
    pub at: u64,
    pub level: Level,
    pub message: String,
}

/// Oldest first.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct LogFile {
    pub items: Vec<Entry>,
}

fn push(file: &mut LogFile, entry: Entry) {
    file.items.push(entry);
    let excess = file.items.len().saturating_sub(MAX_ENTRIES);
    file.items.drain(..excess);
}

pub(crate) struct AppLog(JsonStore<LogFile>);

impl AppLog {
    pub fn new(store: JsonStore<LogFile>) -> Self {
        Self(store)
    }

    /// Never fails: a log that can't be written must not break the action being logged.
    pub async fn add(&self, level: Level, message: String) {
        let entry = Entry {
            at: fsutil::now_secs(),
            level,
            message,
        };
        let _ = self
            .0
            .update(|file| {
                push(file, entry);
                Ok(())
            })
            .await;
    }

    /// An unreadable log reads as empty here; diagnostics should still go out.
    pub async fn snapshot(&self) -> LogFile {
        self.0.get().await.unwrap_or_default()
    }
}

#[tauri::command]
pub async fn applog_list(state: State<'_, AppState>) -> Result<Vec<Entry>> {
    Ok(state.log.0.get().await?.items)
}

#[tauri::command]
pub async fn applog_add(state: State<'_, AppState>, level: Level, message: String) -> Result<()> {
    let message = message.trim().to_owned();
    if message.is_empty() || message.chars().count() > MAX_MESSAGE_CHARS {
        return Err(Error::Invalid(tr!(
            "日志内容为空或过长",
            "The log message is empty or too long",
            "خاتىرە مەزمۇنى بوش ياكى بەك ئۇزۇن"
        )));
    }
    state.log.add(level, message).await;
    Ok(())
}

#[tauri::command]
pub async fn applog_clear(state: State<'_, AppState>) -> Result<()> {
    state
        .log
        .0
        .update(|file| {
            file.items.clear();
            Ok(())
        })
        .await?;
    state
        .log
        .add(
            Level::Info,
            tr!("已清空通用日志", "Cleared the app log", "ئومۇمىي خاتىرە تازىلاندى"),
        )
        .await;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn log_keeps_the_newest_entries() {
        let mut file = LogFile::default();
        for i in 0..MAX_ENTRIES + 3 {
            push(
                &mut file,
                Entry {
                    at: i as u64,
                    level: Level::Info,
                    message: i.to_string(),
                },
            );
        }
        assert_eq!(file.items.len(), MAX_ENTRIES);
        assert_eq!(file.items[0].at, 3);
    }
}
