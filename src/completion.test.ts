import { describe, expect, it, vi } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('./history', () => ({ commandHistory: () => ['git push', 'git pull', 'gzip a'] }))
vi.mock('./path-history', () => ({ getPathHistory: async () => [] }))
vi.mock('./settings-store', () => ({ settings: () => ({ terminal: { suggestions: true } }) }))

const { commandCandidates, splitPathPrefix, suggest } = await import('./completion')
const { parseOptions, parseValues, registerSpecs } = await import('./spec-completion')
const { SPECS } = await import('./completion-data')
registerSpecs(SPECS)
const { acceptKeys, looksLikePrompt } = await import('./terminal-suggest')

describe('splitPathPrefix', () => {
  it('lists the typed directory and matches the last segment', () => {
    expect(splitPathPrefix('/etc/ho')).toEqual({ dir: '/etc', head: '/etc/', base: 'ho' })
    expect(splitPathPrefix('/us')).toEqual({ dir: '/', head: '/', base: 'us' })
  })

  it('resolves home and relative paths against the SFTP start directory', () => {
    expect(splitPathPrefix('~/')).toEqual({ dir: '.', head: '~/', base: '' })
    expect(splitPathPrefix('~/src/ma')).toEqual({ dir: 'src', head: '~/src/', base: 'ma' })
    expect(splitPathPrefix('lo')).toEqual({ dir: '.', head: '', base: 'lo' })
    expect(splitPathPrefix('./a/b')).toEqual({ dir: './a', head: './a/', base: 'b' })
  })
})

describe('commandCandidates', () => {
  it('puts the most used history commands first and skips an exact match', () => {
    const texts = commandCandidates('g').map((c) => c.text)
    expect(texts.slice(0, 2)).toEqual(['git', 'gzip'])
    expect(commandCandidates('git').map((c) => c.text)).not.toContain('git')
  })
})

const texts = async (line: string) =>
  (await suggest(line, line.length, null, true))?.candidates.map((c) => c.text) ?? []

describe('spec data', () => {
  it('parses aliases, value placeholders and quoted values', () => {
    expect(parseOptions('-u|--user <用户> 目标用户;--now 同时启动')).toEqual([
      { flags: ['-u', '--user'], value: '用户', d: '目标用户' },
      { flags: ['--now'], value: null, d: '同时启动' },
    ])
    expect(parseValues('"Accept: application/json";TERM 正常终止 (15)')).toEqual([
      { text: '"Accept: application/json"', d: '' },
      { text: 'TERM', d: '正常终止 (15)' },
    ])
  })
})

describe('spec suggestions', () => {
  it('describes command names', async () => {
    const result = await suggest('systemc', 7, null, false)
    expect(result?.candidates[0]).toMatchObject({ text: 'systemctl', detail: '服务管理' })
  })

  it('walks subcommands and their values', async () => {
    expect(await texts('git ch')).toEqual(['checkout', 'cherry-pick'])
    expect(await texts('docker compose u')).toEqual(['up', 'unpause'])
    expect(await texts('systemctl restart ngi')).toEqual(['nginx'])
  })

  it('suggests options, preferring the short alias, and skips used ones', async () => {
    expect(await texts('git commit -')).toContain('-m')
    expect(await texts('git commit --am')).toEqual(['--amend'])
    expect(await texts('git commit -a -')).not.toContain('-a')
    // Options of the parent command still apply after a subcommand.
    expect(await texts('kubectl get pods --name')).toEqual(['--namespace'])
  })

  it('completes option arguments, inline and as the next word', async () => {
    expect(await texts('kubectl get pods -n kube-')).toEqual(['kube-system', 'kube-public'])
    expect(await texts('docker run --restart u')).toEqual(['unless-stopped'])
    expect(await texts('journalctl -p e')).toEqual(['emerg', 'err'])
    expect(await texts('kill -s K')).toEqual(['KILL'])
  })

  it('starts over after sudo and watch', async () => {
    expect(await texts('sudo systemctl st')).toEqual(['status', 'start', 'stop'])
    expect(await texts('sudo -u root apt inst')).toEqual(['install'])
    expect((await texts('watch -n 2 doc'))[0]).toBe('docker')
    expect(await texts('ls | sudo systemctl is-a')).toEqual(['is-active'])
  })

  it('ignores prototype keys and unknown commands', async () => {
    expect(await texts('git constructor ')).toEqual([])
    expect(await texts('toString x')).toEqual([])
  })
})

describe('terminal suggestions', () => {
  it('recognises shell prompts but not REPLs or questions', () => {
    for (const prompt of ['root@web:~# ', '[dev@host srv]$ ', 'zsh % ', '❯ ', '➜  ~ ']) {
      expect(looksLikePrompt(prompt)).toBe(true)
    }
    for (const other of ['', 'Password: ', '>>> ', 'mysql> ', 'postgres=# ', 'Continue? ']) {
      expect(looksLikePrompt(other)).toBe(false)
    }
  })

  it('types only the missing tail, or erases and retypes', () => {
    expect(acceptKeys('chec', { text: 'checkout' })).toBe('kout ')
    expect(acceptKeys('/et', { text: '/etc/' })).toBe('c/')
    expect(acceptKeys('--for', { text: '--format=', keepOpen: true })).toBe('mat=')
    expect(acceptKeys('Doc', { text: 'docs/' })).toBe('\x7f\x7f\x7fdocs/')
  })
})
