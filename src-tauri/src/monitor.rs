//! Status monitoring. The backend owns the data: every SSH session with monitoring keeps a
//! bounded history, and each snapshot is broadcast to all windows. Any window can rebuild its
//! view at any time from `status_state` and then follow the events.

use std::collections::{HashSet, VecDeque};
use std::sync::{Arc, Mutex as StdMutex, MutexGuard};
use std::time::Duration;

use gxs_core::{Error, tr};
use gxs_core::monitor::{self, Disk, Mode, StatusSnapshot, SystemInfo};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder};

use crate::session::Remote;
use crate::{AppState, Result};

/// Matches `HISTORY` in charts.ts.
const HISTORY: usize = 120;

pub(crate) const EVENT_SNAPSHOT: &str = "status://snapshot";
pub(crate) const EVENT_ACTIVE: &str = "status://active";
pub(crate) const EVENT_ENDED: &str = "status://ended";
pub(crate) const EVENT_WATCHED: &str = "status://watched";

/// Advanced status windows are labelled with this prefix plus the session id.
pub(crate) const WINDOW_PREFIX: &str = "status-";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NetPoint {
    name: String,
    rx: Option<f64>,
    tx: Option<f64>,
}

/// One poll. `net` is empty when the poll failed, which charts draw as a gap.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Point {
    latency: Option<f64>,
    cpu: Option<f64>,
    /// Memory in use, in percent.
    mem: Option<f64>,
    net: Vec<NetPoint>,
}

#[derive(Default)]
pub(crate) struct StatusCache {
    seq: u64,
    last: Option<StatusSnapshot>,
    error: Option<String>,
    system: Option<SystemInfo>,
    disks: Option<Vec<Disk>>,
    history: VecDeque<Point>,
}

pub(crate) type SharedCache = Arc<StdMutex<StatusCache>>;

fn lock(cache: &SharedCache) -> MutexGuard<'_, StatusCache> {
    cache.lock().unwrap_or_else(std::sync::PoisonError::into_inner)
}

impl StatusCache {
    /// Records a snapshot and returns its sequence number.
    fn ingest(&mut self, snap: &StatusSnapshot) -> u64 {
        self.seq += 1;
        let net = if snap.error.is_some() {
            Vec::new()
        } else {
            snap.net
                .iter()
                .map(|n| NetPoint {
                    name: n.name.clone(),
                    rx: n.rx_rate,
                    tx: n.tx_rate,
                })
                .collect()
        };
        if self.history.len() >= HISTORY {
            self.history.pop_front();
        }
        let ok = snap.error.is_none();
        self.history.push_back(Point {
            latency: snap.latency_ms,
            cpu: snap.cpu_percent.filter(|_| ok),
            mem: (ok && snap.mem.total > 0).then(|| snap.mem.used as f64 * 100.0 / snap.mem.total as f64),
            net,
        });
        if let Some(error) = &snap.error {
            self.error = Some(error.clone());
            return self.seq;
        }
        self.error = None;
        if let Some(system) = &snap.system {
            self.system = Some(system.clone());
        }
        if let Some(disks) = &snap.disks {
            self.disks = Some(disks.clone());
        }
        self.last = Some(snap.clone());
        self.seq
    }
}

/// What the main window's visible tab is, relayed to every status view.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TabKind {
    #[default]
    None,
    Local,
    Connecting,
    Live,
    Ended,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActiveTab {
    pub session_id: Option<u32>,
    pub tab: TabKind,
    /// The profile behind a live SSH tab turned monitoring on.
    #[serde(default)]
    pub monitored: bool,
    /// No status view is on screen, so nothing needs polling.
    pub paused: bool,
}

impl ActiveTab {
    fn polls(&self, id: u32) -> bool {
        !self.paused && self.tab == TabKind::Live && self.session_id == Some(id)
    }
}

/// A session with an advanced window polls in detail whatever the main window shows.
fn mode_for(active: &ActiveTab, watched: &HashSet<u32>, id: u32) -> Mode {
    if watched.contains(&id) {
        Mode::Detailed
    } else if active.polls(id) {
        Mode::Basic
    } else {
        Mode::Off
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SnapshotEvent<'a> {
    session_id: u32,
    seq: u64,
    snapshot: &'a StatusSnapshot,
}

/// Starts (or restarts, keeping history) the poller for one session.
fn start(app: &AppHandle, id: u32, remote: &mut Remote, interval: Duration, mode: Mode) {
    let cache = remote.status.clone();
    let app = app.clone();
    let handle = monitor::spawn(remote.client.clone(), interval, mode, move |snap| {
        let seq = lock(&cache).ingest(&snap);
        let _ = app.emit(
            EVENT_SNAPSHOT,
            SnapshotEvent {
                session_id: id,
                seq,
                snapshot: &snap,
            },
        );
        true
    });
    remote.monitor = Some(handle);
}

impl AppState {
    async fn monitor_interval(&self) -> Duration {
        Duration::from_secs(u64::from(self.settings.get().await.status.interval_secs))
    }

    fn active_tab(&self) -> ActiveTab {
        *self.status_active.lock().unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    fn watched_set(&self) -> MutexGuard<'_, HashSet<u32>> {
        self.status_watched.lock().unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    fn watched(&self) -> Vec<u32> {
        let mut ids: Vec<u32> = self.watched_set().iter().copied().collect();
        ids.sort_unstable();
        ids
    }

    fn mode(&self, id: u32) -> Mode {
        mode_for(&self.active_tab(), &self.watched_set(), id)
    }

    pub(crate) async fn start_monitor(&self, id: u32) {
        let interval = self.monitor_interval().await;
        let mode = self.mode(id);
        let mut sessions = self.sessions.lock().await;
        if let Some(remote) = sessions.get_mut(&id).and_then(|s| s.remote.as_mut()) {
            start(&self.app, id, remote, interval, mode);
        }
    }

    async fn apply_modes(&self) {
        for (&id, session) in self.sessions.lock().await.iter() {
            if let Some(handle) = session.remote.as_ref().and_then(|r| r.monitor.as_ref()) {
                handle.set_mode(self.mode(id));
            }
        }
    }

    async fn set_watched(&self, id: u32, on: bool) {
        let changed = if on {
            self.watched_set().insert(id)
        } else {
            self.watched_set().remove(&id)
        };
        if !changed {
            return;
        }
        self.apply_modes().await;
        let _ = self.app.emit(EVENT_WATCHED, self.watched());
    }

    /// The session ended or its advanced window closed.
    pub(crate) async fn unwatch(&self, id: u32) {
        self.set_watched(id, false).await;
    }
}

/// Applies a new polling interval to every running monitor.
pub(crate) async fn restart_all(state: &AppState) {
    let interval = state.monitor_interval().await;
    let mut sessions = state.sessions.lock().await;
    for (&id, session) in sessions.iter_mut() {
        if let Some(remote) = session.remote.as_mut().filter(|r| r.monitor.is_some()) {
            start(&state.app, id, remote, interval, state.mode(id));
        }
    }
}

/// Only the visible SSH tab polls, and only while a status view is on screen.
#[tauri::command]
pub async fn monitor_set_active(state: State<'_, AppState>, active: ActiveTab) -> Result<()> {
    *state.status_active.lock().unwrap_or_else(std::sync::PoisonError::into_inner) = active;
    state.apply_modes().await;
    let _ = state.app.emit(EVENT_ACTIVE, active);
    Ok(())
}

/// The session id behind an advanced window's label.
pub(crate) fn watched_window(label: &str) -> Option<u32> {
    label.strip_prefix(WINDOW_PREFIX)?.parse().ok()
}

/// Opens (or focuses) the advanced status window for one session.
#[tauri::command]
pub async fn status_window_open(state: State<'_, AppState>, session_id: u32, title: String) -> Result<()> {
    let label = format!("{WINDOW_PREFIX}{session_id}");
    if let Some(window) = state.app.get_webview_window(&label) {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
        return Ok(());
    }
    let monitored = {
        let sessions = state.sessions.lock().await;
        let remote = sessions.get(&session_id).ok_or(Error::Closed)?.remote.as_ref();
        remote.is_some_and(|r| r.monitor.is_some())
    };
    if !monitored {
        return Err(Error::Unsupported(tr!(
            "该连接没有开启服务器状态监控",
            "Server status monitoring is off for this connection",
            "بۇ ئۇلىنىشتا مۇلازىمېتىر ھالىتى نازارىتى ئېچىلمىغان"
        )));
    }
    // Watched before the page loads, so its first `status_state` already reports it.
    state.set_watched(session_id, true).await;
    let url = WebviewUrl::App(format!("status-panel.html?session={session_id}").into());
    let built = WebviewWindowBuilder::new(&state.app, &label, url)
        .title({
            let title = gxs_core::i18n::ltr(&title);
            tr!("服务器状态 - {title}", "Server status - {title}", "مۇلازىمېتىر ھالىتى - {title}")
        })
        .inner_size(1180.0, 780.0)
        .min_inner_size(720.0, 520.0)
        .data_directory(state.config_dir.join(crate::datadir::WEBVIEW))
        .initialization_script(crate::lang_script())
        .build();
    if let Err(e) = built {
        state.unwatch(session_id).await;
        return Err(Error::Io(std::io::Error::other(e.to_string())));
    }
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionStatus {
    id: u32,
    /// False for SSH sessions whose profile turned monitoring off.
    monitored: bool,
    seq: u64,
    last: Option<StatusSnapshot>,
    error: Option<String>,
    system: Option<SystemInfo>,
    disks: Option<Vec<Disk>>,
    history: Vec<Point>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatusState {
    active: ActiveTab,
    /// Sessions with an advanced window open.
    watched: Vec<u32>,
    sessions: Vec<SessionStatus>,
}

/// Everything a status view needs to draw from scratch.
#[tauri::command]
pub async fn status_state(state: State<'_, AppState>) -> Result<StatusState> {
    let active = state.active_tab();
    let watched = state.watched();
    let sessions = state.sessions.lock().await;
    let mut list: Vec<SessionStatus> = sessions
        .iter()
        .filter_map(|(&id, session)| {
            let remote = session.remote.as_ref()?;
            let cache = lock(&remote.status);
            Some(SessionStatus {
                id,
                monitored: remote.monitor.is_some(),
                seq: cache.seq,
                last: cache.last.clone(),
                error: cache.error.clone(),
                system: cache.system.clone(),
                disks: cache.disks.clone(),
                history: cache.history.iter().cloned().collect(),
            })
        })
        .collect();
    list.sort_by_key(|s| s.id);
    Ok(StatusState {
        active,
        watched,
        sessions: list,
    })
}

#[tauri::command]
pub async fn process_kill(state: State<'_, AppState>, session_id: u32, pid: u32, signal: i32) -> Result<String> {
    let (client, _) = state.remote(session_id).await?;
    let output = client.exec(&format!("kill -{signal} {pid}")).await?;
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

#[tauri::command]
pub async fn process_renice(state: State<'_, AppState>, session_id: u32, pid: u32, priority: i32) -> Result<String> {
    let (client, _) = state.remote(session_id).await?;
    let output = client.exec(&format!("renice {priority} -p {pid}")).await?;
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

#[cfg(test)]
mod tests {
    use gxs_core::monitor::NetRate;

    use super::*;

    fn snap(rx: f64) -> StatusSnapshot {
        StatusSnapshot {
            latency_ms: Some(rx),
            net: vec![NetRate {
                name: "eth0".into(),
                rx_total: 0,
                tx_total: 0,
                rx_rate: Some(rx),
                tx_rate: None,
            }],
            ..StatusSnapshot::default()
        }
    }

    #[test]
    fn history_is_bounded_and_errors_keep_last_good_snapshot() {
        let mut cache = StatusCache::default();
        for i in 0..(HISTORY + 5) {
            cache.ingest(&snap(i as f64));
        }
        assert_eq!(cache.history.len(), HISTORY);
        assert_eq!(cache.history.front().unwrap().latency, Some(5.0));
        let failed = StatusSnapshot {
            error: Some("boom".into()),
            ..StatusSnapshot::default()
        };
        let seq = cache.ingest(&failed);
        assert_eq!(seq, HISTORY as u64 + 6);
        assert_eq!(cache.error.as_deref(), Some("boom"));
        assert!(cache.last.is_some());
        assert!(cache.history.back().unwrap().net.is_empty());
        cache.ingest(&snap(1.0));
        assert_eq!(cache.error, None);
    }

    #[test]
    fn advanced_windows_poll_in_detail_regardless_of_the_visible_tab() {
        let active = ActiveTab {
            session_id: Some(1),
            tab: TabKind::Live,
            monitored: true,
            paused: false,
        };
        let watched = HashSet::from([2]);
        assert_eq!(mode_for(&active, &watched, 1), Mode::Basic);
        assert_eq!(mode_for(&active, &watched, 2), Mode::Detailed);
        assert_eq!(mode_for(&active, &watched, 3), Mode::Off);
        let paused = ActiveTab { paused: true, ..active };
        assert_eq!(mode_for(&paused, &watched, 1), Mode::Off);
        assert_eq!(mode_for(&paused, &watched, 2), Mode::Detailed);
    }

    #[test]
    fn window_labels_map_to_sessions() {
        assert_eq!(watched_window("status-12"), Some(12));
        assert_eq!(watched_window("status-panel"), None);
        assert_eq!(watched_window("main"), None);
    }
}
