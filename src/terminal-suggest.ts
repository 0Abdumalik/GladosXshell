import type { IDisposable, IMarker, Terminal } from '@xterm/xterm'
import {
  type CompletionCandidate,
  type CompletionPopup,
  createCompletionPopup,
  suggest,
} from './completion'
import { settings } from './settings-store'

/** Text before the cursor that ends like a shell prompt (`$`, `#`, `%`, `>`, `]`, `~`, `❯`…). */
const PROMPT_END = /[$#%>❯➜→λ»\]~)]\s*$/
/** Interactive programs whose prompts look like a shell's. */
const REPL_PROMPT = /(>>>|\.\.\.|mysql>|MariaDB \[[^\]]*\]>|[=-][#>]|redis[^>]*>|irb[^>]*>)\s*$/
/** Longest input followed across wrapped rows. */
const MAX_ROWS = 20
const ECHO_DELAY = 40
const NO_ECHO_DELAY = 250

export function looksLikePrompt(text: string): boolean {
  return text.trim() !== '' && PROMPT_END.test(text) && !REPL_PROMPT.test(text)
}

/** Keys that turn the typed word into the candidate: the missing tail, or erase and retype. */
export function acceptKeys(typed: string, candidate: CompletionCandidate): string {
  const open = candidate.keepOpen === true || candidate.text.endsWith('/')
  const tail = open ? '' : ' '
  if (candidate.text.startsWith(typed)) return candidate.text.slice(typed.length) + tail
  return '\x7f'.repeat([...typed].length) + candidate.text + tail
}

/** Input that edits the current line (printable text, Backspace, Ctrl+W). */
function isTyping(data: string): boolean {
  if (data === '\x7f' || data === '\b' || data === '\x17') return true
  for (const char of data) {
    const code = char.charCodeAt(0)
    if (code < 0x20 || code === 0x7f) return false
  }
  return data.length > 0
}

/** Input that ends or abandons the line: Enter, Ctrl+C, Ctrl+D, Ctrl+L. */
function endsLine(data: string): boolean {
  return /[\r\n]/.test(data) || data === '\x03' || data === '\x04' || data === '\x0c'
}

interface Owner {
  accept: (candidate: CompletionCandidate) => void
}

let popup: CompletionPopup | null = null
let owner: Owner | null = null

function sharedPopup(): CompletionPopup {
  popup ??= createCompletionPopup('term-completion', (candidate) => owner?.accept(candidate))
  return popup
}

export interface SuggestHost {
  term: Terminal
  sessionId: () => number | null
  send: (data: string) => void
}

/**
 * Suggestions while typing at a shell prompt. The input starts where the cursor was when the
 * first key of the line was pressed (right after the prompt); lines that don't follow a prompt,
 * full-screen programs and REPLs get nothing.
 */
export function attachSuggestions({ term, sessionId, send }: SuggestHost): IDisposable {
  let anchor: { marker: IMarker; x: number; prompt: boolean } | null = null
  let dirty = false
  let timer = 0
  let request = 0
  let typed: string | null = null
  const self: Owner = { accept }

  const mine = () => owner === self && sharedPopup().visible()

  function hide(): void {
    request++
    typed = null
    window.clearTimeout(timer)
    if (owner !== self) return
    owner = null
    popup?.hide()
  }

  function reset(): void {
    hide()
    anchor?.marker.dispose()
    anchor = null
    dirty = false
  }

  function setAnchor(): void {
    const buffer = term.buffer.active
    if (buffer.type !== 'normal') return
    const line = buffer.getLine(buffer.baseY + buffer.cursorY)
    const before = line?.translateToString(false, 0, buffer.cursorX) ?? ''
    anchor = { marker: term.registerMarker(0), x: buffer.cursorX, prompt: looksLikePrompt(before) }
  }

  /** What has been typed after the prompt, up to the cursor, and whatever follows it. */
  function readInput(): { before: string; after: string } | null {
    const buffer = term.buffer.active
    if (!anchor || buffer.type !== 'normal' || anchor.marker.isDisposed) return null
    const start = anchor.marker.line
    const cursorLine = buffer.baseY + buffer.cursorY
    if (start < 0 || cursorLine < start || cursorLine - start > MAX_ROWS) return null
    if (cursorLine === start && buffer.cursorX < anchor.x) return null
    let before = ''
    for (let i = start; i <= cursorLine; i++) {
      const line = buffer.getLine(i)
      if (!line) return null
      const from = i === start ? anchor.x : 0
      before += line.translateToString(false, from, i === cursorLine ? buffer.cursorX : undefined)
    }
    const after = buffer.getLine(cursorLine)?.translateToString(true, buffer.cursorX) ?? ''
    return { before, after }
  }

  /** The cursor row on screen and the x where a word `back` cells to the left starts. */
  function cursorBox(back: number): { row: DOMRect; x: number } | null {
    const screen = term.element?.querySelector('.xterm-screen')
    if (!screen) return null
    const box = screen.getBoundingClientRect()
    const buffer = term.buffer.active
    const row = buffer.baseY + buffer.cursorY - buffer.viewportY
    if (box.width === 0 || row < 0 || row >= term.rows) return null
    const cellWidth = box.width / term.cols
    const cellHeight = box.height / term.rows
    return {
      row: new DOMRect(box.left, box.top + row * cellHeight, box.width, cellHeight),
      x: box.left + Math.max(0, buffer.cursorX - back) * cellWidth,
    }
  }

  async function update(): Promise<void> {
    dirty = false
    const ticket = ++request
    const input =
      settings().terminal.suggestions && anchor?.prompt && term.textarea === document.activeElement
        ? readInput()
        : null
    if (input?.after.trim() !== '') return hide()
    const result = await suggest(input.before, input.before.length, sessionId(), false)
    if (ticket !== request) return
    const box = result ? cursorBox([...result.token.text].length) : null
    if (!result || result.candidates.length === 0 || !box) return hide()
    typed = input.before.slice(result.token.start)
    owner = self
    sharedPopup().show(result.candidates, box.row, box.x)
  }

  function schedule(delay: number): void {
    window.clearTimeout(timer)
    timer = window.setTimeout(() => void update(), delay)
  }

  function accept(candidate: CompletionCandidate): void {
    if (typed === null) return
    const keys = acceptKeys(typed, candidate)
    hide()
    send(keys)
    // Folders and `--opt=` keep going once the shell has echoed the new text.
    dirty = true
    schedule(NO_ECHO_DELAY)
  }

  const disposables: IDisposable[] = [
    // Pastes and Enter end the line. Terminal replies (cursor reports…) also arrive here, which is
    // why typing is tracked through onKey instead.
    term.onData((data) => {
      if (endsLine(data)) reset()
    }),
    term.onKey(({ key }) => {
      if (endsLine(key)) return
      if (!anchor) setAnchor()
      if (!isTyping(key)) return hide()
      dirty = true
      schedule(NO_ECHO_DELAY)
    }),
    term.onWriteParsed(() => {
      if (dirty) schedule(ECHO_DELAY)
    }),
    // Reflow moves the prompt; the next line starts fresh.
    term.onResize(reset),
    term.buffer.onBufferChange(reset),
  ]

  term.attachCustomKeyEventHandler((event) => {
    if (event.type !== 'keydown' || !mine()) return true
    if (event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) return true
    const list = sharedPopup()
    switch (event.key) {
      case 'ArrowDown':
        list.selectNext()
        break
      case 'ArrowUp':
        list.selectPrev()
        break
      case 'Tab':
      case 'ArrowRight': {
        const candidate = list.current()
        if (candidate) accept(candidate)
        break
      }
      case 'Escape':
        hide()
        break
      default:
        return true
    }
    event.preventDefault()
    event.stopPropagation()
    return false
  })

  const onBlur = () => hide()
  const onPaste = () => {
    if (!anchor) setAnchor()
    hide()
  }
  term.textarea?.addEventListener('blur', onBlur)
  term.textarea?.addEventListener('paste', onPaste)

  return {
    dispose: () => {
      reset()
      term.textarea?.removeEventListener('blur', onBlur)
      term.textarea?.removeEventListener('paste', onPaste)
      for (const d of disposables) d.dispose()
    },
  }
}
