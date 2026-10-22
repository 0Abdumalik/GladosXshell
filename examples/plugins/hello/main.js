// Background page of the Hello example: owns the commands and the status bar item.

const STATUS_ID = 'count'

// Texts this script shows, in the app's interface language. plugin.json translates its own texts
// with "locales"; text made at run time picks the language from `gx.lang`.
const TEXT = {
  zh: {
    hello: '你好',
    statusTitle: '点击再打一次招呼',
    greeted: '{greeting}，这是第 {count} 次{where}',
    where: '（当前会话：{title}）',
    noSelection: '终端里没有选中的内容',
    copied: '已复制为引用',
  },
  en: {
    hello: 'Hello',
    statusTitle: 'Click to say hello again',
    greeted: '{greeting}, greeting number {count}{where}',
    where: ' (current session: {title})',
    noSelection: 'Nothing is selected',
    copied: 'Copied as a quote',
  },
  ug: {
    hello: 'ياخشىمۇسىز',
    statusTitle: 'يەنە بىر قېتىم سالام بېرىش ئۈچۈن چېكىڭ',
    greeted: '{greeting}، بۇ {count}-قېتىملىق سالام{where}',
    where: ' (نۆۋەتتىكى ئەڭگىمە: {title})',
    noSelection: 'تاللانغان مەزمۇن يوق',
    copied: 'نەقىل قىلىپ كۆچۈرۈلدى',
  },
}
const text = (key, values = {}) =>
  TEXT[gx.lang][key].replace(/\{(\w+)\}/g, (_, name) => String(values[name] ?? ''))
// Names and paths stay in one left-to-right piece inside Uyghur text.
const ltr = (value) => (gx.lang === 'ug' ? `\u2066${value}\u2069` : value)

// Icons can also be added at run time; this one is a filled speech mark in the default 256 box.
const QUOTE_ICON =
  'M100 56H52a12 12 0 0 0-12 12v56a12 12 0 0 0 12 12h44v8a32 32 0 0 1-32 32a8 8 0 0 0 0 16a48 48 0 0 0 48-48V68a12 12 0 0 0-12-12Zm104 0h-48a12 12 0 0 0-12 12v56a12 12 0 0 0 12 12h44v8a32 32 0 0 1-32 32a8 8 0 0 0 0 16a48 48 0 0 0 48-48V68a12 12 0 0 0-12-12Z'

async function showCount(count) {
  if (await gx.config.get('show-status')) {
    await gx.statusBar.set({
      id: STATUS_ID,
      text: `Hello ×${count}`,
      title: text('statusTitle'),
      command: 'greet',
      icon: 'smile',
    })
  } else {
    await gx.statusBar.remove(STATUS_ID)
  }
}

async function greet() {
  const count = ((await gx.storage.get('count')) ?? 0) + 1
  await gx.storage.set('count', count)
  const greeting = (await gx.config.get('greeting')) || text('hello')
  const session = await gx.sessions.active()
  const where = session ? text('where', { title: ltr(session.title) }) : ''
  await gx.ui.status(text('greeted', { greeting, count, where }))
  await showCount(count)
}

// The terminal menu passes `{ sessionId, selection, live }`, the text menu `{ selection, editable }`.
// `"when": "selection"` in plugin.json already hides the entry when nothing is selected.
async function quoteSelection(context) {
  const selection = typeof context?.selection === 'string' ? context.selection : ''
  if (!selection.trim()) {
    await gx.ui.status(text('noSelection'), 'error')
    return
  }
  const quoted = selection
    .split(/\r?\n/)
    .map((line) => `> ${line}`)
    .join('\n')
  await gx.clipboard.writeText(quoted)
  await gx.ui.status(text('copied'))
}

gx.onActivate(async () => {
  await gx.icons.register('quote', QUOTE_ICON)
  await gx.commands.register('greet', greet)
  await gx.commands.register('quote-selection', quoteSelection)
  await showCount((await gx.storage.get('count')) ?? 0)
  gx.config.onChange(async ({ key }) => {
    if (key === 'show-status') await showCount((await gx.storage.get('count')) ?? 0)
  })
})
