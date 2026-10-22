import { ltr, messages } from '../i18n'
import {
  bytesPos,
  CANCEL_SEQUENCE,
  CANFC32,
  CANFDX,
  CANOVIO,
  Decoder,
  Encoder,
  End,
  type EndKind,
  ESCCTL,
  Frame,
  flagBytes,
  type Header,
  posBytes,
  type Token,
  ZDLE,
} from './codec'

const t = messages({
  receiveCancelled: { zh: '已取消接收', en: 'Receive cancelled', ug: 'قوبۇل قىلىشتىن ۋاز كەچتى' },
  uploadCancelled: { zh: '已取消上传', en: 'Upload cancelled', ug: 'يۈكلەشتىن ۋاز كەچتى' },
  idle: {
    zh: '对方长时间没有响应',
    en: 'The remote side stopped responding',
    ug: 'قارشى تەرەپ ئۇزۇن ۋاقىت جاۋاب قايتۇرمىدى',
  },
  remoteCancelled: {
    zh: '对方取消了传输',
    en: 'The remote side cancelled the transfer',
    ug: 'قارشى تەرەپ يەتكۈزۈشتىن ۋاز كەچتى',
  },
  command: {
    zh: '对方请求在本机执行命令，已拒绝',
    en: 'The remote side asked to run a command on this computer; refused',
    ug: 'قارشى تەرەپ بۇ كومپيۇتېردا بۇيرۇق ئىجرا قىلىشنى تەلەپ قىلدى، رەت قىلىندى',
  },
  remoteAborted: {
    zh: '对方中止了传输',
    en: 'The remote side aborted the transfer',
    ug: 'قارشى تەرەپ يەتكۈزۈشنى توختاتتى',
  },
  checksum: {
    zh: '数据反复校验失败',
    en: 'The data kept failing its checksum',
    ug: 'سانلىق مەلۇمات تەكشۈرۈشتىن قايتا-قايتا ئۆتەلمىدى',
  },
  rzTimeout: {
    zh: 'rz 已等待超时退出，请重新运行 rz',
    en: 'rz gave up waiting and exited; run rz again',
    ug: 'rz كۈتۈش ۋاقتى توشۇپ چېكىندى، rz نى قايتا ئىجرا قىلىڭ',
  },
  noInfoReply: {
    zh: '对方没有回应 {name} 的文件信息',
    en: 'The remote side did not answer the file details for {name}',
    ug: 'قارشى تەرەپ {name} نىڭ ھۆججەت ئۇچۇرىغا جاۋاب قايتۇرمىدى',
  },
  refused: {
    zh: '对方拒绝接收 {name}',
    en: 'The remote side refused {name}',
    ug: 'قارشى تەرەپ {name} نى قوبۇل قىلىشنى رەت قىلدى',
  },
  stoppedReceiving: {
    zh: '对方中止了 {name} 的接收',
    en: 'The remote side stopped receiving {name}',
    ug: 'قارشى تەرەپ {name} نى قوبۇل قىلىشنى توختاتتى',
  },
  noAck: {
    zh: '对方没有确认收到的数据',
    en: 'The remote side did not acknowledge the data',
    ug: 'قارشى تەرەپ تاپشۇرۇۋالغان سانلىق مەلۇماتنى جەزملەشتۈرمىدى',
  },
  shrank: {
    zh: '{name} 比开始时短，可能正在被修改',
    en: '{name} is shorter than when the transfer started; it may be changing',
    ug: '{name} باشلانغاندىكىدىن قىسقا، ئۆزگەرتىلىۋاتقان بولۇشى مۇمكىن',
  },
  noEofAck: {
    zh: '对方没有确认 {name} 已收完',
    en: 'The remote side did not confirm it received all of {name}',
    ug: 'قارشى تەرەپ {name} نى تولۇق تاپشۇرۇۋالغانلىقىنى جەزملەشتۈرمىدى',
  },
})

export type Role = 'receive' | 'send'

export interface IncomingFile {
  name: string
  size: number | null
  /** Seconds since the epoch. */
  mtime: number | null
}

export interface FileSink {
  readonly path: string
  write(data: Uint8Array): Promise<void>
  /** `keep` false deletes what was written. */
  close(keep: boolean): Promise<void>
}

export interface OutgoingFile {
  readonly name: string
  readonly size: number
  /** Seconds since the epoch. */
  readonly mtime: number
  read(offset: number, length: number): Promise<Uint8Array>
}

export interface Progress {
  name: string
  /** 1-based. */
  index: number
  count: number | null
  bytesDone: number
  bytesTotal: number | null
}

export interface ZmodemHost {
  /** Writes protocol bytes to the remote side; calls must reach it in order. */
  write(bytes: Uint8Array): Promise<void>
  /** Receiving: runs once before the first file; false declines the whole transfer. */
  prepare(): Promise<boolean>
  /** Receiving: where a file goes; null skips it. */
  open(file: IncomingFile): Promise<FileSink | null>
  /** Sending: the files to offer; null or empty declines. */
  pick(): Promise<OutgoingFile[] | null>
  onProgress(progress: Progress): void
}

export interface FileResult {
  name: string
  size: number
  /** Local path of a received file. */
  path: string | null
  skipped: boolean
}

export type OutcomeState = 'done' | 'cancelled' | 'failed' | 'not-zmodem'

export interface Outcome {
  role: Role
  state: OutcomeState
  message: string
  files: FileResult[]
  /** Shell output recovered after the session ended on a timer; it belongs to the terminal. */
  rest: Uint8Array
}

/** Raw bytes held while the start is unconfirmed; a valid header must show up within these. */
const PROBE_LIMIT = 4096
/** After we cancel, output is swallowed until the remote has been quiet this long. */
const QUIET_MS = 400
const DRAIN_MAX_MS = 5000
/** How much swallowed output is kept for `shellSuffix`. */
const RECENT = 8 * 1024
const CLOSING_MS = 1500
const IDLE_MS = 60_000
const MAX_ERRORS = 30
const SUBPACKET = 1024
const BATCH = 32 * 1024
const WINDOW = 1024 * 1024
const FLUSH_AT = 256 * 1024
const ZCBIN = 1

class Stop extends Error {}

function concat(parts: Uint8Array[]): Uint8Array {
  if (parts.length === 1) return parts[0]
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}

function isAsciiText(b: number): boolean {
  return (
    (b >= 0x20 && b < 0x7f) ||
    b === 0x09 ||
    b === 0x0d ||
    b === 0x0a ||
    b === 0x07 ||
    b === 0x08 ||
    b === 0x1b
  )
}

function utf8Length(bytes: Uint8Array, i: number): number {
  const b = bytes[i]
  const n = b >= 0xc2 && b < 0xe0 ? 2 : b >= 0xe0 && b < 0xf0 ? 3 : b >= 0xf0 && b < 0xf5 ? 4 : 0
  if (n === 0 || i + n > bytes.length) return 0
  for (let k = 1; k < n; k++) if ((bytes[i + k] & 0xc0) !== 0x80) return 0
  return n
}

/**
 * The remote died mid-frame and its shell printed after it. Shell text never holds a ZDLE,
 * so it is the text run at the very end, after the last one.
 */
export function shellSuffix(bytes: Uint8Array): Uint8Array {
  const dle = bytes.lastIndexOf(ZDLE)
  let from = -1
  for (let i = dle < 0 ? 0 : dle + 2; i < bytes.length; ) {
    if (isAsciiText(bytes[i])) {
      if (from < 0) from = i
      i++
      continue
    }
    const n = utf8Length(bytes, i)
    // Multibyte text may continue a run but not start one; stray high bytes are likely data.
    if (n > 0 && from >= 0) i += n
    else {
      from = -1
      i++
    }
  }
  return from < 0 ? new Uint8Array() : bytes.subarray(from)
}

/** Not padding, a cancel tail, line ends or flow control left between frames. */
function isShellText(b: number): boolean {
  return ![0x2a, ZDLE, 0x08, 0x0d, 0x0a, 0x8a, 0x11, 0x13, 0x91, 0x93].includes(b)
}

function recentLength(drain: { recent: Uint8Array[] }): number {
  return drain.recent.reduce((n, p) => n + p.length, 0)
}

function describe(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  if (error && typeof error === 'object' && 'message' in error) return String(error.message)
  return String(error)
}

/** One rz or sz run. Feed it terminal output until `feed` hands bytes back. */
export abstract class ZmodemSession {
  readonly result: Promise<Outcome>
  protected readonly decoder = new Decoder()
  protected readonly encoder = new Encoder()
  protected readonly files: FileResult[] = []
  /** A dialog is open; the remote may legitimately go quiet. */
  protected busy = false
  private resolveResult: (outcome: Outcome) => void = () => {}
  private probe: Uint8Array[] | null = []
  private probeLength = 0
  private finished = false
  private draining: {
    started: number
    outcome: [OutcomeState, string]
    damaged: boolean
    /** The latest swallowed output, in case the shell came back mid-frame. */
    recent: Uint8Array[]
  } | null = null
  private rest = new Uint8Array()
  /** The remote has cancelled; its trailing CANs and backspaces may span several chunks. */
  private tail: [OutcomeState, string] | null = null
  private closing: { expectO: boolean; seen: number } | null = null
  private timer: ReturnType<typeof setTimeout> | undefined

  constructor(
    readonly role: Role,
    protected readonly host: ZmodemHost,
  ) {
    this.result = new Promise((resolve) => {
      this.resolveResult = resolve
    })
    this.arm(IDLE_MS, () => this.idle())
  }

  get over(): boolean {
    return this.finished || this.draining !== null || this.tail !== null
  }

  get ended(): boolean {
    return this.finished
  }

  /**
   * Takes terminal output. Returns null while the transfer keeps it all; once the transfer is
   * over, returns the bytes after it (possibly empty), which belong to the terminal again.
   */
  feed(bytes: Uint8Array): Uint8Array | null {
    if (this.finished) return bytes
    if (this.tail) return this.skipTail(bytes, 0)
    if (this.draining) {
      if (performance.now() - this.draining.started > DRAIN_MAX_MS) {
        this.finish(...this.draining.outcome)
        return bytes
      }
      // The remote answers our cancel with its own, or just exits; either way the shell follows.
      const drain = this.draining
      for (let i = 0; i < bytes.length; i++) {
        if (!drain.damaged && this.decoder.hunting && isShellText(bytes[i])) {
          this.finish(...drain.outcome)
          return bytes.subarray(i)
        }
        const token = this.decoder.step(bytes[i])
        if (token?.kind === 'cancel') {
          this.enterTail(drain.outcome)
          return this.skipTail(bytes, i + 1)
        }
        // Past a damaged frame, raw file data looks like text; wait for quiet instead.
        if (token?.kind === 'error') drain.damaged = true
      }
      drain.recent.push(bytes)
      while (drain.recent.length > 1 && drain.recent[0].length + RECENT < recentLength(drain)) {
        drain.recent.shift()
      }
      this.arm(QUIET_MS, () => this.endDrain())
      return null
    }
    if (!this.busy) this.arm(IDLE_MS, () => this.idle())
    if (this.probe) {
      this.probe.push(bytes)
      this.probeLength += bytes.length
    }
    let offset = 0
    while (offset < bytes.length) {
      if (this.closing) {
        offset = this.close(bytes, offset)
        if (this.finished) return bytes.subarray(offset)
        continue
      }
      const read = this.decoder.read(bytes, offset)
      if (!read) break
      offset = read.next
      if (this.probe) {
        if (read.token.kind !== 'header') return this.notZmodem()
        this.probe = null
      }
      if (read.token.kind === 'cancel') {
        this.remoteCancelled()
        return this.skipTail(bytes, offset)
      }
      this.handle(read.token)
      if (this.finished) return bytes.subarray(offset)
      if (this.draining) return null
    }
    if (this.probe && this.probeLength > PROBE_LIMIT) return this.notZmodem()
    return null
  }

  /** Resolves once data handed over so far has been dealt with (written to disk). */
  settled(): Promise<void> {
    return Promise.resolve()
  }

  /** User cancel: tells the remote to stop. The outcome has no message; the view words it. */
  cancel(): void {
    this.abort('cancelled', '')
  }

  /** The connection is gone; nothing more can be sent. */
  abandon(message: string): void {
    if (!this.finished) this.finish('failed', message)
  }

  protected abstract handle(token: Token): void

  protected cleanup(): void {}

  protected abort(state: OutcomeState, message: string): void {
    if (this.over) return
    this.host.write(CANCEL_SEQUENCE).catch(() => {})
    this.draining = {
      started: performance.now(),
      outcome: [state, message],
      damaged: false,
      recent: [],
    }
    this.cleanup()
    this.arm(QUIET_MS, () => this.endDrain())
  }

  /** Waits out the remote's cancel tail before giving the terminal back. */
  protected enterTail(outcome: [OutcomeState, string]): void {
    this.draining = null
    this.tail = outcome
    this.cleanup()
    this.arm(QUIET_MS, () => this.endTail())
  }

  protected finish(state: OutcomeState, message = ''): void {
    if (this.finished) return
    this.finished = true
    this.draining = null
    this.tail = null
    clearTimeout(this.timer)
    this.cleanup()
    this.resolveResult({ role: this.role, state, message, files: this.files, rest: this.rest })
  }

  /** The protocol is done; skip the line ends after the last header, and the `OO` if expected. */
  protected enterClosing(expectO: boolean): void {
    this.closing = { expectO, seen: 0 }
    this.arm(CLOSING_MS, () => this.finish('done'))
  }

  protected failure(message: string): never {
    throw new Error(message)
  }

  /** Pauses the idle timeout while a dialog is open. */
  protected async waitForUser<T>(run: () => Promise<T>): Promise<T> {
    this.busy = true
    clearTimeout(this.timer)
    try {
      return await run()
    } finally {
      this.busy = false
      if (!this.over) this.arm(IDLE_MS, () => this.idle())
    }
  }

  protected checkOpen(): void {
    if (this.over) throw new Stop()
  }

  protected fail(error: unknown): void {
    if (error instanceof Stop) return
    this.abort('failed', describe(error))
  }

  private close(bytes: Uint8Array, offset: number): number {
    const closing = this.closing
    if (!closing) return offset
    for (let i = offset; i < bytes.length; i++) {
      const b = bytes[i]
      if (b === 0x0d || b === 0x0a || b === 0x8a || b === 0x11) continue
      if (b === 0x4f && closing.expectO && closing.seen < 2) {
        if (++closing.seen === 2) {
          this.finish('done')
          return i + 1
        }
        continue
      }
      this.finish('done')
      return i
    }
    return bytes.length
  }

  private notZmodem(): Uint8Array {
    const held = concat(this.probe ?? [])
    this.probe = null
    this.finish('not-zmodem')
    return held
  }

  private idle(): void {
    if (this.busy || this.over) return
    this.abort('failed', t('idle'))
  }

  private endDrain(): void {
    const drain = this.draining
    if (!drain) return
    // Between frames, shell text would already have ended the drain.
    if (!this.decoder.hunting) this.rest = shellSuffix(concat(drain.recent)).slice()
    this.finish(...drain.outcome)
  }

  private remoteCancelled(): void {
    this.enterTail(['cancelled', t('remoteCancelled')])
  }

  /** lrzsz follows its cancel with more CANs and backspaces; they would only move the cursor. */
  private skipTail(bytes: Uint8Array, offset: number): Uint8Array | null {
    let i = offset
    while (i < bytes.length && (bytes[i] === ZDLE || bytes[i] === 0x08)) i++
    if (i === bytes.length) {
      this.arm(QUIET_MS, () => this.endTail())
      return null
    }
    this.endTail()
    return bytes.subarray(i)
  }

  private endTail(): void {
    if (this.tail) this.finish(...this.tail)
  }

  private arm(ms: number, run: () => void): void {
    clearTimeout(this.timer)
    this.timer = setTimeout(run, ms)
  }
}

interface FileInfo {
  name: string
  size: number | null
  mtime: number | null
  filesLeft: number | null
}

export function parseFileInfo(data: Uint8Array): FileInfo {
  const nul = data.indexOf(0)
  const nameBytes = nul < 0 ? data : data.subarray(0, nul)
  const name = new TextDecoder().decode(nameBytes)
  const rest = nul < 0 ? '' : new TextDecoder('latin1').decode(data.subarray(nul + 1))
  const fields = rest.split('\0')[0].trim().split(/\s+/)
  const num = (text: string | undefined, radix: number) => {
    if (!text) return null
    const value = Number.parseInt(text, radix)
    return Number.isFinite(value) && value >= 0 ? value : null
  }
  return {
    name,
    size: num(fields[0], 10),
    mtime: num(fields[1], 8),
    filesLeft: num(fields[4], 10),
  }
}

export function encodeFileInfo(
  file: OutgoingFile,
  filesLeft: number,
  bytesLeft: number,
): Uint8Array {
  const name = new TextEncoder().encode(file.name)
  const meta = new TextEncoder().encode(
    `${file.size} ${file.mtime.toString(8)} 100644 0 ${filesLeft} ${bytesLeft}`,
  )
  const out = new Uint8Array(name.length + meta.length + 2)
  out.set(name)
  out.set(meta, name.length + 1)
  return out
}

interface Receiving {
  name: string
  size: number | null
  index: number
  sink: FileSink
  received: number
}

/** The remote ran `sz`: we receive. */
export class Receiver extends ZmodemSession {
  private phase: 'init' | 'preparing' | 'ready' | 'opening' = 'init'
  /** What the subpackets after the last header are for. */
  private expect: 'sinit' | 'info' | 'file' | 'ignore' = 'ignore'
  private file: Receiving | null = null
  private count: number | null = null
  private errors = 0
  private work: Promise<void> = Promise.resolve()
  private pending: Uint8Array[] = []
  private pendingLength = 0

  constructor(host: ZmodemHost) {
    super('receive', host)
  }

  override settled(): Promise<void> {
    return this.work
  }

  protected handle(token: Token): void {
    switch (token.kind) {
      case 'error':
        this.damaged()
        return
      case 'data':
        this.data(token.data, token.end)
        return
      case 'header':
        this.header(token)
    }
  }

  protected override cleanup(): void {
    const file = this.file
    this.file = null
    this.pending = []
    if (file) this.work = this.work.then(() => file.sink.close(false)).catch(() => {})
  }

  private header(h: Header): void {
    this.expect = 'ignore'
    switch (h.type) {
      case Frame.RQINIT:
        if (this.phase === 'init') {
          this.phase = 'preparing'
          this.queue(async () => {
            const ok = await this.waitForUser(() => this.host.prepare())
            this.checkOpen()
            if (!ok) return this.abort('cancelled', t('receiveCancelled'))
            this.phase = 'ready'
            await this.sendInit()
          })
        } else if (this.phase === 'ready' && !this.file) this.queue(() => this.sendInit())
        return
      case Frame.SINIT:
        this.expect = 'sinit'
        return
      case Frame.FILE:
        this.expect = 'info'
        return
      case Frame.DATA: {
        const file = this.file
        if (!file) return
        if (bytesPos(h.p) !== file.received) {
          this.retry(file)
          return
        }
        this.expect = 'file'
        return
      }
      case Frame.EOF: {
        const file = this.file
        // An EOF for another offset may have crossed our ZRPOS; the sender will time out and resend.
        if (!file || bytesPos(h.p) !== file.received) return
        this.file = null
        this.flush(file)
        // A complete file is kept even if the transfer is cancelled right after.
        this.queue(async () => {
          await file.sink.close(true)
          this.files.push({
            name: file.name,
            size: file.received,
            path: file.sink.path,
            skipped: false,
          })
          if (!this.over) await this.sendInit()
        }, true)
        return
      }
      case Frame.FIN:
        this.queue(() => this.host.write(this.encoder.hex(Frame.FIN, posBytes(0))))
        this.enterClosing(true)
        return
      case Frame.COMMAND:
        // Never run commands for the remote.
        this.abort('failed', t('command'))
        return
      case Frame.ABORT:
      case Frame.FERR:
      case Frame.CAN:
        this.finish('failed', t('remoteAborted'))
        return
    }
  }

  private data(data: Uint8Array, end: EndKind): void {
    const expect = this.expect
    if (end === End.E || end === End.W) this.expect = 'ignore'
    switch (expect) {
      case 'sinit':
        this.queue(() => this.host.write(this.encoder.hex(Frame.ACK, posBytes(0))))
        return
      case 'info':
        this.info(parseFileInfo(data))
        return
      case 'file': {
        const file = this.file
        if (!file) return
        file.received += data.length
        this.pending.push(data)
        this.pendingLength += data.length
        if (this.pendingLength >= FLUSH_AT || end === End.Q || end === End.W) this.flush(file)
        if (end === End.Q || end === End.W) {
          const pos = posBytes(file.received)
          this.queue(() => this.host.write(this.encoder.hex(Frame.ACK, pos)))
        }
        this.host.onProgress({
          name: file.name,
          index: file.index,
          count: this.count,
          bytesDone: file.received,
          bytesTotal: file.size,
        })
        return
      }
      case 'ignore':
        return
    }
  }

  private info(info: FileInfo): void {
    if (this.phase === 'opening') return
    const current = this.file
    if (current) {
      // The sender missed our ZRPOS and offered the file again.
      if (current.received === 0 && current.name === info.name) {
        this.queue(() => this.host.write(this.encoder.hex(Frame.RPOS, posBytes(0))))
      }
      return
    }
    if (this.phase !== 'ready') return
    const index = this.files.length + 1
    if (info.filesLeft !== null) this.count = this.files.length + info.filesLeft
    this.phase = 'opening'
    this.queue(async () => {
      const sink = await this.host.open({ name: info.name, size: info.size, mtime: info.mtime })
      this.phase = 'ready'
      if (!sink) {
        this.files.push({ name: info.name, size: info.size ?? 0, path: null, skipped: true })
        await this.host.write(this.encoder.hex(Frame.SKIP, posBytes(0)))
        return
      }
      if (this.over) {
        await sink.close(false)
        return
      }
      this.file = { name: info.name, size: info.size, index, sink, received: 0 }
      this.host.onProgress({
        name: info.name,
        index,
        count: this.count,
        bytesDone: 0,
        bytesTotal: info.size,
      })
      await this.host.write(this.encoder.hex(Frame.RPOS, posBytes(0)))
    })
  }

  private damaged(): void {
    if (++this.errors > MAX_ERRORS) {
      this.abort('failed', t('checksum'))
      return
    }
    this.expect = 'ignore'
    if (this.file) this.retry(this.file)
    else this.queue(() => this.host.write(this.encoder.hex(Frame.NAK, posBytes(0))))
  }

  private retry(file: Receiving): void {
    const pos = posBytes(file.received)
    this.queue(() => this.host.write(this.encoder.hex(Frame.RPOS, pos)))
  }

  private flush(file: Receiving): void {
    if (this.pendingLength === 0) return
    const data = concat(this.pending)
    this.pending = []
    this.pendingLength = 0
    this.queue(() => file.sink.write(data), true)
  }

  private sendInit(): Promise<void> {
    return this.host.write(this.encoder.hex(Frame.RINIT, flagBytes(CANFDX | CANOVIO | CANFC32)))
  }

  private queue(run: () => Promise<void>, always = false): void {
    this.work = this.work.then(async () => {
      if (this.over && !always) return
      try {
        await run()
      } catch (error) {
        this.fail(error)
      }
    })
  }
}

/** The remote ran `rz`: we send. */
export class Sender extends ZmodemSession {
  private started = false
  private finSent = false
  private lastInit = 0
  private bufferSize = 0
  private inbox: Header[] = []
  private wake: (() => void) | null = null

  constructor(host: ZmodemHost) {
    super('send', host)
  }

  protected handle(token: Token): void {
    if (token.kind !== 'header') return
    if (token.type === Frame.RINIT) {
      this.lastInit = performance.now()
      if (!this.started) {
        this.started = true
        const flags = token.p[3]
        this.encoder.crc32 = (flags & CANFC32) !== 0
        this.encoder.escapeCtl = (flags & ESCCTL) !== 0
        this.bufferSize = token.p[0] | (token.p[1] << 8)
        this.run().catch((error) => this.fail(error))
        return
      }
    }
    if (token.type === Frame.FIN && this.finSent) {
      this.host.write(new Uint8Array([0x4f, 0x4f])).catch(() => {})
      this.enterClosing(false)
    }
    this.inbox.push(token)
    this.wake?.()
  }

  protected override finish(state: OutcomeState, message = ''): void {
    super.finish(state, message)
    this.wake?.()
  }

  protected override abort(state: OutcomeState, message: string): void {
    super.abort(state, message)
    this.wake?.()
  }

  protected override enterTail(outcome: [OutcomeState, string]): void {
    super.enterTail(outcome)
    this.wake?.()
  }

  private async run(): Promise<void> {
    const files = await this.waitForUser(() => this.host.pick())
    this.checkOpen()
    if (!files?.length) return this.abort('cancelled', t('uploadCancelled'))
    // rz gives up after a couple of minutes; if it went quiet, don't type protocol into the shell.
    if (performance.now() - this.lastInit > 15_000) {
      this.inbox = []
      const h = await this.next(12_000)
      this.checkOpen()
      if (h?.type !== Frame.RINIT) {
        return this.finish('failed', t('rzTimeout'))
      }
    }
    this.inbox = []
    let bytesLeft = files.reduce((n, f) => n + f.size, 0)
    for (const [i, file] of files.entries()) {
      await this.sendFile(file, i + 1, files.length, bytesLeft)
      bytesLeft -= file.size
    }
    this.finSent = true
    for (let tries = 0; tries < 3; tries++) {
      await this.write(this.encoder.hex(Frame.FIN, posBytes(0)))
      for (;;) {
        const h = await this.next(5000)
        this.checkOpen()
        if (!h) break
        if (h.type === Frame.FIN) return
      }
    }
    await this.write(new Uint8Array([0x4f, 0x4f]))
    this.finish('done')
  }

  private async sendFile(file: OutgoingFile, index: number, count: number, bytesLeft: number) {
    const info = encodeFileInfo(file, count - index + 1, bytesLeft)
    let start: number | null = null
    for (let tries = 0; start === null; tries++) {
      if (tries === 10) this.failure(t('noInfoReply', { name: ltr(file.name) }))
      await this.write(
        concat([
          this.encoder.binary(Frame.FILE, flagBytes(ZCBIN)),
          this.encoder.subpacket(info, End.W),
        ]),
      )
      for (;;) {
        const h = await this.next(10_000)
        this.checkOpen()
        if (!h || h.type === Frame.RINIT || h.type === Frame.NAK) break
        if (h.type === Frame.RPOS) {
          start = bytesPos(h.p)
          break
        }
        if (h.type === Frame.SKIP) {
          this.files.push({ name: file.name, size: file.size, path: null, skipped: true })
          return
        }
        if (h.type === Frame.ABORT || h.type === Frame.FERR || h.type === Frame.FIN) {
          this.failure(t('refused', { name: ltr(file.name) }))
        }
      }
    }
    const skipped = await this.stream(file, start, index, count)
    this.files.push({ name: file.name, size: file.size, path: null, skipped })
  }

  /** Returns true when the receiver skipped the file part way. */
  private async stream(file: OutgoingFile, start: number, index: number, count: number) {
    const total = file.size
    const windowed = this.bufferSize > 0
    const window = windowed ? this.bufferSize : WINDOW
    let sent = Math.min(start, total)
    let acked = sent
    let header = true
    let eofSent = false
    let eofTries = 0
    let rewinds = 0
    let skipped = false

    const apply = (h: Header) => {
      switch (h.type) {
        case Frame.ACK:
          acked = Math.max(acked, Math.min(bytesPos(h.p), sent))
          return
        case Frame.RPOS:
          if (++rewinds > MAX_ERRORS) this.failure(t('checksum'))
          sent = Math.min(bytesPos(h.p), total)
          acked = sent
          header = true
          eofSent = false
          return
        case Frame.SKIP:
          skipped = true
          return
        case Frame.ABORT:
        case Frame.FERR:
        case Frame.FIN:
          this.failure(t('stoppedReceiving', { name: ltr(file.name) }))
      }
    }

    for (;;) {
      for (let h = this.inbox.shift(); h; h = this.inbox.shift()) apply(h)
      if (skipped) return true
      if (sent < total) {
        if (sent - acked >= window) {
          const h = await this.next(30_000)
          this.checkOpen()
          if (!h) this.failure(t('noAck'))
          apply(h)
          continue
        }
        const want = Math.min(windowed ? Math.min(BATCH, window) : BATCH, total - sent)
        const chunk = await file.read(sent, want)
        this.checkOpen()
        if (chunk.length === 0) this.failure(t('shrank', { name: ltr(file.name) }))
        const parts: Uint8Array[] = []
        if (header) {
          parts.push(this.encoder.binary(Frame.DATA, posBytes(sent)))
          header = false
        }
        for (let at = 0; at < chunk.length; at += SUBPACKET) {
          const piece = chunk.subarray(at, at + SUBPACKET)
          const last = at + SUBPACKET >= chunk.length
          let end: EndKind = End.G
          if (last && sent + chunk.length >= total) end = End.E
          else if (last) end = windowed ? End.W : End.Q
          parts.push(this.encoder.subpacket(piece, end))
          if (end === End.E || end === End.W) header = true
        }
        await this.write(concat(parts))
        sent += chunk.length
        this.host.onProgress({ name: file.name, index, count, bytesDone: sent, bytesTotal: total })
        continue
      }
      if (!eofSent) {
        if (++eofTries > 5) this.failure(t('noEofAck', { name: ltr(file.name) }))
        await this.write(this.encoder.binary(Frame.EOF, posBytes(total)))
        eofSent = true
        if (total === 0) {
          this.host.onProgress({ name: file.name, index, count, bytesDone: 0, bytesTotal: 0 })
        }
      }
      const h = await this.next(10_000)
      this.checkOpen()
      if (!h) {
        eofSent = false
        continue
      }
      if (h.type === Frame.RINIT) return false
      apply(h)
    }
  }

  private write(bytes: Uint8Array): Promise<void> {
    this.checkOpen()
    return this.host.write(bytes)
  }

  /** Next header from the receiver, or null after `ms` (or once the session is over). */
  private next(ms: number): Promise<Header | null> {
    const ready = this.inbox.shift()
    if (ready || this.over) return Promise.resolve(ready ?? null)
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer)
        this.wake = null
        resolve(this.over ? null : (this.inbox.shift() ?? null))
      }
      const timer = setTimeout(done, ms)
      this.wake = done
    })
  }
}
