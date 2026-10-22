import { captureUiErrors } from './applog'
import { initContextMenus } from './context-menu'
import { $, h, reportError, setStatus } from './dom'
import { fillStatic, messages } from './i18n'

import { initScale } from './scale'
import { loadSettings, loadUserCss } from './settings-store'
import { advancedView } from './status/advanced'
import { initTheme } from './theme'

const t = messages({
  title: { zh: '服务器状态', en: 'Server status', ug: 'مۇلازىمېتىر ھالىتى' },
  loading: { zh: '正在加载…', en: 'Loading…', ug: 'يۈكلىنىۋاتىدۇ…' },
  ready: { zh: '就绪', en: 'Ready', ug: 'تەييار' },
  settingsUnreadable: {
    zh: '设置文件无法读取，已使用默认设置：{error}',
    en: "Couldn't read the settings file, using the defaults: {error}",
    ug: 'تەڭشەك ھۆججىتىنى ئوقۇغىلى بولمىدى، كۆڭۈلدىكى تەڭشەك ئىشلىتىلدى: {error}',
  },
  noServer: {
    zh: '没有指定服务器，请从主窗口的「高级」按钮打开。',
    en: 'No server was given. Open this window with the Advanced button in the main window.',
    ug: 'مۇلازىمېتىر بەلگىلەنمىگەن، ئاساسىي كۆزنەكتىكى «ئالىي» كۇنۇپكىسى ئارقىلىق ئېچىڭ.',
  },
})

const report = reportError

async function start(): Promise<void> {
  fillStatic(t)
  captureUiErrors()
  initContextMenus()
  const settingsError = await loadSettings()
  if (settingsError) setStatus(t('settingsUnreadable', { error: settingsError }), 'error')
  initTheme()
  initScale(report).catch(report)
  loadUserCss().catch(report)
  const raw = new URLSearchParams(location.search).get('session')
  const sessionId = raw === null ? Number.NaN : Number(raw)
  $('status-root').replaceChildren(
    Number.isInteger(sessionId) && sessionId >= 0
      ? advancedView(sessionId, report)
      : h('p', { class: 'panel-empty', text: t('noServer') }),
  )
}

start().catch(report)
