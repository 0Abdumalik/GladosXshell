//! Synthetic terminal load that goes through the same pump as real sessions, so the IPC and
//! renderer can be measured without a shell or network being the bottleneck.

use std::fmt::Write as _;
use std::sync::Arc;

use tokio::sync::{mpsc, oneshot};

use crate::pump::{self, Credit, PumpConfig};
use crate::session::{COMMAND_QUEUE, Command, OUTPUT_QUEUE, SessionExit, SessionHandle, Spawned};

const CHUNK: usize = 16 * 1024;
const SCENE_BYTES: usize = 64 * 1024;

#[derive(Debug, Clone, Copy)]
pub enum Scene {
    /// Colored scrolling log lines, like `tail -f` or a build.
    Log,
    /// Full-screen cursor-addressed redraws, like `htop`.
    Top,
}

struct Lcg(u64);

impl Lcg {
    fn next(&mut self) -> u32 {
        self.0 = self
            .0
            .wrapping_mul(6364136223846793005)
            .wrapping_add(1442695040888963407);
        (self.0 >> 33) as u32
    }
}

fn log_line(out: &mut String, rng: &mut Lcg, seq: u64) {
    let color = 31 + rng.next() % 6;
    let _ = write!(
        out,
        "\x1b[2m{:02}:{:02}:{:02}.{:03}\x1b[0m \x1b[1;{color}m{:<5}\x1b[0m worker-{:02} handled request \
         id={:08x} path=/api/v1/items/{} in \x1b[33m{}.{}ms\x1b[0m seq={seq}\r\n",
        rng.next() % 24,
        rng.next() % 60,
        rng.next() % 60,
        rng.next() % 1000,
        ["INFO", "WARN", "DEBUG", "ERROR"][(rng.next() % 4) as usize],
        rng.next() % 16,
        rng.next(),
        rng.next() % 90_000,
        rng.next() % 900,
        rng.next() % 10,
    );
}

fn top_frame(out: &mut String, rng: &mut Lcg, rows: u16) {
    out.push_str("\x1b[H\x1b[1;30;42m  PID USER       PRI  NI  VIRT   RES  CPU% MEM%   TIME+  Command\x1b[K\x1b[0m");
    for row in 2..=rows {
        let cpu = rng.next() % 1000;
        let bar = if cpu > 700 {
            31
        } else if cpu > 300 {
            33
        } else {
            32
        };
        let _ = write!(
            out,
            "\x1b[{row};1H{:>5} gxs         20   0 {:>4}M {:>4}M \x1b[{bar}m{:>3}.{}\x1b[0m {:>4.1} {:>3}:{:02}.{:02} \
             /usr/bin/service --worker {}\x1b[K",
            1000 + row as u32 * 7,
            rng.next() % 4096,
            rng.next() % 1024,
            cpu / 10,
            cpu % 10,
            f64::from(rng.next() % 1000) / 10.0,
            rng.next() % 200,
            rng.next() % 60,
            rng.next() % 100,
            row,
        );
    }
}

/// Emits `total_bytes` of synthetic output. Must be called inside a Tokio runtime.
pub fn spawn<F>(total_bytes: u64, rows: u16, config: PumpConfig, sink: F) -> Spawned
where
    F: FnMut(Vec<u8>) -> bool + Send + 'static,
{
    let (cmd_tx, mut cmd_rx) = mpsc::channel::<Command>(COMMAND_QUEUE);
    let (out_tx, out_rx) = mpsc::channel::<Vec<u8>>(OUTPUT_QUEUE);
    let (exit_tx, exit_rx) = oneshot::channel();
    let credit = Arc::new(Credit::default());

    let generator = tokio::spawn(async move {
        let mut rng = Lcg(0x9e37_79b9_7f4a_7c15);
        let mut produced = 0u64;
        let mut seq = 0u64;
        let mut chunk = String::with_capacity(CHUNK + 4096);
        let rows = rows.max(2);
        while produced < total_bytes {
            if matches!(cmd_rx.try_recv(), Ok(Command::Close)) {
                break;
            }
            let scene = if (produced as usize / SCENE_BYTES).is_multiple_of(2) {
                Scene::Log
            } else {
                Scene::Top
            };
            chunk.clear();
            while chunk.len() < CHUNK {
                match scene {
                    Scene::Log => {
                        log_line(&mut chunk, &mut rng, seq);
                        seq += 1;
                    }
                    Scene::Top => top_frame(&mut chunk, &mut rng, rows),
                }
            }
            if matches!(scene, Scene::Top) {
                chunk.push_str("\x1b[2J\x1b[H");
            }
            let take = chunk.len().min((total_bytes - produced) as usize);
            produced += take as u64;
            if out_tx.send(chunk.as_bytes()[..take].to_vec()).await.is_err() {
                break;
            }
        }
        produced
    });

    let pump_credit = credit.clone();
    tokio::spawn(async move {
        pump::run(out_rx, pump_credit, config, sink).await;
        let exit = match generator.await {
            Ok(_) => SessionExit {
                code: Some(0),
                ..SessionExit::default()
            },
            Err(e) => SessionExit {
                error: Some(e.to_string()),
                ..SessionExit::default()
            },
        };
        let _ = exit_tx.send(exit);
    });

    Spawned {
        handle: SessionHandle::new(cmd_tx, credit),
        exit: exit_rx,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn emits_exactly_the_requested_bytes_under_flow_control() {
        let (tx, mut rx) = mpsc::unbounded_channel::<Vec<u8>>();
        let config = PumpConfig {
            window: 64 * 1024,
            ..PumpConfig::default()
        };
        let spawned = spawn(1_000_000, 40, config, move |f| tx.send(f).is_ok());
        let handle = spawned.handle.clone();
        let mut total = 0usize;
        while let Some(frame) = rx.recv().await {
            total += frame.len();
            handle.ack(frame.len() as u64);
        }
        assert_eq!(total, 1_000_000);
        assert_eq!(spawned.exit.await.unwrap().code, Some(0));
    }
}
