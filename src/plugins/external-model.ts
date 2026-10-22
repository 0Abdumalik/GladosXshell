import type { ITheme } from '@xterm/xterm'
import type { CommandSpec } from '../completion-data'
import { joinList, ltr, messages } from '../i18n'
import { common } from '../i18n-common'
import { ICON_NAME, type IconData, parseIcon } from '../icons'
import {
  type Advanced,
  DEFAULT_ADVANCED,
  type Profiles,
  type ServerInput,
  type ServerView,
} from '../protocol'
import type { DockRegion } from '../settings-model'
import type { SpecSet } from '../spec-completion'
import type { MenuWhere, SnippetDef, ThemeDef } from './api'

const t = messages({
  sessionsRead: {
    zh: '查看打开的会话（标题、类型、状态、当前目录）',
    en: 'See open sessions (title, type, state and current directory)',
    ug: 'ئوچۇق ئەڭگىمەلەرنى كۆرۈش (ماۋزۇ، تىپى، ھالىتى ۋە نۆۋەتتىكى مۇندەرىجە)',
  },
  sessionsExec: {
    zh: '在 SSH 会话的服务器上执行命令',
    en: 'Run commands on the servers of SSH sessions',
    ug: 'SSH ئەڭگىمىسىدىكى مۇلازىمېتىردا بۇيرۇق ئىجرا قىلىش',
  },
  terminalRead: {
    zh: '读取终端输出',
    en: 'Read terminal output',
    ug: 'تېرمىنال چىقىرىلمىسىنى ئوقۇش',
  },
  terminalInput: {
    zh: '读取你在终端里键入的内容（包括在提示符下输入的密码）',
    en: 'Read what you type in terminals (including passwords typed at a prompt)',
    ug: 'تېرمىنالدا كىرگۈزگەن مەزمۇنلىرىڭىزنى ئوقۇش (ئەسكەرتكۈچتە كىرگۈزگەن ئىممۇ بار)',
  },
  terminalWrite: {
    zh: '向终端输入内容',
    en: 'Type into terminals',
    ug: 'تېرمىنالغا مەزمۇن كىرگۈزۈش',
  },
  filesRead: {
    zh: '读取服务器上的文件',
    en: 'Read files on servers',
    ug: 'مۇلازىمېتىردىكى ھۆججەتلەرنى ئوقۇش',
  },
  filesWrite: {
    zh: '修改服务器上的文件',
    en: 'Change files on servers',
    ug: 'مۇلازىمېتىردىكى ھۆججەتلەرنى ئۆزگەرتىش',
  },
  profilesRead: {
    zh: '查看保存的服务器列表（名称、地址、用户名，不含密码）',
    en: 'See the list of saved servers (name, address and user name, without passwords)',
    ug: 'ساقلانغان مۇلازىمېتىر تىزىملىكىنى كۆرۈش (ئاتى، ئادرېسى ۋە ئىشلەتكۈچى ئاتى، ئىم يوق)',
  },
  profilesWrite: {
    zh: '新建和修改保存的服务器（不能读取或设置密码）',
    en: 'Add and change saved servers (cannot read or set passwords)',
    ug: 'ساقلانغان مۇلازىمېتىرلارنى قوشۇش ۋە ئۆزگەرتىش (ئىمنى ئوقۇيالمايدۇ ۋە بەلگىلىيەلمەيدۇ)',
  },
  clipboard: {
    zh: '读写剪贴板',
    en: 'Read and write the clipboard',
    ug: 'چاپلاش تاختىسىنى ئوقۇش ۋە يېزىش',
  },
  http: {
    zh: '访问网络地址 {host}',
    en: 'Access the network address {host}',
    ug: '{host} تور ئادرېسىنى زىيارەت قىلىش',
  },
  httpOnly: {
    zh: '只能访问 http 或 https 地址',
    en: 'Only http and https addresses can be accessed',
    ug: 'پەقەت http ياكى https ئادرېسىنىلا زىيارەت قىلغىلى بولىدۇ',
  },
  tooLong: {
    zh: '{what}必须是不超过 {max} 个字符的文本',
    en: '{what} must be text of at most {max} characters',
    ug: '{what} ئەڭ كۆپ {max} ھەرپلىك تېكىست بولۇشى كېرەك',
  },
  refusedFields: {
    zh: '不能修改这些字段：{fields}（可改：{allowed}）',
    en: "These fields can't be changed: {fields} (allowed: {allowed})",
    ug: 'بۇ بۆلەكلەرنى ئۆزگەرتكىلى بولمايدۇ: {fields} (ئۆزگەرتىشكە بولىدىغانلىرى: {allowed})',
  },
  badPort: {
    zh: '端口必须是 1 到 65535 之间的整数',
    en: 'Port must be a whole number from 1 to 65535',
    ug: 'ئېغىز 1 دىن 65535 گىچە بولغان پۈتۈن سان بولۇشى كېرەك',
  },
  hostRequired: {
    zh: '主机不能为空',
    en: 'Host is required',
    ug: 'ئاساسىي ماشىنا بوش قالسا بولمايدۇ',
  },
  userRequired: {
    zh: '用户名不能为空',
    en: 'User name is required',
    ug: 'ئىشلەتكۈچى ئاتى بوش قالسا بولمايدۇ',
  },
  user: { zh: '用户名', en: 'User name', ug: 'ئىشلەتكۈچى ئاتى' },
  groupId: { zh: '分组 id', en: 'Group id', ug: 'گۇرۇپپا id سى' },
  skipped: {
    zh: '{entry} 格式不正确，已忽略',
    en: '{entry} is malformed and was skipped',
    ug: '{entry} نىڭ فورماتى خاتا، ئېتىبارغا ئېلىنمىدى',
  },
})

/** `plugin.json` as the backend checked it. */
export interface ExternalManifest {
  id: string
  name: string
  version: string
  engine: number
  description: string
  author?: string
  main?: string
  permissions: string[]
  contributes: Record<string, unknown>
}

export interface Installed {
  id: string
  manifest: ExternalManifest | null
  error: string | null
  granted: string[]
}

/** Tokens a plugin page gets, so its panels can match the app. */
export const THEME_TOKENS = [
  'surface-0',
  'surface-1',
  'surface-2',
  'surface-3',
  'hover',
  'selected',
  'border',
  'border-strong',
  'text',
  'text-muted',
  'text-subtle',
  'accent',
  'accent-strong',
  'on-accent',
  'danger',
  'danger-surface',
  'warning',
  'success',
  'font-ui',
  'font-mono',
  'radius-sm',
  'radius-md',
  'radius-lg',
  'terminal-bg',
  'terminal-fg',
].map((name) => `--gx-${name}`)

export const PERMISSION_TEXT: Record<string, string> = {
  'sessions.read': t('sessionsRead'),
  'sessions.exec': t('sessionsExec'),
  'terminal.read': t('terminalRead'),
  'terminal.input': t('terminalInput'),
  'terminal.write': t('terminalWrite'),
  'files.read': t('filesRead'),
  'files.write': t('filesWrite'),
  'profiles.read': t('profilesRead'),
  'profiles.write': t('profilesWrite'),
  clipboard: t('clipboard'),
}

export function describePermission(permission: string): string {
  if (permission.startsWith('http:')) return t('http', { host: ltr(permission.slice(5)) })
  return PERMISSION_TEXT[permission] ?? permission
}

/** The `http:` permission a request needs: the host, plus the port when one is written out. */
export function httpPermission(url: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
  if (parsed.username || parsed.password) return null
  return `http:${parsed.hostname}${parsed.port ? `:${parsed.port}` : ''}`
}

/** What each SDK method needs; methods not listed need no permission. */
const METHOD_PERMISSIONS: Record<string, string> = {
  'sessions.list': 'sessions.read',
  'sessions.active': 'sessions.read',
  'sessions.exec': 'sessions.exec',
  'terminal.write': 'terminal.write',
  'terminal.watch': 'terminal.read',
  'terminal.watchInput': 'terminal.input',
  'profiles.list': 'profiles.read',
  'profiles.save': 'profiles.write',
  'profiles.remove': 'profiles.write',
  'files.list': 'files.read',
  'files.readText': 'files.read',
  'files.writeText': 'files.write',
  'clipboard.read': 'clipboard',
  'clipboard.write': 'clipboard',
}

/** The permission a call needs, null for none, or an Error for a request that is never allowed. */
export function permissionFor(method: string, args: readonly unknown[]): string | null | Error {
  if (method === 'http.request') {
    const url = typeof args[0] === 'string' ? args[0] : ''
    return httpPermission(url) ?? new Error(t('httpOnly'))
  }
  return METHOD_PERMISSIONS[method] ?? null
}

/** A saved server as plugins see it: no key paths, no secrets, no advanced settings. */
export function pluginServer(server: ServerView) {
  return {
    id: server.id,
    name: server.name,
    groupId: server.groupId,
    host: server.host,
    port: server.port,
    user: server.auth.user,
    method: server.auth.method,
    note: server.note,
    jumpId: server.advanced.jumpId,
    hasPassword: server.auth.hasSecret,
    lastConnectedAt: server.lastConnectedAt,
  }
}

export function pluginProfiles(data: Profiles) {
  return {
    groups: data.groups.map((g) => ({ id: g.id, name: g.name })),
    servers: data.servers.map(pluginServer),
  }
}

const PATCH_FIELDS = new Set(['name', 'groupId', 'host', 'port', 'user', 'note'])

function patchText(value: unknown, what: string, max: number): string {
  if (typeof value !== 'string' || value.length > max) {
    throw new Error(t('tooLong', { what, max }))
  }
  return value.trim()
}

/**
 * The save request for a plugin's change to a saved server, or a new one when `existing` is null.
 * Secrets are never set; moving a server to another address drops its saved password and agent
 * forwarding, so a plugin cannot send them to a host of its choosing.
 */
export function profilePatch(existing: ServerView | null, raw: unknown): ServerInput {
  const patch = record(raw)
  const refused = Object.keys(patch).filter((key) => !PATCH_FIELDS.has(key))
  if (refused.length > 0) {
    throw new Error(
      t('refusedFields', { fields: joinList(refused), allowed: joinList([...PATCH_FIELDS]) }),
    )
  }
  const has = (key: string) => Object.hasOwn(patch, key) && patch[key] !== undefined
  const host = has('host') ? patchText(patch.host, common('host'), 255) : (existing?.host ?? '')
  const user = has('user') ? patchText(patch.user, t('user'), 128) : (existing?.auth.user ?? '')
  let port = existing?.port ?? 22
  if (has('port')) {
    const value = patch.port
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 65535) {
      throw new Error(t('badPort'))
    }
    port = value
  }
  if (!host) throw new Error(t('hostRequired'))
  if (!user) throw new Error(t('userRequired'))
  let groupId = existing?.groupId ?? null
  if (has('groupId')) {
    groupId = patch.groupId === null ? null : patchText(patch.groupId, t('groupId'), 64) || null
  }
  const advanced = structuredClone(existing?.advanced ?? DEFAULT_ADVANCED) as Advanced
  const moved = existing !== null && (host !== existing.host || port !== existing.port)
  const typed =
    existing?.auth.method === 'password' || existing?.auth.method === 'keyboardInteractive'
  if (moved) advanced.agentForward = false
  return {
    id: existing?.id ?? null,
    name: has('name') ? patchText(patch.name, common('name'), 128) : (existing?.name ?? ''),
    groupId,
    host,
    port,
    note: has('note') ? patchText(patch.note, common('note'), 2000) : (existing?.note ?? ''),
    auth: {
      method: existing?.auth.method ?? 'password',
      user,
      keyPath: existing?.auth.keyPath ?? '',
      secret: moved && typed && existing?.auth.hasSecret ? { action: 'clear' } : { action: 'keep' },
    },
    advanced,
    proxySecret: { action: 'keep' },
  }
}

export const MENU_PLACES: readonly MenuWhere[] = [
  'terminal/context',
  'tab/context',
  'tabs/background',
  'files/entry',
  'files/background',
  'commands/item',
  'commands/editor',
  'editor/context',
  'connections/server',
  'connections/group',
  'panel/tab',
  'statusbar',
  'text/context',
]

const NAME = /^[a-z0-9][a-z0-9.-]{0,47}$/
const COLOR = /^#[0-9a-f]{6}$/i
const TERMINAL_COLOR = /^(#[0-9a-f]{3,8}|rgba?\([0-9.,\s%]{1,40}\))$/i

export const validName = (value: unknown): value is string =>
  typeof value === 'string' && NAME.test(value)

const PAGE_SEGMENT = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,63}$/

/** A page inside the plugin folder: relative, no `..`, plain file names. */
export function validPage(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 200) return false
  return value.split('/').every((part) => PAGE_SEGMENT.test(part) && !part.includes('..'))
}

/** Where the app serves plugin files; Windows maps custom schemes to http://<scheme>.localhost. */
export function pluginUrl(path: string, windows: boolean): string {
  return windows ? `http://gxplugin.localhost/${path}` : `gxplugin://localhost/${path}`
}

/** Plain text a plugin shows in the app's own UI: trimmed, single line, capped. */
export function text(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping them is the point
  const clean = value.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim()
  return clean ? clean.slice(0, max) : null
}

export const commandId = (plugin: string, name: string) => `${plugin}:${name}`

/** An icon name a plugin points at; resolved against its own icons first, then the built-ins. */
export function iconRef(value: unknown): string | undefined {
  return typeof value === 'string' && ICON_NAME.test(value) ? value : undefined
}

/** A command a plugin points at: its own by name, or an already full id. */
export function ownCommand(plugin: string, value: unknown): string | null {
  if (!validName(value)) return null
  return commandId(plugin, value)
}

export interface DeclaredCommand {
  name: string
  title: string
  icon?: string
}

export interface MenuCondition {
  key: string
  negate: boolean
}

export interface DeclaredMenuItem {
  label: string
  command: string
  danger: boolean
  icon?: string
  /** Shown only when every condition holds for the menu's context. */
  when?: MenuCondition[]
}

export interface DeclaredPanel {
  name: string
  title: string
  icon?: string
  page: string
  region: DockRegion | 'hidden'
}

export interface DeclaredHighlight {
  pattern: RegExp
  foreground?: string
  background?: string
}

export interface DeclaredSetting {
  key: string
  title: string
  description: string
  type: 'boolean' | 'string' | 'number'
  default: boolean | string | number
}

export interface Contributions {
  commands: DeclaredCommand[]
  keybindings: { key: string; command: string }[]
  menus: Partial<Record<MenuWhere, DeclaredMenuItem[]>>
  panels: DeclaredPanel[]
  themes: ThemeDef[]
  completions: SpecSet | null
  snippets: SnippetDef[]
  highlights: DeclaredHighlight[]
  configuration: DeclaredSetting[]
  icons: { name: string; data: IconData }[]
  /** Entries that were skipped, for the log. */
  problems: string[]
}

const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}

const MAX_ENTRIES = 200
const MAX_ICONS = 64

const CONDITION = /^(!?)([A-Za-z][A-Za-z0-9]{0,23})$/

/** `selection`, `!live`, `selection && editable`: context fields that must be (non-)empty. */
export function parseWhen(value: unknown): MenuCondition[] | null {
  if (typeof value !== 'string' || value.length > 200) return null
  const parts = value.split('&&').map((part) => CONDITION.exec(part.trim()))
  if (parts.length > 8 || parts.some((m) => !m)) return null
  return parts.map((m) => ({ key: (m as RegExpExecArray)[2], negate: m?.[1] === '!' }))
}

const filled = (value: unknown) =>
  Array.isArray(value)
    ? value.length > 0
    : value !== null && value !== undefined && value !== false && value !== '' && value !== 0

export function matchesWhen(when: readonly MenuCondition[] | undefined, context: unknown): boolean {
  if (!when) return true
  const fields = record(context)
  return when.every(
    ({ key, negate }) => filled(Object.hasOwn(fields, key) ? fields[key] : undefined) !== negate,
  )
}

export function menuEntries(plugin: string, value: unknown): DeclaredMenuItem[] | null {
  if (!Array.isArray(value) || value.length > 20) return null
  const items: DeclaredMenuItem[] = []
  for (const raw of value) {
    const entry = record(raw)
    const label = text(entry.label, 64)
    const command = ownCommand(plugin, entry.command)
    const when = entry.when === undefined ? undefined : parseWhen(entry.when)
    if (!label || !command || when === null) return null
    items.push({ label, command, danger: entry.danger === true, icon: iconRef(entry.icon), when })
  }
  return items
}

const SPEC_KEYS = new Set(['d', 's', 'o', 'v', 'a', 'p', 'c'])

/** Completion data is plain strings in a known shape; anything else is dropped. */
function spec(value: unknown, depth: number): CommandSpec | string | null {
  if (typeof value === 'string') return value.slice(0, 200)
  if (depth > 4) return null
  const raw = record(value)
  if (Object.keys(raw).some((k) => !SPEC_KEYS.has(k)) || typeof raw.d !== 'string') return null
  const out: CommandSpec = { d: raw.d.slice(0, 200) }
  if (typeof raw.o === 'string') out.o = raw.o.slice(0, 4000)
  if (typeof raw.v === 'string') out.v = raw.v.slice(0, 4000)
  if (raw.p === true) out.p = true
  if (raw.c === true) out.c = true
  if (raw.a !== undefined) {
    const a = Object.entries(record(raw.a)).filter(([, v]) => typeof v === 'string')
    out.a = Object.fromEntries(a) as Record<string, string>
  }
  if (raw.s !== undefined) {
    const s: Record<string, CommandSpec | string> = {}
    for (const [name, sub] of Object.entries(record(raw.s)).slice(0, MAX_ENTRIES)) {
      const parsed = spec(sub, depth + 1)
      if (parsed !== null) s[name] = parsed
    }
    out.s = s
  }
  return out
}

const WORD = /^[A-Za-z0-9_.+-]{1,64}$/

function themeDef(raw: Record<string, unknown>): ThemeDef | null {
  const id = raw.id
  const name = text(raw.name, 64)
  if ((id !== 'dark' && id !== 'light') || !name) return null
  const tokens: Record<string, string> = {}
  for (const [key, value] of Object.entries(record(raw.tokens))) {
    if (typeof value === 'string') tokens[key] = value
  }
  const terminal: Record<string, string> = {}
  for (const [key, value] of Object.entries(record(raw.terminal))) {
    if (/^[a-zA-Z]{1,24}$/.test(key) && typeof value === 'string' && TERMINAL_COLOR.test(value)) {
      terminal[key] = value
    }
  }
  return {
    id,
    name,
    tokens,
    terminal: Object.keys(terminal).length > 0 ? (terminal as ITheme) : undefined,
  }
}

function highlight(raw: Record<string, unknown>): DeclaredHighlight | null {
  const source = raw.pattern
  if (typeof source !== 'string' || source.length === 0 || source.length > 200) return null
  const flags = typeof raw.flags === 'string' ? raw.flags.replace(/[^iu]/g, '') : ''
  let pattern: RegExp
  try {
    pattern = new RegExp(source, flags)
  } catch {
    return null
  }
  const pick = (value: unknown) =>
    typeof value === 'string' && COLOR.test(value) ? value : undefined
  const foreground = pick(raw.foreground)
  const background = pick(raw.background)
  if (!foreground && !background) return null
  return { pattern, foreground, background }
}

function setting(raw: Record<string, unknown>): DeclaredSetting | null {
  const key = raw.key
  const title = text(raw.title, 64)
  if (!validName(key) || !title) return null
  const description = text(raw.description, 200) ?? ''
  const type = raw.type
  const fallback = raw.default
  if (type === 'boolean') {
    return { key, title, description, type, default: fallback === true }
  }
  if (type === 'number') {
    const value = typeof fallback === 'number' && Number.isFinite(fallback) ? fallback : 0
    return { key, title, description, type, default: value }
  }
  if (type === 'string') {
    return { key, title, description, type, default: text(fallback, 500) ?? '' }
  }
  return null
}

const skipped = (entry: string) => t('skipped', { entry: ltr(entry) })

/** Reads what a manifest declares; malformed entries are skipped and named in `problems`. */
export function parseContributions(manifest: ExternalManifest): Contributions {
  const plugin = manifest.id
  const c = record(manifest.contributes)
  const out: Contributions = {
    commands: [],
    keybindings: [],
    menus: {},
    panels: [],
    themes: [],
    completions: null,
    snippets: [],
    highlights: [],
    configuration: [],
    icons: [],
    problems: [],
  }
  const each = (key: string, read: (raw: Record<string, unknown>) => boolean) => {
    for (const [index, raw] of list(c[key]).slice(0, MAX_ENTRIES).entries()) {
      if (!read(record(raw))) out.problems.push(skipped(`contributes.${key}[${index}]`))
    }
  }
  each('commands', (raw) => {
    const title = text(raw.title, 64)
    if (!validName(raw.id) || !title) return false
    out.commands.push({ name: raw.id, title, icon: iconRef(raw.icon) })
    return true
  })
  each('keybindings', (raw) => {
    const command = ownCommand(plugin, raw.command)
    if (typeof raw.key !== 'string' || raw.key.length > 32 || !command) return false
    out.keybindings.push({ key: raw.key, command })
    return true
  })
  for (const [where, items] of Object.entries(record(c.menus))) {
    const entries = MENU_PLACES.includes(where as MenuWhere) ? menuEntries(plugin, items) : null
    if (entries) out.menus[where as MenuWhere] = entries
    else out.problems.push(skipped(`contributes.menus.${where}`))
  }
  each('panels', (raw) => {
    const title = text(raw.title, 32)
    const region = raw.region
    const place =
      region === 'left' || region === 'right' || region === 'bottom' ? region : ('hidden' as const)
    if (!validName(raw.id) || !validPage(raw.page) || !title) return false
    out.panels.push({
      name: raw.id,
      title,
      icon: iconRef(raw.icon),
      page: raw.page,
      region: place,
    })
    return true
  })
  each('themes', (raw) => {
    const def = themeDef(raw)
    if (def) out.themes.push(def)
    return def !== null
  })
  if (c.completions !== undefined) {
    const specs: Record<string, CommandSpec | string> = {}
    for (const [name, raw] of Object.entries(record(c.completions)).slice(0, MAX_ENTRIES)) {
      const parsed = WORD.test(name) ? spec(raw, 0) : null
      if (parsed !== null) specs[name] = parsed
      else out.problems.push(skipped(`contributes.completions.${name}`))
    }
    out.completions = specs
  }
  each('snippets', (raw) => {
    const name = text(raw.name, 64)
    const command = typeof raw.command === 'string' ? raw.command.slice(0, 4000) : ''
    if (!name || !command.trim()) return false
    out.snippets.push({ name, command, description: text(raw.description, 200) ?? undefined })
    return true
  })
  each('terminalHighlights', (raw) => {
    const rule = highlight(raw)
    if (rule) out.highlights.push(rule)
    return rule !== null
  })
  each('configuration', (raw) => {
    const def = setting(raw)
    if (def) out.configuration.push(def)
    return def !== null
  })
  for (const [index, [name, raw]] of Object.entries(record(c.icons)).entries()) {
    const data = index < MAX_ICONS && ICON_NAME.test(name) ? parseIcon(raw) : null
    if (data) out.icons.push({ name, data })
    else out.problems.push(skipped(`contributes.icons.${name}`))
  }
  return out
}
