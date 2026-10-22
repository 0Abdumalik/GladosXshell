use std::time::Duration;

use gxs_core::pty::{self, PtyOptions};
use gxs_core::{PumpConfig, SessionExit, Spawned};
use tokio::sync::mpsc;

fn shell(script: &str) -> PtyOptions {
    let (program, args) = if cfg!(windows) {
        ("cmd.exe", vec!["/d".to_owned(), "/c".to_owned(), script.to_owned()])
    } else {
        ("/bin/sh", vec!["-c".to_owned(), script.to_owned()])
    };
    PtyOptions {
        program: Some(program.to_owned()),
        args,
        ..PtyOptions::default()
    }
}

fn interactive_shell() -> PtyOptions {
    let program = if cfg!(windows) { "cmd.exe" } else { "/bin/sh" };
    PtyOptions {
        program: Some(program.to_owned()),
        ..PtyOptions::default()
    }
}

/// Plays the terminal: acks every frame and answers ConPTY's cursor-position query.
async fn drive(spawned: Spawned, mut frames: mpsc::UnboundedReceiver<Vec<u8>>) -> (String, SessionExit) {
    let Spawned { handle, exit } = spawned;
    let mut out = Vec::new();
    let collect = async {
        while let Some(frame) = frames.recv().await {
            handle.ack(frame.len() as u64);
            if frame.windows(4).any(|w| w == b"\x1b[6n") {
                handle.write(b"\x1b[1;1R".to_vec()).await.ok();
            }
            out.extend_from_slice(&frame);
        }
    };
    let (_, exit) = tokio::time::timeout(Duration::from_secs(20), async { tokio::join!(collect, exit) })
        .await
        .expect("pty session timed out");
    (String::from_utf8_lossy(&out).into_owned(), exit.expect("exit status"))
}

fn start(options: PtyOptions) -> (Spawned, mpsc::UnboundedReceiver<Vec<u8>>) {
    let (tx, rx) = mpsc::unbounded_channel();
    let spawned = pty::spawn(options, PumpConfig::default(), move |f| tx.send(f).is_ok()).unwrap();
    (spawned, rx)
}

#[tokio::test(flavor = "multi_thread")]
async fn runs_command_and_reports_exit_code() {
    let (spawned, rx) = start(shell("echo gxs-hello && exit 3"));
    let (out, exit) = drive(spawned, rx).await;
    assert!(out.contains("gxs-hello"), "output was {out:?}");
    assert_eq!(exit.code, Some(3));
}

#[tokio::test(flavor = "multi_thread")]
async fn interactive_input_and_resize() {
    let (spawned, rx) = start(interactive_shell());
    let handle = spawned.handle.clone();
    handle.resize(120, 40).await.unwrap();
    handle.write(b"echo gxs-interactive\r".to_vec()).await.unwrap();
    handle.write(b"exit\r".to_vec()).await.unwrap();
    let (out, exit) = drive(spawned, rx).await;
    assert!(out.contains("gxs-interactive"), "output was {out:?}");
    assert_eq!(exit.code, Some(0));
}

#[tokio::test(flavor = "multi_thread")]
async fn close_kills_running_child() {
    let script = if cfg!(windows) {
        "ping -n 60 127.0.0.1"
    } else {
        "sleep 60"
    };
    let (spawned, rx) = start(shell(script));
    let handle = spawned.handle.clone();
    let closer = tokio::spawn(async move {
        tokio::time::sleep(Duration::from_millis(500)).await;
        handle.close().await;
    });
    let (_, exit) = drive(spawned, rx).await;
    closer.await.unwrap();
    assert_ne!(exit.code, Some(0));
}

#[tokio::test(flavor = "multi_thread")]
async fn bulk_output_is_complete_under_flow_control() {
    let script = if cfg!(windows) {
        "for /L %i in (1,1,3000) do @echo line-%i"
    } else {
        "i=1; while [ $i -le 3000 ]; do echo line-$i; i=$((i+1)); done"
    };
    let (spawned, rx) = start(shell(script));
    let (out, exit) = drive(spawned, rx).await;
    assert_eq!(exit.code, Some(0));
    assert!(
        out.contains("line-1\r\n") || out.contains("line-1\n"),
        "missing first line"
    );
    assert!(out.contains("line-3000"), "missing last line");
}
