import { captureUiErrors } from './applog'
import { initCommandBar } from './command-bar'
import { initContextMenus } from './context-menu'
import { offerCrashReport } from './diagnostics'
import { $, reportError, STATUS_IDLE, setStatus } from './dom'
import { loadHistory } from './history'
import { fillStatic, messages } from './i18n'
import { type IconName, icon } from './icons'
import { mountLayout } from './layout'
import { builtinPlugins } from './plugins/builtin'
import { loadExternalPlugins } from './plugins/external'
import {
  activateBuiltins,
  bindPanels,
  bindStatusItems,
  bindThemeTokens,
  initKeybindings,
} from './plugins/host'
import { menuItems, runCommand } from './plugins/registry'
import { reloadProfiles } from './profiles-store'

import { initScale } from './scale'
import { initSessions, refitActive } from './sessions'
import { loadSettings, loadUserCss } from './settings-store'
import { initStatusBar } from './statusbar'
import { restoreTabs } from './tab-restore'
import { initTerminalFonts } from './terminal-fonts'
import { initTerminalMenu } from './terminal-menu'
import { initTheme } from './theme'

const report = reportError

/** The main window's static text (index.html), plus what start-up itself reports. */
const t = messages({
  manager: { zh: '连接管理器', en: 'Connection manager', ug: 'ئۇلىنىش باشقۇرغۇچ' },
  openManager: {
    zh: '打开连接管理器',
    en: 'Open connection manager',
    ug: 'ئۇلىنىش باشقۇرغۇچنى ئاچ',
  },
  newConnection: { zh: '新建连接', en: 'New connection', ug: 'يېڭى ئۇلىنىش' },
  localTerminal: { zh: '本地终端', en: 'Local terminal', ug: 'يەرلىك تېرمىنال' },
  commandBar: { zh: '指令栏', en: 'Command bar', ug: 'بۇيرۇق بالدىقى' },
  downloads: { zh: '下载管理', en: 'Downloads', ug: 'چۈشۈرۈش باشقۇرغۇچ' },
  appLog: { zh: '通用日志', en: 'App log', ug: 'ئومۇمىي خاتىرە' },
  palette: { zh: '命令', en: 'Commands', ug: 'بۇيرۇقلار' },
  settings: { zh: '设置', en: 'Settings', ug: 'تەڭشەك' },
  sessions: { zh: '会话', en: 'Sessions', ug: 'ئەڭگىمەلەر' },
  leftPanel: { zh: '左侧面板', en: 'Left panel', ug: 'سول تاختا' },
  rightPanel: { zh: '右侧面板', en: 'Right panel', ug: 'ئوڭ تاختا' },
  bottomPanel: { zh: '底部面板', en: 'Bottom panel', ug: 'ئاستى تاختا' },
  resizeLeft: {
    zh: '调整左侧面板宽度',
    en: 'Resize left panel',
    ug: 'سول تاختىنىڭ كەڭلىكىنى تەڭشە',
  },
  resizeRight: {
    zh: '调整右侧面板宽度',
    en: 'Resize right panel',
    ug: 'ئوڭ تاختىنىڭ كەڭلىكىنى تەڭشە',
  },
  resizeBottom: {
    zh: '调整底部面板高度',
    en: 'Resize bottom panel',
    ug: 'ئاستى تاختىنىڭ ئېگىزلىكىنى تەڭشە',
  },
  commandInput: { zh: '指令输入', en: 'Command input', ug: 'بۇيرۇق كىرگۈزۈش' },
  emptyTitle: { zh: '开始一个会话', en: 'Start a session', ug: 'ئەڭگىمە باشلاش' },
  emptyText: {
    zh: '从连接管理器选择服务器，或者新建一个连接。也可以先打开本地终端。',
    en: 'Pick a server in the connection manager or create a new connection. You can also open a local terminal first.',
    ug: 'ئۇلىنىش باشقۇرغۇچتىن مۇلازىمېتىر تاللاڭ ياكى يېڭى ئۇلىنىش قۇرۇڭ. ئالدى بىلەن يەرلىك تېرمىنال ئاچسىڭىزمۇ بولىدۇ.',
  },
  pluginOff: {
    zh: '这个功能所在的插件已停用，可以在 设置 → 插件 中启用。',
    en: 'The plugin for this feature is turned off. Turn it on in Settings → Plugins.',
    ug: 'بۇ ئىقتىدارغا تەۋە قىستۇرما چەكلەنگەن، تەڭشەك ← قىستۇرما دا قوزغىتالايسىز.',
  },
  settingsUnreadable: {
    zh: '设置文件无法读取，已使用默认设置：{error}',
    en: "Couldn't read the settings file, using defaults: {error}",
    ug: 'تەڭشەك ھۆججىتىنى ئوقۇغىلى بولمىدى، كۆڭۈلدىكى تەڭشەك ئىشلىتىلدى: {error}',
  },
})

/** Toolbar and empty-state buttons run commands, so they follow the plugins that own them. */
const BUTTONS: [string[], string, IconName][] = [
  [['open-manager', 'empty-manager'], 'connections.manager', 'hard-drives'],
  [['new-server', 'empty-new'], 'session.newServer', 'plus'],
  [['open-local', 'empty-local'], 'session.openLocal', 'terminal'],
  [['open-palette'], 'app.palette', 'command'],
  [['open-settings'], 'app.settings', 'gear'],
  [['open-downloads'], 'app.downloads', 'download-simple'],
  [['open-applog'], 'app.applog', 'article'],
]

function bindButtons(): void {
  $('toggle-command-bar').prepend(icon('terminal-window'))
  for (const [ids, command, name] of BUTTONS) {
    for (const id of ids) {
      const button = $(id)
      button.prepend(icon(name))
      button.addEventListener('click', () => {
        runCommand(command)
          .then((ran) => {
            if (!ran) setStatus(t('pluginOff'), 'error')
          })
          .catch(report)
      })
    }
  }
}

/**
 * English and Uyghur labels outgrow a narrow window: then the tools after the spacer, and if that
 * is not enough every toolbar button, show only their icons, with the label as a tooltip.
 */
function fitToolbar(toolbar: HTMLElement): void {
  const buttons = [...toolbar.querySelectorAll<HTMLButtonElement>('.button')]
  const spacer = toolbar.querySelector('.toolbar-spacer')
  const labels = new Map(buttons.map((b) => [b, b.textContent?.trim() ?? '']))
  const overflows = () => {
    const box = toolbar.getBoundingClientRect()
    return buttons.some((b) => {
      const r = b.getBoundingClientRect()
      return r.left < box.left || r.right > box.right
    })
  }
  const fit = () => {
    for (const level of ['', 'tools', 'icons']) {
      toolbar.dataset.fit = level
      if (!overflows()) break
    }
    const level = toolbar.dataset.fit
    for (const [button, label] of labels) {
      const afterSpacer =
        spacer !== null &&
        (spacer.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
      const iconOnly = level === 'icons' || (level === 'tools' && afterSpacer)
      button.title = iconOnly ? label : ''
      if (iconOnly) button.setAttribute('aria-label', label)
      else button.removeAttribute('aria-label')
    }
  }
  // The window, not the toolbar: fitting changes the toolbar's own size.
  new ResizeObserver(fit).observe(document.documentElement)
}

async function start(): Promise<void> {
  // First, before bindButtons prepends icons and anything else reads these elements.
  fillStatic(t)
  $('status').textContent = STATUS_IDLE
  captureUiErrors()
  initContextMenus({ textItems: (context) => menuItems('text/context', context) })
  const settingsError = await loadSettings()
  if (settingsError) setStatus(t('settingsUnreadable', { error: settingsError }), 'error')
  initTheme()
  bindThemeTokens()
  initScale(report).catch(report)
  loadUserCss().catch(report)
  const profilesLoaded = reloadProfiles().catch(report)
  initTerminalFonts(report)

  loadHistory().catch(report)

  initSessions($('tabs'), $('terminals'), $('empty'))
  initTerminalMenu($('terminals'))
  initCommandBar($('command-bar'), $('toggle-command-bar'))
  const layout = mountLayout($('shell'), report)
  activateBuiltins(builtinPlugins(layout, report))
  bindPanels(layout)
  bindStatusItems($('status-items'))
  initStatusBar()
  initKeybindings()
  bindButtons()
  const toolbar = document.querySelector<HTMLElement>('.toolbar')
  if (toolbar) fitToolbar(toolbar)
  loadExternalPlugins().catch(report)
  profilesLoaded.then(() => restoreTabs(report)).catch(report)
  offerCrashReport().catch(report)

  new ResizeObserver(() => refitActive()).observe($('terminals'))
}

start().catch(report)
