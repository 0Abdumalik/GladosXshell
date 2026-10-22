import { invoke } from '@tauri-apps/api/core'
import { logApp } from '../applog'
import { h } from '../dom'
import { ltr, messages, pl } from '../i18n'
import { addIcon, scopedIcon } from '../icons'
import type { PanelHost } from '../layout'
import { onProfiles } from '../profiles-store'
import { describeError } from '../protocol'
import { allSessions, onActive, onConnected, onCwd, onEnded } from '../sessions'
import type { Settings } from '../settings-model'
import { onSettings, settings, updateSettings } from '../settings-store'
import { registerSpecs } from '../spec-completion'
import { onThemeChange } from '../theme'
import type { Dispose, MenuWhere } from './api'
import {
  configValue,
  dispatch,
  forgetStorage,
  menuProvider,
  type Runtime,
  runPluginCommand,
  sessionView,
  setConfigValue,
} from './external-api'
import { PluginFrame, type ThemeMessage } from './external-frame'
import {
  commandId,
  type DeclaredPanel,
  type DeclaredSetting,
  type ExternalManifest,
  type Installed,
  parseContributions,
  pluginProfiles,
  pluginUrl,
  THEME_TOKENS,
} from './external-model'
import {
  addKeybinding,
  commands,
  menus,
  panels,
  snippets,
  terminalAddons,
  themes,
} from './registry'
import { highlightAddon } from './terminal-addons'

const t = messages({
  log: { zh: '[插件 {name}] {text}', en: '[Plugin {name}] {text}', ug: '[قىستۇرما {name}] {text}' },
  panelFailed: {
    zh: '插件 {name} 的面板 {panel} 出错：{error}',
    en: 'Panel {panel} of plugin {name} failed: {error}',
    ug: '{name} قىستۇرمىسىنىڭ {panel} تاختىسىدا خاتالىق كۆرۈلدى: {error}',
  },
  problem: {
    zh: '插件 {name}：{problem}',
    en: 'Plugin {name}: {problem}',
    ug: 'قىستۇرما {name}: {problem}',
  },
  badKey: {
    zh: '插件 {name}：无法识别的快捷键 {key}',
    en: 'Plugin {name}: unrecognized shortcut {key}',
    ug: 'قىستۇرما {name}: تونۇغىلى بولمايدىغان تېزلەتمە كۇنۇپكا {key}',
  },
  timedOut: {
    zh: '插件没有在 {n} 秒内完成启动',
    en: (p) => `The plugin didn't finish starting within ${pl('second')(p)}`,
    ug: 'قىستۇرما {n} سېكۇنت ئىچىدە قوزغىلىپ بولالمىدى',
  },
  stopFailed: {
    zh: '插件 {name} 停止时出错：{error}',
    en: 'Plugin {name} failed while stopping: {error}',
    ug: '{name} قىستۇرمىسىنى توختاتقاندا خاتالىق كۆرۈلدى: {error}',
  },
  startFailed: {
    zh: '插件 {name}（{id}）启动失败：{error}',
    en: 'Plugin {name} ({id}) failed to start: {error}',
    ug: '{name} قىستۇرمىسى ({id}) قوزغىتالمىدى: {error}',
  },
})

export interface ExternalState {
  id: string
  manifest: ExternalManifest | null
  enabled: boolean
  active: boolean
  error: string | null
  granted: string[]
  problems: string[]
}

const ACTIVATE_TIMEOUT = 10_000
const WINDOWS = navigator.userAgent.includes('Windows')

let installed: Installed[] = []
const runtimes = new Map<string, Runtime>()
const errors = new Map<string, string>()
const listeners = new Set<() => void>()
/** Kept even after removal: the layout caches the host per panel id, so a reinstall reuses it. */
const panelHosts = new Map<string, HTMLElement>()
let frameHost: HTMLElement | null = null

const emit = () => {
  for (const listener of listeners) listener()
}

export function onExternalChange(listener: () => void): Dispose {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

const wanted = (id: string, s: Settings = settings()) => !s.plugins.disabled.includes(id)

export function externalStates(): ExternalState[] {
  return installed.map((entry) => {
    const rt = runtimes.get(entry.id)
    return {
      id: entry.id,
      manifest: entry.manifest,
      enabled: wanted(entry.id),
      active: rt !== undefined && (rt.background === null || started.has(rt)),
      error: entry.error ?? errors.get(entry.id) ?? null,
      granted: rt ? [...rt.granted] : entry.granted,
      // Kept for plugins that failed to start too, since a skipped entry is often the cause.
      problems: entry.manifest
        ? (rt?.contributions ?? parseContributions(entry.manifest)).problems
        : [],
    }
  })
}

function themeMessage(): ThemeMessage {
  const style = getComputedStyle(document.documentElement)
  const tokens: Record<string, string> = {}
  for (const name of THEME_TOKENS) {
    const value = style.getPropertyValue(name).trim()
    if (value) tokens[name] = value
  }
  return { mode: document.documentElement.dataset.theme ?? 'dark', tokens }
}

function broadcast(name: string, data: unknown, permission?: string): void {
  for (const rt of runtimes.values()) {
    if (permission && !rt.granted.has(permission)) continue
    for (const frame of rt.frames) frame.emit(name, data)
  }
}

/** Runtimes whose background page finished activating. */
const started = new WeakSet<Runtime>()
const owned = new WeakMap<Runtime, Dispose[]>()

function openFrame(
  rt: Runtime,
  path: string,
  panel: string | null,
  parent: HTMLElement,
  ready: () => void = () => {},
): PluginFrame {
  const frame = new PluginFrame({
    src: pluginUrl(path, WINDOWS),
    plugin: rt.id,
    panel,
    theme: themeMessage,
    handle: (f, method, args) => dispatch(rt, f, method, args),
    log: (level, text) => logApp(level, t('log', { name: rt.manifest.name, text })),
    ready,
    fail: (error) => {
      if (panel === null) fail(rt, error)
      else logApp('error', t('panelFailed', { name: rt.manifest.name, panel: ltr(panel), error }))
    },
  })
  rt.frames.add(frame)
  parent.append(frame.element)
  return frame
}

function panelContainer(id: string): HTMLElement {
  let element = panelHosts.get(id)
  if (!element) {
    element = h('div', { class: 'plugin-panel' })
    panelHosts.set(id, element)
  }
  return element
}

function mountPanel(rt: Runtime, panel: DeclaredPanel, keep: (dispose: Dispose) => void): void {
  const id = `${rt.id}/${panel.name}`
  const container = panelContainer(id)
  openFrame(rt, `${rt.id}/${panel.page}`, panel.name, container)
  keep(
    panels.add({
      id,
      title: panel.title,
      icon: panel.icon && scopedIcon(rt.id, panel.icon),
      region: panel.region,
      build: (): PanelHost => ({ element: container }),
    }),
  )
}

function start(entry: Installed, manifest: ExternalManifest): void {
  const rt: Runtime = {
    id: entry.id,
    manifest,
    contributions: parseContributions(manifest),
    granted: new Set(entry.granted),
    denied: new Set(),
    asking: new Map(),
    frames: new Set(),
    background: null,
    handlers: new Map(),
    dynamic: new Map(),
    status: new Map(),
    menus: new Map(),
    icons: new Map(),
    changed: emit,
  }
  const subscriptions: Dispose[] = []
  const keep = (dispose: Dispose) => void subscriptions.push(dispose)
  owned.set(rt, subscriptions)
  runtimes.set(rt.id, rt)
  errors.delete(rt.id)
  const c = rt.contributions
  for (const problem of c.problems) logApp('warn', t('problem', { name: manifest.name, problem }))
  for (const icon of c.icons) keep(addIcon(rt.id, icon.name, icon.data))
  for (const def of c.commands) {
    keep(
      commands.add({
        id: commandId(rt.id, def.name),
        title: def.title,
        icon: def.icon && scopedIcon(rt.id, def.icon),
        category: manifest.name,
        run: () => runPluginCommand(rt, def.name, null),
      }),
    )
  }
  for (const binding of c.keybindings) {
    const dispose = addKeybinding(binding.key, binding.command)
    if (dispose) keep(dispose)
    else logApp('warn', t('badKey', { name: manifest.name, key: ltr(binding.key) }))
  }
  for (const [where, items] of Object.entries(c.menus)) {
    if (items) keep(menus.add({ where: where as MenuWhere, provider: menuProvider(rt, items) }))
  }
  for (const def of c.themes) keep(themes.add(def))
  if (c.completions) keep(registerSpecs(c.completions))
  for (const def of c.snippets) keep(snippets.add(def))
  if (c.highlights.length > 0) keep(terminalAddons.add(highlightAddon(c.highlights)))
  for (const panel of c.panels) mountPanel(rt, panel, keep)
  if (manifest.main && frameHost) {
    const timer = window.setTimeout(
      () => fail(rt, t('timedOut', { n: ACTIVATE_TIMEOUT / 1000 })),
      ACTIVATE_TIMEOUT,
    )
    keep(() => window.clearTimeout(timer))
    rt.background = openFrame(rt, `__host/${rt.id}`, null, frameHost, () => {
      window.clearTimeout(timer)
      started.add(rt)
      emit()
    })
  }
  emit()
}

function stop(rt: Runtime): void {
  if (runtimes.get(rt.id) !== rt) return
  runtimes.delete(rt.id)
  started.delete(rt)
  for (const frame of rt.frames) frame.close()
  rt.frames.clear()
  rt.background = null
  const subscriptions = owned.get(rt) ?? []
  for (let i = subscriptions.length - 1; i >= 0; i--) {
    try {
      subscriptions[i]()
    } catch (error) {
      logApp('error', t('stopFailed', { name: rt.manifest.name, error: describeError(error) }))
    }
  }
  subscriptions.length = 0
  emit()
}

function fail(rt: Runtime, error: string): void {
  if (runtimes.get(rt.id) !== rt) return
  errors.set(rt.id, error)
  logApp('error', t('startFailed', { name: rt.manifest.name, id: ltr(rt.id), error }))
  stop(rt)
}

/** Starts and stops plugins to match the settings; a failed one waits for a manual restart. */
function sync(s: Settings = settings()): void {
  for (const entry of installed) {
    const rt = runtimes.get(entry.id)
    if (entry.manifest === null || !wanted(entry.id, s)) {
      if (rt) stop(rt)
      if (errors.delete(entry.id)) emit()
    } else if (!rt && !errors.has(entry.id)) {
      start(entry, entry.manifest)
    }
  }
}
/** Re-reads the plugin folder; plugins whose manifest changed restart. */
export async function reloadExternal(): Promise<void> {
  const next = await invoke<Installed[]>('plugins_list')
  for (const rt of [...runtimes.values()]) {
    const entry = next.find((e) => e.id === rt.id)
    if (!entry || JSON.stringify(entry.manifest) !== JSON.stringify(rt.manifest)) {
      stop(rt)
      errors.delete(rt.id)
    }
  }
  installed = next
  sync()
  emit()
}

function forget(id: string): void {
  const rt = runtimes.get(id)
  if (rt) stop(rt)
  errors.delete(id)
  forgetStorage(id)
}

export async function restartExternal(id: string): Promise<void> {
  forget(id)
  await reloadExternal()
}

/** Installs from a folder or a `.gxplugin` archive; a plugin with the same id is replaced. */
export async function installExternal(path: string): Promise<ExternalManifest> {
  const manifest = await invoke<ExternalManifest>('plugin_install', { path })
  forget(manifest.id)
  await reloadExternal()
  return manifest
}

export async function removeExternal(id: string): Promise<void> {
  forget(id)
  await invoke('plugin_remove', { id })
  await updateSettings((d) => {
    d.plugins.disabled = d.plugins.disabled.filter((x) => x !== id)
  })
  await reloadExternal()
}

export function setExternalEnabled(id: string, on: boolean): Promise<void> {
  return updateSettings((d) => {
    const without = d.plugins.disabled.filter((x) => x !== id)
    if (!on) without.push(id)
    d.plugins.disabled = without
  })
}

export async function revokePermission(id: string, permission: string): Promise<void> {
  await invoke('plugin_revoke', { id, permissions: [permission] })
  const rt = runtimes.get(id)
  if (rt) {
    rt.granted.delete(permission)
    for (const frame of rt.frames) {
      if (permission === 'terminal.read') frame.watching.clear()
      if (permission === 'terminal.input') frame.watchingInput.clear()
    }
  }
  const entry = installed.find((e) => e.id === id)
  if (entry) entry.granted = entry.granted.filter((p) => p !== permission)
  emit()
}

export function externalSettings(id: string): DeclaredSetting[] {
  const manifest = installed.find((e) => e.id === id)?.manifest
  return manifest ? parseContributions(manifest).configuration : []
}

export const externalConfigValue = configValue

export async function setExternalConfig(
  id: string,
  setting: DeclaredSetting,
  value: unknown,
): Promise<void> {
  await setConfigValue(id, setting, value)
  for (const frame of runtimes.get(id)?.frames ?? []) {
    frame.emit('config', { key: setting.key, value })
  }
}

/**
 * Feeds terminal output to the pages that watch it and hold `terminal.read`, and typed input to
 * those that hold `terminal.input`.
 */
function terminalTap(): Dispose {
  return terminalAddons.add({
    attach: (host) => {
      const decoder = new TextDecoder()
      const offOutput = host.onOutput((bytes) => {
        const id = host.sessionId()
        if (id === null) return
        let text: string | null = null
        for (const rt of runtimes.values()) {
          if (!rt.granted.has('terminal.read')) continue
          for (const frame of rt.frames) {
            if (!frame.watching.has(id)) continue
            text ??= decoder.decode(bytes, { stream: true })
            frame.pushOutput(id, text)
          }
        }
      })
      const offInput = host.onInput((data) => {
        const id = host.sessionId()
        if (id === null) return
        for (const rt of runtimes.values()) {
          if (!rt.granted.has('terminal.input')) continue
          for (const frame of rt.frames) if (frame.watchingInput.has(id)) frame.pushInput(id, data)
        }
      })
      return () => {
        offOutput()
        offInput()
      }
    },
  })
}

export async function loadExternalPlugins(): Promise<void> {
  frameHost = h('div', { class: 'plugin-frames', 'aria-hidden': 'true' })
  frameHost.hidden = true
  document.body.append(frameHost)
  terminalTap()
  onThemeChange(() => broadcast('theme', themeMessage()))
  onProfiles((data) => broadcast('profiles', pluginProfiles(data), 'profiles.read'))
  let queued = false
  const sessionsChanged = () => {
    if (queued) return
    queued = true
    queueMicrotask(() => {
      queued = false
      const list = allSessions()
        .filter((s) => s.id !== null)
        .map(sessionView)
      broadcast('sessions', list, 'sessions.read')
    })
  }
  onActive(sessionsChanged)
  onConnected(sessionsChanged)
  onEnded(sessionsChanged)
  onCwd((info) => {
    if (info.id !== null) broadcast('cwd', { sessionId: info.id, cwd: info.cwd }, 'sessions.read')
    sessionsChanged()
  })
  onSettings((next, previous) => {
    if (next.plugins !== previous.plugins) sync(next)
  })
  await reloadExternal()
}
