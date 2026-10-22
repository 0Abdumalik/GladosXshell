import { describe, expect, it } from 'vitest'
import {
  insertDeclaration,
  matchesFilter,
  SELECTOR_HOOKS,
  tokenGroup,
  variantSelector,
} from './settings-hooks-model'

describe('insertDeclaration', () => {
  it('creates a :root block in an empty sheet', () => {
    const { css, at } = insertDeclaration('', '--gx-accent: red;')
    expect(css).toBe(':root {\n  --gx-accent: red;\n}\n')
    expect(css.slice(0, at).endsWith('red;')).toBe(true)
  })

  it('adds to an existing :root block', () => {
    const { css, at } = insertDeclaration(
      ':root {\n  --gx-text: blue;\n}\n.a {}\n',
      '--gx-accent: red;',
    )
    expect(css).toBe(':root {\n  --gx-text: blue;\n  --gx-accent: red;\n}\n.a {}\n')
    expect(css.slice(0, at).endsWith('red;')).toBe(true)
  })

  it('handles a one-line :root block', () => {
    const { css } = insertDeclaration(':root { --gx-text: blue; }', '--gx-accent: red;')
    expect(css).toBe(':root { --gx-text: blue; \n  --gx-accent: red;\n}')
  })

  it('appends after other rules with a blank line', () => {
    const { css } = insertDeclaration('.a { color: red; }', '--gx-x: 1;')
    expect(css).toBe('.a { color: red; }\n\n:root {\n  --gx-x: 1;\n}\n')
  })
})

describe('hooks', () => {
  it('builds attribute selectors', () => {
    const region = SELECTOR_HOOKS.find((h) => h.base === '.gx-region')
    expect(region && variantSelector(region, 'left')).toBe('.gx-region[data-region="left"]')
    expect(variantSelector({ base: '.x', attr: 'data-a', desc: '' }, 'a"b')).toBe(
      '.x[data-a="a\\"b"]',
    )
  })

  it('every hook selector parses', () => {
    for (const hook of SELECTOR_HOOKS) expect(hook.base).toMatch(/^\.[a-z][a-z0-9-]*$/)
  })

  it('groups tokens by prefix', () => {
    expect(tokenGroup('--gx-surface-2')).toBe('背景层级')
    expect(tokenGroup('--gx-n-500')).toBe('基础色阶')
    expect(tokenGroup('--gx-whatever')).toBe('其他')
  })

  it('filters on every word', () => {
    expect(matchesFilter('gx region', '.gx-region', '停靠区域')).toBe(true)
    expect(matchesFilter('停靠 panel', '.gx-region', '停靠区域')).toBe(false)
    expect(matchesFilter('', 'anything')).toBe(true)
  })
})
