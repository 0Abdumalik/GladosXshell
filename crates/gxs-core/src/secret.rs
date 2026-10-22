//! Saved passwords and key passphrases. By default they are encrypted with Windows DPAPI in the
//! current-user scope, so only this user on this machine can decrypt them. With a master password
//! they are sealed with its derived key instead and stay unreadable until it is typed. Other
//! platforms refuse DPAPI storage rather than silently writing plaintext.

use std::sync::Arc;

use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use serde::{Deserialize, Serialize};
use zeroize::Zeroizing;

use crate::error::{Error, Result};
use crate::passphrase::MasterKey;

const MASTER_PREFIX: &str = "m1:";

/// How secrets are sealed right now.
#[derive(Clone)]
pub enum Vault {
    Dpapi,
    Master(Arc<MasterKey>),
    /// A master password is set but has not been typed in this run.
    Locked,
}

/// Base64 of a DPAPI blob, or `m1:` and a blob sealed with the master key. Deliberately has no `Display`/`Debug` that could leak into logs.
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct Sealed(String);

impl std::fmt::Debug for Sealed {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Sealed(..)")
    }
}

impl Sealed {
    pub fn seal(plain: &str, vault: &Vault) -> Result<Self> {
        match vault {
            Vault::Dpapi => Ok(Self(STANDARD.encode(imp::protect(plain.as_bytes())?))),
            Vault::Master(key) => Ok(Self(format!("{MASTER_PREFIX}{}", key.seal(plain.as_bytes())?))),
            Vault::Locked => Err(Error::Locked),
        }
    }

    /// DPAPI blobs open under any vault, so secrets saved before a master password was set
    /// still work; master blobs need the key.
    pub fn open(&self, vault: &Vault) -> Result<Zeroizing<String>> {
        let plain = match (self.0.strip_prefix(MASTER_PREFIX), vault) {
            (Some(blob), Vault::Master(key)) => key.open(blob)?,
            (Some(_), Vault::Locked) => return Err(Error::Locked),
            (Some(_), Vault::Dpapi) => {
                return Err(Error::Secret(crate::tr!(
                    "这条密码用主密码加密，但主密码已不存在",
                    "This password was encrypted with the master password, but there is no master password any more",
                    "بۇ ئىم ئاساسىي ئىم بىلەن شىفىرلانغان، بىراق ئاساسىي ئىم ئەمدى مەۋجۇت ئەمەس"
                ))
                .on("master"));
            }
            (None, _) => {
                let blob = STANDARD
                    .decode(&self.0)
                    .map_err(|e| Error::Secret(format!("corrupt secret: {e}")))?;
                imp::unprotect(&blob)?
            }
        };
        let text = std::str::from_utf8(&plain).map_err(|_| Error::Secret("secret is not UTF-8".into()))?;
        Ok(Zeroizing::new(text.to_owned()))
    }
}

/// Binds blobs to this application so another program running as the same user cannot decrypt
/// them just by calling DPAPI without knowing this value.
#[cfg(windows)]
const ENTROPY: &[u8] = b"GladosXshell/secret/v1";

#[cfg(windows)]
mod imp {
    use std::ptr::{null, null_mut};

    use windows_sys::Win32::Foundation::LocalFree;
    use windows_sys::Win32::Security::Cryptography::{
        CRYPT_INTEGER_BLOB, CRYPTPROTECT_UI_FORBIDDEN, CryptProtectData, CryptUnprotectData,
    };
    use zeroize::{Zeroize, Zeroizing};

    use super::ENTROPY;
    use crate::error::{Error, Result};

    fn blob(data: &[u8]) -> Result<CRYPT_INTEGER_BLOB> {
        Ok(CRYPT_INTEGER_BLOB {
            cbData: u32::try_from(data.len()).map_err(|_| Error::Secret("secret too large".into()))?,
            pbData: data.as_ptr().cast_mut(),
        })
    }

    /// Copies DPAPI's output and frees it, wiping it first when it held plaintext.
    fn take(out: CRYPT_INTEGER_BLOB, wipe: bool) -> Vec<u8> {
        if out.pbData.is_null() {
            return Vec::new();
        }
        // SAFETY: on success DPAPI returns a LocalAlloc'd buffer of `cbData` bytes that we own.
        unsafe {
            let slice = std::slice::from_raw_parts_mut(out.pbData, out.cbData as usize);
            let copy = slice.to_vec();
            if wipe {
                slice.zeroize();
            }
            LocalFree(out.pbData.cast());
            copy
        }
    }

    fn last_error(op: &str) -> Error {
        Error::Secret(format!("{op}: {}", std::io::Error::last_os_error()))
    }

    pub fn protect(plain: &[u8]) -> Result<Vec<u8>> {
        let input = blob(plain)?;
        let entropy = blob(ENTROPY)?;
        let mut out = CRYPT_INTEGER_BLOB {
            cbData: 0,
            pbData: null_mut(),
        };
        // SAFETY: all pointers reference live buffers for the duration of the call.
        let ok = unsafe {
            CryptProtectData(
                &input,
                null(),
                &entropy,
                null(),
                null(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut out,
            )
        };
        if ok == 0 {
            return Err(last_error("encrypt"));
        }
        Ok(take(out, false))
    }

    pub fn unprotect(sealed: &[u8]) -> Result<Zeroizing<Vec<u8>>> {
        let input = blob(sealed)?;
        let entropy = blob(ENTROPY)?;
        let mut out = CRYPT_INTEGER_BLOB {
            cbData: 0,
            pbData: null_mut(),
        };
        // SAFETY: as above; the description out-pointer is optional and passed as null.
        let ok = unsafe {
            CryptUnprotectData(
                &input,
                null_mut(),
                &entropy,
                null(),
                null(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut out,
            )
        };
        if ok == 0 {
            return Err(last_error("decrypt"));
        }
        Ok(Zeroizing::new(take(out, true)))
    }
}

#[cfg(not(windows))]
mod imp {
    use zeroize::Zeroizing;

    use crate::error::{Error, Result};

    pub fn protect(_: &[u8]) -> Result<Vec<u8>> {
        Err(Error::Unsupported("saving passwords on this platform".into()))
    }

    pub fn unprotect(_: &[u8]) -> Result<Zeroizing<Vec<u8>>> {
        Err(Error::Unsupported("saved passwords on this platform".into()))
    }
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;

    use crate::passphrase::{MasterLock, TEST_COST};

    #[test]
    fn seal_open_roundtrip_and_ciphertext_hides_plaintext() {
        let sealed = Sealed::seal("hunter2 密码", &Vault::Dpapi).unwrap();
        assert!(!sealed.0.contains("hunter2"));
        let raw = STANDARD.decode(&sealed.0).unwrap();
        assert!(!raw.windows(7).any(|w| w == b"hunter2"));
        assert_eq!(sealed.open(&Vault::Dpapi).unwrap().as_str(), "hunter2 密码");
        assert_eq!(sealed.open(&Vault::Locked).unwrap().as_str(), "hunter2 密码");
        assert_eq!(format!("{sealed:?}"), "Sealed(..)");
    }

    #[test]
    fn tampered_blob_fails_to_open() {
        let sealed = Sealed::seal("x", &Vault::Dpapi).unwrap();
        let mut raw = STANDARD.decode(&sealed.0).unwrap();
        let last = raw.len() - 1;
        raw[last] ^= 0xff;
        assert!(matches!(
            Sealed(STANDARD.encode(raw)).open(&Vault::Dpapi),
            Err(Error::Secret(_))
        ));
        assert!(matches!(
            Sealed("not base64!".into()).open(&Vault::Dpapi),
            Err(Error::Secret(_))
        ));
    }

    #[test]
    fn master_blobs_need_the_key() {
        let (_, key) = MasterLock::create("correct horse", TEST_COST).unwrap();
        let vault = Vault::Master(Arc::new(key));
        let sealed = Sealed::seal("hunter2", &vault).unwrap();
        assert!(sealed.0.starts_with(MASTER_PREFIX) && !sealed.0.contains("hunter2"));
        assert_eq!(sealed.open(&vault).unwrap().as_str(), "hunter2");
        assert!(matches!(sealed.open(&Vault::Locked), Err(Error::Locked)));
        assert!(sealed.open(&Vault::Dpapi).is_err());
        assert!(matches!(Sealed::seal("x", &Vault::Locked), Err(Error::Locked)));
    }
}
