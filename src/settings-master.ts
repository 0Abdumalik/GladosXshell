import { confirmDialog } from './dialogs'
import { field, h, setFieldError, setStatus } from './dom'
import { messages } from './i18n'
import {
  loadMasterStatus,
  lockMaster,
  type MasterStatus,
  masterStatus,
  onMasterChange,
  setMaster,
  unlockMaster,
} from './master'
import { describeError, errorField } from './protocol'
import type { Section } from './settings-layout'

const t = messages({
  stateOff: {
    zh: '未设置。保存的密码用 Windows 账户加密。',
    en: 'Not set. Saved passwords are encrypted with your Windows account.',
    ug: 'تەڭشەلمىگەن. ساقلانغان ئىملار Windows ھېساباتى بىلەن شىفىرلىنىدۇ.',
  },
  stateOpen: {
    zh: '已设置，本次运行已解锁。',
    en: 'Set, and unlocked for this run.',
    ug: 'تەڭشەلگەن، بۇ قېتىملىق ئىجرادا قۇلۇپ ئېچىلغان.',
  },
  stateLocked: {
    zh: '已设置，尚未解锁。用到保存的密码时会请你输入。',
    en: 'Set, not unlocked yet. You will be asked for it when a saved password is needed.',
    ug: 'تەڭشەلگەن، تېخى قۇلۇپ ئېچىلمىغان. ساقلانغان ئىم ئىشلىتىلگەندە ئۇنى كىرگۈزۈش تەلەپ قىلىنىدۇ.',
  },
  current: { zh: '当前主密码', en: 'Current master password', ug: 'نۆۋەتتىكى ئاساسىي ئىم' },
  next: { zh: '新主密码', en: 'New master password', ug: 'يېڭى ئاساسىي ئىم' },
  nextHelp: {
    zh: '至少 {n} 个字符。忘记后保存的密码无法找回，只能重新填写。',
    en: 'At least {n} characters. If you forget it, saved passwords cannot be recovered and must be entered again.',
    ug: 'كەم دېگەندە {n} ھەرپ. ئۇنتۇپ قالسىڭىز ساقلانغان ئىملارنى قايتۇرۇۋالغىلى بولمايدۇ، پەقەت قايتا تولدۇرۇشقا توغرا كېلىدۇ.',
  },
  again: { zh: '再输入一次', en: 'Repeat password', ug: 'قايتا كىرگۈزۈڭ' },
  minChars: { zh: '至少 {n} 个字符', en: 'At least {n} characters', ug: 'كەم دېگەندە {n} ھەرپ' },
  mismatch: {
    zh: '两次输入的密码不一样',
    en: 'The passwords do not match',
    ug: 'ئىككى قېتىم كىرگۈزگەن ئىم ئوخشاش ئەمەس',
  },
  needCurrent: {
    zh: '请输入当前的主密码',
    en: 'Enter the current master password',
    ug: 'نۆۋەتتىكى ئاساسىي ئىمنى كىرگۈزۈڭ',
  },
  changing: {
    zh: '正在更换主密码',
    en: 'Changing master password',
    ug: 'ئاساسىي ئىم ئالماشتۇرۇلۇۋاتىدۇ',
  },
  setting: { zh: '正在设置主密码', en: 'Setting master password', ug: 'ئاساسىي ئىم تەڭشىلىۋاتىدۇ' },
  changed: { zh: '主密码已更换', en: 'Master password changed', ug: 'ئاساسىي ئىم ئالماشتۇرۇلدى' },
  set: {
    zh: '主密码已设置，保存的密码已改用主密码加密',
    en: 'Master password set; saved passwords are now encrypted with it',
    ug: 'ئاساسىي ئىم تەڭشەلدى، ساقلانغان ئىملار ئەمدى ئاساسىي ئىم بىلەن شىفىرلاندى',
  },
  remove: { zh: '取消主密码', en: 'Remove master password', ug: 'ئاساسىي ئىمنى بىكار قىل' },
  removeTitle: {
    zh: '取消主密码',
    en: 'Remove master password',
    ug: 'ئاساسىي ئىمنى بىكار قىلىش',
  },
  removeText: {
    zh: '保存的密码会改回用 Windows 账户加密，以后用到时不再询问主密码。',
    en: 'Saved passwords go back to being encrypted with your Windows account, and the master password is no longer asked for.',
    ug: 'ساقلانغان ئىملار قايتىدىن Windows ھېساباتى بىلەن شىفىرلىنىدۇ، كېيىن ئىشلەتكەندە ئاساسىي ئىم سورالمايدۇ.',
  },
  removed: { zh: '主密码已取消', en: 'Master password removed', ug: 'ئاساسىي ئىم بىكار قىلىندى' },
  lockedNow: {
    zh: '已锁定，下次用到保存的密码时需要输入主密码',
    en: 'Locked; the master password is needed the next time a saved password is used',
    ug: 'قۇلۇپلاندى، كېيىنكى قېتىم ساقلانغان ئىم ئىشلىتىلگەندە ئاساسىي ئىمنى كىرگۈزۈش كېرەك',
  },
  unlocked: { zh: '已解锁', en: 'Unlocked', ug: 'قۇلۇپ ئېچىلدى' },
  lock: { zh: '立即锁定', en: 'Lock now', ug: 'ھازىرلا قۇلۇپلا' },
  unlock: { zh: '解锁', en: 'Unlock', ug: 'قۇلۇپ ئاچ' },
  change: { zh: '更换主密码', en: 'Change master password', ug: 'ئاساسىي ئىمنى ئالماشتۇر' },
  create: { zh: '设置主密码', en: 'Set master password', ug: 'ئاساسىي ئىم تەڭشە' },
  heading: { zh: '主密码', en: 'Master password', ug: 'ئاساسىي ئىم' },
  help: {
    zh: '设置后，保存的服务器密码、私钥口令和代理密码改用主密码加密（Argon2id + AES-256-GCM），每次启动后第一次用到时输入。不设置时用 Windows 账户加密，登录这台电脑的这个账户就能解开。',
    en: 'Once set, saved server passwords, key passphrases and proxy passwords are encrypted with the master password (Argon2id + AES-256-GCM), which you enter the first time one is needed after each start. Without it they are encrypted with your Windows account, and anyone signed in to this account on this computer can decrypt them.',
    ug: 'تەڭشەلگەندىن كېيىن، ساقلانغان مۇلازىمېتىر ئىمى، ئىم ئىبارىسى ۋە ۋاكالەتچى ئىمى ئاساسىي ئىم بىلەن شىفىرلىنىدۇ (Argon2id + AES-256-GCM)، ھەر قېتىم قوزغالغاندىن كېيىن تۇنجى ئىشلىتىلگەندە كىرگۈزۈلىدۇ. تەڭشەلمىسە Windows ھېساباتى بىلەن شىفىرلىنىدۇ، بۇ كومپيۇتېرغا مۇشۇ ھېسابات بىلەن كىرگەن كىشى ئۇنى يېشەلەيدۇ.',
  },
})

const MIN_PASSWORD = 8

type Report = (error: unknown) => void

function passwordInput(id: string, autocomplete: string): HTMLInputElement {
  return h('input', { id, type: 'password', autocomplete, spellcheck: false })
}

function stateText(status: MasterStatus): string {
  if (!status.enabled) return t('stateOff')
  return t(status.unlocked ? 'stateOpen' : 'stateLocked')
}

export function masterSection(report: Report): Section {
  const state = h('p', { class: 'master-state', role: 'status' })
  const current = passwordInput('master-current', 'current-password')
  const next = passwordInput('master-next', 'new-password')
  const again = passwordInput('master-again', 'new-password')
  const currentField = field(t('current'), current)
  const nextFields = h(
    'div',
    { class: 'master-fields' },
    field(t('next'), next, t('nextHelp', { n: MIN_PASSWORD })),
    field(t('again'), again),
  )
  const inputs = [current, next, again]
  const clear = () => {
    for (const input of inputs) {
      input.value = ''
      setFieldError(input, '')
    }
  }

  const busy = (on: boolean) => {
    for (const b of [setButton, removeButton, lockButton]) b.disabled = on
  }

  const run = async (work: () => Promise<unknown>, done: string) => {
    busy(true)
    try {
      await work()
      clear()
      setStatus(done)
    } catch (error) {
      const about = errorField(error)
      if (about === 'master' && current.value) {
        setFieldError(current, describeError(error))
        current.select()
      } else if (about === 'password') {
        setFieldError(next, describeError(error))
        next.select()
      } else {
        report(error)
      }
    } finally {
      busy(false)
    }
  }

  const checkNext = (): string | null => {
    setFieldError(next, '')
    setFieldError(again, '')
    if ([...next.value].length < MIN_PASSWORD) {
      setFieldError(next, t('minChars', { n: MIN_PASSWORD }))
      next.focus()
      return null
    }
    if (next.value !== again.value) {
      setFieldError(again, t('mismatch'))
      again.focus()
      return null
    }
    return next.value
  }

  const checkCurrent = (): string | null => {
    setFieldError(current, '')
    if (!current.value) {
      setFieldError(current, t('needCurrent'))
      current.focus()
      return null
    }
    return current.value
  }

  const setButton = h('button', {
    type: 'button',
    class: 'button primary',
    onclick: () => {
      const enabled = masterStatus().enabled
      const old = enabled ? checkCurrent() : null
      if (enabled && old === null) return
      const value = checkNext()
      if (value === null) return
      setStatus(t(enabled ? 'changing' : 'setting'))
      void run(() => setMaster(old, value), t(enabled ? 'changed' : 'set'))
    },
  })

  const removeButton = h('button', {
    type: 'button',
    class: 'button danger',
    text: t('remove'),
    onclick: async () => {
      const old = checkCurrent()
      if (old === null) return
      const sure = await confirmDialog(t('removeTitle'), t('removeText'), t('remove'), true)
      if (!sure) return
      void run(() => setMaster(old, null), t('removed'))
    },
  })

  const lockButton = h('button', {
    type: 'button',
    class: 'button',
    onclick: () => {
      if (masterStatus().unlocked) {
        void run(lockMaster, t('lockedNow'))
      } else {
        void unlockMaster().then((ok) => {
          if (ok) setStatus(t('unlocked'))
        })
      }
    },
  })

  const render = (status: MasterStatus) => {
    state.textContent = stateText(status)
    state.dataset.state = !status.enabled ? 'off' : status.unlocked ? 'open' : 'locked'
    currentField.hidden = !status.enabled
    removeButton.hidden = !status.enabled
    lockButton.hidden = !status.enabled
    lockButton.textContent = t(status.unlocked ? 'lock' : 'unlock')
    setButton.textContent = t(status.enabled ? 'change' : 'create')
  }
  const off = onMasterChange(render)
  render(masterStatus())
  loadMasterStatus().catch(report)

  const element = h(
    'div',
    { class: 'settings-section' },
    h('h3', { text: t('heading') }),
    h('p', { class: 'help', text: t('help') }),
    state,
    currentField,
    nextFields,
    h('div', { class: 'settings-actions' }, setButton, lockButton, removeButton),
  )
  return {
    id: 'master',
    label: t('heading'),
    element,
    refresh: () => {},
    dispose: () => {
      clear()
      off()
    },
  }
}
