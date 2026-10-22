import { messages } from './i18n'

const t = messages({
  uptimeDays: { zh: '{d} 天 {h} 小时', en: '{d}d {h}h', ug: '{d} كۈن {h} سائەت' },
  uptimeHours: { zh: '{h} 小时 {m} 分', en: '{h}h {m}m', ug: '{h} سائەت {m} مىنۇت' },
  uptimeMinutes: { zh: '{m} 分', en: '{m}m', ug: '{m} مىنۇت' },
})

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']

export function formatThroughput(bytes: number, ms: number): string {
  const seconds = Math.max(ms, 1) / 1000
  return `${(bytes / 1024 / 1024 / seconds).toFixed(1)} MB/s`
}

export function formatBytes(bytes: number): string {
  let value = Math.max(0, bytes)
  let unit = 0
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024
    unit += 1
  }
  if (unit === 0) return `${value} B`
  const digits = value < 10 ? 2 : value < 100 ? 1 : 0
  return `${value.toFixed(digits)} ${UNITS[unit]}`
}

export function formatRate(bytesPerSec: number | null): string {
  return bytesPerSec === null ? '—' : `${formatBytes(Math.round(bytesPerSec))}/s`
}

export function formatUptime(secs: number): string {
  const days = Math.floor(secs / 86400)
  const hours = Math.floor((secs % 86400) / 3600)
  const minutes = Math.floor((secs % 3600) / 60)
  if (days > 0) return t('uptimeDays', { d: days, h: hours })
  if (hours > 0) return t('uptimeHours', { h: hours, m: minutes })
  return t('uptimeMinutes', { m: minutes })
}

export function formatTime(secs: number | null): string {
  if (secs === null) return ''
  const d = new Date(secs * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}`
  )
}

export function formatPercent(value: number | null): string {
  return value === null ? '—' : `${value.toFixed(value < 10 ? 1 : 0)}%`
}

/** Owner rwx, group rwx, other rwx. */
export function modeToBits(mode: number): boolean[] {
  return Array.from({ length: 9 }, (_, i) => (mode & (0o400 >> i)) !== 0)
}

/** Keeps setuid/setgid/sticky from `base`; the checkboxes only cover the low nine bits. */
export function bitsToMode(bits: boolean[], base = 0): number {
  let mode = base & 0o7000
  bits.forEach((on, i) => {
    if (on) mode |= 0o400 >> i
  })
  return mode
}

export function parseOctal(text: string): number | null {
  const value = text.trim()
  return /^[0-7]{3,4}$/.test(value) ? Number.parseInt(value, 8) : null
}

export function formatOctal(mode: number): string {
  const value = mode & 0o7777
  return value.toString(8).padStart(value > 0o777 ? 4 : 3, '0')
}

export function parentDir(path: string): string {
  const trimmed = path.replace(/\/+$/, '')
  const index = trimmed.lastIndexOf('/')
  return index <= 0 ? '/' : trimmed.slice(0, index)
}

export function joinRemote(dir: string, name: string): string {
  return dir.endsWith('/') ? `${dir}${name}` : `${dir}/${name}`
}

export function validRemoteName(name: string): boolean {
  return (
    name.length > 0 && name.length <= 255 && name !== '.' && name !== '..' && !/[/\0]/.test(name)
  )
}

export function extension(name: string): string {
  const index = name.lastIndexOf('.')
  return index > 0 ? name.slice(index + 1).toLowerCase() : ''
}

/** Runs `task` over `items` with at most `limit` in flight. Failures are the task's to report. */
export async function runLimited<T>(
  items: readonly T[],
  limit: number,
  task: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const item = items[next++]
      try {
        await task(item)
      } catch {
        // Reported by the task itself.
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
}
