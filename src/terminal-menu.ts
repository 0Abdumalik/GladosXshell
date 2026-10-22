import { writeText } from '@tauri-apps/plugin-clipboard-manager'
import { copySelection, openFind, pasteClipboard, softClear } from './command-bar'
import { confirmDialog } from './dialogs'
import { reportError, setStatus } from './dom'
import { messages, pl } from './i18n'
import { common } from './i18n-common'
import { showMenu } from './menu'
import { menuItems } from './plugins/registry'

import { activeSession, activeTerminal, logMenuItem, splitItems } from './sessions'
import { openSettings } from './settings'
import { settings, updateSettings } from './settings-store'
import { pickBackgroundImage } from './settings-terminal'
import type { TerminalSession } from './terminal'

const t = messages({
  empty: { zh: '终端里还没有内容', en: 'The terminal is empty', ug: 'تېرمىنالدا تېخى مەزمۇن يوق' },
  copiedAll: {
    zh: '已复制全部 {n} 行',
    en: (p) => `Copied all ${pl('line')(p)}`,
    ug: 'ھەممە {n} قۇر كۆچۈرۈلدى',
  },
  wipeTitle: { zh: '清空缓存', en: 'Clear scrollback', ug: 'غەملەكنى تازىلاش' },
  wipeMessage: {
    zh: '将丢弃这个终端的全部回滚内容和清空标记，无法找回。只影响本地显示，服务器上的程序不受影响。',
    en: "Discards this terminal's scrollback and clear marks for good. Only the local view changes; programs on the server are not affected.",
    ug: 'بۇ تېرمىنالنىڭ بارلىق ئارقا مەزمۇنى ۋە تازىلاش بەلگىلىرى تاشلىنىدۇ، ئەسلىگە كەلتۈرگىلى بولمايدۇ. پەقەت يەرلىك كۆرۈنۈشكىلا تەسىر قىلىدۇ، مۇلازىمېتىردىكى پروگراممىلارغا تەسىر يەتمەيدۇ.',
  },
  wipeConfirm: { zh: '清空缓存', en: 'Clear scrollback', ug: 'غەملەكنى تازىلا' },
  copyAll: { zh: '复制全部', en: 'Copy all', ug: 'ھەممىنى كۆچۈر' },
  pasteSelection: { zh: '粘贴所选', en: 'Paste selection', ug: 'تاللانغاننى چاپلا' },
  find: { zh: '查找…', en: 'Find…', ug: 'ئىزدە…' },
  softClear: {
    zh: '清空（可找回）',
    en: 'Clear (recoverable)',
    ug: 'تازىلا (ئەسلىگە كەلتۈرگىلى بولىدۇ)',
  },
  jumpClear: {
    zh: '回到上次清空处',
    en: 'Back to last clear',
    ug: 'ئالدىنقى تازىلانغان يەرگە قايت',
  },
  wipeItem: { zh: '清空缓存…', en: 'Clear scrollback…', ug: 'غەملەكنى تازىلا…' },
  setBackground: { zh: '设置背景图片…', en: 'Set background image…', ug: 'تەگلىك رەسىمى بەلگىلە…' },
  removeBackground: {
    zh: '移除背景图片',
    en: 'Remove background image',
    ug: 'تەگلىك رەسىمىنى چىقىرىۋەت',
  },
  terminalSettings: { zh: '终端设置…', en: 'Terminal settings…', ug: 'تېرمىنال تەڭشىكى…' },
})

const report = reportError
const run = (task: Promise<unknown>) => void task.catch(report)

async function copyAll(terminal: TerminalSession): Promise<void> {
  const text = terminal.allText()
  if (!text) {
    setStatus(t('empty'), 'error')
    return
  }
  await writeText(text)
  setStatus(t('copiedAll', { n: text.split('\n').length }))
}

async function wipe(terminal: TerminalSession): Promise<void> {
  const ok = await confirmDialog(t('wipeTitle'), t('wipeMessage'), t('wipeConfirm'), true)
  if (ok) terminal.wipe()
  terminal.focus()
}

/** Right-click menu for the terminal area. */
export function initTerminalMenu(host: HTMLElement): void {
  host.addEventListener('contextmenu', (event) => {
    const terminal = activeTerminal()
    if (!terminal?.element.contains(event.target as Node)) return
    event.preventDefault()
    const selected = terminal.selection()
    const live = terminal.live
    const image = settings().terminal.backgroundImage !== ''
    const key = activeSession()?.key
    showMenu(event.clientX, event.clientY, [
      {
        label: common('copy'),
        icon: 'copy',
        action: () => run(copySelection()),
        disabled: !selected,
      },
      { label: t('copyAll'), icon: 'selection-all', action: () => run(copyAll(terminal)) },
      {
        label: common('paste'),
        icon: 'clipboard-text',
        action: () => run(pasteClipboard()),
        disabled: !live,
      },
      {
        label: t('pasteSelection'),
        icon: 'paper-plane-right',
        action: () => run(terminal.paste(selected).then(() => terminal.focus())),
        disabled: !live || !selected,
      },
      'separator',
      { label: t('find'), icon: 'magnifying-glass', action: openFind },
      { label: t('softClear'), icon: 'broom', action: softClear },
      {
        label: t('jumpClear'),
        icon: 'clock-counter-clockwise',
        action: () => terminal.jumpClear(-1),
        disabled: terminal.clearMarks === 0,
      },
      { label: t('wipeItem'), icon: 'trash', action: () => run(wipe(terminal)), danger: true },
      'separator',
      ...(key === undefined ? [] : [...splitItems(key), 'separator' as const]),
      {
        label: t('setBackground'),
        icon: 'image',
        action: () => run(pickBackgroundImage(report)),
      },
      {
        label: t('removeBackground'),
        icon: 'image-broken',
        action: () =>
          run(
            updateSettings((d) => {
              d.terminal.backgroundImage = ''
            }),
          ),
        disabled: !image,
      },
      ...(key === undefined ? [] : [logMenuItem(key)]),
      { label: t('terminalSettings'), icon: 'gear', action: () => openSettings('terminal') },
      ...menuItems('terminal/context', {
        sessionId: live ? terminal.sessionId : null,
        selection: selected,
        live,
      }),
    ])
  })
}
