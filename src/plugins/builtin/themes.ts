import type { ITheme } from '@xterm/xterm'
import { messages } from '../../i18n'
import type { BuiltinPlugin } from '../api'
import { BUILTIN_VERSION } from './version'

const t = messages({
  name: { zh: '终端配色', en: 'Terminal colors', ug: 'تېرمىنال رەڭ لايىھەسى' },
  description: {
    zh: '深色和浅色主题下终端使用的 16 色调色板。停用后终端使用 xterm 的默认配色。',
    en: 'The 16-color palettes the terminal uses in the dark and light themes. When turned off, the terminal uses the xterm default colors.',
    ug: 'قېنىق ۋە سۇس ئۆرنەكتە تېرمىنال ئىشلىتىدىغان 16 رەڭلىك رەڭ تاختىسى. چەكلەنسە تېرمىنال xterm نىڭ كۆڭۈلدىكى رەڭلىرىنى ئىشلىتىدۇ.',
  },
  dark: { zh: '深色', en: 'Dark', ug: 'قېنىق' },
  light: { zh: '浅色', en: 'Light', ug: 'سۇس' },
})

// The UI tokens of both themes live in styles.css; these are the terminal's ANSI colors.
const DARK: ITheme = {
  background: '#15181d',
  foreground: '#d9dee6',
  cursor: '#8fd6a4',
  selectionBackground: '#34404f',
  black: '#1d2128',
  red: '#e06c75',
  green: '#98c379',
  yellow: '#e5c07b',
  blue: '#61afef',
  magenta: '#c678dd',
  cyan: '#56b6c2',
  white: '#d9dee6',
  brightBlack: '#5c6370',
  brightRed: '#ef8a92',
  brightGreen: '#b5d99c',
  brightYellow: '#f0d197',
  brightBlue: '#8cc6f5',
  brightMagenta: '#d79ee8',
  brightCyan: '#80cdd6',
  brightWhite: '#f2f4f7',
}

const LIGHT: ITheme = {
  background: '#ffffff',
  foreground: '#24292f',
  cursor: '#0969da',
  selectionBackground: '#c8dcf5',
  black: '#24292f',
  red: '#cf222e',
  green: '#116329',
  yellow: '#7d4e00',
  blue: '#0969da',
  magenta: '#8250df',
  cyan: '#1b7c83',
  white: '#6e7781',
  brightBlack: '#57606a',
  brightRed: '#a40e26',
  brightGreen: '#1a7f37',
  brightYellow: '#633c01',
  brightBlue: '#218bff',
  brightMagenta: '#a475f9',
  brightCyan: '#3192aa',
  brightWhite: '#8c959f',
}

export const themesPlugin: BuiltinPlugin = {
  manifest: {
    id: 'gx.themes',
    name: t('name'),
    version: BUILTIN_VERSION,
    description: t('description'),
  },
  activate(ctx) {
    ctx.themes.register({ id: 'dark', name: t('dark'), terminal: DARK })
    ctx.themes.register({ id: 'light', name: t('light'), terminal: LIGHT })
  },
}
