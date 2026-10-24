//! Install and uninstall steps, kept apart from the window so they can be tested.

use std::fs::{self, File, OpenOptions};
use std::io::{self, Cursor, Read, Write};
use std::path::{Path, PathBuf};

use serde::Serialize;
use zip::ZipArchive;

use crate::flavor::{EXE, FLAVOR, UNINSTALLER};
use crate::system::{self, Scope};
use crate::tr;

static PAYLOAD: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/payload.zip"));

const ERROR_SHARING_VIOLATION: i32 = 32;

pub fn payload_present() -> bool {
    ZipArchive::new(Cursor::new(PAYLOAD)).is_ok_and(|mut zip| zip.by_name(EXE).is_ok())
}

/// A picked folder gets the product folder appended, so uninstalling never leaves files loose in it.
pub fn install_target(picked: &Path) -> PathBuf {
    if picked.file_name().is_some_and(|name| name.eq_ignore_ascii_case(FLAVOR.product)) {
        picked.to_path_buf()
    } else {
        picked.join(FLAVOR.product)
    }
}

/// A running program cannot be opened for writing, which is how we tell the app is still open.
pub fn in_use(path: &Path) -> bool {
    match OpenOptions::new().write(true).open(path) {
        Err(e) => e.raw_os_error() == Some(ERROR_SHARING_VIOLATION),
        Ok(_) => false,
    }
}

fn running_error() -> io::Error {
    io::Error::other(tr!(
        "{product} 正在运行，请先关闭它再继续",
        "{product} is running. Close it, then try again",
        "{product} ئىجرا بولۇۋاتىدۇ، ئالدى بىلەن ئۇنى تاقاپ ئاندىن داۋاملاشتۇرۇڭ",
        product = FLAVOR.product
    ))
}

/// Writes the program next to its final name and swaps it in, so a failed upgrade keeps the old one.
fn extract(payload: &[u8], dir: &Path, progress: &mut dyn FnMut(f64)) -> io::Result<u64> {
    let mut zip = ZipArchive::new(Cursor::new(payload)).map_err(io::Error::other)?;
    let mut entry = zip.by_name(EXE).map_err(|_| {
        io::Error::other(tr!(
            "安装包不完整，缺少程序文件",
            "The installer is incomplete: the program file is missing",
            "ئورنىتىش بوغچىسى تولۇق ئەمەس، پروگرامما ھۆججىتى كەم"
        ))
    })?;
    let total = entry.size().max(1);
    let target = dir.join(EXE);
    let partial = dir.join(format!("{EXE}.partial"));
    let mut out = File::create(&partial)?;
    let mut buf = vec![0u8; 256 * 1024];
    let mut written = 0u64;
    let copied = loop {
        let n = match entry.read(&mut buf) {
            Ok(0) => break Ok(()),
            Ok(n) => n,
            Err(e) => break Err(e),
        };
        if let Err(e) = out.write_all(&buf[..n]) {
            break Err(e);
        }
        written += n as u64;
        progress(written as f64 / total as f64);
    };
    let finished = copied.and_then(|()| out.sync_all());
    drop(out);
    if let Err(e) = finished.and_then(|()| fs::rename(&partial, &target)) {
        let _ = fs::remove_file(&partial);
        return Err(e);
    }
    Ok(written)
}

pub struct InstallOptions {
    pub scope: Scope,
    pub dir: PathBuf,
    pub desktop: bool,
    pub start_menu: bool,
}

/// System folders that must never become the parent of an install: opening a data folder
/// under them could damage the OS.
fn is_system_parent(parent: &Path) -> bool {
    let Some(name) = parent.file_name().and_then(|n| n.to_str()) else {
        return true; // a drive root
    };
    matches!(
        name.to_ascii_lowercase().as_str(),
        "windows" | "system32" | "syswow64" | "programdata" | "windows.old" | "recycler" | "$recycle.bin"
    )
}

pub fn install(options: &InstallOptions, progress: &mut dyn FnMut(f64, &str)) -> io::Result<()> {
    // The install target always ends in the product folder: a picked folder gets it appended
    // and an explicit --dir must match the same shape, so a stray path (or a system folder)
    // can never become the install root.
    let dir = install_target(&options.dir);
    if !dir.is_absolute() {
        return Err(io::Error::other(tr!(
            "请选择一个完整的安装路径",
            "Choose a full install path",
            "تولۇق ئورنىتىش يولىنى تاللاڭ"
        )));
    }
    if dir.parent().is_some_and(is_system_parent) {
        return Err(io::Error::other(tr!(
            "不能安装到系统目录，请换一个文件夹",
            "Cannot install into a system folder; choose another one",
            "سىستېما قىسقۇچىغا ئورنىتىشقا بولمايدۇ، باشقا بىر قىسقۇچ تاللاڭ"
        )));
    }
    if options.scope == Scope::Machine && !system::elevated() {
        return Err(io::Error::other(tr!(
            "为所有用户安装需要管理员权限",
            "Installing for all users needs administrator rights",
            "بارلىق ئىشلەتكۈچىلەرگە ئورنىتىش ئۈچۈن باشقۇرغۇچى ھوقۇقى كېرەك"
        )));
    }
    progress(0.02, &tr!("准备安装目录", "Preparing the install folder", "ئورنىتىش قىسقۇچى تەييارلىنىۋاتىدۇ"));
    fs::create_dir_all(&dir)?;
    // A machine-wide install lands in a protected folder (Program Files). Only the data
    // subfolder is opened to standard users, so the program files stay read-only to them.
    if options.scope == Scope::Machine {
        #[cfg(windows)]
        system::grant_users_write(&dir)?;
    }
    if in_use(&dir.join(EXE)) {
        return Err(running_error());
    }

    let extracting = tr!("解压程序文件", "Extracting the program files", "پروگرامما ھۆججەتلىرى يېيىلىۋاتىدۇ");
    progress(0.05, &extracting);
    let exe_size = extract(PAYLOAD, &dir, &mut |f| progress(0.05 + f * 0.8, &extracting))?;

    progress(0.88, &tr!("写入卸载程序", "Writing the uninstaller", "ئۆچۈرگۈچ يېزىلىۋاتىدۇ"));
    let uninstaller = dir.join(UNINSTALLER);
    let current = std::env::current_exe()?;
    if !same_file(&current, &uninstaller) {
        fs::copy(&current, &uninstaller)?;
    }
    let uninstaller_size = fs::metadata(&uninstaller).map(|m| m.len()).unwrap_or(0);

    progress(0.93, &tr!("创建快捷方式", "Creating shortcuts", "تېزلەتمىلەر قۇرۇلۇۋاتىدۇ"));
    let exe = dir.join(EXE);
    let links = system::shortcut_paths(options.scope);
    for (wanted, link) in [(options.desktop, links.desktop), (options.start_menu, links.start_menu)] {
        if let (true, Some(link)) = (wanted, link) {
            system::create_shortcut(&link, &exe)?;
        }
    }

    progress(0.97, &tr!("登记到系统", "Registering with Windows", "سىستېمىغا تىزىملىتىلىۋاتىدۇ"));
    let size_kb = u32::try_from((exe_size + uninstaller_size) / 1024).unwrap_or(u32::MAX);
    system::register(options.scope, &dir, size_kb)?;
    progress(1.0, &tr!("安装完成", "Installation complete", "ئورنىتىش تاماملاندى"));
    Ok(())
}

fn same_file(a: &Path, b: &Path) -> bool {
    match (fs::canonicalize(a), fs::canonicalize(b)) {
        (Ok(a), Ok(b)) => a == b,
        _ => false,
    }
}

pub struct Installed {
    pub dir: PathBuf,
    pub version: String,
    pub scope: Scope,
}

/// What this uninstaller removes: only the registered install the uninstaller actually sits
/// in. A copied uninstall.exe must not steer the deletion toward an arbitrary install.
pub fn installed() -> Option<Installed> {
    let here = std::env::current_exe().ok().and_then(|exe| exe.parent().map(Path::to_path_buf));
    let found = system::existing_installs();
    let e = found.into_iter().find(|e| here.as_deref().is_some_and(|h| same_file(h, &e.dir)))?;
    Some(Installed { dir: e.dir, version: e.version, scope: e.scope })
}

/// Something uninstalling could not delete. The window words it, so the path can be kept left to
/// right in Uyghur.
#[derive(Debug, Serialize)]
pub struct Warning {
    pub path: String,
    pub error: String,
}

impl Warning {
    fn new(path: &Path, error: &io::Error) -> Self {
        Warning { path: path.display().to_string(), error: error.to_string() }
    }
}

pub struct Uninstalled {
    /// Set when this process is the installed uninstaller and has to be deleted after it exits.
    pub leftover: Option<(PathBuf, PathBuf)>,
    pub warnings: Vec<Warning>,
}

/// Only removes what the installer put there; the folder itself goes only if it ends up empty.
pub fn uninstall(remove_data: bool, progress: &mut dyn FnMut(f64, &str)) -> io::Result<Uninstalled> {
    let Installed { dir, scope, .. } = installed().ok_or_else(|| {
        io::Error::other(tr!("没有找到已安装的程序", "No installed copy was found", "ئورنىتىلغان پروگرامما تېپىلمىدى"))
    })?;
    if scope == Scope::Machine && !system::elevated() {
        return Err(io::Error::other(tr!(
            "卸载为所有用户安装的程序需要管理员权限",
            "Uninstalling a copy installed for all users needs administrator rights",
            "بارلىق ئىشلەتكۈچىلەرگە ئورنىتىلغان پروگراممىنى ئۆچۈرۈش ئۈچۈن باشقۇرغۇچى ھوقۇقى كېرەك"
        )));
    }
    let exe = dir.join(EXE);
    if in_use(&exe) {
        return Err(running_error());
    }
    let mut warnings = Vec::new();

    progress(0.2, &tr!("删除程序文件", "Deleting the program files", "پروگرامما ھۆججەتلىرى ئۆچۈرۈلۈۋاتىدۇ"));
    remove_file(&exe)?;

    progress(0.45, &tr!("删除快捷方式", "Deleting shortcuts", "تېزلەتمىلەر ئۆچۈرۈلۈۋاتىدۇ"));
    let links = system::shortcut_paths(scope);
    for link in [links.desktop, links.start_menu].into_iter().flatten() {
        if let Err(e) = remove_file(&link) {
            warnings.push(Warning::new(&link, &e));
        }
    }

    progress(0.6, &tr!("移除系统登记", "Removing the Windows entry", "سىستېمىدىكى تىزىملىتىش ئۆچۈرۈلۈۋاتىدۇ"));
    system::unregister(scope)?;

    if remove_data {
        progress(0.75, &tr!("删除用户数据", "Deleting user data", "ئىشلەتكۈچى سانلىق مەلۇماتى ئۆچۈرۈلۈۋاتىدۇ"));
        for data in system::data_dirs(&dir) {
            match fs::remove_dir_all(&data) {
                Err(e) if e.kind() != io::ErrorKind::NotFound => {
                    warnings.push(Warning::new(&data, &e));
                }
                _ => {}
            }
        }
        // Data that lives beside the program: remove exactly what the app wrote, keep
        // anything the user added to the install folder.
        for item in system::install_data_items(&dir) {
            let result = if item.is_dir() {
                fs::remove_dir_all(&item)
            } else {
                fs::remove_file(&item)
            };
            if let Err(e) = result {
                warnings.push(Warning::new(&item, &e));
            }
        }
    }

    progress(0.9, &tr!("清理安装目录", "Cleaning up the install folder", "ئورنىتىش قىسقۇچى تازىلىنىۋاتىدۇ"));
    let uninstaller = dir.join(UNINSTALLER);
    let running_from_dir = std::env::current_exe().is_ok_and(|c| same_file(&c, &uninstaller));
    let leftover = if running_from_dir {
        Some((uninstaller, dir))
    } else {
        remove_file(&uninstaller)?;
        let _ = fs::remove_dir(&dir);
        None
    };
    progress(1.0, &tr!("卸载完成", "Uninstall complete", "ئۆچۈرۈش تاماملاندى"));
    Ok(Uninstalled { leftover, warnings })
}

fn remove_file(path: &Path) -> io::Result<()> {
    match fs::remove_file(path) {
        Err(e) if e.kind() != io::ErrorKind::NotFound => Err(e),
        _ => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use zip::ZipWriter;
    use zip::write::SimpleFileOptions;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("gxs-setup-test-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn payload(entry: &str, body: &[u8]) -> Vec<u8> {
        let mut zip = ZipWriter::new(Cursor::new(Vec::new()));
        zip.start_file(entry, SimpleFileOptions::default()).unwrap();
        zip.write_all(body).unwrap();
        zip.finish().unwrap().into_inner()
    }

    #[test]
    fn extract_replaces_the_program_and_reports_progress() {
        let dir = temp_dir("extract");
        fs::write(dir.join(EXE), b"old").unwrap();
        let body = vec![7u8; 600 * 1024];
        let mut seen = Vec::new();
        let written = extract(&payload(EXE, &body), &dir, &mut |f| seen.push(f)).unwrap();
        assert_eq!(written, body.len() as u64);
        assert_eq!(fs::read(dir.join(EXE)).unwrap(), body);
        assert!(!dir.join(format!("{EXE}.partial")).exists());
        assert!(seen.windows(2).all(|w| w[0] <= w[1]));
        assert_eq!(seen.last().copied(), Some(1.0));
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn extract_without_the_program_leaves_the_old_one() {
        let dir = temp_dir("missing");
        fs::write(dir.join(EXE), b"old").unwrap();
        assert!(extract(&payload("other.exe", b"x"), &dir, &mut |_| {}).is_err());
        assert_eq!(fs::read(dir.join(EXE)).unwrap(), b"old");
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn picked_folders_get_the_product_folder() {
        let base = Path::new(r"D:\Apps");
        assert_eq!(install_target(base), base.join(FLAVOR.product));
        let named = base.join(FLAVOR.product.to_lowercase());
        assert_eq!(install_target(&named), named);
    }

    #[test]
    fn a_file_nobody_holds_is_not_in_use() {
        let dir = temp_dir("in-use");
        let file = dir.join("free.txt");
        assert!(!in_use(&file));
        fs::write(&file, b"x").unwrap();
        assert!(!in_use(&file));
        fs::remove_dir_all(&dir).unwrap();
    }
}
