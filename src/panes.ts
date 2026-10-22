/** Terminals shown side by side: a binary tree whose leaves are tab keys. */
export type PaneTree = { key: number } | { dir: SplitDir; ratio: number; a: PaneTree; b: PaneTree }

/** `row` puts the two halves left and right, `column` top and bottom. */
export type SplitDir = 'row' | 'column'

export const MIN_RATIO = 0.1

export function clampRatio(ratio: number): number {
  return Math.min(1 - MIN_RATIO, Math.max(MIN_RATIO, ratio))
}

/** Leaf keys in reading order. */
export function paneKeys(tree: PaneTree): number[] {
  return 'key' in tree ? [tree.key] : [...paneKeys(tree.a), ...paneKeys(tree.b)]
}

/** Splits the pane `at`, putting `add` after it (right of or below). */
export function splitPane(tree: PaneTree, at: number, add: number, dir: SplitDir): PaneTree {
  if ('key' in tree) {
    return tree.key === at ? { dir, ratio: 0.5, a: tree, b: { key: add } } : tree
  }
  return { ...tree, a: splitPane(tree.a, at, add, dir), b: splitPane(tree.b, at, add, dir) }
}

/** The tree without `key`; its sibling takes the freed space. Null when nothing is left. */
export function removePane(tree: PaneTree, key: number): PaneTree | null {
  if ('key' in tree) return tree.key === key ? null : tree
  const a = removePane(tree.a, key)
  const b = removePane(tree.b, key)
  if (a === null) return b
  if (b === null) return a
  return { ...tree, a, b }
}

export interface PaneRect {
  key: number
  left: number
  top: number
  right: number
  bottom: number
}

export type PaneDirection = 'left' | 'right' | 'up' | 'down'

/** The pane next to `from` in a direction: it must overlap on the other axis; nearest wins. */
export function paneToward(
  rects: readonly PaneRect[],
  from: number,
  direction: PaneDirection,
): number | null {
  const start = rects.find((r) => r.key === from)
  if (!start) return null
  const horizontal = direction === 'left' || direction === 'right'
  let best: { key: number; gap: number; offset: number } | null = null
  for (const r of rects) {
    if (r.key === from) continue
    const overlaps = horizontal
      ? r.top < start.bottom && r.bottom > start.top
      : r.left < start.right && r.right > start.left
    if (!overlaps) continue
    const gap =
      direction === 'left'
        ? start.left - r.right
        : direction === 'right'
          ? r.left - start.right
          : direction === 'up'
            ? start.top - r.bottom
            : r.top - start.bottom
    // Splitter lines sit between panes, so neighbours are a pixel or two apart.
    if (gap < -2) continue
    const offset = horizontal ? Math.abs(r.top - start.top) : Math.abs(r.left - start.left)
    if (!best || gap < best.gap || (gap === best.gap && offset < best.offset)) {
      best = { key: r.key, gap, offset }
    }
  }
  return best?.key ?? null
}
