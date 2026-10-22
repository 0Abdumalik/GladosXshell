import { invoke } from '@tauri-apps/api/core'
import { h } from '../../dom'
import { formatBytes } from '../../format'
import { forwardAdder } from '../../forward-adder'
import { describeForward } from '../../forward-spec'
import { ltr, messages } from '../../i18n'
import { common } from '../../i18n-common'
import { icon } from '../../icons'
import type { PanelHost } from '../../layout'
import { describeError, type ForwardView } from '../../protocol'
import { activeSession, onActive, onConnected, onEnded, type SessionInfo } from '../../sessions'
import type { BuiltinPlugin } from '../api'
import { BUILTIN_VERSION } from './version'

const t = messages({
  name: { zh: '端口转发', en: 'Port forwarding', ug: 'ئېغىز يوللاش' },
  description: {
    zh: '查看当前 SSH 会话的端口转发和流量，临时添加或停止 {flags} 转发。',
    en: 'See the port forwards and traffic of the current SSH session, and add or stop {flags} forwards on the fly.',
    ug: 'نۆۋەتتىكى SSH ئەڭگىمىسىنىڭ ئېغىز يوللاش ۋە ئېقىم مىقدارىنى كۆرۈش، {flags} يوللاشنى ۋاقىتلىق قوشۇش ياكى توختىتىش.',
  },
  listLabel: {
    zh: '当前会话的端口转发',
    en: 'Port forwards in this session',
    ug: 'نۆۋەتتىكى ئەڭگىمەنىڭ ئېغىز يوللاشلىرى',
  },
  noSession: {
    zh: '没有已连接的 SSH 会话',
    en: 'No connected SSH session',
    ug: 'ئۇلانغان SSH ئەڭگىمىسى يوق',
  },
  stopFailed: {
    zh: '停止 {forward} 失败：{error}',
    en: "Couldn't stop {forward}: {error}",
    ug: '{forward} نى توختىتىش مەغلۇپ بولدى: {error}',
  },
  stopForward: { zh: '停止 {forward}', en: 'Stop {forward}', ug: '{forward} نى توختات' },
  meta: {
    zh: '连接 {active} / 累计 {total} · ↑ {up} ↓ {down}',
    en: '{active} open / {total} total · ↑ {up} ↓ {down}',
    ug: 'ئۇلىنىش {active} / جەمئىي {total} · ↑ {up} ↓ {down}',
  },
  empty: {
    zh: '这个会话还没有端口转发。',
    en: 'No port forwards in this session yet.',
    ug: 'بۇ ئەڭگىمىدە تېخى ئېغىز يوللاش يوق.',
  },
  titleFor: {
    zh: '{title} 的端口转发',
    en: 'Port forwarding on {title}',
    ug: '{title} نىڭ ئېغىز يوللىشى',
  },
  notConnected: {
    zh: '会话未连接。连接成功后可以在这里添加和停止端口转发。',
    en: 'The session is not connected. Once it connects, you can add and stop port forwards here.',
    ug: 'ئەڭگىمە ئۇلانمىغان. ئۇلانغاندىن كېيىن بۇ يەردە ئېغىز يوللاشنى قوشالايسىز ۋە توختىتالايسىز.',
  },
  noSsh: {
    zh: '切换到一个已连接的 SSH 会话后，可以在这里添加和停止端口转发。',
    en: 'Switch to a connected SSH session to add and stop port forwards here.',
    ug: 'ئۇلانغان SSH ئەڭگىمىسىگە ئالماشقاندىن كېيىن، بۇ يەردە ئېغىز يوللاشنى قوشالايسىز ۋە توختىتالايسىز.',
  },
})

const POLL_MS = 2000

interface Row {
  item: HTMLLIElement
  text: HTMLElement
  meta: HTMLElement
  error: HTMLElement
}

function liveSsh(info: SessionInfo | null): number | null {
  return info?.kind === 'ssh' && info.state === 'live' ? info.id : null
}

function forwardsPanel(): PanelHost {
  const title = h('span', { class: 'fwd-target' })
  const empty = h('p', { class: 'panel-empty' })
  const list = h('ul', { class: 'forward-list fwd-list', 'aria-label': t('listLabel') })
  const listError = h('p', { class: 'panel-error', role: 'alert', hidden: true })
  const rows = new Map<number, Row>()
  let session: number | null = null
  /** Bumped on every session switch so a late reply for the old session is dropped. */
  let generation = 0

  const adder = forwardAdder(async (spec) => {
    if (session === null) return t('noSession')
    try {
      await invoke<ForwardView>('forward_start', { sessionId: session, spec })
    } catch (error) {
      return describeError(error)
    }
    await refresh()
    return null
  })
  const body = h('div', { class: 'fwd-body' }, list, listError, adder)
  const element = h(
    'div',
    { class: 'fwd-panel' },
    h('div', { class: 'fwd-head' }, icon('arrows-left-right'), title),
    empty,
    body,
  )

  const stop = async (id: number, view: ForwardView) => {
    if (session === null) return
    try {
      await invoke('forward_stop', { sessionId: session, forwardId: id })
    } catch (error) {
      listError.textContent = t('stopFailed', {
        forward: ltr(describeForward(view.spec, view.boundPort)),
        error: describeError(error),
      })
      listError.hidden = false
    }
    await refresh()
  }

  const rowFor = (view: ForwardView): Row => {
    const existing = rows.get(view.id)
    if (existing) return existing
    const text = h('span', { class: 'forward-text' })
    const meta = h('span', { class: 'fwd-meta' })
    const error = h('span', { class: 'fwd-error' })
    const button = h(
      'button',
      {
        type: 'button',
        class: 'icon-button',
        title: common('stop'),
        'aria-label': t('stopForward', {
          forward: ltr(describeForward(view.spec, view.boundPort)),
        }),
        onclick: () => void stop(view.id, view),
      },
      icon('stop'),
    )
    const item = h(
      'li',
      { class: 'forward-item fwd-item' },
      h('div', { class: 'fwd-lines' }, text, meta, error),
      button,
    )
    const row = { item, text, meta, error }
    rows.set(view.id, row)
    return row
  }

  const render = (views: ForwardView[]) => {
    const seen = new Set(views.map((v) => v.id))
    for (const [id, row] of rows) {
      if (seen.has(id)) continue
      row.item.remove()
      rows.delete(id)
    }
    for (const view of views) {
      const row = rowFor(view)
      row.text.textContent = describeForward(view.spec, view.boundPort)
      row.text.title = row.text.textContent
      row.meta.textContent = t('meta', {
        active: view.active,
        total: view.total,
        up: ltr(formatBytes(view.bytesUp)),
        down: ltr(formatBytes(view.bytesDown)),
      })
      row.error.textContent = view.lastError ?? ''
      row.error.hidden = !view.lastError
      list.append(row.item)
    }
    list.querySelector('.forward-empty')?.remove()
    if (views.length === 0) {
      list.append(h('li', { class: 'forward-empty', text: t('empty') }))
    }
  }

  async function refresh(): Promise<void> {
    const id = session
    const token = generation
    if (id === null) return
    try {
      const views = await invoke<ForwardView[]>('forward_list', { sessionId: id })
      if (token !== generation) return
      listError.hidden = true
      render(views)
    } catch (error) {
      if (token !== generation) return
      listError.textContent = describeError(error)
      listError.hidden = false
    }
  }

  const follow = () => {
    const info = activeSession()
    const id = liveSsh(info)
    if (id !== session) {
      session = id
      generation += 1
      for (const row of rows.values()) row.item.remove()
      rows.clear()
      listError.hidden = true
    }
    body.hidden = id === null
    empty.hidden = id !== null
    title.textContent = id === null ? t('name') : t('titleFor', { title: ltr(info?.title ?? '') })
    empty.textContent = info?.kind === 'ssh' ? t('notConnected') : t('noSsh')
    void refresh()
  }

  onActive(follow)
  onConnected((info) => {
    if (info.key === activeSession()?.key) follow()
  })
  onEnded(() => follow())
  // Counters change without any event; only poll while someone can see them.
  window.setInterval(() => {
    if (session !== null && element.offsetParent !== null) void refresh()
  }, POLL_MS)
  follow()
  return { element, shown: () => void refresh() }
}

export const forwardsPlugin: BuiltinPlugin = {
  manifest: {
    id: 'gx.forwards',
    name: t('name'),
    version: BUILTIN_VERSION,
    description: t('description', { flags: ltr('-L / -R / -D') }),
  },
  activate(ctx) {
    ctx.panels.register({
      id: 'forwards',
      title: t('name'),
      icon: 'arrows-left-right',
      region: 'bottom',
      build: forwardsPanel,
    })
  },
}
