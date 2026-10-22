import { writeText } from '@tauri-apps/plugin-clipboard-manager'
import { $, h, reportError } from './dom'
import { onRecords, recordsIn } from './downloads'
import { ltr, messages, pl } from './i18n'
import { namedIcon } from './icons'
import { type MenuItem, showMenu } from './menu'
import { command, menuItems, runCommand } from './plugins/registry'
import { activeSession, activeTerminal, onActive, type SessionInfo } from './sessions'

const report = reportError

const t = messages({
  starting: { zh: '启动中', en: 'Starting', ug: 'قوزغىلىۋاتىدۇ' },
  connecting: { zh: '连接中', en: 'Connecting', ug: 'ئۇلىنىۋاتىدۇ' },
  connected: { zh: '已连接', en: 'Connected', ug: 'ئۇلاندى' },
  crashed: { zh: '异常退出', en: 'Exited unexpectedly', ug: 'نورمالسىز چېكىندى' },
  disconnected: { zh: '已断开', en: 'Disconnected', ug: 'ئۈزۈلدى' },
  exited: { zh: '已退出', en: 'Exited', ug: 'چېكىندى' },
  ended: { zh: '已结束', en: 'Ended', ug: 'ئاخىرلاشتى' },
  startFailed: { zh: '启动失败', en: 'Failed to start', ug: 'قوزغىتالمىدى' },
  connectFailed: { zh: '连接失败', en: 'Connection failed', ug: 'ئۇلىنالمىدى' },
  localTerminal: { zh: '本地终端', en: 'Local terminal', ug: 'يەرلىك تېرمىنال' },
  sizeTitle: {
    zh: '终端大小（列 × 行）',
    en: 'Terminal size (columns × rows)',
    ug: 'تېرمىنال چوڭلۇقى (ستون × قۇر)',
  },
  openDownloads: { zh: '打开下载管理', en: 'Open downloads', ug: 'چۈشۈرۈش باشقۇرغۇچنى ئاچ' },
  transfersTitle: {
    zh: '{n} 个下载进行中，点击打开下载管理',
    en: (p) => `${pl('download')(p)} in progress. Click to open downloads.`,
    ug: '{n} چۈشۈرۈش داۋاملىشىۋاتىدۇ، چېكىپ چۈشۈرۈش باشقۇرغۇچنى ئېچىڭ',
  },
  transfers: { zh: '下载 {n}', en: 'Downloads {n}', ug: 'چۈشۈرۈش {n}' },
  copyStatus: { zh: '复制状态文字', en: 'Copy status text', ug: 'ھالەت تېكىستىنى كۆچۈر' },
  downloads: { zh: '下载管理', en: 'Downloads', ug: 'چۈشۈرۈش باشقۇرغۇچ' },
  appLog: { zh: '应用日志', en: 'App log', ug: 'ئومۇمىي خاتىرە' },
  palette: { zh: '命令面板', en: 'Command palette', ug: 'بۇيرۇق تاختىسى' },
})

function stateText(info: SessionInfo): string {
  const local = info.kind === 'local'
  switch (info.state) {
    case 'connecting':
      return t(local ? 'starting' : 'connecting')
    case 'live':
      return local ? '' : t('connected')
    case 'ended':
      if (info.lost) return t(local ? 'crashed' : 'disconnected')
      return t(local ? 'exited' : 'ended')
    case 'failed':
      return t(local ? 'startFailed' : 'connectFailed')
  }
}

const STATE_TONE: Record<SessionInfo['state'], string> = {
  connecting: '',
  live: '',
  ended: 'warn',
  failed: 'error',
}

const KIND_ICON: Partial<Record<SessionInfo['kind'], string>> = {
  ssh: 'hard-drives',
  telnet: 'network',
  serial: 'plug',
}

function endpoint(info: SessionInfo): string {
  if (info.kind === 'local') return t('localTerminal')
  return info.target ?? info.title
}

function run(id: string): void {
  runCommand(id).catch(report)
}

function commandItem(label: string, icon: string, id: string): MenuItem {
  return { label, icon, disabled: !command(id), action: () => run(id) }
}

/** Active session, terminal size and running transfers, plus the status bar's own menu. */
export function initStatusBar(): void {
  const bar = $('status')
  const info = $('status-info')
  const footer = bar.parentElement as HTMLElement
  let stopResize: (() => void) | null = null

  const session = h('span', { class: 'statusbar-item' })
  const size = h('span', { class: 'statusbar-item', title: t('sizeTitle') })
  const transfers = h('button', {
    type: 'button',
    class: 'statusbar-item',
    title: t('openDownloads'),
    onclick: () => run('app.downloads'),
  })

  const renderSize = () => {
    const terminal = activeTerminal()
    size.hidden = !terminal
    if (terminal) size.textContent = ltr(`${terminal.cols} × ${terminal.rows}`)
  }

  const renderSession = () => {
    const current = activeSession()
    session.hidden = !current
    if (current) {
      const state = stateText(current)
      const where = endpoint(current)
      session.dataset.tone =
        current.state === 'ended' && !current.lost ? '' : STATE_TONE[current.state]
      session.title = [ltr(current.title), where !== current.title ? ltr(where) : '', state]
        .filter(Boolean)
        .join(' · ')
      const shown = ltr(where)
      session.replaceChildren(
        namedIcon(KIND_ICON[current.kind] ?? 'terminal'),
        h('span', { class: 'statusbar-item-text', text: state ? `${shown} · ${state}` : shown }),
      )
    }
    stopResize?.()
    stopResize = activeTerminal()?.onResize(renderSize) ?? null
    renderSize()
  }

  const renderTransfers = () => {
    const running = recordsIn({ type: 'global' }).filter((r) => r.state === 'running').length
    transfers.hidden = running === 0
    transfers.title = t('transfersTitle', { n: running })
    transfers.replaceChildren(
      namedIcon('download-simple'),
      h('span', { class: 'statusbar-item-text', text: t('transfers', { n: running }) }),
    )
  }

  info.append(transfers, session, size)
  renderSession()
  renderTransfers()
  onActive(renderSession)
  onRecords(renderTransfers)

  // The text is cut off when long; the tooltip shows all of it.
  new MutationObserver(() => {
    bar.title = bar.textContent ?? ''
  }).observe(bar, { childList: true, characterData: true, subtree: true })

  footer.addEventListener('contextmenu', (event) => {
    event.preventDefault()
    const text = bar.textContent ?? ''
    showMenu(event.clientX, event.clientY, [
      {
        label: t('copyStatus'),
        icon: 'copy',
        disabled: !text,
        action: () => writeText(text).catch(report),
      },
      'separator',
      commandItem(t('downloads'), 'download-simple', 'app.downloads'),
      commandItem(t('appLog'), 'article', 'app.applog'),
      commandItem(t('palette'), 'command', 'app.palette'),
      ...menuItems('statusbar', { text }),
    ])
  })
}
