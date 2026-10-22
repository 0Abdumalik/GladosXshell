import { describe, expect, it } from 'vitest'
import { isTerminalReport } from './terminal-reports'

describe('isTerminalReport', () => {
  it('recognises replies and mouse or focus reports', () => {
    for (const data of [
      '\x1b[1;1R',
      '\x1b[?12;40R',
      '\x1b[O',
      '\x1b[I',
      '\x1b[?1;2c',
      '\x1b[>0;276;0c',
      '\x1b[0n',
      '\x1b[?2004;1$y',
      '\x1b[8;24;80t',
      '\x1b[M #!',
      '\x1b[<0;10;5M\x1b[<0;10;5m',
      '\x1b]11;rgb:1e1e/1e1e/1e1e\x1b\\',
      '\x1b]10;rgb:cccc/cccc/cccc\x07',
      '\x1bP1$r0m\x1b\\',
    ])
      expect(isTerminalReport(data), JSON.stringify(data)).toBe(true)
  })

  it('leaves typed keys and pastes alone', () => {
    for (const data of [
      'ls\r',
      '\x1b[A',
      '\x1bOA',
      '\x1b[1;5A',
      '\x1b[15~',
      '\x1b[Z',
      '\x1b',
      '\x1b[200~text\x1b[201~',
      '\x1b[1;1Rx',
    ])
      expect(isTerminalReport(data), JSON.stringify(data)).toBe(false)
  })
})
