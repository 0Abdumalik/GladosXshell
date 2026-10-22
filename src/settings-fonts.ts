import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import { type ComboOption, combobox } from './combobox'
import { field, h, setFieldError, setStatus } from './dom'
import { joinList, ltr, messages, pl } from './i18n'
import { namedIcon } from './icons'
import { MAX_FONTS, NOTO_FONTS, validFontName, validLocalPath } from './settings-model'
import { recentPaths, recentPathsCombo, rememberRecent } from './settings-paths'
import { settings, updateSettings } from './settings-store'
import {
  folderState,
  importFont,
  libraryFonts,
  onFontsChange,
  removeFont,
  type SystemFont,
  systemFonts,
  useFolder,
} from './terminal-fonts'

type Report = (error: unknown) => void

const t = messages({
  slot1: { zh: '首选字体', en: 'Primary font', ug: 'ئاساسىي خەت نۇسخىسى' },
  slot2: { zh: '第二字体', en: 'Second font', ug: 'ئىككىنچى خەت نۇسخىسى' },
  slot3: { zh: '第三字体', en: 'Third font', ug: 'ئۈچىنچى خەت نۇسخىسى' },
  clearSlot1: { zh: '清空首选字体', en: 'Clear primary font', ug: 'ئاساسىي خەت نۇسخىسىنى تازىلا' },
  clearSlot2: { zh: '清空第二字体', en: 'Clear second font', ug: 'ئىككىنچى خەت نۇسخىسىنى تازىلا' },
  clearSlot3: { zh: '清空第三字体', en: 'Clear third font', ug: 'ئۈچىنچى خەت نۇسخىسىنى تازىلا' },
  clearTitle: { zh: '清空这一项', en: 'Clear this entry', ug: 'بۇ تۈرنى تازىلا' },
  none: { zh: '不使用', en: 'None', ug: 'ئىشلىتىلمەيدۇ' },
  groupImported: { zh: '已导入', en: 'Imported', ug: 'ئەكىرىلگەن' },
  mono: { zh: '等宽', en: 'Monospace', ug: 'تەڭ كەڭلىك' },
  groupSystemMono: {
    zh: '系统等宽字体',
    en: 'System monospace fonts',
    ug: 'سىستېمىنىڭ تەڭ كەڭلىكتىكى خەت نۇسخىلىرى',
  },
  groupSystemOther: {
    zh: '系统其他字体',
    en: 'Other system fonts',
    ug: 'سىستېمىنىڭ باشقا خەت نۇسخىلىرى',
  },
  badName: {
    zh: '字体名不能包含引号、逗号或 { } ; < > \\，也不能超过 100 个字符',
    en: 'Font names can have up to 100 characters and no quotes, commas or { } ; < > \\',
    ug: 'خەت نۇسخىسىنىڭ ئاتى 100 ھەرپتىن ئاشمىسۇن، ئۇنىڭدا تىرناق بەلگىسى، پەش ياكى { } ; < > \\ بولمىسۇن',
  },
  readingSystem: {
    zh: '正在读取系统字体…',
    en: 'Reading system fonts…',
    ug: 'سىستېما خەت نۇسخىلىرى ئوقۇلۇۋاتىدۇ…',
  },
  chooseFont: { zh: '选择字体', en: 'Choose a font', ug: 'خەت نۇسخىسى تاللا' },
  notoMissing: {
    zh: '本机还没有 {fonts}。可以从 Google Fonts 下载后用“导入字体文件”加入，或放进兜底文件夹。',
    en: 'Not on this PC yet: {fonts}. Download them from Google Fonts, then add them with “Import font files…” or put them in the fallback folder.',
    ug: 'بۇ كومپيۇتېردا تېخى {fonts} يوق. Google Fonts تىن چۈشۈرۈپ «خەت نۇسخىسى ھۆججىتى ئەكىر» ئارقىلىق قوشۇڭ ياكى زاپاس قىسقۇچقا قويۇڭ.',
  },
  importTitle: {
    zh: '导入字体文件',
    en: 'Import font files',
    ug: 'خەت نۇسخىسى ھۆججىتى ئەكىرىش',
  },
  fontFilter: { zh: '字体', en: 'Fonts', ug: 'خەت نۇسخىلىرى' },
  importedStatus: {
    zh: '已导入字体：{fonts}',
    en: 'Imported fonts: {fonts}',
    ug: 'خەت نۇسخىسى ئەكىرىلدى: {fonts}',
  },
  notoTitle: {
    zh: '{fonts}，覆盖英文、中日韩文字和 emoji',
    en: '{fonts}: covers English, Chinese, Japanese, Korean and emoji',
    ug: '{fonts}: ئىنگلىزچە، خەنزۇچە، ياپونچە، كورېيەچە ۋە emoji نى ئۆز ئىچىگە ئالىدۇ',
  },
  useNoto: {
    zh: '使用推荐：Google Noto',
    en: 'Use Google Noto (recommended)',
    ug: 'Google Noto نى ئىشلەت (تەۋسىيە)',
  },
  importFiles: {
    zh: '导入字体文件…',
    en: 'Import font files…',
    ug: 'خەت نۇسخىسى ھۆججىتى ئەكىر…',
  },
  downloadNoto: {
    zh: '下载 Noto 字体',
    en: 'Download Noto fonts',
    ug: 'Noto خەت نۇسخىلىرىنى چۈشۈر',
  },
  imported: { zh: '已导入的字体', en: 'Imported fonts', ug: 'ئەكىرىلگەن خەت نۇسخىلىرى' },
  italic: { zh: '斜体', en: 'Italic', ug: 'يانتۇ' },
  removeTitle: {
    zh: '从库里删除这个字体文件',
    en: 'Delete this font file from the library',
    ug: 'بۇ خەت نۇسخىسى ھۆججىتىنى ئامباردىن ئۆچۈر',
  },
  removeLabel: { zh: '删除 {name}', en: 'Delete {name}', ug: '{name} نى ئۆچۈر' },
  badFolder: {
    zh: '请填写绝对路径，例如 {path}，或留空',
    en: 'Enter an absolute path, such as {path}, or leave it empty',
    ug: 'مۇتلەق يولنى كىرگۈزۈڭ، مەسىلەن {path}، ياكى بوش قالدۇرۇڭ',
  },
  browse: { zh: '浏览…', en: 'Browse…', ug: 'كۆز يۈگۈرت…' },
  folderDialog: {
    zh: '选择兜底字体文件夹',
    en: 'Choose the fallback font folder',
    ug: 'زاپاس خەت نۇسخىسى قىسقۇچىنى تاللاش',
  },
  rescanTitle: {
    zh: '重新读取文件夹里的字体',
    en: 'Reload the fonts in the folder',
    ug: 'قىسقۇچتىكى خەت نۇسخىلىرىنى قايتا ئوقۇ',
  },
  rescanLabel: {
    zh: '重新读取兜底文件夹',
    en: 'Reload the fallback folder',
    ug: 'زاپاس قىسقۇچنى قايتا ئوقۇ',
  },
  folderLabel: {
    zh: '兜底字体文件夹',
    en: 'Fallback font folder',
    ug: 'زاپاس خەت نۇسخىسى قىسقۇچى',
  },
  folderHelp: {
    zh: '三个字体都没有的字符，会依次到这个文件夹（含三层子文件夹）里的全部 {types} 字体中查找。',
    en: 'Characters missing from all three fonts are looked up, in turn, in every {types} font in this folder and up to three levels of subfolders.',
    ug: 'ئۈچ خەت نۇسخىسىنىڭ ھېچقايسىسىدا يوق ھەرپلەر بۇ قىسقۇچتىكى ۋە ئۇنىڭ ئۈچ قەۋەتكىچە بولغان تارماق قىسقۇچلىرىدىكى بارلىق {types} خەت نۇسخىلىرىدىن بىرمۇبىر ئىزدىلىدۇ.',
  },
  folderUnset: {
    zh: '未设置兜底文件夹。',
    en: 'No fallback folder set.',
    ug: 'زاپاس قىسقۇچ بەلگىلەنمىگەن.',
  },
  folderLoading: {
    zh: '正在载入文件夹里的字体…',
    en: 'Loading fonts from the folder…',
    ug: 'قىسقۇچتىكى خەت نۇسخىلىرى يۈكلىنىۋاتىدۇ…',
  },
  folderError: {
    zh: '无法读取：{error}',
    en: 'Could not read the folder: {error}',
    ug: 'قىسقۇچنى ئوقۇيالمىدى: {error}',
  },
  folderLoaded: {
    zh: (p) =>
      `已载入 {families} 个字体家族（{files} 个文件）${Number(p.failed) > 0 ? '，{failed} 个文件无法载入' : ''}${Number(p.skipped) > 0 ? '，{skipped} 个文件超过数量或大小上限，已跳过' : ''}。`,
    en: (p) => {
      const parts = [
        `Loaded ${pl('font family', 'font families')({ n: p.families })} (${pl('file')({ n: p.files })})`,
      ]
      if (Number(p.failed) > 0) parts.push(`${pl('file')({ n: p.failed })} could not be loaded`)
      if (Number(p.skipped) > 0) {
        parts.push(`${pl('file')({ n: p.skipped })} skipped for going over the count or size limit`)
      }
      return `${parts.join('; ')}.`
    },
    ug: (p) =>
      `{families} خەت نۇسخىسى ئائىلىسى يۈكلەندى ({files} ھۆججەت)${Number(p.failed) > 0 ? '، {failed} ھۆججەتنى يۈكلىگىلى بولمىدى' : ''}${Number(p.skipped) > 0 ? '، {skipped} ھۆججەت سان ياكى چوڭلۇق چېكىدىن ئاشقاچقا ئاتلاپ ئۆتۈلدى' : ''}.`,
  },
  chainHelp: {
    zh: '三个字体逐个兜底：首选字体里没有的字符用第二个，再用第三个，然后是兜底文件夹里的字体，最后是内置的等宽字体。可以直接输入字体名，也可以从列表里选。',
    en: 'The three fonts back each other up: characters missing from the primary font come from the second, then the third, then the fonts in the fallback folder, and last the built-in monospace font. Type a font name or pick one from the list.',
    ug: 'ئۈچ خەت نۇسخىسى بىر-بىرىنى تولۇقلايدۇ: ئاساسىي خەت نۇسخىسىدا يوق ھەرپلەر ئۈچۈن ئىككىنچىسى، ئاندىن ئۈچىنچىسى، ئاندىن زاپاس قىسقۇچتىكى خەت نۇسخىلىرى، ئەڭ ئاخىرىدا ئىچكى تەڭ كەڭلىكتىكى خەت نۇسخىسى ئىشلىتىلىدۇ. خەت نۇسخىسى ئاتىنى بىۋاسىتە كىرگۈزسىڭىزمۇ ياكى تىزىملىكتىن تاللىسىڭىزمۇ بولىدۇ.',
  },
  libraryHelp: {
    zh: '导入的 {types} 文件复制到配置目录里保存，不用安装到系统，选字体时出现在“已导入”分组。',
    en: 'Imported {types} files are copied to the config folder, so there is no need to install them in Windows. They appear in the “Imported” group when you choose a font.',
    ug: 'ئەكىرىلگەن {types} ھۆججەتلىرى سەپلىمە قىسقۇچىغا كۆچۈرۈپ ساقلىنىدۇ، سىستېمىغا ئورنىتىشنىڭ ھاجىتى يوق. خەت نۇسخىسى تاللىغاندا «ئەكىرىلگەن» گۇرۇپپىسىدا كۆرۈنىدۇ.',
  },
})

const SLOTS = [
  { label: t('slot1'), clear: t('clearSlot1') },
  { label: t('slot2'), clear: t('clearSlot2') },
  { label: t('slot3'), clear: t('clearSlot3') },
]
const FONT_FILES = ['ttf', 'otf']
/** File types named in help text, kept left to right in Uyghur. */
const fontTypes = () => ltr('.ttf / .otf')
const NOTO_URL = 'https://fonts.google.com/noto'

function fontOptions(system: readonly SystemFont[]): ComboOption[] {
  const seen = new Set<string>()
  const out: ComboOption[] = []
  const add = (option: ComboOption) => {
    const key = option.value.toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    out.push(option)
  }
  for (const file of libraryFonts()) {
    add({
      value: file.family,
      font: file.family,
      group: t('groupImported'),
      detail: file.mono ? t('mono') : '',
    })
  }
  for (const mono of [true, false]) {
    for (const font of system) {
      if (font.mono !== mono) continue
      add({
        value: font.name,
        font: font.name,
        detail: font.localName ?? '',
        group: mono ? t('groupSystemMono') : t('groupSystemOther'),
      })
    }
  }
  return out
}

function sizeText(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.ceil(bytes / 1024)} KB`
}

/** The family name drawn in its own font. */
function sample(family: string): HTMLElement {
  const name = h('span', { class: 'font-sample', text: family })
  name.style.setProperty('--font-sample', `"${family}"`)
  return name
}

/** The three-font chain, imported font files and the fallback folder. */
export function fontSettings(report: Report) {
  let system: SystemFont[] = []
  systemFonts()
    .then((list) => {
      system = list
    })
    .catch(report)

  const slots = SLOTS.map(() =>
    h('input', { type: 'text', spellcheck: 'false', autocomplete: 'off', placeholder: t('none') }),
  )
  const commitFonts = () => {
    let ok = true
    for (const input of slots) {
      const bad = input.value.trim() !== '' && !validFontName(input.value)
      setFieldError(input, bad ? t('badName') : '')
      ok &&= !bad
    }
    if (!ok) return
    const fonts = slots.map((s) => s.value.trim()).filter(Boolean)
    if (fonts.join('\n') === settings().terminal.fonts.join('\n')) return
    updateSettings((d) => {
      d.terminal.fonts = fonts
    }).catch(report)
  }
  const slotFields = slots.map((input, i) => {
    input.addEventListener('change', commitFonts)
    const clear = h(
      'button',
      {
        type: 'button',
        class: 'icon-button',
        title: t('clearTitle'),
        'aria-label': SLOTS[i].clear,
        onclick: () => {
          input.value = ''
          commitFonts()
        },
      },
      namedIcon('x'),
    )
    const element = field(SLOTS[i].label, input, undefined, clear)
    combobox(input, {
      options: () => fontOptions(system),
      pick: commitFonts,
      empty: t('readingSystem'),
      toggleLabel: t('chooseFont'),
    })
    return element
  })

  const known = (name: string) => {
    const key = name.toLowerCase()
    return (
      system.some((f) => f.name.toLowerCase() === key || f.localName?.toLowerCase() === key) ||
      libraryFonts().some((f) => f.family.toLowerCase() === key)
    )
  }
  const notoNote = h('p', { class: 'help', 'aria-live': 'polite', hidden: true })
  const useNoto = () => {
    updateSettings((d) => {
      d.terminal.fonts = [...NOTO_FONTS].slice(0, MAX_FONTS)
    }).catch(report)
    const missing = NOTO_FONTS.filter((name) => !known(name))
    notoNote.hidden = missing.length === 0
    notoNote.textContent = t('notoMissing', { fonts: ltr(joinList(missing)) })
  }
  const importFiles = async () => {
    const chosen = await open({
      multiple: true,
      directory: false,
      title: t('importTitle'),
      filters: [{ name: t('fontFilter'), extensions: FONT_FILES }],
    })
    const paths = Array.isArray(chosen) ? chosen : typeof chosen === 'string' ? [chosen] : []
    const families = new Set<string>()
    for (const path of paths) {
      for (const font of await importFont(path)) families.add(font.family)
    }
    if (families.size > 0) {
      setStatus(t('importedStatus', { fonts: ltr(joinList([...families])) }))
    }
  }
  const fontActions = h(
    'div',
    { class: 'settings-actions' },
    h(
      'button',
      {
        type: 'button',
        class: 'button',
        title: t('notoTitle', { fonts: ltr(NOTO_FONTS.join(' → ')) }),
        onclick: useNoto,
      },
      namedIcon('sparkle'),
      t('useNoto'),
    ),
    h(
      'button',
      { type: 'button', class: 'button quiet', onclick: () => void importFiles().catch(report) },
      namedIcon('upload-simple'),
      t('importFiles'),
    ),
    h(
      'button',
      {
        type: 'button',
        class: 'button quiet',
        title: NOTO_URL,
        onclick: () => invoke('open_url', { url: NOTO_URL }).catch(report),
      },
      namedIcon('arrow-square-out'),
      t('downloadNoto'),
    ),
  )
  const library = h('ul', { class: 'settings-list font-library', 'aria-label': t('imported') })
  const renderLibrary = () => {
    library.replaceChildren(
      ...libraryFonts().map((font) =>
        h(
          'li',
          { class: 'settings-row' },
          h(
            'span',
            { class: 'settings-row-name' },
            sample(font.family),
            h('span', {
              class: 'help',
              text: ` ${font.weight}${font.italic ? ` ${t('italic')}` : ''} · ${sizeText(font.size)}`,
            }),
          ),
          h(
            'button',
            {
              type: 'button',
              class: 'icon-button',
              title: t('removeTitle'),
              'aria-label': t('removeLabel', { name: ltr(font.family) }),
              onclick: () => removeFont(font.path).catch(report),
            },
            namedIcon('trash'),
          ),
        ),
      ),
    )
  }

  const folderInput = h('input', {
    type: 'text',
    spellcheck: 'false',
    autocomplete: 'off',
    placeholder: t('none'),
  })
  const commitFolder = () => {
    const value = folderInput.value.trim()
    if (!validLocalPath(value)) {
      setFieldError(folderInput, t('badFolder', { path: ltr('D:\\Fonts\\Noto') }))
      return
    }
    setFieldError(folderInput, '')
    if (value === settings().terminal.fontFolder && recentPaths('fontFolder')[0] === value) return
    updateSettings((d) => {
      d.terminal.fontFolder = value
      rememberRecent(d, 'fontFolder', value)
    }).catch(report)
  }
  folderInput.addEventListener('change', commitFolder)
  const folderButtons = h(
    'span',
    { class: 'field-buttons' },
    h('button', {
      type: 'button',
      class: 'button',
      text: t('browse'),
      onclick: async () => {
        const chosen = await open({
          directory: true,
          multiple: false,
          title: t('folderDialog'),
          defaultPath: folderInput.value.trim() || undefined,
        })
        if (typeof chosen !== 'string') return
        folderInput.value = chosen
        commitFolder()
      },
    }),
    h(
      'button',
      {
        type: 'button',
        class: 'icon-button',
        title: t('rescanTitle'),
        'aria-label': t('rescanLabel'),
        onclick: () => void useFolder(settings().terminal.fontFolder, true),
      },
      namedIcon('arrows-clockwise'),
    ),
  )
  const folderField = field(
    t('folderLabel'),
    folderInput,
    t('folderHelp', { types: fontTypes() }),
    folderButtons,
  )
  recentPathsCombo(folderInput, 'fontFolder', commitFolder)
  const folderNote = h('p', { class: 'help font-folder-note', 'aria-live': 'polite' })
  const renderFolder = () => {
    const state = folderState()
    folderNote.dataset.tone = state.error || state.failed > 0 ? 'warning' : ''
    if (!state.path) folderNote.textContent = t('folderUnset')
    else if (state.loading) folderNote.textContent = t('folderLoading')
    else if (state.error) folderNote.textContent = t('folderError', { error: state.error })
    else {
      folderNote.textContent = t('folderLoaded', {
        families: state.families.length,
        files: state.files,
        failed: state.failed,
        skipped: state.skipped,
      })
      folderNote.title = state.families.join('\n')
    }
  }

  const refresh = () => {
    const { fonts, fontFolder } = settings().terminal
    slots.forEach((input, i) => {
      if (document.activeElement !== input) input.value = fonts[i] ?? ''
    })
    if (document.activeElement !== folderInput) folderInput.value = fontFolder
  }
  const onFonts = () => {
    renderLibrary()
    renderFolder()
  }
  const unwatch = onFontsChange(onFonts)
  onFonts()

  const element = h(
    'div',
    { class: 'font-settings' },
    h('p', {
      class: 'help',
      text: t('chainHelp'),
    }),
    slotFields,
    fontActions,
    notoNote,
    h('h3', { text: t('imported') }),
    h('p', { class: 'help', text: t('libraryHelp', { types: fontTypes() }) }),
    library,
    folderField,
    folderNote,
  )
  return { element, refresh, dispose: unwatch }
}
