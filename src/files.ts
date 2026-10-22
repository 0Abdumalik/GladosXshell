import { invoke } from '@tauri-apps/api/core'
import { getCurrentWebview } from '@tauri-apps/api/webview'
import { open } from '@tauri-apps/plugin-dialog'
import { button, confirmDialog, modal, promptDialog } from './dialogs'
import { copyText, field, h, reportError, setFieldError, setStatus } from './dom'
import { openDownloads } from './download-manager'
import { closeEditsFor, editExternal, externalEdits, isImage, previewImage } from './editor'
import { entryIcon, treeIcons } from './file-icons'
import {
  baseName,
  filterEntries,
  groupLabel,
  isDir,
  kindLabel,
  ownerLabel,
  type SortKey,
  sortEntries,
  visibleEntries,
} from './file-list'
import {
  bitsToMode,
  formatBytes,
  formatOctal,
  formatTime,
  joinRemote,
  modeToBits,
  parentDir,
  parseOctal,
  validRemoteName,
} from './format'
import { isRtl, ltr, messages, pl } from './i18n'
import { common } from './i18n-common'
import { type IconName, icon } from './icons'
import type { PanelHost } from './layout'
import { type MenuItem, showMenu, showMenuFor } from './menu'
import { menuItems, service } from './plugins/registry'
import { describeError, type Entry } from './protocol'
import { activeSession, onActive, onEnded, type SessionInfo } from './sessions'
import {
  COLUMN_WIDTH_LIMITS,
  clampColumnWidth,
  DEFAULT_FILE_COLUMNS,
  type EditorMode,
  FILE_COLUMN_NAMES,
  type FileColumn,
  type FileColumnId,
  moveColumn,
  resizeColumn,
  toggleColumn,
} from './settings-model'
import { onSettings, settings, updateSettings } from './settings-store'
import { transferQueue } from './transfers'

const t = messages({
  owner: { zh: '所有者', en: 'Owner', ug: 'ئىگىسى' },
  group: { zh: '用户组', en: 'Group', ug: 'گۇرۇپپا' },
  others: { zh: '其他', en: 'Others', ug: 'باشقىلار' },
  read: { zh: '读', en: 'Read', ug: 'ئوقۇش' },
  write: { zh: '写', en: 'Write', ug: 'يېزىش' },
  execute: { zh: '执行', en: 'Execute', ug: 'ئىجرا قىلىش' },
  permBox: {
    zh: '{who} {what}',
    en: (p) => `${p.who} ${String(p.what).toLowerCase()}`,
    ug: '{who} {what}',
  },
  deleteOne: {
    zh: '从服务器上删除 {path}？',
    en: 'Delete {path} from the server?',
    ug: '{path} نى مۇلازىمېتىردىن ئۆچۈرەمسىز؟',
  },
  deleteMany: {
    zh: '从服务器上删除 这 {n} 项：\n{names}？',
    en: (p) => `Delete these ${pl('item')(p)} from the server?\n${p.names}`,
    ug: 'بۇ {n} تۈرنى مۇلازىمېتىردىن ئۆچۈرەمسىز؟\n{names}',
  },
  folderContents: {
    zh: '文件夹里的内容会一起删除。',
    en: 'Folders are deleted with everything in them.',
    ug: 'قىسقۇچ ئىچىدىكى مەزمۇنلارمۇ بىللە ئۆچۈرۈلىدۇ.',
  },
  quickOne: {
    zh: '在服务器上执行 rm -rf 删除 {path}？',
    en: 'Delete {path} on the server with rm -rf?',
    ug: '{path} نى مۇلازىمېتىردا rm -rf بىلەن ئۆچۈرەمسىز؟',
  },
  quickMany: {
    zh: '在服务器上执行 rm -rf 删除 这 {n} 项：\n{names}？',
    en: (p) => `Delete these ${pl('item')(p)} on the server with rm -rf?\n${p.names}`,
    ug: 'بۇ {n} تۈرنى مۇلازىمېتىردا rm -rf بىلەن ئۆچۈرەمسىز؟\n{names}',
  },
  quickNote: {
    zh: '文件夹会连同内容一起删除，比逐个删除快得多，但中途无法取消。符号链接只删链接本身。',
    en: "Folders are deleted with everything in them. This is much faster than deleting one by one, but it can't be stopped once started. Symbolic links are removed, not what they point to.",
    ug: 'قىسقۇچلار ئىچىدىكى مەزمۇنلار بىلەن بىللە ئۆچۈرۈلىدۇ. بىر-بىرلەپ ئۆچۈرگەندىن خېلى تېز، ئەمما باشلانغاندىن كېيىن توختاتقىلى بولمايدۇ. بەلگە ئۇلانمىسى بولسا پەقەت ئۇلانمىنىڭ ئۆزىلا ئۆچۈرۈلىدۇ.',
  },
  confirmAgain: {
    zh: '再次确认删除',
    en: 'Confirm deletion again',
    ug: 'ئۆچۈرۈشنى قايتا جەزملەش',
  },
  noUndo: {
    zh: '删除后无法恢复，服务器上没有回收站。确定继续吗？',
    en: "Deleted items can't be recovered; the server has no recycle bin. Continue?",
    ug: 'ئۆچۈرۈلگەندىن كېيىن ئەسلىگە كەلتۈرگىلى بولمايدۇ، مۇلازىمېتىردا ئەخلەت چېلىكى يوق. داۋاملاشتۇرامسىز؟',
  },
  confirmDelete: { zh: '确定删除', en: 'Yes, delete', ug: 'ھەئە، ئۆچۈر' },
  badName: {
    zh: '名称不能为空，不能包含 /，也不能是 . 或 ..',
    en: "A name can't be empty, contain /, or be . or ..",
    ug: 'ئات بوش قالمىسۇن، / بەلگىسى بولمىسۇن، . ياكى .. بولمىسۇن',
  },
  noSession: {
    zh: '连接服务器后，这里会显示它的文件。',
    en: 'Connect to a server to see its files here.',
    ug: 'مۇلازىمېتىرغا ئۇلانغاندىن كېيىن ئۇنىڭ ھۆججەتلىرى بۇ يەردە كۆرۈنىدۇ.',
  },
  localTerminal: {
    zh: '本地终端没有远程文件。',
    en: 'A local terminal has no remote files.',
    ug: 'يەرلىك تېرمىنالنىڭ يىراقتىكى ھۆججىتى يوق.',
  },
  connecting: { zh: '正在连接…', en: 'Connecting…', ug: 'ئۇلاۋاتىدۇ…' },
  disconnected: { zh: '会话已断开。', en: 'Session disconnected.', ug: 'ئەڭگىمە ئۈزۈلدى.' },
  chmodTitle: {
    zh: '修改权限：{name}',
    en: 'Change permissions: {name}',
    ug: 'ھوقۇق ئۆزگەرتىش: {name}',
  },
  octal: { zh: '八进制', en: 'Octal', ug: 'سەككىزلىك' },
  octalHelp: {
    zh: '例如 644、755；四位时首位是 setuid / setgid / sticky。',
    en: 'For example 644 or 755. With four digits, the first is setuid / setgid / sticky.',
    ug: 'مەسىلەن 644، 755؛ تۆت خانىلىق بولسا بىرىنچى خانىسى setuid / setgid / sticky بولىدۇ.',
  },
  recursive: {
    zh: '同时应用到文件夹里的所有内容',
    en: 'Also apply to everything in the folder',
    ug: 'قىسقۇچ ئىچىدىكى بارلىق مەزمۇنغىمۇ قوللان',
  },
  apply: { zh: '应用', en: 'Apply', ug: 'قوللان' },
  octalError: {
    zh: '请输入 3 或 4 位八进制数字（0–7）。',
    en: 'Enter 3 or 4 octal digits (0–7).',
    ug: '3 ياكى 4 خانىلىق سەككىزلىك سان (0–7) كىرگۈزۈڭ.',
  },
  chmodDone: {
    zh: '已把 {name} 的权限改为 {mode}',
    en: 'Changed the permissions of {name} to {mode}',
    ug: '{name} نىڭ ھوقۇقى ئۆزگەرتىلدى: {mode}',
  },
  remotePath: { zh: '远程路径', en: 'Remote path', ug: 'يىراقتىكى يول' },
  filter: { zh: '筛选', en: 'Filter', ug: 'سۈزگۈچ' },
  filterLabel: {
    zh: '按名称筛选当前目录，可用 * 和 ?',
    en: 'Filter this folder by name; * and ? work',
    ug: 'نۆۋەتتىكى قىسقۇچنى ئات بويىچە سۈز، * ۋە ? نى ئىشلەتكىلى بولىدۇ',
  },
  filterTitle: {
    zh: '按名称筛选当前目录，可用 * 和 ? 通配',
    en: 'Filter this folder by name; use * and ? as wildcards',
    ug: 'نۆۋەتتىكى قىسقۇچنى ئات بويىچە سۈز، * ۋە ? نى ئورتاق بەلگە قىلىپ ئىشلەتكىلى بولىدۇ',
  },
  up: {
    zh: '上级目录（Backspace）',
    en: 'Parent folder (Backspace)',
    ug: 'ئۈستۈنكى قىسقۇچ (Backspace)',
  },
  home: { zh: '主目录', en: 'Home folder', ug: 'ماكان قىسقۇچ' },
  uploadHere: { zh: '上传到当前目录', en: 'Upload to this folder', ug: 'نۆۋەتتىكى قىسقۇچقا يۈكلە' },
  newItem: { zh: '新建文件或文件夹', en: 'New file or folder', ug: 'يېڭى ھۆججەت ياكى قىسقۇچ' },
  showHidden: { zh: '显示隐藏文件', en: 'Show hidden files', ug: 'يوشۇرۇن ھۆججەتلەرنى كۆرسەت' },
  columns: {
    zh: '列：显示、顺序和宽度',
    en: 'Columns: visibility, order and width',
    ug: 'ئىستونلار: كۆرسىتىش، تەرتىپ ۋە كەڭلىك',
  },
  records: {
    zh: '下载记录：本标签的下载、预览和编辑副本',
    en: 'Download records: downloads, previews and edit copies from this tab',
    ug: 'چۈشۈرۈش خاتىرىسى: بۇ بەتكۈچنىڭ چۈشۈرۈش، ئالدىن كۆرۈش ۋە تەھرىرلەش نۇسخىلىرى',
  },
  remoteFiles: { zh: '远程文件', en: 'Remote files', ug: 'يىراقتىكى ھۆججەتلەر' },
  columnWidth: {
    zh: '「{name}」列宽，←→ 调整',
    en: '{name} column width; use ← → to adjust',
    ug: '«{name}» ئىستون كەڭلىكى، ← → بىلەن تەڭشەڭ',
  },
  resizeTitle: {
    zh: '拖动调整列宽，双击恢复默认',
    en: 'Drag to resize; double-click to reset',
    ug: 'سۆرەپ كەڭلىكىنى تەڭشەڭ، قوش چېكىپ ئەسلىگە قايتۇرۇڭ',
  },
  // Columns run right to left in Uyghur, so moving a column earlier moves it right there.
  moveEarlier: { zh: '「{name}」左移', en: 'Move {name} left', ug: '«{name}» نى ئوڭغا يۆتكە' },
  moveLater: { zh: '「{name}」右移', en: 'Move {name} right', ug: '«{name}» نى سولغا يۆتكە' },
  resetColumns: { zh: '恢复默认列', en: 'Reset columns', ug: 'ئىستونلارنى ئەسلىگە قايتۇر' },
  emptyFolder: {
    zh: '这个目录是空的。可以把文件拖到这里上传。',
    en: 'This folder is empty. Drag files here to upload them.',
    ug: 'بۇ قىسقۇچ قۇرۇق. ھۆججەتلەرنى بۇ يەرگە سۆرەپ يۈكلىيەلەيسىز.',
  },
  noMatch: {
    zh: '没有名称匹配「{filter}」的项目。',
    en: 'No items match “{filter}”.',
    ug: 'ماس كېلىدىغان تۈر يوق: «{filter}».',
  },
  dropHere: {
    zh: '松开即上传到当前目录',
    en: 'Drop to upload to this folder',
    ug: 'قويۇپ بەرسىڭىز نۆۋەتتىكى قىسقۇچقا يۈكلىنىدۇ',
  },
  tree: { zh: '目录树', en: 'Folder tree', ug: 'قىسقۇچ دەرىخى' },
  panelCantOpen: {
    zh: '文件面板无法打开 {path}：{error}',
    en: "The Files panel can't open {path}: {error}",
    ug: 'ھۆججەت تاختىسى {path} نى ئاچالمىدى: {error}',
  },
  cantOpen: {
    zh: '无法打开 {path}：{error}',
    en: "Can't open {path}: {error}",
    ug: '{path} نى ئاچالمىدى: {error}',
  },
  openedHome: {
    zh: '{error}，已改为打开主目录。',
    en: '{error}. Opened the home folder instead.',
    ug: '{error}، ئۇنىڭ ئورنىغا ماكان قىسقۇچ ئېچىلدى.',
  },
  cantReadHome: {
    zh: '无法读取主目录：{error}',
    en: "Can't read the home folder: {error}",
    ug: 'ماكان قىسقۇچنى ئوقۇيالمىدى: {error}',
  },
  openWithTitle: {
    zh: '选择用来打开 {name} 的程序',
    en: 'Choose a program to open {name}',
    ug: '{name} نى ئاچىدىغان پروگراممىنى تاللاڭ',
  },
  programs: { zh: '程序', en: 'Programs', ug: 'پروگراممىلار' },
  special: {
    zh: '{name} 是特殊文件，不能打开。',
    en: "{name} is a special file and can't be opened.",
    ug: '{name} ئالاھىدە ھۆججەت، ئاچقىلى بولمايدۇ.',
  },
  downloadTo: {
    zh: '选择下载位置',
    en: 'Choose a download location',
    ug: 'چۈشۈرۈش ئورنىنى تاللاڭ',
  },
  pickFolder: {
    zh: '选择要上传的文件夹',
    en: 'Choose a folder to upload',
    ug: 'يۈكلەيدىغان قىسقۇچنى تاللاڭ',
  },
  pickFiles: {
    zh: '选择要上传的文件',
    en: 'Choose files to upload',
    ug: 'يۈكلەيدىغان ھۆججەتلەرنى تاللاڭ',
  },
  newFolder: { zh: '新建文件夹', en: 'New folder', ug: 'يېڭى قىسقۇچ' },
  newFile: { zh: '新建文件', en: 'New file', ug: 'يېڭى ھۆججەت' },
  folderName: { zh: '文件夹名称', en: 'Folder name', ug: 'قىسقۇچ ئاتى' },
  fileName: { zh: '文件名称', en: 'File name', ug: 'ھۆججەت ئاتى' },
  defaultFile: { zh: '新建文件.txt', en: 'New file.txt', ug: 'يېڭى ھۆججەت.txt' },
  newName: { zh: '新名称', en: 'New name', ug: 'يېڭى ئات' },
  deletedOne: { zh: '已删除 {name}', en: 'Deleted {name}', ug: '{name} ئۆچۈرۈلدى' },
  deletedMany: {
    zh: '已删除 {n} 项',
    en: (p) => `Deleted ${pl('item')(p)}`,
    ug: '{n} تۈر ئۆچۈرۈلدى',
  },
  quickDeleteTitle: { zh: '快速删除', en: 'Quick delete', ug: 'تېز ئۆچۈرۈش' },
  packingOne: {
    zh: '正在服务器上打包 {name}…',
    en: 'Packing {name} on the server…',
    ug: '{name} مۇلازىمېتىردا بوغچىلىنىۋاتىدۇ…',
  },
  packingMany: {
    zh: '正在服务器上打包 {n} 项…',
    en: (p) => `Packing ${pl('item')(p)} on the server…`,
    ug: '{n} تۈر مۇلازىمېتىردا بوغچىلىنىۋاتىدۇ…',
  },
  packed: {
    zh: '已打包为 {name}，开始下载',
    en: 'Packed as {name}; downloading',
    ug: '{name} قىلىپ بوغچىلاندى، چۈشۈرۈش باشلاندى',
  },
  packCleanup: {
    zh: '服务器上的临时打包文件没能清理：{dir}',
    en: "Couldn't clean up the temporary archive on the server: {dir}",
    ug: 'مۇلازىمېتىردىكى ۋاقىتلىق بوغچىنى تازىلىيالمىدى: {dir}',
  },
  uploadFiles: { zh: '上传文件…', en: 'Upload files…', ug: 'ھۆججەت يۈكلە…' },
  uploadFolder: { zh: '上传文件夹…', en: 'Upload folder…', ug: 'قىسقۇچ يۈكلە…' },
  newFileMenu: { zh: '新建文件…', en: 'New file…', ug: 'يېڭى ھۆججەت…' },
  newFolderMenu: { zh: '新建文件夹…', en: 'New folder…', ug: 'يېڭى قىسقۇچ…' },
  copyCwd: { zh: '复制当前路径', en: 'Copy current path', ug: 'نۆۋەتتىكى يولنى كۆچۈر' },
  openInternal: {
    zh: '内置打开',
    en: 'Open in built-in editor',
    ug: 'ئىچكى تەھرىرلىگۈچتە ئاچ',
  },
  openExternal: { zh: '外部打开', en: 'Open externally', ug: 'سىرتقى پروگراممىدا ئاچ' },
  openWith: { zh: '指定程序打开…', en: 'Open with…', ug: 'پروگرامما تاللاپ ئاچ…' },
  previewImage: { zh: '预览图片', en: 'Preview image', ug: 'رەسىمنى ئالدىن كۆر' },
  downloadMany: {
    zh: '下载 {n} 项',
    en: (p) => `Download ${pl('item')(p)}`,
    ug: '{n} تۈرنى چۈشۈر',
  },
  downloadToMenu: { zh: '下载到…', en: 'Download to…', ug: 'تاللانغان ئورۇنغا چۈشۈر…' },
  downloadManyTo: {
    zh: '下载 {n} 项到…',
    en: (p) => `Download ${pl('item')(p)} to…`,
    ug: '{n} تۈرنى تاللانغان ئورۇنغا چۈشۈر…',
  },
  packDownload: {
    zh: '打包下载（tar.gz）',
    en: 'Download as archive (tar.gz)',
    ug: 'بوغچىلاپ چۈشۈر (tar.gz)',
  },
  packDownloadMany: {
    zh: '打包下载 {n} 项（tar.gz）',
    en: (p) => `Download ${pl('item')(p)} as archive (tar.gz)`,
    ug: '{n} تۈرنى بوغچىلاپ چۈشۈر (tar.gz)',
  },
  renameMenu: { zh: '重命名…', en: 'Rename…', ug: 'ئات ئۆزگەرت…' },
  chmodMenu: { zh: '修改权限…', en: 'Change permissions…', ug: 'ھوقۇق ئۆزگەرت…' },
  copyPath: { zh: '复制路径', en: 'Copy path', ug: 'يولنى كۆچۈر' },
  deleteMenu: { zh: '删除…', en: 'Delete…', ug: 'ئۆچۈر…' },
  deleteManyMenu: {
    zh: '删除 {n} 项…',
    en: (p) => `Delete ${pl('item')(p)}…`,
    ug: '{n} تۈرنى ئۆچۈر…',
  },
  quickDelete: {
    zh: '快速删除（rm -rf）…',
    en: 'Quick delete (rm -rf)…',
    ug: 'تېز ئۆچۈر (rm -rf)…',
  },
  quickDeleteMany: {
    zh: '快速删除 {n} 项（rm -rf）…',
    en: (p) => `Quick delete ${pl('item')(p)} (rm -rf)…`,
    ug: '{n} تۈرنى تېز ئۆچۈر (rm -rf)…',
  },
  fold: { zh: '折叠', en: 'Collapse', ug: 'يىغ' },
})

interface TreeNode {
  /** Sub-folders once listed; null until then. */
  dirs: Entry[] | null
  expanded: boolean
  loading: boolean
  error: string | null
}

interface Place {
  sessionId: number
  cwd: string | null
  entries: Entry[]
  error: string | null
  loading: boolean
  token: number
  selected: Set<string>
  anchor: string | null
  focus: string | null
  filter: string
  tree: Map<string, TreeNode>
  treeFocus: string | null
}

interface LoadOptions {
  /** Keep the selection (minus vanished entries) instead of clearing it. */
  keep?: boolean
  /** Select and focus this path once listed. */
  select?: string
  /** On failure keep the current listing and say so in the status line, not in the panel. */
  quiet?: boolean
}

const NUMERIC_COLUMNS = new Set<FileColumnId>(['size', 'mtime'])
const RESIZE_STEP = 8

function cell(id: FileColumnId, entry: Entry): HTMLTableCellElement {
  switch (id) {
    case 'name':
      return h(
        'td',
        { class: 'files-name' },
        entryIcon(entry),
        h('span', { class: 'cell-text', text: entry.name }),
      )
    case 'size':
      return h('td', { class: 'num', text: isDir(entry) ? '' : ltr(formatBytes(entry.size)) })
    case 'kind':
      return h('td', { class: 'cell-text', text: kindLabel(entry) })
    case 'mtime':
      return h('td', { class: 'num', text: formatTime(entry.mtime) })
    case 'perms':
      return h('td', { class: 'mono', text: entry.perms, title: formatOctal(entry.mode) })
    case 'owner':
      return h('td', { class: 'cell-text', text: ownerLabel(entry) })
    case 'group':
      return h('td', { class: 'cell-text', text: groupLabel(entry) })
  }
}

const saveColumns = (change: (columns: FileColumn[]) => FileColumn[]) =>
  updateSettings((draft) => {
    draft.files.columns = change(draft.files.columns)
  }).catch(report)

const PERM_ROWS = [t('owner'), t('group'), t('others')]
const PERM_COLS = [t('read'), t('write'), t('execute')]

const PROGRAMS = ['exe', 'com', 'bat', 'cmd']

const report = reportError
const treeMode = () => settings().files.view === 'tree'

/** Folders above `path`, outermost first. */
function ancestors(path: string): string[] {
  const out: string[] = []
  for (let p = path; p !== '/'; ) {
    p = parentDir(p)
    out.unshift(p)
  }
  return out
}

/** What a delete prompt asks about: `one` names the path, `many` lists up to six names. */
function describeTargets(
  entries: Entry[],
  one: 'deleteOne' | 'quickOne',
  many: 'deleteMany' | 'quickMany',
): string {
  if (entries.length === 1) return t(one, { path: ltr(entries[0].path) })
  const names = entries
    .slice(0, 6)
    .map((e) => e.name)
    .join('\n')
  return t(many, { n: entries.length, names: `${names}${entries.length > 6 ? '\n…' : ''}` })
}

/** Every delete asks twice; the second prompt names the count so a stray Enter cannot pass both. */
async function confirmDelete(title: string, message: string): Promise<boolean> {
  if (!(await confirmDialog(title, message, common('delete'), true))) return false
  return confirmDialog(t('confirmAgain'), t('noUndo'), t('confirmDelete'), true)
}
const nameCheck = (value: string) => (validRemoteName(value) ? '' : t('badName'))

function placeholder(info: SessionInfo | null): string {
  if (!info) return t('noSession')
  if (info.kind !== 'ssh') return t('localTerminal')
  if (info.state === 'connecting') return t('connecting')
  if (info.state !== 'live') return t('disconnected')
  return ''
}

/** Icon-only button: the label is both its accessible name and its hover tooltip. */
function toolButton(
  label: string,
  onclick: (event: Event) => void,
  iconName: IconName,
): HTMLButtonElement {
  return h(
    'button',
    {
      type: 'button',
      class: 'button small quiet files-tool',
      'aria-label': label,
      title: label,
      onclick,
    },
    icon(iconName),
  )
}

function chmodDialog(sessionId: number, entry: Entry, done: () => void): void {
  const parts = modal('chmod', t('chmodTitle', { name: ltr(entry.name) }), 'sm')
  const base = entry.mode & 0o7777
  const bits = modeToBits(base)
  const boxes = bits.map((on, i) =>
    h('input', {
      type: 'checkbox',
      checked: on,
      'aria-label': t('permBox', { who: PERM_ROWS[Math.floor(i / 3)], what: PERM_COLS[i % 3] }),
    }),
  )
  const octal = h('input', {
    type: 'text',
    class: 'mono',
    value: formatOctal(base),
    inputmode: 'numeric',
    maxlength: '4',
    spellcheck: 'false',
    autocomplete: 'off',
  })
  let special = base & 0o7000
  const fromBoxes = () => {
    octal.value = formatOctal(
      bitsToMode(
        boxes.map((b) => b.checked),
        special,
      ),
    )
    setFieldError(octal, '')
  }
  for (const box of boxes) box.addEventListener('change', fromBoxes)
  octal.addEventListener('input', () => {
    const mode = parseOctal(octal.value)
    if (mode === null) return
    special = mode & 0o7000
    modeToBits(mode).forEach((on, i) => {
      boxes[i].checked = on
    })
    setFieldError(octal, '')
  })
  const recursive = entry.kind === 'dir' ? h('input', { type: 'checkbox' }) : null
  const grid = h(
    'table',
    { class: 'chmod-grid' },
    h(
      'thead',
      {},
      h(
        'tr',
        {},
        h('td'),
        PERM_COLS.map((c) => h('th', { scope: 'col', text: c })),
      ),
    ),
    h(
      'tbody',
      {},
      PERM_ROWS.map((r, row) =>
        h(
          'tr',
          {},
          h('th', { scope: 'row', text: r }),
          boxes.slice(row * 3, row * 3 + 3).map((b) => h('td', {}, b)),
        ),
      ),
    ),
  )
  const form = h(
    'form',
    { class: 'dialog-form', novalidate: true },
    h('p', { class: 'help mono cell-text', text: entry.path, title: entry.path }),
    grid,
    field(t('octal'), octal, t('octalHelp')),
    recursive ? h('label', { class: 'check' }, recursive, t('recursive')) : null,
  )
  parts.body.append(form)
  const apply = button(t('apply'), () => form.requestSubmit(), 'primary')
  form.addEventListener('submit', async (event) => {
    event.preventDefault()
    const mode = parseOctal(octal.value)
    if (mode === null) {
      setFieldError(octal, t('octalError'))
      octal.focus()
      return
    }
    apply.disabled = true
    try {
      await invoke('sftp_chmod', {
        sessionId,
        path: entry.path,
        mode,
        recursive: recursive?.checked ?? false,
      })
      setStatus(t('chmodDone', { name: ltr(entry.name), mode: formatOctal(mode) }))
      parts.dialog.close()
      done()
    } catch (error) {
      setFieldError(octal, describeError(error))
    } finally {
      apply.disabled = false
    }
  })
  parts.actions.append(
    button(common('cancel'), () => parts.dialog.close()),
    apply,
  )
  parts.dialog.addEventListener('close', () => parts.dialog.remove())
  parts.dialog.showModal()
  boxes[0].focus()
}

/** Folders asked for before the panel first listed that session; opened instead of its initial dir. */
const wantedDirs = new Map<number, string>()
let showInPanel: ((sessionId: number, path: string) => Promise<boolean>) | null = null

export function showFolder(sessionId: number, path: string): Promise<boolean> {
  if (showInPanel) return showInPanel(sessionId, path)
  wantedDirs.set(sessionId, path)
  return Promise.resolve(true)
}

export function filesPanel(): PanelHost {
  const places = new Map<number, Place>()
  let sortKey: SortKey = 'name'
  let descending = false
  let rows: Entry[] = []
  let byPath = new Map<string, Entry>()
  let pendingFocus: string | null = null
  let program: string | null = null
  let treeCwd: string | null = null

  const queue = transferQueue((request) => {
    const place = places.get(request.sessionId)
    if (place && request.direction === 'upload' && place.cwd === request.remote) {
      void load(place, request.remote, { keep: true })
    }
  })

  const pathInput = h('input', {
    type: 'text',
    class: 'files-path mono',
    spellcheck: 'false',
    autocomplete: 'off',
    'aria-label': t('remotePath'),
  })
  const pathForm = h('form', { class: 'files-path-form' }, pathInput)
  const filterInput = h('input', {
    type: 'search',
    class: 'files-filter',
    placeholder: t('filter'),
    spellcheck: 'false',
    autocomplete: 'off',
    'aria-label': t('filterLabel'),
    title: t('filterTitle'),
  })
  const upButton = toolButton(t('up'), () => withPlace(goUp), 'arrow-up')
  const homeButton = toolButton(t('home'), () => withPlace(goHome), 'house')
  const refreshButton = toolButton(common('refresh'), () => withPlace(refresh), 'arrows-clockwise')
  const uploadButton = toolButton(
    t('uploadHere'),
    () => withPlace((place) => showMenuFor(uploadButton, uploadItems(place))),
    'upload',
  )
  const newButton = toolButton(
    t('newItem'),
    () => withPlace((place) => showMenuFor(newButton, createItems(place))),
    'plus',
  )
  const hiddenButton = toolButton(
    t('showHidden'),
    () => {
      updateSettings((draft) => {
        draft.files.showHidden = !draft.files.showHidden
      }).catch(report)
    },
    'eye',
  )
  hiddenButton.setAttribute('aria-pressed', 'false')
  const columnsButton = toolButton(
    t('columns'),
    () => showMenuFor(columnsButton, columnItems(null)),
    'columns',
  )
  const recordsButton = toolButton(
    t('records'),
    () => {
      const info = activeSession()
      if (info) openDownloads({ type: 'tab', key: info.key }, info.title)
    },
    'clock-counter-clockwise',
  )

  /** Visible columns in display order, as last built into the header. */
  let shownColumns: FileColumn[] = []
  let ths: HTMLTableCellElement[] = []
  const colgroup = h('colgroup')
  const headRow = h('tr')
  const thead = h('thead', {}, headRow)
  const tbody = h('tbody')
  const table = h(
    'table',
    {
      class: 'data-table files-table',
      role: 'grid',
      'aria-multiselectable': 'true',
      'aria-label': t('remoteFiles'),
    },
    colgroup,
    thead,
    tbody,
  )

  function sortBy(key: SortKey): void {
    if (sortKey === key) descending = !descending
    else {
      sortKey = key
      descending = key === 'mtime' || key === 'size'
    }
    render()
  }

  /** The name column takes the spare room, so its stored width only sets the table's minimum. */
  function applyWidths(): void {
    const cols = [...colgroup.children] as HTMLTableColElement[]
    shownColumns.forEach((column, i) => {
      cols[i].style.inlineSize = column.id === 'name' ? '' : `${column.width}px`
      ths[i].querySelector('.files-col-resize')?.setAttribute('aria-valuenow', String(column.width))
    })
    table.style.minInlineSize = `${shownColumns.reduce((sum, c) => sum + c.width, 0)}px`
  }

  function buildHead(): void {
    const active = document.activeElement
    const refocus =
      active instanceof HTMLElement && headRow.contains(active)
        ? {
            key: active.closest<HTMLElement>('th')?.dataset.key,
            handle: active.classList.contains('files-col-resize'),
          }
        : null
    shownColumns = settings().files.columns.filter((c) => c.visible)
    colgroup.replaceChildren(...shownColumns.map((c) => h('col', { 'data-key': c.id })))
    ths = shownColumns.map((column) => {
      const name = FILE_COLUMN_NAMES[column.id]
      const handle = h('span', {
        class: 'files-col-resize',
        role: 'separator',
        tabindex: '0',
        'aria-orientation': 'vertical',
        'aria-label': t('columnWidth', { name }),
        'aria-valuemin': String(COLUMN_WIDTH_LIMITS[0]),
        'aria-valuemax': String(COLUMN_WIDTH_LIMITS[1]),
        title: t('resizeTitle'),
      })
      handle.addEventListener('pointerdown', (event) => startResize(event, column.id, handle))
      handle.addEventListener('keydown', (event) => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
        event.preventDefault()
        const found = resizeTarget(column.id)
        if (!found) return
        const step = (event.shiftKey ? 4 : 1) * RESIZE_STEP
        const target = shownColumns[found.target]
        const width = target.width + found.sign * (event.key === 'ArrowLeft' ? -step : step)
        void saveColumns((cols) => resizeColumn(cols, target.id, width))
      })
      handle.addEventListener('dblclick', () => {
        const width = DEFAULT_FILE_COLUMNS.find((c) => c.id === column.id)?.width ?? column.width
        void saveColumns((cols) => resizeColumn(cols, column.id, width))
      })
      return h(
        'th',
        {
          scope: 'col',
          class: NUMERIC_COLUMNS.has(column.id) ? 'num' : '',
          'data-key': column.id,
        },
        h('button', {
          type: 'button',
          class: 'sort-button',
          text: name,
          onclick: () => sortBy(column.id),
        }),
        handle,
      )
    })
    headRow.replaceChildren(...ths)
    applyWidths()
    if (refocus) {
      const th = ths.find((t) => t.dataset.key === refocus.key)
      th?.querySelector<HTMLElement>(refocus.handle ? '.files-col-resize' : '.sort-button')?.focus()
    }
  }

  /**
   * Drags a column edge. While the name column is filling spare room, its edge acts as a splitter
   * against the next column, so the line follows the pointer either way. `sign` turns screen
   * pixels into width; right-to-left text mirrors the table, putting each edge on the left.
   */
  function resizeTarget(id: FileColumnId): { target: number; sign: number } | null {
    const index = shownColumns.findIndex((c) => c.id === id)
    if (index < 0) return null
    const filling = table.offsetWidth <= wrap.clientWidth
    const splitter = id === 'name' && filling && index < shownColumns.length - 1
    const outward = isRtl() ? -1 : 1
    return splitter ? { target: index + 1, sign: -outward } : { target: index, sign: outward }
  }

  function startResize(event: PointerEvent, id: FileColumnId, handle: HTMLElement): void {
    if (event.button !== 0) return
    event.preventDefault()
    const found = resizeTarget(id)
    if (!found) return
    const { target, sign } = found
    const startX = event.clientX
    const startWidth = ths[target].offsetWidth
    const original = shownColumns[target].width
    let width = original
    handle.setPointerCapture(event.pointerId)
    handle.classList.add('dragging')
    const move = (e: PointerEvent) => {
      width = clampColumnWidth(startWidth + sign * (e.clientX - startX))
      shownColumns[target] = { ...shownColumns[target], width }
      applyWidths()
    }
    const end = () => {
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', end)
      handle.removeEventListener('pointercancel', end)
      handle.classList.remove('dragging')
      const column = shownColumns[target].id
      if (width !== original) void saveColumns((cols) => resizeColumn(cols, column, width))
    }
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', end)
    handle.addEventListener('pointercancel', end)
  }

  /** Header menu: show or hide columns, move `at` left or right, reset. */
  function columnItems(at: FileColumnId | null): MenuItem[] {
    const columns = settings().files.columns
    const items: MenuItem[] = columns.map((c) => ({
      label: FILE_COLUMN_NAMES[c.id],
      checked: c.visible,
      disabled: c.id === 'name',
      action: () => void saveColumns((cols) => toggleColumn(cols, c.id)),
    }))
    if (at) {
      const shownIds = columns.filter((c) => c.visible).map((c) => c.id)
      const index = shownIds.indexOf(at)
      const name = FILE_COLUMN_NAMES[at]
      items.push(
        'separator',
        {
          label: t('moveEarlier', { name }),
          disabled: index <= 0,
          action: () => void saveColumns((cols) => moveColumn(cols, at, -1)),
        },
        {
          label: t('moveLater', { name }),
          disabled: index < 0 || index >= shownIds.length - 1,
          action: () => void saveColumns((cols) => moveColumn(cols, at, 1)),
        },
      )
    }
    items.push('separator', {
      label: t('resetColumns'),
      action: () => void saveColumns(() => DEFAULT_FILE_COLUMNS.map((c) => ({ ...c }))),
    })
    return items
  }

  const headKey = (event: Event): FileColumnId | null => {
    const th = (event.target as Element).closest<HTMLElement>('th[data-key]')
    return (th?.dataset.key as FileColumnId | undefined) ?? null
  }
  thead.addEventListener('contextmenu', (event) => {
    event.preventDefault()
    event.stopPropagation()
    showMenu(event.clientX, event.clientY, columnItems(headKey(event)))
  })
  thead.addEventListener('keydown', (event) => {
    if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return
    event.preventDefault()
    const target = event.target as HTMLElement
    showMenuFor(target, columnItems(headKey(event)))
  })
  const wrap = h('div', { class: 'table-wrap files-wrap' }, table)
  const empty = h('p', { class: 'panel-empty' })
  const error = h('p', { class: 'panel-error', role: 'alert' })
  const folderEmpty = h('p', {
    class: 'help files-note',
    text: t('emptyFolder'),
  })
  const drop = h('div', { class: 'files-drop', hidden: true }, h('p', { text: t('dropHere') }))
  const tree = h('ul', { class: 'files-tree-list', role: 'tree', 'aria-label': t('tree') })
  const treePane = h('nav', { class: 'files-tree', 'aria-label': t('tree') }, tree)
  const body = h(
    'div',
    { class: 'files-body' },
    treePane,
    h('div', { class: 'files-main' }, wrap, folderEmpty),
  )
  const view = h(
    'div',
    { class: 'files-view' },
    h(
      'header',
      { class: 'files-bar' },
      h('div', { class: 'files-group' }, upButton, homeButton, refreshButton),
      pathForm,
      filterInput,
      h('div', { class: 'files-group' }, uploadButton, newButton),
      h('div', { class: 'files-group' }, hiddenButton, columnsButton, recordsButton),
    ),
    error,
    body,
  )
  const element = h(
    'div',
    { class: 'files-panel' },
    empty,
    view,
    queue.element,
    externalEdits,
    drop,
  )

  const filesVisible = () =>
    settings().layout.panels.some((p) => p.id === 'files' && p.region !== 'hidden')

  // Listing starts lazily, the first time a live SSH session is shown here.
  function shown(): Place | null {
    const info = activeSession()
    if (info?.kind !== 'ssh' || info.state !== 'live' || info.id === null || !info.ssh) return null
    let place = places.get(info.id)
    if (!place && filesVisible()) {
      place = {
        sessionId: info.id,
        cwd: null,
        entries: [],
        error: null,
        loading: false,
        token: 0,
        selected: new Set(),
        anchor: null,
        focus: null,
        filter: '',
        tree: new Map(),
        treeFocus: null,
      }
      places.set(info.id, place)
      const wanted = wantedDirs.get(info.id)
      wantedDirs.delete(info.id)
      void begin(place, wanted ?? info.ssh.initialDir)
    }
    return place ?? null
  }

  function withPlace(task: (place: Place) => unknown): void {
    const place = shown()
    if (place) void task(place)
  }

  async function load(place: Place, path: string, options: LoadOptions = {}): Promise<boolean> {
    const token = ++place.token
    place.loading = true
    if (place === shown()) paintBusy(place)
    try {
      const entries = await invoke<Entry[]>('sftp_list', { sessionId: place.sessionId, path })
      if (token !== place.token) return true
      const moved = place.cwd !== path
      place.cwd = path
      place.entries = entries
      place.error = null
      treeNode(place, path).dirs = entries.filter(isDir)
      if (moved) {
        place.filter = ''
        if (treeMode()) revealInTree(place, path)
      }
      if (options.select) {
        place.selected = new Set([options.select])
        place.anchor = options.select
        place.focus = options.select
        pendingFocus = options.select
      } else if (moved || !options.keep) {
        place.selected = new Set()
        place.anchor = null
        place.focus = null
      } else {
        const alive = new Set(entries.map((e) => e.path))
        place.selected = new Set([...place.selected].filter((p) => alive.has(p)))
      }
      return true
    } catch (error) {
      if (token !== place.token) return false
      const params = { path: ltr(path), error: describeError(error) }
      if (options.quiet) setStatus(t('panelCantOpen', params))
      else place.error = t('cantOpen', params)
      return false
    } finally {
      if (token === place.token) {
        place.loading = false
        if (place === shown()) render()
      }
    }
  }

  async function begin(place: Place, initialDir: string): Promise<void> {
    const sessionId = place.sessionId
    if (initialDir) {
      if (await resolve(place, initialDir)) return
      if (place.error) setStatus(t('openedHome', { error: place.error }), 'error')
    }
    try {
      await load(place, await invoke<string>('sftp_home', { sessionId }))
    } catch (error) {
      place.error = t('cantReadHome', { error: describeError(error) })
      if (place === shown()) render()
    }
  }

  async function resolve(place: Place, path: string): Promise<boolean> {
    try {
      const real = await invoke<string>('sftp_resolve', { sessionId: place.sessionId, path })
      return await load(place, real)
    } catch (error) {
      place.error = t('cantOpen', { path: ltr(path), error: describeError(error) })
      if (place === shown()) render()
      return false
    }
  }

  const goUp = (place: Place) => {
    if (place.cwd && place.cwd !== '/')
      void load(place, parentDir(place.cwd), { select: place.cwd })
  }
  const goHome = async (place: Place) => {
    try {
      await load(place, await invoke<string>('sftp_home', { sessionId: place.sessionId }))
    } catch (error) {
      report(error)
    }
  }
  const refresh = (place: Place) => {
    if (place.cwd) void load(place, place.cwd, { keep: true })
  }

  function treeNode(place: Place, path: string): TreeNode {
    let node = place.tree.get(path)
    if (!node) {
      node = { dirs: null, expanded: false, loading: false, error: null }
      place.tree.set(path, node)
    }
    return node
  }

  async function treeLoad(place: Place, path: string, force = false): Promise<void> {
    const node = treeNode(place, path)
    if (node.loading || (node.dirs && !force)) return
    node.loading = true
    try {
      const entries = await invoke<Entry[]>('sftp_list', { sessionId: place.sessionId, path })
      node.dirs = entries.filter(isDir)
      node.error = null
    } catch (error) {
      node.error = describeError(error)
    } finally {
      node.loading = false
      if (place === shown()) renderTree(place)
    }
  }

  function revealInTree(place: Place, path: string): void {
    if (path === '/') treeNode(place, '/').expanded = true
    for (const dir of ancestors(path)) {
      treeNode(place, dir).expanded = true
      void treeLoad(place, dir)
    }
    place.treeFocus = path
  }

  function toggleTree(place: Place, path: string, open = !treeNode(place, path).expanded): void {
    const node = treeNode(place, path)
    if (node.expanded === open) return
    node.expanded = open
    if (open) void treeLoad(place, path)
    renderTree(place)
  }

  const selectedEntries = (place: Place): Entry[] => rows.filter((e) => place.selected.has(e.path))

  /** The built-in editor is a plugin; while it is off, files open externally. */
  function edit(place: Place, entry: Entry, mode: EditorMode, via: string | null = null): void {
    const editor = mode === 'internal' ? service('editor') : undefined
    const task = editor
      ? editor.open(place.sessionId, entry)
      : editExternal(place.sessionId, entry, via)
    task.catch(report)
  }

  async function openWith(place: Place, entry: Entry): Promise<void> {
    const chosen = await open({
      multiple: false,
      directory: false,
      title: t('openWithTitle', { name: ltr(entry.name) }),
      defaultPath: program ?? undefined,
      filters: [{ name: t('programs'), extensions: PROGRAMS }],
    })
    if (typeof chosen !== 'string') return
    program = chosen
    edit(place, entry, 'external', chosen)
  }

  function activate(place: Place, entry: Entry): void {
    if (isDir(entry)) void load(place, entry.path)
    else if (entry.kind === 'other') setStatus(t('special', { name: ltr(entry.name) }))
    else if (isImage(entry.name)) previewImage(place.sessionId, entry).catch(report)
    else edit(place, entry, settings().files.editor)
  }

  async function download(place: Place, entries: Entry[], ask: boolean): Promise<void> {
    if (entries.length === 0) return
    let dir = ask ? '' : settings().files.downloadDir
    if (!dir) {
      const chosen = await open({ directory: true, multiple: false, title: t('downloadTo') })
      if (typeof chosen !== 'string') return
      dir = chosen
    }
    for (const entry of entries) {
      void queue.start({
        sessionId: place.sessionId,
        direction: 'download',
        local: dir,
        remote: entry.path,
        name: entry.name,
      })
    }
  }

  function upload(place: Place, paths: string[]): void {
    const dir = place.cwd
    if (!dir) return
    for (const local of paths) {
      void queue.start({
        sessionId: place.sessionId,
        direction: 'upload',
        local,
        remote: dir,
        name: baseName(local),
      })
    }
  }

  async function pickUpload(place: Place, folder: boolean): Promise<void> {
    const chosen = await open({
      directory: folder,
      multiple: !folder,
      title: folder ? t('pickFolder') : t('pickFiles'),
    })
    if (chosen === null) return
    upload(place, Array.isArray(chosen) ? chosen : [chosen])
  }

  async function create(place: Place, folder: boolean, dir = place.cwd): Promise<void> {
    if (!dir) return
    const name = await promptDialog(
      folder ? t('newFolder') : t('newFile'),
      folder ? t('folderName') : t('fileName'),
      folder ? t('newFolder') : t('defaultFile'),
      common('create'),
      nameCheck,
    )
    if (name === null) return
    const path = joinRemote(dir, name)
    try {
      await invoke(folder ? 'sftp_mkdir' : 'sftp_create', { sessionId: place.sessionId, path })
      if (dir === place.cwd) await load(place, dir, { select: path })
      else await treeLoad(place, dir, true)
    } catch (error) {
      report(error)
    }
  }

  async function rename(place: Place, entry: Entry): Promise<void> {
    const name = await promptDialog(
      common('rename'),
      t('newName'),
      entry.name,
      common('rename'),
      nameCheck,
    )
    if (name === null || name === entry.name) return
    const to = joinRemote(parentDir(entry.path), name)
    try {
      await invoke('sftp_rename', { sessionId: place.sessionId, from: entry.path, to })
      if (place.cwd) await load(place, place.cwd, { select: to })
    } catch (error) {
      report(error)
    }
  }

  async function afterRemove(place: Place): Promise<void> {
    if (!place.cwd) return
    await load(place, place.cwd, { keep: true })
    for (const [path, node] of place.tree) if (node.dirs) void treeLoad(place, path, true)
  }

  async function remove(place: Place, entries: Entry[]): Promise<void> {
    if (entries.length === 0) return
    const targets = describeTargets(entries, 'deleteOne', 'deleteMany')
    const folders = entries.some((e) => e.kind === 'dir') ? `\n${t('folderContents')}` : ''
    const ok = await confirmDelete(common('delete'), `${targets}${folders}`)
    if (!ok) return
    let removed = 0
    for (const entry of entries) {
      try {
        await invoke('sftp_remove', { sessionId: place.sessionId, path: entry.path })
        removed += 1
      } catch (error) {
        report(error)
      }
    }
    await afterRemove(place)
    if (removed === entries.length)
      setStatus(
        entries.length === 1
          ? t('deletedOne', { name: ltr(entries[0].name) })
          : t('deletedMany', { n: removed }),
      )
  }

  async function quickRemove(place: Place, entries: Entry[]): Promise<void> {
    if (entries.length === 0) return
    const ok = await confirmDelete(
      t('quickDeleteTitle'),
      `${describeTargets(entries, 'quickOne', 'quickMany')}\n${t('quickNote')}`,
    )
    if (!ok) return
    try {
      await invoke('remote_rm', { sessionId: place.sessionId, paths: entries.map((e) => e.path) })
      setStatus(
        entries.length === 1
          ? t('deletedOne', { name: ltr(entries[0].name) })
          : t('deletedMany', { n: entries.length }),
      )
    } catch (error) {
      report(error)
    }
    await afterRemove(place)
  }

  async function packDownload(place: Place, entries: Entry[]): Promise<void> {
    if (entries.length === 0) return
    let dir = settings().files.downloadDir
    if (!dir) {
      const chosen = await open({ directory: true, multiple: false, title: t('downloadTo') })
      if (typeof chosen !== 'string') return
      dir = chosen
    }
    const sessionId = place.sessionId
    setStatus(
      entries.length === 1
        ? t('packingOne', { name: ltr(entries[0].name) })
        : t('packingMany', { n: entries.length }),
    )
    let packed: { dir: string; archive: string }
    try {
      packed = await invoke('pack_create', { sessionId, paths: entries.map((e) => e.path) })
    } catch (error) {
      report(error)
      return
    }
    const name = baseName(packed.archive)
    setStatus(t('packed', { name: ltr(name) }))
    void queue.start({
      sessionId,
      direction: 'download',
      local: dir,
      remote: packed.archive,
      name,
      onEnd: () => {
        invoke('pack_cleanup', { sessionId, dir: packed.dir }).catch(() =>
          setStatus(t('packCleanup', { dir: ltr(packed.dir) }), 'error'),
        )
      },
    })
  }

  const uploadItems = (place: Place): MenuItem[] => [
    {
      label: t('uploadFiles'),
      icon: 'upload-simple',
      action: () => void pickUpload(place, false),
      disabled: !place.cwd,
    },
    {
      label: t('uploadFolder'),
      icon: 'upload',
      action: () => void pickUpload(place, true),
      disabled: !place.cwd,
    },
  ]

  const createItems = (place: Place): MenuItem[] => [
    {
      label: t('newFileMenu'),
      icon: 'file-plus',
      action: () => void create(place, false),
      disabled: !place.cwd,
    },
    {
      label: t('newFolderMenu'),
      icon: 'folder-plus',
      action: () => void create(place, true),
      disabled: !place.cwd,
    },
  ]

  const folderItems = (place: Place): MenuItem[] => [
    ...uploadItems(place),
    'separator',
    ...createItems(place),
    'separator',
    {
      label: common('refresh'),
      icon: 'arrows-clockwise',
      action: () => refresh(place),
      disabled: !place.cwd,
    },
    {
      label: t('copyCwd'),
      icon: 'copy',
      action: () => copyText(place.cwd ?? '').catch(report),
      disabled: !place.cwd,
    },
    ...menuItems('files/background', { sessionId: place.sessionId, directory: place.cwd }),
  ]

  function entryItems(place: Place): MenuItem[] {
    const chosen = selectedEntries(place)
    const one = chosen.length === 1 ? chosen[0] : null
    const file = one && !isDir(one) && one.kind !== 'other' ? one : null
    const n = chosen.length
    const many = n > 1
    const opens: MenuItem[] =
      one && isDir(one)
        ? [{ label: common('open'), icon: 'folder-open', action: () => void load(place, one.path) }]
        : [
            {
              label: common('open'),
              icon: 'folder-open',
              action: () => file && activate(place, file),
              disabled: !file,
            },
            ...(service('editor')
              ? [
                  {
                    label: t('openInternal'),
                    icon: 'note-pencil',
                    action: () => file && edit(place, file, 'internal'),
                    disabled: !file,
                  },
                ]
              : []),
            {
              label: t('openExternal'),
              icon: 'arrow-square-out',
              action: () => file && edit(place, file, 'external'),
              disabled: !file,
            },
            {
              label: t('openWith'),
              icon: 'app-window',
              action: () => file && void openWith(place, file).catch(report),
              disabled: !file,
            },
            ...(file && isImage(file.name)
              ? [
                  {
                    label: t('previewImage'),
                    icon: 'image',
                    action: () => previewImage(place.sessionId, file).catch(report),
                  },
                ]
              : []),
          ]
    return [
      ...opens,
      'separator',
      {
        label: many ? t('downloadMany', { n }) : common('download'),
        icon: 'download-simple',
        action: () => void download(place, chosen, false),
      },
      {
        label: many ? t('downloadManyTo', { n }) : t('downloadToMenu'),
        icon: 'folder-simple',
        action: () => void download(place, chosen, true),
      },
      {
        label: many ? t('packDownloadMany', { n }) : t('packDownload'),
        icon: 'package',
        action: () => void packDownload(place, chosen),
      },
      'separator',
      ...createItems(place),
      'separator',
      {
        label: t('renameMenu'),
        icon: 'pencil-simple',
        action: () => one && void rename(place, one),
        disabled: !one,
      },
      {
        label: t('chmodMenu'),
        icon: 'lock',
        action: () => one && chmodDialog(place.sessionId, one, () => refresh(place)),
        disabled: !one,
      },
      {
        label: t('copyPath'),
        icon: 'copy',
        action: () => copyText(chosen.map((e) => e.path).join('\n')).catch(report),
      },
      ...menuItems('files/entry', {
        sessionId: place.sessionId,
        directory: place.cwd,
        paths: chosen.map((e) => e.path),
      }),
      'separator',
      {
        label: many ? t('deleteManyMenu', { n }) : t('deleteMenu'),
        icon: 'trash',
        action: () => void remove(place, chosen),
        danger: true,
      },
      {
        label: many ? t('quickDeleteMany', { n }) : t('quickDelete'),
        icon: 'lightning',
        action: () => void quickRemove(place, chosen),
        danger: true,
      },
    ]
  }

  function treeItems(place: Place, path: string): MenuItem[] {
    const node = treeNode(place, path)
    return [
      { label: common('open'), icon: 'folder-open', action: () => void load(place, path) },
      {
        label: node.expanded ? t('fold') : common('expand'),
        icon: 'tree-structure',
        action: () => toggleTree(place, path),
        disabled: node.dirs?.length === 0,
      },
      {
        label: common('refresh'),
        icon: 'arrows-clockwise',
        action: () => void treeLoad(place, path, true),
      },
      'separator',
      {
        label: t('newFolderMenu'),
        icon: 'folder-plus',
        action: () => void create(place, true, path),
      },
      { label: t('copyPath'), icon: 'copy', action: () => copyText(path).catch(report) },
      ...menuItems('files/entry', {
        sessionId: place.sessionId,
        directory: place.cwd,
        paths: [path],
      }),
    ]
  }

  function row(entry: Entry): HTMLTableRowElement {
    const link = entry.linkTarget ? ` → ${entry.linkTarget}` : ''
    return h(
      'tr',
      {
        tabindex: '-1',
        'aria-selected': 'false',
        'data-path': entry.path,
        'data-kind': isDir(entry) ? 'dir' : entry.kind,
        title: `${entry.path}${link}`,
      },
      shownColumns.map((column) => cell(column.id, entry)),
    )
  }

  const rowFor = (path: string) => [...tbody.rows].find((r) => r.dataset.path === path)

  function paintSelection(place: Place): void {
    const focus = place.focus && byPath.has(place.focus) ? place.focus : (rows[0]?.path ?? null)
    for (const tr of tbody.rows) {
      const path = tr.dataset.path ?? ''
      tr.setAttribute('aria-selected', String(place.selected.has(path)))
      tr.tabIndex = path === focus ? 0 : -1
    }
  }

  function paintBusy(place: Place): void {
    wrap.setAttribute('aria-busy', String(place.loading))
  }

  function render(): void {
    const info = activeSession()
    const message = placeholder(info)
    empty.textContent = message
    empty.hidden = message === ''
    view.hidden = message !== ''
    const place = shown()
    if (!place) {
      tbody.replaceChildren()
      tree.replaceChildren()
      treeCwd = null
      rows = []
      byPath = new Map()
      return
    }
    const showHidden = settings().files.showHidden
    error.textContent = place.error ?? ''
    error.hidden = place.error === null
    if (document.activeElement !== pathInput) pathInput.value = place.cwd ?? ''
    if (document.activeElement !== filterInput) filterInput.value = place.filter
    upButton.disabled = !place.cwd || place.cwd === '/'
    hiddenButton.setAttribute('aria-pressed', String(showHidden))
    paintBusy(place)
    for (const th of ths) {
      if (th.dataset.key === sortKey)
        th.setAttribute('aria-sort', descending ? 'descending' : 'ascending')
      else th.removeAttribute('aria-sort')
    }
    const hadFocus = tbody.contains(document.activeElement)
    const visible = visibleEntries(place.entries, showHidden)
    rows = sortEntries(filterEntries(visible, place.filter), sortKey, descending)
    byPath = new Map(rows.map((e) => [e.path, e]))
    tbody.replaceChildren(...rows.map(row))
    folderEmpty.hidden = place.cwd === null || place.loading || rows.length > 0
    folderEmpty.textContent =
      visible.length > 0 ? t('noMatch', { filter: ltr(place.filter.trim()) }) : t('emptyFolder')
    treePane.hidden = !treeMode()
    body.dataset.view = treeMode() ? 'tree' : 'single'
    renderTree(place)
    paintSelection(place)
    const focus = pendingFocus ?? (hadFocus ? place.focus : null)
    pendingFocus = null
    if (focus) rowFor(focus)?.focus()
  }

  function treeItem(
    place: Place,
    path: string,
    name: string,
    level: number,
    link: boolean,
  ): HTMLLIElement {
    const node = place.tree.get(path)
    const leaf = node?.dirs?.length === 0
    const expanded = Boolean(node?.expanded) && !leaf
    const li = h(
      'li',
      {
        role: 'treeitem',
        class: 'files-tree-item',
        tabindex: '-1',
        'aria-level': String(level),
        'aria-selected': String(path === place.cwd),
        'aria-expanded': leaf ? null : String(expanded),
        'aria-busy': node?.loading ? 'true' : null,
        'data-path': path,
        'data-error': node?.error ? 'true' : null,
        title: node?.error ? `${path}\n${node.error}` : path,
      },
      h(
        'span',
        { class: 'files-tree-caret', 'data-toggle': 'true', 'data-leaf': leaf },
        expanded ? treeIcons.expanded() : treeIcons.collapsed(),
      ),
      h(
        'span',
        { class: 'files-icon', 'data-icon': link ? 'link' : 'folder' },
        expanded ? treeIcons.open() : treeIcons.closed(),
      ),
      h('span', { class: 'cell-text', text: name }),
    )
    li.style.setProperty('--level', String(level - 1))
    return li
  }

  function renderTree(place: Place): void {
    if (!treeMode()) return
    const showHidden = settings().files.showHidden
    const onPath = new Set(place.cwd ? [...ancestors(place.cwd), place.cwd] : [])
    const items: HTMLLIElement[] = [treeItem(place, '/', '/', 1, false)]
    const walk = (path: string, level: number) => {
      const node = place.tree.get(path)
      if (!node?.expanded || !node.dirs) return
      const dirs = sortEntries(
        node.dirs.filter((d) => showHidden || !d.name.startsWith('.') || onPath.has(d.path)),
        'name',
        false,
      )
      dirs.forEach((dir, i) => {
        const li = treeItem(place, dir.path, dir.name, level, dir.kind === 'symlink')
        li.setAttribute('aria-setsize', String(dirs.length))
        li.setAttribute('aria-posinset', String(i + 1))
        items.push(li)
        walk(dir.path, level + 1)
      })
    }
    walk('/', 2)
    const hadFocus = tree.contains(document.activeElement)
    tree.replaceChildren(...items)
    const find = (path: string | null) => items.find((li) => li.dataset.path === path)
    const current = find(place.cwd)
    const target = find(place.treeFocus) ?? current ?? items[0]
    target.tabIndex = 0
    if (hadFocus) target.focus({ preventScroll: true })
    if (current && place.cwd !== treeCwd) {
      treeCwd = place.cwd
      current.scrollIntoView({ block: 'nearest' })
    }
  }

  const treeItemOf = (event: Event) =>
    (event.target as Element).closest<HTMLLIElement>('.files-tree-item')

  function focusTree(place: Place, li: HTMLLIElement): void {
    place.treeFocus = li.dataset.path ?? null
    for (const item of tree.children) (item as HTMLElement).tabIndex = -1
    li.tabIndex = 0
    li.focus()
  }

  function select(place: Place, path: string, mode: 'only' | 'toggle' | 'range'): void {
    const paths = rows.map((e) => e.path)
    const from = place.anchor === null ? -1 : paths.indexOf(place.anchor)
    const to = paths.indexOf(path)
    if (mode === 'range' && from >= 0 && to >= 0) {
      place.selected = new Set(paths.slice(Math.min(from, to), Math.max(from, to) + 1))
    } else if (mode === 'toggle') {
      if (!place.selected.delete(path)) place.selected.add(path)
      place.anchor = path
    } else {
      place.selected = new Set([path])
      place.anchor = path
    }
    place.focus = path
    paintSelection(place)
  }

  const targetRow = (event: Event) =>
    (event.target as Element).closest<HTMLTableRowElement>('tbody tr')

  tbody.addEventListener('click', (event) => {
    const tr = targetRow(event)
    const place = shown()
    if (!tr?.dataset.path || !place) return
    select(
      place,
      tr.dataset.path,
      event.ctrlKey || event.metaKey ? 'toggle' : event.shiftKey ? 'range' : 'only',
    )
    tr.focus()
  })
  tbody.addEventListener('dblclick', (event) => {
    const entry = byPath.get(targetRow(event)?.dataset.path ?? '')
    const place = shown()
    if (entry && place) activate(place, entry)
  })
  wrap.addEventListener('contextmenu', (event) => {
    event.preventDefault()
    const place = shown()
    if (!place) return
    const tr = targetRow(event)
    if (!tr?.dataset.path) {
      showMenu(event.clientX, event.clientY, folderItems(place))
      return
    }
    const path = tr.dataset.path
    if (!place.selected.has(path)) select(place, path, 'only')
    tr.focus()
    showMenu(event.clientX, event.clientY, entryItems(place))
  })

  tbody.addEventListener('keydown', (event) => {
    const place = shown()
    if (!place || rows.length === 0) return
    const paths = rows.map((e) => e.path)
    const index = Math.max(0, paths.indexOf(place.focus ?? ''))
    const move = (to: number) => {
      const path = paths[Math.max(0, Math.min(paths.length - 1, to))]
      select(place, path, event.shiftKey ? 'range' : 'only')
      rowFor(path)?.focus()
    }
    const entry = byPath.get(place.focus ?? '')
    const mod = event.ctrlKey || event.metaKey
    if (event.key === 'ArrowDown') move(index + 1)
    else if (event.key === 'ArrowUp') move(index - 1)
    else if (event.key === 'PageDown') move(index + 10)
    else if (event.key === 'PageUp') move(index - 10)
    else if (event.key === 'Home') move(0)
    else if (event.key === 'End') move(paths.length - 1)
    else if (event.key === 'Enter' && entry) activate(place, entry)
    else if (event.key === 'Backspace') goUp(place)
    else if (event.key === 'Delete' && event.shiftKey)
      void quickRemove(place, selectedEntries(place))
    else if (event.key === 'Delete') void remove(place, selectedEntries(place))
    else if (event.key === 'F2' && entry) void rename(place, entry)
    else if (event.key === ' ' && entry) select(place, entry.path, mod ? 'toggle' : 'only')
    else if (mod && event.key.toLowerCase() === 'a') {
      place.selected = new Set(paths)
      paintSelection(place)
    } else if ((event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) && entry) {
      const tr = rowFor(entry.path)
      if (!place.selected.has(entry.path)) select(place, entry.path, 'only')
      if (tr) showMenuFor(tr, entryItems(place))
    } else return
    event.preventDefault()
  })

  // One click lists the folder on the right; double click or the caret folds it.
  tree.addEventListener('click', (event) => {
    const li = treeItemOf(event)
    const path = li?.dataset.path
    const place = shown()
    if (!li || !path || !place) return
    focusTree(place, li)
    if ((event.target as Element).closest('[data-toggle]')) toggleTree(place, path)
    else if (path !== place.cwd) void load(place, path)
  })
  tree.addEventListener('dblclick', (event) => {
    const path = treeItemOf(event)?.dataset.path
    const place = shown()
    if (!path || !place || (event.target as Element).closest('[data-toggle]')) return
    place.treeFocus = path
    toggleTree(place, path)
  })
  tree.addEventListener('contextmenu', (event) => {
    event.preventDefault()
    const li = treeItemOf(event)
    const path = li?.dataset.path
    const place = shown()
    if (!li || !path || !place) return
    focusTree(place, li)
    showMenu(event.clientX, event.clientY, treeItems(place, path))
  })
  tree.addEventListener('keydown', (event) => {
    const li = treeItemOf(event)
    const path = li?.dataset.path
    const place = shown()
    if (!li || !path || !place) return
    place.treeFocus = path
    const items = [...tree.querySelectorAll<HTMLLIElement>('.files-tree-item')]
    const index = items.indexOf(li)
    const levelOf = (item: HTMLLIElement) => Number(item.getAttribute('aria-level'))
    const level = levelOf(li)
    const expanded = li.getAttribute('aria-expanded')
    // Right-to-left trees open toward the left.
    const inward = isRtl() ? 'ArrowLeft' : 'ArrowRight'
    const outward = isRtl() ? 'ArrowRight' : 'ArrowLeft'
    const go = (to: HTMLLIElement | undefined) => {
      if (to) focusTree(place, to)
    }
    if (event.key === 'ArrowDown') go(items[index + 1])
    else if (event.key === 'ArrowUp') go(items[index - 1])
    else if (event.key === 'Home') go(items[0])
    else if (event.key === 'End') go(items.at(-1))
    else if (event.key === inward) {
      if (expanded === 'false') toggleTree(place, path, true)
      else if (expanded === 'true' && items[index + 1] && levelOf(items[index + 1]) > level)
        go(items[index + 1])
    } else if (event.key === outward) {
      if (expanded === 'true') toggleTree(place, path, false)
      else
        go(
          items
            .slice(0, index)
            .reverse()
            .find((item) => levelOf(item) < level),
        )
    } else if (event.key === 'Enter' || event.key === ' ') {
      if (path !== place.cwd) void load(place, path)
    } else if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10'))
      showMenuFor(li, treeItems(place, path))
    else return
    event.preventDefault()
  })

  filterInput.addEventListener('input', () => {
    const place = shown()
    if (!place) return
    place.filter = filterInput.value
    render()
  })
  filterInput.addEventListener('keydown', (event) => {
    const place = shown()
    if (!place) return
    if (event.key === 'Escape' && filterInput.value) {
      event.preventDefault()
      event.stopPropagation()
      filterInput.value = ''
      place.filter = ''
      render()
    } else if ((event.key === 'ArrowDown' || event.key === 'Enter') && rows.length > 0) {
      event.preventDefault()
      select(place, rows[0].path, 'only')
      rowFor(rows[0].path)?.focus()
    }
  })

  pathForm.addEventListener('submit', (event) => {
    event.preventDefault()
    const target = pathInput.value.trim() || '/'
    withPlace(async (place) => {
      if (await resolve(place, target)) rowFor(rows[0]?.path ?? '')?.focus()
      else report(place.error)
    })
  })
  pathInput.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return
    event.preventDefault()
    pathInput.value = shown()?.cwd ?? ''
  })
  pathInput.addEventListener('blur', () => {
    pathInput.value = shown()?.cwd ?? ''
  })

  // The webview reports physical pixels; the panel rect is in CSS pixels.
  const overPanel = (position: { x: number; y: number }) => {
    if (!element.isConnected || element.closest('[hidden]')) return false
    const rect = element.getBoundingClientRect()
    const x = position.x / window.devicePixelRatio
    const y = position.y / window.devicePixelRatio
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
  }
  getCurrentWebview()
    .onDragDropEvent((event) => {
      const payload = event.payload
      if (payload.type === 'leave') {
        drop.hidden = true
        return
      }
      const place = shown()
      const inside = place?.cwd != null && overPanel(payload.position)
      if (payload.type === 'drop') {
        drop.hidden = true
        if (place && inside) upload(place, payload.paths)
      } else {
        drop.hidden = !inside
      }
    })
    .catch(report)

  showInPanel = async (sessionId, path) => {
    const place = places.get(sessionId)
    if (!place) {
      wantedDirs.set(sessionId, path)
      if (activeSession()?.id === sessionId) render()
      return true
    }
    return place.cwd === path || load(place, path, { quiet: true })
  }

  onActive(() => render())
  onEnded((info) => {
    if (info.id !== null) {
      wantedDirs.delete(info.id)
      places.delete(info.id)
      closeEditsFor(info.id)
    }
    render()
  })
  onSettings((next, prev) => {
    const moved = JSON.stringify(next.layout.panels) !== JSON.stringify(prev.layout.panels)
    const view = next.files.view !== prev.files.view
    if (view && next.files.view === 'tree') {
      const place = shown()
      if (place?.cwd) revealInTree(place, place.cwd)
    }
    const columns = JSON.stringify(next.files.columns) !== JSON.stringify(prev.files.columns)
    if (columns) {
      if (!shownColumns.some((c) => c.id === sortKey) && sortKey !== 'name') {
        sortKey = 'name'
        descending = false
      }
      buildHead()
    }
    if (moved || view || columns || next.files.showHidden !== prev.files.showHidden) render()
  })

  buildHead()
  render()
  return { element, shown: () => render() }
}
