import { describe, expect, it } from 'vitest'
import { Encoder, Frame, posBytes } from './codec'
import {
  type FileSink,
  type OutgoingFile,
  parseFileInfo,
  Receiver,
  Sender,
  shellSuffix,
  type ZmodemHost,
  type ZmodemSession,
} from './session'

function file(name: string, size: number): OutgoingFile & { data: Uint8Array } {
  const data = new Uint8Array(size).map((_, i) => (i * 131 + size) & 0xff)
  return {
    name,
    size,
    mtime: 1_700_000_000,
    data,
    read: async (offset, length) => data.slice(offset, offset + length),
  }
}

interface Saved {
  name: string
  chunks: Uint8Array[]
  kept: boolean | null
}

function joined(saved: Saved): Uint8Array {
  return new Uint8Array(saved.chunks.flatMap((c) => [...c]))
}

/** Wires a Sender and a Receiver back to back; `tamper` may damage what the sender writes. */
function link(files: OutgoingFile[], tamper?: (bytes: Uint8Array, n: number) => Uint8Array) {
  const saved: Saved[] = []
  let receiver: ZmodemSession | null = null
  let sender: ZmodemSession | null = null
  const toTerminal: number[] = []
  let writes = 0
  const deliver = (target: () => ZmodemSession | null, bytes: Uint8Array) =>
    new Promise<void>((resolve) =>
      setTimeout(() => {
        const rest = target()?.feed(bytes)
        if (rest) toTerminal.push(...rest)
        resolve()
      }, 0),
    )
  const base = {
    prepare: async () => true,
    open: async (): Promise<FileSink | null> => null,
    pick: async () => null,
    onProgress: () => {},
  }
  const receiverHost: ZmodemHost = {
    ...base,
    write: (bytes) => deliver(() => sender, bytes),
    open: async (incoming) => {
      const entry: Saved = { name: incoming.name, chunks: [], kept: null }
      saved.push(entry)
      return {
        path: `/dl/${incoming.name}`,
        write: async (data) => {
          entry.chunks.push(data.slice())
        },
        close: async (keep) => {
          entry.kept = keep
        },
      }
    },
  }
  const senderHost: ZmodemHost = {
    ...base,
    write: (bytes) => deliver(() => receiver, tamper ? tamper(bytes, writes++) : bytes),
    pick: async () => files,
  }
  receiver = new Receiver(receiverHost)
  sender = new Sender(senderHost)
  // What `sz` prints first; our Sender plays sz from here on.
  receiver.feed(new Encoder().hex(Frame.RQINIT, posBytes(0)))
  return { receiver, sender, saved, toTerminal }
}

describe('Sender and Receiver', () => {
  it('move several files, including an empty one', async () => {
    const files = [file('a.bin', 100_000), file('empty', 0), file('中文.txt', 1025)]
    const { receiver, sender, saved, toTerminal } = link(files)
    const got = await receiver.result
    expect(got.state).toBe('done')
    expect(got.files.map((f) => [f.name, f.size, f.skipped])).toEqual([
      ['a.bin', 100_000, false],
      ['empty', 0, false],
      ['中文.txt', 1025, false],
    ])
    expect(saved.map((s) => s.kept)).toEqual([true, true, true])
    for (const [i, f] of files.entries()) expect(joined(saved[i])).toEqual(f.data)
    // The sender has nothing more to hear; the shell prompt ends it.
    expect([...(sender.feed(new Uint8Array([0x24])) ?? [])]).toEqual([0x24])
    expect((await sender.result).state).toBe('done')
    expect(toTerminal).toEqual([])
  })

  it('recovers from damaged data', async () => {
    const f = file('big', 200_000)
    const { receiver, saved } = link([f], (bytes, n) => {
      if (n !== 3 && n !== 6) return bytes
      const copy = bytes.slice()
      copy[copy.length >> 1] ^= 0x55
      return copy
    })
    expect((await receiver.result).state).toBe('done')
    expect(joined(saved[0])).toEqual(f.data)
  })

  it('deletes a partial file when the sender cancels', async () => {
    const f = file('big', 300_000)
    let cancelled = false
    const { receiver, saved } = link([f], (bytes, n) => {
      if (n < 4) return bytes
      if (!cancelled) {
        cancelled = true
        return new Uint8Array([0x18, 0x18, 0x18, 0x18, 0x18, 0x18, 0x08])
      }
      return new Uint8Array()
    })
    const got = await receiver.result
    expect(got.state).toBe('cancelled')
    await receiver.settled()
    expect(saved[0].kept).toBe(false)
  })
})

describe('cancel tails', () => {
  const host: ZmodemHost = {
    write: async () => {},
    prepare: async () => true,
    open: async () => null,
    pick: async () => null,
    onProgress: () => {},
  }
  const bytes = (...parts: (string | number[])[]) =>
    new Uint8Array(
      parts.flatMap((p) => (typeof p === 'string' ? [...p].map((c) => c.charCodeAt(0)) : p)),
    )
  const cans = [...Array(10).fill(0x18), ...Array(10).fill(0x08)]
  const rinit = () => new Encoder().hex(Frame.RINIT, posBytes(0))

  it('gives the prompt back once rz answers our cancel', async () => {
    const s = new Sender(host)
    expect(s.feed(rinit())).toBeNull()
    s.cancel()
    expect(s.feed(bytes(cans, cans))).toBeNull()
    const rest = s.feed(bytes(cans, 'RZ_EXIT=128\r\n$ '))
    expect(new TextDecoder().decode(rest ?? new Uint8Array())).toBe('RZ_EXIT=128\r\n$ ')
    expect((await s.result).state).toBe('cancelled')
  })

  it('gives the prompt back when rz exits without a cancel tail', async () => {
    const s = new Sender(host)
    expect(s.feed(rinit())).toBeNull()
    s.cancel()
    const rpos = new Encoder().hex(Frame.RPOS, posBytes(4096))
    const rest = s.feed(bytes([...rpos], [...rpos], 'RZ_EXIT=128\r\n$ '))
    expect(new TextDecoder().decode(rest ?? new Uint8Array())).toBe('RZ_EXIT=128\r\n$ ')
    expect((await s.result).state).toBe('cancelled')
  })

  it('keeps swallowing after damaged data until the remote goes quiet', async () => {
    const r = new Receiver(host)
    expect(r.feed(new Encoder().hex(Frame.RQINIT, posBytes(0)))).toBeNull()
    r.cancel()
    const broken = new Encoder().hex(Frame.RPOS, posBytes(1))
    broken[8] ^= 0x01
    expect(r.feed(bytes([...broken], 'binary junk'))).toBeNull()
    expect((await r.result).state).toBe('cancelled')
  })

  it('skips a remote cancel tail split across chunks', async () => {
    const s = new Sender(host)
    expect(s.feed(rinit())).toBeNull()
    expect(s.feed(bytes(cans.slice(0, 12)))).toBeNull()
    const rest = s.feed(bytes(cans.slice(12), '$ '))
    expect(new TextDecoder().decode(rest ?? new Uint8Array())).toBe('$ ')
    expect(await s.result).toMatchObject({ state: 'cancelled', message: '对方取消了传输' })
  })
})

describe('false starts', () => {
  it('hands the bytes back when no valid header follows', () => {
    const r = new Receiver({
      write: async () => {},
      prepare: async () => true,
      open: async () => null,
      pick: async () => null,
      onProgress: () => {},
    })
    const text = new TextEncoder().encode('**\x18B00zz not zmodem')
    expect(r.feed(text)).toEqual(text)
    expect(r.ended).toBe(true)
  })
})

describe('shellSuffix', () => {
  const enc = (s: string) => new TextEncoder().encode(s)
  const text = (u: Uint8Array) => new TextDecoder().decode(u)

  it('finds the prompt after binary data cut mid-subpacket', () => {
    const data = new Uint8Array([
      0x41,
      0x18,
      0x6b,
      0x8f,
      0xc2,
      0xab,
      0xdd,
      ...enc('SZ_EXIT=128\r\n路径$ '),
    ])
    expect(text(shellSuffix(data))).toBe('SZ_EXIT=128\r\n路径$ ')
  })

  it('finds nothing when the data just stops', () => {
    expect(shellSuffix(new Uint8Array([0x18, 0x41, 0x99, 0x18, 0x6b, 0xff]))).toHaveLength(0)
  })
})

describe('receiver cancelled mid-subpacket', () => {
  it('recovers the shell text once the remote goes quiet', async () => {
    const r = new Receiver({
      write: async () => {},
      prepare: async () => true,
      open: async () => null,
      pick: async () => null,
      onProgress: () => {},
    })
    const e = new Encoder()
    expect(r.feed(e.hex(Frame.RQINIT, posBytes(0)))).toBeNull()
    expect(r.feed(e.binary(Frame.DATA, posBytes(0)))).toBeNull()
    r.cancel()
    const tail = new TextEncoder().encode('SZ_EXIT=128\r\n$ ')
    expect(r.feed(new Uint8Array([0x80, 0x18, 0x50, 0x9a, ...tail]))).toBeNull()
    const got = await r.result
    expect(got.state).toBe('cancelled')
    expect(new TextDecoder().decode(got.rest)).toBe('SZ_EXIT=128\r\n$ ')
  })
})

describe('parseFileInfo', () => {
  it('reads name, size, octal mtime and files left', () => {
    const info = new TextEncoder().encode('my file.txt\x00123 14537335140 100644 0 3 9999\x00')
    expect(parseFileInfo(info)).toEqual({
      name: 'my file.txt',
      size: 123,
      mtime: 0o14537335140,
      filesLeft: 3,
    })
  })
})
