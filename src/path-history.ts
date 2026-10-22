import { invoke } from '@tauri-apps/api/core'

const STORAGE_KEY = 'gx.pathHistory'
const MAX_PATHS = 100

let paths: string[] = []
let loaded = false

async function ensureLoaded(): Promise<void> {
  if (loaded) return
  try {
    paths = await invoke<string[]>('load_path_history')
    loaded = true
  } catch {
    const raw = localStorage.getItem(STORAGE_KEY)
    paths = raw ? JSON.parse(raw) : []
    loaded = true
  }
}

export async function addPathHistory(path: string): Promise<void> {
  await ensureLoaded()
  const trimmed = path.trim()
  if (!trimmed || trimmed === '~' || trimmed === '.') return
  paths = paths.filter((p) => p !== trimmed)
  paths.push(trimmed)
  if (paths.length > MAX_PATHS) paths = paths.slice(-MAX_PATHS)
  try {
    await invoke('save_path_history', { paths })
  } catch {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(paths))
  }
}

export async function getPathHistory(): Promise<string[]> {
  await ensureLoaded()
  return [...paths].reverse()
}

export async function clearPathHistory(): Promise<void> {
  await ensureLoaded()
  paths = []
  try {
    await invoke('save_path_history', { paths: [] })
  } catch {
    localStorage.removeItem(STORAGE_KEY)
  }
}
