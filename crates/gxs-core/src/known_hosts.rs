//! Host key trust store. Verification is mandatory: there is no accept-all mode, and a host whose
//! key differs from a stored one is always rejected regardless of policy.

use std::future::Future;
use std::path::{Path, PathBuf};
use std::pin::Pin;

use russh::keys::{HashAlg, PublicKey};
use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;

use crate::error::{Error, Result};
use crate::fsutil::{self, now_secs};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum HostKeyPolicy {
    /// Only hosts already in the store are accepted.
    Strict,
    /// Unknown hosts are trusted on first use and recorded.
    Tofu,
    /// Unknown hosts are shown to the user, who decides.
    Prompt,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KnownHost {
    pub host: String,
    pub port: u16,
    /// OpenSSH public key line without comment, e.g. `ssh-ed25519 AAAA...`.
    pub key: String,
    pub fingerprint: String,
    pub added_at: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UnknownHostKey {
    pub host: String,
    pub port: u16,
    pub algorithm: String,
    pub fingerprint: String,
}

pub trait HostKeyPrompter: Send + Sync {
    fn confirm(&self, key: UnknownHostKey) -> Pin<Box<dyn Future<Output = bool> + Send + '_>>;
}

#[derive(Serialize, Deserialize)]
struct StoreFile {
    version: u32,
    hosts: Vec<KnownHost>,
}

const STORE_VERSION: u32 = 1;

pub struct KnownHosts {
    path: PathBuf,
    hosts: Mutex<Vec<KnownHost>>,
}

pub fn fingerprint(key: &PublicKey) -> String {
    key.fingerprint(HashAlg::Sha256).to_string()
}

fn normalize_host(host: &str) -> String {
    host.trim()
        .trim_start_matches('[')
        .trim_end_matches(']')
        .to_ascii_lowercase()
}

fn openssh_line(key: &PublicKey) -> Result<String> {
    let mut key = key.clone();
    key.set_comment("");
    Ok(key.to_openssh().map_err(russh::keys::Error::from)?)
}

enum Lookup {
    Match,
    Mismatch(Vec<String>),
    Unknown,
}

fn lookup(hosts: &[KnownHost], host: &str, port: u16, key: &PublicKey) -> Lookup {
    let mut known = Vec::new();
    for entry in hosts.iter().filter(|e| e.host == host && e.port == port) {
        match PublicKey::from_openssh(&entry.key) {
            Ok(stored) if stored.key_data() == key.key_data() => return Lookup::Match,
            _ => known.push(entry.fingerprint.clone()),
        }
    }
    if known.is_empty() {
        Lookup::Unknown
    } else {
        Lookup::Mismatch(known)
    }
}

impl KnownHosts {
    /// A missing file is an empty store. A corrupt file is an error rather than an empty store,
    /// so damage can never silently downgrade verification to trust-on-first-use.
    pub async fn open(path: impl Into<PathBuf>) -> Result<Self> {
        let path = path.into();
        let hosts = match tokio::fs::read(&path).await {
            Ok(bytes) => {
                let file: StoreFile = serde_json::from_slice(&bytes).map_err(|e| Error::Store(e.to_string()))?;
                if file.version != STORE_VERSION {
                    return Err(Error::Store(format!("unsupported version {}", file.version)));
                }
                file.hosts
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Vec::new(),
            Err(e) => return Err(e.into()),
        };
        Ok(Self {
            path,
            hosts: Mutex::new(hosts),
        })
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub async fn list(&self) -> Vec<KnownHost> {
        self.hosts.lock().await.clone()
    }

    /// Forgets every key for `host:port` (e.g. after a verified key rotation). Returns how many
    /// entries were removed.
    pub async fn remove(&self, host: &str, port: u16) -> Result<usize> {
        let host = normalize_host(host);
        let mut hosts = self.hosts.lock().await;
        let mut next = hosts.clone();
        next.retain(|e| !(e.host == host && e.port == port));
        let removed = hosts.len() - next.len();
        if removed > 0 {
            persist(&self.path, &next).await?;
            *hosts = next;
        }
        Ok(removed)
    }

    pub async fn verify(
        &self,
        host: &str,
        port: u16,
        key: &PublicKey,
        policy: HostKeyPolicy,
        prompter: Option<&dyn HostKeyPrompter>,
    ) -> Result<()> {
        let host = normalize_host(host);
        let fp = fingerprint(key);
        let changed = |known| Error::HostKeyChanged {
            host: format!("{host}:{port}"),
            presented: fp.clone(),
            known,
        };
        let rejected = || Error::HostKeyRejected {
            host: format!("{host}:{port}"),
            fingerprint: fp.clone(),
        };

        match lookup(&self.hosts.lock().await, &host, port, key) {
            Lookup::Match => return Ok(()),
            Lookup::Mismatch(known) => return Err(changed(known)),
            Lookup::Unknown => {}
        }

        match policy {
            HostKeyPolicy::Strict => return Err(rejected()),
            HostKeyPolicy::Tofu => {}
            HostKeyPolicy::Prompt => {
                let Some(prompter) = prompter else {
                    return Err(rejected());
                };
                // The store lock is not held while the user decides.
                let accepted = prompter
                    .confirm(UnknownHostKey {
                        host: host.clone(),
                        port,
                        algorithm: key.algorithm().to_string(),
                        fingerprint: fp.clone(),
                    })
                    .await;
                if !accepted {
                    return Err(rejected());
                }
            }
        }

        let mut hosts = self.hosts.lock().await;
        // Another connection may have recorded a key for this host while we were prompting.
        match lookup(&hosts, &host, port, key) {
            Lookup::Match => return Ok(()),
            Lookup::Mismatch(known) => return Err(changed(known)),
            Lookup::Unknown => {}
        }
        let mut next = hosts.clone();
        next.push(KnownHost {
            host: host.clone(),
            port,
            key: openssh_line(key)?,
            fingerprint: fp.clone(),
            added_at: now_secs(),
        });
        persist(&self.path, &next).await?;
        *hosts = next;
        Ok(())
    }
}

/// What merging another machine's trusted keys did.
#[derive(Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostsMerge {
    pub added: usize,
    pub present: usize,
    /// A different key is already trusted for the host; the local record wins.
    pub conflicts: Vec<String>,
    pub invalid: usize,
}

impl KnownHosts {
    /// Adds keys for hosts that have none here. A host with a different key already trusted is
    /// reported, never overwritten, so an import can not silently replace a verified key.
    pub async fn merge(&self, entries: Vec<KnownHost>) -> Result<HostsMerge> {
        let mut report = HostsMerge::default();
        let mut hosts = self.hosts.lock().await;
        let mut next = hosts.clone();
        for entry in entries {
            let host = normalize_host(&entry.host);
            let parsed = PublicKey::from_openssh(entry.key.trim()).ok();
            let (Some(key), false, true) = (parsed, host.is_empty() || host.len() > 253, entry.port != 0) else {
                report.invalid += 1;
                continue;
            };
            match lookup(&next, &host, entry.port, &key) {
                Lookup::Match => report.present += 1,
                Lookup::Mismatch(_) => report.conflicts.push(format!("{host}:{}", entry.port)),
                Lookup::Unknown => {
                    next.push(KnownHost {
                        key: openssh_line(&key)?,
                        fingerprint: fingerprint(&key),
                        host,
                        port: entry.port,
                        added_at: entry.added_at.min(now_secs()),
                    });
                    report.added += 1;
                }
            }
        }
        if report.added > 0 {
            persist(&self.path, &next).await?;
            *hosts = next;
        }
        Ok(report)
    }
}

async fn persist(path: &Path, hosts: &[KnownHost]) -> Result<()> {
    let body = serde_json::to_vec_pretty(&StoreFile {
        version: STORE_VERSION,
        hosts: hosts.to_vec(),
    })
    .map_err(|e| Error::Store(e.to_string()))?;
    fsutil::write_atomic(path, body).await
}

#[cfg(test)]
mod tests {
    use russh::keys::{Algorithm, PrivateKey};

    use super::*;

    fn entry(host: &str, key: &PublicKey) -> KnownHost {
        KnownHost {
            host: host.into(),
            port: 22,
            key: key.to_openssh().unwrap(),
            fingerprint: "ignored".into(),
            added_at: 1,
        }
    }

    #[tokio::test]
    async fn merge_adds_unknown_hosts_and_keeps_local_keys() {
        let dir = tempfile::tempdir().unwrap();
        let store = KnownHosts::open(dir.path().join("kh.json")).await.unwrap();
        let mut rng = rand::rng();
        let a = PrivateKey::random(&mut rng, Algorithm::Ed25519).unwrap().public_key().clone();
        let b = PrivateKey::random(&mut rng, Algorithm::Ed25519).unwrap().public_key().clone();
        store.verify("one", 22, &a, HostKeyPolicy::Tofu, None).await.unwrap();

        let mut broken = entry("three", &a);
        broken.key = "ssh-ed25519 nope".into();
        let report = store
            .merge(vec![entry("ONE", &a), entry("[two]", &b), entry("one", &b), broken])
            .await
            .unwrap();
        assert_eq!(
            report,
            HostsMerge {
                added: 1,
                present: 1,
                conflicts: vec!["one:22".into()],
                invalid: 1,
            }
        );
        let listed = store.list().await;
        let two = listed.iter().find(|h| h.host == "two").unwrap();
        assert_eq!(two.fingerprint, fingerprint(&b));
        let reopened = KnownHosts::open(store.path()).await.unwrap();
        assert_eq!(reopened.list().await.len(), 2);
        assert!(store.verify("one", 22, &b, HostKeyPolicy::Tofu, None).await.is_err());
    }
}
