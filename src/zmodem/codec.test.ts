import { describe, expect, it } from 'vitest'
import {
  bytesPos,
  crc16,
  crc32,
  Decoder,
  Encoder,
  End,
  Frame,
  findStart,
  flagBytes,
  partialStart,
  posBytes,
  type Token,
} from './codec'

const ascii = (text: string) => new Uint8Array([...text].map((c) => c.charCodeAt(0)))

function decodeAll(bytes: Uint8Array, decoder = new Decoder()): Token[] {
  const tokens: Token[] = []
  for (let r = decoder.read(bytes, 0); r; r = decoder.read(bytes, r.next)) tokens.push(r.token)
  return tokens
}

describe('crc', () => {
  it('matches the reference check values', () => {
    expect(crc16(ascii('123456789'))).toBe(0x31c3)
    expect(crc32(ascii('123456789'))).toBe(0xcbf43926)
    expect(crc32(ascii('12345678'), 0x39)).toBe(0xcbf43926)
  })
})

describe('Encoder', () => {
  it('writes the hex ZRINIT lrzsz rz sends', () => {
    const out = new Encoder().hex(Frame.RINIT, flagBytes(0x23))
    expect(out).toEqual(ascii('**\x18B0100000023be50\r\x8a\x11'))
  })

  it('writes the hex ZRQINIT lrzsz sz sends', () => {
    const out = new Encoder().hex(Frame.RQINIT, posBytes(0))
    expect(out).toEqual(ascii('**\x18B00000000000000\r\x8a\x11'))
  })

  it('escapes ZDLE, flow control and @-CR', () => {
    const out = new Encoder().subpacket(new Uint8Array([0x18, 0x11, 0x41, 0x40, 0x0d, 0x0d]), End.E)
    expect([...out.subarray(0, 9)]).toEqual([0x18, 0x58, 0x18, 0x51, 0x41, 0x40, 0x18, 0x4d, 0x0d])
  })

  it('escapes every control character when asked', () => {
    const enc = new Encoder()
    enc.escapeCtl = true
    const out = enc.subpacket(new Uint8Array([0x01, 0x20, 0x81]), End.E)
    expect([...out.subarray(0, 5)]).toEqual([0x18, 0x41, 0x20, 0x18, 0xc1])
  })
})

describe('Decoder', () => {
  it('round-trips headers and subpackets with both CRCs', () => {
    for (const wide of [false, true]) {
      const enc = new Encoder()
      enc.crc32 = wide
      const payload = new Uint8Array(3000).map((_, i) => (i * 37) & 0xff)
      const stream = new Uint8Array([
        ...enc.binary(Frame.DATA, posBytes(70000)),
        ...enc.subpacket(payload.subarray(0, 1024), End.G),
        ...enc.subpacket(payload.subarray(1024, 2048), End.Q),
        ...enc.subpacket(payload.subarray(2048), End.E),
        ...enc.hex(Frame.EOF, posBytes(3000)),
      ])
      const tokens = decodeAll(stream)
      expect(tokens.map((t) => t.kind)).toEqual(['header', 'data', 'data', 'data', 'header'])
      const [head, , , , eof] = tokens
      expect(head.kind === 'header' && bytesPos(head.p)).toBe(70000)
      expect(eof.kind === 'header' && eof.type).toBe(Frame.EOF)
      const data = tokens.flatMap((t) => (t.kind === 'data' ? [...t.data] : []))
      expect(new Uint8Array(data)).toEqual(payload)
    }
  })

  it('keeps its place across arbitrary chunk boundaries', () => {
    const enc = new Encoder()
    enc.crc32 = true
    const payload = new Uint8Array(500).map((_, i) => i & 0xff)
    const stream = new Uint8Array([
      ...enc.binary(Frame.DATA, posBytes(0)),
      ...enc.subpacket(payload, End.W),
    ])
    const decoder = new Decoder()
    const tokens: Token[] = []
    for (let at = 0; at < stream.length; at += 3) {
      tokens.push(...decodeAll(stream.subarray(at, at + 3), decoder))
    }
    expect(tokens.map((t) => t.kind)).toEqual(['header', 'data'])
    expect(tokens[1].kind === 'data' && tokens[1].data).toEqual(payload)
  })

  it('reports damage and recovers at the next header', () => {
    const enc = new Encoder()
    const sub = enc.subpacket(ascii('hello'), End.E)
    sub[1] ^= 0x01
    const stream = new Uint8Array([
      ...enc.binary(Frame.DATA, posBytes(0)),
      ...sub,
      ...enc.hex(Frame.EOF, posBytes(5)),
    ])
    expect(decodeAll(stream).map((t) => t.kind)).toEqual(['header', 'error', 'header'])
  })

  it('sees the cancel sequence', () => {
    expect(decodeAll(new Uint8Array([0x41, 0x18, 0x18, 0x18, 0x18, 0x18]))).toEqual([
      { kind: 'cancel' },
    ])
  })
})

describe('findStart', () => {
  it('finds sz and rz starts, swallowing the lead-in', () => {
    expect(findStart(ascii('$ sz f\r\nrz\r**\x18B00000000000000\r\x8a\x11'))).toEqual({
      index: 8,
      role: 'receive',
    })
    expect(findStart(ascii('rz waiting to receive.**\x18B0100000023be50'))).toEqual({
      index: 22,
      role: 'send',
    })
    expect(findStart(ascii('\x18B00000000000000'))).toEqual({ index: 0, role: 'receive' })
  })

  it('ignores other output', () => {
    expect(findStart(ascii('**B00 x \x18B00'))).toBeNull()
    expect(findStart(ascii('**\x18B02'))).toBeNull()
  })

  it('holds back a start cut off at the end of a chunk', () => {
    expect(partialStart(ascii('ab**\x18B'))).toBe(4)
    expect(partialStart(ascii('ab**\x18'))).toBe(3)
    expect(partialStart(ascii('ab*'))).toBe(0)
    expect(partialStart(ascii('ab\x18x'))).toBe(0)
  })
})
