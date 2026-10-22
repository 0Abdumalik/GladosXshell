import type { CommandToken } from './commands-model'
import type { CompletionCandidate } from './completion'
import type { CommandSpec } from './completion-data'
import { ltr, messages } from './i18n'

const t = messages({
  aliases: { zh: '{detail}（{aliases}）', en: '{detail} ({aliases})', ug: '{detail} ({aliases})' },
})

export type SpecSet = Readonly<Record<string, CommandSpec | string>>

const sources: SpecSet[] = []
let cache: Map<string, CommandSpec | string> | null = null
let version = 0

/** Adds command specs; a later set overrides an earlier one for the same command. */
export function registerSpecs(specs: SpecSet): () => void {
  sources.push(specs)
  cache = null
  version++
  return () => {
    const index = sources.indexOf(specs)
    if (index < 0) return
    sources.splice(index, 1)
    cache = null
    version++
  }
}

function merged(): Map<string, CommandSpec | string> {
  if (!cache) {
    cache = new Map()
    for (const set of sources) for (const [name, spec] of Object.entries(set)) cache.set(name, spec)
  }
  return cache
}

function lookup(name: string): CommandSpec | string | undefined {
  return merged().get(name)
}

export interface SpecOption {
  flags: string[]
  /** Takes the next word as its value. */
  value: string | null
  d: string
}

export interface SpecValue {
  text: string
  d: string
}

const optionCache = new Map<string, SpecOption[]>()
const valueCache = new Map<string, SpecValue[]>()

export function parseOptions(list: string | undefined): SpecOption[] {
  if (!list) return []
  const cached = optionCache.get(list)
  if (cached) return cached
  const options = list.split(';').flatMap((entry): SpecOption[] => {
    const [flags, ...rest] = entry.trim().split(' ')
    if (!flags) return []
    const value = rest[0]?.startsWith('<') && rest[0].endsWith('>') ? rest.shift() : null
    return [{ flags: flags.split('|'), value: value?.slice(1, -1) ?? null, d: rest.join(' ') }]
  })
  optionCache.set(list, options)
  return options
}

export function parseValues(list: string | undefined): SpecValue[] {
  if (!list) return []
  const cached = valueCache.get(list)
  if (cached) return cached
  const values = list.split(';').flatMap((raw): SpecValue[] => {
    const entry = raw.trim()
    if (!entry) return []
    // A quoted value may itself contain spaces.
    const cut = entry.startsWith('"') ? entry.indexOf('"', 1) + 1 : entry.indexOf(' ')
    if (cut <= 0) return [{ text: entry, d: '' }]
    return [{ text: entry.slice(0, cut), d: entry.slice(cut).trim() }]
  })
  valueCache.set(list, values)
  return values
}

const leaf = (child: CommandSpec | string): CommandSpec =>
  typeof child === 'string' ? { d: child } : child

interface Walk {
  /** Innermost spec first, then its parents (options and option values are inherited). */
  chain: CommandSpec[]
  /** Option whose value is the word being completed. */
  pending: { option: SpecOption; flag: string } | null
  /** The word being completed starts a new command line (after sudo, watch…). */
  command: boolean
  used: Set<string>
  /** Plain words already given to the innermost spec; subcommands only fit the first slot. */
  args: number
}

function findOption(chain: CommandSpec[], flag: string): SpecOption | null {
  for (const spec of chain) {
    const option = parseOptions(spec.o).find((o) => o.flags.includes(flag))
    if (option) return option
  }
  return null
}

function walk(words: string[]): Walk | null {
  const root = lookup(words[0])
  if (!root) return null
  let chain = [leaf(root)]
  let pending: Walk['pending'] = null
  let used = new Set<string>()
  let args = 0
  for (let i = 1; i < words.length; i++) {
    const word = words[i]
    const spec = chain[0]
    if (pending) {
      pending = null
      continue
    }
    if (word.length > 1 && word.startsWith('-')) {
      const option = findOption(chain, word)
      if (option) {
        for (const flag of option.flags) used.add(flag)
        if (option.value) pending = { option, flag: word }
      }
      continue
    }
    if (spec.c) return walk(words.slice(i))
    const child = spec.s && Object.hasOwn(spec.s, word) ? spec.s[word] : undefined
    if (child && args === 0) {
      chain = [leaf(child), ...chain]
      used = new Set()
    } else {
      args++
    }
  }
  const spec = chain[0]
  return { chain, pending, command: !pending && spec.c === true, used, args }
}

function valuesFor(chain: CommandSpec[], option: SpecOption): SpecValue[] {
  for (const spec of chain) {
    if (!spec.a) continue
    for (const flag of option.flags) {
      const list = spec.a[flag] ?? spec.a[flag.replace(/=$/, '')]
      if (list) return parseValues(list)
    }
  }
  return []
}

/** Value names that stand for a remote path, as each language's completion data writes them. */
const PATH_VALUES = new Set([
  // i18n-ignore: value names in completion-data.zh.ts
  ...['文件', '目录', '路径', '卷', '密钥', '公钥'],
  ...['file', 'dir', 'path', 'volume', 'key', 'pubkey'],
  ...['ھۆججەت', 'قىسقۇچ', 'يول', 'ساقلىغۇچ', 'ئاچقۇچ', 'ئاممىۋى-ئاچقۇچ'],
])

/** The option's value is a remote path, so path completion fits it. */
export const pathValue = (name: string): boolean => PATH_VALUES.has(name)

export interface SpecResult {
  candidates: CompletionCandidate[]
  /** Remote paths fit here too. */
  paths: boolean
  /** The word starts a new command line. */
  command: boolean
}

const matches = (text: string, prefix: string) => text !== prefix && text.startsWith(prefix)

/**
 * Suggestions from the built-in command specs for the word `target`, given the words of the
 * current simple command that come before it. Null when the command is unknown.
 */
export function specCandidates(words: string[], prefix: string): SpecResult | null {
  const state = walk(words)
  if (!state) return null
  const { chain, pending } = state
  const spec = chain[0]

  if (pending) {
    const values = valuesFor(chain, pending.option)
    return {
      candidates: values
        .filter((v) => matches(v.text, prefix))
        .map((v) => ({ text: v.text, detail: v.d || pending.option.d, kind: 'value' })),
      paths: values.length === 0 && pathValue(pending.option.value ?? ''),
      command: false,
    }
  }
  if (state.command) return { candidates: [], paths: false, command: true }

  const eq = prefix.indexOf('=')
  if (prefix.startsWith('-') && eq > 0) {
    const flag = prefix.slice(0, eq + 1)
    const option = findOption(chain, flag)
    const values = option ? valuesFor(chain, option) : []
    return {
      candidates: values
        .map((v) => ({
          text: `${flag}${v.text}`,
          label: v.text,
          detail: v.d,
          kind: 'value' as const,
        }))
        .filter((c) => matches(c.text, prefix)),
      paths: false,
      command: false,
    }
  }

  if (prefix.startsWith('-')) {
    const seen = new Set<string>()
    const candidates: CompletionCandidate[] = []
    for (const level of chain) {
      for (const option of parseOptions(level.o)) {
        const flag =
          option.flags.find(
            (f) => f.startsWith(prefix) && (prefix.startsWith('--') || !f.startsWith('--')),
          ) ?? option.flags.find((f) => f.startsWith(prefix))
        if (!flag || flag === prefix || seen.has(flag)) continue
        if (option.flags.some((f) => state.used.has(f))) continue
        seen.add(flag)
        const aliases = option.flags.filter((f) => f !== flag)
        const label = option.value ? `${flag} <${option.value}>` : flag
        candidates.push({
          text: flag,
          label,
          detail:
            aliases.length > 0
              ? t('aliases', { detail: option.d, aliases: ltr(aliases.join(', ')) })
              : option.d,
          kind: 'option',
          keepOpen: flag.endsWith('='),
        })
      }
    }
    return { candidates, paths: false, command: false }
  }

  const candidates: CompletionCandidate[] = []
  for (const [name, child] of Object.entries(state.args === 0 ? (spec.s ?? {}) : {})) {
    if (matches(name, prefix))
      candidates.push({ text: name, detail: leaf(child).d, kind: 'subcommand' })
  }
  for (const value of parseValues(spec.v)) {
    if (matches(value.text, prefix))
      candidates.push({ text: value.text, detail: value.d, kind: 'value' })
  }
  return { candidates, paths: spec.p === true, command: false }
}

/** Words of the simple command that the token at `target` belongs to, up to (not including) it. */
export function commandWords(tokens: CommandToken[], target: CommandToken): string[] {
  const before = tokens.filter((token) => token.end <= target.start && token !== target)
  const start = before.map((token) => token.type).lastIndexOf('command')
  return start < 0 ? [] : before.slice(start).map((token) => token.text)
}

/** Description of a command, for command-name suggestions. */
export function commandDetail(name: string): string | undefined {
  const spec = lookup(name)
  return spec === undefined ? undefined : leaf(spec).d
}

/** Every command some registered spec set knows; changes whenever `specsVersion` does. */
export function specCommands(): string[] {
  return [...merged().keys()]
}

export function specsVersion(): number {
  return version
}
