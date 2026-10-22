import type { Lang } from './i18n'
import type { MenuWhere } from './plugins/api'

/** One text in each interface language; the guide reads it with `inLang`. */
export type L = Record<Lang, string>

export interface ApiMethod {
  sig: string
  desc: L
  /** The permission the call needs. */
  perm?: string
}

export interface ApiGroup {
  name: string
  desc: L
  methods: ApiMethod[]
}

/** [field, type, required, meaning] */
export const MANIFEST_FIELDS: [string, string, boolean, L][] = [
  [
    'id',
    'string',
    true,
    {
      zh: '“作者.名称”，只用小写字母、数字和 -，例如 alice.disk-alert。必须和插件文件夹同名。',
      en: 'In the form `author.name`, using only lowercase letters, digits and `-`, for example `alice.disk-alert`. It must match the name of the plugin folder.',
      ug: '«ئاپتور.ئات» شەكلىدە بولۇپ، پەقەت كىچىك ھەرپ، رەقەم ۋە `-` ئىشلىتىلىدۇ، مەسىلەن `alice.disk-alert`. قىستۇرما قىسقۇچىنىڭ ئاتى بىلەن ئوخشاش بولۇشى كېرەك.',
    },
  ],
  [
    'name',
    'string',
    true,
    {
      zh: '显示在插件列表里的名字。',
      en: 'The name shown in the plugin list.',
      ug: 'قىستۇرمىلار تىزىملىكىدە كۆرۈنىدىغان ئات.',
    },
  ],
  [
    'version',
    'string',
    true,
    {
      zh: '版本号，建议用 1.2.3 这种写法。',
      en: 'The version number, preferably in the form `1.2.3`.',
      ug: 'نەشر نومۇرى، `1.2.3` شەكلىدە يېزىش تەۋسىيە قىلىنىدۇ.',
    },
  ],
  [
    'engine',
    'number',
    true,
    {
      zh: '插件接口的版本，目前是 1。更高的版本会被拒绝安装。',
      en: 'The version of the plugin API, currently `1`. Plugins that ask for a higher version are not installed.',
      ug: 'قىستۇرما ئارايۈزىنىڭ نەشرى، ھازىر `1`. ئۇنىڭدىن يۇقىرى نەشر تەلەپ قىلىنسا ئورنىتىش رەت قىلىنىدۇ.',
    },
  ],
  [
    'description',
    'string',
    false,
    {
      zh: '一句话说明插件做什么。',
      en: 'One sentence on what the plugin does.',
      ug: 'قىستۇرمىنىڭ نېمە ئىش قىلىدىغانلىقى توغرىسىدا بىر جۈملە.',
    },
  ],
  ['author', 'string', false, { zh: '作者名。', en: "The author's name.", ug: 'ئاپتورنىڭ ئاتى.' }],
  [
    'main',
    'string',
    false,
    {
      zh: '后台页脚本，相对插件文件夹的路径。只用声明式贡献的插件可以不写。',
      en: 'The background page script, as a path relative to the plugin folder. Plugins that only use declarative contributions can leave it out.',
      ug: 'ئارقا سەھىپە قوليازمىسى، قىستۇرما قىسقۇچىغا نىسبەتەن يول. پەقەت ئېلان شەكلىدىكى تۆھپىلەرنىلا ئىشلىتىدىغان قىستۇرمىلار يازمىسىمۇ بولىدۇ.',
    },
  ],
  [
    'permissions',
    'string[]',
    false,
    {
      zh: '需要的权限，最多 32 个，见“权限”一节。',
      en: 'The permissions the plugin needs, up to 32. See “Permissions”.',
      ug: 'كېرەكلىك ھوقۇقلار، ئەڭ كۆپ 32. «ھوقۇق» بۆلىكىگە قاراڭ.',
    },
  ],
  [
    'contributes',
    'object',
    false,
    {
      zh: '声明式贡献：命令、菜单、面板、主题等，见“贡献点”一节。',
      en: 'Declarative contributions such as commands, menus, panels and themes. See “Contribution points”.',
      ug: 'ئېلان شەكلىدىكى تۆھپىلەر: بۇيرۇق، تىزىملىك، تاختا، ئۆرنەك قاتارلىقلار. «تۆھپە نۇقتىلىرى» بۆلىكىگە قاراڭ.',
    },
  ],
  [
    'locales',
    'object',
    false,
    {
      zh: '翻译清单自己的文字，格式为 `{ "<语言>": { "<原文>": "<译文>" } }`，语言可选 `zh`、`en`、`ug`。读取清单时，凡是当前语言有译文的地方都换成译文：插件的 `name` 和 `description`，以及 `contributes` 里所有的 `title`、`label`、`description` 和 `placeholder`。没有译文的文字保持原样，所以原文用哪种语言都可以。每种语言最多 500 条，每段文字最多 500 字符。脚本运行时生成的文字按 `gx.lang` 选择语言。',
      en: 'Translates the manifest\'s own text, in the form `{ "<lang>": { "<original text>": "<translation>" } }`, where the language is `zh`, `en` or `ug`. When the app reads the manifest, it swaps in the translation for the current language wherever there is one: the plugin\'s `name` and `description`, and every `title`, `label`, `description` and `placeholder` in `contributes`. Text without a translation stays as written, so the source text can be in any language. Up to 500 entries per language, each text up to 500 characters. Text the script produces at runtime picks its language from `gx.lang`.',
      ug: 'تىزىملىكنىڭ ئۆز تېكىستلىرىنى تەرجىمە قىلىدۇ، شەكلى `{ "<lang>": { "<ئەسلى تېكىست>": "<تەرجىمىسى>" } }`، تىل `zh`، `en` ياكى `ug` بولىدۇ. ئەپ تىزىملىكنى ئوقۇغاندا، نۆۋەتتىكى تىلدا تەرجىمىسى بار ھەممە جاي تەرجىمىسى بىلەن ئالماشتۇرۇلىدۇ: قىستۇرمىنىڭ `name` ۋە `description` بۆلەكلىرى، شۇنداقلا `contributes` ئىچىدىكى بارلىق `title`، `label`، `description` ۋە `placeholder`. تەرجىمىسى يوق تېكىست ئەسلى پېتى قالىدۇ، شۇڭا ئەسلى تېكىست قايسى تىلدا بولسىمۇ بولىدۇ. ھەر بىر تىلغا ئەڭ كۆپ 500 تۈر، ھەر بىر تېكىست ئەڭ ئۇزۇن 500 ھەرپ. قوليازما ئىجرا ۋاقتىدا ھاسىل قىلغان تېكىست تىلنى `gx.lang` دىن ئالىدۇ.',
    },
  ],
]

export interface Contribution {
  key: string
  desc: L
  /** A `contributes` entry; per language where it carries sample text. */
  example: string | L
}

export const CONTRIBUTES: Contribution[] = [
  {
    key: 'commands',
    desc: {
      zh: '命令出现在命令面板（Ctrl+Shift+P）里，菜单项、快捷键和状态栏都通过命令名指向它。命令的实现在后台页里用 gx.commands.register 注册。',
      en: 'Commands appear in the command palette (Ctrl+Shift+P). Menu items, keybindings and status bar items point to a command by its name. The background page registers the implementation with `gx.commands.register`.',
      ug: 'بۇيرۇقلار بۇيرۇق تاختىسىدا (Ctrl+Shift+P) كۆرۈنىدۇ، تىزىملىك تۈرلىرى، تېزلەتمە كۇنۇپكىلار ۋە ھالەت بالدىقى بۇيرۇقنى ئاتى ئارقىلىق كۆرسىتىدۇ. بۇيرۇقنىڭ ئىجرا قىسمى ئارقا سەھىپىدە `gx.commands.register` ئارقىلىق تىزىملىتىلىدۇ.',
    },
    example: {
      zh: `"commands": [
  { "id": "greet", "title": "打个招呼", "icon": "smile" }
]`,
      en: `"commands": [
  { "id": "greet", "title": "Greet", "icon": "smile" }
]`,
      ug: `"commands": [
  { "id": "greet", "title": "سالاملىشىش", "icon": "smile" }
]`,
    },
  },
  {
    key: 'menus',
    desc: {
      zh: '往各处右键菜单追加项目，每个位置最多 20 项。when 写上下文字段名，字段非空时才显示；可以用 ! 取反、用 && 连接。',
      en: 'Adds items to context menus across the app, up to 20 per location. Set `when` to the name of a context field to show the item only when that field is not empty. Negate with `!` and combine with `&&`.',
      ug: 'ھەرقايسى جايلاردىكى ئوڭ كۇنۇپكا تىزىملىكىگە تۈر قوشىدۇ، ھەر بىر ئورۇنغا ئەڭ كۆپ 20 تۈر. `when` غا كونتېكىست بۆلىكىنىڭ ئاتى يېزىلسا، شۇ بۆلەك قۇرۇق بولمىغاندىلا كۆرۈنىدۇ؛ `!` بىلەن ئىنكار قىلىشقا، `&&` بىلەن ئۇلاشقا بولىدۇ.',
    },
    example: {
      zh: `"menus": {
  "terminal/context": [
    { "label": "复制为引用", "command": "quote", "icon": "quote", "when": "selection" }
  ],
  "files/entry": [
    { "label": "统计行数", "command": "count", "when": "paths && !directory" }
  ]
}`,
      en: `"menus": {
  "terminal/context": [
    { "label": "Copy as quote", "command": "quote", "icon": "quote", "when": "selection" }
  ],
  "files/entry": [
    { "label": "Count lines", "command": "count", "when": "paths && !directory" }
  ]
}`,
      ug: `"menus": {
  "terminal/context": [
    { "label": "نەقىل شەكلىدە كۆچۈر", "command": "quote", "icon": "quote", "when": "selection" }
  ],
  "files/entry": [
    { "label": "قۇر سانىنى ساناش", "command": "count", "when": "paths && !directory" }
  ]
}`,
    },
  },
  {
    key: 'keybindings',
    desc: {
      zh: '快捷键写法如 Ctrl+Alt+H、Ctrl+Shift+F5、Alt+F1。同一个快捷键绑定了多条命令时，后注册的生效。',
      en: 'Write keys like Ctrl+Alt+H, Ctrl+Shift+F5 or Alt+F1. When one key is bound to several commands, the one registered last wins.',
      ug: 'تېزلەتمە كۇنۇپكىلار Ctrl+Alt+H، Ctrl+Shift+F5، Alt+F1 دېگەندەك يېزىلىدۇ. بىر تېزلەتمە كۇنۇپكا بىر قانچە بۇيرۇققا باغلانغان بولسا، ئەڭ كېيىن تىزىملاتقىنى كۈچكە ئىگە بولىدۇ.',
    },
    example: `"keybindings": [
  { "key": "Ctrl+Alt+H", "command": "greet" }
]`,
  },
  {
    key: 'panels',
    desc: {
      zh: '面板是插件文件夹里的一个 HTML 页面，在沙箱里显示。region 可选 left、right、bottom，不写则默认隐藏，用户可以在布局设置里摆放。',
      en: 'A panel is an HTML page in the plugin folder, shown in a sandbox. `region` is `left`, `right` or `bottom`. Without it the panel starts hidden, and users can place it in the layout settings.',
      ug: 'تاختا قىستۇرما قىسقۇچىدىكى بىر HTML بەت بولۇپ، قۇم ساندۇقىدا كۆرسىتىلىدۇ. `region` نىڭ قىممىتى `left`، `right` ياكى `bottom` بولىدۇ، يېزىلمىسا كۆڭۈلدىكى ھالەتتە يوشۇرۇن تۇرىدۇ، ئىشلەتكۈچى ئۇنى ئورۇنلاشتۇرۇش تەڭشىكىدە جايلاشتۇرالايدۇ.',
    },
    example: `"panels": [
  { "id": "main", "title": "Hello", "page": "panel.html", "region": "right", "icon": "smile" }
]`,
  },
  {
    key: 'configuration',
    desc: {
      zh: '设置项显示在插件列表里该插件的详情中。type 可选 boolean、string、number；插件用 gx.config.get 读取，用 gx.config.onChange 监听。',
      en: "Settings show in the plugin's details in the plugin list. `type` is `boolean`, `string` or `number`. The plugin reads them with `gx.config.get` and watches for changes with `gx.config.onChange`.",
      ug: 'تەڭشەك تۈرلىرى قىستۇرمىلار تىزىملىكىدىكى شۇ قىستۇرمىنىڭ تەپسىلاتىدا كۆرۈنىدۇ. `type` نىڭ قىممىتى `boolean`، `string` ياكى `number` بولىدۇ؛ قىستۇرما `gx.config.get` بىلەن ئوقۇيدۇ، `gx.config.onChange` بىلەن ئۆزگىرىشنى كۆزىتىدۇ.',
    },
    example: {
      zh: `"configuration": [
  { "key": "threshold", "title": "告警阈值（%）", "type": "number", "default": 90,
    "description": "任一挂载点的使用率达到这个值就告警" }
]`,
      en: `"configuration": [
  { "key": "threshold", "title": "Alert threshold (%)", "type": "number", "default": 90,
    "description": "Alert when any mount point reaches this usage" }
]`,
      ug: `"configuration": [
  { "key": "threshold", "title": "ئاگاھلاندۇرۇش چېكى (%)", "type": "number", "default": 90,
    "description": "ھەرقانداق ئېگەرلەش نۇقتىسىنىڭ ئىشلىتىلىش نىسبىتى بۇ قىممەتكە يەتسە ئاگاھلاندۇرىدۇ" }
]`,
    },
  },
  {
    key: 'themes',
    desc: {
      zh: '覆盖深色（dark）或浅色（light）主题的 --gx-* 变量和终端配色。终端颜色支持 #rgb、#rrggbb、rgba()。',
      en: 'Overrides the `--gx-*` variables and terminal colors of the `dark` or `light` theme. Terminal colors accept `#rgb`, `#rrggbb` and `rgba()`.',
      ug: 'قېنىق (`dark`) ياكى سۇس (`light`) ئۆرنەكنىڭ `--gx-*` ئۆزگەرگۈچىلىرى ۋە تېرمىنال رەڭلىرىنى قاپلايدۇ. تېرمىنال رەڭلىرى `#rgb`، `#rrggbb` ۋە `rgba()` نى قوللايدۇ.',
    },
    example: {
      zh: `"themes": [
  { "id": "dark", "name": "深海",
    "tokens": { "--gx-accent": "oklch(72% 0.12 210)" },
    "terminal": { "background": "#0f1720", "foreground": "#d5dde6", "cursor": "#7cc4e4" } }
]`,
      en: `"themes": [
  { "id": "dark", "name": "Deep sea",
    "tokens": { "--gx-accent": "oklch(72% 0.12 210)" },
    "terminal": { "background": "#0f1720", "foreground": "#d5dde6", "cursor": "#7cc4e4" } }
]`,
      ug: `"themes": [
  { "id": "dark", "name": "چوڭقۇر دېڭىز",
    "tokens": { "--gx-accent": "oklch(72% 0.12 210)" },
    "terminal": { "background": "#0f1720", "foreground": "#d5dde6", "cursor": "#7cc4e4" } }
]`,
    },
  },
  {
    key: 'completions',
    desc: {
      zh: '给命令行补全加数据。d 是说明，s 是子命令，o 是选项（“-a|--all 说明;…”），v 是参数候选，a 按选项给参数候选，p 表示参数是远程路径，c 表示第一个参数是另一条命令。',
      en: 'Adds data for command line completion. `d` is the description, `s` the subcommands, `o` the options (`-a|--all description;…`), `v` the argument candidates and `a` the argument candidates per option. `p` marks the argument as a remote path, and `c` means the first argument is another command.',
      ug: 'بۇيرۇق قۇرى تولۇقلاشقا سانلىق مەلۇمات قوشىدۇ. `d` چۈشەندۈرۈش، `s` تارماق بۇيرۇق، `o` تاللانما (`-a|--all چۈشەندۈرۈش;…`)، `v` پارامېتىر نامزاتلىرى، `a` تاللانما بويىچە پارامېتىر نامزاتلىرى. `p` پارامېتىرنىڭ يىراقتىكى يول ئىكەنلىكىنى، `c` بىرىنچى پارامېتىرنىڭ باشقا بىر بۇيرۇق ئىكەنلىكىنى بىلدۈرىدۇ.',
    },
    example: {
      zh: `"completions": {
  "mytool": {
    "d": "我的部署工具",
    "o": "-v|--verbose 详细输出;-e|--env 环境",
    "a": { "--env": "dev 开发;prod 生产" },
    "s": { "deploy": { "d": "部署", "p": true }, "status": "查看状态" }
  }
}`,
      en: `"completions": {
  "mytool": {
    "d": "My deploy tool",
    "o": "-v|--verbose Verbose output;-e|--env Environment",
    "a": { "--env": "dev Development;prod Production" },
    "s": { "deploy": { "d": "Deploy", "p": true }, "status": "Show status" }
  }
}`,
      ug: `"completions": {
  "mytool": {
    "d": "مېنىڭ يولغا قويۇش قورالىم",
    "o": "-v|--verbose تەپسىلىي چىقىرىش;-e|--env مۇھىت",
    "a": { "--env": "dev ئېچىش;prod ئىشلەپچىقىرىش" },
    "s": { "deploy": { "d": "يولغا قويۇش", "p": true }, "status": "ھالەتنى كۆرسىتىش" }
  }
}`,
    },
  },
  {
    key: 'snippets',
    desc: {
      zh: '命令片段，出现在命令面板里，名字前带“片段：”。选中后填进命令栏，用户确认后再发送。',
      en: 'Command snippets. They appear in the command palette with “Snippet:” before the name. Picking one fills the command bar, and the command is sent once the user confirms it.',
      ug: 'بۇيرۇق پارچىلىرى بۇيرۇق تاختىسىدا كۆرۈنىدۇ، ئاتىنىڭ ئالدىدا «پارچە:» بولىدۇ. تاللانغاندىن كېيىن بۇيرۇق بالدىقىغا تولدۇرۇلىدۇ، ئىشلەتكۈچى جەزملىگەندىن كېيىن ئاندىن يوللىنىدۇ.',
    },
    example: {
      zh: `"snippets": [
  { "name": "查看端口", "command": "ss -tlnp", "description": "列出监听中的 TCP 端口" }
]`,
      en: `"snippets": [
  { "name": "Show ports", "command": "ss -tlnp", "description": "List listening TCP ports" }
]`,
      ug: `"snippets": [
  { "name": "ئېغىزلارنى كۆرسىتىش", "command": "ss -tlnp", "description": "تىڭشاۋاتقان TCP ئېغىزلىرىنى تىزىش" }
]`,
    },
  },
  {
    key: 'terminalHighlights',
    desc: {
      zh: '给终端输出着色。pattern 是正则表达式（最长 200 字符），flags 只认 i 和 u，颜色写 #rrggbb。',
      en: 'Colors terminal output. `pattern` is a regular expression (up to 200 characters), `flags` accepts only `i` and `u`, and colors are written as `#rrggbb`.',
      ug: 'تېرمىنال چىقىرىشىنى رەڭلەيدۇ. `pattern` مۇنتىزىم ئىپادە (ئەڭ ئۇزۇن 200 ھەرپ)، `flags` پەقەت `i` ۋە `u` نىلا تونۇيدۇ، رەڭ `#rrggbb` شەكلىدە يېزىلىدۇ.',
    },
    example: `"terminalHighlights": [
  { "pattern": "\\\\bDEPRECATED\\\\b", "flags": "i", "foreground": "#c28a17" }
]`,
  },
  {
    key: 'icons',
    desc: {
      zh: '插件自己的图标，最多 64 个，和内置图标同名时，只在本插件的菜单、命令和面板里替换内置的那个。可以写 SVG 路径（默认 256 单位的画布），也可以带 viewBox，stroke 为 true 时按 2 单位粗的线条描边。',
      en: "The plugin's own icons, up to 64. An icon with the same name as a built-in one replaces it only in this plugin's menus, commands and panels. Write SVG paths (on a 256-unit canvas by default), optionally with a `viewBox`. When `stroke` is `true`, paths are drawn as 2-unit lines.",
      ug: 'قىستۇرمىنىڭ ئۆز سىنبەلگىلىرى، ئەڭ كۆپ 64. ئىچكى سىنبەلگە بىلەن ئاتى ئوخشاش بولسا، پەقەت مۇشۇ قىستۇرمىنىڭ تىزىملىك، بۇيرۇق ۋە تاختىلىرىدىلا ئىچكى سىنبەلگىنىڭ ئورنىنى ئالىدۇ. SVG يولى يېزىلىدۇ (كۆڭۈلدىكى سىزىش يۈزى 256 بىرلىك)، `viewBox` نىمۇ قوشۇشقا بولىدۇ، `stroke` قىممىتى `true` بولسا 2 بىرلىك توملۇقتىكى سىزىق بىلەن سىزىلىدۇ.',
    },
    example: `"icons": {
  "smile": { "viewBox": "0 0 24 24", "stroke": true,
             "path": ["M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18Z", "M8 14c1 1.5 2.4 2.2 4 2.2s3-.7 4-2.2"] }
}`,
  },
]

/** Where each menu sits, and the fields of the context object it hands to the command. */
export const MENU_CONTEXT: Record<MenuWhere, [L, string | L]> = {
  'terminal/context': [
    { zh: '终端右键', en: 'Right-click in a terminal', ug: 'تېرمىنالدا ئوڭ كۇنۇپكا' },
    'sessionId, selection, live',
  ],
  'tab/context': [
    {
      zh: '会话标签右键',
      en: 'Right-click on a session tab',
      ug: 'ئەڭگىمە بەتكۈچىدە ئوڭ كۇنۇپكا',
    },
    'sessionId, kind, title',
  ],
  'tabs/background': [
    {
      zh: '标签栏空白处右键',
      en: 'Right-click on empty space in the tab bar',
      ug: 'بەتكۈچ بالدىقىنىڭ بوش يېرىدە ئوڭ كۇنۇپكا',
    },
    {
      zh: 'sessionId（当前会话）',
      en: 'sessionId (current session)',
      ug: 'sessionId (نۆۋەتتىكى ئەڭگىمە)',
    },
  ],
  'files/entry': [
    {
      zh: '文件面板中的文件或目录',
      en: 'A file or directory in the files panel',
      ug: 'ھۆججەت تاختىسىدىكى ھۆججەت ياكى مۇندەرىجە',
    },
    'sessionId, directory, paths',
  ],
  'files/background': [
    {
      zh: '文件面板空白处',
      en: 'Empty space in the files panel',
      ug: 'ھۆججەت تاختىسىنىڭ بوش يېرى',
    },
    'sessionId, directory',
  ],
  'commands/item': [
    {
      zh: '指令面板中的收藏指令',
      en: 'A favorite command in the Commands panel',
      ug: 'بۇيرۇقلار تاختىسىدىكى يىغقۇچتىكى بۇيرۇق',
    },
    'command, note',
  ],
  'commands/editor': [
    { zh: '指令编辑器', en: 'The command editor', ug: 'بۇيرۇق تەھرىرلىگۈچ' },
    'selection, text',
  ],
  'editor/context': [
    { zh: '内置文件编辑器', en: 'The built-in file editor', ug: 'ئىچكى ھۆججەت تەھرىرلىگۈچ' },
    'sessionId, path, selection',
  ],
  'connections/server': [
    {
      zh: '连接列表中的服务器',
      en: 'A server in the connection list',
      ug: 'ئۇلىنىش تىزىملىكىدىكى مۇلازىمېتىر',
    },
    'id, name, host, user',
  ],
  'connections/group': [
    {
      zh: '连接列表中的分组',
      en: 'A group in the connection list',
      ug: 'ئۇلىنىش تىزىملىكىدىكى گۇرۇپپا',
    },
    'id, name, servers',
  ],
  'panel/tab': [
    { zh: '停靠面板的标签', en: 'The tab of a docked panel', ug: 'توختىتىلغان تاختىنىڭ بەتكۈچى' },
    'panel, region',
  ],
  statusbar: [
    { zh: '底部状态栏', en: 'The status bar at the bottom', ug: 'ئاستىدىكى ھالەت بالدىقى' },
    'text',
  ],
  'text/context': [
    {
      zh: '其他地方的输入框和选中文字',
      en: 'Input boxes and selected text anywhere else',
      ug: 'باشقا جايلاردىكى كىرگۈزۈش رامكىسى ۋە تاللانغان تېكىست',
    },
    'selection, editable',
  ],
}

export const API_GROUPS: ApiGroup[] = [
  {
    name: 'gx',
    desc: {
      zh: '后台页和面板页里都有的全局对象。调用经由应用转发，应用先检查权限再执行。',
      en: 'The global object in both background and panel pages. Calls go through the app, which checks permissions before running them.',
      ug: 'ئارقا سەھىپە ۋە تاختا سەھىپىسىنىڭ ھەممىسىدە بار ئومۇمىي دائىرىلىك ئوبيېكت. چاقىرىشلار ئەپ ئارقىلىق يەتكۈزۈلىدۇ، ئەپ ئالدى بىلەن ھوقۇقنى تەكشۈرۈپ ئاندىن ئىجرا قىلىدۇ.',
    },
    methods: [
      {
        sig: 'gx.id: string | null',
        desc: { zh: '本插件的 id。', en: "This plugin's id.", ug: 'مۇشۇ قىستۇرمىنىڭ id سى.' },
      },
      {
        sig: 'gx.panel: string | null',
        desc: {
          zh: '当前页面显示的面板名，后台页里是 null。',
          en: 'The name of the panel this page shows, or `null` in the background page.',
          ug: 'نۆۋەتتىكى بەت كۆرسىتىۋاتقان تاختىنىڭ ئاتى، ئارقا سەھىپىدە `null` بولىدۇ.',
        },
      },
      {
        sig: "gx.lang: 'zh' | 'en' | 'ug'",
        desc: {
          zh: '应用的界面语言，应用重启前不会改变。`ug`（维吾尔语）从右往左书写。插件页面 `<html>` 的 `lang` 和 `dir` 会自动跟随它。',
          en: "The app's interface language, fixed until the app restarts. `ug` (Uyghur) reads right to left. The `lang` and `dir` of the page's `<html>` follow it automatically.",
          ug: 'ئەپنىڭ ئارايۈز تىلى، ئەپ قايتا قوزغالغۇچە ئۆزگەرمەيدۇ. `ug` (ئۇيغۇرچە) ئوڭدىن سولغا يېزىلىدۇ. بەتنىڭ `<html>` ئېلېمېنتىدىكى `lang` ۋە `dir` خاسلىقلىرى ئۇنىڭغا ئەگىشىپ ئاپتوماتىك ئۆزگىرىدۇ.',
        },
      },
      {
        sig: 'gx.onActivate(activate: () => void | Promise<void>)',
        desc: {
          zh: '页面连上应用后执行。全部 onActivate 完成才算插件启动成功，超过 10 秒算启动失败。',
          en: 'Runs once the page connects to the app. The plugin has started when every `onActivate` has finished; taking longer than 10 seconds counts as a failed start.',
          ug: 'بەت ئەپكە ئۇلانغاندىن كېيىن ئىجرا بولىدۇ. بارلىق `onActivate` تاماملانغاندىلا قىستۇرما مۇۋەپپەقىيەتلىك قوزغالغان ھېسابلىنىدۇ، 10 سېكۇنتتىن ئاشسا قوزغىتىش مەغلۇپ بولغان ھېسابلىنىدۇ.',
        },
      },
      {
        sig: "gx.on('theme', listener: (theme: ThemeMessage) => void): Dispose",
        desc: {
          zh: '主题切换时收到新的 --gx-* 变量，这些变量也已经写在页面根元素上。',
          en: "Receives the new `--gx-*` variables when the theme changes. They are also already set on the page's root element.",
          ug: 'ئۆرنەك ئالماشقاندا يېڭى `--gx-*` ئۆزگەرگۈچىلىرىنى تاپشۇرۇۋالىدۇ، بۇ ئۆزگەرگۈچىلەر بەتنىڭ يىلتىز ئېلېمېنتىغىمۇ يېزىلغان بولىدۇ.',
        },
      },
      {
        sig: 'gx.log(text: string)',
        desc: {
          zh: '写一条记录到“通用日志”，前面带插件名。',
          en: 'Writes an entry to the App log, prefixed with the plugin name.',
          ug: 'قىستۇرما ئاتى بىلەن باشلانغان بىر خاتىرىنى «ئومۇمىي خاتىرە» گە يازىدۇ.',
        },
      },
    ],
  },
  {
    name: 'commands',
    desc: {
      zh: '命令是插件和应用之间的主要接口。',
      en: 'Commands are the main interface between a plugin and the app.',
      ug: 'بۇيرۇقلار قىستۇرما بىلەن ئەپ ئارىسىدىكى ئاساسلىق ئارايۈز.',
    },
    methods: [
      {
        sig: 'register(name, run: (context) => unknown, title?, icon?): Promise<null>',
        desc: {
          zh: '实现清单里声明的命令；清单里没有的命令要给 title。菜单调用时 context 是该菜单的上下文对象。',
          en: "Implements a command declared in the manifest; commands not in the manifest need a `title`. When a menu runs the command, `context` is that menu's context object.",
          ug: 'تىزىملىكتە ئېلان قىلىنغان بۇيرۇقنى ئەمەلگە ئاشۇرىدۇ؛ تىزىملىكتە يوق بۇيرۇققا `title` بېرىش كېرەك. تىزىملىك تۈرى چاقىرغاندا `context` شۇ ئورۇننىڭ كونتېكىست ئوبيېكتى بولىدۇ.',
        },
      },
      {
        sig: 'run(command: string): Promise<null>',
        desc: {
          zh: '执行命令，可以是本插件的命令名，也可以是完整 id（如 app.settings）。',
          en: 'Runs a command, given either a command name of this plugin or a full id (such as `app.settings`).',
          ug: 'بۇيرۇق ئىجرا قىلىدۇ، مۇشۇ قىستۇرمىنىڭ بۇيرۇق ئاتى ياكى تولۇق id (مەسىلەن `app.settings`) بولسا بولىدۇ.',
        },
      },
    ],
  },
  {
    name: 'keybindings',
    desc: {
      zh: '运行时添加快捷键，和清单里的 keybindings 效果相同。',
      en: 'Adds keybindings at runtime, with the same effect as `keybindings` in the manifest.',
      ug: 'ئىجرا ۋاقتىدا تېزلەتمە كۇنۇپكا قوشىدۇ، ئۈنۈمى تىزىملىكتىكى `keybindings` بىلەن ئوخشاش.',
    },
    methods: [
      {
        sig: 'register(key: string, command: string): Promise<null>',
        desc: {
          zh: '例如 register("Ctrl+Alt+H", "greet")。',
          en: 'For example `register("Ctrl+Alt+H", "greet")`.',
          ug: 'مەسىلەن `register("Ctrl+Alt+H", "greet")`.',
        },
      },
    ],
  },
  {
    name: 'menus',
    desc: {
      zh: '运行时替换某个菜单位置里本插件的全部项目。',
      en: "Replaces all of this plugin's items in one menu location at runtime.",
      ug: 'ئىجرا ۋاقتىدا بىر تىزىملىك ئورنىدىكى مۇشۇ قىستۇرمىنىڭ بارلىق تۈرلىرىنى ئالماشتۇرىدۇ.',
    },
    methods: [
      {
        sig: 'set(where: MenuWhere, items: MenuEntry[]): Promise<null>',
        desc: {
          zh: '传空数组即可清掉。项目格式和清单里的 menus 相同。',
          en: 'Pass an empty array to clear them. Items use the same format as `menus` in the manifest.',
          ug: 'قۇرۇق سانلار گۇرپىسى بېرىلسە تازىلىنىدۇ. تۈرلەرنىڭ شەكلى تىزىملىكتىكى `menus` بىلەن ئوخشاش.',
        },
      },
    ],
  },
  {
    name: 'statusBar',
    desc: {
      zh: '底部状态栏右侧的条目。',
      en: 'Items on the right side of the status bar.',
      ug: 'ئاستىدىكى ھالەت بالدىقىنىڭ سول تەرىپىدىكى تۈرلەر.',
    },
    methods: [
      {
        sig: 'set(item: { id, text, title?, tone?, command?, icon? }): Promise<null>',
        desc: {
          zh: '添加或更新一条；tone 可选 info、warn、error；command 是点击时执行的命令。',
          en: 'Adds or updates an item. `tone` is `info`, `warn` or `error`; `command` is the command to run on click.',
          ug: 'بىر تۈر قوشىدۇ ياكى يېڭىلايدۇ؛ `tone` نىڭ قىممىتى `info`، `warn` ياكى `error` بولىدۇ؛ `command` چېكىلگەندە ئىجرا بولىدىغان بۇيرۇق.',
        },
      },
      {
        sig: 'remove(id: string): Promise<null>',
        desc: { zh: '移除一条。', en: 'Removes an item.', ug: 'بىر تۈرنى چىقىرىۋېتىدۇ.' },
      },
    ],
  },
  {
    name: 'ui',
    desc: {
      zh: '用应用自己的界面和用户交互。',
      en: "Talks to the user through the app's own interface.",
      ug: 'ئەپنىڭ ئۆز ئارايۈزى ئارقىلىق ئىشلەتكۈچى بىلەن ئالاقە قىلىدۇ.',
    },
    methods: [
      {
        sig: "status(text, tone?: 'info' | 'error'): Promise<null>",
        desc: {
          zh: '在状态栏左侧显示一条消息。',
          en: 'Shows a message on the left side of the status bar.',
          ug: 'ھالەت بالدىقىنىڭ ئوڭ تەرىپىدە بىر ئۇچۇر كۆرسىتىدۇ.',
        },
      },
      {
        sig: 'confirm(title, message, label?): Promise<boolean>',
        desc: { zh: '确认对话框。', en: 'A confirmation dialog.', ug: 'جەزملەش سۆزلەشكۈسى.' },
      },
      {
        sig: 'prompt(title, label, initial?): Promise<string | null>',
        desc: {
          zh: '输入对话框，取消时返回 null。',
          en: 'An input dialog. Returns `null` when cancelled.',
          ug: 'كىرگۈزۈش سۆزلەشكۈسى، ۋاز كېچىلسە `null` قايتۇرىدۇ.',
        },
      },
      {
        sig: 'pick<T>(items: PickItem<T>[], placeholder?): Promise<T | null>',
        desc: {
          zh: '可搜索的选择列表，返回选中项的 value。',
          en: 'A searchable pick list. Returns the `value` of the chosen item.',
          ug: 'ئىزدىگىلى بولىدىغان تاللاش تىزىملىكى، تاللانغان تۈرنىڭ `value` سىنى قايتۇرىدۇ.',
        },
      },
      {
        sig: 'menu(x, y, items: PageMenuItem[]): Promise<string | null>',
        desc: {
          zh: '在面板页的坐标处弹出应用样式的菜单，返回选中项的 id。只在用户正在操作这个页面时有效。',
          en: 'Opens an app-styled menu at the given panel page coordinates and returns the `id` of the chosen item. Works only while the user is interacting with the page.',
          ug: 'تاختا سەھىپىسىدىكى كوئوردىناتتا ئەپ ئۇسلۇبىدىكى تىزىملىك ئاچىدۇ، تاللانغان تۈرنىڭ `id` سىنى قايتۇرىدۇ. پەقەت ئىشلەتكۈچى بۇ بەتتە مەشغۇلات قىلىۋاتقاندىلا كۈچكە ئىگە.',
        },
      },
    ],
  },
  {
    name: 'icons',
    desc: {
      zh: '图标名可以用在菜单、命令、状态栏和面板上。',
      en: 'Icon names work in menus, commands, the status bar and panels.',
      ug: 'سىنبەلگە ئاتلىرىنى تىزىملىك، بۇيرۇق، ھالەت بالدىقى ۋە تاختىلاردا ئىشلەتكىلى بولىدۇ.',
    },
    methods: [
      {
        sig: 'register(name, data: IconInput): Promise<null>',
        desc: {
          zh: '添加或替换一个图标，插件停用时自动移除。',
          en: 'Adds or replaces an icon. The app removes it when the plugin is disabled.',
          ug: 'بىر سىنبەلگە قوشىدۇ ياكى ئالماشتۇرىدۇ، قىستۇرما چەكلەنگەندە ئۆزلۈكىدىن چىقىرىۋېتىلىدۇ.',
        },
      },
      {
        sig: 'list(): Promise<string[]>',
        desc: {
          zh: '内置图标名加上本插件的图标名。',
          en: "The built-in icon names plus this plugin's own.",
          ug: 'ئىچكى سىنبەلگە ئاتلىرى ۋە مۇشۇ قىستۇرمىنىڭ سىنبەلگە ئاتلىرى.',
        },
      },
      {
        sig: 'svg(name): Promise<string | null>',
        desc: {
          zh: '独立的 SVG 文本，颜色为 currentColor，可以直接放进面板页。',
          en: 'Standalone SVG markup drawn in `currentColor`, ready to put in a panel page.',
          ug: 'مۇستەقىل SVG تېكىستى، رەڭگى `currentColor`، تاختا سەھىپىسىگە بىۋاسىتە قويغىلى بولىدۇ.',
        },
      },
    ],
  },
  {
    name: 'storage',
    desc: {
      zh: '每个插件一个 JSON 文件，总大小上限 1 MB，键名最长 128 字符。',
      en: 'One JSON file per plugin, up to 1 MB in total, with keys of up to 128 characters.',
      ug: 'ھەر بىر قىستۇرمىغا بىر JSON ھۆججىتى، ئومۇمىي چوڭلۇقى ئەڭ كۆپ 1 MB، ئاچقۇچ ئاتى ئەڭ ئۇزۇن 128 ھەرپ.',
    },
    methods: [
      {
        sig: 'get<T>(key): Promise<T | null>',
        desc: {
          zh: '读取，不存在时为 null。',
          en: 'Reads a value, or `null` when there is none.',
          ug: 'قىممەتنى ئوقۇيدۇ، مەۋجۇت بولمىسا `null` بولىدۇ.',
        },
      },
      {
        sig: 'set(key, value): Promise<null>',
        desc: {
          zh: '写入任何可以 JSON 序列化的值；写 null 即删除。',
          en: 'Writes any value that JSON can serialize. Writing `null` deletes the key.',
          ug: 'JSON شەكلىگە ئايلاندۇرغىلى بولىدىغان ھەرقانداق قىممەتنى يازىدۇ؛ `null` يېزىلسا ئۆچۈرۈلىدۇ.',
        },
      },
    ],
  },
  {
    name: 'config',
    desc: {
      zh: '读取清单 configuration 里声明的设置项。',
      en: "Reads the settings declared in the manifest's `configuration`.",
      ug: 'تىزىملىكنىڭ `configuration` بۆلىكىدە ئېلان قىلىنغان تەڭشەك تۈرلىرىنى ئوقۇيدۇ.',
    },
    methods: [
      {
        sig: 'get<T>(key): Promise<T>',
        desc: {
          zh: '用户的值，没改过时是 default。',
          en: "The user's value, or `default` when they haven't changed it.",
          ug: 'ئىشلەتكۈچىنىڭ قىممىتى، ئۆزگەرتىلمىگەن بولسا `default`.',
        },
      },
      {
        sig: 'onChange(listener: ({ key, value }) => void): Dispose',
        desc: {
          zh: '用户修改设置项时触发。',
          en: 'Fires when the user changes a setting.',
          ug: 'ئىشلەتكۈچى تەڭشەك تۈرىنى ئۆزگەرتكەندە قوزغىلىدۇ.',
        },
      },
    ],
  },
  {
    name: 'sessions',
    desc: {
      zh: '打开的会话（标签）。',
      en: 'Open sessions (tabs).',
      ug: 'ئوچۇق ئەڭگىمەلەر (بەتكۈچلەر).',
    },
    methods: [
      {
        sig: 'list(): Promise<Session[]>',
        desc: {
          zh: '全部会话：id、kind（local/ssh/bench）、title、state、cwd。',
          en: 'All sessions: `id`, `kind` (`local`/`ssh`/`bench`), `title`, `state`, `cwd`.',
          ug: 'بارلىق ئەڭگىمەلەر: `id`، `kind` (`local`/`ssh`/`bench`)، `title`، `state`، `cwd`.',
        },
        perm: 'sessions.read',
      },
      {
        sig: 'active(): Promise<Session | null>',
        desc: {
          zh: '当前标签的会话。',
          en: 'The session in the current tab.',
          ug: 'نۆۋەتتىكى بەتكۈچنىڭ ئەڭگىمەسى.',
        },
        perm: 'sessions.read',
      },
      {
        sig: 'onChange(listener: (sessions) => void): Dispose',
        desc: {
          zh: '会话增减、状态或当前目录变化时触发。',
          en: "Fires when a session opens or closes, or a session's state or working directory changes.",
          ug: 'ئەڭگىمە قوشۇلغاندا ياكى ئازايغاندا، ھالىتى ياكى نۆۋەتتىكى مۇندەرىجىسى ئۆزگەرگەندە قوزغىلىدۇ.',
        },
        perm: 'sessions.read',
      },
      {
        sig: 'onCwd(listener: ({ sessionId, cwd }) => void): Dispose',
        desc: {
          zh: 'shell 报告了新的当前目录（需要提示符发送 OSC 7）。',
          en: 'The shell reported a new working directory (the prompt must send OSC 7).',
          ug: 'shell يېڭى نۆۋەتتىكى مۇندەرىجىنى مەلۇم قىلغاندا قوزغىلىدۇ (بۇيرۇق ئەسكەرتكۈچى OSC 7 نى يوللىشى كېرەك).',
        },
        perm: 'sessions.read',
      },
      {
        sig: 'exec(sessionId, command, { timeout? }): Promise<ExecResult>',
        desc: {
          zh: '在 SSH 服务器上另开通道执行命令，不影响终端。返回 stdout、stderr、code、truncated。',
          en: 'Runs a command on the SSH server over a separate channel, leaving the terminal untouched. Returns `stdout`, `stderr`, `code` and `truncated`.',
          ug: 'SSH مۇلازىمېتىرىدا ئايرىم قانال ئېچىپ بۇيرۇق ئىجرا قىلىدۇ، تېرمىنالغا تەسىر يەتكۈزمەيدۇ. `stdout`، `stderr`، `code`، `truncated` نى قايتۇرىدۇ.',
        },
        perm: 'sessions.exec',
      },
    ],
  },
  {
    name: 'terminal',
    desc: {
      zh: '终端的输入和输出。',
      en: 'Terminal input and output.',
      ug: 'تېرمىنالنىڭ كىرگۈزۈش ۋە چىقىرىشى.',
    },
    methods: [
      {
        sig: 'write(sessionId, text): Promise<null>',
        desc: {
          zh: '像用户打字一样发送到终端，换行用 \\r。',
          en: 'Sends text to the terminal as if the user typed it. Use `\\r` for a new line.',
          ug: 'ئىشلەتكۈچى يازغاندەك تېرمىنالغا يوللايدۇ، قۇر ئالماشتۇرۇشقا `\\r` ئىشلىتىلىدۇ.',
        },
        perm: 'terminal.write',
      },
      {
        sig: 'onOutput(sessionId, listener: (text) => void): Promise<Dispose>',
        desc: {
          zh: '分批收到终端输出的文字。',
          en: 'Receives the terminal output text in chunks.',
          ug: 'تېرمىنال چىقارغان تېكىستنى تۈركۈملەپ تاپشۇرۇۋالىدۇ.',
        },
        perm: 'terminal.read',
      },
      {
        sig: 'onInput(sessionId, listener: (text) => void): Promise<Dispose>',
        desc: {
          zh: '分批收到用户在终端里键入或粘贴的内容，不含插件写入的。授权提示会告知用户其中可能有密码。',
          en: 'Receives what the user types or pastes into the terminal, in chunks, without what plugins write. The permission prompt warns the user that this may include passwords.',
          ug: 'ئىشلەتكۈچى تېرمىنالدا كىرگۈزگەن ياكى چاپلىغان مەزمۇننى تۈركۈملەپ تاپشۇرۇۋالىدۇ، قىستۇرمىلار يازغانلىرى بۇنىڭ ئىچىدە ئەمەس. رۇخسەت سورىغاندا ئىشلەتكۈچىگە ئۇنىڭ ئىچىدە ئىم بولۇشى مۇمكىنلىكى ئۇقتۇرۇلىدۇ.',
        },
        perm: 'terminal.input',
      },
    ],
  },
  {
    name: 'profiles',
    desc: {
      zh: '保存的服务器。插件看不到密码和私钥路径，也不能设置它们。',
      en: "Saved servers. Plugins can't see or set passwords or private key paths.",
      ug: 'ساقلانغان مۇلازىمېتىرلار. قىستۇرمىلار ئىم ۋە شەخسىي ئاچقۇچ يولىنى كۆرەلمەيدۇ، ئۇلارنى تەڭشىيەلمەيدۇ.',
    },
    methods: [
      {
        sig: 'list(): Promise<{ groups, servers }>',
        desc: {
          zh: '分组和服务器：id、name、groupId、host、port、user、method、note、jumpId、hasPassword、lastConnectedAt。',
          en: 'Groups and servers: `id`, `name`, `groupId`, `host`, `port`, `user`, `method`, `note`, `jumpId`, `hasPassword`, `lastConnectedAt`.',
          ug: 'گۇرۇپپا ۋە مۇلازىمېتىرلار: `id`، `name`، `groupId`، `host`، `port`، `user`، `method`، `note`، `jumpId`، `hasPassword`، `lastConnectedAt`.',
        },
        perm: 'profiles.read',
      },
      {
        sig: 'onChange(listener: ({ groups, servers }) => void): Dispose',
        desc: {
          zh: '服务器列表变化时触发。',
          en: 'Fires when the server list changes.',
          ug: 'مۇلازىمېتىر تىزىملىكى ئۆزگەرگەندە قوزغىلىدۇ.',
        },
        perm: 'profiles.read',
      },
      {
        sig: 'save(id | null, { name?, groupId?, host?, port?, user?, note? }): Promise<SavedServer>',
        desc: {
          zh: '修改服务器，id 为 null 时新建（需要 host 和 user）。改了地址或端口会清除已保存的密码并关闭 Agent 转发。',
          en: 'Updates a server, or creates one when `id` is `null` (`host` and `user` are then required). Changing the address or port clears the saved password and turns off agent forwarding.',
          ug: 'مۇلازىمېتىرنى ئۆزگەرتىدۇ، `id` قىممىتى `null` بولسا يېڭىسىنى قۇرىدۇ (`host` ۋە `user` كېرەك). ئادرېس ياكى ئېغىز ئۆزگەرتىلسە ساقلانغان ئىم تازىلىنىدۇ ھەمدە SSH Agent يوللاش تاقىلىدۇ.',
        },
        perm: 'profiles.write',
      },
      {
        sig: 'remove(id): Promise<boolean>',
        desc: {
          zh: '先请用户确认，用户取消时返回 false。',
          en: 'Asks the user to confirm first and returns `false` if they cancel.',
          ug: 'ئالدى بىلەن ئىشلەتكۈچىدىن جەزملەشنى سورايدۇ، ئىشلەتكۈچى ۋاز كەچسە `false` قايتۇرىدۇ.',
        },
        perm: 'profiles.write',
      },
    ],
  },
  {
    name: 'files',
    desc: {
      zh: 'SSH 会话的服务器文件，文本读写有大小上限。',
      en: 'Server files of an SSH session. Text reads and writes have a size limit.',
      ug: 'SSH ئەڭگىمەسىنىڭ مۇلازىمېتىر ھۆججەتلىرى، تېكىست ئوقۇش-يېزىشنىڭ چوڭلۇق چېكى بار.',
    },
    methods: [
      {
        sig: 'list(sessionId, path): Promise<FileEntry[]>',
        desc: { zh: '列出目录。', en: 'Lists a directory.', ug: 'مۇندەرىجىنى تىزىپ بېرىدۇ.' },
        perm: 'files.read',
      },
      {
        sig: 'readText(sessionId, path): Promise<string>',
        desc: {
          zh: '读取 UTF-8 文本文件。',
          en: 'Reads a UTF-8 text file.',
          ug: 'UTF-8 تېكىست ھۆججىتىنى ئوقۇيدۇ.',
        },
        perm: 'files.read',
      },
      {
        sig: 'writeText(sessionId, path, text): Promise<null>',
        desc: { zh: '写入文本文件。', en: 'Writes a text file.', ug: 'تېكىست ھۆججىتى يازىدۇ.' },
        perm: 'files.write',
      },
    ],
  },
  {
    name: 'clipboard',
    desc: { zh: '系统剪贴板。', en: 'The system clipboard.', ug: 'سىستېما چاپلاش تاختىسى.' },
    methods: [
      {
        sig: 'readText(): Promise<string>',
        desc: { zh: '读取文字。', en: 'Reads text.', ug: 'تېكىست ئوقۇيدۇ.' },
        perm: 'clipboard',
      },
      {
        sig: 'writeText(text): Promise<null>',
        desc: { zh: '写入文字。', en: 'Writes text.', ug: 'تېكىست يازىدۇ.' },
        perm: 'clipboard',
      },
    ],
  },
  {
    name: 'http',
    desc: {
      zh: '插件页面本身不能联网，只能经由这个方法访问清单里声明过的地址。',
      en: "Plugin pages can't go online themselves. This method is their only way out, and only to addresses declared in the manifest.",
      ug: 'قىستۇرما بەتلىرى ئۆزى تورغا چىقالمايدۇ، پەقەت بۇ ئۇسۇل ئارقىلىق تىزىملىكتە ئېلان قىلىنغان ئادرېسلارنىلا زىيارەت قىلالايدۇ.',
    },
    methods: [
      {
        sig: 'request(url, { method?, headers?, body?, timeout? }): Promise<HttpResponse>',
        desc: {
          zh: '返回 status、headers、body（文本）。timeout 单位为秒，最多 120。',
          en: 'Returns `status`, `headers` and `body` (as text). `timeout` is in seconds, up to 120.',
          ug: '`status`، `headers`، `body` (تېكىست) نى قايتۇرىدۇ. `timeout` نىڭ بىرلىكى سېكۇنت، ئەڭ كۆپ 120.',
        },
        perm: 'http:<host>',
      },
    ],
  },
]

export const QUICK_MANIFEST: L = {
  zh: `{
  "id": "me.hello",
  "name": "我的第一个插件",
  "version": "0.1.0",
  "engine": 1,
  "main": "main.js",
  "contributes": {
    "commands": [{ "id": "hello", "title": "说你好", "icon": "hand" }],
    "keybindings": [{ "key": "Ctrl+Alt+H", "command": "hello" }]
  }
}`,
  en: `{
  "id": "me.hello",
  "name": "My first plugin",
  "version": "0.1.0",
  "engine": 1,
  "main": "main.js",
  "contributes": {
    "commands": [{ "id": "hello", "title": "Say hello", "icon": "hand" }],
    "keybindings": [{ "key": "Ctrl+Alt+H", "command": "hello" }]
  }
}`,
  ug: `{
  "id": "me.hello",
  "name": "تۇنجى قىستۇرمام",
  "version": "0.1.0",
  "engine": 1,
  "main": "main.js",
  "contributes": {
    "commands": [{ "id": "hello", "title": "سالام بەر", "icon": "hand" }],
    "keybindings": [{ "key": "Ctrl+Alt+H", "command": "hello" }]
  }
}`,
}

export const QUICK_MAIN: L = {
  zh: `gx.onActivate(async () => {
  await gx.commands.register('hello', async () => {
    const name = await gx.ui.prompt('你好', '怎么称呼你？')
    if (name) await gx.ui.status(\`你好，\${name}\`)
  })
})`,
  en: `gx.onActivate(async () => {
  await gx.commands.register('hello', async () => {
    const name = await gx.ui.prompt('Hello', 'What should I call you?')
    if (name) await gx.ui.status(\`Hello, \${name}\`)
  })
})`,
  ug: `gx.onActivate(async () => {
  await gx.commands.register('hello', async () => {
    const name = await gx.ui.prompt('ياخشىمۇسىز', 'سىزنى قانداق ئاتايلى؟')
    if (name) await gx.ui.status(\`ياخشىمۇسىز، \${name}\`)
  })
})`,
}

export const PANEL_PAGE: L = {
  zh: `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <link rel="stylesheet" href="panel.css" />
    <!-- 应用提供的 SDK，必须在插件脚本之前加载 -->
    <script src="/__sdk/gx.js"></script>
    <script src="panel.js" defer></script>
  </head>
  <body>
    <main id="root"></main>
  </body>
</html>`,
  en: `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <link rel="stylesheet" href="panel.css" />
    <!-- The SDK the app provides; it must load before the plugin's scripts -->
    <script src="/__sdk/gx.js"></script>
    <script src="panel.js" defer></script>
  </head>
  <body>
    <main id="root"></main>
  </body>
</html>`,
  ug: `<!doctype html>
<html lang="ug" dir="rtl">
  <head>
    <meta charset="utf-8" />
    <link rel="stylesheet" href="panel.css" />
    <!-- SDK نى ئەپ تەمىنلەيدۇ، ئۇ قىستۇرما قوليازمىلىرىدىن بۇرۇن يۈكلىنىشى كېرەك -->
    <script src="/__sdk/gx.js"></script>
    <script src="panel.js" defer></script>
  </head>
  <body>
    <main id="root"></main>
  </body>
</html>`,
}

export const PANEL_CSS = `body {
  margin: 0;
  font-family: var(--gx-font-ui);
  color: var(--gx-text);
  background: var(--gx-surface-1);
}`
