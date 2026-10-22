import { ensureSyntaxTree } from '@codemirror/language'
import { type Diagnostic, linter, lintGutter } from '@codemirror/lint'
import type { EditorState, Extension } from '@codemirror/state'
import { type LanguageId, languageId } from './editor-languages'
import { ltr, messages } from './i18n'

// Code in a message ({ch}, {close}, {snippet}, {tag}) goes through `ltr`, so brackets keep their
// direction in right-to-left text.
const t = messages({
  unclosedTemplate: {
    zh: '模板字符串没有结束，缺少“`”',
    en: 'Unterminated template string, missing “`”',
    ug: 'قېلىپ تىزمىسى ئاخىرلاشمىغان، «`» كەم',
  },
  unclosedComment: {
    zh: '注释没有结束，缺少“{close}”',
    en: 'Unterminated comment, missing “{close}”',
    ug: 'ئىزاھات ئاخىرلاشمىغان، «{close}» كەم',
  },
  unclosedString: {
    zh: '字符串没有结束，缺少“{close}”',
    en: 'Unterminated string, missing “{close}”',
    ug: 'ھەرپ تىزمىسى ئاخىرلاشمىغان، «{close}» كەم',
  },
  strayCloser: {
    zh: '多余的“{ch}”，前面没有对应的“{open}”',
    en: 'Unexpected “{ch}” with no matching “{open}” before it',
    ug: 'ئارتۇق «{ch}»، ئالدىدا ماس كېلىدىغان «{open}» يوق',
  },
  unclosed: {
    zh: '“{ch}”没有闭合，缺少“{close}”',
    en: '“{ch}” is not closed, missing “{close}”',
    ug: '«{ch}» يېپىلمىغان، «{close}» كەم',
  },
  unclosedByIndent: {
    zh: '“{ch}”没有闭合，缺少“{close}”（第 {line} 行的“{close}”按缩进看属于外层）',
    en: '“{ch}” is not closed, missing “{close}” (by its indentation, the “{close}” on line {line} belongs to an outer block)',
    ug: '«{ch}» يېپىلمىغان، «{close}» كەم ({line}-قۇردىكى «{close}» كەڭلىكىگە قارىغاندا سىرتقى قاتلامغا تەۋە)',
  },
  unclosedInterpolation: {
    zh: '模板字符串里的“{open}”没有闭合，缺少“{close}”',
    en: '“{open}” in a template string is not closed, missing “{close}”',
    ug: 'قېلىپ تىزمىسىدىكى «{open}» يېپىلمىغان، «{close}» كەم',
  },
  jsonIncomplete: {
    zh: '内容不完整，可能缺少括号或引号',
    en: 'Incomplete content; a bracket or quote may be missing',
    ug: 'مەزمۇن تولۇق ئەمەس، تىرناق ياكى نەقىل بەلگىسى كەم بولۇشى مۇمكىن',
  },
  jsonPropertyName: {
    zh: '这里应该是用双引号括起的属性名（是否多了一个逗号？）',
    en: 'Expected a property name in double quotes here (is there an extra comma?)',
    ug: 'بۇ يەردە قوش نەقىل بەلگىسى ئىچىدىكى خاسلىق ئاتى بولۇشى كېرەك (پەش ئارتۇق بولۇپ قالدىمۇ؟)',
  },
  jsonAfterValue: {
    zh: '属性值后面缺少“,”或“{close}”',
    en: 'Missing “,” or “{close}” after a property value',
    ug: 'خاسلىق قىممىتىدىن كېيىن «,» ياكى «{close}» كەم',
  },
  jsonAfterElement: {
    zh: '数组元素后面缺少“,”或“{close}”',
    en: 'Missing “,” or “{close}” after an array element',
    ug: 'تىزىلما ئېلېمېنتىدىن كېيىن «,» ياكى «{close}» كەم',
  },
  jsonAfterName: {
    zh: '属性名后面缺少“:”',
    en: 'Missing “:” after a property name',
    ug: 'خاسلىق ئاتىدىن كېيىن «:» كەم',
  },
  jsonUnterminated: {
    zh: '字符串没有结束',
    en: 'Unterminated string',
    ug: 'ھەرپ تىزمىسى ئاخىرلاشمىغان',
  },
  jsonControl: {
    zh: '字符串里有未转义的控制字符（例如换行或制表符）',
    en: 'Unescaped control character in a string (such as a line break or tab)',
    ug: 'ھەرپ تىزمىسىدا قېچىلمىغان كونترول ھەرپى بار (مەسىلەن قۇر ئالماشتۇرۇش ياكى جەدۋەل بەلگىسى)',
  },
  jsonEscape: {
    zh: '字符串里有无效的转义',
    en: 'Invalid escape in a string',
    ug: 'ھەرپ تىزمىسىدا ئىناۋەتسىز قېچىش بار',
  },
  jsonTrailing: {
    zh: 'JSON 结束后还有多余的内容',
    en: 'Extra content after the JSON',
    ug: 'JSON ئاخىرلاشقاندىن كېيىن ئارتۇق مەزمۇن بار',
  },
  jsonNumber: { zh: '数字格式不对', en: 'Invalid number', ug: 'سان شەكلى خاتا' },
  jsonUnexpected: {
    zh: '这里不应出现“{ch}”',
    en: 'Unexpected “{ch}” here',
    ug: 'بۇ يەردە «{ch}» بولماسلىقى كېرەك',
  },
  jsonError: {
    zh: 'JSON 格式错误：{detail}',
    en: 'Invalid JSON: {detail}',
    ug: 'JSON فورماتى خاتا: {detail}',
  },
  syntaxEnd: {
    zh: '语法错误：文件意外结束，可能缺少括号、引号或语句的后半部分',
    en: 'Syntax error: unexpected end of file; a bracket, a quote or the rest of a statement may be missing',
    ug: 'گرامماتىكا خاتالىقى: ھۆججەت كۈتۈلمىگەن يەردە ئاخىرلاشتى، تىرناق، نەقىل بەلگىسى ياكى جۈملىنىڭ قالغان قىسمى كەم بولۇشى مۇمكىن',
  },
  syntaxUnexpected: {
    zh: '语法错误：这里不应出现“{snippet}”',
    en: 'Syntax error: unexpected “{snippet}”',
    ug: 'گرامماتىكا خاتالىقى: بۇ يەردە «{snippet}» بولماسلىقى كېرەك',
  },
  syntaxMissing: {
    zh: '语法错误：这里缺少内容',
    en: 'Syntax error: something is missing here',
    ug: 'گرامماتىكا خاتالىقى: بۇ يەردە مەزمۇن كەم',
  },
  strayCloseTag: {
    zh: '结束标签“{tag}”没有对应的开始标签',
    en: 'Closing tag “{tag}” has no matching opening tag',
    ug: '«{tag}» ئاخىرلىشىش خەتكۈچىنىڭ ماس باشلىنىش خەتكۈچى يوق',
  },
  unclosedTag: {
    zh: '标签 {open} 没有闭合，缺少 {close}',
    en: 'Tag {open} is not closed, missing {close}',
    ug: '{open} خەتكۈچى يېپىلمىغان، {close} كەم',
  },
})

export interface Problem {
  from: number
  to: number
  severity: 'error' | 'warning'
  message: string
}

/** What a bracket scan must skip: comments and strings, whose brackets do not count. */
interface Syntax {
  line?: readonly string[]
  block?: readonly (readonly [string, string])[]
  /** Quotes whose strings end at the line break. */
  quotes: string
  /** Quotes whose strings may span lines. */
  multiline?: string
  /** No backslash escapes in any string. */
  raw?: boolean
  /** Python and TOML `"""…"""`. */
  triple?: boolean
  /** JavaScript `${…}` inside backtick strings. */
  template?: boolean
  regex?: boolean
  /** Rust: `'a'` is a char, a lone `'a` a lifetime. */
  charLiteral?: boolean
  /** SCSS/Less: `//` right after `:` is a URL, not a comment. */
  urlColon?: boolean
}

const C_COMMENTS = { line: ['//'], block: [['/*', '*/']] } as const
const C_LIKE: Syntax = { ...C_COMMENTS, quotes: `'"` }
const JS: Syntax = { ...C_COMMENTS, quotes: `'"`, multiline: '`', template: true, regex: true }
const CSS_LIKE: Syntax = { ...C_COMMENTS, quotes: `'"`, urlColon: true }

const SYNTAX: Partial<Record<LanguageId, Syntax>> = {
  javascript: JS,
  typescript: JS,
  json: { ...C_COMMENTS, quotes: '"' },
  css: { block: [['/*', '*/']], quotes: `'"` },
  scss: CSS_LIKE,
  less: CSS_LIKE,
  c: C_LIKE,
  cpp: C_LIKE,
  java: C_LIKE,
  go: { ...C_COMMENTS, quotes: `'"`, multiline: '`' },
  rust: { ...C_COMMENTS, quotes: '"', charLiteral: true },
  python: { line: ['#'], quotes: `'"`, triple: true },
  toml: { line: ['#'], quotes: `'"`, triple: true },
  lua: { line: ['--'], block: [['--[[', ']]']], quotes: `'"` },
  nginx: { line: ['#'], quotes: `'"` },
  sql: { line: ['--'], block: [['/*', '*/']], quotes: '', multiline: `'"\``, raw: true },
}

const CLOSE_OF: Record<string, string> = { '(': ')', '[': ']', '{': '}' }
const OPEN_OF: Record<string, string> = { ')': '(', ']': '[', '}': '{' }
const REGEX_AFTER = new Set('(,=:[!&|?{};+-*%<>~^'.split(''))
const REGEX_WORDS = new Set([
  'return',
  'typeof',
  'instanceof',
  'case',
  'do',
  'else',
  'in',
  'of',
  'new',
  'delete',
  'void',
  'throw',
  'yield',
  'await',
])
const MAX_PROBLEMS = 100

interface Open {
  ch: string
  pos: number
  /** Opened by `${` inside a template string. */
  template?: boolean
}

type StringEnd = { end: number; state: 'closed' | 'open' | 'interp' }

function scanString(
  text: string,
  from: number,
  close: string,
  multiline: boolean,
  syntax: Syntax,
  template: boolean,
): StringEnd {
  let j = from
  while (j < text.length) {
    const ch = text[j]
    if (ch === '\\' && !syntax.raw) {
      j += 2
      continue
    }
    if (text.startsWith(close, j)) return { end: j + close.length, state: 'closed' }
    if (template && ch === '$' && text[j + 1] === '{') return { end: j + 2, state: 'interp' }
    if (ch === '\n' && !multiline) return { end: j, state: 'open' }
    j++
  }
  return { end: j, state: 'open' }
}

/** Index just past a regex literal starting after `/`, or -1 when this `/` is a division. */
function scanRegex(text: string, from: number): number {
  let inClass = false
  for (let j = from; j < text.length; j++) {
    const ch = text[j]
    if (ch === '\n') return -1
    if (ch === '\\') j++
    else if (ch === '[') inClass = true
    else if (ch === ']') inClass = false
    else if (ch === '/' && !inClass) {
      let k = j + 1
      while (k < text.length && /[a-z]/i.test(text[k])) k++
      return k
    }
  }
  return -1
}

function lineIndent(text: string, pos: number): { indent: number; first: boolean } {
  const start = text.lastIndexOf('\n', pos - 1) + 1
  let indent = 0
  let j = start
  for (; j < pos && (text[j] === ' ' || text[j] === '\t'); j++) indent += text[j] === '\t' ? 4 : 1
  return { indent, first: j === pos }
}

const lineOf = (text: string, pos: number) => {
  let n = 1
  for (let i = text.indexOf('\n'); i >= 0 && i < pos; i = text.indexOf('\n', i + 1)) n++
  return n
}

const unclosed = (ch: string) => t('unclosed', { ch: ltr(ch), close: ltr(CLOSE_OF[ch]) })

export interface BracketScan {
  problems: Problem[]
  /** The text had comments; JSON with comments is JSONC and skips the strict parse. */
  comments: boolean
}

/** Unbalanced brackets, unterminated strings and comments, with comments and strings skipped. */
export function checkBrackets(text: string, syntax: Syntax): BracketScan {
  const problems: Problem[] = []
  const stack: Open[] = []
  const pairs: [number, number][] = []
  const lineComments = syntax.line ?? []
  const blocks = syntax.block ?? []
  let comments = false
  let last = ''
  let lastWord = ''
  let i = 0
  const report = (from: number, to: number, message: string) => {
    if (problems.length < MAX_PROBLEMS) problems.push({ from, to, severity: 'error', message })
  }
  // Continues a template string after `}` closes one of its `${`.
  const resumeTemplate = (from: number, quotePos: number): number => {
    const r = scanString(text, from, '`', true, syntax, true)
    if (r.state === 'interp') stack.push({ ch: '{', pos: r.end - 1, template: true })
    else if (r.state === 'open') report(quotePos, quotePos + 1, t('unclosedTemplate'))
    return r.end
  }
  const templateStart = new Map<number, number>()

  while (i < text.length) {
    const c = text[i]
    const block = blocks.find(([open]) => text.startsWith(open, i))
    if (block) {
      comments = true
      const end = text.indexOf(block[1], i + block[0].length)
      if (end < 0) {
        report(i, i + block[0].length, t('unclosedComment', { close: ltr(block[1]) }))
        break
      }
      i = end + block[1].length
      continue
    }
    if (
      lineComments.some((l) => text.startsWith(l, i)) &&
      !(syntax.urlColon && text[i - 1] === ':')
    ) {
      comments = true
      const end = text.indexOf('\n', i)
      i = end < 0 ? text.length : end
      continue
    }
    if (syntax.charLiteral && c === "'") {
      const m = /'(?:\\.[^'\n]{0,8}|[^\\'\n])'/y
      m.lastIndex = i
      if (m.test(text)) {
        i = m.lastIndex
        last = 'a'
        continue
      }
      i++
      continue
    }
    const multiline = syntax.multiline?.includes(c) ?? false
    if (syntax.quotes.includes(c) || multiline) {
      const triple = syntax.triple === true && text.startsWith(c.repeat(3), i)
      const close = triple ? c.repeat(3) : c
      const template = syntax.template === true && c === '`'
      const r = scanString(text, i + close.length, close, multiline || triple, syntax, template)
      if (r.state === 'open') {
        report(i, i + close.length, t('unclosedString', { close: ltr(close) }))
      } else if (r.state === 'interp') {
        stack.push({ ch: '{', pos: r.end - 1, template: true })
        templateStart.set(r.end - 1, i)
      }
      i = r.end
      last = 'a'
      lastWord = ''
      continue
    }
    if (
      c === '/' &&
      syntax.regex &&
      (last === '' || REGEX_AFTER.has(last) || (last === 'a' && REGEX_WORDS.has(lastWord)))
    ) {
      const end = scanRegex(text, i + 1)
      if (end > 0) {
        i = end
        last = 'a'
        lastWord = ''
        continue
      }
    }
    if (c in CLOSE_OF) {
      stack.push({ ch: c, pos: i })
      last = c
      i++
      continue
    }
    if (c in OPEN_OF) {
      const want = OPEN_OF[c]
      let k = stack.length - 1
      while (k >= 0 && stack[k].ch !== want) k--
      last = c
      i++
      if (k < 0) {
        report(i - 1, i, t('strayCloser', { ch: ltr(c), open: ltr(want) }))
        continue
      }
      for (const o of stack.splice(k + 1)) report(o.pos, o.pos + 1, unclosed(o.ch))
      const o = stack.pop() as Open
      pairs.push([o.pos, i - 1])
      if (o.template) i = resumeTemplate(i, templateStart.get(o.pos) ?? o.pos)
      continue
    }
    if (/[\w$]/.test(c)) {
      let j = i + 1
      while (j < text.length && /[\w$]/.test(text[j])) j++
      lastWord = text.slice(i, j)
      last = 'a'
      i = j
      continue
    }
    if (c !== ' ' && c !== '\t' && c !== '\n' && c !== '\r') last = c
    i++
  }

  // An opener left at the end often belongs to an inner block that lost its closer; the closer
  // that matched it instead is indented for an outer block.
  const used = new Set<number>()
  for (const o of stack) {
    const at = lineIndent(text, o.pos).indent
    const suspect = pairs.find(([open, close]) => {
      if (open <= o.pos || used.has(open) || text[open] !== o.ch) return false
      const closer = lineIndent(text, close)
      return closer.first && closer.indent < lineIndent(text, open).indent && closer.indent >= at
    })
    if (suspect) {
      used.add(suspect[0])
      const line = lineOf(text, suspect[1])
      report(
        suspect[0],
        suspect[0] + 1,
        t('unclosedByIndent', { ch: ltr(o.ch), close: ltr(CLOSE_OF[o.ch]), line }),
      )
    } else if (o.template) {
      const open = ltr('${')
      report(o.pos - 1, o.pos + 1, t('unclosedInterpolation', { open, close: ltr('}') }))
    } else {
      report(o.pos, o.pos + 1, unclosed(o.ch))
    }
  }
  problems.sort((a, b) => a.from - b.from)
  return { problems, comments }
}

// The patterns match the English messages of the JavaScript engine's JSON.parse.
const JSON_MESSAGES: [RegExp, (m: RegExpExecArray) => string][] = [
  [/Unexpected end of JSON input/, () => t('jsonIncomplete')],
  [/Expected double-quoted property name/, () => t('jsonPropertyName')],
  [/Expected ',' or '}' after property value/, () => t('jsonAfterValue', { close: ltr('}') })],
  [/Expected ',' or ']' after array element/, () => t('jsonAfterElement', { close: ltr(']') })],
  [/Expected ':' after property name/, () => t('jsonAfterName')],
  [/Unterminated string/, () => t('jsonUnterminated')],
  [/Bad control character in string literal/, () => t('jsonControl')],
  [/Bad (?:Unicode )?escape/, () => t('jsonEscape')],
  [/Unexpected non-whitespace character after JSON/, () => t('jsonTrailing')],
  [
    /No number after minus sign|Exponent part is missing|Unterminated fractional number/,
    () => t('jsonNumber'),
  ],
  [/Unexpected token '?(.)'?/, (m) => t('jsonUnexpected', { ch: ltr(m[1]) })],
]

function describeJsonError(message: string): string {
  for (const [pattern, text] of JSON_MESSAGES) {
    const m = pattern.exec(message)
    if (m) return text(m)
  }
  return message.replace(/\s*in JSON at position.*$/, '')
}

/** The strict JSON.parse error, placed where the parser stopped. */
export function jsonProblem(text: string): Problem | null {
  if (!text.trim()) return null
  try {
    JSON.parse(text)
    return null
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const at = /at position (\d+)/.exec(message)
    const pos = Math.min(at ? Number(at[1]) : text.length, text.length)
    return {
      from: pos,
      to: Math.min(pos + 1, text.length),
      severity: 'error',
      message: t('jsonError', { detail: describeJsonError(message) }),
    }
  }
}

const VOID_TAGS = new Set(
  'area base br col embed hr img input link meta param source track wbr command keygen menuitem frame'.split(
    ' ',
  ),
)
// Elements HTML lets you leave open; the parser closes them implicitly.
const OPTIONAL_CLOSE = new Set(
  'p li dt dd option optgroup tr td th thead tbody tfoot colgroup caption rt rp rb rtc html head body'.split(
    ' ',
  ),
)
const TREE_LANGUAGES = new Set<LanguageId>(['javascript', 'typescript', 'css', 'html', 'xml'])

function syntaxError(state: EditorState, from: number, to: number): Problem {
  const { doc } = state
  if (from >= doc.length) {
    return {
      from: doc.length,
      to: doc.length,
      severity: 'error',
      message: t('syntaxEnd'),
    }
  }
  const line = doc.lineAt(from)
  const snippet = doc.sliceString(from, Math.min(to, line.to, from + 24)).trim()
  return {
    from,
    to: Math.max(Math.min(to, line.to), Math.min(from + 1, line.to)),
    severity: 'error',
    message: snippet ? t('syntaxUnexpected', { snippet: ltr(snippet) }) : t('syntaxMissing'),
  }
}

/** Parser error nodes, plus unclosed and stray tags in HTML and XML. */
export function treeProblems(state: EditorState, id: LanguageId): Problem[] {
  const tree = ensureSyntaxTree(state, state.doc.length, 400)
  if (!tree) return []
  const { doc } = state
  const markup = id === 'html' || id === 'xml'
  const out: Problem[] = []
  let lastErrorLine = -1
  tree.iterate({
    enter: (ref) => {
      if (out.length >= MAX_PROBLEMS) return false
      if (ref.type.isError) {
        // In markup an empty error node marks an implicitly closed tag, reported below.
        if (markup && ref.from === ref.to && ref.from < doc.length) return
        const line = doc.lineAt(Math.min(ref.from, doc.length)).number
        if (line !== lastErrorLine) {
          lastErrorLine = line
          out.push(syntaxError(state, ref.from, ref.to))
        }
        return
      }
      if (!markup) return
      if (ref.name === 'MismatchedCloseTag') {
        const text = doc.sliceString(ref.from, ref.to)
        out.push({
          from: ref.from,
          to: ref.to,
          severity: 'error',
          message: t('strayCloseTag', { tag: ltr(text) }),
        })
        return
      }
      if (ref.name !== 'Element') return
      const node = ref.node
      const open = node.firstChild
      if (open?.name !== 'OpenTag') return
      if (node.lastChild?.name === 'CloseTag') return
      const nameNode = open.getChild('TagName')
      const name = nameNode ? doc.sliceString(nameNode.from, nameNode.to) : ''
      if (
        id === 'html' &&
        (VOID_TAGS.has(name.toLowerCase()) || OPTIONAL_CLOSE.has(name.toLowerCase()))
      ) {
        return
      }
      out.push({
        from: open.from,
        to: open.to,
        severity: id === 'xml' ? 'error' : 'warning',
        message: t('unclosedTag', { open: ltr(`<${name}>`), close: ltr(`</${name}>`) }),
      })
    },
  })
  return out
}

/** Everything the checker finds for the editor's current language. */
export function findProblems(state: EditorState): Problem[] {
  const id = state.facet(languageId)
  if (!id) return []
  const syntax = SYNTAX[id]
  const scan = syntax ? checkBrackets(state.doc.toString(), syntax) : null
  // Parser errors after a bracket problem are mostly echoes of it.
  if (scan?.problems.length) return scan.problems
  if (id === 'json') {
    if (scan?.comments) return []
    const problem = jsonProblem(state.doc.toString())
    return problem ? [problem] : []
  }
  return TREE_LANGUAGES.has(id) ? treeProblems(state, id) : []
}

export function problemLinter(): Extension {
  return [
    linter((view): Diagnostic[] => findProblems(view.state), {
      delay: 500,
      needsRefresh: (update) =>
        update.startState.facet(languageId) !== update.state.facet(languageId),
    }),
    lintGutter(),
  ]
}
