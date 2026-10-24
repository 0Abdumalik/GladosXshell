//! Serial console sessions: a blocking reader thread feeds the pump, like the local PTY.

use std::io::{ErrorKind, Read};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serialport::{DataBits, FlowControl, SerialPort, SerialPortType, StopBits};
use tokio::sync::{mpsc, oneshot};

use crate::error::{Error, Result};
use crate::pump::{self, Credit, PumpConfig};
use crate::session::{COMMAND_QUEUE, Command, OUTPUT_QUEUE, SessionExit, SessionHandle, Spawned};

/// How often blocked reads and writes wake up to see whether the session was closed.
const POLL: Duration = Duration::from_millis(200);
pub fn port_lost() -> String {
    crate::tr!(
        "串口已断开（设备被拔出或出错）",
        "The serial port was disconnected (the device was unplugged or failed)",
        "تەرتىپلىك ئېغىز ئۈزۈلدى (ئۈسكۈنە سۇغۇرۇۋېلىندى ياكى خاتالىق كۆرۈلدى)"
    )
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum Parity {
    #[default]
    None,
    Odd,
    Even,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum Flow {
    #[default]
    None,
    Software,
    Hardware,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SerialSettings {
    /// `COM3` on Windows, `/dev/ttyUSB0` elsewhere.
    pub port: String,
    pub baud: u32,
    pub data_bits: u8,
    pub parity: Parity,
    pub stop_bits: u8,
    pub flow: Flow,
}

impl Default for SerialSettings {
    fn default() -> Self {
        Self {
            port: String::new(),
            baud: 115_200,
            data_bits: 8,
            parity: Parity::None,
            stop_bits: 1,
            flow: Flow::None,
        }
    }
}

impl SerialSettings {
    pub fn validate(&self) -> Result<()> {
        if self.port.trim().is_empty() {
            return Err(Error::invalid(crate::tr!("请选择串口", "Choose a serial port", "تەرتىپلىك ئېغىز تاللاڭ")));
        }
        if self.baud == 0 || self.baud > 4_000_000 {
            return Err(Error::invalid(crate::tr!(
                "波特率必须在 1 到 4000000 之间",
                "The baud rate must be between 1 and 4000000",
                "باۋد نىسبىتى 1 دىن 4000000 گىچە بولۇشى كېرەك"
            )));
        }
        if !(5..=8).contains(&self.data_bits) {
            return Err(Error::invalid(crate::tr!(
                "数据位必须是 5 到 8",
                "Data bits must be 5 to 8",
                "سانلىق مەلۇمات بىتى 5 تىن 8 گىچە بولۇشى كېرەك"
            )));
        }
        if !matches!(self.stop_bits, 1 | 2) {
            return Err(Error::invalid(crate::tr!(
                "停止位必须是 1 或 2",
                "Stop bits must be 1 or 2",
                "توختاش بىتى 1 ياكى 2 بولۇشى كېرەك"
            )));
        }
        Ok(())
    }

    fn builder(&self) -> serialport::SerialPortBuilder {
        let data_bits = match self.data_bits {
            5 => DataBits::Five,
            6 => DataBits::Six,
            7 => DataBits::Seven,
            _ => DataBits::Eight,
        };
        let parity = match self.parity {
            Parity::None => serialport::Parity::None,
            Parity::Odd => serialport::Parity::Odd,
            Parity::Even => serialport::Parity::Even,
        };
        let flow = match self.flow {
            Flow::None => FlowControl::None,
            Flow::Software => FlowControl::Software,
            Flow::Hardware => FlowControl::Hardware,
        };
        serialport::new(self.port.trim(), self.baud)
            .data_bits(data_bits)
            .parity(parity)
            .stop_bits(if self.stop_bits == 2 { StopBits::Two } else { StopBits::One })
            .flow_control(flow)
            .timeout(POLL)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PortInfo {
    pub name: String,
    /// What the device says it is, e.g. "CP2102 USB to UART"; empty when unknown.
    pub description: String,
}

pub fn list_ports() -> Result<Vec<PortInfo>> {
    let ports = serialport::available_ports().map_err(|e| {
        Error::Data(crate::tr!(
            "无法列出串口：{e}",
            "Cannot list serial ports: {e}",
            "تەرتىپلىك ئېغىزلارنى تىزالمىدى: {e}"
        ))
    })?;
    let mut list: Vec<PortInfo> = ports
        .into_iter()
        .map(|p| {
            let description = match p.port_type {
                SerialPortType::UsbPort(usb) => usb
                    .product
                    .or(usb.manufacturer)
                    .unwrap_or_else(|| format!("USB {:04x}:{:04x}", usb.vid, usb.pid)),
                SerialPortType::BluetoothPort => crate::tr!("蓝牙", "Bluetooth", "كۆكچىش"),
                SerialPortType::PciPort | SerialPortType::Unknown => String::new(),
            };
            PortInfo { name: p.port_name, description }
        })
        .collect();
    list.sort_by_key(|p| natural_key(&p.name));
    Ok(list)
}

/// COM2 before COM10.
fn natural_key(name: &str) -> (String, u64) {
    let digits = name.len() - name.trim_end_matches(|c: char| c.is_ascii_digit()).len();
    let (head, tail) = name.split_at(name.len() - digits);
    (head.to_owned(), tail.parse().unwrap_or(0))
}

fn open_error(port: &str, e: serialport::Error) -> Error {
    let port = crate::i18n::ltr(port);
    let detail = crate::i18n::ltr(&e.description);
    let message = match e.kind {
        serialport::ErrorKind::NoDevice | serialport::ErrorKind::Io(ErrorKind::NotFound) => crate::tr!(
            "找不到串口 {port}，请确认设备已连接",
            "Serial port {port} not found. Check that the device is connected",
            "{port} تەرتىپلىك ئېغىزى تېپىلمىدى، ئۈسكۈنىنىڭ ئۇلانغانلىقىنى جەزملەشتۈرۈڭ"
        ),
        serialport::ErrorKind::Io(ErrorKind::PermissionDenied) => crate::tr!(
            "无法打开串口 {port}：可能被其他程序占用，或没有权限",
            "Cannot open serial port {port}: another program may be using it, or there is no permission",
            "{port} تەرتىپلىك ئېغىزىنى ئاچالمىدى: باشقا پروگرامما ئىشلىتىۋاتقان ياكى ھوقۇق يوق بولۇشى مۇمكىن"
        ),
        serialport::ErrorKind::InvalidInput => crate::tr!(
            "串口 {port} 不支持这些参数：{detail}",
            "Serial port {port} does not support these settings: {detail}",
            "{port} تەرتىپلىك ئېغىزى بۇ پارامېتىرلارنى قوللىمايدۇ: {detail}"
        ),
        _ => crate::tr!(
            "无法打开串口 {port}：{detail}",
            "Cannot open serial port {port}: {detail}",
            "{port} تەرتىپلىك ئېغىزىنى ئاچالمىدى: {detail}"
        ),
    };
    Error::Connect(message)
}

/// Opens the port and starts the session. Must be called inside a Tokio runtime.
pub fn open<F>(settings: &SerialSettings, config: PumpConfig, sink: F) -> Result<Spawned>
where
    F: FnMut(Vec<u8>) -> bool + Send + 'static,
{
    settings.validate()?;
    let port = settings.port.trim();
    let mut reader = settings.builder().open().map_err(|e| open_error(port, e))?;
    let writer = reader.try_clone().map_err(|e| open_error(port, e))?;

    let (cmd_tx, cmd_rx) = mpsc::channel::<Command>(COMMAND_QUEUE);
    let (out_tx, out_rx) = mpsc::channel::<Vec<u8>>(OUTPUT_QUEUE);
    let (status_tx, status_rx) = oneshot::channel::<SessionExit>();
    let (exit_tx, exit_rx) = oneshot::channel();
    let credit = Arc::new(Credit::default());
    let closed = Arc::new(AtomicBool::new(false));

    let reader_closed = closed.clone();
    let lost_tx = cmd_tx.clone();
    std::thread::Builder::new().name("gxs-serial-read".into()).spawn(move || {
        let mut buf = vec![0u8; 16 * 1024];
        let mut exit = SessionExit::default();
        while !reader_closed.load(Ordering::Acquire) {
            match reader.read(&mut buf) {
                Ok(0) => {}
                Ok(n) => {
                    if out_tx.blocking_send(buf[..n].to_vec()).is_err() {
                        break;
                    }
                }
                Err(e) if matches!(e.kind(), ErrorKind::TimedOut | ErrorKind::Interrupted) => {}
                Err(_) => {
                    if !reader_closed.load(Ordering::Acquire) {
                        exit.error = Some(port_lost());
                    }
                    break;
                }
            }
        }
        let _ = status_tx.send(exit);
        // Lets the control thread drop its handle too, so the port is free to open again.
        let _ = lost_tx.blocking_send(Command::Close);
    })?;

    std::thread::Builder::new()
        .name("gxs-serial-ctl".into())
        .spawn(move || control(writer, cmd_rx, &closed))?;

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

fn control(mut port: Box<dyn SerialPort>, mut cmd_rx: mpsc::Receiver<Command>, closed: &AtomicBool) {
    while let Some(cmd) = cmd_rx.blocking_recv() {
        match cmd {
            Command::Write(data) => {
                if write_all(port.as_mut(), &data, closed).is_err() {
                    break;
                }
            }
            Command::Resize { .. } => {}
            Command::Close => break,
        }
    }
    closed.store(true, Ordering::Release);
}

/// A port held back by flow control times out instead of blocking forever; keep trying until closed.
fn write_all(port: &mut dyn SerialPort, mut data: &[u8], closed: &AtomicBool) -> std::io::Result<()> {
    while !data.is_empty() {
        if closed.load(Ordering::Acquire) {
            return Err(ErrorKind::BrokenPipe.into());
        }
        match port.write(data) {
            Ok(0) => return Err(ErrorKind::WriteZero.into()),
            Ok(n) => data = &data[n..],
            Err(e) if matches!(e.kind(), ErrorKind::TimedOut | ErrorKind::Interrupted) => {}
            Err(e) => return Err(e),
        }
    }
    port.flush()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn settings_default_to_115200_8n1_and_validate() {
        let s: SerialSettings = serde_json::from_str(r#"{"port":"COM3"}"#).unwrap();
        assert_eq!((s.baud, s.data_bits, s.parity, s.stop_bits, s.flow), (115_200, 8, Parity::None, 1, Flow::None));
        assert!(s.validate().is_ok());
        assert!(SerialSettings::default().validate().is_err(), "no port chosen");
        let bad = SerialSettings { port: "COM3".into(), stop_bits: 3, ..SerialSettings::default() };
        assert!(bad.validate().is_err());
        let json = serde_json::to_value(SerialSettings { flow: Flow::Hardware, ..s }).unwrap();
        assert_eq!(json["flow"], "hardware");
        assert_eq!(json["dataBits"], 8);
    }

    #[test]
    fn ports_sort_by_number() {
        let mut names = vec!["COM10", "COM2", "COM1"];
        names.sort_by_key(|n| natural_key(n));
        assert_eq!(names, ["COM1", "COM2", "COM10"]);
    }

    #[tokio::test]
    async fn missing_port_is_a_connect_error_naming_it() {
        let settings = SerialSettings { port: "COM249".into(), ..SerialSettings::default() };
        let Err(err) = open(&settings, PumpConfig::default(), |_| true) else {
            panic!("COM249 should not exist")
        };
        assert_eq!(err.kind(), "connect");
        assert!(err.to_string().contains("COM249"), "{err}");
    }

    #[test]
    fn listing_ports_works_without_devices() {
        assert!(list_ports().is_ok());
    }
}
