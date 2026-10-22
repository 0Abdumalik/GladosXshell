import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import { button, confirmDialog, modal } from '../../dialogs'
import { copyText, field, h, reportError, setFieldError, setStatus } from '../../dom'
import { ltr, messages } from '../../i18n'
import { common } from '../../i18n-common'
import { type IconName, icon } from '../../icons'
import { describeError, errorField } from '../../protocol'
import {
  activeSession,
  allSessions,
  onActive,
  onConnected,
  onEnded,
  type SessionInfo,
} from '../../sessions'
import type { BuiltinPlugin, PluginContext } from '../api'
import { BUILTIN_VERSION } from './version'

const t = messages({
  keyManager: { zh: '密钥管理', en: 'Key manager', ug: 'ئاچقۇچ باشقۇرغۇچ' },
  description: {
    zh: '生成和导入 SSH 密钥，复制公钥，一键装到当前服务器的 authorized_keys；编辑连接时可以直接从密钥库选择私钥。',
    en: 'Generate and import SSH keys, copy public keys and install them in authorized_keys on the current server in one step. When editing a connection, pick its private key straight from the key library.',
    ug: 'SSH ئاچقۇچى ھاسىل قىلىش ۋە ئەكىرىش، ئاممىۋى ئاچقۇچنى كۆچۈرۈش، بىر چېكىپلا نۆۋەتتىكى مۇلازىمېتىرنىڭ authorized_keys ھۆججىتىگە ئورنىتىش؛ ئۇلىنىشنى تەھرىرلىگەندە ئاچقۇچ ئامبىرىدىن شەخسىي ئاچقۇچنى بىۋاسىتە تاللىغىلى بولىدۇ.',
  },
  connection: { zh: '连接', en: 'Connection', ug: 'ئۇلىنىش' },
  ed25519Recommended: {
    zh: 'Ed25519（推荐）',
    en: 'Ed25519 (recommended)',
    ug: 'Ed25519 (تەۋسىيە)',
  },
  deploying: {
    zh: '正在把 {key} 的公钥装到 {server}…',
    en: 'Installing the public key of {key} on {server}…',
    ug: '{key} نىڭ ئاممىۋى ئاچقۇچى {server} غا ئورنىتىلىۋاتىدۇ…',
  },
  deployed: {
    zh: '已把 {key} 的公钥加入 {server} 的 {file}',
    en: 'Added the public key of {key} to {file} on {server}',
    ug: '{key} نىڭ ئاممىۋى ئاچقۇچى {server} دىكى {file} غا قوشۇلدى',
  },
  alreadyDeployed: {
    zh: '{server} 上已经有 {key} 的公钥，没有重复添加',
    en: '{server} already has the public key of {key}; nothing was added',
    ug: '{server} دا {key} نىڭ ئاممىۋى ئاچقۇچى ئاللىبۇرۇن بار، قايتا قوشۇلمىدى',
  },
  generateTitle: { zh: '生成密钥', en: 'Generate key', ug: 'ئاچقۇچ ھاسىل قىل' },
  generateMenu: { zh: '生成密钥…', en: 'Generate key…', ug: 'ئاچقۇچ ھاسىل قىل…' },
  generate: { zh: '生成', en: 'Generate', ug: 'ھاسىل قىل' },
  nameHelp: {
    zh: '保存在密钥库里的文件名，公钥另存为同名 {ext} 文件。',
    en: 'File name in the key library. The public key is saved next to it as a {ext} file.',
    ug: 'ئاچقۇچ ئامبىرىدا ساقلىنىدىغان ھۆججەت نامى، ئاممىۋى ئاچقۇچ ئوخشاش ناملىق {ext} ھۆججىتى قىلىپ ساقلىنىدۇ.',
  },
  comment: { zh: '备注', en: 'Comment', ug: 'ئىزاھ' },
  commentHelp: {
    zh: '写进公钥末尾，方便在服务器上认出这把钥匙，例如 {example}。',
    en: 'Added to the end of the public key so you can recognize it on the server, for example {example}.',
    ug: 'ئاممىۋى ئاچقۇچنىڭ ئاخىرىغا يېزىلىدۇ، مۇلازىمېتىردا بۇ ئاچقۇچنى تونۇۋېلىشقا قۇلايلىق، مەسىلەن {example}.',
  },
  passphrase: { zh: '口令', en: 'Passphrase', ug: 'ئىم ئىبارىسى' },
  passphraseHelp: {
    zh: '留空则不加密。有口令时，私钥文件被拿走也无法直接使用。',
    en: 'Leave empty for no encryption. With a passphrase, a stolen private key file is useless on its own.',
    ug: 'بوش قويسىڭىز شىفىرلانمايدۇ. ئىم ئىبارىسى بولسا، شەخسىي ئاچقۇچ ھۆججىتى ئوغرىلانسىمۇ بىۋاسىتە ئىشلەتكىلى بولمايدۇ.',
  },
  confirmPassphrase: {
    zh: '确认口令',
    en: 'Confirm passphrase',
    ug: 'ئىم ئىبارىسىنى جەزملە',
  },
  passphraseMismatch: {
    zh: '两次输入的口令不一致',
    en: "The passphrases don't match",
    ug: 'ئىككى قېتىم كىرگۈزگەن ئىم ئىبارىسى ئوخشاش ئەمەس',
  },
  generated: {
    zh: '已生成 {name}（{type}）',
    en: 'Generated {name} ({type})',
    ug: '{name} ({type}) ھاسىل قىلىندى',
  },
  browse: { zh: '浏览…', en: 'Browse…', ug: 'كۆز يۈگۈرت…' },
  chooseKeyFile: {
    zh: '选择私钥文件',
    en: 'Choose a private key file',
    ug: 'شەخسىي ئاچقۇچ ھۆججىتىنى تاللاڭ',
  },
  keyFileRequired: {
    zh: '请选择私钥文件',
    en: 'Choose a private key file',
    ug: 'شەخسىي ئاچقۇچ ھۆججىتىنى تاللاڭ',
  },
  importTitle: { zh: '导入私钥', en: 'Import private key', ug: 'شەخسىي ئاچقۇچ ئەكىر' },
  importMenu: { zh: '导入私钥…', en: 'Import private key…', ug: 'شەخسىي ئاچقۇچ ئەكىر…' },
  keyFile: { zh: '私钥文件', en: 'Private key file', ug: 'شەخسىي ئاچقۇچ ھۆججىتى' },
  keyFileHelp: {
    zh: '支持 OpenSSH、PEM、PKCS#8 和 PuTTY .ppk 格式。',
    en: 'Accepts OpenSSH, PEM, PKCS#8 and PuTTY .ppk formats.',
    ug: 'OpenSSH، PEM، PKCS#8 ۋە PuTTY .ppk فورماتلىرىنى قوللايدۇ.',
  },
  importPassphraseHelp: {
    zh: '私钥有口令时填写；导入后仍使用同一个口令。',
    en: 'Fill this in if the private key has a passphrase. It keeps the same passphrase after import.',
    ug: 'شەخسىي ئاچقۇچنىڭ ئىم ئىبارىسى بولسا تولدۇرۇڭ؛ ئەكىرگەندىن كېيىنمۇ ئوخشاش ئىم ئىبارىسى ئىشلىتىلىدۇ.',
  },
  imported: {
    zh: '已导入 {name}（{type}）',
    en: 'Imported {name} ({type})',
    ug: '{name} ({type}) ئەكىرىلدى',
  },
  library: { zh: '密钥库', en: 'Key library', ug: 'ئاچقۇچ ئامبىرى' },
  emptyLibrary: {
    zh: '密钥库里还没有密钥。生成一对新的，或导入已有的私钥。',
    en: 'The key library is empty. Generate a new key pair or import an existing private key.',
    ug: 'ئاچقۇچ ئامبىرىدا تېخى ئاچقۇچ يوق. يېڭى بىر جۈپ ئاچقۇچ ھاسىل قىلىڭ ياكى بار شەخسىي ئاچقۇچنى ئەكىرىڭ.',
  },
  emptyLibraryShort: {
    zh: '密钥库里还没有密钥',
    en: 'The key library is empty',
    ug: 'ئاچقۇچ ئامبىرىدا تېخى ئاچقۇچ يوق',
  },
  actionFor: { zh: '{action}：{key}', en: '{action}: {key}', ug: '{action}: {key}' },
  hasPassphrase: { zh: '有口令', en: 'Passphrase', ug: 'ئىم ئىبارىسى بار' },
  copyPublic: { zh: '复制公钥', en: 'Copy public key', ug: 'ئاممىۋى ئاچقۇچنى كۆچۈر' },
  deployTo: { zh: '装到 {server}', en: 'Install on {server}', ug: '{server} غا ئورنات' },
  deployDisabled: {
    zh: '装到服务器（需要先切换到已连接的 SSH 会话）',
    en: 'Install on server (switch to a connected SSH session first)',
    ug: 'مۇلازىمېتىرغا ئورنات (ئالدى بىلەن ئۇلانغان SSH ئەڭگىمىسىگە ئالماشتۇرۇڭ)',
  },
  target: {
    zh: '部署目标：{server}',
    en: 'Installs on: {server}',
    ug: 'ئورنىتىش نىشانى: {server}',
  },
  noTarget: {
    zh: '切换到已连接的 SSH 会话后，可以把公钥装到那台服务器',
    en: 'Switch to a connected SSH session to install public keys on that server',
    ug: 'ئۇلانغان SSH ئەڭگىمىسىگە ئالماشقاندىن كېيىن، ئاممىۋى ئاچقۇچنى شۇ مۇلازىمېتىرغا ئورنىتالايسىز',
  },
  removeTitle: { zh: '删除密钥', en: 'Delete key', ug: 'ئاچقۇچنى ئۆچۈر' },
  removeText: {
    zh: '从密钥库删除 {name} 和它的公钥文件？已经装到服务器上的公钥不受影响，但之后无法再用这把私钥登录。使用它的连接需要改选其他私钥。',
    en: 'Delete {name} and its public key file from the key library? Public keys already installed on servers stay, but you can no longer sign in with this private key. Connections that use it need another private key.',
    ug: '{name} ۋە ئۇنىڭ ئاممىۋى ئاچقۇچ ھۆججىتىنى ئاچقۇچ ئامبىرىدىن ئۆچۈرەمسىز؟ مۇلازىمېتىرلارغا ئورنىتىلغان ئاممىۋى ئاچقۇچلارغا تەسىر يەتمەيدۇ، لېكىن كېيىن بۇ شەخسىي ئاچقۇچ بىلەن كىرگىلى بولمايدۇ. ئۇنى ئىشلىتىدىغان ئۇلىنىشلار باشقا شەخسىي ئاچقۇچ تاللىشى كېرەك.',
  },
  removed: { zh: '已删除 {name}', en: 'Deleted {name}', ug: '{name} ئۆچۈرۈلدى' },
  openManager: { zh: '打开密钥管理…', en: 'Open key manager…', ug: 'ئاچقۇچ باشقۇرغۇچنى ئاچ…' },
  pickForServer: {
    zh: '选择要装到 {server} 的密钥',
    en: 'Choose a key to install on {server}',
    ug: '{server} غا ئورنىتىدىغان ئاچقۇچنى تاللاڭ',
  },
  pickPrivate: { zh: '选择私钥', en: 'Choose private key', ug: 'شەخسىي ئاچقۇچ تاللاڭ' },
  deployCurrent: {
    zh: '把公钥装到当前服务器…',
    en: 'Install public key on current server…',
    ug: 'ئاممىۋى ئاچقۇچنى نۆۋەتتىكى مۇلازىمېتىرغا ئورنات…',
  },
  deployThis: {
    zh: '把公钥装到这台服务器…',
    en: 'Install public key on this server…',
    ug: 'ئاممىۋى ئاچقۇچنى بۇ مۇلازىمېتىرغا ئورنات…',
  },
})

interface StoredKey {
  path: string
  name: string
  algorithm: string
  bits: number | null
  fingerprint: string
  comment: string
  encrypted: boolean
  public: string
}

const TYPES: { id: string; label: string; kind: string; bits: number | null; file: string }[] = [
  {
    id: 'ed25519',
    label: t('ed25519Recommended'),
    kind: 'ed25519',
    bits: null,
    file: 'id_ed25519',
  },
  { id: 'rsa3072', label: 'RSA 3072', kind: 'rsa', bits: 3072, file: 'id_rsa' },
  { id: 'rsa4096', label: 'RSA 4096', kind: 'rsa', bits: 4096, file: 'id_rsa' },
  { id: 'ecdsa256', label: 'ECDSA P-256', kind: 'ecdsa', bits: 256, file: 'id_ecdsa' },
  { id: 'ecdsa384', label: 'ECDSA P-384', kind: 'ecdsa', bits: 384, file: 'id_ecdsa' },
  { id: 'ecdsa521', label: 'ECDSA P-521', kind: 'ecdsa', bits: 521, file: 'id_ecdsa' },
]

const ALGORITHMS: Record<string, string> = {
  'ssh-ed25519': 'Ed25519',
  'ssh-rsa': 'RSA',
  'ecdsa-sha2-nistp256': 'ECDSA',
  'ecdsa-sha2-nistp384': 'ECDSA',
  'ecdsa-sha2-nistp521': 'ECDSA',
}

const liveSsh = (info: SessionInfo | null | undefined): info is SessionInfo =>
  info?.kind === 'ssh' && info.state === 'live'

// Ed25519 has one size, so its bit count says nothing.
const describe = (key: StoredKey) =>
  `${ALGORITHMS[key.algorithm] ?? key.algorithm}${key.bits && key.algorithm !== 'ssh-ed25519' ? ` ${key.bits}` : ''}`

const listKeys = () => invoke<StoredKey[]>('keys_list')

/** `base`, or `base_2`, `base_3`… if the library already has that name. */
function freeName(base: string, keys: StoredKey[]): string {
  const taken = new Set(keys.map((k) => k.name.toLowerCase()))
  if (!taken.has(base.toLowerCase())) return base
  for (let n = 2; ; n++) if (!taken.has(`${base}_${n}`.toLowerCase())) return `${base}_${n}`
}

function fileName(path: string): string {
  return path.split(/[\\/]/).pop() ?? ''
}

async function deploy(key: StoredKey, session: SessionInfo): Promise<void> {
  const params = { key: ltr(key.name), server: ltr(session.title) }
  setStatus(t('deploying', params))
  try {
    const added = await invoke<boolean>('key_deploy', { sessionId: session.id, path: key.path })
    setStatus(
      added
        ? t('deployed', { ...params, file: ltr('~/.ssh/authorized_keys') })
        : t('alreadyDeployed', params),
    )
  } catch (error) {
    reportError(error)
  }
}

function passwordInput(): HTMLInputElement {
  return h('input', { type: 'password', autocomplete: 'new-password', spellcheck: 'false' })
}

function textInput(value = ''): HTMLInputElement {
  return h('input', { type: 'text', value, autocomplete: 'off', spellcheck: 'false' })
}

/** Runs `submit` from the form's button and Enter; field errors come back keyed by input. */
function formDialog(
  name: string,
  title: string,
  fields: HTMLElement[],
  confirmLabel: string,
  submit: (done: () => void) => Promise<void>,
): HTMLDialogElement {
  const parts = modal(name, title, 'sm')
  const form = h('form', { class: 'dialog-form', novalidate: true }, fields)
  parts.body.append(form)
  const ok = button(confirmLabel, () => form.requestSubmit(), 'primary')
  let busy = false
  form.addEventListener('submit', (event) => {
    event.preventDefault()
    if (busy) return
    busy = true
    ok.disabled = true
    submit(() => parts.dialog.close()).finally(() => {
      busy = false
      ok.disabled = false
    })
  })
  parts.actions.append(
    button(common('cancel'), () => parts.dialog.close()),
    ok,
  )
  parts.dialog.addEventListener('close', () => parts.dialog.remove())
  parts.dialog.showModal()
  return parts.dialog
}

function generateDialog(keys: StoredKey[], saved: (key: StoredKey) => void): void {
  const type = h(
    'select',
    {},
    TYPES.map((option) => h('option', { value: option.id, text: option.label })),
  )
  const name = textInput(freeName(TYPES[0].file, keys))
  const comment = textInput()
  const pass = passwordInput()
  const again = passwordInput()
  let named = false
  name.addEventListener('input', () => {
    named = true
  })
  type.addEventListener('change', () => {
    const chosen = TYPES.find((option) => option.id === type.value) ?? TYPES[0]
    if (!named) name.value = freeName(chosen.file, keys)
  })
  const dialog = formDialog(
    'key-generate',
    t('generateTitle'),
    [
      field(common('type'), type),
      field(common('name'), name, t('nameHelp', { ext: ltr('.pub') })),
      field(t('comment'), comment, t('commentHelp', { example: ltr('me@laptop') })),
      field(t('passphrase'), pass, t('passphraseHelp')),
      field(t('confirmPassphrase'), again),
    ],
    t('generate'),
    async (done) => {
      setFieldError(name, '')
      setFieldError(again, pass.value === again.value ? '' : t('passphraseMismatch'))
      if (pass.value !== again.value) return
      const chosen = TYPES.find((option) => option.id === type.value) ?? TYPES[0]
      try {
        const key = await invoke<StoredKey>('key_generate', {
          name: name.value,
          kind: chosen.kind,
          bits: chosen.bits,
          comment: comment.value,
          passphrase: pass.value || null,
        })
        done()
        saved(key)
        setStatus(t('generated', { name: ltr(key.name), type: describe(key) }))
      } catch (error) {
        setFieldError(name, describeError(error))
      }
    },
  )
  dialog.addEventListener('close', () => {
    pass.value = ''
    again.value = ''
  })
  type.focus()
}

function importDialog(saved: (key: StoredKey) => void): void {
  const path = textInput()
  const name = textInput()
  const pass = passwordInput()
  const browse = button(t('browse'), async () => {
    const chosen = await open({ multiple: false, directory: false, title: t('chooseKeyFile') })
    if (typeof chosen !== 'string') return
    path.value = chosen
    name.value = fileName(chosen).replace(/\.(pem|key|ppk)$/i, '')
    setFieldError(path, '')
  })
  const dialog = formDialog(
    'key-import',
    t('importTitle'),
    [
      field(t('keyFile'), path, t('keyFileHelp'), browse),
      field(common('name'), name),
      field(t('passphrase'), pass, t('importPassphraseHelp')),
    ],
    common('import'),
    async (done) => {
      setFieldError(name, '')
      setFieldError(pass, '')
      setFieldError(path, path.value.trim() ? '' : t('keyFileRequired'))
      if (!path.value.trim()) return
      try {
        const key = await invoke<StoredKey>('key_import', {
          path: path.value.trim(),
          name: name.value,
          passphrase: pass.value || null,
        })
        done()
        saved(key)
        setStatus(t('imported', { name: ltr(key.name), type: describe(key) }))
      } catch (error) {
        const about = { name, passphrase: pass }[errorField(error) ?? ''] ?? path
        setFieldError(about, describeError(error))
      }
    },
  )
  dialog.addEventListener('close', () => {
    pass.value = ''
  })
  browse.focus()
}

let current: HTMLDialogElement | null = null
/** Redraws the open manager, whose deploy buttons depend on the active session. */
let rerender: (() => void) | null = null
let listening = false

function openManager(): void {
  if (current) {
    current.querySelector<HTMLElement>('button')?.focus()
    return
  }
  const parts = modal('keys', t('keyManager'), 'lg')
  current = parts.dialog
  let keys: StoredKey[] = []
  const list = h('ul', { class: 'key-list', role: 'list', 'aria-label': t('library') })
  const empty = h('div', { class: 'key-empty' }, h('p', { text: t('emptyLibrary') }))
  const target = h('p', { class: 'key-target', 'aria-live': 'polite' })
  parts.body.classList.add('key-manager')
  parts.body.append(
    h(
      'div',
      { class: 'key-toolbar' },
      button(t('generateMenu'), () => generateDialog(keys, added)),
      button(t('importMenu'), () => importDialog(added)),
      h('span', { class: 'grow' }),
      target,
    ),
    list,
    empty,
  )
  parts.actions.append(button(common('close'), () => parts.dialog.close()))

  const row = (key: StoredKey): HTMLElement => {
    const session = activeSession()
    const canDeploy = liveSsh(session)
    const action = (name: IconName, label: string, run: () => void, disabled = false) =>
      h(
        'button',
        {
          type: 'button',
          class: 'icon-button',
          title: label,
          'aria-label': t('actionFor', { action: label, key: ltr(key.name) }),
          disabled,
          onclick: run,
        },
        icon(name),
      )
    return h(
      'li',
      { class: 'key-item' },
      h(
        'div',
        { class: 'key-lines' },
        h(
          'div',
          { class: 'key-title' },
          icon('key'),
          h('span', { class: 'key-name', text: key.name }),
          h('span', { class: 'import-tag', text: describe(key) }),
          key.encrypted ? h('span', { class: 'import-tag', text: t('hasPassphrase') }) : null,
        ),
        h('span', { class: 'key-fingerprint num', text: key.fingerprint }),
        key.comment ? h('span', { class: 'key-comment', text: key.comment }) : null,
      ),
      h(
        'div',
        { class: 'key-actions' },
        action('copy', t('copyPublic'), () => void copyText(key.public).catch(reportError)),
        action(
          'upload-simple',
          canDeploy ? t('deployTo', { server: ltr(session.title) }) : t('deployDisabled'),
          () => {
            const now = activeSession()
            if (liveSsh(now)) void deploy(key, now)
          },
          !canDeploy,
        ),
        action('trash', common('delete'), () => void remove(key)),
      ),
    )
  }

  const render = () => {
    list.replaceChildren(...keys.map(row))
    list.hidden = keys.length === 0
    empty.hidden = keys.length > 0
    const session = activeSession()
    target.textContent = liveSsh(session)
      ? t('target', { server: ltr(session.title) })
      : t('noTarget')
  }

  const refresh = async () => {
    try {
      keys = await listKeys()
    } catch (error) {
      reportError(error)
    }
    if (current === parts.dialog) render()
  }

  const added = () => void refresh()

  const remove = async (key: StoredKey) => {
    const ok = await confirmDialog(
      t('removeTitle'),
      t('removeText', { name: ltr(key.name) }),
      common('delete'),
      true,
      true,
    )
    if (!ok) return
    try {
      await invoke('key_remove', { path: key.path })
      setStatus(t('removed', { name: ltr(key.name) }))
    } catch (error) {
      reportError(error)
    }
    await refresh()
  }

  rerender = render
  parts.dialog.addEventListener('close', () => {
    parts.dialog.remove()
    current = null
    rerender = null
  })
  render()
  parts.dialog.showModal()
  void refresh()
}

/** One key from the library, or null; offers the manager when nothing fits. */
async function pickKey(ctx: PluginContext, title: string): Promise<StoredKey | null> {
  const keys = await listKeys()
  const manage = '\u0000manage'
  const chosen = await ctx.ui.pick<StoredKey | string>(
    [
      ...keys.map((key) => ({
        label: key.name,
        icon: 'key',
        detail: `${describe(key)} · ${key.fingerprint}${key.comment ? ` · ${key.comment}` : ''}`,
        hint: key.encrypted ? t('hasPassphrase') : undefined,
        value: key,
      })),
      { label: t('openManager'), icon: 'key', value: manage },
    ],
    keys.length > 0 ? title : t('emptyLibraryShort'),
  )
  if (chosen === manage) {
    openManager()
    return null
  }
  return typeof chosen === 'object' ? chosen : null
}

async function deployPicked(ctx: PluginContext, session: SessionInfo): Promise<void> {
  try {
    const key = await pickKey(ctx, t('pickForServer', { server: ltr(session.title) }))
    if (key) await deploy(key, session)
  } catch (error) {
    reportError(error)
  }
}

export const keysPlugin: BuiltinPlugin = {
  manifest: {
    id: 'gx.keys',
    name: t('keyManager'),
    version: BUILTIN_VERSION,
    description: t('description'),
  },
  activate(ctx) {
    // Session listeners can't be removed, so they are added once and do nothing while closed.
    if (!listening) {
      listening = true
      onActive(() => rerender?.())
      onConnected(() => rerender?.())
      onEnded(() => rerender?.())
    }
    ctx.subscriptions.add(() => current?.close())
    ctx.commands.register({
      id: 'keys.manager',
      title: t('keyManager'),
      category: t('connection'),
      icon: 'key',
      run: openManager,
    })
    ctx.commands.register({
      id: 'keys.deploy',
      title: t('deployCurrent'),
      category: t('connection'),
      icon: 'upload-simple',
      enabled: () => liveSsh(activeSession()),
      run: () => {
        const session = activeSession()
        if (liveSsh(session)) return deployPicked(ctx, session)
      },
    })
    ctx.menus.contribute('terminal/context', ({ sessionId, live }) => {
      const session = allSessions().find((info) => info.id === sessionId)
      if (!live || !liveSsh(session)) return []
      return [
        {
          label: t('deployThis'),
          icon: 'key',
          action: () => void deployPicked(ctx, session),
        },
      ]
    })
    ctx.services.provide('keys', {
      pick: async () => {
        const key = await pickKey(ctx, t('pickPrivate'))
        return key ? { path: key.path, encrypted: key.encrypted } : null
      },
    })
  },
}
