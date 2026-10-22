import { invoke } from '@tauri-apps/api/core'
import { confirmDialog } from './dialogs'
import { h } from './dom'
import { LANG_NAMES, LANGS, messages, pl } from './i18n'
import { allSessions } from './sessions'
import type { Settings } from './settings-model'
import { settings, updateSettings } from './settings-store'

type Report = (error: unknown) => void
type Choice = Settings['ui']['language']

const t = messages({
  heading: { zh: '语言', en: 'Language', ug: 'تىل' },
  label: { zh: '界面语言', en: 'Interface language', ug: 'كۆرۈنمە يۈز تىلى' },
  auto: { zh: '跟随系统', en: 'Same as Windows', ug: 'Windows غا ئەگىشىدۇ' },
  pending: {
    zh: '重启 GladosXshell 后生效。',
    en: 'Takes effect after GladosXshell restarts.',
    ug: 'GladosXshell قايتا قوزغالغاندىن كېيىن كۈچكە ئىگە بولىدۇ.',
  },
  restart: { zh: '立即重启', en: 'Restart now', ug: 'ھازىرلا قايتا قوزغىتىش' },
  confirmTitle: {
    zh: '重启 GladosXshell',
    en: 'Restart GladosXshell',
    ug: 'GladosXshell نى قايتا قوزغىتىش',
  },
  confirmLive: {
    zh: '还有 {n} 个会话开着，重启会断开它们。',
    en: (p) =>
      `${pl('session')(p)} still open; restarting closes ${Number(p.n) === 1 ? 'it' : 'them'}.`,
    ug: 'يەنە {n} ئەڭگىمە ئوچۇق، قايتا قوزغاتسا ئۈزۈلىدۇ.',
  },
})

/** What the user had chosen when this run started, which is the language on screen. */
let atStart: Choice | undefined

export function languageField(report: Report): { element: HTMLElement; refresh: () => void } {
  atStart ??= settings().ui.language
  const select = h(
    'select',
    {
      'aria-label': t('label'),
      onchange: () => {
        const language = select.value as Choice
        updateSettings((d) => {
          d.ui.language = language
        }).catch(report)
      },
    },
    h('option', { value: 'auto', text: t('auto') }),
    ...LANGS.map((code) => h('option', { value: code, lang: code, text: LANG_NAMES[code] })),
  )
  const restart = h('button', {
    type: 'button',
    class: 'button small',
    text: t('restart'),
    onclick: async () => {
      const live = allSessions().filter((s) => s.state === 'live').length
      if (live > 0) {
        const ok = await confirmDialog(
          t('confirmTitle'),
          t('confirmLive', { n: live }),
          t('restart'),
        )
        if (!ok) return
      }
      await invoke('app_restart').catch(report)
    },
  })
  const pending = h(
    'p',
    { class: 'help language-pending', 'aria-live': 'polite' },
    t('pending'),
    ' ',
    restart,
  )
  const refresh = () => {
    const choice = settings().ui.language
    select.value = choice
    pending.hidden = choice === atStart
  }
  refresh()
  const element = h(
    'div',
    { class: 'language-field' },
    h('h3', { text: t('heading') }),
    select,
    pending,
  )
  return { element, refresh }
}
