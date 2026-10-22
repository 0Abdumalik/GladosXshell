import { messages } from './i18n'

const t = messages({
  folderNameEmpty: {
    zh: '请输入收藏夹名称',
    en: 'Enter a folder name',
    ug: 'يىغقۇچ قىسقۇچىنىڭ ئاتىنى كىرگۈزۈڭ',
  },
  folderNameLong: {
    zh: '收藏夹名称不能超过 {n} 个字',
    en: 'Folder names are limited to {n} characters',
    ug: 'يىغقۇچ قىسقۇچىنىڭ ئاتى {n} ھەرپتىن ئاشمىسۇن',
  },
  commandEmpty: { zh: '请输入指令', en: 'Enter a command', ug: 'بۇيرۇق كىرگۈزۈڭ' },
  commandLong: {
    zh: '指令不能超过 64 KB',
    en: 'Commands are limited to 64 KB',
    ug: 'بۇيرۇق 64 KB دىن ئاشمىسۇن',
  },
  noteLong: {
    zh: '备注不能超过 {n} 个字',
    en: 'Notes are limited to {n} characters',
    ug: 'ئىزاھ {n} ھەرپتىن ئاشمىسۇن',
  },
})

const MAX_FOLDER_NAME = 60

export interface Favorite {
  id: string
  command: string
  note: string
  /** null keeps it at the top level. */
  folderId: string | null
  createdAt: number
  updatedAt: number
}

export interface FavoriteFolder {
  id: string
  name: string
}

export function folderNameError(name: string): string {
  const trimmed = name.trim()
  if (trimmed === '') return t('folderNameEmpty')
  if ([...trimmed].length > MAX_FOLDER_NAME) return t('folderNameLong', { n: MAX_FOLDER_NAME })
  return ''
}

export const MAX_COMMAND_BYTES = 64 * 1024
export const MAX_NOTE_CHARS = 2000

/** Turns typed text into terminal input: each line ends with Enter (CR). */
export function commandInput(text: string): string {
  const lines = text.replace(/\r\n?/g, '\n').replace(/\n+$/, '').split('\n')
  return `${lines.join('\r')}\r`
}

export function favoriteErrors(command: string, note: string): { command: string; note: string } {
  let commandError = ''
  if (command.trim() === '') commandError = t('commandEmpty')
  else if (new TextEncoder().encode(command).length > MAX_COMMAND_BYTES)
    commandError = t('commandLong')
  const noteError =
    [...note.trim()].length > MAX_NOTE_CHARS ? t('noteLong', { n: MAX_NOTE_CHARS }) : ''
  return { command: commandError, note: noteError }
}

/** Every whitespace-separated word must appear in the command or the note (case-insensitive). */
export function matchesQuery(query: string, ...fields: string[]): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return true
  const haystack = fields.join('\n').toLowerCase()
  return words.every((word) => haystack.includes(word))
}

/** First non-empty line, shortened, for list rows and status messages. */
export function commandSummary(command: string, max = 60): string {
  const line =
    command
      .split(/\r?\n/)
      .find((l) => l.trim() !== '')
      ?.trim() ?? ''
  const chars = [...line]
  const multiline = command.trim().split(/\r?\n/).length > 1
  if (chars.length > max) return `${chars.slice(0, max).join('')}…`
  return multiline ? `${line} …` : line
}

export type FieldType = 'command' | 'argument' | 'path'

export interface CommandToken {
  text: string
  start: number
  end: number
  type: FieldType
  quoted: boolean
}

/** Commands whose plain (non-option) arguments are usually paths. */
const PATH_COMMANDS = new Set([
  '.',
  'bash',
  'cat',
  'cd',
  'chgrp',
  'chmod',
  'chown',
  'cp',
  'diff',
  'du',
  'file',
  'find',
  'head',
  'less',
  'll',
  'ln',
  'ls',
  'more',
  'mkdir',
  'mv',
  'nano',
  'node',
  'python',
  'python3',
  'rm',
  'rmdir',
  'sh',
  'source',
  'stat',
  'tail',
  'tar',
  'touch',
  'vi',
  'vim',
  'zsh',
])

const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/

/** Tokenizes a shell command into fields, respecting quotes, escapes and operators. */
export function tokenizeCommand(text: string): CommandToken[] {
  const tokens: CommandToken[] = []
  let i = 0
  let isFirstToken = true
  let command = ''
  let redirect = false

  while (i < text.length) {
    const lead = text[i]
    if (/\s/.test(lead)) {
      i++
      continue
    }
    if (lead === '|' || lead === ';' || lead === '&' || lead === '(' || lead === ')') {
      isFirstToken = true
      redirect = false
      i++
      continue
    }
    if (lead === '>' || lead === '<') {
      redirect = true
      i++
      continue
    }

    const start = i
    let token = ''
    let quoted = false
    let quoteChar: string | null = null

    while (i < text.length) {
      const ch = text[i]

      if (quoteChar) {
        if (ch === quoteChar) {
          quoteChar = null
          quoted = true
          i++
        } else if (ch === '\\' && i + 1 < text.length) {
          token += text[i + 1]
          i += 2
        } else {
          token += ch
          i++
        }
      } else if (ch === '\\' && i + 1 < text.length) {
        token += text[i + 1]
        i += 2
      } else if (ch === '"' || ch === "'") {
        quoteChar = ch
        i++
      } else if (/[\s|;&<>()]/.test(ch)) {
        break
      } else {
        token += ch
        i++
      }
    }

    // `VAR=value cmd` keeps the command position open for `cmd`.
    if (isFirstToken && !quoted && ASSIGNMENT.test(token)) {
      tokens.push({ text: token, start, end: i, type: 'argument', quoted })
      continue
    }
    if (token || quoted) {
      const type = redirect ? 'path' : detectFieldType(token, isFirstToken, command)
      tokens.push({ text: token, start, end: i, type, quoted })
      if (isFirstToken) command = token
      isFirstToken = false
      redirect = false
    }
  }

  return tokens
}

/** Detects whether a field is a command, argument, or path. */
export function detectFieldType(field: string, isFirst: boolean, command = ''): FieldType {
  if (isFirst) return 'command'
  if (field.startsWith('/') || field.startsWith('~') || field.startsWith('.')) return 'path'
  if (field.startsWith('-')) return 'argument'
  if (/^[A-Za-z]:[/\\]/.test(field)) return 'path'
  if (field.includes('/') || field.includes('\\')) return 'path'
  return PATH_COMMANDS.has(command) ? 'path' : 'argument'
}

/** Finds the token under or directly before the cursor. */
export function tokenAt(tokens: CommandToken[], position: number): CommandToken | null {
  return tokens.find((token) => position >= token.start && position <= token.end) ?? null
}

/**
 * The field to complete at the cursor: `text` is what was typed up to the cursor, and
 * `start`..`end` is the range a suggestion replaces. Right after a space or an operator this
 * is an empty field typed by its position (command, path or argument).
 */
export function completionToken(text: string, position: number): CommandToken | null {
  const head = text.slice(0, position)
  let token = tokenizeCommand(head).at(-1)
  if (!token || token.end !== position) {
    const probe = tokenizeCommand(`${head}x`).at(-1)
    if (!probe || probe.start !== position) return null
    token = { ...probe, text: '', end: position }
  }
  const full = tokenizeCommand(text).find((other) => other.start === token.start)
  return { ...token, end: Math.max(position, full?.end ?? position) }
}

/** Backslash-escapes characters the shell would otherwise interpret; a leading `~` stays. */
export function shellEscape(text: string): string {
  return text.replace(/[\s'"\\$`!&|;<>()*?#[\]{}]/g, '\\$&')
}
