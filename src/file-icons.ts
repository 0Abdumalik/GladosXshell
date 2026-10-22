// Icons: Phosphor Icons (MIT, https://phosphoricons.com), regular weight; light is too thin at 16px.
import caretDown from '@phosphor-icons/core/regular/caret-down.svg?raw'
import caretRight from '@phosphor-icons/core/regular/caret-right.svg?raw'
import database from '@phosphor-icons/core/regular/database.svg?raw'
import file from '@phosphor-icons/core/regular/file.svg?raw'
import fileArchive from '@phosphor-icons/core/regular/file-archive.svg?raw'
import fileAudio from '@phosphor-icons/core/regular/file-audio.svg?raw'
import fileC from '@phosphor-icons/core/regular/file-c.svg?raw'
import fileCSharp from '@phosphor-icons/core/regular/file-c-sharp.svg?raw'
import fileCode from '@phosphor-icons/core/regular/file-code.svg?raw'
import fileCpp from '@phosphor-icons/core/regular/file-cpp.svg?raw'
import fileCss from '@phosphor-icons/core/regular/file-css.svg?raw'
import fileCsv from '@phosphor-icons/core/regular/file-csv.svg?raw'
import fileDashed from '@phosphor-icons/core/regular/file-dashed.svg?raw'
import fileDoc from '@phosphor-icons/core/regular/file-doc.svg?raw'
import fileHtml from '@phosphor-icons/core/regular/file-html.svg?raw'
import fileImage from '@phosphor-icons/core/regular/file-image.svg?raw'
import fileIni from '@phosphor-icons/core/regular/file-ini.svg?raw'
import fileJs from '@phosphor-icons/core/regular/file-js.svg?raw'
import fileJsx from '@phosphor-icons/core/regular/file-jsx.svg?raw'
import fileLock from '@phosphor-icons/core/regular/file-lock.svg?raw'
import fileMd from '@phosphor-icons/core/regular/file-md.svg?raw'
import filePdf from '@phosphor-icons/core/regular/file-pdf.svg?raw'
import filePpt from '@phosphor-icons/core/regular/file-ppt.svg?raw'
import filePy from '@phosphor-icons/core/regular/file-py.svg?raw'
import fileRs from '@phosphor-icons/core/regular/file-rs.svg?raw'
import fileSql from '@phosphor-icons/core/regular/file-sql.svg?raw'
import fileSvg from '@phosphor-icons/core/regular/file-svg.svg?raw'
import fileText from '@phosphor-icons/core/regular/file-text.svg?raw'
import fileTs from '@phosphor-icons/core/regular/file-ts.svg?raw'
import fileTsx from '@phosphor-icons/core/regular/file-tsx.svg?raw'
import fileTxt from '@phosphor-icons/core/regular/file-txt.svg?raw'
import fileVideo from '@phosphor-icons/core/regular/file-video.svg?raw'
import fileVue from '@phosphor-icons/core/regular/file-vue.svg?raw'
import fileXls from '@phosphor-icons/core/regular/file-xls.svg?raw'
import fileZip from '@phosphor-icons/core/regular/file-zip.svg?raw'
import folderOpen from '@phosphor-icons/core/regular/folder-open.svg?raw'
import folderSimple from '@phosphor-icons/core/regular/folder-simple.svg?raw'
import folderDashed from '@phosphor-icons/core/regular/folder-simple-dashed.svg?raw'
import question from '@phosphor-icons/core/regular/question.svg?raw'
import terminal from '@phosphor-icons/core/regular/terminal-window.svg?raw'
import { isDir } from './file-list'
import { extension } from './format'
import type { Entry } from './protocol'

/** Colour group; styled through `.files-icon[data-icon]`. */
export type IconGroup =
  | 'folder'
  | 'link'
  | 'code'
  | 'script'
  | 'config'
  | 'text'
  | 'doc'
  | 'image'
  | 'audio'
  | 'video'
  | 'archive'
  | 'data'
  | 'key'
  | 'other'
  | 'file'

export interface FileIcon {
  group: IconGroup
  svg: string
}

const groups: [IconGroup, string, string[]][] = [
  ['code', fileJs, ['js', 'mjs', 'cjs']],
  ['code', fileJsx, ['jsx']],
  ['code', fileTs, ['ts', 'mts', 'cts']],
  ['code', fileTsx, ['tsx']],
  ['code', filePy, ['py', 'pyw', 'pyi']],
  ['code', fileRs, ['rs']],
  ['code', fileC, ['c', 'h']],
  ['code', fileCpp, ['cpp', 'cc', 'cxx', 'hpp', 'hh', 'hxx']],
  ['code', fileCSharp, ['cs']],
  ['code', fileCss, ['css', 'scss', 'sass', 'less']],
  ['code', fileHtml, ['html', 'htm', 'xhtml']],
  ['code', fileVue, ['vue']],
  [
    'code',
    fileCode,
    [
      'go',
      'java',
      'kt',
      'kts',
      'swift',
      'rb',
      'php',
      'lua',
      'pl',
      'pm',
      'r',
      'scala',
      'dart',
      'zig',
      'nim',
      'ex',
      'exs',
      'erl',
      'hs',
      'clj',
      'svelte',
      'groovy',
      'gradle',
      'cmake',
      'mk',
      'awk',
      'sed',
      'vim',
      'xml',
      'xsl',
      'json',
      'jsonc',
      'json5',
    ],
  ],
  [
    'script',
    terminal,
    [
      'sh',
      'bash',
      'zsh',
      'fish',
      'ksh',
      'ps1',
      'psm1',
      'bat',
      'cmd',
      'exe',
      'run',
      'bin',
      'appimage',
      'command',
    ],
  ],
  [
    'config',
    fileIni,
    [
      'ini',
      'conf',
      'cfg',
      'cnf',
      'toml',
      'yaml',
      'yml',
      'env',
      'properties',
      'service',
      'socket',
      'timer',
      'rules',
      'lock',
      'plist',
      'desktop',
      'rc',
    ],
  ],
  ['text', fileMd, ['md', 'markdown', 'mdx']],
  ['text', fileTxt, ['txt']],
  ['text', fileCsv, ['csv', 'tsv']],
  ['text', fileText, ['log', 'rst', 'adoc', 'nfo', 'out', 'err', 'diff', 'patch']],
  ['doc', filePdf, ['pdf']],
  ['doc', fileDoc, ['doc', 'docx', 'odt', 'rtf', 'epub']],
  ['doc', fileXls, ['xls', 'xlsx', 'ods']],
  ['doc', filePpt, ['ppt', 'pptx', 'odp']],
  ['image', fileSvg, ['svg']],
  [
    'image',
    fileImage,
    ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'avif', 'tif', 'tiff', 'heic', 'psd'],
  ],
  ['audio', fileAudio, ['mp3', 'wav', 'flac', 'ogg', 'oga', 'm4a', 'aac', 'opus', 'wma', 'mid']],
  ['video', fileVideo, ['mp4', 'mkv', 'avi', 'mov', 'webm', 'flv', 'wmv', 'm4v', 'mpg', 'mpeg']],
  ['archive', fileZip, ['zip', '7z', 'rar', 'jar', 'war', 'whl']],
  [
    'archive',
    fileArchive,
    [
      'tar',
      'gz',
      'tgz',
      'bz2',
      'tbz2',
      'xz',
      'txz',
      'zst',
      'lz4',
      'lzma',
      'z',
      'deb',
      'rpm',
      'apk',
      'ipk',
      'iso',
      'img',
      'dmg',
    ],
  ],
  ['data', fileSql, ['sql']],
  ['data', database, ['db', 'sqlite', 'sqlite3', 'mdb', 'rdb', 'dump']],
  [
    'key',
    fileLock,
    ['pem', 'key', 'crt', 'cer', 'csr', 'pub', 'p12', 'pfx', 'gpg', 'asc', 'der', 'jks'],
  ],
]

const BY_EXTENSION = new Map<string, FileIcon>()
for (const [group, svg, extensions] of groups) {
  for (const ext of extensions) BY_EXTENSION.set(ext, { group, svg })
}

const SPECIAL: Record<string, FileIcon> = {
  dockerfile: { group: 'code', svg: fileCode },
  makefile: { group: 'code', svg: fileCode },
  cmakelists: { group: 'code', svg: fileCode },
  readme: { group: 'text', svg: fileText },
  license: { group: 'text', svg: fileText },
  changelog: { group: 'text', svg: fileText },
  authorized_keys: { group: 'key', svg: fileLock },
  known_hosts: { group: 'key', svg: fileLock },
  id_rsa: { group: 'key', svg: fileLock },
  id_ecdsa: { group: 'key', svg: fileLock },
  id_ed25519: { group: 'key', svg: fileLock },
  crontab: { group: 'config', svg: fileIni },
  fstab: { group: 'config', svg: fileIni },
  hosts: { group: 'config', svg: fileIni },
  passwd: { group: 'config', svg: fileIni },
  shadow: { group: 'key', svg: fileLock },
}

/** Dotfiles such as `.bashrc` or `.gitignore` are configuration. */
const DOT_CONFIG = /^\.[\w.-]+(rc|ignore|config|profile|attributes|editorconfig|env)$/i

/** Picks an icon from the entry type, then well-known names, then the extension. */
export function iconFor(entry: Entry): FileIcon {
  if (entry.kind === 'symlink') {
    return entry.targetIsDir
      ? { group: 'link', svg: folderDashed }
      : { group: 'link', svg: fileDashed }
  }
  if (isDir(entry)) return { group: 'folder', svg: folderSimple }
  if (entry.kind === 'other') return { group: 'other', svg: question }
  const lower = entry.name.toLowerCase()
  const stem = lower.replace(/\.(md|txt)$/, '')
  const special = SPECIAL[lower] ?? SPECIAL[stem]
  if (special) return special
  const known = BY_EXTENSION.get(extension(entry.name))
  if (known) return known
  if (DOT_CONFIG.test(entry.name) || lower === '.profile') return { group: 'config', svg: fileIni }
  if (entry.mode & 0o111) return { group: 'script', svg: terminal }
  return { group: 'file', svg: file }
}

const PATH_DATA = /\sd="([^"]+)"/g
const NS = 'http://www.w3.org/2000/svg'
const prototypes = new Map<string, SVGSVGElement>()

/** Builds the icon from the path data only, so the SVG text never goes through innerHTML. */
export function svgIcon(svg: string): SVGSVGElement {
  let proto = prototypes.get(svg)
  if (!proto) {
    proto = document.createElementNS(NS, 'svg')
    proto.setAttribute('viewBox', '0 0 256 256')
    proto.setAttribute('fill', 'currentColor')
    proto.setAttribute('aria-hidden', 'true')
    proto.setAttribute('focusable', 'false')
    for (const match of svg.matchAll(PATH_DATA)) {
      const path = document.createElementNS(NS, 'path')
      path.setAttribute('d', match[1])
      proto.append(path)
    }
    prototypes.set(svg, proto)
  }
  return proto.cloneNode(true) as SVGSVGElement
}

/** The `.files-icon` element for an entry. */
export function entryIcon(entry: Entry): HTMLSpanElement {
  const { group, svg } = iconFor(entry)
  const span = document.createElement('span')
  span.className = 'files-icon'
  span.dataset.icon = group
  span.append(svgIcon(svg))
  return span
}

export const treeIcons = {
  open: () => svgIcon(folderOpen),
  closed: () => svgIcon(folderSimple),
  expanded: () => svgIcon(caretDown),
  collapsed: () => svgIcon(caretRight),
}
