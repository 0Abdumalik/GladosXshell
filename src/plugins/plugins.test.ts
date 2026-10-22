import { afterEach, describe, expect, it } from 'vitest'
import type { Dispose } from './bag'
import { Bag } from './bag'
import { URL_PATTERN } from './builtin/log-highlight'
import { fuzzyFilter, fuzzyScore } from './fuzzy'
import { formatKey, matchesKey, parseKey } from './keys'
import {
  addKeybinding,
  commandForKey,
  commands,
  keyFor,
  menuItems,
  menus,
  panels,
  panelTitle,
  runCommand,
} from './registry'
import { themeTokensCss } from './theme-css'

const press = (key: string, code: string, mods: Partial<Record<string, boolean>> = {}) => ({
  key,
  code,
  ctrlKey: mods.ctrl ?? false,
  shiftKey: mods.shift ?? false,
  altKey: mods.alt ?? false,
  metaKey: mods.meta ?? false,
})

describe('keys', () => {
  it('parses chords', () => {
    expect(parseKey('Ctrl+Shift+P')).toEqual({
      ctrl: true,
      shift: true,
      alt: false,
      meta: false,
      key: 'KeyP',
    })
    expect(parseKey('ctrl+,')?.key).toBe(',')
    expect(parseKey('Ctrl++')?.key).toBe('+')
    expect(parseKey('Alt+F1')?.key).toBe('f1')
    expect(parseKey('Esc')?.key).toBe('escape')
  })

  it('rejects malformed chords', () => {
    expect(parseKey('')).toBeNull()
    expect(parseKey('Ctrl+')).toBeNull()
    expect(parseKey('Ctrl+Ctrl+P')).toBeNull()
    expect(parseKey('P+Ctrl')).toBeNull()
    expect(parseKey('Ctrl')).toBeNull()
  })

  it('matches letters by physical key and others by key', () => {
    const chord = parseKey('Ctrl+Shift+P')
    if (!chord) throw new Error('unparsed')
    expect(matchesKey(chord, press('P', 'KeyP', { ctrl: true, shift: true }))).toBe(true)
    // A non-Latin layout reports another key but the same code.
    expect(matchesKey(chord, press('з', 'KeyP', { ctrl: true, shift: true }))).toBe(true)
    expect(matchesKey(chord, press('P', 'KeyP', { ctrl: true }))).toBe(false)
    const comma = parseKey('Ctrl+,')
    if (!comma) throw new Error('unparsed')
    expect(matchesKey(comma, press(',', 'Comma', { ctrl: true }))).toBe(true)
  })

  it('formats for display', () => {
    const format = (text: string) => {
      const chord = parseKey(text)
      return chord ? formatKey(chord) : null
    }
    expect(format('ctrl+shift+p')).toBe('Ctrl+Shift+P')
    expect(format('alt+up')).toBe('Alt+ArrowUp')
    expect(format('ctrl+space')).toBe('Ctrl+Space')
    expect(format('f5')).toBe('F5')
  })
})

describe('fuzzy', () => {
  it('matches subsequences case-insensitively', () => {
    expect(fuzzyScore('opset', 'Open settings')).not.toBeNull()
    expect(fuzzyScore('xyz', 'Open settings')).toBeNull()
    expect(fuzzyScore('', 'anything')).toBe(0)
  })

  it('ranks adjacent and word-start hits first', () => {
    const items = ['Toggle terminal', 'Open settings', 'Settings sync']
    expect(fuzzyFilter(items, 'set', (s) => s)[0]).toBe('Settings sync')
    expect(fuzzyFilter(items, 'zzz', (s) => s)).toEqual([])
  })
})

describe('registry', () => {
  const disposers: Dispose[] = []
  const keep = (dispose: Dispose | null) => {
    if (dispose) disposers.push(dispose)
  }
  afterEach(() => {
    for (const dispose of disposers.splice(0).reverse()) dispose()
  })

  it('lets the later binding of a key win, skipping unavailable commands', () => {
    let ran = ''
    keep(commands.add({ id: 'a', title: 'A', run: () => (ran = 'a') }))
    keep(commands.add({ id: 'b', title: 'B', run: () => (ran = 'b'), enabled: () => false }))
    keep(addKeybinding('Ctrl+K', 'a'))
    keep(addKeybinding('Ctrl+K', 'b'))
    const event = press('k', 'KeyK', { ctrl: true })
    expect(commandForKey(event)).toBe('a')
    expect(keyFor('a')).toBe('Ctrl+K')
    expect(commandForKey(press('k', 'KeyK'))).toBeNull()
    return runCommand('a').then((ok) => {
      expect(ok).toBe(true)
      expect(ran).toBe('a')
    })
  })

  it('reports missing commands instead of throwing', async () => {
    expect(await runCommand('nope')).toBe(false)
  })

  it('removes contributions on dispose', () => {
    const dispose = commands.add({ id: 'gone', title: 'Gone', run: () => {} })
    dispose()
    dispose()
    expect(commands.list().some((c) => c.id === 'gone')).toBe(false)
  })

  it('joins menu contributions behind one separator', () => {
    const context = { command: 'ls', note: '' }
    expect(menuItems('commands/item', context)).toEqual([])
    keep(
      menus.add({
        where: 'commands/item',
        provider: () => ['separator', { label: 'One', action: () => {} }, 'separator'],
      }),
    )
    keep(
      menus.add({ where: 'tab/context', provider: () => [{ label: 'Other', action: () => {} }] }),
    )
    keep(
      menus.add({
        where: 'commands/item',
        provider: () => {
          throw new Error('broken provider')
        },
      }),
    )
    const items = menuItems('commands/item', context)
    expect(items.length).toBe(2)
    expect(items[0]).toBe('separator')
    expect(items[1]).toMatchObject({ label: 'One' })
  })

  it('titles panels from their plugin, then the built-in name, then the id', () => {
    expect(panelTitle('files')).toBe('文件')
    expect(panelTitle('x.y/z')).toBe('x.y/z')
    keep(
      panels.add({
        id: 'x.y/z',
        title: 'Zed',
        build: () => ({ element: null as never }) as never,
      }),
    )
    expect(panelTitle('x.y/z')).toBe('Zed')
  })

  it('notifies subscribers', () => {
    const bag = new Bag<number>()
    let calls = 0
    const unsubscribe = bag.subscribe(() => calls++)
    const dispose = bag.add(1)
    dispose()
    unsubscribe()
    bag.add(2)
    expect(calls).toBe(2)
  })
})

describe('theme tokens', () => {
  it('writes one rule per theme', () => {
    const css = themeTokensCss([
      { id: 'dark', name: 'Dark', tokens: { '--gx-accent': 'oklch(70% 0.12 160)' } },
      { id: 'light', name: 'Light' },
    ])
    expect(css).toBe(':root[data-theme="dark"] {\n  --gx-accent: oklch(70% 0.12 160);\n}')
  })

  it('drops unsafe ids, names and values', () => {
    const css = themeTokensCss([
      { id: 'bad"]', name: 'x', tokens: { '--gx-a': 'red' } },
      {
        id: 'ok',
        name: 'x',
        tokens: {
          color: 'red',
          '--gx-a': 'red;}body{display:none',
          '--gx-b': 'url(https://example.com/x.png)',
          '--gx-c': '\\75rl(x)',
          '--gx-d': '#123456',
        },
      },
    ])
    expect(css).toBe(':root[data-theme="ok"] {\n  --gx-d: #123456;\n}')
  })
})

describe('log highlight links', () => {
  it('leaves trailing punctuation out of URLs', () => {
    const find = (text: string) => text.match(URL_PATTERN)?.[0]
    expect(find('see https://example.com/a?b=1.')).toBe('https://example.com/a?b=1')
    expect(find('(http://host:8080/x)')).toBe('http://host:8080/x')
    expect(find('ftp://nope')).toBeUndefined()
  })
})
