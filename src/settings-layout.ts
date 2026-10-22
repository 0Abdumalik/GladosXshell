import { h } from './dom'
import { messages } from './i18n'
import { icon } from './icons'
import { panelDef, panelTitle } from './plugins/registry'
import {
  DEFAULT_SIZES,
  moveItem,
  PRESETS,
  type PresetId,
  panelsByRegion,
  presetPanels,
  REGION_NAMES,
  type Region,
  WIDGET_NAMES,
} from './settings-model'
import { settings, updateSettings } from './settings-store'

const t = messages({
  moveUp: { zh: '上移 {name}', en: 'Move {name} up', ug: '{name} نى يۇقىرىغا يۆتكە' },
  moveDown: { zh: '下移 {name}', en: 'Move {name} down', ug: '{name} نى تۆۋەنگە يۆتكە' },
  presets: { zh: '布局预设', en: 'Layout presets', ug: 'تەييار ئورۇنلاشتۇرۇشلار' },
  custom: {
    zh: '当前为自定义布局。选择一个预设会覆盖下方的面板位置。',
    en: 'The current layout is custom. Choosing a preset replaces the panel positions below.',
    ug: 'نۆۋەتتىكىسى ئۆزلەشتۈرۈلگەن ئورۇنلاشتۇرۇش. بىر تەييار ئورۇنلاشتۇرۇشنى تاللىسىڭىز تۆۋەندىكى تاختا ئورۇنلىرى قاپلىنىدۇ.',
  },
  position: { zh: '{name}的位置', en: 'Position of {name}', ug: '{name} نىڭ ئورنى' },
  pluginOff: { zh: '（插件未启用）', en: ' (plugin not enabled)', ug: ' (قىستۇرما قوزغىتىلمىغان)' },
  presetHeading: { zh: '预设', en: 'Presets', ug: 'تەييار ئورۇنلاشتۇرۇش' },
  positions: { zh: '面板位置', en: 'Panel positions', ug: 'تاختا ئورۇنلىرى' },
  tabsHelp: {
    zh: '同一区域里有多个面板时以页签切换，排在前面的页签靠左。',
    en: 'Panels that share an area become tabs; the higher a panel is in this list, the further left its tab.',
    ug: 'بىر رايوندا بىر قانچە تاختا بولسا بەتكۈچ ئارقىلىق ئالماشتۇرۇلىدۇ، تىزىملىكتە ئالدىدا تۇرغىنىنىڭ بەتكۈچىمۇ ئالدىدا تۇرىدۇ.',
  },
  resetSizes: { zh: '恢复默认尺寸', en: 'Restore default sizes', ug: 'سۈكۈتتىكى چوڭلۇققا قايتۇر' },
  layout: { zh: '布局', en: 'Layout', ug: 'ئورۇنلاشتۇرۇش' },
  refreshHeading: { zh: '刷新', en: 'Refresh', ug: 'يېڭىلاش' },
  interval: {
    zh: '刷新间隔（秒）',
    en: 'Refresh interval (seconds)',
    ug: 'يېڭىلاش ئارىلىقى (سېكۇنت)',
  },
  intervalHelp: {
    zh: '只有当前显示的 SSH 标签会刷新，其余标签暂停。',
    en: 'Only the SSH tab on screen refreshes; the others pause.',
    ug: 'پەقەت نۆۋەتتە كۆرسىتىلىۋاتقان SSH بەتكۈچىلا يېڭىلىنىدۇ، باشقا بەتكۈچلەر توختاپ تۇرىدۇ.',
  },
  widgets: { zh: '小部件', en: 'Widgets', ug: 'كىچىك قورال' },
  widgetsHelp: {
    zh: '取消勾选可隐藏，用箭头调整显示顺序。',
    en: 'Clear a checkbox to hide that widget; use the arrows to change the order.',
    ug: 'بەلگىنى ئېلىۋەتسىڭىز يوشۇرۇلىدۇ، يا ئوقلار بىلەن كۆرسىتىش تەرتىپىنى تەڭشەڭ.',
  },
  status: { zh: '状态面板', en: 'Status panel', ug: 'ھالەت تاختىسى' },
})

export interface Section {
  id: string
  label: string
  element: HTMLElement
  /** Re-renders from the current settings. */
  refresh: () => void
  /** Called when the settings dialog closes. */
  dispose?: () => void
}

type Report = (error: unknown) => void

const REGIONS: Region[] = ['left', 'right', 'bottom', 'hidden']

function moveButtons(index: number, count: number, name: string, move: (step: -1 | 1) => void) {
  return h(
    'span',
    { class: 'order-buttons' },
    h(
      'button',
      {
        type: 'button',
        class: 'icon-button',
        'aria-label': t('moveUp', { name }),
        disabled: index === 0,
        onclick: () => move(-1),
      },
      icon('arrow-up'),
    ),
    h(
      'button',
      {
        type: 'button',
        class: 'icon-button',
        'aria-label': t('moveDown', { name }),
        disabled: index === count - 1,
        onclick: () => move(1),
      },
      icon('arrow-down'),
    ),
  )
}

function diagram(preset: Exclude<PresetId, 'custom'>): HTMLElement {
  const byRegion = panelsByRegion(presetPanels(preset))
  const box = (region: 'left' | 'right' | 'bottom') =>
    byRegion[region].length > 0 ? h('span', { class: 'preset-box', 'data-region': region }) : null
  return h(
    'span',
    { class: 'preset-diagram', 'aria-hidden': 'true' },
    box('left'),
    h('span', { class: 'preset-box', 'data-region': 'center' }),
    box('right'),
    box('bottom'),
  )
}

export function layoutSection(report: Report): Section {
  const presets = h('div', {
    class: 'preset-grid',
    role: 'radiogroup',
    'aria-label': t('presets'),
  })
  const custom = h('p', { class: 'help', text: t('custom') })
  const rows = h('ul', { class: 'settings-list' })

  const refresh = () => {
    const layout = settings().layout
    presets.replaceChildren(
      ...PRESETS.map((preset) =>
        h(
          'button',
          {
            type: 'button',
            role: 'radio',
            class: 'preset-card',
            'aria-checked': String(layout.preset === preset.id),
            onclick: () =>
              updateSettings((d) => {
                d.layout.preset = preset.id
                d.layout.panels = presetPanels(
                  preset.id,
                  d.layout.panels,
                  (id) => panelDef(id)?.region,
                )
              }).catch(report),
          },
          diagram(preset.id),
          h('span', { class: 'preset-name', text: preset.name }),
          h('span', { class: 'preset-desc', text: preset.description }),
        ),
      ),
    )
    custom.hidden = layout.preset !== 'custom'
    rows.replaceChildren(
      ...layout.panels.map((place, index) => {
        const name = panelTitle(place.id)
        const select = h(
          'select',
          {
            'aria-label': t('position', { name }),
            onchange: (e: Event) =>
              updateSettings((d) => {
                d.layout.preset = 'custom'
                d.layout.panels[index].region = (e.target as HTMLSelectElement).value as Region
              }).catch(report),
          },
          ...REGIONS.map((r) =>
            h('option', { value: r, selected: r === place.region, text: REGION_NAMES[r] }),
          ),
        )
        return h(
          'li',
          { class: 'settings-row' },
          h(
            'span',
            { class: 'settings-row-name' },
            name,
            panelDef(place.id) ? null : h('span', { class: 'help', text: t('pluginOff') }),
          ),
          select,
          moveButtons(index, layout.panels.length, name, (step) =>
            updateSettings((d) => {
              d.layout.preset = 'custom'
              d.layout.panels = moveItem(d.layout.panels, index, step)
            }).catch(report),
          ),
        )
      }),
    )
  }

  const element = h(
    'div',
    { class: 'settings-section' },
    h('h3', { text: t('presetHeading') }),
    presets,
    h('h3', { text: t('positions') }),
    h('p', { class: 'help', text: t('tabsHelp') }),
    custom,
    rows,
    h(
      'div',
      { class: 'settings-actions' },
      h('button', {
        type: 'button',
        class: 'button small',
        text: t('resetSizes'),
        onclick: () =>
          updateSettings((d) => {
            d.layout.sizes = { ...DEFAULT_SIZES }
          }).catch(report),
      }),
    ),
  )
  refresh()
  return { id: 'layout', label: t('layout'), element, refresh }
}

export function statusSection(report: Report): Section {
  const interval = h('input', {
    id: 'set-interval',
    type: 'number',
    min: '1',
    max: '60',
    step: '1',
    inputmode: 'numeric',
  })
  interval.addEventListener('change', () => {
    const value = Math.round(Number(interval.value))
    if (!Number.isFinite(value) || value < 1 || value > 60) {
      interval.value = String(settings().status.intervalSecs)
      return
    }
    updateSettings((d) => {
      d.status.intervalSecs = value
    }).catch(report)
  })
  const rows = h('ul', { class: 'settings-list' })

  const refresh = () => {
    const status = settings().status
    if (document.activeElement !== interval) interval.value = String(status.intervalSecs)
    rows.replaceChildren(
      ...status.widgets.map((widget, index) => {
        const name = WIDGET_NAMES[widget.id]
        return h(
          'li',
          { class: 'settings-row' },
          h(
            'label',
            { class: 'check settings-row-name' },
            h('input', {
              type: 'checkbox',
              checked: widget.enabled,
              onchange: (e: Event) =>
                updateSettings((d) => {
                  d.status.widgets[index].enabled = (e.target as HTMLInputElement).checked
                }).catch(report),
            }),
            name,
          ),
          moveButtons(index, status.widgets.length, name, (step) =>
            updateSettings((d) => {
              d.status.widgets = moveItem(d.status.widgets, index, step)
            }).catch(report),
          ),
        )
      }),
    )
  }

  const element = h(
    'div',
    { class: 'settings-section' },
    h('h3', { text: t('refreshHeading') }),
    h(
      'div',
      { class: 'field field-narrow' },
      h('label', { for: 'set-interval', text: t('interval') }),
      interval,
      h('p', { class: 'help', text: t('intervalHelp') }),
    ),
    h('h3', { text: t('widgets') }),
    h('p', { class: 'help', text: t('widgetsHelp') }),
    rows,
  )
  refresh()
  return { id: 'status', label: t('status'), element, refresh }
}
