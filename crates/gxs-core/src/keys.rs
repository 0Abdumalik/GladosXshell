//! SSH key pairs: generating them, reading the formats other tools save, and the remote command
//! that installs a public key in `~/.ssh/authorized_keys`.

use russh::keys::decode_secret_key;
use russh::keys::ssh_key::private::{KeypairData, RsaKeypair};
use russh::keys::ssh_key::{self, Algorithm, EcdsaCurve, HashAlg, LineEnding, PrivateKey, PublicKey};
use serde::Serialize;
use zeroize::Zeroizing;

use crate::{Error, Result};

const MAX_COMMENT: usize = 200;
const MAX_PASSPHRASE: usize = 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum KeyType {
    Ed25519,
    Rsa(usize),
    Ecdsa(EcdsaCurve),
}

impl KeyType {
    pub fn parse(name: &str, bits: Option<u32>) -> Result<Self> {
        match (name, bits) {
            ("ed25519", _) => Ok(KeyType::Ed25519),
            ("rsa", None | Some(3072)) => Ok(KeyType::Rsa(3072)),
            ("rsa", Some(4096)) => Ok(KeyType::Rsa(4096)),
            ("ecdsa", None | Some(256)) => Ok(KeyType::Ecdsa(EcdsaCurve::NistP256)),
            ("ecdsa", Some(384)) => Ok(KeyType::Ecdsa(EcdsaCurve::NistP384)),
            ("ecdsa", Some(521)) => Ok(KeyType::Ecdsa(EcdsaCurve::NistP521)),
            ("rsa" | "ecdsa", Some(bits)) => Err(Error::invalid(crate::tr!(
                "{name} 不支持 {bits} 位",
                "{name} does not support {bits} bits",
                "{name} {bits} بىتنى قوللىمايدۇ"
            ))),
            _ => Err(Error::invalid(crate::tr!(
                "不支持的密钥类型：{name}",
                "Unsupported key type: {name}",
                "قوللىمايدىغان ئاچقۇچ تۈرى: {name}"
            ))),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KeyInfo {
    /// The OpenSSH name, e.g. `ssh-ed25519`.
    pub algorithm: String,
    pub bits: Option<u32>,
    /// `SHA256:…`, as `ssh-keygen -l` prints it.
    pub fingerprint: String,
    pub comment: String,
    pub encrypted: bool,
    /// One `authorized_keys` line.
    pub public: String,
}

fn key_error(e: ssh_key::Error) -> Error {
    Error::Key(e.into())
}

fn check_comment(comment: &str) -> Result<&str> {
    let comment = comment.trim();
    if comment.chars().count() > MAX_COMMENT || comment.chars().any(char::is_control) {
        return Err(Error::invalid(crate::tr!(
            "备注不能超过 200 个字符，也不能包含换行",
            "The comment cannot be longer than 200 characters or contain line breaks",
            "ئىزاھات 200 ھەرپتىن ئېشىپ كەتمەسلىكى ۋە قۇر ئالماشتۇرۇشنى ئۆز ئىچىگە ئالماسلىقى كېرەك"
        )));
    }
    Ok(comment)
}

fn passphrase(value: Option<&str>) -> Result<Option<&str>> {
    match value {
        Some(p) if p.len() > MAX_PASSPHRASE => Err(Error::invalid(crate::tr!(
            "口令太长",
            "The passphrase is too long",
            "ئىم ئىبارىسى بەك ئۇزۇن"
        ))
        .on("passphrase")),
        Some(p) if !p.is_empty() => Ok(Some(p)),
        _ => Ok(None),
    }
}

fn bits(public: &PublicKey) -> Option<u32> {
    if let Some(rsa) = public.key_data().rsa() {
        return Some(rsa.key_size());
    }
    match public.algorithm() {
        Algorithm::Ed25519 => Some(256),
        Algorithm::Ecdsa { curve } => Some(match curve {
            EcdsaCurve::NistP256 => 256,
            EcdsaCurve::NistP384 => 384,
            EcdsaCurve::NistP521 => 521,
        }),
        _ => None,
    }
}

fn public_line(public: &PublicKey) -> Result<String> {
    public.to_openssh().map_err(key_error)
}

fn info(key: &PrivateKey) -> Result<KeyInfo> {
    let public = key.public_key();
    Ok(KeyInfo {
        algorithm: public.algorithm().as_str().to_owned(),
        bits: bits(public),
        fingerprint: public.fingerprint(HashAlg::Sha256).to_string(),
        comment: key.comment().as_str_lossy().to_owned(),
        encrypted: key.is_encrypted(),
        public: public_line(public)?,
    })
}

/// A new key pair in OpenSSH format, encrypted when `passphrase` is non-empty.
pub fn generate(kind: KeyType, comment: &str, pass: Option<&str>) -> Result<(Zeroizing<String>, KeyInfo)> {
    let comment = check_comment(comment)?;
    let pass = passphrase(pass)?;
    let mut rng = rand::rng();
    let mut key = match kind {
        KeyType::Ed25519 => PrivateKey::random(&mut rng, Algorithm::Ed25519),
        KeyType::Ecdsa(curve) => PrivateKey::random(&mut rng, Algorithm::Ecdsa { curve }),
        KeyType::Rsa(bits) => RsaKeypair::random(&mut rng, bits)
            .and_then(|pair| PrivateKey::new(KeypairData::from(pair), comment)),
    }
    .map_err(key_error)?;
    key.set_comment(comment);
    if let Some(pass) = pass {
        key = key.encrypt(&mut rng, pass).map_err(key_error)?;
    }
    let text = key.to_openssh(LineEnding::LF).map_err(key_error)?;
    Ok((text, info(&key)?))
}

fn is_openssh(text: &str) -> bool {
    text.trim_start().starts_with("-----BEGIN OPENSSH PRIVATE KEY-----")
}

/// Facts about a stored OpenSSH private key; the public half is readable without the passphrase.
pub fn inspect(text: &str) -> Result<KeyInfo> {
    let key = PrivateKey::from_openssh(text).map_err(|_| {
        Error::invalid(crate::tr!(
            "不是 OpenSSH 格式的私钥",
            "Not a private key in OpenSSH format",
            "OpenSSH فورماتىدىكى شەخسىي ئاچقۇچ ئەمەس"
        ))
    })?;
    info(&key)
}

/// Any private key russh can read (OpenSSH, PEM, PKCS#8, PuTTY .ppk) rewritten as OpenSSH.
/// An encrypted key keeps its passphrase; OpenSSH files are kept byte for byte.
pub fn to_openssh(text: &str, pass: Option<&str>) -> Result<(Zeroizing<String>, KeyInfo)> {
    let pass = passphrase(pass)?;
    if is_openssh(text) {
        let info = inspect(text)?;
        return Ok((Zeroizing::new(text.to_owned()), info));
    }
    let unsupported = || {
        Error::invalid(crate::tr!(
            "无法读取这个私钥：支持 OpenSSH、PEM、PKCS#8 和 PuTTY .ppk 格式",
            "Cannot read this private key: the supported formats are OpenSSH, PEM, PKCS#8 and PuTTY .ppk",
            "بۇ شەخسىي ئاچقۇچنى ئوقۇيالمىدى: OpenSSH، PEM، PKCS#8 ۋە PuTTY .ppk فورماتلىرى قوللىنىدۇ"
        ))
    };
    let key = match decode_secret_key(text, None) {
        Ok(key) => key,
        Err(e) => {
            // Encrypted PKCS#8 fails like a malformed key, so the header decides what to say.
            let locked = matches!(e, russh::keys::Error::KeyIsEncrypted)
                || text.contains("-----BEGIN ENCRYPTED PRIVATE KEY-----")
                || text.contains("Proc-Type: 4,ENCRYPTED");
            let Some(pass) = pass else {
                return Err(if locked {
                    Error::invalid(crate::tr!(
                        "这个私钥有口令，请输入口令后再导入",
                        "This private key has a passphrase. Enter the passphrase, then import it again",
                        "بۇ شەخسىي ئاچقۇچنىڭ ئىم ئىبارىسى بار، ئىم ئىبارىسىنى كىرگۈزۈپ ئاندىن ئەكىرىڭ"
                    ))
                    .on("passphrase")
                } else {
                    unsupported()
                });
            };
            let key = decode_secret_key(text, Some(pass)).map_err(|_| {
                if locked {
                    Error::invalid(crate::tr!(
                        "私钥口令不对",
                        "The private key passphrase is wrong",
                        "شەخسىي ئاچقۇچنىڭ ئىم ئىبارىسى خاتا"
                    ))
                    .on("passphrase")
                } else {
                    unsupported()
                }
            })?;
            key.encrypt(&mut rand::rng(), pass).map_err(key_error)?
        }
    };
    let text = key.to_openssh(LineEnding::LF).map_err(key_error)?;
    let info = info(&key)?;
    Ok((text, info))
}

fn public_format() -> Error {
    Error::invalid(crate::tr!(
        "公钥格式不正确",
        "The public key format is not valid",
        "ئاممىۋى ئاچقۇچ فورماتى توغرا ئەمەس"
    ))
}

/// Quotes a value for a POSIX shell.
fn quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', r"'\''"))
}

/// The remote command that adds `public` to `~/.ssh/authorized_keys` unless the key is already
/// there. It fixes the permissions sshd insists on and prints `added` or `present`.
pub fn authorized_keys_command(public: &str) -> Result<String> {
    let key = PublicKey::from_openssh(public.trim()).map_err(|_| public_format())?;
    let line = public_line(&key)?;
    let mut fields = line.split(' ');
    let (Some(kind), Some(data)) = (fields.next(), fields.next()) else {
        return Err(public_format());
    };
    // Matched on type and key data alone, so a copy with another comment or options counts.
    let script = concat!(
        r#"umask 077; d="$HOME/.ssh"; f="$d/authorized_keys"; "#,
        r#"mkdir -p "$d" && chmod 700 "$d" && touch "$f" && chmod 600 "$f" || exit 1; "#,
        r#"if grep -qF -- "$2" "$f"; then echo present; exit 0; fi; "#,
        r#"if [ -s "$f" ] && [ -n "$(tail -c 1 "$f")" ]; then echo >> "$f"; fi; "#,
        r#"printf '%s\n' "$1" >> "$f" && echo added"#,
    );
    Ok(format!(
        "sh -c {} sh {} {}",
        quote(script),
        quote(&line),
        quote(&format!("{kind} {data}"))
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_types_and_sizes() {
        assert_eq!(KeyType::parse("ed25519", None).unwrap(), KeyType::Ed25519);
        assert_eq!(KeyType::parse("rsa", None).unwrap(), KeyType::Rsa(3072));
        assert_eq!(KeyType::parse("rsa", Some(4096)).unwrap(), KeyType::Rsa(4096));
        assert_eq!(KeyType::parse("ecdsa", Some(384)).unwrap(), KeyType::Ecdsa(EcdsaCurve::NistP384));
        assert!(KeyType::parse("rsa", Some(1024)).is_err());
        assert!(KeyType::parse("dsa", None).is_err());
    }

    #[test]
    fn generated_keys_round_trip() {
        let (text, made) = generate(KeyType::Ed25519, "me@laptop", None).unwrap();
        assert_eq!(made.algorithm, "ssh-ed25519");
        assert_eq!(made.bits, Some(256));
        assert!(!made.encrypted);
        assert!(made.public.starts_with("ssh-ed25519 AAAA") && made.public.ends_with(" me@laptop"));
        assert!(made.fingerprint.starts_with("SHA256:"));
        let read = inspect(&text).unwrap();
        assert_eq!(read.fingerprint, made.fingerprint);
        assert!(decode_secret_key(&text, None).is_ok());

        let (_, ec) = generate(KeyType::Ecdsa(EcdsaCurve::NistP256), "", None).unwrap();
        assert_eq!(ec.algorithm, "ecdsa-sha2-nistp256");
        assert_eq!(ec.bits, Some(256));
    }

    #[test]
    fn passphrases_encrypt_and_survive_import() {
        let (text, made) = generate(KeyType::Ed25519, "x", Some("secret")).unwrap();
        assert!(made.encrypted);
        assert!(matches!(decode_secret_key(&text, None), Err(russh::keys::Error::KeyIsEncrypted)));
        assert!(decode_secret_key(&text, Some("secret")).is_ok());
        // Stored OpenSSH keys are copied as-is and still need their passphrase.
        let (copy, read) = to_openssh(&text, None).unwrap();
        assert_eq!(*copy, *text);
        assert!(read.encrypted);
        assert_eq!(read.fingerprint, made.fingerprint);
    }

    #[test]
    fn imports_pkcs8_pem() {
        // openssl genpkey -algorithm ed25519
        let pem = "-----BEGIN PRIVATE KEY-----\n\
                   MC4CAQAwBQYDK2VwBCIEII7sOgbYN+IJb8asBdypfJ3GE19Alw0nbxnGxx76WQiB\n\
                   -----END PRIVATE KEY-----\n";
        let (text, read) = to_openssh(pem, None).unwrap();
        assert!(is_openssh(&text));
        assert_eq!(read.algorithm, "ssh-ed25519");
        assert!(!read.encrypted);

        // A passphrase typed for a key that has none is ignored.
        let (_, read) = to_openssh(pem, Some("pw")).unwrap();
        assert!(!read.encrypted);
        assert!(to_openssh("not a key", None).is_err());
    }

    #[test]
    fn encrypted_pem_keeps_its_passphrase() {
        // openssl genpkey -algorithm ed25519 -aes-256-cbc -pass pass:pw
        let pem = "-----BEGIN ENCRYPTED PRIVATE KEY-----\n\
                   MIGjMF8GCSqGSIb3DQEFDTBSMDEGCSqGSIb3DQEFDDAkBBA6HGNNvMlv4f2y9V4Q\n\
                   48egAgIIADAMBggqhkiG9w0CCQUAMB0GCWCGSAFlAwQBKgQQG/h7H/eolscec4hS\n\
                   ijibLARAeOMO4iOY3aKz2EVXZImczf2is+48Yev/Rlr6W9WINkaK5z16UJsgbaae\n\
                   8bg2OpLB5fpcLikWHGKJu0geKgo0rQ==\n\
                   -----END ENCRYPTED PRIVATE KEY-----\n";
        assert!(to_openssh(pem, None).is_err());
        assert!(to_openssh(pem, Some("wrong")).is_err());
        let (locked, read) = to_openssh(pem, Some("pw")).unwrap();
        assert!(read.encrypted);
        assert!(decode_secret_key(&locked, Some("pw")).is_ok());
    }

    #[test]
    fn rejects_bad_comments() {
        assert!(generate(KeyType::Ed25519, "a\nb", None).is_err());
        assert!(generate(KeyType::Ed25519, &"x".repeat(201), None).is_err());
    }

    #[test]
    fn deploy_command_quotes_the_key() {
        let (_, made) = generate(KeyType::Ed25519, "it's me", None).unwrap();
        let command = authorized_keys_command(&made.public).unwrap();
        assert!(command.starts_with("sh -c '"));
        assert!(command.contains(r"'ssh-ed25519 AAAA"));
        assert!(command.contains(r"it'\''s me'"));
        let data = made.public.split(' ').nth(1).unwrap();
        assert!(command.ends_with(&format!(" 'ssh-ed25519 {data}'")));
        assert!(authorized_keys_command("ssh-ed25519 notbase64").is_err());
        assert!(authorized_keys_command("x; rm -rf ~").is_err());
    }
}
