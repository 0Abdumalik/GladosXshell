import { button, confirmDialog } from '../../dialogs'
import { field, h, setFieldError } from '../../dom'
import { ltr, messages } from '../../i18n'
import { common } from '../../i18n-common'
import { activeSession, allSessions } from '../../sessions'
import { openSettings } from '../../settings'
import type { Section } from '../../settings-layout'
import type { BuiltinPlugin, Dispose, PluginContext, TerminalHost } from '../api'
import {
  describeScript,
  type Keystroke,
  MAX_MACROS,
  MAX_SCRIPT,
  type Macro,
  OutputMatcher,
  parseMacros,
  parseScript,
  recordingToScript,
  type Step,
} from './macros-model'
import { BUILTIN_VERSION } from './version'

const t = messages({
  macros: { zh: '宏', en: 'Macros', ug: 'ماكرو' },
  description: {
    zh: '录制或编写一串终端输入，可以在中间等待指定输出再继续，然后一键回放。在设置的“{section}”分区里管理。',
    en: 'Record or write a sequence of terminal input that can wait for given output along the way, then play it back in one step. Manage macros under {section} in settings.',
    ug: 'بىر يۈرۈش تېرمىنال كىرگۈزۈشىنى خاتىرىلەڭ ياكى يېزىڭ، ئارىلىقتا بەلگىلەنگەن چىقىشنى كۈتۈپ ئاندىن داۋاملاشتۇرالايدۇ، ئاندىن بىر چېكىپلا قايتا قويۇڭ. تەڭشەكتىكى «{section}» بۆلىكىدە باشقۇرىلىدۇ.',
  },
  intro: {
    zh: '把一串输入、等待和“等到输出出现某段文字再继续”存成宏，在命令面板（{prefix}…）、终端右键菜单或这里运行。宏只在当前终端里运行。',
    en: 'Save a sequence of input, waits and "continue once some text appears in the output" as a macro, then run it from the command palette ({prefix} …), the terminal context menu or here. A macro runs in the current terminal only.',
    ug: 'بىر يۈرۈش كىرگۈزۈش، كۈتۈش ۋە «چىقىشتا مەلۇم تېكىست كۆرۈنگەندە داۋاملاشتۇرۇش» نى ماكرو قىلىپ ساقلاپ، بۇيرۇق تاختىسى ({prefix} …)، تېرمىنالنىڭ ئوڭ كۇنۇپكا تىزىملىكى ياكى بۇ يەردە ئىجرا قىلىڭ. ماكرو پەقەت نۆۋەتتىكى تېرمىنالدىلا ئىجرا بولىدۇ.',
  },
  empty: {
    zh: '还没有宏。可以在终端右键菜单里选“{record}”，把一段操作录下来；也可以新建后直接写脚本。',
    en: 'No macros yet. Choose "{record}" in the terminal context menu to record what you do, or create one and write its script.',
    ug: 'تېخى ماكرو يوق. تېرمىنالنىڭ ئوڭ كۇنۇپكا تىزىملىكىدىن «{record}» نى تاللاپ مەشغۇلاتنى خاتىرىلىسىڭىز، ياكى يېڭىدىن قۇرۇپ قوليازمىسىنى ئۆزىڭىز يازسىڭىز بولىدۇ.',
  },
  untitled: { zh: '未命名宏', en: 'Untitled macro', ug: 'ئاتسىز ماكرو' },
  newMacro: { zh: '新建宏', en: 'New macro', ug: 'يېڭى ماكرو' },
  maxMacros: { zh: '最多 {max} 个宏', en: 'At most {max} macros', ug: 'ئەڭ كۆپ {max} ماكرو' },
  runIn: {
    zh: '在当前终端运行 {name}',
    en: 'Run {name} in the current terminal',
    ug: '{name} نى نۆۋەتتىكى تېرمىنالدا ئىجرا قىل',
  },
  edit: { zh: '编辑', en: 'Edit', ug: 'تەھرىرلە' },
  editName: { zh: '编辑 {name}', en: 'Edit {name}', ug: '{name} نى تەھرىرلە' },
  deleteName: { zh: '删除 {name}', en: 'Delete {name}', ug: '{name} نى ئۆچۈر' },
  deleteTitle: { zh: '删除宏', en: 'Delete macro', ug: 'ماكرونى ئۆچۈرۈش' },
  deleteConfirm: {
    zh: '删除宏「{name}」？',
    en: 'Delete macro "{name}"?',
    ug: '«{name}» ماكروسىنى ئۆچۈرەمسىز؟',
  },
  editTitle: { zh: '编辑：{name}', en: 'Edit: {name}', ug: 'تەھرىرلەش: {name}' },
  script: { zh: '脚本', en: 'Script', ug: 'قوليازما' },
  scriptHelp: {
    zh: '每行一步：line 文字（输入并回车）、send 文字（只输入，支持 \\r \\n \\t \\e \\xHH）、wait 毫秒、expect 文字（等输出里出现这段文字）、timeout 秒（之后的 expect 最多等多久，默认 10）。# 开头是注释。脚本以明文保存在本机，不要写密码。',
    en: 'One step per line: line TEXT (types it and presses Enter), send TEXT (only types it; \\r \\n \\t \\e \\xHH allowed), wait MS, expect TEXT (waits until the text appears in the output), timeout SECS (how long later expects wait, 10 by default). Lines starting with # are comments. Scripts are saved as plain text on this computer, so do not put passwords in them.',
    ug: 'ھەر قۇر بىر قەدەم: line تېكىست (كىرگۈزۈپ Enter نى باسىدۇ)، send تېكىست (پەقەت كىرگۈزىدۇ، \\r \\n \\t \\e \\xHH نى قوللايدۇ)، wait مىللىسېكۇنت، expect تېكىست (چىقىشتا بۇ تېكىست كۆرۈنگۈچە كۈتىدۇ)، timeout سېكۇنت (كېيىنكى expect نىڭ ئەڭ ئۇزۇن كۈتۈش ۋاقتى، كۆڭۈلدىكىسى 10). # بىلەن باشلانغان قۇر ئىزاھات. قوليازما بۇ كومپيۇتېردا ئوچۇق تېكىست ھالىتىدە ساقلىنىدۇ، ئىم يازماڭ.',
  },
  nameRequired: { zh: '请给宏起个名字', en: 'Give the macro a name', ug: 'ماكروغا ئات قويۇڭ' },
  recordingBadge: {
    zh: '正在录制宏 · {where}',
    en: 'Recording macro · {where}',
    ug: 'ماكرو خاتىرىلىنىۋاتىدۇ · {where}',
  },
  recordingTip: {
    zh: '点击停止录制。录制期间输入的内容（包括密码）会以明文写进宏。',
    en: 'Click to stop recording. Everything typed while recording, passwords included, goes into the macro as plain text.',
    ug: 'چېكىپ خاتىرىلەشنى توختىتىڭ. خاتىرىلەش جەريانىدا كىرگۈزۈلگەن ھەممە مەزمۇن (ئىممۇ بىللە) ماكروغا ئوچۇق تېكىست ھالىتىدە يېزىلىدۇ.',
  },
  runningBadge: {
    zh: '正在运行宏「{name}」',
    en: 'Running macro "{name}"',
    ug: '«{name}» ماكروسى ئىجرا بولۇۋاتىدۇ',
  },
  clickToStop: { zh: '点击停止', en: 'Click to stop', ug: 'چېكىپ توختىتىڭ' },
  noTerminalToRun: {
    zh: '请先切换到一个已连接的终端再运行宏。',
    en: 'Switch to a connected terminal to run a macro.',
    ug: 'ماكرو ئىجرا قىلىشتىن بۇرۇن ئۇلانغان بىر تېرمىنالغا ئالمىشىڭ.',
  },
  stillRunning: {
    zh: '宏「{name}」还在运行，先停止它。',
    en: 'Macro "{name}" is still running. Stop it first.',
    ug: '«{name}» ماكروسى تېخى ئىجرا بولۇۋاتىدۇ، ئاۋۋال ئۇنى توختىتىڭ.',
  },
  recordingHere: {
    zh: '这个终端正在录制宏，先停止录制。',
    en: 'This terminal is recording a macro. Stop recording first.',
    ug: 'بۇ تېرمىنالدا ماكرو خاتىرىلىنىۋاتىدۇ، ئاۋۋال خاتىرىلەشنى توختىتىڭ.',
  },
  scriptError: {
    zh: '宏「{name}」的脚本有错误：{error}',
    en: 'Macro "{name}" has a script error: {error}',
    ug: '«{name}» ماكروسىنىڭ قوليازمىسىدا خاتالىق بار: {error}',
  },
  finished: {
    zh: '宏「{name}」已运行完。',
    en: 'Macro "{name}" finished.',
    ug: '«{name}» ماكروسى ئىجرا بولۇپ بولدى.',
  },
  timedOut: {
    zh: '宏「{name}」停在等待“{text}”：超时没有出现。',
    en: 'Macro "{name}" stopped waiting for "{text}": it did not appear before the timeout.',
    ug: '«{name}» ماكروسى «{text}» نى كۈتۈپ توختاپ قالدى: ۋاقىت چېكى ئىچىدە كۆرۈنمىدى.',
  },
  terminalClosed: {
    zh: '终端已关闭，宏「{name}」已停止。',
    en: 'The terminal closed, so macro "{name}" stopped.',
    ug: 'تېرمىنال يېپىلدى، «{name}» ماكروسى توختىدى.',
  },
  stopped: {
    zh: '已停止宏「{name}」。',
    en: 'Stopped macro "{name}".',
    ug: '«{name}» ماكروسى توختىتىلدى.',
  },
  failed: {
    zh: '宏「{name}」出错：{error}',
    en: 'Macro "{name}" failed: {error}',
    ug: '«{name}» ماكروسىدا خاتالىق كۆرۈلدى: {error}',
  },
  noTerminalToRecord: {
    zh: '请先切换到一个已连接的终端再录制。',
    en: 'Switch to a connected terminal to record.',
    ug: 'خاتىرىلەشتىن بۇرۇن ئۇلانغان بىر تېرمىنالغا ئالمىشىڭ.',
  },
  alreadyRecording: {
    zh: '已经在录制了。',
    en: 'Already recording.',
    ug: 'ئاللىقاچان خاتىرىلەۋاتىدۇ.',
  },
  runningHere: {
    zh: '这个终端正在运行宏。',
    en: 'This terminal is running a macro.',
    ug: 'بۇ تېرمىنالدا ماكرو ئىجرا بولۇۋاتىدۇ.',
  },
  recordedClosed: {
    zh: '录制的终端已关闭，录制已取消。',
    en: 'The terminal being recorded closed. Recording cancelled.',
    ug: 'خاتىرىلىنىۋاتقان تېرمىنال يېپىلدى، خاتىرىلەش بىكار قىلىندى.',
  },
  recordingStarted: {
    zh: '开始录制宏，在这个终端里的输入都会记下来。再次执行“{stop}”结束录制。',
    en: 'Recording a macro. Everything you type in this terminal is recorded. Run "{stop}" to finish.',
    ug: 'ماكرو خاتىرىلەش باشلاندى، بۇ تېرمىنالدا كىرگۈزگەنلىرىڭىزنىڭ ھەممىسى خاتىرىلىنىدۇ. ئاخىرلاشتۇرۇش ئۈچۈن «{stop}» نى ئىجرا قىلىڭ.',
  },
  nothingRecorded: {
    zh: '没有录到任何输入，录制已取消。',
    en: 'Nothing was typed. Recording cancelled.',
    ug: 'ھېچقانداق كىرگۈزۈش خاتىرىلەنمىدى، خاتىرىلەش بىكار قىلىندى.',
  },
  tooManyToRecord: {
    zh: '最多 {max} 个宏，先删掉一些再录制。',
    en: 'You can have at most {max} macros. Delete some before recording.',
    ug: 'ئەڭ كۆپ {max} ماكرو بولىدۇ، خاتىرىلەشتىن بۇرۇن بەزىلىرىنى ئۆچۈرۈڭ.',
  },
  saveTitle: { zh: '保存宏', en: 'Save macro', ug: 'ماكرونى ساقلاش' },
  nameLabel: { zh: '宏的名称', en: 'Macro name', ug: 'ماكرو ئاتى' },
  defaultName: { zh: '宏 {n}', en: 'Macro {n}', ug: 'ماكرو {n}' },
  notSaved: {
    zh: '录制的宏没有保存。',
    en: 'The recorded macro was not saved.',
    ug: 'خاتىرىلەنگەن ماكرو ساقلانمىدى.',
  },
  saved: {
    zh: '已保存宏「{name}」，可以在设置的“{section}”里修改脚本。',
    en: 'Saved macro "{name}". You can edit its script under {section} in settings.',
    ug: '«{name}» ماكروسى ساقلاندى، تەڭشەكتىكى «{section}» بۆلىكىدە قوليازمىسىنى ئۆزگەرتەلەيسىز.',
  },
  noMacros: {
    zh: '还没有宏，可以先录制一个。',
    en: 'No macros yet. Record one first.',
    ug: 'تېخى ماكرو يوق، ئاۋۋال بىرنى خاتىرىلەڭ.',
  },
  pickMacro: {
    zh: '选择要运行的宏',
    en: 'Choose a macro to run',
    ug: 'ئىجرا قىلىدىغان ماكرونى تاللاڭ',
  },
  prefix: { zh: '宏：', en: 'Macros:', ug: 'ماكرو:' },
  runCommand: { zh: '宏：{name}', en: 'Macros: {name}', ug: 'ماكرو: {name}' },
  runPick: { zh: '宏：运行…', en: 'Macros: Run…', ug: 'ماكرو: ئىجرا قىل…' },
  startRecording: {
    zh: '宏：开始录制',
    en: 'Macros: Start recording',
    ug: 'ماكرو: خاتىرىلەشنى باشلا',
  },
  stop: { zh: '宏：停止', en: 'Macros: Stop', ug: 'ماكرو: توختات' },
  settings: { zh: '宏设置', en: 'Macro settings', ug: 'ماكرو تەڭشىكى' },
  stopRecordingMenu: {
    zh: '停止录制宏…',
    en: 'Stop recording macro…',
    ug: 'ماكرو خاتىرىلەشنى توختات…',
  },
  stopMacroMenu: { zh: '停止宏', en: 'Stop macro', ug: 'ماكرونى توختات' },
  runMacroMenu: { zh: '运行宏…', en: 'Run macro…', ug: 'ماكرو ئىجرا قىل…' },
  recordMacroMenu: { zh: '录制宏', en: 'Record macro', ug: 'ماكرو خاتىرىلە' },
})

const SECTION = 'macros'
const KINDS = ['local', 'ssh', 'telnet', 'serial']
const MAX_RECORDED = 5000

const title = (macro: Macro) => macro.name.trim() || t('untitled')

/** Terminals that are open now; each knows its session id. */
const hosts = new Set<TerminalHost>()
/** Called when a terminal goes away, so a run or recording on it stops. */
const closing = new Map<TerminalHost, Set<() => void>>()

function hostFor(sessionId: number | null): TerminalHost | null {
  if (sessionId === null) return null
  for (const host of hosts) if (host.sessionId() === sessionId) return host
  return null
}

function whereOf(host: TerminalHost): string {
  const id = host.sessionId()
  return allSessions().find((s) => s.id === id)?.title ?? common('terminal')
}

function onClose(host: TerminalHost, run: () => void): Dispose {
  let set = closing.get(host)
  if (!set) {
    set = new Set()
    closing.set(host, set)
  }
  set.add(run)
  return () => set.delete(run)
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    signal.addEventListener('abort', () => {
      clearTimeout(timer)
      reject(signal.reason)
    })
  })

class Timeout extends Error {}

/** Sends, waits and expects in order; rejects with the abort reason or a `Timeout`. */
async function play(steps: Step[], host: TerminalHost, signal: AbortSignal): Promise<void> {
  const matcher = new OutputMatcher()
  const decoder = new TextDecoder()
  let wake: (() => void) | null = null
  const stop = host.onOutput((bytes) => {
    matcher.feed(decoder.decode(bytes, { stream: true }))
    wake?.()
  })
  try {
    for (const step of steps) {
      signal.throwIfAborted()
      if (step.kind === 'send') {
        host.send(step.text)
      } else if (step.kind === 'wait') {
        await sleep(step.ms, signal)
      } else {
        const deadline = Date.now() + step.timeoutMs
        while (!matcher.take(step.text)) {
          const left = deadline - Date.now()
          if (left <= 0) throw new Timeout(step.text)
          await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(done, left)
            const abort = () => {
              clearTimeout(timer)
              reject(signal.reason)
            }
            function done() {
              wake = null
              signal.removeEventListener('abort', abort)
              resolve()
            }
            wake = () => {
              clearTimeout(timer)
              done()
            }
            signal.addEventListener('abort', abort, { once: true })
          })
        }
      }
    }
  } finally {
    stop()
  }
}

interface Store {
  macros: () => Macro[]
  save: (macros: Macro[]) => void
  run: (macro: Macro) => void
}

function buildSection(store: Store): Section {
  const list = h('ul', { class: 'settings-list macro-list', 'aria-label': t('macros') })
  const empty = h('p', { class: 'help', text: t('empty', { record: t('recordMacroMenu') }) })
  const add = button(
    t('newMacro'),
    () => edit({ id: crypto.randomUUID(), name: '', script: '' }, true),
    'primary',
  )
  const overview = h(
    'div',
    { class: 'macro-overview' },
    h('div', { class: 'settings-actions' }, add),
    empty,
    list,
  )
  const editor = h('form', { class: 'macro-editor', novalidate: true })
  editor.hidden = true

  const render = () => {
    const macros = store.macros()
    add.disabled = macros.length >= MAX_MACROS
    add.title = add.disabled ? t('maxMacros', { max: MAX_MACROS }) : ''
    empty.hidden = macros.length > 0
    list.replaceChildren(
      ...macros.map((macro) =>
        h(
          'li',
          { class: 'settings-row macro-row' },
          h(
            'span',
            { class: 'macro-main' },
            h('span', { class: 'settings-row-name', text: title(macro) }),
            h('span', { class: 'macro-meta', text: describeScript(macro.script) }),
          ),
          h('button', {
            type: 'button',
            class: 'button small quiet',
            text: common('run'),
            'aria-label': t('runIn', { name: title(macro) }),
            onclick: () => store.run(macro),
          }),
          h('button', {
            type: 'button',
            class: 'button small quiet',
            text: t('edit'),
            'aria-label': t('editName', { name: title(macro) }),
            onclick: () => edit(macro, false),
          }),
          h('button', {
            type: 'button',
            class: 'button small quiet',
            text: common('delete'),
            'aria-label': t('deleteName', { name: title(macro) }),
            onclick: async () => {
              const ok = await confirmDialog(
                t('deleteTitle'),
                t('deleteConfirm', { name: title(macro) }),
                common('delete'),
                true,
              )
              if (!ok) return
              store.save(store.macros().filter((m) => m.id !== macro.id))
              render()
            },
          }),
        ),
      ),
    )
  }

  const close = () => {
    editor.hidden = true
    editor.replaceChildren()
    overview.hidden = false
    render()
  }

  const edit = (macro: Macro, isNew: boolean) => {
    const name = h('input', {
      type: 'text',
      value: macro.name,
      spellcheck: 'false',
      autocomplete: 'off',
      maxlength: '100',
    })
    const script = h('textarea', {
      class: 'mono macro-script',
      rows: 12,
      spellcheck: 'false',
      maxlength: String(MAX_SCRIPT),
    })
    script.value = macro.script
    editor.replaceChildren(
      h('h3', { text: isNew ? t('newMacro') : t('editTitle', { name: title(macro) }) }),
      field(common('name'), name),
      field(t('script'), script, t('scriptHelp')),
      h(
        'div',
        { class: 'settings-actions' },
        h('button', { type: 'submit', class: 'button primary', text: common('save') }),
        button(common('cancel'), close),
      ),
    )
    editor.onsubmit = (event) => {
      event.preventDefault()
      setFieldError(name, '')
      setFieldError(script, '')
      if (!name.value.trim()) {
        setFieldError(name, t('nameRequired'))
        name.focus()
        return
      }
      const parsed = parseScript(script.value)
      if (!Array.isArray(parsed)) {
        setFieldError(script, parsed.message)
        script.focus()
        return
      }
      const next = { ...macro, name: name.value.trim(), script: script.value }
      const macros = store.macros()
      store.save(
        macros.some((m) => m.id === next.id)
          ? macros.map((m) => (m.id === next.id ? next : m))
          : [...macros, next],
      )
      close()
    }
    overview.hidden = true
    editor.hidden = false
    ;(name.value ? script : name).focus()
  }

  render()
  const element = h(
    'div',
    { class: 'settings-section' },
    h('h3', { text: t('macros') }),
    h('p', { class: 'help', text: t('intro', { prefix: t('prefix') }) }),
    overview,
    editor,
  )
  return {
    id: SECTION,
    label: t('macros'),
    element,
    refresh: () => {
      if (editor.hidden) render()
    },
  }
}

export const macrosPlugin: BuiltinPlugin = {
  manifest: {
    id: 'gx.macros',
    name: t('macros'),
    version: BUILTIN_VERSION,
    description: t('description', { section: t('macros') }),
  },
  activate(ctx: PluginContext) {
    let macros = parseMacros(ctx.storage.get('macros'))
    let running: { macro: Macro; host: TerminalHost; abort: AbortController } | null = null
    let recording: { host: TerminalHost; keys: Keystroke[]; stop: Dispose } | null = null
    let badge: Dispose | null = null
    let perMacro: Dispose[] = []

    const showBadge = () => {
      badge?.()
      badge = null
      if (recording) {
        badge = ctx.statusBar.set({
          id: 'macro-recording',
          text: t('recordingBadge', { where: whereOf(recording.host) }),
          icon: 'record',
          tone: 'error',
          title: t('recordingTip'),
          command: 'macros.stop',
          priority: 6,
        })
      } else if (running) {
        badge = ctx.statusBar.set({
          id: 'macro-running',
          text: t('runningBadge', { name: title(running.macro) }),
          icon: 'play',
          tone: 'info',
          title: t('clickToStop'),
          command: 'macros.stop',
          priority: 6,
        })
      }
    }

    const runOn = (macro: Macro, host: TerminalHost | null) => {
      if (!host) {
        ctx.ui.status(t('noTerminalToRun'), 'error')
        return
      }
      if (running) {
        ctx.ui.status(t('stillRunning', { name: title(running.macro) }), 'error')
        return
      }
      if (recording?.host === host) {
        ctx.ui.status(t('recordingHere'), 'error')
        return
      }
      const steps = parseScript(macro.script)
      if (!Array.isArray(steps)) {
        ctx.ui.status(t('scriptError', { name: title(macro), error: steps.message }), 'error')
        return
      }
      const abort = new AbortController()
      const me = { macro, host, abort }
      running = me
      const unhook = onClose(host, () => abort.abort('closed'))
      showBadge()
      play(steps, host, abort.signal)
        .then(
          () => ctx.ui.status(t('finished', { name: title(macro) })),
          (error: unknown) => {
            if (error instanceof Timeout) {
              ctx.ui.status(
                t('timedOut', { name: title(macro), text: ltr(error.message) }),
                'error',
              )
            } else if (error === 'closed') {
              ctx.ui.status(t('terminalClosed', { name: title(macro) }), 'error')
            } else if (error === 'stopped') {
              ctx.ui.status(t('stopped', { name: title(macro) }))
            } else {
              ctx.ui.status(t('failed', { name: title(macro), error: String(error) }), 'error')
            }
          },
        )
        .finally(() => {
          unhook()
          if (running === me) running = null
          showBadge()
        })
    }

    const activeHost = () => hostFor(activeSession()?.id ?? null)

    const startRecording = (host: TerminalHost | null) => {
      if (!host) {
        ctx.ui.status(t('noTerminalToRecord'), 'error')
        return
      }
      if (recording) {
        ctx.ui.status(t('alreadyRecording'), 'error')
        return
      }
      if (running?.host === host) {
        ctx.ui.status(t('runningHere'), 'error')
        return
      }
      const keys: Keystroke[] = []
      const input = host.onInput((data) => {
        if (keys.length < MAX_RECORDED) keys.push({ data, at: Date.now() })
      })
      const unhook = onClose(host, () => {
        stopAll()
        recording = null
        showBadge()
        ctx.ui.status(t('recordedClosed'), 'error')
      })
      recording = {
        host,
        keys,
        stop: () => {
          input()
          unhook()
        },
      }
      showBadge()
      ctx.ui.status(t('recordingStarted', { stop: t('stop') }))
      host.term.focus()
    }
    const stopAll = () => recording?.stop()

    const finishRecording = async () => {
      if (!recording) return
      const { keys, stop } = recording
      stop()
      recording = null
      showBadge()
      if (keys.length === 0) {
        ctx.ui.status(t('nothingRecorded'))
        return
      }
      if (macros.length >= MAX_MACROS) {
        ctx.ui.status(t('tooManyToRecord', { max: MAX_MACROS }), 'error')
        return
      }
      const fallback = t('defaultName', { n: macros.length + 1 })
      const name = await ctx.ui.prompt(t('saveTitle'), t('nameLabel'), fallback)
      if (name === null) {
        ctx.ui.status(t('notSaved'))
        return
      }
      const macro: Macro = {
        id: crypto.randomUUID(),
        name: name.trim().slice(0, 100) || fallback,
        script: recordingToScript(keys),
      }
      store.save([...macros, macro])
      ctx.ui.status(t('saved', { name: title(macro), section: t('macros') }))
    }

    const stop = () => {
      if (recording) void finishRecording()
      else running?.abort.abort('stopped')
    }

    const pick = async (host: TerminalHost | null) => {
      if (macros.length === 0) {
        ctx.ui.status(t('noMacros'))
        return
      }
      const chosen = await ctx.ui.pick(
        macros.map((m) => ({ label: title(m), detail: describeScript(m.script), value: m })),
        t('pickMacro'),
      )
      if (chosen) runOn(chosen, host)
    }

    const registerPerMacro = () => {
      for (const d of perMacro) d()
      perMacro = macros.map((macro) =>
        ctx.commands.register({
          id: `macros.run.${macro.id}`,
          title: t('runCommand', { name: title(macro) }),
          category: t('macros'),
          icon: 'play',
          run: () => runOn(macro, activeHost()),
        }),
      )
    }

    const store: Store = {
      macros: () => macros,
      save: (next) => {
        macros = next
        ctx.storage.set('macros', macros)
        registerPerMacro()
      },
      run: (macro) => runOn(macro, activeHost()),
    }
    registerPerMacro()

    ctx.terminal.addon({
      kinds: KINDS,
      attach: (host) => {
        hosts.add(host)
        return () => {
          hosts.delete(host)
          for (const run of [...(closing.get(host) ?? [])]) run()
          closing.delete(host)
        }
      },
    })
    ctx.settings.section({ id: SECTION, label: t('macros'), build: () => buildSection(store) })

    ctx.commands.register({
      id: 'macros.run',
      title: t('runPick'),
      category: t('macros'),
      icon: 'play',
      run: () => pick(activeHost()),
    })
    ctx.commands.register({
      id: 'macros.record',
      title: t('startRecording'),
      category: t('macros'),
      icon: 'record',
      run: () => startRecording(activeHost()),
      enabled: () => recording === null,
    })
    ctx.commands.register({
      id: 'macros.stop',
      title: t('stop'),
      category: t('macros'),
      icon: 'stop',
      run: stop,
      enabled: () => recording !== null || running !== null,
    })
    ctx.commands.register({
      id: 'macros.settings',
      title: t('settings'),
      category: t('macros'),
      icon: 'list-bullets',
      run: () => openSettings(`plugin-${SECTION}`),
    })
    ctx.menus.contribute('terminal/context', ({ sessionId, live }) => {
      if (!live) return []
      const host = hostFor(sessionId)
      if (!host) return []
      if (recording?.host === host) {
        return [
          { label: t('stopRecordingMenu'), icon: 'stop', action: () => void finishRecording() },
        ]
      }
      if (running?.host === host) {
        return [
          {
            label: t('stopMacroMenu'),
            icon: 'stop',
            action: () => running?.abort.abort('stopped'),
          },
        ]
      }
      return [
        {
          label: t('runMacroMenu'),
          icon: 'play',
          disabled: macros.length === 0,
          action: () => void pick(host),
        },
        {
          label: t('recordMacroMenu'),
          icon: 'record',
          disabled: recording !== null,
          action: () => startRecording(host),
        },
      ]
    })

    ctx.subscriptions.add(() => {
      running?.abort.abort('stopped')
      recording?.stop()
      recording = null
      badge?.()
      for (const d of perMacro) d()
    })
  },
}
