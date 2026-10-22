import { foldAll, indentUnit, unfoldAll } from '@codemirror/language'
import { forEachDiagnostic, openLintPanel } from '@codemirror/lint'
import { gotoLine, openSearchPanel } from '@codemirror/search'
import { Compartment, EditorState, type Extension } from '@codemirror/state'
import { EditorView, type KeyBinding } from '@codemirror/view'
import { Channel, invoke } from '@tauri-apps/api/core'
import { button, confirmDialog, modal } from './dialogs'
import { h, reportError, setStatus } from './dom'
import { addRecord, discardRecord, type RecordKind, updateRecord } from './downloads'
import { type Decoded, detectEol, ENCODINGS, encodingLabel } from './editor-encoding'
import { canFormat, formatChange, looksMinified } from './editor-format'
import {
  LANGUAGE_NAMES,
  type LanguageId,
  languageFor,
  languageId,
  loadLanguage,
} from './editor-languages'
import {
  editMenu,
  editorFeatureItems,
  editorSetup,
  formatDocument,
  selectedText,
} from './editor-setup'
import { extension, formatBytes } from './format'
import { ltr, messages, pl } from './i18n'
import { common } from './i18n-common'
import { type IconName, icon } from './icons'
import { showMenuFor } from './menu'
import type { PickItem } from './plugins/api'
import { pick } from './plugins/palette'
import { menuItems } from './plugins/registry'
import { type PolishResult, polishKindFor, polishText } from './polish'
import { describeError, type Entry, errorKind } from './protocol'
import { tabOf } from './sessions'
import { settings, updateSettings } from './settings-store'

const t = messages({
  current: { zh: '当前', en: 'Current', ug: 'نۆۋەتتىكى' },
  pickSaveEncoding: {
    zh: '选择保存用的编码',
    en: 'Choose an encoding to save with',
    ug: 'ساقلاشتا ئىشلىتىدىغان كودلاشنى تاللاڭ',
  },
  pickReopenEncoding: {
    zh: '选择重新打开用的编码',
    en: 'Choose an encoding to reopen with',
    ug: 'قايتا ئېچىشتا ئىشلىتىدىغان كودلاشنى تاللاڭ',
  },
  remoteChangedTitle: {
    zh: '服务器上的文件已变化',
    en: 'The file changed on the server',
    ug: 'مۇلازىمېتىردىكى ھۆججەت ئۆزگەرگەن',
  },
  remoteChanged: {
    zh: '{path}\n在你下载之后被修改过。继续上传会覆盖服务器上的这些修改。',
    en: '{path}\nwas modified after you downloaded it. Uploading overwrites those changes on the server.',
    ug: '{path}\nسىز چۈشۈرگەندىن كېيىن ئۆزگەرتىلگەن. داۋاملىق يۈكلىسىڭىز مۇلازىمېتىردىكى بۇ ئۆزگىرىشلەر قاپلىنىدۇ.',
  },
  overwriteAnyway: { zh: '仍然覆盖', en: 'Overwrite anyway', ug: 'يەنىلا قاپلا' },
  uploaded: { zh: '已上传 {path}', en: 'Uploaded {path}', ug: '{path} يۈكلەندى' },
  // Separates the polish steps, which polish.ts describes one by one.
  changeSeparator: { zh: '；', en: '; ', ug: '؛ ' },
  alreadyTidy: {
    zh: '内容已经很整洁，没有需要润色的地方',
    en: 'Already tidy; nothing to polish',
    ug: 'مەزمۇن ئاللىقاچان رەتلىك، پەردازلايدىغان يېرى يوق',
  },
  polished: {
    zh: '已润色（Ctrl+Z 可撤销）：{changes}',
    en: 'Polished (Ctrl+Z to undo): {changes}',
    ug: 'پەردازلاندى (Ctrl+Z بىلەن يېنىۋالغىلى بولىدۇ): {changes}',
  },
  syntax: { zh: '语法', en: 'Syntax', ug: 'گرامماتىكا' },
  syntaxTitle: {
    zh: '语法着色使用的语言',
    en: 'Language for syntax highlighting',
    ug: 'گرامماتىكا رەڭلەشتە ئىشلىتىلىدىغان تىل',
  },
  plainText: { zh: '纯文本', en: 'Plain text', ug: 'ساپ تېكىست' },
  features: { zh: '功能', en: 'Features', ug: 'ئىقتىدار' },
  featuresTitle: {
    zh: '开关编辑器功能',
    en: 'Turn editor features on or off',
    ug: 'تەھرىرلىگۈچ ئىقتىدارلىرىنى ئاچ ياكى تاقا',
  },
  foldAll: { zh: '全部折叠', en: 'Fold all', ug: 'ھەممىنى قاتلا' },
  unfoldAll: { zh: '全部展开', en: 'Unfold all', ug: 'ھەممىنى ياي' },
  format: { zh: '格式化', en: 'Format', ug: 'فورماتلا' },
  formatTitle: {
    zh: '整理缩进和换行（Shift+Alt+F）',
    en: 'Tidy indentation and line breaks (Shift+Alt+F)',
    ug: 'كەڭلىك ۋە قۇر ئالماشتۇرۇشنى رەتلە (Shift+Alt+F)',
  },
  problemsTitle: {
    zh: '问题列表（Ctrl+Shift+M），F8 跳到下一个',
    en: 'Problems (Ctrl+Shift+M); F8 goes to the next one',
    ug: 'مەسىلە تىزىملىكى (Ctrl+Shift+M)، F8 كېيىنكىسىگە يۆتكىلىدۇ',
  },
  encodingTitle: {
    zh: '文件编码：通过编码重新打开或保存',
    en: 'File encoding: reopen or save with an encoding',
    ug: 'ھۆججەت كودلاش: كودلاش بىلەن قايتا ئېچىش ياكى ساقلاش',
  },
  reopenWithEncoding: {
    zh: '通过编码重新打开…',
    en: 'Reopen with encoding…',
    ug: 'كودلاش بىلەن قايتا ئاچ…',
  },
  saveWithEncoding: { zh: '通过编码保存…', en: 'Save with encoding…', ug: 'كودلاش بىلەن ساقلا…' },
  eolTitle: {
    zh: '行尾序列，点击切换 LF / CRLF',
    en: 'Line ending; click to switch between LF and CRLF',
    ug: 'قۇر ئاخىرى، LF / CRLF نى ئالماشتۇرۇش ئۈچۈن چېكىڭ',
  },
  localCopy: { zh: '本地副本', en: 'Local copy', ug: 'يەرلىك نۇسخا' },
  showInExplorer: {
    zh: '在资源管理器中显示',
    en: 'Show in Explorer',
    ug: 'ھۆججەت باشقۇرغۇچتا كۆرسەت',
  },
  editorTools: { zh: '编辑器工具', en: 'Editor tools', ug: 'تەھرىرلىگۈچ قوراللىرى' },
  findReplace: { zh: '查找替换', en: 'Find and replace', ug: 'ئىزدە/ئالماشتۇر' },
  findReplaceTitle: {
    zh: '查找和替换（Ctrl+F，F3 下一个）',
    en: 'Find and replace (Ctrl+F, F3 for the next match)',
    ug: 'ئىزدەش ۋە ئالماشتۇرۇش (Ctrl+F، F3 كېيىنكىسى)',
  },
  goToLine: { zh: '跳转到行', en: 'Go to line', ug: 'قۇرغا يۆتكەل' },
  goToLineTitle: {
    zh: '跳转到行（Ctrl+Alt+G）',
    en: 'Go to line (Ctrl+Alt+G)',
    ug: 'قۇرغا يۆتكەل (Ctrl+Alt+G)',
  },
  dismiss: { zh: '忽略', en: 'Dismiss', ug: 'پەرۋا قىلما' },
  saveLocal: { zh: '保存到本地', en: 'Save locally', ug: 'يەرلىككە ساقلا' },
  saveUpload: { zh: '保存并上传', en: 'Save and upload', ug: 'ساقلاپ يۈكلە' },
  stateDirty: { zh: '有未保存的修改', en: 'Unsaved changes', ug: 'ساقلانمىغان ئۆزگىرىش بار' },
  statePending: {
    zh: '已保存到本地，尚未上传',
    en: 'Saved locally, not uploaded yet',
    ug: 'يەرلىككە ساقلاندى، تېخى يۈكلەنمىدى',
  },
  stateClean: { zh: '与服务器一致', en: 'Same as on the server', ug: 'مۇلازىمېتىر بىلەن ئوخشاش' },
  cursor: {
    zh: '行 {line}，列 {column}',
    en: 'Ln {line}, Col {column}',
    ug: 'قۇر {line}، ئىستون {column}',
  },
  cursorSelected: {
    zh: '行 {line}，列 {column}（已选 {n}）',
    en: 'Ln {line}, Col {column} ({n} selected)',
    ug: 'قۇر {line}، ئىستون {column} ({n} تاللاندى)',
  },
  indentTabs: { zh: '制表符 {n}', en: 'Tab size: {n}', ug: 'جەدۋەل بەلگىسى {n}' },
  indentSpaces: { zh: '空格 {n}', en: 'Spaces: {n}', ug: 'بوشلۇق {n}' },
  errors: { zh: '{n} 个错误', en: pl('error'), ug: '{n} خاتالىق' },
  warnings: { zh: '{n} 个警告', en: pl('warning'), ug: '{n} ئاگاھلاندۇرۇش' },
  errorsAndWarnings: {
    zh: '{errors} 个错误，{warnings} 个警告',
    en: (p) => `${pl('error')({ n: p.errors })}, ${pl('warning')({ n: p.warnings })}`,
    ug: '{errors} خاتالىق، {warnings} ئاگاھلاندۇرۇش',
  },
  noProblems: { zh: '没有问题', en: 'No problems', ug: 'مەسىلە يوق' },
  editLabel: { zh: '编辑 {name}', en: 'Edit {name}', ug: '{name} نى تەھرىرلەش' },
  formatDocument: { zh: '格式化文档', en: 'Format document', ug: 'ھۆججەتنى فورماتلا' },
  formatSelection: {
    zh: '格式化选中部分',
    en: 'Format selection',
    ug: 'تاللانغان قىسمىنى فورماتلا',
  },
  minified: {
    zh: '这个文件像是压缩成一行的代码。格式化后会按语句和标签分行，Ctrl+Z 可以撤销。',
    en: 'This file looks like code minified onto one line. Formatting puts statements and tags on their own lines; Ctrl+Z undoes it.',
    ug: 'بۇ ھۆججەت بىر قۇرغا قىسىلغان كودقا ئوخشايدۇ. فورماتلىسا جۈملە ۋە خەتكۈچلەر ئايرىم قۇرلارغا بۆلۈنىدۇ، Ctrl+Z بىلەن يېنىۋالغىلى بولىدۇ.',
  },
  wordWrap: { zh: '自动换行', en: 'Word wrap', ug: 'ئاپتوماتىك قۇر قاتلاش' },
  lossyTitle: {
    zh: '文件里有无法识别的字节',
    en: 'The file has bytes that could not be decoded',
    ug: 'ھۆججەتتە پەرقلەندۈرگىلى بولمايدىغان بايتلار بار',
  },
  lossySave: {
    zh: '按 {encoding} 打开时，部分字节无法解码，显示成了“�”。保存后这些字节会被改写。',
    en: 'Some bytes could not be decoded as {encoding} and show as “�”. Saving rewrites them.',
    ug: '{encoding} بويىچە ئاچقاندا بەزى بايتلار يېشىلمەي «�» بولۇپ كۆرۈندى. ساقلىسىڭىز بۇ بايتلار ئۆزگەرتىپ يېزىلىدۇ.',
  },
  saveAnyway: { zh: '仍然保存', en: 'Save anyway', ug: 'يەنىلا ساقلا' },
  savedLocal: {
    zh: '已保存到本地（{encoding}，{eol}）：{path}',
    en: 'Saved locally ({encoding}, {eol}): {path}',
    ug: 'يەرلىككە ساقلاندى ({encoding}، {eol}): {path}',
  },
  reopenTitle: {
    zh: '通过编码重新打开',
    en: 'Reopen with encoding',
    ug: 'كودلاش بىلەن قايتا ئېچىش',
  },
  reopenDirty: {
    zh: '有修改还没保存。重新打开会丢失这些修改。',
    en: 'You have unsaved changes. Reopening discards them.',
    ug: 'ساقلانمىغان ئۆزگىرىش بار. قايتا ئاچسىڭىز بۇ ئۆزگىرىشلەر يوقىلىدۇ.',
  },
  discardChanges: { zh: '放弃修改', en: 'Discard changes', ug: 'ئۆزگىرىشتىن ۋاز كەچ' },
  lossyReopened: {
    zh: '部分字节无法按 {encoding} 解码，显示成了“�”。可能需要换一种编码重新打开。',
    en: 'Some bytes could not be decoded as {encoding} and show as “�”. You may need to reopen the file with another encoding.',
    ug: 'بەزى بايتلارنى {encoding} بويىچە يېشەلمەي «�» بولۇپ كۆرۈندى. باشقا كودلاش بىلەن قايتا ئېچىشقا توغرا كېلىشى مۇمكىن.',
  },
  otherEncoding: { zh: '换一种编码', en: 'Try another encoding', ug: 'باشقا كودلاشنى سىنا' },
  reopened: {
    zh: '已按 {encoding} 重新打开',
    en: 'Reopened as {encoding}',
    ug: '{encoding} بويىچە قايتا ئېچىلدى',
  },
  uploadTitle: { zh: '上传到服务器', en: 'Upload to server', ug: 'مۇلازىمېتىرغا يۈكلەش' },
  uploadConfirm: {
    zh: '用本地副本覆盖服务器上的\n{path}？',
    en: 'Overwrite this file on the server with the local copy?\n{path}',
    ug: 'مۇلازىمېتىردىكى بۇ ھۆججەتنى يەرلىك نۇسخا بىلەن قاپلامسىز؟\n{path}',
  },
  closeDirty: {
    zh: '有修改还没保存。关闭后这些修改会丢失。',
    en: 'You have unsaved changes. Closing discards them.',
    ug: 'ساقلانمىغان ئۆزگىرىش بار. ياپسىڭىز بۇ ئۆزگىرىشلەر يوقىلىدۇ.',
  },
  closePending: {
    zh: '本地副本已保存，但还没有上传到服务器。',
    en: 'The local copy is saved but not uploaded to the server yet.',
    ug: 'يەرلىك نۇسخا ساقلاندى، ئەمما تېخى مۇلازىمېتىرغا يۈكلەنمىدى.',
  },
  closeTitle: { zh: '关闭编辑器', en: 'Close editor', ug: 'تەھرىرلىگۈچنى يېپىش' },
  closeAnyway: { zh: '仍然关闭', en: 'Close anyway', ug: 'يەنىلا ياپ' },
  polish: { zh: '润色', en: 'Polish', ug: 'پەردازلا' },
  externalLabel: {
    zh: '外部编辑中的文件',
    en: 'Files open in external editors',
    ug: 'سىرتقى تەھرىرلىگۈچتە ئېچىلغان ھۆججەتلەر',
  },
  externalHeading: { zh: '外部编辑', en: 'External edits', ug: 'سىرتقى تەھرىرلەش' },
  externalModified: {
    zh: '有未上传的修改',
    en: 'Changes not uploaded',
    ug: 'يۈكلەنمىگەن ئۆزگىرىش بار',
  },
  externalEditing: { zh: '编辑中', en: 'Editing', ug: 'تەھرىرلىنىۋاتىدۇ' },
  uploadChangesTitle: { zh: '上传修改', en: 'Upload changes', ug: 'ئۆزگىرىشنى يۈكلەش' },
  uploadChanges: {
    zh: '{name} 已在本地保存，要上传到服务器吗？\n{path}',
    en: '{name} was saved locally. Upload it to the server?\n{path}',
    ug: '{name} يەرلىكتە ساقلاندى، مۇلازىمېتىرغا يۈكلەمسىز؟\n{path}',
  },
  alreadyExternal: {
    zh: '{name} 已在外部编辑器中打开，保存后会提示上传。',
    en: '{name} is already open in an external editor; saving it offers an upload.',
    ug: '{name} سىرتقى تەھرىرلىگۈچتە ئېچىلغان، ساقلىغاندىن كېيىن يۈكلەش سورىلىدۇ.',
  },
  uploadName: { zh: '上传 {name}', en: 'Upload {name}', ug: '{name} نى يۈكلە' },
  showLocalCopy: { zh: '显示本地副本', en: 'Show local copy', ug: 'يەرلىك نۇسخىنى كۆرسەت' },
  finish: { zh: '结束', en: 'Stop', ug: 'ئاخىرلاشتۇر' },
  finishName: {
    zh: '结束编辑 {name}',
    en: 'Stop editing {name}',
    ug: '{name} نى تەھرىرلەشنى ئاخىرلاشتۇر',
  },
  finishTitle: { zh: '结束编辑', en: 'Stop editing', ug: 'تەھرىرلەشنى ئاخىرلاشتۇرۇش' },
  finishConfirm: { zh: '结束编辑', en: 'Stop editing', ug: 'ئاخىرلاشتۇر' },
  finishModified: {
    zh: '{name} 有修改还没上传。结束后不会再提示上传，本地副本会保留。',
    en: '{name} has changes that are not uploaded. After you stop, saving no longer offers an upload; the local copy is kept.',
    ug: '{name} دا يۈكلەنمىگەن ئۆزگىرىش بار. ئاخىرلاشتۇرغاندىن كېيىن يۈكلەش سورالمايدۇ، يەرلىك نۇسخا ساقلىنىپ قالىدۇ.',
  },
  openedExternal: {
    zh: '已用外部程序打开 {name}，保存后会提示上传。',
    en: 'Opened {name} in an external program; saving it offers an upload.',
    ug: '{name} سىرتقى پروگراممىدا ئېچىلدى، ساقلىغاندىن كېيىن يۈكلەش سورىلىدۇ.',
  },
  imageBroken: {
    zh: '无法显示这张图片，文件可能已损坏。',
    en: 'Cannot display this image. The file may be damaged.',
    ug: 'بۇ رەسىمنى كۆرسىتەلمىدى، ھۆججەت بۇزۇلغان بولۇشى مۇمكىن.',
  },
})

interface EditOpened {
  editId: number
  local: string
  text: Decoded | null
}

type EncodingChoice = { encoding: string; bom: boolean }

/** Saving offers UTF-8 with and without BOM; UTF-16 is always saved with one. */
function pickEncoding(current: Decoded, saving: boolean): Promise<EncodingChoice | null> {
  const items: PickItem<EncodingChoice>[] = []
  for (const e of ENCODINGS) {
    const variants: EncodingChoice[] =
      saving && e.id === 'utf-8'
        ? [
            { encoding: e.id, bom: false },
            { encoding: e.id, bom: true },
          ]
        : [{ encoding: e.id, bom: e.id.startsWith('utf-16') }]
    for (const choice of variants) {
      const isCurrent =
        choice.encoding === current.encoding && (!saving || choice.bom === current.bom)
      items.push({
        label: saving ? encodingLabel(choice) : e.name,
        detail: e.detail,
        hint: isCurrent ? t('current') : undefined,
        value: choice,
      })
    }
  }
  return pick(items, saving ? t('pickSaveEncoding') : t('pickReopenEncoding'))
}

type EditEvent = { type: 'modified' }

const report = reportError

/** Logs the local copy that `run` fetches in the tab's own download manager. */
async function trackCopy<T>(
  kind: Exclude<RecordKind, 'download'>,
  sessionId: number,
  entry: Entry,
  run: () => Promise<T>,
  localOf: (value: T) => string | Promise<string>,
): Promise<T> {
  const record = addRecord(kind, tabOf(sessionId), entry.name, entry.path)
  try {
    const value = await run()
    const local = await Promise.resolve(localOf(value)).catch(() => '')
    updateRecord(record, {
      state: 'done',
      local,
      bytesDone: entry.size,
      bytesTotal: entry.size,
    })
    return value
  } catch (error) {
    if (errorKind(error) === 'exists') discardRecord(record)
    else updateRecord(record, { state: 'failed', message: describeError(error) })
    throw error
  }
}

const reveal = (path: string) => invoke('reveal_local', { path }).catch(report)

/**
 * Uploads the local copy. If the server copy changed since it was downloaded, asks before
 * overwriting. Resolves false when the user backs out.
 */
async function uploadEdit(editId: number, remote: string): Promise<boolean> {
  try {
    await invoke('edit_upload', { editId, force: false })
  } catch (error) {
    if (errorKind(error) !== 'remote_changed') throw error
    const force = await confirmDialog(
      t('remoteChangedTitle'),
      t('remoteChanged', { path: ltr(remote) }),
      t('overwriteAnyway'),
      true,
    )
    if (!force) return false
    await invoke('edit_upload', { editId, force: true })
  }
  setStatus(t('uploaded', { path: ltr(remote) }))
  return true
}

/** Replaces the document with the polished text as one undoable step. */
export function applyPolish(view: EditorView, result: PolishResult): void {
  if (result.text === view.state.doc.toString()) {
    setStatus(result.changes.length ? result.changes.join(t('changeSeparator')) : t('alreadyTidy'))
    return
  }
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: result.text },
    userEvent: 'input.polish',
    scrollIntoView: true,
  })
  setStatus(t('polished', { changes: result.changes.join(t('changeSeparator')) }))
}

/** Built-in editor: downloads into the work directory, saves there, uploads only on request. */
export async function editInternal(sessionId: number, entry: Entry): Promise<void> {
  const opened = await trackCopy(
    'edit',
    sessionId,
    entry,
    () =>
      invoke<EditOpened>('edit_open', {
        sessionId,
        remote: entry.path,
        mode: 'internal',
        onEvent: new Channel<EditEvent>(),
      }),
    (o) => o.local,
  )
  let file: Decoded = opened.text ?? { text: '', encoding: 'utf-8', bom: false, lossy: false }
  let eol = detectEol(file.text)
  const parts = modal('editor', ltr(entry.path), 'xl')
  parts.body.classList.add('editor-body')
  const host = h('div', { class: 'editor-host' })
  const state = h('span', { class: 'editor-state grow', role: 'status' })
  const cursor = h('span', { class: 'editor-cursor num', 'aria-live': 'off' })
  const indent = h('span', { class: 'editor-indent' })
  const banner = h('div', { class: 'editor-banner', role: 'status', hidden: true })
  const detected = languageFor(entry.name, entry.path, file.text)
  const languageSelect = h(
    'select',
    { class: 'editor-language', 'aria-label': t('syntax'), title: t('syntaxTitle') },
    h('option', { value: '', text: t('plainText') }),
    (Object.keys(LANGUAGE_NAMES) as LanguageId[]).map((id) =>
      h('option', { value: id, text: LANGUAGE_NAMES[id], selected: id === detected }),
    ),
  )
  const tool = (iconName: IconName, label: string, title: string, onclick: () => void) =>
    h(
      'button',
      { type: 'button', class: 'button small quiet', title, onclick },
      icon(iconName),
      label,
    )
  const statusItem = (title: string, onclick: () => void) =>
    h('button', { type: 'button', class: 'button small quiet editor-status', title, onclick })
  const featuresButton = tool('puzzle-piece', t('features'), t('featuresTitle'), () =>
    showMenuFor(featuresButton, [
      ...editorFeatureItems(),
      'separator',
      { label: t('foldAll'), action: () => foldAll(view) },
      { label: t('unfoldAll'), action: () => unfoldAll(view) },
    ]),
  )
  const formatButton = tool('brackets-curly', t('format'), t('formatTitle'), () => void formatNow())
  const problemsButton = statusItem(t('problemsTitle'), () => {
    openLintPanel(view)
  })
  const encodingButton = statusItem(t('encodingTitle'), () =>
    showMenuFor(encodingButton, [
      { label: t('reopenWithEncoding'), action: () => void run(reopenWithEncoding) },
      { label: t('saveWithEncoding'), action: () => void run(saveWithEncoding) },
    ]),
  )
  const eolButton = statusItem(t('eolTitle'), () => {
    eol = eol === '\n' ? '\r\n' : '\n'
    dirty = true
    paint()
    paintStatus(view.state)
    view.focus()
  })
  parts.body.append(
    h(
      'p',
      { class: 'editor-local' },
      h('span', { text: t('localCopy') }),
      h('span', { class: 'mono cell-text', text: opened.local, title: opened.local }),
      h('button', {
        type: 'button',
        class: 'button small quiet',
        text: t('showInExplorer'),
        onclick: () => reveal(opened.local),
      }),
    ),
    h(
      'div',
      { class: 'editor-toolbar', role: 'toolbar', 'aria-label': t('editorTools') },
      tool('magnifying-glass', t('findReplace'), t('findReplaceTitle'), () => {
        openSearchPanel(view)
      }),
      tool('list-numbers', t('goToLine'), t('goToLineTitle'), () => {
        gotoLine(view)
      }),
      formatButton,
      featuresButton,
      languageSelect,
      h('span', { class: 'grow' }),
      problemsButton,
      cursor,
      indent,
      encodingButton,
      eolButton,
    ),
    banner,
    host,
  )

  const showBanner = (text: string, actions: [string, () => void][] = []) => {
    banner.replaceChildren(
      icon('info'),
      h('span', { class: 'grow', text }),
      ...actions.map(([label, action]) =>
        h('button', { type: 'button', class: 'button small', text: label, onclick: action }),
      ),
      h('button', {
        type: 'button',
        class: 'button small quiet',
        text: t('dismiss'),
        onclick: () => {
          banner.hidden = true
          view.focus()
        },
      }),
    )
    banner.hidden = false
  }

  // dirty: edits not yet written locally. pending: written locally, not yet uploaded.
  let dirty = false
  let pending = false
  let busy = false
  const saveButton = button(t('saveLocal'), () => void run(() => saveLocal()))
  const uploadButton = button(t('saveUpload'), () => void run(upload), 'primary')
  const paint = () => {
    state.textContent = dirty ? t('stateDirty') : pending ? t('statePending') : t('stateClean')
    state.dataset.tone = dirty || pending ? 'pending' : 'clean'
    saveButton.disabled = busy || !dirty
    uploadButton.disabled = busy
  }
  const paintStatus = (s: EditorState) => {
    const head = s.selection.main.head
    const line = s.doc.lineAt(head)
    const chosen = s.selection.ranges.reduce((n, r) => n + r.to - r.from, 0)
    const where = { line: line.number, column: head - line.from + 1 }
    cursor.textContent = chosen ? t('cursorSelected', { ...where, n: chosen }) : t('cursor', where)
    const unit = s.facet(indentUnit)
    indent.textContent =
      unit === '\t' ? t('indentTabs', { n: s.tabSize }) : t('indentSpaces', { n: unit.length })
    encodingButton.textContent = encodingLabel(file)
    encodingButton.dataset.tone = file.lossy ? 'warning' : ''
    eolButton.textContent = eol === '\n' ? 'LF' : 'CRLF'
    formatButton.disabled = !canFormat(s.facet(languageId))
    let errors = 0
    let warnings = 0
    forEachDiagnostic(s, (d) => {
      if (d.severity === 'error') errors++
      else if (d.severity === 'warning') warnings++
    })
    problemsButton.hidden = !settings().editor.lint
    problemsButton.dataset.tone = errors ? 'error' : warnings ? 'warning' : ''
    problemsButton.replaceChildren(
      icon(errors ? 'x-circle' : warnings ? 'warning' : 'check-circle'),
      errors && warnings
        ? t('errorsAndWarnings', { errors, warnings })
        : errors
          ? t('errors', { n: errors })
          : warnings
            ? t('warnings', { n: warnings })
            : t('noProblems'),
    )
  }

  const language = new Compartment()
  let languageExt: Extension = []
  const keys: KeyBinding[] = [
    {
      key: 'Mod-s',
      run: () => {
        void run(upload)
        return true
      },
    },
  ]
  const extensions = (doc: string): Extension => [
    editorSetup(keys, doc),
    language.of(languageExt),
    EditorView.contentAttributes.of({ 'aria-label': t('editLabel', { name: ltr(entry.name) }) }),
    editMenu((v) => [
      { label: t('findReplace'), icon: 'magnifying-glass', action: () => void openSearchPanel(v) },
      { label: t('goToLine'), icon: 'list-numbers', action: () => void gotoLine(v) },
      {
        label: v.state.selection.main.empty ? t('formatDocument') : t('formatSelection'),
        icon: 'brackets-curly',
        disabled: !canFormat(v.state.facet(languageId)),
        action: () => void formatNow(),
      },
      'separator',
      {
        label: t('saveLocal'),
        icon: 'floppy-disk',
        disabled: busy || !dirty,
        action: () => void run(() => saveLocal()),
      },
      {
        label: t('saveUpload'),
        icon: 'cloud-arrow-up',
        disabled: busy,
        action: () => void run(upload),
      },
      ...menuItems('editor/context', { sessionId, path: entry.path, selection: selectedText(v) }),
    ]),
    EditorView.updateListener.of((update) => {
      if (update.docChanged && !dirty) {
        dirty = true
        paint()
      }
      if (update.docChanged || update.selectionSet || update.transactions.length > 0) {
        paintStatus(update.state)
      }
    }),
  ]
  const view = new EditorView({
    state: EditorState.create({ doc: file.text, extensions: extensions(file.text) }),
    parent: host,
  })
  paintStatus(view.state)
  let languageToken = 0
  let languageReady: Promise<void> = Promise.resolve()
  const setLanguage = (id: LanguageId | null) => {
    const token = ++languageToken
    if (!id) {
      languageExt = []
      view.dispatch({ effects: language.reconfigure([]) })
      languageReady = Promise.resolve()
      return
    }
    languageReady = loadLanguage(id)
      .then((ext) => {
        if (token !== languageToken) return
        languageExt = ext
        view.dispatch({ effects: language.reconfigure(ext) })
      })
      .catch(report)
  }
  languageSelect.addEventListener('change', () => {
    setLanguage((languageSelect.value || null) as LanguageId | null)
  })
  setLanguage(detected)
  if (looksMinified(file.text)) {
    showBanner(t('minified'), [
      [
        t('format'),
        () => {
          banner.hidden = true
          void formatNow()
        },
      ],
      [
        t('wordWrap'),
        () => {
          banner.hidden = true
          void updateSettings((d) => {
            d.editor.wordWrap = true
          }).catch(report)
        },
      ],
    ])
  }

  async function formatNow(): Promise<void> {
    await languageReady
    try {
      await formatDocument(view)
    } catch (error) {
      report(error)
    }
    view.focus()
  }

  async function saveLocal(force = false): Promise<void> {
    if (!dirty && !force) return
    if (file.lossy) {
      const ok = await confirmDialog(
        t('lossyTitle'),
        t('lossySave', { encoding: ltr(encodingLabel(file)) }),
        t('saveAnyway'),
        true,
      )
      if (!ok) return
    }
    if (settings().editor.formatOnSave && canFormat(view.state.facet(languageId))) {
      // A file that cannot be formatted (e.g. broken syntax) is still saved as it is.
      const change = await formatChange(view.state).catch(() => null)
      if (change) view.dispatch(change)
    }
    const { doc } = view.state
    await invoke('edit_save_local', {
      editId: opened.editId,
      text: doc.sliceString(0, doc.length, eol),
      encoding: file.encoding,
      bom: file.bom,
    })
    file = { ...file, lossy: false }
    dirty = false
    pending = true
    paintStatus(view.state)
    setStatus(
      t('savedLocal', {
        encoding: ltr(encodingLabel(file)),
        eol: eol === '\n' ? 'LF' : 'CRLF',
        path: ltr(opened.local),
      }),
    )
  }

  async function reopenWithEncoding(): Promise<void> {
    const choice = await pickEncoding(file, false)
    if (!choice) return
    if (
      dirty &&
      !(await confirmDialog(t('reopenTitle'), t('reopenDirty'), t('discardChanges'), true))
    ) {
      return
    }
    file = await invoke<Decoded>('edit_reopen', {
      editId: opened.editId,
      encoding: choice.encoding,
    })
    eol = detectEol(file.text)
    view.setState(EditorState.create({ doc: file.text, extensions: extensions(file.text) }))
    dirty = false
    paint()
    paintStatus(view.state)
    if (file.lossy) {
      showBanner(t('lossyReopened', { encoding: ltr(encodingLabel(file)) }), [
        [t('otherEncoding'), () => void run(reopenWithEncoding)],
      ])
    } else {
      banner.hidden = true
      setStatus(t('reopened', { encoding: ltr(encodingLabel(file)) }))
    }
  }

  async function saveWithEncoding(): Promise<void> {
    const choice = await pickEncoding(file, true)
    if (!choice) return
    const previous = file
    file = { ...file, ...choice }
    try {
      await saveLocal(true)
    } catch (error) {
      file = previous
      paintStatus(view.state)
      throw error
    }
  }

  async function upload(): Promise<void> {
    await saveLocal()
    const ok = await confirmDialog(
      t('uploadTitle'),
      t('uploadConfirm', { path: ltr(entry.path) }),
      common('upload'),
    )
    if (ok && (await uploadEdit(opened.editId, entry.path))) pending = false
  }

  async function run(task: () => Promise<void>): Promise<void> {
    if (busy) return
    busy = true
    paint()
    try {
      await task()
    } catch (error) {
      report(error)
    } finally {
      busy = false
      paint()
      view.focus()
    }
  }

  let closing = false
  const requestClose = async () => {
    if (closing) return
    closing = true
    const message = dirty ? t('closeDirty') : pending ? t('closePending') : ''
    const ok =
      !message ||
      (await confirmDialog(
        t('closeTitle'),
        message,
        dirty ? t('discardChanges') : t('closeAnyway'),
        dirty,
      ))
    closing = false
    if (ok) parts.dialog.close()
  }
  parts.dialog.addEventListener('cancel', (event) => {
    event.preventDefault()
    void requestClose()
  })
  parts.dialog.addEventListener('close', () => {
    view.destroy()
    parts.dialog.remove()
    invoke('edit_close', { editId: opened.editId }).catch(report)
  })
  parts.actions.append(
    state,
    button(common('close'), () => void requestClose()),
    button(t('polish'), () => {
      applyPolish(view, polishText(view.state.doc.toString(), polishKindFor(entry.name)))
      view.focus()
    }),
    saveButton,
    uploadButton,
  )
  paint()
  parts.dialog.showModal()
  view.focus()
}

interface External {
  editId: number
  sessionId: number
  remote: string
  local: string
  modified: boolean
  asking: boolean
  row: HTMLElement
  state: HTMLElement
}

const externals = new Map<number, External>()
const externalList = h('ul', { class: 'edits-list' })

/** Files open in an external editor; lives under the file table. */
export const externalEdits = h(
  'section',
  { class: 'edits', 'aria-label': t('externalLabel'), hidden: true },
  h('h3', { class: 'edits-title', text: t('externalHeading') }),
  externalList,
)

function paintExternal(item: External): void {
  item.row.dataset.state = item.modified ? 'modified' : 'clean'
  item.state.textContent = item.modified ? t('externalModified') : t('externalEditing')
  externalEdits.hidden = externals.size === 0
}

async function uploadExternal(item: External): Promise<void> {
  if (item.asking) return
  item.asking = true
  try {
    if (await uploadEdit(item.editId, item.remote)) {
      item.modified = false
      paintExternal(item)
    }
  } catch (error) {
    report(error)
  } finally {
    item.asking = false
  }
}

async function askExternal(item: External): Promise<void> {
  if (item.asking) return
  item.asking = true
  const name = item.remote.slice(item.remote.lastIndexOf('/') + 1)
  const ok = await confirmDialog(
    t('uploadChangesTitle'),
    t('uploadChanges', { name: ltr(name), path: ltr(item.remote) }),
    common('upload'),
  )
  item.asking = false
  if (ok) await uploadExternal(item)
}

function dropExternal(item: External): void {
  externals.delete(item.editId)
  item.row.remove()
  externalEdits.hidden = externals.size === 0
  invoke('edit_close', { editId: item.editId }).catch(report)
}

/**
 * Opens the local copy in `program` (or the configured external program) and offers an upload on
 * each save.
 */
export async function editExternal(
  sessionId: number,
  entry: Entry,
  program: string | null = null,
): Promise<void> {
  const existing = [...externals.values()].find(
    (e) => e.sessionId === sessionId && e.remote === entry.path,
  )
  if (existing) {
    setStatus(t('alreadyExternal', { name: ltr(entry.name) }))
    existing.row.querySelector('button')?.focus()
    return
  }
  const events = new Channel<EditEvent>()
  const opened = await trackCopy(
    'edit',
    sessionId,
    entry,
    () =>
      invoke<EditOpened>('edit_open', {
        sessionId,
        remote: entry.path,
        mode: 'external',
        program,
        onEvent: events,
      }),
    (o) => o.local,
  )
  const state = h('span', { class: 'edit-state' })
  const row = h('li', { class: 'edit', title: `${entry.path}\n${opened.local}` })
  const item: External = {
    editId: opened.editId,
    sessionId,
    remote: entry.path,
    local: opened.local,
    modified: false,
    asking: false,
    row,
    state,
  }
  row.append(
    h('span', { class: 'edit-name cell-text', text: entry.name }),
    state,
    h('button', {
      type: 'button',
      class: 'button small quiet',
      text: common('upload'),
      'aria-label': t('uploadName', { name: ltr(entry.name) }),
      onclick: () => void uploadExternal(item),
    }),
    h('button', {
      type: 'button',
      class: 'button small quiet',
      text: t('showLocalCopy'),
      onclick: () => reveal(item.local),
    }),
    h('button', {
      type: 'button',
      class: 'button small quiet',
      text: t('finish'),
      'aria-label': t('finishName', { name: ltr(entry.name) }),
      onclick: async () => {
        if (
          item.modified &&
          !(await confirmDialog(
            t('finishTitle'),
            t('finishModified', { name: ltr(entry.name) }),
            t('finishConfirm'),
            true,
          ))
        ) {
          return
        }
        dropExternal(item)
      },
    }),
  )
  events.onmessage = () => {
    if (!externals.has(item.editId)) return
    item.modified = true
    paintExternal(item)
    void askExternal(item)
  }
  externals.set(item.editId, item)
  externalList.append(row)
  paintExternal(item)
  setStatus(t('openedExternal', { name: ltr(entry.name) }))
}

/** Stops tracking external edits for a session that has gone away. */
export function closeEditsFor(sessionId: number): void {
  for (const item of [...externals.values()]) if (item.sessionId === sessionId) dropExternal(item)
}

const IMAGE_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
  avif: 'image/avif',
}

export function isImage(name: string): boolean {
  return Object.hasOwn(IMAGE_TYPES, extension(name))
}

export async function previewImage(sessionId: number, entry: Entry): Promise<void> {
  const bytes = await trackCopy(
    'preview',
    sessionId,
    entry,
    () => invoke<ArrayBuffer>('preview_image', { sessionId, remote: entry.path }),
    () => invoke<string>('mirror_local', { sessionId, remote: entry.path }),
  )
  const url = URL.createObjectURL(new Blob([bytes], { type: IMAGE_TYPES[extension(entry.name)] }))
  const parts = modal('preview', entry.name, 'lg')
  const meta = h('p', {
    class: 'help preview-meta',
    text: `${ltr(entry.path)} · ${ltr(formatBytes(bytes.byteLength))}`,
  })
  const image = h('img', { class: 'preview-image', src: url, alt: entry.name })
  image.addEventListener('load', () => {
    meta.textContent += ` · ${ltr(`${image.naturalWidth} × ${image.naturalHeight}`)}`
  })
  image.addEventListener('error', () => {
    image.replaceWith(h('p', { class: 'dialog-message', text: t('imageBroken') }))
  })
  parts.body.append(h('div', { class: 'preview-stage' }, image), meta)
  const close = button(common('close'), () => parts.dialog.close(), 'primary')
  parts.actions.append(close)
  parts.dialog.addEventListener('close', () => {
    URL.revokeObjectURL(url)
    parts.dialog.remove()
  })
  parts.dialog.showModal()
  close.focus()
}
