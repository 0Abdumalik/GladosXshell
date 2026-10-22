//! Docker and Kubernetes over an SSH session. Only a fixed set of commands can be run, and
//! every name is checked against the tools' own naming rules before it is quoted into the
//! remote shell.

use std::time::Duration;

use gxs_core::i18n::ltr;
use gxs_core::{Error, tr};
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::{AppState, Result};

const TIMEOUT: Duration = Duration::from_secs(30);
const MAX_OUTPUT: usize = 4 * 1024 * 1024;
const MAX_TAIL: u32 = 5000;
const MAX_ERROR: usize = 600;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DockerAction {
    Start,
    Stop,
    Restart,
    Pause,
    Unpause,
    Rm,
}

impl DockerAction {
    fn verb(self) -> &'static str {
        match self {
            Self::Start => "start",
            Self::Stop => "stop",
            Self::Restart => "restart",
            Self::Pause => "pause",
            Self::Unpause => "unpause",
            Self::Rm => "rm",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(tag = "op", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum Request {
    Probe,
    DockerList,
    DockerAction { action: DockerAction, id: String },
    DockerLogs { id: String, tail: u32 },
    DockerInspect { id: String },
    KubeNamespaces,
    /// `None` lists pods in every namespace.
    KubePods { namespace: Option<String> },
    KubeLogs { namespace: String, pod: String, container: Option<String>, tail: u32 },
    KubeDescribe { namespace: String, pod: String },
    KubeDelete { namespace: String, pod: String },
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Output {
    text: String,
    truncated: bool,
}

fn invalid(message: impl Into<String>) -> Error {
    Error::Invalid(message.into())
}

/// Docker container ids and names: `[a-zA-Z0-9][a-zA-Z0-9_.-]*`.
fn docker_name(value: &str) -> Result<&str> {
    let mut chars = value.chars();
    let ok = value.len() <= 128
        && chars.next().is_some_and(|c| c.is_ascii_alphanumeric())
        && chars.all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '.' | '-'));
    if ok {
        Ok(value)
    } else {
        let value = ltr(value);
        Err(invalid(tr!("容器名称不正确：{value}", "Invalid container name: {value}", "قاچا نامى توغرا ئەمەس: {value}")))
    }
}

/// Kubernetes object names (RFC 1123 subdomain): lowercase letters, digits, `-` and `.`,
/// starting and ending with a letter or digit.
fn kube_name(value: &str) -> Result<&str> {
    let edge = |c: Option<char>| c.is_some_and(|c| c.is_ascii_lowercase() || c.is_ascii_digit());
    let ok = !value.is_empty()
        && value.len() <= 253
        && edge(value.chars().next())
        && edge(value.chars().last())
        && value.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || matches!(c, '-' | '.'));
    if ok {
        Ok(value)
    } else {
        let value = ltr(value);
        Err(invalid(tr!("Kubernetes 名称不正确：{value}", "Invalid Kubernetes name: {value}", "Kubernetes نامى توغرا ئەمەس: {value}")))
    }
}

fn tail(lines: u32) -> u32 {
    lines.clamp(1, MAX_TAIL)
}

/// The names above can't contain quotes, so single-quoting is enough.
fn quoted(value: &str) -> String {
    format!("'{value}'")
}

const PROBE: &str = "for c in docker kubectl; do if command -v $c >/dev/null 2>&1; then echo $c=yes; else echo $c=no; fi; done";

pub fn command(request: &Request) -> Result<String> {
    Ok(match request {
        Request::Probe => PROBE.to_owned(),
        Request::DockerList => "docker ps -a --no-trunc --format '{{json .}}'".to_owned(),
        Request::DockerAction { action, id } => {
            format!("docker {} {}", action.verb(), quoted(docker_name(id)?))
        }
        Request::DockerLogs { id, tail: lines } => {
            format!("docker logs --timestamps --tail {} {} 2>&1", tail(*lines), quoted(docker_name(id)?))
        }
        Request::DockerInspect { id } => format!("docker inspect {}", quoted(docker_name(id)?)),
        Request::KubeNamespaces => {
            "kubectl get namespaces -o jsonpath='{range .items[*]}{.metadata.name}{\"\\n\"}{end}'".to_owned()
        }
        Request::KubePods { namespace: None } => "kubectl get pods --all-namespaces -o json".to_owned(),
        Request::KubePods { namespace: Some(namespace) } => {
            format!("kubectl get pods -n {} -o json", quoted(kube_name(namespace)?))
        }
        Request::KubeLogs { namespace, pod, container, tail: lines } => {
            let which = match container {
                Some(container) => format!("-c {}", quoted(kube_name(container)?)),
                None => "--all-containers=true --prefix=true".to_owned(),
            };
            format!(
                "kubectl logs -n {} {} {which} --timestamps --tail={} 2>&1",
                quoted(kube_name(namespace)?),
                quoted(kube_name(pod)?),
                tail(*lines),
            )
        }
        Request::KubeDescribe { namespace, pod } => {
            format!("kubectl describe pod -n {} {}", quoted(kube_name(namespace)?), quoted(kube_name(pod)?))
        }
        Request::KubeDelete { namespace, pod } => {
            format!("kubectl delete pod -n {} {} --wait=false", quoted(kube_name(namespace)?), quoted(kube_name(pod)?))
        }
    })
}

/// The tool's own complaint, cut to a length that fits in a status line.
fn failure(stdout: &str, stderr: &str, code: Option<u32>) -> String {
    let text = if stderr.trim().is_empty() { stdout.trim() } else { stderr.trim() };
    let mut message: String = text.chars().take(MAX_ERROR).collect();
    if message.len() < text.len() {
        message.push('…');
    }
    if message.is_empty() {
        message = match code {
            Some(code) => tr!("命令退出码 {code}", "The command exited with code {code}", "بۇيرۇق {code} كودى بىلەن چېكىندى"),
            None => tr!("命令被中断", "The command was interrupted", "بۇيرۇق ئۈزۈلۈپ قالدى"),
        };
    }
    message
}

#[tauri::command]
pub async fn containers_run(state: State<'_, AppState>, session_id: u32, request: Request) -> Result<Output> {
    let command = command(&request)?;
    let (client, _) = state.remote(session_id).await?;
    let out = tokio::time::timeout(TIMEOUT, client.exec_limited(&command, MAX_OUTPUT))
        .await
        .map_err(|_| {
            let secs = TIMEOUT.as_secs();
            invalid(tr!("命令在 {secs} 秒内没有结束", "The command did not finish within {secs} seconds", "بۇيرۇق {secs} سېكۇنت ئىچىدە ئاخىرلاشمىدى"))
        })??;
    let stdout = String::from_utf8_lossy(&out.stdout).into_owned();
    if out.exit.code != Some(0) {
        let stderr = String::from_utf8_lossy(&out.stderr);
        return Err(invalid(failure(&stdout, &stderr, out.exit.code)));
    }
    Ok(Output { text: stdout, truncated: out.truncated })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(json: &str) -> Request {
        serde_json::from_str(json).unwrap()
    }

    #[test]
    fn requests_deserialize_from_the_frontend_shape() {
        assert_eq!(parse(r#"{"op":"dockerList"}"#), Request::DockerList);
        assert_eq!(
            parse(r#"{"op":"dockerAction","action":"restart","id":"gx-web"}"#),
            Request::DockerAction { action: DockerAction::Restart, id: "gx-web".into() }
        );
        assert_eq!(parse(r#"{"op":"kubePods","namespace":null}"#), Request::KubePods { namespace: None });
        assert!(serde_json::from_str::<Request>(r#"{"op":"dockerAction","action":"exec","id":"x"}"#).is_err());
        assert!(serde_json::from_str::<Request>(r#"{"op":"shell","command":"id"}"#).is_err());
    }

    #[test]
    fn commands_quote_checked_names() {
        let stop = Request::DockerAction { action: DockerAction::Stop, id: "gx-web".into() };
        assert_eq!(command(&stop).unwrap(), "docker stop 'gx-web'");
        let logs = Request::KubeLogs {
            namespace: "kube-system".into(),
            pod: "coredns-7b9c.x1".into(),
            container: None,
            tail: 999_999,
        };
        assert_eq!(
            command(&logs).unwrap(),
            "kubectl logs -n 'kube-system' 'coredns-7b9c.x1' --all-containers=true --prefix=true --timestamps --tail=5000 2>&1"
        );
        let one = Request::KubeLogs { namespace: "a".into(), pod: "b".into(), container: Some("c".into()), tail: 0 };
        assert_eq!(command(&one).unwrap(), "kubectl logs -n 'a' 'b' -c 'c' --timestamps --tail=1 2>&1");
    }

    #[test]
    fn hostile_names_are_rejected() {
        for id in ["", "-rf", "a b", "a;id", "a'b", "$(id)", "a\nb", &"x".repeat(129)] {
            let request = Request::DockerLogs { id: id.into(), tail: 10 };
            assert!(command(&request).is_err(), "{id:?}");
        }
        for name in ["", "Upper", "-a", "a-", "a_b", "a'b", "a;b", ".a"] {
            let request = Request::KubeDelete { namespace: "default".into(), pod: name.into() };
            assert!(command(&request).is_err(), "{name:?}");
            let request = Request::KubePods { namespace: Some(name.into()) };
            assert!(command(&request).is_err(), "{name:?}");
        }
        let container = Request::KubeLogs {
            namespace: "a".into(),
            pod: "b".into(),
            container: Some("c d".into()),
            tail: 1,
        };
        assert!(command(&container).is_err());
    }

    #[test]
    fn failure_prefers_stderr_and_stays_short() {
        assert_eq!(failure("out", "  permission denied\n", Some(1)), "permission denied");
        assert_eq!(failure(" out ", "", Some(1)), "out");
        assert_eq!(failure("", "", Some(127)), "命令退出码 127");
        assert_eq!(failure("", "", None), "命令被中断");
        let long = failure("", &"错".repeat(700), Some(1));
        assert_eq!(long.chars().count(), MAX_ERROR + 1);
        assert!(long.ends_with('…'));
    }
}
