import { getCurrentWebview } from '@tauri-apps/api/webview'
import { currentMonitor, getCurrentWindow } from '@tauri-apps/api/window'
import { autoScale, effectiveScale } from './settings-model'
import { onSettings, settings } from './settings-store'

let auto = 100

/** The percentage "auto" resolves to on the current monitor. */
export function autoScaleValue(): number {
  return auto
}

async function apply(): Promise<void> {
  const monitor = await currentMonitor()
  if (monitor) {
    const { width, height } = monitor.size
    auto = autoScale(width / monitor.scaleFactor, height / monitor.scaleFactor)
  }
  await getCurrentWebview().setZoom(effectiveScale(settings().ui.scale, auto) / 100)
}

/** Applies the interface zoom now, on settings changes and when the window changes monitor DPI. */
export async function initScale(report: (error: unknown) => void): Promise<void> {
  onSettings((next, previous) => {
    if (next.ui.scale !== previous.ui.scale) apply().catch(report)
  })
  getCurrentWindow()
    .onScaleChanged(() => apply().catch(report))
    .catch(report)
  await apply()
}
