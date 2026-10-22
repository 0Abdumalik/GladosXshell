import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completeAnyWord,
} from '@codemirror/autocomplete'
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
  redo,
  redoDepth,
  undo,
  undoDepth,
} from '@codemirror/commands'
import {
  bracketMatching,
  foldGutter,
  foldKeymap,
  getIndentUnit,
  HighlightStyle,
  indentOnInput,
  indentUnit,
  syntaxHighlighting,
} from '@codemirror/language'
import { lintKeymap } from '@codemirror/lint'
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search'
import { Compartment, EditorState, type Extension, RangeSetBuilder } from '@codemirror/state'
import {
  crosshairCursor,
  Decoration,
  type DecorationSet,
  drawSelection,
  dropCursor,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  highlightWhitespace,
  type KeyBinding,
  keymap,
  lineNumbers,
  rectangularSelection,
  ViewPlugin,
  type ViewUpdate,
} from '@codemirror/view'
import { classHighlighter, tags } from '@lezer/highlight'
import { readText, writeText } from '@tauri-apps/plugin-clipboard-manager'
import { reportError, setStatus } from './dom'
import { formatChange } from './editor-format'
import { detectIndentUnit, leadingColumns } from './editor-indent'
import { problemLinter } from './editor-lint'
import { scrollbars } from './editor-scrollbar'
import { messages } from './i18n'
import { common } from './i18n-common'
import { type MenuItem, showMenu } from './menu'
import { EDITOR_FEATURES, type EditorSettings } from './settings-model'
import { onSettings, settings, updateSettings } from './settings-store'

const t = messages({
  changedWhileFormatting: {
    zh: '格式化期间内容有变化，请再试一次',
    en: 'The text changed while formatting; try again',
    ug: 'فورماتلاش جەريانىدا مەزمۇن ئۆزگىرىپ كەتتى، قايتا سىناڭ',
  },
  alreadyFormatted: {
    zh: '已经是格式化后的样子',
    en: 'Already formatted',
    ug: 'ئاللىقاچان فورماتلانغان',
  },
  formatted: {
    zh: '已格式化（Ctrl+Z 可撤销）',
    en: 'Formatted (Ctrl+Z to undo)',
    ug: 'فورماتلاندى (Ctrl+Z بىلەن يېنىۋالغىلى بولىدۇ)',
  },
  undo: { zh: '撤销', en: 'Undo', ug: 'يېنىۋال' },
  redo: { zh: '重做', en: 'Redo', ug: 'قايتا قىل' },
  cut: { zh: '剪切', en: 'Cut', ug: 'كەس' },
  tabWidth: { zh: '制表符宽度 {size}', en: 'Tab width {size}', ug: 'جەدۋەل بەلگە كەڭلىكى {size}' },
  // CodeMirror's own phrases (search panel, go to line, folding, lint panel).
  find: { zh: '查找', en: 'Find', ug: 'ئىزدە' },
  replace: { zh: '替换', en: 'Replace', ug: 'ئالماشتۇر' },
  next: { zh: '下一个', en: 'Next', ug: 'كېيىنكى' },
  previous: { zh: '上一个', en: 'Previous', ug: 'ئالدىنقى' },
  selectMatches: { zh: '全选匹配', en: 'Select matches', ug: 'ماسلارنى تاللا' },
  matchCase: { zh: '区分大小写', en: 'Match case', ug: 'چوڭ-كىچىك ھەرپنى پەرقلەندۈر' },
  regexp: { zh: '正则表达式', en: 'Regex', ug: 'مۇنتىزىم ئىپادە' },
  byWord: { zh: '全字匹配', en: 'Whole word', ug: 'پۈتۈن سۆز' },
  replaceAll: { zh: '全部替换', en: 'Replace all', ug: 'ھەممىنى ئالماشتۇر' },
  currentMatch: { zh: '当前匹配', en: 'Current match', ug: 'نۆۋەتتىكى ماس' },
  onLine: { zh: '位于行', en: 'on line', ug: 'قۇر' },
  replacedOnLine: {
    zh: '已替换第 $ 行的匹配',
    en: 'Replaced match on line $',
    ug: '$-قۇردىكى ماس ئالماشتۇرۇلدى',
  },
  replacedCount: { zh: '已替换 $ 处匹配', en: 'Replaced $ matches', ug: '$ ماس ئالماشتۇرۇلدى' },
  goToLine: { zh: '跳转到行', en: 'Go to line', ug: 'قۇرغا يۆتكەل' },
  go: { zh: '跳转', en: 'Go', ug: 'يۆتكەل' },
  rangeTo: { zh: '至', en: 'to', ug: 'دىن' },
  foldedLines: { zh: '已折叠的行', en: 'Folded lines', ug: 'قاتلانغان قۇرلار' },
  unfoldedLines: { zh: '已展开的行', en: 'Unfolded lines', ug: 'يېيىلغان قۇرلار' },
  foldedCode: { zh: '已折叠的代码', en: 'Folded code', ug: 'قاتلانغان كود' },
  unfold: { zh: '展开', en: 'Unfold', ug: 'ياي' },
  foldLine: { zh: '折叠', en: 'Fold line', ug: 'قاتلا' },
  unfoldLine: { zh: '展开', en: 'Unfold line', ug: 'ياي' },
  controlCharacter: { zh: '控制字符', en: 'Control character', ug: 'كونترول ھەرپى' },
  selectionDeleted: {
    zh: '已删除选中内容',
    en: 'Selection deleted',
    ug: 'تاللانغان مەزمۇن ئۆچۈرۈلدى',
  },
  completions: { zh: '补全', en: 'Completions', ug: 'تولۇقلاش' },
  diagnostics: { zh: '问题', en: 'Problems', ug: 'مەسىلىلەر' },
  noDiagnostics: { zh: '没有发现问题', en: 'No problems', ug: 'مەسىلە بايقالمىدى' },
})

const guideMarks = new Map<string, Decoration>()

function guideMark(cols: number, step: number): Decoration {
  const key = `${cols}/${step}`
  let mark = guideMarks.get(key)
  if (!mark) {
    mark = Decoration.line({
      class: 'cm-indented',
      attributes: { style: `--gx-indent: ${cols}; --gx-indent-step: ${step}` },
    })
    guideMarks.set(key, mark)
  }
  return mark
}

/** A blank line inside a block keeps the guides of the shallower of its neighbours. */
function blankIndent(state: EditorState, lineNo: number, tabSize: number): number {
  const near = (dir: -1 | 1) => {
    for (let n = lineNo + dir, i = 0; n >= 1 && n <= state.doc.lines && i < 200; n += dir, i++) {
      const cols = leadingColumns(state.doc.line(n).text, tabSize)
      if (cols !== null) return cols
    }
    return 0
  }
  return Math.min(near(-1), near(1))
}

function buildGuides(view: EditorView): DecorationSet {
  const { state } = view
  const step = Math.max(1, getIndentUnit(state))
  const builder = new RangeSetBuilder<Decoration>()
  let last = 0
  for (const { from, to } of view.visibleRanges) {
    for (let pos = from; pos <= to; ) {
      const line = state.doc.lineAt(pos)
      pos = line.to + 1
      if (line.number <= last) continue
      last = line.number
      const cols =
        leadingColumns(line.text, state.tabSize) ?? blankIndent(state, line.number, state.tabSize)
      if (cols > 0) builder.add(line.from, line.from, guideMark(cols, step))
    }
  }
  return builder.finish()
}

const indentGuides = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(view: EditorView) {
      this.decorations = buildGuides(view)
    }
    update(update: ViewUpdate) {
      const unitChanged =
        update.startState.facet(indentUnit) !== update.state.facet(indentUnit) ||
        update.startState.tabSize !== update.state.tabSize
      if (update.docChanged || update.viewportChanged || unitChanged) {
        this.decorations = buildGuides(update.view)
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
)

function features(e: EditorSettings): Extension {
  return [
    e.lineNumbers ? lineNumbers() : [],
    e.fold ? foldGutter() : [],
    e.activeLine ? [highlightActiveLine(), highlightActiveLineGutter()] : [],
    e.selectionMatches ? highlightSelectionMatches() : [],
    e.closeBrackets ? [closeBrackets(), keymap.of(closeBracketsKeymap)] : [],
    e.autocomplete
      ? [autocompletion(), EditorState.languageData.of(() => [{ autocomplete: completeAnyWord }])]
      : [],
    e.wordWrap ? EditorView.lineWrapping : [],
    e.whitespace ? highlightWhitespace() : [],
    e.indentGuides ? indentGuides : [],
    e.lint ? problemLinter() : [],
    scrollbars(e.minimap),
    EditorState.tabSize.of(e.tabSize),
  ]
}

const changeEditor = (change: (e: EditorSettings) => void) =>
  updateSettings((d) => change(d.editor)).catch((error) => reportError(error))

/** Formats the selection, or the whole document, as one undoable step. */
export async function formatDocument(view: EditorView): Promise<boolean> {
  const before = view.state
  const change = await formatChange(before)
  if (view.state !== before) throw new Error(t('changedWhileFormatting'))
  if (!change) {
    setStatus(t('alreadyFormatted'))
    return false
  }
  view.dispatch(change)
  setStatus(t('formatted'))
  return true
}

/** VS Code keys: Shift+Alt+F formats, Alt+Z toggles word wrap. */
const vscodeKeys: KeyBinding[] = [
  {
    key: 'Shift-Alt-f',
    run: (view) => {
      formatDocument(view).catch((error) => reportError(error))
      return true
    },
  },
  {
    key: 'Alt-z',
    run: () => {
      changeEditor((e) => {
        e.wordWrap = !e.wordWrap
      })
      return true
    },
  },
]

/** The selected text, ranges joined by line breaks. */
export function selectedText(view: EditorView): string {
  const { state } = view
  return state.selection.ranges.map((r) => state.sliceDoc(r.from, r.to)).join(state.lineBreak)
}

/**
 * Undo, cut, copy, paste and select-all on right-click, then whatever `extra` adds. Replaces
 * the generic text menu, which does not know about CodeMirror's selection.
 */
export function editMenu(extra: (view: EditorView) => MenuItem[] = () => []): Extension {
  return EditorView.domEventHandlers({
    contextmenu(event, view) {
      event.preventDefault()
      event.stopPropagation()
      const selection = selectedText(view)
      const writable = !view.state.readOnly
      const act = (run: () => unknown) => async () => {
        view.focus()
        try {
          await run()
        } catch (error) {
          reportError(error)
        }
      }
      const items: MenuItem[] = [
        {
          label: t('undo'),
          icon: 'arrow-counter-clockwise',
          disabled: !writable || undoDepth(view.state) === 0,
          action: act(() => undo(view)),
        },
        {
          label: t('redo'),
          icon: 'arrow-clockwise',
          disabled: !writable || redoDepth(view.state) === 0,
          action: act(() => redo(view)),
        },
        'separator',
        {
          label: t('cut'),
          icon: 'scissors',
          disabled: !writable || !selection,
          action: act(async () => {
            await writeText(selection)
            view.dispatch(view.state.replaceSelection(''), { userEvent: 'delete.cut' })
          }),
        },
        {
          label: common('copy'),
          icon: 'copy',
          disabled: !selection,
          action: act(() => writeText(selection)),
        },
        {
          label: common('paste'),
          icon: 'clipboard-text',
          disabled: !writable,
          action: act(async () => {
            const text = await readText()
            if (text) view.dispatch(view.state.replaceSelection(text), { userEvent: 'input.paste' })
          }),
        },
        'separator',
        {
          label: common('selectAll'),
          icon: 'selection-all',
          disabled: view.state.doc.length === 0,
          action: act(() =>
            view.dispatch({ selection: { anchor: 0, head: view.state.doc.length } }),
          ),
        },
        'separator',
        ...extra(view),
      ]
      showMenu(event.clientX, event.clientY, items)
      return true
    },
  })
}

/** Menu entries that switch the optional features (and tab width) for every editor. */
export function editorFeatureItems(): MenuItem[] {
  const current = settings().editor
  return [
    ...EDITOR_FEATURES.map(({ id, name }) => ({
      label: name,
      checked: current[id],
      action: () =>
        changeEditor((e) => {
          e[id] = !e[id]
        }),
    })),
    'separator',
    ...[2, 4, 8].map((size) => ({
      label: t('tabWidth', { size }),
      checked: current.tabSize === size,
      action: () =>
        changeEditor((e) => {
          e.tabSize = size
        }),
    })),
  ]
}

const featureSlot = new Compartment()

// Feature switches are global settings, so every open editor follows a change at once.
const followSettings = ViewPlugin.fromClass(
  class {
    readonly unsubscribe: () => void
    constructor(view: EditorView) {
      this.unsubscribe = onSettings((next, previous) => {
        if (next.editor === previous.editor) return
        view.dispatch({ effects: featureSlot.reconfigure(features(next.editor)) })
      })
    }
    destroy() {
      this.unsubscribe()
    }
  },
)

// VS Code Dark+/Light+ categories; the colours are --gx-syn-* tokens so custom.css can change them.
const syn = (name: string) => `var(--gx-syn-${name})`
const highlightStyle = HighlightStyle.define([
  {
    tag: [tags.keyword, tags.controlKeyword, tags.moduleKeyword, tags.operatorKeyword],
    color: syn('keyword'),
  },
  {
    tag: [
      tags.definitionKeyword,
      tags.modifier,
      tags.bool,
      tags.null,
      tags.atom,
      tags.self,
      tags.constant(tags.name),
    ],
    color: syn('storage'),
  },
  {
    tag: [tags.string, tags.special(tags.string), tags.character, tags.docString],
    color: syn('string'),
  },
  { tag: [tags.regexp, tags.escape, tags.special(tags.brace)], color: syn('regexp') },
  { tag: [tags.number, tags.integer, tags.float, tags.unit], color: syn('number') },
  { tag: tags.comment, color: syn('comment'), fontStyle: 'italic' },
  {
    tag: [tags.variableName, tags.definition(tags.variableName), tags.special(tags.variableName)],
    color: syn('variable'),
  },
  {
    tag: [
      tags.function(tags.variableName),
      tags.function(tags.propertyName),
      tags.standard(tags.variableName),
      tags.macroName,
      tags.labelName,
    ],
    color: syn('function'),
  },
  {
    tag: [tags.typeName, tags.className, tags.namespace, tags.standard(tags.typeName)],
    color: syn('type'),
  },
  { tag: [tags.propertyName, tags.definition(tags.propertyName)], color: syn('property') },
  { tag: [tags.tagName, tags.angleBracket], color: syn('tag') },
  { tag: tags.attributeName, color: syn('attribute') },
  { tag: [tags.operator, tags.punctuation, tags.separator, tags.bracket], color: syn('operator') },
  {
    tag: [tags.meta, tags.processingInstruction, tags.annotation, tags.documentMeta],
    color: syn('meta'),
  },
  { tag: tags.heading, color: syn('storage'), fontWeight: '700' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strong, fontWeight: '700' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
  { tag: [tags.link, tags.url], color: syn('link'), textDecoration: 'underline' },
  { tag: tags.inserted, color: 'var(--gx-success)' },
  { tag: tags.deleted, color: 'var(--gx-danger)' },
  { tag: tags.changed, color: 'var(--gx-warning)' },
  { tag: tags.invalid, color: 'var(--gx-danger)', textDecoration: 'underline wavy' },
])

const phrases = EditorState.phrases.of({
  Find: t('find'),
  Replace: t('replace'),
  next: t('next'),
  previous: t('previous'),
  all: t('selectMatches'),
  'match case': t('matchCase'),
  regexp: t('regexp'),
  'by word': t('byWord'),
  replace: t('replace'),
  'replace all': t('replaceAll'),
  close: common('close'),
  'current match': t('currentMatch'),
  'on line': t('onLine'),
  'replaced match on line $': t('replacedOnLine'),
  'replaced $ matches': t('replacedCount'),
  'Go to line': t('goToLine'),
  go: t('go'),
  to: t('rangeTo'),
  'Folded lines': t('foldedLines'),
  'Unfolded lines': t('unfoldedLines'),
  'folded code': t('foldedCode'),
  unfold: t('unfold'),
  'Fold line': t('foldLine'),
  'Unfold line': t('unfoldLine'),
  'Control character': t('controlCharacter'),
  'Selection deleted': t('selectionDeleted'),
  Completions: t('completions'),
  Diagnostics: t('diagnostics'),
  'No diagnostics': t('noDiagnostics'),
})

// Colours come from --gx-* tokens so custom.css can retheme the editor too.
export const editorTheme = EditorView.theme(
  {
    '&': { height: '100%', color: 'var(--gx-text)', backgroundColor: 'var(--gx-surface-0)' },
    '.cm-scroller': { fontFamily: 'var(--gx-font-mono)', lineHeight: '1.5' },
    '.cm-content': { caretColor: 'var(--gx-accent-strong)' },
    '&.cm-focused .cm-cursor': { borderLeftColor: 'var(--gx-accent-strong)' },
    '&.cm-focused': { outline: 'none' },
    '.cm-gutters': {
      color: 'var(--gx-text-subtle)',
      backgroundColor: 'var(--gx-surface-1)',
      borderRight: '1px solid var(--gx-border)',
    },
    '.cm-foldGutter .cm-gutterElement': { cursor: 'pointer', paddingInline: '0.25rem' },
    '.cm-foldGutter .cm-gutterElement:hover': { color: 'var(--gx-text)' },
    '.cm-foldPlaceholder': {
      color: 'var(--gx-text-muted)',
      backgroundColor: 'var(--gx-surface-3)',
      border: '1px solid var(--gx-border-strong)',
      borderRadius: 'var(--gx-radius-sm)',
      paddingInline: '0.25rem',
    },
    '.cm-activeLine': { backgroundColor: 'var(--gx-code-active-line)' },
    '.cm-activeLineGutter': {
      color: 'var(--gx-text)',
      backgroundColor: 'var(--gx-code-active-line)',
    },
    '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground':
      { backgroundColor: 'var(--gx-selected)' },
    '.cm-selectionMatch': { backgroundColor: 'var(--gx-code-match)' },
    '&.cm-focused .cm-matchingBracket': {
      backgroundColor: 'var(--gx-code-match)',
      outline: '1px solid var(--gx-border-strong)',
    },
    '&.cm-focused .cm-nonmatchingBracket': { color: 'var(--gx-danger)' },
    '.cm-indented': {
      backgroundImage:
        'repeating-linear-gradient(to right, var(--gx-syn-guide) 0 1px, transparent 1px calc(var(--gx-indent-step) * 1ch))',
      backgroundSize: 'calc(var(--gx-indent) * 1ch) 100%',
      backgroundRepeat: 'no-repeat',
      backgroundOrigin: 'content-box',
    },
    '.cm-highlightSpace': {
      backgroundImage:
        'radial-gradient(circle at 50% 55%, var(--gx-text-subtle) 15%, transparent 20%)',
    },
    '.cm-searchMatch': {
      backgroundColor: 'var(--gx-code-match)',
      outline: '1px solid var(--gx-syn-match-border)',
    },
    '.cm-searchMatch.cm-searchMatch-selected': {
      backgroundColor: 'var(--gx-code-match-active)',
    },
    '.cm-panels': { color: 'var(--gx-text)', backgroundColor: 'var(--gx-surface-2)' },
    '.cm-panels.cm-panels-top': { borderBottom: '1px solid var(--gx-border)' },
    '.cm-panels.cm-panels-bottom': { borderTop: '1px solid var(--gx-border)' },
    '.cm-panel.cm-search, .cm-panel.cm-gotoLine': {
      padding: '0.5rem 2.75rem 0.5rem 0.75rem',
      fontFamily: 'var(--gx-font-ui)',
      fontSize: '0.8125rem',
    },
    '.cm-textfield': {
      font: 'inherit',
      fontFamily: 'var(--gx-font-mono)',
      fontSize: '0.8125rem',
      color: 'var(--gx-text)',
      backgroundColor: 'var(--gx-surface-0)',
      border: '1px solid var(--gx-border-strong)',
      borderRadius: 'var(--gx-radius-sm)',
      padding: '0.25rem 0.5rem',
      margin: '0.125rem 0.375rem 0.125rem 0',
      minInlineSize: '16rem',
    },
    '.cm-textfield:focus': {
      outline: '2px solid var(--gx-accent)',
      outlineOffset: '-1px',
    },
    '.cm-panel .cm-button': {
      font: 'inherit',
      fontSize: '0.8125rem',
      color: 'var(--gx-text)',
      backgroundImage: 'none',
      backgroundColor: 'var(--gx-surface-3)',
      border: '1px solid var(--gx-border-strong)',
      borderRadius: 'var(--gx-radius-sm)',
      padding: '0.25rem 0.625rem',
      margin: '0.125rem 0.375rem 0.125rem 0',
      cursor: 'pointer',
      transition: 'background-color 0.15s var(--gx-ease)',
    },
    '.cm-panel .cm-button:hover': { backgroundColor: 'var(--gx-hover)' },
    '.cm-panel .cm-button:active': {
      backgroundImage: 'none',
      transform: 'scale(0.98)',
    },
    '.cm-panel.cm-search label': {
      display: 'inline-flex',
      alignItems: 'center',
      gap: '0.25rem',
      marginInlineEnd: '0.75rem',
      color: 'var(--gx-text-muted)',
      fontSize: '0.8125rem',
      cursor: 'pointer',
    },
    '.cm-panel.cm-search input[type=checkbox]': { accentColor: 'var(--gx-accent)', margin: 0 },
    '.cm-panel.cm-search [name=close]': {
      top: '0.375rem',
      right: '0.5rem',
      padding: '0 0.375rem',
      fontSize: '1.125rem',
      color: 'var(--gx-text-muted)',
      borderRadius: 'var(--gx-radius-sm)',
    },
    '.cm-panel.cm-search [name=close]:hover': { backgroundColor: 'var(--gx-hover)' },
    '.cm-tooltip': {
      color: 'var(--gx-text)',
      backgroundColor: 'var(--gx-surface-3)',
      border: '1px solid var(--gx-border-strong)',
      borderRadius: 'var(--gx-radius-sm)',
    },
    '.cm-tooltip-autocomplete > ul': { fontFamily: 'var(--gx-font-mono)' },
    '.cm-tooltip-autocomplete > ul > li[aria-selected]': {
      color: 'var(--gx-text)',
      backgroundColor: 'var(--gx-selected)',
    },
    '.cm-lintRange-error': {
      backgroundImage: 'none',
      textDecoration: 'underline wavy var(--gx-danger)',
      textDecorationSkipInk: 'none',
      textUnderlineOffset: '3px',
    },
    '.cm-lintRange-warning': {
      backgroundImage: 'none',
      textDecoration: 'underline wavy var(--gx-warning)',
      textDecorationSkipInk: 'none',
      textUnderlineOffset: '3px',
    },
    '.cm-lintPoint:after': { borderBottomColor: 'var(--gx-danger)' },
    '.cm-lintPoint-warning:after': { borderBottomColor: 'var(--gx-warning)' },
    '.cm-diagnostic': {
      padding: '0.25rem 0.5rem',
      fontFamily: 'var(--gx-font-ui)',
      fontSize: '0.8125rem',
      borderLeftWidth: '3px',
    },
    '.cm-diagnostic-error': { borderLeftColor: 'var(--gx-danger)' },
    '.cm-diagnostic-warning': { borderLeftColor: 'var(--gx-warning)' },
    '.cm-tooltip-lint': { maxInlineSize: '36rem' },
    '.cm-panel.cm-panel-lint ul': { maxHeight: '8rem', fontFamily: 'var(--gx-font-ui)' },
    '.cm-panel.cm-panel-lint ul [aria-selected]': {
      backgroundColor: 'var(--gx-selected)',
      color: 'var(--gx-text)',
    },
    '.cm-panel.cm-panel-lint ul:focus [aria-selected]': {
      backgroundColor: 'var(--gx-selected)',
      color: 'var(--gx-text)',
    },
    '.cm-panel.cm-panel-lint [name=close]': {
      color: 'var(--gx-text-muted)',
      fontSize: '1.125rem',
    },
    '.cm-lint-marker': { width: '0.8em', height: '0.8em' },
    '.cm-completionMatchedText': {
      textDecoration: 'none',
      color: 'var(--gx-accent-strong)',
      fontWeight: '600',
    },
  },
  { dark: true },
)

/**
 * Everything the built-in editors share: keys, search, colouring and the optional features from
 * settings (applied live). `keys` take precedence over the defaults; `doc` picks the indent unit.
 */
export function editorSetup(keys: readonly KeyBinding[], doc: string): Extension {
  const config = settings().editor
  return [
    keymap.of([
      ...keys,
      ...vscodeKeys,
      ...lintKeymap,
      ...defaultKeymap,
      ...searchKeymap,
      ...historyKeymap,
      ...foldKeymap,
      indentWithTab,
    ]),
    highlightSpecialChars(),
    history(),
    drawSelection(),
    dropCursor(),
    EditorState.allowMultipleSelections.of(true),
    indentOnInput(),
    bracketMatching(),
    rectangularSelection(),
    crosshairCursor(),
    search({ top: true }),
    indentUnit.of(detectIndentUnit(doc, config.tabSize)),
    featureSlot.of(features(config)),
    followSettings,
    syntaxHighlighting(highlightStyle),
    // Unstyled .tok-* classes as stable hooks for custom.css.
    syntaxHighlighting(classHighlighter),
    phrases,
    editorTheme,
  ]
}
