import { h } from '../dom'
import { messages } from '../i18n'
import { icon } from '../icons'
import type { PanelHost } from '../layout'
import type { WidgetId } from '../settings-model'
import { onSettings, settings, updateSettings } from '../settings-store'
import { placeholder } from './model'
import { initStatusStore, onStatusChange, statusActive, statusTrack } from './store'
import { createWidgets, type Report, type Widget } from './widgets'

const t = messages({
  reading: { zh: '正在读取状态…', en: 'Reading status…', ug: 'ھالەت ئوقۇلۇۋاتىدۇ…' },
  detailTitle: {
    zh: '详细模式会多显示内核、CPU 型号、进程 PID 和监听端口',
    en: 'Detailed mode also shows the kernel, CPU model, process PIDs and listening ports',
    ug: 'تەپسىلىي ھالەتتە يادرو، CPU مودېلى، جەريان PID سى ۋە ئاڭلاۋاتقان ئېغىزلارمۇ كۆرسىتىلىدۇ',
  },
  detail: { zh: '详细', en: 'Detailed', ug: 'تەپسىلىي' },
  panel: { zh: '服务器状态', en: 'Server status', ug: 'مۇلازىمېتىر ھالىتى' },
  readFailed: {
    zh: '状态读取失败：{error}',
    en: "Couldn't read the status: {error}",
    ug: 'ھالەتنى ئوقۇش مەغلۇپ بولدى: {error}',
  },
  resize: {
    zh: '拖动调整高度，双击恢复自动高度',
    en: 'Drag to change the height, double-click to make it automatic again',
    ug: 'سۆرەپ ئېگىزلىكىنى تەڭشەڭ، قوش چېكىپ ئاپتوماتىك ئېگىزلىككە قايتۇرۇڭ',
  },
})

const MIN_HEIGHT = 128
const MAX_HEIGHT = 2000

/**
 * A read-only view of the backend's status state. Every window builds its own; they share
 * nothing but settings and the backend events.
 */
export function statusPanel(report: Report, actions: HTMLElement[] = []): PanelHost {
  const widgets = createWidgets(report)
  const all = Object.values(widgets)
  const empty = h('p', { class: 'panel-empty', text: t('reading') })
  const error = h('p', { class: 'panel-error', role: 'status', hidden: true })
  const list = h('div', { class: 'status-widgets', hidden: true })
  const modeButton = h(
    'button',
    {
      type: 'button',
      class: 'button small quiet',
      'aria-pressed': 'false',
      title: t('detailTitle'),
      onclick: () => {
        updateSettings((draft) => {
          draft.status.advanced = !draft.status.advanced
        }).catch(report)
      },
    },
    icon('list'),
    h('span', { text: t('detail') }),
  )
  const header = h(
    'header',
    { class: 'status-bar' },
    modeButton,
    h('div', { class: 'status-bar-actions' }, ...actions),
  )
  const content = h('div', { class: 'status-panel-content' }, empty, error, list)
  const element = h('section', { class: 'status-panel', 'aria-label': t('panel') }, header, content)
  let loaded = false

  const render = () => {
    if (!loaded) return
    const active = statusActive()
    const track = statusTrack(active.sessionId)
    const message = placeholder(active, track)
    empty.textContent = message
    empty.hidden = message === ''
    list.hidden = message !== ''
    const failed = message === '' && track?.error ? t('readFailed', { error: track.error }) : ''
    error.textContent = failed
    error.hidden = failed === ''
    if (message || !track?.last) return
    const detail = settings().status.advanced
    for (const widget of all) widget.update(track, track.last, detail)
  }

  const setHeight = (widget: Widget, height: number | undefined) => {
    const { element: root, splitter } = widget
    if (height === undefined) {
      delete root.dataset.sized
      root.style.removeProperty('--widget-height')
      splitter.removeAttribute('aria-valuenow')
    } else {
      root.dataset.sized = ''
      root.style.setProperty('--widget-height', `${height}px`)
      splitter.setAttribute('aria-valuenow', String(height))
    }
  }

  const arrange = () => {
    const status = settings().status
    const shown: Widget[] = []
    for (const { id, enabled } of status.widgets) {
      if (enabled && (id !== 'connections' || status.advanced)) shown.push(widgets[id])
    }
    for (const widget of all) {
      setHeight(widget, status.widgetHeights[widget.id])
      widget.splitter.hidden = widget === shown[shown.length - 1]
    }
    list.replaceChildren(...shown.map((w) => w.element))
    modeButton.setAttribute('aria-pressed', String(status.advanced))
  }

  let pendingHeights: Partial<Record<WidgetId, number | null>> = {}
  let persistTimer = 0
  const persist = (id: WidgetId, height: number | null) => {
    pendingHeights[id] = height
    clearTimeout(persistTimer)
    persistTimer = window.setTimeout(() => {
      const changes = pendingHeights
      pendingHeights = {}
      updateSettings((draft) => {
        for (const [key, value] of Object.entries(changes) as [WidgetId, number | null][]) {
          if (value === null) delete draft.status.widgetHeights[key]
          else draft.status.widgetHeights[key] = value
        }
      }).catch(report)
    }, 250)
  }
  const resize = (widget: Widget, height: number) => {
    const value = Math.round(Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, height)))
    setHeight(widget, value)
    persist(widget.id, value)
  }

  for (const widget of all) {
    const { element: root, splitter } = widget
    splitter.setAttribute('aria-valuemin', String(MIN_HEIGHT))
    splitter.setAttribute('aria-valuemax', String(MAX_HEIGHT))
    splitter.title = t('resize')
    splitter.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return
      event.preventDefault()
      splitter.setPointerCapture(event.pointerId)
      splitter.classList.add('dragging')
      const origin = event.clientY
      const start = root.offsetHeight
      const move = (e: PointerEvent) => resize(widget, start + e.clientY - origin)
      const end = () => {
        splitter.classList.remove('dragging')
        splitter.removeEventListener('pointermove', move)
        splitter.removeEventListener('pointerup', end)
        splitter.removeEventListener('pointercancel', end)
      }
      splitter.addEventListener('pointermove', move)
      splitter.addEventListener('pointerup', end)
      splitter.addEventListener('pointercancel', end)
    })
    splitter.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
      event.preventDefault()
      const step = (event.shiftKey ? 64 : 16) * (event.key === 'ArrowDown' ? 1 : -1)
      resize(widget, root.offsetHeight + step)
    })
    splitter.addEventListener('dblclick', () => {
      setHeight(widget, undefined)
      persist(widget.id, null)
    })
  }

  arrange()
  onSettings((next, previous) => {
    const a = next.status
    const b = previous.status
    if (
      a.advanced !== b.advanced ||
      JSON.stringify(a.widgets) !== JSON.stringify(b.widgets) ||
      JSON.stringify(a.widgetHeights) !== JSON.stringify(b.widgetHeights)
    ) {
      arrange()
    }
    if (
      a.advanced !== b.advanced ||
      JSON.stringify(a.selectedInterfaces) !== JSON.stringify(b.selectedInterfaces)
    ) {
      render()
    }
  })
  onStatusChange((change) => {
    if (change === null || change === statusActive().sessionId) render()
  })
  initStatusStore()
    .then(() => {
      loaded = true
      render()
    })
    .catch(report)

  return {
    element,
    shown: () => {
      for (const widget of all) widget.paint?.()
    },
  }
}
