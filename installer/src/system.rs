//! Windows plumbing: known folders, shortcuts, the uninstall entry, elevation and the deferred cleanup.

use std::io;
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::Command;

use serde::{Deserialize, Serialize};
use windows::Win32::System::Com::{
    CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED, CoCreateInstance, CoInitializeEx, CoTaskMemFree,
    CoUninitialize, IPersistFile,
};
use windows::Win32::UI::Shell::{
    FOLDERID_CommonPrograms, FOLDERID_Desktop, FOLDERID_Programs, FOLDERID_PublicDesktop, IShellLinkW,
    IsUserAnAdmin, KF_FLAG_DEFAULT, SHGetKnownFolderPath, ShellExecuteW, ShellLink,
};
use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;
use windows::core::{GUID, HSTRING, Interface};
use winreg::RegKey;
use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};

use crate::flavor::{EMAIL, EXE, FLAVOR, PUBLISHER, UNINSTALLER, VERSION};
use crate::i18n::ltr;
use crate::tr;

const CREATE_NO_WINDOW: u32 = 0x0800_0000;
const UNINSTALL_ROOT: &str = r"Software\Microsoft\Windows\CurrentVersion\Uninstall";

/// Who the program is installed for. All users needs administrator rights.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Scope {
    User,
    Machine,
}

impl Scope {
    fn hive(self) -> RegKey {
        RegKey::predef(match self {
            Scope::User => HKEY_CURRENT_USER,
            Scope::Machine => HKEY_LOCAL_MACHINE,
        })
    }

    pub fn arg(self) -> &'static str {
        match self {
            Scope::User => "user",
            Scope::Machine => "machine",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "user" => Some(Scope::User),
            "machine" => Some(Scope::Machine),
            _ => None,
        }
    }
}

fn uninstall_key() -> String {
    format!(r"{UNINSTALL_ROOT}\{}", FLAVOR.identifier)
}

fn win_error(e: windows::core::Error) -> io::Error {
    io::Error::other(e.message())
}

/// COM for the current thread; shortcuts need it and install work runs on its own thread.
pub struct Com;

impl Com {
    pub fn init() -> Self {
        // S_FALSE (already initialised) is fine; a different apartment only means shortcuts may fail.
        let _ = unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) };
        Com
    }
}

impl Drop for Com {
    fn drop(&mut self) {
        unsafe { CoUninitialize() };
    }
}

/// True when this process runs with an administrator token (after a UAC prompt).
pub fn elevated() -> bool {
    unsafe { IsUserAnAdmin().as_bool() }
}

/// Starts this program again as administrator; returns once the user answered the UAC prompt.
pub fn relaunch_elevated(args: &[String]) -> io::Result<()> {
    let exe = std::env::current_exe()?;
    let params = args.iter().map(|a| quote_arg(a)).collect::<Vec<_>>().join(" ");
    let code = unsafe {
        ShellExecuteW(
            None,
            &HSTRING::from("runas"),
            &HSTRING::from(exe.as_os_str()),
            &HSTRING::from(params),
            None,
            SW_SHOWNORMAL,
        )
    };
    // Values up to 32 are errors; declining the prompt is one of them.
    if code.0 as usize <= 32 {
        return Err(io::Error::other(tr!(
            "没有获得管理员权限。为所有用户安装或卸载需要管理员权限",
            "Administrator rights were not granted. Installing or uninstalling for all users needs them",
            "باشقۇرغۇچى ھوقۇقىغا ئېرىشەلمىدى. بارلىق ئىشلەتكۈچىلەرگە ئورنىتىش ياكى ئۆچۈرۈش ئۈچۈن باشقۇرغۇچى ھوقۇقى كېرەك"
        )));
    }
    Ok(())
}

/// Quotes one argument so the Rust runtime (and CommandLineToArgvW) splits it back unchanged.
pub fn quote_arg(arg: &str) -> String {
    if !arg.is_empty() && !arg.contains([' ', '\t', '"']) {
        return arg.to_owned();
    }
    let mut out = String::from('"');
    let mut slashes = 0;
    for c in arg.chars() {
        match c {
            '\\' => slashes += 1,
            '"' => {
                out.extend(std::iter::repeat_n('\\', slashes * 2 + 1));
                out.push('"');
                slashes = 0;
            }
            _ => {
                out.extend(std::iter::repeat_n('\\', slashes));
                out.push(c);
                slashes = 0;
            }
        }
    }
    out.extend(std::iter::repeat_n('\\', slashes * 2));
    out.push('"');
    out
}

fn known_folder(id: &GUID) -> io::Result<PathBuf> {
    unsafe {
        let raw = SHGetKnownFolderPath(id, KF_FLAG_DEFAULT, None).map_err(win_error)?;
        let path = raw.to_string().map_err(|e| io::Error::other(e.to_string()));
        CoTaskMemFree(Some(raw.0 as *const _));
        path.map(PathBuf::from)
    }
}

fn env_dir(name: &str) -> io::Result<PathBuf> {
    std::env::var_os(name)
        .map(PathBuf::from)
        .ok_or_else(|| {
            let name = ltr(name);
            io::Error::other(tr!("找不到 {name} 目录", "Could not find the {name} folder", "{name} قىسقۇچى تېپىلمىدى"))
        })
}

/// Program Files for everyone; for one user a folder in their profile rather than AppData.
pub fn default_install_dir(scope: Scope) -> io::Result<PathBuf> {
    match scope {
        Scope::Machine => Ok(env_dir("ProgramFiles")?.join(FLAVOR.product)),
        Scope::User => Ok(env_dir("USERPROFILE")?.join(FLAVOR.product)),
    }
}

/// The app's data folder for the current user (see src-tauri/src/datadir.rs).
pub fn user_data_dir() -> io::Result<PathBuf> {
    Ok(env_dir("USERPROFILE")?.join(FLAVOR.data_folder))
}

/// Folders the app itself writes: settings, connections and keys, and the WebView profile. Older
/// versions used AppData, and a portable copy keeps them in `data` beside the program.
pub fn data_dirs(install_dir: &Path) -> Vec<PathBuf> {
    let legacy = ["APPDATA", "LOCALAPPDATA"].into_iter().filter_map(|name| env_dir(name).ok());
    user_data_dir()
        .into_iter()
        .chain([install_dir.join("data")])
        .chain(legacy.map(|dir| dir.join(FLAVOR.identifier)))
        .collect()
}

pub struct Shortcuts {
    pub desktop: Option<PathBuf>,
    pub start_menu: Option<PathBuf>,
}

pub fn shortcut_paths(scope: Scope) -> Shortcuts {
    let name = format!("{}.lnk", FLAVOR.product);
    let (desktop, programs) = match scope {
        Scope::User => (&FOLDERID_Desktop, &FOLDERID_Programs),
        Scope::Machine => (&FOLDERID_PublicDesktop, &FOLDERID_CommonPrograms),
    };
    Shortcuts {
        desktop: known_folder(desktop).ok().map(|d| d.join(&name)),
        start_menu: known_folder(programs).ok().map(|d| d.join(&name)),
    }
}

pub fn create_shortcut(link: &Path, target: &Path) -> io::Result<()> {
    unsafe {
        let shell: IShellLinkW = CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER).map_err(win_error)?;
        shell.SetPath(&HSTRING::from(target.as_os_str())).map_err(win_error)?;
        if let Some(dir) = target.parent() {
            shell.SetWorkingDirectory(&HSTRING::from(dir.as_os_str())).map_err(win_error)?;
        }
        shell.SetDescription(&HSTRING::from(FLAVOR.product)).map_err(win_error)?;
        shell.SetIconLocation(&HSTRING::from(target.as_os_str()), 0).map_err(win_error)?;
        let file: IPersistFile = shell.cast().map_err(win_error)?;
        file.Save(&HSTRING::from(link.as_os_str()), true).map_err(win_error)?;
    }
    Ok(())
}

pub struct Existing {
    pub dir: PathBuf,
    pub version: String,
    pub scope: Scope,
}

/// Installs registered on this computer, all-users first.
pub fn existing_installs() -> Vec<Existing> {
    [Scope::Machine, Scope::User]
        .into_iter()
        .filter_map(|scope| {
            let key = scope.hive().open_subkey(uninstall_key()).ok()?;
            let dir: String = key.get_value("InstallLocation").ok()?;
            let version: String = key.get_value("DisplayVersion").unwrap_or_default();
            Some(Existing { dir: PathBuf::from(dir), version, scope })
        })
        .collect()
}

pub fn register(scope: Scope, dir: &Path, size_kb: u32) -> io::Result<()> {
    let (key, _) = scope.hive().create_subkey(uninstall_key())?;
    let exe = dir.join(EXE);
    let uninstaller = dir.join(UNINSTALLER);
    key.set_value("DisplayName", &FLAVOR.product)?;
    key.set_value("DisplayVersion", &VERSION)?;
    key.set_value("Publisher", &PUBLISHER)?;
    key.set_value("HelpLink", &format!("mailto:{EMAIL}"))?;
    key.set_value("DisplayIcon", &format!("{},0", exe.display()))?;
    key.set_value("InstallLocation", &dir.display().to_string())?;
    key.set_value("UninstallString", &format!("\"{}\" --uninstall", uninstaller.display()))?;
    key.set_value("EstimatedSize", &size_kb)?;
    key.set_value("NoModify", &1u32)?;
    key.set_value("NoRepair", &1u32)?;
    Ok(())
}

pub fn unregister(scope: Scope) -> io::Result<()> {
    match scope.hive().delete_subkey_all(uninstall_key()) {
        Err(e) if e.kind() != io::ErrorKind::NotFound => Err(e),
        _ => Ok(()),
    }
}

/// The setup window's own WebView cache, kept out of the app's data folders and removed on exit.
pub fn webview_dir() -> PathBuf {
    std::env::temp_dir().join(format!("gladosxshell-setup-{}", std::process::id()))
}

/// Files this process holds cannot be deleted while it runs; cmd removes them once it has exited.
/// Paths go through the environment with delayed expansion so `&` or `%` in them stay literal.
pub fn clean_up_after_exit(webview: &Path, uninstaller: Option<(&Path, &Path)>) -> io::Result<()> {
    let mut cmd = Command::new("cmd");
    cmd.raw_arg(
        r#"/v:on /c "ping -n 4 127.0.0.1 >nul & rmdir /s /q "!GXS_WEBVIEW!" 2>nul & if defined GXS_DIR (del /f /q "!GXS_FILE!" & rmdir "!GXS_DIR!")""#,
    )
    .env("GXS_WEBVIEW", webview)
    .env_remove("GXS_FILE")
    .env_remove("GXS_DIR")
    .current_dir(std::env::temp_dir())
    .creation_flags(CREATE_NO_WINDOW);
    if let Some((file, dir)) = uninstaller {
        cmd.env("GXS_FILE", file).env("GXS_DIR", dir);
    }
    cmd.spawn().map(drop)
}

/// From an elevated installer the app goes through Explorer, so it runs as the normal user.
pub fn launch(exe: &Path) -> io::Result<()> {
    if elevated() {
        return Command::new("explorer.exe").arg(exe).spawn().map(drop);
    }
    Command::new(exe)
        .current_dir(exe.parent().unwrap_or(Path::new(".")))
        .spawn()
        .map(drop)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quoted_arguments_split_back_unchanged() {
        assert_eq!(quote_arg("--auto"), "--auto");
        assert_eq!(quote_arg(r"--dir=C:\Program Files\GladosXshell"), r#""--dir=C:\Program Files\GladosXshell""#);
        assert_eq!(quote_arg(r"--dir=D:\My Apps\"), r#""--dir=D:\My Apps\\""#);
        assert_eq!(quote_arg(r#"a\"b"#), r#""a\\\"b""#);
        assert_eq!(quote_arg(""), r#""""#);
    }

    #[test]
    fn scopes_round_trip_as_arguments() {
        for scope in [Scope::User, Scope::Machine] {
            assert_eq!(Scope::parse(scope.arg()), Some(scope));
        }
        assert_eq!(Scope::parse("everyone"), None);
    }
}
