import { messages } from '../../i18n'
import { common } from '../../i18n-common'

const t = messages({
  notCast: {
    zh: '不是 asciicast 录像',
    en: 'Not an asciicast recording',
    ug: 'asciicast سىنى ئەمەس',
  },
  onlyV2: {
    zh: '只支持 asciicast v2 录像',
    en: 'Only asciicast v2 recordings are supported',
    ug: 'پەقەت asciicast v2 سىنىنىلا قوللايدۇ',
  },
  badSize: {
    zh: '录像头里的终端大小不对',
    en: 'The terminal size in the recording header is invalid',
    ug: 'سىن بېشىدىكى تېرمىنال چوڭلۇقى توغرا ئەمەس',
  },
})

/** `[seconds, code, data]`, as in an asciicast v2 file. */
export type CastEvent = [number, string, string]

export interface Cast {
  width: number
  height: number
  title: string
  /** Output and resize events, in time order. */
  events: CastEvent[]
  duration: number
}

export interface CastEntry {
  name: string
  size: number
  modified: number
  title: string
  width: number
  height: number
  duration: number | null
}

const MAX_BATCH = 1024 * 1024

/** Reads asciicast v2; lines that are not events (or are cut off at the end) are skipped. */
export function parseCast(text: string): Cast | Error {
  const lines = text.split('\n')
  let header: unknown
  try {
    header = JSON.parse(lines[0] ?? '')
  } catch {
    return new Error(t('notCast'))
  }
  const h = header as Record<string, unknown> | null
  if (!h || typeof h !== 'object' || h.version !== 2) return new Error(t('onlyV2'))
  const size = (v: unknown) =>
    typeof v === 'number' && Number.isInteger(v) && v > 0 && v <= 2000 ? v : null
  const width = size(h.width)
  const height = size(h.height)
  if (width === null || height === null) return new Error(t('badSize'))
  const events: CastEvent[] = []
  let last = 0
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]
    if (!line?.startsWith('[')) continue
    let event: unknown
    try {
      event = JSON.parse(line)
    } catch {
      continue
    }
    if (!Array.isArray(event) || event.length < 3) continue
    const [time, code, data] = event
    if (typeof time !== 'number' || !Number.isFinite(time) || typeof data !== 'string') continue
    if (code !== 'o' && code !== 'r') continue
    // Out-of-order times would make seeking ambiguous; hold them at the previous time.
    last = Math.max(last, time)
    events.push([last, code, data])
  }
  return {
    width,
    height,
    title: typeof h.title === 'string' ? h.title : '',
    events,
    duration: last,
  }
}

/** Shortens every pause longer than `max` seconds to `max`. */
export function capIdle(events: CastEvent[], max: number): CastEvent[] {
  let shift = 0
  let previous = 0
  return events.map(([time, code, data]) => {
    const gap = time - previous
    if (gap > max) shift += gap - max
    previous = time
    return [time - shift, code, data]
  })
}

/** `COLSxROWS` from a resize event, or null. */
export function parseSize(data: string): { cols: number; rows: number } | null {
  const m = /^(\d{1,4})x(\d{1,4})$/.exec(data)
  if (!m) return null
  const cols = Number(m[1])
  const rows = Number(m[2])
  return cols > 0 && rows > 0 ? { cols, rows } : null
}

/** Index of the first event after `time`. */
export function indexAfter(events: CastEvent[], time: number): number {
  let lo = 0
  let hi = events.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if ((events[mid]?.[0] ?? 0) <= time) lo = mid + 1
    else hi = mid
  }
  return lo
}

export function castName(title: string, d: Date): string {
  const two = (n: number) => String(n).padStart(2, '0')
  const stamp = `${d.getFullYear()}${two(d.getMonth() + 1)}${two(d.getDate())}_${two(d.getHours())}${two(d.getMinutes())}${two(d.getSeconds())}`
  return `${title.trim() || common('terminal')}_${stamp}`
}

export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  const two = (n: number) => String(n).padStart(2, '0')
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return h > 0 ? `${h}:${two(m)}:${two(s % 60)}` : `${m}:${two(s % 60)}`
}

/** Collects events with times relative to the start; `take` empties it for a write. */
export class EventBuffer {
  private pending: CastEvent[] = []
  private bytes = 0

  constructor(
    private readonly started: number,
    private readonly now: () => number = () => performance.now(),
  ) {}

  push(code: 'o' | 'r', data: string): void {
    if (!data) return
    const time = Math.max(0, (this.now() - this.started) / 1000)
    const last = this.pending.at(-1)
    // Output chunks that arrive in the same millisecond are one event.
    if (code === 'o' && last?.[1] === 'o' && time - last[0] < 0.001) last[2] += data
    else this.pending.push([time, code, data])
    this.bytes += data.length
  }

  /** True once a write should not wait for the timer. */
  get full(): boolean {
    return this.bytes >= MAX_BATCH
  }

  take(): CastEvent[] {
    const events = this.pending
    this.pending = []
    this.bytes = 0
    return events
  }
}
