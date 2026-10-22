import { invoke } from '@tauri-apps/api/core'
import { button, modal } from './dialogs'
import { field, h, setFieldError } from './dom'
import { messages } from './i18n'
import { common } from './i18n-common'
import { describeError, errorKind } from './protocol'

const t = messages({
  title: { zh: '输入主密码', en: 'Enter master password', ug: 'ئاساسىي ئىمنى كىرگۈزۈڭ' },
  intro: {
    zh: '保存的服务器密码已用主密码加密。输入一次后，在关闭软件或手动锁定之前都不再询问。',
    en: "Saved server passwords are encrypted with the master password. Enter it once and you won't be asked again until you close the app or lock it.",
    ug: 'ساقلانغان مۇلازىمېتىر ئىملىرى ئاساسىي ئىم بىلەن شىفىرلانغان. بىر قېتىم كىرگۈزسىڭىز، پروگراممىنى تاقىغۇچە ياكى قولدا قۇلۇپلىغۇچە قايتا سورالمايدۇ.',
  },
  label: { zh: '主密码', en: 'Master password', ug: 'ئاساسىي ئىم' },
  unlock: { zh: '解锁', en: 'Unlock', ug: 'قۇلۇپ ئاچ' },
  required: { zh: '请输入主密码', en: 'Enter the master password', ug: 'ئاساسىي ئىمنى كىرگۈزۈڭ' },
  unlocking: { zh: '正在解锁', en: 'Unlocking', ug: 'قۇلۇپ ئېچىلىۋاتىدۇ' },
})

export interface MasterStatus {
  enabled: boolean
  unlocked: boolean
}

let current: MasterStatus = { enabled: false, unlocked: false }
const listeners = new Set<(status: MasterStatus) => void>()
let pending: Promise<boolean> | null = null

export function masterStatus(): MasterStatus {
  return current
}

export function onMasterChange(listener: (status: MasterStatus) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function publish(status: MasterStatus): MasterStatus {
  current = status
  for (const listener of listeners) listener(status)
  return status
}

export async function loadMasterStatus(): Promise<MasterStatus> {
  return publish(await invoke<MasterStatus>('master_status'))
}

export async function lockMaster(): Promise<MasterStatus> {
  return publish(await invoke<MasterStatus>('master_lock'))
}

/** Sets, changes or (`next` null) removes the master password. */
export async function setMaster(
  currentPassword: string | null,
  next: string | null,
): Promise<MasterStatus> {
  return publish(await invoke<MasterStatus>('master_set', { current: currentPassword, next }))
}

function askUnlock(): Promise<boolean> {
  const parts = modal('master-unlock', t('title'), 'sm')
  const input = h('input', {
    id: 'master-unlock-password',
    type: 'password',
    autocomplete: 'current-password',
    spellcheck: false,
  })
  const form = h(
    'form',
    { class: 'dialog-form', novalidate: true },
    h('p', { class: 'dialog-message', text: t('intro') }),
    field(t('label'), input),
  )
  const ok = button(t('unlock'), () => form.requestSubmit(), 'primary')
  form.addEventListener('submit', (event) => {
    event.preventDefault()
    if (!input.value) {
      setFieldError(input, t('required'))
      return
    }
    setFieldError(input, '')
    ok.disabled = true
    ok.textContent = t('unlocking')
    invoke<MasterStatus>('master_unlock', { password: input.value })
      .then((status) => {
        publish(status)
        parts.dialog.close('ok')
      })
      .catch((error) => {
        ok.disabled = false
        ok.textContent = t('unlock')
        setFieldError(input, describeError(error))
        input.select()
      })
  })
  parts.body.append(form)
  parts.actions.append(
    button(common('cancel'), () => parts.dialog.close()),
    ok,
  )
  return new Promise((resolve) => {
    parts.dialog.addEventListener(
      'close',
      () => {
        input.value = ''
        resolve(parts.dialog.returnValue === 'ok')
        parts.dialog.remove()
      },
      { once: true },
    )
    parts.dialog.returnValue = ''
    parts.dialog.showModal()
    input.focus()
  })
}

/** Asks for the master password; false when the user gives up. Concurrent callers share one dialog. */
export function unlockMaster(): Promise<boolean> {
  pending ??= askUnlock().finally(() => {
    pending = null
  })
  return pending
}

/** Runs `work`; when saved secrets are locked, asks for the master password once and retries. */
export async function withUnlock<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work()
  } catch (error) {
    if (errorKind(error) !== 'locked') throw error
    publish({ enabled: true, unlocked: false })
    if (!(await unlockMaster())) throw error
    return work()
  }
}
