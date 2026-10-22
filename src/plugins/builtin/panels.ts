import { commandsPanel } from '../../commands-panel'
import { connectionsPanel, openManager } from '../../connections'
import { filesPanel, showFolder } from '../../files'
import { messages } from '../../i18n'
import { common } from '../../i18n-common'
import { openImportDialog } from '../../import-dialog'
import type { Layout } from '../../layout'
import { PANEL_NAMES } from '../../settings-model'
import { mainStatusPanel } from '../../status/main-window'
import type { Report } from '../../status/widgets'
import type { BuiltinPlugin } from '../api'
import { BUILTIN_VERSION } from './version'

const t = messages({
  statusName: { zh: '状态面板', en: 'Status panel', ug: 'ھالەت تاختىسى' },
  statusDescription: {
    zh: '服务器的 CPU、内存、磁盘、网络和进程，以及独立的高级状态窗口。',
    en: 'CPU, memory, disks, network and processes on the server, plus a separate advanced status window.',
    ug: 'مۇلازىمېتىرنىڭ CPU، ئىچكى ساقلىغۇچ، دىسكا، تور ۋە جەريانلىرى، شۇنداقلا ئايرىم ئالىي ھالەت كۆزنىكى.',
  },
  filesName: { zh: '文件面板', en: 'Files panel', ug: 'ھۆججەت تاختىسى' },
  filesDescription: {
    zh: '浏览、上传、下载和编辑服务器上的文件。',
    en: 'Browse, upload, download and edit files on the server.',
    ug: 'مۇلازىمېتىردىكى ھۆججەتلەرنى كۆرۈش، يۈكلەش، چۈشۈرۈش ۋە تەھرىرلەش.',
  },
  commandsName: { zh: '指令台', en: 'Commands', ug: 'بۇيرۇقلار' },
  commandsDescription: {
    zh: '收藏的常用指令和分组，可以一键发送到当前终端。',
    en: 'Saved commands in groups, sent to the current terminal with one click.',
    ug: 'ساقلانغان دائىملىق بۇيرۇقلار ۋە گۇرۇپپىلار، بىر چېكىپلا نۆۋەتتىكى تېرمىنالغا يوللىغىلى بولىدۇ.',
  },
  connectionsName: { zh: '连接管理', en: 'Connections', ug: 'ئۇلىنىش باشقۇرۇش' },
  connectionsDescription: {
    zh: '服务器列表面板和连接管理器窗口。',
    en: 'The server list panel and the connection manager window.',
    ug: 'مۇلازىمېتىر تىزىملىكى تاختىسى ۋە ئۇلىنىش باشقۇرغۇچ كۆزنىكى.',
  },
  openManager: {
    zh: '打开连接管理器',
    en: 'Open connection manager',
    ug: 'ئۇلىنىش باشقۇرغۇچنى ئاچ',
  },
  importConnections: {
    zh: '从其他软件导入连接',
    en: 'Import connections from other apps',
    ug: 'باشقا يۇمشاق دېتاللاردىن ئۇلىنىش ئەكىر',
  },
})

export function statusPlugin(layout: Layout, report: Report): BuiltinPlugin {
  return {
    manifest: {
      id: 'gx.status',
      name: t('statusName'),
      version: BUILTIN_VERSION,
      description: t('statusDescription'),
    },
    activate(ctx) {
      ctx.panels.register({
        id: 'status',
        title: PANEL_NAMES.status,
        icon: 'gauge',
        build: () => {
          const panel = mainStatusPanel(report)
          panel.attach(layout)
          return panel
        },
      })
    },
  }
}

export const filesPlugin: BuiltinPlugin = {
  manifest: {
    id: 'gx.files',
    name: t('filesName'),
    version: BUILTIN_VERSION,
    description: t('filesDescription'),
  },
  activate(ctx) {
    ctx.panels.register({
      id: 'files',
      title: PANEL_NAMES.files,
      icon: 'folder-simple',
      build: filesPanel,
    })
    ctx.services.provide('files', { show: showFolder })
  },
}

export const commandsPlugin: BuiltinPlugin = {
  manifest: {
    id: 'gx.commands',
    name: t('commandsName'),
    version: BUILTIN_VERSION,
    description: t('commandsDescription'),
  },
  activate(ctx) {
    ctx.panels.register({
      id: 'commands',
      title: PANEL_NAMES.commands,
      icon: 'terminal-window',
      build: commandsPanel,
    })
  },
}

export const connectionsPlugin: BuiltinPlugin = {
  manifest: {
    id: 'gx.connections',
    name: t('connectionsName'),
    version: BUILTIN_VERSION,
    description: t('connectionsDescription'),
  },
  activate(ctx) {
    ctx.panels.register({
      id: 'connections',
      title: PANEL_NAMES.connections,
      icon: 'hard-drives',
      build: connectionsPanel,
    })
    ctx.commands.register({
      id: 'connections.manager',
      title: t('openManager'),
      icon: 'plugs-connected',
      category: common('session'),
      run: openManager,
    })
    ctx.commands.register({
      id: 'connections.import',
      title: t('importConnections'),
      icon: 'download-simple',
      category: common('session'),
      run: openImportDialog,
    })
    ctx.keybindings.register({ key: 'Ctrl+Shift+N', command: 'connections.manager' })
  },
}
