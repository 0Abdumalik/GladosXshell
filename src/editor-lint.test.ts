import { EditorState } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { formatCode, looksMinified } from './editor-format'
import { type LanguageId, loadLanguage } from './editor-languages'
import { findProblems, jsonProblem } from './editor-lint'

async function problems(id: LanguageId, doc: string) {
  const state = EditorState.create({ doc, extensions: await loadLanguage(id) })
  return findProblems(state)
}

const messages = async (id: LanguageId, doc: string) =>
  (await problems(id, doc)).map((p) => p.message)

describe('bracket checks', () => {
  it('reports a missing closing brace at its opener', async () => {
    const doc = 'function f() {\n  if (x) {\n    return 1\n}\n'
    const found = await problems('javascript', doc)
    expect(found).toHaveLength(1)
    expect(found[0].message).toContain('“{”没有闭合')
    // The `}` on line 4 is indented for the function, so the inner `{` is the one left open.
    expect(found[0].from).toBe(doc.indexOf('{', doc.indexOf('if')))
    expect(found[0].message).toContain('第 4 行')
  })

  it('reports a missing parenthesis and a stray closer', async () => {
    expect(await messages('javascript', 'call(a, b\n')).toEqual(['“(”没有闭合，缺少“)”'])
    expect(await messages('javascript', 'a = 1)\n')).toEqual(['多余的“)”，前面没有对应的“(”'])
  })

  it('reports a closer that skips an inner opener', async () => {
    const found = await messages('javascript', 'f([1, 2)\n')
    expect(found).toEqual(['“[”没有闭合，缺少“]”'])
  })

  it('ignores brackets in strings, comments, templates and regexes', async () => {
    const doc = [
      'const a = "(" + \'[\'',
      '// )',
      '/* } */',
      // biome-ignore lint/suspicious/noTemplateCurlyInString: JavaScript source under test
      'const t = `x ${a + "}"} {`',
      'const r = /[)]/g.test(a)',
      'const d = a / 2 / 3',
      '',
    ].join('\n')
    expect(await problems('javascript', doc)).toEqual([])
  })

  it('reports unterminated strings and comments', async () => {
    expect(await messages('javascript', 'const s = "abc\nfoo()\n')).toEqual([
      '字符串没有结束，缺少“"”',
    ])
    expect(await messages('css', 'a { color: red } /* x')).toEqual(['注释没有结束，缺少“*/”'])
  })

  it('handles language-specific strings', async () => {
    expect(await problems('python', 's = """(\n"""\nprint(s)\n')).toEqual([])
    expect(await problems('rust', "fn f<'a>(x: &'a str) -> char { '(' }\n")).toEqual([])
    expect(await problems('scss', '.a { background: url(http://x/y.png); }\n')).toEqual([])
    expect(await messages('go', 'func f() {\n')).toEqual(['“{”没有闭合，缺少“}”'])
  })
})

describe('parser checks', () => {
  it('reports JavaScript syntax errors once per line', async () => {
    const found = await messages('javascript', 'const = 1\nlet ok = 2\n')
    expect(found).toHaveLength(1)
    expect(found[0]).toMatch(/^语法错误/)
  })

  it('reports unclosed and stray HTML tags', async () => {
    const found = await problems('html', '<div><span>x</div>\n<p>ok\n</section>\n')
    const text = found.map((p) => p.message)
    expect(text).toContain('标签 <span> 没有闭合，缺少 </span>')
    expect(text).toContain('结束标签“</section>”没有对应的开始标签')
    expect(text.some((m) => m.includes('<p>'))).toBe(false)
    expect(text.some((m) => m.startsWith('语法错误'))).toBe(false)
  })

  it('treats an unclosed XML tag as an error', async () => {
    const found = await problems('xml', '<a><b></a>')
    expect(found.some((p) => p.severity === 'error' && p.message.includes('<b>'))).toBe(true)
  })
})

describe('JSON checks', () => {
  it('accepts valid JSON and JSON with comments', async () => {
    expect(await problems('json', '{"a": [1, 2]}')).toEqual([])
    expect(await problems('json', '// settings\n{"a": 1,}\n')).toEqual([])
  })

  it('explains a trailing comma where the parser stopped', () => {
    const text = '{"a": 1,}'
    const p = jsonProblem(text)
    expect(p?.message).toMatch(/^JSON 格式错误/)
    expect(p?.from).toBeGreaterThan(0)
    expect(p?.from).toBeLessThanOrEqual(text.length)
  })

  it('reports a missing brace through the bracket scan', async () => {
    expect(await messages('json', '{"a": {"b": 1}\n')).toEqual(['“{”没有闭合，缺少“}”'])
  })
})

describe('formatting', () => {
  const opts = { indent: 2, tabSize: 2 }

  it('expands minified JavaScript', async () => {
    const out = await formatCode('function f(a){if(a){return 1}return 2}', 'javascript', opts)
    expect(out).toBe('function f(a) {\n  if (a) {\n    return 1\n  }\n  return 2\n}')
  })

  it('expands one-line HTML', async () => {
    const out = await formatCode('<div><p>a</p><p>b</p></div>', 'html', opts)
    expect(out.split('\n')).toEqual(['<div>', '  <p>a</p>', '  <p>b</p>', '</div>'])
  })

  it('pretty-prints JSON with tabs and keeps JSONC comments', async () => {
    expect(await formatCode('{"a":[1,2]}', 'json', { indent: 0, tabSize: 4 })).toBe(
      '{\n\t"a": [\n\t\t1,\n\t\t2\n\t]\n}',
    )
    const jsonc = await formatCode('{// c\n"a":1}', 'json', opts)
    expect(jsonc).toContain('// c')
  })

  it('formats CSS rules on their own lines', async () => {
    const out = await formatCode('a{color:red}b{margin:0}', 'css', opts)
    expect(out).toBe('a {\n  color: red\n}\n\nb {\n  margin: 0\n}')
  })

  it('spots minified bundles', () => {
    expect(looksMinified('x'.repeat(2000))).toBe(true)
    expect(looksMinified('short\n'.repeat(500))).toBe(false)
    expect(looksMinified('a'.repeat(300))).toBe(false)
  })
})

describe('markup endings', () => {
  it('still reports a tag cut off at the end of the file', async () => {
    const found = await messages('html', '<div class="a"')
    expect(found.some((m) => m.startsWith('语法错误'))).toBe(true)
  })
})
