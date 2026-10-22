import type { Advanced, AuthMethod } from './protocol'

/** How to reopen a tab. Ad-hoc connections carry no password; reconnecting asks again. */
export type TabTarget =
  | { kind: 'local'; shell: string }
  | { kind: 'profile'; profileId: string }
  | {
      kind: 'adhoc'
      title: string
      name: string
      host: string
      port: number
      method: AuthMethod
      user: string
      keyPath: string
      advanced: Advanced
    }

export type SavedTab = TabTarget & { fontSize: number | null }

export interface SavedTabs {
  tabs: SavedTab[]
  /** Index into `tabs` of the tab that was in front. */
  active: number | null
}

export interface OpenTab {
  key: number
  target: TabTarget | null
  fontSize: number | null
}

/** Tabs without a target (benchmarks) are left out; `active` follows the front tab if it stays. */
export function snapshotTabs(open: readonly OpenTab[], activeKey: number | null): SavedTabs {
  const kept = open.filter((tab): tab is OpenTab & { target: TabTarget } => tab.target !== null)
  const index = kept.findIndex((tab) => tab.key === activeKey)
  return {
    tabs: kept.map((tab) => ({ ...tab.target, fontSize: tab.fontSize })),
    active: index < 0 ? null : index,
  }
}
