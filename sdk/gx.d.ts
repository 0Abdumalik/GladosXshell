// Types for the `gx` global that GladosXshell gives plugin pages. Every call is async and goes
// through the app, which checks the permissions declared in plugin.json. A failed call rejects
// with a `GxError`; its message is in the app's language, so test `code`, not the text.

export interface GxError extends Error {
  /** 'permission': the permission is not declared, or the user did not grant it. */
  code?: 'permission'
}

export type Dispose = () => void
export type MenuWhere = keyof MenuContexts

/** What a menu command receives as its argument, by menu. */
export interface MenuContexts {
  'terminal/context': { sessionId: number | null; selection: string; live: boolean }
  /** A session tab. */
  'tab/context': { sessionId: number | null; kind: string; title: string }
  /** The empty part of the tab bar; `sessionId` is the active session. */
  'tabs/background': { sessionId: number | null }
  'files/entry': { sessionId: number; directory: string | null; paths: string[] }
  'files/background': { sessionId: number; directory: string | null }
  /** A favourite in the commands panel. */
  'commands/item': { command: string; note: string }
  /** The command editor of the commands panel. */
  'commands/editor': { selection: string; text: string }
  /** The built-in file editor. */
  'editor/context': { sessionId: number; path: string; selection: string }
  'connections/server': { id: string; name: string; host: string; user: string }
  /** `id` is null for servers without a group; `servers` are their ids. */
  'connections/group': { id: string | null; name: string; servers: string[] }
  /** The tab of a docked panel. */
  'panel/tab': { panel: string; region: string }
  /** The status bar; `text` is the message it shows. */
  statusbar: { text: string }
  /** Text fields and selected text anywhere else in the app. */
  'text/context': { selection: string; editable: boolean }
}

/**
 * An icon name: one the plugin registered (via `contributes.icons` or `gx.icons.register`),
 * otherwise a built-in Phosphor icon such as `gear`, `terminal` or `folder-simple`.
 * See `gx.icons.list()` for what is available.
 */
export type IconRef = string

/**
 * Icon data: SVG text (only `viewBox` and `<path d>` are kept), bare path data in a 256-unit box,
 * or an object. `stroke: true` draws the paths as 2-unit outlines instead of filling them.
 */
export type IconInput = string | { path: string | string[]; viewBox?: string; stroke?: boolean }

export interface MenuEntry {
  label: string
  /** A command of this plugin, by name (`run`) or full id (`author.name:run`). */
  command: string
  danger?: boolean
  icon?: IconRef
  /**
   * Context fields that must be non-empty for the item to show, joined by `&&`; `!` negates.
   * For example `"selection"`, `"live && !selection"` or `"paths"`.
   */
  when?: string
}

/** An entry of a menu a page opens itself with `gx.ui.menu`. */
export type PageMenuItem =
  | {
      id: string
      label: string
      icon?: IconRef
      danger?: boolean
      disabled?: boolean
      /** Makes it a check item. */
      checked?: boolean
    }
  | 'separator'

export interface StatusItem {
  id: string
  text: string
  title?: string
  tone?: 'info' | 'warn' | 'error'
  command?: string
  icon?: IconRef
}

export interface PickItem<T> {
  label: string
  detail?: string
  icon?: IconRef
  value: T
}

export interface Session {
  id: number
  kind: 'local' | 'ssh' | 'telnet' | 'serial' | 'bench'
  title: string
  state: 'connecting' | 'live' | 'ended' | 'failed'
  /** The shell's working directory, when its prompt reports one (OSC 7); null otherwise. */
  cwd: string | null
}

/** A saved server; passwords and key paths are never shown to plugins. */
export interface SavedServer {
  id: string
  name: string
  groupId: string | null
  host: string
  port: number
  user: string
  method: 'password' | 'keyFile' | 'agent' | 'keyboardInteractive'
  note: string
  /** The saved server this one connects through. */
  jumpId: string | null
  hasPassword: boolean
  /** Seconds since the epoch. */
  lastConnectedAt: number | null
}

export interface SavedProfiles {
  groups: { id: string; name: string }[]
  servers: SavedServer[]
}

/**
 * Fields a plugin may set; omitted ones keep their value. Moving a server to another host or port
 * clears its saved password and turns off agent forwarding.
 */
export interface ServerPatch {
  name?: string
  groupId?: string | null
  host?: string
  port?: number
  user?: string
  note?: string
}

export interface ExecResult {
  stdout: string
  stderr: string
  code: number | null
  /** True when the output hit the size cap and was cut. */
  truncated: boolean
}

export interface FileEntry {
  name: string
  path: string
  kind: 'file' | 'dir' | 'symlink' | 'other'
  size: number
  /** `ls -l` style, e.g. `-rw-r--r--`. */
  perms: string
  owner: string | null
  group: string | null
  /** Seconds since the epoch. */
  mtime: number | null
  linkTarget: string | null
}

export interface HttpOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD'
  headers?: Record<string, string>
  body?: string
  /** Seconds, at most 120. */
  timeout?: number
}

export interface HttpResponse {
  status: number
  headers: Record<string, string>
  body: string
}

export interface ThemeMessage {
  mode: 'dark' | 'light'
  /** `--gx-*` CSS variables; they are also set on this page's root element. */
  tokens: Record<string, string>
}

export interface Gx {
  readonly id: string | null
  /** The panel this page shows, or null in the background page. */
  readonly panel: string | null
  /**
   * The app's interface language, fixed until the app restarts. The page's `lang` and `dir` follow
   * it; Uyghur (`ug`) is right to left.
   */
  readonly lang: 'zh' | 'en' | 'ug'
  /** Runs once the page is connected; the plugin counts as started when all of these resolve. */
  onActivate(activate: () => void | Promise<void>): void
  on(name: 'theme', listener: (theme: ThemeMessage) => void): Dispose
  log(text: string): void

  commands: {
    /** Implements a declared command, or adds one (needs a title then). */
    register(
      name: string,
      run: (context: unknown) => unknown,
      title?: string,
      icon?: IconRef,
    ): Promise<null>
    run(command: string): Promise<null>
  }
  /** Plugin icons can be used anywhere an IconRef goes; they shadow built-ins of the same name. */
  icons: {
    /** Adds or replaces an icon (at most 64 per plugin); removed when the plugin stops. */
    register(name: string, data: IconInput): Promise<null>
    /** Built-in names plus this plugin's own. */
    list(): Promise<string[]>
    /** Standalone SVG markup coloured with `currentColor`, for use in panel pages. */
    svg(name: IconRef): Promise<string | null>
  }
  keybindings: { register(key: string, command: string): Promise<null> }
  menus: { set(where: MenuWhere, items: MenuEntry[]): Promise<null> }
  statusBar: {
    set(item: StatusItem): Promise<null>
    remove(id: string): Promise<null>
  }
  ui: {
    status(text: string, tone?: 'info' | 'error'): Promise<null>
    confirm(title: string, message: string, label?: string): Promise<boolean>
    prompt(title: string, label: string, initial?: string): Promise<string | null>
    pick<T>(items: PickItem<T>[], placeholder?: string): Promise<T | null>
    /**
     * Opens an app menu at page coordinates (e.g. a contextmenu event's clientX/clientY), at most
     * 50 items. Resolves with the chosen item's id, or null when closed. Only works while the user
     * is in this page. The browser's own menu is already suppressed except in text fields.
     */
    menu(x: number, y: number, items: PageMenuItem[]): Promise<string | null>
  }
  storage: {
    get<T = unknown>(key: string): Promise<T | null>
    set(key: string, value: unknown): Promise<null>
  }
  config: {
    get<T = unknown>(key: string): Promise<T>
    onChange(listener: (change: { key: string; value: unknown }) => void): Dispose
  }
  /** Needs `sessions.read`; `exec` needs `sessions.exec`. */
  sessions: {
    list(): Promise<Session[]>
    active(): Promise<Session | null>
    onChange(listener: (sessions: Session[]) => void): Dispose
    /** A session's shell reported a new working directory. */
    onCwd(listener: (change: { sessionId: number; cwd: string }) => void): Dispose
    exec(sessionId: number, command: string, options?: { timeout?: number }): Promise<ExecResult>
  }
  /**
   * `write` needs `terminal.write`, `onOutput` needs `terminal.read`, `onInput` needs
   * `terminal.input`. Output and input arrive in batches about every 100 ms.
   */
  terminal: {
    write(sessionId: number, text: string): Promise<null>
    onOutput(sessionId: number, listener: (text: string) => void): Promise<Dispose>
    /** What the user types or pastes into the terminal, not what plugins write to it. */
    onInput(sessionId: number, listener: (text: string) => void): Promise<Dispose>
  }
  /** `list` and `onChange` need `profiles.read`; `save` and `remove` need `profiles.write`. */
  profiles: {
    list(): Promise<SavedProfiles>
    /** Changes a saved server, or adds one when `id` is null (`host` and `user` required then). */
    save(id: string | null, patch: ServerPatch): Promise<SavedServer>
    /** Asks the user first; resolves false when they decline. */
    remove(id: string): Promise<boolean>
    onChange(listener: (profiles: SavedProfiles) => void): Dispose
  }
  /** Needs `files.read`; `writeText` needs `files.write`. SSH sessions only. */
  files: {
    list(sessionId: number, path: string): Promise<FileEntry[]>
    readText(sessionId: number, path: string): Promise<string>
    writeText(sessionId: number, path: string, text: string): Promise<null>
  }
  /** Needs `clipboard`. */
  clipboard: {
    readText(): Promise<string>
    writeText(text: string): Promise<null>
  }
  /** Needs `http:<host>` (or `http:<host>:<port>`) for the URL's host. */
  http: { request(url: string, options?: HttpOptions): Promise<HttpResponse> }
}

declare global {
  const gx: Gx
}
