import { h } from './dom'
import { isRtl, messages } from './i18n'
import { namedIcon } from './icons'
import { type MenuItem, showMenu } from './menu'
import { menuItems } from './plugins/registry'
import {
  type DockRegion,
  type PanelId,
  panelsByRegion,
  type Region,
  type Settings,
  SIZE_LIMITS,
} from './settings-model'
import { onSettings, settings, updateSettings } from './settings-store'

export interface PanelHost {
  element: HTMLElement
  /** Called when the panel becomes visible (charts need a redraw after being hidden). */
  shown?: () => void
}

export interface Layout {
  /** Hides a panel for now without touching the saved layout. */
  suppress(id: PanelId, hidden: boolean): void
  addPanel(id: PanelId, host: PanelHost, title: string, icon?: string): void
  /** Takes the panel out of the window; its saved place stays for when it comes back. */
  removePanel(id: PanelId): void
}

const t = messages({
  moveLeft: { zh: '移到左侧', en: 'Move to left', ug: 'سولغا يۆتكە' },
  moveRight: { zh: '移到右侧', en: 'Move to right', ug: 'ئوڭغا يۆتكە' },
  moveBottom: { zh: '移到底部', en: 'Move to bottom', ug: 'ئاستىغا يۆتكە' },
  hidePanel: { zh: '隐藏面板', en: 'Hide panel', ug: 'تاختىنى يوشۇر' },
  showLeft: {
    zh: '在左侧显示「{title}」',
    en: 'Show "{title}" on the left',
    ug: '«{title}» نى سولدا كۆرسەت',
  },
  showRight: {
    zh: '在右侧显示「{title}」',
    en: 'Show "{title}" on the right',
    ug: '«{title}» نى ئوڭدا كۆرسەت',
  },
  showBottom: {
    zh: '在底部显示「{title}」',
    en: 'Show "{title}" at the bottom',
    ug: '«{title}» نى ئاستىدا كۆرسەت',
  },
})

const MOVE_TO = { left: 'moveLeft', right: 'moveRight', bottom: 'moveBottom' } as const
const SHOW_IN = { left: 'showLeft', right: 'showRight', bottom: 'showBottom' } as const

const REGIONS: DockRegion[] = ['left', 'right', 'bottom']
const MIN_TERMINAL = { width: 320, height: 120 }

/**
 * Places panels into the left/right/bottom regions around the terminal. Each region shows its
 * panels as tabs; splitter positions are written back to settings.
 */
export function mountLayout(shell: HTMLElement, onError: (error: unknown) => void): Layout {
  const panels = new Map<PanelId, PanelHost>()
  const titles = new Map<PanelId, { title: string; icon?: string }>()
  const regions = {} as Record<DockRegion, HTMLElement>
  const splitters = {} as Record<DockRegion, HTMLElement>
  const tabLists = {} as Record<DockRegion, HTMLElement>
  const bodies = {} as Record<DockRegion, HTMLElement>
  const chosen: Partial<Record<DockRegion, PanelId>> = {}
  const sizes = { ...settings().layout.sizes }
  const suppressed = new Set<PanelId>()
  let visible: Record<DockRegion, PanelId[]> = { left: [], right: [], bottom: [] }

  for (const region of REGIONS) {
    const element = shell.querySelector<HTMLElement>(`.gx-region[data-region="${region}"]`)
    const splitter = shell.querySelector<HTMLElement>(`.gx-splitter[data-for="${region}"]`)
    if (!element || !splitter) throw new Error(`missing region ${region}`)
    tabLists[region] = h('div', { class: 'gx-region-tabs', role: 'tablist' })
    bodies[region] = h('div', { class: 'gx-region-body' })
    element.append(tabLists[region], bodies[region])
    regions[region] = element
    splitters[region] = splitter
    bindSplitter(region)
    tabLists[region].addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
      const ids = visible[region]
      const index = ids.indexOf(chosen[region] ?? ids[0])
      // Tabs run right to left in right-to-left text.
      const step = (event.key === 'ArrowRight') !== isRtl() ? 1 : -1
      const next = ids[(index + step + ids.length) % ids.length]
      select(region, next)
      tabLists[region].querySelector<HTMLElement>(`[data-panel="${next}"]`)?.focus()
    })
    tabLists[region].addEventListener('contextmenu', (event) => {
      const tab = (event.target as Element).closest<HTMLElement>('.gx-region-tab')
      const id = tab?.dataset.panel
      if (!id) return
      event.preventDefault()
      select(region, id)
      showMenu(event.clientX, event.clientY, tabMenu(id, region))
    })
  }

  function place(id: PanelId, region: Region): void {
    updateSettings((draft) => {
      const entry = draft.layout.panels.find((p) => p.id === id)
      if (!entry || entry.region === region) return
      draft.layout.preset = 'custom'
      entry.region = region
    }).catch(onError)
  }

  function tabMenu(id: PanelId, region: DockRegion): MenuItem[] {
    const icons: Record<DockRegion, string> = {
      left: 'sidebar-simple',
      right: 'sidebar',
      bottom: 'rows',
    }
    return [
      ...REGIONS.map(
        (target): MenuItem => ({
          label: t(MOVE_TO[target]),
          icon: icons[target],
          disabled: target === region,
          action: () => place(id, target),
        }),
      ),
      'separator',
      { label: t('hidePanel'), icon: 'eye-slash', action: () => place(id, 'hidden') },
      'separator',
      ...settings()
        .layout.panels.filter((p) => p.region === 'hidden' && panels.has(p.id))
        .map(
          (p): MenuItem => ({
            label: t(SHOW_IN[region], { title: titles.get(p.id)?.title ?? p.id }),
            icon: titles.get(p.id)?.icon ?? 'eye',
            action: () => place(p.id, region),
          }),
        ),
      ...menuItems('panel/tab', { panel: id, region }),
    ]
  }

  function limit(region: DockRegion, value: number): number {
    const [min, max] = SIZE_LIMITS[region]
    const room =
      region === 'bottom'
        ? shell.clientHeight - MIN_TERMINAL.height
        : shell.clientWidth -
          MIN_TERMINAL.width -
          (region === 'left' ? sizeOf('right') : sizeOf('left'))
    return Math.round(Math.max(min, Math.min(max, room > 0 ? room : max, value)))
  }

  function sizeOf(region: DockRegion): number {
    return visible[region].length > 0 ? sizes[region] : 0
  }

  function applySize(region: DockRegion): void {
    shell.style.setProperty(`--gx-${region}-size`, `${sizeOf(region)}px`)
    const splitter = splitters[region]
    splitter.setAttribute('aria-valuenow', String(sizes[region]))
    splitter.setAttribute('aria-valuemin', String(SIZE_LIMITS[region][0]))
    splitter.setAttribute('aria-valuemax', String(SIZE_LIMITS[region][1]))
  }

  function select(region: DockRegion, id: PanelId): void {
    chosen[region] = id
    for (const tab of tabLists[region].children) {
      const active = (tab as HTMLElement).dataset.panel === id
      tab.setAttribute('aria-selected', String(active))
      ;(tab as HTMLElement).tabIndex = active ? 0 : -1
    }
    for (const panelId of visible[region]) {
      const host = panels.get(panelId)
      if (host) host.element.hidden = panelId !== id
    }
    panels.get(id)?.shown?.()
  }

  function apply(next: Settings): void {
    visible = panelsByRegion(
      next.layout.panels.filter((p) => panels.has(p.id) && !suppressed.has(p.id)),
    )
    Object.assign(sizes, next.layout.sizes)
    for (const region of REGIONS) {
      const ids = visible[region]
      regions[region].hidden = ids.length === 0
      splitters[region].hidden = ids.length === 0
      tabLists[region].replaceChildren(
        ...ids.map((id) => {
          const label = titles.get(id)
          return h(
            'button',
            {
              type: 'button',
              role: 'tab',
              class: 'gx-region-tab',
              id: `panel-tab-${id}`,
              'data-panel': id,
              'aria-controls': `panel-${id}`,
              onclick: () => select(region, id),
            },
            label?.icon ? namedIcon(label.icon) : null,
            h('span', { text: label?.title ?? id }),
          )
        }),
      )
      bodies[region].replaceChildren(...ids.map((id) => (panels.get(id) as PanelHost).element))
      applySize(region)
      const keep = chosen[region]
      if (ids.length > 0) select(region, keep && ids.includes(keep) ? keep : ids[0])
    }
    for (const [id, host] of panels) {
      if (!REGIONS.some((r) => visible[r].includes(id))) host.element.remove()
    }
  }

  let persistTimer = 0
  function persist(region: DockRegion): void {
    clearTimeout(persistTimer)
    persistTimer = window.setTimeout(() => {
      updateSettings((draft) => {
        draft.layout.sizes[region] = sizes[region]
      }).catch(onError)
    }, 250)
  }

  function bindSplitter(region: DockRegion): void {
    const splitter = splitters[region]
    const vertical = region !== 'bottom'
    // Dragging the left splitter right grows the left region; the other two grow the other way.
    const sign = region === 'left' ? 1 : -1
    splitter.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return
      event.preventDefault()
      splitter.setPointerCapture(event.pointerId)
      splitter.classList.add('dragging')
      const origin = vertical ? event.clientX : event.clientY
      const start = sizes[region]
      const move = (e: PointerEvent) => {
        sizes[region] = limit(region, start + sign * ((vertical ? e.clientX : e.clientY) - origin))
        applySize(region)
      }
      const end = () => {
        splitter.classList.remove('dragging')
        splitter.removeEventListener('pointermove', move)
        splitter.removeEventListener('pointerup', end)
        splitter.removeEventListener('pointercancel', end)
        persist(region)
      }
      splitter.addEventListener('pointermove', move)
      splitter.addEventListener('pointerup', end)
      splitter.addEventListener('pointercancel', end)
    })
    splitter.addEventListener('keydown', (event) => {
      const keys = vertical ? ['ArrowLeft', 'ArrowRight'] : ['ArrowUp', 'ArrowDown']
      const index = keys.indexOf(event.key)
      if (index < 0) return
      event.preventDefault()
      const direction = (index === 1 ? 1 : -1) * (vertical ? sign : -1)
      sizes[region] = limit(region, sizes[region] + direction * (event.shiftKey ? 64 : 16))
      applySize(region)
      persist(region)
    })
  }

  apply(settings())
  onSettings((next, previous) => {
    const moved = JSON.stringify(next.layout.panels) !== JSON.stringify(previous.layout.panels)
    const resized = JSON.stringify(next.layout.sizes) !== JSON.stringify(previous.layout.sizes)
    if (moved) apply(next)
    else if (resized) {
      Object.assign(sizes, next.layout.sizes)
      for (const region of REGIONS) applySize(region)
    }
  })

  return {
    suppress(id, hidden) {
      if (suppressed.has(id) === hidden) return
      if (hidden) suppressed.add(id)
      else suppressed.delete(id)
      apply(settings())
    },
    addPanel(id, host, title, icon) {
      host.element.classList.add('gx-panel')
      host.element.dataset.panel = id
      host.element.id = `panel-${id}`
      host.element.setAttribute('role', 'tabpanel')
      host.element.setAttribute('aria-labelledby', `panel-tab-${id}`)
      panels.set(id, host)
      titles.set(id, { title, icon })
      apply(settings())
    },
    removePanel(id) {
      const host = panels.get(id)
      if (!host) return
      panels.delete(id)
      titles.delete(id)
      host.element.remove()
      apply(settings())
    },
  }
}
