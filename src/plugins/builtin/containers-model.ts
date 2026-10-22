import { ltr, messages } from '../../i18n'

const t = messages({
  dockerPermission: {
    zh: '当前用户没有权限访问 Docker。可以执行 {command}，然后重新连接。',
    en: 'The current user has no permission to use Docker. Run {command}, then reconnect.',
    ug: 'نۆۋەتتىكى ئىشلەتكۈچىنىڭ Docker نى زىيارەت قىلىش ھوقۇقى يوق. {command} نى ئىجرا قىلىپ، ئاندىن قايتا ئۇلاڭ.',
  },
  kubeConfig: {
    zh: 'kubectl 没有找到集群配置。检查 {path} 或 KUBECONFIG 环境变量。',
    en: 'kubectl found no cluster configuration. Check {path} or the KUBECONFIG environment variable.',
    ug: 'kubectl كلاستېر سەپلىمىسىنى تاپالمىدى. {path} ياكى KUBECONFIG مۇھىت ئۆزگەرگۈچىسىنى تەكشۈرۈڭ.',
  },
  badContainerName: {
    zh: '容器名称不正确：{name}',
    en: 'Invalid container name: {name}',
    ug: 'قاچا نامى توغرا ئەمەس: {name}',
  },
  badKubeName: {
    zh: 'Kubernetes 名称不正确：{name}',
    en: 'Invalid Kubernetes name: {name}',
    ug: 'Kubernetes نامى توغرا ئەمەس: {name}',
  },
})

export interface Tools {
  docker: boolean
  kubectl: boolean
}

export type DockerState =
  | 'running'
  | 'paused'
  | 'restarting'
  | 'exited'
  | 'created'
  | 'dead'
  | string

export interface DockerContainer {
  id: string
  name: string
  image: string
  command: string
  state: DockerState
  status: string
  ports: string
  created: string
}

export interface Pod {
  namespace: string
  name: string
  /** What kubectl prints in its STATUS column, e.g. CrashLoopBackOff or Terminating. */
  status: string
  ready: string
  restarts: number
  node: string
  /** Epoch milliseconds, or null when the API didn't say. */
  created: number | null
  containers: string[]
}

export type DockerAction = 'start' | 'stop' | 'restart' | 'pause' | 'unpause' | 'rm'

export type ContainerRequest =
  | { op: 'probe' }
  | { op: 'dockerList' }
  | { op: 'dockerAction'; action: DockerAction; id: string }
  | { op: 'dockerLogs'; id: string; tail: number }
  | { op: 'dockerInspect'; id: string }
  | { op: 'kubeNamespaces' }
  | { op: 'kubePods'; namespace: string | null }
  | { op: 'kubeLogs'; namespace: string; pod: string; container: string | null; tail: number }
  | { op: 'kubeDescribe'; namespace: string; pod: string }
  | { op: 'kubeDelete'; namespace: string; pod: string }

export function parseProbe(text: string): Tools {
  const yes = (name: string) => new RegExp(`^${name}=yes$`, 'm').test(text)
  return { docker: yes('docker'), kubectl: yes('kubectl') }
}

const str = (value: unknown): string => (typeof value === 'string' ? value : '')

/** `docker ps --format '{{json .}}'` prints one object per line. */
export function parseDockerList(text: string): DockerContainer[] {
  const out: DockerContainer[] = []
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    let row: Record<string, unknown>
    try {
      row = JSON.parse(line) as Record<string, unknown>
    } catch {
      continue
    }
    const id = str(row.ID)
    if (!id) continue
    const status = str(row.Status)
    out.push({
      id,
      name: str(row.Names).split(',')[0] ?? '',
      image: str(row.Image),
      command: str(row.Command).replace(/^"|"$/g, ''),
      state: str(row.State).toLowerCase() || stateFromStatus(status),
      status,
      ports: str(row.Ports),
      created: str(row.RunningFor) || str(row.CreatedAt),
    })
  }
  return out
}

/** Older Docker versions leave out State; the Status sentence starts with it. */
function stateFromStatus(status: string): DockerState {
  if (/^Up\b/.test(status)) return /\(Paused\)/.test(status) ? 'paused' : 'running'
  if (/^Exited\b/.test(status)) return 'exited'
  if (/^Restarting\b/.test(status)) return 'restarting'
  if (/^Created\b/.test(status)) return 'created'
  if (/^Dead\b/.test(status)) return 'dead'
  return ''
}

export function dockerActions(state: DockerState): DockerAction[] {
  switch (state) {
    case 'running':
      return ['restart', 'pause', 'stop']
    case 'paused':
      return ['unpause', 'stop']
    case 'restarting':
      return ['stop']
    default:
      return ['start', 'rm']
  }
}

export function parseNamespaces(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

type Json = Record<string, unknown>
const obj = (value: unknown): Json =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : {}
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])

/** The STATUS column the way kubectl works it out. */
function podStatus(meta: Json, status: Json): string {
  if (meta.deletionTimestamp) return 'Terminating'
  let reason = str(status.reason) || str(status.phase) || 'Unknown'
  for (const item of list(status.initContainerStatuses)) {
    const state = obj(obj(item).state)
    const waiting = str(obj(state.waiting).reason)
    if (waiting && waiting !== 'PodInitializing') return `Init:${waiting}`
  }
  for (const item of list(status.containerStatuses)) {
    const state = obj(obj(item).state)
    const waiting = str(obj(state.waiting).reason)
    if (waiting) {
      reason = waiting
      continue
    }
    const terminated = obj(state.terminated)
    if (Object.keys(terminated).length > 0) {
      reason = str(terminated.reason) || `Exit:${String(terminated.exitCode ?? '?')}`
    }
  }
  return reason
}

export function parsePods(text: string): Pod[] {
  const root = obj(JSON.parse(text))
  return list(root.items).map((item) => {
    const meta = obj(obj(item).metadata)
    const spec = obj(obj(item).spec)
    const status = obj(obj(item).status)
    const statuses = list(status.containerStatuses).map(obj)
    const containers = list(spec.containers)
      .map((c) => str(obj(c).name))
      .filter(Boolean)
    const created = Date.parse(str(meta.creationTimestamp))
    return {
      namespace: str(meta.namespace),
      name: str(meta.name),
      status: podStatus(meta, status),
      ready: `${statuses.filter((s) => s.ready === true).length}/${containers.length}`,
      restarts: statuses.reduce(
        (sum, s) => sum + (typeof s.restartCount === 'number' ? s.restartCount : 0),
        0,
      ),
      node: str(spec.nodeName),
      created: Number.isNaN(created) ? null : created,
      containers,
    }
  })
}

/** Same short form as kubectl's AGE column. */
export function formatAge(created: number | null, now: number): string {
  if (created === null) return ''
  const seconds = Math.max(0, Math.floor((now - created) / 1000))
  if (seconds < 120) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 120) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return `${hours}h`
  return `${Math.floor(hours / 24)}d`
}

export const isDockerName = (value: string): boolean =>
  /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(value)

export const isKubeName = (value: string): boolean =>
  value.length <= 253 && /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/.test(value)

/** Adds what to do about the two failures everyone hits first. */
export function explainError(message: string): string {
  if (/permission denied.*docker\.sock|docker\.sock.*permission denied/i.test(message)) {
    const command = ltr('sudo usermod -aG docker $USER')
    return `${message}\n${t('dockerPermission', { command })}`
  }
  if (
    /localhost:8080.*refused|no configuration has been provided|KUBERNETES_MASTER/i.test(message)
  ) {
    return `${message}\n${t('kubeConfig', { path: ltr('~/.kube/config') })}`
  }
  return message
}

const SHELL = 'sh -c "command -v bash >/dev/null && exec bash || exec sh"'

/** Typed into the terminal, so the user gets a real TTY inside the container. */
export function dockerShellCommand(id: string): string {
  if (!isDockerName(id)) throw new Error(t('badContainerName', { name: ltr(id) }))
  return `docker exec -it '${id}' ${SHELL}`
}

export function dockerFollowCommand(id: string, tail: number): string {
  if (!isDockerName(id)) throw new Error(t('badContainerName', { name: ltr(id) }))
  return `docker logs -f --tail ${tail} '${id}'`
}

function kubeTarget(namespace: string, pod: string, container: string | null): string {
  for (const name of [namespace, pod, container ?? 'x']) {
    if (!isKubeName(name)) throw new Error(t('badKubeName', { name: ltr(name) }))
  }
  return `-n '${namespace}' '${pod}'${container ? ` -c '${container}'` : ''}`
}

export function kubeShellCommand(namespace: string, pod: string, container: string | null): string {
  return `kubectl exec -it ${kubeTarget(namespace, pod, container)} -- ${SHELL}`
}

export function kubeFollowCommand(
  namespace: string,
  pod: string,
  container: string | null,
  tail: number,
): string {
  const which = container ? '' : ' --all-containers=true --prefix=true'
  return `kubectl logs -f ${kubeTarget(namespace, pod, container)}${which} --tail=${tail}`
}
