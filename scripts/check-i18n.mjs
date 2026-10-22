// Fails when Chinese text appears outside a translation: every user-facing string goes through
// `messages()` in src/i18n.ts, where Chinese sits under a `zh:` key next to `en:` and `ug:`.
//
//   node scripts/check-i18n.mjs              every source file
//   node scripts/check-i18n.mjs a.ts b.ts    just these (a folder means its source files)
//   node scripts/check-i18n.mjs --summary    count per file, largest first
//
// Allowed: comments, the value of a `zh:` property, `*.zh.ts` data files, and a line marked with
// `i18n-ignore` (on it or the line above) for text that is data rather than interface, such as a
// pattern matching Chinese program output.
//
// Rust (crates/gxs-core/src, src-tauri/src) writes its messages with `tr!("中文", "English",
// "ئۇيغۇرچە")` from crates/gxs-core/src/i18n.rs; the Chinese first text is allowed there, as are
// comments, `#[cfg(test)]` items and `i18n-ignore` lines.
//
// The installer (installer/src, installer/ui) follows the same rules: its Rust has a local `tr!`
// and its plain JavaScript a `{ key: { zh, en, ug } }` dictionary, checked like TypeScript.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const CJK = /[　-〿㐀-䶿一-鿿豈-﫿＀-￯]/
const SCAN = [
  'src',
  'index.html',
  'status-panel.html',
  'plugin-guide.html',
  'crates/gxs-core/src',
  'src-tauri/src',
  'installer/src',
  'installer/ui',
]

/** Source files the check reads; tests, type declarations and `*.zh.ts` data are left out. */
export function isChecked(path) {
  return /\.(ts|js|html|rs)$/.test(path) && !/\.test\.[tj]s$|\.d\.ts$|\.zh\.ts$/.test(path)
}

function walk(path, out) {
  if (statSync(path).isDirectory()) {
    for (const name of readdirSync(path)) walk(join(path, name), out)
  } else if (isChecked(path)) {
    out.push(path)
  }
  return out
}

/** Lines (1-based) with Chinese outside comments and `zh:` values. */
export function findTs(text) {
  const bad = new Set()
  const ignored = new Set()
  const lines = text.split('\n')
  lines.forEach((line, i) => {
    if (line.includes('i18n-ignore')) {
      ignored.add(i + 1)
      ignored.add(i + 2)
    }
  })
  let line = 1
  let depth = 0
  /** Depths at which a `zh:` value is open. */
  const allow = []
  /** `{` depths where a template `${` was opened, to return to the template on its `}`. */
  const templates = []
  let last = '' // last significant code character, for telling regex from division
  let word = ''
  let i = 0
  const flag = (ch) => {
    if (CJK.test(ch) && allow.length === 0 && !ignored.has(line)) bad.add(line)
  }
  const endWord = () => {
    if (!word) return
    const prevWord = word
    word = ''
    if (prevWord !== 'zh') return
    let j = i
    while (text[j] === ' ' || text[j] === '\t') j++
    if (text[j] === ':' && text[j + 1] !== ':') allow.push(depth)
  }
  const readString = (quote) => {
    i++
    while (i < text.length && text[i] !== quote) {
      if (text[i] === '\\') i++
      else if (text[i] === '\n') line++
      else flag(text[i])
      i++
    }
    i++
  }
  /** From just after a backtick (or a closing `}` of `${`), to the end of the template or `${`. */
  const readTemplate = () => {
    while (i < text.length) {
      const ch = text[i]
      if (ch === '\\') {
        i += 2
        continue
      }
      if (ch === '`') {
        i++
        last = 'a'
        return
      }
      if (ch === '$' && text[i + 1] === '{') {
        i += 2
        depth++
        templates.push(depth)
        last = '('
        return
      }
      if (ch === '\n') line++
      else flag(ch)
      i++
    }
  }
  while (i < text.length) {
    const ch = text[i]
    if (/[A-Za-z0-9_$]/.test(ch)) {
      word += ch
      last = 'a'
      i++
      continue
    }
    endWord()
    if (ch === '\n') {
      line++
      i++
      continue
    }
    if (ch === ' ' || ch === '\t' || ch === '\r') {
      i++
      continue
    }
    if (ch === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++
      continue
    }
    if (ch === '/' && text[i + 1] === '*') {
      i += 2
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) {
        if (text[i] === '\n') line++
        i++
      }
      i += 2
      continue
    }
    if (ch === "'" || ch === '"') {
      readString(ch)
      last = 'a'
      continue
    }
    if (ch === '`') {
      i++
      readTemplate()
      continue
    }
    if (ch === '/' && (last === '' || '(,=:[!&|?{};+-*%<>~^'.includes(last))) {
      // A regular expression literal.
      i++
      let cls = false
      while (i < text.length && text[i] !== '\n' && (cls || text[i] !== '/')) {
        if (text[i] === '\\') i++
        else if (text[i] === '[') cls = true
        else if (text[i] === ']') cls = false
        else flag(text[i])
        i++
      }
      i++
      last = 'a'
      continue
    }
    if (ch === '(' || ch === '[' || ch === '{') depth++
    if (ch === ')' || ch === ']' || ch === '}') {
      while (allow.length > 0 && allow.at(-1) >= depth) allow.pop()
      if (ch === '}' && templates.at(-1) === depth) {
        templates.pop()
        depth--
        i++
        readTemplate()
        continue
      }
      depth--
    }
    if (ch === ',' || ch === ';') {
      while (allow.length > 0 && allow.at(-1) >= depth) allow.pop()
    }
    flag(ch)
    last = ch
    i++
  }
  return [...bad].sort((a, b) => a - b)
}

/** Static HTML has no dictionary; its text is filled in from TypeScript. */
export function findHtml(text) {
  const bad = []
  const body = text.replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' '))
  body.split('\n').forEach((line, i) => {
    if (CJK.test(line) && !line.includes('i18n-ignore')) bad.push(i + 1)
  })
  return bad
}

/** `#[cfg(test)]` or `#[cfg(all(test, ...))]`, the start of an item that only tests compile. */
const RS_TEST_ATTR = /^#\[\s*cfg\s*\(\s*(?:all\s*\(\s*)?test\b[^\]]*\]/

/**
 * Lines (1-based) with Chinese in Rust code outside comments, `#[cfg(test)]` items and the first
 * (Chinese) text of a `tr!` call. `file` is only used to skip whole test files.
 */
export function findRs(text, file = '') {
  if (/(^|[\\/])tests?\.rs$|[\\/]tests[\\/]/.test(file)) return []
  const bad = new Set()
  const ignored = new Set()
  text.split('\n').forEach((line, i) => {
    if (line.includes('i18n-ignore')) {
      ignored.add(i + 1)
      ignored.add(i + 2)
    }
  })
  let line = 1
  let depth = 0
  let i = 0
  let word = ''
  /** The `#[cfg(test)]` item being skipped: its depth, and whether its body `{` has opened. */
  let testItem = null
  /** After `tr!(`: 'zh' while the next literal is the Chinese text, 'in' while reading `@in lang,`. */
  let trState = null
  let trDepth = 0
  /** The literal being read is the zh text of a `tr!`. */
  let allowed = false
  const flag = (ch) => {
    if (CJK.test(ch) && !allowed && testItem === null && !ignored.has(line)) bad.add(line)
  }
  /** One character of a literal body, counting lines. */
  const body = (ch) => {
    if (ch === '\n') line++
    else flag(ch)
  }
  /** Called when a literal starts: it is allowed when it is the zh text of a `tr!`. */
  const literal = () => {
    allowed = trState === 'zh' && depth === trDepth
    if (trState === 'zh') trState = null
  }
  const readQuoted = () => {
    // text[i] is the opening quote.
    i++
    while (i < text.length && text[i] !== '"') {
      if (text[i] === '\\') {
        i++
        if (text[i] === '\n') line++
      } else body(text[i])
      i++
    }
    i++
    allowed = false
  }
  const readRaw = (hashes) => {
    // text[i] is the first `#`, or the quote when there are none.
    i += hashes + 1
    const close = `"${'#'.repeat(hashes)}`
    while (i < text.length && !text.startsWith(close, i)) {
      body(text[i])
      i++
    }
    i += close.length
    allowed = false
  }
  const readComment = () => {
    // Nested block comment; text[i] is the `/` of `/*`.
    let nest = 0
    while (i < text.length) {
      if (text[i] === '/' && text[i + 1] === '*') {
        nest++
        i += 2
      } else if (text[i] === '*' && text[i + 1] === '/') {
        nest--
        i += 2
        if (nest === 0) return
      } else {
        if (text[i] === '\n') line++
        i++
      }
    }
  }
  /** `'x'`, `'\n'` and `b'x'` are characters; `'a` and `'static` are lifetimes or labels. */
  const readQuote = () => {
    if (text[i + 1] === '\\') {
      literal()
      i += 3
      while (i < text.length && text[i] !== "'" && text[i] !== '\n') i++
      i++
      allowed = false
      return
    }
    const cp = text.codePointAt(i + 1)
    const len = cp === undefined ? 0 : cp > 0xffff ? 2 : 1
    if (len > 0 && text[i + 1] !== '\n' && text[i + 1 + len] === "'") {
      literal()
      body(text.slice(i + 1, i + 1 + len))
      i += len + 2
      allowed = false
      return
    }
    i++
  }
  const closeItem = () => {
    if (testItem !== null && depth < testItem.depth) testItem = null
  }
  while (i < text.length) {
    const ch = text[i]
    if (/[A-Za-z0-9_]/.test(ch)) {
      word += ch
      i++
      continue
    }
    const prev = word
    word = ''
    if (ch === '"') {
      literal()
      if (/^(b|c)?r$/.test(prev)) readRaw(0)
      else readQuoted()
      continue
    }
    if (ch === '#' && /^(b|c)?r$/.test(prev)) {
      const m = /^#+(?=")/.exec(text.slice(i, i + 256))
      if (m) {
        literal()
        readRaw(m[0].length)
        continue
      }
    }
    if (ch === "'") {
      readQuote()
      continue
    }
    if (ch === '\n') {
      line++
      i++
      continue
    }
    if (ch === ' ' || ch === '\t' || ch === '\r') {
      i++
      continue
    }
    if (ch === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++
      continue
    }
    if (ch === '/' && text[i + 1] === '*') {
      readComment()
      continue
    }
    if (ch === '!' && prev === 'tr') {
      let j = i + 1
      while (/\s/.test(text[j] ?? '')) j++
      if ('([{'.includes(text[j] ?? 'x')) {
        for (; i < j; i++) if (text[i] === '\n') line++
        depth++
        trDepth = depth
        i++
        while (/\s/.test(text[i] ?? '')) {
          if (text[i] === '\n') line++
          i++
        }
        trState = text[i] === '@' ? 'in' : 'zh'
        continue
      }
    }
    if (ch === '#' && testItem === null) {
      const m = RS_TEST_ATTR.exec(text.slice(i, i + 256))
      if (m) {
        testItem = { depth, opened: false }
        i += m[0].length
        continue
      }
    }
    if (ch === '(' || ch === '[' || ch === '{') {
      if (ch === '{' && testItem !== null && depth === testItem.depth) testItem.opened = true
      depth++
    } else if (ch === ')' || ch === ']' || ch === '}') {
      depth--
      if (trState !== null && depth < trDepth) trState = null
      closeItem()
      if (ch === '}' && testItem?.opened && depth === testItem.depth) testItem = null
    } else if (ch === ',' || ch === ';') {
      if (trState === 'in' && ch === ',' && depth === trDepth) {
        trState = 'zh'
      } else if (trState === 'zh' && depth === trDepth) {
        trState = null
      }
      if (testItem !== null && !testItem.opened && depth === testItem.depth) testItem = null
    } else {
      flag(ch)
    }
    i++
  }
  return [...bad].sort((a, b) => a - b)
}

function check(file) {
  const text = readFileSync(file, 'utf8')
  if (file.endsWith('.html')) return findHtml(text)
  if (file.endsWith('.rs')) return findRs(text, file)
  return findTs(text)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  const summary = args.includes('--summary')
  const named = args.filter((a) => !a.startsWith('--'))
  const files = (
    named.length > 0 ? named.map((p) => resolve(p)) : SCAN.map((p) => join(ROOT, p))
  ).flatMap((p) => (statSync(p).isDirectory() ? walk(p, []) : [p]))
  const results = files
    .map((file) => ({ file: relative(ROOT, file).split(sep).join('/'), lines: check(file) }))
    .filter((r) => r.lines.length > 0)
  if (summary) {
    results.sort((a, b) => b.lines.length - a.lines.length)
    for (const r of results) console.log(`${String(r.lines.length).padStart(5)}  ${r.file}`)
    console.log(
      `${results.reduce((n, r) => n + r.lines.length, 0)} lines in ${results.length} files`,
    )
  } else {
    for (const r of results) {
      for (const n of r.lines) console.log(`${r.file}:${n}  untranslated Chinese text`)
    }
    if (results.length > 0) {
      console.log('Put user-facing text in messages() with zh, en and ug (see src/i18n.ts).')
      console.log('In Rust, use tr!(zh, en, ug) (see crates/gxs-core/src/i18n.rs).')
      process.exitCode = 1
    }
  }
}
