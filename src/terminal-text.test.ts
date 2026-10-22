import { describe, expect, it } from 'vitest'
import { parseOsc7, pastedLines } from './terminal-text'

describe('pastedLines', () => {
  it('is zero without a line break', () => {
    expect(pastedLines('ls -la')).toBe(0)
  })

  it('counts lines, ignoring one trailing break', () => {
    expect(pastedLines('ls\n')).toBe(1)
    expect(pastedLines('a\r\nb\r\nc')).toBe(3)
    expect(pastedLines('a\rb\n')).toBe(2)
  })
})

describe('parseOsc7', () => {
  it('reads the path and decodes it', () => {
    expect(parseOsc7('file://web-01/home/malik/my%20dir')).toBe('/home/malik/my dir')
    expect(parseOsc7('file:///tmp/')).toBe('/tmp')
    expect(parseOsc7('file://h/')).toBe('/')
    expect(parseOsc7('file://h/srv/%E4%B8%AD')).toBe('/srv/中')
  })

  it('turns Windows drive paths back into native form', () => {
    expect(parseOsc7('file://PC/C:/Users/me/')).toBe('C:\\Users\\me')
    expect(parseOsc7('file://PC/D:/')).toBe('D:\\')
    expect(parseOsc7('file://PC/D:')).toBe('D:\\')
  })

  it('rejects other schemes, bad escapes and control characters', () => {
    expect(parseOsc7('http://h/tmp')).toBeNull()
    expect(parseOsc7('file://h')).toBeNull()
    expect(parseOsc7('file://h/%E4')).toBeNull()
    expect(parseOsc7('file://h/a%0Ab')).toBeNull()
  })
})
