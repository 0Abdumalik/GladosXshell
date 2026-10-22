import { logApp } from '../applog'
import { confirmDialog, promptDialog } from '../dialogs'
import { h, setStatus } from '../dom'
import { ltr, messages } from '../i18n'
import { common } from '../i18n-common'
import { hasIcon, iconNames, namedIcon, registerIcon, scopedIcon } from '../icons'
import type { Layout, PanelHost } from '../layout'
import { type MenuItem, showMenu } from '../menu'
import { describeError } from '../protocol'
import type { Region, Settings } from '../settings-model'
import { onSettings, settings, updateSettings } from '../settings-store'
import { registerSpecs } from '../spec-completion'
import type {
  BuiltinPlugin,
  Dispose,
  MenuProvider,
  MenuWhere,
  PluginContext,
  PluginManifest,
} from './api'
import { pick } from './palette'
import {
  addKeybinding,
  commandForKey,
  commands,
  menus,
  panels,
  provideService,
  reportContributionError,
  runCommand,
  setErrorSink,
  settingsSections,
  snippets,
  statusItems,
  terminalAddons,
  themes,
} from './registry'
import { highlightAddon, linkAddon } from './terminal-addons'
import { themeTokensCss } from './theme-css'

const t = messages({
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
  startFailed: {
    zh: '插件 {name}（{id}）启动失败：{error}',
    en: 'Plugin {name} ({id}) failed to start: {error}',
    ug: '{name} قىستۇرمىسى ({id}) قوزغىتالمىدى: {error}',
  },
  pluginError: {
    zh: '插件出错：{error}',
    en: 'Plugin error: {error}',
    ug: 'قىستۇرمىدا خاتالىق كۆرۈلدى: {error}',
  },
})

export interface PluginState {
  manifest: PluginManifest
  builtin: boolean
  enabled: boolean
  active: boolean
  error: string | null
}

interface Loaded {
  plugin: BuiltinPlugin
  subscriptions: Dispose[] | null
  /** Bumped on every switch, so a slow activation that lost the race cleans up after itself. */
  generation: number
  error: string | null
}

const loaded = new Map<string, Loaded>()
const listeners = new Set<() => void>()

const emit = () => {
  for (const listener of listeners) listener()
}

/** Called when a plugin is switched on or off or fails. */
export function onPluginsChange(listener: () => void): Dispose {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function wantsEnabled(manifest: PluginManifest, s: Settings = settings()): boolean {
  if (manifest.required) return true
  return manifest.optIn
    ? s.plugins.enabled.includes(manifest.id)
    : !s.plugins.disabled.includes(manifest.id)
}

export function pluginStates(): PluginState[] {
  return [...loaded.values()].map((entry) => ({
    manifest: entry.plugin.manifest,
    builtin: true,
    enabled: wantsEnabled(entry.plugin.manifest),
    active: entry.subscriptions !== null,
    error: entry.error,
  }))
}

export function setPluginEnabled(id: string, on: boolean): Promise<void> {
  const entry = loaded.get(id)
  if (!entry || entry.plugin.manifest.required) return Promise.resolve()
  const optIn = entry.plugin.manifest.optIn ?? false
  return updateSettings((d) => {
    const list = optIn ? d.plugins.enabled : d.plugins.disabled
    const keep = optIn ? on : !on
    const without = list.filter((x) => x !== id)
    if (keep) without.push(id)
    if (optIn) d.plugins.enabled = without
    else d.plugins.disabled = without
  })
}

const storageKey = (plugin: string, key: string) => `gx.plugin.${plugin}.${key}`

function contextFor(id: string, subscriptions: Dispose[]): PluginContext {
  const keep = (dispose: Dispose): Dispose => {
    subscriptions.push(dispose)
    return dispose
  }
  // Icon names resolve to the plugin's own icon first; see resolveIcon.
  const own = <T extends { icon?: string }>(item: T): T =>
    item.icon ? { ...item, icon: scopedIcon(id, item.icon) } : item
  const ownMenu = (items: MenuItem[]) => items.map((i) => (i === 'separator' ? i : own(i)))
  return {
    id,
    commands: {
      register: (def) => keep(commands.add(own(def))),
      run: async (command) => {
        if (!(await runCommand(command))) {
          throw new Error(t('commandUnavailable', { id: ltr(command) }))
        }
      },
    },
    keybindings: {
      register: ({ key, command }) => {
        const dispose = addKeybinding(key, command)
        if (!dispose) throw new Error(t('badKey', { key: ltr(key) }))
        return keep(dispose)
      },
    },
    menus: {
      // menuItems only hands a provider the context of the menu it registered for.
      contribute: (where, provider) => {
        const wide = provider as MenuProvider<MenuWhere>
        return keep(menus.add({ where, provider: (context) => ownMenu(wide(context)) }))
      },
    },
    panels: { register: (def) => keep(panels.add(own(def))) },
    statusBar: { set: (item) => keep(statusItems.add(own(item))) },
    settings: { section: (def) => keep(settingsSections.add(def)) },
    completion: { register: (specs) => keep(registerSpecs(specs)) },
    terminal: {
      addon: (addon) => keep(terminalAddons.add(addon)),
      highlight: (rules) => keep(terminalAddons.add(highlightAddon(rules))),
      links: (rule) => keep(terminalAddons.add(linkAddon(rule))),
    },
    themes: { register: (def) => keep(themes.add(def)) },
    snippets: {
      register: (defs) => {
        const disposers = defs.map((def) => snippets.add(def))
        return keep(() => {
          for (const dispose of disposers) dispose()
        })
      },
    },
    services: { provide: (name, value) => keep(provideService(name, value)) },
    icons: {
      register: (name, data) => keep(registerIcon(id, name, data)),
      names: () => iconNames(id),
      has: (name) => hasIcon(scopedIcon(id, name)),
    },
    ui: {
      status: (text, tone) => setStatus(text, tone),
      confirm: (title, message, label, danger) => confirmDialog(title, message, label, danger),
      prompt: (title, label, initial = '') => promptDialog(title, label, initial, common('ok')),
      pick: (items, placeholder) => pick(items.map(own), placeholder),
      menu: (x, y, items) => showMenu(x, y, ownMenu(items)),
    },
    storage: {
      get<T>(key: string): T | undefined {
        const raw = localStorage.getItem(storageKey(id, key))
        if (raw === null) return undefined
        try {
          return JSON.parse(raw) as T
        } catch {
          return undefined
        }
      },
      set(key, value) {
        if (value === undefined) localStorage.removeItem(storageKey(id, key))
        else localStorage.setItem(storageKey(id, key), JSON.stringify(value))
      },
    },
    subscriptions: { add: (dispose) => void keep(dispose) },
  }
}

function release(subscriptions: Dispose[]): void {
  for (let i = subscriptions.length - 1; i >= 0; i--) {
    try {
      subscriptions[i]()
    } catch (error) {
      reportContributionError(error)
    }
  }
  subscriptions.length = 0
}

async function start(entry: Loaded): Promise<void> {
  const { manifest } = entry.plugin
  const generation = ++entry.generation
  const subscriptions: Dispose[] = []
  entry.subscriptions = subscriptions
  entry.error = null
  try {
    await entry.plugin.activate(contextFor(manifest.id, subscriptions))
    if (entry.generation !== generation) release(subscriptions)
  } catch (error) {
    release(subscriptions)
    if (entry.generation === generation) {
      entry.subscriptions = null
      entry.error = describeError(error)
    }
    logApp(
      'error',
      t('startFailed', { name: manifest.name, id: ltr(manifest.id), error: describeError(error) }),
    )
  }
  emit()
}

function stop(entry: Loaded): void {
  entry.generation++
  if (entry.subscriptions) release(entry.subscriptions)
  entry.subscriptions = null
  emit()
}

function sync(s: Settings): void {
  for (const entry of loaded.values()) {
    const want = wantsEnabled(entry.plugin.manifest, s)
    if (want && entry.subscriptions === null) void start(entry)
    else if (!want && entry.subscriptions !== null) stop(entry)
  }
}

/** Loads the built-in plugins and keeps them in step with the plugin settings. */
export function activateBuiltins(plugins: BuiltinPlugin[]): void {
  setErrorSink((error) => logApp('error', t('pluginError', { error: describeError(error) })))
  for (const plugin of plugins) {
    loaded.set(plugin.manifest.id, { plugin, subscriptions: null, generation: 0, error: null })
  }
  sync(settings())
  onSettings((next, previous) => {
    if (next.plugins !== previous.plugins) sync(next)
  })
}

/** Runs bound commands; capture phase, so shortcuts win over the focused terminal. */
export function initKeybindings(): void {
  document.addEventListener(
    'keydown',
    (event) => {
      if (event.isComposing) return
      // Plain keys stay with whatever has focus; only chords and function keys are bindable.
      if (!event.ctrlKey && !event.altKey && !event.metaKey && !/^F\d{1,2}$/.test(event.key)) return
      const id = commandForKey(event)
      if (!id) return
      event.preventDefault()
      event.stopPropagation()
      runCommand(id).catch(reportContributionError)
    },
    true,
  )
}

/** Mirrors contributed panels into the layout; a panel's host is built once and kept. */
export function bindPanels(layout: Layout): void {
  const hosts = new Map<string, PanelHost>()
  const mounted = new Set<string>()
  const refresh = () => {
    const defs = new Map(panels.list().map((def) => [def.id, def]))
    for (const id of [...mounted]) {
      if (defs.has(id)) continue
      mounted.delete(id)
      layout.removePanel(id)
    }
    const missing: { id: string; region: Region }[] = []
    for (const [id, def] of defs) {
      if (mounted.has(id)) continue
      let host = hosts.get(id)
      if (!host) {
        try {
          host = def.build()
        } catch (error) {
          reportContributionError(error)
          continue
        }
        hosts.set(id, host)
      }
      mounted.add(id)
      layout.addPanel(id, host, def.title, def.icon)
      if (!settings().layout.panels.some((p) => p.id === id)) {
        missing.push({ id, region: def.region ?? 'hidden' })
      }
    }
    if (missing.length === 0) return
    updateSettings((d) => {
      for (const place of missing) {
        if (d.layout.panels.some((p) => p.id === place.id)) continue
        d.layout.panels.push({ id: place.id, region: place.region })
      }
    }).catch(reportContributionError)
  }
  refresh()
  panels.subscribe(refresh)
}

/** Contributed status bar items, highest priority on the left. */
export function bindStatusItems(slot: HTMLElement): void {
  const render = () => {
    const items = [...statusItems.list()].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))
    slot.replaceChildren(
      ...items.map((item) => {
        const attrs = {
          class: 'statusbar-item',
          'data-tone': item.tone ?? null,
          'data-item': item.id,
          title: item.title ?? null,
        }
        const content = [
          item.icon ? namedIcon(item.icon) : null,
          h('span', { class: 'statusbar-item-text', text: item.text }),
        ]
        const command = item.command
        return command
          ? h(
              'button',
              {
                ...attrs,
                type: 'button',
                onclick: () => void runCommand(command).catch(reportContributionError),
              },
              content,
            )
          : h('span', attrs, content)
      }),
    )
  }
  render()
  statusItems.subscribe(render)
}

/**
 * Contributed theme tokens, in a stylesheet after the built-in one (styles.css holds dark and
 * light) and before the user's, so custom CSS still wins.
 */
export function bindThemeTokens(): void {
  const style = h('style', { id: 'gx-plugin-themes' })
  document.head.insertBefore(style, document.getElementById('gx-user-css'))
  const render = () => {
    style.textContent = themeTokensCss(themes.list())
  }
  render()
  themes.subscribe(render)
}
