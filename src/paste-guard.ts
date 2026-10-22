import { button, modal } from './dialogs'
import { h } from './dom'
import { messages, pl } from './i18n'
import { common } from './i18n-common'
import { settings, updateSettings } from './settings-store'
import { pastedLines } from './terminal-text'

const t = messages({
  title: { zh: '粘贴多行文字', en: 'Paste multiple lines', ug: 'كۆپ قۇر تېكىست چاپلاش' },
  message: {
    zh: '将粘贴 {n} 行文字。shell 会把每一行当作一条命令立即执行。',
    en: (p) => `About to paste ${pl('line')(p)}. The shell runs each line as a command right away.`,
    ug: '{n} قۇر تېكىست چاپلىنىدۇ. shell ھەر بىر قۇرنى بىر بۇيرۇق سۈپىتىدە دەرھال ئىجرا قىلىدۇ.',
  },
  preview: { zh: '粘贴内容预览', en: 'Text to paste', ug: 'چاپلىنىدىغان مەزمۇن' },
  never: {
    zh: '以后不再询问（可在终端设置中重新打开）',
    en: "Don't ask again (turn it back on in terminal settings)",
    ug: 'قايتا سورىما (تېرمىنال تەڭشىكىدە قايتا ئاچقىلى بولىدۇ)',
  },
})

const PREVIEW_LINES = 12
const PREVIEW_CHARS = 2000

/** Shells in bracketed-paste mode don't run pasted lines one by one, so there's nothing to ask. */
export function pasteNeedsConfirm(text: string, bracketed: boolean): boolean {
  return !bracketed && settings().terminal.pasteConfirm && pastedLines(text) > 0
}

function preview(text: string): string {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  let shown = lines.slice(0, PREVIEW_LINES).join('\n')
  if (shown.length > PREVIEW_CHARS) shown = shown.slice(0, PREVIEW_CHARS)
  const more = lines.length > PREVIEW_LINES || shown.length < text.length
  return more ? `${shown}\n…` : shown
}

/** Shows what is about to be pasted; resolves true to paste it. */
export function confirmPaste(text: string): Promise<boolean> {
  const count = pastedLines(text)
  const parts = modal('paste-confirm', t('title'), 'md')
  const never = h('input', { type: 'checkbox' })
  parts.body.append(
    h('p', { class: 'dialog-message', text: t('message', { n: count }) }),
    h('pre', {
      class: 'paste-preview',
      tabindex: 0,
      'aria-label': t('preview'),
      text: preview(text),
    }),
    h('label', { class: 'check' }, never, t('never')),
  )
  const ok = button(common('paste'), () => parts.dialog.close('ok'), 'primary')
  parts.actions.append(
    button(common('cancel'), () => parts.dialog.close()),
    ok,
  )
  return new Promise((resolve) => {
    parts.dialog.addEventListener(
      'close',
      () => {
        const pasted = parts.dialog.returnValue === 'ok'
        parts.dialog.remove()
        if (pasted && never.checked) {
          updateSettings((d) => {
            d.terminal.pasteConfirm = false
          }).catch(() => {})
        }
        resolve(pasted)
      },
      { once: true },
    )
    parts.dialog.returnValue = ''
    parts.dialog.showModal()
    ok.focus()
  })
}
