import { describe, expect, it } from 'vitest'
import {
  describeScript,
  escapeSend,
  OutputMatcher,
  parseMacros,
  parseScript,
  recordingToScript,
} from './macros-model'

describe('parseScript', () => {
  it('turns each keyword into a step', () => {
    const steps = parseScript(
      ['# login', 'line  ls -l', 'send y\\r', 'wait 500', 'timeout 3', 'expect $ '].join('\n'),
    )
    expect(steps).toEqual([
      { kind: 'send', text: ' ls -l\r' },
      { kind: 'send', text: 'y\r' },
      { kind: 'wait', ms: 500 },
      { kind: 'expect', text: '$ ', timeoutMs: 3000 },
    ])
  })

  it('uses a ten second timeout until told otherwise', () => {
    expect(parseScript('expect ok')).toEqual([{ kind: 'expect', text: 'ok', timeoutMs: 10_000 }])
  })

  it('accepts a bare line as just Enter and upper-case keywords', () => {
    expect(parseScript('LINE')).toEqual([{ kind: 'send', text: '\r' }])
  })

  it('reports the line that is wrong', () => {
    expect(parseScript('line a\nsned b')).toMatchObject({ line: 2 })
    expect(parseScript('wait -1')).toMatchObject({ line: 1 })
    expect(parseScript('wait 1.5')).toMatchObject({ line: 1 })
    expect(parseScript('timeout 0')).toMatchObject({ line: 1 })
    expect(parseScript('expect   ')).toMatchObject({ line: 1 })
    expect(parseScript('send')).toMatchObject({ line: 1 })
  })

  it('refuses an empty script and too many steps', () => {
    expect(parseScript('# nothing\n\n')).toMatchObject({ line: 0 })
    expect(parseScript(Array(501).fill('wait 0').join('\n'))).toMatchObject({ line: 501 })
  })
})

describe('recordingToScript', () => {
  it('ends a step at Enter and turns long pauses into waits', () => {
    const keys = [
      { data: 'l', at: 0 },
      { data: 's', at: 100 },
      { data: '\r', at: 200 },
      { data: 'q', at: 2260 },
      { data: '\x03', at: 2300 },
    ]
    expect(recordingToScript(keys)).toBe(['line ls', 'wait 2100', 'send q\\x03'].join('\n'))
  })

  it('escapes control keys so the script parses back to the same input', () => {
    const typed = 'vi\r\x1b:wq\\\t\r'
    const script = recordingToScript([{ data: typed, at: 0 }])
    const steps = parseScript(script)
    expect(
      Array.isArray(steps) && steps.map((s) => (s.kind === 'send' ? s.text : '')).join(''),
    ).toBe(typed)
  })

  it('caps waits at a minute', () => {
    const script = recordingToScript([
      { data: 'a', at: 0 },
      { data: 'b', at: 600_000 },
    ])
    expect(script).toBe('send a\nwait 60000\nsend b')
  })
})

describe('escapeSend', () => {
  it('writes control characters as escapes', () => {
    expect(escapeSend('a\\b\r\n\t\x1b\x7f')).toBe('a\\\\b\\r\\n\\t\\e\\x7f')
  })
})

describe('OutputMatcher', () => {
  it('finds text across chunks and colour codes', () => {
    const m = new OutputMatcher()
    m.feed('pass')
    expect(m.take('password:')).toBe(false)
    m.feed('\x1b[1mword\x1b[0m:')
    expect(m.take('password:')).toBe(true)
  })

  it('consumes up to the match so the same prompt is not matched twice', () => {
    const m = new OutputMatcher()
    m.feed('$ ls\r\nfile\r\n$ ')
    expect(m.take('$ ')).toBe(true)
    expect(m.take('$ ')).toBe(true)
    expect(m.take('$ ')).toBe(false)
  })

  it('keeps a cut-off escape until the rest arrives', () => {
    const m = new OutputMatcher()
    m.feed('ok\x1b[3')
    expect(m.take('ok')).toBe(true)
    m.feed('1mdone')
    expect(m.take('done')).toBe(true)
    m.feed('x')
    expect(m.take('1m')).toBe(false)
  })
})

describe('parseMacros', () => {
  it('drops entries without an id and duplicates', () => {
    expect(
      parseMacros([
        { id: 'a', name: 'A', script: 'line x' },
        { id: 'a', name: 'B' },
        { name: 'no id' },
        'junk',
      ]),
    ).toEqual([{ id: 'a', name: 'A', script: 'line x' }])
    expect(parseMacros(null)).toEqual([])
  })
})

describe('describeScript', () => {
  it('summarises the steps', () => {
    expect(describeScript('line a\nexpect b\nwait 1')).toBe('3 步 · 发送 1 次 · 等待输出 1 次')
    expect(describeScript('bogus')).toBe('脚本有错误')
  })
})
