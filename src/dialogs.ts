import { field, h, setFieldError, uniqueId } from './dom'
import { common } from './i18n-common'
import { icon } from './icons'

export interface ModalParts {
  dialog: HTMLDialogElement
  body: HTMLElement
  actions: HTMLElement
  heading: HTMLElement
}

/** A `.gx-dialog[data-dialog]` shell with a title, close button, body and action row. */
export function modal(
  name: string,
  title: string,
  size: 'sm' | 'md' | 'lg' | 'xl' = 'md',
): ModalParts {
  const titleId = uniqueId('dlg-title')
  const heading = h('h2', { id: titleId, text: title })
  const close = h(
    'button',
    {
      type: 'button',
      class: 'icon-button dialog-x',
      'aria-label': common('close'),
    },
    icon('x'),
  )
  const body = h('div', { class: 'dialog-body' })
  const actions = h('div', { class: 'dialog-actions' })
  const dialog = h(
    'dialog',
    {
      class: 'dialog gx-dialog',
      'data-dialog': name,
      'data-size': size,
      'aria-labelledby': titleId,
    },
    h('header', { class: 'dialog-head' }, heading, close),
    body,
    actions,
  )
  // Same path as Escape, so a dialog with unsaved work can veto both with one 'cancel' listener.
  close.addEventListener('click', () => {
    if (dialog.dispatchEvent(new Event('cancel', { cancelable: true }))) dialog.close()
  })
  document.body.append(dialog)
  return { dialog, body, actions, heading }
}

export function button(
  label: string,
  onclick: () => void,
  variant: 'primary' | 'quiet' | 'danger' | '' = '',
): HTMLButtonElement {
  return h('button', {
    type: 'button',
    class: `button ${variant}`.trim(),
    text: label,
    onclick: () => onclick(),
  })
}

function once(parts: ModalParts): Promise<string> {
  return new Promise((resolve) => {
    parts.dialog.addEventListener(
      'close',
      () => {
        resolve(parts.dialog.returnValue)
        parts.dialog.remove()
      },
      { once: true },
    )
    parts.dialog.returnValue = ''
    parts.dialog.showModal()
  })
}

export function confirmDialog(
  title: string,
  message: string,
  confirmLabel: string,
  danger = false,
  /** Focus Cancel, for prompts that can pop up while the user is typing elsewhere. */
  focusCancel = false,
): Promise<boolean> {
  const parts = modal('confirm', title, 'sm')
  parts.body.append(h('p', { class: 'dialog-message', text: message }))
  const ok = button(confirmLabel, () => parts.dialog.close('ok'), danger ? 'danger' : 'primary')
  const cancel = button(common('cancel'), () => parts.dialog.close())
  parts.actions.append(cancel, ok)
  const result = once(parts)
  const first = focusCancel ? cancel : ok
  first.focus()
  return result.then((value) => value === 'ok')
}

/** Asks for one line of text; `validate` returns an error message or ''. */
export function promptDialog(
  title: string,
  label: string,
  initial: string,
  confirmLabel: string,
  validate: (value: string) => string = () => '',
): Promise<string | null> {
  const parts = modal('prompt', title, 'sm')
  const input = h('input', {
    type: 'text',
    value: initial,
    spellcheck: 'false',
    autocomplete: 'off',
  })
  const form = h('form', { class: 'dialog-form', novalidate: true }, field(label, input))
  parts.body.append(form)
  let answer: string | null = null
  const submit = () => {
    const message = validate(input.value)
    setFieldError(input, message)
    if (message) return
    answer = input.value
    parts.dialog.close('ok')
  }
  form.addEventListener('submit', (event) => {
    event.preventDefault()
    submit()
  })
  parts.actions.append(
    button(common('cancel'), () => parts.dialog.close()),
    button(confirmLabel, submit, 'primary'),
  )
  const result = once(parts)
  input.focus()
  const dot = initial.lastIndexOf('.')
  input.setSelectionRange(0, dot > 0 ? dot : initial.length)
  return result.then(() => answer)
}
