import { getIndentUnit, indentUnit } from '@codemirror/language'
import type { EditorState, TransactionSpec } from '@codemirror/state'
import { type LanguageId, languageId } from './editor-languages'
import { messages } from './i18n'

const t = messages({
  unsupported: {
    zh: '这种语言不支持格式化',
    en: 'Formatting is not available for this language',
    ug: 'بۇ تىلنى فورماتلىغىلى بولمايدۇ',
  },
  pickLanguage: {
    zh: '当前语言不支持格式化，请先在右上角选择语言',
    en: 'No formatter for the current language. Choose a language in the toolbar first.',
    ug: 'نۆۋەتتىكى تىلنى فورماتلىغىلى بولمايدۇ، ئاۋۋال قورال بالدىقىدىن تىل تاللاڭ',
  },
})

type Beautifier = 'js' | 'css' | 'html'

const FORMATTERS: Partial<Record<LanguageId, Beautifier | 'json'>> = {
  javascript: 'js',
  typescript: 'js',
  json: 'json',
  css: 'css',
  scss: 'css',
  less: 'css',
  html: 'html',
  xml: 'html',
}

export function canFormat(id: LanguageId | null): boolean {
  return id !== null && id in FORMATTERS
}

export interface FormatOptions {
  /** Spaces per level; 0 for tabs. */
  indent: number
  tabSize: number
}

const optionsOf = (state: EditorState): FormatOptions => ({
  indent: state.facet(indentUnit) === '\t' ? 0 : getIndentUnit(state),
  tabSize: state.tabSize,
})

/** Re-indents and re-wraps `text`; minified one-line code comes back one statement per line. */
export async function formatCode(
  text: string,
  id: LanguageId,
  options: FormatOptions,
): Promise<string> {
  const kind = FORMATTERS[id]
  if (!kind) throw new Error(t('unsupported'))
  const space = options.indent === 0 ? '\t' : ' '.repeat(options.indent)
  if (kind === 'json') {
    try {
      return JSON.stringify(JSON.parse(text), null, space)
    } catch {
      // JSONC and broken JSON: the JS beautifier keeps comments and copes with errors.
    }
  }
  const beautify = await import('js-beautify')
  const common = {
    indent_size: options.indent || options.tabSize,
    indent_char: options.indent === 0 ? '\t' : ' ',
    indent_with_tabs: options.indent === 0,
    preserve_newlines: true,
    max_preserve_newlines: 2,
    end_with_newline: false,
    wrap_line_length: 0,
  }
  if (kind === 'css') return beautify.css(text, { ...common, newline_between_rules: true })
  if (kind === 'html') {
    return beautify.html(text, {
      ...common,
      indent_inner_html: true,
      indent_scripts: 'normal',
      wrap_attributes: 'auto',
      extra_liners: [],
      // XML keeps every tag on its own line; HTML lets inline tags stay inline.
      inline: id === 'xml' ? [] : undefined,
    })
  }
  return beautify.js(text, {
    ...common,
    space_in_empty_paren: false,
    keep_array_indentation: false,
  })
}

const indentOf = (line: string) => /^[ \t]*/.exec(line)?.[0] ?? ''

/**
 * The change that formats the selection, or the whole document when nothing is selected. Null
 * when the text is already formatted.
 */
export async function formatChange(state: EditorState): Promise<TransactionSpec | null> {
  const id = state.facet(languageId)
  if (!id || !canFormat(id)) throw new Error(t('pickLanguage'))
  const options = optionsOf(state)
  const { main } = state.selection
  const whole = main.empty
  const from = whole ? 0 : state.doc.lineAt(main.from).from
  const to = whole ? state.doc.length : main.to
  const original = state.sliceDoc(from, to)
  let text = await formatCode(original, id, options)
  if (whole) {
    if (/\n$/.test(original)) text += '\n'
  } else {
    // A selection keeps the indentation of the line it starts on.
    const base = indentOf(original)
    text = text
      .split('\n')
      .map((line) => (line ? base + line : line))
      .join('\n')
    if (/\n$/.test(original)) text += '\n'
  }
  if (text === original) return null
  return {
    changes: { from, to, insert: text },
    userEvent: 'input.format',
    scrollIntoView: true,
  }
}

/** Long lines and few of them: a minified bundle rather than hand-written code. */
export function looksMinified(text: string): boolean {
  if (text.length < 400) return false
  const lines = text.split('\n')
  const longest = lines.reduce((n, line) => Math.max(n, line.length), 0)
  return longest > 500 && text.length / lines.length > 200
}
