import { invoke } from '@tauri-apps/api/core'
import { Chart, niceMax, type Sample, seriesMax } from '../charts'
import { confirmDialog, promptDialog } from '../dialogs'
import { copyText, h, uniqueId } from '../dom'
import { formatBytes, formatPercent, formatRate, formatUptime } from '../format'
import { joinList, ltr, messages, pl } from '../i18n'
import { common } from '../i18n-common'
import { icon } from '../icons'
import { showMenu } from '../menu'
import type { Disk, NetworkConnection, ProcessInfo, StatusSnapshot, SystemInfo } from '../protocol'
import { WIDGET_NAMES, type WidgetId } from '../settings-model'
import { settings, updateSettings } from '../settings-store'
import { meterLevel } from './gauge'
import { chosenInterfaces, MAX_INTERFACES, type Track } from './model'
import { type ProcessKey, sortProcesses, validNice } from './processes'

const t = messages({
  resizeWidget: {
    zh: '调整「{title}」高度',
    en: 'Resize {title}',
    ug: '«{title}» نىڭ ئېگىزلىكىنى تەڭشەش',
  },
  cores: { zh: '{n} 核', en: pl('core'), ug: '{n} يادرو' },
  copyIp: { zh: '复制 IP 地址', en: 'Copy IP address', ug: 'IP ئادرېسنى كۆچۈر' },
  system: { zh: '系统', en: 'System', ug: 'سىستېما' },
  kernel: { zh: '内核', en: 'Kernel', ug: 'يادرو' },
  uptime: { zh: '运行', en: 'Uptime', ug: 'ئىجرا ۋاقتى' },
  load: { zh: '负载', en: 'Load', ug: 'يۈك' },
  loadTitle: {
    zh: '1、5、15 分钟平均负载',
    en: 'Load average over 1, 5 and 15 minutes',
    ug: '1، 5، 15 مىنۇتلۇق ئوتتۇرىچە يۈك',
  },
  valueDetail: { zh: '{value}，{detail}', en: '{value}, {detail}', ug: '{value}، {detail}' },
  memory: { zh: '内存', en: 'Memory', ug: 'ئىچكى ساقلىغۇچ' },
  swap: { zh: '交换', en: 'Swap', ug: 'ئالماشتۇرۇش رايونى' },
  swapOff: { zh: '未启用', en: 'Off', ug: 'قوزغىتىلمىغان' },
  parentPid: { zh: '父进程 {pid}', en: 'Parent {pid}', ug: 'ئاتا جەريان {pid}' },
  processState: { zh: '状态 {state}', en: 'Status {state}', ug: 'ھالەت {state}' },
  threads: { zh: '{n} 线程', en: pl('thread'), ug: '{n} يىپ' },
  processHint: {
    zh: '右键可结束进程或调整优先级',
    en: 'Right-click to end the process or change its priority',
    ug: 'ئوڭ چېكىپ جەرياننى ئاخىرلاشتۇرغىلى ياكى ئالدىنلىقىنى تەڭشىگىلى بولىدۇ',
  },
  command: { zh: '命令', en: 'Command', ug: 'بۇيرۇق' },
  endTitle: { zh: '结束进程', en: 'End process', ug: 'جەرياننى ئاخىرلاشتۇر' },
  sendSignal: {
    zh: '向 {name}（PID {pid}）发送 {signal}？',
    en: 'Send {signal} to {name} (PID {pid})?',
    ug: '{signal} سىگنالىنى {name} جەريانىغا (PID {pid}) ئەۋەتەمسىز؟',
  },
  end: { zh: '结束', en: 'End', ug: 'ئاخىرلاشتۇر' },
  forceKill: { zh: '强制结束', en: 'Force kill', ug: 'مەجبۇرىي ئاخىرلاشتۇر' },
  reniceTitle: { zh: '调整优先级', en: 'Change priority', ug: 'ئالدىنلىقنى تەڭشەش' },
  reniceLabel: {
    zh: '{name}（PID {pid}）的 nice 值，{min} 到 19',
    en: 'Nice value for {name} (PID {pid}), {min} to 19',
    ug: '{name} جەريانى (PID {pid}) نىڭ nice قىممىتى، {min} دىن 19 غىچە',
  },
  apply: { zh: '应用', en: 'Apply', ug: 'قوللان' },
  menuTerm: { zh: '结束（SIGTERM）', en: 'End (SIGTERM)', ug: 'ئاخىرلاشتۇر (SIGTERM)' },
  menuKill: {
    zh: '强制结束（SIGKILL）',
    en: 'Force kill (SIGKILL)',
    ug: 'مەجبۇرىي ئاخىرلاشتۇر (SIGKILL)',
  },
  menuRenice: { zh: '调整优先级…', en: 'Change priority…', ug: 'ئالدىنلىقنى تەڭشە…' },
  copyPid: { zh: '复制 PID', en: 'Copy PID', ug: 'PID نى كۆچۈر' },
  copyName: { zh: '复制命令名', en: 'Copy command name', ug: 'بۇيرۇق نامىنى كۆچۈر' },
  interfacesShown: {
    zh: '显示的网卡，最多 {n} 个',
    en: 'Network interfaces to show, up to {n}',
    ug: 'كۆرسىتىلىدىغان تور ئېغىزلىرى، ئەڭ كۆپ {n} تال',
  },
  chooseInterfaces: {
    zh: '选择要显示的网卡，最多 {n} 个',
    en: 'Choose the network interfaces to show, up to {n}',
    ug: 'كۆرسىتىدىغان تور ئېغىزلىرىنى تاللاڭ، ئەڭ كۆپ {n} تال',
  },
  interfaces: { zh: '网卡', en: 'Interfaces', ug: 'تور ئېغىزى' },
  trafficChart: { zh: '网速图', en: 'Network speed chart', ug: 'تور سۈرئىتى گرافىكى' },
  none: { zh: '无', en: 'None', ug: 'يوق' },
  download: { zh: '下载', en: 'Download', ug: 'چۈشۈرۈش' },
  upload: { zh: '上传', en: 'Upload', ug: 'يۈكلەش' },
  nicRates: {
    zh: '{name}：下载 {rx}，上传 {tx}',
    en: '{name}: download {rx}, upload {tx}',
    ug: '{name}: چۈشۈرۈش {rx}، يۈكلەش {tx}',
  },
  clauseSep: { zh: '；', en: '; ', ug: '؛ ' },
  noNicData: { zh: '没有网卡数据', en: 'No interface data', ug: 'تور ئېغىزى سانلىق مەلۇماتى يوق' },
  latencyChart: { zh: '延迟图', en: 'Latency chart', ug: 'كېچىكىش گرافىكى' },
  latencyStats: {
    zh: '平均 {avg} · 最高 {max}',
    en: 'Average {avg} · max {max}',
    ug: 'ئوتتۇرىچە {avg} · ئەڭ يۇقىرى {max}',
  },
  latencyNow: { zh: '延迟：{value}', en: 'Latency: {value}', ug: 'كېچىكىش: {value}' },
  readingDisks: {
    zh: '正在读取磁盘信息…',
    en: 'Reading disks…',
    ug: 'دىسكا ئۇچۇرى ئوقۇلۇۋاتىدۇ…',
  },
  noDisks: { zh: '没有读取到磁盘。', en: 'No disks found.', ug: 'دىسكا ئوقۇلمىدى.' },
  available: {
    zh: '可用 {size}',
    en: '{size} available',
    ug: 'ئىشلەتكىلى بولىدىغىنى {size}',
  },
  protocol: { zh: '协议', en: 'Protocol', ug: 'كېلىشىم' },
  process: { zh: '进程', en: 'Process', ug: 'جەريان' },
  portCount: { zh: '{n} 个', en: '{n}', ug: '{n}' },
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
  rootForNames: {
    zh: '部分进程名需要以 root 登录才能看到。',
    en: 'Some process names are only visible when logged in as root.',
    ug: 'بەزى جەريان ناملىرىنى root بولۇپ كىرگەندىلا كۆرگىلى بولىدۇ.',
  },
})

const PROCESS_ROWS = 20
const PORT_ROWS = 100

export interface Widget {
  readonly id: WidgetId
  readonly element: HTMLElement
  readonly splitter: HTMLElement
  /** `detail` is the panel's 详细 mode, which adds rows and columns. */
  update(track: Track, snap: StatusSnapshot, detail: boolean): void
  /** Repaints charts after the view was hidden. */
  paint?(): void
}

export type Report = (error: unknown) => void

function section(
  id: WidgetId,
  ...extra: Node[]
): { root: HTMLElement; body: HTMLElement; splitter: HTMLElement } {
  const title = WIDGET_NAMES[id]
  const body = h('div', { class: 'gx-widget-body', id: uniqueId('widget-body') })
  const chevron = icon('caret-down')
  chevron.classList.add('gx-widget-toggle-icon')
  const toggle = h(
    'button',
    {
      class: 'gx-widget-toggle',
      type: 'button',
      'aria-expanded': 'true',
      'aria-controls': body.id,
    },
    chevron,
    h('span', { text: title }),
  )
  const splitter = h('div', {
    class: 'gx-widget-splitter',
    role: 'separator',
    'aria-orientation': 'horizontal',
    'aria-label': t('resizeWidget', { title }),
    tabindex: 0,
  })
  const root = h(
    'section',
    { class: 'gx-widget', 'data-widget': id, 'aria-label': title },
    h(
      'header',
      { class: 'gx-widget-head' },
      h('h3', { class: 'gx-widget-title' }, toggle),
      ...extra,
    ),
    h('div', { class: 'gx-widget-body-wrap' }, body),
    splitter,
  )
  toggle.addEventListener('click', () => {
    const collapsed = root.classList.toggle('collapsed')
    toggle.setAttribute('aria-expanded', String(!collapsed))
  })
  return { root, body, splitter }
}

/** A small figure shown at the end of a widget's header. */
function meta(): HTMLElement {
  return h('span', { class: 'gx-widget-meta num' })
}

export function formatMs(ms: number): string {
  return `${ms < 10 ? ms.toFixed(1) : Math.round(ms)} ms`
}

export interface Fact {
  dt: HTMLElement
  dd: HTMLElement
}

export function fact(label: string, dd: HTMLElement = h('dd', { class: 'cell-text' })): Fact {
  return { dt: h('dt', { text: label }), dd }
}

/** Shows the row only when there is something to say. */
export function setFact(row: Fact, text: string): void {
  row.dd.textContent = text
  row.dd.title = text
  row.dt.hidden = text === ''
  row.dd.hidden = text === ''
}

export function cpuText(system: SystemInfo): string {
  const cores = system.cpuCores > 0 ? t('cores', { n: system.cpuCores }) : ''
  return [system.cpuModel, cores].filter(Boolean).join(' · ')
}

function infoWidget(report: Report): Widget {
  const { root, body, splitter } = section('info')
  const address = h('span', { class: 'mono cell-text' })
  const copy = h(
    'button',
    {
      type: 'button',
      class: 'icon-button status-copy',
      title: t('copyIp'),
      'aria-label': t('copyIp'),
      onclick: () => {
        if (address.textContent) copyText(address.textContent).catch(report)
      },
    },
    icon('copy'),
  )
  const host = fact(common('host'))
  const ip = fact(common('address'), h('dd', { class: 'status-ip' }, address, copy))
  const os = fact(t('system'))
  const kernel = fact(t('kernel'))
  const cpu = fact('CPU')
  const uptime = fact(t('uptime'))
  const load = fact(t('load'), h('dd', { class: 'num', title: t('loadTitle') }))
  const rows = [host, ip, os, kernel, cpu, uptime, load]
  body.append(
    h(
      'dl',
      { class: 'status-facts' },
      rows.flatMap((row) => [row.dt, row.dd]),
    ),
  )
  return {
    id: 'info',
    element: root,
    splitter,
    update(track, snap, detail) {
      const system = track.system
      setFact(host, system?.hostname ?? '')
      address.textContent = snap.address
      ip.dt.hidden = !snap.address
      ip.dd.hidden = !snap.address
      setFact(os, system ? [system.os, system.arch].filter(Boolean).join(' · ') : '')
      setFact(kernel, detail ? (system?.kernel ?? '') : '')
      setFact(cpu, detail && system ? cpuText(system) : '')
      setFact(uptime, formatUptime(snap.uptimeSecs))
      load.dd.textContent = snap.load.map((v) => v.toFixed(2)).join('   ')
    },
  }
}

export interface Meter {
  row: HTMLElement
  /** `fraction` null leaves the bar empty; `value` is the figure, `detail` the context before it. */
  set(fraction: number | null, value: string, detail: string): void
}

export function meter(label: string, labelClass = ''): Meter {
  const fill = h('span', { class: 'meter-fill' })
  const bar = h(
    'span',
    {
      class: 'meter',
      role: 'meter',
      'aria-valuemin': '0',
      'aria-valuemax': '100',
      'aria-label': label,
    },
    fill,
  )
  const detail = h('span', { class: 'meter-detail num' })
  const value = h('span', { class: 'meter-value num' })
  const row = h(
    'div',
    { class: 'meter-row' },
    h(
      'div',
      { class: 'meter-head' },
      h('span', { class: `meter-label ${labelClass}`.trim(), text: label, title: label }),
      detail,
      value,
    ),
    bar,
  )
  return {
    row,
    set(fraction, text, context) {
      const f = fraction === null ? 0 : Math.max(0, Math.min(1, fraction))
      fill.style.setProperty('--value', String(f))
      bar.dataset.level = meterLevel(f)
      bar.setAttribute('aria-valuenow', String(Math.round(f * 100)))
      bar.setAttribute(
        'aria-valuetext',
        text && context ? t('valueDetail', { value: text, detail: context }) : text || context,
      )
      detail.textContent = context
      value.textContent = text
    },
  }
}

export function share(used: number, total: number): number | null {
  return total > 0 ? used / total : null
}

export function sharePercent(used: number, total: number): string {
  return total > 0 ? formatPercent((used / total) * 100) : '—'
}

function resourcesWidget(): Widget {
  const { root, body, splitter } = section('resources')
  const cpu = meter('CPU')
  const mem = meter(t('memory'))
  const swap = meter(t('swap'))
  body.append(h('div', { class: 'status-meters' }, cpu.row, mem.row, swap.row))
  return {
    id: 'resources',
    element: root,
    splitter,
    update(track, snap) {
      const cores =
        track.system && track.system.cpuCores > 0 ? t('cores', { n: track.system.cpuCores }) : ''
      cpu.set(
        snap.cpuPercent === null ? null : snap.cpuPercent / 100,
        formatPercent(snap.cpuPercent),
        cores,
      )
      const { mem: m, swap: s } = snap
      mem.set(
        share(m.used, m.total),
        sharePercent(m.used, m.total),
        ltr(`${formatBytes(m.used)} / ${formatBytes(m.total)}`),
      )
      if (s.total > 0) {
        swap.set(
          share(s.used, s.total),
          sharePercent(s.used, s.total),
          ltr(`${formatBytes(s.used)} / ${formatBytes(s.total)}`),
        )
      } else swap.set(null, '', t('swapOff'))
    },
  }
}

type ProcessSort = Extract<ProcessKey, 'pid' | 'name' | 'cpu' | 'mem'>

const ASCENDING: ReadonlySet<ProcessSort> = new Set(['pid', 'name'])

function processTitle(p: ProcessInfo): string {
  const facts = [`PID ${p.pid}`, t('parentPid', { pid: p.ppid })]
  if (p.state) facts.push(t('processState', { state: p.state }))
  if (p.threads > 0) facts.push(t('threads', { n: p.threads }))
  return `${p.name}\n${facts.join(' · ')}\n${t('processHint')}`
}

function processesWidget(report: Report): Widget {
  const { root, body, splitter } = section('processes')
  let sort: ProcessSort = 'cpu'
  let detail = false
  let sessionId: number | null = null
  let processes: ProcessInfo[] = []
  const tbody = h('tbody')
  const columns: [ProcessSort, string, string][] = [
    ['pid', 'PID', 'num col-pid'],
    ['name', t('command'), 'col-name'],
    ['cpu', 'CPU', 'num col-cpu'],
    ['mem', t('memory'), 'num col-mem'],
  ]
  const ths = columns.map(([key, label, cls]) =>
    h(
      'th',
      { scope: 'col', class: cls, 'data-key': key },
      h('button', {
        type: 'button',
        class: 'sort-button',
        text: label,
        onclick: () => {
          sort = key
          render()
        },
      }),
    ),
  )
  body.append(
    h(
      'div',
      { class: 'table-wrap' },
      h('table', { class: 'data-table' }, h('thead', {}, h('tr', {}, ths)), tbody),
    ),
  )

  const signal = async (id: number, p: ProcessInfo, sig: number, name: string) => {
    const ok = await confirmDialog(
      t('endTitle'),
      t('sendSignal', { name: p.name, pid: p.pid, signal: name }),
      sig === 9 ? t('forceKill') : t('end'),
      true,
    )
    if (ok) await invoke('process_kill', { sessionId: id, pid: p.pid, signal: sig })
  }
  const renice = async (id: number, p: ProcessInfo) => {
    const value = await promptDialog(
      t('reniceTitle'),
      t('reniceLabel', { name: p.name, pid: p.pid, min: ltr('-20') }),
      '0',
      t('apply'),
      validNice,
    )
    if (value === null) return
    await invoke('process_renice', { sessionId: id, pid: p.pid, priority: Number(value.trim()) })
  }

  tbody.addEventListener('contextmenu', (event) => {
    const row = event.target instanceof Element ? event.target.closest('tr') : null
    const pid = Number(row?.dataset.pid)
    const p = processes.find((x) => x.pid === pid)
    const id = sessionId
    if (!p || id === null) return
    event.preventDefault()
    showMenu(event.clientX, event.clientY, [
      { label: t('menuTerm'), action: () => signal(id, p, 15, 'SIGTERM').catch(report) },
      {
        label: t('menuKill'),
        danger: true,
        action: () => signal(id, p, 9, 'SIGKILL').catch(report),
      },
      'separator',
      { label: t('menuRenice'), action: () => renice(id, p).catch(report) },
      { label: t('copyPid'), action: () => copyText(String(p.pid)).catch(report) },
      { label: t('copyName'), action: () => copyText(p.name).catch(report) },
    ])
  })

  const render = () => {
    if (!detail && sort === 'pid') sort = 'cpu'
    for (const th of ths) {
      th.hidden = th.dataset.key === 'pid' && !detail
      if (th.dataset.key === sort)
        th.setAttribute('aria-sort', ASCENDING.has(sort) ? 'ascending' : 'descending')
      else th.removeAttribute('aria-sort')
    }
    tbody.replaceChildren(
      ...sortProcesses(processes, sort)
        .slice(0, PROCESS_ROWS)
        .map((p) =>
          h(
            'tr',
            { title: processTitle(p), 'data-pid': p.pid },
            h('td', { class: 'num', text: p.pid, hidden: !detail }),
            h('td', { class: 'cell-text', text: p.name }),
            h('td', { class: 'num', text: formatPercent(p.cpuPercent) }),
            h('td', { class: 'num', text: ltr(formatBytes(p.memBytes)) }),
          ),
        ),
    )
  }
  render()
  return {
    id: 'processes',
    element: root,
    splitter,
    update(track, snap, isDetail) {
      sessionId = track.id
      processes = snap.processes
      detail = isDetail
      render()
    },
  }
}

/** Download and upload colours per chosen interface, as CSS custom property names. */
export const NIC_COLORS: [string, string][] = [
  ['--gx-chart-rx', '--gx-chart-tx'],
  ['--gx-blue-400', '--gx-purple-400'],
  ['--gx-green-400', '--gx-amber-400'],
  ['--gx-chart-latency', '--gx-red-400'],
  ['--gx-purple-500', '--gx-blue-500'],
]

export function rate(
  value: number | null | undefined,
  arrow: string,
  color: string,
  label: string,
) {
  const span = h('span', {
    class: 'net-rate num',
    text: `${arrow} ${ltr(formatRate(value ?? null))}`,
    title: label,
  })
  span.style.setProperty('--rate-color', `var(${color})`)
  return span
}

function networkWidget(report: Report): Widget {
  const { root, body, splitter } = section('network')
  const chosenText = h('span', { class: 'status-picker-value mono' })
  const chevron = icon('caret-down')
  chevron.classList.add('status-picker-icon')
  const options = h('div', {
    class: 'status-picker-options',
    role: 'group',
    'aria-label': t('interfacesShown', { n: MAX_INTERFACES }),
  })
  const picker = h(
    'details',
    { class: 'status-picker' },
    h(
      'summary',
      { class: 'status-picker-summary', title: t('chooseInterfaces', { n: MAX_INTERFACES }) },
      h('span', { class: 'status-picker-label', text: t('interfaces') }),
      chosenText,
      chevron,
    ),
    options,
  )
  const legend = h('div', { class: 'net-legend' })
  const chart = new Chart(t('trafficChart'))
  body.append(picker, legend, chart.element)

  let names = ''
  let chosen: string[] = []
  const boxes = new Map<string, HTMLInputElement>()

  options.addEventListener('change', (event) => {
    const box = event.target as HTMLInputElement
    const next = chosen.filter((name) => name !== box.value)
    if (box.checked) next.push(box.value)
    updateSettings((draft) => {
      draft.status.selectedInterfaces = next.slice(0, MAX_INTERFACES)
    }).catch(report)
  })

  return {
    id: 'network',
    element: root,
    splitter,
    update(track, snap) {
      chosen = chosenInterfaces(settings().status.selectedInterfaces, snap)
      const list = snap.net.map((n) => n.name)
      // Rebuilt only when the server's interfaces change, so a focused checkbox survives polls.
      if (list.join('\n') !== names) {
        names = list.join('\n')
        boxes.clear()
        options.replaceChildren(
          ...list.map((name) => {
            const box = h('input', { type: 'checkbox', value: name })
            boxes.set(name, box)
            return h(
              'label',
              { class: 'check status-picker-option' },
              box,
              h('span', { class: 'mono', text: name }),
            )
          }),
        )
      }
      const full = chosen.length >= MAX_INTERFACES
      for (const [name, box] of boxes) {
        box.checked = chosen.includes(name)
        // The last one stays: with nothing chosen the busiest interface would come back anyway.
        box.disabled = box.checked ? chosen.length === 1 : full
      }
      chosenText.textContent = joinList(chosen) || t('none')

      const series: { values: readonly Sample[]; color: string; fill?: boolean }[] = []
      const rows: HTMLElement[] = []
      const described: string[] = []
      chosen.forEach((name, index) => {
        const [rx, tx] = NIC_COLORS[index]
        const history = track.net.get(name)
        if (history)
          series.push(
            { values: history.rx, color: rx, fill: true },
            { values: history.tx, color: tx },
          )
        const now = snap.net.find((n) => n.name === name)
        rows.push(
          h(
            'div',
            { class: 'net-legend-row' },
            h('span', { class: 'net-legend-name mono cell-text', text: name, title: name }),
            rate(now?.rxRate, '↓', rx, t('download')),
            rate(now?.txRate, '↑', tx, t('upload')),
          ),
        )
        described.push(
          t('nicRates', {
            name: ltr(name),
            rx: ltr(formatRate(now?.rxRate ?? null)),
            tx: ltr(formatRate(now?.txRate ?? null)),
          }),
        )
      })
      legend.replaceChildren(...rows)
      const max = niceMax(Math.max(seriesMax(series), 1024), true)
      chart.update(series, max, formatRate(max), described.join(t('clauseSep')) || t('noNicData'))
    },
    paint: () => chart.paint(),
  }
}

function latencyWidget(): Widget {
  const value = meta()
  const { root, body, splitter } = section('latency', value)
  const chart = new Chart(t('latencyChart'))
  const note = h('p', { class: 'status-note num' })
  body.append(chart.element, note)
  return {
    id: 'latency',
    element: root,
    splitter,
    update(track, snap) {
      const ms = snap.latencyMs
      const now = ms === null ? '—' : formatMs(ms)
      value.textContent = ltr(now)
      const samples = track.latency.filter((v): v is number => v !== null)
      const peak = Math.max(0, ...samples)
      note.textContent =
        samples.length > 0
          ? t('latencyStats', {
              avg: ltr(formatMs(samples.reduce((a, b) => a + b, 0) / samples.length)),
              max: ltr(formatMs(peak)),
            })
          : ''
      const series = [{ values: track.latency, color: '--gx-chart-latency', fill: true }]
      const max = niceMax(Math.max(peak, 10))
      chart.update(series, max, `${max} ms`, t('latencyNow', { value: ltr(now) }))
    },
    paint: () => chart.paint(),
  }
}

function disksWidget(): Widget {
  const { root, body, splitter } = section('disks')
  const list = h('div', { class: 'status-meters' })
  const note = h('p', { class: 'help' })
  body.append(list, note)
  let shown: Disk[] | null = null
  return {
    id: 'disks',
    element: root,
    splitter,
    update(track) {
      const disks = track.disks
      note.textContent = disks === null ? t('readingDisks') : t('noDisks')
      note.hidden = disks !== null && disks.length > 0
      // Disks arrive every few polls; the same array means nothing changed.
      if (disks === shown) return
      shown = disks
      list.replaceChildren(
        ...(disks ?? []).map((d) => {
          const used = Math.max(0, d.total - d.avail)
          const m = meter(d.mount, 'mono')
          m.row.title = `${d.mount}\n${d.filesystem}\n${t('available', { size: ltr(formatBytes(d.avail)) })}`
          m.set(
            share(used, d.total),
            sharePercent(used, d.total),
            ltr(`${formatBytes(used)} / ${formatBytes(d.total)}`),
          )
          return m.row
        }),
      )
    },
  }
}

export function portOf(address: string): number {
  return Number(address.slice(address.lastIndexOf(':') + 1)) || 0
}

export function sortPorts(list: NetworkConnection[]): NetworkConnection[] {
  return [...list].sort(
    (a, b) => portOf(a.localAddr) - portOf(b.localAddr) || a.proto.localeCompare(b.proto),
  )
}

function portsWidget(): Widget {
  const count = meta()
  const { root, body, splitter } = section('connections', count)
  const tbody = h('tbody')
  const note = h('p', { class: 'help' })
  body.append(
    h(
      'div',
      { class: 'table-wrap' },
      h(
        'table',
        { class: 'data-table status-ports' },
        h(
          'thead',
          {},
          h(
            'tr',
            {},
            h('th', { scope: 'col', class: 'col-proto', text: t('protocol') }),
            h('th', { scope: 'col', text: common('address') }),
            h('th', { scope: 'col', class: 'col-program', text: t('process') }),
          ),
        ),
        tbody,
      ),
    ),
    note,
  )
  return {
    id: 'connections',
    element: root,
    splitter,
    update(_track, snap) {
      const ports = snap.connections
      count.textContent = ports ? t('portCount', { n: ports.length }) : ''
      const hiddenNames = ports?.some((c) => !c.program) ?? false
      note.textContent =
        ports === null ? t('readingPorts') : ports.length === 0 ? t('noPorts') : t('rootForNames')
      note.hidden = ports !== null && ports.length > 0 && !hiddenNames
      tbody.replaceChildren(
        ...sortPorts(ports ?? [])
          .slice(0, PORT_ROWS)
          .map((c) =>
            h(
              'tr',
              { title: [c.proto, c.localAddr, c.state].filter(Boolean).join(' ') },
              h('td', { class: 'cell-text', text: c.proto }),
              h('td', { class: 'cell-text mono', text: c.localAddr }),
              h('td', {
                class: 'cell-text',
                text: c.program || '—',
                title: c.pid === null ? null : `PID ${c.pid}`,
              }),
            ),
          ),
      )
    },
  }
}

export function createWidgets(report: Report): Record<WidgetId, Widget> {
  return {
    info: infoWidget(report),
    resources: resourcesWidget(),
    processes: processesWidget(report),
    network: networkWidget(report),
    latency: latencyWidget(),
    disks: disksWidget(),
    connections: portsWidget(),
  }
}
