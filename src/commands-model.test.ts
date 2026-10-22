import { describe, expect, it } from 'vitest'
import { completionToken, shellEscape, tokenAt, tokenizeCommand } from './commands-model'

const kinds = (text: string) => tokenizeCommand(text).map((t) => [t.text, t.type])

describe('tokenizeCommand', () => {
  it('treats every operator as a separator without hanging', () => {
    expect(kinds('echo a > b')).toEqual([
      ['echo', 'command'],
      ['a', 'argument'],
      ['b', 'path'],
    ])
    expect(kinds('make && ls -la /tmp || true; cat<in &')).toEqual([
      ['make', 'command'],
      ['ls', 'command'],
      ['-la', 'argument'],
      ['/tmp', 'path'],
      ['true', 'command'],
      ['cat', 'command'],
      ['in', 'path'],
    ])
  })

  it('keeps quoted spaces and records raw offsets', () => {
    const [cmd, arg] = tokenizeCommand('cat "my file.txt"')
    expect(cmd).toMatchObject({ text: 'cat', start: 0, end: 3 })
    expect(arg).toMatchObject({ text: 'my file.txt', start: 4, end: 17, quoted: true })
  })

  it('types plain arguments of path commands as paths', () => {
    expect(kinds('cd src')).toEqual([
      ['cd', 'command'],
      ['src', 'path'],
    ])
    expect(kinds('git status')[1]).toEqual(['status', 'argument'])
  })

  it('skips environment assignments before the command', () => {
    expect(kinds('LANG=C ls')).toEqual([
      ['LANG=C', 'argument'],
      ['ls', 'command'],
    ])
  })
})

describe('tokenAt', () => {
  it('includes the position right after a word', () => {
    const tokens = tokenizeCommand('ls /et')
    expect(tokenAt(tokens, 6)?.text).toBe('/et')
    expect(tokenAt(tokens, 2)?.text).toBe('ls')
  })
})

describe('completionToken', () => {
  it('completes the typed prefix and replaces the whole word', () => {
    expect(completionToken('ls /etc/hosts', 7)).toMatchObject({
      text: '/etc',
      start: 3,
      end: 13,
      type: 'path',
    })
  })

  it('offers an empty field after a space or operator', () => {
    expect(completionToken('cd ', 3)).toMatchObject({ text: '', start: 3, end: 3, type: 'path' })
    expect(completionToken('ls | ', 5)).toMatchObject({ text: '', type: 'command' })
    expect(completionToken('git ', 4)).toMatchObject({ type: 'argument' })
  })

  it('works inside an unterminated quote', () => {
    expect(completionToken('cat "my fi', 10)).toMatchObject({ text: 'my fi', start: 4, end: 10 })
  })
})

describe('shellEscape', () => {
  it('escapes shell metacharacters but keeps a leading tilde', () => {
    expect(shellEscape('~/my file (1).txt')).toBe('~/my\\ file\\ \\(1\\).txt')
  })
})
