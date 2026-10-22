// The Hello panel: shows the greeting setting and the open sessions, and runs `greet`.

// Texts this page shows, in the app's interface language (`gx.lang`). The page's `lang` and `dir`
// already follow it; elements with `data-t` get their text from here.
const TEXT = {
  zh: {
    connecting: '连接中',
    live: '已连接',
    ended: '已结束',
    failed: '失败',
    copyTitle: '复制标题',
    copyId: '复制会话编号',
    greet: '打个招呼',
    hello: '你好',
    greeting: '问候语：{text}',
    sessions: '会话',
    empty: '还没有打开的会话',
  },
  en: {
    connecting: 'Connecting',
    live: 'Connected',
    ended: 'Ended',
    failed: 'Failed',
    copyTitle: 'Copy title',
    copyId: 'Copy session number',
    greet: 'Say hello',
    hello: 'Hello',
    greeting: 'Greeting: {text}',
    sessions: 'Sessions',
    empty: 'No sessions open yet',
  },
  ug: {
    connecting: 'ئۇلىنىۋاتىدۇ',
    live: 'ئۇلاندى',
    ended: 'ئاخىرلاشتى',
    failed: 'مەغلۇپ بولدى',
    copyTitle: 'ماۋزۇنى كۆچۈرۈش',
    copyId: 'ئەڭگىمە نومۇرىنى كۆچۈرۈش',
    greet: 'سالام بېرىش',
    hello: 'ياخشىمۇسىز',
    greeting: 'سالام سۆزى: {text}',
    sessions: 'ئەڭگىمەلەر',
    empty: 'تېخى ئېچىلغان ئەڭگىمە يوق',
  },
}
const text = (key, values = {}) =>
  TEXT[gx.lang][key].replace(/\{(\w+)\}/g, (_, name) => String(values[name] ?? ''))

function renderSessions(sessions) {
  const list = document.getElementById('sessions')
  list.replaceChildren(
    ...sessions.map((session) => {
      const item = document.createElement('li')
      const title = document.createElement('span')
      const state = document.createElement('span')
      title.textContent = session.title
      state.textContent = Object.hasOwn(TEXT.en, session.state)
        ? text(session.state)
        : session.state
      item.append(title, state)
      item.addEventListener('contextmenu', (event) => {
        event.preventDefault()
        sessionMenu(session, event.clientX, event.clientY)
      })
      return item
    }),
  )
  document.getElementById('empty').hidden = sessions.length > 0
}

// A menu drawn by the app, at a point inside this page; resolves with the chosen id.
async function sessionMenu(session, x, y) {
  const chosen = await gx.ui.menu(x, y, [
    { id: 'copy-title', label: text('copyTitle'), icon: 'copy' },
    { id: 'copy-id', label: text('copyId'), icon: 'tag', disabled: session.id === null },
    'separator',
    { id: 'greet', label: text('greet'), icon: 'smile' },
  ])
  if (chosen === 'copy-title') await gx.clipboard.writeText(session.title)
  else if (chosen === 'copy-id') await gx.clipboard.writeText(String(session.id))
  else if (chosen === 'greet') await gx.commands.run('greet')
}

async function renderGreeting() {
  const greeting = (await gx.config.get('greeting')) || text('hello')
  document.getElementById('greeting').textContent = text('greeting', { text: greeting })
}

gx.onActivate(async () => {
  for (const element of document.querySelectorAll('[data-t]')) {
    element.textContent = text(element.dataset.t)
  }
  // The SVG comes from the app and only ever holds path data, so it is safe to insert as markup.
  document.getElementById('mark').innerHTML = (await gx.icons.svg('smile')) ?? ''
  document.getElementById('greet').addEventListener('click', () => {
    gx.commands.run('greet').catch((error) => gx.log(String(error)))
  })
  await renderGreeting()
  renderSessions(await gx.sessions.list())
  gx.sessions.onChange(renderSessions)
  gx.config.onChange(({ key }) => {
    if (key === 'greeting') renderGreeting()
  })
})
