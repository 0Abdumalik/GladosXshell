#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[cfg(windows)]
mod app;
#[cfg(windows)]
mod flavor;
mod i18n;
#[cfg(windows)]
mod ops;
#[cfg(windows)]
mod system;

#[cfg(windows)]
fn main() {
    app::run()
}

#[cfg(not(windows))]
fn main() {
    i18n::set(i18n::system());
    eprintln!(
        "{}",
        tr!(
            "GladosXshell 安装程序只支持 Windows",
            "The GladosXshell installer runs only on Windows",
            "GladosXshell ئورناتقۇچى پەقەت Windows دىلا ئىشلەيدۇ"
        )
    );
}
