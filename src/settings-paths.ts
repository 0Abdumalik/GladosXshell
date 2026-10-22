import { combobox } from './combobox'
import { messages } from './i18n'
import { rememberPath, type Settings } from './settings-model'
import { settings } from './settings-store'

const t = messages({
  recent: { zh: '最近使用', en: 'Recent', ug: 'يېقىندا ئىشلىتىلگەن' },
  empty: {
    zh: '还没有用过的路径，填写或浏览后会记在这里',
    en: 'No paths used yet. Paths you type or browse to are remembered here',
    ug: 'تېخى ئىشلىتىلگەن يول يوق، كىرگۈزگەن ياكى كۆزدىن كەچۈرۈپ تاللىغان يوللار بۇ يەردە خاتىرىلىنىدۇ',
  },
  toggle: { zh: '最近使用的路径', en: 'Recent paths', ug: 'يېقىندا ئىشلىتىلگەن يوللار' },
})

/** Paths used before in a field, newest first. */
export function recentPaths(key: string): string[] {
  return settings().recentPaths[key] ?? []
}

/** Puts `path` at the top of the field's history; call inside `updateSettings`. */
export function rememberRecent(d: Settings, key: string, path: string): void {
  if (path.trim() === '') return
  d.recentPaths[key] = rememberPath(d.recentPaths[key] ?? [], path)
}

/** Turns a path input into a combobox listing the field's history. */
export function recentPathsCombo(input: HTMLInputElement, key: string, pick: () => void): void {
  combobox(input, {
    options: () => recentPaths(key).map((value) => ({ value, group: t('recent') })),
    pick,
    empty: t('empty'),
    toggleLabel: t('toggle'),
  })
}
