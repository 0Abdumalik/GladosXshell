const { invoke } = window.__TAURI__.core
const { listen } = window.__TAURI__.event

// Interface language. The installer picks it from the system display language and hands it over
// before any script runs (`window.__GX_LANG__`), like the app does (src/i18n.ts). Every text is
// written in all three languages below; static HTML carries keys in `data-t` attributes.
const LANGS = ['zh', 'en', 'ug']
const BCP47 = { zh: 'zh-CN', en: 'en', ug: 'ug' }
const lang = LANGS.includes(window.__GX_LANG__) ? window.__GX_LANG__ : 'zh'
document.documentElement.lang = BCP47[lang]
document.documentElement.dir = lang === 'ug' ? 'rtl' : 'ltr'

const MESSAGES = {
  // Static text in index.html.
  series: { zh: 'GladosX 系列', en: 'GladosX series', ug: 'GladosX يۈرۈشلۈكى' },
  debugBuild: { zh: '调试版', en: 'Debug', ug: 'سىناق نەشرى' },
  tagline: {
    zh: 'SSH 终端 · 文件 · 端口转发',
    en: 'SSH terminal · Files · Port forwarding',
    ug: 'SSH تېرمىنالى · ھۆججەت · ئېغىز يوللاش',
  },
  minimize: { zh: '最小化', en: 'Minimize', ug: 'كىچىكلىتىش' },
  close: { zh: '关闭', en: 'Close', ug: 'تاقاش' },
  installFor: { zh: '安装给', en: 'Install for', ug: 'كىمگە ئورنىتىش' },
  allUsers: { zh: '所有用户', en: 'All users', ug: 'بارلىق ئىشلەتكۈچىلەر' },
  onlyMe: { zh: '仅当前用户', en: 'Only me', ug: 'پەقەت نۆۋەتتىكى ئىشلەتكۈچى' },
  location: { zh: '安装位置', en: 'Install location', ug: 'ئورنىتىش ئورنى' },
  change: { zh: '更改', en: 'Change', ug: 'ئۆزگەرتىش' },
  desktopShortcut: {
    zh: '创建桌面快捷方式',
    en: 'Create a desktop shortcut',
    ug: 'ئۈستەل يۈزى تېزلەتمىسى قۇرۇش',
  },
  addToStartMenu: {
    zh: '添加到开始菜单',
    en: 'Add to the Start menu',
    ug: 'باشلاش تىزىملىكىگە قوشۇش',
  },
  uninstallLead: {
    zh: '会删除程序文件、快捷方式和系统里的登记信息。',
    en: 'Deletes the program files, the shortcuts and the entry in Windows.',
    ug: 'پروگرامما ھۆججەتلىرى، تېزلەتمىلەر ۋە سىستېمىدىكى تىزىملىتىش ئۇچۇرى ئۆچۈرۈلىدۇ.',
  },
  removeData: {
    zh: '同时删除设置、连接和密钥',
    en: 'Also delete settings, connections and keys',
    ug: 'تەڭشەك، ئۇلىنىش ۋە ئاچقۇچلارنىمۇ ئۆچۈرۈش',
  },
  keepDataHint: {
    zh: '不勾选的话，重新安装后这些数据还在。',
    en: 'Leave this unchecked to keep them for a reinstall.',
    ug: 'بەلگە قويمىسىڭىز، قايتا ئورناتقاندىن كېيىنمۇ بۇ سانلىق مەلۇماتلار ساقلىنىپ قالىدۇ.',
  },
  cancel: { zh: '取消', en: 'Cancel', ug: 'ۋاز كەچ' },
  preparing: { zh: '准备中', en: 'Preparing', ug: 'تەييارلىنىۋاتىدۇ' },
  openNow: { zh: '现在打开', en: 'Open it now', ug: 'ھازىرلا ئېچىش' },
  exit: { zh: '退出', en: 'Exit', ug: 'چېكىنىش' },
  retry: { zh: '重试', en: 'Try again', ug: 'قايتا سىناش' },

  // Window and brand.
  titleInstall: { zh: '{product} 安装', en: '{product} setup', ug: '{product} نى ئورنىتىش' },
  titleUninstall: { zh: '{product} 卸载', en: 'Uninstall {product}', ug: '{product} نى ئۆچۈرۈش' },
  version: { zh: '版本 {version}', en: 'Version {version}', ug: 'نەشرى {version}' },

  // Install screen.
  install: { zh: '安装', en: 'Install', ug: 'ئورنىتىش' },
  installTitle: { zh: '安装 {product}', en: 'Install {product}', ug: '{product} نى ئورنىتىش' },
  installLead: {
    zh: '设置、连接和密钥保存在 {dir}。',
    en: 'Settings, connections and keys live in {dir}.',
    ug: 'تەڭشەك، ئۇلىنىش ۋە ئاچقۇچلار {dir} دا ساقلىنىدۇ.',
  },
  update: { zh: '更新', en: 'Update', ug: 'يېڭىلاش' },
  updateTitle: { zh: '更新到 {version}', en: 'Update to {version}', ug: '{version} گە يېڭىلاش' },
  updateLead: {
    zh: '当前是 {old}。更新只替换程序文件，设置、连接和密钥都会保留。',
    en: 'You have {old}. Updating replaces only the program files and keeps settings, connections and keys.',
    ug: 'ھازىر ئورنىتىلغىنى {old}. يېڭىلاش پەقەت پروگرامما ھۆججەتلىرىنىلا ئالماشتۇرىدۇ، تەڭشەك، ئۇلىنىش ۋە ئاچقۇچلار ساقلىنىدۇ.',
  },
  olderVersion: { zh: '旧版本', en: 'an older version', ug: 'كونا نەشرى' },
  reinstall: { zh: '重新安装', en: 'Reinstall', ug: 'قايتا ئورنىتىش' },
  reinstallTitle: {
    zh: '重新安装 {product}',
    en: 'Reinstall {product}',
    ug: '{product} نى قايتا ئورنىتىش',
  },
  reinstallLead: {
    zh: '已经装了 {version}。重新安装会覆盖程序文件，设置、连接和密钥都会保留。',
    en: '{version} is already installed. Reinstalling overwrites the program files and keeps settings, connections and keys.',
    ug: '{version} ئاللىقاچان ئورنىتىلغان. قايتا ئورنىتىش پروگرامما ھۆججەتلىرىنى قاپلايدۇ، تەڭشەك، ئۇلىنىش ۋە ئاچقۇچلار ساقلىنىدۇ.',
  },
  downgrade: { zh: '安装旧版本', en: 'Install an older version', ug: 'كونا نەشرىنى ئورنىتىش' },
  downgradeTitle: { zh: '换回 {version}', en: 'Go back to {version}', ug: '{version} گە قايتىش' },
  downgradeLead: {
    zh: '已经装了更新的 {version}。数据会保留，但新版本写下的设置不一定能被旧版本读取。',
    en: 'A newer version, {version}, is installed. Your data stays, but this older version may not read settings the newer one wrote.',
    ug: 'تېخىمۇ يېڭى نەشرى {version} ئورنىتىلغان. سانلىق مەلۇمات ساقلىنىدۇ، لېكىن يېڭى نەشرى يازغان تەڭشەكلەرنى كونا نەشرى ئوقۇيالماسلىقى مۇمكىن.',
  },
  installAnyway: { zh: '继续安装', en: 'Install anyway', ug: 'داۋاملىق ئورنىتىش' },
  scopeMachine: {
    zh: '装到 {folder}，这台电脑上的每个用户都能打开。需要管理员权限，点安装后会弹出确认。',
    en: 'Installs to {folder} so every user on this computer can open it. Needs administrator rights; Windows asks you to confirm after you click Install.',
    ug: '{folder} غا ئورنىتىلىدۇ، بۇ كومپيۇتېردىكى ھەممە ئىشلەتكۈچى ئاچالايدۇ. باشقۇرغۇچى ھوقۇقى كېرەك، «ئورنىتىش» نى چەككەندىن كېيىن جەزملەشتۈرۈش كۆزنىكى چىقىدۇ.',
  },
  scopeUser: {
    zh: '只有你能打开，不需要管理员权限。',
    en: 'Only you can open it. No administrator rights needed.',
    ug: 'پەقەت سىزلا ئاچالايسىز، باشقۇرغۇچى ھوقۇقى كېرەك ئەمەس.',
  },
  installedForAll: {
    zh: '已经为所有用户安装，更新时保持不变。',
    en: 'Installed for all users. Updating keeps it that way.',
    ug: 'بارلىق ئىشلەتكۈچىلەرگە ئورنىتىلغان، يېڭىلىغاندا ئۆزگەرمەيدۇ.',
  },
  installedForMe: {
    zh: '已经为当前用户安装，更新时保持不变。',
    en: 'Installed for the current user. Updating keeps it that way.',
    ug: 'نۆۋەتتىكى ئىشلەتكۈچىگە ئورنىتىلغان، يېڭىلىغاندا ئۆزگەرمەيدۇ.',
  },
  installedHere: {
    zh: '已经装在这里，会原地更新。',
    en: 'Already installed here. Setup updates it in place.',
    ug: 'مۇشۇ يەرگە ئورنىتىلغان، ئورنىدىلا يېڭىلىنىدۇ.',
  },
  dirRequired: {
    zh: '请填写安装位置',
    en: 'Enter an install location',
    ug: 'ئورنىتىش ئورنىنى كىرگۈزۈڭ',
  },

  // Progress.
  installing: {
    zh: '正在安装 {product}',
    en: 'Installing {product}',
    ug: '{product} ئورنىتىلىۋاتىدۇ',
  },
  updating: { zh: '正在更新 {product}', en: 'Updating {product}', ug: '{product} يېڭىلىنىۋاتىدۇ' },
  reinstalling: {
    zh: '正在重新安装 {product}',
    en: 'Reinstalling {product}',
    ug: '{product} قايتا ئورنىتىلىۋاتىدۇ',
  },
  uninstalling: {
    zh: '正在卸载 {product}',
    en: 'Uninstalling {product}',
    ug: '{product} ئۆچۈرۈلۈۋاتىدۇ',
  },
  waitingForAdmin: {
    zh: '等待管理员授权',
    en: 'Waiting for administrator approval',
    ug: 'باشقۇرغۇچى ھوقۇقىنى كۈتۈۋاتىدۇ',
  },
  progressDone: { zh: '完成', en: 'Done', ug: 'تامام' },
  // Result screens.
  finish: { zh: '完成', en: 'Finish', ug: 'تامام' },
  installDone: { zh: '安装完成', en: 'Installation complete', ug: 'ئورنىتىش تاماملاندى' },
  updateDone: { zh: '更新完成', en: 'Update complete', ug: 'يېڭىلاش تاماملاندى' },
  installedLead: {
    zh: '{product} {version} 已经装好了，{where}',
    en: '{product} {version} is installed. {where}',
    ug: '{product} {version} ئورنىتىلدى. {where}',
  },
  openFromBoth: {
    zh: '可以从桌面或开始菜单打开它。',
    en: 'Open it from the desktop or the Start menu.',
    ug: 'ئۇنى ئۈستەل يۈزى ياكى باشلاش تىزىملىكىدىن ئاچالايسىز.',
  },
  openFromDesktop: {
    zh: '可以从桌面打开它。',
    en: 'Open it from the desktop.',
    ug: 'ئۇنى ئۈستەل يۈزىدىن ئاچالايسىز.',
  },
  openFromStartMenu: {
    zh: '可以从开始菜单打开它。',
    en: 'Open it from the Start menu.',
    ug: 'ئۇنى باشلاش تىزىملىكىدىن ئاچالايسىز.',
  },
  programIn: { zh: '程序在 {dir}。', en: 'The program is in {dir}.', ug: 'پروگرامما {dir} دا.' },
  openFailed: {
    zh: '没能打开程序',
    en: 'Could not open the program',
    ug: 'پروگراممىنى ئاچقىلى بولمىدى',
  },
  installFailed: {
    zh: '安装没有完成',
    en: 'Installation did not finish',
    ug: 'ئورنىتىش تاماملانمىدى',
  },
  updateFailed: { zh: '更新没有完成', en: 'Update did not finish', ug: 'يېڭىلاش تاماملانمىدى' },
  reinstallFailed: {
    zh: '重新安装没有完成',
    en: 'Reinstall did not finish',
    ug: 'قايتا ئورنىتىش تاماملانمىدى',
  },
  downgradeFailed: {
    zh: '继续安装没有完成',
    en: 'Installation did not finish',
    ug: 'ئورنىتىش تاماملانمىدى',
  },
  contact: {
    zh: '如果反复出现，请把这段提示发给 {email}。',
    en: 'If this keeps happening, send this message to {email}.',
    ug: 'بۇ قايتا-قايتا كۆرۈلسە، بۇ ئۇچۇرنى {email} غا ئەۋەتىڭ.',
  },
  incomplete: {
    zh: '安装程序不完整',
    en: 'The installer is incomplete',
    ug: 'ئورناتقۇچ تولۇق ئەمەس',
  },
  incompleteLead: {
    zh: '这个安装程序里没有打包程序文件，请重新下载。',
    en: 'This installer has no program files packed in it. Download it again.',
    ug: 'بۇ ئورناتقۇچقا پروگرامما ھۆججەتلىرى قاچىلانمىغان، قايتا چۈشۈرۈڭ.',
  },

  // Uninstall.
  uninstall: { zh: '卸载', en: 'Uninstall', ug: 'ئۆچۈرۈش' },
  uninstallTitle: { zh: '卸载 {product}', en: 'Uninstall {product}', ug: '{product} نى ئۆچۈرۈش' },
  notInstalled: {
    zh: '没有找到已安装的程序',
    en: 'No installed copy was found',
    ug: 'ئورنىتىلغان پروگرامما تېپىلمىدى',
  },
  uninstallScopeAll: {
    zh: '为所有用户安装。',
    en: 'Installed for all users.',
    ug: 'بارلىق ئىشلەتكۈچىلەرگە ئورنىتىلغان.',
  },
  uninstallScopeAllAdmin: {
    zh: '为所有用户安装，卸载需要管理员权限。',
    en: 'Installed for all users. Uninstalling needs administrator rights.',
    ug: 'بارلىق ئىشلەتكۈچىلەرگە ئورنىتىلغان، ئۆچۈرۈش ئۈچۈن باشقۇرغۇچى ھوقۇقى كېرەك.',
  },
  removeDataWarning: {
    zh: '会永久删除保存的服务器、密码和密钥，无法恢复。',
    en: 'This deletes saved servers, passwords and keys for good. You cannot undo it.',
    ug: 'ساقلانغان مۇلازىمېتىر، ئىم ۋە ئاچقۇچلار مەڭگۈلۈك ئۆچۈرۈلىدۇ، ئەسلىگە كەلتۈرگىلى بولمايدۇ.',
  },
  uninstalled: { zh: '已卸载', en: 'Uninstalled', ug: 'ئۆچۈرۈلدى' },
  removedLead: {
    zh: '{product} 已经从这台电脑上移除。{kept}',
    en: 'Removed {product} from this computer. {kept}',
    ug: '{product} بۇ كومپيۇتېردىن ئۆچۈرۈلدى. {kept}',
  },
  dataKept: {
    zh: '设置和连接还保留着，重新安装后可以接着用。',
    en: 'Your settings and connections stay for when you reinstall.',
    ug: 'تەڭشەك ۋە ئۇلىنىشلار ساقلىنىپ قالدى، قايتا ئورناتقاندىن كېيىن داۋاملىق ئىشلىتەلەيسىز.',
  },
  notDeleted: {
    zh: '没能删除 {path}: {error}',
    en: 'Could not delete {path}: {error}',
    ug: '{path} نى ئۆچۈرگىلى بولمىدى: {error}',
  },
  uninstallFailed: {
    zh: '卸载没有完成',
    en: 'Uninstall did not finish',
    ug: 'ئۆچۈرۈش تاماملانمىدى',
  },
}

const PLACEHOLDER = /\{(\w+)\}/g

/** The text of `key` in the interface language, with `{name}` placeholders filled from `params`. */
function t(key, params = {}) {
  return MESSAGES[key][lang].replace(PLACEHOLDER, (m, name) =>
    Object.hasOwn(params, name) ? String(params[name]) : m,
  )
}

const LRI = String.fromCodePoint(0x2066)
const PDI = String.fromCodePoint(0x2069)

/** Keeps a path, version or address in one piece inside right-to-left text. */
function ltr(text) {
  return lang === 'ug' && text ? `${LRI}${text}${PDI}` : text
}

const percentFormat = new Intl.NumberFormat(BCP47[lang], {
  style: 'percent',
  maximumFractionDigits: 0,
})

/** `data-t="key"` sets the text; `data-t-aria-label="key"` (any attribute after `data-t-`) sets it. */
function fillStatic() {
  for (const element of document.querySelectorAll('*')) {
    for (const { name, value } of [...element.attributes]) {
      if (name === 'data-t') element.textContent = t(value)
      else if (name.startsWith('data-t-')) element.setAttribute(name.slice(7), t(value))
    }
  }
}

const $ = (id) => document.getElementById(id)
const screens = ['install', 'uninstall', 'progress', 'done', 'error']

let info
let retry = () => {}
let shown = false

function show(name) {
  for (const screen of screens) $(`screen-${screen}`).hidden = screen !== name
  // The first screen leaves focus alone so the window does not open with a focus ring.
  if (shown) {
    const target = $(`screen-${name}`).querySelector('.button.primary, .button.danger')
    target?.focus({ preventScroll: true })
  }
  shown = true
}

function setBusy(busy) {
  $('close').disabled = busy
}

// Semver order: 0.1.0 < 0.1.1-beta < 0.1.1.
function compareVersions(a, b) {
  const [coreA, preA = ''] = a.split(/-(.*)/)
  const [coreB, preB = ''] = b.split(/-(.*)/)
  const pa = coreA.split('.').map(Number)
  const pb = coreB.split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0)
    if (diff !== 0) return Math.sign(diff)
  }
  if (preA === preB) return 0
  if (!preA) return 1
  if (!preB) return -1
  return preA < preB ? -1 : 1
}

function displayVersion(version) {
  return version.replace(
    /-([a-z]+)(.*)$/i,
    (_, tag, rest) => ` ${tag[0].toUpperCase()}${tag.slice(1)}${rest}`,
  )
}

function setProgress(value, label) {
  const clamped = Math.min(1, Math.max(0, value))
  const percent = Math.round(clamped * 100)
  $('progress-fill').style.transform = `scaleX(${clamped})`
  $('progress').setAttribute('aria-valuenow', String(percent))
  $('progress-percent').textContent = percentFormat.format(percent / 100)
  if (label) $('progress-label').textContent = label
}

function startProgress(eyebrow, title) {
  $('progress-eyebrow').textContent = eyebrow
  $('progress-title').textContent = title
  $('progress').classList.remove('danger')
  setProgress(0, t('preparing'))
  show('progress')
  setBusy(true)
}

function showError(title, message, again) {
  setBusy(false)
  $('error-title').textContent = title
  $('error-message').textContent = message
  $('error-contact').textContent = t('contact', { email: ltr(info.email) })
  $('error-back').hidden = !again
  retry = again || (() => {})
  show('error')
}

function showDone({ title, lead, warnings = [], launch }) {
  setBusy(false)
  $('done-title').textContent = title
  $('done-lead').textContent = lead
  const list = $('done-warnings')
  list.replaceChildren(
    ...warnings.map((text) => {
      const item = document.createElement('li')
      item.textContent = text
      return item
    }),
  )
  list.hidden = warnings.length === 0
  $('launch-row').hidden = !launch
  $('finish').textContent = launch ? t('finish') : t('close')
  show('done')
}

const scopeHints = {
  machine: () => t('scopeMachine', { folder: ltr('Program Files') }),
  user: () => t('scopeUser'),
}

function selectedScope() {
  return document.querySelector('input[name="scope"]:checked')?.value ?? 'user'
}

/** A version as the page shows it, kept in one piece in Uyghur. */
const shownVersion = (version) => ltr(displayVersion(version))

/** The texts of the install screen and what follows it, by what installing will do. */
function describeInstall() {
  const { product, version, existing } = info
  if (!existing) {
    return {
      kind: 'install',
      eyebrow: t('install'),
      title: t('installTitle', { product }),
      lead: t('installLead', { dir: ltr(info.dataDir) }),
      action: t('install'),
      working: t('installing', { product }),
      failed: t('installFailed'),
    }
  }
  const order = existing.version ? compareVersions(version, existing.version) : 1
  if (order > 0) {
    const old = existing.version ? shownVersion(existing.version) : t('olderVersion')
    return {
      kind: 'update',
      eyebrow: t('update'),
      title: t('updateTitle', { version: shownVersion(version) }),
      lead: t('updateLead', { old }),
      action: t('update'),
      working: t('updating', { product }),
      failed: t('updateFailed'),
    }
  }
  if (order === 0) {
    return {
      kind: 'reinstall',
      eyebrow: t('reinstall'),
      title: t('reinstallTitle', { product }),
      lead: t('reinstallLead', { version: shownVersion(version) }),
      action: t('reinstall'),
      working: t('reinstalling', { product }),
      failed: t('reinstallFailed'),
    }
  }
  return {
    kind: 'downgrade',
    eyebrow: t('downgrade'),
    title: t('downgradeTitle', { version: shownVersion(version) }),
    lead: t('downgradeLead', { version: shownVersion(existing.version) }),
    action: t('installAnyway'),
    working: t('installing', { product }),
    failed: t('downgradeFailed'),
  }
}

function setUpInstall() {
  const text = describeInstall()
  $('install-eyebrow').textContent = text.eyebrow
  $('install-title').textContent = text.title
  $('install-lead').textContent = text.lead
  $('install').textContent = text.action

  const dir = $('dir')
  const existing = info.existing
  const radios = document.querySelectorAll('input[name="scope"]')
  const applyScope = (scope) => {
    $('scope-hint').textContent = existing
      ? t(scope === 'machine' ? 'installedForAll' : 'installedForMe')
      : scopeHints[scope]()
    // A folder the user typed or picked stays; only the default follows the choice.
    const defaults = Object.values(info.defaultDirs)
    if (!existing && (!dir.value || defaults.includes(dir.value))) {
      dir.value = info.defaultDirs[scope]
    }
  }
  const initial = existing ? existing.scope : info.elevated ? 'machine' : 'user'
  for (const radio of radios) {
    radio.checked = radio.value === initial
    radio.disabled = Boolean(existing)
    radio.addEventListener('change', () => applyScope(radio.value))
  }
  dir.value = existing ? existing.dir : ''
  applyScope(initial)
  dir.disabled = Boolean(existing)
  $('pick').hidden = Boolean(existing)
  $('dir-hint').textContent = existing ? t('installedHere') : ''

  $('pick').addEventListener('click', async () => {
    const picked = await invoke('pick_dir', { current: dir.value })
    if (picked) {
      dir.value = picked
      $('dir-hint').textContent = ''
    }
  })
  dir.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') runInstall()
  })
  $('install').addEventListener('click', runInstall)
  show('install')
}

async function runInstall() {
  const dir = $('dir').value.trim()
  const hint = $('dir-hint')
  if (!dir) {
    hint.textContent = t('dirRequired')
    hint.classList.add('danger-text')
    $('dir').focus()
    return
  }
  hint.classList.remove('danger-text')
  const desktop = $('desktop').checked
  const startMenu = $('start-menu').checked
  const scope = selectedScope()
  const text = describeInstall()
  startProgress(text.eyebrow, text.working)
  if (scope === 'machine' && !info.elevated) setProgress(0, t('waitingForAdmin'))
  try {
    const handedOff = await invoke('install', { scope, dir, desktop, startMenu })
    if (handedOff) {
      invoke('quit')
      return
    }
    setProgress(1, t('progressDone'))
    let where = t('programIn', { dir: ltr(dir) })
    if (desktop && startMenu) where = t('openFromBoth')
    else if (desktop) where = t('openFromDesktop')
    else if (startMenu) where = t('openFromStartMenu')
    $('finish').onclick = async () => {
      if ($('launch').checked) {
        try {
          await invoke('launch_app', { dir })
        } catch (err) {
          showError(t('openFailed'), String(err), null)
          return
        }
      }
      invoke('quit')
    }
    showDone({
      title: text.kind === 'update' ? t('updateDone') : t('installDone'),
      lead: t('installedLead', {
        product: info.product,
        version: shownVersion(info.version),
        where,
      }),
      launch: true,
    })
  } catch (err) {
    showError(text.failed, String(err), runInstall)
  }
}

function setUpUninstall() {
  $('uninstall-title').textContent = t('uninstallTitle', { product: info.product })
  const found = info.existing
  $('uninstall-dir').textContent = found ? found.dir : t('notInstalled')
  $('uninstall-scope').textContent =
    found?.scope === 'machine'
      ? t(info.elevated ? 'uninstallScopeAll' : 'uninstallScopeAllAdmin')
      : ''
  $('uninstall').disabled = !found

  const hint = $('remove-data-hint')
  $('remove-data').addEventListener('change', (event) => {
    const removing = event.target.checked
    hint.textContent = removing ? t('removeDataWarning') : t('keepDataHint')
    hint.classList.toggle('danger-text', removing)
  })
  $('uninstall-cancel').addEventListener('click', () => invoke('quit'))
  $('uninstall').addEventListener('click', runUninstall)
  show('uninstall')
}

async function runUninstall() {
  const removeData = $('remove-data').checked
  startProgress(t('uninstall'), t('uninstalling', { product: info.product }))
  $('progress').classList.add('danger')
  if (info.existing?.scope === 'machine' && !info.elevated) {
    setProgress(0, t('waitingForAdmin'))
  }
  try {
    const { elevated, warnings } = await invoke('uninstall', { removeData })
    if (elevated) {
      invoke('quit')
      return
    }
    setProgress(1, t('progressDone'))
    $('finish').onclick = () => invoke('quit')
    const kept = removeData ? '' : t('dataKept')
    showDone({
      title: t('uninstalled'),
      lead: t('removedLead', { product: info.product, kept }).trim(),
      warnings: warnings.map((w) => t('notDeleted', { path: ltr(w.path), error: w.error })),
      launch: false,
    })
  } catch (err) {
    showError(t('uninstallFailed'), String(err), runUninstall)
  }
}

async function start() {
  info = await invoke('setup_info')
  $('brand-version').textContent = t('version', { version: shownVersion(info.version) })
  $('brand-channel').hidden = info.channel !== 'debug'
  const title = info.mode === 'uninstall' ? 'titleUninstall' : 'titleInstall'
  document.title = t(title, { product: info.product })

  $('minimize').addEventListener('click', () => invoke('minimize'))
  $('close').addEventListener('click', () => invoke('quit'))
  $('error-quit').addEventListener('click', () => invoke('quit'))
  $('error-back').addEventListener('click', () => retry())
  await listen('progress', (event) => setProgress(event.payload.value, event.payload.label))

  // `auto` carries the choices of the window that restarted this one as administrator.
  const auto = info.auto
  if (info.mode === 'uninstall') {
    setUpUninstall()
    if (auto && info.existing) {
      $('remove-data').checked = auto.removeData
      runUninstall()
    }
  } else if (!info.payload) {
    showError(t('incomplete'), t('incompleteLead'), null)
  } else {
    setUpInstall()
    if (auto) {
      for (const radio of document.querySelectorAll('input[name="scope"]')) {
        if (!info.existing) radio.checked = radio.value === auto.scope
      }
      if (auto.dir && !info.existing) $('dir').value = auto.dir
      $('desktop').checked = auto.desktop
      $('start-menu').checked = auto.startMenu
      runInstall()
    }
  }
  await invoke('ready')
}

fillStatic()
start()
