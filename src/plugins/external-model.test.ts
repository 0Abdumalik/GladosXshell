import { describe, expect, it } from 'vitest'
import { DEFAULT_ADVANCED, type ServerView } from '../protocol'
import {
  type ExternalManifest,
  httpPermission,
  MENU_PLACES,
  matchesWhen,
  menuEntries,
  PERMISSION_TEXT,
  parseContributions,
  parseWhen,
  permissionFor,
  pluginServer,
  pluginUrl,
  profilePatch,
  text,
  validPage,
} from './external-model'

const manifest = (contributes: Record<string, unknown>): ExternalManifest => ({
  id: 'demo.hello',
  name: 'Hello',
  version: '1.0.0',
  engine: 1,
  description: '',
  permissions: [],
  contributes,
})

describe('httpPermission', () => {
  it('names the host, and the port only when written out', () => {
    expect(httpPermission('https://api.example.com/v1?q=1')).toBe('http:api.example.com')
    expect(httpPermission('http://example.com:8080/')).toBe('http:example.com:8080')
    expect(httpPermission('https://example.com:443/')).toBe('http:example.com')
  })

  it('refuses other schemes, credentials and junk', () => {
    expect(httpPermission('file:///etc/passwd')).toBeNull()
    expect(httpPermission('http://user:pw@example.com/')).toBeNull()
    expect(httpPermission('not a url')).toBeNull()
  })
})

describe('permissionFor', () => {
  it('maps methods to permissions', () => {
    expect(permissionFor('sessions.exec', [])).toBe('sessions.exec')
    expect(permissionFor('terminal.watch', [])).toBe('terminal.read')
    expect(permissionFor('files.writeText', [])).toBe('files.write')
    expect(permissionFor('terminal.watchInput', [])).toBe('terminal.input')
    expect(permissionFor('profiles.list', [])).toBe('profiles.read')
    expect(permissionFor('profiles.save', [])).toBe('profiles.write')
    expect(permissionFor('profiles.remove', [])).toBe('profiles.write')
    expect(permissionFor('ui.status', [])).toBeNull()
  })

  it('describes every permission it asks for', () => {
    for (const method of ['terminal.watchInput', 'profiles.list', 'profiles.save']) {
      const permission = permissionFor(method, []) as string
      expect(PERMISSION_TEXT[permission]).toBeTruthy()
    }
  })

  it('derives the http permission from the url', () => {
    expect(permissionFor('http.request', ['https://example.com/a'])).toBe('http:example.com')
    expect(permissionFor('http.request', ['ftp://example.com'])).toBeInstanceOf(Error)
    expect(permissionFor('http.request', [42])).toBeInstanceOf(Error)
  })
})

const saved = (over: Partial<ServerView> = {}): ServerView => ({
  id: 's1',
  name: 'web',
  groupId: 'g1',
  host: 'web.example.net',
  port: 22,
  note: '',
  auth: { method: 'password', user: 'deploy', keyPath: '', hasSecret: true },
  advanced: { ...DEFAULT_ADVANCED, agentForward: true, startupCommand: 'cd /srv' },
  hasProxySecret: false,
  lastConnectedAt: 1759700000,
  ...over,
})

describe('pluginServer', () => {
  it('leaves out key paths, secrets and advanced settings', () => {
    const view = pluginServer(
      saved({ auth: { method: 'keyFile', user: 'u', keyPath: 'C:/k', hasSecret: true } }),
    )
    expect(view).toEqual({
      id: 's1',
      name: 'web',
      groupId: 'g1',
      host: 'web.example.net',
      port: 22,
      user: 'u',
      method: 'keyFile',
      note: '',
      jumpId: null,
      hasPassword: true,
      lastConnectedAt: 1759700000,
    })
    expect(JSON.stringify(view)).not.toContain('C:/k')
  })
})

describe('profilePatch', () => {
  it('keeps everything a patch does not name', () => {
    const input = profilePatch(saved(), { note: '生产环境' })
    expect(input.id).toBe('s1')
    expect(input.note).toBe('生产环境')
    expect(input.host).toBe('web.example.net')
    expect(input.auth).toEqual({
      method: 'password',
      user: 'deploy',
      keyPath: '',
      secret: { action: 'keep' },
    })
    expect(input.advanced.agentForward).toBe(true)
    expect(input.advanced.startupCommand).toBe('cd /srv')
    expect(input.proxySecret).toEqual({ action: 'keep' })
  })

  it('drops the saved password and agent forwarding when the server moves', () => {
    const moved = profilePatch(saved(), { host: 'other.example.net' })
    expect(moved.auth.secret).toEqual({ action: 'clear' })
    expect(moved.advanced.agentForward).toBe(false)
    const port = profilePatch(saved(), { port: 2222 })
    expect(port.auth.secret).toEqual({ action: 'clear' })
  })

  it('keeps a key passphrase on a move, since the key file stays local', () => {
    const server = saved({
      auth: { method: 'keyFile', user: 'u', keyPath: 'C:/k', hasSecret: true },
    })
    const moved = profilePatch(server, { host: 'other.example.net' })
    expect(moved.auth.secret).toEqual({ action: 'keep' })
    expect(moved.auth.keyPath).toBe('C:/k')
    expect(moved.advanced.agentForward).toBe(false)
  })

  it('builds a new server from defaults', () => {
    const input = profilePatch(null, { host: ' db.example.net ', user: 'root' })
    expect(input.id).toBeNull()
    expect(input.host).toBe('db.example.net')
    expect(input.port).toBe(22)
    expect(input.groupId).toBeNull()
    expect(input.auth.method).toBe('password')
    expect(input.auth.secret).toEqual({ action: 'keep' })
    expect(input.advanced).toEqual(DEFAULT_ADVANCED)
  })

  it('refuses fields it does not allow and bad values', () => {
    expect(() => profilePatch(saved(), { keyPath: 'x' })).toThrow(/keyPath/)
    expect(() => profilePatch(saved(), { advanced: {} })).toThrow(/advanced/)
    expect(() => profilePatch(saved(), { port: 0 })).toThrow(/端口/)
    expect(() => profilePatch(saved(), { port: 22.5 })).toThrow(/端口/)
    expect(() => profilePatch(saved(), { host: '  ' })).toThrow(/主机/)
    expect(() => profilePatch(null, { host: 'a' })).toThrow(/用户名/)
    expect(() => profilePatch(saved(), { name: 'x'.repeat(129) })).toThrow(/名称/)
  })

  it('moves a server out of its group with null', () => {
    expect(profilePatch(saved(), { groupId: null }).groupId).toBeNull()
    expect(profilePatch(saved(), { groupId: 'g2' }).groupId).toBe('g2')
  })
})

describe('validPage', () => {
  it('accepts plain relative paths', () => {
    expect(validPage('panel.html')).toBe(true)
    expect(validPage('ui/panel.html')).toBe(true)
  })

  it('rejects traversal, absolute paths and odd names', () => {
    for (const bad of [
      '../x.html',
      'a/../b.html',
      '/abs.html',
      'a//b',
      'a\\b.html',
      '.hidden',
      'x..y',
    ]) {
      expect(validPage(bad), bad).toBe(false)
    }
    expect(validPage(42)).toBe(false)
  })
})

describe('text', () => {
  it('trims, flattens control characters and caps', () => {
    expect(text('  a\nb\x07c  ', 10)).toBe('a b c')
    expect(text('abcdef', 3)).toBe('abc')
    expect(text('   ', 10)).toBeNull()
    expect(text(5, 10)).toBeNull()
  })
})

describe('pluginUrl', () => {
  it('uses the Windows form of custom schemes there', () => {
    expect(pluginUrl('a.b/x.html', true)).toBe('http://gxplugin.localhost/a.b/x.html')
    expect(pluginUrl('a.b/x.html', false)).toBe('gxplugin://localhost/a.b/x.html')
  })
})

describe('menuEntries', () => {
  it('keeps commands inside the plugin', () => {
    expect(menuEntries('demo.hello', [{ label: 'Go', command: 'go' }])).toEqual([
      { label: 'Go', command: 'demo.hello:go', danger: false },
    ])
    expect(menuEntries('demo.hello', [{ label: 'Go', command: 'other.plugin:go' }])).toBeNull()
    expect(menuEntries('demo.hello', 'nope')).toBeNull()
  })

  it('reads when conditions and rejects bad ones', () => {
    const [item] =
      menuEntries('demo.hello', [{ label: 'Copy', command: 'copy', when: 'selection && !live' }]) ??
      []
    expect(item.when).toEqual([
      { key: 'selection', negate: false },
      { key: 'live', negate: true },
    ])
    expect(menuEntries('demo.hello', [{ label: 'X', command: 'x', when: 'a || b' }])).toBeNull()
  })
})

describe('parseWhen', () => {
  it('accepts names joined by &&', () => {
    expect(parseWhen('editable')).toEqual([{ key: 'editable', negate: false }])
    expect(parseWhen(' !live ')).toEqual([{ key: 'live', negate: true }])
  })

  it('rejects anything else', () => {
    for (const bad of ['', 'a.b', 'a &&', '1a', 'x == 1', 42, 'a&&b&&c&&d&&e&&f&&g&&h&&i']) {
      expect(parseWhen(bad)).toBeNull()
    }
  })
})

describe('matchesWhen', () => {
  const when = (source: string) => parseWhen(source) ?? undefined

  it('checks fields for being filled', () => {
    expect(matchesWhen(undefined, {})).toBe(true)
    expect(matchesWhen(when('selection'), { selection: 'abc' })).toBe(true)
    expect(matchesWhen(when('selection'), { selection: '' })).toBe(false)
    expect(matchesWhen(when('!live'), { live: false })).toBe(true)
    expect(matchesWhen(when('paths'), { paths: [] })).toBe(false)
    expect(matchesWhen(when('paths && sessionId'), { paths: ['/a'], sessionId: 3 })).toBe(true)
  })

  it('treats missing and inherited fields as empty', () => {
    expect(matchesWhen(when('toString'), {})).toBe(false)
    expect(matchesWhen(when('selection'), null)).toBe(false)
  })
})

describe('MENU_PLACES', () => {
  it('covers the generic text menu and the status bar', () => {
    expect(MENU_PLACES).toContain('text/context')
    expect(MENU_PLACES).toContain('statusbar')
    expect(new Set(MENU_PLACES).size).toBe(MENU_PLACES.length)
  })
})

describe('parseContributions', () => {
  it('reads valid entries and names the rest', () => {
    const c = parseContributions(
      manifest({
        commands: [
          { id: 'greet', title: 'Greet' },
          { id: 'Bad Id', title: 'x' },
        ],
        keybindings: [{ key: 'Ctrl+Alt+H', command: 'greet' }],
        menus: { 'terminal/context': [{ label: 'Greet', command: 'greet' }], nowhere: [] },
        panels: [
          { id: 'main', title: 'Hello', page: 'panel.html', region: 'right' },
          { id: 'evil', title: 'x', page: '../../secret.html' },
        ],
        terminalHighlights: [
          { pattern: 'ERROR', foreground: '#ff5555' },
          { pattern: '(', foreground: '#ff5555' },
        ],
        configuration: [
          { key: 'threshold', title: 'Threshold', type: 'number', default: 90 },
          { key: 'name', title: 'Name', type: 'string', default: 5 },
          { key: 'weird', title: 'x', type: 'object' },
        ],
      }),
    )
    expect(c.commands).toEqual([{ name: 'greet', title: 'Greet' }])
    expect(c.keybindings).toEqual([{ key: 'Ctrl+Alt+H', command: 'demo.hello:greet' }])
    expect(c.menus['terminal/context']).toHaveLength(1)
    expect(c.panels).toEqual([
      { name: 'main', title: 'Hello', page: 'panel.html', region: 'right' },
    ])
    expect(c.highlights).toHaveLength(1)
    expect(c.configuration).toEqual([
      { key: 'threshold', title: 'Threshold', description: '', type: 'number', default: 90 },
      { key: 'name', title: 'Name', description: '', type: 'string', default: '' },
    ])
    expect(c.problems).toEqual([
      'contributes.commands[1] 格式不正确，已忽略',
      'contributes.menus.nowhere 格式不正确，已忽略',
      'contributes.panels[1] 格式不正确，已忽略',
      'contributes.terminalHighlights[1] 格式不正确，已忽略',
      'contributes.configuration[2] 格式不正确，已忽略',
    ])
  })

  it('reads icons and icon references', () => {
    const c = parseContributions(
      manifest({
        commands: [
          { id: 'greet', title: 'Greet', icon: 'smile' },
          { id: 'other', title: 'Other', icon: 'Not An Icon' },
        ],
        menus: { 'tab/context': [{ label: 'Greet', command: 'greet', icon: 'gear' }] },
        icons: {
          smile: { path: 'M0 0h24v24Z', viewBox: '0 0 24 24', stroke: true },
          Bad: 'M0 0Z',
          evil: '<svg><script>x()</script></svg>',
        },
      }),
    )
    expect(c.commands).toEqual([
      { name: 'greet', title: 'Greet', icon: 'smile' },
      { name: 'other', title: 'Other' },
    ])
    expect(c.menus['tab/context']?.[0].icon).toBe('gear')
    expect(c.icons).toEqual([
      { name: 'smile', data: { paths: ['M0 0h24v24Z'], viewBox: '0 0 24 24', stroke: true } },
    ])
    expect(c.problems).toEqual([
      'contributes.icons.Bad 格式不正确，已忽略',
      'contributes.icons.evil 格式不正确，已忽略',
    ])
  })

  it('drops completion specs with unknown keys', () => {
    const c = parseContributions(
      manifest({ completions: { mytool: { d: 'My tool', s: { run: 'Run it' } }, bad: { x: 1 } } }),
    )
    expect(c.completions).toEqual({ mytool: { d: 'My tool', s: { run: 'Run it' } } })
    expect(c.problems).toEqual(['contributes.completions.bad 格式不正确，已忽略'])
  })
})
