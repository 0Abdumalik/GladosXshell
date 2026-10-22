import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import { confirmDialog } from '../dialogs'
import { h, setStatus, uniqueId } from '../dom'
import { messages } from '../i18n'
import { common } from '../i18n-common'
import { namedIcon } from '../icons'
import type { Section } from '../settings-layout'
import {
  type ExternalState,
  externalConfigValue,
  externalSettings,
  externalStates,
  installExternal,
  onExternalChange,
  reloadExternal,
  removeExternal,
  restartExternal,
  revokePermission,
  setExternalConfig,
  setExternalEnabled,
} from './external'
import { type DeclaredSetting, describePermission } from './external-model'
import { onPluginsChange, type PluginState, pluginStates, setPluginEnabled } from './host'
import { runCommand } from './registry'

type Report = (error: unknown) => void

const t = messages({
  required: {
    zh: '核心功能，不能停用',
    en: "Core feature, can't be disabled",
    ug: 'يادرولۇق ئىقتىدار، چەكلىگىلى بولمايدۇ',
  },
  startFailed: { zh: '启动失败', en: 'Failed to start', ug: 'قوزغىتالمىدى' },
  starting: { zh: '启动中', en: 'Starting', ug: 'قوزغىلىۋاتىدۇ' },
  enabled: { zh: '已启用', en: 'Enabled', ug: 'قوزغىتىلغان' },
  disabled: { zh: '已停用', en: 'Disabled', ug: 'چەكلەنگەن' },
  failed: { zh: '出错', en: 'Failed', ug: 'خاتالىق كۆرۈلدى' },
  running: { zh: '运行中', en: 'Running', ug: 'ئىجرا بولۇۋاتىدۇ' },
  enable: { zh: '启用 {name}', en: 'Enable {name}', ug: '{name} نى قوزغات' },
  builtin: { zh: '内置', en: 'Built-in', ug: 'ئىچكى' },
  granted: { zh: '已授权', en: 'Granted', ug: 'رۇخسەت قىلىنغان' },
  askOnUse: { zh: '使用时询问', en: 'Ask when used', ug: 'ئىشلەتكەندە سورايدۇ' },
  revoke: { zh: '撤销', en: 'Revoke', ug: 'بىكار قىل' },
  revokeLabel: {
    zh: '撤销权限：{permission}',
    en: 'Revoke permission: {permission}',
    ug: 'ھوقۇقنى بىكار قىل: {permission}',
  },
  removeTitle: { zh: '移除插件', en: 'Remove plugin', ug: 'قىستۇرمىنى چىقىرىۋەت' },
  removeText: {
    zh: '移除插件“{name}”？它的文件、授权和保存的数据都会删除。',
    en: 'Remove plugin "{name}"? Its files, permissions and saved data are deleted.',
    ug: '«{name}» قىستۇرمىسىنى چىقىرىۋېتەمسىز؟ ئۇنىڭ ھۆججەتلىرى، ھوقۇقلىرى ۋە ساقلانغان سانلىق مەلۇماتلىرى ئۆچۈرۈلىدۇ.',
  },
  restart: { zh: '重启', en: 'Restart', ug: 'قايتا قوزغات' },
  chooseFolder: {
    zh: '选择插件文件夹',
    en: 'Choose a plugin folder',
    ug: 'قىستۇرما قىسقۇچىنى تاللاش',
  },
  chooseFile: { zh: '选择插件文件', en: 'Choose a plugin file', ug: 'قىستۇرما ھۆججىتىنى تاللاش' },
  fileType: {
    zh: 'GladosXshell 插件',
    en: 'GladosXshell plugin',
    ug: 'GladosXshell قىستۇرمىسى',
  },
  installed: {
    zh: '已安装插件 {name} {version}',
    en: 'Installed plugin {name} {version}',
    ug: '{name} {version} قىستۇرمىسى ئورنىتىلدى',
  },
  noExternal: {
    zh: '还没有安装第三方插件。',
    en: 'No third-party plugins installed yet.',
    ug: 'تېخى ئۈچىنچى تەرەپ قىستۇرمىسى ئورنىتىلمىدى.',
  },
  guide: {
    zh: '插件开发指南',
    en: 'Plugin developer guide',
    ug: 'قىستۇرما ئېچىش قوللانمىسى',
  },
  collapseAll: { zh: '全部收起', en: 'Collapse all', ug: 'ھەممىنى يىغ' },
  builtinHeading: { zh: '内置插件', en: 'Built-in plugins', ug: 'ئىچكى قىستۇرمىلار' },
  builtinHelp: {
    zh: '停用后对应的面板、菜单项、命令和快捷键会一起移除，面板的位置设置会保留。',
    en: 'Disabling a plugin removes its panels, menu items, commands and shortcuts. Panel positions are kept.',
    ug: 'چەكلىگەندىن كېيىن ئۇنىڭغا تەۋە تاختا، تىزىملىك تۈرى، بۇيرۇق ۋە تېزلەتمە كۇنۇپكىلار بىللە چىقىرىۋېتىلىدۇ، تاختىلارنىڭ ئورۇن تەڭشىكى ساقلىنىدۇ.',
  },
  externalHeading: {
    zh: '第三方插件',
    en: 'Third-party plugins',
    ug: 'ئۈچىنچى تەرەپ قىستۇرمىلىرى',
  },
  externalHelp: {
    zh: '第三方插件在沙箱中运行，只能使用清单里声明、并且经过你同意的功能。',
    en: 'Third-party plugins run in a sandbox and can only use features declared in their manifest that you have allowed.',
    ug: 'ئۈچىنچى تەرەپ قىستۇرمىلىرى قۇم ساندۇقىدا ئىجرا بولىدۇ، پەقەت تىزىملىكىدە ئېلان قىلىنغان ھەمدە سىز قوشۇلغان ئىقتىدارلارنىلا ئىشلىتەلەيدۇ.',
  },
  installFolder: { zh: '从文件夹安装…', en: 'Install from folder…', ug: 'قىسقۇچتىن ئورنات…' },
  installFile: { zh: '从文件安装…', en: 'Install from file…', ug: 'ھۆججەتتىن ئورنات…' },
  openFolder: { zh: '打开插件目录', en: 'Open plugins folder', ug: 'قىستۇرما قىسقۇچىنى ئاچ' },
  section: { zh: '插件', en: 'Plugins', ug: 'قىستۇرما' },
})

function stateText(state: PluginState): string {
  if (state.manifest.required) return t('required')
  if (state.error) return t('startFailed')
  if (state.enabled && !state.active) return t('starting')
  return state.enabled ? t('enabled') : t('disabled')
}

interface RowParts {
  /** Key in the section's set of expanded rows. */
  key: string
  name: string
  meta: string
  description: string
  state: string
  error: string | null
  enabled: boolean
  locked: boolean
  onToggle: (enabled: boolean) => void
  details?: (Node | null)[]
}

/** One line per plugin; the summary opens to show the rest. */
function pluginItem(row: RowParts, expanded: Set<string>): HTMLElement {
  const details = h(
    'details',
    { class: 'plugin-details', open: expanded.has(row.key) },
    h(
      'summary',
      { class: 'plugin-summary' },
      h('span', { class: 'plugin-name', text: row.name }),
      h('span', { class: 'plugin-desc', text: row.description }),
      h('span', { class: 'plugin-state', text: row.state }),
    ),
    h(
      'div',
      { class: 'plugin-body' },
      h('span', { class: 'plugin-meta mono', text: row.meta }),
      row.error ? h('span', { class: 'plugin-error', text: row.error }) : null,
      row.details ?? [],
    ),
  )
  details.addEventListener('toggle', () => {
    if (details.open) expanded.add(row.key)
    else expanded.delete(row.key)
  })
  return h(
    'li',
    { class: 'settings-row plugin-row', 'data-error': row.error ? 'true' : null },
    h('input', {
      type: 'checkbox',
      class: 'plugin-toggle',
      checked: row.enabled,
      disabled: row.locked,
      'aria-label': t('enable', { name: row.name }),
      onchange: (e: Event) => row.onToggle((e.target as HTMLInputElement).checked),
    }),
    details,
  )
}

function pluginRow(state: PluginState, expanded: Set<string>, report: Report): HTMLElement {
  const { manifest } = state
  return pluginItem(
    {
      key: `builtin:${manifest.id}`,
      name: manifest.name,
      meta: [manifest.version, t('builtin'), manifest.id].join(' · '),
      description: manifest.description ?? '',
      state: stateText(state),
      error: state.error ?? null,
      enabled: state.enabled,
      locked: manifest.required ?? false,
      onToggle: (on) => void setPluginEnabled(manifest.id, on).catch(report),
    },
    expanded,
  )
}

function externalStateText(state: ExternalState): string {
  if (state.error) return t('failed')
  if (!state.enabled) return t('disabled')
  return state.active ? t('running') : t('starting')
}

function settingControl(id: string, setting: DeclaredSetting, report: Report): HTMLElement {
  const controlId = uniqueId('plugin-setting')
  const save = (value: unknown) => setExternalConfig(id, setting, value).catch(report)
  let input: HTMLInputElement
  if (setting.type === 'boolean') {
    input = h('input', {
      type: 'checkbox',
      id: controlId,
      onchange: () => void save(input.checked),
    })
  } else {
    input = h('input', {
      type: setting.type === 'number' ? 'number' : 'text',
      id: controlId,
      spellcheck: 'false',
      autocomplete: 'off',
      onchange: () => {
        if (setting.type === 'string') return void save(input.value)
        const value = Number(input.value)
        if (input.value.trim() !== '' && Number.isFinite(value)) void save(value)
      },
    })
  }
  void externalConfigValue(id, setting)
    .then((value) => {
      if (input.type === 'checkbox') input.checked = value === true
      else input.value = String(value)
    })
    .catch(report)
  const described = setting.description ? `${controlId}-desc` : null
  if (described) input.setAttribute('aria-describedby', described)
  return h(
    'div',
    { class: 'plugin-setting' },
    h('label', { for: controlId, text: setting.title }),
    input,
    described
      ? h('span', { class: 'plugin-desc', id: described, text: setting.description })
      : null,
  )
}

function permissionList(state: ExternalState, report: Report): HTMLElement | null {
  const declared = state.manifest?.permissions ?? []
  const all = [...new Set([...declared, ...state.granted])]
  if (all.length === 0) return null
  return h(
    'ul',
    { class: 'plugin-permissions', 'aria-label': common('permissions') },
    all.map((permission) => {
      const granted = state.granted.includes(permission)
      return h(
        'li',
        {},
        h('span', { class: 'grow', text: describePermission(permission) }),
        h('span', { class: 'plugin-meta', text: granted ? t('granted') : t('askOnUse') }),
        granted
          ? h('button', {
              type: 'button',
              class: 'button quiet',
              text: t('revoke'),
              'aria-label': t('revokeLabel', { permission: describePermission(permission) }),
              onclick: () => void revokePermission(state.id, permission).catch(report),
            })
          : null,
      )
    }),
  )
}

function externalRow(state: ExternalState, expanded: Set<string>, report: Report): HTMLElement {
  const { manifest } = state
  const name = manifest?.name ?? state.id
  const meta = [manifest?.version, manifest?.author, state.id].filter(Boolean).join(' · ')
  const settingsList = state.manifest ? externalSettings(state.id) : []
  const remove = async () => {
    const yes = await confirmDialog(
      t('removeTitle'),
      t('removeText', { name }),
      common('remove'),
      true,
    )
    if (yes) await removeExternal(state.id)
  }
  return pluginItem(
    {
      key: `external:${state.id}`,
      name,
      meta,
      description: manifest?.description ?? '',
      state: externalStateText(state),
      error: state.error,
      enabled: state.enabled && manifest !== null,
      locked: manifest === null,
      onToggle: (on) => void setExternalEnabled(state.id, on).catch(report),
      details: [
        state.problems.length > 0
          ? h(
              'ul',
              { class: 'plugin-problems' },
              state.problems.map((p) => h('li', { text: p })),
            )
          : null,
        permissionList(state, report),
        settingsList.length > 0 && state.enabled
          ? h(
              'div',
              { class: 'plugin-settings' },
              settingsList.map((s) => settingControl(state.id, s, report)),
            )
          : null,
        h(
          'div',
          { class: 'plugin-actions' },
          h('button', {
            type: 'button',
            class: 'button quiet',
            text: t('restart'),
            disabled: !state.enabled || manifest === null,
            onclick: () => void restartExternal(state.id).catch(report),
          }),
          h('button', {
            type: 'button',
            class: 'button quiet danger',
            text: common('remove'),
            onclick: () => void remove().catch(report),
          }),
        ),
      ],
    },
    expanded,
  )
}

async function installFrom(directory: boolean, report: Report): Promise<void> {
  const chosen = await open({
    directory,
    multiple: false,
    title: directory ? t('chooseFolder') : t('chooseFile'),
    filters: directory ? undefined : [{ name: t('fileType'), extensions: ['gxplugin', 'zip'] }],
  })
  if (typeof chosen !== 'string') return
  try {
    const manifest = await installExternal(chosen)
    setStatus(t('installed', { name: manifest.name, version: manifest.version }))
  } catch (error) {
    report(error)
  }
}

export function pluginsSection(report: Report): Section {
  const builtin = h('ul', { class: 'settings-list' })
  const external = h('ul', { class: 'settings-list' })
  const empty = h('p', { class: 'help', text: t('noExternal') })
  const expanded = new Set<string>()
  const refresh = () => {
    const states = pluginStates()
    builtin.replaceChildren(
      ...states.filter((s) => s.builtin).map((state) => pluginRow(state, expanded, report)),
    )
    const others = externalStates()
    external.replaceChildren(...others.map((state) => externalRow(state, expanded, report)))
    empty.hidden = others.length > 0
  }
  const collapseAll = () => {
    expanded.clear()
    for (const details of element.querySelectorAll<HTMLDetailsElement>('.plugin-details')) {
      details.open = false
    }
  }
  const element: HTMLElement = h(
    'div',
    { class: 'settings-section' },
    h(
      'div',
      { class: 'settings-actions' },
      h(
        'button',
        {
          type: 'button',
          class: 'button',
          onclick: () => void runCommand('guide.open').catch(report),
        },
        namedIcon('book-open'),
        t('guide'),
      ),
      h('span', { class: 'grow' }),
      h('button', {
        type: 'button',
        class: 'button quiet',
        text: t('collapseAll'),
        onclick: collapseAll,
      }),
    ),
    h('h3', { text: t('builtinHeading') }),
    h('p', { class: 'help', text: t('builtinHelp') }),
    builtin,
    h('h3', { text: t('externalHeading') }),
    h('p', { class: 'help', text: t('externalHelp') }),
    h(
      'div',
      { class: 'settings-actions' },
      h('button', {
        type: 'button',
        class: 'button',
        text: t('installFolder'),
        onclick: () => void installFrom(true, report),
      }),
      h('button', {
        type: 'button',
        class: 'button',
        text: t('installFile'),
        onclick: () => void installFrom(false, report),
      }),
      h('span', { class: 'grow' }),
      h('button', {
        type: 'button',
        class: 'button quiet',
        text: t('openFolder'),
        onclick: () => void invoke('plugins_open_dir').catch(report),
      }),
      h('button', {
        type: 'button',
        class: 'button quiet',
        text: common('reload'),
        onclick: () => void reloadExternal().catch(report),
      }),
    ),
    empty,
    external,
  )
  refresh()
  const unsubscribe = onPluginsChange(refresh)
  const unsubscribeExternal = onExternalChange(refresh)
  return {
    id: 'plugins',
    label: t('section'),
    element,
    refresh,
    dispose: () => {
      unsubscribe()
      unsubscribeExternal()
    },
  }
}
