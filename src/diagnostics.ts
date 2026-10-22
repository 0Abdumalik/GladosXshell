import { invoke } from '@tauri-apps/api/core'
import { writeText } from '@tauri-apps/plugin-clipboard-manager'
import { save } from '@tauri-apps/plugin-dialog'
import { button, confirmDialog, modal } from './dialogs'
import { h, reportError, setStatus } from './dom'
import { ltr, messages } from './i18n'
import { common } from './i18n-common'
import { pluginStates } from './plugins/host'
import { activeSession, activeTerminal } from './sessions'

const t = messages({
  debug: { zh: '调试版', en: 'Debug build', ug: 'سىناق نەشرى' },
  dev: { zh: '开发版', en: 'Development build', ug: 'ئاچقۇچىلار نەشرى' },
  release: { zh: '正式版', en: 'Release build', ug: 'رەسمىي نەشرى' },
  contents: {
    zh: '诊断包里有：通用日志、崩溃记录、设置、插件状态，以及软件版本、系统版本和屏幕信息。不含服务器密码、密钥、已保存的连接、指令历史和终端内容。日志里会有服务器地址和用户名。',
    en: 'The diagnostics package holds the app log, crash records, settings and plugin states, plus the app version, OS version and screen details. It leaves out server passwords, keys, saved connections, command history and terminal content. The log does include server addresses and user names.',
    ug: 'دىئاگنوز بولىقىدا ئومۇمىي خاتىرە، يىمىرىلىش خاتىرىسى، تەڭشەك، قىستۇرما ھالىتى، شۇنداقلا يۇمشاق دېتال نەشرى، سىستېما نەشرى ۋە ئېكران ئۇچۇرى بار. مۇلازىمېتىر ئىمى، ئاچقۇچ، ساقلانغان ئۇلىنىشلار، بۇيرۇق تارىخى ۋە تېرمىنال مەزمۇنى يوق. خاتىرىدە مۇلازىمېتىر ئادرېسى ۋە ئىشلەتكۈچى ئاتى بولىدۇ.',
  },
  exportedTitle: {
    zh: '诊断包已导出',
    en: 'Diagnostics package exported',
    ug: 'دىئاگنوز بولىقى چىقىرىلدى',
  },
  savedTo: { zh: '已保存到 {path}', en: 'Saved to {path}', ug: '{path} غا ساقلاندى' },
  sendIt: {
    zh: '请把这个文件发到 {email}，并说一下出问题时在做什么、能否重现。',
    en: 'Send this file to {email}, along with what you were doing when the problem happened and whether you can reproduce it.',
    ug: 'بۇ ھۆججەتنى {email} غا ئەۋەتىڭ، مەسىلە كۆرۈلگەندە نېمە قىلىۋاتقانلىقىڭىزنى ۋە ئۇنى قايتا يۈز بەرگۈزگىلى بولىدىغان-بولمايدىغانلىقىنى ئېيتىپ بېرىڭ.',
  },
  reveal: { zh: '打开所在文件夹', en: 'Open containing folder', ug: 'تۇرۇشلۇق قىسقۇچنى ئاچ' },
  copyEmail: { zh: '复制邮箱地址', en: 'Copy email address', ug: 'ئېلخەت ئادرېسىنى كۆچۈر' },
  emailCopied: {
    zh: '已复制邮箱地址',
    en: 'Email address copied',
    ug: 'ئېلخەت ئادرېسى كۆچۈرۈلدى',
  },
  // A file name: kept in Latin letters for Uyghur, so it does not mix directions.
  fileName: {
    zh: 'GladosXshell-诊断-{stamp}.zip',
    en: 'GladosXshell-diagnostics-{stamp}.zip',
    ug: 'GladosXshell-diagnostics-{stamp}.zip',
  },
  filter: { zh: '诊断包', en: 'Diagnostics package', ug: 'دىئاگنوز بولىقى' },
  exporting: {
    zh: '正在导出诊断包',
    en: 'Exporting diagnostics package',
    ug: 'دىئاگنوز بولىقى چىقىرىلىۋاتىدۇ',
  },
  exported: {
    zh: '诊断包已导出：{path}',
    en: 'Diagnostics package exported: {path}',
    ug: 'دىئاگنوز بولىقى چىقىرىلدى: {path}',
  },
  crashTitle: {
    zh: '上次运行意外退出',
    en: 'GladosXshell quit unexpectedly',
    ug: 'ئالدىنقى قېتىملىق ئىجرا كۈتۈلمىگەن ھالدا ئاخىرلاشتى',
  },
  crashText: {
    zh: 'GladosXshell 上次运行时崩溃了：{summary}\n\n导出诊断包发给开发者，可以帮助尽快修好。',
    en: 'GladosXshell crashed the last time it ran: {summary}\n\nExporting a diagnostics package and sending it to the developer helps get this fixed sooner.',
    ug: 'GladosXshell ئالدىنقى قېتىم ئىجرا بولۇۋاتقاندا يىمىرىلدى: {summary}\n\nدىئاگنوز بولىقىنى چىقىرىپ ئاچقۇچىغا ئەۋەتسىڭىز، مەسىلىنى تېزرەك ھەل قىلىشقا ياردىمى بولىدۇ.',
  },
  exportPackage: {
    zh: '导出诊断包',
    en: 'Export diagnostics package',
    ug: 'دىئاگنوز بولىقىنى چىقار',
  },
})

export const FEEDBACK_EMAIL = 'malik6@qq.com'

export type Channel = 'debug' | 'dev' | 'release'

export interface BuildInfo {
  version: string
  channel: Channel
  os: string
  arch: string
  devtools: boolean
}

export const CHANNEL_LABEL: Record<Channel, string> = {
  debug: t('debug'),
  dev: t('dev'),
  release: t('release'),
}

let info: Promise<BuildInfo> | null = null

export function buildInfo(): Promise<BuildInfo> {
  info ??= invoke<BuildInfo>('app_build_info')
  return info
}

export const PACKAGE_CONTENTS = t('contents')

/** What only the window knows; nothing here may identify servers beyond what the log already has. */
function clientInfo(): object {
  const session = activeSession()
  const terminal = activeTerminal()
  return {
    userAgent: navigator.userAgent,
    language: navigator.language,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    screen: `${screen.width}x${screen.height}`,
    window: `${window.innerWidth}x${window.innerHeight}`,
    devicePixelRatio: window.devicePixelRatio,
    theme: document.documentElement.dataset.theme ?? null,
    activeSession: session
      ? { kind: session.kind, state: session.state, renderer: terminal?.renderer ?? null }
      : null,
    plugins: pluginStates().map((p) => ({
      id: p.manifest.id,
      version: p.manifest.version,
      enabled: p.enabled,
      active: p.active,
      error: p.error,
    })),
  }
}

function fileStamp(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-` +
    `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  )
}

function exportedDialog(path: string): void {
  const parts = modal('diagnostics', t('exportedTitle'), 'md')
  parts.body.append(
    h('p', { class: 'dialog-message', text: t('savedTo', { path: ltr(path) }) }),
    h('p', { class: 'help', text: t('sendIt', { email: ltr(FEEDBACK_EMAIL) }) }),
    h('p', { class: 'help', text: PACKAGE_CONTENTS }),
  )
  const reveal = button(
    t('reveal'),
    () => void invoke('reveal_local', { path }).catch(reportError),
    'quiet',
  )
  const copy = button(
    t('copyEmail'),
    () =>
      void writeText(FEEDBACK_EMAIL)
        .then(() => setStatus(t('emailCopied')))
        .catch(reportError),
    'quiet',
  )
  const close = button(common('close'), () => parts.dialog.close(), 'primary')
  parts.actions.append(reveal, copy, close)
  parts.dialog.addEventListener('close', () => parts.dialog.remove())
  parts.dialog.showModal()
  close.focus()
}

export async function exportDiagnostics(): Promise<void> {
  const path = await save({
    defaultPath: t('fileName', { stamp: fileStamp() }),
    filters: [{ name: t('filter'), extensions: ['zip'] }],
  })
  if (!path) return
  setStatus(t('exporting'))
  await invoke('diagnostics_export', {
    path,
    client: JSON.stringify(clientInfo(), null, 2),
    tzOffset: -new Date().getTimezoneOffset(),
  })
  setStatus(t('exported', { path: ltr(path) }))
  exportedDialog(path)
}

/** After a crash the previous run left a marker; offer to send the logs once. */
export async function offerCrashReport(): Promise<void> {
  const summary = await invoke<string | null>('diagnostics_take_crash')
  if (!summary) return
  const ok = await confirmDialog(t('crashTitle'), t('crashText', { summary }), t('exportPackage'))
  if (ok) await exportDiagnostics()
}
