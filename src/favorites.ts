import { invoke } from '@tauri-apps/api/core'
import { type Favorite, type FavoriteFolder, favoriteErrors } from './commands-model'
import { button, modal } from './dialogs'
import { field, h, setFieldError, setStatus } from './dom'
import { ltr, messages } from './i18n'
import { common } from './i18n-common'
import { describeError } from './protocol'

const t = messages({
  editTitle: { zh: '编辑收藏', en: 'Edit favorite', ug: 'يىغىلغان بۇيرۇقنى تەھرىرلەش' },
  addTitle: { zh: '收藏指令', en: 'Add command to favorites', ug: 'بۇيرۇقنى يىغقۇچقا قوشۇش' },
  commandExample: { zh: '例如：{example}', en: 'For example: {example}', ug: 'مەسىلەن: {example}' },
  notePlaceholder: {
    zh: '写下用途或注意事项，方便以后搜索',
    en: 'What it is for or what to watch out for, so you can find it later',
    ug: 'كېيىن ئىزدەشكە قولايلىق بولسۇن ئۈچۈن ئىشلىتىلىشى ياكى دىققەت قىلىدىغان ئىشلارنى يېزىڭ',
  },
  command: { zh: '指令', en: 'Command', ug: 'بۇيرۇق' },
  noteHelp: {
    zh: '搜索时会同时匹配指令和备注。',
    en: 'Search matches both the command and the note.',
    ug: 'ئىزدىگەندە بۇيرۇق بىلەن ئىزاھ تەڭلا سېلىشتۇرۇلىدۇ.',
  },
  updated: { zh: '收藏已更新', en: 'Favorite updated', ug: 'يىغقۇچ يېڭىلاندى' },
  added: { zh: '已加入指令收藏', en: 'Added to favorites', ug: 'بۇيرۇق يىغقۇچقا قوشۇلدى' },
  saveChanges: { zh: '保存修改', en: 'Save changes', ug: 'ئۆزگەرتىشنى ساقلا' },
  add: { zh: '加入收藏', en: 'Add to favorites', ug: 'يىغقۇچقا قوش' },
})

const EXAMPLE = 'journalctl -u nginx --since "1 hour ago"'

type Listener = (items: readonly Favorite[]) => void

/** Newest first, as stored. */
let items: Favorite[] = []
/** In creation order. */
let folders: FavoriteFolder[] = []
let loadError: string | null = null
const listeners: Listener[] = []

function publish(next: Favorite[], nextFolders = folders): void {
  items = next
  folders = nextFolders
  for (const listener of listeners) listener(items)
}

export function favorites(): readonly Favorite[] {
  return items
}

export function favoriteFolders(): readonly FavoriteFolder[] {
  return folders
}

/** Creates a folder (id null) or renames one. */
export async function saveFolder(id: string | null, name: string): Promise<FavoriteFolder> {
  const saved = await invoke<FavoriteFolder>('folder_save', { id, name })
  publish(
    items,
    id === null ? [...folders, saved] : folders.map((f) => (f.id === saved.id ? saved : f)),
  )
  return saved
}

/** Deletes the folder; its favorites move to the top level. */
export async function deleteFolder(id: string): Promise<void> {
  await invoke('folder_delete', { id })
  publish(
    items.map((f) => (f.folderId === id ? { ...f, folderId: null } : f)),
    folders.filter((f) => f.id !== id),
  )
}

export async function moveFavorite(id: string, folderId: string | null): Promise<void> {
  await invoke('favorite_move', { id, folderId })
  publish(items.map((f) => (f.id === id ? { ...f, folderId } : f)))
}

/** Adds a favorite without opening the dialog. */
export async function addFavorite(
  command: string,
  folderId: string | null,
  note = '',
): Promise<Favorite> {
  const saved = await invoke<Favorite>('favorite_save', {
    input: { id: null, command, note, folderId },
  })
  publish([saved, ...items])
  return saved
}

/** Why the favorites file could not be loaded, if it couldn't. */
export function favoritesError(): string | null {
  return loadError
}

export function onFavorites(listener: Listener): () => void {
  listeners.push(listener)
  return () => {
    const index = listeners.indexOf(listener)
    if (index >= 0) listeners.splice(index, 1)
  }
}

export async function loadFavorites(): Promise<void> {
  try {
    const file = await invoke<{ items: Favorite[]; folders: FavoriteFolder[] }>('favorites_list')
    loadError = null
    publish(
      file.items.map((f) => ({ ...f, folderId: f.folderId ?? null })),
      file.folders,
    )
  } catch (error) {
    loadError = describeError(error)
    publish([], [])
    throw error
  }
}

export async function deleteFavorite(id: string): Promise<void> {
  await invoke('favorite_delete', { id })
  publish(items.filter((f) => f.id !== id))
}

export interface FavoriteDraft {
  id?: string
  command: string
  note: string
  /** Where a new favorite goes; ignored when editing. */
  folderId?: string | null
}

/** Add or edit dialog. Resolves with the saved favorite, or null if cancelled. */
export function openFavoriteDialog(draft: FavoriteDraft): Promise<Favorite | null> {
  const editing = draft.id !== undefined
  const parts = modal('favorite', editing ? t('editTitle') : t('addTitle'), 'md')
  const command = h('textarea', {
    class: 'mono',
    rows: 6,
    spellcheck: 'false',
    autocomplete: 'off',
    placeholder: t('commandExample', { example: ltr(EXAMPLE) }),
  })
  command.value = draft.command
  const note = h('textarea', {
    rows: 3,
    placeholder: t('notePlaceholder'),
  })
  note.value = draft.note
  const form = h(
    'form',
    { class: 'dialog-form', novalidate: true },
    field(t('command'), command),
    field(common('note'), note, t('noteHelp')),
  )
  parts.body.append(form)

  let saved: Favorite | null = null
  let busy = false
  const save = async () => {
    if (busy) return
    const errors = favoriteErrors(command.value, note.value)
    setFieldError(command, errors.command)
    setFieldError(note, errors.note)
    if (errors.command) return command.focus()
    if (errors.note) return note.focus()
    busy = true
    try {
      saved = await invoke<Favorite>('favorite_save', {
        input: {
          id: draft.id ?? null,
          command: command.value,
          note: note.value,
          folderId: draft.folderId ?? null,
        },
      })
      const rest = items.filter((f) => f.id !== saved?.id)
      publish(
        editing
          ? items.map((f) => (f.id === saved?.id ? (saved as Favorite) : f))
          : [saved, ...rest],
      )
      setStatus(editing ? t('updated') : t('added'))
      parts.dialog.close('ok')
    } catch (error) {
      setFieldError(command, describeError(error))
    } finally {
      busy = false
    }
  }
  form.addEventListener('submit', (event) => {
    event.preventDefault()
    void save()
  })
  command.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && event.ctrlKey) {
      event.preventDefault()
      void save()
    }
  })
  parts.actions.append(
    button(common('cancel'), () => parts.dialog.close()),
    button(editing ? t('saveChanges') : t('add'), () => void save(), 'primary'),
  )
  return new Promise((resolve) => {
    parts.dialog.addEventListener(
      'close',
      () => {
        parts.dialog.remove()
        resolve(saved)
      },
      { once: true },
    )
    parts.dialog.showModal()
    ;(draft.command ? note : command).focus()
  })
}
