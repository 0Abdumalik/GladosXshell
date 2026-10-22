//! The tabs open at the last exit, so the next start can reopen them.
//!
//! Ad-hoc connections are kept without any password or passphrase: the types below have no field
//! for one, and reconnecting asks again.

use gxs_core::profiles::{Advanced, AuthMethod, Protocol, validate_host};
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::{AppState, Result};

const MAX_TABS: usize = 64;
const MAX_TEXT: usize = 300;

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SavedTabs {
    pub tabs: Vec<SavedTab>,
    /// Index into `tabs` of the tab that was in front.
    pub active: Option<usize>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedTab {
    #[serde(default)]
    pub font_size: Option<u8>,
    #[serde(flatten)]
    pub target: TabTarget,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum TabTarget {
    /// `shell` is a `local_shells` id; empty for the system default.
    Local { shell: String },
    Profile { profile_id: String },
    Adhoc {
        title: String,
        name: String,
        host: String,
        port: u16,
        method: AuthMethod,
        user: String,
        key_path: String,
        advanced: Box<Advanced>,
    },
}

fn plain_text(text: &str) -> bool {
    text.chars().count() <= MAX_TEXT && !text.chars().any(char::is_control)
}

impl SavedTab {
    fn valid(&self) -> bool {
        if self.font_size.is_some_and(|size| !(8..=40).contains(&size)) {
            return false;
        }
        match &self.target {
            TabTarget::Local { shell } => plain_text(shell),
            TabTarget::Profile { profile_id } => !profile_id.is_empty() && plain_text(profile_id),
            TabTarget::Adhoc {
                title,
                name,
                host,
                port,
                user,
                key_path,
                advanced,
                ..
            } => {
                let endpoint = match advanced.protocol {
                    Protocol::Serial => true,
                    Protocol::Telnet => *port != 0 && validate_host(host.trim()).is_ok(),
                    Protocol::Ssh => !user.trim().is_empty() && *port != 0 && validate_host(host.trim()).is_ok(),
                };
                [title, name, user, key_path].iter().all(|t| plain_text(t)) && endpoint && advanced.validate().is_ok()
            }
        }
    }
}

impl SavedTabs {
    /// Drops entries that could not be reopened and keeps `active` pointing at the same tab.
    pub fn normalize(mut self) -> Self {
        let active = self
            .active
            .filter(|&i| self.tabs.get(i).is_some_and(SavedTab::valid))
            .map(|i| self.tabs[..i].iter().filter(|t| t.valid()).count());
        self.tabs.retain(SavedTab::valid);
        self.tabs.truncate(MAX_TABS);
        self.active = active.filter(|&i| i < self.tabs.len());
        self
    }
}

#[tauri::command]
pub async fn tabs_get(state: State<'_, AppState>) -> Result<SavedTabs> {
    Ok(state.tabs.get().await?.normalize())
}

#[tauri::command]
pub async fn tabs_save(state: State<'_, AppState>, tabs: SavedTabs) -> Result<()> {
    let tabs = tabs.normalize();
    state
        .tabs
        .update(|current| {
            *current = tabs;
            Ok(())
        })
        .await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn local(shell: &str) -> SavedTab {
        SavedTab {
            font_size: None,
            target: TabTarget::Local { shell: shell.into() },
        }
    }

    #[test]
    fn reads_the_frontend_shape_and_ignores_secrets() {
        let json = r#"{"tabs":[
            {"kind":"local","shell":"pwsh","fontSize":18},
            {"kind":"profile","profileId":"abc"},
            {"kind":"adhoc","title":"t","name":"","host":"10.0.0.1","port":22,"method":"password",
             "user":"root","keyPath":"","advanced":{},"secret":"hunter2"}
        ],"active":2}"#;
        let tabs: SavedTabs = serde_json::from_str(json).unwrap();
        let tabs = tabs.normalize();
        assert_eq!(tabs.tabs.len(), 3);
        assert_eq!(tabs.active, Some(2));
        assert_eq!(tabs.tabs[0].font_size, Some(18));
        let back = serde_json::to_string(&tabs).unwrap();
        assert!(!back.contains("hunter2"));
        assert!(back.contains(r#""profileId":"abc""#));
    }

    #[test]
    fn serial_tabs_need_no_host_or_user() {
        let json = r#"{"tabs":[
            {"kind":"adhoc","title":"COM3","name":"","host":"","port":0,"method":"password",
             "user":"","keyPath":"","advanced":{"protocol":"serial","serial":{"port":"COM3"}}},
            {"kind":"adhoc","title":"sw","name":"","host":"10.0.0.2","port":23,"method":"password",
             "user":"","keyPath":"","advanced":{"protocol":"telnet"}},
            {"kind":"adhoc","title":"x","name":"","host":"10.0.0.2","port":22,"method":"password",
             "user":"","keyPath":"","advanced":{}}
        ],"active":null}"#;
        let tabs: SavedTabs = serde_json::from_str(json).unwrap();
        assert_eq!(tabs.normalize().tabs.len(), 2, "an SSH tab still needs a user");
    }

    #[test]
    fn drops_invalid_entries_and_follows_the_active_tab() {
        let bad_font = SavedTab {
            font_size: Some(99),
            ..local("cmd")
        };
        let bad_host = SavedTab {
            font_size: None,
            target: TabTarget::Adhoc {
                title: "x".into(),
                name: String::new(),
                host: "bad host".into(),
                port: 22,
                method: AuthMethod::Password,
                user: "root".into(),
                key_path: String::new(),
                advanced: Box::default(),
            },
        };
        let tabs = SavedTabs {
            tabs: vec![bad_font, local("cmd"), bad_host, local("a\u{7}")],
            active: Some(1),
        }
        .normalize();
        assert_eq!(tabs.tabs, vec![local("cmd")]);
        assert_eq!(tabs.active, Some(0));

        let tabs = SavedTabs {
            tabs: vec![local("cmd")],
            active: Some(5),
        }
        .normalize();
        assert_eq!(tabs.active, None);

        let tabs = SavedTabs {
            tabs: vec![local("cmd"), local("x\u{7}"), local("cmd")],
            active: Some(2),
        }
        .normalize();
        assert_eq!(tabs.active, Some(1));
    }
}
