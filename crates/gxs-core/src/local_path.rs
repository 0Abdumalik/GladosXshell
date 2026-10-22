//! Mapping untrusted remote names onto the local (Windows) filesystem. A server controls every
//! file name it lists, so nothing it sends may escape the chosen local directory or hit a device
//! name like `CON`.

use std::path::{Component, Path, PathBuf};

use crate::error::{Error, Result};

const RESERVED: &[&str] = &[
    "CON", "PRN", "AUX", "NUL", "COM0", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9", "LPT0",
    "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9", "CONIN$", "CONOUT$",
];

const MAX_NAME: usize = 200;

/// Makes one remote file name safe as a single local path component. Never returns an empty
/// string, `.` or `..`.
pub fn sanitize_name(name: &str) -> String {
    let mut out: String = name
        .chars()
        .map(|c| match c {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => '_',
            c if c.is_control() => '_',
            c => c,
        })
        .collect();
    // Windows silently strips trailing dots and spaces, which would alias `a.` onto `a`.
    let kept = out.trim_end_matches(['.', ' ']).len();
    let stripped = out.len() - kept;
    out.truncate(kept);
    out.extend(std::iter::repeat_n('_', stripped));
    if out.is_empty() {
        out.push('_');
    }
    let stem = out.split('.').next().unwrap_or("").trim_end().to_ascii_uppercase();
    if RESERVED.contains(&stem.as_str()) {
        out.insert(0, '_');
    }
    if out.len() > MAX_NAME {
        let mut cut = MAX_NAME;
        while !out.is_char_boundary(cut) {
            cut -= 1;
        }
        out.truncate(cut);
    }
    out
}

/// Joins a POSIX-style remote path under `base`. A leading `/` is treated as the root of the
/// mirror; `..` anywhere is rejected outright rather than resolved.
pub fn safe_join(base: &Path, remote: &str) -> Result<PathBuf> {
    let mut path = base.to_path_buf();
    for part in remote.split('/') {
        match part {
            "" | "." => {}
            ".." => return Err(Error::invalid(format!("path escapes the local directory: {remote}"))),
            part => path.push(sanitize_name(part)),
        }
    }
    debug_assert!(path.starts_with(base));
    // Belt and braces: every pushed component must be a plain name.
    if path
        .strip_prefix(base)
        .map_err(|_| Error::invalid("path escapes the local directory"))?
        .components()
        .any(|c| !matches!(c, Component::Normal(_)))
    {
        return Err(Error::invalid(format!("unsafe local path for {remote}")));
    }
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plain_names_pass_through() {
        assert_eq!(sanitize_name("config.json"), "config.json");
        assert_eq!(sanitize_name("中文 文件.txt"), "中文 文件.txt");
        assert_eq!(sanitize_name(".bashrc"), ".bashrc");
    }

    #[test]
    fn illegal_characters_and_trailing_dots_are_replaced() {
        assert_eq!(sanitize_name("a<b>c:d\"e|f?g*h"), "a_b_c_d_e_f_g_h");
        assert_eq!(sanitize_name("back\\slash"), "back_slash");
        assert_eq!(sanitize_name("tab\there"), "tab_here");
        assert_eq!(sanitize_name("trail. ."), "trail___");
        assert_eq!(sanitize_name("..."), "___");
        assert_eq!(sanitize_name(""), "_");
    }

    #[test]
    fn reserved_device_names_are_prefixed() {
        assert_eq!(sanitize_name("CON"), "_CON");
        assert_eq!(sanitize_name("nul.txt"), "_nul.txt");
        assert_eq!(sanitize_name("com1.tar.gz"), "_com1.tar.gz");
        assert_eq!(sanitize_name("console"), "console");
    }

    #[test]
    fn long_names_are_truncated_on_char_boundary() {
        let name = "文".repeat(100);
        let out = sanitize_name(&name);
        assert!(out.len() <= MAX_NAME);
        assert!(out.chars().all(|c| c == '文'));
    }

    #[test]
    fn join_mirrors_remote_path_under_base() {
        let base = Path::new(r"C:\work\srv");
        assert_eq!(
            safe_join(base, "/etc/config/network").unwrap(),
            base.join("etc").join("config").join("network")
        );
        assert_eq!(safe_join(base, "./a//b/").unwrap(), base.join("a").join("b"));
    }

    #[test]
    fn join_rejects_traversal_and_neutralises_drive_letters() {
        let base = Path::new(r"C:\work\srv");
        assert!(safe_join(base, "../x").is_err());
        assert!(safe_join(base, "/a/../../x").is_err());
        assert_eq!(safe_join(base, "C:/Windows").unwrap(), base.join("C_").join("Windows"));
        assert_eq!(safe_join(base, r"..\..\x").unwrap(), base.join(".._.._x"));
        assert_eq!(safe_join(base, "/CON/aux").unwrap(), base.join("_CON").join("_aux"));
    }
}
