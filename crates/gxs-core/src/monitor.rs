//! Server status for the side panel. Each tick runs one small POSIX `sh` script over the existing
//! SSH connection and reads `/proc` directly, so it works the same on full distributions and on
//! busybox systems such as OpenWrt (no `ps --sort`, no `free -b`, no bash).
//!
//! Parsing is pure and kept separate from polling so it can be tested against captured output.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use serde::Serialize;
use tokio::sync::watch;

use crate::ssh::SshClient;

const MARK: &str = "@@gxs:";
const TOP_N: usize = 20;
const DISK_EVERY: u32 = 10;
const EXEC_TIMEOUT: Duration = Duration::from_secs(10);

/// Single quotes are not allowed anywhere in the script: it is wrapped in `sh -c '...'` so it
/// runs under a POSIX shell even when the login shell is fish or csh.
const BASE_SCRIPT: &str = "export LC_ALL=C
echo @@gxs:uptime@@; cat /proc/uptime 2>/dev/null
echo @@gxs:loadavg@@; cat /proc/loadavg 2>/dev/null
echo @@gxs:stat@@; grep ^cpu /proc/stat 2>/dev/null || head -n 1 /proc/stat 2>/dev/null
echo @@gxs:meminfo@@; cat /proc/meminfo 2>/dev/null
echo @@gxs:netdev@@; cat /proc/net/dev 2>/dev/null
echo @@gxs:procs@@; cat /proc/[0-9]*/stat 2>/dev/null
echo @@gxs:status@@; for f in /proc/[0-9]*/status; do [ -r \"$f\" ] && echo \"$f\" && head -n 10 \"$f\" 2>/dev/null; done
echo @@gxs:connections@@; ss -tulpn 2>/dev/null || netstat -tulpn 2>/dev/null
";

const DISK_SCRIPT: &str = "echo @@gxs:df@@; df -kP 2>/dev/null || df -k 2>/dev/null
";

const SYSTEM_SCRIPT: &str = "echo @@gxs:hostname@@; cat /proc/sys/kernel/hostname 2>/dev/null || hostname 2>/dev/null
echo @@gxs:osrelease@@; cat /etc/os-release 2>/dev/null
echo @@gxs:uname@@; uname -srm 2>/dev/null
echo @@gxs:cpuinfo@@; cat /proc/cpuinfo 2>/dev/null
echo @@gxs:ncpu@@; grep -c \"^cpu[0-9]\" /proc/stat 2>/dev/null
echo @@gxs:pagesize@@; getconf PAGESIZE 2>/dev/null
echo @@gxs:clktck@@; getconf CLK_TCK 2>/dev/null
echo @@gxs:virt@@; systemd-detect-virt 2>/dev/null
echo @@gxs:passwd@@; cat /etc/passwd 2>/dev/null
";

/// Only for sessions shown in an advanced window. NUL and newline in a command line become spaces,
/// so every process takes exactly one line after its path.
const DETAIL_SCRIPT: &str = "echo @@gxs:cmdline@@; for f in /proc/[0-9]*/cmdline; do [ -r \"$f\" ] && echo \"$f\" && head -c 512 \"$f\" 2>/dev/null | tr \"\\000\\n\" \"  \"; echo; done
echo @@gxs:who@@; who 2>/dev/null
";

const DETAIL_DISK_SCRIPT: &str = "echo @@gxs:dfi@@; df -iP 2>/dev/null
echo @@gxs:mounts@@; cat /proc/mounts 2>/dev/null
";

/// How much a session's poller collects.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub enum Mode {
    #[default]
    Off,
    Basic,
    /// Every process with its command line, inodes, filesystem types and logged-in users.
    Detailed,
}

pub fn script(disks: bool, system: bool, detailed: bool) -> String {
    let mut body = String::from(BASE_SCRIPT);
    if disks {
        body.push_str(DISK_SCRIPT);
        if detailed {
            body.push_str(DETAIL_DISK_SCRIPT);
        }
    }
    if detailed {
        body.push_str(DETAIL_SCRIPT);
    }
    if system {
        body.push_str(SYSTEM_SCRIPT);
    }
    debug_assert!(!body.contains('\''));
    format!("sh -c '{body}'")
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Serialize)]
pub struct Usage {
    pub used: u64,
    pub total: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Process {
    pub pid: u32,
    pub name: String,
    pub cpu_percent: Option<f64>,
    pub mem_bytes: u64,
    pub state: String,
    pub ppid: u32,
    pub uid: u32,
    /// From `/etc/passwd`, or the uid when the name is unknown.
    pub user: String,
    pub threads: u32,
    pub nice: i32,
    /// Seconds after boot.
    pub start_secs: u64,
    /// Only in detailed mode; `None` for kernel threads.
    pub cmdline: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoginUser {
    pub name: String,
    pub tty: String,
    pub from: String,
    pub since: String,
}

/// Bytes, straight from `/proc/meminfo`. `cached` includes reclaimable slab, as `free` shows it.
#[derive(Debug, Clone, Copy, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryDetail {
    pub total: u64,
    pub free: u64,
    pub available: u64,
    pub buffers: u64,
    pub cached: u64,
    pub shmem: u64,
    pub swap_total: u64,
    pub swap_free: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NetRate {
    pub name: String,
    pub rx_total: u64,
    pub tx_total: u64,
    /// Bytes per second; `None` on the first sample.
    pub rx_rate: Option<f64>,
    pub tx_rate: Option<f64>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Disk {
    pub filesystem: String,
    pub mount: String,
    pub total: u64,
    pub avail: u64,
    /// The next three only in detailed mode.
    pub fs_type: Option<String>,
    pub inodes_total: Option<u64>,
    pub inodes_used: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkConnection {
    pub proto: String,
    pub local_addr: String,
    pub remote_addr: String,
    pub state: String,
    pub pid: Option<u32>,
    pub program: String,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemInfo {
    pub hostname: String,
    pub os: String,
    pub kernel: String,
    pub arch: String,
    pub cpu_model: String,
    /// Logical CPUs.
    pub cpu_cores: u32,
    /// Physical cores across all sockets, when `/proc/cpuinfo` says.
    pub cpu_physical: Option<u32>,
    pub cpu_sockets: Option<u32>,
    pub cpu_mhz: Option<f64>,
    /// `systemd-detect-virt` output (`none` on bare metal); empty when unavailable.
    pub virtualization: String,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatusSnapshot {
    pub address: String,
    /// The host has no Linux `/proc`; nothing else is populated.
    pub unsupported: bool,
    pub error: Option<String>,
    pub uptime_secs: u64,
    pub load: [f64; 3],
    pub cpu_percent: Option<f64>,
    /// Per logical CPU; `None` on the first sample.
    pub cpu_cores: Option<Vec<f64>>,
    pub mem: Usage,
    pub swap: Usage,
    pub memory: MemoryDetail,
    /// Top processes in basic mode, all of them in detailed mode.
    pub processes: Vec<Process>,
    pub process_total: u32,
    pub thread_total: u32,
    /// Only in detailed mode.
    pub users: Option<Vec<LoginUser>>,
    pub net: Vec<NetRate>,
    pub latency_ms: Option<f64>,
    /// Only on ticks where disks were sampled.
    pub disks: Option<Vec<Disk>>,
    /// Only on the first successful tick.
    pub system: Option<SystemInfo>,
    /// Network connections (listening ports and established connections).
    pub connections: Option<Vec<NetworkConnection>>,
}

pub fn sections(output: &str) -> HashMap<&str, &str> {
    let mut map = HashMap::new();
    let mut current: Option<(&str, usize)> = None;
    let mut offset = 0;
    for line in output.split_inclusive('\n') {
        let trimmed = line.trim_end();
        if let Some(name) = trimmed.strip_prefix(MARK).and_then(|r| r.strip_suffix("@@")) {
            if let Some((prev, start)) = current {
                map.insert(prev, &output[start..offset]);
            }
            current = Some((name, offset + line.len()));
        }
        offset += line.len();
    }
    if let Some((prev, start)) = current {
        map.insert(prev, &output[start..]);
    }
    map
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CpuTimes {
    pub total: u64,
    pub idle: u64,
}

fn cpu_line(line: &str) -> Option<CpuTimes> {
    let values: Vec<u64> = line.split_whitespace().skip(1).map_while(|v| v.parse().ok()).collect();
    if values.len() < 4 {
        return None;
    }
    // guest/guest_nice are already counted in user/nice.
    let total = values.iter().take(8).sum();
    let idle = values[3] + values.get(4).copied().unwrap_or(0);
    Some(CpuTimes { total, idle })
}

pub fn parse_cpu(stat: &str) -> Option<CpuTimes> {
    cpu_line(stat.lines().find(|l| l.starts_with("cpu "))?)
}

/// The `cpuN` lines, in order.
pub fn parse_cores(stat: &str) -> Vec<CpuTimes> {
    stat.lines()
        .filter(|l| l.strip_prefix("cpu").is_some_and(|r| r.starts_with(|c: char| c.is_ascii_digit())))
        .filter_map(cpu_line)
        .collect()
}

fn busy_percent(now: CpuTimes, prev: CpuTimes) -> Option<f64> {
    let total = now.total.saturating_sub(prev.total);
    percent(total.saturating_sub(now.idle.saturating_sub(prev.idle)), total)
}

pub fn parse_uptime(text: &str) -> Option<f64> {
    text.split_whitespace().next()?.parse().ok()
}

pub fn parse_load(text: &str) -> [f64; 3] {
    let mut it = text.split_whitespace().map(|v| v.parse().unwrap_or(0.0));
    [
        it.next().unwrap_or(0.0),
        it.next().unwrap_or(0.0),
        it.next().unwrap_or(0.0),
    ]
}

pub fn parse_memory(text: &str) -> MemoryDetail {
    let mut kb: HashMap<&str, u64> = HashMap::new();
    for line in text.lines() {
        if let Some((key, rest)) = line.split_once(':')
            && let Some(value) = rest.split_whitespace().next().and_then(|v| v.parse().ok())
        {
            kb.insert(key.trim(), value);
        }
    }
    let get = |k: &str| kb.get(k).copied().unwrap_or(0);
    let cached = get("Cached") + get("SReclaimable");
    // Kernels before 3.14 have no MemAvailable; approximate it the way `free` does.
    let available = kb
        .get("MemAvailable")
        .copied()
        .unwrap_or_else(|| (get("MemFree") + get("Buffers") + cached).saturating_sub(get("Shmem")));
    MemoryDetail {
        total: get("MemTotal") * 1024,
        free: get("MemFree") * 1024,
        available: available * 1024,
        buffers: get("Buffers") * 1024,
        cached: cached * 1024,
        shmem: get("Shmem") * 1024,
        swap_total: get("SwapTotal") * 1024,
        swap_free: get("SwapFree") * 1024,
    }
}

impl MemoryDetail {
    pub fn usage(&self) -> (Usage, Usage) {
        let mem = Usage {
            used: self.total.saturating_sub(self.available),
            total: self.total,
        };
        let swap = Usage {
            used: self.swap_total.saturating_sub(self.swap_free),
            total: self.swap_total,
        };
        (mem, swap)
    }
}

pub fn parse_meminfo(text: &str) -> (Usage, Usage) {
    parse_memory(text).usage()
}

pub fn parse_netdev(text: &str) -> Vec<(String, u64, u64)> {
    text.lines()
        .filter_map(|line| {
            let (name, rest) = line.split_once(':')?;
            let name = name.trim();
            if name.is_empty() || name.contains('|') {
                return None;
            }
            let fields: Vec<u64> = rest.split_whitespace().map_while(|v| v.parse().ok()).collect();
            (fields.len() >= 9).then(|| (name.to_owned(), fields[0], fields[8]))
        })
        .collect()
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RawProcess {
    pub pid: u32,
    pub name: String,
    pub ticks: u64,
    pub rss_pages: u64,
    pub state: String,
    pub ppid: u32,
    pub threads: u32,
    pub nice: i32,
    /// Clock ticks after boot.
    pub start_ticks: u64,
}

/// `/proc/<pid>/stat` lines. The command name sits in parentheses and may itself contain spaces
/// and parentheses, so the fixed fields are located from the *last* `)`.
pub fn parse_procs(text: &str) -> Vec<RawProcess> {
    text.lines()
        .filter_map(|line| {
            let open = line.find('(')?;
            let close = line.rfind(')')?;
            if close < open {
                return None;
            }
            let pid = line[..open].trim().parse().ok()?;
            let name = line[open + 1..close].to_owned();
            let rest: Vec<&str> = line[close + 1..].split_whitespace().collect();
            // rest[n - 3] is field n: 3 state, 4 ppid, 14/15 utime/stime, 19 nice, 20 threads,
            // 22 starttime, 24 rss.
            let state = rest.first()?.to_string();
            let ppid: u32 = rest.get(1)?.parse().ok()?;
            let utime: u64 = rest.get(11)?.parse().ok()?;
            let stime: u64 = rest.get(12)?.parse().ok()?;
            let nice: i32 = rest.get(16)?.parse().ok()?;
            let threads: u32 = rest.get(17)?.parse().ok()?;
            let start_ticks: u64 = rest.get(19)?.parse().ok()?;
            let rss: i64 = rest.get(21)?.parse().ok()?;
            Some(RawProcess {
                pid,
                name,
                ticks: utime + stime,
                rss_pages: u64::try_from(rss).unwrap_or(0),
                state,
                ppid,
                threads,
                nice,
                start_ticks,
            })
        })
        .collect()
}

/// Parses `/proc/[pid]/status` output to extract UIDs. The input is multiple status files
/// concatenated with their paths as markers (e.g., "/proc/123/status\nUid:\t1000\t...\n").
pub fn parse_status_files(text: &str) -> HashMap<u32, u32> {
    let mut map = HashMap::new();
    let mut current_pid: Option<u32> = None;
    for line in text.lines() {
        if let Some(path) = line.strip_prefix("/proc/") {
            if let Some(pid_str) = path.split('/').next() {
                current_pid = pid_str.parse().ok();
            }
        } else if let Some(rest) = line.strip_prefix("Uid:")
            && let Some(pid) = current_pid
            && let Some(uid_str) = rest.split_whitespace().next()
            && let Ok(uid) = uid_str.parse()
        {
            map.insert(pid, uid);
        }
    }
    map
}

struct DfRow {
    filesystem: String,
    values: [u64; 3],
    mount: String,
}

/// Rows of `df -P` or `df -iP`: filesystem, three numbers, a percentage and the mount point.
fn df_rows(text: &str) -> Vec<DfRow> {
    let mut rows = Vec::new();
    let mut pending: Option<String> = None;
    for line in text.lines().skip(1) {
        let mut fields: Vec<&str> = line.split_whitespace().collect();
        // Non-POSIX df wraps a long device name onto its own line.
        let joined;
        if let Some(fs) = pending.take() {
            joined = fs;
            fields.insert(0, &joined);
        }
        if fields.len() == 1 {
            pending = Some(fields[0].to_owned());
            continue;
        }
        if fields.len() < 6 {
            continue;
        }
        let (Ok(a), Ok(b), Ok(c)) = (fields[1].parse(), fields[2].parse(), fields[3].parse()) else {
            continue;
        };
        rows.push(DfRow {
            filesystem: fields[0].to_owned(),
            values: [a, b, c],
            // Mount points may contain spaces.
            mount: fields[5..].join(" "),
        });
    }
    rows
}

pub fn parse_df(text: &str) -> Vec<Disk> {
    df_rows(text)
        .into_iter()
        .filter(|row| row.values[0] > 0)
        .map(|row| Disk {
            filesystem: row.filesystem,
            mount: row.mount,
            total: row.values[0] * 1024,
            avail: row.values[2] * 1024,
            fs_type: None,
            inodes_total: None,
            inodes_used: None,
        })
        .collect()
}

/// `df -iP`: mount point to (inodes, used inodes). Filesystems without inodes report zero.
fn parse_inodes(text: &str) -> HashMap<String, (u64, u64)> {
    df_rows(text)
        .into_iter()
        .filter(|row| row.values[0] > 0)
        .map(|row| (row.mount, (row.values[0], row.values[1])))
        .collect()
}

/// `/proc/mounts` escapes space, tab, newline and backslash as three-digit octal.
fn unescape_mount(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'\\'
            && let Some(code) = value.get(i + 1..i + 4).and_then(|o| u8::from_str_radix(o, 8).ok())
        {
            out.push(code);
            i += 4;
            continue;
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Mount point to filesystem type; a later mount over the same point wins.
fn parse_mounts(text: &str) -> HashMap<String, String> {
    text.lines()
        .filter_map(|line| {
            let mut f = line.split_whitespace();
            let (_, mount, kind) = (f.next()?, f.next()?, f.next()?);
            Some((unescape_mount(mount), kind.to_owned()))
        })
        .collect()
}

fn parse_passwd(text: &str) -> HashMap<u32, String> {
    text.lines()
        .filter_map(|line| {
            let mut f = line.split(':');
            let name = f.next()?;
            let uid = f.nth(1)?.parse().ok()?;
            (!name.is_empty()).then(|| (uid, name.to_owned()))
        })
        .collect()
}

/// Pairs of `/proc/<pid>/cmdline` and the command line on the next line.
fn parse_cmdlines(text: &str) -> HashMap<u32, String> {
    let mut map = HashMap::new();
    let mut current = None;
    for line in text.lines() {
        let pid = line
            .strip_prefix("/proc/")
            .and_then(|r| r.strip_suffix("/cmdline"))
            .and_then(|p| p.parse::<u32>().ok());
        if pid.is_some() {
            current = pid;
            continue;
        }
        if let Some(pid) = current.take() {
            let value = line.trim();
            if !value.is_empty() {
                map.insert(pid, value.to_owned());
            }
        }
    }
    map
}

/// `who`: `name tty date time [(host)]`. Busybox prints a header and an idle column instead;
/// those rows still give the name and tty.
fn parse_who(text: &str) -> Vec<LoginUser> {
    text.lines()
        .filter_map(|line| {
            let f: Vec<&str> = line.split_whitespace().collect();
            if f.len() < 2 || f[0] == "USER" {
                return None;
            }
            let host = f
                .last()
                .and_then(|l| l.strip_prefix('('))
                .and_then(|l| l.strip_suffix(')'))
                .filter(|_| f.len() > 2);
            let end = if host.is_some() { f.len() - 1 } else { f.len() };
            Some(LoginUser {
                name: f[0].to_owned(),
                tty: f[1].to_owned(),
                from: host.unwrap_or("").to_owned(),
                since: f.get(2..end).map(|r| r.join(" ")).unwrap_or_default(),
            })
        })
        .collect()
}

fn unquote(value: &str) -> &str {
    let v = value.trim();
    v.strip_prefix('"')
        .and_then(|v| v.strip_suffix('"'))
        .or_else(|| v.strip_prefix('\'').and_then(|v| v.strip_suffix('\'')))
        .unwrap_or(v)
}

pub fn parse_system(s: &HashMap<&str, &str>) -> (SystemInfo, u64) {
    let get = |k: &str| s.get(k).copied().unwrap_or("");
    let release: HashMap<&str, &str> = get("osrelease")
        .lines()
        .filter_map(|l| l.split_once('='))
        .map(|(k, v)| (k.trim(), unquote(v)))
        .collect();
    let os = release
        .get("PRETTY_NAME")
        .map(|v| (*v).to_owned())
        .or_else(|| {
            release.get("NAME").map(|n| {
                format!("{n} {}", release.get("VERSION").unwrap_or(&""))
                    .trim()
                    .to_owned()
            })
        })
        .unwrap_or_default();

    let uname = get("uname").trim();
    let (kernel, arch) = match uname.rsplit_once(' ') {
        Some((k, a)) => (k.to_owned(), a.to_owned()),
        None => (uname.to_owned(), String::new()),
    };

    let cpuinfo: Vec<(&str, &str)> = get("cpuinfo")
        .lines()
        .filter_map(|l| l.split_once(':'))
        .map(|(k, v)| (k.trim(), v.trim()))
        .collect();
    let cpu_model = ["model name", "cpu model", "Model", "Hardware", "Processor"]
        .iter()
        .find_map(|key| {
            cpuinfo
                .iter()
                .find(|(k, v)| k == key && !v.is_empty())
                .map(|(_, v)| (*v).to_owned())
        })
        .unwrap_or_default();
    let cpu_cores = get("ncpu")
        .trim()
        .parse()
        .ok()
        .filter(|n| *n > 0)
        .unwrap_or_else(|| cpuinfo.iter().filter(|(k, _)| *k == "processor").count().max(1) as u32);

    // x86 lists "physical id" and "cpu cores" per logical CPU; other architectures omit them.
    let sockets: std::collections::HashSet<&str> =
        cpuinfo.iter().filter(|(k, _)| *k == "physical id").map(|(_, v)| *v).collect();
    let per_socket: Option<u32> = cpuinfo.iter().find(|(k, _)| *k == "cpu cores").and_then(|(_, v)| v.parse().ok());
    let cpu_sockets = (!sockets.is_empty()).then_some(sockets.len() as u32);
    let cpu_physical = per_socket.map(|n| n * cpu_sockets.unwrap_or(1));
    let cpu_mhz = cpuinfo
        .iter()
        .find(|(k, _)| *k == "cpu MHz")
        .and_then(|(_, v)| v.parse().ok());

    let page_size = get("pagesize").trim().parse().ok().filter(|p| *p > 0).unwrap_or(4096);
    let info = SystemInfo {
        hostname: get("hostname").trim().to_owned(),
        os,
        kernel,
        arch,
        cpu_model,
        cpu_cores,
        cpu_physical,
        cpu_sockets,
        cpu_mhz,
        virtualization: get("virt").trim().to_owned(),
    };
    (info, page_size)
}

/// Previous sample, for turning counters into rates.
#[derive(Debug, Default)]
pub struct MonitorState {
    page_size: u64,
    clk_tck: u64,
    users: HashMap<u32, String>,
    uptime: Option<f64>,
    cpu: Option<CpuTimes>,
    cores: Vec<CpuTimes>,
    procs: HashMap<u32, u64>,
    net: HashMap<String, (u64, u64)>,
}

fn percent(part: u64, whole: u64) -> Option<f64> {
    (whole > 0).then(|| (part as f64 / whole as f64 * 100.0).clamp(0.0, 100.0))
}

impl MonitorState {
    /// Forget previous counters so the next sample does not average over a paused period.
    pub fn reset_rates(&mut self) {
        self.uptime = None;
        self.cpu = None;
        self.cores.clear();
        self.procs.clear();
        self.net.clear();
    }

    pub fn update(&mut self, output: &str) -> StatusSnapshot {
        let s = sections(output);
        let mut snap = StatusSnapshot::default();

        if s.contains_key("pagesize") {
            let (info, page_size) = parse_system(&s);
            self.page_size = page_size;
            snap.system = Some(info);
            self.clk_tck = s.get("clktck").and_then(|t| t.trim().parse().ok()).unwrap_or(0);
            self.users = parse_passwd(s.get("passwd").unwrap_or(&""));
        }
        if self.page_size == 0 {
            self.page_size = 4096;
        }
        if self.clk_tck == 0 {
            self.clk_tck = 100;
        }

        let Some(cpu) = s.get("stat").and_then(|t| parse_cpu(t)) else {
            snap.unsupported = true;
            return snap;
        };
        let uptime = s.get("uptime").and_then(|t| parse_uptime(t)).unwrap_or(0.0);
        snap.uptime_secs = uptime as u64;
        snap.load = parse_load(s.get("loadavg").unwrap_or(&""));
        snap.memory = parse_memory(s.get("meminfo").unwrap_or(&""));
        (snap.mem, snap.swap) = snap.memory.usage();

        let cpu_delta = self
            .cpu
            .map(|prev| (cpu.total.saturating_sub(prev.total), cpu.idle.saturating_sub(prev.idle)));
        snap.cpu_percent = cpu_delta.and_then(|(total, idle)| percent(total.saturating_sub(idle), total));
        let cores = parse_cores(s.get("stat").unwrap_or(&""));
        if !cores.is_empty() && cores.len() == self.cores.len() {
            snap.cpu_cores = Some(
                cores
                    .iter()
                    .zip(&self.cores)
                    .map(|(now, prev)| busy_percent(*now, *prev).unwrap_or(0.0))
                    .collect(),
            );
        }
        self.cores = cores;

        let procs = parse_procs(s.get("procs").unwrap_or(&""));
        let uid_map = parse_status_files(s.get("status").unwrap_or(&""));
        let detailed = s.contains_key("cmdline");
        let mut cmdlines = parse_cmdlines(s.get("cmdline").unwrap_or(&""));
        let mut all: Vec<Process> = procs
            .iter()
            .map(|p| {
                let uid = uid_map.get(&p.pid).copied().unwrap_or(0);
                Process {
                    pid: p.pid,
                    name: p.name.clone(),
                    cpu_percent: cpu_delta.and_then(|(total, _)| {
                        // A pid first seen now was born during the interval; count all its ticks.
                        let prev = self.procs.get(&p.pid).copied().unwrap_or(0);
                        percent(p.ticks.saturating_sub(prev), total)
                    }),
                    mem_bytes: p.rss_pages * self.page_size,
                    state: p.state.clone(),
                    ppid: p.ppid,
                    uid,
                    user: self.users.get(&uid).cloned().unwrap_or_else(|| uid.to_string()),
                    threads: p.threads,
                    nice: p.nice,
                    start_secs: p.start_ticks / self.clk_tck,
                    cmdline: cmdlines.remove(&p.pid),
                }
            })
            .collect();
        self.procs = procs.iter().map(|p| (p.pid, p.ticks)).collect();
        snap.process_total = procs.len() as u32;
        snap.thread_total = procs.iter().map(|p| p.threads).sum();
        snap.processes = if detailed {
            sort_by_cpu(&mut all);
            all
        } else {
            top_processes(&mut all)
        };
        snap.users = s.get("who").map(|t| parse_who(t));

        let dt = self.uptime.map(|prev| uptime - prev).filter(|dt| *dt > 0.0);
        let net = parse_netdev(s.get("netdev").unwrap_or(&""));
        snap.net = net
            .iter()
            .map(|(name, rx, tx)| {
                let prev = self.net.get(name);
                let rate = |now: u64, before: Option<u64>| Some(now.saturating_sub(before?) as f64 / dt?);
                NetRate {
                    name: name.clone(),
                    rx_total: *rx,
                    tx_total: *tx,
                    rx_rate: rate(*rx, prev.map(|p| p.0)),
                    tx_rate: rate(*tx, prev.map(|p| p.1)),
                }
            })
            .collect();
        self.net = net.into_iter().map(|(n, rx, tx)| (n, (rx, tx))).collect();

        snap.disks = s.get("df").map(|t| {
            let mut disks = parse_df(t);
            let inodes = s.get("dfi").map(|t| parse_inodes(t)).unwrap_or_default();
            let types = s.get("mounts").map(|t| parse_mounts(t)).unwrap_or_default();
            for disk in &mut disks {
                disk.fs_type = types.get(&disk.mount).cloned();
                if let Some((total, used)) = inodes.get(&disk.mount) {
                    disk.inodes_total = Some(*total);
                    disk.inodes_used = Some(*used);
                }
            }
            disks
        });
        snap.connections = s.get("connections").map(|t| parse_connections(t));
        self.cpu = Some(cpu);
        self.uptime = Some(uptime);
        snap
    }
}

/// `users:(("sshd",pid=812,fd=3),...)` from ss; only the first process is kept.
fn ss_process(field: &str) -> (Option<u32>, String) {
    let Some(rest) = field.strip_prefix("users:((\"") else {
        return (None, String::new());
    };
    let Some(end) = rest.find('"') else {
        return (None, String::new());
    };
    let pid = rest[end..].find("pid=").and_then(|start| {
        let digits = &rest[end + start + 4..];
        let len = digits.find(|c: char| !c.is_ascii_digit()).unwrap_or(digits.len());
        digits[..len].parse().ok()
    });
    (pid, rest[..end].to_string())
}

/// `812/sshd` from netstat, or `-` when the process is not visible.
fn netstat_process(field: &str) -> (Option<u32>, String) {
    match field.split_once('/') {
        Some((pid, name)) => (pid.parse().ok(), name.trim().to_string()),
        None => (None, String::new()),
    }
}

/// Listening sockets from `ss -tulpn` (Netid State Recv-Q Send-Q Local Peer Process) or, as a
/// fallback, `netstat -tulpn` (Proto Recv-Q Send-Q Local Foreign [State] PID/Program).
fn parse_connections(text: &str) -> Vec<NetworkConnection> {
    let mut lines = text.lines();
    let mut ss = None;
    for line in lines.by_ref() {
        let head = line.trim_start();
        if head.starts_with("Netid") {
            ss = Some(true);
            break;
        }
        if head.starts_with("Proto") {
            ss = Some(false);
            break;
        }
    }
    let Some(ss) = ss else {
        return Vec::new();
    };

    let mut connections = Vec::new();
    for line in lines {
        let f: Vec<&str> = line.split_whitespace().collect();
        if f.len() < 5 {
            continue;
        }
        let rest = |from: usize| f.get(from..).map(|r| r.join(" ")).unwrap_or_default();
        let (state, local, remote, (pid, program)) = if ss {
            (f[1], f[4], f.get(5).copied().unwrap_or(""), ss_process(&rest(6)))
        } else if f[0].starts_with("tcp") {
            (f.get(5).copied().unwrap_or(""), f[3], f[4], netstat_process(&rest(6)))
        } else {
            ("", f[3], f[4], netstat_process(&rest(5)))
        };
        connections.push(NetworkConnection {
            proto: f[0].to_string(),
            local_addr: local.to_string(),
            remote_addr: remote.to_string(),
            state: state.to_string(),
            pid,
            program,
        });
    }
    connections
}

/// Union of the top N by CPU and the top N by memory, so the UI can sort by either column.
fn sort_by_cpu(all: &mut [Process]) {
    all.sort_by(|a, b| {
        b.cpu_percent
            .unwrap_or(0.0)
            .total_cmp(&a.cpu_percent.unwrap_or(0.0))
            .then(b.mem_bytes.cmp(&a.mem_bytes))
    });
}

fn top_processes(all: &mut [Process]) -> Vec<Process> {
    let mut keep = std::collections::HashSet::new();
    all.sort_by(|a, b| b.mem_bytes.cmp(&a.mem_bytes));
    keep.extend(all.iter().take(TOP_N).map(|p| p.pid));
    sort_by_cpu(all);
    keep.extend(all.iter().take(TOP_N).map(|p| p.pid));
    all.iter().filter(|p| keep.contains(&p.pid)).cloned().collect()
}

pub struct MonitorHandle {
    mode: watch::Sender<Mode>,
}

impl MonitorHandle {
    pub fn set_mode(&self, mode: Mode) {
        self.mode
            .send_if_modified(|current| std::mem::replace(current, mode) != mode);
    }
}

/// Polls until the connection closes, `sink` returns `false`, or the handle is dropped.
pub fn spawn<F>(client: Arc<SshClient>, interval: Duration, mode: Mode, mut sink: F) -> MonitorHandle
where
    F: FnMut(StatusSnapshot) -> bool + Send + 'static,
{
    let (mode_tx, mut mode_rx) = watch::channel(mode);
    let address = client.peer().map(|a| a.ip().to_string()).unwrap_or_default();
    tokio::spawn(async move {
        let mut state = MonitorState::default();
        let mut need_system = true;
        let mut tick: u32 = 0;
        let mut last_mode = Mode::Off;
        loop {
            let mode = *mode_rx.borrow_and_update();
            if mode == Mode::Off {
                if mode_rx.changed().await.is_err() {
                    break;
                }
                state.reset_rates();
                continue;
            }
            if mode != last_mode {
                // Sample disks right away so inodes and types show up when a detailed view opens.
                if mode == Mode::Detailed {
                    tick = 0;
                }
                last_mode = mode;
            }
            if client.is_closed() {
                break;
            }
            let started = tokio::time::Instant::now();
            let disks = tick.is_multiple_of(DISK_EVERY);
            let command = script(disks, need_system, mode == Mode::Detailed);
            let (output, latency) =
                tokio::join!(tokio::time::timeout(EXEC_TIMEOUT, client.exec(&command)), client.ping());
            let mut snap = match output {
                Ok(Ok(out)) => {
                    let snap = state.update(&String::from_utf8_lossy(&out.stdout));
                    if snap.system.is_some() {
                        need_system = false;
                    }
                    tick = tick.wrapping_add(1);
                    snap
                }
                Ok(Err(e)) => StatusSnapshot {
                    error: Some(e.to_string()),
                    ..StatusSnapshot::default()
                },
                Err(_) => StatusSnapshot {
                    error: Some(crate::tr!(
                        "读取状态的命令超时，服务器可能负载过高或网络很慢",
                        "The status command timed out. The server may be overloaded, or the network may be slow",
                        "ھالەت ئوقۇش بۇيرۇقىنىڭ ۋاقتى ئېشىپ كەتتى، مۇلازىمېتىرنىڭ يۈكى بەك ئېغىر ياكى تور بەك ئاستا بولۇشى مۇمكىن"
                    )),
                    ..StatusSnapshot::default()
                },
            };
            if client.is_closed() {
                break;
            }
            snap.address.clone_from(&address);
            snap.latency_ms = latency.ok().map(|d| d.as_secs_f64() * 1000.0);
            if !sink(snap) {
                break;
            }
            tokio::select! {
                _ = tokio::time::sleep_until(started + interval) => {}
                changed = mode_rx.changed() => if changed.is_err() { break },
            }
        }
    });
    MonitorHandle { mode: mode_tx }
}

#[cfg(test)]
mod tests {
    use super::*;

    const UBUNTU_1: &str = "@@gxs:uptime@@
350735.47 2765439.12
@@gxs:loadavg@@
0.36 0.25 0.25 2/412 98765
@@gxs:stat@@
cpu  1000 20 300 8000 100 0 30 0 0 0
cpu0 500 10 150 4000 50 0 15 0 0 0
cpu1 500 10 150 4000 50 0 15 0 0 0
@@gxs:meminfo@@
MemTotal:        2009536 kB
MemFree:          120000 kB
MemAvailable:    1487256 kB
Buffers:           50000 kB
Cached:           900000 kB
SwapTotal:       1048572 kB
SwapFree:        1048572 kB
@@gxs:netdev@@
Inter-|   Receive                                                |  Transmit
 face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed
    lo:  1000      10    0    0    0     0          0         0     1000      10    0    0    0     0       0          0
  eth0:5000000   4000    0    0    0     0          0         0  2000000   3000    0    0    0     0       0          0
@@gxs:procs@@
1 (systemd) S 0 1 1 0 -1 4194560 1 1 0 0 50 30 0 0 20 0 1 0 1 170000000 3000 18446744073709551615
812 (tmux: server) S 1 812 812 0 -1 4194560 1 1 0 0 10 5 0 0 20 0 1 0 1 10000000 1200 18446744073709551615
900 (a) b (c)) R 1 900 900 0 -1 4194560 1 1 0 0 100 0 0 0 20 0 1 0 1 10000000 500 18446744073709551615
2 (kthreadd) S 0 0 0 0 -1 2129984 0 0 0 0 0 0 0 0 20 0 1 0 1 0 0 18446744073709551615
@@gxs:df@@
Filesystem     1024-blocks    Used Available Capacity Mounted on
/dev/sda1         20510332 1200000  18244000       7% /
tmpfs              1004768       0   1004768       0% /dev/shm
none                     0       0         0       - /sys/fs/bpf
/dev/sdb1         10000000 5000000   5000000      50% /mnt/my data
@@gxs:hostname@@
web-01
@@gxs:osrelease@@
NAME=\"Ubuntu\"
PRETTY_NAME=\"Ubuntu 24.04.1 LTS\"
@@gxs:uname@@
Linux 6.8.0-45-generic x86_64
@@gxs:cpuinfo@@
processor\t: 0
model name\t: Intel(R) Xeon(R) Gold 6148 CPU @ 2.40GHz
processor\t: 1
model name\t: Intel(R) Xeon(R) Gold 6148 CPU @ 2.40GHz
@@gxs:ncpu@@
2
@@gxs:pagesize@@
4096
@@gxs:clktck@@
100
@@gxs:virt@@
kvm
@@gxs:passwd@@
root:x:0:0:root:/root:/bin/bash
deploy:x:1000:1000::/home/deploy:/bin/sh
";

    const UBUNTU_2: &str = "@@gxs:uptime@@
350737.47 2765442.12
@@gxs:loadavg@@
0.40 0.26 0.25 1/412 98770
@@gxs:stat@@
cpu  1100 20 350 8300 120 0 30 0 0 0
cpu0 600 10 200 4100 60 0 15 0 0 0
cpu1 500 10 150 4200 60 0 15 0 0 0
@@gxs:meminfo@@
MemTotal:        2009536 kB
MemAvailable:    1400000 kB
SwapTotal:       1048572 kB
SwapFree:         948572 kB
@@gxs:netdev@@
    lo:  1000      10    0    0    0     0          0         0     1000      10    0    0    0     0       0          0
  eth0:5020000   4100    0    0    0     0          0         0  2010000   3100    0    0    0     0       0          0
@@gxs:procs@@
1 (systemd) S 0 1 1 0 -1 4194560 1 1 0 0 55 35 0 0 20 0 1 0 1 170000000 3000 18446744073709551615
900 (a) b (c)) R 1 900 900 0 -1 4194560 1 1 0 0 200 20 0 0 20 0 1 0 1 10000000 500 18446744073709551615
1234 (new) R 1 1234 1234 0 -1 4194560 1 1 0 0 30 0 0 0 20 0 1 0 1 10000000 100 18446744073709551615
";

    /// OpenWrt 23.05 on a MT7621 router: busybox, no MemAvailable-less quirks, dropbear.
    const OPENWRT: &str = "@@gxs:uptime@@
864321.12 3000000.00
@@gxs:loadavg@@
0.36 0.25 0.25 1/97 12345
@@gxs:stat@@
cpu  5000 0 4000 900000 10 0 2000 0 0 0
@@gxs:meminfo@@
MemTotal:         250152 kB
MemFree:          120000 kB
MemAvailable:     180000 kB
Buffers:            4000 kB
Cached:            40000 kB
SwapTotal:             0 kB
SwapFree:              0 kB
@@gxs:netdev@@
Inter-|   Receive                                                |  Transmit
 face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed
br-lan: 912345678 1000 0 0 0 0 0 0 123456789 900 0 0 0 0 0 0
@@gxs:procs@@
1 (procd) S 0 1 1 0 -1 4194560 1 1 0 0 300 200 0 0 20 0 1 0 5 1500000 400 4294967295
1500 (dropbear) S 1 1500 1500 0 -1 4194560 1 1 0 0 20 10 0 0 20 0 1 0 5 1000000 200 4294967295
@@gxs:df@@
Filesystem           1024-blocks    Used Available Capacity Mounted on
/dev/root                 225280    225280         0 100% /rom
tmpfs                   979852      1064    978788   0% /tmp
/dev/mtdblock6-with-a-very-long-name
                          1945600     81920   1863680   4% /overlay
overlayfs:/overlay     1945600     81920   1863680   4% /
@@gxs:hostname@@
OpenWrt
@@gxs:osrelease@@
NAME='OpenWrt'
VERSION='23.05.3'
PRETTY_NAME='OpenWrt 23.05.3'
@@gxs:uname@@
Linux 5.15.150 mips
@@gxs:cpuinfo@@
system type\t\t: MediaTek MT7621 ver:1 eco:3
processor\t\t: 0
cpu model\t\t: MIPS 1004Kc V2.15
processor\t\t: 1
cpu model\t\t: MIPS 1004Kc V2.15
@@gxs:ncpu@@
@@gxs:pagesize@@
";

    #[test]
    fn script_is_single_quote_safe() {
        for (disks, system, detailed) in [(true, true, true), (false, false, false), (true, false, true)] {
            let s = script(disks, system, detailed);
            assert!(s.starts_with("sh -c '") && s.ends_with('\''));
            assert_eq!(s.matches('\'').count(), 2);
            assert_eq!(s.contains("@@gxs:cmdline@@"), detailed);
            assert_eq!(s.contains("@@gxs:dfi@@"), disks && detailed);
        }
    }

    #[test]
    fn per_core_usage_users_and_totals() {
        let mut state = MonitorState::default();
        let first = state.update(UBUNTU_1);
        assert_eq!(first.cpu_cores, None);
        assert_eq!((first.process_total, first.thread_total), (4, 4));
        let system = first.system.as_ref().unwrap();
        assert_eq!(system.virtualization, "kvm");
        assert_eq!(first.processes.iter().find(|p| p.pid == 1).unwrap().user, "root");
        assert_eq!(first.memory.buffers, 50000 * 1024);
        assert_eq!(first.memory.free, 120000 * 1024);

        let snap = state.update(UBUNTU_2);
        let cores = snap.cpu_cores.unwrap();
        assert_eq!(cores.len(), 2);
        assert!((cores[0] - 150.0 / 260.0 * 100.0).abs() < 1e-9, "{cores:?}");
        assert_eq!(cores[1], 0.0);
        assert!(snap.users.is_none() && snap.processes.iter().all(|p| p.cmdline.is_none()));
    }

    #[test]
    fn stat_fields_nice_and_start_time() {
        let procs = parse_procs(
            "77 (nginx) S 1 77 77 0 -1 4194560 1 1 0 0 10 5 0 0 30 10 4 0 123456 10000000 900 18446744073709551615\n",
        );
        assert_eq!(procs[0].nice, 10);
        assert_eq!(procs[0].threads, 4);
        assert_eq!(procs[0].start_ticks, 123456);
    }

    #[test]
    fn cpuinfo_physical_cores_and_frequency() {
        let s = sections(
            "@@gxs:cpuinfo@@
processor\t: 0
physical id\t: 0
cpu cores\t: 4
cpu MHz\t\t: 2400.000
processor\t: 1
physical id\t: 1
cpu cores\t: 4
@@gxs:ncpu@@
16
",
        );
        let (info, _) = parse_system(&s);
        assert_eq!(info.cpu_cores, 16);
        assert_eq!(info.cpu_sockets, Some(2));
        assert_eq!(info.cpu_physical, Some(8));
        assert_eq!(info.cpu_mhz, Some(2400.0));
        assert_eq!(parse_system(&sections("")).0.cpu_physical, None);
    }

    #[test]
    fn detailed_mode_keeps_every_process_with_command_lines() {
        let mut procs = String::new();
        for pid in 100..140 {
            procs.push_str(&format!(
                "{pid} (w{pid}) S 1 1 1 0 -1 0 0 0 0 0 1 1 0 0 20 0 1 0 1 1000 10 0\n"
            ));
        }
        let output = format!(
            "@@gxs:stat@@
cpu  1 0 1 10 0 0 0 0 0 0
@@gxs:procs@@
{procs}@@gxs:cmdline@@
/proc/100/cmdline
/usr/bin/w100 --flag a b
/proc/101/cmdline

/proc/999/cmdline
@@gxs:who@@
deploy   pts/0        2026-10-02 09:12 (10.0.0.8)
root     tty1         2026-10-01 18:00
"
        );
        let snap = MonitorState::default().update(&output);
        assert_eq!(snap.processes.len(), 40, "no top-N cut");
        let p100 = snap.processes.iter().find(|p| p.pid == 100).unwrap();
        assert_eq!(p100.cmdline.as_deref(), Some("/usr/bin/w100 --flag a b"));
        assert_eq!(snap.processes.iter().find(|p| p.pid == 101).unwrap().cmdline, None);
        let users = snap.users.unwrap();
        assert_eq!(users.len(), 2);
        assert_eq!((users[0].name.as_str(), users[0].from.as_str()), ("deploy", "10.0.0.8"));
        assert_eq!(users[0].since, "2026-10-02 09:12");
        assert_eq!((users[1].tty.as_str(), users[1].from.as_str()), ("tty1", ""));
    }

    #[test]
    fn busybox_who_header_is_skipped() {
        let users = parse_who("USER       TTY      IDLE      TIME            HOST\nroot       pts/0    00:00     Oct  2 10:00:00  10.0.0.8\n");
        assert_eq!(users.len(), 1);
        assert_eq!(users[0].name, "root");
    }

    #[test]
    fn disks_merge_inodes_and_filesystem_types() {
        let output = "@@gxs:stat@@
cpu  1 0 1 10 0 0 0 0 0 0
@@gxs:df@@
Filesystem     1024-blocks    Used Available Capacity Mounted on
/dev/sda1         20510332 1200000  18244000       7% /
/dev/sdb1         10000000 5000000   5000000      50% /mnt/my data
@@gxs:dfi@@
Filesystem      Inodes  IUsed   IFree IUse% Mounted on
/dev/sda1      1310720 250000 1060720   20% /
/dev/sdb1            0      0       0     - /mnt/my data
@@gxs:mounts@@
/dev/sda1 / ext4 rw,relatime 0 0
/dev/sdb1 /mnt/my\\040data btrfs rw 0 0
";
        let disks = MonitorState::default().update(output).disks.unwrap();
        assert_eq!(disks[0].fs_type.as_deref(), Some("ext4"));
        assert_eq!((disks[0].inodes_total, disks[0].inodes_used), (Some(1310720), Some(250000)));
        assert_eq!(disks[1].fs_type.as_deref(), Some("btrfs"));
        assert_eq!(disks[1].inodes_total, None, "btrfs reports no inodes");
    }

    #[test]
    fn passwd_maps_uids_to_names() {
        let users = parse_passwd("root:x:0:0::/root:/bin/sh\n# comment\nbroken\nnobody:x:65534:65534::/:/sbin/nologin\n");
        assert_eq!(users.get(&0).map(String::as_str), Some("root"));
        assert_eq!(users.get(&65534).map(String::as_str), Some("nobody"));
        assert_eq!(users.len(), 2);
    }

    #[test]
    fn sections_split_on_markers() {
        let s = sections("@@gxs:a@@\none\ntwo\n@@gxs:b@@\n@@gxs:c@@\nlast");
        assert_eq!(s["a"], "one\ntwo\n");
        assert_eq!(s["b"], "");
        assert_eq!(s["c"], "last");
    }

    #[test]
    fn first_sample_has_absolute_values_and_no_rates() {
        let mut state = MonitorState::default();
        let snap = state.update(UBUNTU_1);
        assert!(!snap.unsupported);
        assert_eq!(snap.uptime_secs, 350735);
        assert_eq!(snap.load, [0.36, 0.25, 0.25]);
        assert_eq!(snap.cpu_percent, None);
        assert_eq!(snap.mem.total, 2009536 * 1024);
        assert_eq!(snap.mem.used, (2009536 - 1487256) * 1024);
        assert_eq!(
            snap.swap,
            Usage {
                used: 0,
                total: 1048572 * 1024
            }
        );
        assert!(snap.net.iter().all(|n| n.rx_rate.is_none()));

        let system = snap.system.unwrap();
        assert_eq!(system.hostname, "web-01");
        assert_eq!(system.os, "Ubuntu 24.04.1 LTS");
        assert_eq!(system.kernel, "Linux 6.8.0-45-generic");
        assert_eq!(system.arch, "x86_64");
        assert_eq!(system.cpu_model, "Intel(R) Xeon(R) Gold 6148 CPU @ 2.40GHz");
        assert_eq!(system.cpu_cores, 2);

        let tricky = snap.processes.iter().find(|p| p.pid == 900).unwrap();
        assert_eq!(tricky.name, "a) b (c)");
        assert_eq!(tricky.mem_bytes, 500 * 4096);
        assert_eq!(
            snap.processes.iter().find(|p| p.pid == 812).unwrap().name,
            "tmux: server"
        );

        let disks = snap.disks.unwrap();
        assert_eq!(disks.len(), 3, "zero-sized pseudo filesystems are dropped");
        assert_eq!(disks[0].mount, "/");
        assert_eq!(disks[0].avail, 18244000 * 1024);
        assert_eq!(disks[2].mount, "/mnt/my data");
    }

    #[test]
    fn second_sample_computes_cpu_process_and_network_rates() {
        let mut state = MonitorState::default();
        state.update(UBUNTU_1);
        let snap = state.update(UBUNTU_2);
        assert!(snap.system.is_none() && snap.disks.is_none());

        // total delta: (1100+20+350+8300+120+30) - (1000+20+300+8000+100+30) = 470; idle 320.
        let cpu = snap.cpu_percent.unwrap();
        assert!((cpu - 150.0 / 470.0 * 100.0).abs() < 1e-9, "{cpu}");

        let p900 = snap.processes.iter().find(|p| p.pid == 900).unwrap();
        assert!((p900.cpu_percent.unwrap() - 120.0 / 470.0 * 100.0).abs() < 1e-9);
        let born = snap.processes.iter().find(|p| p.pid == 1234).unwrap();
        assert!((born.cpu_percent.unwrap() - 30.0 / 470.0 * 100.0).abs() < 1e-9);
        assert!(
            snap.processes.iter().all(|p| p.pid != 812),
            "exited processes disappear"
        );
        assert_eq!(snap.processes[0].pid, 900, "sorted by CPU first");

        let eth0 = snap.net.iter().find(|n| n.name == "eth0").unwrap();
        assert_eq!(eth0.rx_rate, Some(10000.0));
        assert_eq!(eth0.tx_rate, Some(5000.0));
        assert_eq!(snap.swap.used, 100000 * 1024);
    }

    #[test]
    fn busybox_openwrt_output() {
        let mut state = MonitorState::default();
        let snap = state.update(OPENWRT);
        assert_eq!(snap.uptime_secs / 86400, 10);
        assert_eq!(snap.swap, Usage::default());
        let system = snap.system.unwrap();
        assert_eq!(system.os, "OpenWrt 23.05.3");
        assert_eq!(system.arch, "mips");
        assert_eq!(system.cpu_model, "MIPS 1004Kc V2.15");
        assert_eq!(system.cpu_cores, 2, "falls back to counting processors");
        assert_eq!(snap.net[0].name, "br-lan");
        assert_eq!(snap.net[0].rx_total, 912345678);
        assert_eq!(
            snap.processes.iter().find(|p| p.pid == 1).unwrap().mem_bytes,
            400 * 4096
        );

        let disks = snap.disks.unwrap();
        let mounts: Vec<&str> = disks.iter().map(|d| d.mount.as_str()).collect();
        assert_eq!(mounts, ["/rom", "/tmp", "/overlay", "/"]);
        assert_eq!(disks[2].filesystem, "/dev/mtdblock6-with-a-very-long-name");
        assert_eq!(disks[0].avail, 0);
    }

    #[test]
    fn meminfo_without_memavailable_is_estimated() {
        let (mem, _) =
            parse_meminfo("MemTotal: 1000 kB\nMemFree: 100 kB\nBuffers: 50 kB\nCached: 250 kB\nShmem: 20 kB\n");
        assert_eq!(mem.used, (1000 - 380) * 1024);
    }

    #[test]
    fn missing_proc_stat_means_unsupported() {
        let mut state = MonitorState::default();
        let snap = state.update("@@gxs:uptime@@\n@@gxs:stat@@\n@@gxs:meminfo@@\n");
        assert!(snap.unsupported);
        assert!(state.update("").unsupported);
    }

    #[test]
    fn listening_sockets_from_ss_and_netstat() {
        let ss = parse_connections(
            "Netid State  Recv-Q Send-Q Local Address:Port  Peer Address:Port Process
udp   UNCONN 0      0      127.0.0.53%lo:53     0.0.0.0:*         users:((\"systemd-resolve\",pid=600,fd=13))
tcp   LISTEN 0      4096   0.0.0.0:22           0.0.0.0:*         users:((\"sshd\",pid=812,fd=3),(\"systemd\",pid=1,fd=40))
tcp   LISTEN 0      511    [::]:80              [::]:*
",
        );
        assert_eq!(ss.len(), 3);
        assert_eq!(ss[1].proto, "tcp");
        assert_eq!(ss[1].state, "LISTEN");
        assert_eq!(ss[1].local_addr, "0.0.0.0:22");
        assert_eq!(ss[1].remote_addr, "0.0.0.0:*");
        assert_eq!((ss[1].pid, ss[1].program.as_str()), (Some(812), "sshd"));
        assert_eq!(ss[0].program, "systemd-resolve");
        assert_eq!((ss[2].pid, ss[2].program.as_str()), (None, ""));

        let netstat = parse_connections(
            "Active Internet connections (only servers)
Proto Recv-Q Send-Q Local Address           Foreign Address         State       PID/Program name
tcp        0      0 0.0.0.0:22              0.0.0.0:*               LISTEN      812/sshd
udp        0      0 0.0.0.0:68              0.0.0.0:*                           590/dhclient
tcp6       0      0 :::80                   :::*                    LISTEN      -
",
        );
        assert_eq!(netstat.len(), 3);
        assert_eq!(netstat[0].local_addr, "0.0.0.0:22");
        assert_eq!(netstat[0].state, "LISTEN");
        assert_eq!((netstat[0].pid, netstat[0].program.as_str()), (Some(812), "sshd"));
        assert_eq!(netstat[1].state, "");
        assert_eq!(netstat[1].program, "dhclient");
        assert_eq!(netstat[2].pid, None);
        assert!(parse_connections("").is_empty());
    }

    #[test]
    fn reset_rates_drops_deltas() {
        let mut state = MonitorState::default();
        state.update(UBUNTU_1);
        state.reset_rates();
        assert_eq!(state.update(UBUNTU_2).cpu_percent, None);
    }
}
