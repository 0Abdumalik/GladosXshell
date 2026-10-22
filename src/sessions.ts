import { type Channel, invoke } from '@tauri-apps/api/core'
import { type LogLevel, logApp } from './applog'
import { h, reportError, setStatus } from './dom'
import { openDownloads } from './download-manager'
import { closeTabRecords, type TabRef } from './downloads'
import { ltr, messages, pl } from './i18n'
import { common } from './i18n-common'
import { icon } from './icons'
import { loadShells, localShells } from './local-shells'
import { withUnlock } from './master'
import { type MenuItem, showMenu } from './menu'
import {
  clampRatio,
  type PaneDirection,
  type PaneTree,
  paneKeys,
  paneToward,
  removePane,
  type SplitDir,
  splitPane,
} from './panes'
import { command, menuItems, runCommand } from './plugins/registry'
import { hostKeyChannel, inputPromptChannel } from './prompts'
import {
  type Advanced,
  type AuthMethod,
  describeError,
  describeExit,
  errorKind,
  exitIsAbnormal,
  type ServerView,
  type SessionExit,
  type SshOpened,
} from './protocol'
import { type SavedTabs, snapshotTabs, type TabTarget } from './saved-tabs'
import { settings } from './settings-store'
import { type SessionEvent, TerminalSession } from './terminal'

const t = messages({
  closedTab: { zh: '已关闭的标签', en: 'Closed tab', ug: 'يېپىلغان بەتكۈچ' },
  logName: { zh: '{title}（{target}）', en: '{title} ({target})', ug: '{title} ({target})' },
  loggingTitle: {
    zh: '{title}（正在记录日志：{path}）',
    en: '{title} (logging to {path})',
    ug: '{title} (خاتىرىلىنىۋاتىدۇ: {path})',
  },
  closeTitle: { zh: '关闭 {title}', en: 'Close {title}', ug: '{title} نى ياپ' },
  notConnected: { zh: '会话未连接', en: 'Session not connected', ug: 'ئەڭگىمە ئۇلانمىغان' },
  stopLog: { zh: '停止记录日志', en: 'Stop logging', ug: 'خاتىرىلەشنى توختات' },
  startLog: { zh: '开始记录日志', en: 'Start logging', ug: 'خاتىرىلەشنى باشلا' },
  logStopped: {
    zh: '已停止记录日志：{path}',
    en: 'Stopped logging: {path}',
    ug: 'خاتىرىلەش توختىتىلدى: {path}',
  },
  logNeedsLive: {
    zh: '会话未连接，连接后才能记录日志',
    en: 'Session not connected; connect it to start logging',
    ug: 'ئەڭگىمە ئۇلانمىغان، ئۇلانغاندىن كېيىن ئاندىن خاتىرىلىگىلى بولىدۇ',
  },
  logging: { zh: '正在记录日志：{path}', en: 'Logging to {path}', ug: 'خاتىرىلىنىۋاتىدۇ: {path}' },
  resizeSplit: { zh: '调整分屏大小', en: 'Resize split', ug: 'بۆلۈش چوڭلۇقىنى تەڭشەش' },
  resizeHint: {
    zh: '拖动调整大小，双击均分',
    en: 'Drag to resize, double-click to even out',
    ug: 'سۆرەپ چوڭلۇقىنى تەڭشەڭ، قوش چېكىپ تەڭ بۆلۈڭ',
  },
  paneGone: {
    zh: '分屏中的标签 {key} 已不存在',
    en: 'Tab {key} in the split no longer exists',
    ug: 'بۆلۈشتىكى {key}-بەتكۈچ ئەمدى مەۋجۇت ئەمەس',
  },
  closedLive: {
    zh: '关闭标签 {name}，断开连接',
    en: 'Closed tab {name} and disconnected',
    ug: '{name} بەتكۈچى يېپىلىپ، ئۇلىنىش ئۈزۈلدى',
  },
  closedConnecting: {
    zh: '关闭标签 {name}，放弃正在进行的连接',
    en: 'Closed tab {name} and gave up the connection in progress',
    ug: '{name} بەتكۈچى يېپىلىپ، داۋاملىشىۋاتقان ئۇلىنىشتىن ۋاز كەچتى',
  },
  reopen: { zh: '重新打开', en: 'Reopen', ug: 'قايتا ئاچ' },
  closeTab: { zh: '关闭标签', en: 'Close tab', ug: 'بەتكۈچنى ياپ' },
  retryGaveUpLog: {
    zh: '{name} 自动重连 {n} 次仍未成功，已停止',
    en: (p) => `${p.name}: auto reconnect failed after ${pl('attempt')(p)}, stopped`,
    ug: '{name} غا {n} قېتىم ئاپتوماتىك قايتا ئۇلىنىش مۇۋەپپەقىيەتسىز بولدى، توختىتىلدى',
  },
  retryStopped: {
    zh: '自动重连已停止',
    en: 'Auto reconnect stopped',
    ug: 'ئاپتوماتىك قايتا ئۇلاش توختىتىلدى',
  },
  retryGaveUp: {
    zh: '{reason}\n已重试 {n} 次。',
    en: (p) => `${p.reason}\nTried ${pl('time')(p)}.`,
    ug: '{reason}\n{n} قېتىم قايتا سىنالدى.',
  },
  retryStatus: {
    zh: '{title}：{delay} 秒后第 {n} 次自动重连',
    en: '{title}: auto reconnect attempt {n} in {delay} s',
    ug: '{title}: {delay} سېكۇنتتىن كېيىن {n}-قېتىم ئاپتوماتىك قايتا ئۇلىنىدۇ',
  },
  retryTitle: {
    zh: '连接已断开，正在自动重连',
    en: 'Connection lost, reconnecting',
    ug: 'ئۇلىنىش ئۈزۈلدى، ئاپتوماتىك قايتا ئۇلىنىۋاتىدۇ',
  },
  retryDetail: {
    zh: '{reason}\n{delay} 秒后第 {n} 次重试。',
    en: '{reason}\nAttempt {n} in {delay} s.',
    ug: '{reason}\n{delay} سېكۇنتتىن كېيىن {n}-قېتىم قايتا سىنايدۇ.',
  },
  retryNow: { zh: '立即重连', en: 'Reconnect now', ug: 'ھازىرلا قايتا ئۇلا' },
  stopRetry: { zh: '停止重连', en: 'Stop reconnecting', ug: 'قايتا ئۇلاشنى توختات' },
  retryStoppedLog: {
    zh: '已停止自动重连 {name}',
    en: 'Stopped auto reconnect for {name}',
    ug: '{name} نىڭ ئاپتوماتىك قايتا ئۇلىنىشى توختىتىلدى',
  },
  disconnected: { zh: '连接已断开', en: 'Connection lost', ug: 'ئۇلىنىش ئۈزۈلدى' },
  connectingLog: {
    zh: '正在连接 {name}',
    en: 'Connecting to {name}',
    ug: '{name} غا ئۇلىنىۋاتىدۇ',
  },
  reconnectingLog: {
    zh: '重新连接 {name}',
    en: 'Reconnecting to {name}',
    ug: '{name} غا قايتا ئۇلىنىۋاتىدۇ',
  },
  connecting: {
    zh: '正在连接 {title}…',
    en: 'Connecting to {title}…',
    ug: '{title} غا ئۇلىنىۋاتىدۇ…',
  },
  reconnecting: {
    zh: '正在重新连接 {title}…',
    en: 'Reconnecting to {title}…',
    ug: '{title} غا قايتا ئۇلىنىۋاتىدۇ…',
  },
  lostLog: {
    zh: '{name} 连接已断开：{text}',
    en: '{name}: connection lost: {text}',
    ug: '{name} نىڭ ئۇلىنىشى ئۈزۈلدى: {text}',
  },
  titled: { zh: '{name}：{text}', en: '{name}: {text}', ug: '{name}: {text}' },
  sessionEnded: { zh: '会话已结束', en: 'Session ended', ug: 'ئەڭگىمە ئاخىرلاشتى' },
  connectedLog: {
    zh: '已连接 {name}，用时 {secs} 秒',
    en: 'Connected to {name} in {secs} s',
    ug: '{name} غا ئۇلاندى، {secs} سېكۇنت كەتتى',
  },
  connected: { zh: '已连接 {title}', en: 'Connected to {title}', ug: '{title} غا ئۇلاندى' },
  forwardFailedLog: {
    zh: '{name} 端口转发未能开启：{problem}',
    en: '{name}: port forwarding failed to start: {problem}',
    ug: '{name} نىڭ ئېغىز يوللىشى ئېچىلمىدى: {problem}',
  },
  forwardFailed: {
    zh: '端口转发未能开启：{problem}',
    en: 'Port forwarding failed to start: {problem}',
    ug: 'ئېغىز يوللاش ئېچىلمىدى: {problem}',
  },
  connectedForwardsFailed: {
    zh: '已连接 {title}，{n} 条端口转发未能开启',
    en: (p) => `Connected to ${p.title}; ${pl('port forward')(p)} failed to start`,
    ug: '{title} غا ئۇلاندى، {n} ئېغىز يوللاش ئېچىلمىدى',
  },
  connectFailedLog: {
    zh: '连接 {name} 失败：{message}',
    en: 'Failed to connect to {name}: {message}',
    ug: '{name} غا ئۇلىنىش مەغلۇپ بولدى: {message}',
  },
  connectFailed: { zh: '连接失败', en: 'Connection failed', ug: 'ئۇلىنىش مەغلۇپ بولدى' },
  logBadge: { zh: '日志', en: 'Log', ug: 'خاتىرە' },
  sideBySide: {
    zh: '与当前标签并排显示',
    en: 'Show beside current tab',
    ug: 'نۆۋەتتىكى بەتكۈچ بىلەن يانمۇيان كۆرسەت',
  },
  tabDownloads: {
    zh: '本标签下载管理器…',
    en: 'Downloads for this tab…',
    ug: 'بۇ بەتكۈچنىڭ چۈشۈرۈش باشقۇرغۇچى…',
  },
  fontBigger: { zh: '放大字号', en: 'Increase font size', ug: 'خەتنى چوڭايت' },
  fontSmaller: { zh: '缩小字号', en: 'Decrease font size', ug: 'خەتنى كىچىكلەت' },
  fontReset: { zh: '重置字号', en: 'Reset font size', ug: 'خەت چوڭلۇقىنى ئەسلىگە قايتۇر' },
  closeOthers: { zh: '关闭其他标签', en: 'Close other tabs', ug: 'باشقا بەتكۈچلەرنى ياپ' },
  // Tabs after this one; in a right-to-left layout they sit on its left.
  closeRight: {
    zh: '关闭右侧标签',
    en: 'Close tabs to the right',
    ug: 'كەينىدىكى بەتكۈچلەرنى ياپ',
  },
  localTerminal: { zh: '本地终端', en: 'Local terminal', ug: 'يەرلىك تېرمىنال' },
  newLocalShell: {
    zh: '新建本地终端（{name}）',
    en: 'New local terminal ({name})',
    ug: 'يېڭى يەرلىك تېرمىنال ({name})',
  },
  newLocal: { zh: '新建本地终端', en: 'New local terminal', ug: 'يېڭى يەرلىك تېرمىنال' },
  newShell: { zh: '新建 {name}', en: 'New {name}', ug: 'يېڭى {name}' },
  newConnection: { zh: '新建连接…', en: 'New connection…', ug: 'يېڭى ئۇلىنىش…' },
  manager: { zh: '连接管理器…', en: 'Connection manager…', ug: 'ئۇلىنىش باشقۇرغۇچ…' },
  closeAll: { zh: '关闭全部标签', en: 'Close all tabs', ug: 'بارلىق بەتكۈچلەرنى ياپ' },
  splitRight: { zh: '向右分屏', en: 'Split right', ug: 'ئوڭغا بۆل' },
  splitDown: { zh: '向下分屏', en: 'Split down', ug: 'ئاستىغا بۆل' },
  unsplit: { zh: '移出分屏', en: 'Remove from split', ug: 'بۆلۈشتىن چىقار' },
})

export type SessionKind = 'local' | 'ssh' | 'telnet' | 'serial' | 'bench'
export type SessionState = 'connecting' | 'live' | 'ended' | 'failed'

export interface SessionInfo {
  readonly key: number
  readonly kind: SessionKind
  title: string
  /** Backend session id; changes on reconnect. */
  id: number | null
  ssh: SshOpened | null
  /** `user@host[:port]` for SSH sessions. */
  target: string | null
  state: SessionState
  /** The session ended abnormally (network drop, killed) rather than by exiting. */
  lost: boolean
  /** Per-terminal font size override in pixels (null = use global default). */
  fontSize: number | null
  /** Working directory the shell last reported (OSC 7); null if it never has. */
  cwd: string | null
}

type OpenResult = number | SshOpened

export interface SessionSpec {
  kind: SessionKind
  title: string
  target?: string
  open: (
    onEvent: Channel<SessionEvent>,
    size: { cols: number; rows: number },
  ) => Promise<OpenResult>
  onExit?: (exit: SessionExit, session: TerminalSession) => void
  /** How to reopen this tab at the next start; omitted tabs are not restored. */
  saved?: TabTarget
  fontSize?: number | null
}

interface Tab {
  info: SessionInfo
  spec: SessionSpec
  session: TerminalSession
  tab: HTMLElement
  select: HTMLButtonElement
  label: HTMLElement
  close: HTMLButtonElement
  /** Set while auto-reconnecting after a drop; cleared once a connection succeeds. */
  retry: { attempt: number; timer: number | null } | null
  /** The log file this tab writes to; kept across reconnects so they append to one file. */
  log: { name: string; path: string } | null
  /** Badges set with markTab, by mark name. */
  marks: Map<string, HTMLElement>
}

const RETRY_DELAYS_SECS = [2, 5, 10, 20, 30, 60]
const MAX_RETRIES = 20
/** Errors where trying again later can help; auth and host key problems won't fix themselves. */
const RETRIABLE = new Set(['io', 'ssh', 'connect'])

type Listener<T> = (value: T) => void

interface PaneGroup {
  tree: PaneTree
  element: HTMLElement
}

const tabs = new Map<number, Tab>()
/** Tabs shown side by side, by member key; the members share one group. */
const groups = new Map<number, PaneGroup>()
const activeListeners: Listener<SessionInfo | null>[] = []
const connectedListeners: Listener<SessionInfo>[] = []
const endedListeners: Listener<SessionInfo>[] = []
const cwdListeners: Listener<SessionInfo>[] = []
const tabsListeners: (() => void)[] = []
let nextKey = 1
let activeKey: number | null = null
let tabList: HTMLElement
let terminals: HTMLElement
let empty: HTMLElement

/** Fires when the visible session changes or its state does. */
export function onActive(listener: Listener<SessionInfo | null>): void {
  activeListeners.push(listener)
}

/** Fires when a server session (SSH, Telnet, serial) finishes connecting, active or not. */
export function onConnected(listener: Listener<SessionInfo>): void {
  connectedListeners.push(listener)
}

/** Fires when a session's shell reports a new working directory; read `info.cwd`. */
export function onCwd(listener: Listener<SessionInfo>): () => void {
  cwdListeners.push(listener)
  return () => {
    const at = cwdListeners.indexOf(listener)
    if (at >= 0) cwdListeners.splice(at, 1)
  }
}

/** Fires once per backend session, when it exits or its tab closes. Read `info.id` for which. */
export function onEnded(listener: Listener<SessionInfo>): void {
  endedListeners.push(listener)
}

/** Tabs were opened, closed, reordered, brought to front or resized. */
export function onTabsChanged(listener: () => void): void {
  tabsListeners.push(listener)
}

function emitTabs(): void {
  for (const listener of tabsListeners) listener()
}

export function openTabs(): SavedTabs {
  const open = [...tabs.values()].map((entry) => ({
    key: entry.info.key,
    target: entry.spec.saved ?? null,
    fontSize: entry.info.fontSize,
  }))
  return snapshotTabs(open, activeKey)
}

export function selectTab(key: number): void {
  if (tabs.has(key)) activate(key)
}

export function activeSession(): SessionInfo | null {
  return activeKey === null ? null : (tabs.get(activeKey)?.info ?? null)
}

/** The terminal in the visible tab, if any. */
export function activeTerminal(): TerminalSession | null {
  return activeKey === null ? null : (tabs.get(activeKey)?.session ?? null)
}

export function allSessions(): SessionInfo[] {
  return [...tabs.values()].map((t) => t.info)
}

export function liveSshSessions(): SessionInfo[] {
  return [...tabs.values()].map((t) => t.info).filter((i) => i.kind === 'ssh' && i.state === 'live')
}

/**
 * Shows a badge on a tab and sets `data-mark-<mark>` on it and its terminal; a null label
 * removes both. Marks survive reconnects.
 */
export function markTab(key: number, mark: string, label: string | null): void {
  const entry = tabs.get(key)
  if (!entry) return
  const attr = `data-mark-${mark}`
  entry.marks.get(mark)?.remove()
  entry.marks.delete(mark)
  if (label === null) {
    entry.tab.removeAttribute(attr)
    entry.session.element.removeAttribute(attr)
    return
  }
  const badge = h('span', { class: 'tab-mark', 'data-mark': mark, text: label })
  entry.marks.set(mark, badge)
  entry.select.append(badge)
  entry.tab.setAttribute(attr, '')
  entry.session.element.setAttribute(attr, '')
}

/** The tab bound to a backend session id. */
export function tabOf(sessionId: number): TabRef {
  for (const { info } of tabs.values()) {
    if (info.id === sessionId) return { key: info.key, title: info.title }
  }
  return { key: 0, title: t('closedTab') }
}

export function sshTarget(user: string, host: string, port: number): string {
  const name = host.includes(':') ? `[${host}]` : host
  return `${user}@${name}${port === 22 ? '' : `:${port}`}`
}

/** Where a server connects to, as shown in the status bar and log. */
export function serverTarget(user: string, host: string, port: number, advanced: Advanced): string {
  if (advanced.protocol === 'ssh') return sshTarget(user, host, port)
  if (advanced.protocol === 'serial') return `${advanced.serial.port} @ ${advanced.serial.baud}`
  const name = host.includes(':') ? `[${host}]` : host
  return `telnet ${name}${port === 23 ? '' : `:${port}`}`
}

/** How a session is named in the app log. */
export function logName(info: SessionInfo): string {
  return info.target && info.target !== info.title
    ? t('logName', { title: info.title, target: ltr(info.target) })
    : info.title
}

/** Connection events go to the app log; benchmark tabs and healthy local shells stay out of it. */
function logSession(info: SessionInfo, level: LogLevel, message: string, evenLocal = false): void {
  if (info.kind === 'bench' || (info.kind === 'local' && !evenLocal)) return
  logApp(level, message)
}

function emitActive(): void {
  const info = activeSession()
  for (const listener of activeListeners) listener(info)
}

function setState(entry: Tab, state: SessionState): void {
  entry.info.state = state
  entry.tab.dataset.state = state
  if (entry.info.key === activeKey) emitActive()
}

function setTitle(entry: Tab, title: string): void {
  entry.info.title = title
  entry.label.textContent = title
  entry.select.title = entry.log ? t('loggingTitle', { title, path: ltr(entry.log.path) }) : title
  entry.close.setAttribute('aria-label', t('closeTitle', { title }))
}

function logFileName(title: string): string {
  const d = new Date()
  const two = (n: number) => String(n).padStart(2, '0')
  const stamp = `${d.getFullYear()}${two(d.getMonth() + 1)}${two(d.getDate())}_${two(d.getHours())}${two(d.getMinutes())}${two(d.getSeconds())}`
  return `${title}_${stamp}.log`
}

/** Points the backend at this tab's log file; a new file is named the first time. */
async function attachLog(entry: Tab): Promise<string> {
  const id = entry.info.id
  if (id === null) throw new Error(t('notConnected'))
  const name = entry.log?.name ?? logFileName(entry.info.title)
  const path = await invoke<string>('session_log_start', {
    id,
    name,
    plain: settings().terminal.log.plain,
  })
  entry.log = { name, path }
  entry.tab.toggleAttribute('data-logging', true)
  setTitle(entry, entry.info.title)
  return path
}

/** The log file a tab is writing to, if any. */
export function sessionLogPath(key: number): string | null {
  return tabs.get(key)?.log?.path ?? null
}

/** "Start/stop logging" for a tab's menus. */
export function logMenuItem(key: number): MenuItem {
  const entry = tabs.get(key)
  const logging = entry?.log != null
  return {
    label: logging ? t('stopLog') : t('startLog'),
    icon: 'file-text',
    disabled: !logging && entry?.info.state !== 'live',
    action: () => void toggleSessionLog(key).catch((error) => reportError(error)),
  }
}

/** Starts or stops copying a tab's output to a file. */
export async function toggleSessionLog(key: number): Promise<void> {
  const entry = tabs.get(key)
  if (!entry) return
  if (entry.log) {
    const { path } = entry.log
    entry.log = null
    entry.tab.removeAttribute('data-logging')
    setTitle(entry, entry.info.title)
    if (entry.info.id !== null) await invoke('session_log_stop', { id: entry.info.id })
    setStatus(t('logStopped', { path: ltr(path) }))
    return
  }
  if (entry.info.state !== 'live') {
    setStatus(t('logNeedsLive'), 'error')
    return
  }
  setStatus(t('logging', { path: ltr(await attachLog(entry)) }))
}

/** The tabs on screen when `key` is in front: its split group, or just itself. */
function visibleKeys(key: number | null): number[] {
  if (key === null) return []
  const group = groups.get(key)
  return group ? paneKeys(group.tree) : [key]
}

function paneHandle(
  node: Extract<PaneTree, { dir: SplitDir }>,
  split: HTMLElement,
  a: HTMLElement,
  b: HTMLElement,
): HTMLElement {
  const handle = h('div', {
    class: 'gx-splitter pane-splitter',
    role: 'separator',
    tabIndex: 0,
    'aria-orientation': node.dir === 'row' ? 'vertical' : 'horizontal',
    'aria-label': t('resizeSplit'),
    'aria-valuemin': '10',
    'aria-valuemax': '90',
    title: t('resizeHint'),
  })
  const apply = (ratio: number) => {
    node.ratio = clampRatio(ratio)
    a.style.flexGrow = String(node.ratio)
    b.style.flexGrow = String(1 - node.ratio)
    handle.setAttribute('aria-valuenow', String(Math.round(node.ratio * 100)))
  }
  apply(node.ratio)
  // A row follows the writing direction: in right-to-left text the first pane is on the right.
  const mirrored = () => node.dir === 'row' && getComputedStyle(split).direction === 'rtl'
  handle.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return
    event.preventDefault()
    handle.setPointerCapture(event.pointerId)
    handle.classList.add('dragging')
    const flip = mirrored()
    const move = (e: PointerEvent) => {
      const rect = split.getBoundingClientRect()
      apply(
        node.dir === 'row'
          ? (flip ? rect.right - e.clientX : e.clientX - rect.left) / rect.width
          : (e.clientY - rect.top) / rect.height,
      )
    }
    const end = () => {
      handle.classList.remove('dragging')
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', end)
      handle.removeEventListener('pointercancel', end)
    }
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', end)
    handle.addEventListener('pointercancel', end)
  })
  handle.addEventListener('keydown', (event) => {
    const back = node.dir === 'row' ? 'ArrowLeft' : 'ArrowUp'
    const forward = node.dir === 'row' ? 'ArrowRight' : 'ArrowDown'
    if (event.key !== back && event.key !== forward) return
    event.preventDefault()
    const step = (event.key === forward ? 0.05 : -0.05) * (mirrored() ? -1 : 1)
    apply(node.ratio + step)
  })
  handle.addEventListener('dblclick', () => apply(0.5))
  return handle
}

/** Rebuilds a group's nested splits around its terminals (also after one reconnects). */
function renderGroup(group: PaneGroup): void {
  const build = (node: PaneTree): HTMLElement => {
    if ('key' in node) {
      const entry = tabs.get(node.key)
      if (!entry) throw new Error(t('paneGone', { key: node.key }))
      return entry.session.element
    }
    const a = build(node.a)
    const b = build(node.b)
    const split = h('div', { class: 'pane-split', 'data-dir': node.dir })
    split.append(a, paneHandle(node, split, a, b), b)
    return split
  }
  group.element.replaceChildren(build(group.tree))
}

/** Puts `add` next to `at`, taking it out of any other split first. */
function joinPane(at: number, add: number, dir: SplitDir): void {
  if (at === add) return
  leavePane(add)
  let group = groups.get(at)
  if (!group) {
    group = { tree: { key: at }, element: h('div', { class: 'pane-group' }) }
    terminals.append(group.element)
    groups.set(at, group)
  }
  group.tree = splitPane(group.tree, at, add, dir)
  groups.set(add, group)
  for (const key of [at, add]) tabs.get(key)?.tab.toggleAttribute('data-split', true)
  renderGroup(group)
}

/** Back to a tab of its own, filling the terminal area. */
function standalone(key: number): void {
  groups.delete(key)
  const entry = tabs.get(key)
  if (!entry) return
  entry.tab.removeAttribute('data-split')
  const { element } = entry.session
  element.style.flexGrow = ''
  element.removeAttribute('data-pane-focus')
  terminals.append(element)
}

function leavePane(key: number): void {
  const group = groups.get(key)
  if (!group) return
  standalone(key)
  const tree = removePane(group.tree, key)
  if (tree === null || 'key' in tree) {
    if (tree) standalone(tree.key)
    group.element.remove()
    return
  }
  group.tree = tree
  renderGroup(group)
}

function activate(key: number): void {
  const changed = activeKey !== key
  activeKey = key
  const group = groups.get(key)
  const shown = new Set(visibleKeys(key))
  for (const entry of tabs.values()) {
    const own = entry.info.key
    const active = own === key
    entry.session.element.hidden = !shown.has(own)
    entry.session.element.toggleAttribute('data-pane-focus', active && group !== undefined)
    entry.select.setAttribute('aria-selected', String(active))
    entry.select.tabIndex = active ? 0 : -1
    entry.tab.classList.toggle('active', active)
    entry.tab.classList.toggle('in-view', !active && shown.has(own))
  }
  for (const other of new Set(groups.values())) other.element.hidden = other !== group
  for (const own of shown) if (own !== key) tabs.get(own)?.session.refit()
  const entry = tabs.get(key)
  entry?.session.refit()
  entry?.session.focus()
  if (changed) {
    emitActive()
    emitTabs()
  }
}

function ended(entry: Tab): void {
  if (entry.info.id === null) return
  for (const listener of endedListeners) listener(entry.info)
}

function closeTab(key: number): void {
  const entry = tabs.get(key)
  if (!entry) return
  stopRetry(entry)
  const { state } = entry.info
  if (state === 'live' || state === 'connecting') {
    ended(entry)
    const name = logName(entry.info)
    logSession(
      entry.info,
      'info',
      t(state === 'live' ? 'closedLive' : 'closedConnecting', { name }),
    )
  }
  const mates = visibleKeys(key)
  const at = mates.indexOf(key)
  // The front moves to a pane that stays on screen, if the tab was split.
  const mate = mates[at - 1] ?? mates[at + 1]
  leavePane(key)
  entry.session.dispose()
  entry.tab.remove()
  tabs.delete(key)
  closeTabRecords(key)
  if (activeKey === key) {
    activeKey = null
    const next = mate ?? [...tabs.keys()].at(-1)
    if (next !== undefined) activate(next)
    else emitActive()
  }
  empty.hidden = tabs.size > 0
  emitTabs()
}

function newTerminal(entry: Pick<Tab, 'info'>): TerminalSession {
  const session = new TerminalSession(terminals, entry.info.kind, entry.info.fontSize)
  session.element.id = `terminal-${entry.info.key}`
  session.element.setAttribute('role', 'tabpanel')
  session.element.setAttribute('aria-labelledby', `tab-${entry.info.key}`)
  session.onError = (error) => reportError(error)
  // Clicking or tabbing into a split pane brings its tab to the front.
  const follow = () => {
    const { key } = entry.info
    if (activeKey !== key && tabs.get(key)?.session === session) activate(key)
  }
  session.element.addEventListener('pointerdown', follow, true)
  session.element.addEventListener('focusin', follow)
  session.onCwd = (path) => {
    if (tabs.get(entry.info.key)?.session !== session) return
    entry.info.cwd = path
    for (const listener of cwdListeners) listener(entry.info)
  }
  return session
}

function showEndBanner(entry: Tab, tone: 'error' | 'info', title: string, detail: string): void {
  const { key, kind } = entry.info
  entry.session.showBanner({
    tone,
    title,
    detail,
    actions: [
      {
        label: kind === 'local' ? t('reopen') : common('reconnect'),
        icon: 'arrow-clockwise',
        run: () => void reconnect(key),
      },
      { label: t('closeTab'), icon: 'x', run: () => closeTab(key) },
    ],
  })
}

function stopRetry(entry: Tab): void {
  if (entry.retry?.timer) clearTimeout(entry.retry.timer)
  entry.retry = null
}

/** Waits a growing delay, then reconnects in the same terminal so the scrollback stays. */
function scheduleRetry(entry: Tab, reason: string): void {
  const retry = entry.retry ?? { attempt: 0, timer: null }
  entry.retry = retry
  const { info } = entry
  if (retry.attempt >= MAX_RETRIES) {
    stopRetry(entry)
    logSession(info, 'warn', t('retryGaveUpLog', { name: logName(info), n: MAX_RETRIES }), true)
    showEndBanner(entry, 'error', t('retryStopped'), t('retryGaveUp', { reason, n: MAX_RETRIES }))
    return
  }
  const delay = RETRY_DELAYS_SECS[Math.min(retry.attempt, RETRY_DELAYS_SECS.length - 1)]
  retry.attempt += 1
  const when = { delay, n: retry.attempt }
  setStatus(t('retryStatus', { title: info.title, ...when }), 'error')
  entry.session.showBanner({
    tone: 'error',
    title: t('retryTitle'),
    detail: t('retryDetail', { reason, ...when }),
    actions: [
      { label: t('retryNow'), icon: 'arrow-clockwise', run: () => retryNow(entry) },
      {
        label: t('stopRetry'),
        icon: 'x',
        run: () => {
          stopRetry(entry)
          logSession(info, 'info', t('retryStoppedLog', { name: logName(info) }))
          showEndBanner(entry, 'error', t('disconnected'), reason)
        },
      },
    ],
  })
  retry.timer = window.setTimeout(() => retryNow(entry), delay * 1000)
}

function retryNow(entry: Tab): void {
  if (!entry.retry || tabs.get(entry.info.key) !== entry) return
  if (entry.retry.timer) clearTimeout(entry.retry.timer)
  entry.retry.timer = null
  entry.session.reset()
  // connect() shows the outcome and schedules the next try.
  connect(entry, true).catch(() => {})
}

async function connect(entry: Tab, retry = false): Promise<void> {
  const { info, spec, session } = entry
  info.id = null
  info.ssh = null
  info.cwd = null
  info.lost = false
  entry.tab.removeAttribute('data-lost')
  setState(entry, 'connecting')
  const started = performance.now()
  const stale = () => entry.session !== session || tabs.get(info.key) !== entry
  logSession(info, 'info', t(retry ? 'reconnectingLog' : 'connectingLog', { name: logName(info) }))
  if (info.kind !== 'local' && info.kind !== 'bench') {
    setStatus(t(retry ? 'reconnecting' : 'connecting', { title: info.title }))
  }
  session.onExit = (exit) => {
    if (stale()) return
    const lost = exitIsAbnormal(exit)
    info.lost = lost
    entry.tab.toggleAttribute('data-lost', lost)
    setState(entry, 'ended')
    ended(entry)
    const text = describeExit(exit)
    if (lost) logSession(info, 'warn', t('lostLog', { name: logName(info), text }), true)
    else logSession(info, 'info', t('titled', { name: logName(info), text }))
    if (spec.onExit) spec.onExit(exit, session)
    else if (lost && info.ssh?.autoReconnect) {
      session.notice(text, 'error')
      scheduleRetry(entry, text)
    } else {
      session.notice(text, lost ? 'error' : 'info')
      setStatus(t('titled', { name: info.title, text }), lost ? 'error' : 'info')
      if (lost) showEndBanner(entry, 'error', t('disconnected'), text)
      else showEndBanner(entry, 'info', t('sessionEnded'), text)
    }
  }
  try {
    await session.open(async (onEvent, size) => {
      const result = await spec.open(onEvent, size)
      if (typeof result === 'number') return result
      info.ssh = result
      return result.id
    })
    if (stale()) return
    info.id = session.sessionId
    // Set inside the open callback, which control-flow narrowing can't see.
    const ssh = info.ssh as SshOpened | null
    if (ssh) setTitle(entry, ssh.title)
    if (!session.ended) setState(entry, 'live')
    const secs = ((performance.now() - started) / 1000).toFixed(1)
    logSession(info, 'info', t('connectedLog', { name: logName(info), secs }))
    stopRetry(entry)
    if (entry.log || (settings().terminal.log.auto && info.kind !== 'bench')) {
      attachLog(entry).catch((error) => {
        entry.log = null
        entry.tab.removeAttribute('data-logging')
        reportError(error)
      })
    }
    if (ssh) {
      setStatus(t('connected', { title: info.title }))
      for (const problem of ssh.forwardErrors) {
        logSession(info, 'warn', t('forwardFailedLog', { name: logName(info), problem }), true)
        session.notice(t('forwardFailed', { problem }), 'error')
      }
      if (ssh.forwardErrors.length > 0) {
        const n = ssh.forwardErrors.length
        setStatus(t('connectedForwardsFailed', { title: info.title, n }), 'error')
      }
      for (const listener of connectedListeners) listener(info)
    }
  } catch (error) {
    if (stale()) return
    const message = describeError(error)
    logSession(info, 'error', t('connectFailedLog', { name: logName(info), message }), true)
    session.fail(message)
    setState(entry, 'failed')
    if (entry.retry && RETRIABLE.has(errorKind(error) ?? '')) scheduleRetry(entry, message)
    else if (info.kind !== 'bench') {
      stopRetry(entry)
      setStatus(t('titled', { name: info.title, text: message }), 'error')
      showEndBanner(entry, 'error', t('connectFailed'), message)
    }
    throw error
  }
}

async function reconnect(key: number): Promise<void> {
  const entry = tabs.get(key)
  if (!entry) return
  stopRetry(entry)
  if (entry.info.state === 'live') ended(entry)
  entry.session.dispose()
  entry.session = newTerminal(entry)
  for (const mark of entry.marks.keys()) entry.session.element.setAttribute(`data-mark-${mark}`, '')
  const group = groups.get(key)
  if (group) renderGroup(group)
  activate(key)
  // connect() already shows and logs the failure.
  await connect(entry, true).catch(() => {})
}

/**
 * Opens a new tab and connects it, optionally split next to tab `split.at`. Rejects on failure;
 * the tab stays with the reason shown.
 */
export function openSession(
  spec: SessionSpec,
  split?: { at: number; dir: SplitDir },
): Promise<void> {
  const key = nextKey++
  const info: SessionInfo = {
    key,
    kind: spec.kind,
    title: spec.title,
    id: null,
    ssh: null,
    target: spec.target ?? null,
    state: 'connecting',
    lost: false,
    fontSize: spec.fontSize ?? null,
    cwd: null,
  }
  const label = h('span', { class: 'tab-label' })
  const select = h(
    'button',
    {
      type: 'button',
      class: 'tab-select',
      id: `tab-${key}`,
      role: 'tab',
      'aria-controls': `terminal-${key}`,
      onclick: () => activate(key),
    },
    h('span', { class: 'tab-dot', 'aria-hidden': 'true' }),
    label,
    h('span', { class: 'tab-log', 'aria-hidden': 'true', text: t('logBadge') }),
  )
  const close = h(
    'button',
    {
      type: 'button',
      class: 'tab-close',
      onclick: () => closeTab(key),
    },
    icon('x'),
  )
  const tab = h('div', { class: 'tab', 'data-kind': spec.kind }, select, close)
  tab.addEventListener('auxclick', (event) => {
    if (event.button === 1) closeTab(key)
  })
  tab.addEventListener('contextmenu', (event) => {
    event.preventDefault()
    event.stopPropagation()
    const keys = [...tabs.keys()]
    const right = keys.slice(keys.indexOf(key) + 1)
    const front = activeKey
    showMenu(event.clientX, event.clientY, [
      ...splitItems(key),
      ...(front !== null && !visibleKeys(front).includes(key)
        ? [{ label: t('sideBySide'), icon: 'squares-four', action: () => joinTab(key, front) }]
        : []),
      'separator',
      {
        label: common('reconnect'),
        icon: 'arrows-clockwise',
        action: () => void reconnect(key),
        disabled: info.kind === 'bench',
      },
      {
        label: t('tabDownloads'),
        icon: 'download-simple',
        action: () => openDownloads({ type: 'tab', key }, info.title),
        disabled: info.kind !== 'ssh',
      },
      logMenuItem(key),
      'separator',
      {
        label: t('fontBigger'),
        icon: 'plus',
        action: () => {
          const current = info.fontSize ?? 16
          const next = Math.min(current + 2, 40)
          info.fontSize = next
          entry.session.setFontSize(next)
          emitTabs()
        },
      },
      {
        label: t('fontSmaller'),
        icon: 'minus',
        action: () => {
          const current = info.fontSize ?? 16
          const next = Math.max(current - 2, 8)
          info.fontSize = next
          entry.session.setFontSize(next)
          emitTabs()
        },
      },
      {
        label: t('fontReset'),
        action: () => {
          info.fontSize = null
          entry.session.setFontSize(null)
          emitTabs()
        },
        disabled: info.fontSize === null,
      },
      'separator',
      { label: common('close'), icon: 'x', action: () => closeTab(key) },
      {
        label: t('closeOthers'),
        action: () => {
          for (const other of keys) if (other !== key) closeTab(other)
        },
        disabled: keys.length < 2,
      },
      {
        label: t('closeRight'),
        action: () => {
          for (const other of right) closeTab(other)
        },
        disabled: right.length === 0,
      },
      ...menuItems('tab/context', {
        sessionId: entry.session.live ? entry.session.sessionId : null,
        kind: info.kind,
        title: info.title,
      }),
    ])
  })
  tabList.append(tab)
  const entry: Tab = {
    info,
    spec,
    session: newTerminal({ info }),
    tab,
    select,
    label,
    close,
    retry: null,
    log: null,
    marks: new Map(),
  }
  setTitle(entry, spec.title)
  tabs.set(key, entry)
  empty.hidden = true
  if (split && tabs.has(split.at)) joinPane(split.at, key, split.dir)
  activate(key)
  emitTabs()
  return connect(entry)
}

/** `shellId` is from `local_shells`; empty opens the system default, omitted uses the setting. */
export function openLocal(
  shellId = settings().terminal.defaultShell,
  fontSize: number | null = null,
): Promise<void> {
  const shell = shellId ? localShells().find((s) => s.id === shellId) : undefined
  return openSession({
    kind: 'local',
    title: shell?.name ?? t('localTerminal'),
    saved: { kind: 'local', shell: shellId },
    fontSize,
    open: (onEvent, { cols, rows }) =>
      invoke<number>('pty_open', { cols, rows, shell: shellId || null, onEvent }),
  })
}

export function openProfile(
  server: ServerView,
  title: string,
  fontSize: number | null = null,
): Promise<void> {
  return openSession({
    kind: server.advanced.protocol,
    title,
    saved: { kind: 'profile', profileId: server.id },
    fontSize,
    target: serverTarget(server.auth.user, server.host, server.port, server.advanced),
    open: (onEvent, { cols, rows }) =>
      withUnlock(() =>
        invoke<SshOpened>('ssh_open_profile', {
          profileId: server.id,
          cols,
          rows,
          onEvent,
          onHostKey: hostKeyChannel(),
          onPrompt: inputPromptChannel(),
        }),
      ),
  })
}

export interface AdhocTarget {
  name: string
  host: string
  port: number
  auth: { method: AuthMethod; user: string; keyPath: string; secret: string | null }
  advanced: Advanced
  proxyPassword: string | null
}

export function openAdhoc(
  target: AdhocTarget,
  title: string,
  fontSize: number | null = null,
): Promise<void> {
  return openSession({
    kind: target.advanced.protocol,
    title,
    saved: {
      kind: 'adhoc',
      title,
      name: target.name,
      host: target.host,
      port: target.port,
      method: target.auth.method,
      user: target.auth.user,
      keyPath: target.auth.keyPath,
      advanced: target.advanced,
    },
    fontSize,
    target: serverTarget(target.auth.user, target.host, target.port, target.advanced),
    open: (onEvent, size) =>
      invoke<SshOpened>('ssh_open', {
        args: { ...target, ...size },
        onEvent,
        onHostKey: hostKeyChannel(),
        onPrompt: inputPromptChannel(),
      }),
  })
}

export function initSessions(list: HTMLElement, host: HTMLElement, placeholder: HTMLElement): void {
  tabList = list
  terminals = host
  empty = placeholder
  tabList.addEventListener('contextmenu', (event) => {
    event.preventDefault()
    showMenu(event.clientX, event.clientY, tabBarItems())
  })
  tabList.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    const keys = [...tabs.keys()]
    if (keys.length === 0) return
    const index = activeKey === null ? 0 : keys.indexOf(activeKey)
    // Tabs run right to left in right-to-left text.
    const rtl = getComputedStyle(tabList).direction === 'rtl'
    const step = (event.key === 'ArrowRight') !== rtl ? 1 : -1
    const next = keys[(index + step + keys.length) % keys.length]
    activate(next)
    tabs.get(next)?.select.focus()
  })
}

function commandItem(label: string, icon: string, id: string): MenuItem {
  return {
    label,
    icon,
    disabled: command(id) === undefined,
    action: () => void runCommand(id).catch((error) => reportError(error)),
  }
}

/** The empty part of the tab bar. */
function tabBarItems(): MenuItem[] {
  const active = activeKey === null ? undefined : tabs.get(activeKey)
  const preferred = settings().terminal.defaultShell
  const preferredName = localShells().find((s) => s.id === preferred)?.name
  void loadShells()
  return [
    {
      label: preferredName ? t('newLocalShell', { name: preferredName }) : t('newLocal'),
      icon: 'terminal',
      action: () => void openLocal(),
    },
    ...localShells()
      .filter((shell) => shell.id !== preferred)
      .map((shell) => ({
        label: t('newShell', { name: shell.name }),
        icon: 'terminal',
        action: () => void openLocal(shell.id),
      })),
    commandItem(t('newConnection'), 'plus', 'session.newServer'),
    commandItem(t('manager'), 'hard-drives', 'connections.manager'),
    'separator',
    {
      label: t('closeAll'),
      icon: 'x',
      danger: true,
      disabled: tabs.size === 0,
      action: () => {
        for (const key of [...tabs.keys()]) closeTab(key)
      },
    },
    ...menuItems('tabs/background', {
      sessionId: active?.session.live ? active.session.sessionId : null,
    }),
  ]
}

/** Re-fits the visible terminal (after panels resize around it). */
export function refitActive(): void {
  for (const key of visibleKeys(activeKey)) tabs.get(key)?.session.refit()
}

/** Benchmark tabs can't be copied, so they can't be split either. */
export function canSplit(key: number | null): boolean {
  const entry = key === null ? undefined : tabs.get(key)
  return entry !== undefined && entry.info.kind !== 'bench'
}

/** Opens another connection like tab `key`'s, next to it. Ad-hoc tabs reuse the typed password. */
export function splitTab(key: number, dir: SplitDir): Promise<void> {
  const entry = tabs.get(key)
  if (!entry || !canSplit(key)) return Promise.resolve()
  return openSession({ ...entry.spec, fontSize: entry.info.fontSize }, { at: key, dir })
}

/** Shows tab `key` beside `into` (and whatever `into` is already split with). */
export function joinTab(key: number, into: number, dir: SplitDir = 'row'): void {
  if (key === into || !tabs.has(key) || !tabs.has(into)) return
  joinPane(into, key, dir)
  activate(key)
}

export function isSplit(key: number | null): boolean {
  return key !== null && groups.has(key)
}

/** Gives the tab back its own full-size view. */
export function unsplitTab(key: number): void {
  if (!groups.has(key)) return
  leavePane(key)
  activate(key)
}

/** Moves focus to the neighbouring pane; false when there is none that way. */
export function focusPane(direction: PaneDirection): boolean {
  if (activeKey === null || !groups.has(activeKey)) return false
  const rects = visibleKeys(activeKey).flatMap((key) => {
    const element = tabs.get(key)?.session.element
    if (!element) return []
    const { left, top, right, bottom } = element.getBoundingClientRect()
    return [{ key, left, top, right, bottom }]
  })
  const next = paneToward(rects, activeKey, direction)
  if (next === null) return false
  activate(next)
  return true
}

/** Split entries for a tab's menus. */
export function splitItems(key: number): MenuItem[] {
  // A failed connection stays visible in its pane.
  const quiet = () => {}
  return [
    {
      label: t('splitRight'),
      icon: 'columns',
      disabled: !canSplit(key),
      action: () => void splitTab(key, 'row').catch(quiet),
    },
    {
      label: t('splitDown'),
      icon: 'rows',
      disabled: !canSplit(key),
      action: () => void splitTab(key, 'column').catch(quiet),
    },
    ...(groups.has(key)
      ? [{ label: t('unsplit'), icon: 'corners-out', action: () => unsplitTab(key) }]
      : []),
  ]
}
