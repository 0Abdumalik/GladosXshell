import { invoke } from '@tauri-apps/api/core'
import { writeText } from '@tauri-apps/plugin-clipboard-manager'
import { logApp, openAppLog } from './applog'
import {
  buildInfo,
  CHANNEL_LABEL,
  exportDiagnostics,
  FEEDBACK_EMAIL,
  PACKAGE_CONTENTS,
} from './diagnostics'
import { confirmDialog, modal } from './dialogs'
import { h, reportError, setStatus } from './dom'
import { formatThroughput, formatTime } from './format'
import { ltr, messages, pl } from './i18n'
import { common } from './i18n-common'
import { FINALSHELL_DEPSD_URL } from './import-dialog'
import { pluginsSection } from './plugins/manager-ui'
import { reportContributionError, settingsSections } from './plugins/registry'
import type { KnownHost } from './protocol'
import { openSession } from './sessions'
import { backupSection } from './settings-backup'
import { appearanceSection, filesSection } from './settings-files'
import { languageSection } from './settings-language'
import { layoutSection, type Section, statusSection } from './settings-layout'
import { masterSection } from './settings-master'
import { onSettings } from './settings-store'
import { editorSection, terminalSection } from './settings-terminal'

const t = messages({
  noKnownHosts: {
    zh: '还没有信任过任何主机。',
    en: 'No trusted hosts yet.',
    ug: 'تېخى ھېچقانداق ئاساسىي ماشىناغا ئىشەنچ قىلىنمىدى.',
  },
  removeHost: { zh: '移除 {name}', en: 'Remove {name}', ug: '{name} نى چىقىرىۋەت' },
  removeKeyTitle: {
    zh: '移除主机密钥',
    en: 'Remove host key',
    ug: 'ئاساسىي ماشىنا ئاچقۇچىنى چىقىرىۋېتىش',
  },
  removeKeyText: {
    zh: '移除 {name} 的主机密钥？下次连接需要重新核对指纹。',
    en: 'Remove the host key for {name}? The fingerprint will need checking again on the next connection.',
    ug: '{name} نىڭ ئاساسىي ماشىنا ئاچقۇچىنى چىقىرىۋېتەمسىز؟ كېيىنكى قېتىم ئۇلانغاندا بارماق ئىزىنى قايتا تەكشۈرۈش كېرەك.',
  },
  removedKey: {
    zh: '移除了 {name} 的主机密钥：{fingerprint}',
    en: 'Removed the host key for {name}: {fingerprint}',
    ug: '{name} نىڭ ئاساسىي ماشىنا ئاچقۇچى چىقىرىۋېتىلدى: {fingerprint}',
  },
  trustedHosts: { zh: '已信任的主机', en: 'Trusted hosts', ug: 'ئىشەنچلىك ئاساسىي ماشىنىلار' },
  trustedHelp: {
    zh: '首次连接时确认过指纹的服务器。服务器重装后密钥会变，需要在这里移除旧记录。',
    en: 'Servers whose fingerprint you confirmed on the first connection. A reinstalled server has a new key, so remove its old entry here.',
    ug: 'تۇنجى قېتىم ئۇلانغاندا بارماق ئىزى جەزملەنگەن مۇلازىمېتىرلار. مۇلازىمېتىر قايتا ئورنىتىلسا ئاچقۇچى ئۆزگىرىدۇ، بۇ يەردىن كونا خاتىرىنى چىقىرىۋېتىڭ.',
  },
  knownHosts: { zh: '已知主机', en: 'Known hosts', ug: 'تونۇش ئاساسىي ماشىنىلار' },
  devtools: { zh: '打开开发者工具', en: 'Open developer tools', ug: 'ئاچقۇچىلار قورالىنى ئاچ' },
  exportPackage: {
    zh: '导出诊断包',
    en: 'Export diagnostics package',
    ug: 'دىئاگنوز بولىقىنى چىقار',
  },
  viewLog: { zh: '查看通用日志', en: 'View app log', ug: 'ئومۇمىي خاتىرىنى كۆرسەت' },
  runBench: { zh: '运行渲染测试', en: 'Run render benchmark', ug: 'كۆرسىتىش سىنىقىنى ئىجرا قىل' },
  benchRunning: {
    zh: '渲染测试进行中（{size}）',
    en: 'Render benchmark running ({size})',
    ug: 'كۆرسىتىش سىنىقى ئىجرا بولۇۋاتىدۇ ({size})',
  },
  bench: { zh: '渲染测试', en: 'Render benchmark', ug: 'كۆرسىتىش سىنىقى' },
  benchResult: {
    zh: '渲染测试：{size}，{frames} 帧，用时 {ms} ms，{rate}（{renderer} 渲染）',
    en: (p) =>
      `Render benchmark: ${p.size}, ${pl('frame')({ n: p.frames })} in ${p.ms} ms, ${p.rate} (${p.renderer} renderer)`,
    ug: 'كۆرسىتىش سىنىقى: {size}، {frames} كادىر، {ms} ms ۋاقىت كەتتى، {rate} ({renderer} ئارقىلىق كۆرسىتىلدى)',
  },
  feedback: { zh: '问题反馈', en: 'Feedback', ug: 'پىكىر-تەكلىپ' },
  feedbackHelp: {
    zh: '出问题时导出诊断包，连同问题描述一起发到 {email}。{contents}',
    en: 'When something goes wrong, export a diagnostics package and send it to {email} with a description of the problem. {contents}',
    ug: 'مەسىلە كۆرۈلگەندە دىئاگنوز بولىقىنى چىقىرىپ، مەسىلە چۈشەندۈرۈلۈشى بىلەن بىللە {email} غا ئەۋەتىڭ. {contents}',
  },
  benchHelp: {
    zh: '在新标签里输出 {size} 文本，测量终端的吞吐量。结果显示在底部状态栏。',
    en: 'Writes {size} of text in a new tab to measure terminal throughput. The result appears in the status bar.',
    ug: 'يېڭى بەتكۈچتە {size} تېكىست چىقىرىپ، تېرمىنالنىڭ ئۆتكۈزۈش سۈرئىتىنى ئۆلچەيدۇ. نەتىجە ئاستىدىكى ھالەت بالدىقىدا كۆرۈنىدۇ.',
  },
  testing: { zh: '测试', en: 'Testing', ug: 'سىناق' },
  debugNotice: {
    zh: '这是给测试人员用的调试版，可能不稳定。遇到问题请在「测试」页导出诊断包发给作者。',
    en: 'This is a debug build for testers and may be unstable. If something goes wrong, export a diagnostics package on the Testing page and send it to the author.',
    ug: 'بۇ سىناقچىلار ئۈچۈن چىقىرىلغان سىناق نەشرى، مۇقىمسىز بولۇشى مۇمكىن. مەسىلە كۆرۈلسە «سىناق» بېتىدە دىئاگنوز بولىقىنى چىقىرىپ ئاپتورغا ئەۋەتىڭ.',
  },
  copyEmail: { zh: '复制邮箱地址', en: 'Copy email address', ug: 'ئېلخەت ئادرېسىنى كۆچۈر' },
  emailCopied: {
    zh: '已复制邮箱地址',
    en: 'Email address copied',
    ug: 'ئېلخەت ئادرېسى كۆچۈرۈلدى',
  },
  tagline: {
    zh: 'GladosX 系列 Shell 分支产品。',
    en: 'The Shell branch of the GladosX family.',
    ug: 'GladosX يۈرۈشلۈكىدىكى Shell تارماق مەھسۇلاتى.',
  },
  version: { zh: '版本', en: 'Version', ug: 'نەشرى' },
  author: { zh: '作者', en: 'Author', ug: 'ئاپتور' },
  email: { zh: '邮箱', en: 'Email', ug: 'ئېلخەت' },
  credits: { zh: '致谢', en: 'Credits', ug: 'مىننەتدارلىق' },
  credit: {
    zh: 'FinalShell 密码导入的解密方法来自 FinalShellDePsd',
    en: 'The decryption method for FinalShell password import comes from FinalShellDePsd',
    ug: 'FinalShell ئىم ئەكىرىشنىڭ شىفىر يېشىش ئۇسۇلى FinalShellDePsd دىن ئېلىنغان',
  },
  about: { zh: '关于', en: 'About', ug: 'ھەققىدە' },
  settings: { zh: '设置', en: 'Settings', ug: 'تەڭشەك' },
  categories: { zh: '设置分类', en: 'Settings categories', ug: 'تەڭشەك تۈرلىرى' },
})

const BENCH_BYTES = 64 * 1024 * 1024
/** `64 MB`, kept in one piece in right-to-left text. */
const BENCH_SIZE = ltr(`${BENCH_BYTES / 1024 / 1024} MB`)

type Report = (error: unknown) => void

function knownHostsSection(report: Report): Section {
  const list = h('ul', { class: 'settings-list known-list' })
  const empty = h('p', { class: 'help', text: t('noKnownHosts') })
  const load = () =>
    invoke<KnownHost[]>('known_hosts_list')
      .then((hosts) => {
        empty.hidden = hosts.length > 0
        list.replaceChildren(
          ...hosts.map((host) => {
            const name = `${host.host}:${host.port}`
            return h(
              'li',
              { class: 'settings-row known-row' },
              h(
                'span',
                { class: 'known-main' },
                h('span', { class: 'settings-row-name mono', text: name }),
                h('span', {
                  class: 'known-fp mono',
                  title: host.fingerprint,
                  text: host.fingerprint,
                }),
              ),
              h('span', { class: 'help', text: formatTime(host.addedAt) }),
              h('button', {
                type: 'button',
                class: 'button small quiet',
                text: common('remove'),
                'aria-label': t('removeHost', { name: ltr(name) }),
                onclick: async () => {
                  const ok = await confirmDialog(
                    t('removeKeyTitle'),
                    t('removeKeyText', { name: ltr(name) }),
                    common('remove'),
                    true,
                  )
                  if (!ok) return
                  await invoke('known_hosts_remove', { host: host.host, port: host.port })
                    .then(() => {
                      const fingerprint = ltr(host.fingerprint)
                      logApp('info', t('removedKey', { name: ltr(name), fingerprint }))
                      return load()
                    })
                    .catch(report)
                },
              }),
            )
          }),
        )
      })
      .catch(report)
  const element = h(
    'div',
    { class: 'settings-section' },
    h('h3', { text: t('trustedHosts') }),
    h('p', { class: 'help', text: t('trustedHelp') }),
    empty,
    list,
  )
  void load()
  return { id: 'known-hosts', label: t('knownHosts'), element, refresh: () => {} }
}

function testSection(report: Report, close: () => void): Section {
  const devtools = h('button', {
    type: 'button',
    class: 'button quiet',
    text: t('devtools'),
    hidden: true,
    onclick: () => void invoke('devtools_open').catch(report),
  })
  buildInfo()
    .then((info) => {
      devtools.hidden = !info.devtools
    })
    .catch(report)
  const exportButton = h('button', {
    type: 'button',
    class: 'button primary',
    text: t('exportPackage'),
    onclick: () => void exportDiagnostics().catch(report),
  })
  const log = h('button', {
    type: 'button',
    class: 'button quiet',
    text: t('viewLog'),
    onclick: () => {
      close()
      openAppLog()
    },
  })
  const run = h('button', {
    type: 'button',
    class: 'button',
    text: t('runBench'),
    onclick: () => {
      close()
      const started = performance.now()
      setStatus(t('benchRunning', { size: BENCH_SIZE }))
      openSession({
        kind: 'bench',
        title: t('bench'),
        open: (onEvent, { rows }) =>
          invoke<number>('bench_open', { totalBytes: BENCH_BYTES, rows, onEvent }),
        onExit: (_exit, session) => {
          const ms = performance.now() - started
          const { bytes, frames } = session.stats
          const renderer = session.renderer === 'webgl' ? 'WebGL' : 'DOM'
          setStatus(
            t('benchResult', {
              size: ltr(`${(bytes / 1024 / 1024).toFixed(1)} MB`),
              frames,
              ms: ms.toFixed(0),
              rate: ltr(formatThroughput(bytes, ms)),
              renderer,
            }),
          )
        },
      }).catch((error) => reportError(error))
    },
  })
  const element = h(
    'div',
    { class: 'settings-section' },
    h('h3', { text: t('feedback') }),
    h('p', {
      class: 'help',
      text: t('feedbackHelp', { email: ltr(FEEDBACK_EMAIL), contents: PACKAGE_CONTENTS }),
    }),
    h('div', { class: 'settings-actions' }, exportButton, log, devtools),
    h('h3', { text: t('bench') }),
    h('p', { class: 'help', text: t('benchHelp', { size: BENCH_SIZE }) }),
    h('div', { class: 'settings-actions' }, run),
  )
  return { id: 'test', label: t('testing'), element, refresh: () => {} }
}

const AUTHOR = 'malik'

/** `0.1.1-beta` reads as `0.1.1 Beta`. */
function displayVersion(version: string): string {
  return version.replace(/-([a-z]+)(.*)$/i, (_, tag: string, rest: string) => {
    return ` ${tag[0].toUpperCase()}${tag.slice(1)}${rest}`
  })
}

function aboutSection(report: Report): Section {
  const version = h('dd', { class: 'about-version' }, h('span', { class: 'mono', text: '…' }))
  const notice = h('p', {
    class: 'about-notice',
    hidden: true,
    text: t('debugNotice'),
  })
  buildInfo()
    .then((info) => {
      version.replaceChildren(
        h('span', { class: 'mono', text: displayVersion(info.version) }),
        h('span', {
          class: 'about-channel',
          'data-channel': info.channel,
          text: CHANNEL_LABEL[info.channel],
        }),
      )
      notice.hidden = info.channel !== 'debug'
    })
    .catch(report)
  const copy = h('button', {
    type: 'button',
    class: 'button small quiet',
    text: common('copy'),
    'aria-label': t('copyEmail'),
    onclick: () =>
      writeText(FEEDBACK_EMAIL)
        .then(() => setStatus(t('emailCopied')))
        .catch(report),
  })
  const item = (label: string, ...value: (Node | string)[]) =>
    h('div', { class: 'about-row' }, h('dt', { text: label }), ...value)
  const element = h(
    'div',
    { class: 'settings-section' },
    h('h3', { class: 'about-name', text: 'GladosXshell' }),
    h('p', { class: 'help', text: t('tagline') }),
    notice,
    h(
      'dl',
      { class: 'about-list' },
      item(t('version'), version),
      item(t('author'), h('dd', { text: AUTHOR })),
      item(
        t('email'),
        h('dd', { class: 'about-email' }, h('span', { class: 'mono', text: FEEDBACK_EMAIL }), copy),
      ),
      item(
        t('credits'),
        h(
          'dd',
          { class: 'about-credit' },
          h('span', { text: t('credit') }),
          h('span', { class: 'mono', text: FINALSHELL_DEPSD_URL }),
        ),
      ),
    ),
  )
  return { id: 'about', label: t('about'), element, refresh: () => {} }
}

/** Sections plugins contribute; one that fails to build is logged and left out. */
function contributedSections(report: Report): Section[] {
  const out: Section[] = []
  for (const def of settingsSections.list()) {
    try {
      out.push({ ...def.build(report), id: `plugin-${def.id}`, label: def.label })
    } catch (error) {
      reportContributionError(error)
    }
  }
  return out
}

let openDialog: HTMLDialogElement | null = null

export function openSettings(initial = 'layout'): void {
  if (openDialog) {
    openDialog.focus()
    return
  }
  const parts = modal('settings', t('settings'), 'xl')
  const report: Report = (error) => reportError(error)
  const sections = [
    layoutSection(report),
    statusSection(report),
    terminalSection(report),
    filesSection(report),
    editorSection(report),
    appearanceSection(report),
    languageSection(report),
    pluginsSection(report),
    ...contributedSections(report),
    masterSection(report),
    backupSection(report),
    knownHostsSection(report),
    testSection(report, () => parts.dialog.close()),
    aboutSection(report),
  ]
  const nav = h('nav', {
    class: 'settings-nav',
    role: 'tablist',
    'aria-orientation': 'vertical',
    'aria-label': t('categories'),
  })
  const panes = h('div', { class: 'settings-panes' })
  const tabs = sections.map((section) => {
    section.element.id = `settings-pane-${section.id}`
    section.element.setAttribute('role', 'tabpanel')
    section.element.setAttribute('aria-labelledby', `settings-tab-${section.id}`)
    section.element.tabIndex = -1
    panes.append(section.element)
    const tab = h('button', {
      type: 'button',
      role: 'tab',
      class: 'settings-tab',
      id: `settings-tab-${section.id}`,
      'aria-controls': section.element.id,
      text: section.label,
      onclick: () => select(section.id),
    })
    nav.append(tab)
    return tab
  })
  const select = (id: string) => {
    sections.forEach((section, i) => {
      const active = section.id === id
      section.element.hidden = !active
      tabs[i].setAttribute('aria-selected', String(active))
      tabs[i].tabIndex = active ? 0 : -1
    })
  }
  nav.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
    event.preventDefault()
    const index = tabs.findIndex((tab) => tab.getAttribute('aria-selected') === 'true')
    const next = (index + (event.key === 'ArrowDown' ? 1 : -1) + tabs.length) % tabs.length
    select(sections[next].id)
    tabs[next].focus()
  })
  parts.body.classList.add('settings-body')
  parts.body.append(nav, panes)
  parts.actions.remove()

  const unsubscribe = onSettings(() => {
    for (const section of sections) section.refresh()
  })
  parts.dialog.addEventListener('close', () => {
    unsubscribe()
    for (const section of sections) section.dispose?.()
    parts.dialog.remove()
    openDialog = null
  })
  openDialog = parts.dialog
  select(sections.some((s) => s.id === initial) ? initial : 'layout')
  parts.dialog.showModal()
  tabs.find((tab) => tab.getAttribute('aria-selected') === 'true')?.focus()
}
