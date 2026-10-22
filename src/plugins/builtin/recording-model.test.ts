import { describe, expect, it } from 'vitest'
import {
  capIdle,
  castName,
  EventBuffer,
  formatClock,
  indexAfter,
  parseCast,
  parseSize,
} from './recording-model'

describe('parseCast', () => {
  it('reads the header and output and resize events', () => {
    const text = [
      '{"version":2,"width":80,"height":24,"timestamp":1,"title":"web"}',
      '[0.5,"o","hi"]',
      '[1.0,"r","100x30"]',
      '[1.2,"i","secret"]',
      '[0.9,"o","late"]',
      '[2.0,"o","cut',
    ].join('\n')
    const cast = parseCast(text)
    expect(cast).toEqual({
      width: 80,
      height: 24,
      title: 'web',
      events: [
        [0.5, 'o', 'hi'],
        [1.0, 'r', '100x30'],
        [1.0, 'o', 'late'],
      ],
      duration: 1.0,
    })
  })

  it('refuses other formats', () => {
    expect(parseCast('not json')).toBeInstanceOf(Error)
    expect(parseCast('{"version":1,"width":80,"height":24}')).toBeInstanceOf(Error)
    expect(parseCast('{"version":2,"width":0,"height":24}')).toBeInstanceOf(Error)
  })
})

describe('timeline', () => {
  it('caps long pauses', () => {
    const events = capIdle(
      [
        [1, 'o', 'a'],
        [10, 'o', 'b'],
        [10.5, 'o', 'c'],
      ],
      2,
    )
    expect(events.map((e) => e[0])).toEqual([1, 3, 3.5])
  })

  it('finds the next event', () => {
    const events: [number, string, string][] = [
      [0, 'o', 'a'],
      [1, 'o', 'b'],
      [1, 'o', 'c'],
      [2, 'o', 'd'],
    ]
    expect(indexAfter(events, -1)).toBe(0)
    expect(indexAfter(events, 1)).toBe(3)
    expect(indexAfter(events, 5)).toBe(4)
  })

  it('parses sizes', () => {
    expect(parseSize('120x40')).toEqual({ cols: 120, rows: 40 })
    expect(parseSize('0x40')).toBeNull()
    expect(parseSize('big')).toBeNull()
  })
})

describe('EventBuffer', () => {
  it('times events from the start and merges output in the same millisecond', () => {
    let now = 1000
    const buffer = new EventBuffer(1000, () => now)
    buffer.push('o', 'a')
    buffer.push('o', 'b')
    now = 1500
    buffer.push('r', '80x24')
    buffer.push('o', '')
    now = 2250
    buffer.push('o', 'c')
    expect(buffer.take()).toEqual([
      [0, 'o', 'ab'],
      [0.5, 'r', '80x24'],
      [1.25, 'o', 'c'],
    ])
    expect(buffer.take()).toEqual([])
    expect(buffer.full).toBe(false)
    buffer.push('o', 'x'.repeat(1024 * 1024))
    expect(buffer.full).toBe(true)
  })
})

describe('names and clocks', () => {
  it('stamps the file name', () => {
    expect(castName('web01', new Date(2026, 9, 7, 9, 5, 3))).toBe('web01_20261007_090503')
    expect(castName(' ', new Date(2026, 0, 1, 0, 0, 0))).toBe('终端_20260101_000000')
  })

  it('formats clocks', () => {
    expect(formatClock(65.9)).toBe('1:05')
    expect(formatClock(3725)).toBe('1:02:05')
    expect(formatClock(-1)).toBe('0:00')
  })
})
