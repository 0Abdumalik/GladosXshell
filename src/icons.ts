// Icons: Phosphor Icons (MIT, https://phosphoricons.com), regular weight.
import { h } from './dom'

export const ICON_NAMES = [
  'x',
  'plus',
  'minus',
  'check',
  'caret-up',
  'caret-down',
  'caret-left',
  'caret-right',
  'arrow-up',
  'arrow-down',
  'arrow-left',
  'arrow-right',
  'arrow-clockwise',
  'arrows-clockwise',
  'arrow-counter-clockwise',
  'arrow-square-out',
  'arrows-left-right',
  'arrows-down-up',
  'dots-three',
  'dots-three-vertical',
  'dots-six-vertical',
  'list',
  'list-bullets',
  'list-numbers',
  'list-checks',
  'magnifying-glass',
  'funnel',
  'sort-ascending',
  'sort-descending',
  'gear',
  'gear-six',
  'sliders-horizontal',
  'house',
  'corners-in',
  'corners-out',
  'columns',
  'rows',
  'sidebar',
  'sidebar-simple',
  'layout',
  'info',
  'warning',
  'warning-circle',
  'x-circle',
  'check-circle',
  'question',
  'bell',
  'star',
  'heart',
  'push-pin',
  'eye',
  'eye-slash',
  'lock',
  'lock-open',
  'key',
  'shield-check',
  'user',
  'users',
  'clock',
  'clock-counter-clockwise',
  'calendar',
  'timer',
  'hourglass',
  'lightning',
  'flag',
  'tag',
  'bookmark-simple',
  'link',
  'link-break',
  'globe',
  'cloud',
  'cloud-arrow-up',
  'cloud-arrow-down',
  'wifi-high',
  'copy',
  'clipboard-text',
  'scissors',
  'pencil-simple',
  'note-pencil',
  'trash',
  'floppy-disk',
  'download',
  'upload',
  'download-simple',
  'upload-simple',
  'export',
  'folder-simple',
  'folder-open',
  'folder-plus',
  'file',
  'file-plus',
  'file-text',
  'file-code',
  'terminal',
  'terminal-window',
  'code',
  'brackets-curly',
  'git-branch',
  'puzzle-piece',
  'paper-plane-right',
  'play',
  'pause',
  'stop',
  'record',
  'film-strip',
  'skull',
  'snowflake',
  'chart-line',
  'chart-bar',
  'chart-pie',
  'gauge',
  'cpu',
  'memory',
  'hard-drive',
  'hard-drives',
  'network',
  'plugs',
  'plugs-connected',
  'plug',
  'desktop',
  'monitor',
  'database',
  'tree-structure',
  'tree-view',
  'stack',
  'cube',
  'package',
  'wrench',
  'hammer',
  'bug',
  'robot',
  'command',
  'keyboard',
  'moon',
  'sun',
  'palette',
  'paint-brush',
  'text-aa',
  'magic-wand',
  'sparkle',
  'broom',
  'power',
  'sign-out',
  'sign-in',
  'rocket-launch',
  'pulse',
  'selection-all',
  'circle-notch',
  'spinner',
  'prohibit',
  'app-window',
  'squares-four',
  'article',
  'book-open',
  'note',
  'notepad',
  'chat-circle-text',
  'envelope-simple',
  'share-network',
  'swap',
  'repeat',
  'crosshair',
  'target',
  'map-pin',
  'compass',
  'thermometer',
  'lightbulb',
  'fire',
  'hand',
  'image',
  'image-broken',
] as const

export type IconName = (typeof ICON_NAMES)[number]

// Must list the same names as ICON_NAMES (glob patterns have to be literals); a test checks it.
const SOURCES = import.meta.glob<string>(
  '/node_modules/@phosphor-icons/core/assets/regular/{x,plus,minus,check,caret-up,caret-down,caret-left,caret-right,arrow-up,arrow-down,arrow-left,arrow-right,arrow-clockwise,arrows-clockwise,arrow-counter-clockwise,arrow-square-out,arrows-left-right,arrows-down-up,dots-three,dots-three-vertical,dots-six-vertical,list,list-bullets,list-numbers,list-checks,magnifying-glass,funnel,sort-ascending,sort-descending,gear,gear-six,sliders-horizontal,house,corners-in,corners-out,columns,rows,sidebar,sidebar-simple,layout,info,warning,warning-circle,x-circle,check-circle,question,bell,star,heart,push-pin,eye,eye-slash,lock,lock-open,key,shield-check,user,users,clock,clock-counter-clockwise,calendar,timer,hourglass,lightning,flag,tag,bookmark-simple,link,link-break,globe,cloud,cloud-arrow-up,cloud-arrow-down,wifi-high,copy,clipboard-text,scissors,pencil-simple,note-pencil,trash,floppy-disk,download,upload,download-simple,upload-simple,export,folder-simple,folder-open,folder-plus,file,file-plus,file-text,file-code,terminal,terminal-window,code,brackets-curly,git-branch,puzzle-piece,paper-plane-right,play,pause,stop,record,film-strip,skull,snowflake,chart-line,chart-bar,chart-pie,gauge,cpu,memory,hard-drive,hard-drives,network,plugs,plugs-connected,plug,desktop,monitor,database,tree-structure,tree-view,stack,cube,package,wrench,hammer,bug,robot,command,keyboard,moon,sun,palette,paint-brush,text-aa,magic-wand,sparkle,broom,power,sign-out,sign-in,rocket-launch,pulse,selection-all,circle-notch,spinner,prohibit,app-window,squares-four,article,book-open,note,notepad,chat-circle-text,envelope-simple,share-network,swap,repeat,crosshair,target,map-pin,compass,thermometer,lightbulb,fire,hand,image,image-broken}.svg',
  { query: '?raw', import: 'default', eager: true },
)

/** SVG text, bare path data, or `{ path, viewBox?, stroke? }`. */
export type IconInput = string | { path: string | string[]; viewBox?: string; stroke?: boolean }

/** Only path data survives, so an icon can never carry script, links or styles. */
export interface IconData {
  paths: string[]
  viewBox: string
  stroke: boolean
}

const PATH = /^[MmLlHhVvCcSsQqTtAaZz0-9eE.,+\-\s]+$/
const VIEW_BOX = /^-?\d+(\.\d+)?( -?\d+(\.\d+)?){3}$/
const MAX_PATH = 16 * 1024
const MAX_PATHS = 32
export const ICON_NAME = /^[a-z0-9][a-z0-9-]{0,47}$/
const DEFAULT_VIEW_BOX = '0 0 256 256'

const viewBoxOf = (value: string) => value.trim().replace(/[\s,]+/g, ' ')
const attr = (tag: string, name: string) => new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1]

/**
 * Validates icon data from a plugin: SVG text, bare path data, or
 * `{ path, viewBox?, stroke? }`. Null when anything is off.
 */
export function parseIcon(input: unknown): IconData | null {
  let paths: string[]
  let viewBox = DEFAULT_VIEW_BOX
  let stroke = false
  if (typeof input === 'string') {
    const text = input.trim()
    if (text.startsWith('<')) {
      const root = /<svg\b[^>]*>/i.exec(text)?.[0]
      if (!root) return null
      viewBox = viewBoxOf(attr(root, 'viewBox') ?? DEFAULT_VIEW_BOX)
      stroke = attr(root, 'fill') === 'none' && attr(root, 'stroke') !== undefined
      paths = [...text.matchAll(/<path\b[^>]*\sd="([^"]+)"/gi)].map((m) => m[1])
    } else {
      paths = [text]
    }
  } else if (typeof input === 'object' && input !== null && 'path' in input) {
    const value = input as { path: unknown; viewBox?: unknown; stroke?: unknown }
    const list: unknown[] = Array.isArray(value.path) ? value.path : [value.path]
    if (!list.every((p): p is string => typeof p === 'string')) return null
    paths = list
    if (value.viewBox !== undefined) {
      if (typeof value.viewBox !== 'string') return null
      viewBox = viewBoxOf(value.viewBox)
    }
    stroke = value.stroke === true
  } else {
    return null
  }
  paths = paths.map((p) => p.trim()).filter((p) => p !== '')
  const size = paths.reduce((n, p) => n + p.length, 0)
  if (paths.length === 0 || paths.length > MAX_PATHS || size > MAX_PATH) return null
  if (!paths.every((p) => PATH.test(p)) || !VIEW_BOX.test(viewBox)) return null
  return { paths, viewBox, stroke }
}

const registry = new Map<string, IconData>()
for (const [path, svg] of Object.entries(SOURCES)) {
  const data = parseIcon(svg)
  if (data) registry.set(path.slice(path.lastIndexOf('/') + 1, -'.svg'.length), data)
}

/** Plugin icons live under `<scope>/<name>` so they cannot shadow built-ins or each other. */
export function registerIcon(scope: string, name: string, input: unknown): () => void {
  const data = parseIcon(input)
  if (!data) throw new Error(`invalid icon: ${name}`)
  return addIcon(scope, name, data)
}

/** Like registerIcon, for data parseIcon already produced. */
export function addIcon(scope: string, name: string, data: IconData): () => void {
  if (!ICON_NAME.test(name)) throw new Error(`invalid icon name: ${name}`)
  const key = scopedIcon(scope, name)
  registry.set(key, data)
  return () => {
    if (registry.get(key) === data) registry.delete(key)
  }
}

/** The key a plugin's icon name resolves under; see resolveIcon. */
export const scopedIcon = (scope: string, name: string) => `${scope}/${name}`

/** `<scope>/<name>` falls back to the built-in `<name>` when the plugin has none of its own. */
export function resolveIcon(name: string): IconData | undefined {
  const exact = registry.get(name)
  if (exact) return exact
  const slash = name.lastIndexOf('/')
  return slash < 0 ? undefined : registry.get(name.slice(slash + 1))
}

export const hasIcon = (name: string) => resolveIcon(name) !== undefined

/** Built-in names plus the given scope's own. */
export function iconNames(scope?: string): string[] {
  const prefix = scope ? `${scope}/` : null
  const names: string[] = []
  for (const key of registry.keys()) {
    if (!key.includes('/')) names.push(key)
    else if (prefix && key.startsWith(prefix)) names.push(key.slice(prefix.length))
  }
  return names.sort()
}

const PAINT_FILL = 'fill="currentColor"'
const PAINT_STROKE =
  'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"'

/** Standalone SVG markup; safe because parseIcon validated every value that goes in. */
export function iconMarkup(data: IconData): string {
  const paths = data.paths.map((d) => `<path d="${d}"/>`).join('')
  const paint = data.stroke ? PAINT_STROKE : PAINT_FILL
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${data.viewBox}" ${paint}>${paths}</svg>`
}

const NS = 'http://www.w3.org/2000/svg'
const prototypes = new WeakMap<IconData, SVGSVGElement>()

function svgFor(data: IconData): SVGSVGElement {
  let proto = prototypes.get(data)
  if (!proto) {
    proto = document.createElementNS(NS, 'svg')
    proto.setAttribute('viewBox', data.viewBox)
    proto.setAttribute('aria-hidden', 'true')
    proto.setAttribute('focusable', 'false')
    for (const [, key, value] of (data.stroke ? PAINT_STROKE : PAINT_FILL).matchAll(
      /([a-z-]+)="([^"]+)"/g,
    )) {
      proto.setAttribute(key, value)
    }
    for (const d of data.paths) {
      const path = document.createElementNS(NS, 'path')
      path.setAttribute('d', d)
      proto.append(path)
    }
    prototypes.set(data, proto)
  }
  return proto.cloneNode(true) as SVGSVGElement
}

function iconElement(data: IconData | undefined, name: string, label?: string): HTMLElement {
  const span = h('span', {
    class: 'gx-icon',
    'data-icon': name,
    'aria-hidden': label ? undefined : 'true',
    'aria-label': label,
    role: label ? 'img' : undefined,
  })
  if (data) span.append(svgFor(data))
  return span
}

/** A built-in icon as `span.gx-icon`, sized by font-size and coloured by `color`. */
export function icon(name: IconName, options?: { label?: string }): HTMLElement {
  return iconElement(registry.get(name), name, options?.label)
}

/** An icon named at runtime; an unknown name leaves an empty (hidden) slot instead of failing. */
export function namedIcon(name: string, label?: string): HTMLElement {
  return iconElement(resolveIcon(name), name, label)
}

/** Icon with text label for buttons. */
export function iconButton(iconName: IconName, text: string): [HTMLElement, string] {
  return [icon(iconName), ` ${text}`]
}
