import { invoke } from '@tauri-apps/api/core'
import { reportError } from '../../dom'
import { messages } from '../../i18n'

import type { BuiltinPlugin, HighlightRule } from '../api'
import { BUILTIN_VERSION } from './version'

const t = messages({
  name: { zh: '日志高亮', en: 'Log highlighting', ug: 'خاتىرە گەۋدىلەندۈرۈش' },
  description: {
    zh: '给终端输出里的 ERROR、WARN、INFO 和 IP 地址着色，网址可以 Ctrl+单击打开。',
    en: 'Colors ERROR, WARN, INFO and IP addresses in terminal output, and lets you open web addresses with Ctrl+click.',
    ug: 'تېرمىنال چىقىشىدىكى ERROR، WARN، INFO ۋە IP ئادرېسلارنى رەڭلەيدۇ، تور ئادرېسىنى Ctrl+چېكىش بىلەن ئاچقىلى بولىدۇ.',
  },
  openInBrowser: { zh: '在浏览器中打开', en: 'Open in browser', ug: 'توركۆرگۈچتە ئاچ' },
})

const OCTET = '(?:25[0-5]|2[0-4]\\d|1?\\d?\\d)'

// Mid-tone colours, readable on both the dark and the light terminal background.
export const LOG_RULES: HighlightRule[] = [
  { pattern: /\b(?:ERROR|FATAL|CRITICAL|FAILED|FAIL)\b/, foreground: '#d1495b' },
  { pattern: /\b(?:WARN|WARNING)\b/, foreground: '#c28a17' },
  { pattern: /\bINFO\b/, foreground: '#3d8fd1' },
  { pattern: new RegExp(`\\b${OCTET}(?:\\.${OCTET}){3}\\b`), foreground: '#2f9e8f' },
]

/** Trailing punctuation belongs to the sentence, not the link. */
export const URL_PATTERN = /https?:\/\/[^\s"'<>`]*[^\s"'<>`.,;:!?)\]}]/

export const logHighlightPlugin: BuiltinPlugin = {
  manifest: {
    id: 'gx.log-highlight',
    name: t('name'),
    version: BUILTIN_VERSION,
    description: t('description'),
    optIn: true,
  },
  activate(ctx) {
    ctx.terminal.highlight(LOG_RULES)
    ctx.terminal.links({
      pattern: URL_PATTERN,
      tooltip: t('openInBrowser'),
      open: (url) => {
        invoke('open_url', { url }).catch((error) => reportError(error))
      },
    })
  },
}
