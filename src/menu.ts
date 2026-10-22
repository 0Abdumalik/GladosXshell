import { h } from './dom'
import { isRtl } from './i18n'
import { icon, namedIcon } from './icons'

export type MenuItem =
  | {
      label: string
      action: () => void
      danger?: boolean
      disabled?: boolean
      /** Makes it a check item. */
      checked?: boolean
      /** An icon name; plugin icons are `<pluginId>/<name>`. */
      icon?: string
    }
  | 'separator'

export interface MenuOptions {
  /** Runs after the menu closes, chosen or not (after the chosen item's action). */
  onClose?: () => void
}

let open: { menu: HTMLElement; restore: HTMLElement | null; onClose?: () => void } | null = null

function closeMenu(): void {
  if (!open) return
  const { menu, restore, onClose } = open
  open = null
  menu.remove()
  restore?.focus()
  if (onClose) queueMicrotask(onClose)
}

/** Drops separators at either end and repeated ones, so pieced-together menus stay tidy. */
export function tidyMenu(items: readonly MenuItem[]): MenuItem[] {
  const out: MenuItem[] = []
  for (const item of items) {
    if (item === 'separator' && (out.length === 0 || out.at(-1) === 'separator')) continue
    out.push(item)
  }
  if (out.at(-1) === 'separator') out.pop()
  return out
}

// A keyboard-opened menu (ContextMenu key, Shift+F10) reports the middle of the focused element;
// the menu goes below that element instead.
let keyboardPoint: { x: number; y: number; start: number; bottom: number } | null = null
window.addEventListener(
  'contextmenu',
  (event) => {
    if (event.button !== -1 || !(event.target instanceof Element)) return
    const rect = event.target.getBoundingClientRect()
    const start = isRtl() ? rect.right : rect.left
    keyboardPoint = { x: event.clientX, y: event.clientY, start, bottom: rect.bottom }
    setTimeout(() => {
      keyboardPoint = null
    })
  },
  true,
)

/** Popup menu at viewport coordinates; arrow keys move, Enter runs, Escape closes. */
export function showMenu(x: number, y: number, list: MenuItem[], options?: MenuOptions): void {
  closeMenu()
  const items = tidyMenu(list)
  if (items.length === 0) {
    if (options?.onClose) queueMicrotask(options.onClose)
    return
  }
  const point = keyboardPoint
  const at =
    point && point.x === x && point.y === y
      ? { x: point.start + (isRtl() ? -8 : 8), y: point.bottom + 2 }
      : { x, y }
  const restore = document.activeElement instanceof HTMLElement ? document.activeElement : null
  const buttons: HTMLButtonElement[] = []
  const menu = h('div', { class: 'gx-menu', role: 'menu' })
  // One icon column for the whole menu keeps the labels aligned.
  const slots = items.some((i) => i !== 'separator' && (i.icon || i.checked !== undefined))
  for (const item of items) {
    if (item === 'separator') {
      menu.append(h('div', { class: 'gx-menu-sep', role: 'separator' }))
      continue
    }
    const entry = h('button', {
      type: 'button',
      role: item.checked === undefined ? 'menuitem' : 'menuitemcheckbox',
      'aria-checked': item.checked === undefined ? null : String(item.checked),
      class: item.danger ? 'danger' : null,
      disabled: item.disabled ?? false,
      tabindex: '-1',
    })
    if (slots) {
      const mark = item.checked
        ? icon('check')
        : item.icon && item.checked === undefined
          ? namedIcon(item.icon)
          : null
      entry.append(h('span', { class: 'gx-menu-icon' }, mark))
    }
    entry.append(h('span', { class: 'gx-menu-label', text: item.label }))
    entry.addEventListener('click', () => {
      closeMenu()
      item.action()
    })
    buttons.push(entry)
    menu.append(entry)
  }
  menu.addEventListener('keydown', (event) => {
    const enabled = buttons.filter((b) => !b.disabled)
    const index = enabled.indexOf(document.activeElement as HTMLButtonElement)
    if (event.key === 'Escape' || event.key === 'Tab') {
      event.preventDefault()
      closeMenu()
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const step = event.key === 'ArrowDown' ? 1 : -1
      enabled[(index + step + enabled.length) % enabled.length]?.focus()
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      ;(event.key === 'Home' ? enabled[0] : enabled.at(-1))?.focus()
    }
  })
  // Inside an open modal only the top layer is interactive, so the menu must live there too.
  const host = document.querySelector<HTMLDialogElement>('dialog[open]:modal') ?? document.body
  host.append(menu)
  const rect = menu.getBoundingClientRect()
  // Right-to-left menus hang to the left of the point, so they read from it.
  const left = Math.min(isRtl() ? at.x - rect.width : at.x, window.innerWidth - rect.width - 4)
  const top = Math.min(at.y, window.innerHeight - rect.height - 4)
  menu.style.setProperty('--x', `${Math.max(4, left)}px`)
  menu.style.setProperty('--y', `${Math.max(4, top)}px`)
  open = { menu, restore, onClose: options?.onClose }
  buttons.find((b) => !b.disabled)?.focus()
}

/** Opens the menu below an element (for keyboard and button triggers). */
export function showMenuFor(anchor: HTMLElement, items: MenuItem[]): void {
  const rect = anchor.getBoundingClientRect()
  showMenu(isRtl() ? rect.right : rect.left, rect.bottom + 2, items)
}

document.addEventListener(
  'pointerdown',
  (event) => {
    if (open && !open.menu.contains(event.target as Node)) closeMenu()
  },
  true,
)
window.addEventListener('blur', closeMenu)
window.addEventListener('resize', closeMenu)
