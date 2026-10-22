import { writeText } from '@tauri-apps/plugin-clipboard-manager'
import diskMain from '../examples/plugins/disk-alert/main.js?raw'
import diskManifest from '../examples/plugins/disk-alert/plugin.json?raw'
import helloMain from '../examples/plugins/hello/main.js?raw'
import helloPanelCss from '../examples/plugins/hello/panel.css?raw'
import helloPanel from '../examples/plugins/hello/panel.html?raw'
import helloPanelJs from '../examples/plugins/hello/panel.js?raw'
import helloManifest from '../examples/plugins/hello/plugin.json?raw'
import gxTypes from '../sdk/gx.d.ts?raw'
import { captureUiErrors } from './applog'
import { initContextMenus } from './context-menu'
import { $, h, reportError, setStatus } from './dom'
import { fillStatic, inLang, joinList, messages, pl } from './i18n'
import { common } from './i18n-common'
import { iconNames, namedIcon } from './icons'
import {
  API_GROUPS,
  CONTRIBUTES,
  type L,
  MANIFEST_FIELDS,
  MENU_CONTEXT,
  PANEL_CSS,
  PANEL_PAGE,
  QUICK_MAIN,
  QUICK_MANIFEST,
} from './plugin-guide-content'
import { MENU_PLACES, PERMISSION_TEXT, THEME_TOKENS } from './plugins/external-model'

import { initScale } from './scale'
import { loadSettings, loadUserCss } from './settings-store'
import { initTheme } from './theme'

// The window's chrome and the guide prose. Backticked spans in the prose become inline code (see
// `rich`); the reference tables live in plugin-guide-content.ts.
const t = messages({
  title: { zh: '插件开发指南', en: 'Plugin developer guide', ug: 'قىستۇرما ئېچىش قوللانمىسى' },
  contents: { zh: '目录', en: 'Contents', ug: 'مۇندەرىجە' },
  loading: { zh: '正在加载…', en: 'Loading…', ug: 'يۈكلىنىۋاتىدۇ…' },
  ready: { zh: '就绪', en: 'Ready', ug: 'تەييار' },
  settingsError: {
    zh: '设置文件无法读取，已使用默认设置：{error}',
    en: "Couldn't read the settings file, using the defaults: {error}",
    ug: 'تەڭشەك ھۆججىتىنى ئوقۇغىلى بولمىدى، كۆڭۈلدىكى تەڭشەك ئىشلىتىلدى: {error}',
  },
  copied: { zh: '已复制 {name}', en: 'Copied {name}', ug: '{name} كۆچۈرۈلدى' },
  copiedName: { zh: '已复制：{name}', en: 'Copied: {name}', ug: 'كۆچۈرۈلدى: {name}' },
  copyNamed: { zh: '复制 {name}', en: 'Copy {name}', ug: '{name} نى كۆچۈر' },
  overview: { zh: '概览', en: 'Overview', ug: 'ئومۇمىي چۈشەنچە' },
  quickStart: { zh: '快速上手', en: 'Quick start', ug: 'تېز باشلاش' },
  structure: { zh: '目录结构', en: 'Folder structure', ug: 'مۇندەرىجە قۇرۇلمىسى' },
  manifest: { zh: '清单 plugin.json', en: 'Manifest: plugin.json', ug: 'تىزىملىك: plugin.json' },
  contributes: { zh: '贡献点', en: 'Contribution points', ug: 'تۆھپە نۇقتىلىرى' },
  menus: { zh: '菜单位置', en: 'Menu locations', ug: 'تىزىملىك ئورۇنلىرى' },
  api: { zh: 'API 参考', en: 'API reference', ug: 'API قوللانمىسى' },
  panels: { zh: '面板页', en: 'Panel pages', ug: 'تاختا سەھىپىلىرى' },
  security: { zh: '安全与限制', en: 'Security and limits', ug: 'بىخەتەرلىك ۋە چەكلىمىلەر' },
  packaging: { zh: '打包与安装', en: 'Packaging and installing', ug: 'بوغچىلاش ۋە ئورنىتىش' },
  examples: { zh: '示例', en: 'Examples', ug: 'مىساللار' },
  icons: { zh: '图标', en: 'Icons', ug: 'سىنبەلگىلەر' },
  treeManifest: { zh: '清单，必需', en: 'manifest, required', ug: 'تىزىملىك، زۆرۈر' },
  treeMain: {
    zh: '后台页脚本，可选',
    en: 'background page script, optional',
    ug: 'ئارقا سەھىپە قوليازمىسى، ئىختىيارىي',
  },
  treePanel: {
    zh: '面板页，可选',
    en: 'panel page, optional',
    ug: 'تاختا سەھىپىسى، ئىختىيارىي',
  },
  manifestTable: { zh: 'plugin.json 字段', en: 'plugin.json fields', ug: 'plugin.json بۆلەكلىرى' },
  field: { zh: '字段', en: 'Field', ug: 'بۆلەك' },
  required: { zh: '必需', en: 'Required', ug: 'زۆرۈر' },
  description: { zh: '说明', en: 'Description', ug: 'چۈشەندۈرۈش' },
  yes: { zh: '是', en: 'Yes', ug: 'ھەئە' },
  meaning: { zh: '含义', en: 'Meaning', ug: 'مەنىسى' },
  relatedApis: { zh: '相关 API', en: 'Related APIs', ug: 'مۇناسىۋەتلىك API' },
  place: { zh: '位置', en: 'Location', ug: 'ئورنى' },
  appearsIn: { zh: '出现在', en: 'Appears in', ug: 'كۆرۈنىدىغان جاي' },
  contextFields: { zh: '上下文字段', en: 'Context fields', ug: 'كونتېكىست بۆلەكلىرى' },
  sampleLines: { zh: '行', en: 'lines', ug: 'قۇر' },
  neededPermission: { zh: '需要的权限', en: 'Required permission', ug: 'كېرەكلىك ھوقۇق' },
  typeDeclarations: { zh: '类型声明', en: 'Type declarations', ug: 'تىپ ئېلانى' },
  themeTokens: { zh: '主题变量', en: 'Theme variables', ug: 'ئۆرنەك ئۆزگەرگۈچىلىرى' },
  limits: { zh: '限制', en: 'Limits', ug: 'چەكلىمىلەر' },
  item: { zh: '项目', en: 'Item', ug: 'تۈر' },
  limit: { zh: '上限', en: 'Limit', ug: 'يۇقىرى چېكى' },
  searchIconPlaceholder: { zh: '搜索图标名', en: 'Search icon names', ug: 'سىنبەلگە ئاتى ئىزدە' },
  searchIcons: { zh: '搜索图标', en: 'Search icons', ug: 'سىنبەلگە ئىزدە' },
  builtinIcons: { zh: '内置图标', en: 'Built-in icons', ug: 'ئىچكى سىنبەلگىلەر' },
  found: { zh: '找到 {n} 个', en: (p) => `Found ${pl('icon')(p)}`, ug: '{n} تېپىلدى' },
  iconCount: {
    zh: '共 {n} 个内置图标，点击复制名字。',
    en: (p) => `${pl('built-in icon')(p)}. Click one to copy its name.`,
    ug: 'جەمئىي {n} ئىچكى سىنبەلگە، چەكسىڭىز ئاتى كۆچۈرۈلىدۇ.',
  },
  lead: {
    zh: '用 JavaScript 给 GladosXshell 添加功能。下面从一个最小的插件开始，再逐项介绍清单、权限和全部 API。',
    en: 'Add features to GladosXshell with JavaScript. This guide starts with a minimal plugin, then covers the manifest, permissions and the full API.',
    ug: 'JavaScript ئارقىلىق GladosXshell غا ئىقتىدار قوشۇڭ. تۆۋەندە ئەڭ ئاددىي بىر قىستۇرمىدىن باشلاپ، تىزىملىك، ھوقۇق ۋە بارلىق API لارنى بىر-بىرلەپ تونۇشتۇرىمىز.',
  },
  overviewWhat: {
    zh: '插件可以给应用添加命令、右键菜单、快捷键、面板、状态栏条目、设置项、主题、补全数据、命令片段和终端高亮。经用户授权后，还能读写终端、在 SSH 服务器上执行命令、读写服务器文件、访问指定的网络地址。',
    en: "Plugins can add commands, context menu items, keybindings, panels, status bar items, settings, themes, completion data, command snippets and terminal highlights. With the user's permission they can also read and write the terminal, run commands on SSH servers, read and write server files, and reach specific network addresses.",
    ug: 'قىستۇرمىلار ئەپكە بۇيرۇق، ئوڭ كۇنۇپكا تىزىملىكى، تېزلەتمە كۇنۇپكا، تاختا، ھالەت بالدىقى تۈرى، تەڭشەك تۈرى، ئۆرنەك، تولۇقلاش سانلىق مەلۇماتى، بۇيرۇق پارچىسى ۋە تېرمىنال گەۋدىلەندۈرۈشى قوشالايدۇ. ئىشلەتكۈچى رۇخسەت قىلغاندىن كېيىن، تېرمىنالنى ئوقۇپ-يازالايدۇ، SSH مۇلازىمېتىرىدا بۇيرۇق ئىجرا قىلالايدۇ، مۇلازىمېتىر ھۆججەتلىرىنى ئوقۇپ-يازالايدۇ ۋە بەلگىلەنگەن تور ئادرېسلىرىنى زىيارەت قىلالايدۇ.',
  },
  overviewBuiltin: {
    zh: '应用自带的功能也是插件，在“设置 → 插件 → 内置插件”里可以逐个停用。第三方插件和内置插件用的是同一套接口，区别是第三方插件运行在沙箱里，只能通过全局对象 `gx` 和应用打交道。',
    en: "The app's own features are plugins too, and you can disable them one by one under Settings → Plugins → Built-in plugins. Third-party plugins use the same API as built-in ones. The difference is that third-party plugins run in a sandbox and talk to the app only through the global `gx` object.",
    ug: 'ئەپنىڭ ئۆزىدىكى ئىقتىدارلارمۇ قىستۇرما بولۇپ، «تەڭشەك ← قىستۇرما ← ئىچكى قىستۇرمىلار» دا ئۇلارنى بىر-بىرلەپ چەكلىگىلى بولىدۇ. ئۈچىنچى تەرەپ قىستۇرمىلىرى بىلەن ئىچكى قىستۇرمىلار ئوخشاش ئارايۈزنى ئىشلىتىدۇ، پەرقى شۇكى، ئۈچىنچى تەرەپ قىستۇرمىلىرى قۇم ساندۇقىدا ئىجرا بولىدۇ ۋە پەقەت `gx` ئومۇمىي دائىرىلىك ئوبيېكتى ئارقىلىقلا ئەپ بىلەن ئالاقە قىلالايدۇ.',
  },
  kindManifest: {
    zh: '只用清单的插件：主题、补全、片段、高亮、图标这类数据写进 `plugin.json` 就能生效，不需要脚本。',
    en: 'Manifest-only plugins: data such as themes, completions, snippets, highlights and icons takes effect as soon as it is in `plugin.json`, with no script.',
    ug: 'پەقەت تىزىملىكلا بار قىستۇرما: ئۆرنەك، تولۇقلاش، پارچە، گەۋدىلەندۈرۈش، سىنبەلگە قاتارلىق سانلىق مەلۇماتلار `plugin.json` غا يېزىلسىلا كۈچكە ئىگە بولىدۇ، قوليازما كېرەك ئەمەس.',
  },
  kindScript: {
    zh: '带脚本的插件：清单里写 `main`，在后台页里注册命令、监听事件、调用 API。',
    en: 'Plugins with a script: set `main` in the manifest, then register commands, listen for events and call APIs in the background page.',
    ug: 'قوليازمىلىق قىستۇرما: تىزىملىككە `main` يېزىلىدۇ، ئارقا سەھىپىدە بۇيرۇق تىزىملىتىپ، ھادىسىلەرنى تىڭشاپ، API چاقىرىدۇ.',
  },
  kindPanel: {
    zh: '带面板的插件：再加一个 HTML 页面，显示在左、右或底部的停靠区。',
    en: 'Plugins with a panel: add an HTML page as well, shown in the left, right or bottom dock.',
    ug: 'تاختىلىق قىستۇرما: يەنە بىر HTML بەت قوشۇلىدۇ، ئۇ سول، ئوڭ ياكى ئاستىدىكى توختىتىش رايونىدا كۆرۈنىدۇ.',
  },
  overviewLocales: {
    zh: '清单里的文字可以用 `locales` 字段翻译成应用的各种界面语言，见“清单 plugin.json”一节；脚本运行时生成的文字按 `gx.lang` 选择语言。',
    en: 'The `locales` field translates the text in a manifest into each interface language of the app (see “Manifest: plugin.json”). Text a script produces at runtime picks its language from `gx.lang`.',
    ug: 'تىزىملىكتىكى تېكىستلەرنى `locales` بۆلىكى ئارقىلىق ئەپنىڭ ھەرقايسى ئارايۈز تىللىرىغا تەرجىمە قىلغىلى بولىدۇ («تىزىملىك: plugin.json» بۆلىكىگە قاراڭ)؛ قوليازما ئىجرا ۋاقتىدا ھاسىل قىلغان تېكىست تىلنى `gx.lang` دىن ئالىدۇ.',
  },
  stepOpen: {
    zh: '打开“设置 → 插件”，点“打开插件目录”。',
    en: 'Open Settings → Plugins and click “Open plugins folder”.',
    ug: '«تەڭشەك ← قىستۇرما» نى ئېچىپ، «قىستۇرما قىسقۇچىنى ئاچ» نى چېكىڭ.',
  },
  stepFolder: {
    zh: '新建文件夹 `me.hello`。文件夹名必须和清单里的 `id` 相同。',
    en: 'Create a folder named `me.hello`. The folder name must match the `id` in the manifest.',
    ug: '`me.hello` ناملىق قىسقۇچ قۇرۇڭ. قىسقۇچ ئاتى تىزىملىكتىكى `id` بىلەن ئوخشاش بولۇشى كېرەك.',
  },
  stepFiles: {
    zh: '把下面两个文件放进去。',
    en: 'Put the two files below in it.',
    ug: 'تۆۋەندىكى ئىككى ھۆججەتنى ئۇنىڭ ئىچىگە قويۇڭ.',
  },
  stepReload: {
    zh: '回到插件列表点“重新加载”，然后按 Ctrl+Alt+H，或者在命令面板（Ctrl+Shift+P）里搜索“说你好”。',
    en: 'Back in the plugin list, click “Reload”, then press Ctrl+Alt+H or search the command palette (Ctrl+Shift+P) for “Say hello”.',
    ug: 'قىستۇرمىلار تىزىملىكىگە قايتىپ «قايتا يۈكلە» نى چېكىڭ، ئاندىن Ctrl+Alt+H نى بېسىڭ ياكى بۇيرۇق تاختىسىدا (Ctrl+Shift+P) «سالام بەر» نى ئىزدەڭ.',
  },
  reloadHint: {
    zh: '改了插件文件以后点“重新加载”即可生效。脚本出错时插件会在列表里标红，错误详情写在“通用日志”里（命令面板搜索“日志”）。',
    en: 'After changing plugin files, click “Reload” to apply them. When a script fails, the plugin turns red in the list and the details go to the App log (search the command palette for “log”).',
    ug: 'قىستۇرما ھۆججەتلىرىنى ئۆزگەرتكەندىن كېيىن «قايتا يۈكلە» نى چەكسىڭىز كۈچكە ئىگە بولىدۇ. قوليازمىدا خاتالىق كۆرۈلسە قىستۇرما تىزىملىكتە قىزىل رەڭدە كۆرسىتىلىدۇ، خاتالىق تەپسىلاتى «ئومۇمىي خاتىرە» گە يېزىلىدۇ (بۇيرۇق تاختىسىدا «خاتىرە» نى ئىزدەڭ).',
  },
  structureBackground: {
    zh: '后台页是一个看不见的页面，应用为它生成 HTML，先加载 SDK 再加载 `main` 指向的脚本。面板页是插件自己写的 HTML。',
    en: 'The background page is an invisible page. The app generates its HTML, which loads the SDK first and then the script that `main` points to. Panel pages are HTML that the plugin writes itself.',
    ug: 'ئارقا سەھىپە كۆرۈنمەيدىغان بىر بەت، ئۇنىڭ HTML نى ئەپ ھاسىل قىلىدۇ، ئالدى بىلەن SDK نى، ئاندىن `main` كۆرسەتكەن قوليازمىنى يۈكلەيدۇ. تاختا سەھىپىسى بولسا قىستۇرمىنىڭ ئۆزى يازغان HTML.',
  },
  structureSandbox: {
    zh: '每个页面都是独立的沙箱，彼此不共享变量。后台页和面板之间要共享数据，可以用 `gx.storage`，或者在后台页注册命令、在面板里用 `gx.commands.run` 调用。',
    en: 'Each page is its own sandbox, and pages share no variables. To share data between the background page and a panel, use `gx.storage`, or register a command in the background page and call it from the panel with `gx.commands.run`.',
    ug: 'ھەر بىر بەت مۇستەقىل قۇم ساندۇقى بولۇپ، ئۆزئارا ئۆزگەرگۈچى ئورتاقلاشمايدۇ. ئارقا سەھىپە بىلەن تاختا ئارىسىدا سانلىق مەلۇمات ئورتاقلاشماقچى بولسىڭىز، `gx.storage` نى ئىشلىتىڭ، ياكى ئارقا سەھىپىدە بۇيرۇق تىزىملىتىپ، تاختىدا `gx.commands.run` بىلەن چاقىرىڭ.',
  },
  manifestLimits: {
    zh: '清单文件最大 256 KB。不认识的字段会被忽略，写错的贡献项会在插件详情里列出原因。',
    en: 'The manifest can be up to 256 KB. Unknown fields are ignored, and the plugin details list why each invalid contribution was rejected.',
    ug: 'تىزىملىك ھۆججىتى ئەڭ چوڭ 256 KB. تونۇلمىغان بۆلەكلەرگە پەرۋا قىلىنمايدۇ، خاتا يېزىلغان تۆھپە تۈرلىرىنىڭ سەۋەبى قىستۇرما تەپسىلاتىدا كۆرسىتىلىدۇ.',
  },
  permissionsIntro: {
    zh: '调用带权限的方法前，权限必须先写在清单的 `permissions` 里，否则直接失败。第一次调用时应用会弹窗询问用户，结果会记住；用户随时可以在插件详情里撤销。',
    en: "Before you call a method that needs a permission, list the permission in the manifest's `permissions`, or the call fails right away. On the first call the app asks the user and remembers the answer. The user can revoke it at any time in the plugin details.",
    ug: 'ھوقۇق تەلەپ قىلىدىغان ئۇسۇلنى چاقىرىشتىن بۇرۇن، ئۇ ھوقۇق چوقۇم تىزىملىكنىڭ `permissions` بۆلىكىگە يېزىلغان بولۇشى كېرەك، بولمىسا بىۋاسىتە مەغلۇپ بولىدۇ. تۇنجى قېتىم چاقىرغاندا ئەپ كۆزنەك ئېچىپ ئىشلەتكۈچىدىن سورايدۇ ۋە نەتىجىنى ئېسىدە تۇتىدۇ؛ ئىشلەتكۈچى خالىغان ۋاقىتتا قىستۇرما تەپسىلاتىدا رۇخسەتنى بىكار قىلالايدۇ.',
  },
  permissionHttp: {
    zh: '访问这个主机，例如 `http:api.github.com`；端口不是默认值时写成 `http:example.com:8080`。每个主机单独声明。',
    en: "Access to this host, for example `http:api.github.com`. When the port isn't the default, write `http:example.com:8080`. Declare each host separately.",
    ug: 'بۇ ئاساسىي ماشىنىنى زىيارەت قىلىش، مەسىلەن `http:api.github.com`؛ ئېغىز كۆڭۈلدىكى قىممەت بولمىسا `http:example.com:8080` شەكلىدە يېزىلىدۇ. ھەر بىر ئاساسىي ماشىنا ئايرىم ئېلان قىلىنىدۇ.',
  },
  permissionsRevoke: {
    zh: '插件更新后，新版本不再声明的权限会自动收回。',
    en: 'When a plugin updates, the app revokes any permission the new version no longer declares.',
    ug: 'قىستۇرما يېڭىلانغاندىن كېيىن، يېڭى نەشرى ئەمدى ئېلان قىلمىغان ھوقۇقلار ئاپتوماتىك قايتۇرۇۋېلىنىدۇ.',
  },
  contributesIntro: {
    zh: '`contributes` 里的内容由应用直接从清单读取并注册，不经过插件脚本。下面每个示例都是 `contributes` 对象里的一个键。',
    en: 'The app reads `contributes` straight from the manifest and registers it without running any plugin script. Each example below is one key of the `contributes` object.',
    ug: '`contributes` تىكى مەزمۇنلارنى ئەپ تىزىملىكتىن بىۋاسىتە ئوقۇپ تىزىملىتىدۇ، قىستۇرما قوليازمىسىدىن ئۆتمەيدۇ. تۆۋەندىكى ھەر بىر مىسال `contributes` ئوبيېكتىدىكى بىر ئاچقۇچ.',
  },
  menusIntro: {
    zh: '菜单项的 `command` 写本插件的命令名。用户点击时，这个位置的上下文对象作为参数传给命令的实现函数；`when` 也是按这些字段判断。',
    en: "A menu item's `command` is a command name of this plugin. When the user clicks the item, the context object of its location is passed to the command's implementation, and `when` is checked against the same fields.",
    ug: 'تىزىملىك تۈرىدىكى `command` بۆلىكىگە مۇشۇ قىستۇرمىنىڭ بۇيرۇق ئاتى يېزىلىدۇ. ئىشلەتكۈچى چەككەندە، بۇ ئورۇننىڭ كونتېكىست ئوبيېكتى پارامېتىر سۈپىتىدە بۇيرۇقنى ئىجرا قىلىدىغان فۇنكسىيەگە يەتكۈزۈلىدۇ؛ `when` مۇ مۇشۇ بۆلەكلەر بويىچە ھۆكۈم قىلىدۇ.',
  },
  apiIntro: {
    zh: '下面的方法都挂在全局对象 `gx` 上，例如 `gx.ui.confirm(...)`。签名里返回 Promise 的方法用 await 取结果。标了权限的方法需要先在清单里声明对应权限。',
    en: 'All methods below live on the global `gx` object, for example `gx.ui.confirm(...)`. Use await to get the result of a method whose signature returns a Promise. Methods marked with a permission need that permission declared in the manifest first.',
    ug: 'تۆۋەندىكى ئۇسۇللارنىڭ ھەممىسى `gx` ئومۇمىي دائىرىلىك ئوبيېكتىغا تەۋە، مەسىلەن `gx.ui.confirm(...)`. ئىمزاسى Promise قايتۇرىدىغان ئۇسۇللارنىڭ نەتىجىسىنى await بىلەن ئېلىڭ. ھوقۇق بەلگىسى بار ئۇسۇللار ئۈچۈن ئالدى بىلەن تىزىملىكتە مۇناسىپ ھوقۇقنى ئېلان قىلىش كېرەك.',
  },
  typesHint: {
    zh: '完整的 TypeScript 声明，复制成 `gx.d.ts` 放进插件文件夹，编辑器就能补全和检查。',
    en: 'The full TypeScript declarations. Save them as `gx.d.ts` in the plugin folder, and your editor can complete and check your code.',
    ug: 'تولۇق TypeScript ئېلانى. ئۇنى `gx.d.ts` قىلىپ كۆچۈرۈپ قىستۇرما قىسقۇچىغا قويسىڭىز، تەھرىرلىگۈچ تولۇقلاش ۋە تەكشۈرۈش ئېلىپ بارالايدۇ.',
  },
  panelsIntro: {
    zh: '清单的 `panels` 里每一项指向插件文件夹中的一个 HTML 文件。页面必须先加载 `/__sdk/gx.js`，之后才能用 `gx`；`gx.panel` 是当前面板的 id。',
    en: "Each entry in the manifest's `panels` points to an HTML file in the plugin folder. The page must load `/__sdk/gx.js` before it can use `gx`. `gx.panel` is the id of the current panel.",
    ug: 'تىزىملىكنىڭ `panels` بۆلىكىدىكى ھەر بىر تۈر قىستۇرما قىسقۇچىدىكى بىر HTML ھۆججىتىنى كۆرسىتىدۇ. بەت ئالدى بىلەن `/__sdk/gx.js` نى يۈكلىگەندىن كېيىنلا `gx` نى ئىشلىتەلەيدۇ؛ `gx.panel` نۆۋەتتىكى تاختىنىڭ id سى.',
  },
  panelsTokens: {
    zh: '页面根元素上已经写好下面这些主题变量，用户切换主题时会自动更新，直接在 CSS 里引用就能和应用保持一致。',
    en: "The page's root element already carries the theme variables below, and they update when the user switches themes. Use them in your CSS to match the app.",
    ug: 'بەتنىڭ يىلتىز ئېلېمېنتىغا تۆۋەندىكى ئۆرنەك ئۆزگەرگۈچىلىرى ئاللىقاچان يېزىلغان، ئىشلەتكۈچى ئۆرنەك ئالماشتۇرغاندا ئاپتوماتىك يېڭىلىنىدۇ، CSS تا بىۋاسىتە ئىشلەتسىڭىز ئەپ بىلەن بىردەك بولىدۇ.',
  },
  panelsScripts: {
    zh: '脚本只能从插件文件夹加载，不能写内联脚本；样式可以内联。',
    en: 'Scripts load only from the plugin folder, and inline scripts are not allowed. Inline styles are fine.',
    ug: 'قوليازمىلار پەقەت قىستۇرما قىسقۇچىدىنلا يۈكلىنىدۇ، بەت ئىچىگە قوليازما يازغىلى بولمايدۇ؛ ئۇسلۇبنى بەت ئىچىگە يازسا بولىدۇ.',
  },
  panelsMenu: {
    zh: '需要右键菜单时，在 `contextmenu` 事件里调用 `gx.ui.menu(event.clientX, event.clientY, items)`，菜单样式和应用一致。',
    en: "For a context menu, call `gx.ui.menu(event.clientX, event.clientY, items)` in the `contextmenu` event. The menu matches the app's style.",
    ug: 'ئوڭ كۇنۇپكا تىزىملىكى كېرەك بولسا، `contextmenu` ھادىسىسىدە `gx.ui.menu(event.clientX, event.clientY, items)` نى چاقىرىڭ، تىزىملىك ئۇسلۇبى ئەپ بىلەن بىردەك بولىدۇ.',
  },
  securitySandbox: {
    zh: '插件页面运行在不带同源权限的沙箱 iframe 里，碰不到应用页面、Tauri 接口和本机文件。',
    en: "Plugin pages run in a sandboxed iframe without same-origin access, so they can't reach the app's pages, the Tauri APIs or local files.",
    ug: 'قىستۇرما بەتلىرى ئوخشاش مەنبە ھوقۇقى يوق قۇم ساندۇقى iframe ئىچىدە ئىجرا بولىدۇ، ئەپ بەتلىرى، Tauri ئارايۈزى ۋە يەرلىك ھۆججەتلەرگە تېگەلمەيدۇ.',
  },
  securityNetwork: {
    zh: '页面不能自己联网，`fetch`、`XMLHttpRequest`、`WebSocket` 都会被拦下。访问网络要用 `gx.http.request`，而且只能访问声明过的主机。',
    en: "Pages can't go online on their own: `fetch`, `XMLHttpRequest` and `WebSocket` are all blocked. Use `gx.http.request` for network access, which only reaches declared hosts.",
    ug: 'بەتلەر ئۆزى تورغا چىقالمايدۇ، `fetch`، `XMLHttpRequest`، `WebSocket` نىڭ ھەممىسى توسۇلىدۇ. تورنى زىيارەت قىلىش ئۈچۈن `gx.http.request` نى ئىشلىتىش كېرەك، ئۇنىڭدىمۇ پەقەت ئېلان قىلىنغان ئاساسىي ماشىنىلارنىلا زىيارەت قىلغىلى بولىدۇ.',
  },
  securityResources: {
    zh: '页面只能加载插件文件夹里的脚本、样式、图片、字体和媒体；图片另外允许 `data:` 和 `blob:`。',
    en: 'Pages load scripts, styles, images, fonts and media only from the plugin folder. Images may also use `data:` and `blob:`.',
    ug: 'بەتلەر پەقەت قىستۇرما قىسقۇچىدىكى قوليازما، ئۇسلۇب، رەسىم، خەت نۇسخىسى ۋە ۋاسىتىلەرنىلا يۈكلىيەلەيدۇ؛ رەسىملەر ئۈچۈن يەنە `data:` ۋە `blob:` غا رۇخسەت قىلىنىدۇ.',
  },
  securityStart: {
    zh: '启动超过 10 秒算失败。出错的插件在列表里标红，不影响应用和其他插件。',
    en: "A start that takes longer than 10 seconds counts as failed. A failing plugin turns red in the list and doesn't affect the app or other plugins.",
    ug: 'قوزغىلىش 10 سېكۇنتتىن ئاشسا مەغلۇپ ھېسابلىنىدۇ. خاتالىق كۆرۈلگەن قىستۇرما تىزىملىكتە قىزىل رەڭدە كۆرسىتىلىدۇ، ئەپ ۋە باشقا قىستۇرمىلارغا تەسىر يەتكۈزمەيدۇ.',
  },
  limitManifest: {
    zh: '清单 `plugin.json`',
    en: 'Manifest `plugin.json`',
    ug: 'تىزىملىك `plugin.json`',
  },
  limitPackage: { zh: '安装包', en: 'Package', ug: 'ئورنىتىش بوغچىسى' },
  limitPackageValue: {
    zh: '32 MB，2000 个文件，目录最多 16 层',
    en: '32 MB, 2,000 files, folders up to 16 levels deep',
    ug: '32 MB، 2000 ھۆججەت، مۇندەرىجە ئەڭ كۆپ 16 قەۋەت',
  },
  limitFile: { zh: '单个插件文件', en: 'A single plugin file', ug: 'يەككە قىستۇرما ھۆججىتى' },
  limitStorage: {
    zh: '每个插件 1 MB，键名 128 字符',
    en: '1 MB per plugin, keys up to 128 characters',
    ug: 'ھەر بىر قىستۇرمىغا 1 MB، ئاچقۇچ ئاتى 128 ھەرپ',
  },
  limitPermissions: { zh: '32 个', en: '32', ug: '32' },
  limitLocales: {
    zh: '每种语言 500 条，每段文字 500 字符',
    en: '500 entries per language, 500 characters per text',
    ug: 'ھەر بىر تىلغا 500 تۈر، ھەر بىر تېكىست 500 ھەرپ',
  },
  limitExec: {
    zh: '命令 8000 字符，输出 1 MB',
    en: 'Commands up to 8,000 characters, output up to 1 MB',
    ug: 'بۇيرۇق 8000 ھەرپ، چىقىرىش 1 MB',
  },
  limitHttp: {
    zh: '请求体 1 MB，响应 4 MB，请求头 50 个，超时 120 秒',
    en: 'Request body 1 MB, response 4 MB, 50 headers, 120-second timeout',
    ug: 'ئىلتىماس گەۋدىسى 1 MB، ئىنكاس 4 MB، 50 ئىلتىماس بېشى، ۋاقىت چېكى 120 سېكۇنت',
  },
  packagingDev: {
    zh: '开发时直接把文件夹放进插件目录，改完点“重新加载”。',
    en: 'While developing, put the folder straight into the plugins folder and click “Reload” after each change.',
    ug: 'ئېچىش جەريانىدا قىسقۇچنى بىۋاسىتە قىستۇرما قىسقۇچىغا قويۇڭ، ئۆزگەرتىپ بولغاندىن كېيىن «قايتا يۈكلە» نى چېكىڭ.',
  },
  packagingFolder: {
    zh: '分发时可以给对方整个文件夹，用“从文件夹安装…”安装。',
    en: 'To share a plugin, hand over the whole folder and install it with “Install from folder…”.',
    ug: 'تارقاتقاندا پۈتۈن قىسقۇچنى بەرسىڭىز بولىدۇ، ئۇ «قىسقۇچتىن ئورنات…» ئارقىلىق ئورنىتىلىدۇ.',
  },
  packagingZip: {
    zh: '也可以压缩成 zip，扩展名用 `.zip` 或 `.gxplugin`，用“从文件安装…”安装。`plugin.json` 放在压缩包根目录，或者放在唯一的一个子文件夹里。',
    en: 'You can also zip it, with the extension `.zip` or `.gxplugin`, and install it with “Install from file…”. Put `plugin.json` at the root of the archive or in its only subfolder.',
    ug: 'zip قىلىپ پىرىسلاشقىمۇ بولىدۇ، كېڭەيتمە ئاتى `.zip` ياكى `.gxplugin` بولىدۇ، ئۇ «ھۆججەتتىن ئورنات…» ئارقىلىق ئورنىتىلىدۇ. `plugin.json` پىرىسلانغان بوغچىنىڭ يىلتىز مۇندەرىجىسىگە ياكى بىردىنبىر تارماق قىسقۇچقا قويۇلىدۇ.',
  },
  packagingInstall: {
    zh: '安装会把文件复制到插件目录，已有同 id 的插件时替换成新版本，存储的数据和授权保留。',
    en: 'Installing copies the files into the plugins folder. When a plugin with the same id is already there, the new version replaces it and keeps its stored data and grants.',
    ug: 'ئورنىتىش ھۆججەتلەرنى قىستۇرما قىسقۇچىغا كۆچۈرىدۇ، id سى ئوخشاش قىستۇرما بار بولسا يېڭى نەشرى بىلەن ئالماشتۇرۇلىدۇ، ساقلانغان سانلىق مەلۇمات ۋە رۇخسەتلەر ساقلىنىپ قالىدۇ.',
  },
  examplesIntro: {
    zh: '源码仓库的 `examples/plugins` 里有两个完整示例，可以直接用“从文件夹安装…”装上试用。',
    en: 'The source repository has two complete examples in `examples/plugins`. Install one with “Install from folder…” to try it out.',
    ug: 'مەنبە كود ئامبىرىنىڭ `examples/plugins` مۇندەرىجىسىدە ئىككى تولۇق مىسال بار، «قىسقۇچتىن ئورنات…» ئارقىلىق بىۋاسىتە ئورنىتىپ سىناپ باقسىڭىز بولىدۇ.',
  },
  exampleHello: {
    zh: 'hello：命令、右键菜单、快捷键、状态栏、面板、图标和设置项',
    en: 'hello: commands, context menus, keybindings, status bar, panel, icons and settings',
    ug: 'hello: بۇيرۇق، ئوڭ كۇنۇپكا تىزىملىكى، تېزلەتمە كۇنۇپكا، ھالەت بالدىقى، تاختا، سىنبەلگە ۋە تەڭشەك تۈرى',
  },
  exampleDisk: {
    zh: 'disk-alert：在服务器上执行 df，磁盘快满时在状态栏告警',
    en: 'disk-alert: runs df on the server and warns in the status bar when a disk is nearly full',
    ug: 'disk-alert: مۇلازىمېتىردا df نى ئىجرا قىلىپ، دىسكا تولاي دېگەندە ھالەت بالدىقىدا ئاگاھلاندۇرىدۇ',
  },
  iconsIntro: {
    zh: '命令、菜单项、状态栏和面板的 `icon` 字段写这里的名字。插件可以用 `contributes.icons` 或 `gx.icons.register` 添加自己的图标，和内置图标同名时只在本插件里覆盖。',
    en: 'The `icon` field of commands, menu items, status bar items and panels takes the names here. Plugins can add their own icons with `contributes.icons` or `gx.icons.register`; an icon with a built-in name overrides it only within that plugin.',
    ug: 'بۇيرۇق، تىزىملىك تۈرى، ھالەت بالدىقى ۋە تاختىلارنىڭ `icon` بۆلىكىگە بۇ يەردىكى ئاتلار يېزىلىدۇ. قىستۇرمىلار `contributes.icons` ياكى `gx.icons.register` ئارقىلىق ئۆز سىنبەلگىسىنى قوشالايدۇ، ئىچكى سىنبەلگە بىلەن ئاتى ئوخشاش بولسا پەقەت شۇ قىستۇرمىنىڭ ئىچىدىلا قاپلايدۇ.',
  },
})

/** A content field that may be one string for every language. */
const local = (text: string | L): string => (typeof text === 'string' ? text : inLang(text))

type Part = Node | string
const report = reportError

/** Plain text where `backticked` spans become inline code. */
function rich(text: string): Part[] {
  return text.split(/`([^`]+)`/).map((part, i) => (i % 2 ? h('code', { text: part }) : part))
}

const p = (text: string) => h('p', {}, rich(text))
const bullets = (items: string[]) =>
  h(
    'ul',
    {},
    items.map((item) => h('li', {}, rich(item))),
  )
const steps = (items: string[]) =>
  h(
    'ol',
    {},
    items.map((item) => h('li', {}, rich(item))),
  )
const sub = (text: string) => h('h3', { text })

function copy(text: string, done: string): void {
  writeText(text)
    .then(() => setStatus(done))
    .catch(report)
}

function codeBlock(text: string, caption: string): HTMLElement {
  return h(
    'figure',
    { class: 'guide-code' },
    h(
      'figcaption',
      {},
      h('span', { class: 'mono', text: caption }),
      h(
        'button',
        {
          type: 'button',
          class: 'icon-button',
          title: common('copy'),
          'aria-label': t('copyNamed', { name: caption }),
          onclick: () => copy(text, t('copied', { name: caption })),
        },
        namedIcon('copy'),
      ),
    ),
    // Code reads left to right in every language; Uyghur sits only inside strings and comments.
    h('pre', { dir: 'ltr' }, h('code', { text: text.trimEnd() })),
  )
}

function table(label: string, head: string[], rows: Part[][]): HTMLElement {
  return h(
    'div',
    { class: 'guide-table-wrap' },
    h(
      'table',
      { class: 'guide-table', 'aria-label': label },
      h(
        'thead',
        {},
        h(
          'tr',
          {},
          head.map((text) => h('th', { scope: 'col', text })),
        ),
      ),
      h(
        'tbody',
        {},
        rows.map((row) =>
          h(
            'tr',
            {},
            row.map((cell) => h('td', {}, typeof cell === 'string' ? rich(cell) : cell)),
          ),
        ),
      ),
    ),
  )
}

/** `gx.group.method` names for every API that needs the permission. */
function apisFor(permission: string): Node {
  const names = API_GROUPS.flatMap((g) =>
    g.methods
      .filter((m) => m.perm === permission)
      .map((m) => `gx.${g.name}.${m.sig.slice(0, m.sig.indexOf('('))}`),
  )
  // The list separator of the current language, between code elements.
  const separator = joinList(['', ''])
  return h(
    'span',
    {},
    names.flatMap((name, i) => [i ? separator : '', h('code', { text: name })]),
  )
}

interface GuideSection {
  id: string
  title: string
  body: () => Part[]
}

const overview = (): Part[] => [
  p(t('overviewWhat')),
  p(t('overviewBuiltin')),
  bullets([t('kindManifest'), t('kindScript'), t('kindPanel')]),
  p(t('overviewLocales')),
]

const quickStart = (): Part[] => [
  steps([t('stepOpen'), t('stepFolder'), t('stepFiles'), t('stepReload')]),
  codeBlock(inLang(QUICK_MANIFEST), 'me.hello/plugin.json'),
  codeBlock(inLang(QUICK_MAIN), 'me.hello/main.js'),
  p(t('reloadHint')),
]

const structure = (): Part[] => [
  codeBlock(
    `me.hello/
├─ plugin.json   ${t('treeManifest')}
├─ main.js       ${t('treeMain')}
├─ panel.html    ${t('treePanel')}
├─ panel.js
└─ panel.css`,
    t('structure'),
  ),
  p(t('structureBackground')),
  p(t('structureSandbox')),
]

const manifest = (): Part[] => [
  table(
    t('manifestTable'),
    [t('field'), common('type'), t('required'), t('description')],
    MANIFEST_FIELDS.map(([name, type, required, meaning]) => [
      h('code', { text: name }),
      h('code', { text: type }),
      required ? t('yes') : '',
      inLang(meaning),
    ]),
  ),
  p(t('manifestLimits')),
]

const permissions = (): Part[] => [
  p(t('permissionsIntro')),
  table(
    common('permissions'),
    [common('permissions'), t('meaning'), t('relatedApis')],
    [
      ...Object.entries(PERMISSION_TEXT).map(([perm, text]) => [
        h('code', { text: perm }),
        text,
        apisFor(perm),
      ]),
      [h('code', { text: 'http:<host>' }), t('permissionHttp'), apisFor('http:<host>')],
    ],
  ),
  p(t('permissionsRevoke')),
]

const contributes = (): Part[] => [
  p(t('contributesIntro')),
  ...CONTRIBUTES.flatMap((c) => [
    h('h3', { id: `contributes-${c.key}` }, h('code', { text: c.key })),
    p(inLang(c.desc)),
    codeBlock(local(c.example), `contributes.${c.key}`),
  ]),
]

const menus = (): Part[] => [
  p(t('menusIntro')),
  table(
    t('menus'),
    [t('place'), t('appearsIn'), t('contextFields')],
    MENU_PLACES.map((where) => {
      const [label, fields] = MENU_CONTEXT[where]
      return [
        h('code', { text: where }),
        inLang(label),
        h('span', { class: 'mono', text: local(fields) }),
      ]
    }),
  ),
  codeBlock(
    `gx.commands.register('count', async ({ sessionId, paths }) => {
  for (const path of paths) {
    const text = await gx.files.readText(sessionId, path)
    gx.log(\`\${path}: \${text.split('\\n').length} ${t('sampleLines')}\`)
  }
})`,
    'main.js',
  ),
]

function apiReference(): Part[] {
  return [
    p(t('apiIntro')),
    ...API_GROUPS.map((group) =>
      h(
        'section',
        {
          class: 'guide-api',
          id: `api-${group.name}`,
          'aria-label': group.name === 'gx' ? 'gx' : `gx.${group.name}`,
        },
        h('h3', {}, h('code', { text: group.name === 'gx' ? 'gx' : `gx.${group.name}` })),
        p(inLang(group.desc)),
        h(
          'dl',
          { class: 'guide-methods' },
          group.methods.map((m) =>
            h(
              'div',
              { class: 'guide-method' },
              h(
                'dt',
                {},
                h('code', { text: m.sig }),
                m.perm
                  ? h('span', { class: 'guide-perm', title: t('neededPermission'), text: m.perm })
                  : null,
              ),
              h('dd', {}, rich(inLang(m.desc))),
            ),
          ),
        ),
      ),
    ),
    sub(t('typeDeclarations')),
    p(t('typesHint')),
    h(
      'details',
      { class: 'guide-example' },
      h('summary', { text: 'gx.d.ts' }),
      codeBlock(gxTypes, 'gx.d.ts'),
    ),
  ]
}

const panelPages = (): Part[] => [
  p(t('panelsIntro')),
  codeBlock(inLang(PANEL_PAGE), 'panel.html'),
  p(t('panelsTokens')),
  h(
    'ul',
    { class: 'guide-tokens', 'aria-label': t('themeTokens') },
    THEME_TOKENS.map((token) => h('li', {}, h('code', { text: token }))),
  ),
  codeBlock(PANEL_CSS, 'panel.css'),
  bullets([t('panelsScripts'), t('panelsMenu')]),
]

const security = (): Part[] => [
  bullets([t('securitySandbox'), t('securityNetwork'), t('securityResources'), t('securityStart')]),
  table(
    t('limits'),
    [t('item'), t('limit')],
    [
      [t('limitManifest'), '256 KB'],
      [t('limitPackage'), t('limitPackageValue')],
      [t('limitFile'), '16 MB'],
      ['`gx.storage`', t('limitStorage')],
      ['`permissions`', t('limitPermissions')],
      ['`locales`', t('limitLocales')],
      ['`gx.sessions.exec`', t('limitExec')],
      ['`gx.files.readText` / `writeText`', '4 MB'],
      ['`gx.http.request`', t('limitHttp')],
    ],
  ),
]

const packaging = (): Part[] => [
  bullets([t('packagingDev'), t('packagingFolder'), t('packagingZip'), t('packagingInstall')]),
]

const examples = (): Part[] => {
  const files = (title: string, list: [string, string][]) =>
    h(
      'details',
      { class: 'guide-example' },
      h('summary', { text: title }),
      list.map(([name, text]) => codeBlock(text, name)),
    )
  return [
    p(t('examplesIntro')),
    files(t('exampleHello'), [
      ['hello/plugin.json', helloManifest],
      ['hello/main.js', helloMain],
      ['hello/panel.html', helloPanel],
      ['hello/panel.js', helloPanelJs],
      ['hello/panel.css', helloPanelCss],
    ]),
    files(t('exampleDisk'), [
      ['disk-alert/plugin.json', diskManifest],
      ['disk-alert/main.js', diskMain],
    ]),
  ]
}

function icons(): Part[] {
  const names = iconNames()
  const search = h('input', {
    type: 'search',
    class: 'guide-icon-search',
    placeholder: t('searchIconPlaceholder'),
    'aria-label': t('searchIcons'),
  })
  const count = h('p', { class: 'help', 'aria-live': 'polite' })
  const grid = h(
    'ul',
    { class: 'guide-icons', 'aria-label': t('builtinIcons') },
    names.map((name) =>
      h(
        'li',
        { 'data-name': name },
        h(
          'button',
          {
            type: 'button',
            class: 'guide-icon',
            title: t('copyNamed', { name }),
            onclick: () => copy(name, t('copiedName', { name })),
          },
          namedIcon(name),
          h('span', { class: 'mono', text: name }),
        ),
      ),
    ),
  )
  const filter = () => {
    const query = search.value.trim().toLowerCase()
    let shown = 0
    for (const item of grid.children) {
      const li = item as HTMLElement
      const match = !query || (li.dataset.name ?? '').includes(query)
      li.hidden = !match
      if (match) shown += 1
    }
    count.textContent = query ? t('found', { n: shown }) : t('iconCount', { n: names.length })
  }
  search.addEventListener('input', filter)
  filter()
  return [p(t('iconsIntro')), h('div', { class: 'guide-icon-bar' }, search, count), grid]
}

const SECTIONS: GuideSection[] = [
  { id: 'overview', title: t('overview'), body: overview },
  { id: 'quick-start', title: t('quickStart'), body: quickStart },
  { id: 'structure', title: t('structure'), body: structure },
  { id: 'manifest', title: t('manifest'), body: manifest },
  { id: 'permissions', title: common('permissions'), body: permissions },
  { id: 'contributes', title: t('contributes'), body: contributes },
  { id: 'menus', title: t('menus'), body: menus },
  { id: 'api', title: t('api'), body: apiReference },
  { id: 'panels', title: t('panels'), body: panelPages },
  { id: 'security', title: t('security'), body: security },
  { id: 'packaging', title: t('packaging'), body: packaging },
  { id: 'examples', title: t('examples'), body: examples },
  { id: 'icons', title: t('icons'), body: icons },
]

function render(): void {
  const content = $('guide-content')
  const links = new Map<string, HTMLAnchorElement>()
  const nav = h(
    'ul',
    {},
    SECTIONS.map((section) => {
      const link = h('a', {
        href: `#${section.id}`,
        text: section.title,
        onclick: (event: Event) => {
          event.preventDefault()
          document.getElementById(section.id)?.scrollIntoView({ block: 'start' })
        },
      })
      links.set(section.id, link)
      return h('li', {}, link)
    }),
  )
  $('guide-nav').replaceChildren(nav)
  content.replaceChildren(
    h('header', { class: 'guide-hero' }, h('h1', { text: t('title') }), p(t('lead'))),
    ...SECTIONS.map((section) =>
      h(
        'section',
        { class: 'guide-section', id: section.id, 'aria-labelledby': `${section.id}-title` },
        h('h2', { id: `${section.id}-title`, text: section.title }),
        section.body(),
      ),
    ),
  )

  const visible = new Set<string>()
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) visible.add(entry.target.id)
        else visible.delete(entry.target.id)
      }
      const current = SECTIONS.find((s) => visible.has(s.id))?.id
      for (const [id, link] of links) {
        if (id === current) link.setAttribute('aria-current', 'true')
        else link.removeAttribute('aria-current')
      }
    },
    { root: content, rootMargin: '0px 0px -60% 0px' },
  )
  for (const section of SECTIONS) {
    const element = document.getElementById(section.id)
    if (element) observer.observe(element)
  }
}

async function start(): Promise<void> {
  fillStatic(t)
  captureUiErrors()
  initContextMenus()
  const settingsError = await loadSettings()
  if (settingsError) setStatus(t('settingsError', { error: settingsError }), 'error')
  initTheme()
  initScale(report).catch(report)
  loadUserCss().catch(report)
  render()
}

start().catch(report)
