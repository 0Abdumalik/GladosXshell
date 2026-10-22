import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import { h } from '../dom'
import { formatBytes, formatRate } from '../format'
import { ltr, messages, pl } from '../i18n'
import { common } from '../i18n-common'
import { icon } from '../icons'
import { settings } from '../settings-store'
import {
  type FileSink,
  type Outcome,
  type OutgoingFile,
  type Progress,
  Receiver,
  type Role,
  Sender,
  type ZmodemHost,
  type ZmodemSession,
} from './session'

const t = messages({
  szSending: { zh: 'sz 正在发送文件', en: 'sz is sending files', ug: 'sz ھۆججەت يوللاۋاتىدۇ' },
  rzWaiting: { zh: 'rz 正在等待文件', en: 'rz is waiting for files', ug: 'rz ھۆججەت كۈتۈۋاتىدۇ' },
  readyToReceive: {
    zh: '准备接收…',
    en: 'Getting ready to receive…',
    ug: 'قوبۇل قىلىشقا تەييارلىنىۋاتىدۇ…',
  },
  chooseUpload: {
    zh: '选择要上传的文件…',
    en: 'Choose the files to upload…',
    ug: 'يۈكلەيدىغان ھۆججەتلەرنى تاللاڭ…',
  },
  receiving: { zh: '正在接收 {name}', en: 'Receiving {name}', ug: '{name} قوبۇل قىلىنىۋاتىدۇ' },
  receivingOf: {
    zh: '正在接收 {name}（{index}/{count}）',
    en: 'Receiving {name} ({index}/{count})',
    ug: '{name} قوبۇل قىلىنىۋاتىدۇ ({index}/{count})',
  },
  uploading: { zh: '正在上传 {name}', en: 'Uploading {name}', ug: '{name} يۈكلىنىۋاتىدۇ' },
  uploadingOf: {
    zh: '正在上传 {name}（{index}/{count}）',
    en: 'Uploading {name} ({index}/{count})',
    ug: '{name} يۈكلىنىۋاتىدۇ ({index}/{count})',
  },
  received: {
    zh: '已接收 {n} 个文件，共 {size}',
    en: (p) => `Received ${pl('file')(p)}, ${p.size} in total`,
    ug: '{n} ھۆججەت قوبۇل قىلىندى، جەمئىي {size}',
  },
  uploaded: {
    zh: '已上传 {n} 个文件，共 {size}',
    en: (p) => `Uploaded ${pl('file')(p)}, ${p.size} in total`,
    ug: '{n} ھۆججەت يۈكلەندى، جەمئىي {size}',
  },
  skipped: {
    zh: '{n} 个文件被跳过',
    en: (p) => `${pl('file')(p)} skipped`,
    ug: '{n} ھۆججەت ئاتلاپ ئۆتۈلدى',
  },
  /** Joins the two clauses above. */
  clauseSep: { zh: '，', en: ', ', ug: '، ' },
  noneReceived: {
    zh: '没有接收文件',
    en: 'No files received',
    ug: 'ھېچقانداق ھۆججەت قوبۇل قىلىنمىدى',
  },
  noneUploaded: { zh: '没有上传文件', en: 'No files uploaded', ug: 'ھېچقانداق ھۆججەت يۈكلەنمىدى' },
  savedIn: { zh: '保存在 {folder}', en: 'Saved in {folder}', ug: 'ساقلانغان ئورنى: {folder}' },
  receiveCancelled: { zh: '接收已取消', en: 'Receive cancelled', ug: 'قوبۇل قىلىشتىن ۋاز كەچتى' },
  uploadCancelled: { zh: '上传已取消', en: 'Upload cancelled', ug: 'يۈكلەشتىن ۋاز كەچتى' },
  nothingFinished: {
    zh: '没有文件传完',
    en: 'No file finished',
    ug: 'ھېچقانداق ھۆججەت تولۇق يەتكۈزۈلمىدى',
  },
  receiveFailed: { zh: '接收失败', en: 'Receive failed', ug: 'قوبۇل قىلىش مەغلۇپ بولدى' },
  uploadFailed: { zh: '上传失败', en: 'Upload failed', ug: 'يۈكلەش مەغلۇپ بولدى' },
  openFolder: { zh: '打开文件夹', en: 'Open folder', ug: 'قىسقۇچنى ئاچ' },
  dismiss: { zh: '收起', en: 'Dismiss', ug: 'يىغ' },
  saveTo: {
    zh: '选择 sz 文件的保存位置',
    en: 'Choose where to save the files from sz',
    ug: 'sz ھۆججەتلىرىنى ساقلايدىغان ئورۇننى تاللاڭ',
  },
  pickFiles: {
    zh: '选择要通过 rz 上传的文件',
    en: 'Choose files to upload with rz',
    ug: 'rz ئارقىلىق يۈكلەيدىغان ھۆججەتلەرنى تاللاڭ',
  },
})

const READ_AHEAD = 1024 * 1024
const RESULT_MS = 8000

interface SaveTarget {
  handle: number
  path: string
}

interface LocalFile {
  path: string
  name: string
  size: number
  mtime: number
}

function localFile(file: LocalFile): OutgoingFile {
  let cache = { offset: 0, data: new Uint8Array() }
  return {
    name: file.name,
    size: file.size,
    mtime: file.mtime,
    read: async (offset, length) => {
      if (offset < cache.offset || offset + length > cache.offset + cache.data.length) {
        const bytes = await invoke<ArrayBuffer>('zmodem_read', {
          path: file.path,
          offset,
          len: Math.max(length, READ_AHEAD),
        })
        cache = { offset, data: new Uint8Array(bytes) }
      }
      const start = offset - cache.offset
      return cache.data.subarray(start, start + length)
    },
  }
}

function sink(target: SaveTarget): FileSink {
  const headers = { 'x-handle': String(target.handle) }
  return {
    path: target.path,
    write: (data) => invoke('zmodem_save_write', data, { headers }),
    close: (keep) => invoke('zmodem_save_end', { handle: target.handle, keep }),
  }
}

/** The overlay that shows a running transfer and then its result. */
class TransferView {
  readonly element: HTMLElement
  private readonly title = h('strong')
  private readonly detail = h('p', { class: 'num' })
  private readonly bar = h('progress', { max: 1, value: 0 })
  private readonly actions = h('div', { class: 'terminal-banner-actions' })
  private progress: Progress | null = null
  private frame = 0
  private rate: { at: number; bytes: number; name: string; perSec: number | null } | null = null
  private hideTimer: ReturnType<typeof setTimeout> | undefined

  constructor(
    private readonly role: Role,
    private readonly onCancel: () => void,
    private readonly onClose: () => void,
  ) {
    this.element = h(
      'section',
      { class: 'terminal-banner zmodem-transfer', 'data-tone': 'info', role: 'status' },
      h(
        'span',
        { class: 'terminal-banner-icon' },
        icon(role === 'receive' ? 'download' : 'upload'),
      ),
      h('div', { class: 'terminal-banner-text' }, this.title, this.bar, this.detail),
      this.actions,
    )
    this.element.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      if (this.element.dataset.state === 'running') this.onCancel()
      else this.onClose()
    })
    this.title.textContent = role === 'receive' ? t('szSending') : t('rzWaiting')
    this.detail.textContent = role === 'receive' ? t('readyToReceive') : t('chooseUpload')
    this.element.dataset.state = 'running'
    this.actions.replaceChildren(
      h(
        'button',
        { type: 'button', class: 'button small secondary', onclick: () => this.onCancel() },
        icon('x'),
        common('cancel'),
      ),
    )
  }

  update(progress: Progress): void {
    this.progress = progress
    if (!this.frame) this.frame = requestAnimationFrame(() => this.render())
  }

  private render(): void {
    this.frame = 0
    const p = this.progress
    if (!p || this.element.dataset.state !== 'running') return
    const now = performance.now()
    if (!this.rate || this.rate.name !== p.name || p.bytesDone < this.rate.bytes) {
      this.rate = { at: now, bytes: p.bytesDone, name: p.name, perSec: null }
    } else if (now - this.rate.at >= 1000) {
      const perSec = ((p.bytesDone - this.rate.bytes) * 1000) / (now - this.rate.at)
      this.rate = { at: now, bytes: p.bytesDone, name: p.name, perSec }
    }
    const receive = this.role === 'receive'
    const name = ltr(p.name)
    this.title.textContent = p.count
      ? t(receive ? 'receivingOf' : 'uploadingOf', { name, index: p.index, count: p.count })
      : t(receive ? 'receiving' : 'uploading', { name })
    const total = p.bytesTotal
    if (total) {
      this.bar.max = total
      this.bar.value = Math.min(p.bytesDone, total)
    } else {
      this.bar.removeAttribute('value')
    }
    const size =
      total === null
        ? formatBytes(p.bytesDone)
        : `${formatBytes(p.bytesDone)} / ${formatBytes(total)}`
    this.detail.textContent = ltr(`${size} · ${formatRate(this.rate.perSec)}`)
  }

  /** Shows the outcome; a clean result goes away by itself. */
  finish(outcome: Outcome, folder: string | null): void {
    cancelAnimationFrame(this.frame)
    this.element.dataset.state = 'over'
    this.bar.remove()
    const moved = outcome.files.filter((f) => !f.skipped)
    const skipped = outcome.files.length - moved.length
    const bytes = moved.reduce((n, f) => n + f.size, 0)
    const receive = outcome.role === 'receive'
    const summary =
      moved.length === 0
        ? ''
        : t(receive ? 'received' : 'uploaded', {
            n: moved.length,
            size: ltr(formatBytes(bytes)),
          })
    const skippedText = skipped > 0 ? t('skipped', { n: skipped }) : ''
    const clauses = [summary, skippedText].filter(Boolean).join(t('clauseSep'))
    switch (outcome.state) {
      case 'done':
        this.title.textContent =
          moved.length > 0 ? summary : t(receive ? 'noneReceived' : 'noneUploaded')
        this.detail.textContent = [
          skippedText,
          receive && folder ? t('savedIn', { folder: ltr(folder) }) : '',
        ]
          .filter(Boolean)
          .join('\n')
        break
      case 'cancelled':
        // A user cancel has no message of its own.
        this.title.textContent =
          outcome.message || t(receive ? 'receiveCancelled' : 'uploadCancelled')
        this.detail.textContent = clauses || t('nothingFinished')
        break
      default:
        this.element.dataset.tone = 'error'
        this.element.setAttribute('role', 'alert')
        this.title.textContent = t(receive ? 'receiveFailed' : 'uploadFailed')
        this.detail.textContent = [outcome.message, clauses].filter(Boolean).join('\n')
    }
    this.detail.classList.remove('num')
    const buttons: HTMLElement[] = []
    if (outcome.role === 'receive' && folder && moved.length > 0) {
      const first = moved[0].path
      buttons.push(
        h(
          'button',
          {
            type: 'button',
            class: 'button small primary',
            onclick: () =>
              void invoke('reveal_local', {
                path: moved.length === 1 && first ? first : folder,
              }).catch(() => {}),
          },
          icon('folder-open'),
          t('openFolder'),
        ),
      )
    }
    this.actions.replaceChildren(...buttons)
    this.element.append(
      h(
        'button',
        {
          type: 'button',
          class: 'icon-button terminal-banner-close',
          title: t('dismiss'),
          'aria-label': t('dismiss'),
          onclick: () => this.onClose(),
        },
        icon('x'),
      ),
    )
    if (outcome.state === 'done') {
      const arm = () => {
        clearTimeout(this.hideTimer)
        this.hideTimer = setTimeout(() => this.onClose(), RESULT_MS)
      }
      this.element.addEventListener('pointerenter', () => clearTimeout(this.hideTimer))
      this.element.addEventListener('pointerleave', arm)
      arm()
    }
  }

  dispose(): void {
    cancelAnimationFrame(this.frame)
    clearTimeout(this.hideTimer)
    this.element.remove()
  }
}

export interface TransferTarget {
  sessionId: number
  /** Where the overlay goes. */
  container: HTMLElement
  focus(): void
}

/** The overlay each terminal shows, so a new transfer replaces an old result. */
const shown = new WeakMap<HTMLElement, () => void>()

/** Starts the local side of an `sz` (we receive) or `rz` (we send) the terminal just saw. */
export function startTransfer(role: Role, target: TransferTarget): ZmodemSession {
  let folder: string | null = null
  let chain: Promise<unknown> = Promise.resolve()
  let view: TransferView | null = null
  const writeHeaders = { 'x-session': String(target.sessionId) }

  const host: ZmodemHost = {
    write: (bytes) => {
      const next = chain.then(() => invoke('session_write_bytes', bytes, { headers: writeHeaders }))
      chain = next.catch(() => {})
      return next.then(() => {})
    },
    prepare: async () => {
      const configured = settings().files.downloadDir.trim()
      if (configured) {
        folder = configured
        return true
      }
      const chosen = await open({
        directory: true,
        multiple: false,
        title: t('saveTo'),
      })
      target.focus()
      if (typeof chosen !== 'string') return false
      folder = chosen
      return true
    },
    open: async (file) => {
      if (!folder) return null
      return sink(await invoke<SaveTarget>('zmodem_save_begin', { dir: folder, name: file.name }))
    },
    pick: async () => {
      const chosen = await open({
        multiple: true,
        directory: false,
        title: t('pickFiles'),
      })
      target.focus()
      const paths = typeof chosen === 'string' ? [chosen] : (chosen ?? [])
      if (paths.length === 0) return null
      const files = await invoke<LocalFile[]>('zmodem_stat', { paths })
      return files.map(localFile)
    },
    onProgress: (progress) => view?.update(progress),
  }

  const session = role === 'receive' ? new Receiver(host) : new Sender(host)
  const close = () => {
    const hadFocus = view?.element.contains(document.activeElement) ?? false
    view?.dispose()
    view = null
    if (shown.get(target.container) === close) shown.delete(target.container)
    if (hadFocus) target.focus()
  }
  view = new TransferView(role, () => session.cancel(), close)
  const mount = () => {
    if (!view || view.element.isConnected) return
    shown.get(target.container)?.()
    shown.set(target.container, close)
    target.container.append(view.element)
  }
  // A false start must not flash an overlay.
  const reveal = setTimeout(() => {
    if (!session.ended) mount()
  }, 150)
  void session.result.then(async (outcome) => {
    clearTimeout(reveal)
    if (outcome.state === 'not-zmodem') {
      close()
      return
    }
    await session.settled()
    if (!view) return
    mount()
    view.finish(outcome, folder)
  })
  return session
}
