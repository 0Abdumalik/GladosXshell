import { ltr, messages, pl } from './i18n'
import {
  type Advanced,
  type AuthMethod,
  DEFAULT_PROXY,
  DEFAULT_SERIAL,
  type Flow,
  type ForwardSpec,
  type HostKeyPolicy,
  MAX_SAVED_FORWARDS,
  type Parity,
  type Protocol,
  type ProxyKind,
  type ProxySettings,
  type SecretUpdate,
  type ServerInput,
  type ServerView,
} from './protocol'

const t = messages({
  unknownProtocol: {
    zh: '未知的连接协议',
    en: 'Unknown connection protocol',
    ug: 'نامەلۇم ئۇلىنىش كېلىشىمى',
  },
  nameTooLong: {
    zh: '名称不能超过 128 个字符',
    en: "Name can't be longer than 128 characters",
    ug: 'ئات 128 ھەرپتىن ئاشماسلىقى كېرەك',
  },
  badHost: {
    zh: '请输入主机名或 IP 地址，不含空格、/ 或 @',
    en: 'Enter a host name or IP address without spaces, / or @',
    ug: 'بوشلۇق، / ياكى @ بولمىغان ئاساسىي ماشىنا ئاتى ياكى IP ئادرېسىنى كىرگۈزۈڭ',
  },
  badPort: {
    zh: '端口必须是 1 到 65535',
    en: 'Port must be 1 to 65535',
    ug: 'ئېغىز 1 دىن 65535 كىچە بولۇشى كېرەك',
  },
  noteTooLong: {
    zh: '备注不能超过 2000 个字符',
    en: "Note can't be longer than 2000 characters",
    ug: 'ئىزاھ 2000 ھەرپتىن ئاشماسلىقى كېرەك',
  },
  serialRequired: { zh: '请选择串口', en: 'Choose a serial port', ug: 'تەرتىپلىك ئېغىز تاللاڭ' },
  serialSpaces: {
    zh: '串口名不能包含空格',
    en: "Serial port name can't contain spaces",
    ug: 'تەرتىپلىك ئېغىز ئاتىدا بوشلۇق بولماسلىقى كېرەك',
  },
  badBaud: {
    zh: '波特率必须在 1 到 4000000 之间',
    en: 'Baud rate must be between 1 and 4000000',
    ug: 'ئۇچۇر تېزلىكى 1 دىن 4000000 غىچە بولۇشى كېرەك',
  },
  badDataBits: {
    zh: '数据位必须是 5 到 8',
    en: 'Data bits must be 5 to 8',
    ug: 'سانلىق مەلۇمات بىتى 5 تىن 8 گىچە بولۇشى كېرەك',
  },
  badStopBits: {
    zh: '停止位必须是 1 或 2',
    en: 'Stop bits must be 1 or 2',
    ug: 'توختاش بىتى 1 ياكى 2 بولۇشى كېرەك',
  },
  unknownParity: { zh: '未知的校验方式', en: 'Unknown parity', ug: 'نامەلۇم تەكشۈرۈش ئۇسۇلى' },
  unknownFlow: {
    zh: '未知的流控方式',
    en: 'Unknown flow control',
    ug: 'نامەلۇم ئېقىن كونترول ئۇسۇلى',
  },
  unknownMethod: {
    zh: '未知的认证方式',
    en: 'Unknown authentication method',
    ug: 'نامەلۇم دەلىللەش ئۇسۇلى',
  },
  userRequired: { zh: '请输入用户名', en: 'Enter a username', ug: 'ئىشلەتكۈچى ئاتىنى كىرگۈزۈڭ' },
  userTooLong: { zh: '用户名过长', en: 'Username is too long', ug: 'ئىشلەتكۈچى ئاتى بەك ئۇزۇن' },
  keyRequired: {
    zh: '请选择私钥文件',
    en: 'Choose a private key file',
    ug: 'شەخسىي ئاچقۇچ ھۆججىتىنى تاللاڭ',
  },
  unknownProxy: { zh: '未知的代理类型', en: 'Unknown proxy type', ug: 'نامەلۇم ۋاكالەتچى تىپى' },
  badProxyHost: {
    zh: '请输入代理的主机名或 IP 地址',
    en: "Enter the proxy's host name or IP address",
    ug: 'ۋاكالەتچىنىڭ ئاساسىي ماشىنا ئاتى ياكى IP ئادرېسىنى كىرگۈزۈڭ',
  },
  proxyUserTooLong: {
    zh: '代理用户名过长',
    en: 'Proxy username is too long',
    ug: 'ۋاكالەتچى ئىشلەتكۈچى ئاتى بەك ئۇزۇن',
  },
  proxyOrJump: {
    zh: '代理和跳板机只能选一个；需要两者时，请给跳板机配置代理',
    en: 'Use either a proxy or a jump host. To use both, set the proxy on the jump host.',
    ug: 'ۋاكالەتچى بىلەن ئۆتكۈنچى مۇلازىمېتىردىن پەقەت بىرىنىلا تاللىغىلى بولىدۇ؛ ئىككىلىسى كېرەك بولسا، ئۆتكۈنچى مۇلازىمېتىرغا ۋاكالەتچى تەڭشەڭ',
  },
  telnetJump: {
    zh: 'Telnet 连接不能经过跳板机，可以改用代理',
    en: "Telnet connections can't go through a jump host; use a proxy instead",
    ug: 'Telnet ئۇلىنىشى ئۆتكۈنچى مۇلازىمېتىردىن ئۆتەلمەيدۇ، ئۇنىڭ ئورنىغا ۋاكالەتچى ئىشلىتىڭ',
  },
  maxForwards: {
    zh: '最多保存 {n} 条端口转发',
    en: (p) => `You can save up to ${pl('port forward')(p)}`,
    ug: 'ئەڭ كۆپ بولغاندا {n} ئېغىز يوللاشنى ساقلىغىلى بولىدۇ',
  },
  unknownPolicy: {
    zh: '未知的主机密钥策略',
    en: 'Unknown host key policy',
    ug: 'نامەلۇم ئاساسىي ماشىنا ئاچقۇچى سىياسىتى',
  },
  badTimeout: {
    zh: '连接超时必须是 1 到 120 秒',
    en: 'Connection timeout must be 1 to 120 seconds',
    ug: 'ئۇلىنىش ۋاقىت چېكى 1 دىن 120 سېكۇنتقىچە بولۇشى كېرەك',
  },
  badKeepalive: {
    zh: '心跳间隔必须是 0 到 3600 秒（0 表示关闭）',
    en: 'Keepalive interval must be 0 to 3600 seconds (0 turns it off)',
    ug: 'ھايات ساقلاش ئارىلىقى 0 دىن 3600 سېكۇنتقىچە بولۇشى كېرەك (0 بولسا تاقىلىدۇ)',
  },
  badTerm: {
    zh: '终端类型只能包含字母、数字和 {chars}',
    en: 'Terminal type can only contain letters, digits and {chars}',
    ug: 'تېرمىنال تىپىدا پەقەت ھەرپ، رەقەم ۋە {chars} بولىدۇ',
  },
  multiLineCommand: {
    zh: '登录命令只能是一行',
    en: 'The login command must be a single line',
    ug: 'كىرگەندىن كېيىنكى بۇيرۇق پەقەت بىر قۇر بولۇشى كېرەك',
  },
  badInitialDir: {
    zh: '初始目录必须以 / 或 ~ 开头',
    en: 'The start folder must begin with / or ~',
    ug: 'دەسلەپكى مۇندەرىجە / ياكى ~ بىلەن باشلىنىشى كېرەك',
  },
})

export type ServerTab = 'general' | 'auth' | 'network' | 'forwards' | 'advanced'

export interface ServerForm {
  protocol: string
  name: string
  host: string
  port: string
  groupId: string
  note: string
  serialPort: string
  baud: string
  dataBits: string
  parity: string
  stopBits: string
  flow: string
  method: string
  user: string
  password: string
  savePassword: boolean
  keyPath: string
  passphrase: string
  agentForward: boolean
  proxyKind: string
  proxyHost: string
  proxyPort: string
  proxyUser: string
  proxyPassword: string
  saveProxyPassword: boolean
  jumpId: string
  forwards: ForwardSpec[]
  policy: string
  connectTimeoutSecs: string
  keepaliveSecs: string
  term: string
  startupCommand: string
  initialDir: string
  monitor: boolean
  autoReconnect: boolean
}

export type FormField = keyof ServerForm

export interface FieldError {
  field: FormField
  tab: ServerTab
  message: string
}

export interface ServerDraft {
  name: string
  groupId: string | null
  host: string
  port: number
  note: string
  method: AuthMethod
  user: string
  keyPath: string
  /** Password or key passphrase as typed; empty means "not entered". */
  secret: string
  savePassword: boolean
  /** Proxy password as typed; empty means "not entered". */
  proxySecret: string
  saveProxyPassword: boolean
  advanced: Advanced
}

const PROTOCOLS: readonly Protocol[] = ['ssh', 'telnet', 'serial']
const PARITIES: readonly Parity[] = ['none', 'odd', 'even']
const FLOWS: readonly Flow[] = ['none', 'software', 'hardware']

/** The error for a server with more saved forwards than allowed. */
export function tooManyForwards(): string {
  return t('maxForwards', { n: MAX_SAVED_FORWARDS })
}

/** The port a protocol listens on when the form leaves it empty. */
export function defaultPort(protocol: string): number {
  return protocol === 'telnet' ? 23 : 22
}

const METHODS: readonly AuthMethod[] = ['password', 'keyFile', 'keyboardInteractive', 'agent']
const POLICIES: readonly HostKeyPolicy[] = ['strict', 'tofu', 'prompt']
const PROXIES: readonly ProxyKind[] = ['none', 'socks5', 'http']

function integer(text: string, fallback: number): number | null {
  const value = text.trim()
  if (value === '') return fallback
  return /^\d+$/.test(value) ? Number(value) : null
}

function badHost(host: string): boolean {
  return !host || host.length > 253 || /[\s/@]/.test(host)
}

export function parseServerForm(
  form: ServerForm,
): { ok: true; value: ServerDraft } | { ok: false; errors: FieldError[] } {
  const errors: FieldError[] = []
  const fail = (field: FormField, tab: ServerTab, message: string) =>
    errors.push({ field, tab, message })

  const protocol = form.protocol as Protocol
  if (!PROTOCOLS.includes(protocol)) fail('protocol', 'general', t('unknownProtocol'))
  const ssh = protocol === 'ssh'
  const serial = protocol === 'serial'
  const name = form.name.trim()
  if ([...name].length > 128) fail('name', 'general', t('nameTooLong'))
  const host = serial ? '' : form.host.trim()
  if (!serial && badHost(host)) fail('host', 'general', t('badHost'))
  const port = serial ? 0 : integer(form.port, defaultPort(protocol))
  if (!serial && (port === null || port < 1 || port > 65535)) {
    fail('port', 'general', t('badPort'))
  }
  if ([...form.note].length > 2000) fail('note', 'general', t('noteTooLong'))

  const serialPort = form.serialPort.trim()
  const baud = integer(form.baud, DEFAULT_SERIAL.baud)
  const dataBits = integer(form.dataBits, DEFAULT_SERIAL.dataBits)
  const stopBits = integer(form.stopBits, DEFAULT_SERIAL.stopBits)
  const parity = form.parity as Parity
  const flow = form.flow as Flow
  if (serial) {
    if (!serialPort) fail('serialPort', 'general', t('serialRequired'))
    else if (serialPort.length > 255 || /[\s\0]/.test(serialPort)) {
      fail('serialPort', 'general', t('serialSpaces'))
    }
    if (baud === null || baud < 1 || baud > 4_000_000) {
      fail('baud', 'general', t('badBaud'))
    }
    if (dataBits === null || dataBits < 5 || dataBits > 8)
      fail('dataBits', 'general', t('badDataBits'))
    if (stopBits !== 1 && stopBits !== 2) fail('stopBits', 'general', t('badStopBits'))
    if (!PARITIES.includes(parity)) fail('parity', 'general', t('unknownParity'))
    if (!FLOWS.includes(flow)) fail('flow', 'general', t('unknownFlow'))
  }

  const method = form.method as AuthMethod
  if (!METHODS.includes(method)) fail('method', 'auth', t('unknownMethod'))
  const user = form.user.trim()
  if (ssh && !user) fail('user', 'auth', t('userRequired'))
  else if (user.length > 128) fail('user', 'auth', t('userTooLong'))
  const keyPath = form.keyPath.trim()
  if (ssh && method === 'keyFile' && !keyPath) fail('keyPath', 'auth', t('keyRequired'))

  const proxyKind = form.proxyKind as ProxyKind
  let proxy: ProxySettings = DEFAULT_PROXY
  if (!PROXIES.includes(proxyKind)) fail('proxyKind', 'network', t('unknownProxy'))
  else if (proxyKind !== 'none' && !serial) {
    const proxyHost = form.proxyHost.trim()
    if (badHost(proxyHost)) fail('proxyHost', 'network', t('badProxyHost'))
    const proxyPort = integer(form.proxyPort, proxyKind === 'socks5' ? 1080 : 8080)
    if (proxyPort === null || proxyPort < 1 || proxyPort > 65535) {
      fail('proxyPort', 'network', t('badPort'))
    }
    const proxyUser = form.proxyUser.trim()
    if (proxyUser.length > 255) fail('proxyUser', 'network', t('proxyUserTooLong'))
    proxy = { kind: proxyKind, host: proxyHost, port: proxyPort ?? 0, user: proxyUser }
    if (form.jumpId) {
      fail('jumpId', 'network', t('proxyOrJump'))
    }
  }
  if (protocol === 'telnet' && form.jumpId) {
    fail('jumpId', 'network', t('telnetJump'))
  }
  if (ssh && form.forwards.length > MAX_SAVED_FORWARDS) {
    fail('forwards', 'forwards', tooManyForwards())
  }

  const policy = form.policy as HostKeyPolicy
  if (!POLICIES.includes(policy)) fail('policy', 'advanced', t('unknownPolicy'))
  const timeout = serial ? 10 : integer(form.connectTimeoutSecs, 10)
  if (timeout === null || timeout < 1 || timeout > 120) {
    fail('connectTimeoutSecs', 'advanced', t('badTimeout'))
  }
  const keepalive = serial ? 30 : integer(form.keepaliveSecs, 30)
  if (keepalive === null || keepalive > 3600) {
    fail('keepaliveSecs', 'advanced', t('badKeepalive'))
  }
  const term = (!serial && form.term.trim()) || 'xterm-256color'
  if (!/^[A-Za-z0-9._+-]{1,64}$/.test(term)) {
    fail('term', 'advanced', t('badTerm', { chars: ltr('. _ + -') }))
  }
  const startupCommand = form.startupCommand.trim()
  if (ssh && (/[\r\n]/.test(startupCommand) || startupCommand.length > 4096)) {
    fail('startupCommand', 'advanced', t('multiLineCommand'))
  }
  const initialDir = form.initialDir.trim()
  if (ssh && initialDir && !/^[/~]/.test(initialDir)) {
    fail('initialDir', 'advanced', t('badInitialDir'))
  }

  if (errors.length > 0) return { ok: false, errors }
  const proxyAuth = proxy.kind !== 'none' && proxy.user !== ''
  const saves = ssh && (method === 'password' || method === 'keyFile')
  return {
    ok: true,
    value: {
      name,
      groupId: form.groupId || null,
      host,
      port: port as number,
      note: form.note.trim(),
      method,
      user: ssh ? user : '',
      keyPath: ssh ? keyPath : '',
      secret: !ssh
        ? ''
        : method === 'keyFile'
          ? form.passphrase
          : method === 'password'
            ? form.password
            : '',
      savePassword: saves && form.savePassword,
      proxySecret: proxyAuth ? form.proxyPassword : '',
      saveProxyPassword: proxyAuth && form.saveProxyPassword,
      advanced: {
        protocol,
        serial: serial
          ? {
              port: serialPort,
              baud: baud as number,
              dataBits: dataBits as number,
              parity,
              stopBits: stopBits as number,
              flow,
            }
          : { ...DEFAULT_SERIAL },
        policy,
        connectTimeoutSecs: timeout as number,
        keepaliveSecs: keepalive as number,
        term,
        startupCommand: ssh ? startupCommand : '',
        initialDir: ssh ? initialDir : '',
        monitor: ssh && form.monitor,
        proxy,
        jumpId: serial ? null : form.jumpId || null,
        agentForward: ssh && form.agentForward,
        forwards: ssh ? form.forwards : [],
        autoReconnect: form.autoReconnect,
      },
    },
  }
}

/** A stored secret only survives if it still means the same thing (same auth method). */
export function secretUpdate(draft: ServerDraft, original: ServerView | null): SecretUpdate {
  if (!draft.savePassword) return { action: 'clear' }
  if (draft.secret) return { action: 'set', value: draft.secret }
  return original && original.auth.method === draft.method
    ? { action: 'keep' }
    : { action: 'clear' }
}

export function proxySecretUpdate(draft: ServerDraft, original: ServerView | null): SecretUpdate {
  if (!draft.saveProxyPassword) return { action: 'clear' }
  if (draft.proxySecret) return { action: 'set', value: draft.proxySecret }
  return original?.hasProxySecret ? { action: 'keep' } : { action: 'clear' }
}

export function draftToInput(draft: ServerDraft, original: ServerView | null): ServerInput {
  return {
    id: original?.id ?? null,
    name: draft.name,
    groupId: draft.groupId,
    host: draft.host,
    port: draft.port,
    note: draft.note,
    auth: {
      method: draft.method,
      user: draft.user,
      keyPath: draft.keyPath,
      secret: secretUpdate(draft, original),
    },
    advanced: draft.advanced,
    proxySecret: proxySecretUpdate(draft, original),
  }
}

export function serverToForm(server: ServerView | null, groupId: string | null = null): ServerForm {
  const advanced = server?.advanced
  const proxy = advanced?.proxy ?? DEFAULT_PROXY
  const protocol = advanced?.protocol ?? 'ssh'
  const serial = advanced?.serial ?? DEFAULT_SERIAL
  return {
    protocol,
    name: server?.name ?? '',
    host: server?.host ?? '',
    port: protocol === 'serial' ? '' : String(server?.port ?? 22),
    groupId: server ? (server.groupId ?? '') : (groupId ?? ''),
    note: server?.note ?? '',
    serialPort: serial.port,
    baud: String(serial.baud),
    dataBits: String(serial.dataBits),
    parity: serial.parity,
    stopBits: String(serial.stopBits),
    flow: serial.flow,
    method: server?.auth.method ?? 'password',
    user: server?.auth.user ?? 'root',
    password: '',
    savePassword: server ? server.auth.hasSecret : true,
    keyPath: server?.auth.keyPath ?? '',
    passphrase: '',
    agentForward: advanced?.agentForward ?? false,
    proxyKind: proxy.kind,
    proxyHost: proxy.host,
    proxyPort: proxy.kind === 'none' ? '' : String(proxy.port),
    proxyUser: proxy.user,
    proxyPassword: '',
    saveProxyPassword: server ? server.hasProxySecret : true,
    jumpId: advanced?.jumpId ?? '',
    forwards: [...(advanced?.forwards ?? [])],
    policy: advanced?.policy ?? 'prompt',
    connectTimeoutSecs: String(advanced?.connectTimeoutSecs ?? 10),
    keepaliveSecs: String(advanced?.keepaliveSecs ?? 30),
    term: advanced?.term ?? 'xterm-256color',
    startupCommand: advanced?.startupCommand ?? '',
    initialDir: advanced?.initialDir ?? '',
    monitor: advanced?.monitor ?? true,
    autoReconnect: advanced?.autoReconnect ?? false,
  }
}
