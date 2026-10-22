import { invoke } from '@tauri-apps/api/core'
import { open, save } from '@tauri-apps/plugin-dialog'
import { logApp } from './applog'
import {
  type BackupParts,
  type BundleInfo,
  describeBundle,
  describeExport,
  describeImport,
  type ExportSummary,
  type ImportSummary,
  PART_LABELS,
  partsIn,
} from './backup-model'
import { button, modal } from './dialogs'
import { field, h, setFieldError, setStatus } from './dom'
import { loadFavorites } from './favorites'
import { formatTime } from './format'
import { ltr, messages } from './i18n'
import { common } from './i18n-common'
import { withUnlock } from './master'
import { reloadProfiles } from './profiles-store'
import { describeError, errorField } from './protocol'
import type { Section } from './settings-layout'
import { reloadUserCss } from './settings-store'

const t = messages({
  filter: {
    zh: 'GladosXshell 配置',
    en: 'GladosXshell configuration',
    ug: 'GladosXshell سەپلىمىسى',
  },
  contents: { zh: '包含的内容', en: 'Contents', ug: 'ئۆز ئىچىگە ئالىدىغان مەزمۇن' },
  pickExport: {
    zh: '至少选择一项要导出的内容',
    en: 'Select at least one item to export',
    ug: 'چىقىرىدىغان كەم دېگەندە بىر تۈرنى تاللاڭ',
  },
  pickImport: {
    zh: '至少选择一项要导入的内容',
    en: 'Select at least one item to import',
    ug: 'ئەكىرىدىغان كەم دېگەندە بىر تۈرنى تاللاڭ',
  },
  minChars: { zh: '至少 {n} 个字符', en: 'At least {n} characters', ug: 'كەم دېگەندە {n} ھەرپ' },
  mismatch: {
    zh: '两次输入的密码不一样',
    en: 'The passwords do not match',
    ug: 'ئىككى قېتىم كىرگۈزگەن ئىم ئوخشاش ئەمەس',
  },
  exportingEncrypted: {
    zh: '正在加密并导出配置',
    en: 'Encrypting and exporting configuration',
    ug: 'سەپلىمە شىفىرلىنىپ چىقىرىلىۋاتىدۇ',
  },
  exporting: { zh: '正在导出配置', en: 'Exporting configuration', ug: 'سەپلىمە چىقىرىلىۋاتىدۇ' },
  exportedTo: { zh: '{summary}：{path}', en: '{summary}: {path}', ug: '{summary}: {path}' },
  importTitle: { zh: '导入配置', en: 'Import configuration', ug: 'سەپلىمە ئەكىرىش' },
  exportedAt: { zh: '导出于 {time}', en: 'Exported {time}', ug: '{time} دە چىقىرىلغان' },
  metaSep: { zh: '，', en: ', ', ug: '، ' },
  filePassword: {
    zh: '导出时设置的密码',
    en: 'Password set at export',
    ug: 'چىقىرىشتا تەڭشەلگەن ئىم',
  },
  filePasswordHelp: {
    zh: '留空则只导入服务器，不带密码，之后可以在服务器设置里补上。',
    en: 'Leave empty to import the servers without passwords. You can add them later in the server settings.',
    ug: 'بوش قويسىڭىز مۇلازىمېتىرلار ئىمسىز ئەكىرىلىدۇ، ئىمنى كېيىن مۇلازىمېتىر تەڭشىكىدە تولۇقلىسىڭىز بولىدۇ.',
  },
  importRules: {
    zh: '设置和自定义 CSS 会被文件里的替换。连接、收藏和主机只添加本机还没有的，已有的不会改动；主机密钥不同时保留本机的。',
    en: 'Settings and custom CSS are replaced by the ones in the file. Connections, favorites and hosts are only added when this computer does not have them yet, and existing ones stay as they are; when a host key differs, the local one is kept.',
    ug: 'تەڭشەك ۋە ئۆزلەشتۈرۈلگەن CSS ھۆججەتتىكىسى بىلەن ئالماشتۇرۇلىدۇ. ئۇلىنىش، يىغقۇچ ۋە ئاساسىي ماشىنىلاردىن پەقەت بۇ كومپيۇتېردا يوقلىرىلا قوشۇلىدۇ، بارلىرى ئۆزگەرتىلمەيدۇ؛ ئاساسىي ماشىنا ئاچقۇچى ئوخشىمىسا بۇ كومپيۇتېردىكىسى ساقلىنىدۇ.',
  },
  importing: { zh: '正在导入', en: 'Importing', ug: 'ئەكىرىلىۋاتىدۇ' },
  done: { zh: '完成', en: 'Done', ug: 'تامام' },
  logImported: {
    zh: '导入配置 {path}：{lines}',
    en: 'Imported configuration {path}: {lines}',
    ug: '{path} سەپلىمىسى ئەكىرىلدى: {lines}',
  },
  lineSep: { zh: '；', en: '; ', ug: '؛ ' },
  imported: { zh: '配置已导入', en: 'Configuration imported', ug: 'سەپلىمە ئەكىرىلدى' },
  emptyFile: {
    zh: '这个配置文件是空的',
    en: 'This configuration file is empty',
    ug: 'بۇ سەپلىمە ھۆججىتى قۇرۇق',
  },
  exportPassword: { zh: '导出密码', en: 'Export password', ug: 'چىقىرىش ئىمى' },
  exportPasswordHelp: {
    zh: '至少 {n} 个字符。导入时要输入它，忘记后文件里的密码无法找回。',
    en: 'At least {n} characters. You need it to import the file; without it the passwords in the file cannot be recovered.',
    ug: 'كەم دېگەندە {n} ھەرپ. ئەكىرگەندە ئۇنى كىرگۈزۈش كېرەك، ئۇنتۇپ قالسىڭىز ھۆججەتتىكى ئىملارنى قايتۇرۇۋالغىلى بولمايدۇ.',
  },
  again: { zh: '再输入一次', en: 'Repeat password', ug: 'قايتا كىرگۈزۈڭ' },
  withSecrets: {
    zh: '包含服务器密码（用导出密码加密）',
    en: 'Include server passwords (encrypted with the export password)',
    ug: 'مۇلازىمېتىر ئىملىرىنىمۇ قوش (چىقىرىش ئىمى بىلەن شىفىرلىنىدۇ)',
  },
  exportHeading: { zh: '导出配置', en: 'Export configuration', ug: 'سەپلىمە چىقىرىش' },
  exportHelp: {
    zh: '保存成一个 JSON 文件，用来备份或搬到另一台电脑。默认不含任何密码，私钥文件本身也不会导出，只记录路径。',
    en: 'Saves a JSON file, for a backup or for moving to another computer. By default it holds no passwords, and private key files are not exported either, only their paths.',
    ug: 'بىر JSON ھۆججىتى قىلىپ ساقلايدۇ، زاپاسلاش ياكى باشقا كومپيۇتېرغا يۆتكەش ئۈچۈن. سۈكۈتتىكى ھالەتتە ھېچقانداق ئىم بولمايدۇ، شەخسىي ئاچقۇچ ھۆججىتىنىڭ ئۆزىمۇ چىقىرىلمايدۇ، پەقەت يولىلا خاتىرىلىنىدۇ.',
  },
  exportButton: { zh: '导出到文件', en: 'Export to file', ug: 'ھۆججەتكە چىقار' },
  importHelp: {
    zh: '选择之前导出的文件，先看清里面有什么，再决定导入哪些。',
    en: 'Choose a file you exported earlier, see what it holds, then decide what to import.',
    ug: 'ئىلگىرى چىقارغان ھۆججەتنى تاللاڭ، ئاۋۋال ئىچىدە نېمە بارلىقىنى كۆرۈپ، ئاندىن قايسىلىرىنى ئەكىرىشنى قارار قىلىڭ.',
  },
  importButton: { zh: '从文件导入', en: 'Import from file', ug: 'ھۆججەتتىن ئەكىر' },
  label: { zh: '备份与迁移', en: 'Backup and migration', ug: 'زاپاسلاش ۋە يۆتكەش' },
})

const MIN_PASSWORD = 8
const FILTERS = [{ name: t('filter'), extensions: ['json'] }]
const KEYS = Object.keys(PART_LABELS) as (keyof BackupParts)[]

type Report = (error: unknown) => void

function partChecks(available: BackupParts) {
  const boxes = {} as Record<keyof BackupParts, HTMLInputElement>
  const labels = KEYS.filter((key) => available[key]).map((key) => {
    boxes[key] = h('input', { type: 'checkbox', checked: true })
    return h('label', { class: 'check' }, boxes[key], PART_LABELS[key])
  })
  const read = (): BackupParts => ({
    settings: boxes.settings?.checked ?? false,
    connections: boxes.connections?.checked ?? false,
    favorites: boxes.favorites?.checked ?? false,
    knownHosts: boxes.knownHosts?.checked ?? false,
  })
  const fieldset = h(
    'fieldset',
    { class: 'choice-group' },
    h('legend', { class: 'visually-hidden', text: t('contents') }),
    ...labels,
  )
  return { fieldset, boxes, read }
}

function passwordInput(id: string): HTMLInputElement {
  return h('input', { id, type: 'password', autocomplete: 'new-password', spellcheck: false })
}

async function runExport(
  read: () => BackupParts,
  withSecrets: boolean,
  pass: HTMLInputElement,
  again: HTMLInputElement,
  report: Report,
): Promise<void> {
  const parts = read()
  if (!KEYS.some((key) => parts[key])) {
    setStatus(t('pickExport'), 'error')
    return
  }
  let password: string | null = null
  if (withSecrets && parts.connections) {
    setFieldError(pass, '')
    setFieldError(again, '')
    if ([...pass.value].length < MIN_PASSWORD) {
      setFieldError(pass, t('minChars', { n: MIN_PASSWORD }))
      pass.focus()
      return
    }
    if (pass.value !== again.value) {
      setFieldError(again, t('mismatch'))
      again.focus()
      return
    }
    password = pass.value
  }
  const stamp = new Date().toISOString().slice(0, 10)
  const path = await save({ defaultPath: `gladosxshell-config-${stamp}.json`, filters: FILTERS })
  if (!path) return
  setStatus(t(password ? 'exportingEncrypted' : 'exporting'))
  await withUnlock(() => invoke<ExportSummary>('config_export', { path, parts, password }))
    .then((summary) => {
      pass.value = ''
      again.value = ''
      setStatus(t('exportedTo', { summary: describeExport(summary), path: ltr(path) }))
    })
    .catch(report)
}

/** Preview of the chosen file, then the import itself; resolves once the dialog closes. */
function importDialog(path: string, info: BundleInfo, report: Report): Promise<void> {
  const ui = modal('config-import', t('importTitle'), 'md')
  const meta = [
    info.appVersion ? `GladosXshell ${info.appVersion}` : '',
    info.exportedAt ? t('exportedAt', { time: ltr(formatTime(info.exportedAt)) }) : '',
  ].filter(Boolean)
  const checks = partChecks(partsIn(info))
  const pass = h('input', { type: 'password', autocomplete: 'off', spellcheck: false })
  const passField = field(t('filePassword'), pass, t('filePasswordHelp'))
  const toggleSecrets = () => {
    passField.hidden = !info.secrets || !checks.boxes.connections?.checked
  }
  checks.boxes.connections?.addEventListener('change', toggleSecrets)
  toggleSecrets()
  ui.body.append(
    meta.length ? h('p', { class: 'help', text: meta.join(t('metaSep')) }) : '',
    h(
      'ul',
      { class: 'backup-contents' },
      ...describeBundle(info).map((line) => h('li', { text: line })),
    ),
    checks.fieldset,
    h('p', { class: 'help', text: t('importRules') }),
    passField,
  )
  const result = h('ul', { class: 'backup-result', hidden: true })
  ui.body.append(result)

  const run = button(
    common('import'),
    () => {
      const parts = checks.read()
      if (!KEYS.some((key) => parts[key])) {
        setStatus(t('pickImport'), 'error')
        return
      }
      setFieldError(pass, '')
      run.disabled = true
      run.textContent = t('importing')
      const password = pass.value || null
      withUnlock(() => invoke<ImportSummary>('config_import', { path, parts, password }))
        .then(async (summary) => {
          pass.value = ''
          const lines = describeImport(summary)
          result.replaceChildren(...lines.map((line) => h('li', { text: line })))
          result.hidden = false
          run.hidden = true
          cancel.textContent = t('done')
          logApp('info', t('logImported', { path: ltr(path), lines: lines.join(t('lineSep')) }))
          setStatus(t('imported'))
          const reloads: Promise<unknown>[] = []
          if (summary.connections) reloads.push(reloadProfiles())
          if (summary.favorites) reloads.push(loadFavorites())
          if (summary.customCss) reloadUserCss()
          await Promise.all(reloads)
        })
        .catch((error) => {
          run.disabled = false
          run.textContent = common('import')
          if (info.secrets && pass.value && errorField(error) === 'password') {
            setFieldError(pass, describeError(error))
            pass.focus()
          } else {
            report(error)
          }
        })
    },
    'primary',
  )
  const cancel = button(common('cancel'), () => ui.dialog.close())
  ui.actions.append(cancel, run)
  return new Promise((resolve) => {
    ui.dialog.addEventListener(
      'close',
      () => {
        ui.dialog.remove()
        resolve()
      },
      { once: true },
    )
    ui.dialog.showModal()
    run.focus()
  })
}

async function runImport(report: Report): Promise<void> {
  const path = await open({ multiple: false, directory: false, filters: FILTERS })
  if (typeof path !== 'string') return
  const info = await invoke<BundleInfo>('config_inspect', { path })
  if (describeBundle(info).length === 0) {
    setStatus(t('emptyFile'), 'error')
    return
  }
  await importDialog(path, info, report)
}

export function backupSection(report: Report): Section {
  const all: BackupParts = { settings: true, connections: true, favorites: true, knownHosts: true }
  const checks = partChecks(all)
  const withSecrets = h('input', { type: 'checkbox' })
  const pass = passwordInput('backup-pass')
  const again = passwordInput('backup-pass-again')
  const passFields = h(
    'div',
    { class: 'backup-password', hidden: true },
    field(t('exportPassword'), pass, t('exportPasswordHelp', { n: MIN_PASSWORD })),
    field(t('again'), again),
  )
  const secretsRow = h('label', { class: 'check' }, withSecrets, t('withSecrets'))
  const sync = () => {
    const connections = checks.boxes.connections.checked
    withSecrets.disabled = !connections
    passFields.hidden = !connections || !withSecrets.checked
  }
  checks.boxes.connections.addEventListener('change', sync)
  withSecrets.addEventListener('change', sync)

  const element = h(
    'div',
    { class: 'settings-section' },
    h('h3', { text: t('exportHeading') }),
    h('p', { class: 'help', text: t('exportHelp') }),
    checks.fieldset,
    secretsRow,
    passFields,
    h(
      'div',
      { class: 'settings-actions' },
      h('button', {
        type: 'button',
        class: 'button primary',
        text: t('exportButton'),
        onclick: () =>
          runExport(checks.read, withSecrets.checked, pass, again, report).catch(report),
      }),
    ),
    h('h3', { text: t('importTitle') }),
    h('p', { class: 'help', text: t('importHelp') }),
    h(
      'div',
      { class: 'settings-actions' },
      h('button', {
        type: 'button',
        class: 'button',
        text: t('importButton'),
        onclick: () => runImport(report).catch(report),
      }),
    ),
  )
  return {
    id: 'backup',
    label: t('label'),
    element,
    refresh: () => {},
    dispose: () => {
      pass.value = ''
      again.value = ''
    },
  }
}
