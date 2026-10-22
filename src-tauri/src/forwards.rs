use gxs_core::forward::{Forward, ForwardSpec, ForwardView};
use gxs_core::{Error, tr};
use tauri::State;

use crate::{AppState, Result};

#[tauri::command]
pub async fn forward_list(state: State<'_, AppState>, session_id: u32) -> Result<Vec<ForwardView>> {
    let sessions = state.sessions.lock().await;
    let remote = sessions
        .get(&session_id)
        .ok_or(Error::Closed)?
        .remote
        .as_ref()
        .ok_or_else(|| {
            Error::Unsupported(tr!(
                "本地终端不能做端口转发",
                "A local terminal cannot forward ports",
                "يەرلىك تېرمىنال ئېغىز يوللىيالمايدۇ"
            ))
        })?;
    Ok(remote.forwards.iter().map(Forward::view).collect())
}

#[tauri::command]
pub async fn forward_start(state: State<'_, AppState>, session_id: u32, spec: ForwardSpec) -> Result<ForwardView> {
    let (client, _) = state.remote(session_id).await?;
    let forward = Forward::start(&client, spec).await?;
    let view = forward.view();
    let mut sessions = state.sessions.lock().await;
    match sessions.get_mut(&session_id).and_then(|s| s.remote.as_mut()) {
        Some(remote) => {
            remote.forwards.push(forward);
            Ok(view)
        }
        // The session ended while the forward was starting.
        None => {
            drop(sessions);
            forward.stop(&client).await;
            Err(Error::Closed)
        }
    }
}

#[tauri::command]
pub async fn forward_stop(state: State<'_, AppState>, session_id: u32, forward_id: u32) -> Result<()> {
    let (client, forward) = {
        let mut sessions = state.sessions.lock().await;
        let Some(remote) = sessions.get_mut(&session_id).and_then(|s| s.remote.as_mut()) else {
            return Ok(());
        };
        let Some(at) = remote.forwards.iter().position(|f| f.id() == forward_id) else {
            return Ok(());
        };
        (remote.client.clone(), remote.forwards.remove(at))
    };
    forward.stop(&client).await;
    Ok(())
}
