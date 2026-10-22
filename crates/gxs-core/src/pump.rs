//! Output pump: coalesces terminal output into frames and enforces an ack window so a slow
//! renderer stalls the producer (PTY reader / SSH channel) instead of growing an unbounded queue.

use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use tokio::sync::{Notify, mpsc};
use tokio::time::{Instant, sleep_until};

#[derive(Debug, Clone, Copy)]
pub struct PumpConfig {
    /// Minimum spacing between frames while output is streaming. The first chunk after an idle
    /// period is sent immediately so keystroke echo is not delayed.
    pub frame_interval: Duration,
    /// A frame is flushed as soon as it reaches this size.
    pub max_frame: usize,
    /// Maximum bytes sent but not yet acknowledged by the consumer.
    pub window: u64,
}

impl Default for PumpConfig {
    fn default() -> Self {
        Self {
            frame_interval: Duration::from_millis(8),
            max_frame: 64 * 1024,
            window: 512 * 1024,
        }
    }
}

#[derive(Debug, Default)]
pub struct Credit {
    acked: AtomicU64,
    notify: Notify,
}

impl Credit {
    pub fn ack(&self, bytes: u64) {
        self.acked.fetch_add(bytes, Ordering::AcqRel);
        self.notify.notify_one();
    }

    fn acked(&self) -> u64 {
        self.acked.load(Ordering::Acquire)
    }
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct PumpStats {
    pub frames: u64,
    pub bytes: u64,
}

/// Runs until `source` is closed and every buffered byte has been handed to `sink`.
/// `sink` returns `false` once the consumer is gone; the pump then keeps draining `source`
/// without flow control so the producer can shut down instead of blocking forever.
pub async fn run<T, F>(mut source: mpsc::Receiver<T>, credit: Arc<Credit>, config: PumpConfig, sink: F) -> PumpStats
where
    T: AsRef<[u8]>,
    F: FnMut(Vec<u8>) -> bool,
{
    let mut b = Batcher {
        buf: Vec::with_capacity(config.max_frame),
        max_frame: config.max_frame,
        stats: PumpStats::default(),
        alive: true,
        last_flush: None,
        deadline: None,
        sink,
    };

    loop {
        let has_credit = !b.alive || b.stats.bytes.saturating_sub(credit.acked()) < config.window;

        tokio::select! {
            biased;
            () = sleep_until(b.deadline.unwrap_or_else(Instant::now)), if b.deadline.is_some() => {
                b.flush();
            }
            chunk = source.recv(), if has_credit => {
                let Some(chunk) = chunk else { break };
                b.buf.extend_from_slice(chunk.as_ref());
                while b.buf.len() < config.max_frame {
                    match source.try_recv() {
                        Ok(more) => b.buf.extend_from_slice(more.as_ref()),
                        Err(_) => break,
                    }
                }
                let due = b.last_flush.is_none_or(|t| t.elapsed() >= config.frame_interval);
                if b.buf.len() >= config.max_frame || due {
                    b.flush();
                } else if b.deadline.is_none() {
                    b.deadline = b.last_flush.map(|t| t + config.frame_interval);
                }
            }
            () = credit.notify.notified(), if !has_credit => {}
        }
    }

    b.flush();
    b.stats
}

struct Batcher<F> {
    buf: Vec<u8>,
    max_frame: usize,
    stats: PumpStats,
    alive: bool,
    last_flush: Option<Instant>,
    deadline: Option<Instant>,
    sink: F,
}

impl<F: FnMut(Vec<u8>) -> bool> Batcher<F> {
    fn flush(&mut self) {
        self.deadline = None;
        if self.buf.is_empty() {
            return;
        }
        let frame = std::mem::replace(&mut self.buf, Vec::with_capacity(self.max_frame));
        self.stats.bytes += frame.len() as u64;
        self.stats.frames += 1;
        if self.alive && !(self.sink)(frame) {
            self.alive = false;
        }
        self.last_flush = Some(Instant::now());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cfg(window: u64) -> PumpConfig {
        PumpConfig {
            frame_interval: Duration::from_millis(20),
            max_frame: 1024,
            window,
        }
    }

    #[tokio::test]
    async fn first_chunk_after_idle_is_immediate_and_bursts_coalesce() {
        let (tx, rx) = mpsc::channel::<Vec<u8>>(64);
        let credit = Arc::new(Credit::default());
        let (ftx, mut frx) = mpsc::unbounded_channel();
        let pump = tokio::spawn(run(rx, credit, cfg(u64::MAX), move |f| ftx.send(f).is_ok()));

        tx.send(b"a".to_vec()).await.unwrap();
        let first = tokio::time::timeout(Duration::from_millis(10), frx.recv())
            .await
            .expect("idle chunk must not wait for the frame interval")
            .unwrap();
        assert_eq!(first, b"a");

        for _ in 0..10 {
            tx.send(b"bc".to_vec()).await.unwrap();
        }
        drop(tx);
        let stats = pump.await.unwrap();
        let mut rest = Vec::new();
        while let Some(f) = frx.recv().await {
            rest.push(f);
        }
        assert_eq!(rest.concat(), b"bc".repeat(10));
        assert!(rest.len() <= 2, "burst should coalesce, got {} frames", rest.len());
        assert_eq!(stats.bytes, 21);
    }

    #[tokio::test]
    async fn frames_respect_max_size() {
        let (tx, rx) = mpsc::channel::<Vec<u8>>(64);
        let (ftx, mut frx) = mpsc::unbounded_channel();
        let pump = tokio::spawn(run(rx, Arc::new(Credit::default()), cfg(u64::MAX), move |f| {
            ftx.send(f).is_ok()
        }));
        for _ in 0..40 {
            tx.send(vec![b'x'; 100]).await.unwrap();
        }
        drop(tx);
        pump.await.unwrap();
        let mut total = 0;
        while let Some(f) = frx.recv().await {
            assert!(f.len() < 1024 + 100);
            total += f.len();
        }
        assert_eq!(total, 4000);
    }

    #[tokio::test]
    async fn window_stalls_producer_until_ack() {
        let (tx, rx) = mpsc::channel::<Vec<u8>>(1);
        let credit = Arc::new(Credit::default());
        let (ftx, mut frx) = mpsc::unbounded_channel::<Vec<u8>>();
        let pump = tokio::spawn(run(rx, credit.clone(), cfg(2048), move |f| ftx.send(f).is_ok()));

        let producer = tokio::spawn(async move {
            for _ in 0..16 {
                tx.send(vec![b'y'; 1024]).await.unwrap();
            }
        });

        tokio::time::sleep(Duration::from_millis(100)).await;
        let mut received = 0usize;
        while let Ok(f) = frx.try_recv() {
            received += f.len();
        }
        assert!(received < 16 * 1024, "window must stall output, got {received}");
        assert!(!producer.is_finished(), "producer must be blocked by backpressure");

        credit.ack(received as u64);
        let reader = tokio::spawn(async move {
            let mut total = 0usize;
            while let Some(f) = frx.recv().await {
                total += f.len();
                credit.ack(f.len() as u64);
            }
            total
        });
        producer.await.unwrap();
        pump.await.unwrap();
        assert_eq!(reader.await.unwrap() + received, 16 * 1024);
    }
    #[tokio::test]
    async fn dead_sink_keeps_draining() {
        let (tx, rx) = mpsc::channel::<Vec<u8>>(1);
        let pump = tokio::spawn(run(rx, Arc::new(Credit::default()), cfg(10), |_| false));
        for _ in 0..100 {
            tx.send(vec![0; 64]).await.unwrap();
        }
        drop(tx);
        assert_eq!(pump.await.unwrap().bytes, 6400);
    }
}
