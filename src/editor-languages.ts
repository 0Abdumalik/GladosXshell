import { StreamLanguage } from '@codemirror/language'
import { type Extension, Facet } from '@codemirror/state'
import { extension } from './format'

// Languages load on demand so the editor itself stays small.
type Loader = () => Promise<Extension>
const loaders = {
  shell: async () =>
    StreamLanguage.define((await import('@codemirror/legacy-modes/mode/shell')).shell),
  nginx: async () =>
    StreamLanguage.define((await import('@codemirror/legacy-modes/mode/nginx')).nginx),
  properties: async () =>
    StreamLanguage.define((await import('@codemirror/legacy-modes/mode/properties')).properties),
  toml: async () =>
    StreamLanguage.define((await import('@codemirror/legacy-modes/mode/toml')).toml),
  yaml: async () =>
    StreamLanguage.define((await import('@codemirror/legacy-modes/mode/yaml')).yaml),
  python: async () =>
    StreamLanguage.define((await import('@codemirror/legacy-modes/mode/python')).python),
  lua: async () => StreamLanguage.define((await import('@codemirror/legacy-modes/mode/lua')).lua),
  // Full parsers where one exists: their syntax trees also drive the error checks.
  javascript: async () => (await import('@codemirror/lang-javascript')).javascript({ jsx: true }),
  typescript: async () =>
    (await import('@codemirror/lang-javascript')).javascript({ typescript: true, jsx: true }),
  json: async () => (await import('@codemirror/lang-json')).json(),
  xml: async () => (await import('@codemirror/lang-xml')).xml(),
  html: async () => (await import('@codemirror/lang-html')).html(),
  css: async () => (await import('@codemirror/lang-css')).css(),
  scss: async () => StreamLanguage.define((await import('@codemirror/legacy-modes/mode/css')).sCSS),
  less: async () => StreamLanguage.define((await import('@codemirror/legacy-modes/mode/css')).less),
  sql: async () =>
    StreamLanguage.define((await import('@codemirror/legacy-modes/mode/sql')).standardSQL),
  diff: async () =>
    StreamLanguage.define((await import('@codemirror/legacy-modes/mode/diff')).diff),
  dockerfile: async () =>
    StreamLanguage.define((await import('@codemirror/legacy-modes/mode/dockerfile')).dockerFile),
  go: async () => StreamLanguage.define((await import('@codemirror/legacy-modes/mode/go')).go),
  rust: async () =>
    StreamLanguage.define((await import('@codemirror/legacy-modes/mode/rust')).rust),
  c: async () => StreamLanguage.define((await import('@codemirror/legacy-modes/mode/clike')).c),
  cpp: async () => StreamLanguage.define((await import('@codemirror/legacy-modes/mode/clike')).cpp),
  java: async () =>
    StreamLanguage.define((await import('@codemirror/legacy-modes/mode/clike')).java),
  perl: async () =>
    StreamLanguage.define((await import('@codemirror/legacy-modes/mode/perl')).perl),
} satisfies Record<string, Loader>

export type LanguageId = keyof typeof loaders

export const LANGUAGE_NAMES: Record<LanguageId, string> = {
  shell: 'Shell',
  nginx: 'Nginx',
  properties: 'INI / Properties',
  toml: 'TOML',
  yaml: 'YAML',
  python: 'Python',
  lua: 'Lua',
  javascript: 'JavaScript',
  typescript: 'TypeScript',
  json: 'JSON',
  xml: 'XML',
  html: 'HTML',
  css: 'CSS',
  scss: 'SCSS',
  less: 'Less',
  sql: 'SQL',
  diff: 'Diff',
  dockerfile: 'Dockerfile',
  go: 'Go',
  rust: 'Rust',
  c: 'C',
  cpp: 'C++',
  java: 'Java',
  perl: 'Perl',
}

/** The language the editor is set to; null for plain text. */
export const languageId = Facet.define<LanguageId | null, LanguageId | null>({
  combine: (values) => values[0] ?? null,
})

export async function loadLanguage(id: LanguageId): Promise<Extension> {
  return [await loaders[id](), languageId.of(id)]
}

const BY_EXTENSION: Record<string, LanguageId> = {
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
  ksh: 'shell',
  ash: 'shell',
  properties: 'properties',
  ini: 'properties',
  cfg: 'properties',
  conf: 'properties',
  env: 'properties',
  service: 'properties',
  toml: 'toml',
  yaml: 'yaml',
  yml: 'yaml',
  py: 'python',
  lua: 'lua',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'javascript',
  ts: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  tsx: 'typescript',
  jsonc: 'json',
  webmanifest: 'json',
  json: 'json',
  xml: 'xml',
  svg: 'xml',
  xsl: 'xml',
  xsd: 'xml',
  plist: 'xml',
  html: 'html',
  htm: 'html',
  css: 'css',
  scss: 'scss',
  less: 'less',
  sql: 'sql',
  diff: 'diff',
  patch: 'diff',
  go: 'go',
  rs: 'rust',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  cc: 'cpp',
  hpp: 'cpp',
  java: 'java',
  pl: 'perl',
  pm: 'perl',
}

const SHELL_FILES = new Set([
  '.bashrc',
  '.profile',
  '.bash_profile',
  '.bash_aliases',
  '.zshrc',
  '.ashrc',
])

const SHEBANGS: [RegExp, LanguageId][] = [
  [/\b(?:ba|z|k|da)?sh\b/, 'shell'],
  [/\bpython[0-9.]*\b/, 'python'],
  [/\bnode\b/, 'javascript'],
  [/\bperl\b/, 'perl'],
  [/\blua\b/, 'lua'],
]

/** Picks a language from the file name, its path, or a `#!` line; null for plain text. */
export function languageFor(name: string, path: string, text = ''): LanguageId | null {
  const lower = name.toLowerCase()
  if (lower === 'dockerfile' || lower.startsWith('dockerfile.')) return 'dockerfile'
  if (SHELL_FILES.has(lower)) return 'shell'
  const ext = extension(lower)
  if (ext === 'conf' && path.includes('/nginx/')) return 'nginx'
  if (Object.hasOwn(BY_EXTENSION, ext)) return BY_EXTENSION[ext]
  if (text.startsWith('#!')) {
    const end = text.indexOf('\n')
    const first = end < 0 ? text : text.slice(0, end)
    for (const [pattern, id] of SHEBANGS) if (pattern.test(first)) return id
  }
  return null
}
