import { invoke } from '@tauri-apps/api/core'
import { writeText } from '@tauri-apps/plugin-clipboard-manager'
import { exportDiagnostics } from './diagnostics'
import { button, confirmDialog, modal } from './dialogs'
import { h, onReportedError, reportError, setStatus } from './dom'
import { locale, messages, numericDate, pl } from './i18n'
import { common } from './i18n-common'
import { describeError } from './protocol'

const t = messages({
  info: { zh: '信息', en: 'Info', ug: 'ئۇچۇر' },
  warn: { zh: '警告', en: 'Warning', ug: 'ئاگاھلاندۇرۇش' },
  error: { zh: '错误', en: 'Error', ug: 'خاتالىق' },
  scriptError: {
    zh: '界面脚本出错：{message}',
    en: 'UI script error: {message}',
    ug: 'كۆرۈنمە يۈز قوليازمىسىدا خاتالىق: {message}',
  },
  scriptErrorAt: {
    zh: '界面脚本出错：{message}（{where}）',
    en: 'UI script error: {message} ({where})',
    ug: 'كۆرۈنمە يۈز قوليازمىسىدا خاتالىق: {message} ({where})',
  },
  asyncError: {
    zh: '界面脚本出错（未处理的异步错误）：{message}',
    en: 'UI script error (unhandled async error): {message}',
    ug: 'كۆرۈنمە يۈز قوليازمىسىدا خاتالىق (بىر تەرەپ قىلىنمىغان ئاسىنخرون خاتالىق): {message}',
  },
  title: { zh: '通用日志', en: 'App log', ug: 'ئومۇمىي خاتىرە' },
  level: { zh: '级别', en: 'Level', ug: 'دەرىجە' },
  allLevels: { zh: '全部级别', en: 'All levels', ug: 'ھەممە دەرىجە' },
  search: { zh: '搜索日志', en: 'Search log', ug: 'خاتىرە ئىزدە' },
  time: { zh: '时间', en: 'Time', ug: 'ۋاقىت' },
  message: { zh: '内容', en: 'Message', ug: 'مەزمۇن' },
  help: {
    zh: '记录服务器的连接、断开、重连和失败原因，主机密钥的信任与移除，状态监控的失败与恢复，文件传输失败和其他操作出错，以及软件自身的事件（启动、设置变化、插件、配置文件问题、界面错误）。不记录终端里的输入和服务器的输出。最多保留 1000 条。',
    en: 'Records server connects, disconnects, reconnects and why they failed; host keys trusted and removed; status monitor failures and recoveries; failed file transfers and other failed operations; and events of the app itself (startup, settings changes, plugins, configuration file problems, interface errors). Terminal input and server output are never recorded. Keeps up to 1000 entries.',
    ug: 'مۇلازىمېتىرغا ئۇلىنىش، ئۈزۈلۈش، قايتا ئۇلىنىش ۋە مەغلۇپ بولۇش سەۋەبى، ئاساسىي ماشىنا ئاچقۇچىغا ئىشىنىش ۋە ئۇنى چىقىرىۋېتىش، ھالەت نازارىتىنىڭ مەغلۇپ بولۇشى ۋە ئەسلىگە كېلىشى، ھۆججەت يوللاشنىڭ مەغلۇپ بولۇشى ۋە باشقا مەشغۇلات خاتالىقلىرى، شۇنداقلا يۇمشاق دېتالنىڭ ئۆز ھادىسىلىرى (قوزغىلىش، تەڭشەك ئۆزگىرىشى، قىستۇرما، سەپلىمە ھۆججەت مەسىلىسى، كۆرۈنمە يۈز خاتالىقى) خاتىرىلىنىدۇ. تېرمىنالدىكى كىرگۈزۈش ۋە مۇلازىمېتىرنىڭ چىقىرىشى خاتىرىلەنمەيدۇ. ئەڭ كۆپ بولغاندا 1000 خاتىرە ساقلىنىدۇ.',
  },
  total: { zh: '共 {n} 条', en: pl('entry', 'entries'), ug: 'جەمئىي {n} خاتىرە' },
  shown: {
    zh: '显示 {shown} / {n} 条',
    en: 'Showing {shown} of {n}',
    ug: 'كۆرسىتىلگىنى {shown}/{n}',
  },
  noMatch: { zh: '没有匹配的日志。', en: 'No matching entries.', ug: 'ماس كېلىدىغان خاتىرە يوق.' },
  empty: { zh: '日志是空的。', en: 'The log is empty.', ug: 'خاتىرە قۇرۇق.' },
  copyShown: {
    zh: '复制显示的日志',
    en: 'Copy shown entries',
    ug: 'كۆرسىتىلگەن خاتىرىلەرنى كۆچۈر',
  },
  copied: { zh: '已复制日志', en: 'Log copied', ug: 'خاتىرە كۆچۈرۈلدى' },
  clear: { zh: '清空日志', en: 'Clear log', ug: 'خاتىرىنى تازىلا' },
  clearTitle: { zh: '清空通用日志', en: 'Clear app log', ug: 'ئومۇمىي خاتىرىنى تازىلاش' },
  clearText: {
    zh: '删除全部日志记录？',
    en: 'Delete all log entries?',
    ug: 'بارلىق خاتىرىلەرنى ئۆچۈرەمسىز؟',
  },
  clearConfirm: { zh: '清空', en: 'Clear', ug: 'تازىلا' },
  exportPackage: {
    zh: '导出诊断包',
    en: 'Export diagnostics package',
    ug: 'دىئاگنوز بولىقىنى چىقار',
  },
  readFailed: {
    zh: '无法读取日志：{error}',
    en: 'Could not read the log: {error}',
    ug: 'خاتىرىنى ئوقۇغىلى بولمىدى: {error}',
  },
})

export type LogLevel = 'info' | 'warn' | 'error'

interface LogEntry {
  at: number
  level: LogLevel
  message: string
}

const LEVEL_LABEL: Record<LogLevel, string> = {
  info: t('info'),
  warn: t('warn'),
  error: t('error'),
}

const report = reportError

const RECENT_MS = 5000
let recent: { message: string; at: number }[] = []

/** Records an app or connection event. Never for what the server prints or what the user types. */
export function logApp(level: LogLevel, message: string): void {
  const now = Date.now()
  recent = recent.filter((r) => now - r.at < RECENT_MS)
  recent.push({ message, at: now })
  invoke('applog_add', { level, message: message.slice(0, 2000) }).catch(() => {})
}

const STACK_LINES = 8

function stackOf(error: unknown): string {
  if (!(error instanceof Error) || !error.stack) return ''
  const lines = error.stack.split('\n').slice(1, STACK_LINES + 1)
  return lines.length ? `\n${lines.map((l) => l.trim()).join('\n')}` : ''
}

/** Logs frontend bugs and every reported failure, unless it was just logged with more context. */
export function captureUiErrors(): void {
  onReportedError((text) => {
    const now = Date.now()
    if (!recent.some((r) => now - r.at < RECENT_MS && r.message.includes(text))) {
      logApp('error', text)
    }
  })
  window.addEventListener('error', (event) => {
    const error: unknown = event.error
    const message = event.filename
      ? t('scriptErrorAt', {
          message: event.message,
          where: `${event.filename}:${event.lineno}:${event.colno}`,
        })
      : t('scriptError', { message: event.message })
    logApp('error', `${message}${stackOf(error)}`)
  })
  window.addEventListener('unhandledrejection', (event) => {
    const reason: unknown = event.reason
    const text = reason instanceof Error ? reason.message : describeError(reason)
    logApp('error', `${t('asyncError', { message: text })}${stackOf(reason)}`)
  })
}

function stamp(secs: number): string {
  return new Date(secs * 1000).toLocaleString(locale(), {
    ...numericDate(),
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
}

let current: HTMLDialogElement | null = null

export function openAppLog(): void {
  if (current) {
    current.focus()
    return
  }
  const parts = modal('applog', t('title'), 'lg')
  current = parts.dialog
  const level = h(
    'select',
    { class: 'log-level', 'aria-label': t('level') },
    h('option', { value: '', text: t('allLevels') }),
    ...(['info', 'warn', 'error'] as const).map((l) =>
      h('option', { value: l, text: LEVEL_LABEL[l] }),
    ),
  )
  const search = h('input', {
    type: 'search',
    class: 'log-search',
    placeholder: t('search'),
    'aria-label': t('search'),
    spellcheck: 'false',
  })
  const count = h('p', { class: 'log-count', 'aria-live': 'polite' })
  const tbody = h('tbody')
  const table = h(
    'table',
    { class: 'data-table log-table', 'aria-label': t('title') },
    h(
      'thead',
      {},
      h(
        'tr',
        {},
        h('th', { scope: 'col', class: 'log-at', text: t('time') }),
        h('th', { scope: 'col', class: 'log-lv', text: t('level') }),
        h('th', { scope: 'col', text: t('message') }),
      ),
    ),
    tbody,
  )
  parts.body.append(
    h('p', { class: 'help', text: t('help') }),
    h('div', { class: 'log-head' }, search, level, count),
    h('div', { class: 'table-wrap log-wrap' }, table),
  )

  let entries: LogEntry[] = []
  const visible = () => {
    const words = search.value.toLowerCase().split(/\s+/).filter(Boolean)
    return entries.filter(
      (e) =>
        (level.value === '' || e.level === level.value) &&
        words.every((w) => e.message.toLowerCase().includes(w)),
    )
  }
  const render = () => {
    const shown = visible()
    count.textContent =
      shown.length === entries.length
        ? t('total', { n: entries.length })
        : t('shown', { shown: shown.length, n: entries.length })
    tbody.replaceChildren(
      ...(shown.length > 0
        ? shown.map((e) =>
            h(
              'tr',
              { 'data-level': e.level },
              h('td', { class: 'log-at', text: stamp(e.at) }),
              h('td', { class: 'log-lv', text: LEVEL_LABEL[e.level] }),
              h('td', { class: 'log-msg', text: e.message }),
            ),
          )
        : [
            h(
              'tr',
              {},
              h('td', {
                colspan: '3',
                class: 'log-empty',
                text: t(entries.length ? 'noMatch' : 'empty'),
              }),
            ),
          ]),
    )
  }
  const reload = async () => {
    entries = (await invoke<LogEntry[]>('applog_list')).reverse()
    render()
  }
  search.addEventListener('input', render)
  level.addEventListener('change', render)

  const refresh = button(common('refresh'), () => void reload().catch(report), 'quiet')
  const copy = button(
    t('copyShown'),
    () => {
      const text = visible()
        .map((e) => `${stamp(e.at)}\t${LEVEL_LABEL[e.level]}\t${e.message}`)
        .join('\n')
      writeText(text)
        .then(() => setStatus(t('copied')))
        .catch(report)
    },
    'quiet',
  )
  const clear = button(
    t('clear'),
    () => {
      void (async () => {
        const sure = await confirmDialog(t('clearTitle'), t('clearText'), t('clearConfirm'), true)
        if (!sure) return
        await invoke('applog_clear')
        await reload()
      })().catch(report)
    },
    'danger',
  )
  const diagnostics = button(
    t('exportPackage'),
    () => void exportDiagnostics().catch(report),
    'quiet',
  )
  const close = button(common('close'), () => parts.dialog.close(), 'primary')
  parts.actions.append(refresh, copy, diagnostics, clear, close)
  parts.dialog.addEventListener('close', () => {
    current = null
    parts.dialog.remove()
  })
  render()
  parts.dialog.showModal()
  search.focus()
  reload().catch((error) => {
    count.textContent = ''
    tbody.replaceChildren(
      h(
        'tr',
        {},
        h('td', {
          colspan: '3',
          class: 'log-empty',
          text: t('readFailed', { error: describeError(error) }),
        }),
      ),
    )
  })
}
