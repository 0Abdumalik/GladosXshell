//! Saved connections in the shape they take inside an exported configuration file.
//! Secrets travel separately and only in plaintext form between unlocking and resealing.

use std::collections::{BTreeMap, HashMap};

use serde::{Deserialize, Serialize};
use zeroize::Zeroizing;

use super::{
    Advanced, AuthInput, AuthMethod, Group, ImportFailure, ProfileStore, SecretUpdate, ServerInput, StoredAuth,
    StoredServer, new_id, validate_group_name, validate_input,
};
use crate::error::Result;
use crate::secret::{Sealed, Vault};

pub const MAX_PORTABLE_SERVERS: usize = 5000;
const MAX_PORTABLE_GROUPS: usize = 500;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PortableServer {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub group_id: Option<String>,
    pub host: String,
    pub port: u16,
    #[serde(default)]
    pub note: String,
    pub method: AuthMethod,
    pub user: String,
    #[serde(default)]
    pub key_path: String,
    #[serde(default)]
    pub advanced: Advanced,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct PortableProfiles {
    pub groups: Vec<Group>,
    pub servers: Vec<PortableServer>,
}

#[derive(Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct PortableSecret {
    pub secret: Option<Zeroizing<String>>,
    pub proxy_secret: Option<Zeroizing<String>>,
}

/// Keyed by `PortableServer::id`.
pub type PortableSecrets = BTreeMap<String, PortableSecret>;

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MergeReport {
    pub added: usize,
    /// Already saved here (same id, or same name, address and user); left untouched.
    pub skipped: usize,
    pub failed: Vec<ImportFailure>,
    /// Added servers that came with a password, passphrase or proxy password.
    pub with_secrets: usize,
}

impl StoredServer {
    fn portable(&self) -> PortableServer {
        PortableServer {
            id: self.id.clone(),
            name: self.name.clone(),
            group_id: self.group_id.clone(),
            host: self.host.clone(),
            port: self.port,
            note: self.note.clone(),
            method: self.auth.method,
            user: self.auth.user.clone(),
            key_path: self.auth.key_path.clone(),
            advanced: self.advanced.clone(),
        }
    }

    fn same_target(&self, other: &PortableServer) -> bool {
        self.name == other.name.trim()
            && self.host.eq_ignore_ascii_case(other.host.trim())
            && self.port == other.port
            && self.auth.user == other.user.trim()
    }
}

fn as_input(server: &PortableServer) -> ServerInput {
    let mut advanced = server.advanced.clone();
    advanced.jump_id = None;
    ServerInput {
        id: None,
        name: server.name.clone(),
        group_id: None,
        host: server.host.clone(),
        port: server.port,
        note: server.note.clone(),
        auth: AuthInput {
            method: server.method,
            user: server.user.clone(),
            key_path: server.key_path.clone(),
            secret: SecretUpdate::Keep,
        },
        advanced,
        proxy_secret: SecretUpdate::Keep,
    }
}

fn seal(value: Option<&Zeroizing<String>>, vault: &Vault) -> Result<Option<Sealed>> {
    value
        .filter(|v| !v.is_empty())
        .map(|v| Sealed::seal(v, vault))
        .transpose()
}

impl ProfileStore {
    /// Every group and server; with `secrets`, their passwords decrypted for re-locking.
    pub async fn export(&self, secrets: bool) -> Result<(PortableProfiles, PortableSecrets)> {
        let (data, vault) = {
            let data = self.data.lock().await;
            (data.clone(), self.vault(&data))
        };
        let mut opened = PortableSecrets::new();
        if secrets {
            for server in &data.servers {
                let entry = PortableSecret {
                    secret: server.auth.secret.as_ref().map(|s| s.open(&vault)).transpose()?,
                    proxy_secret: server.proxy_secret.as_ref().map(|s| s.open(&vault)).transpose()?,
                };
                if entry.secret.is_some() || entry.proxy_secret.is_some() {
                    opened.insert(server.id.clone(), entry);
                }
            }
        }
        let profiles = PortableProfiles {
            groups: data.groups,
            servers: data.servers.iter().map(StoredServer::portable).collect(),
        };
        Ok((profiles, opened))
    }

    /// Adds what is not here yet. Groups match by id, then by name; jump servers are rewired to
    /// whichever copy of the target ends up saved.
    pub async fn merge(&self, incoming: PortableProfiles, secrets: PortableSecrets) -> Result<MergeReport> {
        self.mutate(move |data| {
            let vault = self.vault(data);
            let mut sealed: HashMap<String, (Option<Sealed>, Option<Sealed>)> = HashMap::new();
            for (id, entry) in &secrets {
                sealed.insert(
                    id.clone(),
                    (
                        seal(entry.secret.as_ref(), &vault)?,
                        seal(entry.proxy_secret.as_ref(), &vault)?,
                    ),
                );
            }
            drop(secrets);
            let mut report = MergeReport::default();
            let mut group_ids: HashMap<String, String> = HashMap::new();
            for group in incoming.groups.iter().take(MAX_PORTABLE_GROUPS) {
                let Ok(name) = validate_group_name(&group.name) else {
                    continue;
                };
                let id = if let Some(same) = data.groups.iter().find(|g| g.id == group.id || g.name == name) {
                    same.id.clone()
                } else {
                    let id = if group.id.is_empty() || group.id.len() > 64 {
                        new_id(|id| data.groups.iter().any(|g| g.id == id))
                    } else {
                        group.id.clone()
                    };
                    data.groups.push(Group { id: id.clone(), name });
                    id
                };
                group_ids.insert(group.id.clone(), id);
            }

            // Exported id -> id of the server that represents it here.
            let mut server_ids: HashMap<String, String> = HashMap::new();
            let mut added = Vec::new();
            for server in incoming.servers.iter().take(MAX_PORTABLE_SERVERS) {
                if let Some(same) = data.servers.iter().find(|s| s.id == server.id || s.same_target(server)) {
                    server_ids.insert(server.id.clone(), same.id.clone());
                    report.skipped += 1;
                    continue;
                }
                let input = as_input(server);
                if let Err(error) = validate_input(&input, &data.groups, &data.servers) {
                    report.failed.push(ImportFailure {
                        name: server.name.clone(),
                        reason: error.to_string(),
                    });
                    continue;
                }
                let id = if server.id.is_empty() || server.id.len() > 64 {
                    new_id(|id| data.servers.iter().any(|s| s.id == id))
                } else {
                    server.id.clone()
                };
                let (secret, proxy_secret) = sealed.remove(&server.id).unwrap_or_default();
                let secret = secret.filter(|_| input.auth.method.keeps_secret());
                let proxy_secret = proxy_secret
                    .filter(|_| input.advanced.proxy.enabled() && !input.advanced.proxy.user.trim().is_empty());
                if secret.is_some() || proxy_secret.is_some() {
                    report.with_secrets += 1;
                }
                let host = input.host.trim().to_owned();
                let mut advanced = input.advanced;
                advanced.proxy.host = advanced.proxy.host.trim().to_owned();
                advanced.proxy.user = advanced.proxy.user.trim().to_owned();
                data.servers.push(StoredServer {
                    id: id.clone(),
                    name: match input.name.trim() {
                        "" => host.clone(),
                        name => name.to_owned(),
                    },
                    group_id: server.group_id.as_ref().and_then(|g| group_ids.get(g)).cloned(),
                    host,
                    port: input.port,
                    note: input.note,
                    auth: StoredAuth {
                        method: input.auth.method,
                        user: input.auth.user.trim().to_owned(),
                        key_path: input.auth.key_path.trim().to_owned(),
                        secret,
                    },
                    advanced,
                    proxy_secret,
                    last_connected_at: None,
                });
                server_ids.insert(server.id.clone(), id.clone());
                added.push((id, server.advanced.jump_id.clone()));
                report.added += 1;
            }

            for (id, jump) in added {
                let Some(jump) = jump.and_then(|j| server_ids.get(&j).cloned()) else {
                    continue;
                };
                if jump == id {
                    continue;
                }
                if let Some(server) = data.servers.iter_mut().find(|s| s.id == id)
                    && !server.advanced.proxy.enabled()
                {
                    server.advanced.jump_id = Some(jump);
                }
            }
            Ok(report)
        })
        .await
    }
}

#[cfg(test)]
mod tests {
    use super::super::ProxySettings;
    use super::*;
    use crate::transport::ProxyKind;

    async fn store() -> (tempfile::TempDir, ProfileStore) {
        let dir = tempfile::tempdir().unwrap();
        let store = ProfileStore::open(dir.path().join("connections.json")).await.unwrap();
        (dir, store)
    }

    fn server(id: &str, name: &str, group: Option<&str>, jump: Option<&str>) -> PortableServer {
        PortableServer {
            id: id.into(),
            name: name.into(),
            group_id: group.map(str::to_owned),
            host: "10.0.0.1".into(),
            port: 22,
            note: String::new(),
            method: AuthMethod::Password,
            user: "root".into(),
            key_path: String::new(),
            advanced: Advanced {
                jump_id: jump.map(str::to_owned),
                ..Advanced::default()
            },
        }
    }

    #[tokio::test]
    async fn merge_adds_new_skips_known_and_rewires_jumps() {
        let (_dir, store) = store().await;
        let here = store.save_group(None, "生产").await.unwrap();
        let mut existing = as_input(&server("", "bastion", None, None));
        existing.group_id = Some(here.id.clone());
        let existing = store.save_server(existing).await.unwrap();

        let mut bad = server("s4", "bad", None, None);
        bad.user.clear();
        let mut proxied = server("s5", "proxied", None, Some("s1"));
        proxied.advanced.proxy = ProxySettings {
            kind: ProxyKind::Socks5,
            host: "p".into(),
            port: 1080,
            user: String::new(),
        };
        let incoming = PortableProfiles {
            groups: vec![
                Group {
                    id: "g1".into(),
                    name: "生产".into(),
                },
                Group {
                    id: "g2".into(),
                    name: "测试".into(),
                },
            ],
            servers: vec![
                server("s1", "bastion", Some("g1"), None),
                server("s2", "web", Some("g2"), Some("s1")),
                server("s3", "db", Some("gone"), Some("s2")),
                bad,
                proxied,
            ],
        };
        let report = store.merge(incoming.clone(), PortableSecrets::new()).await.unwrap();
        assert_eq!((report.added, report.skipped, report.failed.len()), (3, 1, 1));
        let listed = store.list().await;
        let by_name = |name: &str| listed.servers.iter().find(|s| s.name == name).unwrap();
        assert_eq!(listed.groups.len(), 2);
        assert_eq!(by_name("web").group_id.as_deref(), Some("g2"));
        assert_eq!(by_name("db").group_id, None);
        assert_eq!(by_name("web").advanced.jump_id.as_ref(), Some(&existing.id));
        assert_eq!(by_name("db").advanced.jump_id.as_deref(), Some("s2"));
        assert_eq!(by_name("proxied").advanced.jump_id, None);

        let again = store.merge(incoming, PortableSecrets::new()).await.unwrap();
        assert_eq!((again.added, again.skipped), (0, 4));
    }

    #[tokio::test]
    async fn export_leaves_secrets_out_unless_asked() {
        let (_dir, store) = store().await;
        store.save_server(as_input(&server("", "a", None, None))).await.unwrap();
        let (profiles, secrets) = store.export(false).await.unwrap();
        assert_eq!(profiles.servers.len(), 1);
        assert!(secrets.is_empty());
        let json = serde_json::to_string(&profiles).unwrap();
        assert!(!json.contains("secret"));
    }

    #[cfg(windows)]
    #[tokio::test]
    async fn secrets_survive_export_and_merge() {
        let (_dir, source) = store().await;
        let mut input = as_input(&server("", "a", None, None));
        input.auth.secret = SecretUpdate::Set {
            value: Zeroizing::new("hunter2".into()),
        };
        let saved = source.save_server(input).await.unwrap();
        let (profiles, secrets) = source.export(true).await.unwrap();
        assert_eq!(
            secrets[&saved.id].secret.as_deref().map(String::as_str),
            Some("hunter2")
        );

        let (_dir2, target) = store().await;
        let report = target.merge(profiles, secrets).await.unwrap();
        assert_eq!((report.added, report.with_secrets), (1, 1));
        let resolved = target.resolve(&saved.id).await.unwrap();
        assert_eq!(resolved.secret.as_deref().map(String::as_str), Some("hunter2"));
    }
}
