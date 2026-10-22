import { messages } from '../../i18n'
import type { MenuItem } from '../../menu'
import { activeSession, allSessions, onCwd, type SessionInfo } from '../../sessions'
import type { BuiltinPlugin, TerminalHost } from '../api'
import { service } from '../registry'
import { BUILTIN_VERSION } from './version'

const t = messages({
  name: {
    zh: '文件面板跟随终端目录',
    en: 'Files panel follows terminal folder',
    ug: 'ھۆججەت تاختىسى تېرمىنال قىسقۇچىغا ئەگىشىدۇ',
  },
  description: {
    zh: '终端里 cd 到哪个目录，文件面板就打开哪个目录。需要 shell 在提示符里报告当前目录（OSC 7）；没有报告的终端可以在右键菜单里一键开启，只对这次登录有效。',
    en: 'The files panel opens whatever folder you cd to in the terminal. The shell has to report its current folder at the prompt (OSC 7); for a terminal that does not, turn it on from the context menu in one click, for this login only.',
    ug: 'تېرمىنالدا cd بىلەن قايسى قىسقۇچقا كىرسىڭىز، ھۆججەت تاختىسى شۇ قىسقۇچنى ئاچىدۇ. shell نىڭ بۇيرۇق كۆرسەتكۈچىدە نۆۋەتتىكى قىسقۇچنى مەلۇم قىلىشى (OSC 7) كېرەك؛ مەلۇم قىلمايدىغان تېرمىنالدا ئوڭ كۇنۇپكا تىزىملىكىدىن بىر چېكىپلا ئاچقىلى بولىدۇ، پەقەت بۇ قېتىملىق كىرىشتىلا كۈچكە ئىگە.',
  },
  followOn: {
    zh: '文件面板会跟随终端的当前目录。',
    en: 'The files panel now follows the terminal folder.',
    ug: 'ھۆججەت تاختىسى تېرمىنالنىڭ نۆۋەتتىكى قىسقۇچىغا ئەگىشىدۇ.',
  },
  followOff: {
    zh: '文件面板不再跟随终端目录。',
    en: 'The files panel no longer follows the terminal folder.',
    ug: 'ھۆججەت تاختىسى ئەمدى تېرمىنال قىسقۇچىغا ئەگەشمەيدۇ.',
  },
  fullScreen: {
    zh: '终端正在运行全屏程序，请先退出它，回到命令提示符再开启。',
    en: 'A full-screen program is running in the terminal. Quit it and turn this on at the command prompt.',
    ug: 'تېرمىنالدا پۈتۈن ئېكرانلىق پروگرامما ئىجرا بولۇۋاتىدۇ، ئاۋۋال ئۇنىڭدىن چېكىنىپ، بۇيرۇق كۆرسەتكۈچىگە قايتقاندىن كېيىن ئېچىڭ.',
  },
  toggle: {
    zh: '文件面板：跟随终端目录（开/关）',
    en: 'Files panel: Follow terminal folder (on/off)',
    ug: 'ھۆججەت تاختىسى: تېرمىنال قىسقۇچىغا ئەگەش (ئاچ/ياپ)',
  },
  files: { zh: '文件', en: 'Files', ug: 'ھۆججەت' },
  hookActive: {
    zh: '为当前终端开启目录跟踪',
    en: 'Turn on folder tracking for the current terminal',
    ug: 'نۆۋەتتىكى تېرمىنال ئۈچۈن قىسقۇچ ئىزلاشنى ئاچ',
  },
  hookThis: {
    zh: '为此终端开启目录跟踪',
    en: 'Turn on folder tracking for this terminal',
    ug: 'بۇ تېرمىنال ئۈچۈن قىسقۇچ ئىزلاشنى ئاچ',
  },
  follow: { zh: '跟随终端目录', en: 'Follow terminal folder', ug: 'تېرمىنال قىسقۇچىغا ئەگەش' },
})

/**
 * Makes bash or zsh report its directory (OSC 7) at every prompt, for this shell only. The leading
 * space keeps it out of history where HISTCONTROL ignores such lines; running it twice is harmless.
 */
export const CWD_HOOK = [
  ` __gx_cwd(){ printf '\\033]7;file://%s%s\\007' "\${HOSTNAME:-$HOST}" "$PWD";}`,
  'if [ -n "$ZSH_VERSION" ];then precmd_functions+=(__gx_cwd)',
  `else case "$PROMPT_COMMAND" in *__gx_cwd*);;*)PROMPT_COMMAND="__gx_cwd\${PROMPT_COMMAND:+;$PROMPT_COMMAND}";;esac;fi`,
].join(';')

const live = (info: SessionInfo | undefined): info is SessionInfo & { id: number } =>
  !!info && info.kind === 'ssh' && info.state === 'live' && info.id !== null

export const filesFollowPlugin: BuiltinPlugin = {
  manifest: {
    id: 'gx.files-follow',
    name: t('name'),
    version: BUILTIN_VERSION,
    description: t('description'),
  },
  activate(ctx) {
    const hosts = new Set<TerminalHost>()
    const hostOf = (sessionId: number) => [...hosts].find((h) => h.sessionId() === sessionId)
    let follow = ctx.storage.get<boolean>('follow') ?? true

    const show = (info: SessionInfo) => {
      if (follow && live(info) && info.cwd) void service('files')?.show(info.id, info.cwd)
    }

    const setFollow = (on: boolean) => {
      follow = on
      ctx.storage.set('follow', on)
      if (on) for (const info of allSessions()) show(info)
      ctx.ui.status(on ? t('followOn') : t('followOff'))
    }

    const enableHook = (sessionId: number) => {
      const host = hostOf(sessionId)
      if (!host) return
      if (host.term.buffer.active.type === 'alternate') {
        ctx.ui.status(t('fullScreen'), 'error')
        return
      }
      host.send(`${CWD_HOOK}\r`)
    }

    ctx.subscriptions.add(onCwd(show))
    ctx.terminal.addon({
      kinds: ['ssh'],
      attach: (host) => {
        hosts.add(host)
        return () => hosts.delete(host)
      },
    })

    ctx.commands.register({
      id: 'files.follow.toggle',
      title: t('toggle'),
      category: t('files'),
      icon: 'folder-simple',
      run: () => setFollow(!follow),
    })
    ctx.commands.register({
      id: 'files.follow.hook',
      title: t('hookActive'),
      category: t('files'),
      icon: 'folder-simple',
      enabled: () => {
        const info = activeSession() ?? undefined
        return live(info) && !!hostOf(info.id)
      },
      run: () => {
        const info = activeSession() ?? undefined
        if (live(info)) enableHook(info.id)
      },
    })

    const hookItem = (sessionId: number | null): MenuItem[] => {
      const info = allSessions().find((s) => s.id === sessionId)
      if (!live(info) || info.cwd || !hostOf(info.id)) return []
      return [
        {
          label: t('hookThis'),
          icon: 'folder-simple',
          action: () => enableHook(info.id),
        },
      ]
    }
    ctx.menus.contribute('files/background', ({ sessionId }) => [
      { label: t('follow'), checked: follow, action: () => setFollow(!follow) },
      ...hookItem(sessionId),
    ])
    ctx.menus.contribute('terminal/context', ({ sessionId }) => hookItem(sessionId))
  },
}
