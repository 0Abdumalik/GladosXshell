import { ltr, messages } from './i18n'

const t = messages({
  hostKeyChanged: {
    zh: '主机密钥与记录不一致，已拒绝连接。可能是服务器重装，也可能是中间人攻击。确认服务器确实重装过之后，到 设置 → 已知主机 移除旧记录再连接。',
    en: 'The host key does not match the saved one, so the connection was refused. The server may have been reinstalled, or this may be a man-in-the-middle attack. Once you are sure the server was reinstalled, remove the old entry in Settings → Known hosts and connect again.',
    ug: 'ئاساسىي ماشىنا ئاچقۇچى خاتىرىدىكى بىلەن ماس كەلمىدى، ئۇلىنىش رەت قىلىندى. مۇلازىمېتىر قايتا ئورنىتىلغان بولۇشى مۇمكىن، ياكى ئوتتۇرىدىكى ئادەم ھۇجۇمى بولۇشى مۇمكىن. مۇلازىمېتىرنىڭ راستتىنلا قايتا ئورنىتىلغانلىقىنى جەزملەشتۈرگەندىن كېيىن، «تەڭشەك ← تونۇش ئاساسىي ماشىنىلار» دىن كونا خاتىرىنى چىقىرىۋېتىپ ئاندىن ئۇلاڭ.',
  },
  hostKeyRejected: {
    zh: '主机密钥未被信任（已拒绝或确认超时），已取消连接。',
    en: 'The host key was not trusted (rejected, or the confirmation timed out), so the connection was cancelled.',
    ug: 'ئاساسىي ماشىنا ئاچقۇچىغا ئىشەنچ قىلىنمىدى (رەت قىلىندى ياكى جەزملەشنىڭ ۋاقتى ئېشىپ كەتتى)، ئۇلىنىشتىن ۋاز كەچتى.',
  },
  hostKeyCertificate: {
    zh: '暂不支持主机密钥证书。',
    en: 'Host key certificates are not supported yet.',
    ug: 'ئاساسىي ماشىنا ئاچقۇچ گۇۋاھنامىسى ھازىرچە قوللانمايدۇ.',
  },
  authFailed: {
    zh: '认证失败，请检查用户名和凭据。',
    en: 'Authentication failed. Check the user name and credentials.',
    ug: 'دەلىللەش مەغلۇپ بولدى، ئىشلەتكۈچى ئاتى ۋە ئىسپات ئۇچۇرىنى تەكشۈرۈڭ.',
  },
  key: {
    zh: '私钥无法解析，或口令不正确。',
    en: 'The private key could not be read, or the passphrase is wrong.',
    ug: 'شەخسىي ئاچقۇچنى تەھلىل قىلغىلى بولمىدى، ياكى ئىم ئىبارىسى خاتا.',
  },
  store: {
    zh: '已知主机文件损坏，请检查后再连接。',
    en: 'The known hosts file is damaged. Check it, then connect again.',
    ug: 'تونۇش ئاساسىي ماشىنىلار ھۆججىتى بۇزۇلغان، تەكشۈرۈپ ئاندىن ئۇلاڭ.',
  },
  closed: { zh: '会话已关闭。', en: 'The session is closed.', ug: 'ئەڭگىمە يېپىلدى.' },
  cancelled: { zh: '操作已取消。', en: 'Operation cancelled.', ug: 'مەشغۇلاتتىن ۋاز كەچتى.' },
  locked: {
    zh: '保存的密码已用主密码锁定，输入主密码后才能使用。',
    en: 'Saved passwords are locked with the master password. Enter the master password to use them.',
    ug: 'ساقلانغان ئىملار ئاساسىي ئىم بىلەن قۇلۇپلانغان، ئاساسىي ئىمنى كىرگۈزگەندىن كېيىن ئاندىن ئىشلەتكىلى بولىدۇ.',
  },
  remoteChanged: {
    zh: '远程文件在下载后被修改过。',
    en: 'The remote file changed after it was downloaded.',
    ug: 'يىراقتىكى ھۆججەت چۈشۈرۈلگەندىن كېيىن ئۆزگەرتىلگەن.',
  },
  notFound: { zh: '找不到：{path}', en: 'Not found: {path}', ug: 'تېپىلمىدى: {path}' },
  permissionDenied: {
    zh: '没有权限：{path}',
    en: 'Permission denied: {path}',
    ug: 'ھوقۇق يېتەرسىز: {path}',
  },
  lost: {
    zh: '与服务器的连接已断开。',
    en: 'The connection to the server was lost.',
    ug: 'مۇلازىمېتىر بىلەن بولغان ئۇلىنىش ئۈزۈلدى.',
  },
  serverClosed: {
    zh: '服务器关闭了连接。',
    en: 'The server closed the connection.',
    ug: 'مۇلازىمېتىر ئۇلىنىشنى ياپتى.',
  },
  keepaliveTimeout: {
    zh: '保活超时：服务器长时间没有回应，网络可能已经中断。',
    en: 'Keepalive timed out: the server stopped responding, and the network may be down.',
    ug: 'keepalive ۋاقتى ئېشىپ كەتتى: مۇلازىمېتىر ئۇزۇن ۋاقىت جاۋاب قايتۇرمىدى، تور ئۈزۈلگەن بولۇشى مۇمكىن.',
  },
  connectTimeout: {
    zh: '连接超时：服务器长时间没有回应。',
    en: 'Connection timed out: the server did not respond.',
    ug: 'ئۇلىنىش ۋاقتى ئېشىپ كەتتى: مۇلازىمېتىر ئۇزۇن ۋاقىت جاۋاب قايتۇرمىدى.',
  },
  channelRefused: {
    zh: '服务器拒绝打开新的会话通道，可能已达到会话数上限（MaxSessions）。',
    en: 'The server refused to open a new session channel. It may have reached its session limit (MaxSessions).',
    ug: 'مۇلازىمېتىر يېڭى ئەڭگىمە قانىلى ئېچىشنى رەت قىلدى، ئەڭگىمە سانى چېكىگە (MaxSessions) يەتكەن بولۇشى مۇمكىن.',
  },
  authMethod: {
    zh: '服务器不接受所选的认证方式。',
    en: 'The server does not accept the selected authentication method.',
    ug: 'مۇلازىمېتىر تاللانغان دەلىللەش ئۇسۇلىنى قوبۇل قىلمايدۇ.',
  },
  badSignature: {
    zh: '服务器签名校验失败，已断开连接。',
    en: 'The server signature did not verify, so the connection was closed.',
    ug: 'مۇلازىمېتىر ئىمزاسىنى تەكشۈرۈش مەغلۇپ بولدى، ئۇلىنىش ئۈزۈلدى.',
  },
  requestRejected: {
    zh: '服务器拒绝了这个请求。',
    en: 'The server rejected the request.',
    ug: 'مۇلازىمېتىر بۇ تەلەپنى رەت قىلدى.',
  },
  ioTimeout: {
    zh: '操作超时：服务器没有响应。',
    en: 'Timed out: the server did not respond.',
    ug: 'مەشغۇلات ۋاقتى ئېشىپ كەتتى: مۇلازىمېتىر جاۋاب قايتۇرمىدى.',
  },
  reset: {
    zh: '连接被服务器或网络重置。',
    en: 'The server or the network reset the connection.',
    ug: 'ئۇلىنىشنى مۇلازىمېتىر ياكى تور ئۈزۈۋەتتى.',
  },
  sftpTimeout: {
    zh: 'SFTP 请求超时：服务器没有响应。',
    en: 'SFTP request timed out: the server did not respond.',
    ug: 'SFTP تەلىپىنىڭ ۋاقتى ئېشىپ كەتتى: مۇلازىمېتىر جاۋاب قايتۇرمىدى.',
  },
  sftpLost: {
    zh: 'SFTP 连接出错，与服务器的连接已断开。',
    en: 'SFTP connection error. The connection to the server was lost.',
    ug: 'SFTP ئۇلىنىشىدا خاتالىق كۆرۈلدى، مۇلازىمېتىر بىلەن بولغان ئۇلىنىش ئۈزۈلدى.',
  },
  sshError: {
    zh: 'SSH 错误：{message}',
    en: 'SSH error: {message}',
    ug: 'SSH خاتالىقى: {message}',
  },
  sftpError: {
    zh: 'SFTP 错误：{message}',
    en: 'SFTP error: {message}',
    ug: 'SFTP خاتالىقى: {message}',
  },
  exitLost: {
    zh: '与服务器的连接已断开（网络中断或保活超时）',
    en: 'The connection to the server was lost (network outage or keepalive timeout)',
    ug: 'مۇلازىمېتىر بىلەن بولغان ئۇلىنىش ئۈزۈلدى (تور ئۈزۈلدى ياكى keepalive ۋاقتى ئېشىپ كەتتى)',
  },
  exitUnexpected: {
    zh: '会话意外结束',
    en: 'The session ended unexpectedly',
    ug: 'ئەڭگىمە كۈتۈلمىگەن ھالدا ئاخىرلاشتى',
  },
  exitError: {
    zh: '会话结束：{error}',
    en: 'Session ended: {error}',
    ug: 'ئەڭگىمە ئاخىرلاشتى: {error}',
  },
  exitSignal: {
    zh: '会话被信号 {signal} 终止',
    en: 'Session terminated by signal {signal}',
    ug: 'ئەڭگىمە {signal} سىگنالى بىلەن ئاخىرلاشتۇرۇلدى',
  },
  exitCode: {
    zh: '会话结束，退出码 {code}',
    en: 'Session ended with exit code {code}',
    ug: 'ئەڭگىمە ئاخىرلاشتى، چېكىنىش كودى {code}',
  },
  exited: { zh: '会话结束', en: 'Session ended', ug: 'ئەڭگىمە ئاخىرلاشتى' },
})

type Key = Parameters<typeof t>[0]

export type HostKeyPolicy = 'strict' | 'tofu' | 'prompt'
export type AuthMethod = 'password' | 'keyFile' | 'keyboardInteractive' | 'agent'

export interface SessionExit {
  code: number | null
  signal: string | null
  error: string | null
}

export interface UnknownHostKey {
  host: string
  port: number
  algorithm: string
  fingerprint: string
}

export interface HostKeyPromptEvent {
  promptId: number
  key: UnknownHostKey
  timeoutSecs: number
}

export interface KbdRequest {
  name: string
  instructions: string
  prompts: { prompt: string; echo: boolean }[]
}

export interface InputPromptEvent {
  promptId: number
  request: KbdRequest
  timeoutSecs: number
}

export interface KnownHost {
  host: string
  port: number
  key: string
  fingerprint: string
  addedAt: number
}

export type ProxyKind = 'none' | 'socks5' | 'http'

export interface ProxySettings {
  kind: ProxyKind
  host: string
  port: number
  /** Empty: no proxy authentication. */
  user: string
}

export type ForwardKind = 'local' | 'remote' | 'dynamic'

export interface ForwardSpec {
  kind: ForwardKind
  bindHost: string
  /** 0 lets the listening side pick a free port. */
  bindPort: number
  destHost: string
  destPort: number
  label: string
}

export interface ForwardView {
  id: number
  spec: ForwardSpec
  boundPort: number
  active: number
  total: number
  bytesUp: number
  bytesDown: number
  lastError: string | null
}

export const MAX_SAVED_FORWARDS = 32

export type Protocol = 'ssh' | 'telnet' | 'serial'
export type Parity = 'none' | 'odd' | 'even'
export type Flow = 'none' | 'software' | 'hardware'

export interface SerialSettings {
  /** `COM3` on Windows, `/dev/ttyUSB0` elsewhere. */
  port: string
  baud: number
  dataBits: number
  parity: Parity
  stopBits: number
  flow: Flow
}

export const DEFAULT_SERIAL: Readonly<SerialSettings> = {
  port: '',
  baud: 115200,
  dataBits: 8,
  parity: 'none',
  stopBits: 1,
  flow: 'none',
}

export interface PortInfo {
  name: string
  description: string
}

export interface Advanced {
  protocol: Protocol
  /** Only used by serial connections, which have no host or port. */
  serial: SerialSettings
  policy: HostKeyPolicy
  connectTimeoutSecs: number
  keepaliveSecs: number
  term: string
  startupCommand: string
  initialDir: string
  monitor: boolean
  proxy: ProxySettings
  /** Saved server to tunnel through; exclusive with `proxy`. */
  jumpId: string | null
  agentForward: boolean
  forwards: ForwardSpec[]
  autoReconnect: boolean
}

export const DEFAULT_PROXY: Readonly<ProxySettings> = { kind: 'none', host: '', port: 0, user: '' }

export const DEFAULT_ADVANCED: Readonly<Advanced> = {
  protocol: 'ssh',
  serial: DEFAULT_SERIAL,
  policy: 'prompt',
  connectTimeoutSecs: 10,
  keepaliveSecs: 30,
  term: 'xterm-256color',
  startupCommand: '',
  initialDir: '',
  monitor: true,
  proxy: DEFAULT_PROXY,
  jumpId: null,
  agentForward: false,
  forwards: [],
  autoReconnect: false,
}

export interface Group {
  id: string
  name: string
}

export interface ServerView {
  id: string
  name: string
  groupId: string | null
  host: string
  port: number
  note: string
  auth: { method: AuthMethod; user: string; keyPath: string; hasSecret: boolean }
  advanced: Advanced
  hasProxySecret: boolean
  lastConnectedAt: number | null
}

export interface Profiles {
  groups: Group[]
  servers: ServerView[]
}

export type SecretUpdate =
  | { action: 'keep' }
  | { action: 'clear' }
  | { action: 'set'; value: string }

export interface ServerInput {
  id: string | null
  name: string
  groupId: string | null
  host: string
  port: number
  note: string
  auth: { method: AuthMethod; user: string; keyPath: string; secret: SecretUpdate }
  advanced: Advanced
  proxySecret: SecretUpdate
}

/** What opening a saved or ad-hoc server returns, whatever its protocol. */
export interface SshOpened {
  id: number
  protocol: Protocol
  title: string
  profileId: string | null
  monitor: boolean
  initialDir: string
  autoReconnect: boolean
  /** Saved forwards that could not start; the connection itself is up. */
  forwardErrors: string[]
}

export interface Usage {
  used: number
  total: number
}

export interface ProcessInfo {
  pid: number
  name: string
  cpuPercent: number | null
  memBytes: number
  state: string
  ppid: number
  uid: number
  /** Empty when /etc/passwd has no entry for the uid. */
  user: string
  threads: number
  nice: number
  /** Seconds after boot. */
  startSecs: number
  /** Only in detailed polls; empty for kernel threads. */
  cmdline: string | null
}

export interface LoginUser {
  name: string
  tty: string
  from: string
  since: string
}

/** Bytes; `cached` includes reclaimable slab. */
export interface MemoryDetail {
  total: number
  free: number
  available: number
  buffers: number
  cached: number
  shmem: number
  swapTotal: number
  swapFree: number
}

export interface NetRate {
  name: string
  rxTotal: number
  txTotal: number
  rxRate: number | null
  txRate: number | null
}

export interface Disk {
  filesystem: string
  mount: string
  total: number
  avail: number
  /** The rest only come with detailed polls. */
  fsType: string | null
  inodesTotal: number | null
  inodesUsed: number | null
}

export interface SystemInfo {
  hostname: string
  os: string
  kernel: string
  arch: string
  cpuModel: string
  /** Logical CPUs. */
  cpuCores: number
  cpuPhysical: number | null
  cpuSockets: number | null
  cpuMhz: number | null
  /** What systemd-detect-virt said, e.g. "kvm"; "none" on bare metal, empty when unknown. */
  virtualization: string
}

export interface StatusSnapshot {
  address: string
  unsupported: boolean
  error: string | null
  uptimeSecs: number
  load: [number, number, number]
  cpuPercent: number | null
  /** Per logical CPU, only in detailed polls. */
  cpuCores: number[] | null
  mem: Usage
  swap: Usage
  memory: MemoryDetail
  /** The busiest few, or every process in detailed polls. */
  processes: ProcessInfo[]
  processTotal: number
  threadTotal: number
  users: LoginUser[] | null
  net: NetRate[]
  latencyMs: number | null
  disks: Disk[] | null
  system: SystemInfo | null
  connections: NetworkConnection[] | null
}

export interface NetworkConnection {
  proto: string
  localAddr: string
  remoteAddr: string
  state: string
  pid: number | null
  program: string
}

export type EntryKind = 'dir' | 'file' | 'symlink' | 'other'

export interface Entry {
  name: string
  path: string
  kind: EntryKind
  size: number
  mode: number
  perms: string
  uid: number | null
  gid: number | null
  owner: string | null
  group: string | null
  mtime: number | null
  linkTarget: string | null
  targetIsDir: boolean
}

export interface Progress {
  bytesDone: number
  bytesTotal: number
  filesDone: number
  filesTotal: number
  /** Part of bytesDone not sent again: resumed part files and skipped identical files. */
  bytesResumed: number
}

export interface BackendError {
  kind: string
  message: string
}

export type TransferEvent =
  | { type: 'progress'; progress: Progress }
  | { type: 'done'; progress: Progress }
  | { type: 'failed'; error: BackendError }

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string }

const ERROR_TEXT: Record<string, Key> = {
  host_key_changed: 'hostKeyChanged',
  host_key_rejected: 'hostKeyRejected',
  host_key_certificate: 'hostKeyCertificate',
  auth_failed: 'authFailed',
  key: 'key',
  store: 'store',
  closed: 'closed',
  cancelled: 'cancelled',
  locked: 'locked',
  remote_changed: 'remoteChanged',
}

// Backend messages for these kinds are already written for people; only the English prefix goes.
const PREFIXES = [
  'invalid input: ',
  'not supported: ',
  'already exists: ',
  'not found: ',
  'permission denied: ',
]
// The backend puts only the path or item for these.
const PATH_TEXT: Record<string, Key> = {
  not_found: 'notFound',
  permission_denied: 'permissionDenied',
}

export function errorKind(error: unknown): string | null {
  if (typeof error === 'object' && error !== null && 'kind' in error) {
    return String((error as { kind: unknown }).kind)
  }
  return null
}

/** The input the backend says the error is about ('name', 'passphrase', 'password', 'master'), if any. */
export function errorField(error: unknown): string | null {
  if (typeof error === 'object' && error !== null && 'field' in error) {
    const field = (error as { field: unknown }).field
    return typeof field === 'string' ? field : null
  }
  return null
}

const TRANSPORT_TEXT: Record<string, [RegExp, Key][]> = {
  ssh: [
    [/^Disconnected$|^Connection closed by the remote side$/, 'serverClosed'],
    [/^(Keepalive|Inactivity) timeout$/, 'keepaliveTimeout'],
    [/^Connection timeout$/, 'connectTimeout'],
    [/^Channel send error$|^Unable to receive more messages|^Channel not open$/, 'lost'],
    [/^Failed to open channel/, 'channelRefused'],
    [/^(No|Unsupported) authentication method$/, 'authMethod'],
    [/^Wrong server signature$/, 'badSignature'],
    [/^The request was rejected by the other party$/, 'requestRejected'],
  ],
  io: [
    [/^(connection )?timed out$/i, 'ioTimeout'],
    // i18n-ignore: Windows socket error text on Chinese systems, matched as the OS writes it
    [/connection reset|forcibly closed|强迫关闭/i, 'reset'],
    // i18n-ignore: Windows socket error text on Chinese systems, matched as the OS writes it
    [/broken pipe|connection aborted|中止了一个已建立的连接/i, 'lost'],
  ],
  sftp: [
    [/^Timeout$/, 'sftpTimeout'],
    [/^I\/O: /, 'sftpLost'],
  ],
}
/** The backend's English prefix, and the message that shows the rest when no pattern matches. */
const TRANSPORT_PREFIX: Record<string, [string, Key | null]> = {
  ssh: ['ssh error: ', 'sshError'],
  io: ['i/o error: ', null],
  sftp: ['sftp error: ', 'sftpError'],
}

/** SSH, socket and SFTP errors come from libraries in English; the common ones get explained. */
function describeTransport(kind: string, message: string): string {
  const [prefix, label] = TRANSPORT_PREFIX[kind]
  const rest = (message.startsWith(prefix) ? message.slice(prefix.length) : message)
    .replace(/\s*\(os error \d+\)$/, '')
    .trim()
  const hit = TRANSPORT_TEXT[kind].find(([pattern]) => pattern.test(rest))
  if (hit) return t(hit[1])
  return label ? t(label, { message: ltr(rest) }) : rest
}

export function describeError(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'kind' in error) {
    const { kind, message } = error as { kind: string; message?: string }
    const key = Object.hasOwn(ERROR_TEXT, kind) ? ERROR_TEXT[kind] : null
    if (key) {
      const text = t(key)
      return kind === 'host_key_changed' && message ? `${text}\n${message}` : text
    }
    if (message && Object.hasOwn(TRANSPORT_PREFIX, kind)) return describeTransport(kind, message)
    if (message) {
      const prefix = PREFIXES.find((p) => message.startsWith(p))
      const rest = prefix ? message.slice(prefix.length) : message
      return Object.hasOwn(PATH_TEXT, kind) ? t(PATH_TEXT[kind], { path: ltr(rest) }) : rest
    }
  }
  return error instanceof Error ? error.message : String(error)
}

const TEXT_KINDS: [string, string][] = [
  ['ssh error: ', 'ssh'],
  ['i/o error: ', 'io'],
  ['sftp error: ', 'sftp'],
  ['session is closed', 'closed'],
]

/** For errors that reach the frontend only as their backend message text. */
export function describeErrorText(message: string): string {
  const hit = TEXT_KINDS.find(([prefix]) => message.startsWith(prefix))
  return hit ? describeError({ kind: hit[1], message }) : message
}

/** Keyed by the backend's exit error text. */
const EXIT_ERRORS: Record<string, Key> = {
  'connection lost': 'exitLost',
  'session ended unexpectedly': 'exitUnexpected',
}

/** The connection dropped or the server killed the shell, as opposed to the shell exiting. */
export function exitIsAbnormal(exit: SessionExit): boolean {
  return exit.error !== null || exit.signal !== null
}

export function describeExit(exit: SessionExit): string {
  if (exit.error) {
    return Object.hasOwn(EXIT_ERRORS, exit.error)
      ? t(EXIT_ERRORS[exit.error])
      : t('exitError', { error: ltr(exit.error) })
  }
  if (exit.signal) return t('exitSignal', { signal: exit.signal })
  if (exit.code !== null) return t('exitCode', { code: exit.code })
  return t('exited')
}
