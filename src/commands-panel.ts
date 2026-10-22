import { Compartment, EditorSelection } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { writeText } from '@tauri-apps/plugin-clipboard-manager'
import { fillCommand, sendCommand } from './command-bar'
import {
  commandSummary,
  type Favorite,
  type FavoriteFolder,
  favoriteErrors,
  folderNameError,
  matchesQuery,
} from './commands-model'
import { confirmDialog, promptDialog } from './dialogs'
import { h, reportError, setStatus } from './dom'
import { applyPolish } from './editor'
import { loadLanguage } from './editor-languages'
import { editMenu, editorSetup, selectedText } from './editor-setup'
import {
  addFavorite,
  deleteFavorite,
  deleteFolder,
  favoriteFolders,
  favorites,
  favoritesError,
  loadFavorites,
  moveFavorite,
  onFavorites,
  openFavoriteDialog,
  saveFolder,
} from './favorites'
import { treeIcons } from './file-icons'
import { isRtl, ltr, messages, pl } from './i18n'
import { common } from './i18n-common'
import type { PanelHost } from './layout'
import { type MenuItem, showMenu, showMenuFor } from './menu'
import { menuItems } from './plugins/registry'
import { polishCommand } from './polish'

import { settings, updateSettings } from './settings-store'

const DRAFT_KEY = 'gx.commandEditor.draft'
const COLLAPSED_KEY = 'gx.favorites.collapsed'
const language = new Compartment()

const report = reportError
const run = (task: Promise<unknown>) => void task.catch(report)

const t = messages({
  confirmAgain: { zh: '再次确认删除', en: 'Confirm again', ug: 'قايتا جەزملەشتۈرۈڭ' },
  confirmAgainText: {
    zh: '删除后无法恢复。确定继续吗？',
    en: "This can't be undone. Continue?",
    ug: 'ئۆچۈرگەندىن كېيىن ئەسلىگە كەلتۈرگىلى بولمايدۇ. داۋاملاشتۇرامسىز؟',
  },
  deleteForGood: { zh: '确定删除', en: 'Delete permanently', ug: 'مەڭگۈلۈك ئۆچۈر' },
  editor: { zh: '指令编辑器', en: 'Command editor', ug: 'بۇيرۇق تەھرىرلىگۈچ' },
  editorTools: {
    zh: '指令编辑器工具',
    en: 'Command editor tools',
    ug: 'بۇيرۇق تەھرىرلىگۈچ قوراللىرى',
  },
  sendAllToTerminal: {
    zh: '发送全部到终端',
    en: 'Send all to terminal',
    ug: 'ھەممىنى تېرمىنالغا يوللا',
  },
  sendSelectionToTerminal: {
    zh: '发送选中到终端',
    en: 'Send selection to terminal',
    ug: 'تاللانغاننى تېرمىنالغا يوللا',
  },
  editorEmpty: { zh: '编辑器是空的', en: 'The editor is empty', ug: 'تەھرىرلىگۈچ بوش' },
  sent: { zh: '已发送：{command}', en: 'Sent: {command}', ug: 'يوللاندى: {command}' },
  sendSelection: { zh: '发送选中', en: 'Send selection', ug: 'تاللانغاننى يوللا' },
  sendSelectionHint: {
    zh: '只发送选中的部分',
    en: 'Send only the selected part',
    ug: 'پەقەت تاللانغان قىسمىنىلا يوللا',
  },
  sendAll: { zh: '发送全部', en: 'Send all', ug: 'ھەممىنى يوللا' },
  sendAllHint: {
    zh: '发送编辑器里的全部内容（Ctrl+Enter：有选中时只发送选中）',
    en: 'Send everything in the editor (Ctrl+Enter sends just the selection when there is one)',
    ug: 'تەھرىرلىگۈچتىكى ھەممە مەزمۇننى يوللا (Ctrl+Enter: تاللانغان بولسا پەقەت تاللانغاننىلا يوللايدۇ)',
  },
  clear: { zh: '清空', en: 'Clear', ug: 'تازىلا' },
  clearHint: {
    zh: '清空编辑器（Ctrl+Z 可撤销）',
    en: 'Clear the editor (Ctrl+Z undoes it)',
    ug: 'تەھرىرلىگۈچنى تازىلا (Ctrl+Z بىلەن يېنىۋالغىلى بولىدۇ)',
  },
  polish: { zh: '润色', en: 'Tidy', ug: 'رەتلە' },
  polishHint: {
    zh: '整理空白、续行符、制表符，修正从文档复制来的引号和破折号',
    en: 'Tidy whitespace, line continuations and tabs, and fix quotes and dashes copied from documents',
    ug: 'بوشلۇق، قۇر ئۇلاش بەلگىسى ۋە تاب بەلگىسىنى رەتلەيدۇ، ھۆججەتتىن كۆچۈرۈلگەن تىرناق ۋە سىزىقچىلارنى تۈزىتىدۇ',
  },
  favorite: { zh: '收藏', en: 'Favorite', ug: 'يىغقۇچقا قوش' },
  favoriteHint: {
    zh: '把选中的部分（没有选中时是全部内容）加入收藏',
    en: 'Add the selection (or everything, when nothing is selected) to favorites',
    ug: 'تاللانغان قىسمىنى (تاللانمىسا ھەممىنى) يىغقۇچقا قوش',
  },
  searchHint: {
    zh: '搜索指令或备注',
    en: 'Search commands or notes',
    ug: 'بۇيرۇق ياكى ئىزاھ ئىزدە',
  },
  search: { zh: '搜索收藏', en: 'Search favorites', ug: 'يىغقۇچتىن ئىزدە' },
  list: { zh: '收藏的指令', en: 'Favorite commands', ug: 'يىغىلغان بۇيرۇقلار' },
  deleteFavorite: { zh: '删除收藏', en: 'Delete favorite', ug: 'يىغىلغان بۇيرۇقنى ئۆچۈرۈش' },
  deleteFavoriteText: {
    zh: '删除这条收藏？\n{command}',
    en: 'Delete this favorite?\n{command}',
    ug: 'بۇ يىغىلغان بۇيرۇقنى ئۆچۈرەمسىز؟\n{command}',
  },
  newFolderTitle: { zh: '新建收藏夹', en: 'New folder', ug: 'يېڭى يىغقۇچ قىسقۇچى' },
  folderName: { zh: '收藏夹名称', en: 'Folder name', ug: 'قىسقۇچ ئاتى' },
  folderCreated: {
    zh: '已新建收藏夹「{name}」',
    en: 'Created folder "{name}"',
    ug: '«{name}» يىغقۇچ قىسقۇچى قۇرۇلدى',
  },
  renameFolderTitle: {
    zh: '重命名收藏夹',
    en: 'Rename folder',
    ug: 'يىغقۇچ قىسقۇچىنىڭ ئاتىنى ئۆزگەرتىش',
  },
  deleteFolderTitle: { zh: '删除收藏夹', en: 'Delete folder', ug: 'يىغقۇچ قىسقۇچىنى ئۆچۈرۈش' },
  deleteFolderText: {
    zh: '删除收藏夹「{name}」？',
    en: 'Delete folder "{name}"?',
    ug: '«{name}» يىغقۇچ قىسقۇچىنى ئۆچۈرەمسىز؟',
  },
  deleteFolderTextWith: {
    zh: '删除收藏夹「{name}」？\n里面的 {n} 条指令会移到未分组，不会被删除。',
    en: (p) =>
      `Delete folder "{name}"?\nIts ${pl('command')(p)} will move to Ungrouped and won't be deleted.`,
    ug: '«{name}» يىغقۇچ قىسقۇچىنى ئۆچۈرەمسىز؟\nئىچىدىكى {n} بۇيرۇق گۇرۇپپىسىزغا يۆتكىلىدۇ، ئۆچۈرۈلمەيدۇ.',
  },
  folderDeleted: {
    zh: '已删除收藏夹「{name}」',
    en: 'Deleted folder "{name}"',
    ug: '«{name}» يىغقۇچ قىسقۇچى ئۆچۈرۈلدى',
  },
  newCommand: { zh: '新建指令', en: 'New command', ug: 'يېڭى بۇيرۇق' },
  newCommandIn: {
    zh: '新建指令到「{name}」',
    en: 'New command in "{name}"',
    ug: '«{name}» قىسقۇچىغا يېڭى بۇيرۇق',
  },
  command: { zh: '指令', en: 'Command', ug: 'بۇيرۇق' },
  addFavorite: { zh: '加入收藏', en: 'Add to favorites', ug: 'يىغقۇچقا قوش' },
  added: {
    zh: '已加入收藏：{command}',
    en: 'Added to favorites: {command}',
    ug: 'يىغقۇچقا قوشۇلدى: {command}',
  },
  movedTo: {
    zh: '已移到「{name}」',
    en: 'Moved to "{name}"',
    ug: '«{name}» قىسقۇچىغا يۆتكەلدى',
  },
  movedUngrouped: { zh: '已移到未分组', en: 'Moved to Ungrouped', ug: 'گۇرۇپپىسىزغا يۆتكەلدى' },
  newCommandMenu: { zh: '新建指令…', en: 'New command…', ug: 'يېڭى بۇيرۇق…' },
  newFolderMenu: { zh: '新建收藏夹…', en: 'New folder…', ug: 'يېڭى يىغقۇچ قىسقۇچى…' },
  send: { zh: '发送', en: 'Send', ug: 'يوللا' },
  fillBar: { zh: '填入指令栏', en: 'Insert into command bar', ug: 'بۇيرۇق بالدىقىغا تولدۇر' },
  toEditor: { zh: '放入编辑器', en: 'Insert into editor', ug: 'تەھرىرلىگۈچكە قوي' },
  copyCommand: { zh: '复制指令', en: 'Copy command', ug: 'بۇيرۇقنى كۆچۈر' },
  copied: { zh: '已复制：{command}', en: 'Copied: {command}', ug: 'كۆچۈرۈلدى: {command}' },
  editFavorite: { zh: '编辑收藏…', en: 'Edit favorite…', ug: 'يىغىلغان بۇيرۇقنى تەھرىرلە…' },
  moveToFolder: {
    zh: '移动到收藏夹…',
    en: 'Move to folder…',
    ug: 'يىغقۇچ قىسقۇچىغا يۆتكە…',
  },
  deleteMenu: { zh: '删除…', en: 'Delete…', ug: 'ئۆچۈر…' },
  more: { zh: '更多', en: 'More', ug: 'تېخىمۇ كۆپ' },
  moreFor: {
    zh: '更多操作：{command}',
    en: 'More actions: {command}',
    ug: 'باشقا مەشغۇلاتلار: {command}',
  },
  sendFor: { zh: '发送：{command}', en: 'Send: {command}', ug: 'يوللا: {command}' },
  fill: { zh: '填入', en: 'Insert', ug: 'تولدۇر' },
  fillHint: {
    zh: '填入终端下方的指令栏，确认后再发送',
    en: 'Insert into the command bar under the terminal, to review before sending',
    ug: 'تېرمىنال ئاستىدىكى بۇيرۇق بالدىقىغا تولدۇرۇپ، جەزملىگەندىن كېيىن يوللاڭ',
  },
  fillFor: {
    zh: '填入指令栏：{command}',
    en: 'Insert into command bar: {command}',
    ug: 'بۇيرۇق بالدىقىغا تولدۇر: {command}',
  },
  collapse: { zh: '折叠', en: 'Collapse', ug: 'يىغ' },
  renameMenu: { zh: '重命名…', en: 'Rename…', ug: 'ئات ئۆزگەرت…' },
  deleteFolderMenu: {
    zh: '删除收藏夹…',
    en: 'Delete folder…',
    ug: 'يىغقۇچ قىسقۇچىنى ئۆچۈر…',
  },
  folderActions: {
    zh: '收藏夹操作：{name}',
    en: 'Folder actions: {name}',
    ug: 'يىغقۇچ قىسقۇچى مەشغۇلاتلىرى: {name}',
  },
  emptyFolder: {
    zh: '空收藏夹。右键可以直接在这里新建指令。',
    en: 'Empty folder. Right-click to add a command here.',
    ug: 'بوش قىسقۇچ. ئوڭ كۇنۇپكىنى بېسىپ بۇ يەردىلا يېڭى بۇيرۇق قۇرالايسىز.',
  },
  unreadable: {
    zh: '收藏文件无法读取，暂时不能使用收藏：{error}',
    en: "Couldn't read the favorites file, so favorites are unavailable for now: {error}",
    ug: 'يىغقۇچ ھۆججىتىنى ئوقۇغىلى بولمىدى، ھازىرچە يىغقۇچنى ئىشلەتكىلى بولمايدۇ: {error}',
  },
  matchCount: {
    zh: '匹配 {shown} / {all} 条',
    en: '{shown} of {all} match',
    ug: '{shown} / {all} ماس كەلدى',
  },
  total: {
    zh: '共 {n} 条',
    en: (p) => pl('favorite')(p),
    ug: 'جەمئىي {n}',
  },
  noMatch: {
    zh: '没有匹配的收藏，换个关键词试试。',
    en: 'No matching favorites. Try other keywords.',
    ug: 'ماس كېلىدىغان بۇيرۇق يوق، باشقا ئاچقۇچلۇق سۆز بىلەن سىناپ بېقىڭ.',
  },
  emptyHint: {
    zh: '在编辑器里写好指令后点「收藏」，或在这里右键新建收藏夹、直接输入指令。备注会和指令一起参与搜索。',
    en: 'Write a command in the editor and click Favorite, or right-click here to create a folder or type a command directly. Search covers notes as well as commands.',
    ug: 'تەھرىرلىگۈچتە بۇيرۇق يېزىپ «يىغقۇچقا قوش» نى چېكىڭ، ياكى بۇ يەردە ئوڭ كۇنۇپكىنى بېسىپ يىغقۇچ قىسقۇچى قۇرۇڭ ياكى بۇيرۇقنى بىۋاسىتە كىرگۈزۈڭ. ئىزدىگەندە ئىزاھمۇ بۇيرۇق بىلەن بىللە ئىزدىلىدۇ.',
  },
  favorites: { zh: '指令收藏', en: 'Favorites', ug: 'بۇيرۇق يىغقۇچ' },
  favoritesTools: { zh: '指令收藏工具', en: 'Favorites tools', ug: 'بۇيرۇق يىغقۇچ قوراللىرى' },
  new: { zh: '新建', en: 'New', ug: 'يېڭى' },
  newHint: {
    zh: '直接输入一条指令和备注加入收藏',
    en: 'Type a command and a note to add to favorites',
    ug: 'بىر بۇيرۇق ۋە ئىزاھ كىرگۈزۈپ يىغقۇچقا قوش',
  },
  newFolder: { zh: '新建收藏夹', en: 'New folder', ug: 'يېڭى قىسقۇچ' },
  newFolderHint: {
    zh: '新建一个收藏夹来分组指令；右键列表也可以新建',
    en: 'Create a folder to group commands. Right-clicking the list works too.',
    ug: 'بۇيرۇقلارنى گۇرۇپپىلاش ئۈچۈن يىغقۇچ قىسقۇچى قۇر؛ تىزىملىكتە ئوڭ كۇنۇپكىنى بېسىپمۇ قۇرغىلى بولىدۇ',
  },
  resizeList: {
    zh: '调整收藏列表宽度',
    en: 'Resize favorites list',
    ug: 'يىغقۇچ تىزىملىكىنىڭ كەڭلىكىنى تەڭشە',
  },
})

/** A command summary inside a sentence. */
const summary = (command: string, max: number) => ltr(commandSummary(command, max))

function loadCollapsed(): Set<string> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? '[]')
    return new Set(Array.isArray(value) ? value.filter((v) => typeof v === 'string') : [])
  } catch {
    return new Set()
  }
}

/** Every delete asks twice. */
async function confirmTwice(title: string, message: string): Promise<boolean> {
  if (!(await confirmDialog(title, message, common('delete'), true))) return false
  return confirmDialog(t('confirmAgain'), t('confirmAgainText'), t('deleteForGood'), true)
}

function tool(text: string, title: string, onclick: (button: HTMLButtonElement) => unknown) {
  const element: HTMLButtonElement = h('button', {
    type: 'button',
    class: 'button small quiet',
    text,
    title,
  })
  element.addEventListener('click', () => {
    Promise.resolve(onclick(element)).catch(report)
  })
  return element
}

function pane(
  name: string,
  title: string,
  toolsLabel: string,
  tools: HTMLElement[],
  ...body: HTMLElement[]
) {
  const id = `cmd-pane-${name}`
  return h(
    'section',
    { class: 'cmd-pane', 'data-pane': name, 'aria-labelledby': id },
    h(
      'header',
      { class: 'cmd-pane-bar' },
      h('h3', { class: 'cmd-pane-title', id, text: title }),
      h('div', { class: 'cmd-pane-tools', role: 'toolbar', 'aria-label': toolsLabel }, ...tools),
    ),
    ...body,
  )
}

function commandEditor() {
  const doc = localStorage.getItem(DRAFT_KEY) ?? ''
  const view = new EditorView({
    doc,
    extensions: [
      editorSetup(
        [
          {
            key: 'Mod-Enter',
            run: () => {
              sendFromEditor()
              return true
            },
          },
        ],
        doc,
      ),
      language.of([]),
      EditorView.contentAttributes.of({ 'aria-label': t('editor') }),
      editMenu((v) => [
        {
          label: t(v.state.selection.main.empty ? 'sendAllToTerminal' : 'sendSelectionToTerminal'),
          icon: 'paper-plane-right',
          disabled: v.state.doc.length === 0,
          action: sendFromEditor,
        },
        ...menuItems('commands/editor', {
          selection: selectedText(v),
          text: v.state.doc.toString(),
        }),
      ]),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) saveDraft()
        if (update.docChanged || update.selectionSet) paint()
      }),
    ],
  })
  loadLanguage('shell')
    .then((ext) => view.dispatch({ effects: language.reconfigure(ext) }))
    .catch(report)

  let draftTimer = 0
  function saveDraft(): void {
    window.clearTimeout(draftTimer)
    draftTimer = window.setTimeout(() => {
      localStorage.setItem(DRAFT_KEY, view.state.doc.toString())
    }, 400)
  }

  const selected = () =>
    view.state.selection.ranges
      .filter((r) => !r.empty)
      .map((r) => view.state.sliceDoc(r.from, r.to))
      .join('\n')

  function sendFromEditor(): void {
    const text = selected() || view.state.doc.toString()
    if (text.trim() === '') {
      setStatus(t('editorEmpty'), 'error')
      return
    }
    if (sendCommand(text)) setStatus(t('sent', { command: summary(text, 40) }))
  }

  const sendSelected = tool(t('sendSelection'), t('sendSelectionHint'), () => {
    const text = selected()
    if (text && sendCommand(text)) setStatus(t('sent', { command: summary(text, 40) }))
  })
  const sendAll = tool(t('sendAll'), t('sendAllHint'), () => {
    const text = view.state.doc.toString()
    if (text.trim() === '') setStatus(t('editorEmpty'), 'error')
    else if (sendCommand(text)) setStatus(t('sent', { command: summary(text, 40) }))
  })
  const clear = tool(t('clear'), t('clearHint'), () => {
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: '' } })
    view.focus()
  })

  function paint(): void {
    sendSelected.disabled = selected() === ''
    const empty = view.state.doc.length === 0
    sendAll.disabled = empty
    clear.disabled = empty
  }

  const element = pane(
    'editor',
    t('editor'),
    t('editorTools'),
    [
      sendAll,
      sendSelected,
      tool(t('polish'), t('polishHint'), () => {
        applyPolish(view, polishCommand(view.state.doc.toString()))
        view.focus()
      }),
      tool(t('favorite'), t('favoriteHint'), () =>
        openFavoriteDialog({ command: selected() || view.state.doc.toString(), note: '' }),
      ),
      clear,
    ],
    h('div', { class: 'cmd-editor-host' }, view.dom),
  )
  paint()

  /** Puts text at the cursor, replacing any selection. */
  const insert = (text: string) => {
    const { from, to } = view.state.selection.main
    view.dispatch({
      changes: { from, to, insert: text },
      selection: EditorSelection.cursor(from + text.length),
      scrollIntoView: true,
    })
    view.focus()
  }
  return { element, insert }
}

function favoritesPane(insert: (text: string) => void) {
  const search = h('input', {
    type: 'search',
    class: 'cmd-fav-search',
    placeholder: t('searchHint'),
    'aria-label': t('search'),
    spellcheck: 'false',
  })
  const count = h('p', { class: 'cmd-fav-count', 'aria-live': 'polite' })
  const error = h('p', { class: 'cmd-fav-error', role: 'alert', hidden: true })
  const list = h('ul', { class: 'fav-list', 'aria-label': t('list') })

  const collapsed = loadCollapsed()
  const setCollapsed = (id: string, closed: boolean) => {
    if (closed) collapsed.add(id)
    else collapsed.delete(id)
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...collapsed]))
    render()
  }

  const remove = async (favorite: Favorite) => {
    const ok = await confirmTwice(
      t('deleteFavorite'),
      t('deleteFavoriteText', { command: summary(favorite.command, 80) }),
    )
    if (ok) await deleteFavorite(favorite.id)
  }

  const newFolder = async () => {
    const name = await promptDialog(
      t('newFolderTitle'),
      t('folderName'),
      '',
      common('create'),
      folderNameError,
    )
    if (name === null) return
    const folder = await saveFolder(null, name.trim())
    setStatus(t('folderCreated', { name: folder.name }))
  }

  const renameFolder = async (folder: FavoriteFolder) => {
    const name = await promptDialog(
      t('renameFolderTitle'),
      t('folderName'),
      folder.name,
      common('rename'),
      folderNameError,
    )
    if (name === null || name.trim() === folder.name) return
    await saveFolder(folder.id, name.trim())
  }

  const removeFolder = async (folder: FavoriteFolder) => {
    const count = favorites().filter((f) => f.folderId === folder.id).length
    const message =
      count > 0
        ? t('deleteFolderTextWith', { name: folder.name, n: count })
        : t('deleteFolderText', { name: folder.name })
    if (!(await confirmTwice(t('deleteFolderTitle'), message))) return
    await deleteFolder(folder.id)
    setCollapsed(folder.id, false)
    setStatus(t('folderDeleted', { name: folder.name }))
  }

  /** Typed straight in, without the dialog or the command editor. */
  const quickAdd = async (folderId: string | null) => {
    const where = favoriteFolders().find((f) => f.id === folderId)
    const command = await promptDialog(
      where ? t('newCommandIn', { name: where.name }) : t('newCommand'),
      t('command'),
      '',
      t('addFavorite'),
      (value) => favoriteErrors(value, '').command,
    )
    if (command === null) return
    const saved = await addFavorite(command, folderId)
    if (folderId) setCollapsed(folderId, false)
    setStatus(t('added', { command: summary(saved.command, 40) }))
  }

  const moveTo = (favorite: Favorite, folder: FavoriteFolder | null) =>
    run(
      moveFavorite(favorite.id, folder?.id ?? null).then(() =>
        setStatus(folder ? t('movedTo', { name: folder.name }) : t('movedUngrouped')),
      ),
    )

  const createItems = (folderId: string | null): MenuItem[] => [
    { label: t('newCommandMenu'), icon: 'plus', action: () => run(quickAdd(folderId)) },
    { label: t('newFolderMenu'), icon: 'folder-plus', action: () => run(newFolder()) },
  ]

  const moveItems = (favorite: Favorite): MenuItem[] => [
    {
      label: common('ungrouped'),
      icon: 'folder-simple',
      action: () => moveTo(favorite, null),
      disabled: favorite.folderId === null,
    },
    ...favoriteFolders().map((folder) => ({
      label: folder.name,
      action: () => moveTo(favorite, folder),
      disabled: favorite.folderId === folder.id,
    })),
  ]

  /** `x`/`y` place the follow-up folder picker where this menu was. */
  const favoriteItems = (favorite: Favorite, x: number, y: number): MenuItem[] => {
    const label = summary(favorite.command, 40)
    return [
      {
        label: t('send'),
        icon: 'paper-plane-right',
        action: () => {
          if (sendCommand(favorite.command)) setStatus(t('sent', { command: label }))
        },
      },
      { label: t('fillBar'), icon: 'terminal-window', action: () => fillCommand(favorite.command) },
      { label: t('toEditor'), icon: 'note-pencil', action: () => insert(favorite.command) },
      {
        label: t('copyCommand'),
        icon: 'copy',
        action: () =>
          run(writeText(favorite.command).then(() => setStatus(t('copied', { command: label })))),
      },
      'separator',
      {
        label: t('editFavorite'),
        icon: 'pencil-simple',
        action: () =>
          run(
            openFavoriteDialog({ id: favorite.id, command: favorite.command, note: favorite.note }),
          ),
      },
      {
        label: t('moveToFolder'),
        icon: 'swap',
        action: () => showMenu(x, y, moveItems(favorite)),
        disabled: favoriteFolders().length === 0,
      },
      'separator',
      ...createItems(favorite.folderId),
      ...menuItems('commands/item', { command: favorite.command, note: favorite.note }),
      'separator',
      { label: t('deleteMenu'), icon: 'trash', danger: true, action: () => run(remove(favorite)) },
    ]
  }

  const row = (favorite: Favorite) => {
    const label = summary(favorite.command, 40)
    const more = h('button', {
      type: 'button',
      class: 'icon-button',
      text: t('more'),
      'aria-haspopup': 'menu',
      'aria-label': t('moreFor', { command: label }),
    })
    more.addEventListener('click', () => {
      const rect = more.getBoundingClientRect()
      showMenuFor(more, favoriteItems(favorite, rect.left, rect.bottom + 2))
    })
    return h(
      'li',
      { class: 'fav-item', 'data-id': favorite.id },
      h(
        'div',
        { class: 'fav-main' },
        h('pre', {
          class: 'fav-command mono',
          dir: 'ltr',
          text: favorite.command,
          title: favorite.command,
        }),
        favorite.note ? h('p', { class: 'fav-note', text: favorite.note }) : null,
      ),
      h(
        'div',
        { class: 'fav-actions' },
        h('button', {
          type: 'button',
          class: 'icon-button',
          text: t('send'),
          'aria-label': t('sendFor', { command: label }),
          onclick: () => {
            if (sendCommand(favorite.command)) setStatus(t('sent', { command: label }))
          },
        }),
        h('button', {
          type: 'button',
          class: 'icon-button',
          text: t('fill'),
          title: t('fillHint'),
          'aria-label': t('fillFor', { command: label }),
          onclick: () => fillCommand(favorite.command),
        }),
        more,
      ),
    )
  }

  const folderItems = (folder: FavoriteFolder): MenuItem[] => [
    ...createItems(folder.id),
    'separator',
    {
      label: collapsed.has(folder.id) ? common('expand') : t('collapse'),
      icon: 'tree-structure',
      action: () => setCollapsed(folder.id, !collapsed.has(folder.id)),
    },
    { label: t('renameMenu'), icon: 'pencil-simple', action: () => run(renameFolder(folder)) },
    'separator',
    {
      label: t('deleteFolderMenu'),
      icon: 'trash',
      danger: true,
      action: () => run(removeFolder(folder)),
    },
  ]

  // While searching every folder with a match is shown open, whatever its saved state.
  const folderNode = (folder: FavoriteFolder, inside: Favorite[], searching: boolean) => {
    const open = searching || !collapsed.has(folder.id)
    const more = h('button', {
      type: 'button',
      class: 'icon-button',
      text: t('more'),
      'aria-haspopup': 'menu',
      'aria-label': t('folderActions', { name: folder.name }),
      onclick: () => showMenuFor(more, folderItems(folder)),
    })
    return h(
      'li',
      { class: 'fav-folder', 'data-folder': folder.id },
      h(
        'div',
        { class: 'fav-folder-head' },
        h(
          'button',
          {
            type: 'button',
            class: 'fav-folder-toggle',
            'aria-expanded': String(open),
            disabled: searching,
            onclick: () => setCollapsed(folder.id, open),
          },
          h(
            'span',
            { class: 'fav-folder-caret' },
            open ? treeIcons.expanded() : treeIcons.collapsed(),
          ),
          h(
            'span',
            { class: 'files-icon', 'data-icon': 'folder' },
            open ? treeIcons.open() : treeIcons.closed(),
          ),
          h('span', { class: 'fav-folder-name cell-text', text: folder.name }),
          h('span', { class: 'fav-folder-count', text: String(inside.length) }),
        ),
        more,
      ),
      open
        ? h(
            'ul',
            { class: 'fav-sublist', 'aria-label': folder.name },
            inside.length > 0
              ? inside.map(row)
              : h('li', { class: 'fav-empty', text: t('emptyFolder') }),
          )
        : null,
    )
  }

  const render = () => {
    const problem = favoritesError()
    error.hidden = problem === null
    error.textContent = problem ? t('unreadable', { error: problem }) : ''
    const all = favorites()
    const folders = favoriteFolders()
    const searching = search.value.trim() !== ''
    const shown = all.filter((f) => matchesQuery(search.value, f.command, f.note))
    count.textContent = searching
      ? t('matchCount', { shown: shown.length, all: all.length })
      : t('total', { n: all.length })
    const known = new Set(folders.map((f) => f.id))
    const nodes: HTMLElement[] = []
    for (const folder of folders) {
      const inside = shown.filter((f) => f.folderId === folder.id)
      if (!searching || inside.length > 0) nodes.push(folderNode(folder, inside, searching))
    }
    for (const favorite of shown) {
      if (favorite.folderId === null || !known.has(favorite.folderId)) nodes.push(row(favorite))
    }
    if (nodes.length === 0) {
      nodes.push(
        h('li', {
          class: 'fav-empty',
          text: searching ? t('noMatch') : t('emptyHint'),
        }),
      )
    }
    list.replaceChildren(...nodes)
  }
  list.addEventListener('contextmenu', (event) => {
    event.preventDefault()
    const target = event.target as Element
    const id = target.closest<HTMLElement>('.fav-item')?.dataset.id
    const favorite = id ? favorites().find((f) => f.id === id) : undefined
    if (favorite) {
      showMenu(event.clientX, event.clientY, favoriteItems(favorite, event.clientX, event.clientY))
      return
    }
    const folderId = target.closest<HTMLElement>('.fav-folder')?.dataset.folder
    const folder = favoriteFolders().find((f) => f.id === folderId)
    showMenu(event.clientX, event.clientY, folder ? folderItems(folder) : createItems(null))
  })
  search.addEventListener('input', render)
  onFavorites(render)
  loadFavorites().catch(render)
  render()

  return pane(
    'favorites',
    t('favorites'),
    t('favoritesTools'),
    [
      tool(t('new'), t('newHint'), () => openFavoriteDialog({ command: '', note: '' })),
      tool(t('newFolder'), t('newFolderHint'), () => newFolder()),
    ],
    h('div', { class: 'cmd-fav-head' }, search, count),
    error,
    list,
  )
}

/** The command console: favorites on one side, a scratch editor for long commands on the other. */
export function commandsPanel(): PanelHost {
  const editor = commandEditor()
  const favorites = favoritesPane(editor.insert)
  const splitter = h('div', {
    class: 'cmd-console-splitter',
    role: 'separator',
    'aria-orientation': 'vertical',
    'aria-label': t('resizeList'),
    tabIndex: 0,
  })
  const element = h('div', { class: 'cmd-console' }, favorites, splitter, editor.element)

  bindConsoleSplitter(element, splitter)
  return { element }
}

function bindConsoleSplitter(console: HTMLElement, splitter: HTMLElement): void {
  const MIN_WIDTH = 180
  const MAX_WIDTH = 600

  const applyWidth = (width: number) => {
    console.style.setProperty('--cmd-favorites-width', `${width}px`)
  }

  applyWidth(settings().commands?.favoritesWidth ?? 300)
  const currentWidth = () =>
    parseFloat(getComputedStyle(console).getPropertyValue('--cmd-favorites-width') || '300')

  let persistTimer = 0
  const persist = (width: number) => {
    clearTimeout(persistTimer)
    persistTimer = window.setTimeout(() => {
      updateSettings((draft) => {
        if (!draft.commands) draft.commands = { favoritesWidth: 300 }
        draft.commands.favoritesWidth = width
      }).catch((error: unknown) => reportError(error))
    }, 250)
  }

  splitter.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return
    event.preventDefault()
    splitter.setPointerCapture(event.pointerId)
    splitter.classList.add('dragging')
    const origin = event.clientX
    const start = currentWidth()
    // The favorites sit on the right in right-to-left text, so dragging left widens them.
    const outward = isRtl() ? -1 : 1
    let width = start
    const move = (e: PointerEvent) => {
      width = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, start + outward * (e.clientX - origin)))
      applyWidth(width)
    }
    const end = () => {
      splitter.classList.remove('dragging')
      splitter.removeEventListener('pointermove', move)
      splitter.removeEventListener('pointerup', end)
      splitter.removeEventListener('pointercancel', end)
      persist(width)
    }
    splitter.addEventListener('pointermove', move)
    splitter.addEventListener('pointerup', end)
    splitter.addEventListener('pointercancel', end)
  })

  splitter.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    const current = currentWidth()
    const direction = (event.key === 'ArrowRight') !== isRtl() ? 1 : -1
    const delta = event.shiftKey ? 64 : 16
    const width = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, current + direction * delta))
    applyWidth(width)
    persist(width)
  })
}
