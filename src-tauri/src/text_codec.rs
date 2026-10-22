//! Text encodings for the built-in editor: detection on open, round-trip on save.

use encoding_rs::{Encoding, GB18030, UTF_8, UTF_16BE, UTF_16LE};
use gxs_core::i18n::ltr;
use gxs_core::{Error, tr};
use serde::Serialize;

use crate::Result;

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Decoded {
    pub text: String,
    /// WHATWG label, lower case: `utf-8`, `gbk`, `utf-16le`, …
    pub encoding: String,
    pub bom: bool,
    /// Some bytes did not decode and became U+FFFD.
    pub lossy: bool,
}

fn lookup(label: &str) -> Result<&'static Encoding> {
    Encoding::for_label(label.trim().as_bytes())
        .filter(|e| *e != encoding_rs::REPLACEMENT)
        .ok_or_else(|| {
            let label = ltr(label);
            Error::Invalid(tr!("不支持的编码：{label}", "Unsupported encoding: {label}", "قوللىمايدىغان كودلاش: {label}"))
        })
}

fn label(encoding: &'static Encoding) -> String {
    encoding.name().to_ascii_lowercase()
}

fn bom_of(bytes: &[u8]) -> Option<(&'static Encoding, usize)> {
    Encoding::for_bom(bytes)
}

/// With no `wanted` encoding: BOM, then strict UTF-8, then GB18030. Text-looking bytes that fit
/// neither are refused so a binary file is not silently mangled.
pub fn decode(bytes: &[u8], wanted: Option<&str>) -> Result<Decoded> {
    let bom = bom_of(bytes);
    let encoding = match wanted {
        Some(w) => lookup(w)?,
        None => match bom {
            Some((e, _)) => e,
            None if bytes.contains(&0) => {
                return Err(Error::Invalid(tr!(
                    "文件像是二进制文件，请用外部编辑器打开",
                    "The file looks like a binary file. Open it in an external editor",
                    "ھۆججەت ئىككىلىك ھۆججەتكە ئوخشايدۇ، سىرتقى تەھرىرلىگۈچتە ئېچىڭ"
                )));
            }
            None if std::str::from_utf8(bytes).is_ok() => UTF_8,
            None => GB18030,
        },
    };
    let has_bom = bom.is_some_and(|(e, _)| e == encoding);
    let body = match bom {
        Some((_, len)) if has_bom => &bytes[len..],
        _ => bytes,
    };
    let (text, lossy) = encoding.decode_without_bom_handling(body);
    if wanted.is_none() && lossy {
        return Err(Error::Invalid(tr!(
            "无法识别文件编码，请用外部编辑器打开",
            "The file encoding could not be recognized. Open it in an external editor",
            "ھۆججەتنىڭ كودلىشىنى تونۇغىلى بولمىدى، سىرتقى تەھرىرلىگۈچتە ئېچىڭ"
        )));
    }
    Ok(Decoded {
        text: text.into_owned(),
        encoding: label(encoding),
        bom: has_bom,
        lossy,
    })
}

fn utf16(text: &str, big_endian: bool, bom: bool) -> Vec<u8> {
    let mut out = Vec::with_capacity(text.len() * 2 + 2);
    let units = bom.then_some(0xfeff).into_iter().chain(text.encode_utf16());
    for unit in units {
        out.extend_from_slice(&if big_endian { unit.to_be_bytes() } else { unit.to_le_bytes() });
    }
    out
}

/// Refuses characters the target encoding cannot hold instead of writing `&#…;` escapes.
pub fn encode(text: &str, wanted: &str, bom: bool) -> Result<Vec<u8>> {
    let encoding = lookup(wanted)?;
    if encoding == UTF_16LE || encoding == UTF_16BE {
        return Ok(utf16(text, encoding == UTF_16BE, bom));
    }
    let (bytes, _, unmappable) = encoding.encode(text);
    if unmappable {
        let bad = text
            .chars()
            .find(|c| encoding.encode(c.encode_utf8(&mut [0; 4])).2)
            .unwrap_or('\u{fffd}');
        let name = ltr(encoding.name());
        return Err(Error::Invalid(tr!(
            "字符“{bad}”无法用 {name} 编码保存，请换一种编码",
            "The character “{bad}” cannot be saved in {name}. Choose another encoding",
            "«{bad}» ھەرپىنى {name} كودلىشى بىلەن ساقلىغىلى بولمايدۇ، باشقا كودلاشنى تاللاڭ"
        )));
    }
    if bom && encoding == UTF_8 {
        let mut out = Vec::with_capacity(bytes.len() + 3);
        out.extend_from_slice(b"\xef\xbb\xbf");
        out.extend_from_slice(&bytes);
        return Ok(out);
    }
    Ok(bytes.into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_utf8_and_bom() {
        let d = decode("你好".as_bytes(), None).unwrap();
        assert_eq!((d.encoding.as_str(), d.bom, d.text.as_str()), ("utf-8", false, "你好"));
        let d = decode(b"\xef\xbb\xbfhi", None).unwrap();
        assert_eq!((d.encoding.as_str(), d.bom, d.text.as_str()), ("utf-8", true, "hi"));
    }

    #[test]
    fn falls_back_to_gb18030() {
        let (gbk, _, _) = encoding_rs::GBK.encode("中文注释");
        let d = decode(&gbk, None).unwrap();
        assert_eq!((d.encoding.as_str(), d.text.as_str()), ("gb18030", "中文注释"));
    }

    #[test]
    fn utf16_round_trip() {
        let bytes = encode("a中", "utf-16le", true).unwrap();
        assert_eq!(bytes, [0xff, 0xfe, b'a', 0, 0x2d, 0x4e]);
        let d = decode(&bytes, None).unwrap();
        assert_eq!((d.encoding.as_str(), d.bom, d.text.as_str()), ("utf-16le", true, "a中"));
        let be = encode("a", "utf-16be", false).unwrap();
        assert_eq!(be, [0, b'a']);
    }

    #[test]
    fn rejects_binary_and_unmappable() {
        assert!(decode(b"ab\0cd", None).is_err());
        assert!(encode("€ 😀", "gbk", false).is_err());
        assert!(encode("x", "nope", false).is_err());
        assert_eq!(encode("中", "gbk", false).unwrap(), [0xd6, 0xd0]);
    }

    #[test]
    fn explicit_encoding_is_lossy_not_an_error() {
        let d = decode(&[0xff, 0x41], Some("utf-8")).unwrap();
        assert!(d.lossy);
        assert_eq!(d.text, "\u{fffd}A");
        let d = decode("中".as_bytes(), Some("gbk")).unwrap();
        assert_eq!(d.encoding, "gbk");
    }

    #[test]
    fn utf8_bom_on_save() {
        assert_eq!(encode("a", "utf-8", true).unwrap(), b"\xef\xbb\xbfa");
        assert_eq!(encode("a", "utf-8", false).unwrap(), b"a");
    }
}
