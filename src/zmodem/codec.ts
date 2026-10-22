// ZMODEM framing (Forsberg 1988, as spoken by lrzsz): CRCs, ZDLE escaping, headers, subpackets.

export const ZPAD = 0x2a
export const ZDLE = 0x18
const ZBIN = 0x41
const ZHEX = 0x42
const ZBIN32 = 0x43

export const Frame = {
  RQINIT: 0,
  RINIT: 1,
  SINIT: 2,
  ACK: 3,
  FILE: 4,
  SKIP: 5,
  NAK: 6,
  ABORT: 7,
  FIN: 8,
  RPOS: 9,
  DATA: 10,
  EOF: 11,
  FERR: 12,
  CRC: 13,
  CHALLENGE: 14,
  COMPL: 15,
  CAN: 16,
  FREECNT: 17,
  COMMAND: 18,
  STDERR: 19,
} as const

/** How a data subpacket ends: E ends the frame, G continues, Q continues and wants an ACK, W ends and wants an ACK. */
export const End = { E: 0x68, G: 0x69, Q: 0x6a, W: 0x6b } as const
export type EndKind = (typeof End)[keyof typeof End]

/** ZRINIT capability bits (ZF0). */
export const CANFDX = 0x01
export const CANOVIO = 0x02
export const CANFC32 = 0x20
export const ESCCTL = 0x40

const ZRUB0 = 0x6c
const ZRUB1 = 0x6d
/** Longest subpacket accepted; ZMODEM-8k is the largest variant in use. */
const MAX_SUBPACKET = 8192
const CANCELS = 5

/** 8 × CAN then 8 × backspace, the abort lrzsz itself sends; the backspaces erase it from a tty. */
export const CANCEL_SEQUENCE = new Uint8Array([...Array(8).fill(ZDLE), ...Array(8).fill(0x08)])

const CRC16_TABLE = (() => {
  const table = new Uint16Array(256)
  for (let i = 0; i < 256; i++) {
    let crc = i << 8
    for (let j = 0; j < 8; j++) crc = crc & 0x8000 ? (crc << 1) ^ 0x1021 : crc << 1
    table[i] = crc & 0xffff
  }
  return table
})()

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let crc = i
    for (let j = 0; j < 8; j++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1
    table[i] = crc >>> 0
  }
  return table
})()

/** CRC-16/XMODEM over `bytes`, then over `extra` when given. */
export function crc16(bytes: Uint8Array, extra?: number): number {
  let crc = 0
  const step = (b: number) => {
    crc = ((crc << 8) ^ CRC16_TABLE[((crc >>> 8) ^ b) & 0xff]) & 0xffff
  }
  for (const b of bytes) step(b)
  if (extra !== undefined) step(extra)
  return crc
}

/** CRC-32 (IEEE) over `bytes`, then over `extra` when given. */
export function crc32(bytes: Uint8Array, extra?: number): number {
  let crc = 0xffffffff
  const step = (b: number) => {
    crc = (crc >>> 8) ^ CRC32_TABLE[(crc ^ b) & 0xff]
  }
  for (const b of bytes) step(b)
  if (extra !== undefined) step(extra)
  return (crc ^ 0xffffffff) >>> 0
}

/** Header argument bytes p0..p3 for a file position (little-endian). */
export function posBytes(pos: number): Uint8Array {
  return new Uint8Array([pos & 0xff, (pos >>> 8) & 0xff, (pos >>> 16) & 0xff, (pos >>> 24) & 0xff])
}

export function bytesPos(p: Uint8Array): number {
  return (p[0] | (p[1] << 8) | (p[2] << 16) | (p[3] << 24)) >>> 0
}

/** Flag bytes ZF0..ZF3 travel in reverse: ZF0 is p3. */
export function flagBytes(zf0: number, zf1 = 0, zf2 = 0, zf3 = 0): Uint8Array {
  return new Uint8Array([zf3, zf2, zf1, zf0])
}

const HEX = '0123456789abcdef'

export class Encoder {
  /** Use CRC-32 for binary headers and subpackets (the receiver set CANFC32). */
  crc32 = false
  /** Escape every control character (the receiver set ESCCTL). */
  escapeCtl = false
  private last = 0

  hex(type: number, p: Uint8Array): Uint8Array {
    const head = new Uint8Array([type, ...p])
    const crc = crc16(head)
    let text = ''
    for (const b of [...head, crc >>> 8, crc & 0xff]) text += HEX[b >>> 4] + HEX[b & 0x0f]
    const out = [ZPAD, ZPAD, ZDLE, ZHEX, ...[...text].map((c) => c.charCodeAt(0)), 0x0d, 0x8a]
    if (type !== Frame.FIN && type !== Frame.ACK) out.push(0x11)
    this.last = out[out.length - 1]
    return new Uint8Array(out)
  }

  binary(type: number, p: Uint8Array): Uint8Array {
    const head = new Uint8Array([type, ...p])
    const out = new Writer(32)
    out.push(ZPAD, ZDLE, this.crc32 ? ZBIN32 : ZBIN)
    this.last = this.crc32 ? ZBIN32 : ZBIN
    this.escape(out, head)
    this.escape(out, this.trailer(head))
    return out.bytes()
  }

  subpacket(data: Uint8Array, end: EndKind): Uint8Array {
    const out = new Writer(data.length * 2 + 16)
    this.escape(out, data)
    out.push(ZDLE, end)
    this.last = end
    this.escape(out, this.trailer(data, end))
    return out.bytes()
  }

  private trailer(data: Uint8Array, extra?: number): Uint8Array {
    if (this.crc32) {
      const crc = crc32(data, extra)
      return new Uint8Array([crc & 0xff, (crc >>> 8) & 0xff, (crc >>> 16) & 0xff, crc >>> 24])
    }
    const crc = crc16(data, extra)
    return new Uint8Array([crc >>> 8, crc & 0xff])
  }

  private escape(out: Writer, bytes: Uint8Array): void {
    for (const b of bytes) {
      if (this.needsEscape(b)) {
        out.push(ZDLE, b ^ 0x40)
        this.last = b ^ 0x40
      } else {
        out.push(b)
        this.last = b
      }
    }
  }

  private needsEscape(b: number): boolean {
    switch (b) {
      case ZDLE:
      case 0x10:
      case 0x90:
      case 0x11:
      case 0x91:
      case 0x13:
      case 0x93:
        return true
      // `@` + CR is the Telenet escape.
      case 0x0d:
      case 0x8d:
        return this.escapeCtl || (this.last & 0x7f) === 0x40
      default:
        return this.escapeCtl && (b & 0x60) === 0
    }
  }
}

class Writer {
  private buf: Uint8Array
  private len = 0

  constructor(size: number) {
    this.buf = new Uint8Array(size)
  }

  push(...bytes: number[]): void {
    if (this.len + bytes.length > this.buf.length) {
      const next = new Uint8Array(Math.max(this.buf.length * 2, this.len + bytes.length))
      next.set(this.buf)
      this.buf = next
    }
    for (const b of bytes) this.buf[this.len++] = b
  }

  bytes(): Uint8Array {
    return this.buf.slice(0, this.len)
  }
}

export interface Header {
  kind: 'header'
  type: number
  p: Uint8Array
}

export type Token =
  | Header
  | { kind: 'data'; data: Uint8Array; end: EndKind }
  /** A damaged header or subpacket; the decoder is hunting for the next header. */
  | { kind: 'error'; reason: string }
  /** The other side sent the cancel sequence. */
  | { kind: 'cancel' }

type State = 'hunt' | 'pad' | 'padDle' | 'hex' | 'bin' | 'hexTail' | 'data' | 'crc'

const FRAMES_WITH_DATA: ReadonlySet<number> = new Set([
  Frame.SINIT,
  Frame.FILE,
  Frame.DATA,
  Frame.COMMAND,
])

function isFlow(b: number): boolean {
  return b === 0x11 || b === 0x13 || b === 0x91 || b === 0x93
}

function hexValue(b: number): number {
  if (b >= 0x30 && b <= 0x39) return b - 0x30
  if (b >= 0x61 && b <= 0x66) return b - 0x57
  if (b >= 0x41 && b <= 0x46) return b - 0x37
  return -1
}

/** Byte-at-a-time parser; it keeps its place across chunks. */
export class Decoder {
  private state: State = 'hunt'
  private escaped = false
  private cancels = 0
  private wide = false
  private head = new Uint8Array(9)
  private headLen = 0
  private headWant = 0
  private nibble = -1
  private tail = 0
  private data = new Uint8Array(MAX_SUBPACKET)
  private dataLen = 0
  private end: EndKind = End.E
  private crc = new Uint8Array(4)
  private crcLen = 0

  /** Between frames: the next byte is not part of any header or subpacket. */
  get hunting(): boolean {
    return this.state === 'hunt'
  }

  /** Parses from `offset` until a token completes; null once the input is used up. */
  read(bytes: Uint8Array, offset: number): { token: Token; next: number } | null {
    for (let i = offset; i < bytes.length; i++) {
      const token = this.step(bytes[i])
      if (token) return { token, next: i + 1 }
    }
    return null
  }

  step(b: number): Token | null {
    if (b === ZDLE) {
      if (++this.cancels >= CANCELS) {
        this.cancels = 0
        this.reset()
        return { kind: 'cancel' }
      }
    } else this.cancels = 0

    switch (this.state) {
      case 'hunt':
        if (b === ZPAD) this.state = 'pad'
        return null
      case 'pad':
        if (b === ZDLE) this.state = 'padDle'
        else if (b !== ZPAD) this.state = 'hunt'
        return null
      case 'padDle':
        this.headLen = 0
        this.escaped = false
        if (b === ZHEX) {
          this.state = 'hex'
          this.headWant = 7
          this.nibble = -1
          this.wide = false
        } else if (b === ZBIN || b === ZBIN32) {
          this.state = 'bin'
          this.wide = b === ZBIN32
          this.headWant = this.wide ? 9 : 7
        } else this.state = b === ZPAD ? 'pad' : 'hunt'
        return null
      case 'hex':
        return this.hexByte(b)
      case 'bin': {
        const v = this.unescape(b)
        if (v === null) return null
        if (v < 0) return this.fail('header has a bad escape')
        this.head[this.headLen++] = v
        return this.headLen === this.headWant ? this.finishHeader() : null
      }
      case 'hexTail':
        if (this.tail === 0 && b === 0x0d) {
          this.tail = 1
          return null
        }
        if (this.tail <= 1 && (b === 0x0a || b === 0x8a)) {
          this.tail = 2
          return null
        }
        this.state = 'data'
        return this.dataByte(b)
      case 'data':
        return this.dataByte(b)
      case 'crc': {
        const v = this.unescape(b)
        if (v === null) return null
        if (v < 0) return this.fail('subpacket CRC has a bad escape')
        this.crc[this.crcLen++] = v
        return this.crcLen === (this.wide ? 4 : 2) ? this.finishSubpacket() : null
      }
    }
  }

  private hexByte(b: number): Token | null {
    const v = hexValue(b)
    if (v < 0) return this.fail('hex header has a non-hex character')
    if (this.nibble < 0) {
      this.nibble = v
      return null
    }
    this.head[this.headLen++] = (this.nibble << 4) | v
    this.nibble = -1
    return this.headLen === this.headWant ? this.finishHeader() : null
  }

  private finishHeader(): Token {
    const body = this.head.slice(0, 5)
    let ok: boolean
    if (this.wide) {
      const got = bytesPos(this.head.subarray(5, 9))
      ok = got === crc32(body)
    } else ok = ((this.head[5] << 8) | this.head[6]) === crc16(body)
    if (!ok) return this.fail('header CRC mismatch')
    const type = body[0]
    const hex = this.state === 'hex'
    if (FRAMES_WITH_DATA.has(type)) {
      this.dataLen = 0
      this.escaped = false
      this.tail = 0
      this.state = hex ? 'hexTail' : 'data'
    } else this.state = 'hunt'
    return { kind: 'header', type, p: body.slice(1, 5) }
  }

  private dataByte(b: number): Token | null {
    if (!this.escaped) {
      if (b === ZDLE) this.escaped = true
      else if (!isFlow(b)) return this.pushData(b)
      return null
    }
    if (b === ZDLE || isFlow(b)) return null
    this.escaped = false
    if (b >= End.E && b <= End.W) {
      this.end = b as EndKind
      this.crcLen = 0
      this.state = 'crc'
      return null
    }
    if (b === ZRUB0) return this.pushData(0x7f)
    if (b === ZRUB1) return this.pushData(0xff)
    if ((b & 0x60) === 0x40) return this.pushData(b ^ 0x40)
    return this.fail('subpacket has a bad escape')
  }

  private pushData(b: number): Token | null {
    if (this.dataLen === MAX_SUBPACKET) return this.fail('subpacket too long')
    this.data[this.dataLen++] = b
    return null
  }

  private finishSubpacket(): Token {
    const data = this.data.slice(0, this.dataLen)
    const ok = this.wide
      ? bytesPos(this.crc) === crc32(data, this.end)
      : ((this.crc[0] << 8) | this.crc[1]) === crc16(data, this.end)
    if (!ok) return this.fail('subpacket CRC mismatch')
    const end = this.end
    this.dataLen = 0
    this.state = end === End.G || end === End.Q ? 'data' : 'hunt'
    return { kind: 'data', data, end }
  }

  /** null: needs another byte; -1: invalid escape. */
  private unescape(b: number): number | null {
    if (!this.escaped) {
      if (b === ZDLE) {
        this.escaped = true
        return null
      }
      return isFlow(b) ? null : b
    }
    if (b === ZDLE || isFlow(b)) return null
    this.escaped = false
    if (b === ZRUB0) return 0x7f
    if (b === ZRUB1) return 0xff
    return (b & 0x60) === 0x40 ? b ^ 0x40 : -1
  }

  private fail(reason: string): Token {
    this.reset()
    return { kind: 'error', reason }
  }

  private reset(): void {
    this.state = 'hunt'
    this.escaped = false
    this.dataLen = 0
  }
}

export interface ZmodemStart {
  /** Index of the first byte that belongs to the transfer. */
  index: number
  /** `receive`: the remote ran sz and we take files; `send`: it ran rz and wants ours. */
  role: 'receive' | 'send'
}

const START = [ZDLE, ZHEX, 0x30] as const

function padsBefore(bytes: Uint8Array, at: number): number {
  let from = at
  while (from > 0 && at - from < 2 && bytes[from - 1] === ZPAD) from--
  return from
}

/**
 * Finds a ZRQINIT (`sz` starting) or ZRINIT (`rz` starting) hex header in terminal output.
 * The leading `**` and the `rz\r` lrzsz prints before ZRQINIT are counted as part of it.
 * Without the `**` it only counts at the very start, where they may have ended the last chunk.
 */
export function findStart(bytes: Uint8Array): ZmodemStart | null {
  for (let i = 0; i + 3 < bytes.length; i++) {
    if (bytes[i] !== START[0] || bytes[i + 1] !== START[1] || bytes[i + 2] !== START[2]) continue
    const kind = bytes[i + 3]
    if (kind !== 0x30 && kind !== 0x31) continue
    let index = padsBefore(bytes, i)
    if (index === i && i > 0) continue
    const role = kind === 0x30 ? 'receive' : 'send'
    const rz = [0x72, 0x7a, 0x0d]
    if (role === 'receive' && index >= 3 && rz.every((c, k) => bytes[index - 3 + k] === c))
      index -= 3
    return { index, role }
  }
  return null
}

/** Length of a trailing partial start header (`**` ZDLE `B` `0`) to hold back for the next chunk. */
export function partialStart(bytes: Uint8Array): number {
  const n = bytes.length
  const at = bytes.lastIndexOf(ZDLE)
  if (at < 0 || n - at > START.length) return 0
  for (let k = at; k < n; k++) if (bytes[k] !== START[k - at]) return 0
  return n - padsBefore(bytes, at)
}
