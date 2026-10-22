/**
 * How well `query` matches `text` as a case-insensitive subsequence; null when it does not.
 * Runs of adjacent letters, word starts and an early first hit score higher.
 */
export function fuzzyScore(query: string, text: string): number | null {
  const q = query.trim().toLowerCase()
  if (!q) return 0
  const t = text.toLowerCase()
  let score = 0
  let from = 0
  let previous = -2
  for (const char of q) {
    if (char === ' ') continue
    const at = t.indexOf(char, from)
    if (at < 0) return null
    score += 1
    if (at === previous + 1) score += 3
    // i18n-ignore: word separators in the text being matched, Chinese punctuation included
    if (at === 0 || /[\s\-_./:：（(]/.test(t[at - 1])) score += 2
    if (previous < 0) score -= Math.min(at, 10) * 0.1
    previous = at
    from = at + 1
  }
  return score - t.length * 0.01
}

/** The items matching `query`, best first; ties keep their order. */
export function fuzzyFilter<T>(items: readonly T[], query: string, text: (item: T) => string): T[] {
  const scored: { item: T; score: number; index: number }[] = []
  items.forEach((item, index) => {
    const score = fuzzyScore(query, text(item))
    if (score !== null) scored.push({ item, score, index })
  })
  return scored.sort((a, b) => b.score - a.score || a.index - b.index).map((s) => s.item)
}
