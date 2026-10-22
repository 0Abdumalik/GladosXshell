import { invoke } from '@tauri-apps/api/core'
import { confirmDialog, promptDialog } from '../dialogs'
import { copyText, h, setStatus } from '../dom'
import { formatBytes, formatPercent, formatTime, formatUptime } from '../format'
import { ltr, messages, pl } from '../i18n'
import { common } from '../i18n-common'
import { type IconName, icon } from '../icons'
import { type MenuItem, showMenu } from '../menu'
import type { ProcessInfo, StatusSnapshot } from '../protocol'
import { processStart } from './model'
import {
  defaultDirection,
  filterProcesses,
  type ProcessKey,
  processTree,
  type SortDirection,
  type StateFilter,
  shortTime,
  sortProcesses,
  stateGroup,
  stateName,
  type TreeRow,
  validNice,
} from './processes'
import { fact, type Report, setFact } from './widgets'

const t = messages({
  end: { zh: '结束', en: 'End', ug: 'ئاخىرلاشتۇر' },
  forceKill: { zh: '强制结束', en: 'Force kill', ug: 'مەجبۇرىي ئاخىرلاشتۇر' },
  endTitle: { zh: '结束进程', en: 'End process', ug: 'جەرياننى ئاخىرلاشتۇر' },
  reloadTitle: { zh: '重新加载进程', en: 'Reload process', ug: 'جەرياننى قايتا يۈكلە' },
  forceKillTitle: {
    zh: '强制结束进程',
    en: 'Force kill process',
    ug: 'جەرياننى مەجبۇرىي ئاخىرلاشتۇر',
  },
  sendSignal: {
    zh: '向 {name}（PID {pid}）发送 {signal}？',
    en: 'Send {signal} to {name} (PID {pid})?',
    ug: '{signal} سىگنالىنى {name} جەريانىغا (PID {pid}) ئەۋەتەمسىز؟',
  },
  signalSent: {
    zh: '已向 {name}（PID {pid}）发送 {signal}',
    en: 'Sent {signal} to {name} (PID {pid})',
    ug: '{signal} سىگنالى {name} جەريانىغا (PID {pid}) ئەۋەتىلدى',
  },
  reniceTitle: { zh: '调整优先级', en: 'Change priority', ug: 'ئالدىنلىقنى تەڭشەش' },
  reniceLabel: {
    zh: '{name}（PID {pid}）的 nice 值，{min} 到 19，越小越优先',
    en: 'Nice value for {name} (PID {pid}), {min} to 19. Lower values run first.',
    ug: '{name} جەريانى (PID {pid}) نىڭ nice قىممىتى، {min} دىن 19 غىچە، قانچە كىچىك بولسا شۇنچە ئالدىن ئورۇنلىنىدۇ',
  },
  apply: { zh: '应用', en: 'Apply', ug: 'قوللان' },
  reniced: {
    zh: '已把 {name}（PID {pid}）的 nice 值改为 {value}',
    en: 'Changed the nice value of {name} (PID {pid}) to {value}',
    ug: '{name} جەريانى (PID {pid}) نىڭ nice قىممىتى {value} قىلىپ ئۆزگەرتىلدى',
  },
  menuTerm: { zh: '结束（SIGTERM）', en: 'End (SIGTERM)', ug: 'ئاخىرلاشتۇر (SIGTERM)' },
  menuHup: { zh: '重新加载（SIGHUP）', en: 'Reload (SIGHUP)', ug: 'قايتا يۈكلە (SIGHUP)' },
  menuKill: {
    zh: '强制结束（SIGKILL）',
    en: 'Force kill (SIGKILL)',
    ug: 'مەجبۇرىي ئاخىرلاشتۇر (SIGKILL)',
  },
  menuRenice: { zh: '调整优先级…', en: 'Change priority…', ug: 'ئالدىنلىقنى تەڭشە…' },
  copyPid: { zh: '复制 PID', en: 'Copy PID', ug: 'PID نى كۆچۈر' },
  copyCommandLine: { zh: '复制命令行', en: 'Copy command line', ug: 'بۇيرۇق قۇرىنى كۆچۈر' },
  user: { zh: '用户', en: 'User', ug: 'ئىشلەتكۈچى' },
  memory: { zh: '内存', en: 'Memory', ug: 'ئىچكى ساقلىغۇچ' },
  threads: { zh: '线程', en: 'Threads', ug: 'يىپ' },
  status: { zh: '状态', en: 'Status', ug: 'ھالەت' },
  started: { zh: '启动', en: 'Started', ug: 'قوزغالغان' },
  allStates: { zh: '全部状态', en: 'All statuses', ug: 'بارلىق ھالەت' },
  running: { zh: '运行', en: 'Running', ug: 'ئىجرا' },
  sleeping: { zh: '睡眠', en: 'Sleeping', ug: 'ئۇيقۇ' },
  zombie: { zh: '僵尸', en: 'Zombie', ug: 'ئۆلۈك' },
  stopped: { zh: '停止', en: 'Stopped', ug: 'توختىغان' },
  searchPlaceholder: {
    zh: '搜索名称、PID、用户或命令行',
    en: 'Search name, PID, user or command line',
    ug: 'نام، PID، ئىشلەتكۈچى ياكى بۇيرۇق قۇرىنى ئىزدە',
  },
  search: { zh: '搜索进程', en: 'Search processes', ug: 'جەريان ئىزدە' },
  filterState: { zh: '按状态筛选', en: 'Filter by status', ug: 'ھالەت بويىچە سۈز' },
  list: { zh: '列表', en: 'List', ug: 'تىزىملىك' },
  tree: { zh: '树', en: 'Tree', ug: 'دەرەخ' },
  freezeTitle: {
    zh: '暂停表格刷新，方便查看和操作',
    en: 'Pause table updates so rows stay still while you work with them',
    ug: 'جەدۋەلنىڭ يېڭىلىنىشىنى ۋاقىتلىق توختىتىپ، كۆرۈش ۋە مەشغۇلات قىلىشنى قۇلايلاشتۇرىدۇ',
  },
  freeze: { zh: '冻结', en: 'Freeze', ug: 'توڭلات' },
  view: { zh: '视图', en: 'View', ug: 'كۆرۈنۈش' },
  listLabel: {
    zh: '进程列表。方向键选择，Enter 查看详情，Delete 结束进程',
    en: 'Process list. Arrow keys select, Enter shows details, Delete ends the process',
    ug: 'جەريان تىزىملىكى. يۆنىلىش كۇنۇپكىلىرى بىلەن تاللاڭ، Enter بىلەن تەپسىلاتىنى كۆرۈڭ، Delete بىلەن جەرياننى ئاخىرلاشتۇرۇڭ',
  },
  parent: { zh: '父进程', en: 'Parent', ug: 'ئاتا جەريان' },
  priority: { zh: '优先级', en: 'Priority', ug: 'ئالدىنلىق' },
  commandLine: { zh: '命令行', en: 'Command line', ug: 'بۇيرۇق قۇرى' },
  pickProcess: {
    zh: '选择一个进程查看详情。',
    en: 'Select a process to see its details.',
    ug: 'تەپسىلاتىنى كۆرۈش ئۈچۈن بىر جەرياننى تاللاڭ.',
  },
  details: { zh: '进程详情', en: 'Process details', ug: 'جەريان تەپسىلاتى' },
  reading: { zh: '正在读取进程…', en: 'Reading processes…', ug: 'جەريانلار ئوقۇلۇۋاتىدۇ…' },
  noMatch: { zh: '没有符合条件的进程。', en: 'No processes match.', ug: 'شەرتكە ماس جەريان يوق.' },
  totals: {
    zh: '{processes} 个进程 · {threads} 个线程',
    en: (p) =>
      `${pl('process', 'processes')({ n: p.processes })} · ${pl('thread')({ n: p.threads })}`,
    ug: '{processes} جەريان · {threads} يىپ',
  },
  filteredTotals: {
    zh: '{shown} / {processes} 个进程 · {threads} 个线程',
    en: (p) =>
      `${p.shown} / ${pl('process', 'processes')({ n: p.processes })} · ${pl('thread')({ n: p.threads })}`,
    ug: '{shown} / {processes} جەريان · {threads} يىپ',
  },
  frozen: { zh: '已冻结', en: 'Frozen', ug: 'توڭلىتىلدى' },
  parentName: { zh: '{name}（{pid}）', en: '{name} ({pid})', ug: '{name} ({pid})' },
  goToParent: { zh: '跳到父进程', en: 'Go to the parent process', ug: 'ئاتا جەريانغا ئۆت' },
  userUid: { zh: '{user}（uid {uid}）', en: '{user} (uid {uid})', ug: '{user} (uid {uid})' },
  startedAgo: {
    zh: '{time}（已运行 {duration}）',
    en: '{time} (running for {duration})',
    ug: '{time} ({duration} ئىجرا بولدى)',
  },
  noCommandLine: {
    zh: '没有命令行（内核线程，或需要更高权限才能读取）',
    en: 'No command line (a kernel thread, or reading it needs more privileges)',
    ug: 'بۇيرۇق قۇرى يوق (يادرو يىپى، ياكى ئوقۇش ئۈچۈن تېخىمۇ يۇقىرى ھوقۇق كېرەك)',
  },
})

interface Signal {
  signal: number
  name: string
  /** The confirm button and the detail pane's button. */
  label: string
  /** The confirm dialog's title. */
  title: string
  danger?: boolean
}

const TERM: Signal = { signal: 15, name: 'SIGTERM', label: t('end'), title: t('endTitle') }
const HUP: Signal = { signal: 1, name: 'SIGHUP', label: common('reload'), title: t('reloadTitle') }
const KILL: Signal = {
  signal: 9,
  name: 'SIGKILL',
  label: t('forceKill'),
  title: t('forceKillTitle'),
  danger: true,
}

const COLUMNS: { key: ProcessKey; label: string; cls: string }[] = [
  { key: 'pid', label: 'PID', cls: 'num col-pid' },
  { key: 'name', label: common('name'), cls: 'col-name' },
  { key: 'user', label: t('user'), cls: 'col-user' },
  { key: 'cpu', label: 'CPU', cls: 'num col-cpu' },
  { key: 'mem', label: t('memory'), cls: 'num col-mem' },
  { key: 'threads', label: t('threads'), cls: 'num col-threads' },
  { key: 'nice', label: 'Nice', cls: 'num col-nice' },
  { key: 'state', label: t('status'), cls: 'col-state' },
  { key: 'start', label: t('started'), cls: 'num col-start' },
]

const STATE_FILTERS: [StateFilter, string][] = [
  ['all', t('allStates')],
  ['running', t('running')],
  ['sleeping', t('sleeping')],
  ['zombie', t('zombie')],
  ['stopped', t('stopped')],
]

const PAGE = 10

export interface ProcessManager {
  element: HTMLElement
  /** Takes a new poll; ignored (but kept) while the table is frozen. */
  update(snap: StatusSnapshot, now: number): void
  /** Turns the actions off once the session is gone. */
  setEnded(ended: boolean): void
}

export function processManager(sessionId: number, report: Report): ProcessManager {
  let all: ProcessInfo[] = []
  let uptime = 0
  let takenAt = 0
  let threadTotal = 0
  let frozen = false
  let pending: { snap: StatusSnapshot; now: number } | null = null
  let query = ''
  let state: StateFilter = 'all'
  let tree = false
  let key: ProcessKey = 'cpu'
  let direction: SortDirection = defaultDirection(key)
  let selected: number | null = null
  let shown: ProcessInfo[] = []
  let ended = false
  const rowsByPid = new Map<number, HTMLTableRowElement>()

  const find = (pid: number | null) => (pid === null ? undefined : all.find((p) => p.pid === pid))
  const startOf = (p: ProcessInfo) => processStart(p.startSecs, uptime, takenAt)

  const send = async (p: ProcessInfo, sig: Signal) => {
    const ok = await confirmDialog(
      sig.title,
      t('sendSignal', { name: p.name, pid: p.pid, signal: sig.name }),
      sig.label,
      sig.danger ?? sig.signal === 15,
    )
    if (!ok) return
    await invoke('process_kill', { sessionId, pid: p.pid, signal: sig.signal })
    setStatus(t('signalSent', { name: p.name, pid: p.pid, signal: sig.name }))
  }
  const renice = async (p: ProcessInfo) => {
    const value = await promptDialog(
      t('reniceTitle'),
      t('reniceLabel', { name: p.name, pid: p.pid, min: ltr('-20') }),
      String(p.nice),
      t('apply'),
      validNice,
    )
    if (value === null) return
    const priority = Number(value.trim())
    await invoke('process_renice', { sessionId, pid: p.pid, priority })
    setStatus(t('reniced', { name: p.name, pid: p.pid, value: ltr(String(priority)) }))
  }
  const menuFor = (p: ProcessInfo): MenuItem[] => [
    { label: t('menuTerm'), disabled: ended, action: () => send(p, TERM).catch(report) },
    { label: t('menuHup'), disabled: ended, action: () => send(p, HUP).catch(report) },
    {
      label: t('menuKill'),
      danger: true,
      disabled: ended,
      action: () => send(p, KILL).catch(report),
    },
    'separator',
    { label: t('menuRenice'), disabled: ended, action: () => renice(p).catch(report) },
    { label: t('copyPid'), action: () => copyText(String(p.pid)).catch(report) },
    {
      label: t('copyCommandLine'),
      disabled: !p.cmdline,
      action: () => copyText(p.cmdline ?? '').catch(report),
    },
  ]

  // Toolbar
  const search = h('input', {
    type: 'search',
    class: 'proc-search',
    placeholder: t('searchPlaceholder'),
    'aria-label': t('search'),
    spellcheck: 'false',
    autocomplete: 'off',
  })
  let searchTimer = 0
  search.addEventListener('input', () => {
    clearTimeout(searchTimer)
    searchTimer = window.setTimeout(() => {
      query = search.value
      render()
    }, 200)
  })
  search.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowDown') return
    event.preventDefault()
    wrap.focus()
    if (selected === null && shown.length > 0) select(shown[0].pid)
  })
  const stateSelect = h(
    'select',
    { 'aria-label': t('filterState') },
    STATE_FILTERS.map(([value, label]) => h('option', { value, text: label })),
  )
  stateSelect.addEventListener('change', () => {
    state = stateSelect.value as StateFilter
    render()
  })
  const viewButton = (isTree: boolean, iconName: IconName, label: string) =>
    h(
      'button',
      {
        type: 'button',
        class: 'segment',
        'aria-pressed': String(tree === isTree),
        onclick: () => {
          if (tree === isTree) return
          tree = isTree
          listButton.setAttribute('aria-pressed', String(!tree))
          treeButton.setAttribute('aria-pressed', String(tree))
          render()
        },
      },
      icon(iconName),
      h('span', { text: label }),
    )
  const listButton = viewButton(false, 'list', t('list'))
  const treeButton = viewButton(true, 'tree-structure', t('tree'))
  const freezeButton = h(
    'button',
    {
      type: 'button',
      class: 'button small quiet',
      'aria-pressed': 'false',
      title: t('freezeTitle'),
      onclick: () => {
        frozen = !frozen
        freezeButton.setAttribute('aria-pressed', String(frozen))
        if (!frozen && pending) {
          take(pending.snap, pending.now)
          pending = null
        }
        render()
      },
    },
    icon('snowflake'),
    h('span', { text: t('freeze') }),
  )
  const count = h('span', { class: 'proc-count num', 'aria-live': 'polite' })
  const toolbar = h(
    'div',
    { class: 'proc-toolbar' },
    h('label', { class: 'proc-search-wrap' }, icon('magnifying-glass'), search),
    stateSelect,
    h(
      'div',
      { class: 'segmented', role: 'group', 'aria-label': t('view') },
      listButton,
      treeButton,
    ),
    freezeButton,
    count,
  )

  // Table
  const ths = COLUMNS.map((column) =>
    h(
      'th',
      { scope: 'col', class: column.cls },
      h('button', {
        type: 'button',
        class: 'sort-button',
        text: column.label,
        onclick: () => {
          if (key === column.key) direction = direction === 'ascending' ? 'descending' : 'ascending'
          else {
            key = column.key
            direction = defaultDirection(key)
          }
          render()
        },
      }),
    ),
  )
  const tbody = h('tbody')
  const empty = h('p', { class: 'panel-empty', hidden: true })
  const wrap = h(
    'div',
    {
      class: 'table-wrap proc-wrap',
      tabindex: 0,
      'aria-label': t('listLabel'),
    },
    h('table', { class: 'data-table proc-table' }, h('thead', {}, h('tr', {}, ths)), tbody),
    empty,
  )

  // Detail
  const detailName = h('h3', { class: 'proc-detail-name cell-text' })
  const detailState = h('span', { class: 'proc-state' })
  const pid = fact('PID', h('dd', { class: 'num' }))
  const parentButton = h('button', { type: 'button', class: 'link-button mono' })
  const parent = fact(t('parent'), h('dd', {}, parentButton))
  const user = fact(t('user'))
  const cpu = fact('CPU', h('dd', { class: 'num' }))
  const mem = fact(t('memory'), h('dd', { class: 'num' }))
  const threads = fact(t('threads'), h('dd', { class: 'num' }))
  const nice = fact('Nice', h('dd', { class: 'num' }))
  const started = fact(t('started'), h('dd', { class: 'num' }))
  const facts = [pid, parent, user, cpu, mem, threads, nice, started]
  const cmdline = h('pre', { class: 'proc-cmd mono' })
  const copyCmd = h(
    'button',
    {
      type: 'button',
      class: 'icon-button',
      title: t('copyCommandLine'),
      'aria-label': t('copyCommandLine'),
      onclick: () => {
        const p = find(selected)
        if (p?.cmdline) copyText(p.cmdline).catch(report)
      },
    },
    icon('copy'),
  )
  const action = (sig: Signal | 'renice', iconName: IconName, label: string, cls = '') =>
    h(
      'button',
      {
        type: 'button',
        class: `button small ${cls}`.trim(),
        onclick: () => {
          const p = find(selected)
          if (!p) return
          ;(sig === 'renice' ? renice(p) : send(p, sig)).catch(report)
        },
      },
      icon(iconName),
      h('span', { text: label }),
    )
  const actions = [
    action(TERM, 'stop', TERM.label),
    action(HUP, 'arrows-clockwise', HUP.label),
    action('renice', 'gauge', t('priority')),
    action(KILL, 'skull', KILL.label, 'danger'),
  ]
  const detailBody = h(
    'div',
    { class: 'proc-detail-body' },
    h('header', { class: 'proc-detail-head' }, detailName, detailState),
    h(
      'dl',
      { class: 'status-facts proc-facts' },
      facts.flatMap((row) => [row.dt, row.dd]),
    ),
    h(
      'div',
      { class: 'proc-cmd-head' },
      h('h4', { class: 'adv-label', text: t('commandLine') }),
      copyCmd,
    ),
    cmdline,
    h('div', { class: 'proc-actions' }, actions),
  )
  const detailEmpty = h('p', { class: 'panel-empty', text: t('pickProcess') })
  const detail = h(
    'aside',
    { class: 'proc-detail', 'aria-label': t('details'), tabindex: -1 },
    detailEmpty,
    detailBody,
  )

  const element = h(
    'div',
    { class: 'proc-manager' },
    toolbar,
    h('div', { class: 'proc-main' }, wrap, detail),
  )

  function take(snap: StatusSnapshot, now: number): void {
    all = snap.processes
    uptime = snap.uptimeSecs
    takenAt = now
    threadTotal = snap.threadTotal
  }

  function row({ process: p, depth }: TreeRow): HTMLTableRowElement {
    const name = h('td', { class: 'cell-text proc-name', title: p.cmdline || p.name, text: p.name })
    if (tree) name.style.setProperty('--depth', String(depth))
    const start = startOf(p)
    const tr = h(
      'tr',
      { 'data-pid': p.pid },
      h('td', { class: 'num', text: p.pid }),
      name,
      h('td', { class: 'cell-text', text: p.user || String(p.uid) }),
      h('td', { class: 'num', text: formatPercent(p.cpuPercent) }),
      h('td', { class: 'num', text: ltr(formatBytes(p.memBytes)) }),
      h('td', { class: 'num', text: p.threads }),
      // A negative nice would show as `1-` in right-to-left text.
      h('td', { class: 'num', text: ltr(String(p.nice)) }),
      h(
        'td',
        { class: 'cell-text' },
        h('span', {
          class: 'proc-state',
          'data-group': stateGroup(p.state) ?? 'other',
          text: stateName(p.state),
        }),
      ),
      h('td', { class: 'num', text: shortTime(start, takenAt), title: formatTime(start / 1000) }),
    )
    if (p.pid === selected) tr.setAttribute('aria-current', 'true')
    rowsByPid.set(p.pid, tr)
    return tr
  }

  function render(): void {
    const filtered = filterProcesses(all, query, state)
    const sorted = sortProcesses(filtered, key, direction)
    const rows = tree ? processTree(sorted) : sorted.map((process) => ({ process, depth: 0 }))
    shown = rows.map((r) => r.process)
    COLUMNS.forEach((column, i) => {
      if (column.key === key) ths[i].setAttribute('aria-sort', direction)
      else ths[i].removeAttribute('aria-sort')
    })
    rowsByPid.clear()
    tbody.replaceChildren(...rows.map(row))
    empty.hidden = rows.length > 0
    empty.textContent = all.length === 0 ? t('reading') : t('noMatch')
    const totals = { shown: filtered.length, processes: all.length, threads: threadTotal }
    count.textContent = [
      frozen ? t('frozen') : '',
      filtered.length === all.length ? t('totals', totals) : t('filteredTotals', totals),
    ]
      .filter(Boolean)
      .join(' · ')
    if (selected !== null && !find(selected)) selected = null
    renderDetail()
  }

  function renderDetail(): void {
    const p = find(selected)
    detailEmpty.hidden = p !== undefined
    detailBody.hidden = p === undefined
    if (!p) return
    detailName.textContent = p.name
    detailName.title = p.name
    detailState.textContent = stateName(p.state)
    detailState.dataset.group = stateGroup(p.state) ?? 'other'
    setFact(pid, String(p.pid))
    const up = find(p.ppid)
    parentButton.textContent = up ? t('parentName', { name: up.name, pid: p.ppid }) : String(p.ppid)
    parentButton.disabled = !up
    parentButton.title = up ? t('goToParent') : ''
    parent.dt.hidden = p.ppid === 0
    parent.dd.hidden = p.ppid === 0
    setFact(user, p.user ? t('userUid', { user: p.user, uid: p.uid }) : `uid ${p.uid}`)
    setFact(cpu, formatPercent(p.cpuPercent))
    setFact(mem, ltr(formatBytes(p.memBytes)))
    setFact(threads, String(p.threads))
    setFact(nice, ltr(String(p.nice)))
    const ran = Math.max(0, uptime - p.startSecs)
    setFact(
      started,
      t('startedAgo', { time: ltr(formatTime(startOf(p) / 1000)), duration: formatUptime(ran) }),
    )
    cmdline.textContent = p.cmdline || t('noCommandLine')
    cmdline.classList.toggle('muted', !p.cmdline)
    copyCmd.disabled = !p.cmdline
    for (const button of actions) button.disabled = ended
  }

  function select(next: number, reveal = true): void {
    if (selected !== null) rowsByPid.get(selected)?.removeAttribute('aria-current')
    selected = next
    const tr = rowsByPid.get(next)
    tr?.setAttribute('aria-current', 'true')
    if (reveal) tr?.scrollIntoView({ block: 'nearest' })
    renderDetail()
  }

  parentButton.addEventListener('click', () => {
    const p = find(selected)
    if (!p || !find(p.ppid)) return
    if (!shown.some((x) => x.pid === p.ppid)) {
      query = ''
      search.value = ''
      state = 'all'
      stateSelect.value = 'all'
      render()
    }
    select(p.ppid)
  })

  const rowOf = (target: EventTarget | null) =>
    target instanceof Element ? target.closest<HTMLTableRowElement>('tr[data-pid]') : null
  tbody.addEventListener('click', (event) => {
    const tr = rowOf(event.target)
    if (tr) select(Number(tr.dataset.pid), false)
  })
  tbody.addEventListener('dblclick', (event) => {
    if (rowOf(event.target)) detail.focus()
  })
  tbody.addEventListener('contextmenu', (event) => {
    const tr = rowOf(event.target)
    const p = find(Number(tr?.dataset.pid))
    if (!p) return
    event.preventDefault()
    select(p.pid, false)
    showMenu(event.clientX, event.clientY, menuFor(p))
  })
  wrap.addEventListener('keydown', (event) => {
    if (event.target !== wrap) return
    const index = shown.findIndex((p) => p.pid === selected)
    const last = shown.length - 1
    let next = -1
    switch (event.key) {
      case 'ArrowDown':
        next = Math.min(last, index + 1)
        break
      case 'ArrowUp':
        next = Math.max(0, index - 1)
        break
      case 'PageDown':
        next = Math.min(last, index + PAGE)
        break
      case 'PageUp':
        next = Math.max(0, index - PAGE)
        break
      case 'Home':
        next = 0
        break
      case 'End':
        next = last
        break
      case 'Enter':
        if (index >= 0) detail.focus()
        break
      case 'Delete': {
        const p = shown[index]
        if (p && !ended) send(p, TERM).catch(report)
        break
      }
      case 'ContextMenu': {
        const p = shown[index]
        const rect = p && rowsByPid.get(p.pid)?.getBoundingClientRect()
        if (p && rect) showMenu(rect.left + 24, rect.bottom, menuFor(p))
        break
      }
      default:
        return
    }
    event.preventDefault()
    if (next >= 0 && shown[next]) select(shown[next].pid)
  })

  render()

  return {
    element,
    update(snap, now) {
      if (frozen) {
        pending = { snap, now }
        return
      }
      take(snap, now)
      render()
    },
    setEnded(value) {
      if (ended === value) return
      ended = value
      renderDetail()
    },
  }
}
