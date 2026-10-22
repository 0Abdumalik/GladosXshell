import type { ITheme, Terminal } from '@xterm/xterm'
import type { IconInput } from '../icons'
import type { PanelHost } from '../layout'
import type { MenuItem } from '../menu'
import type { Entry } from '../protocol'
import type { Section } from '../settings-layout'
import type { DockRegion } from '../settings-model'
import type { SpecSet } from '../spec-completion'
import type { Dispose } from './bag'

export type { Dispose }

export interface CommandDef {
  id: string
  title: string
  category?: string
  /** Icon name (see `ctx.icons`), shown in the palette and on toolbar buttons. */
  icon?: string
  run: () => unknown
  /** Hidden from the palette and skipped by shortcuts while false. */
  enabled?: () => boolean
}

export interface KeybindingDef {
  /** `Ctrl+Shift+P`, `Alt+F1`, `Ctrl+,`… */
  key: string
  command: string
}

/** What each menu tells its contributors about where it was opened. */
export interface MenuContexts {
  'terminal/context': { sessionId: number | null; selection: string; live: boolean }
  'tab/context': { sessionId: number | null; kind: string; title: string }
  'tabs/background': { sessionId: number | null }
  'files/entry': { sessionId: number; directory: string | null; paths: string[] }
  'files/background': { sessionId: number; directory: string | null }
  'commands/item': { command: string; note: string }
  'commands/editor': { selection: string; text: string }
  'editor/context': { sessionId: number; path: string; selection: string }
  'connections/server': { id: string; name: string; host: string; user: string }
  'connections/group': { id: string | null; name: string; servers: string[] }
  'panel/tab': { panel: string; region: string }
  statusbar: { text: string }
  /** Text fields and selected text anywhere else in the app. */
  'text/context': { selection: string; editable: boolean }
}

export type MenuWhere = keyof MenuContexts
export type MenuProvider<W extends MenuWhere> = (context: MenuContexts[W]) => MenuItem[]

export interface PanelDef {
  /** A built-in panel name, or `plugin.id/name`. */
  id: string
  title: string
  icon?: string
  /** Where the panel goes the first time it appears. */
  region?: DockRegion | 'hidden'
  /** Called once; the same host is reused when the plugin comes back. */
  build: () => PanelHost
}

export interface StatusItem {
  id: string
  text: string
  icon?: string
  title?: string
  tone?: 'info' | 'warn' | 'error'
  /** Command run on click. */
  command?: string
  /** Higher sits further left. */
  priority?: number
}

export interface SettingsSectionDef {
  id: string
  label: string
  build: (report: (error: unknown) => void) => Section
}

export interface ThemeDef {
  /** `dark` and `light` style the built-in themes. */
  id: string
  name: string
  /** CSS custom properties set on the document while the theme is active. */
  tokens?: Record<string, string>
  terminal?: ITheme
}

export interface SnippetDef {
  name: string
  command: string
  description?: string
}

export interface HighlightRule {
  pattern: RegExp
  foreground?: string
  background?: string
}

export interface LinkRule {
  pattern: RegExp
  tooltip?: string
  open: (text: string, sessionId: number | null) => void
}

/** What a terminal addon sees of one terminal. */
export interface TerminalHost {
  term: Terminal
  kind: string
  sessionId: () => number | null
  send: (data: string) => void
  onOutput: (listener: (bytes: Uint8Array) => void) => Dispose
  /** What the user types or pastes into this terminal; not what `send` or plugins write. */
  onInput: (listener: (data: string) => void) => Dispose
}

export interface TerminalAddon {
  /** Session kinds to attach to; all when omitted. */
  kinds?: string[]
  attach: (host: TerminalHost) => Dispose
}

export interface PickItem<T> {
  label: string
  detail?: string
  hint?: string
  icon?: string
  value: T
}

/** Services one plugin offers others; absent while the providing plugin is off. */
export interface Services {
  editor: { open: (sessionId: number, entry: Entry) => Promise<void> }
  files: {
    /** Lists `path` for that session; false, keeping the old listing, if it can't be read. */
    show: (sessionId: number, path: string) => Promise<boolean>
  }
  keys: {
    /** Lets the user choose a key from the library; null when cancelled. */
    pick: () => Promise<{ path: string; encrypted: boolean } | null>
  }
}

export interface PluginManifest {
  id: string
  name: string
  version: string
  description: string
  /** Ships switched off; the user turns it on. */
  optIn?: boolean
  /** Part of the core; cannot be switched off. */
  required?: boolean
}

export interface PluginContext {
  readonly id: string
  readonly commands: {
    register(def: CommandDef): Dispose
    run(id: string): Promise<void>
  }
  readonly keybindings: { register(def: KeybindingDef): Dispose }
  readonly menus: {
    contribute<W extends MenuWhere>(where: W, provider: MenuProvider<W>): Dispose
  }
  readonly panels: { register(def: PanelDef): Dispose }
  readonly statusBar: { set(item: StatusItem): Dispose }
  readonly settings: { section(def: SettingsSectionDef): Dispose }
  readonly completion: { register(specs: SpecSet): Dispose }
  readonly terminal: {
    addon(addon: TerminalAddon): Dispose
    highlight(rules: HighlightRule[]): Dispose
    links(rule: LinkRule): Dispose
  }
  readonly themes: { register(def: ThemeDef): Dispose }
  readonly snippets: { register(defs: SnippetDef[]): Dispose }
  /**
   * Built-in Phosphor icons plus the plugin's own. Names given anywhere in this context
   * resolve to the plugin's icon first, then the built-in one.
   */
  readonly icons: {
    register(name: string, data: IconInput): Dispose
    names(): string[]
    has(name: string): boolean
  }
  readonly services: {
    provide<K extends keyof Services>(name: K, service: Services[K]): Dispose
  }
  readonly ui: {
    status(text: string, tone?: 'info' | 'error'): void
    confirm(title: string, message: string, label: string, danger?: boolean): Promise<boolean>
    prompt(title: string, label: string, initial?: string): Promise<string | null>
    pick<T>(items: PickItem<T>[], placeholder?: string): Promise<T | null>
    menu(x: number, y: number, items: MenuItem[]): void
  }
  readonly storage: {
    get<T>(key: string): T | undefined
    set(key: string, value: unknown): void
  }
  /** Disposed, last first, when the plugin is switched off. */
  readonly subscriptions: { add(dispose: Dispose): void }
}

export interface BuiltinPlugin {
  manifest: PluginManifest
  activate(ctx: PluginContext): void | Promise<void>
}
