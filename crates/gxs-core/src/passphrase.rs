//! Data locked with a password the user types: Argon2id derives the key, AES-256-GCM seals the
//! data. Unlike `secret::Sealed` this works on any machine that knows the password, so it is what
//! leaves the computer (exported configuration) or replaces DPAPI under a master password.

use argon2::{Algorithm, Argon2, Params, Version};
use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use ring::aead::{AES_256_GCM, Aad, LessSafeKey, NONCE_LEN, Nonce, UnboundKey};
use ring::rand::{SecureRandom, SystemRandom};
use serde::{Deserialize, Serialize};
use zeroize::Zeroizing;

use crate::error::{Error, Result};

const AAD: &[u8] = b"GladosXshell/locked/v1";
const MASTER_AAD: &[u8] = b"GladosXshell/master/v1";
const MASTER_CHECK: &[u8] = b"GladosXshell master password";
const SALT_LEN: usize = 16;
const KEY_LEN: usize = 32;
pub const MIN_PASSWORD_CHARS: usize = 8;
const MAX_PASSWORD_BYTES: usize = 1024;

/// Work factors stored with the data, so they can be raised later without breaking old files.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Cost {
    /// KiB of memory.
    pub memory: u32,
    pub passes: u32,
    pub lanes: u32,
}

impl Cost {
    pub const DEFAULT: Self = Self {
        memory: 64 * 1024,
        passes: 3,
        lanes: 1,
    };

    /// A file could otherwise ask for gigabytes of memory or minutes of work just by being opened.
    fn check(self) -> Result<Params> {
        let sane = (8 * 1024..=1024 * 1024).contains(&self.memory)
            && (1..=16).contains(&self.passes)
            && (1..=8).contains(&self.lanes);
        if !sane {
            return Err(Error::Data(crate::tr!(
                "加密参数超出范围，文件可能已损坏",
                "The encryption parameters are out of range; the file may be damaged",
                "شىفىرلاش پارامېتىرى دائىرىدىن ئېشىپ كەتتى، ھۆججەت بۇزۇلغان بولۇشى مۇمكىن"
            )));
        }
        Params::new(self.memory, self.passes, self.lanes, Some(KEY_LEN)).map_err(|e| {
            Error::Data(crate::tr!(
                "加密参数无效：{e}",
                "Invalid encryption parameters: {e}",
                "شىفىرلاش پارامېتىرى ئىناۋەتسىز: {e}"
            ))
        })
    }
}

#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Locked {
    pub kdf: String,
    pub cost: Cost,
    salt: String,
    nonce: String,
    data: String,
}

impl std::fmt::Debug for Locked {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Locked(..)")
    }
}

pub fn check_password(password: &str) -> Result<()> {
    if password.chars().count() < MIN_PASSWORD_CHARS {
        return Err(Error::invalid(crate::tr!(
            "密码至少 {MIN_PASSWORD_CHARS} 个字符",
            "The password must be at least {MIN_PASSWORD_CHARS} characters",
            "ئىم كەم دېگەندە {MIN_PASSWORD_CHARS} ھەرپ بولۇشى كېرەك"
        ))
        .on("password"));
    }
    if password.len() > MAX_PASSWORD_BYTES {
        return Err(Error::invalid(crate::tr!(
            "密码太长",
            "The password is too long",
            "ئىم بەك ئۇزۇن"
        ))
        .on("password"));
    }
    Ok(())
}

fn random<const N: usize>() -> Result<[u8; N]> {
    let mut out = [0; N];
    SystemRandom::new().fill(&mut out).map_err(|_| {
        Error::Secret(crate::tr!(
            "无法生成随机数",
            "Could not generate random numbers",
            "تاسادىپىي سان ھاسىل قىلالمىدى"
        ))
    })?;
    Ok(out)
}

fn encrypt_failed() -> Error {
    Error::Secret(crate::tr!("加密失败", "Encryption failed", "شىفىرلاش مەغلۇپ بولدى"))
}

fn unsupported_kdf(kdf: &str) -> Error {
    Error::Data(crate::tr!(
        "不支持的加密方式 {kdf}",
        "Unsupported encryption method {kdf}",
        "قوللىمايدىغان شىفىرلاش ئۇسۇلى {kdf}"
    ))
}

fn derive(password: &str, salt: &[u8], cost: Cost) -> Result<LessSafeKey> {
    let mut key = Zeroizing::new([0u8; KEY_LEN]);
    Argon2::new(Algorithm::Argon2id, Version::V0x13, cost.check()?)
        .hash_password_into(password.as_bytes(), salt, key.as_mut())
        .map_err(|e| {
            Error::Secret(crate::tr!(
                "密钥派生失败：{e}",
                "Key derivation failed: {e}",
                "ئاچقۇچ ھاسىل قىلىش مەغلۇپ بولدى: {e}"
            ))
        })?;
    let key = UnboundKey::new(&AES_256_GCM, key.as_ref())
        .map_err(|_| Error::Secret(crate::tr!("密钥无效", "The key is not valid", "ئاچقۇچ ئىناۋەتسىز")))?;
    Ok(LessSafeKey::new(key))
}

impl Locked {
    pub fn lock(password: &str, plain: &[u8]) -> Result<Self> {
        Self::lock_with(password, plain, Cost::DEFAULT)
    }

    pub fn lock_with(password: &str, plain: &[u8], cost: Cost) -> Result<Self> {
        check_password(password)?;
        let salt = random::<SALT_LEN>()?;
        let nonce = random::<NONCE_LEN>()?;
        let key = derive(password, &salt, cost)?;
        let mut data = plain.to_vec();
        key.seal_in_place_append_tag(Nonce::assume_unique_for_key(nonce), Aad::from(AAD), &mut data)
            .map_err(|_| encrypt_failed())?;
        Ok(Self {
            kdf: "argon2id".into(),
            cost,
            salt: STANDARD.encode(salt),
            nonce: STANDARD.encode(nonce),
            data: STANDARD.encode(data),
        })
    }

    pub fn unlock(&self, password: &str) -> Result<Zeroizing<Vec<u8>>> {
        let corrupt = || {
            Error::Data(crate::tr!(
                "加密内容已损坏",
                "The encrypted content is damaged",
                "شىفىرلانغان مەزمۇن بۇزۇلغان"
            ))
        };
        if self.kdf != "argon2id" {
            return Err(unsupported_kdf(&self.kdf));
        }
        let salt = STANDARD.decode(&self.salt).map_err(|_| corrupt())?;
        let nonce: [u8; NONCE_LEN] = STANDARD
            .decode(&self.nonce)
            .ok()
            .and_then(|n| n.try_into().ok())
            .ok_or_else(corrupt)?;
        let mut data = Zeroizing::new(STANDARD.decode(&self.data).map_err(|_| corrupt())?);
        if salt.len() != SALT_LEN {
            return Err(corrupt());
        }
        let key = derive(password, &salt, self.cost)?;
        let plain = key
            .open_in_place(Nonce::assume_unique_for_key(nonce), Aad::from(AAD), data.as_mut_slice())
            .map_err(|_| {
                Error::Data(crate::tr!(
                    "密码不对，或者内容已损坏",
                    "The password is wrong, or the content is damaged",
                    "ئىم خاتا، ياكى مەزمۇن بۇزۇلغان"
                ))
                .on("password")
            })?;
        Ok(Zeroizing::new(plain.to_vec()))
    }
}

/// Key derived from the master password. Each saved secret is sealed with it directly, so
/// unlocking costs one derivation however many servers there are.
pub struct MasterKey(LessSafeKey);

/// What the connection store keeps to check a master password and derive its key again.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MasterLock {
    pub kdf: String,
    pub cost: Cost,
    salt: String,
    /// A known value sealed with the key: opening it proves the password is right.
    check: String,
}

impl MasterLock {
    pub fn create(password: &str, cost: Cost) -> Result<(Self, MasterKey)> {
        check_password(password)?;
        let salt = random::<SALT_LEN>()?;
        let key = MasterKey(derive(password, &salt, cost)?);
        let check = key.seal(MASTER_CHECK)?;
        let lock = Self {
            kdf: "argon2id".into(),
            cost,
            salt: STANDARD.encode(salt),
            check,
        };
        Ok((lock, key))
    }

    pub fn unlock(&self, password: &str) -> Result<MasterKey> {
        if self.kdf != "argon2id" {
            return Err(unsupported_kdf(&self.kdf));
        }
        let salt = STANDARD
            .decode(&self.salt)
            .ok()
            .filter(|s| s.len() == SALT_LEN)
            .ok_or_else(|| {
                Error::Data(crate::tr!(
                    "主密码记录已损坏",
                    "The master password record is damaged",
                    "ئاساسىي ئىم خاتىرىسى بۇزۇلغان"
                ))
                .on("master")
            })?;
        let wrong = || {
            Error::invalid(crate::tr!(
                "主密码不对",
                "The master password is wrong",
                "ئاساسىي ئىم خاتا"
            ))
            .on("master")
        };
        if password.is_empty() || password.len() > MAX_PASSWORD_BYTES {
            return Err(wrong());
        }
        let key = MasterKey(derive(password, &salt, self.cost)?);
        match key.open(&self.check) {
            Ok(plain) if plain.as_slice() == MASTER_CHECK => Ok(key),
            _ => Err(wrong()),
        }
    }
}

impl MasterKey {
    /// Base64 of nonce followed by ciphertext and tag.
    pub fn seal(&self, plain: &[u8]) -> Result<String> {
        let nonce = random::<NONCE_LEN>()?;
        let mut data = plain.to_vec();
        self.0
            .seal_in_place_append_tag(Nonce::assume_unique_for_key(nonce), Aad::from(MASTER_AAD), &mut data)
            .map_err(|_| encrypt_failed())?;
        let mut out = nonce.to_vec();
        out.extend_from_slice(&data);
        Ok(STANDARD.encode(out))
    }

    pub fn open(&self, text: &str) -> Result<Zeroizing<Vec<u8>>> {
        let corrupt = || {
            Error::Secret(crate::tr!(
                "保存的密码已损坏",
                "The saved password is damaged",
                "ساقلانغان ئىم بۇزۇلغان"
            ))
        };
        let mut raw = Zeroizing::new(STANDARD.decode(text).map_err(|_| corrupt())?);
        if raw.len() < NONCE_LEN {
            return Err(corrupt());
        }
        let (nonce, data) = raw.split_at_mut(NONCE_LEN);
        let nonce: [u8; NONCE_LEN] = (&*nonce).try_into().map_err(|_| corrupt())?;
        let plain = self
            .0
            .open_in_place(Nonce::assume_unique_for_key(nonce), Aad::from(MASTER_AAD), data)
            .map_err(|_| corrupt())?;
        Ok(Zeroizing::new(plain.to_vec()))
    }
}

#[cfg(test)]
pub(crate) const TEST_COST: Cost = Cost {
    memory: 8 * 1024,
    passes: 1,
    lanes: 1,
};

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip_and_wrong_password() {
        let locked = Locked::lock_with("correct horse", b"hunter2 \xe5\xaf\x86", TEST_COST).unwrap();
        assert!(!locked.data.contains("hunter2"));
        assert_eq!(
            locked.unlock("correct horse").unwrap().as_slice(),
            b"hunter2 \xe5\xaf\x86"
        );
        let wrong = locked.unlock("wrong horse").unwrap_err();
        assert_eq!((wrong.kind(), wrong.field()), ("data", Some("password")));
        assert_eq!(format!("{locked:?}"), "Locked(..)");
    }

    #[test]
    fn master_lock_checks_the_password_and_seals_with_its_key() {
        let (lock, key) = MasterLock::create("correct horse", TEST_COST).unwrap();
        let sealed = key.seal(b"pa55").unwrap();
        assert_ne!(key.seal(b"pa55").unwrap(), sealed, "fresh nonce each time");
        let again = lock.unlock("correct horse").unwrap();
        assert_eq!(again.open(&sealed).unwrap().as_slice(), b"pa55");
        for password in ["wrong horse", ""] {
            let Err(wrong) = lock.unlock(password) else { panic!("{password:?} unlocked") };
            assert_eq!((wrong.kind(), wrong.field()), ("invalid", Some("master")));
        }
        let (_, other) = MasterLock::create("correct horse", TEST_COST).unwrap();
        assert!(other.open(&sealed).is_err(), "new salt, new key");
        assert!(MasterLock::create("short", TEST_COST).is_err());
        let json = serde_json::to_string(&lock).unwrap();
        assert_eq!(serde_json::from_str::<MasterLock>(&json).unwrap(), lock);
    }

    #[test]
    fn rejects_short_passwords_tampering_and_absurd_cost() {
        assert!(Locked::lock_with("short", b"x", TEST_COST).is_err());
        let locked = Locked::lock_with("long enough", b"x", TEST_COST).unwrap();
        let mut bad = locked.clone();
        bad.data = STANDARD.encode(b"0123456789abcdefg");
        assert!(bad.unlock("long enough").is_err());
        let mut greedy = locked.clone();
        greedy.cost.memory = u32::MAX;
        assert!(greedy.unlock("long enough").is_err());
        let json = serde_json::to_string(&locked).unwrap();
        let back: Locked = serde_json::from_str(&json).unwrap();
        assert_eq!(back.unlock("long enough").unwrap().as_slice(), b"x");
    }
}
