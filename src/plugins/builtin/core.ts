import { invoke } from '@tauri-apps/api/core'
import { openAppLog } from '../../applog'
import { buildInfo, exportDiagnostics } from '../../diagnostics'
import { openDownloads } from '../../download-manager'
import { messages } from '../../i18n'
import { common } from '../../i18n-common'
import { loadShells } from '../../local-shells'
import type { PaneDirection } from '../../panes'
import { openServerDialog } from '../../server-dialog'
import {
  activeSession,
  canSplit,
  focusPane,
  isSplit,
  openLocal,
  splitTab,
  unsplitTab,
} from '../../sessions'
import { openSettings } from '../../settings'
import { setTheme } from '../../theme'
import type { BuiltinPlugin, CommandDef } from '../api'
import { openPalette } from '../palette'
import { BUILTIN_VERSION } from './version'

const t = messages({
  name: { zh: '基础命令', en: 'Core commands', ug: 'ئاساسىي بۇيرۇقلار' },
  description: {
    zh: '命令面板、设置、下载管理、通用日志、诊断包、新建连接、本地终端和分屏。',
    en: 'Command palette, settings, downloads, app log, diagnostics package, new connection, local terminal and split panes.',
    ug: 'بۇيرۇق تاختىسى، تەڭشەك، چۈشۈرۈش باشقۇرغۇچ، ئومۇمىي خاتىرە، دىئاگنوز بولىقى، يېڭى ئۇلىنىش، يەرلىك تېرمىنال ۋە ئېكران بۆلۈش.',
  },
  palette: { zh: '命令面板', en: 'Command palette', ug: 'بۇيرۇق تاختىسى' },
  settings: { zh: '打开设置', en: 'Open settings', ug: 'تەڭشەكنى ئاچ' },
  plugins: { zh: '管理插件', en: 'Manage plugins', ug: 'قىستۇرمىلارنى باشقۇر' },
  downloads: { zh: '下载管理', en: 'Downloads', ug: 'چۈشۈرۈش باشقۇرغۇچ' },
  appLog: { zh: '通用日志', en: 'App log', ug: 'ئومۇمىي خاتىرە' },
  about: { zh: '关于 GladosXshell', en: 'About GladosXshell', ug: 'GladosXshell ھەققىدە' },
  diagnostics: {
    zh: '导出诊断包',
    en: 'Export diagnostics package',
    ug: 'دىئاگنوز بولىقىنى چىقار',
  },
  openLocal: { zh: '打开本地终端', en: 'Open local terminal', ug: 'يەرلىك تېرمىنال ئاچ' },
  openShell: {
    zh: '新建本地终端：{name}',
    en: 'New local terminal: {name}',
    ug: 'يېڭى يەرلىك تېرمىنال: {name}',
  },
  splitRight: { zh: '向右分屏', en: 'Split right', ug: 'ئوڭغا بۆل' },
  splitDown: { zh: '向下分屏', en: 'Split down', ug: 'ئاستىغا بۆل' },
  unsplit: { zh: '移出分屏', en: 'Unsplit', ug: 'بۆلۈشتىن چىقار' },
  focusLeft: { zh: '切换到左侧分屏', en: 'Focus left pane', ug: 'سول بۆلەككە ئۆت' },
  focusRight: { zh: '切换到右侧分屏', en: 'Focus right pane', ug: 'ئوڭ بۆلەككە ئۆت' },
  focusUp: { zh: '切换到上方分屏', en: 'Focus pane above', ug: 'ئۈستىدىكى بۆلەككە ئۆت' },
  focusDown: { zh: '切换到下方分屏', en: 'Focus pane below', ug: 'ئاستىدىكى بۆلەككە ئۆت' },
  theme: { zh: '主题', en: 'Theme', ug: 'ئۆرنەك' },
  dark: { zh: '深色', en: 'Dark', ug: 'قېنىق' },
  light: { zh: '浅色', en: 'Light', ug: 'سۇس' },
  auto: { zh: '跟随系统', en: 'Same as Windows', ug: 'Windows غا ئەگىشىدۇ' },
  devtools: { zh: '打开开发者工具', en: 'Open developer tools', ug: 'ئاچقۇچىلار قورالىنى ئاچ' },
})

const PANE_MOVES: [PaneDirection, string][] = [
  ['left', t('focusLeft')],
  ['right', t('focusRight')],
  ['up', t('focusUp')],
  ['down', t('focusDown')],
]

async function splitActive(dir: 'row' | 'column'): Promise<void> {
  const key = activeSession()?.key
  // A failed connection stays visible in its pane.
  if (key !== undefined) await splitTab(key, dir).catch(() => {})
}

export const core: BuiltinPlugin = {
  manifest: {
    id: 'gx.core',
    name: t('name'),
    version: BUILTIN_VERSION,
    description: t('description'),
    required: true,
  },
  activate(ctx) {
    const defs: CommandDef[] = [
      { id: 'app.palette', title: t('palette'), icon: 'command', run: openPalette },
      { id: 'app.settings', title: t('settings'), icon: 'gear', run: () => openSettings() },
      {
        id: 'app.plugins',
        title: t('plugins'),
        icon: 'puzzle-piece',
        run: () => openSettings('plugins'),
      },
      {
        id: 'app.downloads',
        title: t('downloads'),
        icon: 'download-simple',
        run: () => openDownloads({ type: 'global' }),
      },
      { id: 'app.applog', title: t('appLog'), icon: 'article', run: openAppLog },
      {
        id: 'app.about',
        title: t('about'),
        icon: 'info',
        run: () => openSettings('about'),
      },
      {
        id: 'app.diagnostics',
        title: t('diagnostics'),
        icon: 'package',
        run: exportDiagnostics,
      },
      {
        id: 'session.newServer',
        title: common('newConnection'),
        icon: 'plus',
        category: common('session'),
        run: () => openServerDialog(null),
      },
      {
        id: 'session.openLocal',
        title: t('openLocal'),
        icon: 'terminal',
        category: common('session'),
        run: () => openLocal(),
      },
      {
        id: 'session.splitRight',
        title: t('splitRight'),
        icon: 'columns',
        category: common('session'),
        enabled: () => canSplit(activeSession()?.key ?? null),
        run: () => splitActive('row'),
      },
      {
        id: 'session.splitDown',
        title: t('splitDown'),
        icon: 'rows',
        category: common('session'),
        enabled: () => canSplit(activeSession()?.key ?? null),
        run: () => splitActive('column'),
      },
      {
        id: 'session.unsplit',
        title: t('unsplit'),
        icon: 'corners-out',
        category: common('session'),
        enabled: () => isSplit(activeSession()?.key ?? null),
        run: () => {
          const key = activeSession()?.key
          if (key !== undefined) unsplitTab(key)
        },
      },
      ...PANE_MOVES.map(
        ([direction, title]): CommandDef => ({
          id: `session.focusPane.${direction}`,
          title,
          category: common('session'),
          enabled: () => isSplit(activeSession()?.key ?? null),
          run: () => void focusPane(direction),
        }),
      ),
      {
        id: 'theme.dark',
        title: t('dark'),
        icon: 'moon',
        category: t('theme'),
        run: () => setTheme('dark'),
      },
      {
        id: 'theme.light',
        title: t('light'),
        icon: 'sun',
        category: t('theme'),
        run: () => setTheme('light'),
      },
      {
        id: 'theme.auto',
        title: t('auto'),
        icon: 'desktop',
        category: t('theme'),
        run: () => setTheme('auto'),
      },
    ]
    for (const def of defs) ctx.commands.register(def)
    void loadShells().then((shells) => {
      for (const shell of shells) {
        ctx.commands.register({
          id: `session.openShell.${shell.id}`,
          title: t('openShell', { name: shell.name }),
          icon: 'terminal',
          category: common('session'),
          run: () => openLocal(shell.id),
        })
      }
    })
    void buildInfo().then((info) => {
      if (!info.devtools) return
      ctx.commands.register({
        id: 'app.devtools',
        title: t('devtools'),
        icon: 'wrench',
        run: () => invoke('devtools_open'),
      })
    })
    ctx.keybindings.register({ key: 'Ctrl+Shift+P', command: 'app.palette' })
    ctx.keybindings.register({ key: 'Ctrl+,', command: 'app.settings' })
    ctx.keybindings.register({ key: 'Ctrl+Shift+E', command: 'session.splitRight' })
    ctx.keybindings.register({ key: 'Ctrl+Shift+O', command: 'session.splitDown' })
    // Only taken while the front tab is split; otherwise the keys reach the shell.
    for (const [direction] of PANE_MOVES) {
      const key = `Alt+${direction[0].toUpperCase()}${direction.slice(1)}`
      ctx.keybindings.register({ key, command: `session.focusPane.${direction}` })
    }
  },
}
