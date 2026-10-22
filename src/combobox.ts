import { h, uniqueId } from './dom'
import { messages } from './i18n'
import { icon } from './icons'

const t = messages({
  showList: { zh: '展开列表', en: 'Show list', ug: 'تىزىملىكنى ياي' },
  noOptions: { zh: '没有可选的项', en: 'No options', ug: 'تاللىغىلى بولىدىغان تۈر يوق' },
  noMatches: { zh: '没有匹配的项', en: 'No matches', ug: 'ماس كېلىدىغان تۈر يوق' },
  more: {
    zh: '还有 {n} 项，输入文字缩小范围',
    en: '{n} more, type to narrow the list',
    ug: 'يەنە {n} تۈر بار، دائىرىنى تارايتىش ئۈچۈن خەت كىرگۈزۈڭ',
  },
})

export interface ComboOption {
  value: string
  /** Shown instead of the value. */
  label?: string
  /** Muted text after the label. */
  detail?: string
  /** Renders the label in this font family (a preview). */
  font?: string
  /** Options with the same group are listed under one heading, in first-seen order. */
  group?: string
}

export interface ComboboxOptions {
  /** Options for the current moment; called each time the list opens or the text changes. */
  options: () => ComboOption[]
  /** Runs after an option is picked and written into the input. */
  pick: (value: string) => void
  /** Text for an empty list. */
  empty?: string
  /** Label of the toggle button. */
  toggleLabel?: string
}

const MAX_SHOWN = 200

function matches(option: ComboOption, words: string[]): boolean {
  const text = `${option.value} ${option.label ?? ''} ${option.detail ?? ''}`.toLowerCase()
  return words.every((w) => text.includes(w))
}

/**
 * A text input with a drop-down list (the ARIA combobox pattern): the toggle shows every option,
 * typing filters them, and free text stays allowed. Call it after the input is in its place.
 */
export function combobox(
  input: HTMLInputElement,
  config: ComboboxOptions,
): { element: HTMLElement; close: () => void } {
  const listId = uniqueId('combo')
  const list = h('ul', { class: 'combo-list', id: listId, role: 'listbox', hidden: true })
  const toggle = h(
    'button',
    {
      type: 'button',
      class: 'icon-button combo-toggle',
      tabindex: '-1',
      title: config.toggleLabel ?? t('showList'),
      'aria-label': config.toggleLabel ?? t('showList'),
      'aria-controls': listId,
    },
    icon('caret-down'),
  )
  input.setAttribute('role', 'combobox')
  input.setAttribute('aria-autocomplete', 'list')
  input.setAttribute('aria-expanded', 'false')
  input.setAttribute('aria-controls', listId)
  // Takes the input's place, so it can be called after `field()` has laid the input out.
  const element = h('div', { class: 'combo' })
  input.replaceWith(element)
  element.append(input, toggle, list)

  let shown: { option: ComboOption; row: HTMLElement }[] = []
  let active = -1

  const setActive = (index: number) => {
    shown[active]?.row.removeAttribute('aria-selected')
    active = index
    const item = shown[active]
    if (!item) {
      input.removeAttribute('aria-activedescendant')
      return
    }
    item.row.setAttribute('aria-selected', 'true')
    input.setAttribute('aria-activedescendant', item.row.id)
    item.row.scrollIntoView({ block: 'nearest' })
  }

  const place = () => {
    const rect = element.getBoundingClientRect()
    const below = window.innerHeight - rect.bottom
    const up = below < 200 && rect.top > below
    list.style.setProperty('--combo-x', `${rect.left}px`)
    list.style.setProperty('--combo-w', `${rect.width}px`)
    list.style.setProperty('--combo-y', `${up ? rect.top : rect.bottom}px`)
    list.dataset.up = String(up)
  }

  const onScroll = (event: Event) => {
    if (event.target instanceof Node && list.contains(event.target)) return
    close()
  }

  const close = () => {
    if (list.hidden) return
    list.hidden = true
    input.setAttribute('aria-expanded', 'false')
    input.removeAttribute('aria-activedescendant')
    window.removeEventListener('scroll', onScroll, true)
    window.removeEventListener('resize', close)
  }

  const choose = (option: ComboOption) => {
    input.value = option.value
    close()
    config.pick(option.value)
  }

  const render = (filter: boolean) => {
    const words = filter ? input.value.trim().toLowerCase().split(/\s+/).filter(Boolean) : []
    const all = config.options()
    const found = all.filter((o) => matches(o, words))
    const groups = new Map<string, ComboOption[]>()
    for (const option of found.slice(0, MAX_SHOWN)) {
      const key = option.group ?? ''
      groups.set(key, [...(groups.get(key) ?? []), option])
    }
    shown = []
    active = -1
    const rows: HTMLElement[] = []
    for (const [group, options] of groups) {
      if (group) rows.push(h('li', { class: 'combo-group', role: 'presentation', text: group }))
      for (const option of options) {
        const label = h('span', { class: 'combo-label', text: option.label ?? option.value })
        if (option.font) label.style.setProperty('--combo-font', `"${option.font}"`)
        const row = h(
          'li',
          { class: 'combo-option', role: 'option', id: uniqueId('combo-opt') },
          label,
          option.detail ? h('span', { class: 'combo-detail', text: option.detail }) : null,
        )
        // Keeps focus in the input so the click is not a blur.
        row.addEventListener('pointerdown', (event) => event.preventDefault())
        row.addEventListener('click', () => choose(option))
        shown.push({ option, row })
        rows.push(row)
      }
    }
    if (rows.length === 0) {
      const text = all.length === 0 ? (config.empty ?? t('noOptions')) : t('noMatches')
      rows.push(h('li', { class: 'combo-empty', role: 'presentation', text }))
    } else if (found.length > MAX_SHOWN) {
      const text = t('more', { n: found.length - MAX_SHOWN })
      rows.push(h('li', { class: 'combo-empty', role: 'presentation', text }))
    }
    list.replaceChildren(...rows)
  }

  const show = (filter: boolean) => {
    render(filter)
    place()
    if (list.hidden) {
      list.hidden = false
      input.setAttribute('aria-expanded', 'true')
      window.addEventListener('scroll', onScroll, true)
      window.addEventListener('resize', close)
    }
    const current = input.value.trim().toLowerCase()
    const index = shown.findIndex((s) => s.option.value.toLowerCase() === current)
    if (index >= 0) setActive(index)
  }

  toggle.addEventListener('pointerdown', (event) => event.preventDefault())
  toggle.addEventListener('click', () => {
    if (list.hidden) {
      input.focus()
      show(false)
    } else close()
  })
  input.addEventListener('input', () => show(true))
  input.addEventListener('blur', close)
  input.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (list.hidden) {
        show(false)
        return
      }
      if (shown.length === 0) return
      const step = event.key === 'ArrowDown' ? 1 : -1
      setActive((active + step + shown.length) % shown.length)
    } else if (event.key === 'Enter' && !list.hidden && shown[active]) {
      event.preventDefault()
      choose(shown[active].option)
    } else if (event.key === 'Escape' && !list.hidden) {
      // Closes the list only, not the surrounding dialog.
      event.preventDefault()
      event.stopPropagation()
      close()
    }
  })
  return { element, close }
}
