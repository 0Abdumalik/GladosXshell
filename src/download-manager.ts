import { invoke } from '@tauri-apps/api/core'
import { button, modal } from './dialogs'
import { h, reportError } from './dom'
import {
  type DownloadRecord,
  dismiss,
  inScope,
  matchesRecord,
  onRecords,
  type RecordKind,
  recordsIn,
  type Scope,
} from './downloads'
import { formatBytes, formatRate } from './format'
import { locale, ltr, messages, numericDate, pl } from './i18n'
import { common } from './i18n-common'

const t = messages({
  kindDownload: { zh: '下载', en: 'Download', ug: 'چۈشۈرۈش' },
  kindPreview: { zh: '预览', en: 'Preview', ug: 'ئالدىن كۆرۈش' },
  kindEdit: { zh: '编辑副本', en: 'Edit copy', ug: 'تەھرىرلەش نۇسخىسى' },
  running: { zh: '进行中', en: 'In progress', ug: 'داۋاملىشىۋاتىدۇ' },
  done: { zh: '完成', en: 'Done', ug: 'تاماملاندى' },
  failed: { zh: '失败', en: 'Failed', ug: 'مەغلۇپ بولدى' },
  titleGlobal: {
    zh: '下载管理器（全部标签）',
    en: 'Downloads (all tabs)',
    ug: 'چۈشۈرۈش باشقۇرغۇچ (بارلىق بەتكۈچلەر)',
  },
  titleTab: { zh: '下载管理器 · {tab}', en: 'Downloads · {tab}', ug: 'چۈشۈرۈش باشقۇرغۇچ · {tab}' },
  search: {
    zh: '搜索文件名、路径或标签',
    en: 'Search file names, paths or tabs',
    ug: 'ھۆججەت ئاتى، يول ياكى بەتكۈچ ئىزدە',
  },
  searchLabel: { zh: '搜索下载记录', en: 'Search downloads', ug: 'چۈشۈرۈش خاتىرىسىنى ئىزدە' },
  kindLabel: { zh: '记录类型', en: 'Record type', ug: 'خاتىرە تىپى' },
  allKinds: { zh: '全部类型', en: 'All types', ug: 'بارلىق تىپلار' },
  list: { zh: '下载记录', en: 'Download records', ug: 'چۈشۈرۈش خاتىرىلىرى' },
  helpGlobal: {
    zh: '这里汇总所有标签的普通下载。图片预览和编辑副本记录在各自标签的下载管理器里（右键标签打开）。',
    en: "Regular downloads from every tab. Image previews and edit copies are listed in each tab's own download manager (right-click a tab to open it).",
    ug: 'بۇ يەردە بارلىق بەتكۈچلەرنىڭ ئادەتتىكى چۈشۈرۈشلىرى توپلانغان. رەسىم ئالدىن كۆرۈش ۋە تەھرىرلەش نۇسخىلىرى ھەر قايسى بەتكۈچنىڭ ئۆز چۈشۈرۈش باشقۇرغۇچىدا خاتىرىلىنىدۇ (بەتكۈچنى ئوڭ چېكىپ ئېچىڭ).',
  },
  helpTab: {
    zh: '这个标签的下载、图片预览和编辑副本。关闭标签后，这里的记录随之清除，普通下载仍保留在总下载管理器里。',
    en: 'Downloads, image previews and edit copies from this tab. Closing the tab clears this list; regular downloads stay in the main download manager.',
    ug: 'بۇ بەتكۈچنىڭ چۈشۈرۈش، رەسىم ئالدىن كۆرۈش ۋە تەھرىرلەش نۇسخىلىرى. بەتكۈچ يېپىلسا بۇ يەردىكى خاتىرىلەرمۇ تازىلىنىدۇ، ئادەتتىكى چۈشۈرۈشلەر ئومۇمىي چۈشۈرۈش باشقۇرغۇچتا ساقلىنىپ قالىدۇ.',
  },
  cancelLabel: {
    zh: '取消下载 {name}',
    en: 'Cancel download of {name}',
    ug: '{name} نى چۈشۈرۈشتىن ۋاز كەچ',
  },
  reveal: { zh: '在资源管理器中显示', en: 'Show in Explorer', ug: 'ھۆججەت باشقۇرغۇچتا كۆرسەت' },
  removeLabel: {
    zh: '移除记录 {name}',
    en: 'Remove the record of {name}',
    ug: '{name} خاتىرىسىنى چىقىرىۋەت',
  },
  progress: { zh: '{name} 进度', en: '{name} progress', ug: '{name} نىڭ ئىلگىرىلىشى' },
  clear: { zh: '清除已结束', en: 'Clear finished', ug: 'تاماملانغانلىرىنى تازىلا' },
  countShown: {
    zh: '显示 {shown} / {total} 条',
    en: 'Showing {shown} of {total}',
    ug: '{shown} / {total} تۈر كۆرسىتىلدى',
  },
  countAll: { zh: '共 {n} 条', en: pl('record'), ug: 'جەمئىي {n} تۈر' },
  noMatch: { zh: '没有匹配的记录。', en: 'No matching records.', ug: 'ماس كېلىدىغان خاتىرە يوق.' },
  emptyGlobal: {
    zh: '还没有下载。在文件面板里右键文件，选「下载」即可。',
    en: 'No downloads yet. Right-click a file in the Files panel and choose Download.',
    ug: 'تېخى چۈشۈرۈش يوق. ھۆججەت تاختىسىدا ھۆججەتنى ئوڭ چېكىپ «چۈشۈر» نى تاللاڭ.',
  },
  emptyTab: {
    zh: '这个标签还没有下载、预览或编辑过文件。',
    en: 'No files downloaded, previewed or edited in this tab yet.',
    ug: 'بۇ بەتكۈچتە تېخى ھېچقانداق ھۆججەت چۈشۈرۈلمىدى، ئالدىن كۆرۈلمىدى ياكى تەھرىرلەنمىدى.',
  },
})

const KIND_LABEL: Record<RecordKind, string> = {
  download: t('kindDownload'),
  preview: t('kindPreview'),
  edit: t('kindEdit'),
}

const STATE_LABEL = {
  running: t('running'),
  done: t('done'),
  failed: t('failed'),
  cancelled: common('cancelled'),
} as const

const report = reportError

function clock(ms: number): string {
  const date = new Date(ms)
  const time = date.toLocaleTimeString(locale(), { hour12: false })
  return date.toDateString() === new Date().toDateString()
    ? time
    : `${date.toLocaleDateString(locale(), numericDate())} ${time}`
}

function summary(record: DownloadRecord, showTab: boolean): string {
  const parts: string[] = [STATE_LABEL[record.state]]
  if (record.state === 'running') {
    if (record.bytesTotal > 0) {
      parts.push(ltr(`${formatBytes(record.bytesDone)} / ${formatBytes(record.bytesTotal)}`))
    }
    if (record.rate !== null) parts.push(ltr(formatRate(record.rate)))
  } else if (record.bytesTotal > 0) parts.push(ltr(formatBytes(record.bytesTotal)))
  if (record.message && record.state !== 'cancelled') parts.push(record.message)
  if (showTab) parts.push(record.tab.title)
  parts.push(ltr(clock(record.startedAt)))
  return parts.join(' · ')
}

interface Row {
  element: HTMLElement
  fill: HTMLElement
  bar: HTMLElement
  info: HTMLElement
  actions: HTMLElement
  /** Actions are rebuilt only when this changes, not on every progress tick. */
  signature: string
}

const open = new Map<string, HTMLDialogElement>()

/** The global manager lists every normal download; a tab's manager adds its previews and edits. */
export function openDownloads(scope: Scope, tabTitle = ''): void {
  const key = scope.type === 'global' ? 'global' : `tab-${scope.key}`
  const existing = open.get(key)
  if (existing) {
    existing.focus()
    return
  }
  const global = scope.type === 'global'
  const parts = modal(
    'downloads',
    global ? t('titleGlobal') : t('titleTab', { tab: tabTitle }),
    'lg',
  )
  parts.dialog.dataset.scope = scope.type
  open.set(key, parts.dialog)

  const search = h('input', {
    type: 'search',
    class: 'dl-search',
    placeholder: t('search'),
    'aria-label': t('searchLabel'),
    spellcheck: 'false',
  })
  const kind = h(
    'select',
    { class: 'dl-kind', 'aria-label': t('kindLabel'), hidden: global },
    h('option', { value: '', text: t('allKinds') }),
    ...(['download', 'preview', 'edit'] as const).map((k) =>
      h('option', { value: k, text: KIND_LABEL[k] }),
    ),
  )
  const count = h('p', { class: 'dl-count', 'aria-live': 'polite' })
  const list = h('ul', { class: 'dl-list', 'aria-label': t('list') })
  parts.body.append(
    h('p', {
      class: 'help',
      text: global ? t('helpGlobal') : t('helpTab'),
    }),
    h('div', { class: 'dl-head' }, search, kind, count),
    list,
  )

  const rows = new Map<number, Row>()
  const shown = () =>
    recordsIn(scope).filter(
      (r) => matchesRecord(r, search.value) && (kind.value === '' || r.kind === kind.value),
    )

  const actionsFor = (record: DownloadRecord): HTMLElement[] => {
    const out: HTMLElement[] = []
    if (record.state === 'running' && record.transferId !== null) {
      const id = record.transferId
      out.push(
        h('button', {
          type: 'button',
          class: 'button small quiet',
          text: common('cancel'),
          'aria-label': t('cancelLabel', { name: ltr(record.name) }),
          onclick: (event: Event) => {
            ;(event.currentTarget as HTMLButtonElement).disabled = true
            invoke('transfer_cancel', { id }).catch(report)
          },
        }),
      )
    }
    if (record.state === 'done' && record.local) {
      const path = record.local
      out.push(
        h('button', {
          type: 'button',
          class: 'button small quiet',
          text: t('reveal'),
          onclick: () => invoke('reveal_local', { path }).catch(report),
        }),
      )
    }
    if (record.state !== 'running') {
      out.push(
        h('button', {
          type: 'button',
          class: 'button small quiet',
          text: common('remove'),
          'aria-label': t('removeLabel', { name: ltr(record.name) }),
          onclick: () => dismiss(scope, (r) => r === record),
        }),
      )
    }
    return out
  }

  const paint = (record: DownloadRecord, row: Row) => {
    row.element.dataset.state = record.state
    const fraction =
      record.bytesTotal > 0 ? record.bytesDone / record.bytesTotal : record.state === 'done' ? 1 : 0
    row.fill.style.setProperty('--value', String(Math.min(1, fraction)))
    row.bar.setAttribute('aria-valuenow', String(Math.round(fraction * 100)))
    row.info.textContent = summary(record, global)
    row.element.title = record.local ? `${record.remote}\n→ ${record.local}` : record.remote
    const signature = `${record.state}|${record.transferId}|${record.local}`
    if (signature !== row.signature) {
      row.signature = signature
      row.actions.replaceChildren(...actionsFor(record))
    }
  }

  const build = (record: DownloadRecord): HTMLElement => {
    const fill = h('span', { class: 'transfer-fill' })
    const bar = h(
      'span',
      {
        class: 'transfer-bar',
        role: 'progressbar',
        'aria-valuemin': '0',
        'aria-valuemax': '100',
        'aria-label': t('progress', { name: ltr(record.name) }),
      },
      fill,
    )
    const info = h('span', { class: 'transfer-info num' })
    const actions = h('span', { class: 'transfer-actions' })
    const element = h(
      'li',
      { class: 'transfer dl-item', 'data-kind': record.kind },
      h('span', { class: 'transfer-dir', text: KIND_LABEL[record.kind] }),
      h('span', { class: 'transfer-name cell-text', text: record.name }),
      actions,
      bar,
      info,
    )
    const row: Row = { element, fill, bar, info, actions, signature: '' }
    rows.set(record.id, row)
    paint(record, row)
    return element
  }

  const clear = button(t('clear'), () => dismiss(scope, () => true), 'quiet')

  const render = () => {
    rows.clear()
    const all = recordsIn(scope)
    const visible = shown()
    const filtered = search.value.trim() !== '' || kind.value !== ''
    count.textContent = filtered
      ? t('countShown', { shown: visible.length, total: all.length })
      : t('countAll', { n: all.length })
    clear.disabled = all.every((r) => r.state === 'running')
    list.replaceChildren(
      ...(visible.length > 0
        ? visible.map(build)
        : [
            h('li', {
              class: 'dl-empty',
              text: all.length ? t('noMatch') : global ? t('emptyGlobal') : t('emptyTab'),
            }),
          ]),
    )
  }

  const unsubscribe = onRecords((record) => {
    if (record === null) {
      render()
      return
    }
    if (!inScope(record, scope)) return
    const row = rows.get(record.id)
    if (row) paint(record, row)
    if (record.state !== 'running') clear.disabled = false
  })
  search.addEventListener('input', render)
  kind.addEventListener('change', render)
  render()

  const close = button(common('close'), () => parts.dialog.close(), 'primary')
  parts.actions.append(clear, close)
  parts.dialog.addEventListener('close', () => {
    unsubscribe()
    open.delete(key)
    parts.dialog.remove()
  })
  parts.dialog.showModal()
  search.focus()
}
