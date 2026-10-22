// GladosXshell plugin SDK. Runs inside a sandboxed frame and talks to the app only through the
// MessagePort the app hands over; every call is checked against the plugin's permissions there.
;(() => {
  let port = null
  let info = null
  let nextId = 1
  let loaded = document.readyState === 'complete'
  let started = false
  const queue = []
  const pending = new Map()
  const handlers = new Map()
  const listeners = new Map()
  const activators = []

  const errorText = (error) => (error instanceof Error ? error.message : String(error))

  // The app's interface language, from the init message; Chinese until it arrives.
  let lang = 'zh'
  const TEXT = {
    unknownCall: {
      zh: '未知的调用：{0}',
      en: 'Unknown call: {0}',
      ug: 'نامەلۇم چاقىرىق: {0}',
    },
    noCommand: {
      zh: '插件没有实现命令 {0}',
      en: 'The plugin does not implement the command {0}',
      ug: 'قىستۇرما {0} بۇيرۇقىنى ئەمەلگە ئاشۇرمىغان',
    },
  }
  const text = (key, value) => TEXT[key][lang].replace('{0}', value)

  const send = (message) => {
    if (port) port.postMessage(message)
    else queue.push(message)
  }

  const call = (method, ...args) =>
    new Promise((resolve, reject) => {
      const id = nextId++
      pending.set(id, { resolve, reject })
      try {
        send({ t: 'call', id, m: method, a: args })
      } catch (error) {
        pending.delete(id)
        reject(error)
      }
    })

  const emit = (name, data) => {
    for (const listener of listeners.get(name) ?? []) {
      try {
        listener(data)
      } catch (error) {
        console.error(error)
      }
    }
  }

  const applyTheme = (theme) => {
    if (!theme) return
    const root = document.documentElement
    root.dataset.theme = theme.mode
    for (const [name, value] of Object.entries(theme.tokens)) root.style.setProperty(name, value)
  }

  const reply = (id, result) => {
    try {
      port.postMessage({ t: 'ret', id, ...result })
    } catch (error) {
      port.postMessage({ t: 'ret', id, ok: false, e: errorText(error) })
    }
  }

  async function answer(message) {
    try {
      if (message.m !== 'command') throw new Error(text('unknownCall', message.m))
      const [name, context] = message.a
      const run = handlers.get(name)
      if (!run) throw new Error(text('noCommand', name))
      const value = await run(context)
      reply(message.id, { ok: true, v: value === undefined ? null : value })
    } catch (error) {
      reply(message.id, { ok: false, e: errorText(error) })
    }
  }

  function receive(event) {
    const message = event.data
    if (!message || typeof message !== 'object') return
    if (message.t === 'ret') {
      const waiter = pending.get(message.id)
      if (!waiter) return
      pending.delete(message.id)
      if (message.ok) waiter.resolve(message.v)
      else {
        const error = new Error(message.e)
        if (typeof message.c === 'string') error.code = message.c
        waiter.reject(error)
      }
    } else if (message.t === 'call') {
      void answer(message)
    } else if (message.t === 'event') {
      if (message.name === 'theme') applyTheme(message.data)
      emit(message.name, message.data)
    }
  }

  async function start() {
    if (started || !port || !loaded) return
    started = true
    try {
      for (const activate of activators) await activate()
      port.postMessage({ t: 'ready' })
    } catch (error) {
      port.postMessage({ t: 'fail', e: errorText(error) })
    }
  }

  window.addEventListener('message', (event) => {
    const data = event.data
    if (port || event.source !== window.parent || !data || data.gx !== 'init') return
    if (!event.ports[0]) return
    port = event.ports[0]
    info = { id: data.id, panel: data.panel ?? null }
    if (TEXT.unknownCall[data.lang]) {
      lang = data.lang
      document.documentElement.lang = lang === 'zh' ? 'zh-CN' : lang
      document.documentElement.dir = lang === 'ug' ? 'rtl' : 'ltr'
    }
    port.onmessage = receive
    applyTheme(data.theme)
    for (const message of queue.splice(0)) port.postMessage(message)
    void start()
  })
  window.addEventListener('load', () => {
    loaded = true
    void start()
  })
  // The browser's own menu (Back, Reload, Print…) makes no sense in a panel. It stays for text
  // fields and selected text, where it offers copy and paste; pages show their own with gx.ui.menu.
  window.addEventListener('contextmenu', (event) => {
    if (event.defaultPrevented) return
    const target = event.target
    if (target instanceof Element && target.closest('input, textarea, [contenteditable]')) return
    const selection = window.getSelection()
    if (selection && !selection.isCollapsed && selection.toString().trim()) return
    event.preventDefault()
  })
  window.addEventListener('error', (event) => {
    send({ t: 'log', level: 'error', text: errorText(event.error ?? event.message) })
  })
  window.addEventListener('unhandledrejection', (event) => {
    send({ t: 'log', level: 'error', text: errorText(event.reason) })
  })

  const on = (name, listener) => {
    let set = listeners.get(name)
    if (!set) {
      set = new Set()
      listeners.set(name, set)
    }
    set.add(listener)
    return () => set.delete(listener)
  }

  const outputTaps = new Map()
  const inputTaps = new Map()

  // Counted per session, so removing one listener leaves the app's watch for the others.
  async function tap(counts, event, watch, unwatch, sessionId, listener) {
    const off = on(event, (data) => {
      if (data.sessionId === sessionId) listener(data.text)
    })
    try {
      await call(watch, sessionId)
    } catch (error) {
      off()
      throw error
    }
    counts.set(sessionId, (counts.get(sessionId) ?? 0) + 1)
    let done = false
    return () => {
      if (done) return
      done = true
      off()
      const left = (counts.get(sessionId) ?? 1) - 1
      if (left > 0) {
        counts.set(sessionId, left)
      } else {
        counts.delete(sessionId)
        void call(unwatch, sessionId)
      }
    }
  }

  const gx = Object.freeze({
    get id() {
      return info?.id ?? null
    },
    /** The panel this page shows, or null in the plugin's background page. */
    get panel() {
      return info?.panel ?? null
    },
    /** The app's interface language: 'zh', 'en' or 'ug' (right to left). */
    get lang() {
      return lang
    },
    onActivate(activate) {
      activators.push(activate)
    },
    on,
    log: (text) => send({ t: 'log', level: 'info', text: String(text) }),
    commands: Object.freeze({
      register(name, run, title, icon) {
        handlers.set(name, run)
        return call('commands.register', name, title ?? null, icon ?? null)
      },
      run: (id) => call('commands.run', id),
    }),
    icons: Object.freeze({
      register: (name, data) => call('icons.register', name, data),
      list: () => call('icons.list'),
      svg: (name) => call('icons.svg', name),
    }),
    keybindings: Object.freeze({
      register: (key, command) => call('keybindings.register', key, command),
    }),
    menus: Object.freeze({
      set: (where, items) => call('menus.set', where, items),
    }),
    statusBar: Object.freeze({
      set: (item) => call('statusBar.set', item),
      remove: (id) => call('statusBar.remove', id),
    }),
    ui: Object.freeze({
      status: (text, tone) => call('ui.status', text, tone ?? 'info'),
      confirm: (title, message, label) => call('ui.confirm', title, message, label ?? null),
      prompt: (title, label, initial) => call('ui.prompt', title, label, initial ?? ''),
      pick: (items, placeholder) => call('ui.pick', items, placeholder ?? ''),
      /** Opens an app menu at page coordinates; resolves with the chosen item's id, or null. */
      menu: (x, y, items) => call('ui.menu', x, y, items),
    }),
    storage: Object.freeze({
      get: (key) => call('storage.get', key),
      set: (key, value) => call('storage.set', key, value === undefined ? null : value),
    }),
    config: Object.freeze({
      get: (key) => call('config.get', key),
      onChange: (listener) => on('config', listener),
    }),
    sessions: Object.freeze({
      list: () => call('sessions.list'),
      active: () => call('sessions.active'),
      onChange: (listener) => on('sessions', listener),
      onCwd: (listener) => on('cwd', listener),
      exec: (sessionId, command, options) =>
        call('sessions.exec', sessionId, command, options ?? {}),
    }),
    terminal: Object.freeze({
      write: (sessionId, text) => call('terminal.write', sessionId, text),
      onOutput: (sessionId, listener) =>
        tap(outputTaps, 'output', 'terminal.watch', 'terminal.unwatch', sessionId, listener),
      onInput: (sessionId, listener) =>
        tap(
          inputTaps,
          'input',
          'terminal.watchInput',
          'terminal.unwatchInput',
          sessionId,
          listener,
        ),
    }),
    profiles: Object.freeze({
      list: () => call('profiles.list'),
      save: (id, patch) => call('profiles.save', id ?? null, patch),
      remove: (id) => call('profiles.remove', id),
      onChange: (listener) => on('profiles', listener),
    }),
    files: Object.freeze({
      list: (sessionId, path) => call('files.list', sessionId, path),
      readText: (sessionId, path) => call('files.readText', sessionId, path),
      writeText: (sessionId, path, text) => call('files.writeText', sessionId, path, text),
    }),
    clipboard: Object.freeze({
      readText: () => call('clipboard.read'),
      writeText: (text) => call('clipboard.write', text),
    }),
    http: Object.freeze({
      request: (url, options) => call('http.request', url, options ?? {}),
    }),
  })
  Object.defineProperty(window, 'gx', { value: gx, enumerable: true })
})()
