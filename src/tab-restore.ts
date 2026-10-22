import { invoke } from '@tauri-apps/api/core'
import { loadShells } from './local-shells'
import { profiles, serverTitle } from './profiles-store'
import type { SavedTab, SavedTabs } from './saved-tabs'
import {
  allSessions,
  onTabsChanged,
  openAdhoc,
  openLocal,
  openProfile,
  openTabs,
  selectTab,
} from './sessions'
import { settings } from './settings-store'

const SAVE_DELAY_MS = 300

type Report = (error: unknown) => void

/** Opens one saved tab; false when it can no longer be opened (its server was deleted). */
function reopen(tab: SavedTab): boolean {
  // A failed connection stays visible in its tab, so the rejection needs no further report.
  const quiet = () => {}
  switch (tab.kind) {
    case 'local':
      openLocal(tab.shell, tab.fontSize).catch(quiet)
      return true
    case 'profile': {
      const server = profiles().servers.find((s) => s.id === tab.profileId)
      if (!server) return false
      openProfile(server, serverTitle(server), tab.fontSize).catch(quiet)
      return true
    }
    case 'adhoc':
      openAdhoc(
        {
          name: tab.name,
          host: tab.host,
          port: tab.port,
          auth: { method: tab.method, user: tab.user, keyPath: tab.keyPath, secret: null },
          advanced: tab.advanced,
          proxyPassword: null,
        },
        tab.title,
        tab.fontSize,
      ).catch(quiet)
      return true
  }
}

/**
 * Reopens the tabs from the last run (when the setting is on), then keeps the saved list in step
 * with the tab bar. Call once profiles have loaded.
 */
export async function restoreTabs(report: Report): Promise<void> {
  let timer: number | null = null
  const save = () => {
    if (timer !== null) clearTimeout(timer)
    timer = window.setTimeout(() => {
      timer = null
      invoke('tabs_save', { tabs: openTabs() }).catch(report)
    }, SAVE_DELAY_MS)
  }
  try {
    if (!settings().terminal.restoreTabs) return
    const saved = await invoke<SavedTabs>('tabs_get')
    if (saved.tabs.length === 0) return
    if (saved.tabs.some((tab) => tab.kind === 'local')) await loadShells()
    let front: number | null = null
    saved.tabs.forEach((tab, index) => {
      if (!reopen(tab)) return
      if (index === saved.active) front = allSessions().at(-1)?.key ?? null
    })
    if (front !== null) selectTab(front)
  } finally {
    onTabsChanged(save)
    save()
  }
}
