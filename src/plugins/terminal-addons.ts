import type { IBufferLine, IDisposable, ILink, IMarker, Terminal } from '@xterm/xterm'
import { messages } from '../i18n'
import type { HighlightRule, LinkRule, TerminalAddon } from './api'

const t = messages({
  hint: {
    zh: 'Ctrl+单击打开',
    en: 'Ctrl+click to open',
    ug: 'ئېچىش ئۈچۈن Ctrl نى بېسىپ تۇرۇپ چېكىڭ',
  },
  hintWith: {
    zh: '{tooltip}，Ctrl+单击打开',
    en: '{tooltip} (Ctrl+click to open)',
    ug: '{tooltip}، ئېچىش ئۈچۈن Ctrl نى بېسىپ تۇرۇپ چېكىڭ',
  },
})

const MAX_PER_LINE = 24
/** Lines scanned per write at most; a burst of output only gets its tail highlighted. */
export const MAX_LINES_PER_PASS = 1000

export interface CellText {
  text: string
  /** Cell column of each UTF-16 unit of `text`. */
  columns: number[]
  /** Cell width of each UTF-16 unit. */
  widths: number[]
}

export function cellText(line: IBufferLine, term: Terminal): CellText {
  const out: CellText = { text: '', columns: [], widths: [] }
  const reuse = term.buffer.active.getNullCell()
  for (let x = 0; x < line.length; x++) {
    const cell = line.getCell(x, reuse)
    if (!cell || cell.getWidth() === 0) continue
    const chars = cell.getChars() || ' '
    out.text += chars
    for (let i = 0; i < chars.length; i++) {
      out.columns.push(x)
      out.widths.push(cell.getWidth())
    }
  }
  return out
}

export const everyMatch = (pattern: RegExp) =>
  pattern.global ? pattern : new RegExp(pattern.source, `${pattern.flags}g`)

/** Matches as cell ranges: [first column, width in cells, matched text]. */
export function* cellMatches(
  cells: CellText,
  pattern: RegExp,
): Generator<[number, number, string]> {
  let count = 0
  for (const match of cells.text.matchAll(pattern)) {
    if (match[0].length === 0 || match.index === undefined) continue
    const first = match.index
    const lastUnit = first + match[0].length - 1
    const start = cells.columns[first]
    const end = cells.columns[lastUnit] + cells.widths[lastUnit]
    yield [start, end - start, match[0]]
    if (++count >= MAX_PER_LINE) return
  }
}

/** Colours matching text in finished output lines (normal buffer only; colours are #rrggbb). */
export function highlightAddon(rules: HighlightRule[]): TerminalAddon {
  const patterns = rules.map((rule) => ({ ...rule, pattern: everyMatch(rule.pattern) }))
  return {
    attach: ({ term }) => {
      const markers = new Set<IMarker>()
      let done: IMarker | undefined
      const decorate = (y: number, cursor: number) => {
        const line = term.buffer.active.getLine(y)
        if (!line) return
        const cells = cellText(line, term)
        if (cells.text.trim() === '') return
        for (const rule of patterns) {
          for (const [x, width] of cellMatches(cells, rule.pattern)) {
            const marker = term.registerMarker(y - cursor)
            if (!marker) continue
            markers.add(marker)
            marker.onDispose(() => markers.delete(marker))
            term.registerDecoration({
              marker,
              x,
              width,
              foregroundColor: rule.foreground,
              backgroundColor: rule.background,
            })
          }
        }
      }
      const scan = () => {
        const buffer = term.buffer.active
        if (buffer.type === 'alternate') return
        const cursor = buffer.baseY + buffer.cursorY
        // A marker keeps its line while old output is trimmed from the top.
        const resume = done && !done.isDisposed && done.line >= 0 ? done.line : cursor - term.rows
        const from = Math.max(0, resume, cursor - MAX_LINES_PER_PASS)
        for (let y = from; y < cursor; y++) decorate(y, cursor)
        done?.dispose()
        done = term.registerMarker(0)
      }
      const subscription = term.onWriteParsed(scan)
      return () => {
        subscription.dispose()
        done?.dispose()
        for (const marker of [...markers]) marker.dispose()
      }
    },
  }
}

/** Ctrl+click links for text matching the rule. */
export function linkAddon(rule: LinkRule): TerminalAddon {
  const pattern = everyMatch(rule.pattern)
  const hint = rule.tooltip ? t('hintWith', { tooltip: rule.tooltip }) : t('hint')
  return {
    attach: ({ term, sessionId }) => {
      const provider: IDisposable = term.registerLinkProvider({
        provideLinks(y, callback) {
          const line = term.buffer.active.getLine(y - 1)
          if (!line) return callback(undefined)
          const links: ILink[] = []
          for (const [x, width, text] of cellMatches(cellText(line, term), pattern)) {
            links.push({
              range: { start: { x: x + 1, y }, end: { x: x + width, y } },
              text,
              activate(event, linkText) {
                if (event.ctrlKey || event.metaKey) rule.open(linkText, sessionId())
              },
              hover() {
                if (term.element) term.element.title = hint
              },
              leave() {
                if (term.element) term.element.title = ''
              },
            })
          }
          callback(links.length > 0 ? links : undefined)
        },
      })
      return () => provider.dispose()
    },
  }
}
