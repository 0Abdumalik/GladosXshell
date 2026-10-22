//! The local SSH agent: OpenSSH's agent or Pageant on Windows, `SSH_AUTH_SOCK` elsewhere.

use russh::keys::agent::client::{AgentClient, AgentStream};

use crate::error::{Error, Result};

pub type Agent = AgentClient<Box<dyn AgentStream + Send + Unpin>>;

#[cfg(windows)]
const OPENSSH_PIPE: &str = r"\\.\pipe\openssh-ssh-agent";

#[cfg(windows)]
fn not_found() -> Error {
    Error::Connect(crate::tr!(
        "没有找到 SSH Agent。请启动 Pageant 并添加密钥，或启动 Windows 的 OpenSSH Authentication Agent 服务后用 ssh-add 添加密钥。",
        "No SSH agent was found. Start Pageant and add a key, or start the OpenSSH Authentication Agent service in Windows and add a key with ssh-add.",
        "SSH Agent تېپىلمىدى. Pageant نى قوزغىتىپ ئاچقۇچ قوشۇڭ، ياكى Windows نىڭ OpenSSH Authentication Agent مۇلازىمىتىنى قوزغىتىپ ssh-add ئارقىلىق ئاچقۇچ قوشۇڭ."
    ))
}
#[cfg(not(windows))]
fn not_found() -> Error {
    Error::Connect(crate::tr!(
        "没有找到 SSH Agent：SSH_AUTH_SOCK 未设置或无法连接。请先启动 ssh-agent 并用 ssh-add 添加密钥。",
        "No SSH agent was found: SSH_AUTH_SOCK is not set or cannot be reached. Start ssh-agent and add a key with ssh-add first.",
        "SSH Agent تېپىلمىدى: SSH_AUTH_SOCK تەڭشەلمىگەن ياكى ئۇنىڭغا ئۇلىغىلى بولمىدى. ئالدى بىلەن ssh-agent نى قوزغىتىپ ssh-add ئارقىلىق ئاچقۇچ قوشۇڭ."
    ))
}

/// Tries `SSH_AUTH_SOCK` when it names a pipe, then OpenSSH's pipe, then Pageant.
#[cfg(windows)]
pub async fn connect() -> Result<Agent> {
    if let Ok(path) = std::env::var("SSH_AUTH_SOCK")
        && path.starts_with(r"\\.\pipe\")
        && let Ok(agent) = AgentClient::connect_named_pipe(&path).await
    {
        return Ok(agent.dynamic());
    }
    if let Ok(agent) = AgentClient::connect_named_pipe(OPENSSH_PIPE).await {
        return Ok(agent.dynamic());
    }
    match AgentClient::connect_pageant().await {
        Ok(agent) => Ok(agent.dynamic()),
        Err(_) => Err(not_found()),
    }
}

#[cfg(not(windows))]
pub async fn connect() -> Result<Agent> {
    match AgentClient::connect_env().await {
        Ok(agent) => Ok(agent.dynamic()),
        Err(_) => Err(not_found()),
    }
}
