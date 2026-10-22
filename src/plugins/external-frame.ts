import { lang, messages } from '../i18n'
import { describeError } from '../protocol'
import type { Dispose } from './api'
import { PermissionError } from './external-api'

const t = messages({
  notLoaded: {
    zh: '插件页面还没有加载完成',
    en: 'The plugin page has not finished loading',
    ug: 'قىستۇرما بېتى تېخى يۈكلىنىپ بولمىدى',
  },
  emitFailed: {
    zh: '无法向插件发送事件 {name}：{error}',
    en: "Couldn't send the event {name} to the plugin: {error}",
    ug: 'قىستۇرمىغا {name} ھادىسىسىنى يوللىيالمىدى: {error}',
  },
  closed: { zh: '插件页面已关闭', en: 'The plugin page was closed', ug: 'قىستۇرما بېتى تاقالدى' },
  commandFailed: {
    zh: '插件命令失败',
    en: 'Plugin command failed',
    ug: 'قىستۇرما بۇيرۇقى مەغلۇپ بولدى',
  },
  startFailed: { zh: '启动失败', en: 'Failed to start', ug: 'قوزغىتالمىدى' },
})

export interface ThemeMessage {
  mode: string
  tokens: Record<string, string>
}

export interface FrameOptions {
  src: string
  plugin: string
  panel: string | null
  theme: () => ThemeMessage
  handle: (frame: PluginFrame, method: string, args: unknown[]) => Promise<unknown>
  log: (level: 'info' | 'error', text: string) => void
  ready: () => void
  fail: (error: string) => void
}

interface Waiter {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
}

const MAX_LOGS = 200
const MAX_OUTPUT = 256 * 1024
const OUTPUT_DELAY = 100

const errorText = describeError

/**
 * One sandboxed page of a plugin. Every message goes through a MessagePort handed over after
 * the page loads; the page has an opaque origin, so it reaches nothing else of the app.
 */
export class PluginFrame {
  readonly element: HTMLIFrameElement
  /** Backend session ids whose terminal output this page asked for. */
  readonly watching = new Set<number>()
  /** Backend session ids whose typed input this page asked for. */
  readonly watchingInput = new Set<number>()
  private port: MessagePort | null = null
  private nextId = 1
  private readonly pending = new Map<number, Waiter>()
  private readonly owned: Dispose[] = []
  private readonly output = new Map<number, string>()
  private readonly input = new Map<number, string>()
  private flushTimer: number | null = null
  private logs = 0
  private closed = false

  constructor(private readonly options: FrameOptions) {
    const frame = document.createElement('iframe')
    frame.setAttribute('sandbox', 'allow-scripts')
    frame.referrerPolicy = 'no-referrer'
    frame.className = 'plugin-frame'
    frame.title = options.panel ?? options.plugin
    frame.src = options.src
    // A reload (or the layout moving the panel) starts the page over with a fresh port.
    frame.addEventListener('load', () => this.connect())
    this.element = frame
  }

  get panel(): string | null {
    return this.options.panel
  }

  /** Disposed when the page closes or reloads. */
  own(dispose: Dispose): void {
    if (this.closed) dispose()
    else this.owned.push(dispose)
  }

  call(method: string, args: unknown[]): Promise<unknown> {
    const port = this.port
    if (!port || this.closed) return Promise.reject(new Error(t('notLoaded')))
    return new Promise((resolve, reject) => {
      const id = this.nextId++
      this.pending.set(id, { resolve, reject })
      try {
        port.postMessage({ t: 'call', id, m: method, a: args })
      } catch (error) {
        this.pending.delete(id)
        reject(new Error(errorText(error)))
      }
    })
  }

  emit(name: string, data: unknown): void {
    try {
      this.port?.postMessage({ t: 'event', name, data })
    } catch (error) {
      this.options.log('error', t('emitFailed', { name, error: errorText(error) }))
    }
  }

  /** Batches terminal output so a busy terminal does not flood the page. */
  pushOutput(sessionId: number, text: string): void {
    this.queue(this.output, sessionId, text)
  }

  pushInput(sessionId: number, text: string): void {
    this.queue(this.input, sessionId, text)
  }

  private queue(into: Map<number, string>, sessionId: number, text: string): void {
    const joined = (into.get(sessionId) ?? '') + text
    into.set(sessionId, joined.length > MAX_OUTPUT ? joined.slice(-MAX_OUTPUT) : joined)
    if (this.flushTimer !== null) return
    this.flushTimer = window.setTimeout(() => {
      this.flushTimer = null
      // Input first: a keystroke usually comes before the echo it causes.
      for (const [id, chunk] of this.input) this.emit('input', { sessionId: id, text: chunk })
      for (const [id, chunk] of this.output) this.emit('output', { sessionId: id, text: chunk })
      this.input.clear()
      this.output.clear()
    }, OUTPUT_DELAY)
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.reset()
    this.element.remove()
  }

  private reset(): void {
    this.port?.close()
    this.port = null
    for (const waiter of this.pending.values()) waiter.reject(new Error(t('closed')))
    this.pending.clear()
    for (let i = this.owned.length - 1; i >= 0; i--) this.owned[i]()
    this.owned.length = 0
    this.watching.clear()
    this.watchingInput.clear()
    this.output.clear()
    this.input.clear()
    if (this.flushTimer !== null) window.clearTimeout(this.flushTimer)
    this.flushTimer = null
  }

  private connect(): void {
    if (this.closed) return
    this.reset()
    const target = this.element.contentWindow
    if (!target) return
    const channel = new MessageChannel()
    this.port = channel.port1
    this.port.onmessage = (event) => this.receive(event.data)
    const { plugin, panel } = this.options
    // The page has an opaque origin, so '*' is the only target that matches it.
    target.postMessage(
      { gx: 'init', id: plugin, panel, lang: lang(), theme: this.options.theme() },
      '*',
      [channel.port2],
    )
  }

  private receive(message: unknown): void {
    if (!message || typeof message !== 'object') return
    const m = message as Record<string, unknown>
    switch (m.t) {
      case 'ret': {
        const waiter = typeof m.id === 'number' ? this.pending.get(m.id) : undefined
        if (!waiter) return
        this.pending.delete(m.id as number)
        if (m.ok === true) waiter.resolve(m.v)
        else waiter.reject(new Error(typeof m.e === 'string' ? m.e : t('commandFailed')))
        return
      }
      case 'call':
        if (typeof m.id === 'number' && typeof m.m === 'string' && Array.isArray(m.a)) {
          void this.answer(m.id, m.m, m.a)
        }
        return
      case 'ready':
        this.options.ready()
        return
      case 'fail':
        this.options.fail(typeof m.e === 'string' ? m.e.slice(0, 500) : t('startFailed'))
        return
      case 'log':
        if (this.logs++ >= MAX_LOGS) return
        this.options.log(m.level === 'error' ? 'error' : 'info', String(m.text).slice(0, 1000))
    }
  }

  private async answer(id: number, method: string, args: unknown[]): Promise<void> {
    const port = this.port
    let result: Record<string, unknown>
    try {
      const value = await this.options.handle(this, method, args)
      result = { ok: true, v: value === undefined ? null : value }
    } catch (error) {
      const code = error instanceof PermissionError ? error.code : null
      result = { ok: false, e: errorText(error), c: code }
    }
    // The page may have reloaded meanwhile; the answer belongs to the old one.
    if (this.closed || !port || this.port !== port) return
    try {
      port.postMessage({ t: 'ret', id, ...result })
    } catch (error) {
      port.postMessage({ t: 'ret', id, ok: false, e: errorText(error) })
    }
  }
}
