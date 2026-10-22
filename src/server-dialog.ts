import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import { button, modal } from './dialogs'
import { field, h, reportError, setFieldError, setStatus } from './dom'
import { forwardAdder } from './forward-adder'
import { describeForward } from './forward-spec'
import { joinList, ltr, messages, pl } from './i18n'
import { common } from './i18n-common'
import { icon } from './icons'
import { withUnlock } from './master'
import { service } from './plugins/registry'
import {
  connectServers,
  endpointTitle,
  profiles,
  reloadProfiles,
  serverTitle,
} from './profiles-store'
import {
  describeError,
  type ForwardSpec,
  MAX_SAVED_FORWARDS,
  type PortInfo,
  type ServerView,
} from './protocol'
import {
  defaultPort,
  draftToInput,
  type FormField,
  parseServerForm,
  type ServerDraft,
  type ServerForm,
  type ServerTab,
  serverToForm,
  tooManyForwards,
} from './server-form'
import { openAdhoc } from './sessions'

const t = messages({
  tabGeneral: { zh: '常规', en: 'General', ug: 'ئادەتتىكى' },
  tabAuth: { zh: '认证', en: 'Authentication', ug: 'دەلىللەش' },
  tabNetwork: { zh: '代理与跳板', en: 'Proxy and jump host', ug: 'ۋاكالەتچى ۋە ئۆتكۈنچى' },
  tabForwards: { zh: '端口转发', en: 'Port forwarding', ug: 'ئېغىز يوللاش' },
  tabAdvanced: { zh: '高级', en: 'Advanced', ug: 'ئالىي' },
  protocolSerial: { zh: '串口', en: 'Serial', ug: 'تەرتىپلىك ئېغىز' },
  none: { zh: '无', en: 'None', ug: 'يوق' },
  parityOdd: { zh: '奇校验', en: 'Odd', ug: 'تاق' },
  parityEven: { zh: '偶校验', en: 'Even', ug: 'جۈپ' },
  flowSoftware: {
    zh: '软件（XON/XOFF）',
    en: 'Software (XON/XOFF)',
    ug: 'يۇمشاق دېتال (XON/XOFF)',
  },
  flowHardware: { zh: '硬件（RTS/CTS）', en: 'Hardware (RTS/CTS)', ug: 'قاتتىق دېتال (RTS/CTS)' },
  nameHintSsh: {
    zh: '留空时显示为 用户名@主机',
    en: 'Leave empty to show user@host',
    ug: 'بوش قالسا user@host شەكلىدە كۆرسىتىلىدۇ',
  },
  nameHintTelnet: {
    zh: '留空时显示为主机名',
    en: 'Leave empty to show the host name',
    ug: 'بوش قالسا ئاساسىي ماشىنا ئاتى كۆرسىتىلىدۇ',
  },
  nameHintSerial: {
    zh: '留空时显示为串口名',
    en: 'Leave empty to show the port name',
    ug: 'بوش قالسا تەرتىپلىك ئېغىز ئاتى كۆرسىتىلىدۇ',
  },
  keyFile: { zh: '私钥文件', en: 'Private key file', ug: 'شەخسىي ئاچقۇچ ھۆججىتى' },
  keyboardInteractive: {
    zh: '键盘交互',
    en: 'Keyboard-interactive',
    ug: 'كۇنۇپكا تاختىسى ئارقىلىق',
  },
  noProxy: { zh: '不使用代理', en: 'No proxy', ug: 'ۋاكالەتچى ئىشلەتمەيدۇ' },
  policyPrompt: {
    zh: '首次连接时询问（推荐）',
    en: 'Ask on first connection (recommended)',
    ug: 'تۇنجى ئۇلانغاندا سورايدۇ (تەۋسىيە)',
  },
  policyTofu: {
    zh: '首次连接自动信任',
    en: 'Trust automatically on first connection',
    ug: 'تۇنجى ئۇلانغاندا ئاپتوماتىك ئىشىنىدۇ',
  },
  policyStrict: {
    zh: '只连接已信任的主机',
    en: 'Only connect to trusted hosts',
    ug: 'پەقەت ئىشەنچلىك ئاساسىي ماشىنىلارغا ئۇلىنىدۇ',
  },
  noJump: { zh: '不使用跳板机', en: 'No jump host', ug: 'ئۆتكۈنچى مۇلازىمېتىر ئىشلەتمەيدۇ' },
  deletedServer: {
    zh: '（已删除的服务器）',
    en: '(deleted server)',
    ug: '(ئۆچۈرۈلگەن مۇلازىمېتىر)',
  },
  editTitle: { zh: '编辑：{name}', en: 'Edit: {name}', ug: 'تەھرىرلەش: {name}' },
  hostPlaceholder: { zh: '主机名或 IP', en: 'Host name or IP', ug: 'ئاساسىي ماشىنا ئاتى ياكى IP' },
  serialPlaceholder: {
    zh: '例如 {a} 或 {b}',
    en: 'e.g. {a} or {b}',
    ug: 'مەسىلەن {a} ياكى {b}',
  },
  example: { zh: '例如 {value}', en: 'e.g. {value}', ug: 'مەسىلەن {value}' },
  initialDirPlaceholder: {
    zh: '留空时打开主目录',
    en: 'Leave empty to open the home folder',
    ug: 'بوش قالسا باش مۇندەرىجە ئېچىلىدۇ',
  },
  proxyHostPlaceholder: {
    zh: '代理主机名或 IP',
    en: 'Proxy host name or IP',
    ug: 'ۋاكالەتچىنىڭ ئاساسىي ماشىنا ئاتى ياكى IP',
  },
  proxyUserPlaceholder: {
    zh: '代理不需要认证时留空',
    en: 'Leave empty if the proxy needs no authentication',
    ug: 'ۋاكالەتچى دەلىللەش تەلەپ قىلمىسا بوش قالدۇرۇڭ',
  },
  agentHelp: {
    zh: '使用 Pageant 或 Windows OpenSSH Authentication Agent 里的密钥，本程序不保存任何凭据。',
    en: 'Uses the keys in Pageant or the Windows OpenSSH Authentication Agent. GladosXshell stores no credentials.',
    ug: 'Pageant ياكى Windows OpenSSH Authentication Agent دىكى ئاچقۇچلارنى ئىشلىتىدۇ، بۇ پروگرامما ھېچقانداق كىملىك ئۇچۇرى ساقلىمايدۇ.',
  },
  deleteForward: { zh: '删除 {name}', en: 'Delete {name}', ug: '{name} نى ئۆچۈر' },
  noForwards: {
    zh: '还没有保存的端口转发。',
    en: 'No saved port forwards yet.',
    ug: 'تېخى ساقلانغان ئېغىز يوللاش يوق.',
  },
  proxyHost: { zh: '代理主机', en: 'Proxy host', ug: 'ۋاكالەتچى ئاساسىي ماشىنا' },
  proxyUser: { zh: '代理用户名', en: 'Proxy username', ug: 'ۋاكالەتچى ئىشلەتكۈچى ئاتى' },
  proxyPassword: { zh: '代理密码', en: 'Proxy password', ug: 'ۋاكالەتچى ئىمى' },
  saveProxyPassword: {
    zh: '保存代理密码',
    en: 'Save proxy password',
    ug: 'ۋاكالەتچى ئىمىنى ساقلا',
  },
  browse: { zh: '浏览…', en: 'Browse…', ug: 'كۆز يۈگۈرت…' },
  chooseKey: {
    zh: '选择私钥文件',
    en: 'Choose private key file',
    ug: 'شەخسىي ئاچقۇچ ھۆججىتىنى تاللاش',
  },
  keyLibrary: { zh: '密钥库…', en: 'Key library…', ug: 'ئاچقۇچ ئامبىرى…' },
  keyFileHelp: {
    zh: 'OpenSSH、PEM 或 PuTTY .ppk 格式的私钥。',
    en: 'A private key in OpenSSH, PEM or PuTTY .ppk format.',
    ug: 'OpenSSH، PEM ياكى PuTTY .ppk فورماتىدىكى شەخسىي ئاچقۇچ.',
  },
  passphrase: { zh: '私钥口令', en: 'Passphrase', ug: 'ئىم ئىبارىسى' },
  passphraseHelp: {
    zh: '私钥没有口令时留空。',
    en: 'Leave empty if the key has no passphrase.',
    ug: 'ئاچقۇچنىڭ ئىم ئىبارىسى بولمىسا بوش قالدۇرۇڭ.',
  },
  portsFound: {
    zh: '找到 {n} 个串口：{list}',
    en: (p) => `Found ${pl('serial port')(p)}: ${p.list}`,
    ug: '{n} تەرتىپلىك ئېغىز تېپىلدى: {list}',
  },
  noPorts: {
    zh: '没有找到串口，可以直接输入名称。',
    en: 'No serial ports found. You can type a name instead.',
    ug: 'تەرتىپلىك ئېغىز تېپىلمىدى، ئاتىنى بىۋاسىتە كىرگۈزسىڭىز بولىدۇ.',
  },
  portsFailed: {
    zh: '无法列出串口：{error}',
    en: "Can't list serial ports: {error}",
    ug: 'تەرتىپلىك ئېغىزلارنى تىزىپ چىقالمىدى: {error}',
  },
  serialPort: { zh: '串口', en: 'Serial port', ug: 'تەرتىپلىك ئېغىز' },
  baud: { zh: '波特率', en: 'Baud rate', ug: 'ئۇچۇر تېزلىكى' },
  dataBits: { zh: '数据位', en: 'Data bits', ug: 'سانلىق مەلۇمات بىتى' },
  parity: { zh: '校验', en: 'Parity', ug: 'تەكشۈرۈش' },
  stopBits: { zh: '停止位', en: 'Stop bits', ug: 'توختاش بىتى' },
  flow: { zh: '流控', en: 'Flow control', ug: 'ئېقىن كونترولى' },
  jumpHost: { zh: '跳板机', en: 'Jump host', ug: 'ئۆتكۈنچى مۇلازىمېتىر' },
  jumpHelp: {
    zh: '先连接这台已保存的服务器，再从它连到目标。跳板机自己的代理和跳板设置同样生效。',
    en: "Connects to this saved server first, then from it to the target. The jump host's own proxy and jump host settings apply too.",
    ug: 'ئالدى بىلەن بۇ ساقلانغان مۇلازىمېتىرغا ئۇلىنىپ، ئاندىن ئۇنىڭدىن نىشانغا ئۇلىنىدۇ. ئۆتكۈنچى مۇلازىمېتىرنىڭ ئۆز ۋاكالەتچى ۋە ئۆتكۈنچى تەڭشەكلىرىمۇ كۈچكە ئىگە.',
  },
  hostKey: { zh: '主机密钥', en: 'Host key', ug: 'ئاساسىي ماشىنا ئاچقۇچى' },
  policyHelp: {
    zh: '「询问」会在首次连接时显示指纹，由你确认。',
    en: '"Ask" shows the fingerprint on the first connection for you to confirm.',
    ug: '«سورايدۇ» تۇنجى ئۇلانغاندا بارماق ئىزىنى كۆرسىتىپ، سىزنىڭ جەزملىشىڭىزنى كۈتىدۇ.',
  },
  connectTimeout: {
    zh: '连接超时（秒）',
    en: 'Connection timeout (s)',
    ug: 'ئۇلىنىش ۋاقىت چېكى (سېكۇنت)',
  },
  keepalive: {
    zh: '心跳间隔（秒）',
    en: 'Keepalive interval (s)',
    ug: 'ھايات ساقلاش ئارىلىقى (سېكۇنت)',
  },
  keepaliveHelp: { zh: '0 表示关闭。', en: '0 turns it off.', ug: '0 بولسا تاقىلىدۇ.' },
  termType: { zh: '终端类型', en: 'Terminal type', ug: 'تېرمىنال تىپى' },
  startupCommand: { zh: '登录后执行', en: 'Run after login', ug: 'كىرگەندىن كېيىن ئىجرا قىلىش' },
  startupHelp: {
    zh: '连接成功后写入终端的一行命令。',
    en: 'A one-line command typed into the terminal once connected.',
    ug: 'ئۇلانغاندىن كېيىن تېرمىنالغا يېزىلىدىغان بىر قۇر بۇيرۇق.',
  },
  initialDir: {
    zh: '文件管理初始目录',
    en: 'File manager start folder',
    ug: 'ھۆججەت باشقۇرغۇچنىڭ دەسلەپكى مۇندەرىجىسى',
  },
  monitor: { zh: '启用状态监控', en: 'Monitor server status', ug: 'ھالەت كۆزىتىشنى قوزغات' },
  protocol: { zh: '协议', en: 'Protocol', ug: 'كېلىشىم' },
  group: { zh: '分组', en: 'Group', ug: 'گۇرۇپپا' },
  method: { zh: '认证方式', en: 'Authentication method', ug: 'دەلىللەش ئۇسۇلى' },
  user: { zh: '用户名', en: 'Username', ug: 'ئىشلەتكۈچى ئاتى' },
  agentForward: { zh: '转发 SSH Agent', en: 'Forward SSH agent', ug: 'SSH Agent نى يوللا' },
  agentForwardHelp: {
    zh: '服务器上的 ssh/git 可以借用本机 Agent 里的密钥。只对信任的服务器开启。',
    en: 'Lets ssh and git on the server use the keys in your local agent. Turn it on only for servers you trust.',
    ug: 'مۇلازىمېتىردىكى ssh/git بۇ كومپيۇتېردىكى Agent ئىچىدىكى ئاچقۇچلارنى ئىشلىتەلەيدۇ. پەقەت ئىشەنچلىك مۇلازىمېتىرلار ئۈچۈنلا ئېچىڭ.',
  },
  proxy: { zh: '代理', en: 'Proxy', ug: 'ۋاكالەتچى' },
  proxyHelp: {
    zh: '连接经由这个代理建立。',
    en: 'The connection goes through this proxy.',
    ug: 'ئۇلىنىش مۇشۇ ۋاكالەتچى ئارقىلىق قۇرۇلىدۇ.',
  },
  forwardsHelp: {
    zh: '连接成功后自动开启，断开时关闭。连接后也可以在“端口转发”面板里临时添加。',
    en: 'They start once connected and stop on disconnect. You can also add one for the session in the Port forwarding panel.',
    ug: 'ئۇلانغاندىن كېيىن ئاپتوماتىك ئېچىلىدۇ، ئۈزۈلگەندە تاقىلىدۇ. ئۇلانغاندىن كېيىن «ئېغىز يوللاش» تاختىسىدىمۇ ۋاقىتلىق قوشقىلى بولىدۇ.',
  },
  autoReconnect: {
    zh: '断线后自动重连',
    en: 'Reconnect automatically when the connection drops',
    ug: 'ئۈزۈلگەندە ئاپتوماتىك قايتا ئۇلا',
  },
  autoReconnectHelp: {
    zh: '网络中断或保活超时后按递增间隔重试，手动关闭会话不会触发。',
    en: "Retries at growing intervals after a network drop or keepalive timeout. Closing a session yourself doesn't trigger it.",
    ug: 'تور ئۈزۈلگەندە ياكى ھايات ساقلاش ۋاقتى ئېشىپ كەتكەندە بارغانسېرى ئۇزىرايدىغان ئارىلىقتا قايتا سىنايدۇ؛ ئەڭگىمىنى ئۆزىڭىز تاقىسىڭىز قوزغالمايدۇ.',
  },
  savePassphrase: { zh: '保存私钥口令', en: 'Save passphrase', ug: 'ئىم ئىبارىسىنى ساقلا' },
  savePassword: { zh: '保存密码', en: 'Save password', ug: 'ئىمنى ساقلا' },
  secretStored: {
    zh: '已保存。留空则保持不变；取消勾选会删除已保存的内容。',
    en: 'Saved. Leave empty to keep it; uncheck to delete it.',
    ug: 'ساقلانغان. بوش قالدۇرسىڭىز ئۆزگەرمەيدۇ؛ بەلگىنى ئېلىۋەتسىڭىز ساقلانغىنى ئۆچۈرۈلىدۇ.',
  },
  secretHelp: {
    zh: '用 Windows 当前用户的凭据加密保存在本机。不保存时每次连接都会询问。',
    en: "Encrypted with your Windows account's credentials and kept on this computer. If not saved, you're asked on every connection.",
    ug: 'Windows دىكى نۆۋەتتىكى ئىشلەتكۈچىنىڭ كىملىك ئۇچۇرى بىلەن شىفىرلىنىپ بۇ كومپيۇتېردا ساقلىنىدۇ. ساقلىمىسىڭىز ھەر قېتىم ئۇلانغاندا سورىلىدۇ.',
  },
  serverSettings: { zh: '服务器设置', en: 'Server settings', ug: 'مۇلازىمېتىر تەڭشىكى' },
  saved: { zh: '已保存 {name}', en: 'Saved {name}', ug: '{name} ساقلاندى' },
  connectOnly: { zh: '仅连接', en: 'Connect only', ug: 'پەقەت ئۇلا' },
  connectOnlyTitle: {
    zh: '用这些设置连接一次，不保存',
    en: 'Connect once with these settings without saving them',
    ug: 'بۇ تەڭشەكلەر بىلەن بىر قېتىم ئۇلا، ساقلىما',
  },
  saveAndConnect: { zh: '保存并连接', en: 'Save and connect', ug: 'ساقلاپ ئۇلا' },
})

const TABS: [ServerTab, string][] = [
  ['general', t('tabGeneral')],
  ['auth', t('tabAuth')],
  ['network', t('tabNetwork')],
  ['forwards', t('tabForwards')],
  ['advanced', t('tabAdvanced')],
]

const PROTOCOLS: [string, string][] = [
  ['ssh', 'SSH'],
  ['telnet', 'Telnet'],
  ['serial', t('protocolSerial')],
]

const BAUDS = ['9600', '19200', '38400', '57600', '115200', '230400', '460800', '921600']
const DATA_BITS: [string, string][] = ['8', '7', '6', '5'].map((v) => [v, v])
const STOP_BITS: [string, string][] = [
  ['1', '1'],
  ['2', '2'],
]
const PARITIES: [string, string][] = [
  ['none', t('none')],
  ['odd', t('parityOdd')],
  ['even', t('parityEven')],
]
const FLOWS: [string, string][] = [
  ['none', t('none')],
  ['software', t('flowSoftware')],
  ['hardware', t('flowHardware')],
]

const NAME_HINTS: Record<string, string> = {
  ssh: t('nameHintSsh'),
  telnet: t('nameHintTelnet'),
  serial: t('nameHintSerial'),
}

const METHODS: [string, string][] = [
  ['password', common('password')],
  ['keyFile', t('keyFile')],
  ['keyboardInteractive', t('keyboardInteractive')],
  ['agent', 'SSH Agent'],
]

const PROXIES: [string, string][] = [
  ['none', t('noProxy')],
  ['socks5', 'SOCKS5'],
  ['http', 'HTTP CONNECT'],
]

const POLICIES: [string, string][] = [
  ['prompt', t('policyPrompt')],
  ['tofu', t('policyTofu')],
  ['strict', t('policyStrict')],
]

type Control = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement

function text(value: string, attrs: Record<string, string> = {}): HTMLInputElement {
  return h('input', { type: 'text', value, spellcheck: 'false', autocomplete: 'off', ...attrs })
}

function choice(options: [string, string][], value: string): HTMLSelectElement {
  return h(
    'select',
    {},
    options.map(([v, label]) => h('option', { value: v, selected: v === value, text: label })),
  )
}

function check(checked: boolean): HTMLInputElement {
  return h('input', { type: 'checkbox', checked })
}

/** Other saved servers; a missing saved choice stays listed so it isn't silently dropped. */
function jumpOptions(server: ServerView | null, current: string): [string, string][] {
  const others = profiles().servers.filter((s) => s.id !== server?.id)
  const options: [string, string][] = [
    ['', t('noJump')],
    ...others.map((s): [string, string] => [s.id, serverTitle(s)]),
  ]
  if (current && !others.some((s) => s.id === current)) {
    options.push([current, t('deletedServer')])
  }
  return options
}

/** Add or edit a saved server. `server` null means a new one, optionally pre-filed in `groupId`. */
export function openServerDialog(server: ServerView | null, groupId: string | null = null): void {
  const initial = serverToForm(server, groupId)
  const heading = server ? t('editTitle', { name: serverTitle(server) }) : common('newConnection')
  const parts = modal('server', heading, 'md')

  const note = h('textarea', { rows: 3, spellcheck: 'false' })
  note.value = initial.note
  const groups: [string, string][] = [
    ['', common('ungrouped')],
    ...profiles().groups.map((g): [string, string] => [g.id, g.name]),
  ]
  const portList = h('datalist', { id: 'server-serial-ports' })
  const baudList = h(
    'datalist',
    { id: 'server-bauds' },
    BAUDS.map((v) => h('option', { value: v })),
  )
  const inputs = {
    protocol: choice(PROTOCOLS, initial.protocol),
    name: text(initial.name, { placeholder: NAME_HINTS[initial.protocol] ?? '' }),
    host: text(initial.host, { placeholder: t('hostPlaceholder') }),
    port: text(initial.port, { inputmode: 'numeric' }),
    groupId: choice(groups, initial.groupId),
    note,
    serialPort: text(initial.serialPort, {
      list: portList.id,
      placeholder: t('serialPlaceholder', { a: 'COM3', b: ltr('/dev/ttyUSB0') }),
    }),
    baud: text(initial.baud, { list: baudList.id, inputmode: 'numeric' }),
    dataBits: choice(DATA_BITS, initial.dataBits),
    parity: choice(PARITIES, initial.parity),
    stopBits: choice(STOP_BITS, initial.stopBits),
    flow: choice(FLOWS, initial.flow),
    method: choice(METHODS, initial.method),
    user: text(initial.user),
    password: h('input', { type: 'password', autocomplete: 'off' }),
    keyPath: text(initial.keyPath, {
      placeholder: t('example', { value: ltr('C:\\Users\\me\\.ssh\\id_ed25519') }),
    }),
    passphrase: h('input', { type: 'password', autocomplete: 'off' }),
    policy: choice(POLICIES, initial.policy),
    connectTimeoutSecs: text(initial.connectTimeoutSecs, { inputmode: 'numeric' }),
    keepaliveSecs: text(initial.keepaliveSecs, { inputmode: 'numeric' }),
    term: text(initial.term),
    startupCommand: text(initial.startupCommand, {
      placeholder: t('example', { value: ltr('cd /var/log') }),
    }),
    initialDir: text(initial.initialDir, { placeholder: t('initialDirPlaceholder') }),
    proxyKind: choice(PROXIES, initial.proxyKind),
    proxyHost: text(initial.proxyHost, { placeholder: t('proxyHostPlaceholder') }),
    proxyPort: text(initial.proxyPort, { inputmode: 'numeric' }),
    proxyUser: text(initial.proxyUser, { placeholder: t('proxyUserPlaceholder') }),
    proxyPassword: h('input', { type: 'password', autocomplete: 'off' }),
    jumpId: choice(jumpOptions(server, initial.jumpId), initial.jumpId),
  } satisfies Partial<Record<FormField, Control>>
  const savePassword = check(initial.savePassword)
  const saveProxyPassword = check(initial.saveProxyPassword)
  const monitor = check(initial.monitor)
  const agentForward = check(initial.agentForward)
  const autoReconnect = check(initial.autoReconnect)
  const saveLabel = h('span')
  const secretHelp = h('p', { class: 'help' })
  const agentHelp = h('p', {
    class: 'help',
    text: t('agentHelp'),
  })

  const forwards: ForwardSpec[] = [...initial.forwards]
  const forwardList = h('ul', { class: 'forward-list', id: 'server-forwards' })
  const forwardError = h('p', { class: 'field-error', id: 'server-forwards-error', role: 'alert' })
  const renderForwards = () => {
    forwardList.replaceChildren(
      ...forwards.map((spec, index) =>
        h(
          'li',
          { class: 'forward-item' },
          h('span', { class: 'forward-text', text: describeForward(spec) }),
          h(
            'button',
            {
              type: 'button',
              class: 'icon-button',
              'aria-label': t('deleteForward', { name: ltr(describeForward(spec)) }),
              title: common('delete'),
              onclick: () => {
                forwards.splice(index, 1)
                renderForwards()
              },
            },
            icon('trash'),
          ),
        ),
      ),
    )
    if (forwards.length === 0) {
      forwardList.append(h('li', { class: 'forward-empty', text: t('noForwards') }))
    }
  }
  renderForwards()
  const adder = forwardAdder((spec) => {
    if (forwards.length >= MAX_SAVED_FORWARDS) return tooManyForwards()
    forwards.push(spec)
    renderForwards()
    forwardError.textContent = ''
    return null
  })

  const proxyFields = h(
    'div',
    { class: 'dialog-form' },
    h(
      'div',
      { class: 'field-row' },
      field(t('proxyHost'), inputs.proxyHost),
      field(common('port'), inputs.proxyPort),
    ),
    field(t('proxyUser'), inputs.proxyUser),
    field(t('proxyPassword'), inputs.proxyPassword),
    h('label', { class: 'check' }, saveProxyPassword, t('saveProxyPassword')),
  )
  const syncProxy = () => {
    proxyFields.hidden = inputs.proxyKind.value === 'none'
    if (!inputs.proxyPort.value.trim() && inputs.proxyKind.value !== 'none') {
      inputs.proxyPort.value = inputs.proxyKind.value === 'socks5' ? '1080' : '8080'
    }
  }
  inputs.proxyKind.addEventListener('change', syncProxy)
  syncProxy()

  const browse = button(t('browse'), async () => {
    const chosen = await open({
      multiple: false,
      directory: false,
      title: t('chooseKey'),
      defaultPath: inputs.keyPath.value.trim() || undefined,
    })
    if (typeof chosen === 'string') inputs.keyPath.value = chosen
  })
  const keys = service('keys')
  const library = keys
    ? button(t('keyLibrary'), async () => {
        const chosen = await keys.pick().catch(reportError)
        if (!chosen) return
        inputs.keyPath.value = chosen.path
        if (chosen.encrypted) inputs.passphrase.focus()
      })
    : null
  const passwordField = field(common('password'), inputs.password)
  const keyFields = h(
    'div',
    { class: 'dialog-form' },
    field(
      t('keyFile'),
      inputs.keyPath,
      t('keyFileHelp'),
      h('div', { class: 'key-path-actions' }, browse, library),
    ),
    field(t('passphrase'), inputs.passphrase, t('passphraseHelp')),
  )
  const saveRow = h('label', { class: 'check' }, savePassword, saveLabel)

  const portHelp = h('p', { class: 'help' })
  const loadPorts = async () => {
    try {
      const ports = await invoke<PortInfo[]>('serial_ports')
      portList.replaceChildren(
        ...ports.map((p) => h('option', { value: p.name, label: p.description || p.name })),
      )
      portHelp.textContent = ports.length
        ? t('portsFound', {
            n: ports.length,
            list: joinList(ports.map((p) => ltr(p.name))),
          })
        : t('noPorts')
    } catch (error) {
      portHelp.textContent = t('portsFailed', { error: describeError(error) })
    }
  }
  let portsLoaded = false
  const endpointRow = h(
    'div',
    { class: 'field-row' },
    field(common('host'), inputs.host),
    field(common('port'), inputs.port),
  )
  const serialFields = h(
    'div',
    { class: 'dialog-form' },
    field(
      t('serialPort'),
      inputs.serialPort,
      undefined,
      button(common('refresh'), () => void loadPorts()),
    ),
    portHelp,
    portList,
    baudList,
    h(
      'div',
      { class: 'field-pair' },
      field(t('baud'), inputs.baud),
      field(t('dataBits'), inputs.dataBits),
    ),
    h(
      'div',
      { class: 'field-pair' },
      field(t('parity'), inputs.parity),
      field(t('stopBits'), inputs.stopBits),
    ),
    field(t('flow'), inputs.flow),
  )
  const jumpField = field(t('jumpHost'), inputs.jumpId, t('jumpHelp'))
  const policyField = field(t('hostKey'), inputs.policy, t('policyHelp'))
  const timingFields = h(
    'div',
    { class: 'field-pair' },
    field(t('connectTimeout'), inputs.connectTimeoutSecs),
    field(t('keepalive'), inputs.keepaliveSecs, t('keepaliveHelp')),
  )
  const termField = field(t('termType'), inputs.term)
  const sshAdvanced = h(
    'div',
    { class: 'dialog-form' },
    field(t('startupCommand'), inputs.startupCommand, t('startupHelp')),
    field(t('initialDir'), inputs.initialDir),
    h('label', { class: 'check' }, monitor, t('monitor')),
  )

  const panes: Record<ServerTab, HTMLElement> = {
    general: h(
      'div',
      { class: 'dialog-form' },
      field(t('protocol'), inputs.protocol),
      field(common('name'), inputs.name),
      endpointRow,
      serialFields,
      field(t('group'), inputs.groupId),
      field(common('note'), inputs.note),
    ),
    auth: h(
      'div',
      { class: 'dialog-form' },
      field(t('method'), inputs.method),
      field(t('user'), inputs.user),
      passwordField,
      keyFields,
      agentHelp,
      h('div', { class: 'field' }, saveRow, secretHelp),
      h(
        'div',
        { class: 'field' },
        h('label', { class: 'check' }, agentForward, t('agentForward')),
        h('p', { class: 'help', text: t('agentForwardHelp') }),
      ),
    ),
    network: h(
      'div',
      { class: 'dialog-form' },
      field(t('proxy'), inputs.proxyKind, t('proxyHelp')),
      proxyFields,
      jumpField,
    ),
    forwards: h(
      'div',
      { class: 'dialog-form' },
      h('p', { class: 'help', text: t('forwardsHelp') }),
      forwardList,
      forwardError,
      adder,
    ),
    advanced: h(
      'div',
      { class: 'dialog-form' },
      policyField,
      timingFields,
      termField,
      sshAdvanced,
      h(
        'div',
        { class: 'field' },
        h('label', { class: 'check' }, autoReconnect, t('autoReconnect')),
        h('p', { class: 'help', text: t('autoReconnectHelp') }),
      ),
    ),
  }

  const syncMethod = () => {
    const method = inputs.method.value
    passwordField.hidden = method !== 'password'
    keyFields.hidden = method !== 'keyFile'
    agentHelp.hidden = method !== 'agent'
    saveRow.parentElement?.toggleAttribute('hidden', method !== 'password' && method !== 'keyFile')
    saveLabel.textContent = method === 'keyFile' ? t('savePassphrase') : t('savePassword')
    const stored = server?.auth.hasSecret && server.auth.method === method
    secretHelp.textContent = stored ? t('secretStored') : t('secretHelp')
  }
  inputs.method.addEventListener('change', syncMethod)
  syncMethod()

  const tabList = h('div', {
    class: 'dialog-tabs',
    role: 'tablist',
    'aria-label': t('serverSettings'),
  })
  const tabs = {} as Record<ServerTab, HTMLButtonElement>
  const form = h('form', { class: 'server-form', novalidate: true })
  const show = (tab: ServerTab) => {
    for (const [id] of TABS) {
      const active = id === tab
      panes[id].hidden = !active
      tabs[id].setAttribute('aria-selected', String(active))
      tabs[id].tabIndex = active ? 0 : -1
    }
  }
  for (const [id, label] of TABS) {
    tabs[id] = h('button', {
      type: 'button',
      role: 'tab',
      class: 'dialog-tab',
      id: `server-tab-${id}`,
      'aria-controls': `server-pane-${id}`,
      text: label,
      onclick: () => show(id),
    })
    panes[id].id = `server-pane-${id}`
    panes[id].setAttribute('role', 'tabpanel')
    panes[id].setAttribute('aria-labelledby', tabs[id].id)
    tabList.append(tabs[id])
    form.append(panes[id])
  }
  tabList.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    const visible = TABS.filter(([id]) => !tabs[id].hidden)
    const index = visible.findIndex(([id]) => tabs[id].getAttribute('aria-selected') === 'true')
    // Tabs run right to left in right-to-left text.
    const rtl = getComputedStyle(tabList).direction === 'rtl'
    const step = (event.key === 'ArrowRight') !== rtl ? 1 : -1
    const [next] = visible[(index + step + visible.length) % visible.length]
    show(next)
    tabs[next].focus()
  })
  const formError = h('p', { class: 'field-error', role: 'alert' })
  parts.body.append(tabList, form, formError)
  show('general')

  let protocol = initial.protocol
  const syncProtocol = () => {
    const previous = protocol
    protocol = inputs.protocol.value
    const ssh = protocol === 'ssh'
    const serial = protocol === 'serial'
    endpointRow.hidden = serial
    serialFields.hidden = !serial
    tabs.auth.hidden = !ssh
    tabs.forwards.hidden = !ssh
    tabs.network.hidden = serial
    tabs.network.textContent = ssh ? t('tabNetwork') : t('proxy')
    jumpField.hidden = !ssh
    policyField.hidden = !ssh
    sshAdvanced.hidden = !ssh
    timingFields.hidden = serial
    termField.hidden = serial
    inputs.name.placeholder = NAME_HINTS[protocol] ?? ''
    const port = inputs.port.value.trim()
    if (!serial && (!port || port === String(defaultPort(previous)))) {
      inputs.port.value = String(defaultPort(protocol))
    }
    if (serial && !portsLoaded) {
      portsLoaded = true
      void loadPorts()
    }
  }
  inputs.protocol.addEventListener('change', syncProtocol)
  syncProtocol()

  const readForm = (): ServerForm => ({
    protocol: inputs.protocol.value,
    name: inputs.name.value,
    host: inputs.host.value,
    port: inputs.port.value,
    groupId: inputs.groupId.value,
    note: inputs.note.value,
    serialPort: inputs.serialPort.value,
    baud: inputs.baud.value,
    dataBits: inputs.dataBits.value,
    parity: inputs.parity.value,
    stopBits: inputs.stopBits.value,
    flow: inputs.flow.value,
    method: inputs.method.value,
    user: inputs.user.value,
    password: inputs.password.value,
    savePassword: savePassword.checked,
    keyPath: inputs.keyPath.value,
    passphrase: inputs.passphrase.value,
    policy: inputs.policy.value,
    connectTimeoutSecs: inputs.connectTimeoutSecs.value,
    keepaliveSecs: inputs.keepaliveSecs.value,
    term: inputs.term.value,
    startupCommand: inputs.startupCommand.value,
    initialDir: inputs.initialDir.value,
    monitor: monitor.checked,
    agentForward: agentForward.checked,
    proxyKind: inputs.proxyKind.value,
    proxyHost: inputs.proxyHost.value,
    proxyPort: inputs.proxyPort.value,
    proxyUser: inputs.proxyUser.value,
    proxyPassword: inputs.proxyPassword.value,
    saveProxyPassword: saveProxyPassword.checked,
    jumpId: inputs.jumpId.value,
    forwards: [...forwards],
    autoReconnect: autoReconnect.checked,
  })

  /** Validates, marks bad fields and jumps to the first tab with an error. */
  const validate = (): ServerDraft | null => {
    for (const control of Object.values(inputs)) setFieldError(control, '')
    forwardError.textContent = ''
    for (const [id] of TABS) tabs[id].removeAttribute('data-invalid')
    const parsed = parseServerForm(readForm())
    if (parsed.ok) return parsed.value
    for (const error of parsed.errors) {
      const control = (inputs as Partial<Record<FormField, Control>>)[error.field]
      if (control) setFieldError(control, error.message)
      else if (error.field === 'forwards') forwardError.textContent = error.message
      tabs[error.tab].dataset.invalid = 'true'
    }
    const first = parsed.errors[0]
    show(first.tab)
    ;(inputs as Partial<Record<FormField, Control>>)[first.field]?.focus()
    return null
  }

  const actionButtons: HTMLButtonElement[] = []
  const busy = (on: boolean) => {
    for (const b of actionButtons) b.disabled = on
  }
  const save = async (connect: boolean) => {
    const draft = validate()
    if (!draft) return
    busy(true)
    formError.textContent = ''
    let saved: ServerView
    try {
      saved = await withUnlock(() =>
        invoke<ServerView>('profile_save', { input: draftToInput(draft, server) }),
      )
    } catch (error) {
      formError.textContent = describeError(error)
      busy(false)
      return
    }
    parts.dialog.close()
    setStatus(t('saved', { name: serverTitle(saved) }))
    await reloadProfiles().catch(reportError)
    if (connect) await connectServers([saved])
  }
  const connectOnly = () => {
    const draft = validate()
    if (!draft) return
    parts.dialog.close()
    const title = endpointTitle(draft.name, draft.user, draft.host, draft.advanced)
    // The tab, status bar and app log already show why a connection failed.
    openAdhoc(
      {
        name: draft.name,
        host: draft.host,
        port: draft.port,
        auth: {
          method: draft.method,
          user: draft.user,
          keyPath: draft.keyPath,
          secret: draft.secret || null,
        },
        advanced: draft.advanced,
        proxyPassword: draft.proxySecret || null,
      },
      title,
    ).catch(() => {})
  }
  form.addEventListener('submit', (event) => {
    event.preventDefault()
    void save(false)
  })
  // Enter in a text field submits the form even though the submit buttons live outside it.
  form.append(h('button', { type: 'submit', hidden: true, tabindex: '-1' }))

  actionButtons.push(
    button(t('connectOnly'), connectOnly, 'quiet'),
    button(common('cancel'), () => parts.dialog.close()),
    button(common('save'), () => void save(false)),
    button(t('saveAndConnect'), () => void save(true), 'primary'),
  )
  actionButtons[0].title = t('connectOnlyTitle')
  parts.actions.append(actionButtons[0], h('span', { class: 'grow' }), ...actionButtons.slice(1))

  parts.dialog.addEventListener('close', () => {
    inputs.password.value = ''
    inputs.passphrase.value = ''
    inputs.proxyPassword.value = ''
    parts.dialog.remove()
  })
  parts.dialog.showModal()
  ;(server ? inputs.name : inputs.protocol).focus()
}
