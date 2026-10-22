import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import { field, h, setFieldError, setStatus } from './dom'
import { ltr, messages } from './i18n'
import { common } from './i18n-common'
import { namedIcon } from './icons'
import { hooksBrowser } from './settings-hooks'
import { insertDeclaration } from './settings-hooks-model'
import { languageField } from './settings-language'
import type { Section } from './settings-layout'
import { type Settings, validLocalPath } from './settings-model'
import { recentPaths, recentPathsCombo, rememberRecent } from './settings-paths'
import {
  applyUserCss,
  defaultWorkDirectory,
  loadUserCss,
  onUserCssFile,
  saveUserCss,
  settings,
  updateSettings,
} from './settings-store'
import { scaleField } from './settings-terminal'

type Report = (error: unknown) => void
type PathKey = 'externalEditor' | 'workDir' | 'downloadDir'

const t = messages({
  badPath: {
    zh: '请填写绝对路径，例如 {path}，或留空',
    en: 'Enter an absolute path, such as {path}, or leave it empty',
    ug: 'مۇتلەق يولنى كىرگۈزۈڭ، مەسىلەن {path}، ياكى بوش قالدۇرۇڭ',
  },
  browse: { zh: '浏览…', en: 'Browse…', ug: 'كۆز يۈگۈرت…' },
  programFilter: { zh: '程序', en: 'Programs', ug: 'پروگراممىلار' },
  externalEditor: { zh: '外部编辑器', en: 'External editor', ug: 'سىرتقى تەھرىرلىگۈچ' },
  externalEditorHelp: {
    zh: '留空时使用 Windows 为该文件类型设置的默认程序。',
    en: 'Leave empty to use the program Windows opens this file type with.',
    ug: 'بوش قالدۇرسىڭىز Windows بۇ ھۆججەت تىپىغا بەلگىلىگەن كۆڭۈلدىكى پروگرامما ئىشلىتىلىدۇ.',
  },
  externalEditorPlaceholder: {
    zh: '系统默认程序',
    en: 'System default program',
    ug: 'سىستېمىنىڭ كۆڭۈلدىكى پروگراممىسى',
  },
  externalEditorDialog: {
    zh: '选择外部编辑器',
    en: 'Choose an external editor',
    ug: 'سىرتقى تەھرىرلىگۈچ تاللاش',
  },
  workDir: { zh: '本地工作目录', en: 'Local working folder', ug: 'يەرلىك خىزمەت قىسقۇچى' },
  workDirHelp: {
    zh: '编辑和预览的文件先下载到这里，按服务器和远程路径分目录保存。',
    en: 'Files you edit or preview are downloaded here first, in folders by server and remote path.',
    ug: 'تەھرىرلىنىدىغان ۋە ئالدىن كۆرۈلىدىغان ھۆججەتلەر ئاۋۋال بۇ يەرگە چۈشۈرۈلىدۇ، مۇلازىمېتىر ۋە يىراقتىكى يول بويىچە قىسقۇچلارغا ئايرىپ ساقلىنىدۇ.',
  },
  workDirDialog: {
    zh: '选择本地工作目录',
    en: 'Choose the local working folder',
    ug: 'يەرلىك خىزمەت قىسقۇچىنى تاللاش',
  },
  downloadDir: {
    zh: '默认下载目录',
    en: 'Default download folder',
    ug: 'كۆڭۈلدىكى چۈشۈرۈش قىسقۇچى',
  },
  downloadDirHelp: {
    zh: '留空时每次下载都询问保存位置。',
    en: 'Leave empty to be asked where to save on every download.',
    ug: 'بوش قالدۇرسىڭىز ھەر قېتىم چۈشۈرگەندە ساقلاش ئورنىنى سورايدۇ.',
  },
  downloadDirPlaceholder: { zh: '每次询问', en: 'Ask every time', ug: 'ھەر قېتىم سورايدۇ' },
  downloadDirDialog: {
    zh: '选择默认下载目录',
    en: 'Choose the default download folder',
    ug: 'كۆڭۈلدىكى چۈشۈرۈش قىسقۇچىنى تاللاش',
  },
  editing: { zh: '编辑方式', en: 'Editing', ug: 'تەھرىرلەش ئۇسۇلى' },
  editingLegend: {
    zh: '默认编辑方式',
    en: 'Default way to edit',
    ug: 'كۆڭۈلدىكى تەھرىرلەش ئۇسۇلى',
  },
  internalEditor: { zh: '内置编辑器', en: 'Built-in editor', ug: 'ئىچكى تەھرىرلىگۈچ' },
  externalProgram: { zh: '外部程序', en: 'External program', ug: 'سىرتقى پروگرامما' },
  editingHelp: {
    zh: '文件右键菜单里可以临时换另一种方式。两种方式都要确认后才上传。',
    en: 'Use the other way for one file from its right-click menu. Either way, changes upload only after you confirm.',
    ug: 'ھۆججەتنىڭ ئوڭ كۇنۇپكا تىزىملىكىدىن ۋاقىتلىق يەنە بىر ئۇسۇلغا ئالماشتۇرغىلى بولىدۇ. ھەر ئىككى ئۇسۇلدا جەزملىگەندىن كېيىنلا يۈكلىنىدۇ.',
  },
  folders: { zh: '目录', en: 'Folders', ug: 'قىسقۇچلار' },
  list: { zh: '列表', en: 'List', ug: 'تىزىملىك' },
  filesLayout: {
    zh: '文件面板布局',
    en: 'Files panel layout',
    ug: 'ھۆججەتلەر تاختىسىنىڭ ئورۇنلاشتۇرۇشى',
  },
  viewTree: {
    zh: '双栏：左侧目录树，右侧文件列表',
    en: 'Two panes: folder tree on the left, file list on the right',
    ug: 'ئىككى بۆلەك: سولدا قىسقۇچ دەرىخى، ئوڭدا ھۆججەت تىزىملىكى',
  },
  viewSingle: {
    zh: '单栏：只有文件列表',
    en: 'One pane: file list only',
    ug: 'بىر بۆلەك: پەقەت ھۆججەت تىزىملىكى',
  },
  showHidden: { zh: '显示隐藏文件', en: 'Show hidden files', ug: 'يوشۇرۇن ھۆججەتلەرنى كۆرسەت' },
  filesLabel: { zh: '文件与编辑', en: 'Files and editing', ug: 'ھۆججەت ۋە تەھرىرلەش' },
  cssChangedDirty: {
    zh: '{file} 已在外部修改并应用。编辑框里还有未保存的内容，保存会覆盖外部的修改。',
    en: '{file} was changed outside and applied. You still have unsaved changes here; saving overwrites the outside changes.',
    ug: '{file} سىرتتا ئۆزگەرتىلىپ قوللىنىلدى. تەھرىرلەش رامكىسىدا يەنە ساقلانمىغان مەزمۇن بار، ساقلىسىڭىز سىرتتىكى ئۆزگەرتىش قاپلىنىدۇ.',
  },
  cssChanged: {
    zh: '{file} 已在外部修改，已重新载入并应用。',
    en: '{file} was changed outside, then reloaded and applied.',
    ug: '{file} سىرتتا ئۆزگەرتىلدى، قايتا يۈكلىنىپ قوللىنىلدى.',
  },
  importCssDialog: { zh: '导入 CSS 文件', en: 'Import a CSS file', ug: 'CSS ھۆججىتى ئەكىرىش' },
  cssFilter: { zh: '样式表', en: 'Stylesheets', ug: 'ئۇسلۇب جەدۋىلى' },
  importedFrom: { zh: '导入自 {name}', en: 'Imported from {name}', ug: '{name} دىن ئەكىرىلدى' },
  appendedPreview: {
    zh: '已追加 {name} 并预览。编辑框里原本有未保存的修改，确认后点保存。',
    en: 'Appended {name} and previewed it. You already had unsaved changes here; check them, then save.',
    ug: '{name} قوشۇلۇپ ئالدىن كۆرسىتىلدى. تەھرىرلەش رامكىسىدا ئەسلىدە ساقلانمىغان ئۆزگەرتىش بار ئىدى، تەكشۈرۈپ بولۇپ «ساقلا» نى چېكىڭ.',
  },
  importedSaved: {
    zh: '已导入 {name}，追加在原有样式之后并已保存。',
    en: 'Imported {name}, appended it after the existing styles and saved.',
    ug: '{name} ئەكىرىلىپ بار ئۇسلۇبلارنىڭ كەينىگە قوشۇلدى ۋە ساقلاندى.',
  },
  display: { zh: '显示', en: 'Display', ug: 'كۆرسىتىش' },
  theme: { zh: '主题', en: 'Theme', ug: 'ئۆرنەك' },
  themeLegend: { zh: '界面主题', en: 'Interface theme', ug: 'كۆرۈنمە يۈز ئۆرنىكى' },
  dark: { zh: '深色模式', en: 'Dark mode', ug: 'قېنىق ھالەت' },
  light: { zh: '浅色模式', en: 'Light mode', ug: 'سۇس ھالەت' },
  auto: { zh: '跟随系统', en: 'Same as Windows', ug: 'Windows غا ئەگىشىدۇ' },
  customCss: { zh: '自定义 CSS', en: 'Custom CSS', ug: 'ئىختىيارى CSS' },
  customCssHelp: {
    zh: '在内置样式之后加载，可以覆盖任何规则。也可以用外部编辑器修改 {file}，切回本窗口时自动载入。外部 {url} 会被安全策略拦截。',
    en: 'Loads after the built-in styles, so it can override any rule. You can also edit {file} in an external editor; it reloads when you switch back to this window. External {url} references are blocked by the security policy.',
    ug: 'ئىچكى ئۇسلۇبلاردىن كېيىن يۈكلىنىدۇ، ھەر قانداق قائىدىنى قاپلىيالايدۇ. {file} نى سىرتقى تەھرىرلىگۈچتە ئۆزگەرتسىڭىزمۇ بولىدۇ، بۇ كۆزنەككە قايتقاندا ئاپتوماتىك يۈكلىنىدۇ. سىرتقى {url} بىخەتەرلىك سىياسىتى تەرىپىدىن توسۇلىدۇ.',
  },
  stylesheet: { zh: '样式表', en: 'Stylesheet', ug: 'ئۇسلۇب جەدۋىلى' },
  preview: { zh: '预览', en: 'Preview', ug: 'ئالدىن كۆر' },
  cssSaved: { zh: '自定义样式已保存', en: 'Custom styles saved', ug: 'ئىختىيارى ئۇسلۇب ساقلاندى' },
  revert: { zh: '撤销修改', en: 'Revert changes', ug: 'ئۆزگەرتىشنى ئەسلىگە قايتۇر' },
  openCssTitle: {
    zh: '用系统默认程序打开 {file}；文件不存在时先创建一个带说明的模板',
    en: 'Open {file} in the default program. If it doesn’t exist yet, a template with notes is created first.',
    ug: '{file} نى سىستېمىنىڭ كۆڭۈلدىكى پروگراممىسىدا ئاچ؛ ھۆججەت مەۋجۇت بولمىسا ئاۋۋال چۈشەندۈرۈشلىك قېلىپ قۇرۇلىدۇ',
  },
  unsavedExternal: {
    zh: '编辑框里有未保存的修改，外部编辑器打开的是已保存的版本。',
    en: 'You have unsaved changes here; the external editor opens the saved version.',
    ug: 'تەھرىرلەش رامكىسىدا ساقلانمىغان ئۆزگەرتىش بار، سىرتقى تەھرىرلىگۈچ ساقلانغان نۇسخىنى ئاچىدۇ.',
  },
  openCss: { zh: '打开 {file}', en: 'Open {file}', ug: '{file} نى ئاچ' },
  importCssTitle: {
    zh: '选择一个 {ext} 文件，追加到自定义样式的末尾',
    en: 'Choose a {ext} file to append to the end of your custom styles',
    ug: 'بىر {ext} ھۆججىتىنى تاللاپ ئىختىيارى ئۇسلۇبنىڭ ئاخىرىغا قوش',
  },
  importCss: { zh: '导入 CSS 文件…', en: 'Import CSS file…', ug: 'CSS ھۆججىتى ئەكىر…' },
  openConfigDir: { zh: '打开配置目录', en: 'Open config folder', ug: 'سەپلىمە قىسقۇچىنى ئاچ' },
  hooks: { zh: '样式钩子', en: 'Style hooks', ug: 'ئۇسلۇب ئىلمەكلىرى' },
  hooksHelp: {
    zh: '这些选择器和变量会保持稳定。点击加号把规则或变量插入上面的样式表，数值标签对应的变体也可以直接点击插入。',
    en: 'These selectors and variables stay stable. Click a plus sign to insert a rule or variable into the stylesheet above; click a value tag to insert that variant.',
    ug: 'بۇ تاللىغۇچ ۋە ئۆزگەرگۈچىلەر مۇقىم ساقلىنىدۇ. قوشۇش بەلگىسىنى چېكىپ قائىدە ياكى ئۆزگەرگۈچىنى يۇقىرىدىكى ئۇسلۇب جەدۋىلىگە قىستۇرۇڭ، قىممەت خەتكۈچىنى چېكىپ ئۇنىڭغا ماس شەكلىنىمۇ بىۋاسىتە قىستۇرغىلى بولىدۇ.',
  },
  appearance: { zh: '外观', en: 'Appearance', ug: 'كۆرۈنۈش' },
})

/** The stylesheet's file name, kept left to right in Uyghur. */
const cssFile = () => ltr('custom.css')

function pathField(
  key: PathKey,
  label: string,
  help: string,
  placeholder: string,
  pick: { directory: boolean; title: string },
  report: Report,
): { element: HTMLElement; refresh: () => void } {
  const input = h('input', { type: 'text', spellcheck: 'false', autocomplete: 'off', placeholder })
  const commit = () => {
    const value = input.value.trim()
    if (!validLocalPath(value)) {
      setFieldError(input, t('badPath', { path: ltr('D:\\GladosXshell') }))
      return
    }
    setFieldError(input, '')
    if (value === settings().files[key] && recentPaths(key)[0] === value) return
    updateSettings((d) => {
      d.files[key] = value
      rememberRecent(d, key, value)
    }).catch(report)
  }
  input.addEventListener('change', commit)
  const browse = h('button', {
    type: 'button',
    class: 'button',
    text: t('browse'),
    onclick: async () => {
      const chosen = await open({
        directory: pick.directory,
        multiple: false,
        title: pick.title,
        defaultPath: input.value.trim() || undefined,
        filters: pick.directory
          ? undefined
          : [{ name: t('programFilter'), extensions: ['exe', 'cmd', 'bat'] }],
      })
      if (typeof chosen === 'string') {
        input.value = chosen
        commit()
      }
    },
  })
  const element = field(label, input, help, browse)
  recentPathsCombo(input, key, commit)
  return {
    element,
    refresh: () => {
      if (document.activeElement !== input) input.value = settings().files[key]
    },
  }
}

export function filesSection(report: Report): Section {
  const internal = h('input', { type: 'radio', name: 'set-editor', value: 'internal' })
  const external = h('input', { type: 'radio', name: 'set-editor', value: 'external' })
  for (const radio of [internal, external]) {
    radio.addEventListener('change', () =>
      updateSettings((d) => {
        d.files.editor = radio.value as Settings['files']['editor']
      }).catch(report),
    )
  }
  const tree = h('input', { type: 'radio', name: 'set-files-view', value: 'tree' })
  const single = h('input', { type: 'radio', name: 'set-files-view', value: 'single' })
  for (const radio of [tree, single]) {
    radio.addEventListener('change', () =>
      updateSettings((d) => {
        d.files.view = radio.value as Settings['files']['view']
      }).catch(report),
    )
  }
  const showHidden = h('input', { type: 'checkbox' })
  showHidden.addEventListener('change', () =>
    updateSettings((d) => {
      d.files.showHidden = showHidden.checked
    }).catch(report),
  )
  const editor = pathField(
    'externalEditor',
    t('externalEditor'),
    t('externalEditorHelp'),
    t('externalEditorPlaceholder'),
    { directory: false, title: t('externalEditorDialog') },
    report,
  )
  const workDir = pathField(
    'workDir',
    t('workDir'),
    t('workDirHelp'),
    defaultWorkDirectory(),
    { directory: true, title: t('workDirDialog') },
    report,
  )
  const downloadDir = pathField(
    'downloadDir',
    t('downloadDir'),
    t('downloadDirHelp'),
    t('downloadDirPlaceholder'),
    { directory: true, title: t('downloadDirDialog') },
    report,
  )
  const refresh = () => {
    const files = settings().files
    internal.checked = files.editor === 'internal'
    external.checked = files.editor === 'external'
    showHidden.checked = files.showHidden
    tree.checked = files.view === 'tree'
    single.checked = files.view === 'single'
    for (const f of [editor, workDir, downloadDir]) f.refresh()
  }
  const element = h(
    'div',
    { class: 'settings-section' },
    h('h3', { text: t('editing') }),
    h(
      'fieldset',
      { class: 'choice-group' },
      h('legend', { class: 'visually-hidden', text: t('editingLegend') }),
      h('label', { class: 'check' }, internal, t('internalEditor')),
      h('label', { class: 'check' }, external, t('externalProgram')),
    ),
    h('p', { class: 'help', text: t('editingHelp') }),
    editor.element,
    h('h3', { text: t('folders') }),
    workDir.element,
    downloadDir.element,
    h('h3', { text: t('list') }),
    h(
      'fieldset',
      { class: 'choice-group' },
      h('legend', { class: 'visually-hidden', text: t('filesLayout') }),
      h('label', { class: 'check' }, tree, t('viewTree')),
      h('label', { class: 'check' }, single, t('viewSingle')),
    ),
    h('label', { class: 'check' }, showHidden, t('showHidden')),
  )
  refresh()
  return { id: 'files', label: t('filesLabel'), element, refresh }
}

export function appearanceSection(report: Report): Section {
  const dark = h('input', { type: 'radio', name: 'set-theme', value: 'dark' })
  const light = h('input', { type: 'radio', name: 'set-theme', value: 'light' })
  const auto = h('input', { type: 'radio', name: 'set-theme', value: 'auto' })
  for (const radio of [dark, light, auto]) {
    radio.addEventListener('change', () => {
      import('./theme')
        .then(({ setTheme }) => {
          setTheme(radio.value as Settings['ui']['theme'])
        })
        .catch(report)
    })
  }
  const css = h('textarea', {
    class: 'mono css-editor',
    dir: 'ltr',
    rows: 14,
    spellcheck: 'false',
    placeholder: ':root {\n  --gx-accent: oklch(70% 0.13 200);\n}',
  })
  const scale = scaleField(report)
  const refreshTheme = () => {
    const theme = settings().ui.theme
    dark.checked = theme === 'dark'
    light.checked = theme === 'light'
    auto.checked = theme === 'auto'
  }
  let saved = ''
  const note = h('p', { class: 'help css-file-note', 'aria-live': 'polite', hidden: true })
  const load = () =>
    loadUserCss()
      .then((text) => {
        saved = text
        css.value = text
      })
      .catch(report)
  const stopWatch = onUserCssFile((text) => {
    const dirty = css.value !== saved
    saved = text
    if (!dirty) css.value = text
    note.hidden = false
    note.textContent = t(dirty ? 'cssChangedDirty' : 'cssChanged', { file: cssFile() })
    hooks.update()
  })

  const insertRule = (selector: string) => {
    const start = css.selectionStart
    const lead = start > 0 && css.value[start - 1] !== '\n' ? '\n' : ''
    css.setRangeText(`${lead}${selector} {\n  \n}\n`, start, css.selectionEnd, 'end')
    const caret = start + lead.length + selector.length + 5
    css.focus()
    css.setSelectionRange(caret, caret)
  }
  const insertToken = (name: string, value: string) => {
    const next = insertDeclaration(css.value, `${name}: ${value};`)
    css.value = next.css
    css.focus()
    css.setSelectionRange(next.at - value.length - 1, next.at - 1)
  }
  const hooks = hooksBrowser({ rule: insertRule, token: insertToken })

  /** Appends a picked stylesheet; saves at once unless the editor already had unsaved edits. */
  const importCss = async () => {
    const chosen = await open({
      multiple: false,
      directory: false,
      title: t('importCssDialog'),
      filters: [{ name: t('cssFilter'), extensions: ['css'] }],
    })
    if (typeof chosen !== 'string') return
    const text = await invoke<string>('custom_css_import', { path: chosen })
    const name = chosen.split(/[\\/]/).pop() ?? chosen
    const unsaved = css.value !== saved
    const head = css.value.trimEnd()
    const banner = `/* ${t('importedFrom', { name: name.replaceAll('*/', '') })} */`
    css.value = `${head}${head ? '\n\n' : ''}${banner}\n${text.trimEnd()}\n`
    applyUserCss(css.value)
    note.hidden = false
    if (unsaved) {
      note.textContent = t('appendedPreview', { name: ltr(name) })
      return
    }
    await saveUserCss(css.value)
    saved = css.value
    hooks.update()
    note.textContent = t('importedSaved', { name: ltr(name) })
  }

  const language = languageField(report)
  const element = h(
    'div',
    { class: 'settings-section' },
    language.element,
    h('h3', { text: t('display') }),
    scale.element,
    h('h3', { text: t('theme') }),
    h(
      'fieldset',
      { class: 'choice-group' },
      h('legend', { class: 'visually-hidden', text: t('themeLegend') }),
      h('label', { class: 'check' }, dark, t('dark')),
      h('label', { class: 'check' }, light, t('light')),
      h('label', { class: 'check' }, auto, t('auto')),
    ),
    h('h3', { text: t('customCss') }),
    h('p', {
      class: 'help',
      text: t('customCssHelp', { file: cssFile(), url: ltr('url()') }),
    }),
    field(t('stylesheet'), css),
    note,
    h(
      'div',
      { class: 'settings-actions' },
      h('button', {
        type: 'button',
        class: 'button',
        text: t('preview'),
        onclick: () => applyUserCss(css.value),
      }),
      h('button', {
        type: 'button',
        class: 'button primary',
        text: common('save'),
        onclick: () =>
          saveUserCss(css.value)
            .then(() => {
              saved = css.value
              note.hidden = true
              hooks.update()
              setStatus(t('cssSaved'))
            })
            .catch(report),
      }),
      h('button', {
        type: 'button',
        class: 'button quiet',
        text: t('revert'),
        onclick: () => {
          css.value = saved
          applyUserCss(saved)
        },
      }),
      h('span', { class: 'grow' }),
      h(
        'button',
        {
          type: 'button',
          class: 'button quiet',
          title: t('openCssTitle', { file: cssFile() }),
          onclick: () => {
            const unsaved = css.value !== saved
            invoke('custom_css_open')
              .then(() => {
                if (!unsaved) return
                note.hidden = false
                note.textContent = t('unsavedExternal')
              })
              .catch(report)
          },
        },
        namedIcon('file-code'),
        t('openCss', { file: cssFile() }),
      ),
      h(
        'button',
        {
          type: 'button',
          class: 'button quiet',
          title: t('importCssTitle', { ext: ltr('.css') }),
          onclick: () => void importCss().catch(report),
        },
        namedIcon('upload-simple'),
        t('importCss'),
      ),
      h('button', {
        type: 'button',
        class: 'button quiet',
        text: t('openConfigDir'),
        onclick: () => invoke('open_config_dir').catch(report),
      }),
    ),
    h('h3', { text: t('hooks') }),
    h('p', { class: 'help', text: t('hooksHelp') }),
    hooks.element,
  )
  void load()
  const refresh = () => {
    refreshTheme()
    language.refresh()
    scale.refresh()
    hooks.update()
  }
  refresh()
  return { id: 'appearance', label: t('appearance'), element, refresh, dispose: stopWatch }
}
