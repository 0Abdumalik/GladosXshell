import { invoke } from '@tauri-apps/api/core'
import { setStatus } from './dom'
import { runLimited } from './format'
import { messages, pl } from './i18n'
import type { Advanced, Profiles, ServerView } from './protocol'
import { openProfile } from './sessions'

const t = messages({
  connecting: {
    zh: '正在连接 {n} 台服务器',
    en: (p) => `Connecting to ${pl('server')(p)}`,
    ug: '{n} مۇلازىمېتىرغا ئۇلىنىۋاتىدۇ',
  },
  connectedSome: {
    zh: '已连接 {ok} 台，{failed} 台失败，原因见各自的标签页',
    en: (p) =>
      `Connected to ${pl('server')({ n: p.ok })}, ${p.failed} failed; see each tab for the reason`,
    ug: '{ok} مۇلازىمېتىرغا ئۇلاندى، {failed} سى مەغلۇپ بولدى، سەۋەبىنى ئۆز بەتكۈچىدىن كۆرۈڭ',
  },
  connectedAll: {
    zh: '已连接 {n} 台服务器',
    en: (p) => `Connected to ${pl('server')(p)}`,
    ug: '{n} مۇلازىمېتىرغا ئۇلاندى',
  },
})

type Listener = (profiles: Profiles) => void

const BATCH_LIMIT = 4

let current: Profiles = { groups: [], servers: [] }
const listeners: Listener[] = []

export function profiles(): Profiles {
  return current
}

export async function reloadProfiles(): Promise<Profiles> {
  current = await invoke<Profiles>('profiles_list')
  for (const listener of listeners) listener(current)
  return current
}

/** Returns an unsubscribe function. */
export function onProfiles(listener: Listener): () => void {
  listeners.push(listener)
  return () => {
    const index = listeners.indexOf(listener)
    if (index >= 0) listeners.splice(index, 1)
  }
}

export function serverTitle(
  server: Pick<ServerView, 'name' | 'host' | 'auth' | 'advanced'>,
): string {
  return endpointTitle(server.name, server.auth.user, server.host, server.advanced)
}

/** Same rule as the backend's tab title. */
export function endpointTitle(
  name: string,
  user: string,
  host: string,
  advanced: Pick<Advanced, 'protocol' | 'serial'>,
): string {
  if (name) return name
  if (advanced.protocol === 'serial') return advanced.serial.port
  if (advanced.protocol === 'telnet' && !user) return host
  return `${user}@${host}`
}

export function matchesServer(server: ServerView, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return [server.name, server.host, server.auth.user, server.note, String(server.port)].some((v) =>
    v.toLowerCase().includes(q),
  )
}

/** One tab per server, at most four handshakes at a time; failures stay visible in their tab. */
export async function connectServers(servers: readonly ServerView[]): Promise<void> {
  if (servers.length === 0) return
  let failed = 0
  if (servers.length > 1) setStatus(t('connecting', { n: servers.length }))
  await runLimited(servers, BATCH_LIMIT, (server) =>
    openProfile(server, serverTitle(server)).catch((error) => {
      failed += 1
      throw error
    }),
  )
  // A single connection already reported its own result.
  if (servers.length > 1) {
    const ok = servers.length - failed
    setStatus(
      failed ? t('connectedSome', { ok, failed }) : t('connectedAll', { n: ok }),
      failed ? 'error' : 'info',
    )
  }
  // Only refreshes "last connected"; a failure here is not worth replacing the message above.
  reloadProfiles().catch(() => {})
}
