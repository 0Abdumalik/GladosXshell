import { afterEach, describe, expect, it } from 'vitest'
import {
  inLang,
  isRtl,
  joinList,
  lang,
  locale,
  ltr,
  messages,
  numericDate,
  pl,
  setLang,
} from './i18n'

const LRI = String.fromCodePoint(0x2066)
const PDI = String.fromCodePoint(0x2069)

const t = messages({
  hello: { zh: '你好，{name}', en: 'Hello {name}', ug: 'ياخشىمۇسىز، {name}' },
  files: { zh: '{n} 个文件', en: pl('file'), ug: '{n} ھۆججەت' },
  hint: { zh: '现在运行 {cmd}', en: 'Run {cmd} now', ug: '{cmd} نى ھازىر ئىجرا قىلىڭ' },
})

afterEach(() => setLang('zh'))

describe('i18n', () => {
  it('starts in Chinese outside the app', () => {
    expect(lang()).toBe('zh')
    expect(locale()).toBe('zh-cn')
    expect(isRtl()).toBe(false)
  })

  it('fills placeholders in the current language and keeps unknown ones', () => {
    expect(t('hello', { name: 'malik' })).toBe('你好，malik')
    setLang('en')
    expect(t('hello', { name: 'malik' })).toBe('Hello malik')
    expect(t('hello')).toBe('Hello {name}')
    setLang('ug')
    expect(isRtl()).toBe(true)
    expect(t('hello', { name: 'malik' })).toBe('ياخشىمۇسىز، malik')
  })

  it('counts plurals in English only', () => {
    expect(t('files', { n: 3 })).toBe('3 个文件')
    setLang('en')
    expect(t('files', { n: 1 })).toBe('1 file')
    expect(t('files', { n: 1200 })).toBe('1,200 files')
    setLang('ug')
    expect(t('files', { n: 3 })).toBe('3 ھۆججەت')
  })

  it('splices parts where each language puts them', () => {
    expect(t.parts('hint', { cmd: 'ls' })).toEqual(['现在运行 ', 'ls'])
    setLang('en')
    expect(t.parts('hint', { cmd: 'ls' })).toEqual(['Run ', 'ls', ' now'])
    setLang('ug')
    expect(t.parts('hint', { cmd: 'ls' })).toEqual(['ls', ' نى ھازىر ئىجرا قىلىڭ'])
  })

  it('isolates left-to-right runs only in Uyghur', () => {
    expect(ltr('/var/log')).toBe('/var/log')
    setLang('ug')
    expect(ltr('/var/log')).toBe(`${LRI}/var/log${PDI}`)
    expect(ltr('')).toBe('')
  })

  it('resolves inline texts in the current language', () => {
    const text = { zh: '帮助', en: 'Help', ug: 'ياردەم' }
    expect(inLang(text)).toBe('帮助')
    setLang('ug')
    expect(inLang(text)).toBe('ياردەم')
  })

  it('joins lists with the separator of each language', () => {
    expect(joinList(['a', 'b'])).toBe('a、b')
    setLang('en')
    expect(joinList(['a', 'b'])).toBe('a, b')
    setLang('ug')
    expect(joinList(['a', 'b'])).toBe('a، b')
  })

  it('writes numeric dates month before day in Uyghur', () => {
    const date = new Date(2026, 9, 3)
    expect(date.toLocaleDateString(locale(), numericDate())).toBe('2026/10/3')
    setLang('ug')
    expect(date.toLocaleDateString(locale(), numericDate())).toBe('2026-10-03')
  })
})
