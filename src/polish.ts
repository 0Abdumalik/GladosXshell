import { extension } from './format'
import { messages, pl } from './i18n'

const t = messages({
  lineEndings: {
    zh: '换行统一为 LF',
    en: 'Converted line endings to LF',
    ug: 'قۇر ئاخىرى LF غا بىرلىككە كەلتۈرۈلدى',
  },
  jsonInvalid: {
    zh: '不是合法的 JSON，只整理了空白',
    en: 'Not valid JSON; tidied whitespace only',
    ug: 'ئىناۋەتلىك JSON ئەمەس، پەقەت بوشلۇقلارلا رەتلەندى',
  },
  jsonLossy: {
    zh: 'JSON 无法无损重排（大数字、重复键或转义写法），只整理了空白',
    en: "Can't reformat this JSON without changing it (large numbers, duplicate keys or escapes); tidied whitespace only",
    ug: 'JSON نى ئۆزگەرتمەي تۇرۇپ قايتا رەتلىگىلى بولمايدۇ (چوڭ سان، تەكرار ئاچقۇچ ياكى قېچىش بەلگىسى)، پەقەت بوشلۇقلارلا رەتلەندى',
  },
  jsonReformatted: { zh: '重新排版 JSON', en: 'Reformatted the JSON', ug: 'JSON قايتا رەتلەندى' },
  trailing: {
    zh: '去掉 {n} 行的行尾空白',
    en: (p) => `Removed trailing whitespace from ${pl('line')(p)}`,
    ug: '{n} قۇرنىڭ ئاخىرىدىكى بوشلۇق ئۆچۈرۈلدى',
  },
  finalNewline: {
    zh: '补上末尾换行',
    en: 'Added a final newline',
    ug: 'ئاخىرىغا قۇر ئالماشتۇرۇش بەلگىسى قوشۇلدى',
  },
  endBlank: {
    zh: '去掉末尾多余空行',
    en: 'Removed extra blank lines at the end',
    ug: 'ئاخىرىدىكى ئارتۇقچە بوش قۇرلار ئۆچۈرۈلدى',
  },
  collapsed: {
    zh: '合并连续空行（删掉 {n} 行）',
    en: (p) => `Collapsed runs of blank lines (removed ${pl('line')(p)})`,
    ug: 'ئۇدا كەلگەن بوش قۇرلار بىرلەشتۈرۈلدى ({n} قۇر ئۆچۈرۈلدى)',
  },
  blankOnly: {
    zh: '清空了只有空白的内容',
    en: 'Cleared text that was only whitespace',
    ug: 'پەقەت بوشلۇقتىنلا ئىبارەت مەزمۇن تازىلاندى',
  },
  prompt: {
    zh: '去掉行首的 $ 提示符',
    en: 'Removed the $ prompts at the start of lines',
    ug: 'قۇر بېشىدىكى $ ئەسكەرتىش بەلگىسى ئۆچۈرۈلدى',
  },
  continuation: {
    zh: '修复 {n} 处续行符 \\ 后多余的空格',
    en: (p) => `Removed stray spaces after the \\ continuation on ${pl('line')(p)}`,
    ug: '{n} يەردە \\ قۇر داۋاملاشتۇرۇش بەلگىسىدىن كېيىنكى ئارتۇقچە بوشلۇق ئۆچۈرۈلدى',
  },
  tabs: {
    zh: '制表符换成空格（终端里 Tab 会触发补全）',
    en: 'Replaced tabs with spaces (Tab triggers completion in a terminal)',
    ug: 'جەدۋەل بەلگىسى بوشلۇققا ئالماشتۇرۇلدى (تېرمىنالدا Tab تولۇقلاشنى قوزغىتىدۇ)',
  },
  typography: {
    zh: '替换从文档复制来的弯引号、长破折号和特殊空格',
    en: 'Replaced curly quotes, long dashes and special spaces copied from documents',
    ug: 'پۈتۈكتىن كۆچۈرۈلگەن ئەگرى تىرناق، ئۇزۇن سىزىقچە ۋە ئالاھىدە بوشلۇقلار ئالماشتۇرۇلدى',
  },
  indent: {
    zh: '缩进续行',
    en: 'Indented continued lines',
    ug: 'داۋاملاشقان قۇرلار ئىچىگە تارتىلدى',
  },
  extraBlank: {
    zh: '去掉多余空行',
    en: 'Removed extra blank lines',
    ug: 'ئارتۇقچە بوش قۇرلار ئۆچۈرۈلدى',
  },
})

export interface PolishResult {
  text: string
  /** Human-readable list of what changed; empty when the text was already tidy. */
  changes: string[]
}

export type PolishKind = 'text' | 'json' | 'markdown'

export function polishKindFor(name: string): PolishKind {
  const ext = extension(name)
  if (ext === 'json') return 'json'
  if (ext === 'md' || ext === 'markdown') return 'markdown'
  return 'text'
}

const TRAILING_SPACE = /[ \t\u00a0\u3000]+$/

function splitLines(text: string, changes: string[]): string[] {
  if (text.includes('\r')) changes.push(t('lineEndings'))
  return text.replace(/\r\n?/g, '\n').split('\n')
}

/** Caps runs of blank lines at `max`; returns how many lines were dropped. */
function collapseBlank(lines: string[], max: number): { lines: string[]; dropped: number } {
  const out: string[] = []
  let run = 0
  let dropped = 0
  for (const line of lines) {
    run = line === '' ? run + 1 : 0
    if (run > max) dropped++
    else out.push(line)
  }
  return { lines: out, dropped }
}

/** Removes everything but whitespace outside strings, without parsing. */
function compactJson(text: string): string {
  const out: string[] = []
  let inString = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inString) {
      out.push(c)
      if (c === '\\') out.push(text[++i] ?? '')
      else if (c === '"') inString = false
    } else if (c === '"') {
      inString = true
      out.push(c)
    } else if (c !== ' ' && c !== '\n' && c !== '\r' && c !== '\t') {
      out.push(c)
    }
  }
  return out.join('')
}

function jsonIndent(text: string): string {
  const match = /\n([ \t]+)\S/.exec(text)
  if (!match) return '  '
  const indent = match[1]
  if (/^\t+$/.test(indent)) return '\t'
  if (/^ +$/.test(indent) && indent.length >= 2 && indent.length <= 8) return indent
  return '  '
}

/**
 * Pretty-prints JSON objects and arrays, but only when that is lossless: big numbers, duplicate
 * keys, `1.0` or escaped characters would change, so those are left alone.
 */
function polishJson(text: string, changes: string[]): string | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    changes.push(t('jsonInvalid'))
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  if (compactJson(text) !== JSON.stringify(parsed)) {
    changes.push(t('jsonLossy'))
    return null
  }
  const pretty = `${JSON.stringify(parsed, null, jsonIndent(text))}\n`
  if (pretty !== text) changes.push(t('jsonReformatted'))
  return pretty
}

/** Tidies a text file: trailing whitespace, blank-line runs, a single final newline, JSON layout. */
export function polishText(text: string, kind: PolishKind = 'text'): PolishResult {
  const changes: string[] = []
  if (text.trim() === '') return { text, changes }
  if (kind === 'json') {
    const pretty = polishJson(text, changes)
    if (pretty !== null) return { text: pretty, changes }
  }

  let lines = splitLines(text, changes)
  // Markdown uses two trailing spaces as a line break.
  if (kind !== 'markdown') {
    let trimmed = 0
    lines = lines.map((line) => {
      const next = line.replace(TRAILING_SPACE, '')
      if (next !== line) trimmed++
      return next
    })
    if (trimmed) changes.push(t('trailing', { n: trimmed }))
  }

  let ending = 0
  while (lines.length > 0 && lines[lines.length - 1].trim() === '') {
    lines.pop()
    ending++
  }
  if (ending === 0) changes.push(t('finalNewline'))
  else if (ending > 1) changes.push(t('endBlank'))

  const collapsed = collapseBlank(lines, 2)
  if (collapsed.dropped) changes.push(t('collapsed', { n: collapsed.dropped }))
  return { text: `${collapsed.lines.join('\n')}\n`, changes }
}

const HEREDOC = /(?<!<)<<(-?)\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\2/

type LineKind = 'start' | 'continued' | 'blank' | 'heredoc'

function continues(line: string): boolean {
  const match = /\\+$/.exec(line)
  return match !== null && match[0].length % 2 === 1
}

/** Classifies each line of a shell snippet so heredoc bodies can be left untouched. */
function classify(lines: readonly string[]): LineKind[] {
  const kinds: LineKind[] = []
  let heredoc: { delimiter: string; tabs: boolean } | null = null
  let previousContinues = false
  for (const line of lines) {
    if (heredoc) {
      kinds.push('heredoc')
      const body = heredoc.tabs ? line.replace(/^\t+/, '') : line
      if (body === heredoc.delimiter) heredoc = null
      continue
    }
    const trimmed = line.replace(TRAILING_SPACE, '')
    if (trimmed === '') kinds.push('blank')
    else kinds.push(previousContinues ? 'continued' : 'start')
    previousContinues = trimmed !== '' && continues(trimmed)
    const start = HEREDOC.exec(trimmed)
    if (start) heredoc = { delimiter: start[3], tabs: start[1] === '-' }
  }
  return kinds
}

const ODD_SPACES = /[\u00a0\u2000-\u200a\u202f\u205f]/g
const ZERO_WIDTH = /[\u200b-\u200d\ufeff]/g
const DOC_DASH = /(^|\s)[\u2013\u2014](?=[A-Za-z])/g

/**
 * Tidies a command before it is typed into a shell: fixes text pasted from documents (prompt
 * signs, curly quotes, dashes, odd spaces), the classic `\ ` continuation mistake, and tabs,
 * which an interactive shell would treat as completion requests. Heredoc bodies stay verbatim.
 */
export function polishCommand(text: string): PolishResult {
  if (text.trim() === '') return { text: '', changes: text === '' ? [] : [t('blankOnly')] }
  const changes: string[] = []
  const lines = splitLines(text, changes)
  const kinds = classify(lines)

  const starts = lines.filter((_, i) => kinds[i] === 'start')
  const stripPrompt = starts.length > 0 && starts.every((line) => /^\s*\$ /.test(line))
  if (stripPrompt) changes.push(t('prompt'))
  // Curly quotes are only swapped when the text has no straight ones, so quoted prose survives.
  const curlyDouble = /[\u201c\u201d]/.test(text) && !text.includes('"')
  const curlySingle = /[\u2018\u2019]/.test(text) && !text.includes("'")

  const counts = { continuation: 0, trailing: 0, tabs: 0, indent: 0, typography: 0 }
  const tidy = (line: string, kind: LineKind): string => {
    const trimmed = line.replace(TRAILING_SPACE, '')
    if (trimmed !== line) {
      if (continues(trimmed) && /\\[ \t\u00a0\u3000]+$/.test(line)) counts.continuation++
      else counts.trailing++
    }
    let next = trimmed
    if (stripPrompt && kind === 'start') next = next.replace(/^(\s*)\$ /, '$1')
    if (next.includes('\t')) {
      counts.tabs++
      next = next.replace(/\t/g, '  ')
    }
    let typeset = next.replace(ODD_SPACES, ' ').replace(ZERO_WIDTH, '').replace(DOC_DASH, '$1--')
    if (curlyDouble) typeset = typeset.replace(/[\u201c\u201d]/g, '"')
    if (curlySingle) typeset = typeset.replace(/[\u2018\u2019]/g, "'")
    if (typeset !== next) counts.typography++
    next = typeset
    if (kind === 'continued' && /^\S/.test(next)) {
      counts.indent++
      next = `  ${next}`
    }
    return next
  }

  // Blank lines outside heredocs: none at the ends, at most one in a row.
  const out: string[] = []
  let blankRun = 0
  let droppedBlank = false
  lines.forEach((line, i) => {
    const kind = kinds[i]
    if (kind === 'blank') {
      if (out.length === 0 || blankRun > 0) droppedBlank = true
      else out.push('')
      blankRun++
      return
    }
    blankRun = 0
    out.push(kind === 'heredoc' ? line : tidy(line, kind))
  })
  while (out.length > 0 && kinds[lines.length - 1] === 'blank' && out[out.length - 1] === '') {
    out.pop()
    droppedBlank = true
  }

  if (counts.continuation) changes.push(t('continuation', { n: counts.continuation }))
  if (counts.trailing) changes.push(t('trailing', { n: counts.trailing }))
  if (counts.tabs) changes.push(t('tabs'))
  if (counts.typography) changes.push(t('typography'))
  if (counts.indent) changes.push(t('indent'))
  if (droppedBlank) changes.push(t('extraBlank'))
  return { text: out.join('\n'), changes }
}
