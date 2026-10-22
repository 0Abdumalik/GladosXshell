import type { CommandToken } from './commands-model'
import { type CompletionCandidate, createCompletionPopup, suggest } from './completion'
import { setStatus } from './dom'
import { messages } from './i18n'
import { activeTerminal, onActive } from './sessions'

const t = messages({
  none: { zh: '没有可用的补全', en: 'No completions', ug: 'ئىشلەتكىلى بولىدىغان تولۇقلاش يوق' },
})

export interface InputCompletion {
  /** Handles Tab and, while suggestions are open, the navigation keys. True when consumed. */
  keydown: (event: KeyboardEvent) => boolean
  hide: () => void
}

const POPUP_ID = 'cmd-completion'
const CARET_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'Home', 'End'])

/** Wires shell-style suggestions (command names, remote paths) to the command bar input. */
export function attachCompletion(input: HTMLTextAreaElement, changed: () => void): InputCompletion {
  let request = 0
  let target: CommandToken | null = null
  const measure = document.createElement('canvas').getContext('2d')

  const syncAria = () => {
    const open = popup.visible()
    input.setAttribute('aria-expanded', String(open))
    const active = popup.activeId()
    if (active) input.setAttribute('aria-activedescendant', active)
    else input.removeAttribute('aria-activedescendant')
  }

  const hide = () => {
    request++
    target = null
    popup.hide()
    syncAria()
  }

  /** Screen x of a character in the input's current line, so the list opens under the word. */
  const caretX = (index: number): number => {
    const rect = input.getBoundingClientRect()
    const style = getComputedStyle(input)
    const line = input.value.slice(0, index).split('\n').pop() ?? ''
    let width = 0
    if (measure) {
      measure.font = `${style.fontSize} ${style.fontFamily}`
      width = measure.measureText(line).width
    }
    const x = rect.left + Number.parseFloat(style.paddingLeft) + width - input.scrollLeft
    return Math.min(x, rect.right - 32)
  }

  const accept = (candidate: CompletionCandidate) => {
    if (!target) return
    const value = input.value
    const open = candidate.keepOpen === true || candidate.text.endsWith('/')
    const spaced = value[target.end] === ' '
    const insert = open || spaced ? candidate.text : `${candidate.text} `
    input.value = value.slice(0, target.start) + insert + value.slice(target.end)
    const caret = target.start + insert.length + (!open && spaced ? 1 : 0)
    input.setSelectionRange(caret, caret)
    changed()
    hide()
    // Keep drilling into a folder (or an `--opt=` value) like a shell does.
    if (open) void update(false)
  }

  const popup = createCompletionPopup(POPUP_ID, accept)

  async function update(explicit: boolean): Promise<void> {
    const ticket = ++request
    const position = input.selectionStart
    if (position !== input.selectionEnd || input.value.slice(0, position).includes('\n')) {
      hide()
      return
    }
    const result = await suggest(
      input.value,
      position,
      activeTerminal()?.sessionId ?? null,
      explicit,
    )
    if (ticket !== request) return
    if (!result) {
      hide()
      return
    }
    const { token, candidates } = result
    target = token
    if (explicit && candidates.length === 1) {
      accept(candidates[0])
      return
    }
    if (candidates.length === 0) {
      hide()
      if (explicit) setStatus(t('none'))
      return
    }
    popup.show(candidates, input.getBoundingClientRect(), caretX(token.start))
    syncAria()
  }

  input.setAttribute('aria-autocomplete', 'list')
  input.setAttribute('aria-controls', POPUP_ID)
  input.setAttribute('aria-expanded', 'false')
  input.addEventListener('input', () => void update(false))
  input.addEventListener('keyup', (event) => {
    if (popup.visible() && CARET_KEYS.has(event.key)) void update(false)
  })
  input.addEventListener('pointerdown', hide)
  input.addEventListener('blur', hide)
  window.addEventListener('resize', hide)
  onActive(hide)

  const keydown = (event: KeyboardEvent): boolean => {
    const plain = !event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey
    if (event.key === 'Tab' && plain) {
      if (popup.visible()) {
        event.preventDefault()
        const candidate = popup.current()
        if (candidate) accept(candidate)
        return true
      }
      // An empty bar lets Tab move focus on as usual.
      if (input.value.trim() === '') return false
      event.preventDefault()
      void update(true)
      return true
    }
    if (!popup.visible() || !plain) return false
    if (event.key === 'Escape') {
      event.preventDefault()
      hide()
      return true
    }
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault()
      if (event.key === 'ArrowUp') popup.selectPrev()
      else popup.selectNext()
      syncAria()
      return true
    }
    if (event.key === 'Enter') hide()
    return false
  }

  return { keydown, hide }
}
