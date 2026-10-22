import { invoke } from '@tauri-apps/api/core'
import { readText, writeText } from '@tauri-apps/plugin-clipboard-manager'
import { logApp } from '../applog'
import { confirmDialog, promptDialog } from '../dialogs'
import { setStatus } from '../dom'
import { ltr, messages } from '../i18n'
import { common } from '../i18n-common'
import { iconMarkup, iconNames, registerIcon, resolveIcon, scopedIcon } from '../icons'
import { type MenuItem, showMenu } from '../menu'
import { reloadProfiles, serverTitle } from '../profiles-store'
import { describeError, type ServerView } from '../protocol'
import { activeSession, allSessions, type SessionInfo } from '../sessions'
import type { Dispose, MenuProvider, MenuWhere } from './api'
import type { PluginFrame } from './external-frame'
import {
  type Contributions,
  commandId,
  type DeclaredMenuItem,
  type DeclaredSetting,
  describePermission,
  type ExternalManifest,
  iconRef,
  MENU_PLACES,
  matchesWhen,
  menuEntries,
  permissionFor,
  pluginProfiles,
  pluginServer,
  profilePatch,
  text,
  validName,
} from './external-model'
import { pick } from './palette'
import { addKeybinding, commands, menus, runCommand, statusItems } from './registry'

const t = messages({
  pluginError: {
    zh: '插件 {name}：{error}',
    en: 'Plugin {name}: {error}',
    ug: 'قىستۇرما {name}: {error}',
  },
  noCode: {
    zh: '插件 {name} 没有可运行的代码',
    en: 'Plugin {name} has no code to run',
    ug: '{name} قىستۇرمىسىدا ئىجرا قىلغىلى بولىدىغان كود يوق',
  },
  undeclared: {
    zh: '插件没有在 plugin.json 中声明这项权限：{permission}',
    en: "The plugin didn't declare this permission in plugin.json: {permission}",
    ug: 'قىستۇرما بۇ ھوقۇقنى plugin.json دا ئېلان قىلمىغان: {permission}',
  },
  notGranted: {
    zh: '没有获得授权：{permission}',
    en: 'Permission not granted: {permission}',
    ug: 'رۇخسەت قىلىنمىدى: {permission}',
  },
  askTitle: {
    zh: '插件请求权限',
    en: 'Plugin permission request',
    ug: 'قىستۇرما ھوقۇق تەلەپ قىلىدۇ',
  },
  askText: {
    zh: '插件“{name}”（{id}）请求：{permission}。\n允许后会一直有效，可以在 设置 → 插件 中撤销。',
    en: 'Plugin "{name}" ({id}) requests: {permission}.\nOnce allowed, it stays allowed until you revoke it in Settings → Plugins.',
    ug: '«{name}» قىستۇرمىسى ({id}) تەلەپ قىلىدۇ: {permission}.\nرۇخسەت قىلغاندىن كېيىن داۋاملىق كۈچكە ئىگە بولىدۇ، تەڭشەك ← قىستۇرما دا ھوقۇقنى بىكار قىلغىلى بولىدۇ.',
  },
  allow: { zh: '允许', en: 'Allow', ug: 'رۇخسەت قىل' },
  tooLong: {
    zh: '{what}必须是不超过 {max} 个字符的文本',
    en: '{what} must be text of at most {max} characters',
    ug: '{what} ئەڭ كۆپ {max} ھەرپلىك تېكىست بولۇشى كېرەك',
  },
  empty: { zh: '{what}不能为空', en: "{what} can't be empty", ug: '{what} بوش قالسا بولمايدۇ' },
  badName: {
    zh: '{what}只能包含小写字母、数字、点和横线',
    en: '{what} can only contain lowercase letters, digits, dots and hyphens',
    ug: '{what} پەقەت كىچىك ھەرپ، رەقەم، چېكىت ۋە سىزىقچىدىن تەركىب تاپالايدۇ',
  },
  badTimeout: {
    zh: '超时必须是正数（秒）',
    en: 'Timeout must be a positive number of seconds',
    ug: 'ۋاقىت چېكى مۇسبەت سان (سېكۇنت) بولۇشى كېرەك',
  },
  noSession: {
    zh: '会话不存在或已关闭',
    en: 'The session does not exist or has been closed',
    ug: 'ئەڭگىمە مەۋجۇت ئەمەس ياكى تاقالغان',
  },
  sshOnly: {
    zh: '只能对已连接的 SSH 会话使用',
    en: 'Only works with connected SSH sessions',
    ug: 'پەقەت ئۇلانغان SSH ئەڭگىمىسىدىلا ئىشلەتكىلى بولىدۇ',
  },
  tooManyWatches: {
    zh: '同时监听的终端太多',
    en: 'Too many terminals watched at once',
    ug: 'بىرلا ۋاقىتتا كۆزىتىلىۋاتقان تېرمىنال بەك كۆپ',
  },
  noServer: {
    zh: '保存的服务器不存在',
    en: 'The saved server does not exist',
    ug: 'ساقلانغان مۇلازىمېتىر مەۋجۇت ئەمەس',
  },
  tooManyCommands: {
    zh: '注册的命令太多',
    en: 'Too many registered commands',
    ug: 'تىزىملاتقان بۇيرۇق بەك كۆپ',
  },
  commandUnavailable: {
    zh: '命令不可用：{id}',
    en: 'Command not available: {id}',
    ug: 'بۇيرۇقنى ئىشلەتكىلى بولمايدۇ: {id}',
  },
  badKey: {
    zh: '无法识别的快捷键：{key}',
    en: 'Unrecognized shortcut: {key}',
    ug: 'تونۇغىلى بولمايدىغان تېزلەتمە كۇنۇپكا: {key}',
  },
  badPlace: {
    zh: '不支持的菜单位置：{where}',
    en: 'Unsupported menu location: {where}',
    ug: 'قوللىمايدىغان تىزىملىك ئورنى: {where}',
  },
  badMenuItems: {
    zh: '菜单项格式不正确：需要 label 和本插件的 command，最多 20 项',
    en: 'Malformed menu items: each needs a label and a command of this plugin, 20 at most',
    ug: 'تىزىملىك تۈرىنىڭ فورماتى خاتا: ھەر بىر تۈردە label ۋە بۇ قىستۇرمىغا تەۋە command بولۇشى كېرەك، ئەڭ كۆپ 20 تۈر',
  },
  tooManyStatus: {
    zh: '状态栏项太多',
    en: 'Too many status bar items',
    ug: 'ھالەت بالدىقى تۈرى بەك كۆپ',
  },
  prefixed: { zh: '{name}：{text}', en: '{name}: {text}', ug: '{name}: {text}' },
  badPickItems: {
    zh: '选项必须是数组，最多 {max} 项',
    en: 'Options must be an array of at most {max} items',
    ug: 'تاللانمىلار ئەڭ كۆپ {max} تۈرلۈك تىزىلما بولۇشى كېرەك',
  },
  menuNotFocused: {
    zh: '只能在用户正在操作的插件面板里打开菜单',
    en: 'Menus can only open in the plugin panel the user is working in',
    ug: 'تىزىملىكنى پەقەت ئىشلەتكۈچى مەشغۇلات قىلىۋاتقان قىستۇرما تاختىسىدىلا ئاچقىلى بولىدۇ',
  },
  badMenu: {
    zh: '菜单项必须是数组，最多 {max} 项',
    en: 'Menu items must be an array of at most {max} items',
    ug: 'تىزىملىك تۈرلىرى ئەڭ كۆپ {max} تۈرلۈك تىزىلما بولۇشى كېرەك',
  },
  badIconName: {
    zh: '图标名只能包含小写字母、数字和横线，最长 48 个字符',
    en: 'Icon names can only contain lowercase letters, digits and hyphens, up to 48 characters',
    ug: 'سىنبەلگە ئاتى پەقەت كىچىك ھەرپ، رەقەم ۋە سىزىقچىدىن تەركىب تاپالايدۇ، ئەڭ ئۇزۇن بولسا 48 ھەرپ',
  },
  tooManyIcons: {
    zh: '注册的图标太多',
    en: 'Too many registered icons',
    ug: 'تىزىملاتقان سىنبەلگە بەك كۆپ',
  },
  badIconData: {
    zh: '图标数据不正确：需要只含 <path d> 的 SVG、路径数据或 { path, viewBox }',
    en: 'Invalid icon data: expected an SVG with only <path d>, path data, or { path, viewBox }',
    ug: 'سىنبەلگە سانلىق مەلۇماتى خاتا: پەقەت <path d> لا بار SVG، يول سانلىق مەلۇماتى ياكى { path, viewBox } بولۇشى كېرەك',
  },
  reservedKey: {
    zh: '以 gx: 开头的存储键留给应用使用',
    en: 'Storage keys starting with gx: are reserved for the app',
    ug: 'gx: بىلەن باشلانغان ساقلاش ئاچقۇچلىرى ئەپ ئۈچۈن ساقلاپ قويۇلغان',
  },
  noSetting: {
    zh: '插件没有声明设置项 {key}',
    en: 'The plugin has not declared the setting {key}',
    ug: 'قىستۇرما {key} تەڭشەك تۈرىنى ئېلان قىلمىغان',
  },
  notConnected: {
    zh: '会话没有连接',
    en: 'The session is not connected',
    ug: 'ئەڭگىمە ئۇلانمىغان',
  },
  deleteServer: { zh: '删除服务器', en: 'Delete server', ug: 'مۇلازىمېتىرنى ئۆچۈر' },
  deleteServerText: {
    zh: '插件“{name}”要删除保存的服务器「{server}」，已保存的密码也会一起删除。',
    en: 'Plugin "{name}" wants to delete the saved server "{server}". Its saved password is deleted too.',
    ug: '«{name}» قىستۇرمىسى ساقلانغان «{server}» مۇلازىمېتىرىنى ئۆچۈرمەكچى، ساقلانغان ئىممۇ بىللە ئۆچۈرۈلىدۇ.',
  },
  badMethod: {
    zh: '不支持的请求方法：{method}',
    en: 'Unsupported request method: {method}',
    ug: 'قوللىمايدىغان ئىلتىماس ئۇسۇلى: {method}',
  },
  badHeaders: {
    zh: '请求头必须是文本，最多 50 个',
    en: 'Request headers must be text, 50 at most',
    ug: 'ئىلتىماس بېشى تېكىست بولۇشى كېرەك، ئەڭ كۆپ 50',
  },
  unknownCall: {
    zh: '未知的调用：{method}',
    en: 'Unknown call: {method}',
    ug: 'نامەلۇم چاقىرىق: {method}',
  },
  // What a checked argument is, for the messages above.
  command: { zh: '命令', en: 'Command', ug: 'بۇيرۇق' },
  commandName: { zh: '命令名', en: 'Command name', ug: 'بۇيرۇق ئاتى' },
  shortcut: { zh: '快捷键', en: 'Shortcut', ug: 'تېزلەتمە كۇنۇپكا' },
  statusId: { zh: '状态栏项 id', en: 'Status bar item id', ug: 'ھالەت بالدىقى تۈرىنىڭ id سى' },
  statusText: { zh: '状态栏文字', en: 'Status bar text', ug: 'ھالەت بالدىقى تېكىستى' },
  statusMessage: { zh: '提示', en: 'Status message', ug: 'ئەسكەرتىش ئۇچۇرى' },
  title: { zh: '标题', en: 'Title', ug: 'ماۋزۇ' },
  message: { zh: '内容', en: 'Message', ug: 'مەزمۇن' },
  fieldLabel: { zh: '输入框说明', en: 'Field label', ug: 'كىرگۈزۈش رامكىسىنىڭ ئىزاھاتى' },
  initial: { zh: '初始内容', en: 'Initial value', ug: 'دەسلەپكى مەزمۇن' },
  option: { zh: '选项', en: 'Option', ug: 'تاللانما' },
  menuItemId: { zh: '菜单项 id', en: 'Menu item id', ug: 'تىزىملىك تۈرىنىڭ id سى' },
  menuItem: { zh: '菜单项', en: 'Menu item', ug: 'تىزىملىك تۈرى' },
  storageKey: { zh: '存储键', en: 'Storage key', ug: 'ساقلاش ئاچقۇچى' },
  input: { zh: '输入内容', en: 'Input', ug: 'كىرگۈزۈش مەزمۇنى' },
  path: { zh: '路径', en: 'Path', ug: 'يول' },
  fileContent: { zh: '文件内容', en: 'File content', ug: 'ھۆججەت مەزمۇنى' },
  clipboardText: { zh: '剪贴板内容', en: 'Clipboard text', ug: 'چاپلاش تاختىسى مەزمۇنى' },
  body: { zh: '请求内容', en: 'Request body', ug: 'ئىلتىماس مەزمۇنى' },
})

/** One running third-party plugin. */
export interface Runtime {
  readonly id: string
  readonly manifest: ExternalManifest
  readonly contributions: Contributions
  granted: Set<string>
  /** Refused this run; asked again after a restart. */
  readonly denied: Set<string>
  readonly asking: Map<string, Promise<boolean>>
  readonly frames: Set<PluginFrame>
  background: PluginFrame | null
  /** Command name → the page that implements it. */
  readonly handlers: Map<string, PluginFrame>
  /** Commands registered from code rather than declared in the manifest. */
  readonly dynamic: Map<string, Dispose>
  readonly status: Map<string, Dispose>
  readonly menus: Map<MenuWhere, Dispose>
  /** Icons registered from code, by name. */
  readonly icons: Map<string, Dispose>
  /** Grants or state changed; the plugin list redraws. */
  readonly changed: () => void
}

const MAX_DYNAMIC_COMMANDS = 100
const MAX_STATUS_ITEMS = 8
const MAX_WATCHES = 16
const MAX_PICK_ITEMS = 1000
const MAX_ICONS = 64
const MAX_MENU_ITEMS = 50
const HTTP_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'])

export function reportPluginError(rt: Runtime, error: unknown): void {
  const message = t('pluginError', { name: rt.manifest.name, error: describeError(error) })
  logApp('error', message)
  setStatus(message, 'error')
}

/** A plugin's icon reference, looked up among its own icons before the built-ins. */
export function pluginIcon(rt: Runtime, value: unknown): string | undefined {
  const ref = iconRef(value)
  return ref && scopedIcon(rt.id, ref)
}

export function runPluginCommand(rt: Runtime, name: string, context: unknown): Promise<unknown> {
  const frame = rt.handlers.get(name) ?? rt.background
  if (!frame) return Promise.reject(new Error(t('noCode', { name: rt.manifest.name })))
  return frame.call('command', [name, context])
}

/** Menu items that run the plugin's command with the menu's context. */
export function menuProvider(rt: Runtime, items: DeclaredMenuItem[]): MenuProvider<MenuWhere> {
  const prefix = `${rt.id}:`
  return (context) =>
    items
      .filter((item) => matchesWhen(item.when, context))
      .map(
        (item): MenuItem => ({
          label: item.label,
          danger: item.danger,
          icon: item.icon && scopedIcon(rt.id, item.icon),
          action: () => {
            runPluginCommand(rt, item.command.slice(prefix.length), context).catch((error) =>
              reportPluginError(rt, error),
            )
          },
        }),
      )
}

const stores = new Map<string, Promise<Record<string, unknown>>>()
const CONFIG_PREFIX = 'gx:config.'

export function storageOf(id: string): Promise<Record<string, unknown>> {
  let store = stores.get(id)
  if (!store) {
    store = invoke<Record<string, unknown>>('plugin_storage_get', { id })
    stores.set(id, store)
    store.catch(() => stores.delete(id))
  }
  return store
}

export async function setStorage(id: string, key: string, value: unknown): Promise<void> {
  const stored = value === undefined ? null : value
  await invoke('plugin_storage_set', { id, key, value: stored })
  const data = await storageOf(id)
  if (stored === null) delete data[key]
  else data[key] = stored
}

export function forgetStorage(id: string): void {
  stores.delete(id)
}

export async function configValue(id: string, setting: DeclaredSetting): Promise<unknown> {
  const value = (await storageOf(id))[CONFIG_PREFIX + setting.key]
  return typeof value === typeof setting.default ? value : setting.default
}

export function setConfigValue(id: string, setting: DeclaredSetting, value: unknown) {
  return setStorage(id, CONFIG_PREFIX + setting.key, value)
}

/** A call a permission blocks; plugins see it as an error with `code: 'permission'`. */
export class PermissionError extends Error {
  readonly code = 'permission'
}

/** Asks once per permission; the answer is stored by the backend, a refusal only for this run. */
async function ensure(rt: Runtime, permission: string): Promise<void> {
  if (rt.granted.has(permission)) return
  const what = describePermission(permission)
  if (!rt.manifest.permissions.includes(permission)) {
    throw new PermissionError(t('undeclared', { permission: what }))
  }
  if (rt.denied.has(permission)) throw new PermissionError(t('notGranted', { permission: what }))
  let asking = rt.asking.get(permission)
  if (!asking) {
    const { name } = rt.manifest
    asking = confirmDialog(
      t('askTitle'),
      t('askText', { name, id: ltr(rt.id), permission: what }),
      t('allow'),
      false,
      true,
    )
      .then(async (yes) => {
        if (!yes) {
          rt.denied.add(permission)
          return false
        }
        const granted = await invoke<string[]>('plugin_grant', {
          id: rt.id,
          permissions: [permission],
        })
        rt.granted = new Set(granted)
        return true
      })
      .finally(() => {
        rt.asking.delete(permission)
        rt.changed()
      })
    rt.asking.set(permission, asking)
  }
  if (!(await asking)) throw new PermissionError(t('notGranted', { permission: what }))
}

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}

function str(value: unknown, what: string, max: number): string {
  if (typeof value !== 'string' || value.length > max) {
    throw new Error(t('tooLong', { what, max }))
  }
  return value
}

function label(value: unknown, what: string, max: number): string {
  const clean = text(value, max)
  if (!clean) throw new Error(t('empty', { what }))
  return clean
}

function name(value: unknown, what: string): string {
  if (!validName(value)) throw new Error(t('badName', { what }))
  return value
}

/** A command of this plugin, by name or by full id. */
function ownName(rt: Runtime, value: unknown): string {
  const raw =
    typeof value === 'string' && value.startsWith(`${rt.id}:`)
      ? value.slice(rt.id.length + 1)
      : value
  return name(raw, t('command'))
}

function seconds(value: unknown, fallback: number, max: number): number {
  if (value === undefined || value === null) return fallback
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new Error(t('badTimeout'))
  }
  return Math.min(Math.ceil(value), max)
}

function session(value: unknown, ssh: boolean): SessionInfo {
  const info = allSessions().find((s) => s.id !== null && s.id === value)
  if (!info) throw new Error(t('noSession'))
  if (ssh && (info.kind !== 'ssh' || info.state !== 'live')) {
    throw new Error(t('sshOnly'))
  }
  return info
}

export const sessionView = (info: SessionInfo) => ({
  id: info.id,
  kind: info.kind,
  title: info.title,
  state: info.state,
  cwd: info.cwd,
})

function watch(set: Set<number>, sessionId: unknown): null {
  const info = session(sessionId, false)
  if (!set.has(info.id as number) && set.size >= MAX_WATCHES) {
    throw new Error(t('tooManyWatches'))
  }
  set.add(info.id as number)
  return null
}

async function savedServer(id: unknown): Promise<ServerView> {
  const server = (await reloadProfiles()).servers.find((s) => s.id === id)
  if (!server) throw new Error(t('noServer'))
  return server
}

type Method = (rt: Runtime, frame: PluginFrame, args: unknown[]) => unknown

const METHODS: Record<string, Method> = {
  'commands.register': (rt, frame, [raw, title, icon]) => {
    const command = name(raw, t('commandName'))
    rt.dynamic.get(command)?.()
    const release = () => {
      if (rt.handlers.get(command) === frame) rt.handlers.delete(command)
    }
    rt.handlers.set(command, frame)
    if (rt.contributions.commands.some((c) => c.name === command)) {
      frame.own(release)
      return null
    }
    if (rt.dynamic.size >= MAX_DYNAMIC_COMMANDS) throw new Error(t('tooManyCommands'))
    const remove = commands.add({
      id: commandId(rt.id, command),
      title: text(title, 64) ?? command,
      icon: pluginIcon(rt, icon),
      category: rt.manifest.name,
      run: () => runPluginCommand(rt, command, null),
    })
    const dispose = () => {
      remove()
      release()
      if (rt.dynamic.get(command) === dispose) rt.dynamic.delete(command)
    }
    rt.dynamic.set(command, dispose)
    frame.own(dispose)
    return null
  },
  'commands.run': async (rt, _frame, [raw]) => {
    const id = commandId(rt.id, ownName(rt, raw))
    if (!(await runCommand(id))) throw new Error(t('commandUnavailable', { id: ltr(id) }))
    return null
  },
  'keybindings.register': (rt, frame, [key, command]) => {
    const dispose = addKeybinding(
      str(key, t('shortcut'), 32),
      commandId(rt.id, ownName(rt, command)),
    )
    if (!dispose) throw new Error(t('badKey', { key: ltr(String(key)) }))
    frame.own(dispose)
    return null
  },
  'menus.set': (rt, frame, [where, items]) => {
    if (!MENU_PLACES.includes(where as MenuWhere))
      throw new Error(t('badPlace', { where: ltr(String(where)) }))
    const place = where as MenuWhere
    const entries = menuEntries(rt.id, items)
    if (!entries) throw new Error(t('badMenuItems'))
    rt.menus.get(place)?.()
    rt.menus.delete(place)
    if (entries.length === 0) return null
    const remove = menus.add({ where: place, provider: menuProvider(rt, entries) })
    const dispose = () => {
      remove()
      if (rt.menus.get(place) === dispose) rt.menus.delete(place)
    }
    rt.menus.set(place, dispose)
    frame.own(dispose)
    return null
  },
  'statusBar.set': (rt, frame, [raw]) => {
    const item = record(raw)
    const id = name(item.id, t('statusId'))
    if (!rt.status.has(id) && rt.status.size >= MAX_STATUS_ITEMS)
      throw new Error(t('tooManyStatus'))
    const tone = item.tone === 'warn' || item.tone === 'error' ? item.tone : 'info'
    const command =
      item.command === undefined || item.command === null
        ? undefined
        : commandId(rt.id, ownName(rt, item.command))
    rt.status.get(id)?.()
    const remove = statusItems.add({
      id: `${rt.id}:${id}`,
      text: label(item.text, t('statusText'), 80),
      title: text(item.title, 200) ?? rt.manifest.name,
      icon: pluginIcon(rt, item.icon),
      tone,
      command,
    })
    const dispose = () => {
      remove()
      if (rt.status.get(id) === dispose) rt.status.delete(id)
    }
    rt.status.set(id, dispose)
    frame.own(dispose)
    return null
  },
  'statusBar.remove': (rt, _frame, [id]) => {
    rt.status.get(name(id, t('statusId')))?.()
    return null
  },
  // Dialog titles carry the plugin's name so a plugin cannot pass itself off as the app.
  'ui.status': (rt, _frame, [message, tone]) => {
    setStatus(
      t('prefixed', { name: rt.manifest.name, text: label(message, t('statusMessage'), 200) }),
      tone === 'error' ? 'error' : 'info',
    )
    return null
  },
  'ui.confirm': (rt, _frame, [title, message, ok]) =>
    confirmDialog(
      t('prefixed', { name: rt.manifest.name, text: label(title, t('title'), 64) }),
      str(message, t('message'), 2000),
      text(ok, 16) ?? common('ok'),
    ),
  'ui.prompt': (rt, _frame, [title, field, initial]) =>
    promptDialog(
      t('prefixed', { name: rt.manifest.name, text: label(title, t('title'), 64) }),
      label(field, t('fieldLabel'), 64),
      initial === undefined || initial === null ? '' : str(initial, t('initial'), 2000),
      common('ok'),
    ),
  'ui.pick': async (rt, _frame, [raw, placeholder]) => {
    if (!Array.isArray(raw) || raw.length > MAX_PICK_ITEMS) {
      throw new Error(t('badPickItems', { max: MAX_PICK_ITEMS }))
    }
    const items = raw.map(record)
    const chosen = await pick(
      items.map((item, index) => ({
        label: label(item.label, t('option'), 200),
        detail: text(item.detail, 200) ?? undefined,
        icon: pluginIcon(rt, item.icon),
        value: index,
      })),
      text(placeholder, 64) ?? undefined,
    )
    return chosen === null ? null : (items[chosen].value ?? null)
  },
  'ui.menu': (rt, frame, [x, y, raw]) => {
    const box = frame.element.getBoundingClientRect()
    // Only the page the user is working in, so a background page cannot pop menus up.
    if (document.activeElement !== frame.element || box.width === 0) {
      throw new Error(t('menuNotFocused'))
    }
    if (!Array.isArray(raw) || raw.length > MAX_MENU_ITEMS) {
      throw new Error(t('badMenu', { max: MAX_MENU_ITEMS }))
    }
    const coord = (value: unknown, size: number) =>
      typeof value === 'number' && Number.isFinite(value) ? Math.min(Math.max(value, 0), size) : 0
    return new Promise<string | null>((resolve) => {
      let chosen: string | null = null
      const items = raw.map((entry): MenuItem => {
        if (entry === 'separator') return 'separator'
        const item = record(entry)
        const id = str(item.id, t('menuItemId'), 64)
        return {
          label: label(item.label, t('menuItem'), 64),
          icon: pluginIcon(rt, item.icon),
          danger: item.danger === true,
          disabled: item.disabled === true,
          checked: typeof item.checked === 'boolean' ? item.checked : undefined,
          action: () => {
            chosen = id
          },
        }
      })
      showMenu(box.left + coord(x, box.width), box.top + coord(y, box.height), items, {
        onClose: () => resolve(chosen),
      })
    })
  },
  'icons.register': (rt, frame, [raw, data]) => {
    const icon = iconRef(raw)
    if (!icon) throw new Error(t('badIconName'))
    if (!rt.icons.has(icon) && rt.icons.size >= MAX_ICONS) throw new Error(t('tooManyIcons'))
    let remove: Dispose
    try {
      remove = registerIcon(rt.id, icon, data)
    } catch {
      throw new Error(t('badIconData'))
    }
    rt.icons.get(icon)?.()
    const dispose = () => {
      remove()
      if (rt.icons.get(icon) === dispose) rt.icons.delete(icon)
    }
    rt.icons.set(icon, dispose)
    frame.own(dispose)
    return null
  },
  'icons.list': (rt) => iconNames(rt.id),
  'icons.svg': (rt, _frame, [raw]) => {
    const icon = iconRef(raw)
    const data = icon && resolveIcon(scopedIcon(rt.id, icon))
    return data ? iconMarkup(data) : null
  },
  'storage.get': async (rt, _frame, [key]) =>
    (await storageOf(rt.id))[str(key, t('storageKey'), 128)] ?? null,
  'storage.set': async (rt, _frame, [key, value]) => {
    const k = str(key, t('storageKey'), 128)
    if (k.startsWith('gx:')) throw new Error(t('reservedKey'))
    await setStorage(rt.id, k, value)
    return null
  },
  'config.get': (rt, _frame, [key]) => {
    const setting = rt.contributions.configuration.find((s) => s.key === key)
    if (!setting) throw new Error(t('noSetting', { key: ltr(String(key)) }))
    return configValue(rt.id, setting)
  },
  'sessions.list': () =>
    allSessions()
      .filter((s) => s.id !== null)
      .map(sessionView),
  'sessions.active': () => {
    const info = activeSession()
    return info && info.id !== null ? sessionView(info) : null
  },
  'sessions.exec': (rt, _frame, [sessionId, command, options]) => {
    const info = session(sessionId, true)
    return invoke('plugin_exec', {
      id: rt.id,
      sessionId: info.id,
      command: label(command, t('command'), 8000),
      timeoutSecs: seconds(record(options).timeout, 30, 120),
    })
  },
  'terminal.write': async (_rt, _frame, [sessionId, data]) => {
    const info = session(sessionId, false)
    if (info.state !== 'live') throw new Error(t('notConnected'))
    await invoke('session_write', { id: info.id, data: str(data, t('input'), 64 * 1024) })
    return null
  },
  'terminal.watch': (_rt, frame, [sessionId]) => watch(frame.watching, sessionId),
  'terminal.unwatch': (_rt, frame, [sessionId]) => {
    if (typeof sessionId === 'number') frame.watching.delete(sessionId)
    return null
  },
  'terminal.watchInput': (_rt, frame, [sessionId]) => watch(frame.watchingInput, sessionId),
  'terminal.unwatchInput': (_rt, frame, [sessionId]) => {
    if (typeof sessionId === 'number') frame.watchingInput.delete(sessionId)
    return null
  },
  'profiles.list': async () => pluginProfiles(await reloadProfiles()),
  'profiles.save': async (_rt, _frame, [id, patch]) => {
    const existing = id === null || id === undefined ? null : await savedServer(id)
    const saved = await invoke<ServerView>('profile_save', { input: profilePatch(existing, patch) })
    await reloadProfiles()
    return pluginServer(saved)
  },
  'profiles.remove': async (rt, _frame, [id]) => {
    const server = await savedServer(id)
    const ok = await confirmDialog(
      t('prefixed', { name: rt.manifest.name, text: t('deleteServer') }),
      t('deleteServerText', { name: rt.manifest.name, server: serverTitle(server) }),
      common('delete'),
      true,
    )
    if (!ok) return false
    await invoke('profile_delete', { id: server.id })
    await reloadProfiles()
    return true
  },
  'files.list': (_rt, _frame, [sessionId, path]) =>
    invoke('sftp_list', {
      sessionId: session(sessionId, true).id,
      path: label(path, t('path'), 4096),
    }),
  'files.readText': (rt, _frame, [sessionId, path]) =>
    invoke('plugin_file_read', {
      id: rt.id,
      sessionId: session(sessionId, true).id,
      path: label(path, t('path'), 4096),
    }),
  'files.writeText': async (rt, _frame, [sessionId, path, content]) => {
    await invoke('plugin_file_write', {
      id: rt.id,
      sessionId: session(sessionId, true).id,
      path: label(path, t('path'), 4096),
      text: str(content, t('fileContent'), 4 * 1024 * 1024),
    })
    return null
  },
  'clipboard.read': () => readText(),
  'clipboard.write': async (_rt, _frame, [value]) => {
    await writeText(str(value, t('clipboardText'), 1024 * 1024))
    return null
  },
  'http.request': (rt, _frame, [url, raw]) => {
    const options = record(raw)
    const method = typeof options.method === 'string' ? options.method.toUpperCase() : 'GET'
    if (!HTTP_METHODS.has(method)) throw new Error(t('badMethod', { method }))
    const headers = Object.entries(record(options.headers))
    if (headers.length > 50 || headers.some(([, v]) => typeof v !== 'string')) {
      throw new Error(t('badHeaders'))
    }
    return invoke('plugin_http', {
      id: rt.id,
      url: str(url, common('address'), 4096),
      method,
      headers: Object.fromEntries(headers),
      body:
        options.body === undefined || options.body === null
          ? null
          : str(options.body, t('body'), 1024 * 1024),
      timeoutSecs: seconds(options.timeout, 30, 120),
    })
  },
}

/** Runs one SDK call after checking the plugin may make it. */
export async function dispatch(
  rt: Runtime,
  frame: PluginFrame,
  method: string,
  args: unknown[],
): Promise<unknown> {
  const run = Object.hasOwn(METHODS, method) ? METHODS[method] : undefined
  if (!run) throw new Error(t('unknownCall', { method }))
  const permission = permissionFor(method, args)
  if (permission instanceof Error) throw permission
  if (permission) await ensure(rt, permission)
  return run(rt, frame, args)
}
