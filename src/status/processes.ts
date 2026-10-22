import { ltr, messages } from '../i18n'
import type { ProcessInfo } from '../protocol'

const t = messages({
  running: { zh: '运行', en: 'Running', ug: 'ئىجرا' },
  sleeping: { zh: '睡眠', en: 'Sleeping', ug: 'ئۇيقۇ' },
  uninterruptible: { zh: '不可中断', en: 'Uninterruptible', ug: 'ئۈزۈلمەس' },
  idle: { zh: '空闲', en: 'Idle', ug: 'بىكار' },
  zombie: { zh: '僵尸', en: 'Zombie', ug: 'ئۆلۈك' },
  stopped: { zh: '停止', en: 'Stopped', ug: 'توختىغان' },
  traced: { zh: '跟踪中', en: 'Traced', ug: 'ئىز قوغلىنىۋاتىدۇ' },
  dead: { zh: '退出', en: 'Dead', ug: 'چېكىنگەن' },
  badNice: {
    zh: '请输入 {min} 到 {max} 之间的整数',
    en: 'Enter a whole number from {min} to {max}',
    ug: '{min} دىن {max} غىچە بولغان پۈتۈن سان كىرگۈزۈڭ',
  },
})

export type ProcessKey =
  | 'pid'
  | 'name'
  | 'user'
  | 'cpu'
  | 'mem'
  | 'threads'
  | 'nice'
  | 'state'
  | 'start'

export type SortDirection = 'ascending' | 'descending'

export type StateFilter = 'all' | 'running' | 'sleeping' | 'zombie' | 'stopped'

export const STATE_NAMES: Record<string, string> = {
  R: t('running'),
  S: t('sleeping'),
  D: t('uninterruptible'),
  I: t('idle'),
  Z: t('zombie'),
  T: t('stopped'),
  t: t('traced'),
  X: t('dead'),
}

export function stateName(state: string): string {
  return STATE_NAMES[state] ?? state
}

/** The filter group a /proc state letter belongs to, or null for the rare ones. */
export function stateGroup(state: string): Exclude<StateFilter, 'all'> | null {
  switch (state) {
    case 'R':
      return 'running'
    case 'S':
    case 'D':
    case 'I':
      return 'sleeping'
    case 'Z':
      return 'zombie'
    case 'T':
    case 't':
      return 'stopped'
    default:
      return null
  }
}

/** Matches the name, user and command line anywhere, and the PID from its start. */
export function filterProcesses(
  list: readonly ProcessInfo[],
  query: string,
  state: StateFilter,
): ProcessInfo[] {
  const q = query.trim().toLowerCase()
  return list.filter(
    (p) =>
      (state === 'all' || stateGroup(p.state) === state) &&
      (q === '' ||
        String(p.pid).startsWith(q) ||
        p.name.toLowerCase().includes(q) ||
        p.user.toLowerCase().includes(q) ||
        (p.cmdline?.toLowerCase().includes(q) ?? false)),
  )
}

const DESCENDING: ReadonlySet<ProcessKey> = new Set(['cpu', 'mem', 'threads', 'start'])

/** Figures read best biggest first, text A to Z. */
export function defaultDirection(key: ProcessKey): SortDirection {
  return DESCENDING.has(key) ? 'descending' : 'ascending'
}

const VALUE: Record<ProcessKey, (p: ProcessInfo) => number | string> = {
  pid: (p) => p.pid,
  name: (p) => p.name,
  user: (p) => p.user || String(p.uid),
  cpu: (p) => p.cpuPercent ?? -1,
  mem: (p) => p.memBytes,
  threads: (p) => p.threads,
  nice: (p) => p.nice,
  state: (p) => p.state,
  start: (p) => p.startSecs,
}

function compare(a: ProcessInfo, b: ProcessInfo, key: ProcessKey): number {
  const x = VALUE[key](a)
  const y = VALUE[key](b)
  return typeof x === 'string' ? x.localeCompare(String(y)) : x - Number(y)
}

/** Ties fall back to memory for CPU, then to PID, so rows keep still between polls. */
export function sortProcesses(
  list: readonly ProcessInfo[],
  key: ProcessKey,
  direction: SortDirection = defaultDirection(key),
): ProcessInfo[] {
  const sign = direction === 'ascending' ? 1 : -1
  return [...list].sort(
    (a, b) =>
      sign * compare(a, b, key) || (key === 'cpu' ? b.memBytes - a.memBytes : 0) || a.pid - b.pid,
  )
}

export interface TreeRow {
  process: ProcessInfo
  depth: number
}

/**
 * Nests every process under its parent, keeping the given order among siblings. A process whose
 * parent is not in the list (filtered out, or PID 0) becomes a root.
 */
export function processTree(sorted: readonly ProcessInfo[]): TreeRow[] {
  const pids = new Set(sorted.map((p) => p.pid))
  const children = new Map<number, ProcessInfo[]>()
  const roots: ProcessInfo[] = []
  for (const p of sorted) {
    if (p.ppid !== p.pid && pids.has(p.ppid)) {
      const list = children.get(p.ppid)
      if (list) list.push(p)
      else children.set(p.ppid, [p])
    } else roots.push(p)
  }
  const rows: TreeRow[] = []
  const seen = new Set<number>()
  const walk = (p: ProcessInfo, depth: number) => {
    if (seen.has(p.pid)) return
    seen.add(p.pid)
    rows.push({ process: p, depth })
    for (const child of children.get(p.pid) ?? []) walk(child, depth + 1)
  }
  for (const root of roots) walk(root, 0)
  // A parent loop (PIDs reused mid-poll) leaves processes unreached; show them rather than drop.
  for (const p of sorted) walk(p, 0)
  return rows
}

/** A start time as short as it can be next to `now`: time today, date this year, else the year. */
export function shortTime(ms: number, now: number): string {
  const d = new Date(ms)
  const n = new Date(now)
  const pad = (v: number) => String(v).padStart(2, '0')
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  const date = `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  if (d.getFullYear() !== n.getFullYear()) return `${d.getFullYear()}-${date}`
  if (d.getMonth() === n.getMonth() && d.getDate() === n.getDate()) return time
  return `${date} ${time}`
}

/** A nice value the server's renice accepts, or the message explaining why not. */
export function validNice(value: string): string {
  const n = Number(value.trim())
  return value.trim() !== '' && Number.isInteger(n) && n >= -20 && n <= 19
    ? ''
    : t('badNice', { min: ltr('-20'), max: 19 })
}
