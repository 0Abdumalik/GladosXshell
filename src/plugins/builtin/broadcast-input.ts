import type { IModes } from '@xterm/xterm'

export type InputModes = Pick<IModes, 'applicationCursorKeysMode' | 'bracketedPasteMode'>

// biome-ignore lint/suspicious/noControlCharactersInRegex: escape sequences are the point
const PASTE_MARKS = /\x1b\[20[01]~/g
// biome-ignore lint/suspicious/noControlCharactersInRegex: escape sequences are the point
const APP_CURSOR = /\x1bO([ABCDHF])/g
// biome-ignore lint/suspicious/noControlCharactersInRegex: escape sequences are the point
const NORMAL_CURSOR = /\x1b\[([ABCDHF])/g

/**
 * Rewrites keys typed in one terminal for another whose modes differ: arrow keys in application
 * vs normal cursor mode (vim vs the shell), and paste brackets the other side did not ask for.
 */
export function adaptInput(data: string, from: InputModes, to: InputModes): string {
  let out = data
  if (from.bracketedPasteMode && !to.bracketedPasteMode) out = out.replace(PASTE_MARKS, '')
  if (from.applicationCursorKeysMode && !to.applicationCursorKeysMode) {
    out = out.replace(APP_CURSOR, '\x1b[$1')
  } else if (!from.applicationCursorKeysMode && to.applicationCursorKeysMode) {
    out = out.replace(NORMAL_CURSOR, '\x1bO$1')
  }
  return out
}
