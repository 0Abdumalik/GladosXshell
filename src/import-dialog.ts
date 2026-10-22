import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import { button, confirmDialog, modal } from './dialogs'
import { field, h, reportError, setStatus } from './dom'
import { ltr, messages, pl } from './i18n'
import { common } from './i18n-common'
import { withUnlock } from './master'
import { reloadProfiles } from './profiles-store'
import type { Advanced, AuthMethod } from './protocol'

const t = messages({
  sshConfig: {
    zh: 'OpenSSH 配置（{path}）',
    en: 'OpenSSH config ({path})',
    ug: 'OpenSSH سەپلىمىسى ({path})',
  },
  xshell: { zh: 'Xshell 会话', en: 'Xshell sessions', ug: 'Xshell ئەڭگىمىلىرى' },
  putty: {
    zh: 'PuTTY 会话（注册表）',
    en: 'PuTTY sessions (registry)',
    ug: 'PuTTY ئەڭگىمىلىرى (تىزىملاش جەدۋىلى)',
  },
  finalShell: { zh: 'FinalShell 连接', en: 'FinalShell connections', ug: 'FinalShell ئۇلىنىشلىرى' },
  hintSshConfig: {
    zh: '配置文件在别处的话，点「选择位置…」选它。',
    en: 'If the config file is somewhere else, click “Choose location…” and pick it.',
    ug: 'سەپلىمە ھۆججىتى باشقا يەردە بولسا، «ئورۇن تاللا…» نى چېكىپ ئۇنى تاللاڭ.',
  },
  hintXshell: {
    zh: 'Xshell 会话放在别处的话，点「选择位置…」选会话所在的文件夹（Xshell 里「文件 › 打开」能看到路径）。',
    en: 'If the Xshell sessions are somewhere else, click “Choose location…” and pick the folder they are in (Xshell shows it under File › Open).',
    ug: 'Xshell ئەڭگىمىلىرى باشقا يەردە بولسا، «ئورۇن تاللا…» نى چېكىپ ئەڭگىمىلەر تۇرغان قىسقۇچنى تاللاڭ (Xshell دىكى «File › Open» دا يولىنى كۆرگىلى بولىدۇ).',
  },
  hintFinalShell: {
    zh: 'FinalShell 装在别处的话，点「选择位置…」选它的安装文件夹（里面有 conn 文件夹）。',
    en: 'If FinalShell is installed somewhere else, click “Choose location…” and pick its install folder (the one with the conn folder inside).',
    ug: 'FinalShell باشقا يەرگە ئورنىتىلغان بولسا، «ئورۇن تاللا…» نى چېكىپ ئۇنىڭ ئورنىتىش قىسقۇچىنى تاللاڭ (ئىچىدە conn قىسقۇچى بار).',
  },
  keyFile: { zh: '私钥', en: 'Private key', ug: 'شەخسىي ئاچقۇچ' },
  keyboardInteractive: {
    zh: '键盘交互',
    en: 'Keyboard-interactive',
    ug: 'كۇنۇپكا تاختىسى ئارقىلىق',
  },
  title: { zh: '导入连接', en: 'Import connections', ug: 'ئۇلىنىش ئەكىرىش' },
  pick: { zh: '选择位置…', en: 'Choose location…', ug: 'ئورۇن تاللا…' },
  reread: { zh: '重新读取', en: 'Read again', ug: 'قايتا ئوقۇ' },
  found: { zh: '找到的连接', en: 'Connections found', ug: 'تېپىلغان ئۇلىنىشلار' },
  withPasswords: {
    zh: '同时导入 FinalShell 保存的密码',
    en: 'Also import passwords saved in FinalShell',
    ug: 'FinalShell دا ساقلانغان ئىملارنىمۇ بىللە ئەكىرىش',
  },
  secretsHelp: {
    zh: '密码只在本机解密，随即按本软件的方式重新加密保存，不会显示、复制或写进日志。解密方法来自 FinalShellDePsd（{url}）。',
    en: 'Passwords are decrypted only on this computer and right away encrypted again the way GladosXshell stores them. They are never shown, copied or logged. The decryption method comes from FinalShellDePsd ({url}).',
    ug: 'ئىملار پەقەت بۇ كومپيۇتېردىلا شىفىردىن يېشىلىدۇ، ئاندىن دەرھال بۇ يۇمشاق دېتالنىڭ ئۇسۇلى بويىچە قايتا شىفىرلىنىپ ساقلىنىدۇ، كۆرسىتىلمەيدۇ، كۆچۈرۈلمەيدۇ ۋە خاتىرىگە يېزىلمايدۇ. شىفىر يېشىش ئۇسۇلى FinalShellDePsd ({url}) دىن كەلگەن.',
  },
  source: { zh: '来源', en: 'Source', ug: 'مەنبە' },
  importSelected: { zh: '导入选中', en: 'Import selected', ug: 'تاللانغاننى ئەكىر' },
  selected: {
    zh: '已选 {n} / {total}',
    en: '{n} of {total} selected',
    ug: 'تاللانغىنى {n}/{total}',
  },
  userPlaceholder: {
    zh: '填写用户名后才能导入',
    en: 'Enter a user name to import',
    ug: 'ئەكىرىش ئۈچۈن ئىشلەتكۈچى ئاتىنى كىرگۈزۈڭ',
  },
  userLabel: {
    zh: '{name} 的用户名',
    en: 'User name for {name}',
    ug: '{name} نىڭ ئىشلەتكۈچى ئاتى',
  },
  via: { zh: '经 {jump}', en: 'via {jump}', ug: '{jump} ئارقىلىق' },
  exists: { zh: '已存在', en: 'Already saved', ug: 'ئاللىبۇرۇن بار' },
  doubtful: { zh: '可能不是 SSH', en: 'May not be SSH', ug: 'SSH بولماسلىقى مۇمكىن' },
  hasPassword: { zh: '有保存的密码', en: 'Saved password', ug: 'ساقلانغان ئىمى بار' },
  readFrom: { zh: '读取自：{paths}', en: 'Read from: {paths}', ug: 'ئوقۇلغان ئورۇن: {paths}' },
  lookedIn: { zh: '查找了：{paths}', en: 'Looked in: {paths}', ug: 'ئىزدەلگەن ئورۇن: {paths}' },
  pathSep: { zh: '；', en: '; ', ug: '؛ ' },
  noneFound: {
    zh: '没有找到可以导入的 SSH 连接。',
    en: 'No SSH connections to import were found.',
    ug: 'ئەكىرگىلى بولىدىغان SSH ئۇلىنىشى تېپىلمىدى.',
  },
  skipped: {
    zh: '跳过 {n} 个非 SSH 或没有地址的条目。',
    en: (p) => `Skipped ${pl('entry', 'entries')(p)} that are not SSH or have no address.`,
    ug: 'SSH ئەمەس ياكى ئادرېسى يوق {n} تۈر ئاتلاپ ئۆتۈلدى.',
  },
  reading: { zh: '正在读取…', en: 'Reading…', ug: 'ئوقۇۋاتىدۇ…' },
  pickFolder: {
    zh: '选择 {source} 所在文件夹',
    en: 'Choose the folder with the {source}',
    ug: '{source} تۇرغان قىسقۇچنى تاللاڭ',
  },
  pickFile: {
    zh: '选择 ssh config 文件',
    en: 'Choose the ssh config file',
    ug: 'ssh config ھۆججىتىنى تاللاڭ',
  },
  confirmTitle: {
    zh: '导入保存的密码',
    en: 'Import saved passwords',
    ug: 'ساقلانغان ئىملارنى ئەكىرىش',
  },
  confirmText: {
    zh: '将在本机解密 {n} 个 FinalShell 保存的密码，并立即加密保存到本软件。密码不会显示、复制或写进日志。确定继续吗？',
    en: (p) =>
      `${Number(p.n) === 1 ? 'One password' : `${p.n} passwords`} saved by FinalShell will be decrypted on this computer and encrypted again right away for GladosXshell. Passwords are never shown, copied or logged. Continue?`,
    ug: 'FinalShell ساقلىغان {n} ئىم بۇ كومپيۇتېردا شىفىردىن يېشىلىپ، دەرھال شىفىرلىنىپ بۇ يۇمشاق دېتالغا ساقلىنىدۇ. ئىملار كۆرسىتىلمەيدۇ، كۆچۈرۈلمەيدۇ ۋە خاتىرىگە يېزىلمايدۇ. داۋاملاشتۇرامسىز؟',
  },
  confirmButton: { zh: '导入密码', en: 'Import passwords', ug: 'ئىملارنى ئەكىر' },
  imported: {
    zh: (p) =>
      `已导入 ${p.added} 个连接${Number(p.secrets) > 0 ? `，含 ${p.secrets} 个密码` : ''}${Number(p.unreadable) > 0 ? `，${p.unreadable} 个密码无法解密` : ''}${Number(p.failed) > 0 ? `，${p.failed} 个失败` : ''}`,
    en: (p) =>
      [
        `Imported ${pl('connection')({ n: p.added })}`,
        Number(p.secrets) > 0 ? `with ${pl('password')({ n: p.secrets })}` : '',
        Number(p.unreadable) > 0
          ? `${pl('password')({ n: p.unreadable })} could not be decrypted`
          : '',
        Number(p.failed) > 0 ? `${p.failed} failed` : '',
      ]
        .filter(Boolean)
        .join(', '),
    ug: (p) =>
      [
        `${p.added} ئۇلىنىش ئەكىرىلدى`,
        Number(p.secrets) > 0 ? `ئىچىدە ${p.secrets} ئىم بار` : '',
        Number(p.unreadable) > 0 ? `${p.unreadable} ئىمنى شىفىردىن يېشەلمىدى` : '',
        Number(p.failed) > 0 ? `مەغلۇپ بولغىنى ${p.failed}` : '',
      ]
        .filter(Boolean)
        .join('، '),
  },
  failedHead: {
    zh: '{n} 个连接没有导入：',
    en: (p) => `${pl('connection')(p)} not imported:`,
    ug: '{n} ئۇلىنىش ئەكىرىلمىدى:',
  },
  failure: { zh: '{name}：{reason}', en: '{name}: {reason}', ug: '{name}: {reason}' },
})

type Source = 'sshConfig' | 'xshell' | 'putty' | 'finalShell'

interface Candidate {
  source: Source
  name: string
  group: string | null
  host: string
  port: number
  user: string
  method: AuthMethod
  keyPath: string
  jump: string | null
  note: string
  advanced: Advanced
  warnings: string[]
  doubtful: boolean
  exists: boolean
  /** Handle for a password the backend holds; the password itself never comes here. */
  passwordRef: string | null
}

interface SourceScan {
  source: Source
  paths: string[]
  candidates: Candidate[]
  skipped: number
  error: string | null
}

interface ImportReport {
  added: number
  failed: { name: string; reason: string }[]
  secrets: number
  secretsUnreadable: number
}

export const FINALSHELL_DEPSD_URL = 'https://github.com/WishMelz/FinalShellDePsd'

const SOURCES: { id: Source; label: string; pick: 'file' | 'folder' | null }[] = [
  { id: 'sshConfig', label: t('sshConfig', { path: ltr('~/.ssh/config') }), pick: 'file' },
  { id: 'xshell', label: t('xshell'), pick: 'folder' },
  { id: 'putty', label: t('putty'), pick: null },
  { id: 'finalShell', label: t('finalShell'), pick: 'folder' },
]

const MISSING_HINT: Partial<Record<Source, string>> = {
  sshConfig: t('hintSshConfig'),
  xshell: t('hintXshell'),
  finalShell: t('hintFinalShell'),
}

const METHOD: Record<AuthMethod, string> = {
  password: common('password'),
  keyFile: t('keyFile'),
  keyboardInteractive: t('keyboardInteractive'),
  agent: 'Agent',
}

let current: HTMLDialogElement | null = null

/** Reads connections saved by another client and saves the ones the user keeps checked. */
export function openImportDialog(): void {
  if (current) {
    current.querySelector<HTMLElement>('select')?.focus()
    return
  }
  const parts = modal('import', t('title'), 'lg')
  current = parts.dialog
  const custom = new Map<Source, string>()
  let candidates: Candidate[] = []
  const checked = new Set<number>()
  let busy = false

  const source = h(
    'select',
    {},
    SOURCES.map((s) => h('option', { value: s.id, text: s.label })),
  )
  const pick = button(t('pick'), () => choosePath().catch(reportError))
  const reread = button(t('reread'), () => void scan())
  const where = h('p', { class: 'import-where', 'aria-live': 'polite' })
  const all = h('input', { type: 'checkbox', 'aria-label': common('selectAll') })
  const head = h('label', { class: 'import-head' }, all, h('span', { text: common('selectAll') }))
  const list = h('ul', { class: 'import-list', role: 'list', 'aria-label': t('found') })
  const failures = h('div', { class: 'import-failures', role: 'alert' })
  // Off on every scan: carrying passwords over is something to opt into each time.
  const withPasswords = h('input', { type: 'checkbox', 'aria-describedby': 'import-secrets-help' })
  const secrets = h(
    'div',
    { class: 'import-secrets' },
    h(
      'label',
      { class: 'import-secrets-toggle' },
      withPasswords,
      h('span', { text: t('withPasswords') }),
    ),
    h('p', {
      id: 'import-secrets-help',
      class: 'import-secrets-help',
      text: t('secretsHelp', { url: ltr(FINALSHELL_DEPSD_URL) }),
    }),
  )
  parts.body.classList.add('import-body')
  parts.body.append(
    h(
      'div',
      { class: 'import-source' },
      field(
        t('source'),
        source,
        undefined,
        h('div', { class: 'import-source-actions' }, pick, reread),
      ),
    ),
    where,
    head,
    list,
    secrets,
    failures,
  )

  const count = h('span', { class: 'conn-selected num', 'aria-live': 'polite' })
  const run = button(t('importSelected'), () => void save(), 'primary')
  parts.actions.append(
    count,
    h('span', { class: 'grow' }),
    button(common('cancel'), () => parts.dialog.close()),
    run,
  )

  const sourceInfo = () => SOURCES.find((s) => s.id === source.value) ?? SOURCES[0]

  const importable = () => candidates.filter((c) => c.user).length

  const sync = () => {
    const n = checked.size
    const max = importable()
    count.textContent = candidates.length > 0 ? t('selected', { n, total: candidates.length }) : ''
    run.disabled = busy || n === 0
    all.checked = n > 0 && n === max
    all.indeterminate = n > 0 && n < max
    head.hidden = candidates.length === 0
    secrets.hidden = !candidates.some((c) => c.passwordRef)
    withPasswords.disabled = busy
    for (const box of list.querySelectorAll<HTMLInputElement>('input[data-index]')) {
      box.checked = checked.has(Number(box.dataset.index))
    }
  }

  const row = (c: Candidate, index: number): HTMLElement => {
    const box = h('input', { type: 'checkbox', 'data-index': index, disabled: !c.user })
    box.addEventListener('change', () => {
      if (box.checked) checked.add(index)
      else checked.delete(index)
      sync()
    })
    // Some clients save a connection without a user and ask at login; a saved server needs one.
    let userField: HTMLElement | null = null
    if (!c.user) {
      const input = h('input', {
        type: 'text',
        class: 'import-user-input',
        placeholder: t('userPlaceholder'),
        'aria-label': t('userLabel', { name: c.name }),
        spellcheck: 'false',
        autocomplete: 'off',
      })
      input.addEventListener('input', () => {
        c.user = input.value.trim()
        box.disabled = !c.user
        if (c.user) checked.add(index)
        else checked.delete(index)
        sync()
      })
      userField = h('div', { class: 'import-user' }, input)
    }
    const address = `${c.user ? `${c.user}@` : ''}${c.host}${c.port === 22 ? '' : `:${c.port}`}`
    const meta = [
      c.group,
      ltr(address),
      METHOD[c.method],
      c.jump ? t('via', { jump: c.jump }) : null,
    ]
      .filter(Boolean)
      .join(' · ')
    const tags = [
      c.exists ? h('span', { class: 'import-tag', text: t('exists') }) : null,
      c.doubtful ? h('span', { class: 'import-tag', text: t('doubtful') }) : null,
      c.passwordRef ? h('span', { class: 'import-tag', text: t('hasPassword') }) : null,
    ]
    return h(
      'li',
      { class: 'import-item' },
      h(
        'label',
        { class: 'import-row' },
        box,
        h('span', { class: 'conn-name', text: c.name }),
        ...tags,
        h('span', { class: 'conn-meta', text: meta, title: meta }),
      ),
      userField,
      c.warnings.length > 0
        ? h(
            'ul',
            { class: 'import-warnings' },
            c.warnings.map((w) => h('li', { text: w })),
          )
        : null,
    )
  }

  const render = (result: SourceScan) => {
    candidates = result.candidates
    withPasswords.checked = false
    checked.clear()
    candidates.forEach((c, i) => {
      if (c.user && !c.exists && !c.doubtful) checked.add(i)
    })
    const lines: string[] = []
    if (result.paths.length > 0) {
      const paths = result.paths.map(ltr).join(t('pathSep'))
      lines.push(t(result.candidates.length > 0 ? 'readFrom' : 'lookedIn', { paths }))
    }
    if (result.error) lines.push(result.error)
    else if (result.candidates.length === 0) {
      lines.push(t('noneFound'))
      const hint = MISSING_HINT[result.source]
      if (hint && !custom.has(result.source)) lines.push(hint)
    }
    if (result.skipped > 0) lines.push(t('skipped', { n: result.skipped }))
    where.textContent = lines.join('\n')
    where.dataset.tone = result.error ? 'error' : 'info'
    list.replaceChildren(...candidates.map(row))
    list.hidden = candidates.length === 0
    failures.replaceChildren()
    sync()
  }

  let generation = 0
  const scan = async () => {
    const info = sourceInfo()
    pick.hidden = info.pick === null
    const mine = ++generation
    busy = true
    sync()
    where.textContent = t('reading')
    where.dataset.tone = 'info'
    try {
      const result = await invoke<SourceScan>('profiles_import_scan', {
        source: info.id,
        path: custom.get(info.id) ?? null,
      })
      if (mine === generation) render(result)
    } catch (error) {
      if (mine !== generation) return
      render({ source: info.id, paths: [], candidates: [], skipped: 0, error: null })
      where.textContent = ''
      reportError(error)
    } finally {
      if (mine === generation) {
        busy = false
        sync()
      }
    }
  }

  const choosePath = async () => {
    const info = sourceInfo()
    if (!info.pick) return
    const chosen = await open({
      multiple: false,
      directory: info.pick === 'folder',
      title: info.pick === 'folder' ? t('pickFolder', { source: info.label }) : t('pickFile'),
      defaultPath: custom.get(info.id),
    })
    if (typeof chosen !== 'string') return
    custom.set(info.id, chosen)
    await scan()
  }

  const save = async () => {
    const chosen = candidates.filter((_, i) => checked.has(i))
    if (chosen.length === 0) return
    const withSecrets = withPasswords.checked
      ? chosen.filter((c) => c.passwordRef && c.method === 'password').length
      : 0
    if (withSecrets > 0) {
      const ok = await confirmDialog(
        t('confirmTitle'),
        t('confirmText', { n: withSecrets }),
        t('confirmButton'),
        true,
        true,
      )
      if (!ok) return
    }
    busy = true
    sync()
    try {
      const report = await withUnlock(() =>
        invoke<ImportReport>('profiles_import', {
          candidates: chosen,
          withPasswords: withSecrets > 0,
        }),
      )
      await reloadProfiles()
      const counts = {
        added: report.added,
        secrets: report.secrets,
        unreadable: report.secretsUnreadable,
        failed: report.failed.length,
      }
      if (report.failed.length === 0) {
        setStatus(t('imported', counts), report.secretsUnreadable > 0 ? 'error' : undefined)
        parts.dialog.close()
        return
      }
      setStatus(t('imported', counts), 'error')
      failures.replaceChildren(
        h('p', { text: t('failedHead', { n: report.failed.length }) }),
        h(
          'ul',
          {},
          report.failed.map((f) =>
            h('li', { text: t('failure', { name: f.name, reason: f.reason }) }),
          ),
        ),
      )
      const failed = new Set(report.failed.map((f) => f.name))
      checked.clear()
      candidates.forEach((c, i) => {
        if (failed.has(c.name)) checked.add(i)
      })
    } catch (error) {
      reportError(error)
    } finally {
      busy = false
      sync()
    }
  }

  source.addEventListener('change', () => void scan())
  parts.dialog.addEventListener('close', () => {
    generation++
    parts.dialog.remove()
    current = null
  })
  all.addEventListener('change', () => {
    checked.clear()
    if (all.checked) {
      for (const [i, c] of candidates.entries()) if (c.user) checked.add(i)
    }
    sync()
  })
  parts.dialog.showModal()
  source.focus()
  void scan()
}
