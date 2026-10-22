import { describe, expect, it } from 'vitest'
import { fontStack, MAX_RECENT_PATHS, rememberPath, validFontName } from './settings-model'

describe('rememberPath', () => {
  it('puts the path first and drops a case-insensitive duplicate', () => {
    expect(rememberPath(['D:\\a', 'D:\\b'], 'd:\\B')).toEqual(['d:\\B', 'D:\\a'])
  })

  it('ignores blank paths', () => {
    expect(rememberPath(['D:\\a'], '  ')).toEqual(['D:\\a'])
  })

  it('keeps at most MAX_RECENT_PATHS entries', () => {
    const list = Array.from({ length: MAX_RECENT_PATHS }, (_, i) => `D:\\${i}`)
    const next = rememberPath(list, 'D:\\new')
    expect(next).toHaveLength(MAX_RECENT_PATHS)
    expect(next[0]).toBe('D:\\new')
    expect(next).not.toContain(`D:\\${MAX_RECENT_PATHS - 1}`)
  })
})

describe('validFontName', () => {
  it('accepts ordinary and localized names', () => {
    expect(validFontName('Noto Sans SC')).toBe(true)
    expect(validFontName('微软雅黑')).toBe(true)
  })

  it('rejects characters that could break out of a CSS font list', () => {
    for (const bad of ['a"b', "a'b", 'a,b', 'a;b', 'a{b', 'a<b', 'a\\b', 'a\nb']) {
      expect(validFontName(bad)).toBe(false)
    }
    expect(validFontName('x'.repeat(101))).toBe(false)
  })
})

describe('fontStack', () => {
  it('quotes names in order, removes duplicates and ends with monospace', () => {
    expect(fontStack(['Noto Sans Mono', ''], ['noto sans mono', 'Folder Font'], ['Consolas'])).toBe(
      '"Noto Sans Mono", "Folder Font", "Consolas", monospace',
    )
  })

  it('skips invalid names', () => {
    expect(fontStack(['bad"; x', 'Ok'])).toBe('"Ok", monospace')
  })
})
