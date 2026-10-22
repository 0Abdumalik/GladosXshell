use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::Arc;

use portable_pty::{CommandBuilder, PtySize, native_pty_system};
use tokio::sync::{mpsc, oneshot};

use crate::error::{Error, Result};
use crate::pump::{self, Credit, PumpConfig};
use crate::session::{COMMAND_QUEUE, Command, OUTPUT_QUEUE, SessionExit, SessionHandle, Spawned};

#[derive(Debug, Clone)]
pub struct PtyOptions {
    /// `None` starts the user's default shell.
    pub program: Option<String>,
    pub args: Vec<String>,
    pub cwd: Option<PathBuf>,
    pub env: Vec<(String, String)>,
    pub cols: u16,
    pub rows: u16,
}

impl Default for PtyOptions {
    fn default() -> Self {
        Self {
            program: None,
            args: Vec::new(),
            cwd: None,
            env: Vec::new(),
            cols: 80,
            rows: 24,
        }
    }
}

fn pty_err(e: impl std::fmt::Display) -> Error {
    Error::Pty(e.to_string())
}

fn size(cols: u16, rows: u16) -> PtySize {
    PtySize {
        rows: rows.max(1),
        cols: cols.max(1),
        pixel_width: 0,
        pixel_height: 0,
    }
}

/// Spawns a local shell on a pseudo-terminal. Must be called inside a Tokio runtime.
pub fn spawn<F>(options: PtyOptions, config: PumpConfig, sink: F) -> Result<Spawned>
where
    F: FnMut(Vec<u8>) -> bool + Send + 'static,
{
    let pair = native_pty_system()
        .openpty(size(options.cols, options.rows))
        .map_err(pty_err)?;

    let mut cmd = match &options.program {
        Some(program) => {
            let mut cmd = CommandBuilder::new(program);
            cmd.args(&options.args);
            cmd
        }
        None => CommandBuilder::new_default_prog(),
    };
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    for (k, v) in &options.env {
        cmd.env(k, v);
    }
    if let Some(cwd) = &options.cwd {
        cmd.cwd(cwd);
    }

    let mut child = pair.slave.spawn_command(cmd).map_err(pty_err)?;
    // Keeping the slave open would prevent EOF on the reader after the child exits (Unix).
    drop(pair.slave);

    let master = pair.master;
    let mut reader = master.try_clone_reader().map_err(pty_err)?;
    let mut writer = master.take_writer().map_err(pty_err)?;
    let mut killer = child.clone_killer();

    let (cmd_tx, mut cmd_rx) = mpsc::channel::<Command>(COMMAND_QUEUE);
    let (out_tx, out_rx) = mpsc::channel::<Vec<u8>>(OUTPUT_QUEUE);
    let (status_tx, status_rx) = oneshot::channel::<SessionExit>();
    let (exit_tx, exit_rx) = oneshot::channel();
    let credit = Arc::new(Credit::default());

    std::thread::Builder::new().name("gxs-pty-read".into()).spawn(move || {
        let mut buf = vec![0u8; 16 * 1024];
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    if out_tx.blocking_send(buf[..n].to_vec()).is_err() {
                        break;
                    }
                }
            }
        }
    })?;

    let waiter_tx = cmd_tx.clone();
    std::thread::Builder::new().name("gxs-pty-wait".into()).spawn(move || {
        let exit = match child.wait() {
            Ok(status) => SessionExit {
                code: Some(status.exit_code()),
                signal: status.signal().map(str::to_owned),
                error: None,
            },
            Err(e) => SessionExit {
                error: Some(e.to_string()),
                ..SessionExit::default()
            },
        };
        let _ = status_tx.send(exit);
        let _ = waiter_tx.blocking_send(Command::Close);
    })?;

    // Owns the master: dropping it closes the ConPTY / pty fd, which is what finally unblocks
    // the reader thread once the child is gone.
    std::thread::Builder::new().name("gxs-pty-ctl".into()).spawn(move || {
        while let Some(cmd) = cmd_rx.blocking_recv() {
            match cmd {
                Command::Write(data) => {
                    if writer.write_all(&data).and_then(|()| writer.flush()).is_err() {
                        break;
                    }
                }
                Command::Resize { cols, rows } => {
                    let _ = master.resize(size(cols, rows));
                }
                Command::Close => break,
            }
        }
        let _ = killer.kill();
        drop(writer);
        drop(master);
    })?;

    let pump_credit = credit.clone();
    tokio::spawn(async move {
        pump::run(out_rx, pump_credit, config, sink).await;
        let exit = status_rx.await.unwrap_or_default();
        let _ = exit_tx.send(exit);
    });

    Ok(Spawned {
        handle: SessionHandle::new(cmd_tx, credit),
        exit: exit_rx,
    })
}
