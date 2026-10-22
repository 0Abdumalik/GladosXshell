//! Reading the Windows registry (current user hive), for importers and shell detection.

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RegValue {
    Text(String),
    Number(u32),
}

#[cfg(windows)]
pub use imp::Key;

#[cfg(windows)]
mod imp {
    use std::collections::HashMap;
    use std::io;
    use std::ptr::{null, null_mut};

    use windows_sys::Win32::Foundation::{ERROR_FILE_NOT_FOUND, ERROR_MORE_DATA, ERROR_SUCCESS};
    use windows_sys::Win32::System::Registry::{
        HKEY, KEY_READ, REG_DWORD, REG_EXPAND_SZ, REG_SZ, RegCloseKey, RegEnumKeyExW, RegEnumValueW, RegOpenKeyExW,
    };

    use super::RegValue;

    pub struct Key(HKEY);

    impl Drop for Key {
        fn drop(&mut self) {
            // SAFETY: the handle came from RegOpenKeyExW and is closed once.
            unsafe { RegCloseKey(self.0) };
        }
    }

    fn wide(text: &str) -> Vec<u16> {
        text.encode_utf16().chain(Some(0)).collect()
    }

    impl Key {
        /// `None` when the key does not exist.
        pub fn open(parent: HKEY, path: &str) -> io::Result<Option<Self>> {
            let mut key: HKEY = null_mut();
            let path = wide(path);
            // SAFETY: `path` is NUL-terminated and outlives the call; `key` is a valid out pointer.
            let status = unsafe { RegOpenKeyExW(parent, path.as_ptr(), 0, KEY_READ, &mut key) };
            match status {
                ERROR_SUCCESS => Ok(Some(Self(key))),
                ERROR_FILE_NOT_FOUND => Ok(None),
                code => Err(io::Error::from_raw_os_error(code as i32)),
            }
        }

        pub fn handle(&self) -> HKEY {
            self.0
        }

        pub fn subkeys(&self) -> Vec<String> {
            let mut out = Vec::new();
            let mut name = [0u16; 256];
            for index in 0.. {
                let mut len = name.len() as u32;
                // SAFETY: `name` holds `len` UTF-16 units; the optional out pointers are null.
                let status = unsafe {
                    RegEnumKeyExW(self.0, index, name.as_mut_ptr(), &mut len, null(), null_mut(), null_mut(), null_mut())
                };
                if status != ERROR_SUCCESS {
                    break;
                }
                out.push(String::from_utf16_lossy(&name[..len as usize]));
            }
            out
        }

        /// Text and number values, keyed by lower-case name.
        pub fn values(&self) -> HashMap<String, RegValue> {
            let mut out = HashMap::new();
            let mut name = vec![0u16; 16384];
            let mut data = vec![0u8; 64 * 1024];
            for index in 0.. {
                let mut name_len = name.len() as u32;
                let mut data_len = data.len() as u32;
                let mut kind = 0u32;
                // SAFETY: both buffers are as long as the lengths passed in.
                let status = unsafe {
                    RegEnumValueW(
                        self.0,
                        index,
                        name.as_mut_ptr(),
                        &mut name_len,
                        null(),
                        &mut kind,
                        data.as_mut_ptr(),
                        &mut data_len,
                    )
                };
                if status == ERROR_MORE_DATA {
                    continue;
                }
                if status != ERROR_SUCCESS {
                    break;
                }
                let bytes = &data[..data_len as usize];
                let value = match kind {
                    REG_SZ | REG_EXPAND_SZ => {
                        let units: Vec<u16> = bytes.chunks_exact(2).map(|p| u16::from_le_bytes([p[0], p[1]])).collect();
                        let end = units.iter().position(|&u| u == 0).unwrap_or(units.len());
                        RegValue::Text(String::from_utf16_lossy(&units[..end]))
                    }
                    REG_DWORD if bytes.len() >= 4 => {
                        RegValue::Number(u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]))
                    }
                    _ => continue,
                };
                out.insert(String::from_utf16_lossy(&name[..name_len as usize]).to_lowercase(), value);
            }
            out
        }
    }
}
