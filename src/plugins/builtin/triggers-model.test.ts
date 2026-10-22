import { describe, expect, it } from 'vitest'
import {
  type CompiledTrigger,
  compileRule,
  compileRules,
  FireGuard,
  hostGlobs,
  inScope,
  newRule,
  parseRules,
  type TriggerRule,
  unescapeSend,
} from './triggers-model'

const rule = (patch: Partial<TriggerRule>): TriggerRule => ({ ...newRule('r1'), ...patch })
const compiled = (patch: Partial<TriggerRule>) => compileRule(rule(patch)) as CompiledTrigger

describe('compileRule', () => {
  it('matches plain text literally and without case by default', () => {
    const c = compiled({ pattern: 'a.b (y/n)' })
    expect(c.pattern.test('A.B (Y/N)')).toBe(true)
    expect(c.pattern.test('axb (y/n)')).toBe(false)
  })

  it('honours regex and case sensitivity', () => {
    const c = compiled({ pattern: '^ERR\\d+', regex: true, caseSensitive: true })
    expect(c.pattern.test('ERR42 boom')).toBe(true)
    expect(c.pattern.test('err42')).toBe(false)
  })

  it('rejects bad, empty-matching and action-less rules', () => {
    expect(compileRule(rule({ pattern: '' }))).toMatchObject({ field: 'pattern' })
    expect(compileRule(rule({ pattern: '(', regex: true }))).toMatchObject({ field: 'pattern' })
    expect(compileRule(rule({ pattern: 'a*', regex: true }))).toMatchObject({ field: 'pattern' })
    expect(compileRule(rule({ pattern: 'x', color: null }))).toMatchObject({ field: 'actions' })
  })

  it('builds colours and input', () => {
    const fg = compiled({ pattern: 'x', color: 'red' })
    expect(fg.foreground).toBe('#d1495b')
    expect(fg.background).toBeUndefined()
    expect(fg.acts).toBe(false)
    const bg = compiled({ pattern: 'x', color: 'red', background: true })
    expect(bg.background).toBe('#d1495b')
    const send = compiled({ pattern: 'x', color: null, send: 'yes' })
    expect(send.input).toBe('yes\r')
    expect(send.acts).toBe(true)
    expect(compiled({ pattern: 'x', send: 'q', enter: false }).input).toBe('q')
  })

  it('skips disabled and broken rules in bulk', () => {
    const rules = [
      rule({ id: 'a', pattern: 'ok' }),
      rule({ id: 'b', pattern: 'off', enabled: false }),
      rule({ id: 'c', pattern: '[', regex: true }),
    ]
    expect(compileRules(rules).map((c) => c.rule.id)).toEqual(['a'])
  })
})

describe('scope', () => {
  it('matches every terminal when empty', () => {
    expect(inScope(hostGlobs(''), null)).toBe(true)
    expect(inScope(hostGlobs(' '), 'me@h')).toBe(true)
  })

  it('matches the target or the bare host', () => {
    const globs = hostGlobs('*.prod.example.com, 10.0.*，root@db')
    expect(inScope(globs, 'me@web1.prod.example.com:2222')).toBe(true)
    expect(inScope(globs, 'me@10.0.3.7')).toBe(true)
    expect(inScope(globs, 'root@DB')).toBe(true)
    expect(inScope(globs, 'me@db')).toBe(false)
    expect(inScope(globs, null)).toBe(false)
    expect(inScope(hostGlobs('::1'), 'me@[::1]:22')).toBe(true)
  })
})

describe('unescapeSend', () => {
  it('resolves the allowed escapes only', () => {
    expect(unescapeSend('a\\rb\\n\\t\\x03\\e\\\\\\q')).toBe('a\rb\n\t\x03\x1b\\\\q')
  })
})

describe('parseRules', () => {
  it('drops damaged and duplicate entries and unknown colours', () => {
    const out = parseRules([
      { id: 'a', pattern: 'x', color: 'pink', notify: true },
      { id: 'a', pattern: 'dup' },
      { id: 'b' },
      'junk',
    ])
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ id: 'a', color: null, notify: true, enabled: true })
    expect(parseRules({})).toEqual([])
  })
})

describe('FireGuard', () => {
  it('spaces firings and stops a runaway rule', () => {
    const guard = new FireGuard(1000, 3, 10_000)
    expect(guard.check('r', 0)).toBe('ok')
    expect(guard.check('r', 500)).toBe('wait')
    expect(guard.check('r', 1000)).toBe('ok')
    expect(guard.check('r', 2000)).toBe('ok')
    expect(guard.check('r', 3000)).toBe('stop')
    expect(guard.check('other', 3000)).toBe('ok')
    expect(guard.check('r', 13_500)).toBe('ok')
  })
})
