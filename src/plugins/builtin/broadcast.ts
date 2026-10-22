import { messages, pl } from '../../i18n'
import { common } from '../../i18n-common'
import type { MenuItem } from '../../menu'
import { activeSession, allSessions, markTab, type SessionInfo } from '../../sessions'
import type { BuiltinPlugin, Dispose, TerminalHost } from '../api'
import { adaptInput } from './broadcast-input'
import { BUILTIN_VERSION } from './version'

const t = messages({
  broadcastInput: { zh: '广播输入', en: 'Broadcast input', ug: 'ئورتاق كىرگۈزۈش' },
  description: {
    zh: '把在一个终端里键入的内容同时发送到其他选中的终端，适合在多台服务器上执行同样的操作。在标签右键菜单或命令面板里开启。',
    en: 'Sends what you type in one terminal to the other selected terminals at the same time, for doing the same work on several servers. Turn it on from the tab context menu or the command palette.',
    ug: 'بىر تېرمىنالدا كىرگۈزگەن مەزمۇننى تاللانغان باشقا تېرمىناللارغىمۇ بىرلا ۋاقىتتا يوللايدۇ، بىر قانچە مۇلازىمېتىردا ئوخشاش مەشغۇلات قىلىشقا ماس كېلىدۇ. بەتكۈچنىڭ ئوڭ كۇنۇپكا تىزىملىكى ياكى بۇيرۇق تاختىسىدىن ئاچقىلى بولىدۇ.',
  },
  tabMark: { zh: '广播', en: 'Broadcast', ug: 'ئورتاق' },
  statusText: {
    zh: '广播输入 · {n} 个终端',
    en: (p) => `Broadcast input · ${pl('terminal')(p)}`,
    ug: 'ئورتاق كىرگۈزۈش · {n} تېرمىنال',
  },
  statusTitle: {
    zh: '在带“广播”标记的终端里键入，会同时发送到其他带标记的终端。点击停止广播。',
    en: 'Typing in a terminal marked Broadcast also sends it to the other marked terminals. Click to stop broadcasting.',
    ug: '«ئورتاق» بەلگىسى بار تېرمىنالدا كىرگۈزگەن مەزمۇن بەلگىسى بار باشقا تېرمىناللارغىمۇ يوللىنىدۇ. چەكسىڭىز ئورتاق كىرگۈزۈش توختايدۇ.',
  },
  toggle: {
    zh: '广播输入：当前终端加入或退出',
    en: 'Broadcast input: add or remove current terminal',
    ug: 'ئورتاق كىرگۈزۈش: نۆۋەتتىكى تېرمىنالنى قوش ياكى چىقار',
  },
  allCommand: {
    zh: '广播输入：所有已连接的终端',
    en: 'Broadcast input: all connected terminals',
    ug: 'ئورتاق كىرگۈزۈش: ئۇلانغان بارلىق تېرمىناللار',
  },
  allMenu: {
    zh: '广播到所有已连接的终端',
    en: 'Broadcast to all connected terminals',
    ug: 'ئۇلانغان بارلىق تېرمىناللارغا ئورتاق كىرگۈزۈش',
  },
  stop: { zh: '停止广播输入', en: 'Stop broadcast input', ug: 'ئورتاق كىرگۈزۈشنى توختات' },
})

const KINDS = ['local', 'ssh', 'telnet', 'serial']
const MARK = 'broadcast'

const eligible = (info: SessionInfo | null | undefined): info is SessionInfo =>
  !!info && KINDS.includes(info.kind) && info.state === 'live'

export const broadcastPlugin: BuiltinPlugin = {
  manifest: {
    id: 'gx.broadcast',
    name: t('broadcastInput'),
    version: BUILTIN_VERSION,
    description: t('description'),
  },
  activate(ctx) {
    /** Tab keys, so membership survives a reconnect. */
    const members = new Set<number>()
    const hosts = new Set<TerminalHost>()
    let status: Dispose | null = null

    const keyOfSession = (id: number | null) =>
      id === null ? null : (allSessions().find((info) => info.id === id)?.key ?? null)

    const update = () => {
      const open = new Set(allSessions().map((info) => info.key))
      for (const key of members) if (!open.has(key)) members.delete(key)
      for (const key of open) markTab(key, MARK, members.has(key) ? t('tabMark') : null)
      status?.()
      status = null
      if (members.size === 0) return
      status = ctx.statusBar.set({
        id: 'broadcast',
        text: t('statusText', { n: members.size }),
        icon: 'keyboard',
        tone: 'warn',
        title: t('statusTitle'),
        command: 'broadcast.stop',
        priority: 10,
      })
    }

    const toggle = (key: number | null) => {
      if (key === null) return
      if (members.has(key)) members.delete(key)
      else members.add(key)
      update()
    }

    const forward = (source: TerminalHost, data: string) => {
      const from = keyOfSession(source.sessionId())
      if (from === null || !members.has(from)) return
      for (const host of hosts) {
        if (host === source) continue
        const key = keyOfSession(host.sessionId())
        if (key === null || key === from || !members.has(key)) continue
        host.send(adaptInput(data, source.term.modes, host.term.modes))
      }
    }

    ctx.terminal.addon({
      kinds: KINDS,
      attach: (host) => {
        hosts.add(host)
        const off = host.onInput((data) => forward(host, data))
        return () => {
          off()
          hosts.delete(host)
          // A closing tab disposes its terminal before it leaves the tab list.
          queueMicrotask(update)
        }
      },
    })

    ctx.commands.register({
      id: 'broadcast.toggle',
      title: t('toggle'),
      category: common('terminal'),
      icon: 'keyboard',
      enabled: () => eligible(activeSession()),
      run: () => toggle(activeSession()?.key ?? null),
    })
    ctx.commands.register({
      id: 'broadcast.all',
      title: t('allCommand'),
      category: common('terminal'),
      icon: 'keyboard',
      enabled: () => allSessions().filter(eligible).length > 1,
      run: () => {
        for (const info of allSessions()) if (eligible(info)) members.add(info.key)
        update()
      },
    })
    ctx.commands.register({
      id: 'broadcast.stop',
      title: t('stop'),
      category: common('terminal'),
      icon: 'stop',
      enabled: () => members.size > 0,
      run: () => {
        members.clear()
        update()
      },
    })

    const item = (sessionId: number | null): MenuItem[] => {
      const key = keyOfSession(sessionId)
      return [
        {
          label: t('broadcastInput'),
          checked: key !== null && members.has(key),
          disabled: key === null,
          action: () => toggle(key),
        },
      ]
    }
    ctx.menus.contribute('tab/context', ({ sessionId, kind }) =>
      KINDS.includes(kind) ? item(sessionId) : [],
    )
    ctx.menus.contribute('terminal/context', ({ sessionId }) => item(sessionId))
    ctx.menus.contribute('tabs/background', () => [
      {
        label: t('allMenu'),
        icon: 'keyboard',
        disabled: allSessions().filter(eligible).length < 2,
        action: () => void ctx.commands.run('broadcast.all'),
      },
      {
        label: t('stop'),
        icon: 'stop',
        disabled: members.size === 0,
        action: () => void ctx.commands.run('broadcast.stop'),
      },
    ])

    ctx.subscriptions.add(() => {
      members.clear()
      update()
    })
  },
}
