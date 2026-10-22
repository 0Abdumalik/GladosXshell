import { Channel, invoke } from '@tauri-apps/api/core'
import { logApp } from './applog'
import { confirmDialog } from './dialogs'
import { h, reportError } from './dom'
import { addRecord, type DownloadRecord, discardRecord, updateRecord } from './downloads'
import { formatBytes, formatRate } from './format'
import { ltr, messages } from './i18n'
import { common } from './i18n-common'
import { describeError, errorKind, type Progress, type TransferEvent } from './protocol'
import { tabOf } from './sessions'

const t = messages({
  clear: { zh: '清除已结束', en: 'Clear finished', ug: 'تاماملانغانلىرىنى تازىلا' },
  queue: { zh: '传输队列', en: 'Transfer queue', ug: 'يەتكۈزۈش ئۆچىرىكى' },
  headRunning: {
    zh: '传输 · {n} 个进行中',
    en: 'Transfers · {n} in progress',
    ug: 'يەتكۈزۈش · {n} داۋاملىشىۋاتىدۇ',
  },
  headFinished: {
    zh: '传输 · {n} 个已结束',
    en: 'Transfers · {n} finished',
    ug: 'يەتكۈزۈش · {n} تاماملاندى',
  },
  files: { zh: '{done}/{total} 个文件', en: '{done}/{total} files', ug: '{done}/{total} ھۆججەت' },
  resumed: {
    zh: '已有 {size} 未重传',
    en: '{size} already there, not sent again',
    ug: '{size} بار ئىكەن، قايتا يوللانمىدى',
  },
  took: { zh: '用时 {s} 秒', en: 'took {s} s', ug: '{s} سېكۇنت كەتتى' },
  downloadFailed: {
    zh: '{tab}：下载 {name} 失败（{remote}）：{message}',
    en: '{tab}: download of {name} failed ({remote}): {message}',
    ug: '{tab}: {name} نى چۈشۈرۈش مەغلۇپ بولدى ({remote}): {message}',
  },
  uploadFailed: {
    zh: '{tab}：上传 {name} 失败（{remote}）：{message}',
    en: '{tab}: upload of {name} failed ({remote}): {message}',
    ug: '{tab}: {name} نى يۈكلەش مەغلۇپ بولدى ({remote}): {message}',
  },
  removeLabel: {
    zh: '从列表移除 {name}',
    en: 'Remove {name} from the list',
    ug: '{name} نى تىزىملىكتىن چىقىرىۋەت',
  },
  retry: { zh: '重试', en: 'Retry', ug: 'قايتا سىنا' },
  retryLabel: {
    zh: '重试传输 {name}',
    en: 'Retry the transfer of {name}',
    ug: '{name} نى يەتكۈزۈشنى قايتا سىنا',
  },
  reveal: { zh: '在资源管理器中显示', en: 'Show in Explorer', ug: 'ھۆججەت باشقۇرغۇچتا كۆرسەت' },
  progress: { zh: '{name} 进度', en: '{name} progress', ug: '{name} نىڭ ئىلگىرىلىشى' },
  preparing: { zh: '准备中…', en: 'Preparing…', ug: 'تەييارلىنىۋاتىدۇ…' },
  download: { zh: '下载', en: 'Download', ug: 'چۈشۈرۈش' },
  upload: { zh: '上传', en: 'Upload', ug: 'يۈكلەش' },
  cancelLabel: {
    zh: '取消传输 {name}',
    en: 'Cancel the transfer of {name}',
    ug: '{name} نى يەتكۈزۈشتىن ۋاز كەچ',
  },
  existsTitle: { zh: '目标已存在', en: 'Target exists', ug: 'نىشان ئاللىقاچان مەۋجۇت' },
  existsBody: {
    zh: '{target}\n已经存在。覆盖会替换不同的文件，大小和修改时间都相同的文件会跳过。',
    en: '{target}\nalready exists. Overwriting replaces files that differ and skips files with the same size and modified time.',
    ug: '{target}\nئاللىقاچان مەۋجۇت. قاپلىسا ئوخشىمايدىغان ھۆججەتلەر ئالماشتۇرۇلىدۇ، چوڭلۇقى ۋە ئۆزگەرتىلگەن ۋاقتى ئوخشاش ھۆججەتلەر ئاتلاپ ئۆتۈلىدۇ.',
  },
  overwrite: { zh: '覆盖', en: 'Overwrite', ug: 'قاپلا' },
})

export type Direction = 'download' | 'upload'

export interface TransferRequest {
  sessionId: number
  direction: Direction
  /** Download: destination directory. Upload: the local file or folder. */
  local: string
  /** Download: the remote file or folder. Upload: destination directory. */
  remote: string
  name: string
  /** Runs once the job ends in any way, or when it never starts. Such jobs cannot be retried. */
  onEnd?: () => void
}

type JobState = 'running' | 'done' | 'failed' | 'cancelled'

interface Job {
  id: number | null
  request: TransferRequest
  target: string
  state: JobState
  row: HTMLElement
  fill: HTMLElement
  bar: HTMLElement
  info: HTMLElement
  actions: HTMLElement
  started: number
  sample: { at: number; bytes: number }
  rate: number | null
  /** Downloads are also listed in the download managers. */
  record: DownloadRecord | null
}

const KEEP_FINISHED = 50

export interface TransferQueue {
  element: HTMLElement
  start(request: TransferRequest): Promise<void>
}

/** The collapsible transfer list under the file table. `onFinished` fires after a successful job. */
export function transferQueue(onFinished: (request: TransferRequest) => void): TransferQueue {
  const jobs: Job[] = []
  const list = h('ul', { class: 'transfers-list', id: 'transfers-list' })
  const toggle = h('button', {
    type: 'button',
    class: 'transfers-toggle',
    'aria-expanded': 'true',
    'aria-controls': 'transfers-list',
  })
  const clear = h('button', {
    type: 'button',
    class: 'button small quiet',
    text: t('clear'),
    onclick: () => {
      for (const job of jobs.filter((j) => j.state !== 'running')) remove(job)
    },
  })
  const element = h(
    'section',
    { class: 'transfers', 'aria-label': t('queue'), hidden: true },
    h('header', { class: 'transfers-head' }, toggle, clear),
    list,
  )
  toggle.addEventListener('click', () => {
    const open = toggle.getAttribute('aria-expanded') !== 'true'
    toggle.setAttribute('aria-expanded', String(open))
    list.hidden = !open
  })

  const paintHead = () => {
    element.hidden = jobs.length === 0
    const running = jobs.filter((j) => j.state === 'running').length
    toggle.textContent =
      running > 0 ? t('headRunning', { n: running }) : t('headFinished', { n: jobs.length })
    clear.disabled = running === jobs.length
  }

  const remove = (job: Job) => {
    const index = jobs.indexOf(job)
    if (index >= 0) jobs.splice(index, 1)
    job.row.remove()
    paintHead()
  }

  const trim = () => {
    const finished = jobs.filter((j) => j.state !== 'running')
    for (const job of finished.slice(0, Math.max(0, finished.length - KEEP_FINISHED))) remove(job)
  }

  const setProgress = (job: Job, p: Progress) => {
    const fraction = p.bytesTotal > 0 ? p.bytesDone / p.bytesTotal : job.state === 'done' ? 1 : 0
    job.fill.style.setProperty('--value', String(Math.min(1, fraction)))
    job.bar.setAttribute('aria-valuenow', String(Math.round(fraction * 100)))
    const files =
      p.filesTotal > 1 ? ` · ${t('files', { done: p.filesDone, total: p.filesTotal })}` : ''
    const reused =
      p.bytesResumed > 0 ? ` · ${t('resumed', { size: ltr(formatBytes(p.bytesResumed)) })}` : ''
    if (job.state === 'running') {
      // Resumed bytes arrive in one jump and would inflate the rate.
      const sent = p.bytesDone - p.bytesResumed
      const now = performance.now()
      const dt = (now - job.sample.at) / 1000
      if (dt >= 0.25) {
        const instant = (sent - job.sample.bytes) / dt
        job.rate = job.rate === null ? instant : job.rate * 0.6 + instant * 0.4
        job.sample = { at: now, bytes: sent }
      }
      const rate = job.rate === null ? '' : ` · ${ltr(formatRate(job.rate))}`
      const size = ltr(`${formatBytes(p.bytesDone)} / ${formatBytes(p.bytesTotal)}`)
      job.info.textContent = `${size}${rate}${files}${reused}`
    } else {
      const secs = (performance.now() - job.started) / 1000
      const took = t('took', { s: secs.toFixed(1) })
      job.info.textContent = `${ltr(formatBytes(p.bytesTotal))} · ${took}${files}${reused}`
    }
    if (job.record) {
      updateRecord(job.record, { bytesDone: p.bytesDone, bytesTotal: p.bytesTotal, rate: job.rate })
    }
  }

  const finish = (job: Job, state: JobState, message = '') => {
    job.state = state
    job.row.dataset.state = state
    if (message) job.info.textContent = message
    if (job.record) updateRecord(job.record, { state, message, transferId: null })
    if (state === 'failed') {
      const { direction, name, remote, sessionId } = job.request
      const params = { tab: tabOf(sessionId).title, name: ltr(name), remote: ltr(remote), message }
      logApp('error', t(direction === 'download' ? 'downloadFailed' : 'uploadFailed', params))
    }
    const dismiss = h('button', {
      type: 'button',
      class: 'button small quiet',
      text: common('remove'),
      'aria-label': t('removeLabel', { name: ltr(job.request.name) }),
      onclick: () => remove(job),
    })
    // Retrying with overwrite continues from the part files the failed attempt left behind.
    const retry =
      (state === 'failed' || state === 'cancelled') && !job.request.onEnd
        ? h('button', {
            type: 'button',
            class: 'button small quiet',
            text: t('retry'),
            'aria-label': t('retryLabel', { name: ltr(job.request.name) }),
            onclick: () => {
              remove(job)
              if (job.record) discardRecord(job.record)
              void start(job.request, true)
            },
          })
        : null
    const reveal =
      state === 'done' && job.request.direction === 'download'
        ? h('button', {
            type: 'button',
            class: 'button small quiet',
            text: t('reveal'),
            onclick: () => {
              invoke('reveal_local', { path: job.target }).catch((e) => reportError(e))
            },
          })
        : null
    job.actions.replaceChildren(...[retry, reveal, dismiss].filter((b) => b !== null))
    job.request.onEnd?.()
    paintHead()
    trim()
  }

  const create = (request: TransferRequest): Job => {
    const fill = h('span', { class: 'transfer-fill' })
    const bar = h(
      'span',
      {
        class: 'transfer-bar',
        role: 'progressbar',
        'aria-valuemin': '0',
        'aria-valuemax': '100',
        'aria-valuenow': '0',
        'aria-label': t('progress', { name: ltr(request.name) }),
      },
      fill,
    )
    const info = h('span', { class: 'transfer-info num', text: t('preparing') })
    const actions = h('span', { class: 'transfer-actions' })
    const row = h(
      'li',
      { class: 'transfer', 'data-state': 'running', 'data-direction': request.direction },
      h('span', {
        class: 'transfer-dir',
        text: request.direction === 'download' ? t('download') : t('upload'),
      }),
      h('span', { class: 'transfer-name cell-text', text: request.name, title: request.name }),
      actions,
      bar,
      info,
    )
    const now = performance.now()
    const job: Job = {
      id: null,
      request,
      target: '',
      state: 'running',
      row,
      fill,
      bar,
      info,
      actions,
      started: now,
      sample: { at: now, bytes: 0 },
      rate: null,
      record:
        request.direction === 'download'
          ? addRecord('download', tabOf(request.sessionId), request.name, request.remote)
          : null,
    }
    const cancel = h('button', {
      type: 'button',
      class: 'button small quiet',
      text: common('cancel'),
      'aria-label': t('cancelLabel', { name: ltr(request.name) }),
      onclick: () => {
        if (job.id === null) return
        cancel.disabled = true
        invoke('transfer_cancel', { id: job.id }).catch((e) => reportError(e))
      },
    })
    actions.append(cancel)
    jobs.push(job)
    list.prepend(row)
    paintHead()
    return job
  }

  const start = async (request: TransferRequest, overwrite = false): Promise<void> => {
    const job = create(request)
    const channel = new Channel<TransferEvent>()
    channel.onmessage = (event) => {
      if (job.state !== 'running') return
      if (event.type === 'progress') setProgress(job, event.progress)
      else if (event.type === 'done') {
        job.state = 'done'
        setProgress(job, event.progress)
        finish(job, 'done')
        onFinished(request)
      } else if (event.error.kind === 'cancelled') finish(job, 'cancelled', common('cancelled'))
      else finish(job, 'failed', describeError(event.error))
    }
    try {
      const started = await invoke<{ id: number; target: string }>('transfer_start', {
        args: {
          sessionId: request.sessionId,
          direction: request.direction,
          local: request.local,
          remote: request.remote,
          overwrite,
        },
        onProgress: channel,
      })
      job.id = started.id
      job.target = started.target
      job.row.title = started.target
      if (job.record) updateRecord(job.record, { transferId: started.id, local: started.target })
    } catch (error) {
      if (!overwrite && errorKind(error) === 'exists') {
        remove(job)
        if (job.record) discardRecord(job.record)
        const replace = await confirmDialog(
          t('existsTitle'),
          t('existsBody', { target: ltr(describeError(error)) }),
          t('overwrite'),
          true,
        )
        if (replace) await start(request, true)
        else request.onEnd?.()
        return
      }
      finish(job, 'failed', describeError(error))
    }
  }

  return { element, start: (request) => start(request) }
}
