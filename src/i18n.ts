/**
 * Interface language. The backend picks it at startup and hands it to every window before any
 * script runs (`window.__GX_LANG__`, or `?lang=` for windows the frontend opens), so it is fixed
 * for the run: module-level constants may call `t`. Changing it in settings applies on restart.
 *
 * Every message is written in all three languages where it is used:
 *
 *   const t = messages({ saved: { zh: '已保存 {name}', en: 'Saved {name}', ug: '{name} ساقلاندى' } })
 *   t('saved', { name })
 */

export const LANGS = ['zh', 'en', 'ug'] as const
export type Lang = (typeof LANGS)[number]

/** Each language in its own script, for the picker. */
export const LANG_NAMES: Record<Lang, string> = { zh: '中文', en: 'English', ug: 'ئۇيغۇرچە' }
const BCP47: Record<Lang, string> = { zh: 'zh-CN', en: 'en', ug: 'ug' }

declare global {
  interface Window {
    __GX_LANG__?: string
  }
}

const isLang = (value: unknown): value is Lang => LANGS.includes(value as Lang)

function initial(): Lang {
  if (typeof window === 'undefined') return 'zh'
  const injected = window.__GX_LANG__
  if (isLang(injected)) return injected
  const query = new URLSearchParams(window.location.search).get('lang')
  return isLang(query) ? query : 'zh'
}

let current: Lang = initial()

function applyToDocument(): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  root.lang = BCP47[current]
  root.dir = current === 'ug' ? 'rtl' : 'ltr'
}
applyToDocument()

export const lang = (): Lang => current
/** BCP 47 tag of the current language, for `Intl` and `lang` attributes. */
export const locale = (): string => BCP47[current]
export const isRtl = (): boolean => current === 'ug'

/** For tests; the app sets the language only at startup. */
export function setLang(next: Lang): void {
  current = next
  applyToDocument()
}

export type Params = Record<string, string | number>
/** A string with `{name}` placeholders, or a function for plurals and other logic. */
export type Text = string | ((p: Params) => string)
export type Msg = Record<Lang, Text>

const PLACEHOLDER = /\{(\w+)\}/g

function render(text: Text, params?: Params): string {
  const s = typeof text === 'function' ? text(params ?? {}) : text
  if (!params) return s
  return s.replace(PLACEHOLDER, (m, k: string) => (k in params ? String(params[k]) : m))
}

/**
 * One text in all three languages, resolved on the spot. For data tables (the plugin guide's API
 * reference and the like) where a dictionary key per row would only add indirection.
 */
export function inLang(text: Record<Lang, string>): string {
  return text[current]
}

/** English count noun: `pl('file')` reads `{n}` and gives `1 file`, `3 files`. */
export const pl =
  (one: string, many = `${one}s`) =>
  (p: Params): string => {
    const n = Number(p.n)
    return `${n.toLocaleString('en')} ${n === 1 ? one : many}`
  }

export type Part = Node | string

export interface Translator<K extends string> {
  (key: K, params?: Params): string
  /** Like `t`, but placeholders may be nodes (links, code, inputs), for `h` children. */
  parts(key: K, parts: Record<string, Part>): Part[]
}

/** A typed dictionary; every message needs all three languages. */
export function messages<K extends string>(defs: Record<K, Msg>): Translator<K> {
  const t = ((key: K, params?: Params) => render(defs[key][current], params)) as Translator<K>
  t.parts = (key, parts) => {
    const text = defs[key][current]
    const s = typeof text === 'function' ? text({}) : text
    const out: Part[] = []
    let last = 0
    for (const m of s.matchAll(PLACEHOLDER)) {
      const name = m[1] ?? ''
      if (!Object.hasOwn(parts, name)) continue
      if (m.index > last) out.push(s.slice(last, m.index))
      out.push(parts[name])
      last = m.index + m[0].length
    }
    if (last < s.length) out.push(s.slice(last))
    return out
  }
  return t
}

const LRI = String.fromCodePoint(0x2066)
const PDI = String.fromCodePoint(0x2069)

/**
 * Keeps a left-to-right run (a path, a size, a host:port) in one piece inside right-to-left
 * text. A no-op in the other languages.
 */
export function ltr(text: string): string {
  return current === 'ug' && text ? `${LRI}${text}${PDI}` : text
}

/**
 * Static HTML carries keys instead of text: `data-t="key"` sets the text and
 * `data-t-aria-label="key"` (any attribute after `data-t-`) sets that attribute.
 */
export function fillStatic<K extends string>(t: Translator<K>, root: ParentNode = document): void {
  for (const element of root.querySelectorAll<HTMLElement>('*')) {
    for (const { name, value } of [...element.attributes]) {
      if (name === 'data-t') element.textContent = t(value as K)
      else if (name.startsWith('data-t-')) element.setAttribute(name.slice(7), t(value as K))
    }
  }
}

/**
 * Options for a numeric date in `toLocaleString` and `toLocaleDateString`. Uyghur's default
 * numeric pattern puts the day before the month (2026-3-10 is 3 October); two-digit fields give
 * 2026-10-03. The other languages keep their defaults.
 */
export function numericDate(): Intl.DateTimeFormatOptions {
  const field = current === 'ug' ? '2-digit' : 'numeric'
  return { year: 'numeric', month: field, day: field }
}

const LIST_SEP: Record<Lang, string> = { zh: '、', en: ', ', ug: '، ' }

/** `a、b、c` / `a, b, c` / `a، b، c`. */
export function joinList(items: readonly string[]): string {
  return items.join(LIST_SEP[current])
}
