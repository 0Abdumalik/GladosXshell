import { describe, expect, it } from 'vitest'
import { adaptInput, type InputModes } from './broadcast-input'

const modes = (cursor: boolean, paste: boolean): InputModes => ({
  applicationCursorKeysMode: cursor,
  bracketedPasteMode: paste,
})
const shell = modes(false, true)
const vim = modes(true, false)
const plain = modes(false, false)

describe('adaptInput', () => {
  it('passes input through between terminals in the same mode', () => {
    expect(adaptInput('ls -la\r', shell, shell)).toBe('ls -la\r')
    expect(adaptInput('\x1b[A', shell, shell)).toBe('\x1b[A')
    expect(adaptInput('\x1b[200~x\x1b[201~', shell, shell)).toBe('\x1b[200~x\x1b[201~')
  })

  it('switches arrow keys between cursor modes', () => {
    expect(adaptInput('\x1bOA\x1bOD', vim, shell)).toBe('\x1b[A\x1b[D')
    expect(adaptInput('\x1b[B\x1b[H', shell, vim)).toBe('\x1bOB\x1bOH')
  })

  it('leaves modified keys alone', () => {
    expect(adaptInput('\x1b[1;5A', shell, vim)).toBe('\x1b[1;5A')
  })

  it('drops paste brackets the other side did not ask for', () => {
    expect(adaptInput('\x1b[200~a\rb\x1b[201~', shell, plain)).toBe('a\rb')
    expect(adaptInput('a\rb', plain, shell)).toBe('a\rb')
  })
})
