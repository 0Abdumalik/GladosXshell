import { h } from './dom'
import { FORWARD_KINDS, parseForward } from './forward-spec'
import { ltr, messages } from './i18n'
import { common } from './i18n-common'
import type { ForwardSpec } from './protocol'

const t = messages({
  localBind: {
    zh: '本机监听，如 {example}',
    en: 'Listen on this computer, e.g. {example}',
    ug: 'بۇ كومپيۇتېردا تىڭشا، مەسىلەن {example}',
  },
  localDest: {
    zh: '服务器能访问的目标，如 {example}',
    en: 'Destination the server can reach, e.g. {example}',
    ug: 'مۇلازىمېتىر زىيارەت قىلالايدىغان نىشان، مەسىلەن {example}',
  },
  remoteBind: {
    zh: '服务器上监听，如 {example}',
    en: 'Listen on the server, e.g. {example}',
    ug: 'مۇلازىمېتىردا تىڭشا، مەسىلەن {example}',
  },
  remoteDest: {
    zh: '本机能访问的目标，如 {example}',
    en: 'Destination this computer can reach, e.g. {example}',
    ug: 'بۇ كومپيۇتېر زىيارەت قىلالايدىغان نىشان، مەسىلەن {example}',
  },
  dynamicBind: {
    zh: '本机 SOCKS 端口，如 {example}',
    en: 'Local SOCKS port, e.g. {example}',
    ug: 'يەرلىك SOCKS ئېغىزى، مەسىلەن {example}',
  },
  kind: { zh: '转发类型', en: 'Forward type', ug: 'يوللاش تىپى' },
  bind: { zh: '监听地址', en: 'Listen address', ug: 'تىڭشاش ئادرېسى' },
  dest: { zh: '目标地址', en: 'Destination address', ug: 'نىشان ئادرېسى' },
  labelHint: { zh: '名称（可选）', en: 'Name (optional)', ug: 'ئاتى (ئىختىيارىي)' },
  add: { zh: '添加', en: 'Add', ug: 'قوش' },
})

const example = (value: string) => ({ example: ltr(value) })

const PLACEHOLDERS: Record<string, [string, string]> = {
  local: [t('localBind', example('8080')), t('localDest', example('127.0.0.1:3306'))],
  remote: [t('remoteBind', example('9000')), t('remoteDest', example('127.0.0.1:80'))],
  dynamic: [t('dynamicBind', example('1080')), ''],
}

/**
 * A one-row form for a new forward. `add` returns an error to show, or null when it took the
 * spec, which clears the inputs.
 */
export function forwardAdder(
  add: (spec: ForwardSpec) => string | null | Promise<string | null>,
): HTMLElement {
  const kind = h(
    'select',
    { 'aria-label': t('kind') },
    FORWARD_KINDS.map(([value, label]) => h('option', { value, text: label })),
  )
  const attrs = { type: 'text', spellcheck: 'false', autocomplete: 'off' }
  const bind = h('input', { ...attrs, 'aria-label': t('bind') })
  const dest = h('input', { ...attrs, 'aria-label': t('dest') })
  const label = h('input', { ...attrs, 'aria-label': common('name'), placeholder: t('labelHint') })
  const error = h('p', { class: 'field-error', role: 'alert' })
  const sync = () => {
    const [bindHint, destHint] = PLACEHOLDERS[kind.value]
    bind.placeholder = bindHint
    dest.placeholder = destHint
    dest.hidden = kind.value === 'dynamic'
  }
  kind.addEventListener('change', sync)
  sync()
  const submit = h('button', { type: 'button', class: 'button small', text: t('add') })
  const run = async () => {
    const parsed = parseForward({
      kind: kind.value,
      bind: bind.value,
      dest: dest.value,
      label: label.value,
    })
    if (!parsed.ok) {
      error.textContent = parsed.error
      return
    }
    submit.disabled = true
    try {
      const problem = await add(parsed.value)
      error.textContent = problem ?? ''
      if (problem === null) {
        bind.value = ''
        dest.value = ''
        label.value = ''
        bind.focus()
      }
    } finally {
      submit.disabled = false
    }
  }
  submit.addEventListener('click', () => void run())
  for (const input of [bind, dest, label]) {
    input.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return
      // Keeps Enter from also submitting a surrounding form.
      event.preventDefault()
      event.stopPropagation()
      void run()
    })
  }
  return h(
    'div',
    { class: 'forward-adder' },
    h('div', { class: 'forward-adder-row' }, kind, bind, dest, label, submit),
    error,
  )
}
