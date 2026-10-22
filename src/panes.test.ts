import { describe, expect, it } from 'vitest'
import { clampRatio, type PaneRect, paneKeys, paneToward, removePane, splitPane } from './panes'

describe('pane tree', () => {
  it('splits a leaf in place and lists keys in reading order', () => {
    let tree = splitPane({ key: 1 }, 1, 2, 'row')
    tree = splitPane(tree, 1, 3, 'column')
    expect(paneKeys(tree)).toEqual([1, 3, 2])
    expect(tree).toEqual({
      dir: 'row',
      ratio: 0.5,
      a: { dir: 'column', ratio: 0.5, a: { key: 1 }, b: { key: 3 } },
      b: { key: 2 },
    })
  })

  it('collapses the parent when a pane is removed', () => {
    const tree = splitPane(splitPane({ key: 1 }, 1, 2, 'row'), 2, 3, 'column')
    expect(removePane(tree, 2)).toEqual({ dir: 'row', ratio: 0.5, a: { key: 1 }, b: { key: 3 } })
    expect(removePane(removePane(tree, 2) ?? { key: 0 }, 1)).toEqual({ key: 3 })
    expect(removePane({ key: 1 }, 1)).toBeNull()
    expect(removePane(tree, 9)).toEqual(tree)
  })

  it('keeps ratios away from the edges', () => {
    expect(clampRatio(0)).toBe(0.1)
    expect(clampRatio(1)).toBe(0.9)
    expect(clampRatio(0.3)).toBe(0.3)
  })
})

describe('paneToward', () => {
  // 1 | 2
  // --+--
  // 3 | 2
  const rects: PaneRect[] = [
    { key: 1, left: 0, top: 0, right: 100, bottom: 50 },
    { key: 2, left: 101, top: 0, right: 200, bottom: 100 },
    { key: 3, left: 0, top: 51, right: 100, bottom: 100 },
  ]

  it('finds the neighbour that overlaps on the other axis', () => {
    expect(paneToward(rects, 1, 'right')).toBe(2)
    expect(paneToward(rects, 1, 'down')).toBe(3)
    expect(paneToward(rects, 3, 'up')).toBe(1)
    expect(paneToward(rects, 2, 'left')).toBe(1)
  })

  it('returns null at the edge', () => {
    expect(paneToward(rects, 1, 'left')).toBeNull()
    expect(paneToward(rects, 2, 'right')).toBeNull()
    expect(paneToward(rects, 9, 'right')).toBeNull()
  })
})
