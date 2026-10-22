import { invoke } from '@tauri-apps/api/core'
import { button, confirmDialog } from '../../dialogs'
import { h } from '../../dom'
import { formatBytes, formatTime } from '../../format'
import { ltr, messages, pl } from '../../i18n'
import { common } from '../../i18n-common'
import { activeSession, allSessions } from '../../sessions'
import { openSettings } from '../../settings'
import type { Section } from '../../settings-layout'
import type { BuiltinPlugin, Dispose, PluginContext, TerminalHost } from '../api'
import { type CastEntry, castName, EventBuffer, formatClock } from './recording-model'
import { playRecording } from './recording-player'
import { BUILTIN_VERSION } from './version'

const t = messages({
  terminalRecording: { zh: '终端录像', en: 'Terminal recording', ug: 'تېرمىنال سىنى' },
  description: {
    zh: '把终端显示的内容按时间录成 asciicast 文件，可以在应用里回放、调速、拖动进度。在设置的“{section}”分区里管理。',
    en: 'Records what the terminal shows, with timing, as asciicast files. Play them back in the app, change the speed and seek. Manage them under {section} in settings.',
    ug: 'تېرمىنالدا كۆرۈنگەن مەزمۇننى ۋاقىت بويىچە asciicast ھۆججىتىگە سىنغا ئالىدۇ، پروگراممىدا قويۇش، تېزلىكىنى تەڭشەش ۋە ئورنىنى سۆرەش مۇمكىن. تەڭشەكتىكى «{section}» بۆلىكىدە باشقۇرۇلىدۇ.',
  },
  recordings: { zh: '录像', en: 'Recordings', ug: 'سىنلار' },
  category: { zh: '录像', en: 'Recording', ug: 'سىن' },
  writeFailed: {
    zh: '录像「{name}」已停止：{error}',
    en: 'Recording "{name}" stopped: {error}',
    ug: '«{name}» نى سىنغا ئېلىش توختاپ قالدى: {error}',
  },
  saved: { zh: '录像已保存：{name}', en: 'Recording saved: {name}', ug: 'سىن ساقلاندى: {name}' },
  empty: {
    zh: '还没有录像。在终端右键菜单里选“{menu}”，或在命令面板运行“{command}”。',
    en: 'No recordings yet. Choose "{menu}" in the terminal context menu, or run "{command}" from the command palette.',
    ug: 'تېخى سىن يوق. تېرمىنالنىڭ ئوڭ كۇنۇپكا تىزىملىكىدىن «{menu}» نى تاللاڭ ياكى بۇيرۇق تاختىسىدا «{command}» نى ئىجرا قىلىڭ.',
  },
  recordingNow: { zh: '正在录制…', en: 'Recording…', ug: 'سىنغا ئېلىنىۋاتىدۇ…' },
  play: { zh: '播放', en: 'Play', ug: 'قوي' },
  playName: { zh: '播放 {name}', en: 'Play {name}', ug: '{name} نى قوي' },
  deleteName: { zh: '删除 {name}', en: 'Delete {name}', ug: '{name} نى ئۆچۈر' },
  deleteTitle: { zh: '删除录像', en: 'Delete recording', ug: 'سىننى ئۆچۈر' },
  deleteText: {
    zh: '删除录像「{name}」？',
    en: 'Delete recording "{name}"?',
    ug: '«{name}» سىنىنى ئۆچۈرەمسىز؟',
  },
  help: {
    zh: '录下终端显示的内容和时间（asciicast v2 格式，可以用 asciinema 播放），不记录键盘输入。但屏幕上显示过的内容都会写进文件，注意别录到敏感信息。',
    en: 'Records what the terminal shows and when (asciicast v2, playable with asciinema). Keystrokes are not recorded, but everything shown on screen goes into the file, so keep sensitive information off the screen.',
    ug: 'تېرمىنالدا كۆرۈنگەن مەزمۇن ۋە ۋاقىتنى سىنغا ئالىدۇ (asciicast v2 فورماتى، asciinema بىلەن قويغىلى بولىدۇ)، كۇنۇپكا كىرگۈزۈشىنى خاتىرىلىمەيدۇ. لېكىن ئېكراندا كۆرۈنگەن ھەممە مەزمۇن ھۆججەتكە يېزىلىدۇ، مەخپىي ئۇچۇرلارنى سىنغا ئېلىپ سالماڭ.',
  },
  openFolder: { zh: '打开录像文件夹', en: 'Open recordings folder', ug: 'سىن قىسقۇچىنى ئاچ' },
  badgeOne: {
    zh: '正在录像 · {title}',
    en: 'Recording · {title}',
    ug: 'سىنغا ئېلىنىۋاتىدۇ · {title}',
  },
  badgeMany: {
    zh: '正在录像 {n} 个终端',
    en: (p) => `Recording ${pl('terminal')(p)}`,
    ug: '{n} تېرمىنال سىنغا ئېلىنىۋاتىدۇ',
  },
  badgeTitle: {
    zh: '点击停止当前终端的录像',
    en: 'Click to stop recording the current terminal',
    ug: 'چېكىپ نۆۋەتتىكى تېرمىنالنى سىنغا ئېلىشنى توختىتىڭ',
  },
  noTerminal: {
    zh: '请先切换到一个已连接的终端再录像。',
    en: 'Switch to a connected terminal before recording.',
    ug: 'سىنغا ئېلىشتىن بۇرۇن ئۇلانغان تېرمىنالغا ئالماشتۇرۇڭ.',
  },
  started: {
    zh: '开始录像：{title}。屏幕上显示的内容都会写进录像文件。',
    en: 'Recording {title}. Everything shown on screen goes into the recording file.',
    ug: 'سىنغا ئېلىش باشلاندى: {title}. ئېكراندا كۆرۈنگەن ھەممە مەزمۇن سىن ھۆججىتىگە يېزىلىدۇ.',
  },
  startFailed: {
    zh: '无法开始录像：{error}',
    en: "Couldn't start recording: {error}",
    ug: 'سىنغا ئېلىشنى باشلىغىلى بولمىدى: {error}',
  },
  closedSaved: {
    zh: '终端已关闭，录像已保存：{name}',
    en: 'Terminal closed; recording saved: {name}',
    ug: 'تېرمىنال يېپىلدى، سىن ساقلاندى: {name}',
  },
  startCommand: {
    zh: '录像：开始录制当前终端',
    en: 'Recording: Start recording current terminal',
    ug: 'سىن: نۆۋەتتىكى تېرمىنالنى سىنغا ئېلىشنى باشلا',
  },
  stopCommand: {
    zh: '录像：停止录制',
    en: 'Recording: Stop recording',
    ug: 'سىن: سىنغا ئېلىشنى توختات',
  },
  listCommand: {
    zh: '录像：管理与回放',
    en: 'Recording: Manage and play back',
    ug: 'سىن: باشقۇرۇش ۋە قويۇش',
  },
  stopWhich: {
    zh: '先切换到要停止录像的终端。',
    en: 'Switch to the terminal whose recording you want to stop.',
    ug: 'ئالدى بىلەن سىنغا ئېلىشنى توختاتماقچى بولغان تېرمىنالغا ئالماشتۇرۇڭ.',
  },
  stopMenu: { zh: '停止录像', en: 'Stop recording', ug: 'سىنغا ئېلىشنى توختات' },
  startMenu: {
    zh: '开始录制终端',
    en: 'Start recording terminal',
    ug: 'تېرمىنالنى سىنغا ئېلىشنى باشلا',
  },
})

const SECTION = 'recordings'
const FLUSH_MS = 500

interface Recording {
  id: number
  name: string
  stop: () => Promise<void>
}

const hosts = new Set<TerminalHost>()
const recordings = new Map<TerminalHost, Recording>()
/** Told after a recording starts or ends, so the badge and settings list follow. */
const watchers = new Set<() => void>()
const changed = () => {
  for (const watch of watchers) watch()
}

function hostFor(sessionId: number | null): TerminalHost | null {
  if (sessionId === null) return null
  for (const host of hosts) if (host.sessionId() === sessionId) return host
  return null
}

function titleOf(host: TerminalHost): string {
  const id = host.sessionId()
  return allSessions().find((s) => s.id === id)?.title ?? common('terminal')
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e))

async function start(host: TerminalHost, ctx: PluginContext): Promise<void> {
  if (recordings.has(host)) return
  const title = titleOf(host)
  const opened = await invoke<{ id: number; name: string; path: string }>('recording_start', {
    start: {
      name: castName(title, new Date()),
      width: host.term.cols,
      height: host.term.rows,
      title,
      term: 'xterm-256color',
    },
  })
  const buffer = new EventBuffer(performance.now())
  const decoder = new TextDecoder()
  let chain = Promise.resolve()
  let failed = false
  let timer = 0

  const flush = () => {
    clearTimeout(timer)
    timer = 0
    const events = buffer.take()
    if (events.length === 0 || failed) return chain
    chain = chain
      .then(() => invoke<void>('recording_write', { id: opened.id, events }))
      .catch((e: unknown) => {
        if (failed) return
        failed = true
        ctx.ui.status(t('writeFailed', { name: ltr(opened.name), error: errorText(e) }), 'error')
        void end()
      })
    return chain
  }
  const later = () => {
    if (buffer.full) void flush()
    else if (!timer) timer = window.setTimeout(flush, FLUSH_MS)
  }

  const output = host.onOutput((bytes) => {
    buffer.push('o', decoder.decode(bytes, { stream: true }))
    later()
  })
  const resize = host.term.onResize(({ cols, rows }) => {
    buffer.push('r', `${cols}x${rows}`)
    later()
  })

  let ending: Promise<void> | null = null
  const end = () => {
    ending ??= (async () => {
      output()
      resize.dispose()
      buffer.push('o', decoder.decode())
      recordings.delete(host)
      changed()
      await flush()
      await invoke('recording_stop', { id: opened.id }).catch(() => {})
    })()
    return ending
  }
  recordings.set(host, { id: opened.id, name: opened.name, stop: end })
  changed()
}

async function stop(host: TerminalHost, ctx: PluginContext): Promise<void> {
  const recording = recordings.get(host)
  if (!recording) return
  await recording.stop()
  ctx.ui.status(t('saved', { name: ltr(recording.name) }))
}

function entryMeta(entry: CastEntry): string {
  const parts = [`${entry.width}×${entry.height}`]
  if (entry.duration !== null) parts.push(formatClock(entry.duration))
  parts.push(formatBytes(entry.size), formatTime(Math.floor(entry.modified / 1000)))
  // Sizes, dimensions and times, all left to right; in Uyghur each would reorder on its own.
  return ltr(parts.join(' · '))
}

function buildSection(ctx: PluginContext): Section {
  const list = h('ul', { class: 'settings-list cast-list', 'aria-label': t('recordings') })
  const empty = h('p', {
    class: 'help',
    text: t('empty', { menu: t('startMenu'), command: t('startCommand') }),
  })
  const report = (e: unknown) => ctx.ui.status(errorText(e), 'error')
  let alive = true

  const render = async () => {
    let entries: CastEntry[]
    try {
      entries = await invoke<CastEntry[]>('recording_list')
    } catch (e) {
      report(e)
      return
    }
    if (!alive) return
    const live = new Set([...recordings.values()].map((r) => r.name))
    empty.hidden = entries.length > 0
    list.replaceChildren(
      ...entries.map((entry) => {
        const name = entry.title || entry.name
        const recordingNow = live.has(entry.name)
        return h(
          'li',
          { class: 'settings-row macro-row' },
          h(
            'span',
            { class: 'macro-main' },
            h('span', { class: 'settings-row-name', text: entry.name, title: entry.title }),
            h('span', {
              class: 'macro-meta',
              text: recordingNow ? t('recordingNow') : entryMeta(entry),
            }),
          ),
          h('button', {
            type: 'button',
            class: 'button small quiet',
            text: t('play'),
            disabled: recordingNow,
            'aria-label': t('playName', { name: ltr(name) }),
            onclick: () => void playRecording(entry.name).catch(report),
          }),
          h('button', {
            type: 'button',
            class: 'button small quiet',
            text: common('delete'),
            disabled: recordingNow,
            'aria-label': t('deleteName', { name: ltr(name) }),
            onclick: async () => {
              const ok = await confirmDialog(
                t('deleteTitle'),
                t('deleteText', { name: ltr(entry.name) }),
                common('delete'),
                true,
              )
              if (!ok) return
              await invoke('recording_delete', { name: entry.name }).catch(report)
              void render()
            },
          }),
        )
      }),
    )
  }

  const watch = () => void render()
  watchers.add(watch)
  void render()
  const element = h(
    'div',
    { class: 'settings-section' },
    h('h3', { text: t('terminalRecording') }),
    h('p', {
      class: 'help',
      text: t('help'),
    }),
    h(
      'div',
      { class: 'settings-actions' },
      button(t('openFolder'), () => {
        void invoke<string>('recording_dir')
          .then((path) => invoke('reveal_local', { path }))
          .catch(report)
      }),
      button(common('refresh'), () => void render()),
    ),
    empty,
    list,
  )
  return {
    id: SECTION,
    label: t('recordings'),
    element,
    refresh: () => void render(),
    dispose: () => {
      alive = false
      watchers.delete(watch)
    },
  }
}

export const recordingPlugin: BuiltinPlugin = {
  manifest: {
    id: 'gx.recording',
    name: t('terminalRecording'),
    version: BUILTIN_VERSION,
    description: t('description', { section: t('recordings') }),
  },
  activate(ctx: PluginContext) {
    let badge: Dispose | null = null
    const showBadge = () => {
      badge?.()
      badge = null
      if (recordings.size === 0) return
      const [host] = recordings.keys()
      badge = ctx.statusBar.set({
        id: 'terminal-recording',
        text:
          recordings.size === 1 && host
            ? t('badgeOne', { title: ltr(titleOf(host)) })
            : t('badgeMany', { n: recordings.size }),
        icon: 'record',
        tone: 'error',
        title: t('badgeTitle'),
        command: 'recording.stop',
        priority: 6,
      })
    }
    watchers.add(showBadge)

    const activeHost = () => hostFor(activeSession()?.id ?? null)
    /** The active terminal's recording, or the only one running. */
    const target = () => {
      const host = activeHost()
      if (host && recordings.has(host)) return host
      return recordings.size === 1 ? ([...recordings.keys()][0] ?? null) : null
    }
    const begin = (host: TerminalHost | null) => {
      if (!host) {
        ctx.ui.status(t('noTerminal'), 'error')
        return
      }
      start(host, ctx).then(
        () => ctx.ui.status(t('started', { title: ltr(titleOf(host)) })),
        (e: unknown) => ctx.ui.status(t('startFailed', { error: errorText(e) }), 'error'),
      )
    }

    ctx.terminal.addon({
      attach: (host) => {
        hosts.add(host)
        return () => {
          hosts.delete(host)
          const recording = recordings.get(host)
          if (recording) {
            void recording.stop()
            ctx.ui.status(t('closedSaved', { name: ltr(recording.name) }))
          }
        }
      },
    })
    ctx.settings.section({ id: SECTION, label: t('recordings'), build: () => buildSection(ctx) })

    ctx.commands.register({
      id: 'recording.start',
      title: t('startCommand'),
      category: t('category'),
      icon: 'record',
      run: () => begin(activeHost()),
      enabled: () => {
        const host = activeHost()
        return host !== null && !recordings.has(host)
      },
    })
    ctx.commands.register({
      id: 'recording.stop',
      title: t('stopCommand'),
      category: t('category'),
      icon: 'stop',
      run: () => {
        const host = target()
        if (host) void stop(host, ctx)
        else if (recordings.size > 1) ctx.ui.status(t('stopWhich'), 'error')
      },
      enabled: () => recordings.size > 0,
    })
    ctx.commands.register({
      id: 'recording.list',
      title: t('listCommand'),
      category: t('category'),
      icon: 'film-strip',
      run: () => openSettings(`plugin-${SECTION}`),
    })
    ctx.menus.contribute('terminal/context', ({ sessionId, live }) => {
      const host = hostFor(sessionId)
      if (!host) return []
      if (recordings.has(host)) {
        return [{ label: t('stopMenu'), icon: 'stop', action: () => void stop(host, ctx) }]
      }
      if (!live) return []
      return [{ label: t('startMenu'), icon: 'record', action: () => begin(host) }]
    })

    ctx.subscriptions.add(() => {
      for (const recording of [...recordings.values()]) void recording.stop()
      watchers.delete(showBadge)
      badge?.()
    })
  },
}
