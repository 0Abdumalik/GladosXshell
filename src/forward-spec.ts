import { ltr, messages } from './i18n'
import type { ForwardKind, ForwardSpec, Parsed } from './protocol'

const t = messages({
  // `{flag}` is `-L`, `-R` or `-D`, kept in one piece: in Uyghur `(-L)` would show as `(L-)`.
  local: { zh: '本地 ({flag})', en: 'Local ({flag})', ug: 'يەرلىك ({flag})' },
  remote: { zh: '远程 ({flag})', en: 'Remote ({flag})', ug: 'يىراق ({flag})' },
  dynamic: {
    zh: '动态 SOCKS ({flag})',
    en: 'Dynamic SOCKS ({flag})',
    ug: 'ھەرىكەتچان SOCKS ({flag})',
  },
  unknownKind: { zh: '未知的转发类型', en: 'Unknown forward type', ug: 'نامەلۇم يوللاش تىپى' },
  badBind: {
    zh: '监听地址写成 端口 或 地址:端口，例如 {port} 或 {hostPort}',
    en: 'Write the listen address as port or address:port, for example {port} or {hostPort}',
    ug: 'تىڭشاش ئادرېسىنى ئېغىز ياكى ئادرېس:ئېغىز شەكلىدە يېزىڭ، مەسىلەن {port} ياكى {hostPort}',
  },
  badDest: {
    zh: '目标写成 地址:端口，例如 {hostPort}',
    en: 'Write the destination as address:port, for example {hostPort}',
    ug: 'نىشاننى ئادرېس:ئېغىز شەكلىدە يېزىڭ، مەسىلەن {hostPort}',
  },
  labelTooLong: {
    zh: '名称最多 {n} 个字符',
    en: 'Names are limited to {n} characters',
    ug: 'ئاتى ئەڭ كۆپ بولغاندا {n} ھەرپ بولىدۇ',
  },
  labelled: { zh: '{label}（{spec}）', en: '{label} ({spec})', ug: '{label} ({spec})' },
})

export const FORWARD_KINDS: [ForwardKind, string][] = [
  ['local', t('local', { flag: ltr('-L') })],
  ['remote', t('remote', { flag: ltr('-R') })],
  ['dynamic', t('dynamic', { flag: ltr('-D') })],
]

const MAX_LABEL = 64

export interface ForwardFields {
  kind: string
  /** `port` or `host:port`; IPv6 hosts go in brackets. */
  bind: string
  /** `host:port`; ignored for dynamic forwards. */
  dest: string
  label: string
}

function hostPort(text: string): { host: string | null; port: number } | null {
  const value = text.trim()
  let host: string | null = null
  let port = value
  if (!/^\d{1,5}$/.test(value)) {
    const match =
      /^\[([^\]\s]+)\]:(\d{1,5})$/.exec(value) ?? /^([^\s:/@[\]]+):(\d{1,5})$/.exec(value)
    if (!match) return null
    host = match[1]
    port = match[2]
  }
  const number = Number(port)
  return number <= 65535 ? { host, port: number } : null
}

export function parseForward(fields: ForwardFields): Parsed<ForwardSpec> {
  const kind = fields.kind as ForwardKind
  if (!FORWARD_KINDS.some(([k]) => k === kind)) return { ok: false, error: t('unknownKind') }
  const bind = hostPort(fields.bind)
  if (!bind) {
    return {
      ok: false,
      error: t('badBind', { port: ltr('8080'), hostPort: ltr('0.0.0.0:8080') }),
    }
  }
  let destHost = ''
  let destPort = 0
  if (kind !== 'dynamic') {
    const dest = hostPort(fields.dest)
    if (!dest?.host || dest.port === 0) {
      return { ok: false, error: t('badDest', { hostPort: ltr('127.0.0.1:3306') }) }
    }
    destHost = dest.host
    destPort = dest.port
  }
  const label = fields.label.trim()
  if ([...label].length > MAX_LABEL) {
    return { ok: false, error: t('labelTooLong', { n: MAX_LABEL }) }
  }
  return {
    ok: true,
    value: {
      kind,
      bindHost: bind.host ?? '127.0.0.1',
      bindPort: bind.port,
      destHost,
      destPort,
      label,
    },
  }
}

function joinHost(host: string, port: number): string {
  return `${host.includes(':') ? `[${host}]` : host}:${port}`
}

/** One-line form close to the ssh flag, e.g. `-L 127.0.0.1:8080 → db:5432`. */
export function describeForward(spec: ForwardSpec, boundPort = spec.bindPort): string {
  const flag = spec.kind === 'local' ? '-L' : spec.kind === 'remote' ? '-R' : '-D'
  const bind = joinHost(spec.bindHost, boundPort)
  const text =
    spec.kind === 'dynamic'
      ? `${flag} ${bind}`
      : `${flag} ${bind} → ${joinHost(spec.destHost, spec.destPort)}`
  return spec.label ? t('labelled', { label: spec.label, spec: ltr(text) }) : text
}
