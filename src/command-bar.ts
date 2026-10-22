import { getCurrentWindow } from '@tauri-apps/api/window'
import { readText, writeText } from '@tauri-apps/plugin-clipboard-manager'
import { attachCompletion } from './command-completion'
import { commandInput, commandSummary, matchesQuery, tokenizeCommand } from './commands-model'
import { button, confirmDialog, modal } from './dialogs'
import { h, reportError, setStatus } from './dom'
import { openFavoriteDialog } from './favorites'
import { addHistory, clearHistory, commandHistory, onHistory, removeHistory } from './history'
import { isRtl, ltr, messages, pl } from './i18n'
import { common } from './i18n-common'
import { type IconName, icon } from './icons'
import { showMenuFor } from './menu'
import { addPathHistory } from './path-history'

import { activeTerminal, onActive } from './sessions'
import type { TerminalSession } from './terminal'

const HIDDEN_KEY = 'gx.commandBar.hidden'
const MENU_RECENT = 15
const MAX_ROWS = 6

const report = reportError

const t = messages({
  noSession: {
    zh: '没有可发送的会话：先打开本地终端或连接服务器',
    en: 'No session to send to. Open a local terminal or connect to a server first.',
    ug: 'يوللىغىلى بولىدىغان ئەڭگىمە يوق: ئالدى بىلەن يەرلىك تېرمىنال ئېچىڭ ياكى مۇلازىمېتىرغا ئۇلاڭ',
  },
  fullscreen: { zh: '全屏', en: 'Full screen', ug: 'پۈتۈن ئېكران' },
  enterFullscreen: {
    zh: '终端全屏（F11）',
    en: 'Full-screen terminal (F11)',
    ug: 'تېرمىنالنى پۈتۈن ئېكران قىل (F11)',
  },
  exitFullscreen: {
    zh: '退出全屏（F11）',
    en: 'Exit full screen (F11)',
    ug: 'پۈتۈن ئېكراندىن چېكىن (F11)',
  },
  noSelection: {
    zh: '终端里没有选中的文字',
    en: 'No text selected in the terminal',
    ug: 'تېرمىنالدا تاللانغان تېكىست يوق',
  },
  copiedChars: {
    zh: '已复制 {n} 个字符',
    en: (p) => `Copied ${pl('character')(p)}`,
    ug: '{n} ھەرپ كۆچۈرۈلدى',
  },
  clipboardEmpty: { zh: '剪贴板是空的', en: 'The clipboard is empty', ug: 'چاپلاش تاختىسى بوش' },
  noClear: {
    zh: '全屏程序（如 vim、top）运行时无法清空',
    en: "Can't clear while a full-screen program (such as vim or top) is running",
    ug: 'پۈتۈن ئېكرانلىق پروگرامما (مەسىلەن vim، top) ئىجرا بولۇۋاتقاندا تازىلىغىلى بولمايدۇ',
  },
  historyEmpty: {
    zh: '指令历史已经是空的',
    en: 'Command history is already empty',
    ug: 'بۇيرۇق تارىخى ئاللىقاچان بوش',
  },
  clearTitle: { zh: '清除指令历史', en: 'Clear command history', ug: 'بۇيرۇق تارىخىنى تازىلاش' },
  clearText: {
    zh: '将删除全部 {n} 条指令历史，无法恢复。收藏不受影响。',
    en: (p) =>
      `This deletes ${Number(p.n) === 1 ? 'the 1 command' : `all ${pl('command')(p)}`} in history and can't be undone. Favorites are kept.`,
    ug: 'بارلىق {n} بۇيرۇق تارىخى ئۆچۈرۈلىدۇ، ئەسلىگە كەلتۈرگىلى بولمايدۇ. يىغقۇچقا تەسىر يەتمەيدۇ.',
  },
  clearHistory: { zh: '清除历史', en: 'Clear history', ug: 'تارىخنى تازىلا' },
  clearHistoryHint: {
    zh: '清除全部指令历史',
    en: 'Clear all command history',
    ug: 'بارلىق بۇيرۇق تارىخىنى تازىلا',
  },
  clearAll: { zh: '清除全部历史', en: 'Clear all history', ug: 'بارلىق تارىخنى تازىلا' },
  noHistory: { zh: '还没有历史记录', en: 'No history yet', ug: 'تېخى تارىخ خاتىرىسى يوق' },
  allHistory: { zh: '查看全部历史…', en: 'View all history…', ug: 'بارلىق تارىخنى كۆر…' },
  historyTitle: { zh: '指令历史', en: 'Command history', ug: 'بۇيرۇق تارىخى' },
  searchHistory: {
    zh: '搜索历史指令',
    en: 'Search command history',
    ug: 'تارىختىكى بۇيرۇقلارنى ئىزدە',
  },
  historyList: { zh: '历史指令', en: 'Past commands', ug: 'تارىختىكى بۇيرۇقلار' },
  matchCount: {
    zh: '匹配 {shown} / {all} 条',
    en: '{shown} of {all} match',
    ug: '{shown} / {all} ماس كەلدى',
  },
  totalCount: {
    zh: '共 {n} 条，最新的在上面',
    en: (p) => `${pl('command')(p)}, newest first`,
    ug: 'جەمئىي {n}، ئەڭ يېڭىسى ئۈستىدە',
  },
  noMatch: { zh: '没有匹配的指令', en: 'No matching commands', ug: 'ماس كېلىدىغان بۇيرۇق يوق' },
  historyHint: {
    zh: '发送过的指令会出现在这里',
    en: 'Commands you send show up here',
    ug: 'يوللىغان بۇيرۇقلىرىڭىز بۇ يەردە كۆرۈنىدۇ',
  },
  fill: { zh: '填入', en: 'Insert', ug: 'تولدۇر' },
  send: { zh: '发送', en: 'Send', ug: 'يوللا' },
  favorite: { zh: '收藏', en: 'Favorite', ug: 'يىغقۇچقا قوش' },
  favoriteHint: {
    zh: '收藏输入框里的指令',
    en: 'Add the command in the input box to favorites',
    ug: 'كىرگۈزۈش رامكىسىدىكى بۇيرۇقنى يىغقۇچقا قوش',
  },
  deleteHistory: {
    zh: '删除历史：{command}',
    en: 'Delete from history: {command}',
    ug: 'تارىختىن ئۆچۈر: {command}',
  },
  findHint: {
    zh: '在终端输出中搜索',
    en: 'Search terminal output',
    ug: 'تېرمىنال چىقىرىمىدىن ئىزدە',
  },
  noTerminal: { zh: '没有终端', en: 'No terminal', ug: 'تېرمىنال يوق' },
  noResults: { zh: '无结果', en: 'No results', ug: 'نەتىجە يوق' },
  manyResults: { zh: '{n}+ 处', en: '{n}+ matches', ug: '{n}+ ئورۇن' },
  badRegex: {
    zh: '正则无效',
    en: 'Invalid regular expression',
    ug: 'مۇنتىزىم ئىپادە ئىناۋەتسىز',
  },
  matchCase: { zh: '区分大小写', en: 'Match case', ug: 'چوڭ-كىچىك ھەرپنى پەرقلەندۈر' },
  regex: { zh: '正则', en: 'Regex', ug: 'مۇنتىزىم ئىپادە' },
  prev: { zh: '上一个', en: 'Previous', ug: 'ئالدىنقى' },
  prevHint: {
    zh: '上一个匹配（Shift+Enter）',
    en: 'Previous match (Shift+Enter)',
    ug: 'ئالدىنقى ماسلىق (Shift+Enter)',
  },
  next: { zh: '下一个', en: 'Next', ug: 'كېيىنكى' },
  nextHint: {
    zh: '下一个匹配（Enter）',
    en: 'Next match (Enter)',
    ug: 'كېيىنكى ماسلىق (Enter)',
  },
  closeFind: { zh: '关闭搜索', en: 'Close search', ug: 'ئىزدەشنى ياپ' },
  closeFindHint: {
    zh: '关闭搜索（Esc）',
    en: 'Close search (Esc)',
    ug: 'ئىزدەشنى ياپ (Esc)',
  },
  commandInput: { zh: '指令输入', en: 'Command input', ug: 'بۇيرۇق كىرگۈزۈش' },
  inputHint: {
    zh: '输入指令后按 Enter 发送到当前会话，Shift+Enter 换行，↑↓ 翻看历史，Tab 自动补全',
    en: 'Type a command and press Enter to send it to the current session. Shift+Enter for a new line, ↑↓ for history, Tab to complete',
    ug: 'بۇيرۇق كىرگۈزۈپ Enter نى باسسىڭىز نۆۋەتتىكى ئەڭگىمىگە يوللىنىدۇ، Shift+Enter يېڭى قۇر، ↑↓ تارىخ، Tab ئاپتوماتىك تولۇقلاش',
  },
  tools: { zh: '指令栏工具', en: 'Command bar tools', ug: 'بۇيرۇق بالدىقى قوراللىرى' },
  recent: { zh: '最近的指令', en: 'Recent commands', ug: 'يېقىنقى بۇيرۇقلار' },
  viewHistory: { zh: '查看历史', en: 'View history', ug: 'تارىخنى كۆر' },
  viewHistoryHint: {
    zh: '查看和搜索全部指令历史',
    en: 'View and search all command history',
    ug: 'بارلىق بۇيرۇق تارىخىنى كۆرۈش ۋە ئىزدەش',
  },
  clearScreen: { zh: '清空屏幕', en: 'Clear screen', ug: 'ئېكراننى تازىلا' },
  clearScreenHint: {
    zh: '清空屏幕（之前的内容留在回滚里，可用终端右上角的 ↑↓ 找回）',
    en: 'Clear screen (earlier output stays in the scrollback; ↑↓ at the top right of the terminal brings it back)',
    ug: 'ئېكراننى تازىلا (ئىلگىرىكى مەزمۇن ئارقىغا يۆگەشتە قالىدۇ، تېرمىنالنىڭ ئوڭ ئۈستىدىكى ↑↓ ئارقىلىق قايتۇرۇۋالغىلى بولىدۇ)',
  },
  copyHint: {
    zh: '复制终端中选中的文字',
    en: 'Copy the text selected in the terminal',
    ug: 'تېرمىنالدا تاللانغان تېكىستنى كۆچۈر',
  },
  pasteHint: {
    zh: '粘贴剪贴板内容到终端',
    en: 'Paste the clipboard into the terminal',
    ug: 'چاپلاش تاختىسىدىكى مەزمۇننى تېرمىنالغا چاپلا',
  },
  search: { zh: '搜索', en: 'Search', ug: 'ئىزدە' },
  searchHint: {
    zh: '在终端输出中搜索（Ctrl+Shift+F）',
    en: 'Search terminal output (Ctrl+Shift+F)',
    ug: 'تېرمىنال چىقىرىمىدىن ئىزدە (Ctrl+Shift+F)',
  },
  hideBar: { zh: '隐藏指令栏', en: 'Hide command bar', ug: 'بۇيرۇق بالدىقىنى يوشۇر' },
  hideBarHint: {
    zh: '隐藏指令栏（工具栏的「指令栏」按钮可以再打开）',
    en: 'Hide command bar (the Command bar button in the toolbar brings it back)',
    ug: 'بۇيرۇق بالدىقىنى يوشۇر (قورال بالدىقىدىكى «بۇيرۇق بالدىقى» كۇنۇپكىسى ئارقىلىق قايتا ئاچقىلى بولىدۇ)',
  },
})

let root: HTMLElement
let input: HTMLTextAreaElement
let toggleButton: HTMLButtonElement | null = null
let fullscreenButton: HTMLButtonElement
let fullscreen = false
/** Position in history while browsing with the arrow keys; null when editing fresh text. */
let browsing: number | null = null
let draft = ''
let openFindBar: () => void = () => {}

function liveTerminal(): TerminalSession | null {
  const terminal = activeTerminal()
  if (terminal?.live) return terminal
  setStatus(t('noSession'), 'error')
  return null
}

/** Sends text to the visible session as typed lines and records it in history. */
export function sendCommand(text: string): boolean {
  if (text.trim() === '') return false
  const terminal = liveTerminal()
  if (!terminal) return false
  terminal.input(commandInput(text))
  addHistory(text).catch(report)
  const tokens = tokenizeCommand(text.trim())
  if (tokens.length >= 2 && tokens[0].text === 'cd') {
    addPathHistory(tokens[1].text).catch(report)
  }
  return true
}

/** Puts text into the command bar for review before sending. */
export function fillCommand(text: string): void {
  setCommandBarHidden(false)
  setInput(text)
  input.focus()
}

function setInput(text: string): void {
  input.value = text
  autosize()
  input.setSelectionRange(text.length, text.length)
}

function autosize(): void {
  const lines = input.value.split('\n').length
  input.rows = Math.min(MAX_ROWS, Math.max(1, lines))
  // The empty input shows the hint, a sentence in the interface language; typed text is shell.
  input.dir = input.value || !isRtl() ? 'ltr' : 'rtl'
}

function submit(): void {
  if (!sendCommand(input.value)) return
  browsing = null
  setInput('')
}

function browse(step: -1 | 1): boolean {
  const list = commandHistory()
  if (list.length === 0) return false
  if (browsing === null) {
    if (step === 1) return false
    draft = input.value
    browsing = list.length
  }
  const next = browsing + step
  if (next < 0) return true
  if (next >= list.length) {
    browsing = null
    setInput(draft)
    return true
  }
  browsing = next
  setInput(list[next])
  return true
}

function setCommandBarHidden(hidden: boolean): void {
  if (root.hidden === hidden) return
  root.hidden = hidden
  localStorage.setItem(HIDDEN_KEY, hidden ? '1' : '0')
  toggleButton?.setAttribute('aria-pressed', String(!hidden))
  if (hidden) activeTerminal()?.focus()
}

export function toggleCommandBar(): void {
  setCommandBarHidden(!root.hidden)
  if (!root.hidden) input.focus()
}

async function setFullscreen(on: boolean): Promise<void> {
  fullscreen = on
  document.querySelector('.app')?.classList.toggle('gx-focus', on)
  fullscreenButton.setAttribute('aria-pressed', String(on))
  fullscreenButton.replaceChildren(icon(on ? 'corners-in' : 'corners-out'))
  fullscreenButton.title = t(on ? 'exitFullscreen' : 'enterFullscreen')
  await getCurrentWindow().setFullscreen(on).catch(report)
}

/** Opens the search row under the terminal. */
export function openFind(): void {
  openFindBar()
}

export async function copySelection(): Promise<void> {
  const text = activeTerminal()?.selection() || input.value
  if (!text) {
    setStatus(t('noSelection'), 'error')
    return
  }
  await writeText(text)
  setStatus(t('copiedChars', { n: [...text].length }))
}

export async function pasteClipboard(): Promise<void> {
  const text = await readText()
  if (!text) {
    setStatus(t('clipboardEmpty'), 'error')
    return
  }
  const terminal = liveTerminal()
  if (!terminal) return
  await terminal.paste(text)
  terminal.focus()
}

/** Recoverable clear of the visible terminal. */
export function softClear(): void {
  const terminal = activeTerminal()
  if (!terminal) return
  if (!terminal.softClear()) setStatus(t('noClear'), 'error')
  terminal.focus()
}

async function confirmClearHistory(): Promise<boolean> {
  const count = commandHistory().length
  if (count === 0) {
    setStatus(t('historyEmpty'))
    return false
  }
  const ok = await confirmDialog(
    t('clearTitle'),
    t('clearText', { n: count }),
    t('clearHistory'),
    true,
  )
  if (ok) await clearHistory()
  return ok
}

function historyMenu(anchor: HTMLElement): void {
  const recent = commandHistory().slice(-MENU_RECENT).reverse()
  showMenuFor(anchor, [
    ...(recent.length === 0
      ? [{ label: t('noHistory'), action: () => {}, disabled: true }]
      : recent.map((command) => ({
          label: commandSummary(command, 50),
          action: () => fillCommand(command),
        }))),
    'separator',
    { label: t('allHistory'), action: openHistoryDialog },
  ])
}

function openHistoryDialog(): void {
  const parts = modal('history', t('historyTitle'), 'lg')
  const search = h('input', {
    type: 'search',
    placeholder: t('searchHistory'),
    'aria-label': t('searchHistory'),
    spellcheck: 'false',
  })
  const count = h('p', { class: 'cmd-history-count', 'aria-live': 'polite' })
  const list = h('ul', { class: 'cmd-history-list', 'aria-label': t('historyList') })
  parts.body.append(h('div', { class: 'cmd-history-head' }, search, count), list)

  const render = () => {
    const all = commandHistory()
    const shown = all.filter((c) => matchesQuery(search.value, c)).reverse()
    count.textContent = search.value
      ? t('matchCount', { shown: shown.length, all: all.length })
      : t('totalCount', { n: all.length })
    list.replaceChildren(
      ...(shown.length === 0
        ? [
            h('li', {
              class: 'cmd-history-empty',
              text: all.length ? t('noMatch') : t('historyHint'),
            }),
          ]
        : shown.map((command) =>
            h(
              'li',
              { class: 'cmd-history-item' },
              h('pre', {
                class: 'cmd-history-text mono',
                dir: 'ltr',
                text: command,
                title: command,
              }),
              h(
                'div',
                { class: 'cmd-history-actions' },
                h('button', {
                  type: 'button',
                  class: 'icon-button',
                  text: t('fill'),
                  onclick: () => {
                    parts.dialog.close()
                    fillCommand(command)
                  },
                }),
                h('button', {
                  type: 'button',
                  class: 'icon-button',
                  text: t('send'),
                  onclick: () => {
                    if (sendCommand(command)) parts.dialog.close()
                  },
                }),
                h('button', {
                  type: 'button',
                  class: 'icon-button',
                  text: t('favorite'),
                  onclick: () => void openFavoriteDialog({ command, note: '' }).catch(report),
                }),
                h('button', {
                  type: 'button',
                  class: 'icon-button',
                  text: common('delete'),
                  'aria-label': t('deleteHistory', { command: ltr(commandSummary(command, 40)) }),
                  onclick: () => removeHistory(command).catch(report),
                }),
              ),
            ),
          )),
    )
  }
  search.addEventListener('input', render)
  const unsubscribe = onHistory(render)
  render()

  parts.actions.append(
    button(t('clearAll'), () => void confirmClearHistory().catch(report), 'danger'),
    button(common('close'), () => parts.dialog.close(), 'primary'),
  )
  parts.dialog.addEventListener(
    'close',
    () => {
      unsubscribe()
      parts.dialog.remove()
    },
    { once: true },
  )
  parts.dialog.showModal()
  search.focus()
}

function findBar(): { element: HTMLElement; open: () => void } {
  const text = h('input', {
    type: 'search',
    class: 'cmd-find-input',
    placeholder: t('findHint'),
    'aria-label': t('findHint'),
    spellcheck: 'false',
  })
  const caseBox = h('input', { type: 'checkbox' })
  const regexBox = h('input', { type: 'checkbox' })
  const count = h('span', { class: 'cmd-find-count', 'aria-live': 'polite' })
  let searched: TerminalSession | null = null

  const run = (backwards: boolean, incremental = false) => {
    const terminal = activeTerminal()
    if (!terminal) {
      count.textContent = t('noTerminal')
      return
    }
    if (searched && searched !== terminal) searched.clearFind()
    searched = terminal
    terminal.onFindResult = ({ index, count: total }) => {
      if (total === 0) count.textContent = t('noResults')
      else
        count.textContent = index < 0 ? t('manyResults', { n: total }) : `${index + 1} / ${total}`
    }
    if (!text.value) {
      terminal.clearFind()
      count.textContent = ''
      return
    }
    try {
      const options = { caseSensitive: caseBox.checked, regex: regexBox.checked, incremental }
      if (!terminal.find(text.value, options, backwards)) count.textContent = t('noResults')
    } catch {
      count.textContent = t('badRegex')
    }
  }

  const element = h(
    'div',
    { class: 'cmd-find', role: 'search', hidden: true },
    text,
    h('label', { class: 'check' }, caseBox, t('matchCase')),
    h('label', { class: 'check' }, regexBox, t('regex')),
    count,
    tool(t('prev'), t('prevHint'), () => run(true), 'caret-up'),
    tool(t('next'), t('nextHint'), () => run(false), 'caret-down'),
    tool(t('closeFind'), t('closeFindHint'), () => close(), 'x'),
  )
  const close = () => {
    element.hidden = true
    searched?.clearFind()
    searched = null
    count.textContent = ''
    activeTerminal()?.focus()
  }
  text.addEventListener('input', () => run(false, true))
  caseBox.addEventListener('change', () => run(false, true))
  regexBox.addEventListener('change', () => run(false, true))
  text.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      run(event.shiftKey)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      close()
    }
  })
  onActive(() => {
    if (element.hidden) return
    searched?.clearFind()
    searched = null
    count.textContent = ''
  })
  const open = () => {
    setCommandBarHidden(false)
    element.hidden = false
    const selected = activeTerminal()?.selection()
    if (selected && !selected.includes('\n')) text.value = selected
    text.focus()
    text.select()
    if (text.value) run(false, true)
  }
  return { element, open }
}

/** Icon-only button: the label is its accessible name and the hover tooltip carries the hint. */
function tool(
  label: string,
  title: string,
  onclick: (button: HTMLButtonElement) => unknown,
  iconName: IconName,
) {
  const element: HTMLButtonElement = h(
    'button',
    { type: 'button', class: 'icon-button cmd-tool', title, 'aria-label': label },
    icon(iconName),
  )
  element.addEventListener('click', () => {
    Promise.resolve(onclick(element)).catch(report)
  })
  return element
}

/** Builds the command bar into `host` (the row under the terminals). */
export function initCommandBar(host: HTMLElement, toggle: HTMLButtonElement): void {
  root = host
  toggleButton = toggle
  input = h('textarea', {
    class: 'cmd-input mono',
    // Shell syntax reads left to right in every language; Ctrl+←/→ below relies on it. While
    // empty, autosize turns it to the interface direction so the hint reads in order.
    dir: isRtl() ? 'rtl' : 'ltr',
    rows: 1,
    spellcheck: 'false',
    autocomplete: 'off',
    'aria-label': t('commandInput'),
    placeholder: t('inputHint'),
  })
  const find = findBar()
  openFindBar = find.open
  fullscreenButton = tool(
    t('fullscreen'),
    t('enterFullscreen'),
    () => setFullscreen(!fullscreen),
    'corners-out',
  )
  fullscreenButton.setAttribute('aria-pressed', 'false')

  const completion = attachCompletion(input, autosize)

  const tools = h(
    'div',
    { class: 'cmd-tools', role: 'toolbar', 'aria-label': t('tools') },
    h(
      'div',
      { class: 'cmd-group' },
      tool(t('recent'), t('recent'), historyMenu, 'clock-counter-clockwise'),
      tool(t('viewHistory'), t('viewHistoryHint'), openHistoryDialog, 'list'),
      tool(t('clearHistory'), t('clearHistoryHint'), confirmClearHistory, 'trash'),
    ),
    h(
      'div',
      { class: 'cmd-group' },
      tool(t('clearScreen'), t('clearScreenHint'), softClear, 'broom'),
      tool(common('copy'), t('copyHint'), copySelection, 'copy'),
      tool(common('paste'), t('pasteHint'), pasteClipboard, 'clipboard-text'),
      tool(t('search'), t('searchHint'), find.open, 'magnifying-glass'),
      tool(
        t('favorite'),
        t('favoriteHint'),
        () => openFavoriteDialog({ command: input.value, note: '' }),
        'star',
      ),
    ),
    h(
      'div',
      { class: 'cmd-group' },
      fullscreenButton,
      tool(t('hideBar'), t('hideBarHint'), () => setCommandBarHidden(true), 'eye-slash'),
    ),
  )
  root.append(
    find.element,
    h(
      'div',
      { class: 'cmd-row' },
      input,
      h(
        'button',
        {
          type: 'button',
          class: 'button primary small cmd-send',
          onclick: submit,
        },
        icon('paper-plane-right'),
        ` ${t('send')}`,
      ),
      tools,
    ),
  )

  input.addEventListener('input', () => {
    browsing = null
    autosize()
  })
  input.addEventListener('keydown', (event) => {
    if (event.isComposing) return
    const plain = !event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey
    if (completion.keydown(event)) return

    if (event.key === 'Enter' && !event.shiftKey && !event.altKey) {
      event.preventDefault()
      completion.hide()
      submit()
    } else if (
      (event.key === 'ArrowLeft' || event.key === 'ArrowRight') &&
      event.ctrlKey &&
      !event.shiftKey &&
      !event.altKey
    ) {
      event.preventDefault()
      // Selects the previous / next field, wherever the caret sits between them.
      const tokens = tokenizeCommand(input.value)
      const at = input.selectionStart
      const target =
        event.key === 'ArrowLeft'
          ? tokens.filter((token) => token.start < at).at(-1)
          : tokens.find((token) => token.start > at)
      if (target) input.setSelectionRange(target.start, target.end)
    } else if ((event.key === 'ArrowUp' || event.key === 'ArrowDown') && plain) {
      const before = input.value.slice(0, input.selectionStart)
      const after = input.value.slice(input.selectionEnd)
      if (event.key === 'ArrowUp' && before.includes('\n')) return
      if (event.key === 'ArrowDown' && after.includes('\n')) return
      if (browse(event.key === 'ArrowUp' ? -1 : 1)) event.preventDefault()
    } else if (event.key === 'Escape' && plain) {
      event.preventDefault()
      activeTerminal()?.focus()
    }
  })

  toggle.addEventListener('click', toggleCommandBar)
  const hidden = localStorage.getItem(HIDDEN_KEY) === '1'
  root.hidden = hidden
  toggle.setAttribute('aria-pressed', String(!hidden))

  // Capture phase, so the shortcuts win over the focused terminal.
  document.addEventListener(
    'keydown',
    (event) => {
      if (event.key === 'F11' && !event.ctrlKey && !event.altKey && !event.shiftKey) {
        event.preventDefault()
        event.stopPropagation()
        void setFullscreen(!fullscreen)
      } else if (event.ctrlKey && event.shiftKey && !event.altKey && event.code === 'KeyF') {
        event.preventDefault()
        event.stopPropagation()
        find.open()
      }
    },
    true,
  )
}
