import { WebviewWindow } from '@tauri-apps/api/webviewWindow'
import { reportError } from '../../dom'
import { lang, messages } from '../../i18n'

import type { BuiltinPlugin } from '../api'
import { BUILTIN_VERSION } from './version'

export const GUIDE_COMMAND = 'guide.open'
const LABEL = 'plugin-guide'

const t = messages({
  guide: { zh: '插件开发指南', en: 'Plugin developer guide', ug: 'قىستۇرما ئېچىش قوللانمىسى' },
  windowTitle: {
    zh: '插件开发指南 - GladosXshell',
    en: 'Plugin developer guide - GladosXshell',
    ug: 'قىستۇرما ئېچىش قوللانمىسى - GladosXshell',
  },
  description: {
    zh: '在单独的窗口里介绍插件的结构、清单、权限和全部 API，附示例和图标列表。',
    en: 'Covers plugin structure, the manifest, permissions and the whole API in a separate window, with examples and the icon list.',
    ug: 'ئايرىم كۆزنەكتە قىستۇرمىنىڭ قۇرۇلمىسى، تىزىملىكى، ھوقۇقى ۋە بارلىق API نى تونۇشتۇرىدۇ، مىساللار ۋە سىنبەلگە تىزىملىكى بار.',
  },
  open: {
    zh: '打开插件开发指南',
    en: 'Open plugin developer guide',
    ug: 'قىستۇرما ئېچىش قوللانمىسىنى ئاچ',
  },
  help: { zh: '帮助', en: 'Help', ug: 'ياردەم' },
})

async function openGuide(): Promise<void> {
  const existing = await WebviewWindow.getByLabel(LABEL)
  if (existing) {
    await existing.unminimize()
    await existing.show()
    await existing.setFocus()
    return
  }
  const window = new WebviewWindow(LABEL, {
    url: `plugin-guide.html?lang=${lang()}`,
    title: t('windowTitle'),
    width: 1120,
    height: 800,
    minWidth: 720,
    minHeight: 520,
  })
  window.once('tauri://error', (event) => reportError(event.payload))
}

export const guidePlugin: BuiltinPlugin = {
  manifest: {
    id: 'gx.plugin-guide',
    name: t('guide'),
    version: BUILTIN_VERSION,
    description: t('description'),
  },
  activate(ctx) {
    ctx.commands.register({
      id: GUIDE_COMMAND,
      title: t('open'),
      icon: 'book-open',
      category: t('help'),
      run: openGuide,
    })
  },
}
