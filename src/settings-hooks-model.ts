import { messages } from './i18n'

const t = messages({
  region: { zh: '停靠区域', en: 'Dock areas', ug: 'توختىتىش رايونى' },
  panel: {
    zh: '面板，插件面板的 id 也会列出',
    en: 'Panels; plugin panel ids are listed too',
    ug: 'تاختا، قىستۇرما تاختىلىرىنىڭ id سىمۇ كۆرسىتىلىدۇ',
  },
  regionTab: {
    zh: '停靠区域的页签',
    en: 'Tabs in dock areas',
    ug: 'توختىتىش رايونىدىكى بەتكۈچلەر',
  },
  cmdPane: {
    zh: '指令台的收藏和编辑器',
    en: 'Favorites and editor in the Commands panel',
    ug: 'بۇيرۇقلار تاختىسىدىكى يىغقۇچ ۋە تەھرىرلىگۈچ',
  },
  commandBar: {
    zh: '终端下方的指令栏',
    en: 'Command bar below the terminal',
    ug: 'تېرمىنال ئاستىدىكى بۇيرۇق بالدىقى',
  },
  tab: { zh: '终端标签', en: 'Terminal tabs', ug: 'تېرمىنال بەتكۈچلىرى' },
  terminalArea: { zh: '终端区域', en: 'Terminal area', ug: 'تېرمىنال رايونى' },
  backdrop: { zh: '终端背景图层', en: 'Terminal background layer', ug: 'تېرمىنال تەگلىك قاتلىمى' },
  marks: {
    zh: '清空位置导航',
    en: 'Navigation between screen clears',
    ug: 'ئېكران تازىلانغان ئورۇنلار ئارا يۆتكىلىش',
  },
  banner: {
    zh: '连接断开或失败的提示',
    en: 'Notice when a connection drops or fails',
    ug: 'ئۇلىنىش ئۈزۈلگەن ياكى مەغلۇپ بولغاندىكى ئەسكەرتىش',
  },
  filesTree: { zh: '文件目录树', en: 'File tree', ug: 'ھۆججەت مۇندەرىجە دەرىخى' },
  filesIcon: { zh: '文件类型图标', en: 'File type icons', ug: 'ھۆججەت تىپى سىنبەلگىلىرى' },
  widget: { zh: '状态小部件', en: 'Status widgets', ug: 'ھالەت كىچىك قوراللىرى' },
  statusbar: { zh: '底部状态栏', en: 'Status bar at the bottom', ug: 'ئاستىدىكى ھالەت بالدىقى' },
  statusbarItem: {
    zh: '状态栏里的会话、终端大小和传输条目',
    en: 'Session, terminal size and transfer items in the status bar',
    ug: 'ھالەت بالدىقىدىكى ئەڭگىمە، تېرمىنال چوڭلۇقى ۋە يوللاش تۈرلىرى',
  },
  menu: {
    zh: '右键菜单，打开时才能统计',
    en: 'Context menu; counted only while open',
    ug: 'ئوڭ كۇنۇپكا تىزىملىكى، ئېچىلغاندىلا سانىغىلى بولىدۇ',
  },
  dialog: {
    zh: '弹窗，打开时才能统计',
    en: 'Dialogs; counted only while open',
    ug: 'سۆزلىشىش رامكىسى، ئېچىلغاندىلا سانىغىلى بولىدۇ',
  },
  // Token groups; the keys are the group ids.
  surface: { zh: '背景层级', en: 'Surface levels', ug: 'تەگلىك قاتلاملىرى' },
  text: { zh: '文字', en: 'Text', ug: 'تېكىست' },
  accent: { zh: '强调色', en: 'Accent', ug: 'تەكىتلەش رەڭگى' },
  border: { zh: '边框', en: 'Borders', ug: 'گىرۋەك' },
  interaction: { zh: '交互状态', en: 'Interaction states', ug: 'مەشغۇلات ھالىتى' },
  status: { zh: '状态色', en: 'Status colors', ug: 'ھالەت رەڭلىرى' },
  terminal: {
    zh: '终端（十六进制，新开标签生效）',
    en: 'Terminal (hex, applies to new tabs)',
    ug: 'تېرمىنال (ئون ئالتىلىك، يېڭى بەتكۈچتە كۈچكە ئىگە)',
  },
  chart: { zh: '图表与仪表', en: 'Charts and meters', ug: 'دىئاگرامما ۋە ئۆلچىگۈچ' },
  icon: { zh: '图标颜色', en: 'Icon colors', ug: 'سىنبەلگە رەڭلىرى' },
  syntax: { zh: '语法着色', en: 'Syntax highlighting', ug: 'گرامماتىكا رەڭلەش' },
  palette: { zh: '基础色阶', en: 'Base color scales', ug: 'ئاساسىي رەڭ دەرىجىلىرى' },
  font: { zh: '字体', en: 'Fonts', ug: 'خەت نۇسخىسى' },
  spacing: { zh: '间距与圆角', en: 'Spacing and corner radius', ug: 'ئارىلىق ۋە يۇمىلاق بۇلۇڭ' },
  depth: { zh: '阴影与层级', en: 'Shadows and layers', ug: 'سايە ۋە قاتلام' },
  motion: { zh: '动画曲线', en: 'Easing curves', ug: 'ھەرىكەت ئەگرى سىزىقى' },
  other: { zh: '其他', en: 'Other', ug: 'باشقا' },
})

export interface SelectorHook {
  base: string
  desc: string
  /** Data attribute whose values pick out variants; values seen in the page are added. */
  attr?: string
  values?: string[]
}

export const SELECTOR_HOOKS: SelectorHook[] = [
  {
    base: '.gx-region',
    attr: 'data-region',
    values: ['left', 'right', 'bottom'],
    desc: t('region'),
  },
  {
    base: '.gx-panel',
    attr: 'data-panel',
    values: ['status', 'files', 'commands', 'connections'],
    desc: t('panel'),
  },
  { base: '.gx-region-tab', attr: 'data-panel', desc: t('regionTab') },
  {
    base: '.cmd-pane',
    attr: 'data-pane',
    values: ['favorites', 'editor'],
    desc: t('cmdPane'),
  },
  { base: '.gx-command-bar', desc: t('commandBar') },
  {
    base: '.tab',
    attr: 'data-kind',
    values: ['local', 'ssh', 'telnet', 'serial'],
    desc: t('tab'),
  },
  { base: '.terminal', desc: t('terminalArea') },
  { base: '.terminal-backdrop', desc: t('backdrop') },
  { base: '.terminal-marks', desc: t('marks') },
  {
    base: '.terminal-banner',
    attr: 'data-tone',
    values: ['error', 'info'],
    desc: t('banner'),
  },
  { base: '.files-tree', desc: t('filesTree') },
  { base: '.files-icon', attr: 'data-icon', desc: t('filesIcon') },
  {
    base: '.gx-widget',
    attr: 'data-widget',
    values: ['info', 'resources', 'processes', 'network', 'latency', 'disks', 'connections'],
    desc: t('widget'),
  },
  { base: '.statusbar', desc: t('statusbar') },
  { base: '.statusbar-item', desc: t('statusbarItem') },
  { base: '.gx-menu', desc: t('menu') },
  { base: '.gx-dialog', attr: 'data-dialog', desc: t('dialog') },
]

export function variantSelector(hook: SelectorHook, value: string): string {
  return `${hook.base}[${hook.attr}="${value.replace(/["\\]/g, '\\$&')}"]`
}

export type TokenGroup =
  | 'surface'
  | 'text'
  | 'accent'
  | 'border'
  | 'interaction'
  | 'status'
  | 'terminal'
  | 'chart'
  | 'icon'
  | 'syntax'
  | 'palette'
  | 'font'
  | 'spacing'
  | 'depth'
  | 'motion'
  | 'other'

const GROUPS: [TokenGroup, string[]][] = [
  ['surface', ['surface']],
  ['text', ['text', 'on']],
  ['accent', ['accent']],
  ['border', ['border']],
  ['interaction', ['hover', 'selected']],
  ['status', ['danger', 'success', 'warning']],
  ['terminal', ['terminal']],
  ['chart', ['chart', 'meter']],
  ['icon', ['icon']],
  ['syntax', ['syn', 'code']],
  ['palette', ['n', 'blue', 'red', 'green', 'amber', 'purple']],
  ['font', ['font']],
  ['spacing', ['space', 'radius']],
  ['depth', ['shadow', 'z', 'dialog']],
  ['motion', ['ease']],
]

/** Group of a `--gx-*` token; unknown prefixes go under `other`. */
export function tokenGroupId(name: string): TokenGroup {
  const prefix = name.replace(/^--gx-/, '').split('-')[0]
  return GROUPS.find(([, prefixes]) => prefixes.includes(prefix))?.[0] ?? 'other'
}

export const groupLabel = (group: TokenGroup): string => t(group)

/** Group label for a `--gx-*` token. */
export function tokenGroup(name: string): string {
  return groupLabel(tokenGroupId(name))
}

export function groupOrder(group: TokenGroup): number {
  const index = GROUPS.findIndex(([id]) => id === group)
  return index < 0 ? GROUPS.length : index
}

export function matchesFilter(query: string, ...fields: string[]): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  const haystack = fields.join(' ').toLowerCase()
  return words.every((w) => haystack.includes(w))
}

/** Adds the declaration to the first `:root { }` block, or appends a new block. */
export function insertDeclaration(css: string, declaration: string): { css: string; at: number } {
  const root = /:root\s*\{/.exec(css)
  const close = root ? css.indexOf('}', root.index) : -1
  if (root && close >= 0) {
    const before = css.slice(0, close)
    const line = `${before.endsWith('\n') ? '' : '\n'}  ${declaration}\n`
    return { css: before + line + css.slice(close), at: close + line.length - 1 }
  }
  const gap = css === '' || css.endsWith('\n\n') ? '' : css.endsWith('\n') ? '\n' : '\n\n'
  const block = `${gap}:root {\n  ${declaration}\n}\n`
  return { css: css + block, at: css.length + block.length - 3 }
}
