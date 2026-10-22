import { describe, expect, it } from 'vitest'
import {
  hasIcon,
  ICON_NAMES,
  iconMarkup,
  iconNames,
  parseIcon,
  registerIcon,
  resolveIcon,
  scopedIcon,
} from './icons'

describe('built-in icons', () => {
  it('loads every listed name and nothing else', () => {
    expect(iconNames()).toEqual([...ICON_NAMES].sort())
  })
})

describe('parseIcon', () => {
  it('keeps only viewBox and path data from SVG text', () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" onload="x()"><path d="M0 0L24 24Z" onclick="y()"/><script>z()</script></svg>'
    expect(parseIcon(svg)).toEqual({ paths: ['M0 0L24 24Z'], viewBox: '0 0 24 24', stroke: false })
  })

  it('reads outline SVGs as stroked', () => {
    const svg =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M1 1h4"/></svg>'
    expect(parseIcon(svg)?.stroke).toBe(true)
  })

  it('accepts bare path data and objects', () => {
    expect(parseIcon('M0 0h256v256Z')).toEqual({
      paths: ['M0 0h256v256Z'],
      viewBox: '0 0 256 256',
      stroke: false,
    })
    expect(parseIcon({ path: ['M0 0h1', 'M2 2h1'], viewBox: '0,0,16,16', stroke: true })).toEqual({
      paths: ['M0 0h1', 'M2 2h1'],
      viewBox: '0 0 16 16',
      stroke: true,
    })
  })

  it('rejects anything that is not plain path data', () => {
    expect(parseIcon('<script>alert(1)</script>')).toBeNull()
    expect(parseIcon('<svg><path d="url(#x)"/></svg>')).toBeNull()
    expect(parseIcon('M0 0" onload="x')).toBeNull()
    expect(parseIcon({ path: 'M0 0', viewBox: '0 0 24' })).toBeNull()
    expect(parseIcon({ path: 'M0 0', viewBox: 24 })).toBeNull()
    expect(parseIcon({ path: [1] })).toBeNull()
    expect(parseIcon({ path: [] })).toBeNull()
    expect(parseIcon(`M${'1 '.repeat(9000)}`)).toBeNull()
    expect(parseIcon({ path: Array(33).fill('M0 0') })).toBeNull()
    expect(parseIcon(42)).toBeNull()
  })
})

describe('plugin icons', () => {
  it('are scoped to their plugin and fall back to built-ins', () => {
    const dispose = registerIcon('demo.a', 'gear', 'M1 1h2Z')
    expect(resolveIcon(scopedIcon('demo.a', 'gear'))?.paths).toEqual(['M1 1h2Z'])
    expect(resolveIcon(scopedIcon('demo.b', 'gear'))).toBe(resolveIcon('gear'))
    expect(resolveIcon('gear')?.paths).not.toEqual(['M1 1h2Z'])
    expect(hasIcon(scopedIcon('demo.b', 'nope'))).toBe(false)
    dispose()
    expect(resolveIcon(scopedIcon('demo.a', 'gear'))).toBe(resolveIcon('gear'))
  })

  it('lists built-ins plus the scope’s own names', () => {
    const dispose = registerIcon('demo.a', 'zz-mine', 'M0 0Z')
    expect(iconNames('demo.a')).toContain('zz-mine')
    expect(iconNames('demo.b')).not.toContain('zz-mine')
    expect(iconNames()).not.toContain('zz-mine')
    dispose()
    expect(iconNames('demo.a')).not.toContain('zz-mine')
  })

  it('a replaced registration survives the old dispose', () => {
    const first = registerIcon('demo.a', 'dot', 'M0 0Z')
    registerIcon('demo.a', 'dot', 'M1 1Z')
    first()
    expect(resolveIcon(scopedIcon('demo.a', 'dot'))?.paths).toEqual(['M1 1Z'])
  })

  it('reject bad names and data', () => {
    expect(() => registerIcon('demo.a', 'Bad Name', 'M0 0Z')).toThrow()
    expect(() => registerIcon('demo.a', 'ok', '<script/>')).toThrow()
  })
})

describe('iconMarkup', () => {
  it('builds a currentColor SVG', () => {
    expect(iconMarkup({ paths: ['M0 0Z'], viewBox: '0 0 24 24', stroke: false })).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M0 0Z"/></svg>',
    )
  })
})
