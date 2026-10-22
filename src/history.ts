import { invoke } from '@tauri-apps/api/core'

type Listener = (items: readonly string[]) => void

/** Oldest first, as stored. */
let items: string[] = []
const listeners: Listener[] = []

function publish(next: string[]): void {
  items = next
  for (const listener of listeners) listener(items)
}

export function commandHistory(): readonly string[] {
  return items
}

export function onHistory(listener: Listener): () => void {
  listeners.push(listener)
  return () => {
    const index = listeners.indexOf(listener)
    if (index >= 0) listeners.splice(index, 1)
  }
}

export async function loadHistory(): Promise<void> {
  publish(await invoke<string[]>('history_list'))
}

export async function addHistory(command: string): Promise<void> {
  await invoke('history_add', { command })
  await loadHistory()
}

export async function removeHistory(command: string): Promise<void> {
  await invoke('history_remove', { command })
  publish(items.filter((c) => c !== command))
}

export async function clearHistory(): Promise<void> {
  await invoke('history_clear')
  publish([])
}
