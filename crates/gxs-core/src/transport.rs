//! How the SSH byte stream reaches the server: a plain TCP connection, or one tunnelled through a
//! SOCKS5 or HTTP CONNECT proxy. Jump hosts are handled in `ssh` because they need a session.

use std::net::IpAddr;
use std::time::Duration;

use base64::Engine;
use serde::{Deserialize, Serialize};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use tokio::net::TcpStream;
use zeroize::Zeroizing;

use crate::error::{Error, Result};
use crate::i18n::ltr;
use crate::ssh::{endpoint, open_tcp};

/// Anything an SSH session can run over.
pub trait Stream: AsyncRead + AsyncWrite + Unpin + Send {}
impl<T: AsyncRead + AsyncWrite + Unpin + Send> Stream for T {}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ProxyKind {
    #[default]
    None,
    Socks5,
    Http,
}

pub struct Proxy {
    pub kind: ProxyKind,
    pub host: String,
    pub port: u16,
    /// Empty: no proxy authentication.
    pub user: String,
    pub password: Option<Zeroizing<String>>,
}

impl Proxy {
    fn label(&self) -> String {
        let kind = match self.kind {
            ProxyKind::Http => "HTTP",
            _ => "SOCKS5",
        };
        let addr = ltr(&endpoint(&self.host, self.port));
        crate::tr!("{kind} 代理 {addr}", "{kind} proxy {addr}", "{kind} ۋاكالەتچى {addr}")
    }

    fn password(&self) -> &str {
        self.password.as_deref().map_or("", |p| p.as_str())
    }
}

fn bare(host: &str) -> &str {
    host.trim_start_matches('[').trim_end_matches(']')
}

/// Opens a TCP connection to `host:port` through `proxy`. The proxy resolves the name, so
/// hosts only known inside the proxy's network work.
pub async fn connect_proxy(proxy: &Proxy, host: &str, port: u16, limit: Duration) -> Result<TcpStream> {
    let label = proxy.label();
    let target = endpoint(host, port);
    let attempt = async {
        let mut stream = open_tcp(&proxy.host, proxy.port, limit).await.map_err(|e| match e {
            Error::Connect(message) => Error::Connect(crate::tr!(
                "无法连接{label}：{message}",
                "Cannot connect to {label}: {message}",
                "{label} غا ئۇلىنالمىدى: {message}"
            )),
            other => other,
        })?;
        stream.set_nodelay(true)?;
        match proxy.kind {
            ProxyKind::Socks5 => socks5_connect(&mut stream, proxy, &label, host, port).await?,
            ProxyKind::Http => http_connect(&mut stream, proxy, &label, host, port).await?,
            ProxyKind::None => {}
        }
        Ok(stream)
    };
    tokio::time::timeout(limit, attempt).await.unwrap_or_else(|_| {
        let (target, secs) = (ltr(&target), limit.as_secs());
        Err(Error::Connect(crate::tr!(
            "通过{label}连接 {target} 超时：{secs} 秒内没有完成。请检查代理是否可用。",
            "Connecting to {target} through {label} timed out: it did not finish within {secs} seconds. Check that the proxy is working.",
            "{label} ئارقىلىق {target} غا ئۇلىنىش ۋاقتى ئېشىپ كەتتى: {secs} سېكۇنت ئىچىدە تاماملانمىدى. ۋاكالەتچىنىڭ ئىشلەۋاتقانلىقىنى تەكشۈرۈڭ."
        )))
    })
}

fn credentials_required(label: &str) -> String {
    crate::tr!(
        "{label} 要求认证，请在代理设置里填写用户名和密码。",
        "{label} requires authentication. Enter a user name and password in the proxy settings.",
        "{label} دەلىللەشنى تەلەپ قىلىدۇ، ۋاكالەتچى تەڭشىكىدە ئىشلەتكۈچى ئاتى ۋە ئىمنى تولدۇرۇڭ."
    )
}

fn credentials_rejected(label: &str) -> String {
    crate::tr!(
        "{label} 拒绝了用户名或密码。",
        "{label} rejected the user name or password.",
        "{label} ئىشلەتكۈچى ئاتى ياكى ئىمنى رەت قىلدى."
    )
}

fn handshake_io(label: &str, e: std::io::Error) -> Error {
    use std::io::ErrorKind as K;
    match e.kind() {
        K::UnexpectedEof | K::ConnectionReset | K::ConnectionAborted => Error::Connect(crate::tr!(
            "{label} 在握手时关闭了连接。请检查代理类型（SOCKS5 / HTTP）和端口是否正确。",
            "{label} closed the connection during the handshake. Check that the proxy type (SOCKS5 / HTTP) and port are correct.",
            "{label} قول ئېلىشىش جەريانىدا ئۇلىنىشنى ياپتى. ۋاكالەتچى تۈرى (SOCKS5 / HTTP) ۋە ئېغىزنىڭ توغرىلىقىنى تەكشۈرۈڭ."
        )),
        _ => {
            let e = ltr(&e.to_string());
            Error::Connect(crate::tr!(
                "与{label}握手失败：{e}",
                "The handshake with {label} failed: {e}",
                "{label} بىلەن قول ئېلىشىش مەغلۇپ بولدى: {e}"
            ))
        }
    }
}

/// Appends a SOCKS5 address (type, address, port).
pub(crate) fn push_socks_addr(buf: &mut Vec<u8>, host: &str, port: u16) -> Result<()> {
    let host = bare(host);
    match host.parse::<IpAddr>() {
        Ok(IpAddr::V4(ip)) => {
            buf.push(1);
            buf.extend_from_slice(&ip.octets());
        }
        Ok(IpAddr::V6(ip)) => {
            buf.push(4);
            buf.extend_from_slice(&ip.octets());
        }
        Err(_) => {
            let name = host.as_bytes();
            let len = u8::try_from(name.len()).map_err(|_| {
                Error::invalid(crate::tr!("主机名太长", "The host name is too long", "ئاساسىي ماشىنا نامى بەك ئۇزۇن"))
            })?;
            buf.push(3);
            buf.push(len);
            buf.extend_from_slice(name);
        }
    }
    buf.extend_from_slice(&port.to_be_bytes());
    Ok(())
}

/// Reads a SOCKS5 address (type byte already consumed) and returns host and port.
pub(crate) async fn read_socks_addr<S: AsyncRead + Unpin>(stream: &mut S, kind: u8) -> std::io::Result<(String, u16)> {
    let host = match kind {
        1 => {
            let mut ip = [0u8; 4];
            stream.read_exact(&mut ip).await?;
            std::net::Ipv4Addr::from(ip).to_string()
        }
        4 => {
            let mut ip = [0u8; 16];
            stream.read_exact(&mut ip).await?;
            std::net::Ipv6Addr::from(ip).to_string()
        }
        3 => {
            let mut len = [0u8; 1];
            stream.read_exact(&mut len).await?;
            let mut name = vec![0u8; usize::from(len[0])];
            stream.read_exact(&mut name).await?;
            String::from_utf8(name).map_err(|_| std::io::Error::from(std::io::ErrorKind::InvalidData))?
        }
        _ => return Err(std::io::ErrorKind::InvalidData.into()),
    };
    let mut port = [0u8; 2];
    stream.read_exact(&mut port).await?;
    Ok((host, u16::from_be_bytes(port)))
}

fn socks_reply_text(code: u8) -> String {
    match code {
        1 => crate::tr!("代理内部出错", "the proxy had an internal error", "ۋاكالەتچىدە ئىچكى خاتالىق كۆرۈلدى"),
        2 => crate::tr!(
            "代理的规则不允许这个连接",
            "the proxy rules do not allow this connection",
            "ۋاكالەتچىنىڭ قائىدىسى بۇ ئۇلىنىشقا يول قويمايدۇ"
        ),
        3 => crate::tr!("代理所在网络不可达", "the proxy cannot reach the network", "ۋاكالەتچى تورغا يېتەلمەيدۇ"),
        4 => crate::tr!(
            "代理无法到达目标主机",
            "the proxy cannot reach the target host",
            "ۋاكالەتچى نىشان ئاساسىي ماشىنىغا يېتەلمەيدۇ"
        ),
        5 => crate::tr!("目标拒绝了连接", "the target refused the connection", "نىشان ئۇلىنىشنى رەت قىلدى"),
        6 => crate::tr!("连接超时", "the connection timed out", "ئۇلىنىش ۋاقتى ئېشىپ كەتتى"),
        7 => crate::tr!(
            "代理不支持 CONNECT 命令",
            "the proxy does not support the CONNECT command",
            "ۋاكالەتچى CONNECT بۇيرۇقىنى قوللىمايدۇ"
        ),
        8 => crate::tr!(
            "代理不支持这种地址类型",
            "the proxy does not support this address type",
            "ۋاكالەتچى بۇ خىل ئادرېس تۈرىنى قوللىمايدۇ"
        ),
        _ => crate::tr!("未知错误", "unknown error", "نامەلۇم خاتالىق"),
    }
}

async fn socks5_connect<S: AsyncRead + AsyncWrite + Unpin>(
    stream: &mut S,
    proxy: &Proxy,
    label: &str,
    host: &str,
    port: u16,
) -> Result<()> {
    let io = |e| handshake_io(label, e);
    let auth = !proxy.user.is_empty();
    let hello: &[u8] = if auth { &[5, 2, 0, 2] } else { &[5, 1, 0] };
    stream.write_all(hello).await.map_err(io)?;
    let mut choice = [0u8; 2];
    stream.read_exact(&mut choice).await.map_err(io)?;
    if choice[0] != 5 {
        return Err(Error::Connect(crate::tr!(
            "{label} 回应的不是 SOCKS5 协议。请检查代理类型和端口是否正确。",
            "{label} did not answer with the SOCKS5 protocol. Check that the proxy type and port are correct.",
            "{label} نىڭ جاۋابى SOCKS5 كېلىشىمى ئەمەس. ۋاكالەتچى تۈرى ۋە ئېغىزنىڭ توغرىلىقىنى تەكشۈرۈڭ."
        )));
    }
    match choice[1] {
        0 => {}
        2 if auth => {
            let user = proxy.user.as_bytes();
            let password = proxy.password().as_bytes();
            let (Ok(user_len), Ok(password_len)) = (u8::try_from(user.len()), u8::try_from(password.len())) else {
                return Err(Error::invalid(crate::tr!(
                    "代理用户名或密码太长（最多 255 字节）",
                    "The proxy user name or password is too long (255 bytes at most)",
                    "ۋاكالەتچى ئىشلەتكۈچى ئاتى ياكى ئىمى بەك ئۇزۇن (ئەڭ كۆپ 255 بايت)"
                )));
            };
            let mut message = Zeroizing::new(Vec::with_capacity(3 + user.len() + password.len()));
            message.push(1);
            message.push(user_len);
            message.extend_from_slice(user);
            message.push(password_len);
            message.extend_from_slice(password);
            stream.write_all(&message).await.map_err(io)?;
            let mut status = [0u8; 2];
            stream.read_exact(&mut status).await.map_err(io)?;
            if status[1] != 0 {
                return Err(Error::Connect(credentials_rejected(label)));
            }
        }
        _ if auth => {
            return Err(Error::Connect(crate::tr!(
                "{label} 不接受用户名密码认证。",
                "{label} does not accept user name and password authentication.",
                "{label} ئىشلەتكۈچى ئاتى ۋە ئىم ئارقىلىق دەلىللەشنى قوبۇل قىلمايدۇ."
            )));
        }
        _ => {
            return Err(Error::Connect(credentials_required(label)));
        }
    }
    let mut request = vec![5, 1, 0];
    push_socks_addr(&mut request, host, port)?;
    stream.write_all(&request).await.map_err(io)?;
    let mut head = [0u8; 4];
    stream.read_exact(&mut head).await.map_err(io)?;
    if head[1] != 0 {
        let (target, reason) = (ltr(&endpoint(host, port)), socks_reply_text(head[1]));
        return Err(Error::Connect(crate::tr!(
            "{label} 无法连接 {target}：{reason}。",
            "{label} cannot connect to {target}: {reason}.",
            "{label} {target} غا ئۇلىنالمىدى: {reason}."
        )));
    }
    read_socks_addr(stream, head[3]).await.map_err(io)?;
    Ok(())
}

const HTTP_HEAD_LIMIT: usize = 16 * 1024;

async fn http_connect<S: AsyncRead + AsyncWrite + Unpin>(
    stream: &mut S,
    proxy: &Proxy,
    label: &str,
    host: &str,
    port: u16,
) -> Result<()> {
    let io = |e| handshake_io(label, e);
    let target = endpoint(host, port);
    let mut request = Zeroizing::new(format!("CONNECT {target} HTTP/1.1\r\nHost: {target}\r\n"));
    if !proxy.user.is_empty() {
        let credentials = Zeroizing::new(format!("{}:{}", proxy.user, proxy.password()));
        let token = Zeroizing::new(base64::engine::general_purpose::STANDARD.encode(credentials.as_bytes()));
        request.push_str("Proxy-Authorization: Basic ");
        request.push_str(&token);
        request.push_str("\r\n");
    }
    request.push_str("\r\n");
    stream.write_all(request.as_bytes()).await.map_err(io)?;

    // Byte by byte so nothing after the header (the server's SSH banner) is swallowed.
    let mut head = Vec::new();
    let mut byte = [0u8; 1];
    while !head.ends_with(b"\r\n\r\n") {
        if head.len() >= HTTP_HEAD_LIMIT {
            return Err(Error::Connect(crate::tr!(
                "{label} 的回应头太长，无法解析。",
                "The response header from {label} is too long to parse.",
                "{label} نىڭ جاۋاب بېشى بەك ئۇزۇن، تەھلىل قىلغىلى بولمىدى."
            )));
        }
        stream.read_exact(&mut byte).await.map_err(io)?;
        head.push(byte[0]);
    }
    let status_line = String::from_utf8_lossy(head.split(|b| *b == b'\r').next().unwrap_or_default()).into_owned();
    let mut parts = status_line.split_whitespace();
    let code = match (parts.next(), parts.next().and_then(|c| c.parse::<u16>().ok())) {
        (Some(version), Some(code)) if version.starts_with("HTTP/") => code,
        _ => {
            return Err(Error::Connect(crate::tr!(
                "{label} 回应的不是 HTTP 协议。请检查代理类型和端口是否正确。",
                "{label} did not answer with the HTTP protocol. Check that the proxy type and port are correct.",
                "{label} نىڭ جاۋابى HTTP كېلىشىمى ئەمەس. ۋاكالەتچى تۈرى ۋە ئېغىزنىڭ توغرىلىقىنى تەكشۈرۈڭ."
            )));
        }
    };
    let (target, status_line) = (ltr(&target), ltr(&status_line));
    match code {
        200..=299 => Ok(()),
        407 => Err(Error::Connect(if proxy.user.is_empty() {
            credentials_required(label)
        } else {
            credentials_rejected(label)
        })),
        403 | 405 => Err(Error::Connect(crate::tr!(
            "{label} 不允许连接 {target}（{status_line}）。有些代理只允许连接 443 端口。",
            "{label} does not allow connecting to {target} ({status_line}). Some proxies only allow port 443.",
            "{label} {target} غا ئۇلىنىشقا يول قويمايدۇ ({status_line}). بەزى ۋاكالەتچىلەر پەقەت 443 ئېغىزىغىلا ئۇلىنىشقا يول قويىدۇ."
        ))),
        502..=504 => Err(Error::Connect(crate::tr!(
            "{label} 无法连接 {target}（{status_line}）。",
            "{label} cannot connect to {target} ({status_line}).",
            "{label} {target} غا ئۇلىنالمىدى ({status_line})."
        ))),
        _ => Err(Error::Connect(crate::tr!(
            "{label} 拒绝了连接请求（{status_line}）。",
            "{label} refused the connection request ({status_line}).",
            "{label} ئۇلىنىش ئىلتىماسىنى رەت قىلدى ({status_line})."
        ))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::duplex;

    fn proxy(kind: ProxyKind, user: &str, password: &str) -> Proxy {
        Proxy {
            kind,
            host: "proxy".into(),
            port: 1080,
            user: user.into(),
            password: Some(Zeroizing::new(password.into())),
        }
    }

    #[tokio::test]
    async fn socks5_with_password_sends_domain_request() {
        let (mut client, mut server) = duplex(1024);
        let server = tokio::spawn(async move {
            let mut hello = [0u8; 4];
            server.read_exact(&mut hello).await.unwrap();
            assert_eq!(hello, [5, 2, 0, 2]);
            server.write_all(&[5, 2]).await.unwrap();
            let mut auth = [0u8; 9];
            server.read_exact(&mut auth).await.unwrap();
            assert_eq!(&auth, b"\x01\x01u\x05pass1");
            server.write_all(&[1, 0]).await.unwrap();
            let mut head = [0u8; 4];
            server.read_exact(&mut head).await.unwrap();
            assert_eq!(head, [5, 1, 0, 3]);
            let target = read_socks_addr(&mut server, 3).await.unwrap();
            assert_eq!(target, ("example.org".to_owned(), 22));
            server.write_all(&[5, 0, 0, 1, 0, 0, 0, 0, 0, 0]).await.unwrap();
        });
        let p = proxy(ProxyKind::Socks5, "u", "pass1");
        socks5_connect(&mut client, &p, "代理", "example.org", 22).await.unwrap();
        server.await.unwrap();
    }

    #[tokio::test]
    async fn socks5_failure_code_is_explained() {
        let (mut client, mut server) = duplex(1024);
        tokio::spawn(async move {
            let mut hello = [0u8; 3];
            server.read_exact(&mut hello).await.unwrap();
            server.write_all(&[5, 0]).await.unwrap();
            let mut request = [0u8; 10];
            server.read_exact(&mut request).await.unwrap();
            assert_eq!(request, [5, 1, 0, 1, 10, 0, 0, 9, 0, 22]);
            server.write_all(&[5, 5, 0, 1, 0, 0, 0, 0, 0, 0]).await.unwrap();
        });
        let p = proxy(ProxyKind::Socks5, "", "");
        let err = socks5_connect(&mut client, &p, "代理", "10.0.0.9", 22).await.unwrap_err();
        assert!(err.to_string().contains("目标拒绝了连接"), "{err}");
    }

    #[tokio::test]
    async fn http_connect_keeps_bytes_after_header() {
        let (mut client, mut server) = duplex(4096);
        tokio::spawn(async move {
            let mut buf = vec![0u8; 512];
            let mut got = Vec::new();
            while !got.ends_with(b"\r\n\r\n") {
                let n = server.read(&mut buf).await.unwrap();
                got.extend_from_slice(&buf[..n]);
            }
            let text = String::from_utf8(got).unwrap();
            assert!(text.starts_with("CONNECT [::1]:2222 HTTP/1.1\r\n"), "{text}");
            assert!(text.contains("Proxy-Authorization: Basic dTpw\r\n"), "{text}");
            server
                .write_all(b"HTTP/1.1 200 Connection established\r\n\r\nSSH-2.0-test\r\n")
                .await
                .unwrap();
        });
        let p = proxy(ProxyKind::Http, "u", "p");
        http_connect(&mut client, &p, "代理", "::1", 2222).await.unwrap();
        let mut banner = [0u8; 8];
        client.read_exact(&mut banner).await.unwrap();
        assert_eq!(&banner, b"SSH-2.0-");
    }

    #[tokio::test]
    async fn http_407_asks_for_credentials() {
        let (mut client, mut server) = duplex(4096);
        tokio::spawn(async move {
            let mut buf = vec![0u8; 512];
            let _ = server.read(&mut buf).await.unwrap();
            server
                .write_all(b"HTTP/1.1 407 Proxy Authentication Required\r\nX: y\r\n\r\n")
                .await
                .unwrap();
        });
        let p = proxy(ProxyKind::Http, "", "");
        let err = http_connect(&mut client, &p, "代理", "h", 22).await.unwrap_err();
        assert!(err.to_string().contains("要求认证"), "{err}");
    }
}
