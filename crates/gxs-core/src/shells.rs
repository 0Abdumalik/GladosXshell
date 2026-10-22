//! Local shells installed on this machine, offered as terminal types.

use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::pty::PtyOptions;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Shell {
    /// Stable across runs: `cmd`, `powershell`, `pwsh`, `git-bash`, `wsl:<distro>`, or a path on Unix.
    pub id: String,
    pub name: String,
    pub program: String,
    #[serde(skip)]
    pub args: Vec<String>,
}

impl Shell {
    fn new(id: impl Into<String>, name: impl Into<String>, program: &Path, args: &[&str]) -> Self {
        Self {
            id: id.into(),
            name: name.into(),
            program: program.display().to_string(),
            args: args.iter().map(|a| (*a).to_owned()).collect(),
        }
    }

    pub fn apply(&self, options: &mut PtyOptions) {
        options.program = Some(self.program.clone());
        options.args = self.args.clone();
    }
}

/// Where Windows keeps things, read from the environment.
#[derive(Debug, Clone, Default)]
pub struct WinPlaces {
    pub system_root: PathBuf,
    pub comspec: Option<PathBuf>,
    pub program_files: Vec<PathBuf>,
    pub local_app_data: Option<PathBuf>,
    pub path: Vec<PathBuf>,
}

/// Distro names WSL accepts; anything else is skipped rather than passed to `wsl.exe -d`.
fn valid_distro(name: &str) -> bool {
    !name.is_empty() && name.len() <= 64 && name.chars().all(|c| c.is_ascii_alphanumeric() || "._-".contains(c))
}

/// Docker Desktop's distros only run its engine and have no usable shell.
fn interactive_distro(name: &str) -> bool {
    !name.to_ascii_lowercase().starts_with("docker-desktop")
}

/// The shells found under `places`; `distros` are registered WSL distros, default first.
pub fn windows_shells(places: &WinPlaces, exists: &dyn Fn(&Path) -> bool, distros: &[String]) -> Vec<Shell> {
    let mut out = Vec::new();
    let system32 = places.system_root.join("System32");

    let cmd = places.comspec.clone().filter(|p| exists(p)).unwrap_or_else(|| system32.join("cmd.exe"));
    if exists(&cmd) {
        let name = crate::tr!("命令提示符", "Command Prompt", "بۇيرۇق كۆزنىكى");
        out.push(Shell::new("cmd", name, &cmd, &[]));
    }
    let powershell = system32.join(r"WindowsPowerShell\v1.0\powershell.exe");
    if exists(&powershell) {
        out.push(Shell::new("powershell", "Windows PowerShell", &powershell, &["-NoLogo"]));
    }

    let pwsh = places.path.iter().map(|d| d.join("pwsh.exe")).chain(
        places
            .program_files
            .iter()
            .flat_map(|d| ["7", "7-preview", "6"].map(|v| d.join("PowerShell").join(v).join("pwsh.exe"))),
    );
    if let Some(pwsh) = pwsh.into_iter().find(|p| exists(p)) {
        out.push(Shell::new("pwsh", "PowerShell", &pwsh, &["-NoLogo"]));
    }

    // Git's own `cmd` folder on PATH points at the install; a bare `bash.exe` on PATH is
    // usually System32's WSL launcher, so it is not used.
    let git_roots = places
        .path
        .iter()
        .filter(|d| d.file_name().is_some_and(|n| n.eq_ignore_ascii_case("cmd")))
        .filter_map(|d| d.parent().map(Path::to_path_buf))
        .chain(places.program_files.iter().map(|d| d.join("Git")))
        .chain(places.local_app_data.iter().map(|d| d.join(r"Programs\Git")));
    if let Some(bash) = git_roots.map(|root| root.join(r"bin\bash.exe")).find(|p| exists(p)) {
        out.push(Shell::new("git-bash", "Git Bash", &bash, &["--login", "-i"]));
    }

    let wsl = system32.join("wsl.exe");
    if exists(&wsl) {
        for distro in distros.iter().filter(|d| valid_distro(d) && interactive_distro(d)) {
            out.push(Shell::new(
                format!("wsl:{distro}"),
                format!("{distro} (WSL)"),
                &wsl,
                &["-d", distro, "--cd", "~"],
            ));
        }
    }
    out
}

/// Login shells listed in `/etc/shells`, one per program name.
pub fn parse_etc_shells(text: &str, exists: &dyn Fn(&Path) -> bool) -> Vec<Shell> {
    let mut out: Vec<Shell> = Vec::new();
    for line in text.lines().map(str::trim) {
        if line.is_empty() || line.starts_with('#') || !line.starts_with('/') {
            continue;
        }
        let path = Path::new(line);
        let Some(name) = path.file_name().and_then(|n| n.to_str()) else { continue };
        if matches!(name, "nologin" | "false" | "true") || out.iter().any(|s| s.name == name) || !exists(path) {
            continue;
        }
        out.push(Shell::new(line, name, path, &["-l"]));
    }
    out
}

#[cfg(windows)]
fn wsl_distros() -> Vec<String> {
    use windows_sys::Win32::System::Registry::HKEY_CURRENT_USER;

    use crate::registry::{Key, RegValue};

    let Ok(Some(root)) = Key::open(HKEY_CURRENT_USER, r"Software\Microsoft\Windows\CurrentVersion\Lxss") else {
        return Vec::new();
    };
    let default = match root.values().remove("defaultdistribution") {
        Some(RegValue::Text(id)) => id,
        _ => String::new(),
    };
    let mut found: Vec<(bool, String)> = root
        .subkeys()
        .into_iter()
        .filter_map(|sub| {
            let key = Key::open(root.handle(), &sub).ok()??;
            match key.values().remove("distributionname") {
                Some(RegValue::Text(name)) => Some((sub.eq_ignore_ascii_case(&default), name)),
                _ => None,
            }
        })
        .collect();
    found.sort_by_key(|(is_default, _)| !is_default);
    found.into_iter().map(|(_, name)| name).collect()
}

#[cfg(windows)]
pub fn detect() -> Vec<Shell> {
    let var = |name: &str| std::env::var_os(name).filter(|v| !v.is_empty()).map(PathBuf::from);
    let mut program_files = Vec::new();
    for name in ["ProgramFiles", "ProgramW6432", "ProgramFiles(x86)"] {
        if let Some(dir) = var(name)
            && !program_files.contains(&dir)
        {
            program_files.push(dir);
        }
    }
    let places = WinPlaces {
        system_root: var("SystemRoot").unwrap_or_else(|| PathBuf::from(r"C:\Windows")),
        comspec: var("ComSpec"),
        program_files,
        local_app_data: var("LOCALAPPDATA"),
        path: std::env::var_os("PATH").map(|p| std::env::split_paths(&p).collect()).unwrap_or_default(),
    };
    windows_shells(&places, &|p| p.is_file(), &wsl_distros())
}

#[cfg(not(windows))]
pub fn detect() -> Vec<Shell> {
    let text = std::fs::read_to_string("/etc/shells").unwrap_or_default();
    parse_etc_shells(&text, &|p| p.is_file())
}

pub fn find(id: &str) -> Option<Shell> {
    detect().into_iter().find(|s| s.id == id)
}

#[cfg(test)]
mod tests {
    #[cfg(windows)]
    use std::collections::HashSet;

    use super::*;

    #[cfg(windows)]
    fn places() -> WinPlaces {
        WinPlaces {
            system_root: PathBuf::from(r"C:\Windows"),
            comspec: Some(PathBuf::from(r"C:\Windows\System32\cmd.exe")),
            program_files: vec![PathBuf::from(r"C:\Program Files"), PathBuf::from(r"C:\Program Files (x86)")],
            local_app_data: Some(PathBuf::from(r"C:\Users\u\AppData\Local")),
            path: vec![PathBuf::from(r"C:\Windows\System32"), PathBuf::from(r"D:\Tools\Git\cmd")],
        }
    }

    fn ids(shells: &[Shell]) -> Vec<&str> {
        shells.iter().map(|s| s.id.as_str()).collect()
    }

    #[cfg(windows)]
    #[test]
    fn finds_windows_shells_in_order() {
        let files: HashSet<PathBuf> = [
            r"C:\Windows\System32\cmd.exe",
            r"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe",
            r"C:\Program Files\PowerShell\7\pwsh.exe",
            r"D:\Tools\Git\bin\bash.exe",
            r"C:\Program Files\Git\bin\bash.exe",
            r"C:\Windows\System32\wsl.exe",
            r"C:\Windows\System32\bash.exe",
        ]
        .iter()
        .map(PathBuf::from)
        .collect();
        let distros = ["Ubuntu-22.04", "docker-desktop", "bad name", "Debian"].map(String::from);
        let shells = windows_shells(&places(), &|p| files.contains(p), &distros);
        assert_eq!(ids(&shells), ["cmd", "powershell", "pwsh", "git-bash", "wsl:Ubuntu-22.04", "wsl:Debian"]);
        let bash = &shells[3];
        assert_eq!(bash.program, r"D:\Tools\Git\bin\bash.exe");
        assert_eq!(bash.args, ["--login", "-i"]);
        assert_eq!(shells[4].args, ["-d", "Ubuntu-22.04", "--cd", "~"]);
        assert_eq!(shells[4].name, "Ubuntu-22.04 (WSL)");
    }

    #[cfg(windows)]
    #[test]
    fn falls_back_when_comspec_is_missing_and_skips_absent_shells() {
        let files: HashSet<PathBuf> =
            [r"C:\Windows\System32\cmd.exe", r"C:\Users\u\AppData\Local\Programs\Git\bin\bash.exe"]
                .iter()
                .map(PathBuf::from)
                .collect();
        let mut at = places();
        at.comspec = Some(PathBuf::from(r"X:\gone\cmd.exe"));
        let shells = windows_shells(&at, &|p| files.contains(p), &["Ubuntu".into()]);
        assert_eq!(ids(&shells), ["cmd", "git-bash"]);
        assert_eq!(shells[0].program, r"C:\Windows\System32\cmd.exe");
    }

    #[test]
    fn parses_etc_shells() {
        let text = "# comment\n/bin/sh\n/bin/bash\n/usr/bin/bash\n\n/usr/sbin/nologin\nrelative\n/usr/bin/zsh\n/gone/fish\n";
        let shells = parse_etc_shells(text, &|p| !p.starts_with("/gone"));
        assert_eq!(ids(&shells), ["/bin/sh", "/bin/bash", "/usr/bin/zsh"]);
        assert_eq!(shells[2].name, "zsh");
        assert_eq!(shells[2].args, ["-l"]);
    }

    #[test]
    fn distro_names_are_checked() {
        assert!(valid_distro("Ubuntu-22.04"));
        assert!(!valid_distro("a b"));
        assert!(!valid_distro("x;rm"));
        assert!(!valid_distro(""));
        assert!(!interactive_distro("docker-desktop-data"));
    }
}
