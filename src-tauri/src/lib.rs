mod applog;
mod backup;
mod commands;
mod containers;
mod datadir;
mod diagnostics;
mod files;
mod forwards;
mod keys;
mod library;
mod monitor;
mod plugin_api;
mod plugins;
mod profiles;
mod recording;
mod session;
mod session_log;
mod settings;
mod store;
mod tabs;
mod text_codec;
mod zmodem;

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::{AtomicU32, Ordering};

use gxs_core::Error;
use gxs_core::known_hosts::KnownHosts;
use gxs_core::profiles::ProfileStore;
use gxs_core::sftp::Sftp;
use gxs_core::ssh::SshClient;
use gxs_core::tr;
use tauri::Manager;
use tokio::sync::{Mutex, oneshot};
use tokio_util::sync::CancellationToken;

use crate::store::JsonStore;

pub(crate) type Result<T> = std::result::Result<T, Error>;
pub(crate) type Prompts<T> = Arc<Mutex<HashMap<u32, oneshot::Sender<T>>>>;

pub(crate) struct AppState {
    next_id: AtomicU32,
    sessions: Arc<Mutex<HashMap<u32, session::Session>>>,
    host_key_prompts: Prompts<bool>,
    kbd_prompts: Prompts<Option<Vec<String>>>,
    known_hosts: Arc<KnownHosts>,
    profiles: ProfileStore,
    settings: settings::SettingsStore,
    transfers: Mutex<HashMap<u32, CancellationToken>>,
    edits: Mutex<HashMap<u32, files::Edit>>,
    favorites: commands::Favorites,
    history: commands::History,
    path_history: commands::PathHistory,
    tabs: JsonStore<tabs::SavedTabs>,
    log: applog::AppLog,
    plugins: plugins::Plugins,
    recordings: recording::Recordings,
    config_dir: PathBuf,
    app: tauri::AppHandle,
    status_active: std::sync::Mutex<monitor::ActiveTab>,
    status_watched: std::sync::Mutex<std::collections::HashSet<u32>>,
    import_passwords: profiles::ImportPasswords,
}

impl AppState {
    fn id(&self) -> u32 {
        self.next_id.fetch_add(1, Ordering::Relaxed)
    }

    /// The SSH connection behind a session and its local work-directory folder name.
    async fn remote(&self, id: u32) -> Result<(Arc<SshClient>, String)> {
        let sessions = self.sessions.lock().await;
        let remote = sessions
            .get(&id)
            .ok_or(Error::Closed)?
            .remote
            .as_ref()
            .ok_or_else(|| {
                Error::Unsupported(tr!(
                    "本地终端没有远程文件和状态",
                    "A local terminal has no remote files or status",
                    "يەرلىك تېرمىنالدا يىراقتىكى ھۆججەت ۋە ھالەت يوق"
                ))
            })?;
        Ok((remote.client.clone(), remote.label.clone()))
    }

    async fn sftp(&self, id: u32) -> Result<(Sftp, String)> {
        let (client, label) = self.remote(id).await?;
        Ok((client.sftp().await?, label))
    }
}

fn open_error(e: tauri_plugin_opener::Error) -> Error {
    Error::Io(std::io::Error::other(e.to_string()))
}

/// Runs before any page script, so the frontend knows its language while modules load.
/// Windows opened from the frontend pass it in the URL instead.
pub(crate) fn lang_script() -> String {
    format!("window.__GX_LANG__ = '{}';", gxs_core::i18n::current().code())
}

/// Language changes apply on the next start.
#[tauri::command]
fn app_restart(app: tauri::AppHandle) {
    app.restart();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let identifier = app.config().identifier.clone();
            let exe_dir = std::env::current_exe().ok().and_then(|exe| exe.parent().map(PathBuf::from));
            let legacy =
                datadir::Legacy { data: app.path().app_data_dir().ok(), webview: app.path().app_local_data_dir().ok() };
            let prepared = datadir::prepare(exe_dir.as_deref(), &app.path().home_dir()?, &identifier, &legacy);
            let config_dir = prepared.root;
            diagnostics::install_panic_hook(config_dir.clone());
            let documents = app.path().document_dir().unwrap_or_else(|_| config_dir.clone());
            // Settings come first: they pick the language everything after this is written in.
            let settings = tauri::async_runtime::block_on(settings::SettingsStore::open(
                &config_dir,
                documents.join("GladosXshell"),
            ));
            gxs_core::i18n::set(tauri::async_runtime::block_on(settings.get()).ui.language.resolve());
            let (known_hosts, profiles, favorites, history, path_history, log) = tauri::async_runtime::block_on(async {
                let (log, log_problem) = JsonStore::open(config_dir.join("app_log.json"), false).await;
                let log = applog::AppLog::new(log);
                let (favorites, favorites_problem) = JsonStore::open(config_dir.join("favorites.json"), true).await;
                let (history, history_problem) = JsonStore::open(config_dir.join("command_history.json"), false).await;
                let (path_history, path_history_problem) = JsonStore::open(config_dir.join("path_history.json"), false).await;
                // `0.1.1-beta` and `dev` are left-to-right runs inside the Uyghur sentence.
                let version = gxs_core::i18n::ltr(env!("CARGO_PKG_VERSION"));
                let channel = gxs_core::i18n::ltr(diagnostics::channel());
                log.add(
                    applog::Level::Info,
                    tr!(
                        "软件启动（{version}，{channel}）",
                        "App started ({version}, {channel})",
                        "يۇمشاق دېتال قوزغالدى ({version}، {channel})"
                    ),
                )
                .await;
                if let Some((level, note)) = prepared.note {
                    log.add(level, note.text()).await;
                }
                if let Some(problem) = log_problem {
                    let text = tr!("{problem}，已重新开始记录", "{problem}. The log starts over", "{problem}، خاتىرە قايتىدىن باشلاندى");
                    log.add(applog::Level::Warn, text).await;
                }
                if let Some(problem) = favorites_problem {
                    let text = tr!(
                        "{problem}，收藏暂不可用",
                        "{problem}. Favorites are unavailable for now",
                        "{problem}، يىغقۇچنى ھازىرچە ئىشلەتكىلى بولمايدۇ"
                    );
                    log.add(applog::Level::Error, text).await;
                }
                if let Some(problem) = history_problem {
                    let text = tr!("{problem}，指令历史已清空", "{problem}. Command history was cleared", "{problem}، بۇيرۇق تارىخى تازىلاندى");
                    log.add(applog::Level::Warn, text).await;
                }
                if let Some(problem) = path_history_problem {
                    let text = tr!("{problem}，路径历史已清空", "{problem}. Path history was cleared", "{problem}، يول تارىخى تازىلاندى");
                    log.add(applog::Level::Warn, text).await;
                }
                Ok::<_, Error>((
                    KnownHosts::open(config_dir.join("known_hosts.json")).await?,
                    ProfileStore::open(config_dir.join("connections.json")).await?,
                    favorites,
                    history,
                    path_history,
                    log,
                ))
            })?;
            if let Some(problem) = tauri::async_runtime::block_on(settings.load_error()) {
                tauri::async_runtime::block_on(log.add(applog::Level::Warn, problem));
            }
            let (plugins, plugins_problem) = tauri::async_runtime::block_on(plugins::Plugins::open(&config_dir));
            if let Some(problem) = plugins_problem {
                tauri::async_runtime::block_on(log.add(applog::Level::Warn, problem));
            }
            let (tabs, tabs_problem) =
                tauri::async_runtime::block_on(JsonStore::open(config_dir.join("open_tabs.json"), false));
            if let Some(problem) = tabs_problem {
                let text = tr!(
                    "{problem}，不恢复上次的标签",
                    "{problem}. The tabs from last time are not restored",
                    "{problem}، ئالدىنقى قېتىمقى بەتكۈچلەر ئەسلىگە كەلتۈرۈلمەيدۇ"
                );
                tauri::async_runtime::block_on(log.add(applog::Level::Warn, text));
            }
            app.manage(AppState {
                next_id: AtomicU32::new(1),
                sessions: Arc::default(),
                host_key_prompts: Arc::default(),
                kbd_prompts: Arc::default(),
                known_hosts: Arc::new(known_hosts),
                profiles,
                settings,
                transfers: Mutex::default(),
                edits: Mutex::default(),
                favorites,
                history,
                path_history,
                tabs,
                log,
                plugins,
                recordings: recording::Recordings::default(),
                config_dir: config_dir.clone(),
                app: app.handle().clone(),
                status_active: std::sync::Mutex::default(),
                status_watched: std::sync::Mutex::default(),
                import_passwords: profiles::ImportPasswords::default(),
            });
            // Built here rather than from the config so its WebView profile sits in the data folder.
            let main = app.config().app.windows.iter().find(|w| w.label == "main").ok_or_else(|| {
                tr!("缺少主窗口配置", "The main window configuration is missing", "ئاساسىي كۆزنەك سەپلىمىسى كەم")
            })?;
            tauri::WebviewWindowBuilder::from_config(app.handle(), main)?
                .data_directory(config_dir.join(datadir::WEBVIEW))
                .initialization_script(lang_script())
                .build()?;
            Ok(())
        })
        // Pages for sandboxed plugin frames; see plugins::serve for what may be loaded.
        .register_asynchronous_uri_scheme_protocol("gxplugin", |ctx, request, responder| {
            let root = plugins::root(ctx.app_handle());
            tauri::async_runtime::spawn_blocking(move || {
                let response = match root {
                    Some(root) => plugins::serve(&root, &request),
                    None => plugins::not_found(),
                };
                responder.respond(response);
            });
        })
        .invoke_handler(tauri::generate_handler![
            session::local_shells,
            session::serial_ports,
            session::pty_open,
            session::ssh_open,
            session::ssh_open_profile,
            session::bench_open,
            session::session_write,
            session::session_write_bytes,
            session_log::session_log_start,
            session_log::session_log_stop,
            session_log::session_log_pause,
            session_log::session_log_dir,
            recording::recording_start,
            recording::recording_write,
            recording::recording_stop,
            recording::recording_list,
            recording::recording_read,
            recording::recording_delete,
            recording::recording_dir,
            containers::containers_run,
            zmodem::zmodem_save_begin,
            zmodem::zmodem_save_write,
            zmodem::zmodem_save_end,
            zmodem::zmodem_stat,
            zmodem::zmodem_read,
            session::session_resize,
            session::session_ack,
            session::session_close,
            session::host_key_answer,
            session::prompt_answer,
            session::known_hosts_list,
            session::known_hosts_remove,
            forwards::forward_list,
            forwards::forward_start,
            forwards::forward_stop,
            profiles::profiles_list,
            profiles::profile_save,
            profiles::profile_delete,
            profiles::profile_duplicate,
            profiles::profiles_move,
            profiles::group_save,
            profiles::group_delete,
            profiles::profiles_import_scan,
            profiles::profiles_import,
            profiles::master_status,
            profiles::master_unlock,
            profiles::master_lock,
            profiles::master_set,
            monitor::monitor_set_active,
            monitor::status_state,
            monitor::status_window_open,
            monitor::process_kill,
            monitor::process_renice,
            files::sftp_home,
            files::sftp_resolve,
            files::sftp_list,
            files::sftp_list_for_completion,
            files::sftp_mkdir,
            files::sftp_create,
            files::sftp_rename,
            files::sftp_remove,
            files::sftp_chmod,
            files::remote_rm,
            files::pack_create,
            files::pack_cleanup,
            files::transfer_start,
            files::transfer_cancel,
            files::edit_open,
            files::edit_save_local,
            files::edit_reopen,
            files::edit_upload,
            files::edit_close,
            files::preview_image,
            files::mirror_local,
            files::reveal_local,
            files::open_url,
            app_restart,
            settings::settings_get,
            settings::settings_set,
            settings::custom_css_get,
            settings::custom_css_set,
            settings::custom_css_open,
            settings::custom_css_import,
            settings::open_config_dir,
            backup::config_export,
            backup::config_inspect,
            backup::config_import,
            settings::local_image,
            library::background_list,
            library::background_import,
            library::background_remove,
            library::fonts_system,
            library::fonts_folder,
            library::font_library,
            library::font_import,
            library::font_remove,
            library::font_data,
            keys::keys_list,
            keys::key_generate,
            keys::key_import,
            keys::key_remove,
            keys::key_deploy,
            commands::favorites_list,
            commands::favorite_save,
            commands::favorite_delete,
            commands::favorite_move,
            commands::folder_save,
            commands::folder_delete,
            commands::history_list,
            commands::history_add,
            commands::history_remove,
            commands::history_clear,
            tabs::tabs_get,
            tabs::tabs_save,
            commands::load_path_history,
            commands::save_path_history,
            applog::applog_list,
            applog::applog_add,
            applog::applog_clear,
            diagnostics::app_build_info,
            diagnostics::devtools_open,
            diagnostics::diagnostics_take_crash,
            diagnostics::diagnostics_export,
            plugins::plugins_list,
            plugins::plugin_install,
            plugins::plugin_remove,
            plugins::plugin_grant,
            plugins::plugin_revoke,
            plugins::plugin_storage_get,
            plugins::plugin_storage_set,
            plugins::plugins_open_dir,
            plugin_api::plugin_exec,
            plugin_api::plugin_file_read,
            plugin_api::plugin_file_write,
            plugin_api::plugin_http,
        ])
        // Status windows depend on the main one's sessions, so they must not outlive it.
        .on_window_event(|window, event| {
            if !matches!(event, tauri::WindowEvent::Destroyed) {
                return;
            }
            if window.label() == "main" {
                window.app_handle().exit(0);
            } else if let Some(id) = monitor::watched_window(window.label()) {
                let app = window.app_handle().clone();
                tauri::async_runtime::spawn(async move {
                    app.state::<AppState>().unwatch(id).await;
                });
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running GladosXshell");
}
