//! Decrypts the passwords FinalShell keeps in its connection files, so an import can carry them
//! over. The scheme was worked out by FinalShellDePsd: https://github.com/WishMelz/FinalShellDePsd
//!
//! A saved password is base64 of an 8-byte header followed by DES/ECB/PKCS#5 ciphertext. The DES
//! key is the first half of an MD5 over values drawn from `java.util.Random` seeded from the
//! header, so the generator is reproduced here bit for bit.

use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use des::Des;
use des::cipher::{Block, BlockCipherDecrypt, KeyInit};
use zeroize::{Zeroize, Zeroizing};

use crate::error::{Error, Result};

const HEADER: usize = 8;
const BLOCK: usize = 8;
/// Longer blobs are not something FinalShell writes for a password.
const MAX_BLOB: usize = 4096;

/// `java.util.Random`, which FinalShell derives its key with.
struct JavaRandom(u64);

impl JavaRandom {
    const MULTIPLIER: u64 = 0x5_DEEC_E66D;
    const MASK: u64 = (1 << 48) - 1;

    fn new(seed: i64) -> Self {
        Self((seed as u64 ^ Self::MULTIPLIER) & Self::MASK)
    }

    fn next(&mut self, bits: u32) -> i32 {
        self.0 = self.0.wrapping_mul(Self::MULTIPLIER).wrapping_add(0xB) & Self::MASK;
        (self.0 >> (48 - bits)) as u32 as i32
    }

    /// Only the non-power-of-two branch is needed: FinalShell always asks for `nextInt(127)`.
    fn next_int(&mut self, bound: i32) -> i32 {
        loop {
            let bits = self.next(31);
            let value = bits % bound;
            if bits.wrapping_sub(value).wrapping_add(bound - 1) >= 0 {
                return value;
            }
        }
    }

    fn next_long(&mut self) -> i64 {
        let high = i64::from(self.next(32)) << 32;
        high.wrapping_add(i64::from(self.next(32)))
    }
}

/// The seed picked by header byte 5; `None` where FinalShell itself would divide by zero.
fn seed(head5: i64) -> Option<i64> {
    let divisor = JavaRandom::new(head5).next_int(127);
    (divisor != 0).then(|| 3_680_984_568_597_093_857 / i64::from(divisor))
}

/// The three generated values mixed into the key, after skipping `head0` draws.
fn draws(head0: i64, seed: i64) -> [i64; 3] {
    let mut random = JavaRandom::new(seed);
    for _ in 0..head0.max(0) {
        random.next_long();
    }
    let mut second = JavaRandom::new(random.next_long());
    let (a, b) = (second.next_long(), second.next_long());
    [a, b, random.next_long()]
}

/// Header bytes are Java `byte`s, so they widen with their sign.
fn key(head: &[u8; HEADER]) -> Result<[u8; BLOCK]> {
    let b = |i: usize| i64::from(head[i] as i8);
    let seed = seed(b(5)).ok_or_else(|| {
        Error::Data(crate::tr!(
            "FinalShell 密码格式无法识别",
            "The FinalShell password format is not recognized",
            "FinalShell ئىم فورماتىنى تونۇغىلى بولمىدى"
        ))
    })?;
    let [d0, d1, d2] = draws(b(0), seed);
    let values = [b(4), d0, b(7), b(3), d1, b(1), d2, b(2)];
    let mut data = Zeroizing::new(Vec::with_capacity(values.len() * 8));
    for value in values {
        data.extend_from_slice(&value.to_be_bytes());
    }
    let mut digest = md5::compute(&*data).0;
    let mut out = [0u8; BLOCK];
    out.copy_from_slice(&digest[..BLOCK]);
    digest.zeroize();
    Ok(out)
}

/// The plain password, or an error that never quotes the input.
pub fn decrypt(saved: &str) -> Result<Zeroizing<String>> {
    let unreadable = || {
        Error::Data(crate::tr!(
            "FinalShell 保存的密码无法解密",
            "The password saved by FinalShell cannot be decrypted",
            "FinalShell ساقلىغان ئىمنى يەشكىلى بولمىدى"
        ))
    };
    let saved = saved.trim();
    if saved.is_empty() || saved.len() > MAX_BLOB {
        return Err(unreadable());
    }
    let raw = Zeroizing::new(STANDARD.decode(saved).map_err(|_| unreadable())?);
    if raw.len() <= HEADER || !(raw.len() - HEADER).is_multiple_of(BLOCK) {
        return Err(unreadable());
    }
    let mut head = [0u8; HEADER];
    head.copy_from_slice(&raw[..HEADER]);
    let mut key = key(&head)?;
    let cipher = Des::new_from_slice(&key).map_err(|_| unreadable());
    key.zeroize();
    let cipher = cipher?;
    let mut plain = Zeroizing::new(raw[HEADER..].to_vec());
    for chunk in plain.chunks_exact_mut(BLOCK) {
        let block: &mut Block<Des> = chunk.try_into().map_err(|_| unreadable())?;
        cipher.decrypt_block(block);
    }
    let pad = usize::from(*plain.last().ok_or_else(unreadable)?);
    if pad == 0 || pad > BLOCK || !plain[plain.len() - pad..].iter().all(|&b| usize::from(b) == pad) {
        return Err(unreadable());
    }
    let len = plain.len() - pad;
    let text = std::str::from_utf8(&plain[..len]).map_err(|_| unreadable())?;
    Ok(Zeroizing::new(text.to_owned()))
}

#[cfg(test)]
mod tests {
    use des::cipher::BlockCipherEncrypt;

    use super::*;

    /// FinalShell's side: header bytes drawn below 127, then DES/ECB/PKCS#5 under the derived key.
    fn encrypt(head: [u8; HEADER], plain: &str) -> String {
        let cipher = Des::new_from_slice(&key(&head).unwrap()).unwrap();
        let mut data = plain.as_bytes().to_vec();
        let pad = BLOCK - data.len() % BLOCK;
        data.extend(std::iter::repeat_n(pad as u8, pad));
        for chunk in data.chunks_exact_mut(BLOCK) {
            let block: &mut Block<Des> = chunk.try_into().unwrap();
            cipher.encrypt_block(block);
        }
        STANDARD.encode([head.as_slice(), &data].concat())
    }

    #[test]
    fn java_random_matches_the_jdk() {
        // new Random(42): nextInt() and nextLong() as printed by a JDK.
        let mut r = JavaRandom::new(42);
        assert_eq!(r.next(32), -1_170_105_035);
        let mut r = JavaRandom::new(42);
        assert_eq!(r.next_long(), -5_025_562_857_975_149_833);
    }

    /// Values from FinalShellDePsd's precomputed tables.
    #[test]
    fn derivation_matches_the_reference_tables() {
        assert_eq!(seed(0), Some(153_374_357_024_878_910));
        assert_eq!(seed(3), Some(30_674_871_404_975_782));
        assert_eq!(seed(5), Some(75_122_134_053_001_915));
        assert_eq!(seed(52), None);
        assert_eq!(seed(103), None);
        assert_eq!(
            draws(100, 30_674_871_404_975_782),
            [1_010_697_528_151_415_885, 6_167_696_842_041_099_374, 2_581_066_632_675_006_400]
        );
        assert_eq!(
            draws(126, 153_374_357_024_878_910),
            [-7_446_390_801_832_404_841, -4_530_697_593_818_497_478, -4_921_786_579_790_481_596]
        );
    }

    /// Made with FinalShellDePsd's own decrypt() on blobs this module's encrypt() produced.
    #[test]
    fn decrypts_blobs_the_reference_tool_accepts() {
        for (blob, plain) in VECTORS {
            assert_eq!(decrypt(blob).unwrap().as_str(), *plain);
        }
    }

    #[test]
    fn round_trips_any_header() {
        for seed in 0..64u8 {
            let head = [seed, 3, 120, seed / 2, 9, seed.wrapping_mul(7) % 127, 64, 126];
            if super::seed(i64::from(head[5])).is_none() {
                continue;
            }
            let blob = encrypt(head, "示例-pass word 123");
            assert_eq!(decrypt(&blob).unwrap().as_str(), "示例-pass word 123");
        }
    }

    #[test]
    fn rejects_garbage_without_echoing_it() {
        for bad in ["", "not base64!", "AAAA", &STANDARD.encode([1u8; 12]), &STANDARD.encode([5u8; 24])] {
            let error = decrypt(bad).unwrap_err().to_string();
            assert!(bad.is_empty() || !error.contains(bad), "{error}");
        }
    }

    const VECTORS: &[(&str, &str)] = &[
        ("AAECAwQFBgdVhfeyWBLXUA==", "a"),
        ("fgN4PwkAQH6CN02TbeM9ipzD7q8hXkgN69i5nGeaAtY=", "示例-pass word 123"),
        ("ZDIZA00DC2MH4GUdAJaMl/BGrW/K50wB", "exactly8"),
        ("EVgBbSp+BTybM0qeqYTHfAFXJ9gsh7X0bFXlRF/LK6S16ObeFI0K2w==", "p@ss:w0rd/with\\symbols\"'"),
    ];
}
