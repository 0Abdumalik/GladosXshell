import { Channel, invoke } from '@tauri-apps/api/core'
import { logApp } from './applog'
import { button, modal } from './dialogs'
import { field, h, reportError, setStatus } from './dom'
import { ltr, messages } from './i18n'
import { common } from './i18n-common'
import type { HostKeyPromptEvent, InputPromptEvent } from './protocol'

const t = messages({
  hostKeyExpired: {
    zh: '等待确认{where} 的主机密钥超时，连接已取消',
    en: 'Timed out waiting to confirm the host key of {where}; connection cancelled',
    ug: '{where} نىڭ ئاساسىي ماشىنا ئاچقۇچىنى جەزملەشنى ساقلاش ۋاقتى ئېشىپ كەتتى، ئۇلىنىش ئەمەلدىن قالدى',
  },
  inputExpired: {
    zh: '等待确认「{name}」超时，连接已取消',
    en: 'Timed out waiting for "{name}"; connection cancelled',
    ug: '«{name}» نى ساقلاش ۋاقتى ئېشىپ كەتتى، ئۇلىنىش ئەمەلدىن قالدى',
  },
  loginExpired: {
    zh: '等待确认登录输入超时，连接已取消',
    en: 'Timed out waiting for login input; connection cancelled',
    ug: 'كىرىش ئۇچۇرىنى ساقلاش ۋاقتى ئېشىپ كەتتى، ئۇلىنىش ئەمەلدىن قالدى',
  },
  expiredStatus: {
    zh: '等待确认超时，连接已取消，请重新连接',
    en: 'Timed out waiting for confirmation and the connection was cancelled; reconnect to try again',
    ug: 'جەزملەشنى ساقلاش ۋاقتى ئېشىپ كەتتى، ئۇلىنىش ئەمەلدىن قالدى، قايتا ئۇلاڭ',
  },
  hostKeyTitle: {
    zh: '确认主机密钥',
    en: 'Confirm host key',
    ug: 'ئاساسىي ماشىنا ئاچقۇچىنى جەزملەش',
  },
  hostKeyIntro: {
    zh: '首次连接这台服务器。请向管理员核对指纹，一致后再信任。',
    en: 'This is the first connection to this server. Check the fingerprint with its administrator and trust it only if it matches.',
    ug: 'بۇ مۇلازىمېتىرغا تۇنجى قېتىم ئۇلىنىۋاتىسىز. بارماق ئىزىنى باشقۇرغۇچى بىلەن سېلىشتۇرۇپ، ماس كەلسىلا ئىشىنىڭ.',
  },
  algorithm: { zh: '算法', en: 'Algorithm', ug: 'ئالگورىتىم' },
  fingerprint: { zh: '指纹', en: 'Fingerprint', ug: 'بارماق ئىزى' },
  reject: { zh: '拒绝', en: 'Reject', ug: 'رەت قىل' },
  trust: { zh: '信任并连接', en: 'Trust and connect', ug: 'ئىشىنىپ ئۇلا' },
  trusted: {
    zh: '已信任 {where} 的主机密钥：{algorithm} {fingerprint}',
    en: 'Trusted the host key of {where}: {algorithm} {fingerprint}',
    ug: '{where} نىڭ ئاساسىي ماشىنا ئاچقۇچىغا ئىشەنچ قىلىندى: {algorithm} {fingerprint}',
  },
  rejected: {
    zh: '拒绝了 {where} 的主机密钥：{algorithm} {fingerprint}',
    en: 'Rejected the host key of {where}: {algorithm} {fingerprint}',
    ug: '{where} نىڭ ئاساسىي ماشىنا ئاچقۇچى رەت قىلىندى: {algorithm} {fingerprint}',
  },
  inputTitle: { zh: '需要输入', en: 'Input required', ug: 'كىرگۈزۈش كېرەك' },
  inputLabel: { zh: '输入', en: 'Response', ug: 'جاۋاب' },
})

// Several connections may ask at once (batch connect); dialogs are shown one at a time.
let queue: Promise<void> = Promise.resolve()

function enqueue(task: () => Promise<void>): void {
  queue = queue.then(task).catch((error) => reportError(error))
}

const EXPIRED = 'expired'
// Closes a little before the backend stops waiting, so a last-moment click still counts.
const DEADLINE_MARGIN = 1000

/** Resolves with the dialog's returnValue, or null once the backend no longer waits for it. */
function showOnce(
  dialog: HTMLDialogElement,
  focus: HTMLElement,
  deadline: number,
): Promise<string | null> {
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => dialog.close(EXPIRED), deadline - Date.now())
    dialog.addEventListener(
      'close',
      () => {
        window.clearTimeout(timer)
        resolve(dialog.returnValue === EXPIRED ? null : dialog.returnValue)
        dialog.remove()
      },
      { once: true },
    )
    dialog.returnValue = ''
    dialog.showModal()
    focus.focus()
  })
}

const deadlineOf = (timeoutSecs: number) => Date.now() + timeoutSecs * 1000 - DEADLINE_MARGIN

/** `message` says what was being waited for, for the app log. */
const expired = (message: string) => {
  logApp('warn', message)
  setStatus(t('expiredStatus'), 'error')
}

async function askHostKey(event: HostKeyPromptEvent, deadline: number): Promise<void> {
  const { key } = event
  const where = ltr(`${key.host}:${key.port}`)
  if (Date.now() >= deadline) return expired(t('hostKeyExpired', { where }))
  const parts = modal('host-key', t('hostKeyTitle'), 'md')
  parts.body.append(
    h('p', { class: 'dialog-message', text: t('hostKeyIntro') }),
    h(
      'dl',
      { class: 'fingerprint' },
      h('dt', { text: common('host') }),
      h('dd', { class: 'mono', text: `${key.host}:${key.port}` }),
      h('dt', { text: t('algorithm') }),
      h('dd', { class: 'mono', text: key.algorithm }),
      h('dt', { text: t('fingerprint') }),
      h('dd', { class: 'mono', text: key.fingerprint }),
    ),
  )
  const reject = button(t('reject'), () => parts.dialog.close())
  parts.actions.append(
    reject,
    button(t('trust'), () => parts.dialog.close('accept'), 'primary'),
  )
  // Escape closes with an empty returnValue, which counts as a rejection.
  const answer = await showOnce(parts.dialog, reject, deadline)
  if (answer === null) return expired(t('hostKeyExpired', { where }))
  const accept = answer === 'accept'
  const detail = { where, algorithm: key.algorithm, fingerprint: ltr(key.fingerprint) }
  logApp(accept ? 'info' : 'warn', t(accept ? 'trusted' : 'rejected', detail))
  await invoke('host_key_answer', { promptId: event.promptId, accept })
}

async function askInput(event: InputPromptEvent, deadline: number): Promise<void> {
  const { request } = event
  const what = request.name ? t('inputExpired', { name: request.name }) : t('loginExpired')
  if (Date.now() >= deadline) return expired(what)
  const parts = modal('input-prompt', request.name || t('inputTitle'), 'sm')
  const form = h('form', { class: 'dialog-form', novalidate: true })
  if (request.instructions) {
    form.append(h('p', { class: 'dialog-message', text: request.instructions }))
  }
  const inputs = request.prompts.map((p) =>
    h('input', {
      type: p.echo ? 'text' : 'password',
      autocomplete: 'off',
      spellcheck: 'false',
    }),
  )
  request.prompts.forEach((p, i) => {
    // i18n-ignore: strips a trailing ASCII or full-width colon from the server's own prompt
    form.append(field(p.prompt.replace(/[:：]\s*$/, '') || t('inputLabel'), inputs[i]))
  })
  parts.body.append(form)
  form.addEventListener('submit', (e) => {
    e.preventDefault()
    parts.dialog.close('ok')
  })
  const ok = button(common('ok'), () => parts.dialog.close('ok'), 'primary')
  parts.actions.append(
    button(common('cancel'), () => parts.dialog.close()),
    ok,
  )
  const answer = await showOnce(parts.dialog, inputs[0] ?? ok, deadline)
  const answers = answer === 'ok' ? inputs.map((i) => i.value) : null
  for (const input of inputs) input.value = ''
  if (answer === null) return expired(what)
  await invoke('prompt_answer', { promptId: event.promptId, answers })
}

// The backend's wait starts when it sends, so a dialog queued behind another has less time.
export function hostKeyChannel(): Channel<HostKeyPromptEvent> {
  const channel = new Channel<HostKeyPromptEvent>()
  channel.onmessage = (event) => {
    const deadline = deadlineOf(event.timeoutSecs)
    enqueue(() => askHostKey(event, deadline))
  }
  return channel
}

export function inputPromptChannel(): Channel<InputPromptEvent> {
  const channel = new Channel<InputPromptEvent>()
  channel.onmessage = (event) => {
    const deadline = deadlineOf(event.timeoutSecs)
    enqueue(() => askInput(event, deadline))
  }
  return channel
}
