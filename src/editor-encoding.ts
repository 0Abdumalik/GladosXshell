import { messages } from './i18n'

const t = messages({
  utf8: {
    zh: 'Unicode，Linux 上的默认编码',
    en: 'Unicode, the default on Linux',
    ug: 'Unicode، Linux دىكى سۈكۈتتىكى كودلاش',
  },
  gbk: {
    zh: '简体中文，中文 Windows 的默认编码',
    en: 'Simplified Chinese, the default on Chinese Windows',
    ug: 'ئاددىي خەنزۇچە، خەنزۇچە Windows دىكى سۈكۈتتىكى كودلاش',
  },
  gb18030: {
    zh: '简体中文，GBK 的超集',
    en: 'Simplified Chinese, a superset of GBK',
    ug: 'ئاددىي خەنزۇچە، GBK نى ئۆز ئىچىگە ئالىدۇ',
  },
  big5: { zh: '繁体中文', en: 'Traditional Chinese', ug: 'مۇرەككەپ خەنزۇچە' },
  utf16le: {
    zh: 'Unicode，Windows 记事本的“Unicode”',
    en: 'Unicode, what Windows Notepad calls “Unicode”',
    ug: 'Unicode، Windows خاتىرە دەپتىرىدىكى «Unicode»',
  },
  utf16be: { zh: 'Unicode，大端', en: 'Unicode, big-endian', ug: 'Unicode، چوڭ ئۇچلۇق' },
  japanese: { zh: '日文', en: 'Japanese', ug: 'ياپونچە' },
  korean: { zh: '韩文', en: 'Korean', ug: 'كورېيەچە' },
  westernEuropean: {
    zh: '西欧语言（Latin-1）',
    en: 'Western European (Latin-1)',
    ug: 'غەربىي ياۋروپا تىللىرى (Latin-1)',
  },
  cyrillic: { zh: '西里尔文', en: 'Cyrillic', ug: 'كىرىل يېزىقى' },
  russian: { zh: '俄文', en: 'Russian', ug: 'رۇسچە' },
})

/** A file as the backend decoded it. */
export interface Decoded {
  text: string
  /** Lower-case WHATWG name: `utf-8`, `gbk`, `utf-16le`, … */
  encoding: string
  bom: boolean
  /** Some bytes did not decode and show as U+FFFD. */
  lossy: boolean
}

export const ENCODINGS: { id: string; name: string; detail: string }[] = [
  { id: 'utf-8', name: 'UTF-8', detail: t('utf8') },
  { id: 'gbk', name: 'GBK', detail: t('gbk') },
  { id: 'gb18030', name: 'GB18030', detail: t('gb18030') },
  { id: 'big5', name: 'Big5', detail: t('big5') },
  { id: 'utf-16le', name: 'UTF-16 LE', detail: t('utf16le') },
  { id: 'utf-16be', name: 'UTF-16 BE', detail: t('utf16be') },
  { id: 'shift_jis', name: 'Shift JIS', detail: t('japanese') },
  { id: 'euc-jp', name: 'EUC-JP', detail: t('japanese') },
  { id: 'euc-kr', name: 'EUC-KR', detail: t('korean') },
  { id: 'windows-1252', name: 'Windows 1252', detail: t('westernEuropean') },
  { id: 'windows-1251', name: 'Windows 1251', detail: t('cyrillic') },
  { id: 'koi8-r', name: 'KOI8-R', detail: t('russian') },
]

export function encodingLabel(file: Pick<Decoded, 'encoding' | 'bom'>): string {
  const name = ENCODINGS.find((e) => e.id === file.encoding)?.name ?? file.encoding.toUpperCase()
  return file.bom && file.encoding === 'utf-8' ? `${name} BOM` : name
}

/** The line ending most lines use; CodeMirror itself only keeps `\n`. */
export function detectEol(text: string): '\n' | '\r\n' {
  let crlf = 0
  let lf = 0
  for (let i = text.indexOf('\n'); i >= 0; i = text.indexOf('\n', i + 1)) {
    if (text[i - 1] === '\r') crlf++
    else lf++
  }
  return crlf > lf ? '\r\n' : '\n'
}
