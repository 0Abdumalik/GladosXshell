use std::sync::Arc;

use serde::Serialize;
use tokio::sync::{mpsc, oneshot};

use crate::error::{Error, Result};
use crate::pump::Credit;

pub(crate) enum Command {
    Write(Vec<u8>),
    Resize { cols: u16, rows: u16 },
    Close,
}

/// Control side of a running terminal session. Output is delivered through the frame sink
/// passed at spawn time; every delivered frame must eventually be passed to [`Self::ack`].
#[derive(Clone)]
pub struct SessionHandle {
    tx: mpsc::Sender<Command>,
    credit: Arc<Credit>,
}

impl SessionHandle {
    pub(crate) fn new(tx: mpsc::Sender<Command>, credit: Arc<Credit>) -> Self {
        Self { tx, credit }
    }

    pub async fn write(&self, data: Vec<u8>) -> Result<()> {
        self.send(Command::Write(data)).await
    }

    pub async fn resize(&self, cols: u16, rows: u16) -> Result<()> {
        self.send(Command::Resize { cols, rows }).await
    }

    /// Idempotent: closing an already finished session succeeds.
    pub async fn close(&self) {
        let _ = self.tx.send(Command::Close).await;
    }

    pub fn ack(&self, bytes: u64) {
        self.credit.ack(bytes);
    }

    async fn send(&self, cmd: Command) -> Result<()> {
        self.tx.send(cmd).await.map_err(|_| Error::Closed)
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionExit {
    pub code: Option<u32>,
    pub signal: Option<String>,
    pub error: Option<String>,
}

pub struct Spawned {
    pub handle: SessionHandle,
    /// Resolves after the last output frame has been handed to the sink.
    pub exit: oneshot::Receiver<SessionExit>,
}

pub(crate) const COMMAND_QUEUE: usize = 256;
pub(crate) const OUTPUT_QUEUE: usize = 32;
