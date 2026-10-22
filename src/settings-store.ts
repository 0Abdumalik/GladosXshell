import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import type { Settings, SettingsView } from './settings-model'

type Listener = (settings: Settings, previous: Settings) => void

let current: Settings
let defaultWorkDir = ''
let saving: Promise<unknown> = Promise.resolve()
/** While this window has saves in flight, its own optimistic copy is newer than any broadcast. */
let pending = 0
const listeners: Listener[] = []

export async function loadSettings(): Promise<string | null> {
  // Saves from any window come back here, so every window follows the same settings.
  await listen<Settings>('settings://changed', (event) => {
    if (pending > 0 || !current) return
    if (JSON.stringify(event.payload) === JSON.stringify(current)) return
    publish(event.payload, current)
  })
  const view = await invoke<SettingsView>('settings_get')
  current = view.settings
  defaultWorkDir = view.defaultWorkDir
  return view.error
}

export function settings(): Settings {
  return current
}

export function defaultWorkDirectory(): string {
  return defaultWorkDir
}

/** Returns an unsubscribe function. */
export function onSettings(listener: Listener): () => void {
  listeners.push(listener)
  return () => {
    const index = listeners.indexOf(listener)
    if (index >= 0) listeners.splice(index, 1)
  }
}

function publish(next: Settings, previous: Settings): void {
  current = next
  for (const listener of listeners) listener(next, previous)
}

/**
 * Applies the change right away, then persists it. Saves are serialized so a slow write can't
 * land after a newer one; the backend's normalized copy replaces the optimistic one.
 */
export function updateSettings(change: (draft: Settings) => void): Promise<void> {
  const previous = current
  const draft = structuredClone(current)
  change(draft)
  publish(draft, previous)
  pending += 1
  const save = saving.then(async () => {
    try {
      const saved = await invoke<Settings>('settings_set', { settings: draft })
      if (current === draft) publish(saved, draft)
    } catch (error) {
      if (current === draft) publish(previous, draft)
      throw error
    } finally {
      pending -= 1
    }
  })
  saving = save.catch(() => {})
  return save
}

const userCss = document.createElement('style')
userCss.id = 'gx-user-css'

/** The user stylesheet goes last in <head> so it wins over the built-in styles. */
export function applyUserCss(css: string): void {
  userCss.textContent = css
  if (userCss.parentNode !== document.head || document.head.lastElementChild !== userCss) {
    document.head.append(userCss)
  }
}

let fileCss: string | null = null
const cssListeners = new Set<(css: string) => void>()

export async function loadUserCss(): Promise<string> {
  const css = await invoke<string>('custom_css_get')
  if (fileCss === null) window.addEventListener('focus', reloadUserCss)
  fileCss = css
  applyUserCss(css)
  return css
}

export async function saveUserCss(css: string): Promise<void> {
  await invoke('custom_css_set', { css })
  fileCss = css
  applyUserCss(css)
}

/** custom.css edited outside the app shows up when the window gets focus back. */
export function reloadUserCss(): void {
  invoke<string>('custom_css_get')
    .then((css) => {
      if (css === fileCss) return
      fileCss = css
      applyUserCss(css)
      for (const listener of cssListeners) listener(css)
    })
    .catch(() => {})
}

export function onUserCssFile(listener: (css: string) => void): () => void {
  cssListeners.add(listener)
  return () => cssListeners.delete(listener)
}
