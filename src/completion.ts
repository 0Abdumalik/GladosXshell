import { invoke } from '@tauri-apps/api/core'
import { type CommandToken, completionToken, shellEscape, tokenizeCommand } from './commands-model'
import { h } from './dom'
import { commandHistory } from './history'
import { messages, pl } from './i18n'
import { type IconName, icon } from './icons'
import { getPathHistory } from './path-history'
import {
  commandDetail,
  commandWords,
  specCandidates,
  specCommands,
  specsVersion,
} from './spec-completion'

const t = messages({
  fromHistory: { zh: '来自 cd 历史', en: 'From cd history', ug: 'cd تارىخىدىن' },
  used: {
    zh: '使用过 {n} 次',
    en: (p) => `Used ${pl('time')(p)}`,
    ug: '{n} قېتىم ئىشلىتىلگەن',
  },
})

export interface CompletionCandidate {
  /** Inserted in place of the field (already shell-escaped by the caller if needed). */
  text: string
  /** Shown in the list; defaults to `text`. */
  label?: string
  frequency?: number
  isDirectory?: boolean
  fromHistory?: boolean
  /** Short description shown after the label. */
  detail?: string
  kind?: 'command' | 'subcommand' | 'option' | 'value'
  /** Accepting does not end the word (`--since=`), so suggestions continue. */
  keepOpen?: boolean
}

const MAX_COMMANDS = 12
const MAX_PATHS = 60
const LIST_TTL_MS = 5000

/** Built-in common commands that should always appear in suggestions. */
const BUILTIN_COMMANDS = [
  'ls',
  'cd',
  'pwd',
  'cat',
  'less',
  'tail',
  'head',
  'vim',
  'nano',
  'grep',
  'find',
  'tar',
  'ssh',
  'scp',
  'rsync',
  'top',
  'htop',
  'ps',
  'kill',
  'df',
  'du',
  'free',
  'chmod',
  'chown',
  'mkdir',
  'rmdir',
  'rm',
  'cp',
  'mv',
  'touch',
  'echo',
  'man',
  'git',
  'docker',
  'systemctl',
  'journalctl',
  'npm',
  'yarn',
  'node',
  'python3',
  'pip',
  'wget',
  'curl',
  'sudo',
]

let known: { version: number; commands: string[] } | null = null

/** Common commands first, then everything else the specs know, alphabetically. */
function knownCommands(): string[] {
  if (known?.version !== specsVersion()) {
    const specs = specCommands().filter((c) => c.length > 1)
    known = {
      version: specsVersion(),
      commands: [...new Set([...BUILTIN_COMMANDS, ...specs.sort()])],
    }
  }
  return known.commands
}

function firstWord(command: string): string {
  return command.trim().split(/\s+/)[0] || ''
}

/** Command names from history (most used first), then common built-ins. */
export function commandCandidates(prefix: string): CompletionCandidate[] {
  if (prefix.trim() === '') return []
  const lower = prefix.toLowerCase()
  const freq = new Map<string, number>()
  for (const cmd of commandHistory()) {
    const word = firstWord(cmd)
    if (word) freq.set(word, (freq.get(word) || 0) + 1)
  }
  const candidates: CompletionCandidate[] = []
  const seen = new Set<string>()
  const historical = [...freq.entries()]
    .filter(([cmd]) => cmd.toLowerCase().startsWith(lower) && cmd !== prefix)
    .sort((a, b) => b[1] - a[1])
  for (const [cmd, count] of historical) {
    candidates.push({ text: cmd, frequency: count, detail: commandDetail(cmd), kind: 'command' })
    seen.add(cmd)
  }
  for (const cmd of knownCommands()) {
    if (cmd.startsWith(lower) && cmd !== prefix && !seen.has(cmd)) {
      candidates.push({ text: cmd, detail: commandDetail(cmd), kind: 'command' })
      seen.add(cmd)
    }
  }
  return candidates.slice(0, MAX_COMMANDS)
}

/**
 * Splits a typed path into the directory to list over SFTP and the name prefix to match.
 * `head` is kept verbatim in suggestions so `~/`, `./` and relative paths read as typed.
 * Relative paths list against the SFTP start directory, which is the login home.
 */
export function splitPathPrefix(prefix: string): { dir: string; head: string; base: string } {
  const slash = prefix.lastIndexOf('/')
  if (slash < 0) return { dir: '.', head: '', base: prefix }
  const head = prefix.slice(0, slash + 1)
  const base = prefix.slice(slash + 1)
  if (head === '/') return { dir: '/', head, base }
  const trimmed = head.slice(0, -1)
  if (trimmed === '~') return { dir: '.', head, base }
  if (trimmed.startsWith('~/')) return { dir: trimmed.slice(2), head, base }
  return { dir: trimmed, head, base }
}

type Listing = Array<{ name: string; isDirectory: boolean }>
const listings = new Map<string, { at: number; entries: Promise<Listing> }>()

function listDir(sessionId: number, dir: string): Promise<Listing> {
  const key = `${sessionId}\0${dir}`
  const cached = listings.get(key)
  if (cached && Date.now() - cached.at < LIST_TTL_MS) return cached.entries
  const entries = invoke<Listing>('sftp_list_for_completion', { sessionId, path: dir })
  listings.set(key, { at: Date.now(), entries })
  entries.catch(() => listings.delete(key))
  return entries
}

/** Directory entries matching the typed path, then matching `cd` history. */
export async function pathCandidates(
  sessionId: number,
  prefix: string,
): Promise<CompletionCandidate[]> {
  const { dir, head, base } = splitPathPrefix(prefix)
  const candidates: CompletionCandidate[] = []
  const seen = new Set<string>()

  try {
    const lower = base.toLowerCase()
    const entries = (await listDir(sessionId, dir))
      .filter((e) => e.name.toLowerCase().startsWith(lower))
      .filter((e) => base.startsWith('.') || !e.name.startsWith('.'))
      .sort(
        (a, b) =>
          Number(b.isDirectory) - Number(a.isDirectory) || a.name.localeCompare(b.name, 'en'),
      )
    for (const entry of entries) {
      const raw = `${head}${entry.name}${entry.isDirectory ? '/' : ''}`
      candidates.push({
        text: shellEscape(raw),
        label: `${entry.name}${entry.isDirectory ? '/' : ''}`,
        isDirectory: entry.isDirectory,
      })
      seen.add(raw)
    }
  } catch {
    // Local terminals and dropped SFTP channels just fall back to history.
  }

  for (const path of await getPathHistory()) {
    if (path !== prefix && path.startsWith(prefix) && !seen.has(path)) {
      candidates.push({ text: shellEscape(path), label: path, fromHistory: true })
      seen.add(path)
    }
  }
  return candidates.slice(0, MAX_PATHS)
}

export interface Suggestion {
  /** The field the candidates replace. */
  token: CommandToken
  candidates: CompletionCandidate[]
}

/**
 * Everything worth suggesting at `position` in a one-line command: command names, then
 * subcommands, options and values from the built-in specs, then remote paths where they fit.
 * Null when there is nothing to complete (or only an empty field and `explicit` is false).
 */
export async function suggest(
  text: string,
  position: number,
  sessionId: number | null,
  explicit: boolean,
): Promise<Suggestion | null> {
  const token = completionToken(text, position)
  if (!token || (!explicit && token.text === '')) return null
  if (token.type === 'command') return { token, candidates: commandCandidates(token.text) }

  const words = commandWords(tokenizeCommand(text.slice(0, position)), token)
  const spec = words.length > 0 ? specCandidates(words, token.text) : null
  if (spec?.command) return { token, candidates: commandCandidates(token.text) }

  const candidates = spec?.candidates ?? []
  const options = token.text.startsWith('-')
  if (!options && (token.type === 'path' || spec?.paths) && sessionId != null) {
    candidates.push(...(await pathCandidates(sessionId, token.text)))
  }
  return { token, candidates: candidates.slice(0, MAX_PATHS) }
}

export interface CompletionPopup {
  element: HTMLElement
  show: (candidates: CompletionCandidate[], anchor: DOMRect, x: number) => void
  hide: () => void
  selectNext: () => void
  selectPrev: () => void
  current: () => CompletionCandidate | null
  visible: () => boolean
  /** id of the highlighted option, for aria-activedescendant. */
  activeId: () => string | null
}

const GAP = 4

const KIND_ICONS: Record<NonNullable<CompletionCandidate['kind']>, IconName> = {
  command: 'terminal',
  subcommand: 'git-branch',
  option: 'flag',
  value: 'tag',
}

/**
 * A suggestion list that opens above its anchor (the command bar sits at the bottom of the
 * window) and flips below only when there is no room. Lives on `document.body` so no
 * ancestor's overflow or containing block can clip it.
 */
export function createCompletionPopup(
  id: string,
  onSelect: (candidate: CompletionCandidate) => void,
): CompletionPopup {
  let candidates: CompletionCandidate[] = []
  let selectedIndex = 0

  const element = h('div', { class: 'gx-completion', id, role: 'listbox', hidden: true })
  // Keep focus in the input while clicking a suggestion.
  element.addEventListener('mousedown', (event) => event.preventDefault())
  document.body.append(element)

  const optionId = (index: number) => `${id}-${index}`

  const badge = (candidate: CompletionCandidate): HTMLElement | null => {
    if (candidate.fromHistory)
      return h('span', { class: 'gx-completion-badge', title: t('fromHistory') }, icon('clock'))
    if (candidate.frequency)
      return h('span', {
        class: 'gx-completion-badge',
        text: String(candidate.frequency),
        title: t('used', { n: candidate.frequency }),
      })
    return null
  }

  const kindIcon = (candidate: CompletionCandidate): HTMLElement => {
    const name = candidate.kind
      ? KIND_ICONS[candidate.kind]
      : candidate.isDirectory === undefined
        ? candidate.fromHistory
          ? 'folder-open'
          : 'terminal'
        : candidate.isDirectory
          ? 'folder-simple'
          : 'file'
    return h('span', { class: 'gx-completion-icon', 'data-kind': name }, icon(name))
  }

  const render = () => {
    element.replaceChildren(
      ...candidates.map((candidate, index) => {
        const label = candidate.label ?? candidate.text
        return h(
          'div',
          {
            class: 'gx-completion-item',
            id: optionId(index),
            role: 'option',
            'aria-selected': String(index === selectedIndex),
            title: candidate.detail ? `${label}  ${candidate.detail}` : label,
            onclick: () => {
              hide()
              onSelect(candidate)
            },
          },
          kindIcon(candidate),
          h('span', { class: 'gx-completion-text mono', text: label }),
          candidate.detail
            ? h('span', { class: 'gx-completion-detail', text: candidate.detail })
            : null,
          badge(candidate),
        )
      }),
    )
  }

  const highlight = (index: number) => {
    if (candidates.length === 0) return
    selectedIndex = (index + candidates.length) % candidates.length
    for (const [i, item] of [...element.children].entries())
      item.setAttribute('aria-selected', String(i === selectedIndex))
    element.children[selectedIndex]?.scrollIntoView({ block: 'nearest' })
  }

  const place = (anchor: DOMRect, x: number) => {
    const above = anchor.top - 2 * GAP
    const below = window.innerHeight - anchor.bottom - 2 * GAP
    const up = above >= 160 || above >= below
    element.style.setProperty('--max-h', `${Math.max(up ? above : below, 48)}px`)
    const { offsetWidth: width, offsetHeight: height } = element
    const top = up ? Math.max(GAP, anchor.top - height - GAP) : anchor.bottom + GAP
    const left = Math.min(Math.max(GAP, x), Math.max(GAP, window.innerWidth - width - GAP))
    element.style.setProperty('--x', `${left}px`)
    element.style.setProperty('--y', `${top}px`)
  }

  const show = (next: CompletionCandidate[], anchor: DOMRect, x: number) => {
    candidates = next
    selectedIndex = 0
    if (candidates.length === 0) {
      hide()
      return
    }
    render()
    element.hidden = false
    place(anchor, x)
  }

  const hide = () => {
    element.hidden = true
    candidates = []
    element.replaceChildren()
  }

  return {
    element,
    show,
    hide,
    selectNext: () => highlight(selectedIndex + 1),
    selectPrev: () => highlight(selectedIndex - 1),
    current: () => candidates[selectedIndex] ?? null,
    visible: () => !element.hidden,
    activeId: () => (element.hidden ? null : optionId(selectedIndex)),
  }
}
