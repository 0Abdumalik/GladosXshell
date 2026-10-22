//! Telnet client sessions (RFC 854) with the options a terminal needs: binary, echo,
//! suppress-go-ahead, terminal type (RFC 1091) and window size (RFC 1073).

use std::sync::Arc;
use std::time::Duration;

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::sync::{mpsc, oneshot};

use crate::error::Result;
use crate::pump::{self, Credit, PumpConfig};
use crate::session::{COMMAND_QUEUE, Command, OUTPUT_QUEUE, SessionExit, SessionHandle, Spawned};
use crate::ssh::{CONNECTION_LOST, open_tcp};
use crate::transport::{Proxy, connect_proxy};

const IAC: u8 = 255;
const DONT: u8 = 254;
const DO: u8 = 253;
const WONT: u8 = 252;
const WILL: u8 = 251;
const SB: u8 = 250;
const NOP: u8 = 241;
const SE: u8 = 240;

const BINARY: u8 = 0;
const ECHO: u8 = 1;
const SGA: u8 = 3;
const TTYPE: u8 = 24;
const NAWS: u8 = 31;

const TTYPE_IS: u8 = 0;
const TTYPE_SEND: u8 = 1;
const MAX_SUB: usize = 512;

#[derive(Clone, Copy, PartialEq, Eq)]
enum State {
    Data,
    Iac,
    Option(u8),
    Sub,
    SubIac,
}

/// Option negotiation and IAC framing, with no I/O. `us` are options this side performs
/// (agreed with DO), `them` the ones the server performs (agreed with WILL).
pub struct Telnet {
    term: String,
    cols: u16,
    rows: u16,
    state: State,
    sub: Vec<u8>,
    last_cr: bool,
    us: [bool; 256],
    them: [bool; 256],
}

impl Telnet {
    pub fn new(term: &str, cols: u16, rows: u16) -> Self {
        Self {
            term: term.to_owned(),
            cols,
            rows,
            state: State::Data,
            sub: Vec::new(),
            last_cr: false,
            us: [false; 256],
            them: [false; 256],
        }
    }

    /// What a client opens with; servers that wait for the client then know what it supports.
    pub fn greeting(&mut self) -> Vec<u8> {
        self.us[NAWS as usize] = true;
        self.us[TTYPE as usize] = true;
        self.them[SGA as usize] = true;
        let mut out = vec![IAC, WILL, NAWS, IAC, WILL, TTYPE, IAC, DO, SGA];
        out.extend(self.naws());
        out
    }

    /// Whether the server echoes what is typed; until it does, the client echoes locally.
    pub fn remote_echo(&self) -> bool {
        self.them[ECHO as usize]
    }

    /// Splits server bytes into terminal output and negotiation replies to send back.
    pub fn receive(&mut self, input: &[u8], out: &mut Vec<u8>, reply: &mut Vec<u8>) {
        for &b in input {
            self.state = match self.state {
                State::Data => {
                    if b == IAC {
                        State::Iac
                    } else {
                        // NVT sends a bare CR as CR NUL.
                        if !(self.last_cr && b == 0 && !self.them[BINARY as usize]) {
                            out.push(b);
                        }
                        self.last_cr = b == b'\r';
                        State::Data
                    }
                }
                State::Iac => match b {
                    IAC => {
                        out.push(IAC);
                        self.last_cr = false;
                        State::Data
                    }
                    DO | DONT | WILL | WONT => State::Option(b),
                    SB => {
                        self.sub.clear();
                        State::Sub
                    }
                    _ => State::Data,
                },
                State::Option(command) => {
                    self.negotiate(command, b, reply);
                    State::Data
                }
                State::Sub => {
                    if b == IAC {
                        State::SubIac
                    } else {
                        if self.sub.len() < MAX_SUB {
                            self.sub.push(b);
                        }
                        State::Sub
                    }
                }
                State::SubIac => match b {
                    SE => {
                        self.subnegotiation(reply);
                        State::Data
                    }
                    IAC => {
                        if self.sub.len() < MAX_SUB {
                            self.sub.push(IAC);
                        }
                        State::Sub
                    }
                    _ => State::Data,
                },
            };
        }
    }

    fn negotiate(&mut self, command: u8, option: u8, reply: &mut Vec<u8>) {
        let at = option as usize;
        match command {
            DO => {
                if matches!(option, BINARY | SGA | TTYPE | NAWS) {
                    if !self.us[at] {
                        self.us[at] = true;
                        reply.extend([IAC, WILL, option]);
                    }
                    if option == NAWS {
                        reply.extend(self.naws());
                    }
                } else {
                    reply.extend([IAC, WONT, option]);
                }
            }
            DONT => {
                if self.us[at] {
                    self.us[at] = false;
                    reply.extend([IAC, WONT, option]);
                }
            }
            WILL => {
                if matches!(option, BINARY | ECHO | SGA) {
                    if !self.them[at] {
                        self.them[at] = true;
                        reply.extend([IAC, DO, option]);
                    }
                } else {
                    reply.extend([IAC, DONT, option]);
                }
            }
            _ => {
                if self.them[at] {
                    self.them[at] = false;
                    reply.extend([IAC, DONT, option]);
                }
            }
        }
    }

    fn subnegotiation(&mut self, reply: &mut Vec<u8>) {
        if self.sub.first() == Some(&TTYPE) && self.sub.get(1) == Some(&TTYPE_SEND) && self.us[TTYPE as usize] {
            reply.extend([IAC, SB, TTYPE, TTYPE_IS]);
            reply.extend(self.term.bytes().filter(|&b| b != IAC));
            reply.extend([IAC, SE]);
        }
    }

    /// Keyboard input as it goes on the wire.
    pub fn encode(&self, data: &[u8]) -> Vec<u8> {
        let binary = self.us[BINARY as usize];
        let mut out = Vec::with_capacity(data.len() + 4);
        for (i, &b) in data.iter().enumerate() {
            match b {
                IAC => out.extend([IAC, IAC]),
                b'\r' if !binary && data.get(i + 1) != Some(&b'\n') => out.extend([b'\r', 0]),
                _ => out.push(b),
            }
        }
        out
    }

    /// The window size report; empty until the server has agreed to NAWS.
    pub fn resize(&mut self, cols: u16, rows: u16) -> Vec<u8> {
        self.cols = cols;
        self.rows = rows;
        if self.us[NAWS as usize] { self.naws() } else { Vec::new() }
    }

    fn naws(&self) -> Vec<u8> {
        let mut out = vec![IAC, SB, NAWS];
        for b in self.cols.to_be_bytes().into_iter().chain(self.rows.to_be_bytes()) {
            out.push(b);
            if b == IAC {
                out.push(IAC);
            }
        }
        out.extend([IAC, SE]);
        out
    }
}

/// What typing produces on screen when the server doesn't echo: Enter moves to a new line.
fn local_echo(data: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(data.len());
    for &b in data {
        match b {
            b'\r' => out.extend(b"\r\n"),
            0x7f | 0x08 => out.extend(b"\x08 \x08"),
            b if b >= 0x20 || b == b'\t' || b == b'\n' => out.push(b),
            _ => {}
        }
    }
    out
}

pub struct TelnetOptions {
    pub host: String,
    pub port: u16,
    pub term: String,
    pub connect_timeout: Duration,
    /// Sends IAC NOP this often so a dead connection is noticed.
    pub keepalive: Option<Duration>,
    pub proxy: Option<Proxy>,
    pub cols: u16,
    pub rows: u16,
}

/// Connects and starts the session. Connection failures are returned before any tab output.
pub async fn connect<F>(options: TelnetOptions, config: PumpConfig, sink: F) -> Result<Spawned>
where
    F: FnMut(Vec<u8>) -> bool + Send + 'static,
{
    let stream = match &options.proxy {
        Some(proxy) => connect_proxy(proxy, &options.host, options.port, options.connect_timeout).await?,
        None => open_tcp(&options.host, options.port, options.connect_timeout).await?,
    };
    stream.set_nodelay(true)?;
    Ok(spawn(stream, &options, config, sink))
}

fn spawn<F>(stream: TcpStream, options: &TelnetOptions, config: PumpConfig, sink: F) -> Spawned
where
    F: FnMut(Vec<u8>) -> bool + Send + 'static,
{
    let (cmd_tx, mut cmd_rx) = mpsc::channel::<Command>(COMMAND_QUEUE);
    let (out_tx, out_rx) = mpsc::channel::<Vec<u8>>(OUTPUT_QUEUE);
    let (exit_tx, exit_rx) = oneshot::channel();
    let credit = Arc::new(Credit::default());
    let mut telnet = Telnet::new(&options.term, options.cols, options.rows);
    let keepalive = options.keepalive;

    let session = tokio::spawn(async move {
        let (mut read, mut write) = stream.into_split();
        let mut exit = SessionExit::default();
        if write.write_all(&telnet.greeting()).await.is_err() {
            exit.error = Some(CONNECTION_LOST.into());
            return exit;
        }
        let mut buf = vec![0u8; 16 * 1024];
        // Output waiting for pump credit; the socket isn't read until it has gone out.
        let mut pending: Option<Vec<u8>> = None;
        let mut ticker = keepalive.map(|every| tokio::time::interval_at(tokio::time::Instant::now() + every, every));
        loop {
            tokio::select! {
                cmd = cmd_rx.recv() => {
                    let wire = match cmd {
                        Some(Command::Write(data)) => {
                            if !telnet.remote_echo() {
                                let echo = local_echo(&data);
                                if !echo.is_empty() {
                                    pending.get_or_insert_with(Vec::new).extend(echo);
                                }
                            }
                            telnet.encode(&data)
                        }
                        Some(Command::Resize { cols, rows }) => telnet.resize(cols, rows),
                        Some(Command::Close) | None => {
                            let _ = write.shutdown().await;
                            break;
                        }
                    };
                    if !wire.is_empty() && write.write_all(&wire).await.is_err() {
                        exit.error = Some(CONNECTION_LOST.into());
                        break;
                    }
                }
                read = read.read(&mut buf), if pending.is_none() => {
                    let n = match read {
                        Ok(0) => break,
                        Ok(n) => n,
                        Err(_) => {
                            exit.error = Some(CONNECTION_LOST.into());
                            break;
                        }
                    };
                    let mut out = Vec::new();
                    let mut reply = Vec::new();
                    telnet.receive(&buf[..n], &mut out, &mut reply);
                    if !reply.is_empty() && write.write_all(&reply).await.is_err() {
                        exit.error = Some(CONNECTION_LOST.into());
                        break;
                    }
                    if !out.is_empty() {
                        pending = Some(out);
                    }
                }
                permit = out_tx.reserve(), if pending.is_some() => {
                    let Ok(permit) = permit else { break };
                    if let Some(out) = pending.take() {
                        permit.send(out);
                    }
                }
                _ = async { ticker.as_mut().expect("guarded").tick().await }, if ticker.is_some() => {
                    if write.write_all(&[IAC, NOP]).await.is_err() {
                        exit.error = Some(CONNECTION_LOST.into());
                        break;
                    }
                }
            }
        }
        if let Some(out) = pending.take() {
            let _ = out_tx.send(out).await;
        }
        exit
    });

    let pump_credit = credit.clone();
    tokio::spawn(async move {
        pump::run(out_rx, pump_credit, config, sink).await;
        let exit = session.await.unwrap_or_else(|e| SessionExit {
            error: Some(e.to_string()),
            ..SessionExit::default()
        });
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
    use tokio::net::TcpListener;

    fn feed(t: &mut Telnet, input: &[u8]) -> (Vec<u8>, Vec<u8>) {
        let mut out = Vec::new();
        let mut reply = Vec::new();
        t.receive(input, &mut out, &mut reply);
        (out, reply)
    }

    #[test]
    fn strips_commands_and_unescapes_iac() {
        let mut t = Telnet::new("xterm", 80, 24);
        let (out, reply) = feed(&mut t, &[b'a', IAC, NOP, b'b', IAC, IAC, b'c', b'\r', 0, b'd']);
        assert_eq!(out, [b'a', b'b', IAC, b'c', b'\r', b'd']);
        assert!(reply.is_empty());
    }

    #[test]
    fn sequences_split_across_reads_are_parsed() {
        let mut t = Telnet::new("xterm", 80, 24);
        let (out, reply) = feed(&mut t, &[b'x', IAC]);
        assert_eq!(out, b"x");
        assert!(reply.is_empty());
        let (_, reply) = feed(&mut t, &[WILL]);
        assert!(reply.is_empty());
        let (out, reply) = feed(&mut t, &[ECHO, b'y']);
        assert_eq!(out, b"y");
        assert_eq!(reply, [IAC, DO, ECHO]);
        assert!(t.remote_echo());
    }

    #[test]
    fn negotiation_accepts_known_options_once_and_refuses_others() {
        let mut t = Telnet::new("xterm", 80, 24);
        let (_, reply) = feed(&mut t, &[IAC, DO, TTYPE, IAC, DO, TTYPE]);
        assert_eq!(reply, [IAC, WILL, TTYPE]);
        let (_, reply) = feed(&mut t, &[IAC, DO, 39, IAC, WILL, 5]);
        assert_eq!(reply, [IAC, WONT, 39, IAC, DONT, 5]);
        let (_, reply) = feed(&mut t, &[IAC, WILL, ECHO, IAC, WONT, ECHO, IAC, WONT, ECHO]);
        assert_eq!(reply, [IAC, DO, ECHO, IAC, DONT, ECHO]);
        assert!(!t.remote_echo());
    }

    #[test]
    fn greeting_offers_window_size_and_answers_terminal_type() {
        let mut t = Telnet::new("xterm-256color", 300, 50);
        let hello = t.greeting();
        assert!(hello.starts_with(&[IAC, WILL, NAWS, IAC, WILL, TTYPE, IAC, DO, SGA]));
        assert!(hello.ends_with(&[IAC, SB, NAWS, 1, 44, 0, 50, IAC, SE]));
        // Already offered, so the server's DO only gets a fresh size, not another WILL.
        let (_, reply) = feed(&mut t, &[IAC, DO, NAWS]);
        assert_eq!(reply, [IAC, SB, NAWS, 1, 44, 0, 50, IAC, SE]);
        let (_, reply) = feed(&mut t, &[IAC, SB, TTYPE, TTYPE_SEND, IAC, SE]);
        let mut expected = vec![IAC, SB, TTYPE, TTYPE_IS];
        expected.extend(b"xterm-256color");
        expected.extend([IAC, SE]);
        assert_eq!(reply, expected);
    }

    #[test]
    fn window_sizes_with_255_are_escaped() {
        let mut t = Telnet::new("xterm", 80, 24);
        assert!(t.resize(10, 10).is_empty(), "NAWS not agreed yet");
        feed(&mut t, &[IAC, DO, NAWS]);
        assert_eq!(t.resize(255, 24), [IAC, SB, NAWS, 0, IAC, IAC, 0, 24, IAC, SE]);
    }

    #[test]
    fn input_escapes_iac_and_pads_bare_cr_until_binary() {
        let mut t = Telnet::new("xterm", 80, 24);
        assert_eq!(t.encode(b"ls\r"), [b'l', b's', b'\r', 0]);
        assert_eq!(t.encode(b"a\r\nb"), b"a\r\nb");
        assert_eq!(t.encode(&[IAC]), [IAC, IAC]);
        feed(&mut t, &[IAC, DO, BINARY]);
        assert_eq!(t.encode(b"\r"), b"\r");
    }

    #[test]
    fn local_echo_turns_enter_into_newline_and_erases_backspace() {
        assert_eq!(local_echo(b"hi\r"), b"hi\r\n");
        assert_eq!(local_echo(&[b'a', 0x7f, 0x03]), b"a\x08 \x08");
    }

    #[tokio::test]
    async fn session_negotiates_echoes_and_reports_close() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let server = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut hello = [0u8; 9];
            socket.read_exact(&mut hello).await.unwrap();
            assert_eq!(hello, [IAC, WILL, NAWS, IAC, WILL, TTYPE, IAC, DO, SGA]);
            let mut size = [0u8; 9];
            socket.read_exact(&mut size).await.unwrap();
            assert_eq!(size, [IAC, SB, NAWS, 0, 100, 0, 30, IAC, SE]);
            socket.write_all(&[IAC, WILL, ECHO]).await.unwrap();
            socket.write_all(b"login: ").await.unwrap();
            let mut answer = [0u8; 3];
            socket.read_exact(&mut answer).await.unwrap();
            assert_eq!(answer, [IAC, DO, ECHO]);
            let mut typed = [0u8; 4];
            socket.read_exact(&mut typed).await.unwrap();
            assert_eq!(typed, [b'm', b'e', b'\r', 0]);
        });

        let (frames_tx, mut frames) = mpsc::unbounded_channel();
        let spawned = connect(
            TelnetOptions {
                host: "127.0.0.1".into(),
                port,
                term: "xterm".into(),
                connect_timeout: Duration::from_secs(5),
                keepalive: None,
                proxy: None,
                cols: 100,
                rows: 30,
            },
            PumpConfig::default(),
            move |frame| frames_tx.send(frame).is_ok(),
        )
        .await
        .unwrap();
        let mut seen = Vec::new();
        while !seen.ends_with(b"login: ") {
            let frame = frames.recv().await.unwrap();
            spawned.handle.ack(frame.len() as u64);
            seen.extend(frame);
        }
        spawned.handle.write(b"me\r".to_vec()).await.unwrap();
        server.await.unwrap();
        let exit = spawned.exit.await.unwrap();
        assert_eq!(exit, SessionExit::default(), "server closing is a normal end");
        while let Ok(frame) = frames.try_recv() {
            seen.extend(frame);
        }
        assert_eq!(seen, b"login: ", "the server echoes, so nothing is echoed locally");
    }
}
