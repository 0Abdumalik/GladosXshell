import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import { field, h, setFieldError } from './dom'
import { ltr, messages } from './i18n'
import { common } from './i18n-common'
import { namedIcon } from './icons'
import { loadShells, localShells } from './local-shells'
import { autoScaleValue } from './scale'
import { fontSettings } from './settings-fonts'
import type { Section } from './settings-layout'
import {
  type CursorStyle,
  EDITOR_FEATURES,
  type EditorSettings,
  SCALE_CHOICES,
  type TerminalSettings,
  validLocalPath,
} from './settings-model'
import { settings, updateSettings } from './settings-store'

type Report = (error: unknown) => void
type NumberKey = 'fontSize' | 'lineHeight' | 'scrollback' | 'backgroundOpacity'

const t = messages({
  cursorBlock: { zh: '方块', en: 'Block', ug: 'چاسا' },
  cursorBar: { zh: '竖线', en: 'Bar', ug: 'تىك سىزىق' },
  cursorUnderline: { zh: '下划线', en: 'Underline', ug: 'ئاستى سىزىق' },
  imageDialog: {
    zh: '选择终端背景图片',
    en: 'Choose a terminal background image',
    ug: 'تېرمىنال تەگلىك رەسىمىنى تاللاش',
  },
  imageFilter: { zh: '图片', en: 'Images', ug: 'رەسىملەر' },
  galleryLabel: { zh: '背景图片库', en: 'Background image library', ug: 'تەگلىك رەسىم ئامبىرى' },
  galleryEmpty: {
    zh: '库里还没有图片。点“添加图片…”导入一张。',
    en: 'No images in the library yet. Click “Add image…” to import one.',
    ug: 'ئامباردا تېخى رەسىم يوق. «رەسىم قوش…» نى چېكىپ بىرنى ئەكىرىڭ.',
  },
  useImage: { zh: '使用 {name}', en: 'Use {name}', ug: '{name} نى ئىشلەت' },
  removeImageTitle: { zh: '从库里删除', en: 'Delete from the library', ug: 'ئامباردىن ئۆچۈر' },
  removeImage: { zh: '删除 {name}', en: 'Delete {name}', ug: '{name} نى ئۆچۈر' },
  wholeNumber: {
    zh: '请填写 {min} 到 {max} 之间的整数',
    en: 'Enter a whole number from {min} to {max}',
    ug: '{min} بىلەن {max} ئارىلىقىدىكى پۈتۈن ساننى كىرگۈزۈڭ',
  },
  logDirPlaceholder: {
    zh: '工作目录下的 logs',
    en: 'logs in the working folder',
    ug: 'خىزمەت قىسقۇچىدىكى logs',
  },
  badPath: {
    zh: '请填写绝对路径，或留空',
    en: 'Enter an absolute path, or leave it empty',
    ug: 'مۇتلەق يولنى كىرگۈزۈڭ ياكى بوش قالدۇرۇڭ',
  },
  browse: { zh: '浏览…', en: 'Browse…', ug: 'كۆز يۈگۈرت…' },
  logDirDialog: {
    zh: '选择会话日志目录',
    en: 'Choose the session log folder',
    ug: 'ئەڭگىمە خاتىرىسى قىسقۇچىنى تاللاش',
  },
  revealLogTitle: {
    zh: '在资源管理器中显示日志目录',
    en: 'Show the log folder in File Explorer',
    ug: 'خاتىرە قىسقۇچىنى ھۆججەت باشقۇرغۇچتا كۆرسەت',
  },
  logAuto: {
    zh: '连接后自动记录每个会话的输出',
    en: 'Log the output of every session once it connects',
    ug: 'ئۇلانغاندىن كېيىن ھەر بىر ئەڭگىمەنىڭ چىقىرىشىنى ئاپتوماتىك خاتىرىلە',
  },
  logPlain: {
    zh: '去掉颜色和控制字符，只保存文字',
    en: 'Strip colors and control characters, and keep only the text',
    ug: 'رەڭ ۋە كونترول ھەرپلىرىنى چىقىرىۋېتىپ، پەقەت تېكىستنىلا ساقلا',
  },
  logDir: { zh: '日志目录', en: 'Log folder', ug: 'خاتىرە قىسقۇچى' },
  logDirHelp: {
    zh: '每个会话一个文件，名称为“标签名_日期时间.log”。也可以在终端右键菜单里单独开始或停止记录。',
    en: 'One file per session, named “tab name_date time.log”. You can also start or stop logging one session from the terminal’s right-click menu.',
    ug: 'ھەر بىر ئەڭگىمە ئۈچۈن بىر ھۆججەت، ئاتى «بەتكۈچ ئاتى_چېسلا ۋاقىت.log» بولىدۇ. تېرمىنالنىڭ ئوڭ كۇنۇپكا تىزىملىكىدىن ئايرىم باشلاشقا ياكى توختىتىشقىمۇ بولىدۇ.',
  },
  fontSize: { zh: '字号', en: 'Font size', ug: 'خەت چوڭلۇقى' },
  fontSizeHelp: {
    zh: '单位为像素，会随界面缩放一起变化。',
    en: 'In pixels; zooms along with the interface.',
    ug: 'بىرلىكى پىكسېل، كۆرۈنمە يۈز چوڭايتىشىغا ئەگىشىپ ئۆزگىرىدۇ.',
  },
  lineHeight: { zh: '行高', en: 'Line height', ug: 'قۇر ئېگىزلىكى' },
  lineHeightHelp: {
    zh: '字号的百分比，115 表示 1.15 倍。',
    en: 'Percent of the font size: 115 means 1.15 times.',
    ug: 'خەت چوڭلۇقىنىڭ پىرسەنتى، 115 بولسا 1.15 ھەسسە دېگەنلىك.',
  },
  scrollback: { zh: '回滚行数', en: 'Scrollback', ug: 'ئارقىغا سىيرىلىش قۇرى' },
  scrollbackHelp: {
    zh: '能往上翻看的历史行数。超出后最早的内容和清空标记会被丢弃。',
    en: 'Lines of history you can scroll back through. Past that, the oldest output and clear marks are dropped.',
    ug: 'يۇقىرىغا سىيرىپ كۆرگىلى بولىدىغان تارىخ قۇر سانى. ئۇنىڭدىن ئاشسا ئەڭ بۇرۇنقى مەزمۇن ۋە تازىلاش بەلگىلىرى تاشلىۋېتىلىدۇ.',
  },
  systemDefault: { zh: '系统默认', en: 'System default', ug: 'سىستېما كۆڭۈلدىكى' },
  shellMissing: { zh: '{name}（未找到）', en: '{name} (not found)', ug: '{name} (تېپىلمىدى)' },
  imageUnset: { zh: '未设置', en: 'Not set', ug: 'بەلگىلەنمىگەن' },
  clearImage: { zh: '不使用', en: 'Clear', ug: 'ئىشلەتمە' },
  clearImageTitle: {
    zh: '不显示背景图片，库里的图片保留',
    en: 'Show no background image; the image stays in the library',
    ug: 'تەگلىك رەسىم كۆرسەتمە، ئامباردىكى رەسىم ساقلىنىپ قالىدۇ',
  },
  addImage: { zh: '添加图片…', en: 'Add image…', ug: 'رەسىم قوش…' },
  localTerminal: { zh: '本地终端', en: 'Local terminal', ug: 'يەرلىك تېرمىنال' },
  defaultType: { zh: '默认类型', en: 'Default type', ug: 'كۆڭۈلدىكى تىپ' },
  defaultTypeHelp: {
    zh: '工具栏的“本地终端”按钮打开这种终端。其他类型可以在标签栏空白处右键，或在命令面板里搜索“本地终端”打开。',
    en: 'The Local terminal button on the toolbar opens this kind. Open other kinds by right-clicking an empty spot on the tab bar, or by searching the command palette for “Local terminal”.',
    ug: 'قورال بالدىقىدىكى «يەرلىك تېرمىنال» كۇنۇپكىسى مۇشۇ خىلدىكى تېرمىنالنى ئاچىدۇ. باشقا تىپلارنى بەتكۈچ بالدىقىنىڭ بوش يېرىدە ئوڭ چېكىپ ياكى بۇيرۇق تاختىسىدا «يەرلىك تېرمىنال» نى ئىزدەپ ئاچقىلى بولىدۇ.',
  },
  tabs: { zh: '标签', en: 'Tabs', ug: 'بەتكۈچلەر' },
  restoreTabs: {
    zh: '启动时重新打开上次的标签',
    en: 'Reopen the tabs from last time at startup',
    ug: 'قوزغالغاندا ئالدىنقى قېتىمقى بەتكۈچلەرنى قايتا ئاچ',
  },
  restoreTabsHelp: {
    zh: '本地终端和服务器会重新连接。“仅连接”打开的服务器不保存密码，重连时再询问。',
    en: 'Local terminals and servers reconnect. Servers opened with “Connect only” don’t save the password, so you are asked again when reconnecting.',
    ug: 'يەرلىك تېرمىنال ۋە مۇلازىمېتىرلار قايتا ئۇلىنىدۇ. «پەقەت ئۇلا» ئارقىلىق ئېچىلغان مۇلازىمېتىرلارنىڭ ئىمى ساقلانمايدۇ، قايتا ئۇلانغاندا يەنە سورايدۇ.',
  },
  text: { zh: '文字', en: 'Text', ug: 'تېكىست' },
  cursorSelection: { zh: '光标与选择', en: 'Cursor and selection', ug: 'نۇر بەلگىسى ۋە تاللاش' },
  cursorStyle: { zh: '光标样式', en: 'Cursor style', ug: 'نۇر بەلگىسى ئۇسلۇبى' },
  cursorBlink: { zh: '光标闪烁', en: 'Blinking cursor', ug: 'نۇر بەلگىسى جىمىرلاش' },
  copyOnSelect: {
    zh: '选中文字后自动复制',
    en: 'Copy text automatically on select',
    ug: 'تېكىست تاللىسىلا ئاپتوماتىك كۆچۈر',
  },
  pasteConfirm: {
    zh: '粘贴多行文字前先确认',
    en: 'Confirm before pasting multiple lines',
    ug: 'كۆپ قۇرلۇق تېكىست چاپلاشتىن بۇرۇن جەزملە',
  },
  pasteConfirmHelp: {
    zh: '多行文字粘贴到 shell 会逐行执行。程序自己处理粘贴（如 vim、开启了括号粘贴的 shell）时不询问。',
    en: 'A shell runs pasted lines one by one. You are not asked when the program handles the paste itself (such as vim, or a shell with bracketed paste on).',
    ug: 'shell غا چاپلانغان كۆپ قۇرلۇق تېكىست قۇرمۇقۇر ئىجرا قىلىنىدۇ. پروگرامما چاپلاشنى ئۆزى بىر تەرەپ قىلغاندا (مەسىلەن vim، تىرناقلىق چاپلاش ئوچۇق shell) سورىمايدۇ.',
  },
  suggestions: { zh: '输入推荐', en: 'Input suggestions', ug: 'كىرگۈزۈش تەۋسىيەسى' },
  suggestionsLabel: {
    zh: '在命令提示符后输入时显示命令、选项和路径推荐',
    en: 'Suggest commands, options and paths while typing at the prompt',
    ug: 'بۇيرۇق ئەسكەرتكۈچىدىن كېيىن كىرگۈزگەندە بۇيرۇق، تاللانما ۋە يول تەۋسىيەسىنى كۆرسەت',
  },
  suggestionsHelp: {
    zh: '↑↓ 选择，Tab 或 → 采用，Esc 关闭。全屏程序（vim、top 等）中不显示。',
    en: '↑↓ to choose, Tab or → to accept, Esc to close. Not shown in full-screen programs such as vim and top.',
    ug: '↑↓ تاللاش، Tab ياكى → قوبۇل قىلىش، Esc يېپىش. پۈتۈن ئېكرانلىق پروگراممىلاردا (vim، top قاتارلىق) كۆرۈنمەيدۇ.',
  },
  backgroundImage: { zh: '背景图片', en: 'Background image', ug: 'تەگلىك رەسىم' },
  currentImage: { zh: '当前图片', en: 'Current image', ug: 'نۆۋەتتىكى رەسىم' },
  currentImageHelp: {
    zh: '添加的图片（PNG、JPG、GIF、WebP 或 BMP，不超过 20 MB）复制到配置目录的库里，以后点缩略图就能切换。',
    en: 'Added images (PNG, JPG, GIF, WebP or BMP, up to 20 MB) are copied to a library in the config folder, so you can switch later by clicking a thumbnail.',
    ug: 'قوشۇلغان رەسىملەر (PNG، JPG، GIF، WebP ياكى BMP، 20 MB دىن ئاشمايدۇ) سەپلىمە قىسقۇچىدىكى ئامبارغا كۆچۈرۈلىدۇ، كېيىن كىچىك رەسىمنى چەكسىڭىزلا ئالماشتۇرالايسىز.',
  },
  imageOpacity: { zh: '图片浓度', en: 'Image opacity', ug: 'رەسىم قويۇقلۇقى' },
  imageOpacityHelp: {
    zh: '数值越大图片越明显，文字对比度越低。',
    en: 'Higher values make the image stronger and the text contrast lower.',
    ug: 'سان قانچە چوڭ بولسا رەسىم شۇنچە ئېنىق، تېكىست سېلىشتۇرمىسى شۇنچە تۆۋەن بولىدۇ.',
  },
  zmodem: { zh: 'rz / sz 文件传输', en: 'rz / sz file transfer', ug: 'rz / sz ھۆججەت يوللاش' },
  zmodemLabel: {
    zh: '在终端里运行 rz 或 sz 时直接收发文件',
    en: 'Send and receive files when rz or sz runs in the terminal',
    ug: 'تېرمىنالدا rz ياكى sz ئىجرا قىلىنغاندا ھۆججەتنى بىۋاسىتە تاپشۇرۇۋال ۋە يوللا',
  },
  zmodemHelp: {
    zh: 'sz 发来的文件存到“文件”设置中的默认下载位置，没有设置时每次询问。rz 会让你选择要上传的文件。传输中按 Ctrl+C 取消。服务器需要安装 lrzsz。',
    en: 'Files sent by sz go to the default download folder in “Files and editing”, or you are asked each time if none is set. rz lets you choose the files to upload. Press Ctrl+C to cancel a transfer. The server needs lrzsz installed.',
    ug: 'sz يوللىغان ھۆججەتلەر «ھۆججەت ۋە تەھرىرلەش» تەڭشىكىدىكى كۆڭۈلدىكى چۈشۈرۈش قىسقۇچىغا ساقلىنىدۇ، بەلگىلەنمىگەن بولسا ھەر قېتىم سورايدۇ. rz يۈكلەيدىغان ھۆججەتلەرنى تاللىتىدۇ. يوللاش جەريانىدا Ctrl+C نى بېسىپ ۋاز كېچىڭ. مۇلازىمېتىرغا lrzsz ئورنىتىلغان بولۇشى كېرەك.',
  },
  sessionLogs: { zh: '会话日志', en: 'Session logs', ug: 'ئەڭگىمە خاتىرىسى' },
  features: { zh: '功能', en: 'Features', ug: 'ئىقتىدارلار' },
  featuresHelp: {
    zh: '内置编辑器和指令编辑器共用这些开关，编辑器工具栏的“功能”菜单里也能切换。',
    en: 'The built-in editor and the command editor share these switches. You can also toggle them from the Features menu on the editor toolbar.',
    ug: 'ئىچكى تەھرىرلىگۈچ بىلەن بۇيرۇق تەھرىرلىگۈچى بۇ ئالماشتۇرغۇچلارنى ئورتاق ئىشلىتىدۇ، تەھرىرلىگۈچ قورال بالدىقىدىكى «ئىقتىدارلار» تىزىملىكىدىنمۇ ئالماشتۇرغىلى بولىدۇ.',
  },
  indent: { zh: '缩进', en: 'Indentation', ug: 'تارتىلىش' },
  tabSize: { zh: '制表符宽度', en: 'Tab size', ug: 'Tab كەڭلىكى' },
  tabSizeHelp: {
    zh: '制表符占的列数。打开文件时会按内容判断用空格还是制表符缩进，判断不出时使用这个宽度。',
    en: 'Columns per tab. Opening a file detects whether it is indented with spaces or tabs; this width is used when that can’t be told.',
    ug: 'بىر Tab ئىگىلەيدىغان ئىستون سانى. ھۆججەت ئېچىلغاندا مەزمۇنىغا قاراپ بوشلۇق ياكى Tab بىلەن تارتىلغانلىقى پەرقلەندۈرۈلىدۇ، پەرقلەندۈرگىلى بولمىسا بۇ كەڭلىك ئىشلىتىلىدۇ.',
  },
  editor: { zh: '编辑器', en: 'Editor', ug: 'تەھرىرلىگۈچ' },
  uiScale: { zh: '界面缩放', en: 'Interface zoom', ug: 'كۆرۈنمە يۈز چوڭايتىش' },
  uiScaleHelp: {
    zh: '整个窗口（包括终端文字）一起缩放。自动会按显示器的可用尺寸挑选。',
    en: 'Zooms the whole window, terminal text included. Auto picks a zoom from the monitor’s usable size.',
    ug: 'پۈتۈن كۆزنەك (تېرمىنال تېكىستىنىمۇ ئۆز ئىچىگە ئالىدۇ) بىللە چوڭىيىدۇ. ئاپتوماتىك بولسا ئېكراننىڭ ئىشلىتىشكە بولىدىغان چوڭلۇقىغا قاراپ تاللايدۇ.',
  },
  scaleAuto: {
    zh: '自动（当前 {n}%）',
    en: 'Auto (currently {n}%)',
    ug: 'ئاپتوماتىك (ھازىر {n}%)',
  },
})

const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp']
const CURSORS: [CursorStyle, string][] = [
  ['block', t('cursorBlock')],
  ['bar', t('cursorBar')],
  ['underline', t('cursorUnderline')],
]

function setTerminal(change: (t: TerminalSettings) => void, report: Report): void {
  updateSettings((d) => change(d.terminal)).catch(report)
}

interface LibraryImage {
  path: string
  name: string
  size: number
}

const libraryListeners = new Set<() => void>()

/** Asks for an image, copies it into the background library and makes it the terminal background. */
export async function pickBackgroundImage(report: Report): Promise<void> {
  const chosen = await open({
    multiple: false,
    directory: false,
    title: t('imageDialog'),
    filters: [{ name: t('imageFilter'), extensions: IMAGE_EXTENSIONS }],
  })
  if (typeof chosen !== 'string') return
  const stored = await invoke<LibraryImage>('background_import', { path: chosen })
  for (const listener of libraryListeners) listener()
  setTerminal((t) => {
    t.backgroundImage = stored.path
  }, report)
}

/** Thumbnails of every imported background; a click selects one. */
function backgroundGallery(report: Report) {
  const list = h('ul', { class: 'bg-gallery', 'aria-label': t('galleryLabel') })
  const urls = new Map<string, string>()
  let images: LibraryImage[] = []

  const thumb = (image: LibraryImage) => {
    const img = h('img', { alt: '', loading: 'lazy', decoding: 'async' })
    const cached = urls.get(image.path)
    if (cached) img.src = cached
    else {
      invoke<ArrayBuffer>('local_image', { path: image.path })
        .then((bytes) => {
          const url = URL.createObjectURL(new Blob([bytes]))
          urls.set(image.path, url)
          img.src = url
        })
        .catch(() => img.classList.add('broken'))
    }
    return img
  }

  const render = () => {
    const current = settings().terminal.backgroundImage
    if (images.length === 0) {
      list.replaceChildren(h('li', { class: 'help bg-empty', text: t('galleryEmpty') }))
      return
    }
    list.replaceChildren(
      ...images.map((image) =>
        h(
          'li',
          { class: 'bg-item' },
          h(
            'button',
            {
              type: 'button',
              class: 'bg-pick',
              title: image.name,
              'aria-label': t('useImage', { name: ltr(image.name) }),
              'aria-pressed': String(image.path === current),
              onclick: () =>
                setTerminal((t) => {
                  t.backgroundImage = image.path
                }, report),
            },
            thumb(image),
          ),
          h(
            'button',
            {
              type: 'button',
              class: 'icon-button bg-remove',
              title: t('removeImageTitle'),
              'aria-label': t('removeImage', { name: ltr(image.name) }),
              onclick: () => void remove(image).catch(report),
            },
            namedIcon('trash'),
          ),
        ),
      ),
    )
  }

  const load = async () => {
    images = await invoke<LibraryImage[]>('background_list')
    for (const [path, url] of urls) {
      if (images.some((i) => i.path === path)) continue
      URL.revokeObjectURL(url)
      urls.delete(path)
    }
    render()
  }

  const remove = async (image: LibraryImage) => {
    await invoke('background_remove', { path: image.path })
    if (settings().terminal.backgroundImage === image.path) {
      await updateSettings((d) => {
        d.terminal.backgroundImage = ''
      })
    }
    await load()
  }

  const reload = () => void load().catch(report)
  libraryListeners.add(reload)
  reload()
  return {
    element: list,
    refresh: render,
    dispose: () => {
      libraryListeners.delete(reload)
      for (const url of urls.values()) URL.revokeObjectURL(url)
      urls.clear()
    },
  }
}

function numberField(
  key: NumberKey,
  label: string,
  [min, max]: [number, number],
  help: string,
  report: Report,
): { element: HTMLElement; refresh: () => void } {
  const input = h('input', { type: 'number', min, max, step: 1, inputmode: 'numeric' })
  input.addEventListener('change', () => {
    const value = Number(input.value)
    if (!Number.isInteger(value) || value < min || value > max) {
      setFieldError(input, t('wholeNumber', { min, max }))
      return
    }
    setFieldError(input, '')
    if (value !== settings().terminal[key]) {
      setTerminal((t) => {
        t[key] = value
      }, report)
    }
  })
  return {
    element: field(label, input, help),
    refresh: () => {
      if (document.activeElement !== input) input.value = String(settings().terminal[key])
    },
  }
}

function logSettings(report: Report): { element: HTMLElement[]; refresh: () => void } {
  const auto = h('input', { type: 'checkbox' })
  auto.addEventListener('change', () =>
    setTerminal((t) => {
      t.log.auto = auto.checked
    }, report),
  )
  const plain = h('input', { type: 'checkbox' })
  plain.addEventListener('change', () =>
    setTerminal((t) => {
      t.log.plain = plain.checked
    }, report),
  )
  const dir = h('input', {
    type: 'text',
    spellcheck: 'false',
    autocomplete: 'off',
    placeholder: t('logDirPlaceholder'),
  })
  const commit = () => {
    const value = dir.value.trim()
    if (!validLocalPath(value)) {
      setFieldError(dir, t('badPath'))
      return
    }
    setFieldError(dir, '')
    if (value === settings().terminal.log.dir) return
    setTerminal((t) => {
      t.log.dir = value
    }, report)
  }
  dir.addEventListener('change', commit)
  const buttons = h(
    'span',
    { class: 'field-buttons' },
    h('button', {
      type: 'button',
      class: 'button',
      text: t('browse'),
      onclick: async () => {
        const chosen = await open({
          directory: true,
          multiple: false,
          title: t('logDirDialog'),
          defaultPath: dir.value.trim() || undefined,
        })
        if (typeof chosen === 'string') {
          dir.value = chosen
          commit()
        }
      },
    }),
    h('button', {
      type: 'button',
      class: 'button quiet',
      text: common('open'),
      title: t('revealLogTitle'),
      onclick: () =>
        void invoke<string>('session_log_dir')
          .then((path) => invoke('reveal_local', { path }))
          .catch(report),
    }),
  )
  return {
    element: [
      h('label', { class: 'check' }, auto, t('logAuto')),
      h('label', { class: 'check' }, plain, t('logPlain')),
      field(t('logDir'), dir, t('logDirHelp'), buttons),
    ],
    refresh: () => {
      const l = settings().terminal.log
      auto.checked = l.auto
      plain.checked = l.plain
      if (document.activeElement !== dir) dir.value = l.dir
    },
  }
}

export function terminalSection(report: Report): Section {
  const fonts = fontSettings(report)
  const gallery = backgroundGallery(report)
  const numbers = [
    numberField('fontSize', t('fontSize'), [8, 40], t('fontSizeHelp'), report),
    numberField('lineHeight', t('lineHeight'), [100, 200], t('lineHeightHelp'), report),
    numberField('scrollback', t('scrollback'), [500, 200000], t('scrollbackHelp'), report),
  ]
  const cursors = CURSORS.map(([value]) => {
    const radio = h('input', { type: 'radio', name: 'set-cursor', value })
    radio.addEventListener('change', () =>
      setTerminal((t) => {
        t.cursorStyle = value
      }, report),
    )
    return radio
  })
  const blink = h('input', { type: 'checkbox' })
  blink.addEventListener('change', () =>
    setTerminal((t) => {
      t.cursorBlink = blink.checked
    }, report),
  )
  const copyOnSelect = h('input', { type: 'checkbox' })
  copyOnSelect.addEventListener('change', () =>
    setTerminal((t) => {
      t.copyOnSelect = copyOnSelect.checked
    }, report),
  )
  const suggestions = h('input', { type: 'checkbox' })
  suggestions.addEventListener('change', () =>
    setTerminal((t) => {
      t.suggestions = suggestions.checked
    }, report),
  )
  const pasteConfirm = h('input', { type: 'checkbox' })
  pasteConfirm.addEventListener('change', () =>
    setTerminal((t) => {
      t.pasteConfirm = pasteConfirm.checked
    }, report),
  )
  const zmodem = h('input', { type: 'checkbox' })
  zmodem.addEventListener('change', () =>
    setTerminal((t) => {
      t.zmodem = zmodem.checked
    }, report),
  )
  const log = logSettings(report)
  const restore = h('input', { type: 'checkbox' })
  restore.addEventListener('change', () =>
    setTerminal((t) => {
      t.restoreTabs = restore.checked
    }, report),
  )

  const shell = h('select', { id: 'set-default-shell' })
  shell.addEventListener('change', () =>
    setTerminal((t) => {
      t.defaultShell = shell.value
    }, report),
  )
  const fillShells = () => {
    const current = settings().terminal.defaultShell
    const found = localShells()
    const options = [
      h('option', { value: '', text: t('systemDefault'), selected: current === '' }),
      ...found.map((s) =>
        h('option', { value: s.id, text: s.name, title: s.program, selected: s.id === current }),
      ),
    ]
    if (current && !found.some((s) => s.id === current)) {
      options.push(
        h('option', {
          value: current,
          text: t('shellMissing', { name: ltr(current) }),
          selected: true,
        }),
      )
    }
    shell.replaceChildren(...options)
  }
  void loadShells().then(fillShells)

  const image = h('input', {
    type: 'text',
    readonly: true,
    placeholder: t('imageUnset'),
    'aria-readonly': 'true',
  })
  const clearImage = h('button', {
    type: 'button',
    class: 'button quiet',
    text: t('clearImage'),
    title: t('clearImageTitle'),
    onclick: () =>
      setTerminal((t) => {
        t.backgroundImage = ''
      }, report),
  })
  const imageButtons = h(
    'span',
    { class: 'field-buttons' },
    h('button', {
      type: 'button',
      class: 'button',
      text: t('addImage'),
      onclick: () => void pickBackgroundImage(report).catch(report),
    }),
    clearImage,
  )
  const opacity = h('input', { type: 'range', min: 5, max: 100, step: 5 })
  const opacityValue = h('output', { class: 'num' })
  opacity.addEventListener('input', () => {
    opacityValue.textContent = `${opacity.value}%`
  })
  opacity.addEventListener('change', () =>
    setTerminal((t) => {
      t.backgroundOpacity = Number(opacity.value)
    }, report),
  )

  const refresh = () => {
    const t = settings().terminal
    fonts.refresh()
    gallery.refresh()
    for (const n of numbers) n.refresh()
    for (const radio of cursors) radio.checked = radio.value === t.cursorStyle
    blink.checked = t.cursorBlink
    copyOnSelect.checked = t.copyOnSelect
    suggestions.checked = t.suggestions
    pasteConfirm.checked = t.pasteConfirm
    zmodem.checked = t.zmodem
    restore.checked = t.restoreTabs
    fillShells()
    log.refresh()
    image.value = t.backgroundImage
    image.title = t.backgroundImage
    clearImage.disabled = !t.backgroundImage
    opacity.value = String(t.backgroundOpacity)
    opacityValue.textContent = `${t.backgroundOpacity}%`
  }

  const element = h(
    'div',
    { class: 'settings-section' },
    h('h3', { text: t('localTerminal') }),
    field(t('defaultType'), shell, t('defaultTypeHelp')),
    h('h3', { text: t('tabs') }),
    h('label', { class: 'check' }, restore, t('restoreTabs')),
    h('p', { class: 'help', text: t('restoreTabsHelp') }),
    h('h3', { text: t('text') }),
    fonts.element,
    numbers.map((n) => n.element),
    h('h3', { text: t('cursorSelection') }),
    h(
      'fieldset',
      { class: 'choice-group' },
      h('legend', { class: 'visually-hidden', text: t('cursorStyle') }),
      CURSORS.map(([, label], i) => h('label', { class: 'check' }, cursors[i], label)),
    ),
    h('label', { class: 'check' }, blink, t('cursorBlink')),
    h('label', { class: 'check' }, copyOnSelect, t('copyOnSelect')),
    h('label', { class: 'check' }, pasteConfirm, t('pasteConfirm')),
    h('p', { class: 'help', text: t('pasteConfirmHelp') }),
    h('h3', { text: t('suggestions') }),
    h('label', { class: 'check' }, suggestions, t('suggestionsLabel')),
    h('p', { class: 'help', text: t('suggestionsHelp') }),
    h('h3', { text: t('backgroundImage') }),
    field(t('currentImage'), image, t('currentImageHelp'), imageButtons),
    gallery.element,
    h(
      'div',
      { class: 'field' },
      h('label', { for: 'set-bg-opacity', text: t('imageOpacity') }),
      h('div', { class: 'field-inline' }, opacity, opacityValue),
      h('p', { class: 'help', text: t('imageOpacityHelp') }),
    ),
    h('h3', { text: t('zmodem') }),
    h('label', { class: 'check' }, zmodem, t('zmodemLabel')),
    h('p', { class: 'help', text: t('zmodemHelp') }),
    h('h3', { text: t('sessionLogs') }),
    log.element,
  )
  opacity.id = 'set-bg-opacity'
  refresh()
  return {
    id: 'terminal',
    label: common('terminal'),
    element,
    refresh,
    dispose: () => {
      fonts.dispose()
      gallery.dispose()
    },
  }
}

function setEditor(change: (e: EditorSettings) => void, report: Report): void {
  updateSettings((d) => change(d.editor)).catch(report)
}

/** The built-in editors' optional features; open editors follow a change at once. */
export function editorSection(report: Report): Section {
  const switches = EDITOR_FEATURES.map((feature) => {
    const box = h('input', { type: 'checkbox' })
    box.addEventListener('change', () =>
      setEditor((e) => {
        e[feature.id] = box.checked
      }, report),
    )
    return { feature, box }
  })
  const tabSize = h('input', { type: 'number', min: 1, max: 8, step: 1, inputmode: 'numeric' })
  tabSize.addEventListener('change', () => {
    const value = Number(tabSize.value)
    if (!Number.isInteger(value) || value < 1 || value > 8) {
      setFieldError(tabSize, t('wholeNumber', { min: 1, max: 8 }))
      return
    }
    setFieldError(tabSize, '')
    setEditor((e) => {
      e.tabSize = value
    }, report)
  })
  const refresh = () => {
    const e = settings().editor
    for (const { feature, box } of switches) box.checked = e[feature.id]
    if (document.activeElement !== tabSize) tabSize.value = String(e.tabSize)
  }
  const element = h(
    'div',
    { class: 'settings-section' },
    h('h3', { text: t('features') }),
    h('p', { class: 'help', text: t('featuresHelp') }),
    switches.map(({ feature, box }) =>
      h(
        'label',
        { class: 'check' },
        box,
        h('span', { text: feature.name }),
        h('span', { class: 'help', text: feature.description }),
      ),
    ),
    h('h3', { text: t('indent') }),
    field(t('tabSize'), tabSize, t('tabSizeHelp')),
  )
  refresh()
  return { id: 'editor', label: t('editor'), element, refresh }
}

export function scaleField(report: Report): { element: HTMLElement; refresh: () => void } {
  const select = h('select')
  select.addEventListener('change', () =>
    updateSettings((d) => {
      d.ui.scale = Number(select.value)
    }).catch(report),
  )
  return {
    element: field(t('uiScale'), select, t('uiScaleHelp')),
    refresh: () => {
      const current = settings().ui.scale
      const choices: number[] = [...SCALE_CHOICES]
      if (!choices.includes(current)) choices.push(current)
      select.replaceChildren(
        ...choices.map((value) =>
          h('option', {
            value,
            text: value === 0 ? t('scaleAuto', { n: autoScaleValue() }) : `${value}%`,
            selected: value === current,
          }),
        ),
      )
    },
  }
}
