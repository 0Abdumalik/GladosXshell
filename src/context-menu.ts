import { readText, writeText } from '@tauri-apps/plugin-clipboard-manager'
import { reportError } from './dom'
import { messages } from './i18n'
import { common } from './i18n-common'
import { type MenuItem, showMenu } from './menu'

/** What the generic text menu tells contributors (`text/context` for plugins). */
export interface TextContext {
  selection: string
  editable: boolean
}

export interface ContextMenuOptions {
  /** Extra items for the text menu (inputs and selected text). */
  textItems?: (context: TextContext) => MenuItem[]
}

type Field = HTMLInputElement | HTMLTextAreaElement

const t = messages({
  undo: { zh: '撤销', en: 'Undo', ug: 'يېنىۋال' },
  redo: { zh: '重做', en: 'Redo', ug: 'قايتا قىل' },
  cut: { zh: '剪切', en: 'Cut', ug: 'كەس' },
})

const TEXT_INPUTS = new Set(['text', 'search', 'url', 'tel', 'email', 'password', 'number', ''])

function fieldOf(target: EventTarget | null): Field | null {
  if (target instanceof HTMLTextAreaElement) return target
  if (target instanceof HTMLInputElement && TEXT_INPUTS.has(target.type)) return target
  return null
}

const report = reportError

function fieldSelection(field: Field): string {
  // number inputs do not expose a selection.
  if (field.selectionStart === null || field.selectionEnd === null) return ''
  return field.value.slice(field.selectionStart, field.selectionEnd)
}

/** Cut/copy/paste for a text field; edits go through execCommand so Ctrl+Z still undoes them. */
function fieldItems(field: Field): MenuItem[] {
  const selection = fieldSelection(field)
  const writable = !field.readOnly && !field.disabled
  const secret = field instanceof HTMLInputElement && field.type === 'password'
  const edit = (run: () => void | Promise<void>) => async () => {
    field.focus()
    try {
      await run()
    } catch (error) {
      report(error)
    }
  }
  return [
    {
      label: t('undo'),
      icon: 'arrow-counter-clockwise',
      disabled: !writable,
      action: edit(() => void document.execCommand('undo')),
    },
    {
      label: t('redo'),
      icon: 'arrow-clockwise',
      disabled: !writable,
      action: edit(() => void document.execCommand('redo')),
    },
    'separator',
    {
      label: t('cut'),
      icon: 'scissors',
      disabled: !writable || !selection || secret,
      action: edit(async () => {
        await writeText(selection)
        document.execCommand('delete')
      }),
    },
    {
      label: common('copy'),
      icon: 'copy',
      disabled: !selection || secret,
      action: edit(() => writeText(selection)),
    },
    {
      label: common('paste'),
      icon: 'clipboard-text',
      disabled: !writable,
      action: edit(async () => {
        const text = await readText()
        if (text) document.execCommand('insertText', false, text)
      }),
    },
    {
      label: common('delete'),
      icon: 'x',
      disabled: !writable || !selection,
      action: edit(() => void document.execCommand('delete')),
    },
    'separator',
    {
      label: common('selectAll'),
      icon: 'selection-all',
      disabled: field.value === '',
      action: edit(() => field.select()),
    },
  ]
}

function selectedText(target: Node): string {
  const selection = window.getSelection()
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return ''
  const text = selection.toString()
  if (!text.trim()) return ''
  // Only when the click lands on the selection's part of the page, not somewhere unrelated.
  const range = selection.getRangeAt(0)
  const box = range.commonAncestorContainer
  return box.contains(target) || target.contains(box) ? text : ''
}

/**
 * The browser's own menu (Back, Reload, Inspect…) never shows. Places with a menu of their own
 * handle the event first and call preventDefault; everything else ends up here: text fields get
 * an edit menu, selected text a copy entry, the rest no menu at all.
 *
 * In development, Ctrl+right-click still opens the browser menu for Inspect.
 */
export function initContextMenus(options: ContextMenuOptions = {}): void {
  window.addEventListener('contextmenu', (event) => {
    if (event.defaultPrevented) return
    if (import.meta.env.DEV && event.ctrlKey) return
    event.preventDefault()
    const target = event.target
    if (!(target instanceof Node)) return
    const field = fieldOf(target)
    const selection = field ? fieldSelection(field) : selectedText(target)
    let items: MenuItem[]
    if (field) items = fieldItems(field)
    else if (selection)
      items = [
        {
          label: common('copy'),
          icon: 'copy',
          action: () => writeText(selection).catch(report),
        },
      ]
    else return
    const extra = options.textItems?.({ selection, editable: field !== null }) ?? []
    showMenu(event.clientX, event.clientY, [...items, 'separator', ...extra])
  })
}
