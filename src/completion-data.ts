import { SPECS as en } from './completion-data.en'
import { SPECS as ug } from './completion-data.ug'
import { SPECS as zh } from './completion-data.zh'
import { lang } from './i18n'

/**
 * Built-in shell completion data, one file per language. completion-data.zh.ts is the source; the
 * en and ug files have the same commands, flags and values (completion-data.test.ts checks this).
 *
 * Option and value lists are `;`-separated entries of `flags [<value>] description`. Flags are
 * `|`-separated aliases; `<value>` marks an option that takes the next word, and a flag ending in
 * `=` takes its value inline.
 */
export interface CommandSpec {
  d: string
  /** Subcommands; a bare string is the description of a leaf. */
  s?: Record<string, CommandSpec | string>
  o?: string
  /** Values for plain arguments. */
  v?: string
  /** Values for an option's argument, keyed by any of its flags. */
  a?: Record<string, string>
  /** Plain arguments are remote paths. */
  p?: true
  /** The first plain argument starts a command line of its own (sudo, watch…). */
  c?: true
}

/** The completion data in the language of this run. */
export const SPECS: Record<string, CommandSpec | string> = { zh, en, ug }[lang()]
