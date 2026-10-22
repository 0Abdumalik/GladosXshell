import { ltr, messages } from './i18n'
import { describeError } from './protocol'

type Child = Node | string | null | undefined | false
type Attrs = Record<string, string | number | boolean | null | undefined | EventListener>

/**
 * Small element builder. `on*` keys become listeners, booleans toggle attributes,
 * and `text` sets textContent. Strings are always inserted as text, never as HTML.
 */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: (Child | Child[])[]
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag)
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue
    if (key.startsWith('on') && typeof value === 'function') {
      element.addEventListener(key.slice(2), value)
    } else if (key === 'text') {
      element.textContent = String(value)
    } else if (value === true) {
      element.setAttribute(key, '')
    } else {
      element.setAttribute(key, String(value))
    }
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue
    element.append(child)
  }
  return element
}

export function $<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id)
  if (!element) throw new Error(`missing #${id}`)
  return element as T
}

let uid = 0
export function uniqueId(prefix: string): string {
  uid += 1
  return `${prefix}-${uid}`
}

const t = messages({
  ready: { zh: '就绪', en: 'Ready', ug: 'تەييار' },
  copied: { zh: '已复制：{text}', en: 'Copied: {text}', ug: 'كۆچۈرۈلدى: {text}' },
})

const statusBar = () => document.getElementById('status')

export const STATUS_IDLE = t('ready')
// Messages are about the moment they were shown; after this they would describe something stale.
const STATUS_LIFETIME_MS = { info: 8000, error: 20000 }
let statusTimer: ReturnType<typeof setTimeout> | undefined
const errorListeners: ((text: string) => void)[] = []

/** Called with every failed operation passed to `reportError`; the app log keeps them. */
export function onReportedError(listener: (text: string) => void): void {
  errorListeners.push(listener)
}

export function setStatus(text: string, tone: 'info' | 'error' = 'info'): void {
  const bar = statusBar()
  if (!bar) return
  bar.textContent = text
  bar.dataset.tone = tone
  clearTimeout(statusTimer)
  statusTimer = setTimeout(() => {
    bar.textContent = STATUS_IDLE
    bar.dataset.tone = 'info'
  }, STATUS_LIFETIME_MS[tone])
}

/** Shows a failed operation in the status bar. Plain hints about input use `setStatus` instead. */
export function reportError(error: unknown): void {
  const text = describeError(error)
  setStatus(text, 'error')
  for (const listener of errorListeners) listener(text)
}

/** Labelled field wrapper with an error slot referenced by aria-describedby. */
export function field(
  label: string,
  control: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
  help?: string,
  extra?: Node,
): HTMLElement {
  const id = control.id || uniqueId('f')
  control.id = id
  const error = h('p', { class: 'field-error', id: `${id}-error`, role: 'alert' })
  const described = [help ? `${id}-help` : '', error.id].filter(Boolean).join(' ')
  control.setAttribute('aria-describedby', described)
  return h(
    'div',
    { class: 'field' },
    h('label', { for: id, text: label }),
    extra ? h('div', { class: 'field-inline' }, control, extra) : control,
    help ? h('p', { class: 'help', id: `${id}-help`, text: help }) : null,
    error,
  )
}

export function setFieldError(control: HTMLElement, message: string): void {
  const error = document.getElementById(`${control.id}-error`)
  if (error) error.textContent = message
  if (message) control.setAttribute('aria-invalid', 'true')
  else control.removeAttribute('aria-invalid')
}

export async function copyText(text: string): Promise<void> {
  await navigator.clipboard.writeText(text)
  setStatus(t('copied', { text: ltr(text) }))
}
