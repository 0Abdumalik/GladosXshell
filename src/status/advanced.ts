import { Chart, niceMax, type Series, seriesMax } from '../charts'
import { copyText, h, uniqueId } from '../dom'
import { formatBytes, formatPercent, formatRate, formatTime, formatUptime } from '../format'
import { ltr, messages, pl } from '../i18n'
import { common } from '../i18n-common'
import { type IconName, icon } from '../icons'
import type { Disk, NetworkConnection, StatusSnapshot, SystemInfo } from '../protocol'
import { type RingGauge, ringGauge } from './gauge'
import { bootTime, defaultInterface, type MemoryParts, memoryParts, type Track } from './model'
import { processManager } from './process-manager'
import { initStatusStore, onStatusChange, statusTrack } from './store'
import {
  type Fact,
  fact,
  formatMs,
  type Meter,
  meter,
  portOf,
  type Report,
  rate,
  setFact,
  share,
  sharePercent,
  sortPorts,
} from './widgets'

const t = messages({
  used: { zh: '已用', en: 'Used', ug: 'ئىشلىتىلگەن' },
  buffers: { zh: '缓冲', en: 'Buffers', ug: 'بۇففېر' },
  cached: { zh: '缓存', en: 'Cache', ug: 'غەملەك' },
  free: { zh: '空闲', en: 'Free', ug: 'بوش' },
  count: {
    zh: (p) =>
      scaled(Number(p.n), [
        [1e8, ' 亿'],
        [1e4, ' 万'],
      ]),
    en: (p) =>
      scaled(Number(p.n), [
        [1e9, 'B'],
        [1e6, 'M'],
        [1e4, 'K'],
      ]),
    ug: (p) =>
      scaled(Number(p.n), [
        [1e9, ' مىليارد'],
        [1e6, ' مىليون'],
        [1e4, ' مىڭ'],
      ]),
  },
  logicalCores: { zh: '{n} 个逻辑核', en: pl('logical core'), ug: '{n} لوگىكىلىق يادرو' },
  physicalCores: { zh: '{n} 个物理核', en: pl('physical core'), ug: '{n} فىزىكىلىق يادرو' },
  sockets: { zh: '{n} 路', en: pl('socket'), ug: '{n} ئۇيا' },
  hostname: { zh: '主机名', en: 'Hostname', ug: 'ئاساسىي ماشىنا نامى' },
  system: { zh: '系统', en: 'System', ug: 'سىستېما' },
  kernel: { zh: '内核', en: 'Kernel', ug: 'يادرو' },
  arch: { zh: '架构', en: 'Architecture', ug: 'قۇرۇلما' },
  cpuModel: { zh: 'CPU 型号', en: 'CPU model', ug: 'CPU مودېلى' },
  cores: { zh: '核心', en: 'Cores', ug: 'CPU يادروسى' },
  virtualization: { zh: '虚拟化', en: 'Virtualization', ug: 'مەۋھۇملاشتۇرۇش' },
  bootTime: { zh: '开机时间', en: 'Boot time', ug: 'قوزغالغان ۋاقىت' },
  uptimeFact: { zh: '运行时长', en: 'Uptime', ug: 'ئىجرا ۋاقتى' },
  load: { zh: '负载', en: 'Load', ug: 'يۈك' },
  loadTitle: {
    zh: '1、5、15 分钟平均负载',
    en: 'Load average over 1, 5 and 15 minutes',
    ug: '1، 5، 15 مىنۇتلۇق ئوتتۇرىچە يۈك',
  },
  tasks: { zh: '任务', en: 'Tasks', ug: 'ۋەزىپە' },
  overview: { zh: '基本信息', en: 'Overview', ug: 'ئاساسىي ئۇچۇر' },
  cpuUsage: { zh: 'CPU 使用率', en: 'CPU usage', ug: 'CPU ئىشلىتىلىش نىسبىتى' },
  coreNote: {
    zh: '每核使用率会在下一次刷新时出现。',
    en: 'Per-core usage appears after the next refresh.',
    ug: 'ھەر بىر يادرونىڭ ئىشلىتىلىش نىسبىتى كېيىنكى قېتىم يېڭىلانغاندا كۆرۈنىدۇ.',
  },
  perCore: { zh: '每个逻辑核', en: 'Logical cores', ug: 'ھەر بىر لوگىكىلىق يادرو' },
  memory: { zh: '内存', en: 'Memory', ug: 'ئىچكى ساقلىغۇچ' },
  memoryUsage: {
    zh: '内存使用率',
    en: 'Memory usage',
    ug: 'ئىچكى ساقلىغۇچ ئىشلىتىلىش نىسبىتى',
  },
  swap: { zh: '交换', en: 'Swap', ug: 'ئالماشتۇرۇش رايونى' },
  loggedIn: { zh: '登录用户', en: 'Logged-in users', ug: 'كىرگەن ئىشلەتكۈچىلەر' },
  user: { zh: '用户', en: 'User', ug: 'ئىشلەتكۈچى' },
  from: { zh: '来源', en: 'From', ug: 'مەنبە' },
  loginTime: { zh: '登录时间', en: 'Login time', ug: 'كىرگەن ۋاقىت' },
  summaryPage: { zh: '概览', en: 'Summary', ug: 'ئومۇمىي كۆرۈنۈش' },
  physical: { zh: '物理机', en: 'Physical machine', ug: 'فىزىكىلىق ماشىنا' },
  taskCounts: {
    zh: '{processes} 个进程 · {threads} 个线程',
    en: (p) =>
      `${pl('process', 'processes')({ n: p.processes })} · ${pl('thread')({ n: p.threads })}`,
    ug: '{processes} جەريان · {threads} يىپ',
  },
  cpuUsageNow: {
    zh: 'CPU 使用率 {value}',
    en: 'CPU usage {value}',
    ug: 'CPU ئىشلىتىلىش نىسبىتى {value}',
  },
  clauseSep: { zh: '，', en: ', ', ug: '، ' },
  memTotal: { zh: '共 {size}', en: '{size} total', ug: 'جەمئىي {size}' },
  available: {
    zh: '可用 {size}',
    en: '{size} available',
    ug: 'ئىشلەتكىلى بولىدىغىنى {size}',
  },
  shared: { zh: '共享 {size}', en: '{size} shared', ug: 'ئورتاق {size}' },
  memoryUsageNow: {
    zh: '内存使用率 {value}',
    en: 'Memory usage {value}',
    ug: 'ئىچكى ساقلىغۇچ ئىشلىتىلىش نىسبىتى {value}',
  },
  swapOff: { zh: '未启用', en: 'Off', ug: 'قوزغىتىلمىغان' },
  sessions: { zh: '{n} 个会话', en: pl('session'), ug: '{n} ئەڭگىمە' },
  readingUsers: {
    zh: '正在读取登录用户…',
    en: 'Reading logged-in users…',
    ug: 'كىرگەن ئىشلەتكۈچىلەر ئوقۇلۇۋاتىدۇ…',
  },
  noUsers: {
    zh: '当前没有登录用户。',
    en: 'No users are logged in.',
    ug: 'ھازىر كىرگەن ئىشلەتكۈچى يوق.',
  },
  local: { zh: '本地', en: 'Local', ug: 'يەرلىك' },
  diskSpace: {
    zh: '{mount} 已用空间',
    en: 'Used space on {mount}',
    ug: '{mount} نىڭ ئىشلىتىلگەن بوشلۇقى',
  },
  diskUsed: {
    zh: '已用 {percent}，{amount}',
    en: '{percent} used, {amount}',
    ug: 'ئىشلىتىلگىنى {percent}، {amount}',
  },
  details: { zh: '明细', en: 'Details', ug: 'تەپسىلات' },
  mountPoint: { zh: '挂载点', en: 'Mount point', ug: 'ئېگەرلەش نۇقتىسى' },
  device: { zh: '设备', en: 'Device', ug: 'ئۈسكۈنە' },
  size: { zh: '容量', en: 'Size', ug: 'سىغىم' },
  availableColumn: { zh: '可用', en: 'Available', ug: 'ئىشلەتكىلى بولىدىغان' },
  usage: { zh: '使用率', en: 'Usage', ug: 'ئىشلىتىلىش نىسبىتى' },
  disks: { zh: '磁盘', en: 'Disks', ug: 'دىسكا' },
  readingDisks: {
    zh: '正在读取磁盘信息…',
    en: 'Reading disks…',
    ug: 'دىسكا ئۇچۇرى ئوقۇلۇۋاتىدۇ…',
  },
  noDisks: { zh: '没有读取到磁盘。', en: 'No disks found.', ug: 'دىسكا ئوقۇلمىدى.' },
  mounts: { zh: '{n} 个挂载点', en: pl('mount point'), ug: '{n} ئېگەرلەش نۇقتىسى' },
  showTraffic: {
    zh: '查看 {name} 的流量曲线',
    en: 'Show the traffic graph for {name}',
    ug: '{name} نىڭ ئېقىم ئەگرى سىزىقىنى كۆرسەت',
  },
  interfaces: { zh: '网卡', en: 'Interfaces', ug: 'تور ئېغىزلىرى' },
  interface: { zh: '网卡', en: 'Interface', ug: 'تور ئېغىزى' },
  download: { zh: '下载', en: 'Download', ug: 'چۈشۈرۈش' },
  upload: { zh: '上传', en: 'Upload', ug: 'يۈكلەش' },
  received: { zh: '累计接收', en: 'Received', ug: 'جەمئىي قوبۇل قىلىنغان' },
  sent: { zh: '累计发送', en: 'Sent', ug: 'جەمئىي يوللانغان' },
  traffic: { zh: '流量', en: 'Traffic', ug: 'ئېقىم' },
  trafficChart: { zh: '网速图', en: 'Network speed chart', ug: 'تور سۈرئىتى گرافىكى' },
  latency: { zh: '延迟', en: 'Latency', ug: 'كېچىكىش' },
  latencyChart: { zh: '延迟图', en: 'Latency chart', ug: 'كېچىكىش گرافىكى' },
  searchPorts: {
    zh: '搜索地址、端口、进程或 PID',
    en: 'Search address, port, process or PID',
    ug: 'ئادرېس، ئېغىز، جەريان ياكى PID نى ئىزدە',
  },
  searchPortsLabel: {
    zh: '搜索监听端口',
    en: 'Search listening ports',
    ug: 'ئاڭلاۋاتقان ئېغىزلارنى ئىزدە',
  },
  filterProtocol: { zh: '按协议筛选', en: 'Filter by protocol', ug: 'كېلىشىم بويىچە سۈز' },
  allProtocols: { zh: '全部协议', en: 'All protocols', ug: 'بارلىق كېلىشىملەر' },
  listening: { zh: '监听端口', en: 'Listening ports', ug: 'ئاڭلاۋاتقان ئېغىزلار' },
  protocol: { zh: '协议', en: 'Protocol', ug: 'كېلىشىم' },
  process: { zh: '进程', en: 'Process', ug: 'جەريان' },
  portCount: { zh: '{n} 个', en: '{n}', ug: '{n}' },
  portCountFiltered: { zh: '{shown} / {n} 个', en: '{shown} / {n}', ug: '{shown} / {n}' },
  readingPorts: {
    zh: '正在读取监听端口…',
    en: 'Reading listening ports…',
    ug: 'ئاڭلاۋاتقان ئېغىزلار ئوقۇلۇۋاتىدۇ…',
  },
  noPorts: {
    zh: '没有读取到监听端口，服务器可能没有 ss 或 netstat。',
    en: 'No listening ports found. The server may not have ss or netstat.',
    ug: 'ئاڭلاۋاتقان ئېغىز ئوقۇلمىدى، مۇلازىمېتىردا ss ياكى netstat بولماسلىقى مۇمكىن.',
  },
  noPortMatch: { zh: '没有符合条件的端口。', en: 'No ports match.', ug: 'شەرتكە ماس ئېغىز يوق.' },
  rootForNames: {
    zh: '部分进程名需要以 root 登录才能看到。',
    en: 'Some process names are only visible when logged in as root.',
    ug: 'بەزى جەريان ناملىرىنى root بولۇپ كىرگەندىلا كۆرگىلى بولىدۇ.',
  },
  now: { zh: '当前', en: 'Now', ug: 'ھازىر' },
  nicRates: {
    zh: '{name}：下载 {rx}，上传 {tx}',
    en: '{name}: download {rx}, upload {tx}',
    ug: '{name}: چۈشۈرۈش {rx}، يۈكلەش {tx}',
  },
  noNicData: { zh: '没有网卡数据', en: 'No interface data', ug: 'تور ئېغىزى سانلىق مەلۇماتى يوق' },
  latencyStats: {
    zh: '平均 {avg} · 最高 {max} · 最低 {min}',
    en: 'Average {avg} · max {max} · min {min}',
    ug: 'ئوتتۇرىچە {avg} · ئەڭ يۇقىرى {max} · ئەڭ تۆۋەن {min}',
  },
  latencyNow: { zh: '延迟：{value}', en: 'Latency: {value}', ug: 'كېچىكىش: {value}' },
  network: { zh: '网络', en: 'Network', ug: 'تور' },
  connectionLoading: { zh: '加载中', en: 'Loading', ug: 'يۈكلىنىۋاتىدۇ' },
  connectionLive: { zh: '实时', en: 'Live', ug: 'جانلىق' },
  connectionError: { zh: '读取失败', en: 'Read failed', ug: 'ئوقۇش مەغلۇپ' },
  connectionEnded: { zh: '已断开', en: 'Disconnected', ug: 'ئۈزۈلدى' },
  processes: { zh: '进程', en: 'Processes', ug: 'جەريان' },
  tabs: { zh: '页签', en: 'Tabs', ug: 'بەتكۈچلەر' },
  serverStatus: { zh: '服务器状态', en: 'Server status', ug: 'مۇلازىمېتىر ھالىتى' },
  copyIp: { zh: '复制 IP 地址', en: 'Copy IP address', ug: 'IP ئادرېسنى كۆچۈر' },
  uptime: { zh: '运行', en: 'Uptime', ug: 'ئىجرا ۋاقتى' },
  loading: { zh: '正在加载…', en: 'Loading…', ug: 'يۈكلىنىۋاتىدۇ…' },
  categories: { zh: '状态分类', en: 'Status categories', ug: 'ھالەت تۈرلىرى' },
  disconnected: { zh: '连接已断开。', en: 'Disconnected.', ug: 'ئۇلىنىش ئۈزۈلدى.' },
  readFailed: {
    zh: '状态读取失败：{error}',
    en: "Couldn't read the status: {error}",
    ug: 'ھالەتنى ئوقۇش مەغلۇپ بولدى: {error}',
  },
  reading: { zh: '正在读取状态…', en: 'Reading status…', ug: 'ھالەت ئوقۇلۇۋاتىدۇ…' },
  unsupported: {
    zh: '该系统暂不支持状态监控（需要 Linux 的 {proc}）。',
    en: 'Status monitoring is not supported on this system yet (it needs Linux {proc}).',
    ug: 'بۇ سىستېما ھازىرچە ھالەت كۆزىتىشنى قوللىمايدۇ (Linux نىڭ {proc} مۇندەرىجىسى كېرەك).',
  },
  lastData: {
    zh: '连接已断开，下面是断开前的最后数据。',
    en: 'Disconnected. Below is the last data from before the disconnect.',
    ug: 'ئۇلىنىش ئۈزۈلدى، تۆۋەندىكىسى ئۈزۈلۈشتىن بۇرۇنقى ئەڭ ئاخىرقى سانلىق مەلۇمات.',
  },
  lastFailed: {
    zh: '最近一次读取失败：{error}',
    en: 'The last read failed: {error}',
    ug: 'ئەڭ ئاخىرقى قېتىملىق ئوقۇش مەغلۇپ بولدى: {error}',
  },
})

/** `n` in the largest step it reaches, to one decimal: 12.3 万, 4.5M. */
function scaled(n: number, steps: [number, string][]): string {
  for (const [size, unit] of steps) if (n >= size) return `${(n / size).toFixed(1)}${unit}`
  return String(n)
}

type PageId = 'overview' | 'processes' | 'disks' | 'network'

interface Page {
  id: PageId
  label: string
  icon: IconName
  element: HTMLElement
  /** `takenAt` is when this window received the snapshot, in ms since the epoch. */
  update(track: Track, snap: StatusSnapshot, takenAt: number): void
  /** Repaints charts once the page is visible again. */
  shown?(): void
}

const TAB_KEY = 'gx-advanced-tab'
const PORT_ROWS = 500

const MEM_PARTS: [keyof MemoryParts, string][] = [
  ['used', t('used')],
  ['buffers', t('buffers')],
  ['cached', t('cached')],
  ['free', t('free')],
]

function card(title: string, meta: Node | null, ...children: Node[]): HTMLElement {
  return h(
    'section',
    { class: 'adv-card', 'aria-label': title },
    h(
      'header',
      { class: 'adv-card-head' },
      h('h2', { class: 'adv-card-title', text: title }),
      meta,
    ),
    ...children,
  )
}

function metaText(): HTMLElement {
  return h('span', { class: 'adv-card-meta num' })
}

function facts(rows: Fact[]): HTMLElement {
  return h(
    'dl',
    { class: 'status-facts adv-facts' },
    rows.flatMap((row) => [row.dt, row.dd]),
  )
}

function th(label: string, cls = ''): HTMLElement {
  return h('th', { scope: 'col', class: cls || null, text: label })
}

function table(cls: string, heads: HTMLElement[], tbody: HTMLElement): HTMLElement {
  return h(
    'div',
    { class: 'table-wrap adv-table-wrap' },
    h(
      'table',
      { class: `data-table adv-table ${cls}`.trim() },
      h('thead', {}, h('tr', {}, heads)),
      tbody,
    ),
  )
}

function chart(name: string, tall = false): Chart {
  const c = new Chart(name)
  c.element.classList.add('adv-chart')
  if (tall) c.element.classList.add('adv-chart-tall')
  return c
}

/** Large counts the way each language says them: 万 and 亿 in Chinese, K and M in English. */
function formatCount(n: number): string {
  return t('count', { n })
}

function coreText(s: SystemInfo): string {
  const parts: string[] = []
  if (s.cpuCores > 0) parts.push(t('logicalCores', { n: s.cpuCores }))
  if (s.cpuPhysical) parts.push(t('physicalCores', { n: s.cpuPhysical }))
  if (s.cpuSockets) parts.push(t('sockets', { n: s.cpuSockets }))
  if (s.cpuMhz) parts.push(ltr(`${Math.round(s.cpuMhz)} MHz`))
  return parts.join(' · ')
}

function overviewPage(): Page {
  const host = fact(t('hostname'))
  const os = fact(t('system'))
  const kernel = fact(t('kernel'), h('dd', { class: 'cell-text mono' }))
  const arch = fact(t('arch'))
  const model = fact(t('cpuModel'))
  const cores = fact(t('cores'))
  const virt = fact(t('virtualization'))
  const boot = fact(t('bootTime'), h('dd', { class: 'num' }))
  const uptime = fact(t('uptimeFact'), h('dd', { class: 'num' }))
  const load = fact(t('load'), h('dd', { class: 'num', title: t('loadTitle') }))
  const tasks = fact(t('tasks'), h('dd', { class: 'num' }))
  const info = card(
    t('overview'),
    null,
    facts([host, os, kernel, arch, model, cores, virt, boot, uptime, load, tasks]),
  )

  const cpuNow = metaText()
  const cpuChart = chart(t('cpuUsage'))
  const coreGrid = h('div', { class: 'adv-cores' })
  const coreNote = h('p', { class: 'help', text: t('coreNote') })
  let coreMeters: Meter[] = []
  const cpu = card(
    'CPU',
    cpuNow,
    cpuChart.element,
    h('h3', { class: 'adv-label', text: t('perCore') }),
    coreGrid,
    coreNote,
  )

  const memNow = metaText()
  const parts = MEM_PARTS.map(([part, label]) => ({
    part,
    label,
    segment: h('span', { class: 'mem-part', 'data-part': part }),
    value: h('span', { class: 'mem-legend-value num' }),
  }))
  const stack = h(
    'div',
    { class: 'mem-stack', role: 'img' },
    parts.map((p) => p.segment),
  )
  const legend = h(
    'ul',
    { class: 'mem-legend' },
    parts.map((p) =>
      h(
        'li',
        { class: 'mem-legend-item', 'data-part': p.part },
        h('span', { class: 'mem-swatch', 'aria-hidden': 'true' }),
        h('span', { class: 'mem-legend-label', text: p.label }),
        p.value,
      ),
    ),
  )
  const memNote = h('p', { class: 'status-note num' })
  const memChart = chart(t('memoryUsage'))
  const swap = meter(t('swap'))
  const memory = card(t('memory'), memNow, stack, legend, memNote, memChart.element, swap.row)

  const userCount = metaText()
  const userRows = h('tbody')
  const userNote = h('p', { class: 'help' })
  const users = card(
    t('loggedIn'),
    userCount,
    table('', [th(t('user')), th(common('terminal')), th(t('from')), th(t('loginTime'))], userRows),
    userNote,
  )

  return {
    id: 'overview',
    label: t('summaryPage'),
    icon: 'gauge',
    element: h('div', { class: 'adv-overview' }, info, cpu, memory, users),
    update(track, snap, takenAt) {
      const system = track.system
      setFact(host, system?.hostname ?? '')
      setFact(os, system?.os ?? '')
      setFact(kernel, system?.kernel ?? '')
      setFact(arch, system?.arch ?? '')
      setFact(model, system?.cpuModel ?? '')
      setFact(cores, system ? coreText(system) : '')
      const v = system?.virtualization ?? ''
      setFact(virt, v === 'none' ? t('physical') : v)
      setFact(boot, formatTime(bootTime(snap.uptimeSecs, takenAt) / 1000))
      setFact(uptime, formatUptime(snap.uptimeSecs))
      load.dd.textContent = snap.load.map((x) => x.toFixed(2)).join(' / ')
      setFact(tasks, t('taskCounts', { processes: snap.processTotal, threads: snap.threadTotal }))

      cpuNow.textContent = formatPercent(snap.cpuPercent)
      cpuChart.update(
        [{ values: track.cpu, color: '--gx-chart-rx', fill: true }],
        100,
        '100%',
        t('cpuUsageNow', { value: cpuNow.textContent }),
      )
      const perCore = snap.cpuCores
      coreNote.hidden = perCore !== null
      if (perCore) {
        if (coreMeters.length !== perCore.length) {
          coreMeters = perCore.map((_, i) => meter(`CPU ${i}`))
          coreGrid.replaceChildren(...coreMeters.map((m) => m.row))
        }
        perCore.forEach((value, i) => {
          coreMeters[i].set(value / 100, formatPercent(value), '')
        })
      }

      const m = snap.memory
      const split = memoryParts(m)
      let start = 0
      const described: string[] = []
      for (const p of parts) {
        const size = m.total > 0 ? split[p.part] / m.total : 0
        p.segment.style.setProperty('--start', String(start))
        p.segment.style.setProperty('--size', String(size))
        start += size
        const text = ltr(`${formatBytes(split[p.part])} · ${sharePercent(split[p.part], m.total)}`)
        p.value.textContent = text
        described.push(`${p.label} ${text}`)
      }
      stack.setAttribute('aria-label', described.join(t('clauseSep')))
      memNow.textContent = sharePercent(snap.mem.used, snap.mem.total)
      memNote.textContent = [
        t('memTotal', { size: ltr(formatBytes(m.total)) }),
        t('available', { size: ltr(formatBytes(m.available)) }),
        m.shmem > 0 ? t('shared', { size: ltr(formatBytes(m.shmem)) }) : '',
      ]
        .filter(Boolean)
        .join(' · ')
      memChart.update(
        [{ values: track.mem, color: '--gx-purple-400', fill: true }],
        100,
        '100%',
        t('memoryUsageNow', { value: memNow.textContent }),
      )
      const s = snap.swap
      if (s.total > 0) {
        swap.set(
          share(s.used, s.total),
          sharePercent(s.used, s.total),
          ltr(`${formatBytes(s.used)} / ${formatBytes(s.total)}`),
        )
      } else swap.set(null, '', t('swapOff'))

      const list = snap.users
      userCount.textContent = list ? t('sessions', { n: list.length }) : ''
      userNote.textContent = list === null ? t('readingUsers') : t('noUsers')
      userNote.hidden = list !== null && list.length > 0
      userRows.replaceChildren(
        ...(list ?? []).map((u) =>
          h(
            'tr',
            {},
            h('td', { class: 'cell-text', text: u.name }),
            h('td', { class: 'cell-text mono', text: u.tty }),
            h('td', { class: 'cell-text mono', text: u.from || t('local') }),
            h('td', { class: 'cell-text num', text: u.since }),
          ),
        ),
      )
    },
    shown() {
      cpuChart.paint()
      memChart.paint()
    },
  }
}

interface DiskCard {
  root: HTMLElement
  ring: RingGauge
  device: HTMLElement
  size: HTMLElement
  inodes: Meter
}

function diskCard(mount: string): DiskCard {
  const ring = ringGauge(t('diskSpace', { mount: ltr(mount) }))
  const device = h('p', { class: 'adv-disk-device cell-text' })
  const size = h('p', { class: 'adv-disk-size num' })
  const inodes = meter('inode')
  const root = h(
    'article',
    { class: 'adv-disk', 'aria-label': mount },
    ring.element,
    h('h3', { class: 'adv-disk-mount mono cell-text', text: mount, title: mount }),
    device,
    size,
    inodes.row,
  )
  return { root, ring, device, size, inodes }
}

function fillDisk(c: DiskCard, d: Disk): void {
  const used = Math.max(0, d.total - d.avail)
  const percent = sharePercent(used, d.total)
  const amount = `${formatBytes(used)} / ${formatBytes(d.total)}`
  c.ring.set(share(used, d.total), percent, t('diskUsed', { percent, amount: ltr(amount) }))
  const device = [d.filesystem, d.fsType].filter(Boolean).join(' · ')
  c.device.textContent = device
  c.device.title = device
  c.size.textContent = ltr(amount)
  c.size.title = t('available', { size: ltr(formatBytes(d.avail)) })
  const total = d.inodesTotal ?? 0
  const usedInodes = d.inodesUsed ?? 0
  // Some filesystems (btrfs, many FUSE mounts) report no inode limit at all.
  c.inodes.row.hidden = total <= 0
  if (total > 0) {
    c.inodes.set(
      share(usedInodes, total),
      sharePercent(usedInodes, total),
      `${formatCount(usedInodes)} / ${formatCount(total)}`,
    )
  }
}

function disksPage(): Page {
  const cards = new Map<string, DiskCard>()
  const grid = h('div', { class: 'adv-disks' })
  const note = h('p', { class: 'help' })
  const count = metaText()
  const rows = h('tbody')
  const detail = card(
    t('details'),
    count,
    table(
      'adv-disk-table',
      [
        th(t('mountPoint'), 'col-mount'),
        th(t('device')),
        th(common('type'), 'col-type'),
        th(t('size'), 'num col-size'),
        th(t('used'), 'num col-size'),
        th(t('availableColumn'), 'num col-size'),
        th(t('usage'), 'num col-share'),
        th('inode', 'num col-share'),
      ],
      rows,
    ),
  )
  let shown: Disk[] | null | undefined
  let order = ''
  return {
    id: 'disks',
    label: t('disks'),
    icon: 'hard-drive',
    element: h('div', { class: 'adv-stack' }, note, grid, detail),
    update(track) {
      const disks = track.disks
      note.textContent = disks === null ? t('readingDisks') : t('noDisks')
      note.hidden = disks !== null && disks.length > 0
      // Disks arrive every few polls; the same array means nothing changed.
      if (disks === shown) return
      shown = disks
      const list = [...(disks ?? [])].sort((a, b) => a.mount.localeCompare(b.mount))
      const next: HTMLElement[] = []
      for (const d of list) {
        let c = cards.get(d.mount)
        if (!c) {
          c = diskCard(d.mount)
          cards.set(d.mount, c)
        }
        fillDisk(c, d)
        next.push(c.root)
      }
      const mounts = new Set(list.map((d) => d.mount))
      for (const mount of [...cards.keys()]) if (!mounts.has(mount)) cards.delete(mount)
      // Cards are only re-inserted when the set changes, so their rings animate in place.
      const key = list.map((d) => d.mount).join('\n')
      if (key !== order) {
        order = key
        grid.replaceChildren(...next)
      }
      count.textContent = list.length > 0 ? t('mounts', { n: list.length }) : ''
      rows.replaceChildren(
        ...list.map((d) => {
          const used = Math.max(0, d.total - d.avail)
          const total = d.inodesTotal ?? 0
          return h(
            'tr',
            {},
            h('td', { class: 'cell-text mono', text: d.mount, title: d.mount }),
            h('td', { class: 'cell-text mono', text: d.filesystem, title: d.filesystem }),
            h('td', { class: 'cell-text', text: d.fsType ?? '—' }),
            h('td', { class: 'num', text: ltr(formatBytes(d.total)) }),
            h('td', { class: 'num', text: ltr(formatBytes(used)) }),
            h('td', { class: 'num', text: ltr(formatBytes(d.avail)) }),
            h('td', { class: 'num', text: sharePercent(used, d.total) }),
            h('td', {
              class: 'num',
              text: total > 0 ? sharePercent(d.inodesUsed ?? 0, total) : '—',
            }),
          )
        }),
      )
    },
  }
}

interface NicRow {
  tr: HTMLTableRowElement
  button: HTMLButtonElement
  rx: HTMLElement
  tx: HTMLElement
  rxTotal: HTMLElement
  txTotal: HTMLElement
}

function nicRow(name: string): NicRow {
  const button = h('button', {
    type: 'button',
    class: 'adv-row-button mono',
    'data-nic': name,
    'aria-pressed': 'false',
    title: t('showTraffic', { name: ltr(name) }),
    text: name,
  })
  const rx = h('td', { class: 'num' })
  const tx = h('td', { class: 'num' })
  const rxTotal = h('td', { class: 'num' })
  const txTotal = h('td', { class: 'num' })
  const tr = h('tr', {}, h('td', { class: 'cell-text' }, button), rx, tx, rxTotal, txTotal)
  return { tr, button, rx, tx, rxTotal, txTotal }
}

function networkPage(): Page {
  let chosen: string | null = null
  let names = ''
  let last: { track: Track; snap: StatusSnapshot } | null = null
  const nics = new Map<string, NicRow>()
  const nicRows = h('tbody')
  const nicCard = card(
    t('interfaces'),
    null,
    table(
      'adv-nic-table',
      [
        th(t('interface')),
        th(t('download'), 'num'),
        th(t('upload'), 'num'),
        th(t('received'), 'num'),
        th(t('sent'), 'num'),
      ],
      nicRows,
    ),
  )

  const trafficName = h('span', { class: 'adv-card-meta mono' })
  const legend = h('div', { class: 'net-legend' })
  const traffic = chart(t('trafficChart'), true)
  const trafficCard = card(t('traffic'), trafficName, legend, traffic.element)

  const latencyNow = metaText()
  const latency = chart(t('latencyChart'), true)
  const latencyNote = h('p', { class: 'status-note num' })
  const latencyCard = card(t('latency'), latencyNow, latency.element, latencyNote)

  let ports: NetworkConnection[] | null = null
  const search = h('input', {
    type: 'search',
    class: 'adv-filter-search',
    placeholder: t('searchPorts'),
    'aria-label': t('searchPortsLabel'),
    spellcheck: 'false',
    autocomplete: 'off',
  })
  const proto = h(
    'select',
    { class: 'adv-filter-select', 'aria-label': t('filterProtocol') },
    h('option', { value: '', text: t('allProtocols') }),
    h('option', { value: 'tcp', text: 'TCP' }),
    h('option', { value: 'udp', text: 'UDP' }),
  )
  const portCount = metaText()
  const portRows = h('tbody')
  const portNote = h('p', { class: 'help' })
  const portsCard = card(
    t('listening'),
    portCount,
    h('div', { class: 'adv-filter' }, search, proto),
    table(
      'adv-port-table',
      [
        th(t('protocol'), 'col-proto'),
        th(common('address')),
        th(common('port'), 'num col-port'),
        th(t('process')),
        th('PID', 'num col-pid'),
      ],
      portRows,
    ),
    portNote,
  )

  const renderPorts = () => {
    const q = search.value.trim().toLowerCase()
    const p = proto.value
    const all = sortPorts(ports ?? [])
    const list = all.filter(
      (c) =>
        (p === '' || c.proto.toLowerCase().startsWith(p)) &&
        (q === '' ||
          c.localAddr.toLowerCase().includes(q) ||
          c.program.toLowerCase().includes(q) ||
          (c.pid !== null && String(c.pid).startsWith(q))),
    )
    portCount.textContent =
      ports === null
        ? ''
        : list.length === all.length
          ? t('portCount', { n: all.length })
          : t('portCountFiltered', { shown: list.length, n: all.length })
    portNote.textContent =
      ports === null
        ? t('readingPorts')
        : all.length === 0
          ? t('noPorts')
          : list.length === 0
            ? t('noPortMatch')
            : t('rootForNames')
    portNote.hidden = ports !== null && list.length > 0 && list.every((c) => c.program)
    portRows.replaceChildren(
      ...list.slice(0, PORT_ROWS).map((c) => {
        const cut = c.localAddr.lastIndexOf(':')
        const host = cut >= 0 ? c.localAddr.slice(0, cut) : c.localAddr
        return h(
          'tr',
          { title: [c.proto, c.localAddr, c.state].filter(Boolean).join(' ') },
          h('td', { class: 'cell-text', text: c.proto }),
          h('td', { class: 'cell-text mono', text: host }),
          h('td', { class: 'num', text: portOf(c.localAddr) }),
          h('td', { class: 'cell-text', text: c.program || '—' }),
          h('td', { class: 'num', text: c.pid ?? '—' }),
        )
      }),
    )
  }
  let searchTimer = 0
  search.addEventListener('input', () => {
    clearTimeout(searchTimer)
    searchTimer = window.setTimeout(renderPorts, 200)
  })
  proto.addEventListener('change', renderPorts)
  renderPorts()

  const draw = (track: Track, snap: StatusSnapshot) => {
    const list = snap.net
    if (chosen === null || !list.some((n) => n.name === chosen)) chosen = defaultInterface(snap)
    // Rows are rebuilt only when the interfaces change, so a focused button survives polls.
    const key = list.map((n) => n.name).join('\n')
    if (key !== names) {
      names = key
      nics.clear()
      nicRows.replaceChildren(
        ...list.map((n) => {
          const row = nicRow(n.name)
          nics.set(n.name, row)
          return row.tr
        }),
      )
    }
    for (const n of list) {
      const row = nics.get(n.name)
      if (!row) continue
      row.rx.textContent = ltr(formatRate(n.rxRate))
      row.tx.textContent = ltr(formatRate(n.txRate))
      row.rxTotal.textContent = ltr(formatBytes(n.rxTotal))
      row.txTotal.textContent = ltr(formatBytes(n.txTotal))
      const on = n.name === chosen
      row.button.setAttribute('aria-pressed', String(on))
      if (on) row.tr.setAttribute('aria-current', 'true')
      else row.tr.removeAttribute('aria-current')
    }

    trafficName.textContent = chosen ?? ''
    const history = chosen === null ? undefined : track.net.get(chosen)
    const series: Series[] = history
      ? [
          { values: history.rx, color: '--gx-chart-rx', fill: true },
          { values: history.tx, color: '--gx-chart-tx' },
        ]
      : []
    const now = list.find((n) => n.name === chosen)
    legend.replaceChildren(
      h(
        'div',
        { class: 'net-legend-row' },
        h('span', { class: 'net-legend-name', text: t('now') }),
        rate(now?.rxRate, '↓', '--gx-chart-rx', t('download')),
        rate(now?.txRate, '↑', '--gx-chart-tx', t('upload')),
      ),
    )
    const max = niceMax(Math.max(seriesMax(series), 1024), true)
    traffic.update(
      series,
      max,
      formatRate(max),
      now
        ? t('nicRates', {
            name: ltr(now.name),
            rx: ltr(formatRate(now.rxRate)),
            tx: ltr(formatRate(now.txRate)),
          })
        : t('noNicData'),
    )

    const ms = snap.latencyMs
    const current = ms === null ? '—' : formatMs(ms)
    latencyNow.textContent = ltr(current)
    const samples = track.latency.filter((v): v is number => v !== null)
    const peak = Math.max(0, ...samples)
    latencyNote.textContent =
      samples.length > 0
        ? t('latencyStats', {
            avg: ltr(formatMs(samples.reduce((a, b) => a + b, 0) / samples.length)),
            max: ltr(formatMs(peak)),
            min: ltr(formatMs(Math.min(...samples))),
          })
        : ''
    const top = niceMax(Math.max(peak, 10))
    latency.update(
      [{ values: track.latency, color: '--gx-chart-latency', fill: true }],
      top,
      `${top} ms`,
      t('latencyNow', { value: ltr(current) }),
    )

    // Ports come with some polls only; keep the last list in between.
    if (snap.connections && snap.connections !== ports) {
      ports = snap.connections
      renderPorts()
    }
  }

  nicRows.addEventListener('click', (event) => {
    const button =
      event.target instanceof Element
        ? event.target.closest<HTMLButtonElement>('button[data-nic]')
        : null
    if (!button?.dataset.nic) return
    chosen = button.dataset.nic
    if (last) draw(last.track, last.snap)
  })

  return {
    id: 'network',
    label: t('network'),
    icon: 'network',
    element: h(
      'div',
      { class: 'adv-network' },
      nicCard,
      h('div', { class: 'adv-pair' }, trafficCard, latencyCard),
      portsCard,
    ),
    update(track, snap) {
      last = { track, snap }
      draw(track, snap)
    },
    shown() {
      traffic.paint()
      latency.paint()
    },
  }
}

type Connection = 'loading' | 'live' | 'error' | 'ended'

const CONNECTION_TEXT: Record<Connection, string> = {
  loading: t('connectionLoading'),
  live: t('connectionLive'),
  error: t('connectionError'),
  ended: t('connectionEnded'),
}

/** The advanced window for one server; it keeps the last data on screen after a disconnect. */
export function advancedView(sessionId: number, report: Report): HTMLElement {
  const manager = processManager(sessionId, report)
  const pages: Page[] = [
    overviewPage(),
    {
      id: 'processes',
      label: t('processes'),
      icon: 'list-bullets',
      element: manager.element,
      update: (_track, snap, takenAt) => manager.update(snap, takenAt),
    },
    disksPage(),
    networkPage(),
  ]
  const saved = sessionStorage.getItem(TAB_KEY)
  let current = pages.find((p) => p.id === saved) ?? pages[0]

  const tabs = pages.map((page) =>
    h(
      'button',
      { type: 'button', role: 'tab', id: uniqueId('adv-tab'), class: 'adv-tab' },
      icon(page.icon),
      h('span', { text: page.label }),
    ),
  )
  const panels = pages.map((page, i) => {
    const panel = h(
      'section',
      {
        role: 'tabpanel',
        id: uniqueId('adv-panel'),
        class: 'adv-panel',
        'data-page': page.id,
        'aria-labelledby': tabs[i].id,
        // Pages without controls of their own still need a tab stop to scroll by keyboard.
        tabindex: page.id === 'overview' || page.id === 'disks' ? 0 : null,
      },
      page.element,
    )
    tabs[i].setAttribute('aria-controls', panel.id)
    return panel
  })
  const tablist = h(
    'div',
    { class: 'adv-tabs', role: 'tablist', 'aria-orientation': 'vertical', 'aria-label': t('tabs') },
    tabs,
  )

  const hostName = h('h1', { class: 'adv-host cell-text', text: t('serverStatus') })
  const badge = h('span', { class: 'adv-badge' })
  const address = h('span', { class: 'mono' })
  const copy = h(
    'button',
    {
      type: 'button',
      class: 'icon-button adv-copy',
      title: t('copyIp'),
      'aria-label': t('copyIp'),
      onclick: () => {
        if (address.textContent) copyText(address.textContent).catch(report)
      },
    },
    icon('copy'),
  )
  const os = h('span', { class: 'cell-text' })
  const up = h('span', { class: 'num' })
  const ping = h('span', { class: 'num' })
  const item = (label: string, ...value: Node[]) =>
    h('div', { class: 'adv-summary-item' }, h('dt', { text: label }), h('dd', {}, ...value))
  const head = h(
    'header',
    { class: 'adv-head' },
    h('div', { class: 'adv-title' }, hostName, badge),
    h(
      'dl',
      { class: 'adv-summary' },
      item(common('address'), address, copy),
      item(t('system'), os),
      item(t('uptime'), up),
      item(t('latency'), ping),
    ),
  )
  const banner = h('p', { class: 'adv-banner', role: 'status', hidden: true })
  const empty = h('p', { class: 'panel-empty', text: t('loading') })
  const body = h(
    'div',
    { class: 'adv-body', hidden: true },
    h('nav', { class: 'adv-nav', 'aria-label': t('categories') }, tablist),
    h('div', { class: 'adv-content' }, panels),
  )
  const element = h('div', { class: 'adv' }, head, banner, empty, body)

  let loaded = false
  let ended = false
  let track: Track | null = null
  let seq = -1
  let takenAt = 0

  const setConnection = (state: Connection) => {
    badge.dataset.state = state
    badge.textContent = CONNECTION_TEXT[state]
  }
  setConnection('loading')

  const render = () => {
    if (!loaded) return
    const live = statusTrack(sessionId)
    if (live) track = live
    else if (!ended) {
      // The store drops a session once it ends; after loading, a missing one has ended.
      ended = true
      manager.setEnded(true)
    }
    const snap = track?.last ?? null
    const error = track?.error ?? null
    const message = !snap
      ? ended
        ? t('disconnected')
        : error
          ? t('readFailed', { error })
          : t('reading')
      : snap.unsupported
        ? t('unsupported', { proc: ltr('/proc') })
        : ''
    empty.textContent = message
    empty.hidden = message === ''
    body.hidden = message !== ''
    setConnection(ended ? 'ended' : error ? 'error' : snap ? 'live' : 'loading')
    const warning = snap && ended ? t('lastData') : snap && error ? t('lastFailed', { error }) : ''
    banner.textContent = warning
    banner.hidden = warning === ''
    const system = track?.system ?? null
    hostName.textContent = system?.hostname || snap?.address || t('serverStatus')
    address.textContent = snap?.address ?? '—'
    copy.hidden = !snap?.address
    os.textContent = system ? [system.os, system.arch].filter(Boolean).join(' · ') : '—'
    up.textContent = snap ? formatUptime(snap.uptimeSecs) : '—'
    const ms = snap?.latencyMs ?? null
    ping.textContent = ms === null || ended ? '—' : ltr(formatMs(ms))
    if (!track || !snap || message) return
    if (track.seq !== seq) {
      seq = track.seq
      takenAt = Date.now()
    }
    // Hidden pages catch up when they are opened.
    current.update(track, snap, takenAt)
  }

  const select = (page: Page, focus = false) => {
    current = page
    sessionStorage.setItem(TAB_KEY, page.id)
    pages.forEach((p, i) => {
      const on = p === page
      tabs[i].setAttribute('aria-selected', String(on))
      tabs[i].tabIndex = on ? 0 : -1
      panels[i].hidden = !on
    })
    if (focus) tabs[pages.indexOf(page)].focus()
    render()
    page.shown?.()
  }

  tablist.addEventListener('click', (event) => {
    const i = tabs.findIndex((tab) => event.target instanceof Node && tab.contains(event.target))
    if (i >= 0) select(pages[i])
  })
  tablist.addEventListener('keydown', (event) => {
    const i = pages.indexOf(current)
    let next: number
    switch (event.key) {
      case 'ArrowDown':
        next = (i + 1) % pages.length
        break
      case 'ArrowUp':
        next = (i - 1 + pages.length) % pages.length
        break
      case 'Home':
        next = 0
        break
      case 'End':
        next = pages.length - 1
        break
      default:
        return
    }
    event.preventDefault()
    select(pages[next], true)
  })

  select(current)
  onStatusChange((change) => {
    if (change === null || change === sessionId) render()
  })
  initStatusStore()
    .then(() => {
      loaded = true
      render()
      current.shown?.()
    })
    .catch(report)

  return element
}
