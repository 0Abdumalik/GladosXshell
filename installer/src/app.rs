use std::path::PathBuf;
use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, RunEvent, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tauri_plugin_dialog::DialogExt;

use crate::flavor::{EMAIL, EXE, FLAVOR, VERSION};
use crate::i18n::{self, Lang};
use crate::ops::{self, InstallOptions, Warning};
use crate::system::{self, Com, Scope};
use crate::tr;

/// Set after an uninstall run from the install folder: the uninstaller and the folder to remove.
#[derive(Default)]
struct Leftover(Mutex<Option<(PathBuf, PathBuf)>>);

fn uninstall_mode() -> bool {
    std::env::args().skip(1).any(|a| a == "--uninstall")
}

/// `--name=value` from the command line.
fn arg(name: &str) -> Option<String> {
    let prefix = format!("--{name}=");
    std::env::args().skip(1).find_map(|a| a.strip_prefix(&prefix).map(str::to_owned))
}

fn flag(name: &str) -> bool {
    arg(name).as_deref() == Some("1")
}

fn bit(value: bool) -> &'static str {
    if value { "1" } else { "0" }
}

/// The system display language, or the one the unelevated window passed on: an administrator
/// who answers the UAC prompt may use another language than the user who started setup.
fn language() -> Lang {
    arg("lang").as_deref().and_then(Lang::from_code).unwrap_or_else(i18n::system)
}

fn lang_arg() -> String {
    format!("--lang={}", i18n::current().code())
}

/// Runs before any page script, so main.js knows its language while it loads.
fn lang_script() -> String {
    format!("window.__GX_LANG__ = '{}';", i18n::current().code())
}

/// Choices the unelevated window passed on when it restarted as administrator.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Auto {
    scope: Scope,
    dir: String,
    desktop: bool,
    start_menu: bool,
    remove_data: bool,
}

fn auto() -> Option<Auto> {
    std::env::args().skip(1).any(|a| a == "--auto").then(|| Auto {
        scope: arg("scope").as_deref().and_then(Scope::parse).unwrap_or(Scope::User),
        dir: arg("dir").unwrap_or_default(),
        desktop: flag("desktop"),
        start_menu: flag("start-menu"),
        remove_data: flag("remove-data"),
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ExistingInfo {
    dir: String,
    version: String,
    scope: Scope,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DefaultDirs {
    user: String,
    machine: String,
}

fn default_dir(scope: Scope) -> String {
    system::default_install_dir(scope).map(|d| d.display().to_string()).unwrap_or_default()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SetupInfo {
    mode: &'static str,
    product: &'static str,
    channel: &'static str,
    version: &'static str,
    email: &'static str,
    default_dirs: DefaultDirs,
    data_dir: String,
    elevated: bool,
    existing: Option<ExistingInfo>,
    auto: Option<Auto>,
    payload: bool,
}

#[tauri::command]
fn setup_info() -> SetupInfo {
    let existing = if uninstall_mode() {
        ops::installed().map(|e| ExistingInfo { dir: e.dir.display().to_string(), version: e.version, scope: e.scope })
    } else {
        system::existing_installs()
            .into_iter()
            .next()
            .map(|e| ExistingInfo { dir: e.dir.display().to_string(), version: e.version, scope: e.scope })
    };
    SetupInfo {
        mode: if uninstall_mode() { "uninstall" } else { "install" },
        product: FLAVOR.product,
        channel: FLAVOR.channel,
        version: VERSION,
        email: EMAIL,
        default_dirs: DefaultDirs { user: default_dir(Scope::User), machine: default_dir(Scope::Machine) },
        data_dir: system::user_data_dir().map(|d| d.display().to_string()).unwrap_or_default(),
        elevated: system::elevated(),
        existing,
        auto: auto(),
        payload: ops::payload_present(),
    }
}

#[tauri::command]
fn ready(window: WebviewWindow) {
    let _ = window.show();
    let _ = window.set_focus();
}

#[tauri::command]
fn minimize(window: WebviewWindow) {
    let _ = window.minimize();
}

#[tauri::command]
fn quit(app: AppHandle) {
    app.exit(0);
}

/// Async so it runs off the main thread, which the blocking folder dialog requires.
#[tauri::command]
async fn pick_dir(app: AppHandle, current: String) -> Option<String> {
    let mut dialog =
        app.dialog().file().set_title(tr!("选择安装位置", "Choose an install location", "ئورنىتىش ئورنىنى تاللاش"));
    let start = PathBuf::from(&current);
    if let Some(parent) = start.parent().filter(|p| p.is_dir()) {
        dialog = dialog.set_directory(parent);
    }
    let picked = dialog.blocking_pick_folder()?.into_path().ok()?;
    Some(ops::install_target(&picked).display().to_string())
}

#[derive(Clone, Serialize)]
struct Progress<'a> {
    value: f64,
    label: &'a str,
}

fn reporter(app: &AppHandle) -> impl FnMut(f64, &str) + '_ {
    // The extractor reports every chunk; only whole percent steps reach the window.
    let mut last = -1i64;
    move |value, label| {
        let percent = (value * 100.0).round() as i64;
        if percent != last {
            last = percent;
            let _ = app.emit("progress", Progress { value, label });
        }
    }
}

/// Restarts as administrator with the same choices; blocks until the UAC prompt is answered.
async fn elevate(args: Vec<String>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || system::relaunch_elevated(&args))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

/// `true` when an elevated copy took over and this window should close.
#[tauri::command]
async fn install(
    app: AppHandle,
    scope: Scope,
    dir: String,
    desktop: bool,
    start_menu: bool,
) -> Result<bool, String> {
    let dir = dir.trim().trim_end_matches(['\\', '/']).to_owned();
    if scope == Scope::Machine && !system::elevated() {
        let args = vec![
            "--auto".to_owned(),
            format!("--scope={}", scope.arg()),
            format!("--dir={dir}"),
            format!("--desktop={}", bit(desktop)),
            format!("--start-menu={}", bit(start_menu)),
            lang_arg(),
        ];
        elevate(args).await?;
        return Ok(true);
    }
    let options = InstallOptions { scope, dir: PathBuf::from(dir), desktop, start_menu };
    tauri::async_runtime::spawn_blocking(move || {
        let _com = Com::init();
        ops::install(&options, &mut reporter(&app))
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())?;
    Ok(false)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct UninstallDone {
    elevated: bool,
    warnings: Vec<Warning>,
}

#[tauri::command]
async fn uninstall(app: AppHandle, remove_data: bool) -> Result<UninstallDone, String> {
    let machine = ops::installed().is_some_and(|e| e.scope == Scope::Machine);
    if machine && !system::elevated() {
        let args = vec![
            "--uninstall".to_owned(),
            "--auto".to_owned(),
            format!("--remove-data={}", bit(remove_data)),
            lang_arg(),
        ];
        elevate(args).await?;
        return Ok(UninstallDone { elevated: true, warnings: Vec::new() });
    }
    let done = tauri::async_runtime::spawn_blocking({
        let app = app.clone();
        move || ops::uninstall(remove_data, &mut reporter(&app))
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())?;
    *app.state::<Leftover>().0.lock().unwrap() = done.leftover;
    Ok(UninstallDone { elevated: false, warnings: done.warnings })
}

#[tauri::command]
fn launch_app(dir: String) -> Result<(), String> {
    system::launch(&PathBuf::from(dir).join(EXE)).map_err(|e| e.to_string())
}

/// Matches the `document.title` main.js sets.
fn title() -> String {
    let product = FLAVOR.product;
    if uninstall_mode() {
        tr!("{product} 卸载", "Uninstall {product}", "{product} نى ئۆچۈرۈش")
    } else {
        tr!("{product} 安装", "{product} setup", "{product} نى ئورنىتىش")
    }
}

pub fn run() {
    i18n::set(language());
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(Leftover::default())
        .invoke_handler(tauri::generate_handler![
            setup_info, ready, minimize, quit, pick_dir, install, uninstall, launch_app
        ])
        .setup(|app| {
            WebviewWindowBuilder::new(app, "main", WebviewUrl::default())
                .title(title())
                .initialization_script(lang_script())
                .inner_size(720.0, 500.0)
                .resizable(false)
                .maximizable(false)
                .decorations(false)
                .visible(false)
                .center()
                .data_directory(system::webview_dir())
                .build()?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("failed to start the installer");

    app.run(|handle, event| {
        if let RunEvent::Exit = event {
            let leftover = handle.state::<Leftover>().0.lock().unwrap().take();
            let leftover = leftover.as_ref().map(|(file, dir)| (file.as_path(), dir.as_path()));
            let _ = system::clean_up_after_exit(&system::webview_dir(), leftover);
        }
    });
}
