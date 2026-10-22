import { Channel, invoke } from '@tauri-apps/api/core'
import { FitAddon } from '@xterm/addon-fit'
import { type ISearchOptions, SearchAddon } from '@xterm/addon-search'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { WebglAddon } from '@xterm/addon-webgl'
import { type IDecoration, type IMarker, Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import { writeText } from '@tauri-apps/plugin-clipboard-manager'
import { h } from './dom'
import { messages } from './i18n'
import { type IconName, icon } from './icons'
import { confirmPaste, pasteNeedsConfirm } from './paste-guard'
import type { TerminalAddon } from './plugins/api'
import { reportContributionError, terminalAddons, theme } from './plugins/registry'
import type { SessionExit } from './protocol'
import { DEFAULT_FONTS, fontStack, type TerminalSettings } from './settings-model'
import { onSettings, settings } from './settings-store'
import { folderFamilies, onFontsChange } from './terminal-fonts'
import { isTerminalReport } from './terminal-reports'
import { parseOsc7 } from './terminal-text'
import { onThemeChange } from './theme'
import { findStart, partialStart } from './zmodem/codec'
import type { ZmodemSession } from './zmodem/session'
import { startTransfer } from './zmodem/transfer'

const t = messages({
  marks: { zh: '清空位置', en: 'Clear marks', ug: 'تازىلاش ئورۇنلىرى' },
  previousTitle: {
    zh: '上一处清空位置（显示清空前的内容）',
    en: 'Previous clear (shows what was on screen before it)',
    ug: 'ئالدىنقى تازىلاش ئورنى (تازىلاشتىن بۇرۇنقى مەزمۇننى كۆرسىتىدۇ)',
  },
  previous: { zh: '上一处清空位置', en: 'Previous clear', ug: 'ئالدىنقى تازىلاش ئورنى' },
  nextTitle: {
    zh: '下一处清空位置，最后回到底部',
    en: 'Next clear, then back to the bottom',
    ug: 'كېيىنكى تازىلاش ئورنى، ئاخىرىدا ئاستىغا قايتىدۇ',
  },
  next: { zh: '下一处清空位置', en: 'Next clear', ug: 'كېيىنكى تازىلاش ئورنى' },
  dismiss: { zh: '收起提示', en: 'Dismiss', ug: 'ئەسكەرتىشنى يىغ' },
  disconnected: { zh: '连接已断开', en: 'Connection lost', ug: 'ئۇلىنىش ئۈزۈلدى' },
  tabClosed: { zh: '标签已关闭', en: 'Tab closed', ug: 'بەتكۈچ يېپىلدى' },
})

export type SessionEvent = ArrayBuffer | SessionExit

export type Opener = (
  onEvent: Channel<SessionEvent>,
  size: { cols: number; rows: number },
) => Promise<number>

const SEARCH_DECORATIONS = {
  matchBackground: '#3d4a2f',
  matchOverviewRuler: '#98c379',
  activeMatchBackground: '#7a5c1e',
  activeMatchColorOverviewRuler: '#e5c07b',
}

const CLEAR_MARK = '#e5c07b'
const IMAGE_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
}

let background: { path: string; url: Promise<string> } | null = null

function joinBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  if (a.length === 0) return b
  if (b.length === 0) return a
  const out = new Uint8Array(a.length + b.length)
  out.set(a)
  out.set(b, a.length)
  return out
}

/** One blob URL per configured image, shared by every terminal. */
function backgroundUrl(path: string): Promise<string> {
  if (background?.path === path) return background.url
  const old = background
  const url = invoke<ArrayBuffer>('local_image', { path }).then((bytes) => {
    const type = IMAGE_TYPES[path.split('.').pop()?.toLowerCase() ?? ''] ?? ''
    return URL.createObjectURL(new Blob([bytes], { type }))
  })
  background = { path, url }
  void old?.url.then((u) => URL.revokeObjectURL(u)).catch(() => {})
  return url
}

function terminalOptions(t: TerminalSettings, fontSizeOverride?: number | null) {
  return {
    // The chosen fonts in order, then every font of the fallback folder, then the defaults.
    fontFamily: fontStack(t.fonts, folderFamilies(), DEFAULT_FONTS),
    fontSize: fontSizeOverride ?? t.fontSize,
    lineHeight: t.lineHeight / 100,
    scrollback: t.scrollback,
    cursorStyle: t.cursorStyle,
    cursorBlink: t.cursorBlink,
  }
}

/** Colors from the active theme; custom CSS may override the two base colors (hex only). */
function terminalPalette() {
  const root = document.documentElement
  const css = getComputedStyle(root)
  const palette = theme(root.dataset.theme ?? 'dark')?.terminal ?? {}
  const color = (name: string, fallback = '') => css.getPropertyValue(name).trim() || fallback
  const background = color('--gx-terminal-bg', palette.background ?? '#15181d')
  return {
    ...palette,
    background,
    cursorAccent: background,
    foreground: color('--gx-terminal-fg', palette.foreground),
  }
}

/** Fonts and colors of a session terminal, for read-only views like the recording player. */
export function viewerOptions() {
  return {
    ...terminalOptions(settings().terminal),
    cursorBlink: false,
    disableStdin: true,
    scrollback: 1000,
    theme: terminalPalette(),
  }
}

interface ClearMark {
  marker: IMarker
  decoration: IDecoration | undefined
}

export interface FindOptions {
  caseSensitive: boolean
  regex: boolean
  /** Extend the current match while typing instead of jumping to the next one. */
  incremental?: boolean
}

export interface FindResult {
  index: number
  count: number
}

export interface BannerAction {
  label: string
  icon: IconName
  run: () => void
}

export interface Banner {
  tone: 'error' | 'info'
  title: string
  detail: string
  /** The first action is the primary one and takes focus. */
  actions: BannerAction[]
}

export class TerminalSession {
  readonly element: HTMLElement
  readonly stats = { bytes: 0, frames: 0 }
  renderer: 'webgl' | 'dom' = 'dom'
  onExit: (exit: SessionExit) => void = () => {}
  onError: (error: unknown) => void = () => {}
  onFindResult: (result: FindResult) => void = () => {}
  /** The shell reported a new working directory (OSC 7). */
  onCwd: (path: string) => void = () => {}
  /** Last directory the shell reported through OSC 7; null until it does. */
  cwd: string | null = null

  private readonly term: Terminal
  private readonly fit = new FitAddon()
  private readonly search = new SearchAddon({ highlightLimit: 2000 })
  private readonly observer: ResizeObserver
  private id: number | null = null
  private exited = false
  private disposed = false
  private pendingAck = 0
  // ConPTY asks for the cursor position before the open call returns; the reply must not be lost.
  private pendingInput: string[] = []
  private fitFrame = 0
  private marks: ClearMark[] = []
  private readonly screen: HTMLElement
  private readonly backdrop: HTMLElement
  private readonly marksBar: HTMLElement
  private readonly marksCount: HTMLElement
  private background = ''
  private backgroundPath = ''
  private readonly unsubscribe: () => void
  private readonly unwatchAddons: () => void
  private readonly unwatchTheme: () => void
  private readonly unwatchFonts: () => void
  private fontSizeOverride: number | null = null
  private readonly addons = new Map<TerminalAddon, () => void>()
  private readonly outputListeners = new Set<(bytes: Uint8Array) => void>()
  private readonly inputListeners = new Set<(data: string) => void>()
  private banner: HTMLElement | null = null
  private transfer: ZmodemSession | null = null
  /** The tail of the last frame, which may be the start of a ZMODEM header. */
  private held: Uint8Array | null = null
  private heldTimer: ReturnType<typeof setTimeout> | undefined

  constructor(
    parent: HTMLElement,
    readonly kind: string,
    fontSizeOverride?: number | null,
  ) {
    this.backdrop = h('div', { class: 'terminal-backdrop', 'aria-hidden': 'true' })
    this.screen = h('div', { class: 'terminal-screen' })
    this.marksCount = h('span', { class: 'terminal-marks-count num' })
    this.marksBar = h(
      'div',
      { class: 'terminal-marks', role: 'toolbar', 'aria-label': t('marks'), hidden: true },
      h(
        'button',
        {
          type: 'button',
          class: 'icon-button',
          title: t('previousTitle'),
          'aria-label': t('previous'),
          onclick: () => this.jumpClear(-1),
        },
        icon('arrow-up'),
      ),
      this.marksCount,
      h(
        'button',
        {
          type: 'button',
          class: 'icon-button',
          title: t('nextTitle'),
          'aria-label': t('next'),
          onclick: () => this.jumpClear(1),
        },
        icon('arrow-down'),
      ),
    )
    this.element = h('div', { class: 'terminal' }, this.backdrop, this.screen, this.marksBar)
    parent.append(this.element)

    this.term = new Terminal({
      allowProposedApi: true,
      // Needed for the background image; xterm only reads it before open().
      allowTransparency: true,
      overviewRuler: { width: 10 },
      ...terminalOptions(settings().terminal, fontSizeOverride),
    })
    this.applyPalette()
    this.term.loadAddon(this.fit)
    this.term.loadAddon(new Unicode11Addon())
    this.term.loadAddon(this.search)
    this.search.onDidChangeResults(({ resultIndex, resultCount }) =>
      this.onFindResult({ index: resultIndex, count: resultCount }),
    )
    this.term.unicode.activeVersion = '11'
    this.term.open(this.screen)
    this.loadWebgl()
    this.applyBackground(settings().terminal)
    this.unsubscribe = onSettings((next, previous) => {
      if (next.terminal !== previous.terminal)
        this.applySettings(next.terminal, this.fontSizeOverride)
    })
    this.term.onSelectionChange(() => {
      if (!settings().terminal.copyOnSelect) return
      const text = this.term.getSelection()
      if (text) writeText(text).catch(this.onError)
    })
    this.term.onScroll(() => this.updateMarks())

    this.term.parser.registerOscHandler(7, (data) => {
      const path = parseOsc7(data)
      if (path !== null && path !== this.cwd) {
        this.cwd = path
        this.guard(() => this.onCwd(path))
      }
      return true
    })
    // Capture phase on an ancestor runs before xterm's own listener on its textarea.
    this.element.addEventListener('paste', (event) => this.guardNativePaste(event), true)
    this.term.onData((data) => {
      this.send(data)
      if (this.live && !this.transfer && !isTerminalReport(data))
        for (const listener of this.inputListeners) this.guard(() => listener(data))
    })
    this.term.onResize(({ cols, rows }) => {
      if (this.id !== null && !this.exited) {
        invoke('session_resize', { id: this.id, cols, rows }).catch(this.onError)
      }
    })
    this.observer = new ResizeObserver(() => this.scheduleFit())
    this.observer.observe(this.screen)
    this.syncAddons()
    this.unwatchAddons = terminalAddons.subscribe(() => this.syncAddons())
    this.unwatchTheme = onThemeChange(() => this.applyPalette())
    this.fontSizeOverride = fontSizeOverride ?? null
    this.unwatchFonts = onFontsChange(() => this.remeasure())
  }

  /** Newly loaded faces don't change the font list, so xterm is made to measure and draw again. */
  private remeasure(): void {
    const family = terminalOptions(settings().terminal).fontFamily
    this.term.options.fontFamily = 'monospace'
    this.term.options.fontFamily = family
    this.term.clearTextureAtlas()
    this.scheduleFit()
  }

  private applyPalette(): void {
    const palette = terminalPalette()
    this.background = palette.background
    this.term.options.theme = {
      ...palette,
      background: this.backdrop.style.backgroundImage ? '#00000000' : this.background,
    }
  }

  /** Attaches contributed addons for this session kind and detaches withdrawn ones. */
  private syncAddons(): void {
    const wanted = terminalAddons.list().filter((a) => !a.kinds || a.kinds.includes(this.kind))
    for (const [addon, detach] of this.addons) {
      if (wanted.includes(addon)) continue
      this.addons.delete(addon)
      this.guard(detach)
    }
    for (const addon of wanted) {
      if (this.addons.has(addon)) continue
      this.guard(() => {
        const detach = addon.attach({
          term: this.term,
          kind: this.kind,
          sessionId: () => (this.live ? this.id : null),
          send: (data) => this.send(data),
          onOutput: (listener) => {
            this.outputListeners.add(listener)
            return () => this.outputListeners.delete(listener)
          },
          onInput: (listener) => {
            this.inputListeners.add(listener)
            return () => this.inputListeners.delete(listener)
          },
        })
        this.addons.set(addon, detach)
      })
    }
  }

  private guard(run: () => void): void {
    try {
      run()
    } catch (error) {
      reportContributionError(error)
    }
  }

  private applySettings(t: TerminalSettings, fontSizeOverride?: number | null): void {
    Object.assign(this.term.options, terminalOptions(t, fontSizeOverride))
    this.applyBackground(t)
    this.scheduleFit()
  }

  setFontSize(size: number | null): void {
    this.fontSizeOverride = size
    this.applySettings(settings().terminal, size)
  }

  private applyBackground(t: TerminalSettings): void {
    this.backdrop.style.opacity = String(t.backgroundOpacity / 100)
    if (t.backgroundImage === this.backgroundPath) return
    const path = t.backgroundImage
    this.backgroundPath = path
    const transparent = (on: boolean) => {
      this.term.options.theme = {
        ...this.term.options.theme,
        background: on ? '#00000000' : this.background,
      }
    }
    if (!path) {
      this.backdrop.style.backgroundImage = ''
      transparent(false)
      return
    }
    backgroundUrl(path)
      .then((url) => {
        if (this.backgroundPath !== path) return
        this.backdrop.style.backgroundImage = `url("${url}")`
        transparent(true)
      })
      .catch(this.onError)
  }

  async open(opener: Opener): Promise<void> {
    const channel = new Channel<SessionEvent>()
    channel.onmessage = (message) => {
      if (message instanceof ArrayBuffer) this.receive(new Uint8Array(message))
      else this.finish(message)
    }
    this.fit.fit()
    this.id = await opener(channel, { cols: this.term.cols, rows: this.term.rows })
    // The tab closed while connecting; don't leave the new backend session running.
    if (this.disposed) {
      await this.close().catch(() => {})
      return
    }
    if (this.pendingAck > 0) this.ack(this.pendingAck)
    this.pendingAck = 0
    for (const data of this.pendingInput.splice(0)) this.send(data)
  }

  get rows(): number {
    return this.term.rows
  }

  get cols(): number {
    return this.term.cols
  }

  onResize(listener: (size: { cols: number; rows: number }) => void): () => void {
    const subscription = this.term.onResize(listener)
    return () => subscription.dispose()
  }

  get sessionId(): number | null {
    return this.id
  }

  get ended(): boolean {
    return this.exited
  }

  /** Writes a local message (connection progress, errors) into the terminal. */
  notice(text: string, tone: 'info' | 'error' = 'info'): void {
    const color = tone === 'error' ? '31' : '90'
    this.term.write(`\x1b[${color}m${text.replace(/\r?\n/g, '\r\n')}\x1b[0m\r\n`)
  }

  /** Marks a session that never opened (failed connect) as finished. */
  fail(text: string): void {
    this.exited = true
    this.notice(text, 'error')
  }

  /** Overlay over the top of the terminal (connection failed or lost); output stays readable. */
  showBanner({ tone, title, detail, actions }: Banner): void {
    this.hideBanner()
    const hadFocus = this.element.contains(document.activeElement)
    const buttons = actions.map((action, i) =>
      h(
        'button',
        {
          type: 'button',
          class: i === 0 ? 'button small primary' : 'button small secondary',
          onclick: () => action.run(),
        },
        icon(action.icon),
        action.label,
      ),
    )
    const banner = h(
      'section',
      {
        class: 'terminal-banner',
        'data-tone': tone,
        role: tone === 'error' ? 'alert' : 'status',
        'aria-label': title,
      },
      h('span', { class: 'terminal-banner-icon' }, icon(tone === 'error' ? 'plugs' : 'info')),
      h(
        'div',
        { class: 'terminal-banner-text' },
        h('strong', { text: title }),
        h('p', { text: detail }),
      ),
      h('div', { class: 'terminal-banner-actions' }, buttons),
      h(
        'button',
        {
          type: 'button',
          class: 'icon-button terminal-banner-close',
          title: t('dismiss'),
          'aria-label': t('dismiss'),
          onclick: () => {
            this.hideBanner()
            this.term.focus()
          },
        },
        icon('x'),
      ),
    )
    banner.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      this.hideBanner()
      this.term.focus()
    })
    this.banner = banner
    this.element.dataset.ended = tone
    this.element.append(banner)
    if (hadFocus) buttons[0]?.focus()
  }

  hideBanner(): void {
    this.banner?.remove()
    this.banner = null
  }

  /** Lets an ended session be opened again in place, keeping its scrollback. */
  reset(): void {
    this.id = null
    this.cwd = null
    this.exited = false
    this.pendingAck = 0
    this.pendingInput = []
    this.dropTransfer(t('disconnected'))
    this.hideBanner()
    delete this.element.dataset.ended
    // The dropped shell may have left a full-screen app, mouse reporting or paste mode on.
    // 1049l also restores the saved cursor, so only send it when the alternate screen is up.
    const alternate = this.term.buffer.active.type === 'alternate' ? '\x1b[?1049l' : ''
    this.term.write(`${alternate}\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1006l\x1b[?2004l\x1b[0m`)
  }

  focus(): void {
    if (this.banner) this.banner.querySelector('button')?.focus()
    else this.term.focus()
  }

  /** True once the backend session is open and has not exited. */
  get live(): boolean {
    return this.id !== null && !this.exited
  }

  /** Sends raw input to the session as if typed. */
  input(data: string): void {
    this.send(data)
  }

  /** Pastes through xterm so bracketed-paste mode is honoured; multi-line text may ask first. */
  async paste(text: string): Promise<void> {
    if (this.exited) return
    if (pasteNeedsConfirm(text, this.term.modes.bracketedPasteMode)) {
      const ok = await confirmPaste(text)
      this.term.focus()
      if (!ok || this.exited) return
    }
    this.term.paste(text)
  }

  /** Native paste (Ctrl+V, Shift+Insert) goes straight to xterm unless it needs confirming. */
  private guardNativePaste(event: ClipboardEvent): void {
    const text = event.clipboardData?.getData('text/plain') ?? ''
    if (!pasteNeedsConfirm(text, this.term.modes.bracketedPasteMode)) return
    event.preventDefault()
    event.stopPropagation()
    void this.paste(text)
  }

  selection(): string {
    return this.term.getSelection()
  }

  /** Every line of the buffer (scrollback and screen), trailing blank lines dropped. */
  allText(): string {
    const buffer = this.term.buffer.active
    const lines: string[] = []
    for (let i = 0; i < buffer.length; i++) {
      lines.push(buffer.getLine(i)?.translateToString(true) ?? '')
    }
    while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
    return lines.join('\n')
  }

  /**
   * Pushes the screen above the cursor into scrollback and marks the spot, so the old output stays
   * reachable (overview ruler, ↑↓ buttons). Local only. False while a full-screen program runs.
   */
  softClear(): boolean {
    const buffer = this.term.buffer.active
    if (buffer.type === 'alternate') return false
    const { cursorX, cursorY } = buffer
    if (cursorY === 0) return true
    // Line feeds on the bottom row scroll lines into scrollback; the cursor line then goes back to
    // the top with its column, so the shell prompt keeps working.
    const rows = this.term.rows
    this.term.write(`\x1b[${rows};1H${'\n'.repeat(cursorY)}\x1b[1;${cursorX + 1}H`, () => {
      const marker = this.term.registerMarker(0)
      const decoration = this.term.registerDecoration({
        marker,
        overviewRulerOptions: { color: CLEAR_MARK, position: 'full' },
      })
      const mark: ClearMark = { marker, decoration }
      // Markers die when their line falls out of the scrollback.
      marker.onDispose(() => {
        decoration?.dispose()
        this.marks = this.marks.filter((m) => m !== mark)
        this.updateMarks()
      })
      this.marks.push(mark)
      this.term.scrollToBottom()
      this.updateMarks()
    })
    return true
  }

  /** Drops scrollback, screen and clear marks for good. Local only. */
  wipe(): void {
    for (const mark of [...this.marks]) mark.marker.dispose()
    this.marks = []
    this.term.clear()
    this.updateMarks()
  }

  get clearMarks(): number {
    return this.marks.length
  }

  /** Scrolls to the screen as it was before a clear; -1 goes back, 1 forward (then the bottom). */
  jumpClear(direction: -1 | 1): void {
    const bottom = this.term.buffer.active.viewportY + this.term.rows - 1
    const lines = this.marks.map((m) => m.marker.line).filter((line) => line >= 0)
    const target =
      direction < 0 ? lines.filter((l) => l < bottom).at(-1) : lines.find((l) => l > bottom)
    if (target === undefined) {
      if (direction > 0) this.term.scrollToBottom()
      return
    }
    this.term.scrollToLine(Math.max(0, target - this.term.rows + 1))
  }

  private updateMarks(): void {
    const total = this.marks.length
    this.marksBar.hidden = total === 0
    if (total === 0) return
    const bottom = this.term.buffer.active.viewportY + this.term.rows - 1
    const seen = this.marks.filter((m) => m.marker.line >= 0 && m.marker.line <= bottom).length
    this.marksCount.textContent = `${seen}/${total}`
  }

  /** Finds the next or previous match; counts arrive through `onFindResult`. */
  find(text: string, options: FindOptions, backwards: boolean): boolean {
    const searchOptions: ISearchOptions = { ...options, decorations: SEARCH_DECORATIONS }
    return backwards
      ? this.search.findPrevious(text, searchOptions)
      : this.search.findNext(text, searchOptions)
  }

  clearFind(): void {
    this.search.clearDecorations()
    this.term.clearSelection()
  }

  refit(): void {
    this.scheduleFit()
  }

  async close(): Promise<void> {
    if (this.id !== null && !this.exited) await invoke('session_close', { id: this.id })
  }

  dispose(): void {
    this.disposed = true
    this.dropTransfer(t('tabClosed'))
    cancelAnimationFrame(this.fitFrame)
    this.observer.disconnect()
    this.unsubscribe()
    this.unwatchAddons()
    this.unwatchTheme()
    this.unwatchFonts()
    for (const detach of this.addons.values()) this.guard(detach)
    this.addons.clear()
    this.outputListeners.clear()
    this.inputListeners.clear()
    void this.close().catch(() => {})
    this.term.dispose()
    this.element.remove()
  }

  private loadWebgl(): void {
    try {
      const webgl = new WebglAddon()
      webgl.onContextLoss(() => {
        webgl.dispose()
        this.renderer = 'dom'
      })
      this.term.loadAddon(webgl)
      this.renderer = 'webgl'
    } catch {
      this.renderer = 'dom'
    }
  }

  private receive(bytes: Uint8Array): void {
    this.stats.bytes += bytes.byteLength
    this.stats.frames += 1
    const shown = this.route(bytes)
    // Credit is returned only once xterm has parsed the frame, so a slow renderer throttles the source.
    this.term.write(shown, () => this.ack(bytes.byteLength))
    if (shown.length > 0) this.notifyOutput(shown)
  }

  private notifyOutput(bytes: Uint8Array): void {
    for (const listener of this.outputListeners) this.guard(() => listener(bytes))
  }

  /** Splits rz/sz traffic off the output; returns what the terminal should show. */
  private route(bytes: Uint8Array): Uint8Array {
    if (this.transfer) {
      const rest = this.transfer.feed(bytes)
      if (rest === null) return new Uint8Array()
      this.endTransfer()
      return rest
    }
    let data = bytes
    if (this.held) {
      clearTimeout(this.heldTimer)
      data = joinBytes(this.held, data)
      this.held = null
    }
    if (!settings().terminal.zmodem || !this.live || this.id === null) return data
    const start = findStart(data)
    if (start) {
      const before = data.subarray(0, start.index)
      const transfer = startTransfer(start.role, {
        sessionId: this.id,
        container: this.element,
        focus: () => this.term.focus(),
      })
      const rest = transfer.feed(data.subarray(start.index))
      if (rest !== null) return joinBytes(before, rest)
      this.transfer = transfer
      invoke('session_log_pause', { id: this.id, paused: true }).catch(() => {})
      void transfer.result.then((outcome) => {
        if (this.transfer !== transfer) return
        this.endTransfer()
        if (outcome.rest.length === 0 || this.disposed) return
        this.term.write(outcome.rest)
        this.notifyOutput(outcome.rest)
      })
      return before
    }
    const keep = partialStart(data)
    if (keep === 0) return data
    this.held = data.slice(data.length - keep)
    // Don't sit on the bytes if the rest of the header never comes.
    this.heldTimer = setTimeout(() => {
      const held = this.held
      this.held = null
      if (!held || this.disposed) return
      this.term.write(held)
      this.notifyOutput(held)
    }, 100)
    return data.subarray(0, data.length - keep)
  }

  private endTransfer(): void {
    this.transfer = null
    if (this.live) invoke('session_log_pause', { id: this.id, paused: false }).catch(() => {})
  }

  /** Ends a transfer the connection can no longer carry. */
  private dropTransfer(message: string): void {
    clearTimeout(this.heldTimer)
    this.held = null
    const transfer = this.transfer
    this.transfer = null
    transfer?.abandon(message)
  }

  private ack(bytes: number): void {
    if (this.id === null) {
      this.pendingAck += bytes
      return
    }
    if (!this.exited) invoke('session_ack', { id: this.id, bytes }).catch(() => {})
  }

  private send(data: string): void {
    if (this.exited) return
    // Keys would corrupt the transfer; Ctrl+C or Ctrl+X stops it instead.
    if (this.transfer && !this.transfer.ended) {
      if (data.includes('\x03') || data.includes('\x18')) this.transfer.cancel()
      return
    }
    if (this.id === null) {
      this.pendingInput.push(data)
      return
    }
    invoke('session_write', { id: this.id, data }).catch(this.onError)
  }

  private finish(exit: SessionExit): void {
    this.exited = true
    this.dropTransfer(t('disconnected'))
    // Wait for queued frames to be parsed so timings and the final screen are complete.
    this.term.write('', () => this.onExit(exit))
  }

  private scheduleFit(): void {
    cancelAnimationFrame(this.fitFrame)
    this.fitFrame = requestAnimationFrame(() => {
      if (this.screen.clientWidth > 0 && this.screen.clientHeight > 0) this.fit.fit()
    })
  }
}
