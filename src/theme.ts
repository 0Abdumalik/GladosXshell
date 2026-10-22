import { themes } from './plugins/registry'
import { onSettings, settings, updateSettings } from './settings-store'

export function applyTheme(theme: 'dark' | 'light' | 'auto'): void {
  const resolved = theme === 'auto' ? getSystemTheme() : theme
  document.documentElement.dataset.theme = resolved
}

function getSystemTheme(): 'dark' | 'light' {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function initTheme(): void {
  applyTheme(settings().ui.theme)
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (settings().ui.theme === 'auto') applyTheme('auto')
  })
  // Another window may change the theme.
  onSettings((next, previous) => {
    if (next.ui.theme !== previous.ui.theme) applyTheme(next.ui.theme)
  })
}

/** Called when the active theme changes or a theme contribution comes or goes. */
export function onThemeChange(listener: () => void): () => void {
  const observer = new MutationObserver(listener)
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
  const unsubscribe = themes.subscribe(listener)
  return () => {
    observer.disconnect()
    unsubscribe()
  }
}

export function setTheme(theme: 'dark' | 'light' | 'auto'): void {
  updateSettings((d) => {
    d.ui.theme = theme
  })
  applyTheme(theme)
}
