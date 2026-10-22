import { SPECS } from '../../completion-data'
import { editInternal } from '../../editor'
import { messages } from '../../i18n'
import { attachSuggestions } from '../../terminal-suggest'
import type { BuiltinPlugin } from '../api'
import { BUILTIN_VERSION } from './version'

const t = messages({
  completionName: {
    zh: '命令补全数据',
    en: 'Command completion data',
    ug: 'بۇيرۇق تولۇقلاش سانلىق مەلۇماتى',
  },
  completionDescription: {
    zh: '常用命令的子命令、选项和参数说明，供指令栏和终端推荐使用。',
    en: 'Subcommands, options and argument descriptions for common commands, used by the command bar and terminal suggestions.',
    ug: 'كۆپ ئىشلىتىلىدىغان بۇيرۇقلارنىڭ تارماق بۇيرۇق، تاللانما ۋە پارامېتىر چۈشەندۈرۈشى، بۇيرۇق بالدىقى ۋە تېرمىنال تەۋسىيەسى ئۈچۈن.',
  },
  suggestName: {
    zh: '终端输入推荐',
    en: 'Terminal input suggestions',
    ug: 'تېرمىنال كىرگۈزۈش تەۋسىيەسى',
  },
  suggestDescription: {
    zh: '在 SSH 终端的提示符后输入时弹出命令和路径建议。',
    en: 'Suggests commands and paths as you type at the prompt in SSH terminals.',
    ug: 'SSH تېرمىنالىدا بۇيرۇق كۆرسەتكۈچىدىن كېيىن كىرگۈزگەندە بۇيرۇق ۋە يول تەۋسىيەسى كۆرسىتىدۇ.',
  },
  editorName: { zh: '内置编辑器', en: 'Built-in editor', ug: 'ئىچكى تەھرىرلىگۈچ' },
  editorDescription: {
    zh: '在应用内编辑远程文件，带语法着色和搜索替换。停用后文件用外部编辑器打开。',
    en: 'Edit remote files inside the app, with syntax coloring and find and replace. When turned off, files open in an external editor.',
    ug: 'يىراقتىكى ھۆججەتلەرنى ئەپ ئىچىدە تەھرىرلەيدۇ، گرامماتىكا رەڭلەش ۋە ئىزدەپ ئالماشتۇرۇش بار. چەكلەنسە ھۆججەتلەر سىرتقى تەھرىرلىگۈچتە ئېچىلىدۇ.',
  },
})

export const completionPlugin: BuiltinPlugin = {
  manifest: {
    id: 'gx.completion',
    name: t('completionName'),
    version: BUILTIN_VERSION,
    description: t('completionDescription'),
  },
  activate(ctx) {
    ctx.completion.register(SPECS)
  },
}

export const suggestPlugin: BuiltinPlugin = {
  manifest: {
    id: 'gx.terminal-suggest',
    name: t('suggestName'),
    version: BUILTIN_VERSION,
    description: t('suggestDescription'),
  },
  activate(ctx) {
    ctx.terminal.addon({
      kinds: ['ssh'],
      attach: (host) => {
        const suggestions = attachSuggestions(host)
        return () => suggestions.dispose()
      },
    })
  },
}

export const editorPlugin: BuiltinPlugin = {
  manifest: {
    id: 'gx.editor',
    name: t('editorName'),
    version: BUILTIN_VERSION,
    description: t('editorDescription'),
  },
  activate(ctx) {
    ctx.services.provide('editor', { open: editInternal })
  },
}
