import { invoke } from '@tauri-apps/api/core'
import { logApp } from '../applog'
import { h } from '../dom'
import { messages } from '../i18n'
import { icon } from '../icons'
import type { Layout, PanelHost } from '../layout'
import { panels } from '../plugins/registry'
import { activeSession, allSessions, logName, onActive, type SessionInfo } from '../sessions'
import { onSettings, settings } from '../settings-store'
import type { ActiveTab, TabKind } from './model'
import { statusPanel } from './panel'
import { initStatusStore, onStatusChange, statusTrack, statusWatched } from './store'
import type { Report } from './widgets'

const t = messages({
  monitorFailed: {
    zh: '{name} 状态监控读取失败：{error}',
    en: 'Status monitoring for {name} failed to read: {error}',
    ug: '{name} نىڭ ھالەت كۆزىتىشى ئوقۇش مەغلۇپ بولدى: {error}',
  },
  monitorRecovered: {
    zh: '{name} 状态监控已恢复',
    en: 'Status monitoring for {name} recovered',
    ug: '{name} نىڭ ھالەت كۆزىتىشى ئەسلىگە كەلدى',
  },
  advancedTitle: {
    zh: '在独立窗口中查看该服务器的详细状态',
    en: "Show this server's detailed status in a separate window",
    ug: 'بۇ مۇلازىمېتىرنىڭ تەپسىلىي ھالىتىنى ئايرىم كۆزنەكتە كۆرسەت',
  },
  advanced: { zh: '高级', en: 'Advanced', ug: 'ئالىي' },
})

function tabOf(info: SessionInfo | null): TabKind {
  if (!info) return 'none'
  if (info.kind !== 'ssh') return 'local'
  if (info.state === 'connecting') return 'connecting'
  return info.state === 'live' ? 'live' : 'ended'
}

/** Logs when a server's status stops being readable and when it recovers, not every failed poll. */
function logMonitorHealth(): void {
  const failing = new Set<number>()
  onStatusChange((change) => {
    if (change === null) return
    const info = allSessions().find((i) => i.id === change)
    const error = statusTrack(change)?.error ?? null
    if (info?.state !== 'live') {
      failing.delete(change)
      return
    }
    if (error && !failing.has(change)) {
      failing.add(change)
      logApp('warn', t('monitorFailed', { name: logName(info), error }))
    } else if (!error && failing.delete(change)) {
      logApp('info', t('monitorRecovered', { name: logName(info) }))
    }
  })
}

export interface MainStatusPanel extends PanelHost {
  /** Hides the panel while the visible tab's server has its advanced window open. */
  attach(layout: Layout): void
}

/**
 * The main window's status panel. Only this window knows which tab is visible, so it tells the
 * backend, which relays it to every status view and polls only the session on screen.
 */
export function mainStatusPanel(report: Report): MainStatusPanel {
  const advancedButton = h(
    'button',
    {
      type: 'button',
      class: 'button small quiet',
      title: t('advancedTitle'),
      onclick: () => {
        const info = activeSession()
        if (info?.id == null) return
        invoke('status_window_open', { sessionId: info.id, title: info.title }).catch(report)
      },
    },
    icon('chart-line'),
    h('span', { text: t('advanced') }),
  )
  const view = statusPanel(report, [advancedButton])

  let sent = ''
  const sync = () => {
    const info = activeSession()
    const docked =
      panels.list().some((p) => p.id === 'status') &&
      settings().layout.panels.some((p) => p.id === 'status' && p.region !== 'hidden')
    const active: ActiveTab = {
      sessionId: info?.id ?? null,
      tab: tabOf(info),
      monitored: info?.ssh?.monitor ?? false,
      paused: !docked,
    }
    advancedButton.disabled = active.tab !== 'live' || !active.monitored
    const key = JSON.stringify(active)
    if (key === sent) return
    sent = key
    invoke('monitor_set_active', { active }).catch(report)
  }

  onActive(sync)
  onSettings(sync)
  panels.subscribe(sync)
  sync()

  return {
    ...view,
    attach(layout) {
      const follow = () => {
        const id = activeSession()?.id
        layout.suppress('status', id != null && statusWatched().has(id))
      }
      onActive(follow)
      onStatusChange((change) => {
        if (change === null) follow()
      })
      logMonitorHealth()
      initStatusStore().then(follow).catch(report)
    },
  }
}
