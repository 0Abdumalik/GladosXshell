import { invoke } from '@tauri-apps/api/core'
import { writeText } from '@tauri-apps/plugin-clipboard-manager'
import { button, modal } from '../../dialogs'
import { h } from '../../dom'
import { ltr, messages } from '../../i18n'
import { common } from '../../i18n-common'
import { icon } from '../../icons'
import type { PanelHost } from '../../layout'
import type { MenuItem } from '../../menu'
import { describeError } from '../../protocol'
import {
  activeSession,
  activeTerminal,
  onActive,
  onConnected,
  onEnded,
  type SessionInfo,
} from '../../sessions'
import type { BuiltinPlugin, PluginContext } from '../api'
import {
  type ContainerRequest,
  type DockerAction,
  type DockerContainer,
  dockerActions,
  dockerFollowCommand,
  dockerShellCommand,
  explainError,
  formatAge,
  kubeFollowCommand,
  kubeShellCommand,
  type Pod,
  parseDockerList,
  parseNamespaces,
  parsePods,
  parseProbe,
  type Tools,
} from './containers-model'
import { BUILTIN_VERSION } from './version'

const t = messages({
  name: { zh: 'Docker 与 Kubernetes', en: 'Docker and Kubernetes', ug: 'Docker ۋە Kubernetes' },
  description: {
    zh: '在底部“{panel}”面板里查看当前 SSH 服务器上的 Docker 容器和 Kubernetes Pod：启动、停止、删除，查看日志和详细信息，进入容器终端。',
    en: 'See the Docker containers and Kubernetes pods on the current SSH server in the bottom {panel} panel: start, stop and delete them, read their logs and details, and open a shell inside.',
    ug: 'ئاستىدىكى «{panel}» تاختىسىدا نۆۋەتتىكى SSH مۇلازىمېتىرىدىكى Docker قاچىلىرى ۋە Kubernetes Pod لىرىنى كۆرۈش: قوزغىتىش، توختىتىش، ئۆچۈرۈش، خاتىرە ۋە تەپسىلىي ئۇچۇرنى كۆرۈش، قاچا تېرمىنالىغا كىرىش.',
  },
  panel: { zh: '容器', en: 'Containers', ug: 'قاچىلار' },
  panelFor: { zh: '{title} 的容器', en: 'Containers on {title}', ug: '{title} دىكى قاچىلار' },
  start: { zh: '启动', en: 'Start', ug: 'قوزغات' },
  restart: { zh: '重启', en: 'Restart', ug: 'قايتا قوزغات' },
  pause: { zh: '暂停', en: 'Pause', ug: 'ۋاقتىنچە توختات' },
  unpause: { zh: '恢复', en: 'Resume', ug: 'داۋاملاشتۇر' },
  startBusy: {
    zh: '正在启动容器 {name}…',
    en: 'Starting container {name}…',
    ug: '{name} قاچىسى قوزغىتىلىۋاتىدۇ…',
  },
  startDone: {
    zh: '已启动容器 {name}',
    en: 'Started container {name}',
    ug: '{name} قاچىسى قوزغىتىلدى',
  },
  startFailed: {
    zh: '启动容器 {name} 失败：{error}',
    en: "Couldn't start container {name}: {error}",
    ug: '{name} قاچىسىنى قوزغىتىش مەغلۇپ بولدى: {error}',
  },
  stopBusy: {
    zh: '正在停止容器 {name}…',
    en: 'Stopping container {name}…',
    ug: '{name} قاچىسى توختىتىلىۋاتىدۇ…',
  },
  stopDone: {
    zh: '已停止容器 {name}',
    en: 'Stopped container {name}',
    ug: '{name} قاچىسى توختىتىلدى',
  },
  stopFailed: {
    zh: '停止容器 {name} 失败：{error}',
    en: "Couldn't stop container {name}: {error}",
    ug: '{name} قاچىسىنى توختىتىش مەغلۇپ بولدى: {error}',
  },
  restartBusy: {
    zh: '正在重启容器 {name}…',
    en: 'Restarting container {name}…',
    ug: '{name} قاچىسى قايتا قوزغىتىلىۋاتىدۇ…',
  },
  restartDone: {
    zh: '已重启容器 {name}',
    en: 'Restarted container {name}',
    ug: '{name} قاچىسى قايتا قوزغىتىلدى',
  },
  restartFailed: {
    zh: '重启容器 {name} 失败：{error}',
    en: "Couldn't restart container {name}: {error}",
    ug: '{name} قاچىسىنى قايتا قوزغىتىش مەغلۇپ بولدى: {error}',
  },
  pauseBusy: {
    zh: '正在暂停容器 {name}…',
    en: 'Pausing container {name}…',
    ug: '{name} قاچىسى ۋاقتىنچە توختىتىلىۋاتىدۇ…',
  },
  pauseDone: {
    zh: '已暂停容器 {name}',
    en: 'Paused container {name}',
    ug: '{name} قاچىسى ۋاقتىنچە توختىتىلدى',
  },
  pauseFailed: {
    zh: '暂停容器 {name} 失败：{error}',
    en: "Couldn't pause container {name}: {error}",
    ug: '{name} قاچىسىنى ۋاقتىنچە توختىتىش مەغلۇپ بولدى: {error}',
  },
  unpauseBusy: {
    zh: '正在恢复容器 {name}…',
    en: 'Resuming container {name}…',
    ug: '{name} قاچىسى داۋاملاشتۇرۇلۇۋاتىدۇ…',
  },
  unpauseDone: {
    zh: '已恢复容器 {name}',
    en: 'Resumed container {name}',
    ug: '{name} قاچىسى داۋاملاشتۇرۇلدى',
  },
  unpauseFailed: {
    zh: '恢复容器 {name} 失败：{error}',
    en: "Couldn't resume container {name}: {error}",
    ug: '{name} قاچىسىنى داۋاملاشتۇرۇش مەغلۇپ بولدى: {error}',
  },
  rmBusy: {
    zh: '正在删除容器 {name}…',
    en: 'Deleting container {name}…',
    ug: '{name} قاچىسى ئۆچۈرۈلۈۋاتىدۇ…',
  },
  rmDone: {
    zh: '已删除容器 {name}',
    en: 'Deleted container {name}',
    ug: '{name} قاچىسى ئۆچۈرۈلدى',
  },
  rmFailed: {
    zh: '删除容器 {name} 失败：{error}',
    en: "Couldn't delete container {name}: {error}",
    ug: '{name} قاچىسىنى ئۆچۈرۈش مەغلۇپ بولدى: {error}',
  },
  running: { zh: '运行中', en: 'Running', ug: 'ئىجرا بولۇۋاتىدۇ' },
  paused: { zh: '已暂停', en: 'Paused', ug: 'ۋاقتىنچە توختىتىلغان' },
  restarting: { zh: '重启中', en: 'Restarting', ug: 'قايتا قوزغىلىۋاتىدۇ' },
  exited: { zh: '已退出', en: 'Exited', ug: 'چېكىنگەن' },
  created: { zh: '已创建', en: 'Created', ug: 'قۇرۇلغان' },
  dead: { zh: '已失效', en: 'Dead', ug: 'ئۆلۈك' },
  truncated: {
    zh: '输出超过 {size}，后面的部分没有显示。',
    en: 'The output is over {size}; the rest is not shown.',
    ug: 'چىقىرىش {size} دىن ئېشىپ كەتتى، قالغان قىسمى كۆرسىتىلمىدى.',
  },
  tailLabel: { zh: '显示的行数', en: 'Lines to show', ug: 'كۆرسىتىلىدىغان قۇر سانى' },
  tailOption: { zh: '最近 {n} 行', en: 'Last {n} lines', ug: 'ئاخىرقى {n} قۇر' },
  loading: { zh: '正在读取…', en: 'Loading…', ug: 'ئوقۇۋاتىدۇ…' },
  noOutput: { zh: '（没有输出）', en: '(no output)', ug: '(چىقىرىش يوق)' },
  follow: { zh: '在终端里持续跟踪', en: 'Follow in terminal', ug: 'تېرمىنالدا ئىز قوغلا' },
  platform: { zh: '容器类型', en: 'Container platform', ug: 'قاچا تىپى' },
  namespace: { zh: '命名空间', en: 'Namespace', ug: 'نام بوشلۇقى' },
  allNamespaces: { zh: '全部命名空间', en: 'All namespaces', ug: 'بارلىق نام بوشلۇقلىرى' },
  terminalOffline: {
    zh: '终端未连接，无法执行。',
    en: "Can't run it: the terminal is not connected.",
    ug: 'تېرمىنال ئۇلانمىغان، ئىجرا قىلغىلى بولمايدۇ.',
  },
  deleteContainer: { zh: '删除容器', en: 'Delete container', ug: 'قاچىنى ئۆچۈر' },
  deleteContainerText: {
    zh: '删除容器「{name}」？容器里没有挂载出去的数据会一起删除。',
    en: 'Delete container "{name}"? Data in the container that is not on a mounted volume is deleted with it.',
    ug: '«{name}» قاچىسىنى ئۆچۈرەمسىز؟ قاچىدىكى سىرتقا ئېگەرلەنمىگەن سانلىق مەلۇماتلارمۇ بىللە ئۆچۈرۈلىدۇ.',
  },
  logsOf: { zh: '日志：{name}', en: 'Logs: {name}', ug: 'خاتىرە: {name}' },
  detailsOf: { zh: '详细信息：{name}', en: 'Details: {name}', ug: 'تەپسىلىي ئۇچۇر: {name}' },
  openShell: { zh: '进入容器终端', en: 'Open shell', ug: 'قاچا تېرمىنالىغا كىر' },
  viewLogs: { zh: '查看日志', en: 'View logs', ug: 'خاتىرىنى كۆر' },
  followLogs: {
    zh: '在终端里持续跟踪日志',
    en: 'Follow logs in terminal',
    ug: 'تېرمىنالدا خاتىرىنى ئىز قوغلا',
  },
  details: { zh: '详细信息', en: 'Details', ug: 'تەپسىلىي ئۇچۇر' },
  image: { zh: '镜像', en: 'Image', ug: 'تەسۋىر' },
  status: { zh: '状态', en: 'Status', ug: 'ھالىتى' },
  ports: { zh: '端口', en: 'Ports', ug: 'ئېغىز' },
  createdColumn: { zh: '创建', en: 'Created', ug: 'قۇرۇلغان ۋاقتى' },
  noContainers: {
    zh: '这台服务器上还没有容器。',
    en: 'No containers on this server yet.',
    ug: 'بۇ مۇلازىمېتىردا تېخى قاچا يوق.',
  },
  pickContainer: {
    zh: '选择 {pod} 里的容器',
    en: 'Choose a container in {pod}',
    ug: '{pod} دىكى قاچىنى تاللاڭ',
  },
  deletePod: { zh: '删除 Pod', en: 'Delete pod', ug: 'Pod نى ئۆچۈر' },
  deletePodText: {
    zh: '删除 {namespace} 里的 Pod「{name}」？由 Deployment 等控制器管理的 Pod 会被重新创建。',
    en: 'Delete pod "{name}" in {namespace}? Pods managed by a controller such as a Deployment are created again.',
    ug: '{namespace} دىكى «{name}» Pod نى ئۆچۈرەمسىز؟ Deployment قاتارلىق كونتروللىغۇچ باشقۇرىدىغان Pod لار قايتا قۇرۇلىدۇ.',
  },
  podDeleted: { zh: '已删除 Pod {name}', en: 'Deleted pod {name}', ug: 'Pod {name} ئۆچۈرۈلدى' },
  podDeleteFailed: {
    zh: '删除 Pod {name} 失败：{error}',
    en: "Couldn't delete pod {name}: {error}",
    ug: 'Pod {name} نى ئۆچۈرۈش مەغلۇپ بولدى: {error}',
  },
  ready: { zh: '就绪', en: 'Ready', ug: 'تەييار' },
  restarts: { zh: '重启', en: 'Restarts', ug: 'قايتا قوزغىلىش' },
  age: { zh: '存在', en: 'Age', ug: 'مەۋجۇت ۋاقتى' },
  node: { zh: '节点', en: 'Node', ug: 'تۈگۈن' },
  noPodsCluster: {
    zh: '集群里还没有 Pod。',
    en: 'No pods in the cluster yet.',
    ug: 'كلاستېردا تېخى Pod يوق.',
  },
  noPodsNamespace: {
    zh: '这个命名空间里还没有 Pod。',
    en: 'No pods in this namespace yet.',
    ug: 'بۇ نام بوشلۇقىدا تېخى Pod يوق.',
  },
  actions: { zh: '操作', en: 'Actions', ug: 'مەشغۇلات' },
  actionsFor: { zh: '{name} 的操作', en: 'Actions for {name}', ug: '{name} نىڭ مەشغۇلاتلىرى' },
  noTools: {
    zh: '这台服务器上没有找到 docker 或 kubectl 命令。',
    en: 'This server has no docker or kubectl command.',
    ug: 'بۇ مۇلازىمېتىردا docker ياكى kubectl بۇيرۇقى تېپىلمىدى.',
  },
  notConnected: {
    zh: '会话未连接。连接成功后可以在这里查看 Docker 容器和 Kubernetes Pod。',
    en: 'The session is not connected. Once it connects, you can see Docker containers and Kubernetes pods here.',
    ug: 'ئەڭگىمە ئۇلانمىغان. ئۇلانغاندىن كېيىن بۇ يەردە Docker قاچىلىرى ۋە Kubernetes Pod لىرىنى كۆرەلەيسىز.',
  },
  noSsh: {
    zh: '切换到一个已连接的 SSH 会话后，可以在这里查看 Docker 容器和 Kubernetes Pod。',
    en: 'Switch to a connected SSH session to see Docker containers and Kubernetes pods here.',
    ug: 'ئۇلانغان SSH ئەڭگىمىسىگە ئالماشقاندىن كېيىن، بۇ يەردە Docker قاچىلىرى ۋە Kubernetes Pod لىرىنى كۆرەلەيسىز.',
  },
})

const POLL_MS = 5000
const LOG_TAILS = [200, 1000, 5000]
const FOLLOW_TAIL = 200

type View = 'docker' | 'kube'

interface Output {
  text: string
  truncated: boolean
}

const run = (sessionId: number, request: ContainerRequest) =>
  invoke<Output>('containers_run', { sessionId, request })

const errorText = (error: unknown) => explainError(describeError(error))

const ACTION_LABEL: Record<DockerAction, string> = {
  start: t('start'),
  stop: common('stop'),
  restart: t('restart'),
  pause: t('pause'),
  unpause: t('unpause'),
  rm: common('delete'),
}
const ACTION_ICON: Record<DockerAction, string> = {
  start: 'play',
  stop: 'stop',
  restart: 'arrows-clockwise',
  pause: 'pause',
  unpause: 'play',
  rm: 'trash',
}
const STATE_LABEL: Record<string, string> = {
  running: t('running'),
  paused: t('paused'),
  restarting: t('restarting'),
  exited: t('exited'),
  created: t('created'),
  dead: t('dead'),
}

/** Logs, inspect and describe output in a dialog; `follow` adds a tail picker and a terminal hand-off. */
function textViewer(
  title: string,
  load: (tail: number) => Promise<Output>,
  follow?: (tail: number) => void,
): void {
  const parts = modal('container-text', title, 'xl')
  const pre = h('pre', { class: 'ctr-text', tabindex: '0', 'aria-label': title })
  const note = h('p', {
    class: 'help',
    hidden: true,
    text: t('truncated', { size: ltr('4 MB') }),
  })
  const tail = h(
    'select',
    { 'aria-label': t('tailLabel'), hidden: !follow },
    ...LOG_TAILS.map((n) => h('option', { value: String(n), text: t('tailOption', { n }) })),
  )
  parts.body.classList.add('ctr-text-body')
  parts.body.append(pre, note)

  let token = 0
  const refresh = async () => {
    const mine = ++token
    pre.textContent = t('loading')
    note.hidden = true
    try {
      const out = await load(Number(tail.value))
      if (mine !== token) return
      pre.textContent = out.text || t('noOutput')
      note.hidden = !out.truncated
      pre.scrollTop = follow ? pre.scrollHeight : 0
    } catch (error) {
      if (mine !== token) return
      pre.textContent = errorText(error)
    }
  }
  tail.onchange = () => void refresh()

  const followButton = button(t('follow'), () => {
    follow?.(FOLLOW_TAIL)
    parts.dialog.close()
  })
  followButton.hidden = !follow
  parts.actions.append(
    tail,
    followButton,
    button(common('copy'), () => void writeText(pre.textContent ?? '')),
    button(common('refresh'), () => void refresh()),
    button(common('close'), () => parts.dialog.close(), 'primary'),
  )
  parts.dialog.addEventListener('close', () => parts.dialog.remove())
  parts.dialog.showModal()
  pre.focus()
  void refresh()
}

function liveSsh(info: SessionInfo | null): number | null {
  return info?.kind === 'ssh' && info.state === 'live' ? info.id : null
}

function cell(text: string, className?: string): HTMLTableCellElement {
  return h('td', { class: className, text, title: text })
}

function headRow(columns: [string, string][]): HTMLTableSectionElement {
  return h(
    'thead',
    {},
    h(
      'tr',
      {},
      ...columns.map(([label, className]) =>
        h('th', { class: `ctr-th ${className}`, scope: 'col', text: label }),
      ),
    ),
  )
}

function containersPanel(ctx: PluginContext, alive: () => boolean): PanelHost {
  const title = h('span', { class: 'ctr-target' })
  const tab = (label: string, value: View) =>
    h('button', {
      type: 'button',
      class: 'ctr-tab',
      text: label,
      'aria-pressed': 'false',
      onclick: () => choose(value),
    })
  const dockerTab = tab('Docker', 'docker')
  const kubeTab = tab('Kubernetes', 'kube')
  const tabs = h(
    'div',
    { class: 'ctr-tabs', role: 'group', 'aria-label': t('platform') },
    dockerTab,
    kubeTab,
  )
  const namespace = h('select', { class: 'ctr-ns', 'aria-label': t('namespace') })
  const refreshButton = h(
    'button',
    {
      type: 'button',
      class: 'icon-button',
      title: common('refresh'),
      'aria-label': common('refresh'),
      onclick: () => void refresh(true),
    },
    icon('arrows-clockwise'),
  )
  const head = h('div', { class: 'ctr-head' }, icon('cube'), title, tabs, namespace, refreshButton)
  const empty = h('p', { class: 'panel-empty' })
  const error = h('p', { class: 'panel-error ctr-error', role: 'alert', hidden: true })
  const table = h('table', { class: 'data-table ctr-table' })
  const wrap = h('div', { class: 'table-wrap ctr-wrap' }, table)
  const element = h('div', { class: 'ctr-panel' }, head, empty, error, wrap)

  let session: number | null = null
  /** Bumped on every session switch so a late reply for the old session is dropped. */
  let generation = 0
  let tools: Tools | null = null
  let view: View = ctx.storage.get<View>('view') === 'kube' ? 'kube' : 'docker'
  let busy = false
  let shown = ''

  const showEmpty = (text: string | null) => {
    empty.hidden = text === null
    empty.textContent = text ?? ''
    wrap.hidden = text !== null
  }
  const showError = (text: string | null) => {
    error.hidden = text === null
    error.textContent = text ?? ''
  }

  const typeIn = (command: string) => {
    const info = activeSession()
    const terminal = activeTerminal()
    if (info?.id !== session || !terminal?.live) {
      ctx.ui.status(t('terminalOffline'), 'error')
      return
    }
    terminal.input(`${command}\r`)
    terminal.focus()
  }

  const attempt = (fn: () => void) => {
    try {
      fn()
    } catch (e) {
      ctx.ui.status(errorText(e), 'error')
    }
  }

  // --- Docker -------------------------------------------------------------------------------

  const dockerAct = async (c: DockerContainer, action: DockerAction) => {
    const id = session
    if (id === null) return
    const name = ltr(c.name)
    if (action === 'rm') {
      const ok = await ctx.ui.confirm(
        t('deleteContainer'),
        t('deleteContainerText', { name }),
        common('delete'),
        true,
      )
      if (!ok) return
    }
    ctx.ui.status(t(`${action}Busy`, { name }))
    try {
      await run(id, { op: 'dockerAction', action, id: c.id })
      ctx.ui.status(t(`${action}Done`, { name }))
    } catch (e) {
      ctx.ui.status(t(`${action}Failed`, { name, error: errorText(e) }), 'error')
    }
    await refresh(true)
  }

  const dockerLogs = (c: DockerContainer) => {
    const id = session
    if (id === null) return
    textViewer(
      t('logsOf', { name: ltr(c.name) }),
      (tail) => run(id, { op: 'dockerLogs', id: c.id, tail }),
      (tail) => attempt(() => typeIn(dockerFollowCommand(c.id, tail))),
    )
  }

  const dockerMenu = (c: DockerContainer): MenuItem[] => {
    const id = session
    const items: MenuItem[] = []
    if (c.state === 'running') {
      items.push({
        label: t('openShell'),
        icon: 'terminal-window',
        action: () => attempt(() => typeIn(dockerShellCommand(c.id))),
      })
    }
    items.push(
      { label: t('viewLogs'), icon: 'file-text', action: () => dockerLogs(c) },
      {
        label: t('followLogs'),
        icon: 'list',
        action: () => attempt(() => typeIn(dockerFollowCommand(c.id, FOLLOW_TAIL))),
      },
      {
        label: t('details'),
        icon: 'info',
        disabled: id === null,
        action: () => {
          if (id !== null)
            textViewer(t('detailsOf', { name: ltr(c.name) }), () =>
              run(id, { op: 'dockerInspect', id: c.id }),
            )
        },
      },
      'separator',
    )
    for (const action of dockerActions(c.state)) {
      items.push({
        label: ACTION_LABEL[action],
        icon: ACTION_ICON[action],
        danger: action === 'rm',
        action: () => void dockerAct(c, action),
      })
    }
    return items
  }

  const renderDocker = (rows: DockerContainer[]) => {
    const body = h('tbody', {})
    for (const c of rows) {
      const state = h(
        'span',
        { class: 'ctr-state', 'data-state': c.state },
        STATE_LABEL[c.state] ?? c.state,
      )
      const status = h('td', { class: 'ctr-status', title: c.status }, state, ` ${c.status}`)
      body.append(
        row(c.name, dockerMenu(c), () => dockerLogs(c), [
          h('td', { class: 'ctr-name', text: c.name, title: `${c.name}\n${c.id.slice(0, 12)}` }),
          cell(c.image),
          status,
          // Docker's own text: `2 weeks ago` and `0.0.0.0:80->80/tcp` reorder in right-to-left text.
          cell(ltr(c.ports)),
          cell(ltr(c.created)),
        ]),
      )
    }
    table.replaceChildren(
      headRow([
        [common('name'), 'col-name'],
        [t('image'), 'col-image'],
        [t('status'), 'col-status'],
        [t('ports'), 'col-ports'],
        [t('createdColumn'), 'col-created'],
        ['', 'col-actions'],
      ]),
      body,
    )
    showEmpty(rows.length === 0 ? t('noContainers') : null)
  }

  // --- Kubernetes ---------------------------------------------------------------------------

  const podLogs = (p: Pod) => {
    const id = session
    if (id === null) return
    textViewer(
      t('logsOf', { name: ltr(p.name) }),
      (tail) =>
        run(id, { op: 'kubeLogs', namespace: p.namespace, pod: p.name, container: null, tail }),
      (tail) => attempt(() => typeIn(kubeFollowCommand(p.namespace, p.name, null, tail))),
    )
  }

  const podShell = async (p: Pod) => {
    let container: string | null = p.containers[0] ?? null
    if (p.containers.length > 1) {
      container = await ctx.ui.pick(
        p.containers.map((name) => ({ label: name, value: name, icon: 'cube' })),
        t('pickContainer', { pod: ltr(p.name) }),
      )
      if (container === null) return
    }
    attempt(() => typeIn(kubeShellCommand(p.namespace, p.name, container)))
  }

  const podDelete = async (p: Pod) => {
    const id = session
    if (id === null) return
    const ok = await ctx.ui.confirm(
      t('deletePod'),
      t('deletePodText', { namespace: ltr(p.namespace), name: ltr(p.name) }),
      common('delete'),
      true,
    )
    if (!ok) return
    try {
      await run(id, { op: 'kubeDelete', namespace: p.namespace, pod: p.name })
      ctx.ui.status(t('podDeleted', { name: ltr(p.name) }))
    } catch (e) {
      ctx.ui.status(t('podDeleteFailed', { name: ltr(p.name), error: errorText(e) }), 'error')
    }
    await refresh(true)
  }

  const podMenu = (p: Pod): MenuItem[] => {
    const id = session
    return [
      {
        label: t('openShell'),
        icon: 'terminal-window',
        disabled: p.status !== 'Running',
        action: () => void podShell(p),
      },
      { label: t('viewLogs'), icon: 'file-text', action: () => podLogs(p) },
      {
        label: t('followLogs'),
        icon: 'list',
        action: () =>
          attempt(() => typeIn(kubeFollowCommand(p.namespace, p.name, null, FOLLOW_TAIL))),
      },
      {
        label: t('details'),
        icon: 'info',
        action: () => {
          if (id === null) return
          textViewer(t('detailsOf', { name: ltr(p.name) }), () =>
            run(id, { op: 'kubeDescribe', namespace: p.namespace, pod: p.name }),
          )
        },
      },
      'separator',
      { label: t('deletePod'), icon: 'trash', danger: true, action: () => void podDelete(p) },
    ]
  }

  const renderPods = (pods: Pod[]) => {
    const all = namespace.value === ''
    const now = Date.now()
    const body = h('tbody', {})
    for (const p of pods) {
      const healthy = p.status === 'Running' || p.status === 'Succeeded' || p.status === 'Completed'
      const status = h(
        'td',
        { class: 'ctr-status', title: p.status },
        h('span', { class: 'ctr-state', 'data-state': healthy ? 'running' : 'exited' }, p.status),
      )
      const cells = [
        ...(all ? [cell(p.namespace)] : []),
        h('td', { class: 'ctr-name', text: p.name, title: p.name }),
        cell(p.ready, 'num'),
        status,
        cell(String(p.restarts), 'num'),
        cell(formatAge(p.created, now), 'num'),
        cell(p.node),
      ]
      body.append(row(p.name, podMenu(p), () => podLogs(p), cells))
    }
    table.replaceChildren(
      headRow([
        ...(all ? ([[t('namespace'), 'col-ns']] as [string, string][]) : []),
        [common('name'), 'col-name'],
        [t('ready'), 'col-ready num'],
        [t('status'), 'col-status'],
        [t('restarts'), 'col-restarts num'],
        [t('age'), 'col-age num'],
        [t('node'), 'col-node'],
        ['', 'col-actions'],
      ]),
      body,
    )
    showEmpty(pods.length === 0 ? (all ? t('noPodsCluster') : t('noPodsNamespace')) : null)
  }

  /** One table row with a "more" button; right-click and double-click work on the whole row. */
  function row(
    name: string,
    items: MenuItem[],
    open: () => void,
    cells: HTMLTableCellElement[],
  ): HTMLTableRowElement {
    const more = h(
      'button',
      {
        type: 'button',
        class: 'icon-button ctr-more',
        title: t('actions'),
        'aria-label': t('actionsFor', { name: ltr(name) }),
        'aria-haspopup': 'menu',
        onclick: () => {
          const rect = more.getBoundingClientRect()
          ctx.ui.menu(rect.left, rect.bottom + 2, items)
        },
      },
      icon('dots-three'),
    )
    const tr = h('tr', {}, ...cells, h('td', { class: 'ctr-actions' }, more))
    tr.addEventListener('contextmenu', (event) => {
      event.preventDefault()
      ctx.ui.menu(event.clientX, event.clientY, items)
    })
    tr.addEventListener('dblclick', open)
    return tr
  }

  // --- Loading ------------------------------------------------------------------------------

  const setTabs = () => {
    dockerTab.hidden = !tools?.docker
    kubeTab.hidden = !tools?.kubectl
    tabs.hidden = !tools || (!tools.docker && !tools.kubectl)
    dockerTab.setAttribute('aria-pressed', String(view === 'docker'))
    kubeTab.setAttribute('aria-pressed', String(view === 'kube'))
    namespace.hidden = view !== 'kube' || !tools?.kubectl
  }

  const loadNamespaces = async (id: number) => {
    const names = parseNamespaces((await run(id, { op: 'kubeNamespaces' })).text)
    const saved = namespace.value || ctx.storage.get<string>('namespace') || ''
    namespace.replaceChildren(
      h('option', { value: '', text: t('allNamespaces') }),
      ...names.map((n) => h('option', { value: n, text: n })),
    )
    namespace.value = names.includes(saved) ? saved : ''
  }

  /** `full` also re-reads the tools and namespaces; polling only re-reads the list. */
  async function refresh(full: boolean): Promise<void> {
    const id = session
    const token = generation
    if (id === null || !alive()) return
    if (busy && !full) return
    busy = true
    try {
      if (!tools || full) {
        const found = parseProbe((await run(id, { op: 'probe' })).text)
        if (token !== generation) return
        tools = found
        if (view === 'docker' && !found.docker && found.kubectl) view = 'kube'
        if (view === 'kube' && !found.kubectl && found.docker) view = 'docker'
      }
      setTabs()
      if (!tools.docker && !tools.kubectl) {
        table.replaceChildren()
        showError(null)
        showEmpty(t('noTools'))
        return
      }
      let signature: string
      if (view === 'docker') {
        const rows = parseDockerList((await run(id, { op: 'dockerList' })).text)
        if (token !== generation) return
        signature = `docker${JSON.stringify(rows)}`
        if (signature !== shown) renderDocker(rows)
      } else {
        if (full || namespace.options.length === 0) await loadNamespaces(id)
        if (token !== generation) return
        const out = await run(id, { op: 'kubePods', namespace: namespace.value || null })
        if (token !== generation) return
        const pods = parsePods(out.text)
        signature = `kube${namespace.value}${Math.floor(Date.now() / 60000)}${JSON.stringify(pods)}`
        if (signature !== shown) renderPods(pods)
      }
      shown = signature
      showError(null)
    } catch (e) {
      if (token !== generation) return
      shown = ''
      table.replaceChildren()
      showEmpty(null)
      wrap.hidden = true
      showError(errorText(e))
    } finally {
      if (token === generation) busy = false
    }
  }

  function choose(next: View): void {
    if (next === view) return
    view = next
    ctx.storage.set('view', view)
    shown = ''
    table.replaceChildren()
    setTabs()
    void refresh(false)
  }

  namespace.onchange = () => {
    ctx.storage.set('namespace', namespace.value)
    shown = ''
    void refresh(false)
  }

  const follow = () => {
    if (!alive()) return
    const info = activeSession()
    const id = liveSsh(info)
    if (id !== session) {
      session = id
      generation += 1
      busy = false
      tools = null
      shown = ''
      table.replaceChildren()
      namespace.replaceChildren()
      showError(null)
    }
    title.textContent = id === null ? t('panel') : t('panelFor', { title: ltr(info?.title ?? '') })
    setTabs()
    if (id === null) {
      showEmpty(info?.kind === 'ssh' ? t('notConnected') : t('noSsh'))
      return
    }
    void refresh(false)
  }

  onActive(follow)
  onConnected((info) => {
    if (info.key === activeSession()?.key) follow()
  })
  onEnded(() => follow())
  // Container state changes without any event; only poll while someone can see the list.
  const timer = window.setInterval(() => {
    if (session !== null && element.offsetParent !== null) void refresh(false)
  }, POLL_MS)
  ctx.subscriptions.add(() => clearInterval(timer))
  follow()
  return { element, shown: () => void refresh(false) }
}

export const containersPlugin: BuiltinPlugin = {
  manifest: {
    id: 'gx.containers',
    name: t('name'),
    version: BUILTIN_VERSION,
    description: t('description', { panel: t('panel') }),
  },
  activate(ctx) {
    let alive = true
    ctx.subscriptions.add(() => {
      alive = false
    })
    ctx.panels.register({
      id: 'containers',
      title: t('panel'),
      icon: 'cube',
      region: 'bottom',
      build: () => containersPanel(ctx, () => alive),
    })
  },
}
