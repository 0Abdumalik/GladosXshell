import { joinList, ltr, messages, pl } from '../../i18n'
import { unescapeSend } from './triggers-model'

const t = messages({
  tooLong: {
    zh: '脚本不能超过 {max} 个字符',
    en: 'A script can have at most {max} characters',
    ug: 'قوليازما {max} ھەرپتىن ئاشمىسۇن',
  },
  unknown: {
    zh: '第 {line} 行：不认识“{word}”，可用 {keywords}',
    en: 'Line {line}: unknown keyword "{word}"; use one of {keywords}',
    ug: '{line}-قۇر: «{word}» تونۇلمىدى، ئىشلىتىشكە بولىدىغانلىرى: {keywords}',
  },
  sendEmpty: {
    zh: '第 {line} 行：send 后面要写发送的内容',
    en: 'Line {line}: write the text to send after send',
    ug: '{line}-قۇر: send دىن كېيىن يوللايدىغان مەزمۇننى يېزىڭ',
  },
  waitRange: {
    zh: '第 {line} 行：wait 的毫秒数必须是 0 到 {max} 的整数',
    en: 'Line {line}: wait takes a whole number of milliseconds from 0 to {max}',
    ug: '{line}-قۇر: wait نىڭ مىللىسېكۇنت سانى 0 – {max} ئارىلىقىدىكى پۈتۈن سان بولۇشى كېرەك',
  },
  timeoutRange: {
    zh: '第 {line} 行：timeout 的秒数必须是 1 到 {max} 的整数',
    en: 'Line {line}: timeout takes a whole number of seconds from 1 to {max}',
    ug: '{line}-قۇر: timeout نىڭ سېكۇنت سانى 1 – {max} ئارىلىقىدىكى پۈتۈن سان بولۇشى كېرەك',
  },
  expectEmpty: {
    zh: '第 {line} 行：expect 后面要写等待出现的文字',
    en: 'Line {line}: write the text to wait for after expect',
    ug: '{line}-قۇر: expect دىن كېيىن كۈتىدىغان تېكىستنى يېزىڭ',
  },
  tooManySteps: { zh: '最多 {max} 步', en: 'At most {max} steps', ug: 'ئەڭ كۆپ {max} قەدەم' },
  noSteps: {
    zh: '脚本里还没有步骤',
    en: 'The script has no steps yet',
    ug: 'قوليازمىدا تېخى قەدەم يوق',
  },
  hasErrors: { zh: '脚本有错误', en: 'Script has errors', ug: 'قوليازمىدا خاتالىق بار' },
  steps: { zh: '{n} 步', en: pl('step'), ug: '{n} قەدەم' },
  sends: { zh: '发送 {n} 次', en: pl('send'), ug: '{n} قېتىم يوللاش' },
  expects: { zh: '等待输出 {n} 次', en: pl('expect'), ug: '{n} قېتىم چىقىش كۈتۈش' },
})

export interface Macro {
  id: string
  name: string
  /** One step per line; see `parseScript`. */
  script: string
}

export type Step =
  | { kind: 'send'; text: string }
  | { kind: 'wait'; ms: number }
  | { kind: 'expect'; text: string; timeoutMs: number }

export type ScriptError = { line: number; message: string }

export const MAX_MACROS = 200
export const MAX_SCRIPT = 20_000
const MAX_STEPS = 500
const MAX_WAIT_MS = 600_000
const DEFAULT_TIMEOUT_SECS = 10
const MAX_TIMEOUT_SECS = 3600
/** Pauses shorter than this while recording are typing, not waiting for the server. */
const RECORD_GAP_MS = 800
const RECORD_MAX_WAIT_MS = 60_000

const KEYWORDS = ['send', 'line', 'wait', 'expect', 'timeout'] as const

const str = (value: unknown) => (typeof value === 'string' ? value : '')

function parseMacro(raw: unknown): Macro | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  const id = str(r.id)
  if (!id) return null
  return { id, name: str(r.name).slice(0, 100), script: str(r.script).slice(0, MAX_SCRIPT) }
}

export function parseMacros(raw: unknown): Macro[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: Macro[] = []
  for (const item of raw) {
    const macro = parseMacro(item)
    if (!macro || seen.has(macro.id)) continue
    seen.add(macro.id)
    out.push(macro)
    if (out.length >= MAX_MACROS) break
  }
  return out
}

/**
 * `send TEXT` types TEXT (with \r \n \t \e \xHH), `line TEXT` types it and presses Enter,
 * `wait MS` pauses, `expect TEXT` waits for TEXT in the output, `timeout SECS` sets how long
 * the following expects wait. `#` starts a comment line.
 */
export function parseScript(script: string): Step[] | ScriptError {
  if (script.length > MAX_SCRIPT) return { line: 0, message: t('tooLong', { max: MAX_SCRIPT }) }
  const steps: Step[] = []
  let timeoutMs = DEFAULT_TIMEOUT_SECS * 1000
  const lines = script.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]
    const trimmed = raw.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const line = i + 1
    const match = /^\s*(\S+)(?: (.*))?$/.exec(raw)
    const keyword = match?.[1].toLowerCase() ?? ''
    // Only the one space after the keyword is a separator, so text can keep leading spaces.
    const arg = match?.[2] ?? ''
    if (!(KEYWORDS as readonly string[]).includes(keyword)) {
      return {
        line,
        message: t('unknown', {
          line,
          word: ltr(match?.[1] ?? trimmed),
          keywords: joinList(KEYWORDS.map(ltr)),
        }),
      }
    }
    if (keyword === 'send' || keyword === 'line') {
      const text = unescapeSend(arg) + (keyword === 'line' ? '\r' : '')
      if (!text) return { line, message: t('sendEmpty', { line }) }
      steps.push({ kind: 'send', text })
    } else if (keyword === 'wait') {
      const ms = Number(arg.trim())
      if (!Number.isInteger(ms) || ms < 0 || ms > MAX_WAIT_MS) {
        return { line, message: t('waitRange', { line, max: MAX_WAIT_MS }) }
      }
      steps.push({ kind: 'wait', ms })
    } else if (keyword === 'timeout') {
      const secs = Number(arg.trim())
      if (!Number.isInteger(secs) || secs < 1 || secs > MAX_TIMEOUT_SECS) {
        return { line, message: t('timeoutRange', { line, max: MAX_TIMEOUT_SECS }) }
      }
      timeoutMs = secs * 1000
    } else {
      const text = unescapeSend(arg)
      if (!text.trim()) return { line, message: t('expectEmpty', { line }) }
      steps.push({ kind: 'expect', text, timeoutMs })
    }
    if (steps.length > MAX_STEPS) return { line, message: t('tooManySteps', { max: MAX_STEPS }) }
  }
  if (steps.length === 0) return { line: 0, message: t('noSteps') }
  return steps
}

/** The inverse of `unescapeSend` for control characters, so recorded keys stay readable. */
export function escapeSend(text: string): string {
  let out = ''
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0
    if (ch === '\\') out += '\\\\'
    else if (ch === '\r') out += '\\r'
    else if (ch === '\n') out += '\\n'
    else if (ch === '\t') out += '\\t'
    else if (ch === '\x1b') out += '\\e'
    else if (code < 0x20 || code === 0x7f) out += `\\x${code.toString(16).padStart(2, '0')}`
    else out += ch
  }
  return out
}

export interface Keystroke {
  data: string
  at: number
}

/** Turns typed input into a script: Enter ends a step, long pauses become waits. */
export function recordingToScript(keys: Keystroke[]): string {
  const out: string[] = []
  let pending = ''
  let last: number | null = null
  const flush = () => {
    if (!pending) return
    const body = pending.endsWith('\r') ? pending.slice(0, -1) : null
    // biome-ignore lint/suspicious/noControlCharactersInRegex: control keys are what is looked for
    const plain = body !== null && !/[\x00-\x1f\x7f]/.test(body)
    out.push(plain ? `line ${body}` : `send ${escapeSend(pending)}`)
    pending = ''
  }
  for (const key of keys) {
    if (last !== null && key.at - last >= RECORD_GAP_MS) {
      flush()
      const ms = Math.min(RECORD_MAX_WAIT_MS, Math.round((key.at - last) / 100) * 100)
      out.push(`wait ${ms}`)
    }
    last = key.at
    for (const ch of key.data) {
      pending += ch
      if (ch === '\r') flush()
    }
  }
  flush()
  return out.join('\n')
}

// CSI, OSC (BEL or ST ended) and two-byte escapes; a cut-off sequence at the end stays until it completes.
const ANSI =
  // biome-ignore lint/suspicious/noControlCharactersInRegex: matching terminal escapes is the point
  /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]|[\x00-\x08\x0e-\x1a\x1c-\x1f]/g
const KEEP = 8192

/** Collects output for `expect`, stripped of escapes; a match consumes everything up to it. */
export class OutputMatcher {
  private text = ''

  feed(chunk: string): void {
    this.text = (this.text + chunk).slice(-KEEP)
  }

  take(needle: string): boolean {
    const plain = this.text.replace(ANSI, '')
    const at = plain.indexOf(needle)
    if (at < 0) return false
    this.text = plain.slice(at + needle.length)
    return true
  }

  clear(): void {
    this.text = ''
  }
}

export function describeScript(script: string): string {
  const steps = parseScript(script)
  if (!Array.isArray(steps)) return t('hasErrors')
  const sends = steps.filter((s) => s.kind === 'send').length
  const expects = steps.filter((s) => s.kind === 'expect').length
  return [
    t('steps', { n: steps.length }),
    t('sends', { n: sends }),
    expects ? t('expects', { n: expects }) : '',
  ]
    .filter(Boolean)
    .join(' · ')
}
