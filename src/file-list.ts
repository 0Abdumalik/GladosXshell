import { extension } from './format'
import { ltr, messages } from './i18n'
import type { Entry } from './protocol'

const t = messages({
  folder: { zh: '文件夹', en: 'Folder', ug: 'قىسقۇچ' },
  folderLink: { zh: '文件夹链接', en: 'Folder link', ug: 'قىسقۇچ ئۇلانمىسى' },
  link: { zh: '链接', en: 'Link', ug: 'ئۇلانما' },
  special: { zh: '特殊文件', en: 'Special file', ug: 'ئالاھىدە ھۆججەت' },
  typedFile: { zh: '{ext} 文件', en: '{ext} file', ug: '{ext} ھۆججىتى' },
  file: { zh: '文件', en: 'File', ug: 'ھۆججەت' },
})

export type SortKey = 'name' | 'size' | 'kind' | 'mtime' | 'perms' | 'owner' | 'group'

export const isDir = (entry: Entry): boolean =>
  entry.kind === 'dir' || (entry.kind === 'symlink' && entry.targetIsDir)

export function kindLabel(entry: Entry): string {
  if (entry.kind === 'dir') return t('folder')
  if (entry.kind === 'symlink') return entry.targetIsDir ? t('folderLink') : t('link')
  if (entry.kind === 'other') return t('special')
  const ext = extension(entry.name)
  return ext ? t('typedFile', { ext: ltr(ext.toUpperCase()) }) : t('file')
}

export const ownerLabel = (entry: Entry): string =>
  entry.owner ?? (entry.uid === null ? '' : String(entry.uid))

export const groupLabel = (entry: Entry): string =>
  entry.group ?? (entry.gid === null ? '' : String(entry.gid))

const collator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' })

function compare(a: Entry, b: Entry, key: SortKey): number {
  switch (key) {
    case 'size':
      return a.size - b.size
    case 'kind':
      return collator.compare(kindLabel(a), kindLabel(b))
    case 'mtime':
      return (a.mtime ?? 0) - (b.mtime ?? 0)
    case 'perms':
      return (a.mode & 0o7777) - (b.mode & 0o7777)
    case 'owner':
      return collator.compare(ownerLabel(a), ownerLabel(b))
    case 'group':
      return collator.compare(groupLabel(a), groupLabel(b))
    case 'name':
      return collator.compare(a.name, b.name)
  }
}

/** Folders first, then by `key`; ties fall back to the name in the same direction. */
export function sortEntries(entries: readonly Entry[], key: SortKey, descending: boolean): Entry[] {
  const sign = descending ? -1 : 1
  return [...entries].sort((a, b) => {
    const folders = Number(isDir(b)) - Number(isDir(a))
    if (folders !== 0) return folders
    return sign * (compare(a, b, key) || collator.compare(a.name, b.name))
  })
}

export function visibleEntries(entries: readonly Entry[], showHidden: boolean): Entry[] {
  return showHidden ? [...entries] : entries.filter((e) => !e.name.startsWith('.'))
}

/** Keeps names containing `query` (any case); `*` and `?` make it a whole-name wildcard match. */
export function filterEntries(entries: readonly Entry[], query: string): Entry[] {
  const q = query.trim().toLowerCase()
  if (!q) return [...entries]
  if (!/[*?]/.test(q)) return entries.filter((e) => e.name.toLowerCase().includes(q))
  const source = q
    .split('')
    .map((c) => (c === '*' ? '.*' : c === '?' ? '.' : c.replace(/[\\^$.|+()[\]{}]/g, '\\$&')))
    .join('')
  const pattern = new RegExp(`^${source}$`, 'i')
  return entries.filter((e) => pattern.test(e.name))
}

/** Last component of a Windows or POSIX path. */
export function baseName(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, '')
  return trimmed.slice(Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\')) + 1) || path
}
