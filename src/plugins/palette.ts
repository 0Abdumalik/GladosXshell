import { fillCommand } from '../command-bar'
import { h, uniqueId } from '../dom'
import { locale, messages } from '../i18n'
import { namedIcon } from '../icons'
import type { PickItem } from './api'
import { fuzzyFilter } from './fuzzy'
import { commandAvailable, commands, keyFor, runCommand, snippets } from './registry'

const t = messages({
  filter: { zh: '输入以筛选', en: 'Type to filter', ug: 'سۈزۈش ئۈچۈن كىرگۈزۈڭ' },
  results: { zh: '结果', en: 'Results', ug: 'نەتىجىلەر' },
  noMatches: { zh: '没有匹配项', en: 'No matches', ug: 'ماس كېلىدىغىنى يوق' },
  categorySep: { zh: '：', en: ': ', ug: ': ' },
  snippet: { zh: '片段：{name}', en: 'Snippet: {name}', ug: 'پارچە: {name}' },
  commandName: { zh: '输入命令名称', en: 'Type a command name', ug: 'بۇيرۇق ئاتىنى كىرگۈزۈڭ' },
})

const MAX_SHOWN = 200

/** A filterable list in a modal; resolves with the chosen value, or null on Escape. */
export function pick<T>(items: PickItem<T>[], placeholder = t('filter')): Promise<T | null> {
  const listId = uniqueId('palette-list')
  const input = h('input', {
    type: 'text',
    class: 'palette-input',
    role: 'combobox',
    'aria-expanded': 'true',
    'aria-controls': listId,
    'aria-autocomplete': 'list',
    'aria-label': placeholder,
    placeholder,
    spellcheck: 'false',
    autocomplete: 'off',
  })
  const list = h('ul', {
    id: listId,
    class: 'palette-list',
    role: 'listbox',
    'aria-label': t('results'),
  })
  const empty = h('p', { class: 'palette-empty', text: t('noMatches'), hidden: true })
  const dialog = h('dialog', { class: 'gx-palette', 'aria-label': placeholder }, input, list, empty)
  document.body.append(dialog)

  let shown: PickItem<T>[] = []
  let active = 0
  let chosen: T | null = null

  const render = () => {
    shown = fuzzyFilter(items, input.value, (i) => `${i.label} ${i.detail ?? ''}`).slice(
      0,
      MAX_SHOWN,
    )
    active = 0
    list.replaceChildren(
      ...shown.map((item, index) =>
        h(
          'li',
          {
            id: `${listId}-${index}`,
            role: 'option',
            class: 'palette-item',
            'aria-selected': 'false',
            onmousedown: (event: Event) => event.preventDefault(),
            onclick: () => choose(index),
            onmousemove: () => highlight(index),
          },
          h('span', { class: 'palette-icon' }, item.icon ? namedIcon(item.icon) : null),
          h('span', { class: 'palette-label', text: item.label }),
          item.detail ? h('span', { class: 'palette-detail', text: item.detail }) : null,
          item.hint ? h('kbd', { class: 'palette-hint', text: item.hint }) : null,
        ),
      ),
    )
    empty.hidden = shown.length > 0
    highlight(0)
  }

  const highlight = (index: number) => {
    const items = list.children
    items[active]?.setAttribute('aria-selected', 'false')
    active = index
    const item = items[active]
    if (!item) {
      input.removeAttribute('aria-activedescendant')
      return
    }
    item.setAttribute('aria-selected', 'true')
    input.setAttribute('aria-activedescendant', item.id)
    item.scrollIntoView({ block: 'nearest' })
  }

  const choose = (index: number) => {
    const item = shown[index]
    if (!item) return
    chosen = item.value
    dialog.close()
  }

  input.addEventListener('input', render)
  input.addEventListener('keydown', (event) => {
    const count = shown.length
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (count > 0) highlight((active + (event.key === 'ArrowDown' ? 1 : -1) + count) % count)
    } else if (event.key === 'PageDown' || event.key === 'PageUp') {
      event.preventDefault()
      if (count > 0) {
        const step = event.key === 'PageDown' ? 8 : -8
        highlight(Math.max(0, Math.min(count - 1, active + step)))
      }
    } else if (event.key === 'Enter') {
      event.preventDefault()
      choose(active)
    }
  })
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close()
  })

  const restore = document.activeElement instanceof HTMLElement ? document.activeElement : null
  return new Promise((resolve) => {
    dialog.addEventListener(
      'close',
      () => {
        dialog.remove()
        if (chosen === null) restore?.focus()
        resolve(chosen)
      },
      { once: true },
    )
    render()
    dialog.showModal()
    input.focus()
  })
}

type Choice = { kind: 'command'; id: string } | { kind: 'snippet'; command: string }

/** Plugin authors often write the prefix themselves; it should not show up twice. */
function withCategory(category: string | undefined, title: string): string {
  if (!category) return title
  // i18n-ignore: a title may carry the prefix with either colon, whatever the language
  const written = title.startsWith(`${category}：`) || title.startsWith(`${category}:`)
  return written ? title : `${category}${t('categorySep')}${title}`
}

/** Every available command and snippet; the chosen command runs, a snippet fills the command bar. */
export async function openPalette(): Promise<void> {
  const items: PickItem<Choice>[] = []
  const seen = new Set<string>()
  const defs = commands.list()
  for (let i = defs.length - 1; i >= 0; i--) {
    const def = defs[i]
    if (seen.has(def.id)) continue
    seen.add(def.id)
    if (!commandAvailable(def)) continue
    items.push({
      label: withCategory(def.category, def.title),
      icon: def.icon,
      hint: keyFor(def.id) ?? undefined,
      value: { kind: 'command', id: def.id },
    })
  }
  items.sort((a, b) => a.label.localeCompare(b.label, locale()))
  for (const snippet of snippets.list()) {
    items.push({
      label: t('snippet', { name: snippet.name }),
      icon: 'brackets-curly',
      detail: snippet.description ?? snippet.command,
      value: { kind: 'snippet', command: snippet.command },
    })
  }
  const choice = await pick(items, t('commandName'))
  if (choice?.kind === 'command') await runCommand(choice.id)
  else if (choice?.kind === 'snippet') fillCommand(choice.command)
}
