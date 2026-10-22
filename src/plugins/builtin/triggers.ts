import { getCurrentWindow, UserAttentionType } from '@tauri-apps/api/window'
import type { IMarker } from '@xterm/xterm'
import { logApp } from '../../applog'
import { button, confirmDialog } from '../../dialogs'
import { field, h, setFieldError } from '../../dom'
import { joinList, ltr, messages } from '../../i18n'
import { common } from '../../i18n-common'
import { activeSession, allSessions, markTab, onActive, type SessionInfo } from '../../sessions'
import { openSettings } from '../../settings'
import type { Section } from '../../settings-layout'
import type { BuiltinPlugin, Dispose, PluginContext, TerminalHost } from '../api'
import { cellMatches, cellText, everyMatch, MAX_LINES_PER_PASS } from '../terminal-addons'
import {
  COLORS,
  type CompiledTrigger,
  compileRule,
  compileRules,
  describeActions,
  FireGuard,
  inScope,
  MAX_RULES,
  newRule,
  parseRules,
  type TriggerRule,
} from './triggers-model'
import { BUILTIN_VERSION } from './version'

const t = messages({
  triggers: { zh: '触发器', en: 'Triggers', ug: 'قوزغاتقۇچ' },
  description: {
    zh: '终端输出匹配到指定文字或正则表达式时，高亮这段文字、发出提醒，或自动发送一段输入。在设置的“{section}”分区里管理规则。',
    en: 'When terminal output matches given text or a regular expression, highlight it, notify you or auto-send some input. Manage the rules under {section} in settings.',
    ug: 'تېرمىنال چىقىشى بەلگىلەنگەن تېكىست ياكى مۇنتىزىم ئىپادىگە ماس كەلگەندە، ئۇنى گەۋدىلەندۈرىدۇ، ئۇقتۇرىدۇ ياكى بىر بۆلەك كىرگۈزۈشنى ئاپتوماتىك يوللايدۇ. قائىدىلەر تەڭشەكتىكى «{section}» بۆلىكىدە باشقۇرىلىدۇ.',
  },
  intro: {
    zh: '终端输出里出现指定内容时，自动高亮、提醒或发送一段输入。规则对所有已打开和新打开的终端立即生效。',
    en: 'When given text shows up in terminal output, highlight it, notify you or send some input. Rules apply right away to every open and newly opened terminal.',
    ug: 'تېرمىنال چىقىشىدا بەلگىلەنگەن مەزمۇن كۆرۈلگەندە، ئاپتوماتىك گەۋدىلەندۈرىدۇ، ئۇقتۇرىدۇ ياكى بىر بۆلەك كىرگۈزۈشنى يوللايدۇ. قائىدىلەر ئېچىلغان ۋە يېڭىدىن ئېچىلىدىغان بارلىق تېرمىناللاردا دەرھال كۈچكە ئىگە بولىدۇ.',
  },
  notifyStatus: {
    zh: '触发器「{name}」· {where}：{text}',
    en: 'Trigger "{name}" · {where}: {text}',
    ug: '«{name}» قوزغاتقۇچى · {where}: {text}',
  },
  notifyLog: {
    zh: '触发器「{name}」在 {where} 匹配：{text}',
    en: 'Trigger "{name}" matched in {where}: {text}',
    ug: '«{name}» قوزغاتقۇچى ماس كەلدى ({where}): {text}',
  },
  mark: { zh: '提醒', en: 'Alert', ug: 'ئەسكەرتىش' },
  repeated: {
    zh: '触发器「{name}」在 10 秒内反复触发，已在 {where} 里停用，重新打开标签后恢复。可能是自动发送的内容又匹配了它。',
    en: 'Trigger "{name}" fired again and again within 10 seconds, so it is off in {where} until the tab is reopened. Its auto-send text may be matching it again.',
    ug: '«{name}» قوزغاتقۇچى 10 سېكۇنت ئىچىدە قايتا-قايتا قوزغالغاچقا، {where} تېرمىنالىدا چەكلەندى، بەتكۈچنى قايتا ئاچسىڭىز ئەسلىگە كېلىدۇ. ئاپتوماتىك يوللانغان مەزمۇن ئۇنىڭغا يەنە ماس كەلگەن بولۇشى مۇمكىن.',
  },
  empty: {
    zh: '还没有触发器。可以让终端在出现 error 时高亮并提醒，或在看到 “{example}” 这类提示时自动回答。',
    en: 'No triggers yet. A trigger can highlight and notify when "error" appears, or answer prompts such as "{example}" for you.',
    ug: 'تېخى قوزغاتقۇچ يوق. تېرمىنالدا error كۆرۈلگەندە گەۋدىلەندۈرۈپ ئۇقتۇرىدىغان، ياكى «{example}» غا ئوخشاش سوئاللارغا ئاپتوماتىك جاۋاب بېرىدىغان قىلالايسىز.',
  },
  pauseAll: {
    zh: '暂停所有触发器',
    en: 'Pause all triggers',
    ug: 'بارلىق قوزغاتقۇچلارنى ۋاقتىنچە توختات',
  },
  newTrigger: { zh: '新建触发器', en: 'New trigger', ug: 'يېڭى قوزغاتقۇچ' },
  maxRules: {
    zh: '最多 {max} 个触发器',
    en: 'At most {max} triggers',
    ug: 'ئەڭ كۆپ {max} قوزغاتقۇچ',
  },
  enableName: { zh: '启用 {name}', en: 'Enable {name}', ug: '{name} نى قوزغات' },
  onlyHosts: { zh: '仅 {hosts}', en: 'Only {hosts}', ug: 'پەقەت {hosts}' },
  edit: { zh: '编辑', en: 'Edit', ug: 'تەھرىرلە' },
  editName: { zh: '编辑 {name}', en: 'Edit {name}', ug: '{name} نى تەھرىرلە' },
  deleteName: { zh: '删除 {name}', en: 'Delete {name}', ug: '{name} نى ئۆچۈر' },
  deleteTitle: { zh: '删除触发器', en: 'Delete trigger', ug: 'قوزغاتقۇچنى ئۆچۈرۈش' },
  deleteConfirm: {
    zh: '删除触发器「{name}」？',
    en: 'Delete trigger "{name}"?',
    ug: '«{name}» قوزغاتقۇچىنى ئۆچۈرەمسىز؟',
  },
  namePlaceholder: {
    zh: '留空时显示匹配内容',
    en: 'Leave empty to show the match text',
    ug: 'بوش قويسىڭىز ماسلاش مەزمۇنى كۆرسىتىلىدۇ',
  },
  noHighlight: { zh: '不高亮', en: 'No highlight', ug: 'گەۋدىلەندۈرمەسلىك' },
  example: { zh: '例如 {example}', en: 'e.g. {example}', ug: 'مەسىلەن {example}' },
  samplePlaceholder: {
    zh: '粘贴一行终端输出，看看是否匹配',
    en: 'Paste a line of terminal output to see if it matches',
    ug: 'ماس كېلىش-كەلمەسلىكىنى كۆرۈش ئۈچۈن تېرمىنال چىقىشىدىن بىر قۇر چاپلاڭ',
  },
  matched: { zh: '匹配：{text}', en: 'Match: {text}', ug: 'ماس كەلدى: {text}' },
  noMatch: { zh: '不匹配', en: 'No match', ug: 'ماس كەلمىدى' },
  editTitle: { zh: '编辑：{name}', en: 'Edit: {name}', ug: 'تەھرىرلەش: {name}' },
  matchText: { zh: '匹配内容', en: 'Match text', ug: 'ماسلاش مەزمۇنى' },
  matchHelp: {
    zh: '对每一行终端输出查找这段文字。全屏程序（{programs} 等）运行时不检查。',
    en: 'Looks for this text in every line of terminal output. Not checked while a full-screen program such as {programs} is running.',
    ug: 'تېرمىنال چىقىشىنىڭ ھەر بىر قۇرىدىن بۇ تېكىستنى ئىزدەيدۇ. پۈتۈن ئېكرانلىق پروگرامما ({programs} قاتارلىقلار) ئىجرا بولۇۋاتقاندا تەكشۈرمەيدۇ.',
  },
  regex: { zh: '正则表达式', en: 'Regular expression', ug: 'مۇنتىزىم ئىپادە' },
  caseSensitive: { zh: '区分大小写', en: 'Match case', ug: 'چوڭ-كىچىك ھەرپنى پەرقلەندۈر' },
  test: { zh: '测试', en: 'Test', ug: 'سىناق' },
  actions: { zh: '动作', en: 'Actions', ug: 'ھەرىكەت' },
  highlightColor: { zh: '高亮颜色', en: 'Highlight color', ug: 'گەۋدىلەندۈرۈش رەڭگى' },
  asBackground: {
    zh: '改为背景色',
    en: 'Color the background instead',
    ug: 'ئورنىغا تەگلىكنى بويا',
  },
  notify: { zh: '提醒', en: 'Notify', ug: 'ئۇقتۇرۇش' },
  notifyHelp: {
    zh: '在状态栏显示这一行并写入通用日志；标签不在前台时加上“{mark}”标记，窗口不在前台时闪烁任务栏。',
    en: 'Shows the line in the status bar and adds it to the app log. A tab in the background gets an "{mark}" badge, and the taskbar flashes when the window is not in front.',
    ug: 'بۇ قۇرنى ھالەت بالدىقىدا كۆرسىتىپ، ئومۇمىي خاتىرىگە يازىدۇ؛ بەتكۈچ ئالدىدا بولمىسا «{mark}» بەلگىسى قوشۇلىدۇ، كۆزنەك ئالدىدا بولمىسا ۋەزىپە بالدىقى چاقنايدۇ.',
  },
  autoSend: { zh: '自动发送', en: 'Auto-send', ug: 'ئاپتوماتىك يوللاش' },
  autoSendHelp: {
    zh: '匹配后输入这段内容，支持 \\r \\n \\t 和 \\xHH（\\x03 是 Ctrl+C）。以明文保存在本机，不要填写密码。',
    en: 'Typed after a match; \\r \\n \\t and \\xHH are allowed (\\x03 is Ctrl+C). Saved as plain text on this computer, so do not enter passwords.',
    ug: 'ماس كەلگەندىن كېيىن بۇ مەزمۇن كىرگۈزۈلىدۇ، \\r \\n \\t ۋە \\xHH نى قوللايدۇ (\\x03 بولسا Ctrl+C). بۇ كومپيۇتېردا ئوچۇق تېكىست ھالىتىدە ساقلىنىدۇ، ئىم تولدۇرماڭ.',
  },
  pressEnter: {
    zh: '发送后按回车',
    en: 'Press Enter after sending',
    ug: 'يوللىغاندىن كېيىن Enter نى باس',
  },
  scope: { zh: '范围', en: 'Scope', ug: 'دائىرە' },
  hosts: { zh: '适用服务器', en: 'Servers', ug: 'ماس كېلىدىغان مۇلازىمېتىر' },
  hostsHelp: {
    zh: '逗号分隔，支持 * 和 ?，可以写主机名或 用户@主机。留空则对所有终端生效，包括本地终端。',
    en: 'Comma-separated; * and ? are allowed. Use a host name or user@host. Leave empty to apply to every terminal, local ones included.',
    ug: 'پەش بىلەن ئايرىلىدۇ، * ۋە ? نى قوللايدۇ، ئاساسىي ماشىنا ئاتى ياكى ئىشلەتكۈچى@ئاساسىي ماشىنا يېزىشقا بولىدۇ. بوش قويسىڭىز يەرلىك تېرمىنالنى ئۆز ئىچىگە ئالغان بارلىق تېرمىناللاردا كۈچكە ئىگە بولىدۇ.',
  },
  paused: { zh: '触发器已暂停', en: 'Triggers paused', ug: 'قوزغاتقۇچلار ۋاقتىنچە توختىتىلدى' },
  clickToResume: {
    zh: '点击恢复触发器',
    en: 'Click to resume triggers',
    ug: 'چېكىپ قوزغاتقۇچلارنى داۋاملاشتۇرۇڭ',
  },
  pausedStatus: {
    zh: '触发器已暂停。',
    en: 'Triggers paused.',
    ug: 'قوزغاتقۇچلار ۋاقتىنچە توختىتىلدى.',
  },
  resumedStatus: {
    zh: '触发器已恢复。',
    en: 'Triggers resumed.',
    ug: 'قوزغاتقۇچلار داۋاملاشتۇرۇلدى.',
  },
  settings: { zh: '触发器设置', en: 'Trigger settings', ug: 'قوزغاتقۇچ تەڭشىكى' },
  pauseOrResume: {
    zh: '触发器：暂停或恢复',
    en: 'Triggers: Pause or resume',
    ug: 'قوزغاتقۇچ: ۋاقتىنچە توختات ياكى داۋاملاشتۇر',
  },
  fromSelection: {
    zh: '用选中的文字新建触发器…',
    en: 'New trigger from selection…',
    ug: 'تاللانغان تېكىستتىن قوزغاتقۇچ قۇر…',
  },
})

const MARK = 'trigger'
const SECTION = 'triggers'

interface Active extends CompiledTrigger {
  every: RegExp
}

const title = (rule: TriggerRule) => rule.name.trim() || rule.pattern
const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}…` : text)
const sessionOf = (host: TerminalHost): SessionInfo | undefined => {
  const id = host.sessionId()
  return id === null ? undefined : allSessions().find((info) => info.id === id)
}

/** Tabs carrying the reminder mark; cleared when the user looks at them. */
const marked = new Set<number>()
let listening = false

function clearMark(key: number): void {
  if (!marked.delete(key)) return
  markTab(key, MARK, null)
}

function clearActiveMark(): void {
  const info = activeSession()
  if (info && document.hasFocus()) clearMark(info.key)
}

/** Runs the rules over one terminal's output: colours finished lines, fires each rule once per line. */
function watch(host: TerminalHost, rules: () => Active[], ctx: PluginContext): Dispose {
  const { term } = host
  const markers = new Set<IMarker>()
  const guard = new FireGuard()
  /** Rules switched off in this terminal because they kept firing. */
  const stopped = new Set<string>()
  let done: IMarker | undefined
  /** The line the cursor is on and the rules that already fired on it. */
  let open: { marker: IMarker; fired: Set<string> } | null = null

  const notify = (rule: TriggerRule, text: string) => {
    const info = sessionOf(host)
    const where = info?.title ?? common('terminal')
    ctx.ui.status(
      t('notifyStatus', { name: clip(title(rule), 40), where, text: ltr(clip(text, 120)) }),
    )
    logApp('info', t('notifyLog', { name: title(rule), where, text: ltr(clip(text, 300)) }))
    const focused = document.hasFocus()
    if (info && (!focused || activeSession()?.key !== info.key)) {
      marked.add(info.key)
      markTab(info.key, MARK, t('mark'))
    }
    if (!focused) {
      getCurrentWindow()
        .requestUserAttention(UserAttentionType.Informational)
        .catch(() => {})
    }
  }

  const fire = (rule: Active, text: string) => {
    const verdict = guard.check(rule.rule.id, Date.now())
    if (verdict === 'wait') return
    if (verdict === 'stop') {
      stopped.add(rule.rule.id)
      const where = sessionOf(host)?.title ?? common('terminal')
      const message = t('repeated', { name: title(rule.rule), where })
      ctx.ui.status(message, 'error')
      logApp('warn', message)
      return
    }
    if (rule.input) host.send(rule.input)
    if (rule.rule.notify) notify(rule.rule, text)
  }

  const scan = () => {
    const buffer = term.buffer.active
    if (buffer.type === 'alternate') return
    const cursor = buffer.baseY + buffer.cursorY
    const target = sessionOf(host)?.target ?? null
    const live = rules().filter((r) => !stopped.has(r.rule.id) && inScope(r.hosts, target))
    // A marker keeps its line while old output is trimmed from the top.
    const resume = done && !done.isDisposed && done.line >= 0 ? done.line : cursor - term.rows
    const from = Math.max(0, resume, cursor - MAX_LINES_PER_PASS)
    for (let y = from; y < cursor && live.length > 0; y++) {
      const line = buffer.getLine(y)
      if (!line) continue
      const cells = cellText(line, term)
      const text = cells.text.trim()
      if (!text) continue
      const fired = open && !open.marker.isDisposed && open.marker.line === y ? open.fired : null
      for (const rule of live) {
        if (rule.foreground || rule.background) {
          for (const [x, width] of cellMatches(cells, rule.every)) {
            const marker = term.registerMarker(y - cursor)
            if (!marker) continue
            markers.add(marker)
            marker.onDispose(() => markers.delete(marker))
            term.registerDecoration({
              marker,
              x,
              width,
              foregroundColor: rule.foreground,
              backgroundColor: rule.background,
            })
          }
        }
        if (rule.acts && !fired?.has(rule.rule.id) && rule.pattern.test(cells.text)) {
          fire(rule, text)
        }
      }
    }
    if (open && (open.marker.isDisposed || open.marker.line !== cursor)) {
      open.marker.dispose()
      open = null
    }
    // Prompts wait on the cursor line without a newline, so actions also look there.
    const current = buffer.getLine(cursor)?.translateToString(true) ?? ''
    if (current.trim()) {
      for (const rule of live) {
        if (!rule.acts || open?.fired.has(rule.rule.id) || !rule.pattern.test(current)) continue
        if (!open) {
          const marker = term.registerMarker(0)
          if (marker) open = { marker, fired: new Set() }
        }
        open?.fired.add(rule.rule.id)
        fire(rule, current.trim())
      }
    }
    done?.dispose()
    done = term.registerMarker(0)
  }

  const subscription = term.onWriteParsed(scan)
  return () => {
    subscription.dispose()
    done?.dispose()
    open?.marker.dispose()
    for (const marker of [...markers]) marker.dispose()
  }
}

interface Store {
  rules: () => TriggerRule[]
  save: (rules: TriggerRule[]) => void
  paused: () => boolean
  setPaused: (on: boolean) => void
}

/** The open settings section; `create` starts the editor on a new rule. */
interface LiveSection {
  create: (pattern: string) => void
}
let section: LiveSection | null = null

function check(checked: boolean): HTMLInputElement {
  return h('input', { type: 'checkbox', checked })
}

function text(value: string, attrs: Record<string, string> = {}): HTMLInputElement {
  return h('input', { type: 'text', value, spellcheck: 'false', autocomplete: 'off', ...attrs })
}

function buildSection(store: Store): Section {
  const list = h('ul', { class: 'settings-list trigger-list', 'aria-label': t('triggers') })
  const empty = h('p', { class: 'help', text: t('empty', { example: ltr('[y/N]') }) })
  const pause = check(store.paused())
  pause.addEventListener('change', () => store.setPaused(pause.checked))
  const add = button(t('newTrigger'), () => edit(newRule(crypto.randomUUID()), true), 'primary')
  const overview = h(
    'div',
    { class: 'trigger-overview' },
    h(
      'div',
      { class: 'settings-actions' },
      add,
      h('span', { class: 'grow' }),
      h('label', { class: 'check' }, pause, t('pauseAll')),
    ),
    empty,
    list,
  )
  const editor = h('form', { class: 'trigger-editor', novalidate: true })
  editor.hidden = true

  const render = () => {
    const rules = store.rules()
    pause.checked = store.paused()
    add.disabled = rules.length >= MAX_RULES
    add.title = add.disabled ? t('maxRules', { max: MAX_RULES }) : ''
    empty.hidden = rules.length > 0
    list.replaceChildren(
      ...rules.map((rule) => {
        const enabled = check(rule.enabled)
        enabled.setAttribute('aria-label', t('enableName', { name: title(rule) }))
        enabled.addEventListener('change', () => {
          store.save(
            store.rules().map((r) => (r.id === rule.id ? { ...r, enabled: enabled.checked } : r)),
          )
        })
        const hosts = rule.hosts.trim()
        const meta = [...describeActions(rule), hosts ? t('onlyHosts', { hosts: ltr(hosts) }) : '']
        return h(
          'li',
          { class: 'settings-row trigger-row', 'data-disabled': rule.enabled ? null : '' },
          enabled,
          h(
            'span',
            { class: 'trigger-main' },
            h('span', { class: 'settings-row-name', text: title(rule) }),
            h(
              'span',
              { class: 'trigger-meta' },
              h('span', { class: 'mono', text: rule.regex ? `/${rule.pattern}/` : rule.pattern }),
              ...meta.filter(Boolean).map((m) => h('span', { text: m })),
            ),
          ),
          h('button', {
            type: 'button',
            class: 'button small quiet',
            text: t('edit'),
            'aria-label': t('editName', { name: title(rule) }),
            onclick: () => edit(rule, false),
          }),
          h('button', {
            type: 'button',
            class: 'button small quiet',
            text: common('delete'),
            'aria-label': t('deleteName', { name: title(rule) }),
            onclick: async () => {
              const ok = await confirmDialog(
                t('deleteTitle'),
                t('deleteConfirm', { name: title(rule) }),
                common('delete'),
                true,
              )
              if (ok) store.save(store.rules().filter((r) => r.id !== rule.id))
            },
          }),
        )
      }),
    )
  }

  const close = () => {
    editor.hidden = true
    editor.replaceChildren()
    overview.hidden = false
    render()
  }

  const edit = (rule: TriggerRule, isNew: boolean) => {
    const name = text(rule.name, { placeholder: t('namePlaceholder') })
    const pattern = text(rule.pattern, { class: 'mono' })
    const regex = check(rule.regex)
    const caseSensitive = check(rule.caseSensitive)
    const color = h(
      'select',
      {},
      h('option', { value: '', text: t('noHighlight'), selected: rule.color === null }),
      Object.entries(COLORS).map(([id, c]) =>
        h('option', { value: id, text: c.label, selected: rule.color === id }),
      ),
    )
    const background = check(rule.background)
    const notify = check(rule.notify)
    const send = text(rule.send, { class: 'mono', placeholder: t('example', { example: 'yes' }) })
    const enter = check(rule.enter)
    const hosts = text(rule.hosts, {
      placeholder: t('example', { example: ltr('*.prod.example.com, root@10.0.0.*') }),
    })
    const sample = text('', { placeholder: t('samplePlaceholder') })
    const verdict = h('p', { class: 'help trigger-verdict', 'aria-live': 'polite' })
    const actionsError = h('p', { class: 'field-error', role: 'alert' })

    const read = (): TriggerRule => ({
      ...rule,
      name: name.value.trim(),
      pattern: pattern.value,
      regex: regex.checked,
      caseSensitive: caseSensitive.checked,
      color: color.value || null,
      background: background.checked,
      notify: notify.checked,
      send: send.value,
      enter: enter.checked,
      hosts: hosts.value.trim(),
    })
    const test = () => {
      const line = sample.value
      if (!line) {
        verdict.textContent = ''
        return
      }
      const compiled = compileRule({ ...read(), color: 'red' })
      if (!('rule' in compiled)) {
        verdict.textContent = compiled.field === 'pattern' ? compiled.message : ''
        return
      }
      const match = compiled.pattern.exec(line)
      verdict.textContent = match ? t('matched', { text: ltr(match[0]) }) : t('noMatch')
      verdict.dataset.tone = match ? 'ok' : ''
    }
    for (const control of [pattern, regex, caseSensitive, sample]) {
      control.addEventListener('input', test)
    }
    const syncColor = () => {
      background.disabled = !color.value
    }
    color.addEventListener('change', syncColor)
    syncColor()

    editor.replaceChildren(
      h('h3', { text: isNew ? t('newTrigger') : t('editTitle', { name: title(rule) }) }),
      field(common('name'), name),
      field(
        t('matchText'),
        pattern,
        t('matchHelp', { programs: joinList(['vim', 'top'].map(ltr)) }),
      ),
      h(
        'div',
        { class: 'trigger-checks' },
        h('label', { class: 'check' }, regex, t('regex')),
        h('label', { class: 'check' }, caseSensitive, t('caseSensitive')),
      ),
      field(t('test'), sample),
      verdict,
      h('h3', { text: t('actions') }),
      h(
        'div',
        { class: 'field-row trigger-color' },
        field(t('highlightColor'), color),
        h('label', { class: 'check' }, background, t('asBackground')),
      ),
      h(
        'div',
        { class: 'field' },
        h('label', { class: 'check' }, notify, t('notify')),
        h('p', { class: 'help', text: t('notifyHelp', { mark: t('mark') }) }),
      ),
      field(
        t('autoSend'),
        send,
        t('autoSendHelp'),
        h('label', { class: 'check' }, enter, t('pressEnter')),
      ),
      actionsError,
      h('h3', { text: t('scope') }),
      field(t('hosts'), hosts, t('hostsHelp')),
      h(
        'div',
        { class: 'settings-actions' },
        h('button', { type: 'submit', class: 'button primary', text: common('save') }),
        button(common('cancel'), close),
      ),
    )
    editor.onsubmit = (event) => {
      event.preventDefault()
      setFieldError(pattern, '')
      setFieldError(send, '')
      actionsError.textContent = ''
      const next = read()
      const compiled = compileRule(next)
      if (!('rule' in compiled)) {
        if (compiled.field === 'actions') actionsError.textContent = compiled.message
        else setFieldError(compiled.field === 'pattern' ? pattern : send, compiled.message)
        ;(compiled.field === 'send' ? send : compiled.field === 'pattern' ? pattern : color).focus()
        return
      }
      const rules = store.rules()
      store.save(
        rules.some((r) => r.id === next.id)
          ? rules.map((r) => (r.id === next.id ? next : r))
          : [...rules, next],
      )
      close()
    }
    overview.hidden = true
    editor.hidden = false
    ;(isNew && !rule.pattern ? pattern : name).focus()
    if (isNew && rule.pattern) {
      sample.value = rule.pattern
      test()
    }
  }

  section = { create: (p) => edit(newRule(crypto.randomUUID(), p), true) }
  render()
  const element = h(
    'div',
    { class: 'settings-section' },
    h('h3', { text: t('triggers') }),
    h('p', { class: 'help', text: t('intro') }),
    overview,
    editor,
  )
  return {
    id: SECTION,
    label: t('triggers'),
    element,
    refresh: () => {
      if (editor.hidden) render()
    },
    dispose: () => {
      section = null
    },
  }
}

export const triggersPlugin: BuiltinPlugin = {
  manifest: {
    id: 'gx.triggers',
    name: t('triggers'),
    version: BUILTIN_VERSION,
    description: t('description', { section: t('triggers') }),
  },
  activate(ctx) {
    let rules = parseRules(ctx.storage.get('rules'))
    let paused = ctx.storage.get<boolean>('paused') ?? false
    let active: Active[] = []
    let status: Dispose | null = null

    const update = () => {
      active = compileRules(rules).map((r) => ({ ...r, every: everyMatch(r.pattern) }))
      status?.()
      status = null
      if (paused && rules.some((r) => r.enabled)) {
        status = ctx.statusBar.set({
          id: 'triggers-paused',
          text: t('paused'),
          icon: 'pause',
          tone: 'warn',
          title: t('clickToResume'),
          command: 'triggers.pause',
          priority: 5,
        })
      }
    }
    const store: Store = {
      rules: () => rules,
      save: (next) => {
        rules = next
        ctx.storage.set('rules', rules)
        update()
      },
      paused: () => paused,
      setPaused: (on) => {
        paused = on
        ctx.storage.set('paused', on)
        update()
        ctx.ui.status(on ? t('pausedStatus') : t('resumedStatus'))
      },
    }
    update()

    if (!listening) {
      listening = true
      onActive(clearActiveMark)
      window.addEventListener('focus', clearActiveMark)
    }

    ctx.terminal.addon({
      kinds: ['local', 'ssh', 'telnet', 'serial'],
      attach: (host) => watch(host, () => (paused ? [] : active), ctx),
    })
    ctx.settings.section({ id: SECTION, label: t('triggers'), build: () => buildSection(store) })

    const openWith = (pattern: string | null) => {
      openSettings(`plugin-${SECTION}`)
      if (pattern !== null) section?.create(pattern)
    }
    ctx.commands.register({
      id: 'triggers.settings',
      title: t('settings'),
      category: common('terminal'),
      icon: 'lightning',
      run: () => openWith(null),
    })
    ctx.commands.register({
      id: 'triggers.pause',
      title: t('pauseOrResume'),
      category: common('terminal'),
      icon: 'pause',
      run: () => store.setPaused(!paused),
    })
    ctx.menus.contribute('terminal/context', ({ selection }) => {
      const line =
        selection
          .split(/\r?\n/)
          .find((l) => l.trim())
          ?.trim() ?? ''
      if (!line) return []
      return [
        {
          label: t('fromSelection'),
          icon: 'lightning',
          action: () => openWith(line.slice(0, 500)),
        },
      ]
    })

    ctx.subscriptions.add(() => {
      status?.()
      for (const key of [...marked]) clearMark(key)
      section = null
    })
  },
}
