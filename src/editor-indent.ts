/** Columns of leading whitespace, or null for a blank line. */
export function leadingColumns(text: string, tabSize: number): number | null {
  let col = 0
  for (const ch of text) {
    if (ch === ' ') col += 1
    else if (ch === '\t') col += tabSize - (col % tabSize)
    else return col
  }
  return null
}

/** Tabs if most indented lines start with one, else the most common space step, else `fallback`. */
export function detectIndentUnit(text: string, fallback: number): string {
  let tabs = 0
  let spaced = 0
  const steps = new Map<number, number>()
  let previous = 0
  for (const line of text.split('\n', 5000)) {
    if (line.trim() === '') continue
    if (line.startsWith('\t')) tabs += 1
    else if (line.startsWith(' ')) spaced += 1
    const width = line.length - line.trimStart().length
    const step = Math.abs(width - previous)
    if (!line.startsWith('\t') && step >= 2 && step <= 8)
      steps.set(step, (steps.get(step) ?? 0) + 1)
    previous = line.startsWith('\t') ? previous : width
  }
  if (tabs > spaced) return '\t'
  let best = 0
  let count = 0
  for (const [step, seen] of steps) {
    if (seen > count || (seen === count && step < best)) [best, count] = [step, seen]
  }
  return ' '.repeat(best || fallback)
}
