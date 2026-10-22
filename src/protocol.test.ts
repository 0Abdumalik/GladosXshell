import { describe, expect, it } from 'vitest'
import { niceMax, pushSample, type Sample } from './charts'
import { commandInput, commandSummary, favoriteErrors, matchesQuery } from './commands-model'
import {
  addRecord,
  closeTabRecords,
  dismiss,
  matchesRecord,
  recordsIn,
  updateRecord,
} from './downloads'
import { baseName, sortEntries, visibleEntries } from './file-list'
import {
  bitsToMode,
  extension,
  formatBytes,
  formatOctal,
  formatRate,
  formatThroughput,
  formatUptime,
  joinRemote,
  modeToBits,
  parentDir,
  parseOctal,
  runLimited,
  validRemoteName,
} from './format'
import { describeForward, parseForward } from './forward-spec'
import { polishCommand, polishKindFor, polishText } from './polish'
import {
  DEFAULT_ADVANCED,
  DEFAULT_PROXY,
  DEFAULT_SERIAL,
  describeError,
  describeErrorText,
  describeExit,
  type Entry,
  exitIsAbnormal,
  type ServerView,
} from './protocol'
import {
  parseServerForm,
  proxySecretUpdate,
  type ServerDraft,
  secretUpdate,
  serverToForm,
} from './server-form'
import {
  DEFAULT_FILE_COLUMNS,
  moveColumn,
  moveItem,
  panelsByRegion,
  presetPanels,
  resizeColumn,
  toggleColumn,
  validLocalPath,
} from './settings-model'

describe('describeError', () => {
  it('explains errors known only by their message text', () => {
    expect(describeErrorText('ssh error: Disconnected')).toBe('服务器关闭了连接。')
    expect(describeErrorText('session is closed')).toBe('会话已关闭。')
    expect(describeErrorText('权限不足')).toBe('权限不足')
  })

  it('keeps the fingerprint detail for a changed host key', () => {
    const text = describeError({ kind: 'host_key_changed', message: 'presented SHA256:abc' })
    expect(text).toContain('中间人攻击')
    expect(text).toContain('SHA256:abc')
  })

  it('falls back to the backend message and strips known English prefixes', () => {
    expect(describeError({ kind: 'io', message: 'connection refused' })).toBe('connection refused')
    expect(describeError({ kind: 'exists', message: 'already exists: /srv/a.txt' })).toBe(
      '/srv/a.txt',
    )
    expect(describeError('boom')).toBe('boom')
  })

  it('explains raw transport errors', () => {
    expect(describeError({ kind: 'io', message: 'i/o error: connection timed out' })).toBe(
      '操作超时：服务器没有响应。',
    )
    expect(describeError({ kind: 'ssh', message: 'ssh error: Keepalive timeout' })).toContain(
      '保活超时',
    )
    expect(describeError({ kind: 'ssh', message: 'ssh error: Weird thing' })).toBe(
      'SSH 错误：Weird thing',
    )
    expect(
      describeError({
        kind: 'io',
        message: 'i/o error: 远程主机强迫关闭了一个现有的连接。 (os error 10054)',
      }),
    ).toBe('连接被服务器或网络重置。')
    expect(describeError({ kind: 'sftp', message: 'sftp error: Timeout' })).toContain('SFTP')
  })

  it('shows connect errors as written by the backend', () => {
    const message = '连接 h:22 超时：10 秒内没有收到响应。'
    expect(describeError({ kind: 'connect', message })).toBe(message)
  })

  it('names the problem for path-only messages', () => {
    expect(describeError({ kind: 'not_found', message: 'not found: /srv/a.txt' })).toBe(
      '找不到：/srv/a.txt',
    )
    expect(describeError({ kind: 'permission_denied', message: 'permission denied: /etc/x' })).toBe(
      '没有权限：/etc/x',
    )
  })
})

describe('describeExit', () => {
  it('prefers error, then signal, then code', () => {
    expect(describeExit({ code: 1, signal: 'KILL', error: 'lost' })).toContain('lost')
    expect(describeExit({ code: 1, signal: 'KILL', error: null })).toContain('KILL')
    expect(describeExit({ code: 3, signal: null, error: null })).toContain('3')
  })

  it('tells a dropped connection from the shell exiting', () => {
    const lost = { code: null, signal: null, error: 'connection lost' }
    expect(describeExit(lost)).toContain('连接已断开')
    expect(exitIsAbnormal(lost)).toBe(true)
    expect(exitIsAbnormal({ code: null, signal: 'HUP', error: null })).toBe(true)
    expect(exitIsAbnormal({ code: 1, signal: null, error: null })).toBe(false)
    expect(describeExit({ code: null, signal: null, error: 'toString' })).toBe('会话结束：toString')
  })
})

describe('formatting', () => {
  it('formats bytes with binary units', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(1023)).toBe('1023 B')
    expect(formatBytes(1536)).toBe('1.50 KB')
    expect(formatBytes(47.3 * 1024 * 1024)).toBe('47.3 MB')
    expect(formatBytes(612 * 1024 ** 3)).toBe('612 GB')
  })

  it('formats rates and throughput', () => {
    expect(formatRate(null)).toBe('—')
    expect(formatRate(2048)).toBe('2.00 KB/s')
    expect(formatThroughput(64 * 1024 * 1024, 2000)).toBe('32.0 MB/s')
  })

  it('formats uptime', () => {
    expect(formatUptime(59)).toBe('0 分')
    expect(formatUptime(3 * 3600 + 7 * 60)).toBe('3 小时 7 分')
    expect(formatUptime(12 * 86400 + 5 * 3600 + 59)).toBe('12 天 5 小时')
  })
})

describe('permissions', () => {
  it('converts between mode and rwx bits', () => {
    const bits = modeToBits(0o754)
    expect(bits).toEqual([true, true, true, true, false, true, true, false, false])
    expect(bitsToMode(bits)).toBe(0o754)
  })

  it('keeps special bits from the base mode', () => {
    expect(bitsToMode(modeToBits(0o755), 0o4755)).toBe(0o4755)
    expect(formatOctal(0o4755)).toBe('4755')
    expect(formatOctal(0o40644)).toBe('644')
    expect(formatOctal(0o7)).toBe('007')
  })

  it('parses only 3 or 4 octal digits', () => {
    expect(parseOctal(' 644 ')).toBe(0o644)
    expect(parseOctal('1777')).toBe(0o1777)
    for (const bad of ['', '64', '888', '12345', '6a4']) expect(parseOctal(bad)).toBeNull()
  })
})

describe('remote paths', () => {
  it('finds parents and joins names', () => {
    expect(parentDir('/srv/www/')).toBe('/srv')
    expect(parentDir('/srv')).toBe('/')
    expect(parentDir('/')).toBe('/')
    expect(joinRemote('/', 'etc')).toBe('/etc')
    expect(joinRemote('/srv', 'a.txt')).toBe('/srv/a.txt')
  })

  it('rejects names that are not a single path component', () => {
    expect(validRemoteName('notes.md')).toBe(true)
    for (const bad of ['', '.', '..', 'a/b', 'a\0b', 'x'.repeat(256)]) {
      expect(validRemoteName(bad)).toBe(false)
    }
  })

  it('extracts lowercase extensions but not from dotfiles', () => {
    expect(extension('Photo.JPG')).toBe('jpg')
    expect(extension('.bashrc')).toBe('')
    expect(extension('Makefile')).toBe('')
  })

  it('takes the last component of Windows and POSIX paths', () => {
    expect(baseName('C:\\Users\\dev\\report.pdf')).toBe('report.pdf')
    expect(baseName('/var/log/')).toBe('log')
    expect(baseName('D:\\builds\\')).toBe('builds')
  })
})

describe('runLimited', () => {
  it('caps concurrency and keeps going after a failure', async () => {
    let active = 0
    let peak = 0
    const done: number[] = []
    await runLimited([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      active += 1
      peak = Math.max(peak, active)
      await new Promise((resolve) => setTimeout(resolve, 5))
      active -= 1
      if (n === 2) throw new Error('fail')
      done.push(n)
    })
    expect(peak).toBe(3)
    expect(done.sort()).toEqual([1, 3, 4, 5, 6, 7])
  })
})

const entry = (name: string, kind: Entry['kind'], size = 0, targetIsDir = false): Entry => ({
  name,
  path: `/srv/${name}`,
  kind,
  size,
  mode: 0o644,
  perms: '-rw-r--r--',
  uid: 0,
  gid: 0,
  owner: 'root',
  group: 'root',
  mtime: 1_700_000_000,
  linkTarget: null,
  targetIsDir,
})

describe('file list', () => {
  const entries = [
    entry('b.log', 'file', 300),
    entry('a.log', 'file', 300),
    entry('data', 'dir'),
    entry('c.txt', 'file', 12),
    entry('current', 'symlink', 0, true),
    entry('.env', 'file', 41),
  ]

  it('sorts folders first and breaks ties by name', () => {
    const names = sortEntries(entries, 'size', true).map((e) => e.name)
    expect(names.slice(0, 2).sort()).toEqual(['current', 'data'])
    expect(names.slice(2)).toEqual(['b.log', 'a.log', '.env', 'c.txt'])
    const asc = sortEntries(entries, 'size', false).map((e) => e.name)
    expect(asc.slice(2)).toEqual(['c.txt', '.env', 'a.log', 'b.log'])
  })

  it('hides dotfiles unless asked', () => {
    expect(visibleEntries(entries, false).some((e) => e.name === '.env')).toBe(false)
    expect(visibleEntries(entries, true)).toHaveLength(entries.length)
  })
})

describe('settings model', () => {
  it('accepts drive and UNC paths only', () => {
    expect(validLocalPath('')).toBe(true)
    expect(validLocalPath('D:\\Work\\gx')).toBe(true)
    expect(validLocalPath('\\\\nas\\share\\gx')).toBe(true)
    expect(validLocalPath('relative\\dir')).toBe(false)
    expect(validLocalPath('/home/dev')).toBe(false)
  })

  it('moves items within bounds', () => {
    expect(moveItem(['a', 'b', 'c'], 0, 1)).toEqual(['b', 'a', 'c'])
    expect(moveItem(['a', 'b', 'c'], 0, -1)).toEqual(['a', 'b', 'c'])
    expect(moveItem(['a', 'b', 'c'], 2, 1)).toEqual(['a', 'b', 'c'])
  })

  it('edits file columns', () => {
    const cols = DEFAULT_FILE_COLUMNS.map((c) => ({ ...c }))
    const ids = (list: { id: string }[]) => list.map((c) => c.id)
    // group is hidden, so owner cannot move past it and size skips nothing.
    expect(ids(moveColumn(cols, 'owner', 1))).toEqual(ids(cols))
    expect(ids(moveColumn(cols, 'size', -1)).slice(0, 2)).toEqual(['size', 'name'])
    const hiddenKind = toggleColumn(cols, 'kind')
    expect(ids(moveColumn(hiddenKind, 'size', 1)).slice(0, 4)).toEqual([
      'name',
      'mtime',
      'kind',
      'size',
    ])
    expect(toggleColumn(cols, 'name')[0].visible).toBe(true)
    expect(resizeColumn(cols, 'size', 5)[1].width).toBe(40)
    expect(resizeColumn(cols, 'size', 99.6)[1].width).toBe(100)
    expect(cols[1].width).toBe(88)
  })

  it('groups preset panels by region', () => {
    expect(panelsByRegion(presetPanels('finalshell'))).toEqual({
      left: ['status'],
      right: [],
      bottom: ['files', 'commands'],
    })
    expect(panelsByRegion(presetPanels('sidebar')).left).toEqual([
      'connections',
      'status',
      'files',
      'commands',
    ])
    expect(panelsByRegion(presetPanels('terminal'))).toEqual({ left: [], right: [], bottom: [] })
  })

  it('returns fresh copies of presets', () => {
    const first = presetPanels('finalshell')
    first[0].region = 'hidden'
    expect(presetPanels('finalshell')[0].region).toBe('left')
  })

  it('puts plugin panels where they ask, translated to the preset', () => {
    const current = [
      { id: 'files', region: 'left' as const },
      { id: 'forwards', region: 'hidden' as const },
      { id: 'x.y/side', region: 'hidden' as const },
      { id: 'x.y/gone', region: 'bottom' as const },
    ]
    const wanted = (id: string) =>
      ({ forwards: 'bottom', 'x.y/side': 'right' })[id] as 'bottom' | 'right' | undefined
    const extras = (preset: Parameters<typeof presetPanels>[0]) =>
      presetPanels(preset, current, wanted).slice(4)
    expect(extras('finalshell')).toEqual([
      { id: 'forwards', region: 'bottom' },
      { id: 'x.y/side', region: 'right' },
      { id: 'x.y/gone', region: 'hidden' },
    ])
    expect(extras('sidebar').map((p) => p.region)).toEqual(['left', 'left', 'hidden'])
    expect(extras('filesRight').map((p) => p.region)).toEqual(['right', 'right', 'hidden'])
    expect(extras('terminal').map((p) => p.region)).toEqual(['hidden', 'hidden', 'hidden'])
  })
})

describe('server form', () => {
  const valid = { ...serverToForm(null), name: '旁路由', host: '192.168.1.2', password: 'pw' }

  it('parses a valid form with defaults', () => {
    const parsed = parseServerForm({ ...valid, port: '' })
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.value.port).toBe(22)
    expect(parsed.value.secret).toBe('pw')
    expect(parsed.value.advanced).toEqual(DEFAULT_ADVANCED)
  })

  it('reports each error with its tab', () => {
    const parsed = parseServerForm({
      ...valid,
      host: 'a b',
      method: 'keyFile',
      keyPath: '',
      connectTimeoutSecs: '0',
      startupCommand: 'ls\nrm',
    })
    expect(parsed.ok).toBe(false)
    if (parsed.ok) return
    expect(parsed.errors.map((e) => [e.field, e.tab])).toEqual([
      ['host', 'general'],
      ['keyPath', 'auth'],
      ['connectTimeoutSecs', 'advanced'],
      ['startupCommand', 'advanced'],
    ])
  })

  it.each(['0', '65536', '22.5', 'abc', '-1'])('rejects port %s', (port) => {
    expect(parseServerForm({ ...valid, port }).ok).toBe(false)
  })

  it('rejects unknown policies instead of falling back to a weaker one', () => {
    expect(parseServerForm({ ...valid, policy: 'accept-all' }).ok).toBe(false)
  })

  const original: ServerView = {
    id: 's1',
    name: '旁路由',
    groupId: null,
    host: '192.168.1.2',
    port: 22,
    note: '',
    auth: { method: 'password', user: 'root', keyPath: '', hasSecret: true },
    advanced: { ...DEFAULT_ADVANCED },
    hasProxySecret: true,
    lastConnectedAt: null,
  }
  const draft = (patch: Partial<ServerDraft>): ServerDraft => {
    const parsed = parseServerForm(valid)
    if (!parsed.ok) throw new Error('fixture must parse')
    return { ...parsed.value, ...patch }
  }

  it('agent auth carries and saves no secret', () => {
    const parsed = parseServerForm({ ...valid, method: 'agent', savePassword: true })
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.value.secret).toBe('')
    expect(parsed.value.savePassword).toBe(false)
  })

  it('parses proxy settings and keeps proxy and jump host exclusive', () => {
    const proxied = { ...valid, proxyKind: 'socks5', proxyHost: ' 10.0.0.1 ', proxyPort: '' }
    const parsed = parseServerForm({ ...proxied, proxyUser: 'u', proxyPassword: 'p' })
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.value.advanced.proxy).toEqual({
      kind: 'socks5',
      host: '10.0.0.1',
      port: 1080,
      user: 'u',
    })
    expect(parsed.value.proxySecret).toBe('p')
    const both = parseServerForm({ ...proxied, jumpId: 's2' })
    expect(!both.ok && both.errors.map((e) => [e.field, e.tab])).toEqual([['jumpId', 'network']])
    const noHost = parseServerForm({ ...valid, proxyKind: 'http', proxyHost: '' })
    expect(!noHost.ok && noHost.errors[0].field).toBe('proxyHost')
  })

  it('drops proxy fields when no proxy is used', () => {
    const parsed = parseServerForm({ ...valid, proxyHost: 'x', proxyPassword: 'p' })
    expect(parsed.ok && parsed.value.advanced.proxy).toEqual(DEFAULT_PROXY)
    expect(parsed.ok && parsed.value.proxySecret).toBe('')
  })

  it('telnet needs no user, defaults to port 23 and refuses jump hosts', () => {
    const telnet = { ...valid, protocol: 'telnet', port: '', user: '', forwards: [] }
    const parsed = parseServerForm({ ...telnet, password: 'pw', savePassword: true })
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.value.port).toBe(23)
    expect(parsed.value.secret).toBe('')
    expect(parsed.value.savePassword).toBe(false)
    expect(parsed.value.advanced.protocol).toBe('telnet')
    expect(parsed.value.advanced.monitor).toBe(false)
    const jumped = parseServerForm({ ...telnet, jumpId: 's2' })
    expect(!jumped.ok && jumped.errors.map((e) => [e.field, e.tab])).toEqual([
      ['jumpId', 'network'],
    ])
  })

  it('serial ignores host, port and auth and validates the line settings', () => {
    const serial = {
      ...valid,
      protocol: 'serial',
      host: 'a b',
      port: 'x',
      user: '',
      serialPort: ' COM3 ',
    }
    const parsed = parseServerForm({ ...serial, baud: '9600', parity: 'even', jumpId: 's2' })
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.value.host).toBe('')
    expect(parsed.value.port).toBe(0)
    expect(parsed.value.advanced.jumpId).toBeNull()
    expect(parsed.value.advanced.serial).toEqual({
      ...DEFAULT_SERIAL,
      port: 'COM3',
      baud: 9600,
      parity: 'even',
    })
    const bad = parseServerForm({
      ...serial,
      serialPort: '',
      baud: '0',
      dataBits: '9',
      stopBits: '3',
    })
    expect(!bad.ok && bad.errors.map((e) => e.field)).toEqual([
      'serialPort',
      'baud',
      'dataBits',
      'stopBits',
    ])
  })

  it('keeps, clears or sets the stored proxy password', () => {
    const proxied = (patch: Partial<ServerDraft>) =>
      draft({ saveProxyPassword: true, proxySecret: '', ...patch })
    expect(proxySecretUpdate(proxied({}), original)).toEqual({ action: 'keep' })
    expect(proxySecretUpdate(proxied({ proxySecret: 'n' }), original)).toEqual({
      action: 'set',
      value: 'n',
    })
    expect(proxySecretUpdate(proxied({ saveProxyPassword: false }), original)).toEqual({
      action: 'clear',
    })
    expect(proxySecretUpdate(proxied({}), null)).toEqual({ action: 'clear' })
  })

  it('keeps, clears or sets the stored secret', () => {
    expect(secretUpdate(draft({ secret: '' }), original)).toEqual({ action: 'keep' })
    expect(secretUpdate(draft({ secret: 'new' }), original)).toEqual({
      action: 'set',
      value: 'new',
    })
    expect(secretUpdate(draft({ savePassword: false }), original)).toEqual({ action: 'clear' })
    expect(secretUpdate(draft({ secret: '', method: 'keyFile' }), original)).toEqual({
      action: 'clear',
    })
    expect(secretUpdate(draft({ secret: '' }), null)).toEqual({ action: 'clear' })
  })
})

describe('forward spec', () => {
  const fields = { kind: 'local', bind: '8080', dest: 'db:5432', label: '' }

  it('parses bind and destination addresses', () => {
    expect(parseForward(fields)).toEqual({
      ok: true,
      value: {
        kind: 'local',
        bindHost: '127.0.0.1',
        bindPort: 8080,
        destHost: 'db',
        destPort: 5432,
        label: '',
      },
    })
    const v6 = parseForward({ ...fields, kind: 'remote', bind: '[::]:0', dest: '[::1]:80' })
    expect(v6.ok && [v6.value.bindHost, v6.value.bindPort, v6.value.destHost]).toEqual([
      '::',
      0,
      '::1',
    ])
    const socks = parseForward({ ...fields, kind: 'dynamic', bind: '0.0.0.0:1080', dest: 'x' })
    expect(socks.ok && [socks.value.destHost, socks.value.destPort]).toEqual(['', 0])
  })

  it.each([
    ['bind', 'abc'],
    ['bind', '70000'],
    ['bind', 'a b:1'],
    ['dest', '5432'],
    ['dest', 'db:0'],
    ['kind', 'sideways'],
  ])('rejects %s %s', (key, value) => {
    expect(parseForward({ ...fields, [key]: value }).ok).toBe(false)
  })

  it('describes forwards like ssh flags', () => {
    const parsed = parseForward({ ...fields, label: '数据库' })
    if (!parsed.ok) throw new Error('fixture must parse')
    expect(describeForward(parsed.value)).toBe('数据库（-L 127.0.0.1:8080 → db:5432）')
    expect(describeForward({ ...parsed.value, kind: 'dynamic', label: '' }, 1081)).toBe(
      '-D 127.0.0.1:1081',
    )
  })
})

describe('charts', () => {
  it('rounds axis maxima to 1, 2 or 5 steps', () => {
    expect(niceMax(0)).toBe(1)
    expect(niceMax(37)).toBe(50)
    expect(niceMax(120)).toBe(200)
    expect(niceMax(3 * 1024 * 1024, true)).toBe(5 * 1024 * 1024)
  })

  it('keeps only the latest 120 samples', () => {
    const list: Sample[] = []
    for (let i = 0; i < 130; i++) pushSample(list, i)
    expect(list).toHaveLength(120)
    expect(list[0]).toBe(10)
    expect(list[119]).toBe(129)
  })
})

describe('commands model', () => {
  it('types each line followed by Enter', () => {
    expect(commandInput('ls -la')).toBe('ls -la\r')
    expect(commandInput('cd /tmp\r\nls\n\n')).toBe('cd /tmp\rls\r')
  })

  it('validates favorites', () => {
    expect(favoriteErrors('  ', '').command).toBe('请输入指令')
    expect(favoriteErrors('uptime', 'x'.repeat(2001)).note).not.toBe('')
    expect(favoriteErrors('uptime', '负载')).toEqual({ command: '', note: '' })
  })

  it('matches every word against command and note', () => {
    expect(matchesQuery('nginx 日志', 'journalctl -u nginx', '看 nginx 日志')).toBe(true)
    expect(matchesQuery('NGINX', 'journalctl -u nginx')).toBe(true)
    expect(matchesQuery('nginx mysql', 'journalctl -u nginx')).toBe(false)
    expect(matchesQuery('  ', 'anything')).toBe(true)
  })

  it('summarises the first non-empty line', () => {
    expect(commandSummary('\n  df -h  \n')).toBe('df -h')
    expect(commandSummary('cd /srv\nmake')).toBe('cd /srv …')
    expect(commandSummary('abcdef', 3)).toBe('abc…')
  })
})

describe('polish', () => {
  it('tidies whitespace in text files', () => {
    const result = polishText('a  \n\n\n\n\nb\t\n\n\n')
    expect(result.text).toBe('a\n\n\nb\n')
    expect(result.changes.length).toBeGreaterThan(0)
    expect(polishText('a\nb\n')).toEqual({ text: 'a\nb\n', changes: [] })
    expect(polishText('a\r\nb').text).toBe('a\nb\n')
  })

  it('keeps markdown hard breaks', () => {
    expect(polishText('line  \nnext\n', 'markdown').text).toBe('line  \nnext\n')
  })

  it('pretty-prints JSON only when lossless', () => {
    expect(polishText('{"a":1,"b":[true,null]}', 'json').text).toBe(
      '{\n  "a": 1,\n  "b": [\n    true,\n    null\n  ]\n}\n',
    )
    expect(polishText('{\n    "a":1}', 'json').text).toBe('{\n    "a": 1\n}\n')
    expect(polishText('{"id": 12345678901234567890}', 'json').text).toBe(
      '{"id": 12345678901234567890}\n',
    )
    expect(polishText('{"a":1,"a":2}', 'json').text).toBe('{"a":1,"a":2}\n')
    expect(polishText('{"a":"\\u00e9"}', 'json').text).toBe('{"a":"\\u00e9"}\n')
    expect(polishText('{ broken', 'json').text).toBe('{ broken\n')
    expect(polishKindFor('package.JSON')).toBe('json')
    expect(polishKindFor('README.md')).toBe('markdown')
  })

  it('fixes commands pasted from documents', () => {
    expect(polishCommand('$ apt update\n$ apt install – y nginx').text).toBe(
      'apt update\napt install – y nginx',
    )
    expect(polishCommand('ls —all “my dir”').text).toBe('ls --all "my dir"')
    expect(polishCommand('echo "他说“好”"').text).toBe('echo "他说“好”"')
    expect(polishCommand('a b​').text).toBe('a b')
  })

  it('repairs continuations, tabs and blank lines', () => {
    const result = polishCommand('\n\ndocker run \\  \n-d \\\n\tnginx\n\n\n\nuptime\n\n')
    expect(result.text).toBe('docker run \\\n  -d \\\n  nginx\n\nuptime')
    expect(result.changes.some((c) => c.includes('续行符'))).toBe(true)
  })

  it('leaves heredoc bodies alone', () => {
    const text = "cat <<'EOF' > a.txt\n\tkeep  \n\n\nEOF\n$ not a prompt"
    expect(polishCommand(text).text).toBe(text)
    expect(polishCommand('cat <<<"x"\nls  ').text).toBe('cat <<<"x"\nls')
  })
})

describe('download records', () => {
  it('keeps previews per tab and downloads in both views', () => {
    const tab1 = { key: 1, title: '旁路由' }
    const tab2 = { key: 2, title: 'web-01' }
    const file = addRecord('download', tab1, 'a.tar.gz', '/srv/a.tar.gz')
    const preview = addRecord('preview', tab1, 'logo.png', '/srv/logo.png')
    const other = addRecord('download', tab2, 'b.log', '/var/log/b.log')
    expect(recordsIn({ type: 'global' })).toEqual([other, file])
    expect(recordsIn({ type: 'tab', key: 1 })).toEqual([preview, file])
    expect(matchesRecord(other, 'web-01 log')).toBe(true)

    dismiss({ type: 'tab', key: 1 }, () => true)
    expect(recordsIn({ type: 'tab', key: 1 })).toHaveLength(2)

    updateRecord(file, { state: 'done' })
    updateRecord(preview, { state: 'done' })
    expect(file.finishedAt).not.toBeNull()
    dismiss({ type: 'tab', key: 1 }, (r) => r === preview)
    expect(recordsIn({ type: 'tab', key: 1 })).toEqual([file])

    closeTabRecords(1)
    expect(recordsIn({ type: 'tab', key: 1 })).toEqual([])
    expect(recordsIn({ type: 'global' })).toEqual([other, file])
  })
})
