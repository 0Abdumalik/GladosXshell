import { writeText } from '@tauri-apps/plugin-clipboard-manager'
import { h, setStatus } from './dom'
import { ltr, messages, pl } from './i18n'
import { namedIcon } from './icons'
import {
  groupLabel,
  groupOrder,
  matchesFilter,
  SELECTOR_HOOKS,
  type SelectorHook,
  type TokenGroup,
  tokenGroupId,
  variantSelector,
} from './settings-hooks-model'

const t = messages({
  copied: { zh: '已复制：{text}', en: 'Copied: {text}', ug: 'كۆچۈرۈلدى: {text}' },
  searchPlaceholder: {
    zh: '搜索选择器、变量名、说明或取值',
    en: 'Search selectors, variables, descriptions or values',
    ug: 'تاللىغۇچ، ئۆزگەرگۈچى مىقدار، چۈشەندۈرۈش ياكى قىممەت ئىزدە',
  },
  searchLabel: { zh: '搜索样式钩子', en: 'Search style hooks', ug: 'ئۇسلۇب ئىلمەكلىرىنى ئىزدە' },
  selectors: { zh: '选择器', en: 'Selectors', ug: 'تاللىغۇچلار' },
  insertRuleFor: {
    zh: '插入 {selector} 规则',
    en: 'Insert a {selector} rule',
    ug: '{selector} قائىدىسىنى قىستۇر',
  },
  matchCountTitle: {
    zh: '当前页面里匹配的元素数',
    en: 'Matching elements on the current page',
    ug: 'نۆۋەتتىكى بەتتە ماس كەلگەن ئېلېمېنت سانى',
  },
  matchCount: { zh: '{n} 个', en: '{n}', ug: '{n} دانە' },
  copySelector: { zh: '复制选择器', en: 'Copy selector', ug: 'تاللىغۇچنى كۆچۈر' },
  insertRule: {
    zh: '插入规则到样式表',
    en: 'Insert a rule into the stylesheet',
    ug: 'ئۇسلۇب جەدۋىلىگە قائىدە قىستۇر',
  },
  unset: { zh: '（未设置）', en: '(not set)', ug: '(تەڭشەلمىگەن)' },
  copyVar: { zh: '复制 var() 引用', en: 'Copy var() reference', ug: 'var() نەقىلىنى كۆچۈر' },
  overrideToken: {
    zh: '以当前值加入 :root 覆盖',
    en: 'Override in :root with the current value',
    ug: 'نۆۋەتتىكى قىممەت بىلەن :root قا قاپلاش قوش',
  },
  variables: {
    zh: '变量 · {group}',
    en: 'Variables · {group}',
    ug: 'ئۆزگەرگۈچى مىقدار · {group}',
  },
  empty: {
    zh: '没有匹配的钩子，换个关键词试试。',
    en: 'No matching hooks. Try other keywords.',
    ug: 'ماس ئىلمەك يوق، باشقا ئاچقۇچلۇق سۆز بىلەن سىناپ بېقىڭ.',
  },
  summarySearch: {
    zh: '匹配 {selectors} 个选择器、{tokens} 个变量',
    en: (p) =>
      `Matching: ${pl('selector')({ n: p.selectors })}, ${pl('variable')({ n: p.tokens })}`,
    ug: 'ماس كەلگىنى: {selectors} تاللىغۇچ، {tokens} ئۆزگەرگۈچى مىقدار',
  },
  summary: {
    zh: '{selectors} 个选择器、{tokens} 个变量。数量和取值是当前界面的实时结果。',
    en: (p) =>
      `${pl('selector')({ n: p.selectors })}, ${pl('variable')({ n: p.tokens })}. Counts and values are live from the current interface.`,
    ug: '{selectors} تاللىغۇچ، {tokens} ئۆزگەرگۈچى مىقدار. سان ۋە قىممەتلەر نۆۋەتتىكى كۆرۈنمە يۈزنىڭ ھازىرقى ئەھۋالى.',
  },
  recount: { zh: '重新统计', en: 'Recount', ug: 'قايتا سانا' },
})

const MAX_VARIANTS = 24

export interface HookTarget {
  /** Inserts an empty rule for the selector at the cursor. */
  rule(selector: string): void
  /** Adds the declaration to the `:root` block. */
  token(name: string, value: string): void
}

function count(selector: string): number {
  try {
    return document.querySelectorAll(selector).length
  } catch {
    return 0
  }
}

/** Every `--gx-*` property declared by a loaded stylesheet. */
function tokenNames(): string[] {
  const names = new Set<string>()
  const walk = (rules: CSSRuleList) => {
    for (const rule of rules) {
      if (rule instanceof CSSStyleRule) {
        for (let i = 0; i < rule.style.length; i++) {
          const name = rule.style[i]
          if (name.startsWith('--gx-')) names.add(name)
        }
      }
      if ('cssRules' in rule) walk((rule as CSSGroupingRule).cssRules)
    }
  }
  for (const sheet of document.styleSheets) {
    try {
      walk(sheet.cssRules)
    } catch {
      // Sheets from another origin can't be read.
    }
  }
  return [...names].sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
}

function variants(hook: SelectorHook): string[] {
  if (!hook.attr) return []
  const seen = new Set(hook.values ?? [])
  for (const el of document.querySelectorAll(`${hook.base}[${hook.attr}]`)) {
    const value = el.getAttribute(hook.attr)
    if (value) seen.add(value)
  }
  return [...seen].slice(0, MAX_VARIANTS)
}

function iconButton(label: string, iconName: string, run: () => void) {
  return h(
    'button',
    { type: 'button', class: 'icon-button', title: label, 'aria-label': label, onclick: run },
    namedIcon(iconName),
  )
}

function copy(text: string): void {
  writeText(text)
    .then(() => setStatus(t('copied', { text: ltr(text) })))
    .catch((error: unknown) => setStatus(String(error), 'error'))
}

/** Searchable list of stable selectors and `--gx-*` tokens with live counts and values. */
export function hooksBrowser(target: HookTarget) {
  const search = h('input', {
    type: 'search',
    class: 'hook-search',
    placeholder: t('searchPlaceholder'),
    'aria-label': t('searchLabel'),
    spellcheck: 'false',
  })
  const summary = h('p', { class: 'hook-summary', 'aria-live': 'polite' })
  const body = h('div', { class: 'hook-groups' })
  /** Groups the user has open: `selectors` or a token group id. */
  const open = new Set<string>(['selectors'])

  const group = (
    id: string,
    label: string,
    size: number,
    rows: HTMLElement[],
    searching: boolean,
  ) => {
    const details = h(
      'details',
      { class: 'hook-group', open: searching || open.has(id) },
      h(
        'summary',
        {},
        h('span', { text: label }),
        h('span', { class: 'hook-group-count num', text: String(size) }),
      ),
      h('ul', { class: 'hook-rows' }, rows),
    )
    details.addEventListener('toggle', () => {
      if (searching) return
      if (details.open) open.add(id)
      else open.delete(id)
    })
    return details
  }

  const selectorRow = (hook: SelectorHook) => {
    const total = count(hook.base)
    const chips = variants(hook).map((value) => {
      const selector = variantSelector(hook, value)
      const n = count(selector)
      return h(
        'button',
        {
          type: 'button',
          class: 'hook-chip',
          'data-empty': n === 0,
          title: t('insertRuleFor', { selector: ltr(selector) }),
          onclick: () => target.rule(selector),
        },
        h('span', { class: 'mono', text: value }),
        h('span', { class: 'hook-chip-count num', text: String(n) }),
      )
    })
    return h(
      'li',
      { class: 'hook-row' },
      h(
        'div',
        { class: 'hook-main' },
        h('code', {
          class: 'hook-name',
          text: hook.attr ? `${hook.base}[${hook.attr}]` : hook.base,
        }),
        h('span', {
          class: 'hook-count num',
          'data-empty': total === 0,
          title: t('matchCountTitle'),
          text: t('matchCount', { n: total }),
        }),
        h('span', { class: 'hook-desc', text: hook.desc }),
      ),
      chips.length > 0 ? h('div', { class: 'hook-chips' }, chips) : null,
      h(
        'div',
        { class: 'hook-actions' },
        iconButton(t('copySelector'), 'copy', () => copy(hook.base)),
        iconButton(t('insertRule'), 'plus', () => target.rule(hook.base)),
      ),
    )
  }

  const tokenRow = (name: string, value: string) => {
    const swatch = h('span', { class: 'hook-swatch', 'aria-hidden': 'true' })
    if (value && CSS.supports('color', value)) swatch.style.setProperty('--hook-swatch', value)
    else swatch.dataset.none = 'true'
    return h(
      'li',
      { class: 'hook-row hook-token' },
      h(
        'div',
        { class: 'hook-main' },
        swatch,
        h('code', { class: 'hook-name', text: name }),
        h('span', { class: 'hook-value mono', text: value || t('unset'), title: value }),
      ),
      h(
        'div',
        { class: 'hook-actions' },
        iconButton(t('copyVar'), 'copy', () => copy(`var(${name})`)),
        iconButton(t('overrideToken'), 'plus', () => target.token(name, value)),
      ),
    )
  }

  const render = () => {
    const query = search.value.trim()
    const searching = query !== ''
    const css = getComputedStyle(document.documentElement)
    const selectors = SELECTOR_HOOKS.filter((hook) =>
      matchesFilter(query, hook.base, hook.attr ?? '', hook.desc, ...(hook.values ?? [])),
    )
    const tokens = new Map<TokenGroup, HTMLElement[]>()
    let shownTokens = 0
    const names = tokenNames()
    for (const name of names) {
      const value = css.getPropertyValue(name).trim()
      const id = tokenGroupId(name)
      if (!matchesFilter(query, name, value, groupLabel(id))) continue
      shownTokens++
      const rows = tokens.get(id) ?? []
      rows.push(tokenRow(name, value))
      tokens.set(id, rows)
    }
    const groups: HTMLElement[] = []
    if (selectors.length > 0) {
      groups.push(
        group('selectors', t('selectors'), selectors.length, selectors.map(selectorRow), searching),
      )
    }
    const ids = [...tokens.keys()].sort((a, b) => groupOrder(a) - groupOrder(b))
    for (const id of ids) {
      const rows = tokens.get(id) ?? []
      const label = t('variables', { group: groupLabel(id) })
      groups.push(group(id, label, rows.length, rows, searching))
    }
    if (groups.length === 0) {
      groups.push(h('p', { class: 'hook-empty', text: t('empty') }))
    }
    body.replaceChildren(...groups)
    summary.textContent = searching
      ? t('summarySearch', { selectors: selectors.length, tokens: shownTokens })
      : t('summary', { selectors: SELECTOR_HOOKS.length, tokens: names.length })
  }

  let frame = 0
  const update = () => {
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(render)
  }
  search.addEventListener('input', update)

  const element = h(
    'div',
    { class: 'hook-browser' },
    h(
      'div',
      { class: 'hook-toolbar' },
      search,
      iconButton(t('recount'), 'arrows-clockwise', update),
    ),
    summary,
    body,
  )
  update()
  return { element, update }
}
