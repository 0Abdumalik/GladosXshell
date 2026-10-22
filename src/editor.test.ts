import { describe, expect, it } from 'vitest'
import { detectEol, encodingLabel } from './editor-encoding'
import { detectIndentUnit, leadingColumns } from './editor-indent'
import { languageFor } from './editor-languages'

describe('leadingColumns', () => {
  it('counts spaces and expands tabs to the next stop', () => {
    expect(leadingColumns('    x', 4)).toBe(4)
    expect(leadingColumns('\tx', 4)).toBe(4)
    expect(leadingColumns('  \tx', 4)).toBe(4)
    expect(leadingColumns('\t\tx', 2)).toBe(4)
    expect(leadingColumns('x', 4)).toBe(0)
  })

  it('treats blank lines as having no indent of their own', () => {
    expect(leadingColumns('', 4)).toBeNull()
    expect(leadingColumns('   ', 4)).toBeNull()
  })
})

describe('detectIndentUnit', () => {
  it('prefers tabs when most indented lines use them', () => {
    expect(detectIndentUnit('a {\n\tb\n\tc\n}\n', 4)).toBe('\t')
  })

  it('finds the most common space step', () => {
    const yaml = 'a:\n  b:\n    c: 1\n    d: 2\n  e: 3\nf: 4\n'
    expect(detectIndentUnit(yaml, 4)).toBe('  ')
    const py = 'def f():\n    if x:\n        return 1\n    return 2\n'
    expect(detectIndentUnit(py, 2)).toBe('    ')
  })

  it('falls back when nothing is indented', () => {
    expect(detectIndentUnit('one\ntwo\n', 3)).toBe('   ')
    expect(detectIndentUnit('', 4)).toBe('    ')
  })
})

describe('languageFor', () => {
  it('uses the extension first', () => {
    expect(languageFor('app.py', '/srv/app.py')).toBe('python')
    expect(languageFor('Config.YML', '/etc/Config.YML')).toBe('yaml')
    expect(languageFor('main.rs', '/src/main.rs')).toBe('rust')
  })

  it('knows special file names and nginx configs', () => {
    expect(languageFor('Dockerfile', '/app/Dockerfile')).toBe('dockerfile')
    expect(languageFor('Dockerfile.prod', '/app/Dockerfile.prod')).toBe('dockerfile')
    expect(languageFor('.bashrc', '/root/.bashrc')).toBe('shell')
    expect(languageFor('site.conf', '/etc/nginx/conf.d/site.conf')).toBe('nginx')
    expect(languageFor('app.conf', '/etc/app.conf')).toBe('properties')
  })

  it('falls back to the shebang line', () => {
    expect(languageFor('deploy', '/usr/local/bin/deploy', '#!/usr/bin/env bash\necho hi')).toBe(
      'shell',
    )
    expect(languageFor('tool', '/opt/tool', '#!/usr/bin/python3\n')).toBe('python')
    expect(languageFor('notes', '/root/notes', 'just text')).toBeNull()
  })
})

describe('detectEol', () => {
  it('keeps the line ending most lines use', () => {
    expect(detectEol('a\r\nb\r\nc\n')).toBe('\r\n')
    expect(detectEol('a\nb\r\nc\n')).toBe('\n')
    expect(detectEol('single line')).toBe('\n')
  })
})

describe('encodingLabel', () => {
  it('names the encoding and marks a UTF-8 BOM', () => {
    expect(encodingLabel({ encoding: 'utf-8', bom: false })).toBe('UTF-8')
    expect(encodingLabel({ encoding: 'utf-8', bom: true })).toBe('UTF-8 BOM')
    expect(encodingLabel({ encoding: 'gbk', bom: false })).toBe('GBK')
    expect(encodingLabel({ encoding: 'x-mac-roman', bom: false })).toBe('X-MAC-ROMAN')
  })
})
