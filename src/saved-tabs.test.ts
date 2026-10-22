import { describe, expect, it } from 'vitest'
import { snapshotTabs } from './saved-tabs'

describe('snapshotTabs', () => {
  const local = { kind: 'local', shell: 'pwsh' } as const
  const profile = { kind: 'profile', profileId: 'p1' } as const

  it('keeps order and font sizes, skipping tabs that cannot be reopened', () => {
    const saved = snapshotTabs(
      [
        { key: 1, target: local, fontSize: 18 },
        { key: 2, target: null, fontSize: null },
        { key: 3, target: profile, fontSize: null },
      ],
      3,
    )
    expect(saved).toEqual({
      tabs: [
        { kind: 'local', shell: 'pwsh', fontSize: 18 },
        { kind: 'profile', profileId: 'p1', fontSize: null },
      ],
      active: 1,
    })
  })

  it('has no front tab when the active one is not saved', () => {
    expect(snapshotTabs([{ key: 2, target: null, fontSize: null }], 2).active).toBeNull()
    expect(snapshotTabs([], null)).toEqual({ tabs: [], active: null })
  })
})
