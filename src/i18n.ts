/**
 * Interface language and language packs. Two kinds of code exist side by side:
 *
 * - `Lang` (zh / en / ug): the keys of the inline three-language dictionaries used by
 *   `messages()`. Kept short for the 90+ call sites.
 * - lower-case BCP 47 codes (zh-cn / en / ug / …): what settings, language-pack files, `?lang=` and
 *   `window.__GX_LANG__` use. Imported packs add more codes.
 *
 * The backend picks the language at startup and hands it to every window before any script runs:
 * `window.__GX_LANG__` (a BCP 47 code), `window.__GX_PACKS__` (English text -> translation) and
 * `window.__GX_RTL__`. English text is the key, Cheat Engine .lng style: a message looks its
 * English text up in the pack and falls back to English (or the inline dictionary) when the key
 * is missing, so an imported pack only translates what it wants to.
 */

/** The inline dictionary keys; keep these short and stable. */
export const LANGS = ['zh', 'en', 'ug'] as const
export type Lang = (typeof LANGS)[number]

declare global {
  interface Window {
    __GX_LANG__?: string
    __GX_PACKS__?: Record<string, string>
    __GX_RTL__?: boolean
  }
}

/** Fold any code (inline or BCP 47) to an inline dictionary key; external packs count as en. */
function toLang(code: string): Lang {
  const base = code.toLowerCase().split(/[_-]/)[0] ?? ''
  if (base === 'zh') return 'zh'
  if (base === 'ug') return 'ug'
  return 'en'
}

/** Fold any code to the closest BCP 47 built-in; other codes are left as-is (external packs). */
function toCode(code: string): string {
  const lower = code.toLowerCase()
  const base = lower.split(/[_-]/)[0] ?? ''
  if (base === 'zh') return 'zh-cn'
  if (base === 'en') return 'en'
  if (base === 'ug') return 'ug'
  return lower
}

function initialCode(): string {
  if (typeof window === 'undefined') return 'zh-cn'
  const injected = window.__GX_LANG__
  if (typeof injected === 'string' && injected) return injected
  const query = new URLSearchParams(window.location.search).get('lang')
  return query ? toCode(query) : 'en'
}

let currentCode: string = initialCode()
let current: Lang = toLang(currentCode)

/** Pack of the current language: English text -> translation. Empty outside the app (tests). */
const packs: Record<string, string> =
  typeof window !== 'undefined' && window.__GX_PACKS__ ? window.__GX_PACKS__ : {}

function applyToDocument(): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  root.lang = locale()
  root.dir = isRtl() ? 'rtl' : 'ltr'
}

/** The inline dictionary key of the current language (zh / en / ug). */
export const lang = (): Lang => current
/** The lower-case BCP 47 code of the current pack (zh-cn / en / ug / imported). */
export const code = (): string => currentCode
/** The BCP 47 tag for `Intl` and `lang` attributes. */
export const locale = (): string => currentCode
export const isRtl = (): boolean =>
  typeof window !== 'undefined' && window.__GX_RTL__ !== undefined
    ? !!window.__GX_RTL__
    : current === 'ug'

// Runs once at startup. Must come after locale()/isRtl() are defined, or the const
// arrow functions are still in the temporal dead zone when it fires (blank UI).
applyToDocument()

/** For tests; the app sets the language only at startup. */
export function setLang(next: string): void {
  currentCode = toCode(next)
  current = toLang(next)
  applyToDocument()
}

export type Params = Record<string, string | number>
/** A string with `{name}` placeholders, or a function for plurals and other logic. */
export type Text = string | ((p: Params) => string)
export type Msg = Record<Lang, Text>

const PLACEHOLDER = /\{(\w+)\}/g

function render(text: string, params?: Params): string {
  if (!params) return text
  return text.replace(PLACEHOLDER, (m, k: string) => (k in params ? String(params[k]) : m))
}

function asText(text: Text, params: Params | undefined): string {
  return typeof text === 'function' ? text(params ?? {}) : text
}

/**
 * One text in all three languages, resolved on the spot. Also resolves through the pack when it
 * carries a translation for the English text; otherwise the inline text stands.
 */
export function inLang(text: Record<Lang, string>): string {
  const fromPack = packs[text.en]
  return fromPack ?? text[current]
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

const LRI = String.fromCodePoint(0x2066)
const PDI = String.fromCodePoint(0x2069)

/**
 * Keeps a left-to-right run (a path, a size, a host:port) in one piece inside right-to-left
 * text. A no-op in the other languages.
 */
export function ltr(text: string): string {
  return isRtl() && text ? `${LRI}${text}${PDI}` : text
}

/** A typed dictionary; every message needs all three built-in languages. */
export function messages<K extends string>(defs: Record<K, Msg>): Translator<K> {
  /** The pack key of a message: its English text, or the dictionary key when en is a function. */
  const packKey = (key: K): string => {
    const en = defs[key].en
    return typeof en === 'string' ? en : key
  }
  const t = ((key: K, params?: Params) => {
    const fromPack = packs[packKey(key)]
    if (typeof fromPack === 'string') return render(fromPack, params)
    // English fallback: the inline dictionary of the current built-in language.
    return render(asText(defs[key][current], params), params)
  }) as Translator<K>
  t.parts = (key, parts) => {
    const fromPack = packs[packKey(key)]
    const text = fromPack !== undefined ? fromPack : asText(defs[key][current], {})
    const out: Part[] = []
    let last = 0
    for (const m of text.matchAll(PLACEHOLDER)) {
      const name = m[1] ?? ''
      if (!Object.hasOwn(parts, name)) continue
      if (m.index > last) out.push(text.slice(last, m.index))
      out.push(parts[name])
      last = m.index + m[0].length
    }
    if (last < text.length) out.push(text.slice(last))
    return out
  }
  return t
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
