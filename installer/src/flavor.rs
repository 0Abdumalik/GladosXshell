pub struct Flavor {
    pub product: &'static str,
    /// Same as the app's Tauri identifier, so data folders and the uninstall entry line up.
    pub identifier: &'static str,
    pub channel: &'static str,
    /// The app's data folder under the user profile; see src-tauri/src/datadir.rs.
    pub data_folder: &'static str,
}

#[cfg_attr(gxs_debug, allow(dead_code))]
pub const RELEASE: Flavor = Flavor {
    product: "GladosXshell",
    identifier: "com.gladosx.shell",
    channel: "release",
    data_folder: ".gladosxshell",
};

#[cfg_attr(not(gxs_debug), allow(dead_code))]
pub const DEBUG: Flavor = Flavor {
    product: "GladosXshell Debug",
    identifier: "com.gladosx.shell.debug",
    channel: "debug",
    data_folder: ".gladosxshell-debug",
};

#[cfg(gxs_debug)]
pub const FLAVOR: Flavor = DEBUG;
#[cfg(not(gxs_debug))]
pub const FLAVOR: Flavor = RELEASE;

pub const EXE: &str = "GladosXshell.exe";
pub const UNINSTALLER: &str = "uninstall.exe";
pub const VERSION: &str = env!("CARGO_PKG_VERSION");
pub const PUBLISHER: &str = "malik";
pub const EMAIL: &str = "malik6@qq.com";

#[cfg(test)]
mod tests {
    use super::*;

    fn config(name: &str) -> serde_json::Value {
        let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../src-tauri/");
        serde_json::from_str(&std::fs::read_to_string(format!("{path}{name}")).unwrap()).unwrap()
    }

    #[test]
    fn flavors_match_the_app_configs() {
        let release = config("tauri.conf.json");
        assert_eq!(release["productName"], RELEASE.product);
        assert_eq!(release["identifier"], RELEASE.identifier);
        let debug = config("tauri.debug.conf.json");
        assert_eq!(debug["productName"], DEBUG.product);
        assert_eq!(debug["identifier"], DEBUG.identifier);
    }
}
