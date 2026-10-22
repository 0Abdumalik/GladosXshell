import { invoke } from '@tauri-apps/api/core'
import { onSettings, settings } from './settings-store'

export interface SystemFont {
  name: string
  /** A localized name such as 微软雅黑. */
  localName: string | null
  mono: boolean
}

export interface FontFile {
  family: string
  path: string
  weight: number
  italic: boolean
  mono: boolean
  size: number
}

interface FontSet {
  fonts: FontFile[]
  /** Files left out because of the count or size caps. */
  skipped: number
}

export interface FolderState {
  path: string
  families: string[]
  files: number
  skipped: number
  failed: number
  loading: boolean
  error: string
}

const LOAD_PARALLEL = 4

const faces = new Map<string, FontFace>()
const listeners = new Set<() => void>()
let library: FontFile[] = []
let folderFiles: FontFile[] = []
let folder: FolderState = emptyFolder('')
let folderToken = 0
let systemList: Promise<SystemFont[]> | null = null

function emptyFolder(path: string): FolderState {
  return { path, families: [], files: 0, skipped: 0, failed: 0, loading: false, error: '' }
}

function notify(): void {
  for (const listener of listeners) listener()
}

/** Runs after library or folder fonts are added or dropped; terminals re-measure then. */
export function onFontsChange(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Installed families, read once per session. */
export function systemFonts(): Promise<SystemFont[]> {
  systemList ??= invoke<SystemFont[]>('fonts_system').catch((error: unknown) => {
    systemList = null
    throw error
  })
  return systemList
}

async function loadFace(file: FontFile): Promise<void> {
  if (faces.has(file.path)) return
  const bytes = await invoke<ArrayBuffer>('font_data', { path: file.path })
  const face = new FontFace(file.family, bytes, {
    weight: String(file.weight),
    style: file.italic ? 'italic' : 'normal',
  })
  await face.load()
  document.fonts.add(face)
  faces.set(file.path, face)
}

/** Loads a few files at a time; returns how many could not be loaded. */
async function loadFaces(files: readonly FontFile[]): Promise<number> {
  let failed = 0
  let next = 0
  const worker = async () => {
    while (next < files.length) {
      const file = files[next++]
      await loadFace(file).catch(() => {
        failed++
      })
    }
  }
  await Promise.all(Array.from({ length: LOAD_PARALLEL }, worker))
  return failed
}

function dropFaces(keep: (path: string) => boolean): void {
  for (const [path, face] of faces) {
    if (keep(path)) continue
    document.fonts.delete(face)
    faces.delete(path)
  }
}

const inUse = (path: string) =>
  library.some((f) => f.path === path) || folderFiles.some((f) => f.path === path)

/** Fonts imported into the app, each file a face. */
export function libraryFonts(): readonly FontFile[] {
  return library
}

export async function refreshLibrary(): Promise<void> {
  const set = await invoke<FontSet>('font_library')
  library = set.fonts
  dropFaces(inUse)
  await loadFaces(library)
  notify()
}

export async function importFont(path: string): Promise<FontFile[]> {
  const added = await invoke<FontFile[]>('font_import', { path })
  await refreshLibrary()
  return added
}

export async function removeFont(path: string): Promise<void> {
  await invoke('font_remove', { path })
  await refreshLibrary()
}

export function folderState(): FolderState {
  return folder
}

/** Families from the fallback folder, in file order. */
export function folderFamilies(): string[] {
  return folder.families
}

/** Loads every font in `path` (replacing the previous folder); empty clears it. */
export async function useFolder(path: string, force = false): Promise<void> {
  if (path === folder.path && !force) return
  const token = ++folderToken
  folderFiles = []
  dropFaces(inUse)
  folder = { ...emptyFolder(path), loading: path !== '' }
  notify()
  if (!path) return
  try {
    const set = await invoke<FontSet>('fonts_folder', { path })
    if (token !== folderToken) return
    folderFiles = set.fonts
    const failed = await loadFaces(set.fonts)
    if (token !== folderToken) return
    const families: string[] = []
    for (const file of set.fonts) {
      if (faces.has(file.path) && !families.includes(file.family)) families.push(file.family)
    }
    folder = {
      path,
      families,
      files: set.fonts.length,
      skipped: set.skipped,
      failed,
      loading: false,
      error: '',
    }
  } catch (error) {
    if (token !== folderToken) return
    folder = { ...emptyFolder(path), error: String(error) }
  }
  notify()
}

/** Loads library fonts and the configured folder, and follows later folder changes. */
export function initTerminalFonts(report: (error: unknown) => void): void {
  refreshLibrary().catch(report)
  void useFolder(settings().terminal.fontFolder)
  onSettings((next) => {
    void useFolder(next.terminal.fontFolder)
  })
}
