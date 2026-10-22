import { ltr, messages } from '../../i18n'

const t = messages({
  red: { zh: '红', en: 'Red', ug: 'قىزىل' },
  orange: { zh: '橙', en: 'Orange', ug: 'ئاپېلسىن رەڭ' },
  yellow: { zh: '黄', en: 'Yellow', ug: 'سېرىق' },
  green: { zh: '绿', en: 'Green', ug: 'يېشىل' },
  teal: { zh: '青', en: 'Teal', ug: 'يېشىل كۆك' },
  blue: { zh: '蓝', en: 'Blue', ug: 'كۆك' },
  purple: { zh: '紫', en: 'Purple', ug: 'سۆسۈن' },
  patternRequired: {
    zh: '请填写要匹配的内容',
    en: 'Enter the text to match',
    ug: 'ماسلايدىغان مەزمۇننى كىرگۈزۈڭ',
  },
  patternTooLong: {
    zh: '匹配内容最长 {max} 个字符',
    en: 'The match text can be at most {max} characters',
    ug: 'ماسلاش مەزمۇنى ئەڭ كۆپ {max} ھەرپ بولىدۇ',
  },
  badRegex: {
    zh: '正则表达式有误：{error}',
    en: 'Invalid regular expression: {error}',
    ug: 'مۇنتىزىم ئىپادىدە خاتالىق بار: {error}',
  },
  matchesEmpty: {
    zh: '这个表达式能匹配空文本，会在每一行触发',
    en: 'This expression matches empty text, so it would fire on every line',
    ug: 'بۇ ئىپادە بوش تېكىستكىمۇ ماس كېلىدۇ، ھەر بىر قۇردا قوزغىلىدۇ',
  },
  sendTooLong: {
    zh: '发送内容最长 {max} 个字符',
    en: 'The text to send can be at most {max} characters',
    ug: 'يوللايدىغان مەزمۇن ئەڭ كۆپ {max} ھەرپ بولىدۇ',
  },
  noAction: {
    zh: '至少选择一个动作：高亮、提醒或自动发送',
    en: 'Choose at least one action: highlight, notify or auto-send',
    ug: 'كەم دېگەندە بىر ھەرىكەتنى تاللاڭ: گەۋدىلەندۈرۈش، ئۇقتۇرۇش ياكى ئاپتوماتىك يوللاش',
  },
  highlight: { zh: '{color}色高亮', en: '{color} highlight', ug: '{color} گەۋدىلەندۈرۈش' },
  highlightBackground: {
    zh: '{color}色背景高亮',
    en: '{color} background',
    ug: '{color} تەگلىك گەۋدىلەندۈرۈش',
  },
  notify: { zh: '提醒', en: 'Notify', ug: 'ئۇقتۇرۇش' },
  send: { zh: '发送 {text}', en: 'Send {text}', ug: 'يوللاش: {text}' },
})

export interface TriggerRule {
  id: string
  name: string
  pattern: string
  regex: boolean
  caseSensitive: boolean
  /** A key of COLORS, or null for no highlight. */
  color: string | null
  /** Colour the background instead of the text. */
  background: boolean
  notify: boolean
  /** Sent to the terminal on a match; `\r`, `\n`, `\t`, `\xHH` and `\\` escapes allowed. */
  send: string
  /** Press Enter after `send`. */
  enter: boolean
  /** Comma-separated globs on `user@host[:port]` or the host; empty for every terminal. */
  hosts: string
  enabled: boolean
}

export interface CompiledTrigger {
  rule: TriggerRule
  pattern: RegExp
  hosts: RegExp[]
  foreground?: string
  background?: string
  /** What to type on a match, escapes resolved; empty when the rule doesn't send. */
  input: string
  /** The rule notifies or sends, so it fires once per line rather than only colouring. */
  acts: boolean
}

// Mid-tone colours, readable on both the dark and the light terminal background.
export const COLORS: Record<string, { label: string; value: string }> = {
  red: { label: t('red'), value: '#d1495b' },
  orange: { label: t('orange'), value: '#d9822b' },
  yellow: { label: t('yellow'), value: '#c9a227' },
  green: { label: t('green'), value: '#4f9d52' },
  teal: { label: t('teal'), value: '#2f9e8f' },
  blue: { label: t('blue'), value: '#3d8fd1' },
  purple: { label: t('purple'), value: '#9a6fd1' },
}

/** Text drawn over a coloured background. */
const ON_COLOR = '#101418'

export const MAX_RULES = 100
const MAX_PATTERN = 500
const MAX_SEND = 1000

export function newRule(id: string, pattern = ''): TriggerRule {
  return {
    id,
    name: '',
    pattern,
    regex: false,
    caseSensitive: false,
    color: 'yellow',
    background: false,
    notify: false,
    send: '',
    enter: true,
    hosts: '',
    enabled: true,
  }
}

const str = (value: unknown, fallback = '') => (typeof value === 'string' ? value : fallback)
const bool = (value: unknown, fallback: boolean) => (typeof value === 'boolean' ? value : fallback)

/** A stored rule, or null if it is too damaged to keep. */
export function parseRule(raw: unknown): TriggerRule | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const id = str(r.id)
  const pattern = str(r.pattern)
  if (!id || !pattern) return null
  const color = typeof r.color === 'string' && r.color in COLORS ? r.color : null
  return {
    id,
    name: str(r.name),
    pattern,
    regex: bool(r.regex, false),
    caseSensitive: bool(r.caseSensitive, false),
    color,
    background: bool(r.background, false),
    notify: bool(r.notify, false),
    send: str(r.send),
    enter: bool(r.enter, true),
    hosts: str(r.hosts),
    enabled: bool(r.enabled, true),
  }
}

export function parseRules(raw: unknown): TriggerRule[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: TriggerRule[] = []
  for (const item of raw) {
    const rule = parseRule(item)
    if (!rule || seen.has(rule.id)) continue
    seen.add(rule.id)
    out.push(rule)
    if (out.length >= MAX_RULES) break
  }
  return out
}

const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function glob(pattern: string): RegExp {
  const source = pattern
    .split('')
    .map((c) => (c === '*' ? '.*' : c === '?' ? '.' : escapeRegex(c)))
    .join('')
  return new RegExp(`^${source}$`, 'i')
}

export function hostGlobs(hosts: string): RegExp[] {
  return (
    hosts
      // i18n-ignore: Chinese and Arabic-script keyboards type their own comma between hosts
      .split(/[,，،\s]+/)
      .filter(Boolean)
      .map(glob)
  )
}

/** `user@host[:port]` → `host`, unwrapping `[v6]`. */
function hostOf(target: string): string {
  const host = target.slice(target.lastIndexOf('@') + 1)
  const v6 = /^\[(.*)\](?::\d+)?$/.exec(host)
  if (v6) return v6[1]
  return host.replace(/:\d+$/, '')
}

/** Whether a terminal with this SSH target (null for local shells) is in the rule's scope. */
export function inScope(globs: RegExp[], target: string | null): boolean {
  if (globs.length === 0) return true
  if (target === null) return false
  const host = hostOf(target)
  return globs.some((g) => g.test(target) || g.test(host))
}

/** Resolves the escapes the send field allows; anything else after `\` stays as typed. */
export function unescapeSend(text: string): string {
  return text.replace(/\\(x[0-9a-fA-F]{2}|[rnte\\])/g, (_, code: string) => {
    if (code[0] === 'x') return String.fromCharCode(Number.parseInt(code.slice(1), 16))
    return { r: '\r', n: '\n', t: '\t', e: '\x1b', '\\': '\\' }[code] ?? code
  })
}

export type RuleError = { field: 'pattern' | 'send' | 'actions'; message: string }

/** A usable rule, or what is wrong with it. */
export function compileRule(rule: TriggerRule): CompiledTrigger | RuleError {
  if (!rule.pattern) return { field: 'pattern', message: t('patternRequired') }
  if (rule.pattern.length > MAX_PATTERN) {
    return { field: 'pattern', message: t('patternTooLong', { max: MAX_PATTERN }) }
  }
  let pattern: RegExp
  try {
    const source = rule.regex ? rule.pattern : escapeRegex(rule.pattern)
    pattern = new RegExp(source, rule.caseSensitive ? '' : 'i')
  } catch (error) {
    return { field: 'pattern', message: t('badRegex', { error: (error as Error).message }) }
  }
  if (pattern.test('')) {
    return { field: 'pattern', message: t('matchesEmpty') }
  }
  if (rule.send.length > MAX_SEND) {
    return { field: 'send', message: t('sendTooLong', { max: MAX_SEND }) }
  }
  const input = rule.send ? unescapeSend(rule.send) + (rule.enter ? '\r' : '') : ''
  const color = rule.color ? COLORS[rule.color]?.value : undefined
  if (!color && !rule.notify && !input) {
    return { field: 'actions', message: t('noAction') }
  }
  return {
    rule,
    pattern,
    hosts: hostGlobs(rule.hosts),
    foreground: color && (rule.background ? ON_COLOR : color),
    background: color && rule.background ? color : undefined,
    input,
    acts: rule.notify || input !== '',
  }
}

export function compileRules(rules: TriggerRule[]): CompiledTrigger[] {
  const out: CompiledTrigger[] = []
  for (const rule of rules) {
    if (!rule.enabled) continue
    const compiled = compileRule(rule)
    if ('rule' in compiled) out.push(compiled)
  }
  return out
}

/** One-line description of what the rule does, for the list. */
export function describeActions(rule: TriggerRule): string[] {
  const out: string[] = []
  if (rule.color && COLORS[rule.color]) {
    const color = COLORS[rule.color].label
    out.push(t(rule.background ? 'highlightBackground' : 'highlight', { color }))
  }
  if (rule.notify) out.push(t('notify'))
  if (rule.send) out.push(t('send', { text: ltr(`${rule.send}${rule.enter ? ' ⏎' : ''}`) }))
  return out
}

/**
 * Stops a rule that keeps answering its own output: at most `limit` firings per `windowMs`,
 * and none within `gapMs` of the last.
 */
export class FireGuard {
  private readonly times = new Map<string, number[]>()

  constructor(
    private readonly gapMs = 1000,
    private readonly limit = 5,
    private readonly windowMs = 10_000,
  ) {}

  /** 'ok' to fire, 'wait' to skip this one, 'stop' when the rule should be switched off. */
  check(id: string, now: number): 'ok' | 'wait' | 'stop' {
    const recent = (this.times.get(id) ?? []).filter((t) => now - t < this.windowMs)
    this.times.set(id, recent)
    const last = recent[recent.length - 1]
    if (last !== undefined && now - last < this.gapMs) return 'wait'
    if (recent.length >= this.limit) return 'stop'
    recent.push(now)
    return 'ok'
  }
}
