//! Privileged calls made on behalf of third-party plugins: remote commands, remote files and
//! HTTP. Each one re-checks the plugin's grant and caps time and size.

use std::collections::BTreeMap;
use std::sync::OnceLock;
use std::time::Duration;

use gxs_core::i18n::ltr;
use gxs_core::{Error, tr};
use reqwest::{Method, Url, header};
use serde::Serialize;
use tauri::State;

use crate::{AppState, Result};

const MAX_COMMAND: usize = 8000;
const MAX_EXEC_OUTPUT: usize = 1024 * 1024;
const MAX_FILE: usize = 4 * 1024 * 1024;
const MAX_HTTP_BODY: usize = 1024 * 1024;
const MAX_HTTP_RESPONSE: usize = 4 * 1024 * 1024;
const MAX_HEADERS: usize = 50;
const MAX_TIMEOUT_SECS: u64 = 120;

fn invalid(message: impl Into<String>) -> Error {
    Error::Invalid(message.into())
}

fn timeout(secs: u64) -> Duration {
    Duration::from_secs(secs.clamp(1, MAX_TIMEOUT_SECS))
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecResult {
    stdout: String,
    stderr: String,
    code: Option<u32>,
    truncated: bool,
}

#[tauri::command]
pub async fn plugin_exec(
    state: State<'_, AppState>,
    id: String,
    session_id: u32,
    command: String,
    timeout_secs: u64,
) -> Result<ExecResult> {
    state.plugins.require(&id, "sessions.exec").await?;
    if command.trim().is_empty() || command.len() > MAX_COMMAND {
        return Err(invalid(tr!(
            "命令不能为空，最长 8000 个字符",
            "The command must not be empty and can be up to 8000 characters",
            "بۇيرۇق بوش بولسا بولمايدۇ، ئەڭ ئۇزۇن بولغاندا 8000 ھەرپ"
        )));
    }
    let (client, _) = state.remote(session_id).await?;
    let limit = timeout(timeout_secs);
    let out = tokio::time::timeout(limit, client.exec_limited(&command, MAX_EXEC_OUTPUT))
        .await
        .map_err(|_| {
            let secs = limit.as_secs();
            invalid(tr!(
                "命令在 {secs} 秒内没有结束",
                "The command did not finish within {secs} seconds",
                "بۇيرۇق {secs} سېكۇنت ئىچىدە ئاخىرلاشمىدى"
            ))
        })??;
    Ok(ExecResult {
        stdout: String::from_utf8_lossy(&out.stdout).into_owned(),
        stderr: String::from_utf8_lossy(&out.stderr).into_owned(),
        code: out.exit.code,
        truncated: out.truncated,
    })
}

fn remote_path(path: &str) -> Result<&str> {
    if path.is_empty() || path.len() > 4096 || path.contains('\0') {
        return Err(invalid(tr!("路径不正确", "The path is not valid", "يول توغرا ئەمەس")));
    }
    Ok(path)
}

#[tauri::command]
pub async fn plugin_file_read(state: State<'_, AppState>, id: String, session_id: u32, path: String) -> Result<String> {
    state.plugins.require(&id, "files.read").await?;
    let (sftp, _) = state.sftp(session_id).await?;
    let data = sftp.read_all(remote_path(&path)?, MAX_FILE).await?;
    String::from_utf8(data).map_err(|_| {
        let path = ltr(&path);
        invalid(tr!(
            "{path} 不是 UTF-8 文本",
            "{path} is not UTF-8 text",
            "{path} UTF-8 تېكىستى ئەمەس"
        ))
    })
}

#[tauri::command]
pub async fn plugin_file_write(
    state: State<'_, AppState>,
    id: String,
    session_id: u32,
    path: String,
    text: String,
) -> Result<()> {
    state.plugins.require(&id, "files.write").await?;
    if text.len() > MAX_FILE {
        return Err(invalid(tr!(
            "文件内容最多 4 MB",
            "File content can be up to 4 MB",
            "ھۆججەت مەزمۇنى ئەڭ كۆپ بولغاندا 4 MB"
        )));
    }
    let (sftp, _) = state.sftp(session_id).await?;
    sftp.write_all(remote_path(&path)?, text.as_bytes()).await
}

/// The permission a request to `url` needs: `http:<host>`, plus `:<port>` when the URL names a
/// non-default port. Must match `httpPermission` in the frontend.
pub(crate) fn http_permission(url: &Url) -> Option<String> {
    if !matches!(url.scheme(), "http" | "https") || !url.username().is_empty() || url.password().is_some() {
        return None;
    }
    let host = url.host_str()?;
    Some(match url.port() {
        Some(port) => format!("http:{host}:{port}"),
        None => format!("http:{host}"),
    })
}

fn http_client() -> Result<&'static reqwest::Client> {
    static CLIENT: OnceLock<std::result::Result<reqwest::Client, String>> = OnceLock::new();
    CLIENT
        .get_or_init(|| {
            // Another crate may have installed one already; either is fine.
            let _ = rustls::crypto::ring::default_provider().install_default();
            reqwest::Client::builder()
                // Each hop would need its own permission check; plugins follow redirects themselves.
                .redirect(reqwest::redirect::Policy::none())
                .user_agent(concat!("GladosXshell/", env!("CARGO_PKG_VERSION")))
                .build()
                .map_err(|e| e.to_string())
        })
        .as_ref()
        .map_err(|e| {
            let e = ltr(e);
            invalid(tr!(
                "无法创建 HTTP 客户端：{e}",
                "Could not create the HTTP client: {e}",
                "HTTP خېرىدارىنى قۇرغىلى بولمىدى: {e}"
            ))
        })
}

#[derive(Debug, Serialize)]
pub struct HttpResponse {
    status: u16,
    headers: BTreeMap<String, String>,
    body: String,
}

fn http_error(e: reqwest::Error) -> Error {
    if e.is_timeout() {
        return invalid(tr!("请求超时", "The request timed out", "تەلەپنىڭ ۋاقتى ئېشىپ كەتتى"));
    }
    let e = ltr(&e.to_string());
    invalid(tr!(
        "请求失败：{e}",
        "The request failed: {e}",
        "تەلەپ مەغلۇپ بولدى: {e}"
    ))
}

#[tauri::command]
pub async fn plugin_http(
    state: State<'_, AppState>,
    id: String,
    url: String,
    method: String,
    headers: BTreeMap<String, String>,
    body: Option<String>,
    timeout_secs: u64,
) -> Result<HttpResponse> {
    let url =
        Url::parse(&url).map_err(|_| invalid(tr!("地址不正确", "The address is not valid", "ئادرېس توغرا ئەمەس")))?;
    let permission = http_permission(&url).ok_or_else(|| {
        invalid(tr!(
            "只能请求 http 或 https 地址，且不能带用户名密码",
            "Only http or https addresses can be requested, without a user name or password",
            "پەقەت http ياكى https ئادرېسىنىلا تەلەپ قىلغىلى بولىدۇ، ئىشلەتكۈچى ئاتى ۋە ئىم بولسا بولمايدۇ"
        ))
    })?;
    state.plugins.require(&id, &permission).await?;
    let method = match method.as_str() {
        "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" => Method::from_bytes(method.as_bytes()),
        _ => {
            let method = ltr(&method);
            return Err(invalid(tr!(
                "不支持的请求方法：{method}",
                "Unsupported request method: {method}",
                "قوللىمايدىغان تەلەپ ئۇسۇلى: {method}"
            )));
        }
    }
    .map_err(|_| {
        invalid(tr!(
            "请求方法不正确",
            "The request method is not valid",
            "تەلەپ ئۇسۇلى توغرا ئەمەس"
        ))
    })?;
    if headers.len() > MAX_HEADERS {
        return Err(invalid(tr!(
            "请求头最多 50 个",
            "At most 50 request headers",
            "تەلەپ بېشى ئەڭ كۆپ بولغاندا 50"
        )));
    }
    if body.as_ref().is_some_and(|b| b.len() > MAX_HTTP_BODY) {
        return Err(invalid(tr!(
            "请求内容最多 1 MB",
            "The request body can be up to 1 MB",
            "تەلەپ مەزمۇنى ئەڭ كۆپ بولغاندا 1 MB"
        )));
    }
    let mut map = header::HeaderMap::new();
    for (name, value) in headers {
        let name = header::HeaderName::from_bytes(name.as_bytes()).map_err(|_| {
            let name = ltr(&name);
            invalid(tr!(
                "请求头名称不正确：{name}",
                "Request header name is not valid: {name}",
                "تەلەپ بېشىنىڭ نامى توغرا ئەمەس: {name}"
            ))
        })?;
        let value = header::HeaderValue::from_str(&value).map_err(|_| {
            let name = ltr(name.as_str());
            invalid(tr!(
                "请求头 {name} 的值不正确",
                "The value of request header {name} is not valid",
                "{name} تەلەپ بېشىنىڭ قىممىتى توغرا ئەمەس"
            ))
        })?;
        map.append(name, value);
    }
    let mut request = http_client()?
        .request(method, url)
        .headers(map)
        .timeout(timeout(timeout_secs));
    if let Some(body) = body {
        request = request.body(body);
    }
    let mut response = request.send().await.map_err(http_error)?;
    let status = response.status().as_u16();
    let mut out_headers = BTreeMap::new();
    for (name, value) in response.headers() {
        let value = String::from_utf8_lossy(value.as_bytes()).into_owned();
        out_headers
            .entry(name.as_str().to_owned())
            .and_modify(|v: &mut String| {
                v.push_str(", ");
                v.push_str(&value);
            })
            .or_insert(value);
    }
    let mut data = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(http_error)? {
        if data.len() + chunk.len() > MAX_HTTP_RESPONSE {
            return Err(invalid(tr!(
                "响应太大（最多 4 MB）",
                "The response is too large (4 MB at most)",
                "جاۋاب بەك چوڭ (ئەڭ كۆپ بولغاندا 4 MB)"
            )));
        }
        data.extend_from_slice(&chunk);
    }
    Ok(HttpResponse {
        status,
        headers: out_headers,
        body: String::from_utf8_lossy(&data).into_owned(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn permission(url: &str) -> Option<String> {
        http_permission(&Url::parse(url).unwrap())
    }

    #[test]
    fn http_permission_matches_the_frontend() {
        assert_eq!(
            permission("https://api.example.com/v1?q=1").as_deref(),
            Some("http:api.example.com")
        );
        assert_eq!(
            permission("http://example.com:8080/").as_deref(),
            Some("http:example.com:8080")
        );
        assert_eq!(
            permission("https://example.com:443/").as_deref(),
            Some("http:example.com")
        );
        assert_eq!(permission("https://EXAMPLE.com/").as_deref(), Some("http:example.com"));
        assert_eq!(permission("http://user:pw@example.com/"), None);
        assert_eq!(permission("file:///etc/passwd"), None);
        assert_eq!(permission("ftp://example.com/"), None);
    }

    #[test]
    fn timeouts_are_clamped() {
        assert_eq!(timeout(0), Duration::from_secs(1));
        assert_eq!(timeout(30), Duration::from_secs(30));
        assert_eq!(timeout(10_000), Duration::from_secs(MAX_TIMEOUT_SECS));
    }

    #[test]
    fn remote_paths_are_checked() {
        assert!(remote_path("/etc/hosts").is_ok());
        assert!(remote_path("").is_err());
        assert!(remote_path("a\0b").is_err());
    }
}
