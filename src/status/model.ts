import { pushSample, type Sample } from '../charts'
import { ltr, messages } from '../i18n'
import {
  type Disk,
  describeErrorText,
  type MemoryDetail,
  type StatusSnapshot,
  type SystemInfo,
} from '../protocol'

const t = messages({
  noTab: {
    zh: '连接服务器后，这里会显示它的运行状态。',
    en: 'Connect to a server to see its status here.',
    ug: 'مۇلازىمېتىرغا ئۇلانغاندىن كېيىن، ئۇنىڭ ئىجرا ھالىتى بۇ يەردە كۆرۈنىدۇ.',
  },
  local: {
    zh: '本地终端、Telnet 和串口连接没有状态监控。',
    en: 'Local terminal, Telnet and serial connections have no status monitoring.',
    ug: 'يەرلىك تېرمىنال، Telnet ۋە تىزمىلىق ئېغىز ئۇلىنىشلىرىدا ھالەت كۆزىتىش يوق.',
  },
  connecting: { zh: '正在连接…', en: 'Connecting…', ug: 'ئۇلىنىۋاتىدۇ…' },
  ended: { zh: '会话已断开。', en: 'Session disconnected.', ug: 'ئەڭگىمە ئۈزۈلدى.' },
  unmonitored: {
    zh: '这台服务器关闭了状态监控，可以在服务器设置的「高级」页签里打开。',
    en: 'Status monitoring is off for this server. Turn it on in the Advanced tab of its server settings.',
    ug: 'بۇ مۇلازىمېتىرنىڭ ھالەت كۆزىتىشى تاقاقلىق، ئۇنى مۇلازىمېتىر تەڭشىكىدىكى «ئالىي» بەتكۈچىدە ئاچقىلى بولىدۇ.',
  },
  starting: {
    zh: '正在启动状态监控…',
    en: 'Starting status monitoring…',
    ug: 'ھالەت كۆزىتىش قوزغىلىۋاتىدۇ…',
  },
  unsupported: {
    zh: '该系统暂不支持状态监控（需要 Linux 的 {proc}）。',
    en: 'Status monitoring is not supported on this system yet (it needs Linux {proc}).',
    ug: 'بۇ سىستېما ھازىرچە ھالەت كۆزىتىشنى قوللىمايدۇ (Linux نىڭ {proc} مۇندەرىجىسى كېرەك).',
  },
  reading: { zh: '正在读取状态…', en: 'Reading status…', ug: 'ھالەت ئوقۇلۇۋاتىدۇ…' },
  readFailed: {
    zh: '状态读取失败：{error}',
    en: "Couldn't read the status: {error}",
    ug: 'ھالەتنى ئوقۇش مەغلۇپ بولدى: {error}',
  },
})

export type TabKind = 'none' | 'local' | 'connecting' | 'live' | 'ended'

/** The main window's visible tab, relayed by the backend to every status view. */
export interface ActiveTab {
  sessionId: number | null
  tab: TabKind
  monitored: boolean
  paused: boolean
}

export const NO_TAB: ActiveTab = { sessionId: null, tab: 'none', monitored: false, paused: false }

/** One poll as the backend stores it; an empty `net` means the poll failed. */
export interface Point {
  latency: number | null
  cpu: number | null
  /** Memory in use, in percent. */
  mem: number | null
  net: { name: string; rx: number | null; tx: number | null }[]
}

export interface SessionStatus {
  id: number
  seq: number
  last: StatusSnapshot | null
  error: string | null
  system: SystemInfo | null
  disks: Disk[] | null
  history: Point[]
}

export interface StatusState {
  active: ActiveTab
  /** Sessions with an advanced window open. */
  watched: number[]
  sessions: SessionStatus[]
}

export interface SnapshotEvent {
  sessionId: number
  seq: number
  snapshot: StatusSnapshot
}

export interface NetHistory {
  rx: Sample[]
  tx: Sample[]
}

export interface Track {
  id: number
  seq: number
  last: StatusSnapshot | null
  error: string | null
  system: SystemInfo | null
  disks: Disk[] | null
  latency: Sample[]
  cpu: Sample[]
  mem: Sample[]
  net: Map<string, NetHistory>
}

export function newTrack(id: number): Track {
  return {
    id,
    seq: 0,
    last: null,
    error: null,
    system: null,
    disks: null,
    latency: [],
    cpu: [],
    mem: [],
    net: new Map(),
  }
}

/** Mirrors `StatusCache::ingest` in monitor.rs. */
export function pointOf(snap: StatusSnapshot): Point {
  const ok = !snap.error
  return {
    latency: snap.latencyMs,
    cpu: ok ? snap.cpuPercent : null,
    mem: ok && snap.mem.total > 0 ? (snap.mem.used * 100) / snap.mem.total : null,
    net: ok ? snap.net.map((n) => ({ name: n.name, rx: n.rxRate, tx: n.txRate })) : [],
  }
}

/** Every interface gets a sample per point, so all series stay aligned with the latency one. */
export function pushPoint(track: Track, point: Point): void {
  const before = track.latency.length
  pushSample(track.latency, point.latency)
  pushSample(track.cpu, point.cpu)
  pushSample(track.mem, point.mem)
  const seen = new Set<string>()
  for (const n of point.net) {
    seen.add(n.name)
    let history = track.net.get(n.name)
    if (!history) {
      history = { rx: Array(before).fill(null), tx: Array(before).fill(null) }
      track.net.set(n.name, history)
    }
    pushSample(history.rx, n.rx)
    pushSample(history.tx, n.tx)
  }
  for (const [name, history] of track.net) {
    if (seen.has(name)) continue
    pushSample(history.rx, null)
    pushSample(history.tx, null)
  }
}

export function trackFromState(state: SessionStatus): Track {
  const track: Track = {
    ...newTrack(state.id),
    seq: state.seq,
    last: state.last,
    error: state.error && describeErrorText(state.error),
    system: state.system,
    disks: state.disks,
  }
  for (const point of state.history) pushPoint(track, point)
  return track
}

/** Returns false for a snapshot the track already holds (it arrived before the initial state). */
export function applySnapshot(track: Track, seq: number, snap: StatusSnapshot): boolean {
  if (seq <= track.seq) return false
  track.seq = seq
  pushPoint(track, pointOf(snap))
  if (snap.error) {
    track.error = describeErrorText(snap.error)
    return true
  }
  track.error = null
  track.last = snap
  if (snap.system) track.system = snap.system
  if (snap.disks) track.disks = snap.disks
  return true
}

export const MAX_INTERFACES = 5

/** The busiest interface other than loopback. */
export function defaultInterface(snap: StatusSnapshot): string | null {
  const real = snap.net.filter((n) => n.name !== 'lo')
  let best: string | null = null
  let most = -1
  for (const n of real.length > 0 ? real : snap.net) {
    const total = n.rxTotal + n.txTotal
    if (total > most) {
      most = total
      best = n.name
    }
  }
  return best
}

/** The saved choice limited to what this server has, or its busiest interface. */
export function chosenInterfaces(saved: readonly string[], snap: StatusSnapshot): string[] {
  const names = new Set(snap.net.map((n) => n.name))
  const kept = saved.filter((name) => names.has(name)).slice(0, MAX_INTERFACES)
  if (kept.length > 0) return kept
  const fallback = defaultInterface(snap)
  return fallback ? [fallback] : []
}

/** What to show instead of the widgets, or '' when there is data to draw. */
export function placeholder(active: ActiveTab, track: Track | null): string {
  switch (active.tab) {
    case 'none':
      return t('noTab')
    case 'local':
      return t('local')
    case 'connecting':
      return t('connecting')
    case 'ended':
      return t('ended')
  }
  if (!active.monitored) return t('unmonitored')
  if (!track) return t('starting')
  if (track.last?.unsupported) return t('unsupported', { proc: ltr('/proc') })
  if (!track.last) return track.error ? t('readFailed', { error: track.error }) : t('reading')
  return ''
}

export interface MemoryParts {
  used: number
  buffers: number
  cached: number
  free: number
}

/** Splits RAM into stacked parts that add up to the total; `used` is whatever the rest leave. */
export function memoryParts(m: MemoryDetail): MemoryParts {
  const free = Math.max(0, Math.min(m.free, m.total))
  const buffers = Math.max(0, Math.min(m.buffers, m.total - free))
  const cached = Math.max(0, Math.min(m.cached, m.total - free - buffers))
  return { used: Math.max(0, m.total - free - buffers - cached), buffers, cached, free }
}

/** When the server booted, in ms since the epoch, given its uptime at `now`. */
export function bootTime(uptimeSecs: number, now: number): number {
  return now - uptimeSecs * 1000
}

/** When a process started, in ms since the epoch; `startSecs` counts from boot. */
export function processStart(startSecs: number, uptimeSecs: number, now: number): number {
  return bootTime(uptimeSecs, now) + Math.min(startSecs, uptimeSecs) * 1000
}
