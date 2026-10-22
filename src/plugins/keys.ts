export interface KeyChord {
  ctrl: boolean
  shift: boolean
  alt: boolean
  meta: boolean
  /** `KeyP`, `Digit1` for letters and digits (layout independent), else the lowercased key. */
  key: string
}

export type KeyEventLike = Pick<
  KeyboardEvent,
  'ctrlKey' | 'shiftKey' | 'altKey' | 'metaKey' | 'key' | 'code'
>

const MODIFIERS: Record<string, keyof Omit<KeyChord, 'key'>> = {
  ctrl: 'ctrl',
  control: 'ctrl',
  shift: 'shift',
  alt: 'alt',
  meta: 'meta',
  cmd: 'meta',
  win: 'meta',
}

const ALIASES: Record<string, string> = {
  esc: 'escape',
  del: 'delete',
  space: ' ',
  up: 'arrowup',
  down: 'arrowdown',
  left: 'arrowleft',
  right: 'arrowright',
  plus: '+',
}

function keyName(key: string): string {
  if (/^[a-z]$/i.test(key)) return `Key${key.toUpperCase()}`
  if (/^[0-9]$/.test(key)) return `Digit${key}`
  const lower = key.toLowerCase()
  return ALIASES[lower] ?? lower
}

/** `Ctrl+Shift+P` → chord; null when the text names no key or repeats a modifier. */
export function parseKey(text: string): KeyChord | null {
  // A trailing `+` is the key itself (`Ctrl++`).
  const parts = text.trim().replace(/\+\+$/, '+plus').split('+')
  const chord: KeyChord = { ctrl: false, shift: false, alt: false, meta: false, key: '' }
  for (const [index, raw] of parts.entries()) {
    const part = raw.trim()
    if (!part) return null
    const modifier = MODIFIERS[part.toLowerCase()]
    if (modifier && index < parts.length - 1) {
      if (chord[modifier]) return null
      chord[modifier] = true
    } else if (index === parts.length - 1 && !modifier) {
      chord.key = keyName(part)
    } else {
      return null
    }
  }
  return chord.key ? chord : null
}

export function matchesKey(chord: KeyChord, event: KeyEventLike): boolean {
  if (
    chord.ctrl !== event.ctrlKey ||
    chord.shift !== event.shiftKey ||
    chord.alt !== event.altKey ||
    chord.meta !== event.metaKey
  )
    return false
  if (chord.key.startsWith('Key') || chord.key.startsWith('Digit')) return event.code === chord.key
  return event.key.toLowerCase() === chord.key
}

/** Display form, matching the `aria-keyshortcuts` style: `Ctrl+Shift+P`. */
export function formatKey(chord: KeyChord): string {
  const key = chord.key.replace(/^(Key|Digit)/, '')
  const shown = key === ' ' ? 'Space' : key.length === 1 ? key.toUpperCase() : cap(key)
  return [
    chord.ctrl && 'Ctrl',
    chord.shift && 'Shift',
    chord.alt && 'Alt',
    chord.meta && 'Meta',
    shown,
  ]
    .filter(Boolean)
    .join('+')
}

const cap = (key: string) =>
  key
    .replace(/^arrow(.)/, (_, c: string) => `Arrow${c.toUpperCase()}`)
    .replace(/^./, (c) => c.toUpperCase())
