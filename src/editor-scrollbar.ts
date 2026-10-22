import { syntaxTree } from '@codemirror/language'
import { forEachDiagnostic } from '@codemirror/lint'
import { getSearchQuery, type SearchQuery, searchPanelOpen } from '@codemirror/search'
import {
  ChangeSet,
  type EditorState,
  type Extension,
  StateEffect,
  type Text,
} from '@codemirror/state'
import { EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view'
import { classHighlighter, highlightTree } from '@lezer/highlight'

// VS Code's layout: text | minimap | scrollbar with an overview ruler drawn in it.
const RAIL = 14
const HBAR = 10
const MINIMAP = 90
const MINI_LINE = 2
const MINI_COLUMNS = MINIMAP
const MAX_MATCHES = 2000
const MIN_THUMB = 20

/** Forgets the changes so far, e.g. after the file is reopened with another encoding. */
export const resetChangeMarks = StateEffect.define<null>()

const TOKEN_COLORS: [string, string][] = [
  ['tok-comment', 'comment'],
  ['tok-string', 'string'],
  ['tok-keyword', 'keyword'],
  ['tok-number', 'number'],
  ['tok-bool', 'storage'],
  ['tok-atom', 'storage'],
  ['tok-typeName', 'type'],
  ['tok-className', 'type'],
  ['tok-namespace', 'type'],
  ['tok-propertyName', 'property'],
  ['tok-tagName', 'tag'],
  ['tok-attributeName', 'attribute'],
  ['tok-variableName', 'variable'],
  ['tok-meta', 'meta'],
  ['tok-operator', 'operator'],
  ['tok-punctuation', 'operator'],
]

type Colors = Record<string, string>

function readColors(dom: HTMLElement): Colors {
  const css = getComputedStyle(dom)
  const get = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback
  const text = css.color
  const colors: Colors = {
    text,
    error: get('--gx-danger', 'red'),
    warning: get('--gx-warning', 'orange'),
    change: get('--gx-accent', text),
    match: get('--gx-syn-match-border', get('--gx-warning', 'orange')),
  }
  for (const [, syn] of TOKEN_COLORS) colors[syn] = get(`--gx-syn-${syn}`, text)
  return colors
}

function tokenColor(classes: string, colors: Colors): string {
  for (const [cls, syn] of TOKEN_COLORS) if (classes.includes(cls)) return colors[syn]
  return colors.text
}

/** Follows the pointer until it is released; `move` gets the offset from the press. */
function drag(event: PointerEvent, move: (dx: number, dy: number) => void): void {
  const target = event.currentTarget as HTMLElement
  const { clientX, clientY, pointerId } = event
  target.setPointerCapture(pointerId)
  const onMove = (e: PointerEvent) => move(e.clientX - clientX, e.clientY - clientY)
  const onUp = () => {
    target.removeEventListener('pointermove', onMove)
    target.removeEventListener('pointerup', onUp)
    target.removeEventListener('pointercancel', onUp)
    target.classList.remove('cm-gx-dragging')
  }
  target.classList.add('cm-gx-dragging')
  target.addEventListener('pointermove', onMove)
  target.addEventListener('pointerup', onUp)
  target.addEventListener('pointercancel', onUp)
}

const sizeCanvas = (canvas: HTMLCanvasElement, width: number, height: number) => {
  const ratio = window.devicePixelRatio || 1
  const w = Math.max(1, Math.round(width * ratio))
  const h = Math.max(1, Math.round(height * ratio))
  if (canvas.width !== w) canvas.width = w
  if (canvas.height !== h) canvas.height = h
  canvas.style.height = `${height}px`
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
  ctx.clearRect(0, 0, width, height)
  return ctx
}

class Scrollbars {
  readonly rail = document.createElement('div')
  readonly marks = document.createElement('canvas')
  readonly thumb = document.createElement('div')
  readonly hbar = document.createElement('div')
  readonly hthumb = document.createElement('div')
  readonly minimap: HTMLDivElement | null
  readonly miniCanvas = document.createElement('canvas')
  readonly miniSlider = document.createElement('div')
  changed: ChangeSet
  frame = 0
  matches: number[] = []
  matchDoc: Text | null = null
  matchQuery: SearchQuery | null = null
  // Geometry of the last paint, for the pointer handlers.
  thumbSize = 0
  miniStart = 0
  miniSliderSize = 0
  miniHeight = 0
  readonly schedule = () => {
    if (!this.frame) this.frame = requestAnimationFrame(() => this.paint())
  }

  constructor(
    readonly view: EditorView,
    withMinimap: boolean,
  ) {
    this.changed = ChangeSet.empty(view.state.doc.length)
    this.rail.className = 'cm-gx-rail'
    this.rail.setAttribute('aria-hidden', 'true')
    this.marks.className = 'cm-gx-marks'
    this.thumb.className = 'cm-gx-thumb'
    this.rail.append(this.marks, this.thumb)
    this.hbar.className = 'cm-gx-hbar'
    this.hbar.setAttribute('aria-hidden', 'true')
    this.hthumb.className = 'cm-gx-thumb'
    this.hbar.append(this.hthumb)
    view.dom.append(this.rail, this.hbar)
    this.minimap = withMinimap ? document.createElement('div') : null
    if (this.minimap) {
      this.minimap.className = 'cm-gx-minimap'
      this.minimap.setAttribute('aria-hidden', 'true')
      this.miniSlider.className = 'cm-gx-minimap-slider'
      this.minimap.append(this.miniCanvas, this.miniSlider)
      view.dom.append(this.minimap)
      this.minimap.addEventListener('pointerdown', this.onMinimap)
      this.minimap.addEventListener('wheel', this.onWheel, { passive: false })
    }
    this.rail.addEventListener('pointerdown', this.onRail)
    this.rail.addEventListener('wheel', this.onWheel, { passive: false })
    this.hbar.addEventListener('pointerdown', this.onHbar)
    view.scrollDOM.addEventListener('scroll', this.schedule, { passive: true })
    this.schedule()
  }

  update(update: ViewUpdate) {
    if (update.transactions.some((tr) => tr.effects.some((e) => e.is(resetChangeMarks)))) {
      this.changed = ChangeSet.empty(update.state.doc.length)
    } else if (update.docChanged) {
      this.changed = this.changed.compose(update.changes)
    }
    this.schedule()
  }

  destroy() {
    cancelAnimationFrame(this.frame)
    this.view.scrollDOM.removeEventListener('scroll', this.schedule)
    this.rail.remove()
    this.hbar.remove()
    this.minimap?.remove()
  }

  /** Pixels from the top of the scrolled content to the first line. */
  docOffset(): number {
    const s = this.view.scrollDOM
    return this.view.documentTop - s.getBoundingClientRect().top + s.scrollTop
  }

  paint() {
    this.frame = 0
    const { view } = this
    const s = view.scrollDOM
    if (!s.isConnected || s.clientHeight === 0) return
    const top = s.offsetTop
    const height = s.clientHeight
    const colors = readColors(view.dom)
    const offset = this.docOffset()
    for (const el of [this.rail, this.minimap]) {
      if (!el) continue
      el.style.top = `${top}px`
      el.style.height = `${height}px`
    }

    const maxY = s.scrollHeight - s.clientHeight
    this.thumbSize = Math.max(MIN_THUMB, (height * s.clientHeight) / s.scrollHeight)
    this.thumb.hidden = maxY <= 1
    if (maxY > 1) {
      this.thumb.style.height = `${this.thumbSize}px`
      this.thumb.style.transform = `translateY(${(s.scrollTop / maxY) * (height - this.thumbSize)}px)`
    }

    const gutters = view.dom.querySelector<HTMLElement>('.cm-gutters')
    const left = gutters ? gutters.offsetWidth : 0
    const maxX = s.scrollWidth - s.clientWidth
    this.hbar.hidden = maxX <= 1
    if (maxX > 1) {
      const track = s.clientWidth - left
      const size = Math.max(MIN_THUMB, (track * s.clientWidth) / s.scrollWidth)
      this.hbar.style.top = `${top + height - HBAR}px`
      this.hbar.style.left = `${left}px`
      this.hbar.style.width = `${track}px`
      this.hthumb.style.width = `${size}px`
      this.hthumb.style.transform = `translateX(${(s.scrollLeft / maxX) * (track - size)}px)`
    }

    this.paintMarks(height, offset, colors)
    if (this.minimap) this.paintMinimap(height, offset, colors)
  }

  paintMarks(height: number, offset: number, colors: Colors) {
    const { state } = this.view
    const ctx = sizeCanvas(this.marks, RAIL, height)
    const total = Math.max(1, this.view.scrollDOM.scrollHeight)
    const y = (pos: number) => ((this.view.lineBlockAt(pos).top + offset) / total) * height
    const mark = (from: number, to: number, x: number, w: number, color: string) => {
      const a = y(from)
      const b = to > from ? y(to) + 1 : a
      ctx.fillStyle = color
      ctx.fillRect(x, Math.min(a, height - 2), w, Math.max(2, b - a))
    }
    this.changed.iterChangedRanges((_fa, _ta, from, to) => mark(from, to, 0, 4, colors.change))
    for (const pos of this.searchMatches(state)) mark(pos, pos, 4, 6, colors.match)
    forEachDiagnostic(state, (d, from, to) => {
      mark(from, to, 9, 5, d.severity === 'error' ? colors.error : colors.warning)
    })
    ctx.globalAlpha = 0.7
    mark(state.selection.main.head, state.selection.main.head, 0, RAIL, colors.text)
    ctx.globalAlpha = 1
  }

  searchMatches(state: EditorState): number[] {
    if (!searchPanelOpen(state)) return []
    const query = getSearchQuery(state)
    if (!query.valid || !query.search) return []
    if (this.matchDoc === state.doc && this.matchQuery?.eq(query)) return this.matches
    this.matchDoc = state.doc
    this.matchQuery = query
    this.matches = []
    const cursor = query.getCursor(state)
    for (let next = cursor.next(); !next.done && this.matches.length < MAX_MATCHES; ) {
      this.matches.push(next.value.from)
      next = cursor.next()
    }
    return this.matches
  }

  paintMinimap(height: number, offset: number, colors: Colors) {
    const { view } = this
    const { doc, tabSize } = view.state
    const s = view.scrollDOM
    const ctx = sizeCanvas(this.miniCanvas, MINIMAP, height)
    const fit = Math.floor(height / MINI_LINE)
    const maxY = s.scrollHeight - s.clientHeight
    const frac = maxY > 0 ? s.scrollTop / maxY : 0
    // A long file scrolls inside the minimap in step with the editor.
    this.miniStart = doc.lines > fit ? Math.round(frac * (doc.lines - fit)) : 0
    this.miniHeight = Math.min(height, doc.lines * MINI_LINE)
    const first = doc.lineAt(view.lineBlockAtHeight(Math.max(0, s.scrollTop - offset)).from)
    const last = doc.lineAt(
      view.lineBlockAtHeight(Math.max(0, s.scrollTop + s.clientHeight - offset - 1)).to,
    )
    this.miniSliderSize = Math.max(MINI_LINE * 2, (last.number - first.number + 1) * MINI_LINE)
    this.miniSlider.style.height = `${this.miniSliderSize}px`
    this.miniSlider.style.transform = `translateY(${(first.number - 1 - this.miniStart) * MINI_LINE}px)`

    const tree = syntaxTree(view.state)
    ctx.globalAlpha = 0.75
    const end = Math.min(doc.lines, this.miniStart + fit)
    for (let n = this.miniStart + 1; n <= end; n++) {
      const line = doc.line(n)
      const to = Math.min(line.to, line.from + MINI_COLUMNS * 2)
      const spans: [number, number, string][] = []
      highlightTree(tree, classHighlighter, (f, t, c) => spans.push([f, t, c]), line.from, to)
      const rowY = (n - 1 - this.miniStart) * MINI_LINE
      let col = 0
      let span = 0
      for (let pos = line.from; pos < to && col < MINI_COLUMNS; pos++) {
        const ch = doc.sliceString(pos, pos + 1)
        if (ch === '\t') {
          col += tabSize - (col % tabSize)
          continue
        }
        if (ch !== ' ') {
          while (span < spans.length && spans[span][1] <= pos) span++
          const s0 = spans[span]
          ctx.fillStyle = s0 && s0[0] <= pos ? tokenColor(s0[2], colors) : colors.text
          ctx.fillRect(col, rowY, 1, MINI_LINE - 0.5)
        }
        col++
      }
    }
    ctx.globalAlpha = 1
  }

  scrollTo(top: number) {
    this.view.scrollDOM.scrollTop = top
  }

  readonly onWheel = (event: WheelEvent) => {
    event.preventDefault()
    const s = this.view.scrollDOM
    s.scrollTop += event.deltaY
    s.scrollLeft += event.deltaX
  }

  readonly onRail = (event: PointerEvent) => {
    if (event.button !== 0) return
    event.preventDefault()
    const s = this.view.scrollDOM
    const height = s.clientHeight
    const maxY = s.scrollHeight - s.clientHeight
    if (maxY <= 1) return
    const room = Math.max(1, height - this.thumbSize)
    if (event.target !== this.thumb) {
      // Jump so the thumb centres on the click, then keep dragging from there.
      const y = event.clientY - this.rail.getBoundingClientRect().top
      this.scrollTo(((y - this.thumbSize / 2) / room) * maxY)
    }
    const start = s.scrollTop
    drag(event, (_dx, dy) => this.scrollTo(start + (dy / room) * maxY))
  }

  readonly onHbar = (event: PointerEvent) => {
    if (event.button !== 0) return
    event.preventDefault()
    const s = this.view.scrollDOM
    const track = this.hbar.clientWidth
    const size = this.hthumb.offsetWidth
    const maxX = s.scrollWidth - s.clientWidth
    const room = Math.max(1, track - size)
    if (event.target !== this.hthumb) {
      const x = event.clientX - this.hbar.getBoundingClientRect().left
      s.scrollLeft = ((x - size / 2) / room) * maxX
    }
    const start = s.scrollLeft
    drag(event, (dx) => {
      s.scrollLeft = start + (dx / room) * maxX
    })
  }

  readonly onMinimap = (event: PointerEvent) => {
    if (event.button !== 0 || !this.minimap) return
    event.preventDefault()
    const { view } = this
    const s = view.scrollDOM
    const maxY = s.scrollHeight - s.clientHeight
    if (event.target !== this.miniSlider) {
      const y = event.clientY - this.minimap.getBoundingClientRect().top
      const n = Math.min(view.state.doc.lines, this.miniStart + Math.floor(y / MINI_LINE) + 1)
      const block = view.lineBlockAt(view.state.doc.line(n).from)
      this.scrollTo(block.top + this.docOffset() - s.clientHeight / 2)
    }
    if (maxY <= 0) return
    const start = s.scrollTop
    const room = Math.max(1, this.miniHeight - this.miniSliderSize)
    drag(event, (_dx, dy) => this.scrollTo(start + (dy / room) * maxY))
  }
}

const scrollbarTheme = EditorView.theme({
  '&.cm-gx-scrollbars .cm-scroller': { scrollbarWidth: 'none', marginRight: `${RAIL}px` },
  '&.cm-gx-scrollbars.cm-gx-has-minimap .cm-scroller': { marginRight: `${RAIL + MINIMAP}px` },
  '.cm-gx-rail': {
    position: 'absolute',
    right: '0',
    width: `${RAIL}px`,
    borderLeft: '1px solid var(--gx-border)',
    boxSizing: 'border-box',
    zIndex: '3',
    touchAction: 'none',
  },
  '.cm-gx-marks': { position: 'absolute', inset: '0', width: '100%', pointerEvents: 'none' },
  '.cm-gx-thumb': {
    position: 'absolute',
    top: '0',
    left: '0',
    right: '0',
    backgroundColor: 'color-mix(in oklab, var(--gx-text) 16%, transparent)',
    transition: 'background-color 0.15s var(--gx-ease)',
  },
  '.cm-gx-rail:hover .cm-gx-thumb, .cm-gx-hbar:hover .cm-gx-thumb': {
    backgroundColor: 'color-mix(in oklab, var(--gx-text) 26%, transparent)',
  },
  '.cm-gx-dragging .cm-gx-thumb': {
    backgroundColor: 'color-mix(in oklab, var(--gx-text) 36%, transparent)',
  },
  '.cm-gx-hbar': {
    position: 'absolute',
    height: `${HBAR}px`,
    zIndex: '3',
    touchAction: 'none',
  },
  '.cm-gx-hbar .cm-gx-thumb': { bottom: '0', right: 'auto', borderRadius: '2px' },
  '.cm-gx-minimap': {
    position: 'absolute',
    right: `${RAIL}px`,
    width: `${MINIMAP}px`,
    overflow: 'hidden',
    cursor: 'default',
    backgroundColor: 'var(--gx-surface-0)',
    boxShadow: '-1px 0 0 var(--gx-border)',
    zIndex: '2',
    touchAction: 'none',
  },
  '.cm-gx-minimap canvas': { display: 'block', width: '100%', pointerEvents: 'none' },
  '.cm-gx-minimap-slider': {
    position: 'absolute',
    top: '0',
    left: '0',
    right: '0',
    backgroundColor: 'color-mix(in oklab, var(--gx-text) 7%, transparent)',
    transition: 'background-color 0.15s var(--gx-ease)',
  },
  '.cm-gx-minimap:hover .cm-gx-minimap-slider': {
    backgroundColor: 'color-mix(in oklab, var(--gx-text) 13%, transparent)',
  },
  '.cm-gx-minimap.cm-gx-dragging .cm-gx-minimap-slider': {
    backgroundColor: 'color-mix(in oklab, var(--gx-text) 20%, transparent)',
  },
})

const railOnly = ViewPlugin.define((view) => new Scrollbars(view, false), {
  provide: () => EditorView.editorAttributes.of({ class: 'cm-gx-scrollbars' }),
})
const withMinimap = ViewPlugin.define((view) => new Scrollbars(view, true), {
  provide: () => EditorView.editorAttributes.of({ class: 'cm-gx-scrollbars cm-gx-has-minimap' }),
})

/** VS Code-style scrollbars: overview ruler marks, a thin horizontal bar and an optional minimap. */
export function scrollbars(minimap: boolean): Extension {
  return [minimap ? withMinimap : railOnly, scrollbarTheme]
}
