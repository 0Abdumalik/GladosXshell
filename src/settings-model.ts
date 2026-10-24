import { messages } from './i18n'
import { common } from './i18n-common'

const t = messages({
  lineNumbers: { zh: '行号', en: 'Line numbers', ug: 'قۇر نومۇرى' },
  lineNumbersHelp: {
    zh: '在左侧显示行号',
    en: 'Show line numbers on the left',
    ug: 'سول تەرەپتە قۇر نومۇرىنى كۆرسىتىدۇ',
  },
  fold: { zh: '代码折叠', en: 'Code folding', ug: 'كود قاتلاش' },
  foldHelp: {
    zh: '在行号旁折叠代码块',
    en: 'Fold code blocks from beside the line numbers',
    ug: 'قۇر نومۇرىنىڭ يېنىدا كود بۆلىكىنى قاتلايدۇ',
  },
  indentGuides: { zh: '缩进参考线', en: 'Indent guides', ug: 'تارتىلىش يېتەكچى سىزىقى' },
  indentGuidesHelp: {
    zh: '每一级缩进画一条竖线',
    en: 'Draw a vertical line at each indent level',
    ug: 'ھەر بىر دەرىجىلىك تارتىلىشقا بىر تىك سىزىق سىزىدۇ',
  },
  activeLine: { zh: '高亮当前行', en: 'Highlight current line', ug: 'نۆۋەتتىكى قۇرنى يورۇتۇش' },
  activeLineHelp: {
    zh: '突出光标所在的行',
    en: 'Make the line with the cursor stand out',
    ug: 'نۇر بەلگىسى تۇرغان قۇرنى گەۋدىلەندۈرىدۇ',
  },
  selectionMatches: {
    zh: '高亮相同内容',
    en: 'Highlight matches',
    ug: 'ئوخشاش مەزمۇننى يورۇتۇش',
  },
  selectionMatchesHelp: {
    zh: '标出与选中文字相同的其他位置',
    en: 'Mark other places with the same text as the selection',
    ug: 'تاللانغان تېكىستكە ئوخشاش باشقا ئورۇنلارنى بەلگىلەيدۇ',
  },
  closeBrackets: {
    zh: '自动闭合括号',
    en: 'Auto close brackets',
    ug: 'تىرناقنى ئاپتوماتىك يېپىش',
  },
  closeBracketsHelp: {
    zh: '输入括号和引号时补上另一半',
    en: 'Add the closing half when you type a bracket or quote',
    ug: 'تىرناق ياكى قوش تىرناق كىرگۈزگەندە يەنە بىر يېرىمىنى قوشىدۇ',
  },
  autocomplete: { zh: '自动补全', en: 'Autocomplete', ug: 'ئاپتوماتىك تولۇقلاش' },
  autocompleteHelp: {
    zh: '输入时提示文件中已有的词',
    en: 'Suggest words from the file as you type',
    ug: 'كىرگۈزگەندە ھۆججەتتە بار سۆزلەرنى تەۋسىيە قىلىدۇ',
  },
  wordWrap: { zh: '自动换行', en: 'Word wrap', ug: 'ئاپتوماتىك قۇر قاتلاش' },
  wordWrapHelp: {
    zh: '长行在窗口边缘折行显示',
    en: 'Wrap long lines at the edge of the window',
    ug: 'ئۇزۇن قۇرلارنى كۆزنەك گىرۋىكىدە قاتلاپ كۆرسىتىدۇ',
  },
  whitespace: { zh: '显示空白字符', en: 'Show whitespace', ug: 'بوشلۇق ھەرپلىرىنى كۆرسىتىش' },
  whitespaceHelp: {
    zh: '用点和箭头标出空格与制表符',
    en: 'Mark spaces and tabs with dots and arrows',
    ug: 'بوشلۇق ۋە Tab ھەرپلىرىنى چېكىت ۋە يا ئوق بىلەن بەلگىلەيدۇ',
  },
  lint: { zh: '错误检查', en: 'Error checking', ug: 'خاتالىق تەكشۈرۈش' },
  lintHelp: {
    zh: '标出缺少的括号、语法错误和未闭合的标签',
    en: 'Mark missing brackets, syntax errors and unclosed tags',
    ug: 'كەم تىرناق، گرامماتىكىلىق خاتالىق ۋە يېپىلمىغان خەتكۈچلەرنى بەلگىلەيدۇ',
  },
  minimap: { zh: '缩略图', en: 'Minimap', ug: 'كىچىك خەرىتە' },
  minimapHelp: {
    zh: '在右侧显示整个文件的缩略图',
    en: 'Show an overview of the whole file on the right',
    ug: 'ئوڭ تەرەپتە پۈتۈن ھۆججەتنىڭ كىچىك خەرىتىسىنى كۆرسىتىدۇ',
  },
  formatOnSave: { zh: '保存时格式化', en: 'Format on save', ug: 'ساقلىغاندا فورماتلا' },
  formatOnSaveHelp: {
    zh: '保存 JS、TS、JSON、HTML、XML、CSS 文件前先整理缩进和换行',
    en: 'Tidy indentation and line breaks in JS, TS, JSON, HTML, XML and CSS files before saving',
    ug: 'JS، TS، JSON، HTML، XML ۋە CSS ھۆججەتلىرىنى ساقلاشتىن بۇرۇن تارتىلىش ۋە قۇر ئالماشتۇرۇشنى رەتلەيدۇ',
  },
  panelStatus: { zh: '服务器状态', en: 'Server status', ug: 'مۇلازىمېتىر ھالىتى' },
  panelFiles: { zh: '文件', en: 'Files', ug: 'ھۆججەتلەر' },
  panelCommands: { zh: '指令台', en: 'Commands', ug: 'بۇيرۇقلار' },
  panelConnections: { zh: '连接', en: 'Connections', ug: 'ئۇلىنىشلار' },
  regionLeft: { zh: '左侧', en: 'Left', ug: 'سول' },
  regionRight: { zh: '右侧', en: 'Right', ug: 'ئوڭ' },
  regionBottom: { zh: '底部', en: 'Bottom', ug: 'ئاستى' },
  regionHidden: { zh: '隐藏', en: 'Hidden', ug: 'يوشۇرۇن' },
  widgetInfo: { zh: '基本信息', en: 'Overview', ug: 'ئاساسىي ئۇچۇر' },
  widgetResources: { zh: '资源', en: 'Resources', ug: 'بايلىق' },
  widgetProcesses: { zh: '进程', en: 'Processes', ug: 'جەريانلار' },
  widgetNetwork: { zh: '网络', en: 'Network', ug: 'تور' },
  widgetLatency: { zh: '延迟', en: 'Latency', ug: 'كېچىكىش' },
  widgetDisks: { zh: '磁盘', en: 'Disks', ug: 'دىسكىلار' },
  widgetPorts: { zh: '监听端口', en: 'Listening ports', ug: 'ئاڭلاۋاتقان ئېغىزلار' },
  presetFinalshellHelp: {
    zh: '左侧状态，底部文件和指令台',
    en: 'Status on the left, files and commands at the bottom',
    ug: 'ھالەت سولدا، ھۆججەتلەر ۋە بۇيرۇقلار ئاستىدا',
  },
  presetSidebar: { zh: '侧栏页签', en: 'Sidebar tabs', ug: 'يان تاختا بەتكۈچلىرى' },
  presetSidebarHelp: {
    zh: '连接、状态、文件、指令台都在左侧，以页签切换',
    en: 'Connections, status, files and commands all on the left, one tab each',
    ug: 'ئۇلىنىشلار، ھالەت، ھۆججەتلەر ۋە بۇيرۇقلارنىڭ ھەممىسى سولدا، بەتكۈچ ئارقىلىق ئالماشتۇرۇلىدۇ',
  },
  presetFilesRight: { zh: '文件在右', en: 'Files on the right', ug: 'ھۆججەتلەر ئوڭدا' },
  presetFilesRightHelp: {
    zh: '左侧状态，右侧文件和指令台',
    en: 'Status on the left, files and commands on the right',
    ug: 'ھالەت سولدا، ھۆججەتلەر ۋە بۇيرۇقلار ئوڭدا',
  },
  presetTerminal: { zh: '纯终端', en: 'Terminal only', ug: 'پەقەت تېرمىنال' },
  presetTerminalHelp: {
    zh: '隐藏所有面板',
    en: 'All panels hidden',
    ug: 'بارلىق تاختىلار يوشۇرۇن',
  },
  columnSize: { zh: '大小', en: 'Size', ug: 'چوڭلۇقى' },
  columnModified: { zh: '修改时间', en: 'Modified', ug: 'ئۆزگەرتىلگەن ۋاقىت' },
  columnOwner: { zh: '所有者', en: 'Owner', ug: 'ئىگىسى' },
  columnGroup: { zh: '属组', en: 'Group', ug: 'گۇرۇپپا' },
})

/** A built-in panel or `plugin.id/panel` for one a plugin contributes. */
export type PanelId = string
export type BuiltinPanel = 'status' | 'files' | 'commands' | 'connections'
export type Region = 'left' | 'right' | 'bottom' | 'hidden'
export type DockRegion = Exclude<Region, 'hidden'>
export type WidgetId =
  | 'info'
  | 'resources'
  | 'processes'
  | 'network'
  | 'latency'
  | 'disks'
  | 'connections'
export type EditorMode = 'internal' | 'external'
export type PresetId = 'finalshell' | 'sidebar' | 'filesRight' | 'terminal' | 'custom'
export type FilesView = 'tree' | 'single'
export type CursorStyle = 'block' | 'bar' | 'underline'
export type FileColumnId = 'name' | 'size' | 'kind' | 'mtime' | 'perms' | 'owner' | 'group'

/** `width` is in CSS pixels; the name column fills spare room and treats it as its minimum. */
export interface FileColumn {
  id: FileColumnId
  visible: boolean
  width: number
}

export interface TerminalSettings {
  /** Up to three family names tried in order, before the built-in monospace stack. */
  fonts: string[]
  /** Every font file in this folder joins the fallback after `fonts`. */
  fontFolder: string
  fontSize: number
  /** Percent of the font size. */
  lineHeight: number
  scrollback: number
  cursorStyle: CursorStyle
  cursorBlink: boolean
  copyOnSelect: boolean
  /** Command, option and path suggestions while typing at the shell prompt. */
  suggestions: boolean
  backgroundImage: string
  /** How strongly the image shows through, in percent. */
  backgroundOpacity: number
  /** Ask before pasting text with line breaks outside bracketed-paste mode. */
  pasteConfirm: boolean
  /** Answer `rz` / `sz` (ZMODEM) in the terminal with a file transfer. */
  zmodem: boolean
  log: LogSettings
  /** Shell id from `local_shells` for new local terminals; empty for the system default. */
  defaultShell: string
  /** Reopen the tabs that were open at the last exit. */
  restoreTabs: boolean
}

export interface LogSettings {
  /** Start a log for every session once it connects. */
  auto: boolean
  /** Empty means `logs` in the work folder. */
  dir: string
  /** Strip colours and other escape sequences. */
  plain: boolean
}

/** Optional features of the built-in code editors, each switched on or off like a plugin. */
export interface EditorSettings {
  lineNumbers: boolean
  fold: boolean
  wordWrap: boolean
  whitespace: boolean
  activeLine: boolean
  selectionMatches: boolean
  closeBrackets: boolean
  autocomplete: boolean
  indentGuides: boolean
  lint: boolean
  minimap: boolean
  formatOnSave: boolean
  /** Columns per tab stop and per indent level, 1–8. */
  tabSize: number
}

export type EditorFeature = Exclude<keyof EditorSettings, 'tabSize'>

export const EDITOR_FEATURES: { id: EditorFeature; name: string; description: string }[] = [
  { id: 'lineNumbers', name: t('lineNumbers'), description: t('lineNumbersHelp') },
  { id: 'fold', name: t('fold'), description: t('foldHelp') },
  { id: 'indentGuides', name: t('indentGuides'), description: t('indentGuidesHelp') },
  { id: 'activeLine', name: t('activeLine'), description: t('activeLineHelp') },
  {
    id: 'selectionMatches',
    name: t('selectionMatches'),
    description: t('selectionMatchesHelp'),
  },
  { id: 'closeBrackets', name: t('closeBrackets'), description: t('closeBracketsHelp') },
  { id: 'autocomplete', name: t('autocomplete'), description: t('autocompleteHelp') },
  { id: 'wordWrap', name: t('wordWrap'), description: t('wordWrapHelp') },
  { id: 'whitespace', name: t('whitespace'), description: t('whitespaceHelp') },
  { id: 'lint', name: t('lint'), description: t('lintHelp') },
  { id: 'minimap', name: t('minimap'), description: t('minimapHelp') },
  { id: 'formatOnSave', name: t('formatOnSave'), description: t('formatOnSaveHelp') },
]

export interface PanelPlace {
  id: PanelId
  region: Region
}

export interface Layout {
  preset: PresetId
  panels: PanelPlace[]
  sizes: { left: number; right: number; bottom: number }
}

export interface Settings {
  /** `scale` is a percentage; 0 picks one from the screen size. */
  ui: {
    scale: number
    theme: 'dark' | 'light' | 'auto'
    /** A BCP 47 code, or `'auto'` to follow the system display language. Applies on restart. */
    language: string
  }
  layout: Layout
  status: {
    intervalSecs: number
    widgets: { id: WidgetId; enabled: boolean }[]
    /** Also shows the connections table. */
    advanced: boolean
    widgetHeights: Partial<Record<WidgetId, number>>
    selectedInterfaces: string[]
  }
  commands: { favoritesWidth: number }
  terminal: TerminalSettings
  files: {
    view: FilesView
    editor: EditorMode
    externalEditor: string
    workDir: string
    downloadDir: string
    showHidden: boolean
    columns: FileColumn[]
  }
  editor: EditorSettings
  /** `disabled`: switched off by the user; `enabled`: opt-in plugins switched on. */
  plugins: { disabled: string[]; enabled: string[] }
  /** Recently used paths per field, newest first. */
  recentPaths: Record<string, string[]>
}

export interface SettingsView {
  settings: Settings
  error: string | null
  defaultWorkDir: string
}

export const PANEL_NAMES: Record<BuiltinPanel, string> = {
  status: t('panelStatus'),
  files: t('panelFiles'),
  commands: t('panelCommands'),
  connections: t('panelConnections'),
}

export const REGION_NAMES: Record<Region, string> = {
  left: t('regionLeft'),
  right: t('regionRight'),
  bottom: t('regionBottom'),
  hidden: t('regionHidden'),
}

export const WIDGET_NAMES: Record<WidgetId, string> = {
  info: t('widgetInfo'),
  resources: t('widgetResources'),
  processes: t('widgetProcesses'),
  network: t('widgetNetwork'),
  latency: t('widgetLatency'),
  disks: t('widgetDisks'),
  connections: t('widgetPorts'),
}

export const PRESETS: { id: Exclude<PresetId, 'custom'>; name: string; description: string }[] = [
  { id: 'finalshell', name: 'FinalShell', description: t('presetFinalshellHelp') },
  { id: 'sidebar', name: t('presetSidebar'), description: t('presetSidebarHelp') },
  { id: 'filesRight', name: t('presetFilesRight'), description: t('presetFilesRightHelp') },
  { id: 'terminal', name: t('presetTerminal'), description: t('presetTerminalHelp') },
]

const PRESET_PLACES: Record<Exclude<PresetId, 'custom'>, PanelPlace[]> = {
  finalshell: [
    { id: 'status', region: 'left' },
    { id: 'files', region: 'bottom' },
    { id: 'commands', region: 'bottom' },
    { id: 'connections', region: 'hidden' },
  ],
  sidebar: [
    { id: 'connections', region: 'left' },
    { id: 'status', region: 'left' },
    { id: 'files', region: 'left' },
    { id: 'commands', region: 'left' },
  ],
  filesRight: [
    { id: 'status', region: 'left' },
    { id: 'files', region: 'right' },
    { id: 'commands', region: 'right' },
    { id: 'connections', region: 'hidden' },
  ],
  terminal: [
    { id: 'status', region: 'hidden' },
    { id: 'files', region: 'hidden' },
    { id: 'commands', region: 'hidden' },
    { id: 'connections', region: 'hidden' },
  ],
}

/**
 * Where a preset puts panels it does not name (plugin panels), by the region each one asks for.
 * The regions follow the FinalShell layout, so other presets move them with files and status.
 */
const PRESET_EXTRAS: Record<Exclude<PresetId, 'custom'>, Record<DockRegion, Region>> = {
  finalshell: { left: 'left', right: 'right', bottom: 'bottom' },
  sidebar: { left: 'left', right: 'left', bottom: 'left' },
  filesRight: { left: 'left', right: 'right', bottom: 'right' },
  terminal: { left: 'hidden', right: 'hidden', bottom: 'hidden' },
}

/**
 * Panels a preset does not know keep their place in the list and go where they ask for,
 * translated to the preset; one that asks for nothing, or is not registered now, stays hidden.
 */
export function presetPanels(
  preset: Exclude<PresetId, 'custom'>,
  current: readonly PanelPlace[] = [],
  wanted: (id: PanelId) => Region | undefined = () => undefined,
): PanelPlace[] {
  const places = PRESET_PLACES[preset].map((p) => ({ ...p }))
  for (const place of current) {
    if (places.some((p) => p.id === place.id)) continue
    const asked = wanted(place.id)
    const region = asked && asked !== 'hidden' ? PRESET_EXTRAS[preset][asked] : 'hidden'
    places.push({ id: place.id, region })
  }
  return places
}

/** Panels per visible region, in list order. */
export function panelsByRegion(panels: readonly PanelPlace[]): Record<DockRegion, PanelId[]> {
  const out: Record<DockRegion, PanelId[]> = { left: [], right: [], bottom: [] }
  for (const place of panels) if (place.region !== 'hidden') out[place.region].push(place.id)
  return out
}

/** Moves the item at `index` by `step`, returning a new list; out-of-range moves are no-ops. */
export function moveItem<T>(items: readonly T[], index: number, step: -1 | 1): T[] {
  const target = index + step
  const out = [...items]
  if (index < 0 || index >= out.length || target < 0 || target >= out.length) return out
  ;[out[index], out[target]] = [out[target], out[index]]
  return out
}

export const FILE_COLUMN_NAMES: Record<FileColumnId, string> = {
  name: common('name'),
  size: t('columnSize'),
  kind: common('type'),
  mtime: t('columnModified'),
  perms: common('permissions'),
  owner: t('columnOwner'),
  group: t('columnGroup'),
}

/** Mirrors the backend defaults. */
export const DEFAULT_FILE_COLUMNS: readonly Readonly<FileColumn>[] = [
  { id: 'name', visible: true, width: 200 },
  { id: 'size', visible: true, width: 88 },
  { id: 'kind', visible: true, width: 112 },
  { id: 'mtime', visible: true, width: 152 },
  { id: 'perms', visible: true, width: 104 },
  { id: 'owner', visible: true, width: 88 },
  { id: 'group', visible: false, width: 88 },
]

export const COLUMN_WIDTH_LIMITS: [number, number] = [40, 1200]

export function clampColumnWidth(width: number): number {
  const [min, max] = COLUMN_WIDTH_LIMITS
  return Math.min(max, Math.max(min, Math.round(width)))
}

/** Shows or hides a column; the name column always stays. */
export function toggleColumn(columns: readonly FileColumn[], id: FileColumnId): FileColumn[] {
  return columns.map((c) => (c.id === id && id !== 'name' ? { ...c, visible: !c.visible } : c))
}

/** Swaps a column with its nearest visible neighbour, so hidden columns never absorb a move. */
export function moveColumn(
  columns: readonly FileColumn[],
  id: FileColumnId,
  step: -1 | 1,
): FileColumn[] {
  const out = [...columns]
  const from = out.findIndex((c) => c.id === id)
  if (from < 0) return out
  let to = from + step
  while (to >= 0 && to < out.length && !out[to].visible) to += step
  if (to < 0 || to >= out.length) return out
  ;[out[from], out[to]] = [out[to], out[from]]
  return out
}

export function resizeColumn(
  columns: readonly FileColumn[],
  id: FileColumnId,
  width: number,
): FileColumn[] {
  return columns.map((c) => (c.id === id ? { ...c, width: clampColumnWidth(width) } : c))
}

export const SIZE_LIMITS: Record<DockRegion, [number, number]> = {
  left: [180, 900],
  right: [180, 900],
  bottom: [120, 900],
}

export const DEFAULT_SIZES: Readonly<Layout['sizes']> = { left: 300, right: 380, bottom: 280 }

const DRIVE_PATH = /^[A-Za-z]:[\\/]/
const UNC_PATH = /^\\\\[^\\/]+[\\/][^\\/]+/

/** Empty, a drive path (C:\…) or a UNC path (\\server\share…); the backend rejects anything else. */
export function validLocalPath(path: string): boolean {
  const value = path.trim()
  return value === '' || DRIVE_PATH.test(value) || UNC_PATH.test(value)
}

export const SCALE_CHOICES = [0, 70, 75, 80, 85, 90, 100, 110, 125, 150] as const

/**
 * Zoom for "auto", in steps of 5 between 70 and 100. The layout is sized for a workspace of about
 * 2400 x 1350 logical pixels; smaller screens (a 2K monitor at 125 % or 150 % Windows scaling) are
 * zoomed out to fit. Takes the monitor size in logical pixels.
 */
export function autoScale(screenWidth: number, screenHeight: number): number {
  const fit = Math.min(screenWidth / 2400, screenHeight / 1350)
  return Math.min(100, Math.max(70, Math.round(fit * 20) * 5))
}

export function effectiveScale(scale: number, auto: number): number {
  return scale === 0 ? auto : scale
}

export const MAX_RECENT_PATHS = 8

/** Puts `path` first; Windows paths compare without case. */
export function rememberPath(list: readonly string[], path: string): string[] {
  const value = path.trim()
  if (value === '') return [...list]
  const key = value.toLowerCase()
  return [value, ...list.filter((p) => p.toLowerCase() !== key)].slice(0, MAX_RECENT_PATHS)
}

export const MAX_FONTS = 3
export const DEFAULT_FONTS = ['Cascadia Mono', 'JetBrains Mono', 'Consolas'] as const
/** Google Noto: Latin monospace, then Chinese, then emoji and symbols. */
export const NOTO_FONTS = ['Noto Sans Mono', 'Noto Sans SC', 'Noto Color Emoji'] as const
const BAD_FONT_NAME = /[{};<>"'\\,\p{Cc}]/u

export function validFontName(name: string): boolean {
  const value = name.trim()
  return value.length <= 100 && !BAD_FONT_NAME.test(value)
}

/** A CSS font-family list: each name quoted once, in order, ending with `monospace`. */
export function fontStack(...groups: readonly (readonly string[])[]): string {
  const seen = new Set<string>()
  const names: string[] = []
  for (const name of groups.flat()) {
    const value = name.trim()
    const key = value.toLowerCase()
    if (value === '' || seen.has(key) || !validFontName(value)) continue
    seen.add(key)
    names.push(`"${value}"`)
  }
  return [...names, 'monospace'].join(', ')
}
