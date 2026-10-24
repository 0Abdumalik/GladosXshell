import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import { confirmDialog } from './dialogs'
import { h, setStatus } from './dom'
import { code, messages, pl } from './i18n'
import { allSessions } from './sessions'
import type { Section } from './settings-layout'
import { settings, updateSettings } from './settings-store'

type Report = (error: unknown) => void

/** One entry of the language picker, from `languages_list`. */
export interface LanguageInfo {
  code: string
  name: string
  nativeName: string
  rtl: boolean
  builtin: boolean
  /** Pack version ("1.2.0"); empty when the pack carries none. */
  version: string
}

const t = messages({
  heading: { zh: '语言', en: 'Language', ug: 'تىل' },
  followSystem: { zh: '跟随系统', en: 'Follow system', ug: 'سىستېمىغا ئەگەش' },
  followSystemHelp: {
    zh: '首次启动时按系统语言自动选择，并固定下来。没有匹配的语言时使用英语。',
    en: 'Picks a language from the system on first launch and keeps it. English is used when nothing matches.',
    ug: 'تۇنجى قېتىم قوزغالغاندا سىستېمىنىڭ تىلىغا قاراپ تاللايدۇ ۋە ساقلايدۇ. ماس كېلىدىغان تىل بولمىسا ئىنگلىز تىلى ئىشلىتىلىدۇ.',
  },
  languageHead: { zh: '语言', en: 'Language', ug: 'تىل' },
  codeHead: { zh: '代码', en: 'Code', ug: 'كود' },
  versionHead: { zh: '版本', en: 'Version', ug: 'نەشرى' },
  stateHead: { zh: '状态', en: 'State', ug: 'ھالەت' },
  noVersion: { zh: '—', en: '—', ug: '—' },
  current: { zh: '使用中', en: 'In use', ug: 'ئىشلىتىلىۋاتىدۇ' },
  builtin: { zh: '内置', en: 'Built-in', ug: 'ئۆزىگە مەنسۇپ' },
  imported: { zh: '已导入', en: 'Imported', ug: 'ئەكىرىلگەن' },
  importButton: { zh: '导入语言包…', en: 'Import language pack…', ug: 'تىل بوغچىسىنى ئەكىر…' },
  importDialog: {
    zh: '选择语言包文件（JSON）',
    en: 'Choose a language pack file (JSON)',
    ug: 'تىل بوغچىسى ھۆججىتىنى تاللاڭ (JSON)',
  },
  importFilter: { zh: '语言包', en: 'Language packs', ug: 'تىل بوغچىسى' },
  importedOk: {
    zh: '已导入语言包：{name}',
    en: 'Imported the language pack {name}',
    ug: 'تىل بوغچىسى ئەكىرىلدى: {name}',
  },
  importFailed: {
    zh: '导入语言包失败：{error}',
    en: 'Could not import the language pack: {error}',
    ug: 'تىل بوغچىسىنى ئەكىرەلمىدى: {error}',
  },
  remove: { zh: '删除', en: 'Remove', ug: 'ئۆچۈر' },
  removeTitle: { zh: '删除语言包', en: 'Remove language pack', ug: 'تىل بوغچىسىنى ئۆچۈرۈش' },
  removeText: {
    zh: '删除「{name}」语言包？当前界面文字在重启前不受影响。',
    en: 'Remove the “{name}” language pack? The interface text is unaffected until the next restart.',
    ug: '«{name}» تىل بوغچىسىنى ئۆچۈرەمسىز؟ قايتا قوزغالغانغا قەدەر كۆرۈنمە يۈز تېكىستى تەسىرلەنمەيدۇ.',
  },
  removedOk: { zh: '已删除语言包', en: 'Language pack removed', ug: 'تىل بوغچىسى ئۆچۈرۈلدى' },
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
  englishFallback: {
    zh: '语言包缺的条目自动显示英文。',
    en: 'Entries a pack does not cover fall back to English.',
    ug: 'بوغچىدا يوق تۈرلەر ئاپتوماتىك ئىنگلىزچە كۆرسىتىلىدۇ.',
  },
})

/** What the user had chosen when this run started, which is the language on screen. */
let atStart: string | undefined
let languages: LanguageInfo[] = []

async function listLanguages(): Promise<LanguageInfo[]> {
  return invoke<LanguageInfo[]>('languages_list')
}

/** The user-facing text of a Tauri invoke error, not its object form. */
function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : typeof error === 'object' && error !== null && 'message' in error
      ? String((error as { message: unknown }).message)
      : String(error)
}

/** The language manager as its own settings tab, between Appearance and Plugins. */
export function languageSection(report: Report): Section {
  const manager = languageManager(report)
  return {
    id: 'language',
    label: t('heading'),
    element: h('div', { class: 'settings-section' }, manager.element),
    refresh: manager.refresh,
  }
}

/**
 * The language manager: every installed language as a table row (native name, code, version,
 * state), with import, remove and a restart prompt, Cheat Engine style. Packs live in the
 * `<data>/Language` folder and users may drop files in or delete them.
 */
export function languageManager(report: Report): { element: HTMLElement; refresh: () => void } {
  const root = h('div', { class: 'language-manager' })
  const tbody = h('tbody')
  const table = h(
    'table',
    { class: 'language-table' },
    h(
      'thead',
      {},
      h(
        'tr',
        {},
        h('th', { scope: 'col', text: t('languageHead') }),
        h('th', { scope: 'col', text: t('codeHead') }),
        h('th', { scope: 'col', text: t('versionHead') }),
        h('th', { scope: 'col', text: t('stateHead') }),
        h('th', { scope: 'col' }),
      ),
    ),
    tbody,
  )
  const note = h('p', { class: 'help language-pending', 'aria-live': 'polite', hidden: true })
  const importButton = h('button', {
    type: 'button',
    class: 'button small',
    text: t('importButton'),
    onclick: importPack,
  })

  async function importPack(): Promise<void> {
    const chosen = await open({
      multiple: false,
      directory: false,
      title: t('importDialog'),
      filters: [{ name: t('importFilter'), extensions: ['json'] }],
    }).catch(report)
    if (typeof chosen !== 'string') return
    try {
      const info = await invoke<LanguageInfo>('language_pack_import', { path: chosen })
      await refresh()
      setStatus(t('importedOk', { name: info.nativeName }))
    } catch (error) {
      setStatus(t('importFailed', { error: errorMessage(error) }), 'error')
    }
  }

  async function removePack(info: LanguageInfo): Promise<void> {
    const ok = await confirmDialog(
      t('removeTitle'),
      t('removeText', { name: info.nativeName }),
      t('remove'),
    )
    if (!ok) return
    try {
      await invoke('language_pack_remove', { code: info.code })
      await refresh()
      setStatus(t('removedOk'))
    } catch (error) {
      setStatus(t('importFailed', { error: errorMessage(error) }), 'error')
    }
  }

  function row(info: LanguageInfo, chosen: string): void {
    const radio = h('input', {
      type: 'radio',
      name: 'gx-language',
      value: info.code,
      checked: chosen === info.code,
      onchange: () => {
        updateSettings((d) => {
          d.ui.language = info.code
        }).catch(report)
      },
    })
    const badge = h('span', {
      class: chosen === info.code ? 'language-badge current' : 'language-badge',
      text: chosen === info.code ? t('current') : info.builtin ? t('builtin') : t('imported'),
    })
    const nameCell = h(
      'td',
      {},
      h(
        'label',
        { class: 'language-cell' },
        radio,
        h('span', {
          class: 'language-name',
          lang: info.code,
          dir: info.rtl ? 'rtl' : 'ltr',
          text: info.nativeName,
        }),
      ),
    )
    const codeCell = h('td', { class: 'language-code' }, h('span', { dir: 'ltr', text: info.name }))
    const versionCell = h('td', {
      class: 'language-version',
      text: info.version ? `v${info.version}` : t('noVersion'),
    })
    const stateCell = h('td', {}, badge)
    // The pack in use cannot be removed under itself; the backend refuses it too.
    if (!info.builtin && chosen !== info.code) {
      const remove = h('button', {
        type: 'button',
        class: 'button small quiet',
        text: t('remove'),
        'aria-label': `${t('remove')} ${info.nativeName}`,
        onclick: () => removePack(info),
      })
      tbody.append(h('tr', {}, nameCell, codeCell, versionCell, stateCell, h('td', {}, remove)))
    } else {
      tbody.append(h('tr', {}, nameCell, codeCell, versionCell, stateCell, h('td')))
    }
  }

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
  note.append(restart)

  const follow = h(
    'label',
    { class: 'language-row follow-system' },
    h('input', {
      type: 'radio',
      name: 'gx-language',
      value: 'auto',
      onchange: () => {
        updateSettings((d) => {
          d.ui.language = 'auto'
        }).catch(report)
      },
    }),
    h('span', { class: 'language-name', text: t('followSystem') }),
    h('span', { class: 'language-code', text: t('followSystemHelp') }),
  )

  const refresh = async () => {
    languages = await listLanguages().catch((error) => {
      report(error)
      return []
    })
    const choice = settings().ui.language
    const live = code()
    atStart ??= settings().ui.language
    const auto = follow.querySelector('input')
    if (auto) auto.checked = choice === 'auto'
    const active = choice === 'auto' ? live : choice
    tbody.replaceChildren()
    for (const info of languages) row(info, active)
    note.hidden = choice === atStart
  }

  root.append(
    h('h3', { text: t('heading') }),
    follow,
    table,
    h(
      'div',
      { class: 'language-actions' },
      importButton,
      h('p', { class: 'help', text: t('englishFallback') }),
    ),
    note,
  )
  void refresh()
  return { element: root, refresh }
}
