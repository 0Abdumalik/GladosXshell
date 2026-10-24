#!/usr/bin/env node
// Extracts every translated message from Rust (tr!) and TypeScript (messages()) sources into
// standalone language pack files under locales/, one JSON file per language, CE style.
//
//   locales/zh.json   { "Saved": "保存", ... }   (built-in; bundled into the binary)
//   locales/ug.json   { "Saved": "ساقلاندى", ... }
//   locales/en.json   { "Saved": "Saved", ... }  (reference: the full key set)
//
// The English text is the key ("English text as key", like Cheat Engine .lng files), so a pack
// missing an entry falls back to English at run time.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = path.join(ROOT, 'locales')
const SRC = [
  path.join(ROOT, 'crates'),
  path.join(ROOT, 'src-tauri'),
  path.join(ROOT, 'installer'),
  path.join(ROOT, 'src'),
]
const EXT = new Set(['.rs', '.ts'])

// The built-in packs carry the app version so pack management can tell them apart.
const APP_VERSION =
  JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version ?? '0.1.1'

const META = {
  en: { code: 'en', name: 'English', nativeName: 'English', rtl: false, version: APP_VERSION },
  'zh-CN': {
    code: 'zh-CN',
    name: 'Chinese (Simplified)',
    nativeName: '简体中文',
    rtl: false,
    version: APP_VERSION,
  },
  ug: { code: 'ug', name: 'Uyghur', nativeName: 'ئۇيغۇرچە', rtl: true, version: APP_VERSION },
}

// ---------------------------------------------------------------------------
// Quoted string literal reader. Returns { value, end } for a '...' / "..." literal
// starting at i, or null. Handles \, \', \", \n etc. as raw backslash escapes.
// ---------------------------------------------------------------------------
function readString(src, i) {
  const quote = src[i]
  if (quote !== '"' && quote !== "'") return null
  let out = ''
  let j = i + 1
  while (j < src.length) {
    const c = src[j]
    if (c === '\\') {
      if (j + 1 >= src.length) return null
      const n = src[j + 1]
      switch (n) {
        case 'n':
          out += '\n'
          break
        case 't':
          out += '\t'
          break
        case 'r':
          out += '\r'
          break
        case '0':
          out += '\0'
          break
        default:
          out += n
      }
      j += 2
    } else if (c === quote) {
      return { value: out, end: j + 1 }
    } else {
      out += c
      j += 1
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// Rust: tr!(...) / tr!(@in lang, ...). First three string literals after the
// opening paren are zh, en, ug (the @in marker and lang expression are skipped).
// ---------------------------------------------------------------------------
function extractRust(text) {
  const entries = []
  const re = /\btr!\s*\(/g
  for (;;) {
    const m = re.exec(text)
    if (m === null) break
    const start = m.index + m[0].length
    let i = start
    // Skip an @in marker: tr!(@in lang, ...
    if (text.slice(i, i + 3) === '@in') {
      i += 3
      // skip the lang expression up to the first comma
      const comma = text.indexOf(',', i)
      if (comma === -1) continue
      i = comma + 1
    }
    const strings = []
    for (let k = 0; k < 3; k++) {
      // skip whitespace, commas and parens until the next quote
      while (i < text.length && !(text[i] === '"' || text[i] === "'")) {
        if (text[i] === '(' || text[i] === ')') {
          // reached the closing paren before three literals; bail
          break
        }
        i += 1
      }
      if (i >= text.length) break
      const s = readString(text, i)
      if (!s) break
      strings.push(s.value)
      i = s.end
    }
    if (strings.length === 3) entries.push({ zh: strings[0], en: strings[1], ug: strings[2] })
  }
  return entries
}

// ---------------------------------------------------------------------------
// TypeScript: messages({ key: { zh: ..., en: ..., ug: ... }, ... }). We find the
// messages( call, then scan balanced { } blocks for entries. en may be a function
// call such as pl('file'); then its first string argument becomes the pack key.
// ---------------------------------------------------------------------------
function extractTs(text) {
  const entries = []
  const re = /\bmessages\s*\(\s*\{/g
  for (;;) {
    const m = re.exec(text)
    if (m === null) break
    const start = m.index + m[0].length - 1 // position of the opening brace
    // find the matching closing brace
    let depth = 1
    let i = start + 1
    const end = (() => {
      while (i < text.length) {
        const c = text[i]
        if (c === '"' || c === "'") {
          const s = readString(text, i)
          i = s ? s.end : i + 1
          continue
        }
        if (c === '{') depth += 1
        else if (c === '}') {
          depth -= 1
          if (depth === 0) return i
        }
        i += 1
      }
      return -1
    })()
    if (end === -1) continue
    const block = text.slice(start + 1, end)
    // each entry: <key> : { ... zh: V, en: V, ug: V ... }
    const entryRe = /([A-Za-z_][\w]*)\s*:\s*\{[^}]*\}/g
    for (;;) {
      const e = entryRe.exec(block)
      if (e === null) break
      const key = e[1]
      const body = e[0]
      const field = (name) => {
        const fr = new RegExp(`\\b${name}\\s*:`)
        const fm = fr.exec(body)
        if (!fm) return null
        let j = fm.index + fm[0].length
        while (j < body.length && /\s/.test(body[j])) j += 1
        const s = readString(body, j)
        if (s) return { kind: 'string', value: s.value }
        // a function call like pl('file') or (p) => ...
        const call = body.slice(j).match(/^\w+\s*\(\s*([^)]*)\s*\)/)
        if (call) {
          const arg = readString(call[1].trim(), 0)
          return { kind: 'fn', value: arg ? arg.value : '' }
        }
        return { kind: 'fn', value: '' }
      }
      const zh = field('zh')
      const en = field('en')
      const ug = field('ug')
      if (!zh || !en || !ug) continue
      const packKey = en.kind === 'string' ? en.value : en.value || key
      entries.push({ key: packKey, zh: zh.value, en: en.value, ug: ug.value, dictKey: key })
    }
  }
  return entries
}

// ---------------------------------------------------------------------------
// Walk sources.
// ---------------------------------------------------------------------------
function walk(dir, out) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name)
    if (name === 'node_modules' || name === 'target' || name === '.git' || name === 'dist') continue
    const st = fs.statSync(full)
    if (st.isDirectory()) walk(full, out)
    else if (EXT.has(path.extname(full))) out.push(full)
  }
}

const files = []
for (const dir of SRC) if (fs.existsSync(dir)) walk(dir, files)

const rustFiles = files.filter((f) => f.endsWith('.rs'))
const tsFiles = files.filter((f) => f.endsWith('.ts'))

const rustEntries = []
for (const f of rustFiles) {
  try {
    rustEntries.push(...extractRust(fs.readFileSync(f, 'utf8')))
  } catch {
    /* ignore */
  }
}
const tsEntries = []
for (const f of tsFiles) {
  try {
    tsEntries.push(...extractTs(fs.readFileSync(f, 'utf8')))
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------------------
// Merge into packs. Later duplicate keys keep the first (source order stable).
// ---------------------------------------------------------------------------
function build(entries, field) {
  const map = new Map()
  for (const e of entries) {
    if (!map.has(e.en)) map.set(e.en, e[field])
  }
  return Object.fromEntries(map)
}

const packs = {
  en: build(rustEntries, 'en'),
  'zh-CN': build(rustEntries, 'zh'),
  ug: build(rustEntries, 'ug'),
}
// TS entries cover zh/ug only (their en is the key itself); merge into the same packs.
for (const [code, field] of [
  ['zh-CN', 'zh'],
  ['ug', 'ug'],
]) {
  const map = new Map(Object.entries(packs[code]))
  for (const e of tsEntries) {
    if (!map.has(e.en)) map.set(e.en, e[field])
  }
  packs[code] = Object.fromEntries(map)
}
// en reference pack: every key maps to itself.
{
  const map = new Map()
  for (const e of [...rustEntries, ...tsEntries]) map.set(e.en, e.en)
  packs.en = Object.fromEntries(map)
}

// ---------------------------------------------------------------------------
// Write files.
// ---------------------------------------------------------------------------
fs.mkdirSync(OUT_DIR, { recursive: true })
const written = []
for (const code of ['en', 'zh-CN', 'ug']) {
  const file = path.join(OUT_DIR, `${code}.json`)
  const doc = {
    meta: META[code],
    translations: Object.fromEntries(Object.entries(packs[code]).sort()),
  }
  fs.writeFileSync(file, `${JSON.stringify(doc, null, 2)}\n`)
  written.push({ file, count: Object.keys(packs[code]).length })
}

// report
const zhOnly = Object.keys(packs['zh-CN']).filter((k) => !(k in packs.ug)).length
const ugOnly = Object.keys(packs.ug).filter((k) => !(k in packs['zh-CN'])).length
console.log('Sources scanned:', files.length, 'files')
console.log('Rust tr! entries:', rustEntries.length, '| TS messages entries:', tsEntries.length)
console.log('Packs written:')
for (const w of written) console.log(`  ${path.relative(ROOT, w.file)}  (${w.count} keys)`)
if (zhOnly || ugOnly) console.log('Key-set mismatch (zh-only / ug-only):', zhOnly, '/', ugOnly)
