import { invoke } from '@tauri-apps/api/core'
import { writeText } from '@tauri-apps/plugin-clipboard-manager'
import { button, confirmDialog, modal, promptDialog } from './dialogs'
import { field, h, reportError, setStatus } from './dom'
import { messages, pl } from './i18n'
import { common } from './i18n-common'
import { icon } from './icons'
import { openImportDialog } from './import-dialog'
import type { PanelHost } from './layout'
import { type MenuItem, showMenu } from './menu'
import { menuItems } from './plugins/registry'
import {
  connectServers,
  matchesServer,
  onProfiles,
  profiles,
  reloadProfiles,
  serverTitle,
} from './profiles-store'
import type { Group, Profiles, ServerView } from './protocol'
import { openServerDialog } from './server-dialog'

const t = messages({
  groupNameRequired: {
    zh: '请输入分组名称',
    en: 'Enter a group name',
    ug: 'گۇرۇپپا ئاتىنى كىرگۈزۈڭ',
  },
  groupNameTooLong: {
    zh: '分组名称不能超过 64 个字符',
    en: "Group name can't be longer than 64 characters",
    ug: 'گۇرۇپپا ئاتى 64 ھەرپتىن ئاشماسلىقى كېرەك',
  },
  newGroup: { zh: '新建分组', en: 'New group', ug: 'يېڭى گۇرۇپپا' },
  groupName: { zh: '分组名称', en: 'Group name', ug: 'گۇرۇپپا ئاتى' },
  renameGroup: { zh: '重命名分组', en: 'Rename group', ug: 'گۇرۇپپا ئاتىنى ئۆزگەرت' },
  deleteGroupMoves: {
    zh: '删除分组「{name}」？其中的 {n} 台服务器会移到「未分组」，不会被删除。',
    en: (p) =>
      `Delete group "${p.name}"? Its ${pl('server')(p)} will move to "Ungrouped" and won't be deleted.`,
    ug: '«{name}» گۇرۇپپىسىنى ئۆچۈرەمسىز؟ ئۇنىڭدىكى {n} مۇلازىمېتىر «گۇرۇپپىسىز» غا يۆتكىلىدۇ، ئۆچۈرۈلمەيدۇ.',
  },
  deleteGroupAsk: {
    zh: '删除分组「{name}」？',
    en: 'Delete group "{name}"?',
    ug: '«{name}» گۇرۇپپىسىنى ئۆچۈرەمسىز؟',
  },
  deleteGroup: { zh: '删除分组', en: 'Delete group', ug: 'گۇرۇپپىنى ئۆچۈر' },
  deleteServer: { zh: '删除服务器', en: 'Delete server', ug: 'مۇلازىمېتىرنى ئۆچۈر' },
  deleteServerAsk: {
    zh: '删除「{name}」？已保存的密码也会一起删除。',
    en: 'Delete "{name}"? Its saved password is deleted too.',
    ug: '«{name}» نى ئۆچۈرەمسىز؟ ساقلانغان ئىممۇ بىللە ئۆچۈرۈلىدۇ.',
  },
  deleted: { zh: '已删除 {name}', en: 'Deleted {name}', ug: '{name} ئۆچۈرۈلدى' },
  duplicated: { zh: '已复制为 {name}', en: 'Duplicated as {name}', ug: '{name} قىلىپ كۆپەيتىلدى' },
  moveMany: {
    zh: '移动 {n} 台服务器',
    en: (p) => `Move ${pl('server')(p)}`,
    ug: '{n} مۇلازىمېتىرنى يۆتكەش',
  },
  moveToGroup: { zh: '移动到分组', en: 'Move to group', ug: 'گۇرۇپپىغا يۆتكەش' },
  targetGroup: { zh: '目标分组', en: 'Target group', ug: 'نىشان گۇرۇپپا' },
  move: { zh: '移动', en: 'Move', ug: 'يۆتكە' },
  connect: { zh: '连接', en: 'Connect', ug: 'ئۇلا' },
  edit: { zh: '编辑…', en: 'Edit…', ug: 'تەھرىرلە…' },
  duplicate: { zh: '创建副本', en: 'Duplicate', ug: 'كۆپەيت' },
  copyAddress: { zh: '复制地址', en: 'Copy address', ug: 'ئادرېسنى كۆچۈر' },
  moveToGroupItem: { zh: '移动到分组…', en: 'Move to group…', ug: 'گۇرۇپپىغا يۆتكە…' },
  connectAll: { zh: '全部连接（{n}）', en: 'Connect all ({n})', ug: 'ھەممىگە ئۇلا ({n})' },
  newInGroup: {
    zh: '在此分组新建连接…',
    en: 'New connection in this group…',
    ug: 'بۇ گۇرۇپپىدا يېڭى ئۇلىنىش…',
  },
  renameItem: { zh: '重命名…', en: 'Rename…', ug: 'ئات ئۆزگەرت…' },
  selectServer: { zh: '选择 {name}', en: 'Select {name}', ug: '{name} نى تاللا' },
  selectGroup: {
    zh: '选择分组 {name} 的全部服务器',
    en: 'Select all servers in {name}',
    ug: '{name} گۇرۇپپىسىدىكى بارلىق مۇلازىمېتىرلارنى تاللا',
  },
  empty: {
    zh: '还没有保存的服务器。保存后可以一键连接，也可以按分组批量连接。',
    en: 'No saved servers yet. Once saved, a server connects in one click, or a whole group at once.',
    ug: 'تېخى ساقلانغان مۇلازىمېتىر يوق. ساقلىغاندىن كېيىن بىر چېكىپلا ئۇلىغىلى، گۇرۇپپا بويىچە تەڭ ئۇلىغىلىمۇ بولىدۇ.',
  },
  importOther: {
    zh: '从其他软件导入',
    en: 'Import from other apps',
    ug: 'باشقا يۇمشاق دېتالدىن ئەكىر',
  },
  searchPlaceholder: {
    zh: '搜索名称、主机、用户或备注',
    en: 'Search name, host, user or note',
    ug: 'ئات، ئاساسىي ماشىنا، ئىشلەتكۈچى ياكى ئىزاھ بويىچە ئىزدە',
  },
  deleteSelectedAsk: {
    zh: '删除选中的 {n} 台服务器？已保存的密码也会一起删除。',
    en: (p) => `Delete ${pl('selected server')(p)}? Their saved passwords are deleted too.`,
    ug: 'تاللانغان {n} مۇلازىمېتىرنى ئۆچۈرەمسىز؟ ساقلانغان ئىملارمۇ بىللە ئۆچۈرۈلىدۇ.',
  },
  deletedMany: {
    zh: '已删除 {n} 台服务器',
    en: (p) => `Deleted ${pl('server')(p)}`,
    ug: '{n} مۇلازىمېتىر ئۆچۈرۈلدى',
  },
  manager: { zh: '连接管理器', en: 'Connection manager', ug: 'ئۇلىنىش باشقۇرغۇچ' },
  searchServers: { zh: '搜索服务器', en: 'Search servers', ug: 'مۇلازىمېتىر ئىزدە' },
  savedServers: { zh: '已保存的服务器', en: 'Saved servers', ug: 'ساقلانغان مۇلازىمېتىرلار' },
  connectSelected: { zh: '连接选中', en: 'Connect selected', ug: 'تاللانغانغا ئۇلا' },
  moveSelected: { zh: '移动选中', en: 'Move selected', ug: 'تاللانغاننى يۆتكە' },
  deleteSelected: { zh: '删除选中', en: 'Delete selected', ug: 'تاللانغاننى ئۆچۈر' },
  selectedCount: { zh: '已选 {n} 台', en: '{n} selected', ug: '{n} تاللاندى' },
  searchSaved: {
    zh: '搜索已保存的服务器',
    en: 'Search saved servers',
    ug: 'ساقلانغان مۇلازىمېتىرلارنى ئىزدە',
  },
})

const UNGROUPED = ''

/** Collapsed group ids, shared by the manager and the docked panel. */
const collapsed = new Set<string>()

const report = reportError

interface TreeOptions {
  /** Checkbox selection (manager only). */
  selected?: Set<string>
  onSelection?: () => void
  /** Called after a connection starts from inside the tree. */
  onConnect?: () => void
}

function validGroupName(name: string): string {
  const value = name.trim()
  if (!value) return t('groupNameRequired')
  if ([...value].length > 64) return t('groupNameTooLong')
  return ''
}

export async function newGroup(): Promise<Group | null> {
  const name = await promptDialog(
    t('newGroup'),
    t('groupName'),
    '',
    common('create'),
    validGroupName,
  )
  if (name === null) return null
  const group = await invoke<Group>('group_save', { id: null, name: name.trim() })
  await reloadProfiles()
  return group
}

async function renameGroup(group: Group): Promise<void> {
  const name = await promptDialog(
    t('renameGroup'),
    t('groupName'),
    group.name,
    common('save'),
    validGroupName,
  )
  if (name === null || name.trim() === group.name) return
  await invoke('group_save', { id: group.id, name: name.trim() })
  await reloadProfiles()
}

async function deleteGroup(group: Group, count: number): Promise<void> {
  const message =
    count > 0
      ? t('deleteGroupMoves', { name: group.name, n: count })
      : t('deleteGroupAsk', { name: group.name })
  if (!(await confirmDialog(t('deleteGroup'), message, t('deleteGroup'), true))) return
  await invoke('group_delete', { id: group.id })
  await reloadProfiles()
}

async function deleteServer(server: ServerView): Promise<void> {
  const title = serverTitle(server)
  const ok = await confirmDialog(
    t('deleteServer'),
    t('deleteServerAsk', { name: title }),
    common('delete'),
    true,
  )
  if (!ok) return
  await invoke('profile_delete', { id: server.id })
  await reloadProfiles()
  setStatus(t('deleted', { name: title }))
}

async function duplicateServer(server: ServerView): Promise<void> {
  const copy = await invoke<ServerView>('profile_duplicate', { id: server.id })
  await reloadProfiles()
  setStatus(t('duplicated', { name: serverTitle(copy) }))
}
/** Asks for a target group; resolves undefined on cancel, '' for "ungrouped". */
function chooseGroup(count: number, current: string): Promise<string | undefined> {
  const title = count > 1 ? t('moveMany', { n: count }) : t('moveToGroup')
  const parts = modal('move-servers', title, 'sm')
  const select = h(
    'select',
    {},
    h('option', { value: UNGROUPED, text: common('ungrouped'), selected: current === UNGROUPED }),
    profiles().groups.map((g) =>
      h('option', { value: g.id, text: g.name, selected: g.id === current }),
    ),
  )
  parts.body.append(field(t('targetGroup'), select))
  let answer: string | undefined
  parts.actions.append(
    button(common('cancel'), () => parts.dialog.close()),
    button(
      t('move'),
      () => {
        answer = select.value
        parts.dialog.close()
      },
      'primary',
    ),
  )
  return new Promise((resolve) => {
    parts.dialog.addEventListener('close', () => {
      parts.dialog.remove()
      resolve(answer)
    })
    parts.dialog.showModal()
    select.focus()
  })
}

async function moveServers(servers: ServerView[]): Promise<void> {
  if (servers.length === 0) return
  const target = await chooseGroup(servers.length, servers[0].groupId ?? UNGROUPED)
  if (target === undefined) return
  await invoke('profiles_move', { ids: servers.map((s) => s.id), groupId: target || null })
  await reloadProfiles()
}

function serverMenu(server: ServerView, options: TreeOptions): MenuItem[] {
  return [
    {
      label: t('connect'),
      icon: 'plugs-connected',
      action: () => {
        options.onConnect?.()
        void connectServers([server])
      },
    },
    { label: t('edit'), icon: 'pencil-simple', action: () => openServerDialog(server) },
    { label: t('duplicate'), icon: 'copy', action: () => duplicateServer(server).catch(report) },
    {
      label: t('copyAddress'),
      icon: 'link',
      action: () => writeText(endpoint(server)).catch(report),
    },
    {
      label: t('moveToGroupItem'),
      icon: 'swap',
      action: () => moveServers([server]).catch(report),
    },
    ...menuItems('connections/server', {
      id: server.id,
      name: serverTitle(server),
      host: server.host,
      user: server.auth.user,
    }),
    'separator',
    {
      label: common('delete'),
      icon: 'trash',
      danger: true,
      action: () => deleteServer(server).catch(report),
    },
  ]
}

function groupMenu(group: Group | null, servers: ServerView[], options: TreeOptions): MenuItem[] {
  const items: MenuItem[] = [
    {
      label: t('connectAll', { n: servers.length }),
      icon: 'plugs-connected',
      disabled: servers.length === 0,
      action: () => {
        options.onConnect?.()
        void connectServers(servers)
      },
    },
    {
      label: t('newInGroup'),
      icon: 'plus',
      action: () => openServerDialog(null, group?.id ?? null),
    },
  ]
  if (group) {
    items.push({
      label: t('renameItem'),
      icon: 'pencil-simple',
      action: () => renameGroup(group).catch(report),
    })
  }
  items.push(
    ...menuItems('connections/group', {
      id: group?.id ?? null,
      name: group?.name ?? common('ungrouped'),
      servers: servers.map((s) => s.id),
    }),
  )
  if (group) {
    items.push('separator', {
      label: t('deleteGroup'),
      icon: 'trash',
      danger: true,
      action: () => deleteGroup(group, servers.length).catch(report),
    })
  }
  return items
}
function endpoint(server: ServerView): string {
  const port = server.port === 22 ? '' : `:${server.port}`
  return `${server.auth.user}@${server.host}${port}`
}

function serverRow(server: ServerView, options: TreeOptions): HTMLLIElement {
  const title = serverTitle(server)
  const connect = () => {
    options.onConnect?.()
    void connectServers([server])
  }
  const item = h(
    'button',
    { type: 'button', class: 'conn-item', 'data-id': server.id, title: server.note || null },
    h('span', { class: 'conn-name', text: title }),
    h('span', { class: 'conn-meta mono', text: endpoint(server) }),
  )
  item.addEventListener('dblclick', connect)
  item.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return
    event.preventDefault()
    connect()
  })
  item.addEventListener('contextmenu', (event) => {
    event.preventDefault()
    event.stopPropagation()
    showMenu(event.clientX, event.clientY, serverMenu(server, options))
  })
  const row = h('li', { class: 'conn-server' })
  const { selected } = options
  if (selected) {
    const box = h('input', {
      type: 'checkbox',
      class: 'conn-check',
      'data-server': server.id,
      checked: selected.has(server.id),
      'aria-label': t('selectServer', { name: title }),
    })
    box.addEventListener('change', () => {
      if (box.checked) selected.add(server.id)
      else selected.delete(server.id)
      options.onSelection?.()
    })
    item.addEventListener('click', () => box.click())
    row.append(box)
  }
  row.append(item)
  return row
}

function groupSection(
  group: Group | null,
  servers: ServerView[],
  options: TreeOptions,
  forceOpen: boolean,
): HTMLLIElement {
  const key = group?.id ?? UNGROUPED
  const name = group?.name ?? common('ungrouped')
  const expanded = forceOpen || !collapsed.has(key)
  const listId = `conn-group-${key || 'none'}-${options.selected ? 'm' : 'p'}`
  const toggle = h(
    'button',
    {
      type: 'button',
      class: 'conn-toggle',
      'data-group': key,
      'aria-expanded': String(expanded),
      'aria-controls': listId,
      onclick: () => {
        if (collapsed.has(key)) collapsed.delete(key)
        else collapsed.add(key)
        list.hidden = collapsed.has(key)
        toggle.setAttribute('aria-expanded', String(!list.hidden))
      },
    },
    h('span', { class: 'conn-caret', 'aria-hidden': 'true' }),
    h('span', { class: 'conn-group-name', text: name }),
    h('span', { class: 'conn-count num', text: String(servers.length) }),
  )
  toggle.addEventListener('contextmenu', (event) => {
    event.preventDefault()
    event.stopPropagation()
    showMenu(event.clientX, event.clientY, groupMenu(group, servers, options))
  })
  const list = h('ul', { class: 'conn-servers', id: listId, hidden: !expanded })
  list.append(...servers.map((s) => serverRow(s, options)))
  const head = h('div', { class: 'conn-group-head' })
  const { selected } = options
  if (selected) {
    const picked = servers.filter((s) => selected.has(s.id)).length
    const box = h('input', {
      type: 'checkbox',
      class: 'conn-check conn-group-check',
      checked: servers.length > 0 && picked === servers.length,
      disabled: servers.length === 0,
      'aria-label': t('selectGroup', { name }),
    })
    box.indeterminate = picked > 0 && picked < servers.length
    box.addEventListener('change', () => {
      for (const s of servers) {
        if (box.checked) selected.add(s.id)
        else selected.delete(s.id)
      }
      options.onSelection?.()
    })
    head.append(box)
  }
  head.append(toggle)
  return h('li', { class: 'conn-group', 'data-group': key }, head, list)
}
/** Renders the group tree into `list`; returns the servers that matched `query`. */
function renderTree(
  list: HTMLElement,
  data: Profiles,
  query: string,
  options: TreeOptions,
): ServerView[] {
  const focused = document.activeElement as HTMLElement | null
  const focusKey = list.contains(focused)
    ? (focused?.dataset.id ??
      (focused?.dataset.group !== undefined ? `g:${focused.dataset.group}` : null))
    : null
  const matched = data.servers.filter((s) => matchesServer(s, query))
  const searching = query.trim() !== ''
  const byGroup = new Map<string, ServerView[]>()
  for (const server of matched) {
    const key = server.groupId ?? UNGROUPED
    byGroup.set(key, [...(byGroup.get(key) ?? []), server])
  }
  const rows: HTMLElement[] = []
  for (const group of data.groups) {
    const servers = byGroup.get(group.id) ?? []
    if (searching && servers.length === 0) continue
    rows.push(groupSection(group, servers, options, searching))
  }
  const loose = byGroup.get(UNGROUPED) ?? []
  if (data.groups.length === 0) rows.push(...loose.map((s) => serverRow(s, options)))
  else if (loose.length > 0) rows.push(groupSection(null, loose, options, searching))
  list.replaceChildren(...rows)

  if (focusKey) {
    const selector = focusKey.startsWith('g:')
      ? `.conn-toggle[data-group="${CSS.escape(focusKey.slice(2))}"]`
      : `.conn-item[data-id="${CSS.escape(focusKey)}"]`
    list.querySelector<HTMLElement>(selector)?.focus()
  }
  return matched
}

function emptyState(onNew: () => void, onGroup: () => void): HTMLElement {
  return h(
    'div',
    { class: 'conn-empty' },
    h('p', { text: t('empty') }),
    h(
      'div',
      { class: 'conn-empty-actions' },
      button(common('newConnection'), onNew, 'primary'),
      button(t('newGroup'), onGroup),
      button(t('importOther'), openImportDialog),
    ),
  )
}

function searchBox(label: string): HTMLInputElement {
  return h('input', {
    type: 'search',
    class: 'conn-search',
    placeholder: t('searchPlaceholder'),
    'aria-label': label,
    spellcheck: 'false',
    autocomplete: 'off',
  })
}

/** Brings checkboxes in line with `selected` without re-rendering, so focus stays put. */
function syncChecks(list: HTMLElement, selected: Set<string>): void {
  for (const box of list.querySelectorAll<HTMLInputElement>('input[data-server]')) {
    box.checked = selected.has(box.dataset.server ?? '')
  }
  for (const group of list.querySelectorAll<HTMLElement>('.conn-group')) {
    const box = group.querySelector<HTMLInputElement>('.conn-group-check')
    if (!box) continue
    const items = [...group.querySelectorAll<HTMLInputElement>('input[data-server]')]
    const on = items.filter((b) => b.checked).length
    box.checked = items.length > 0 && on === items.length
    box.indeterminate = on > 0 && on < items.length
  }
}

/** Arrow keys move between the visible rows of a tree. */
function bindTreeKeys(list: HTMLElement, search: HTMLInputElement): void {
  const rows = () =>
    [...list.querySelectorAll<HTMLElement>('.conn-toggle, .conn-item')].filter(
      (el) => el.offsetParent !== null,
    )
  search.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowDown') return
    event.preventDefault()
    rows()[0]?.focus()
  })
  list.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    const all = rows()
    const index = all.indexOf(document.activeElement as HTMLElement)
    if (index < 0) return
    event.preventDefault()
    const next = index + (event.key === 'ArrowDown' ? 1 : -1)
    if (next < 0) search.focus()
    else all[Math.min(next, all.length - 1)].focus()
  })
}

async function deleteServers(servers: ServerView[]): Promise<void> {
  if (servers.length === 1) return deleteServer(servers[0])
  const ok = await confirmDialog(
    t('deleteServer'),
    t('deleteSelectedAsk', { n: servers.length }),
    common('delete'),
    true,
  )
  if (!ok) return
  try {
    for (const server of servers) await invoke('profile_delete', { id: server.id })
  } finally {
    await reloadProfiles()
  }
  setStatus(t('deletedMany', { n: servers.length }))
}

let manager: HTMLDialogElement | null = null

/** The connection manager dialog: group tree with checkboxes and batch actions. */
export function openManager(): void {
  if (manager) {
    manager.querySelector<HTMLElement>('.conn-search')?.focus()
    return
  }
  const parts = modal('connections', t('manager'), 'lg')
  manager = parts.dialog
  const selected = new Set<string>()
  const search = searchBox(t('searchServers'))
  const list = h('ul', { class: 'conn-tree', role: 'list', 'aria-label': t('savedServers') })
  const empty = emptyState(
    () => openServerDialog(null),
    () => newGroup().catch(report),
  )
  const toolbar = h(
    'div',
    { class: 'conn-toolbar' },
    search,
    button(common('newConnection'), () => openServerDialog(null)),
    button(t('newGroup'), () => newGroup().catch(report)),
    button(common('import'), openImportDialog),
  )
  parts.body.classList.add('conn-manager')
  parts.body.append(toolbar, list, empty)

  const count = h('span', { class: 'conn-selected num', 'aria-live': 'polite' })
  const connect = button(
    t('connectSelected'),
    () => {
      const servers = picked()
      parts.dialog.close()
      void connectServers(servers)
    },
    'primary',
  )
  const move = button(t('moveSelected'), () => moveServers(picked()).catch(report))
  const remove = button(t('deleteSelected'), () => deleteServers(picked()).catch(report), 'danger')
  parts.actions.append(count, h('span', { class: 'grow' }), remove, move, connect)

  const picked = () => profiles().servers.filter((s) => selected.has(s.id))
  const syncActions = () => {
    const n = picked().length
    count.textContent = n > 0 ? t('selectedCount', { n }) : ''
    for (const b of [connect, move, remove]) b.disabled = n === 0
  }
  let visible: ServerView[] = []
  const render = () => {
    const data = profiles()
    const known = new Set(data.servers.map((s) => s.id))
    for (const id of selected) if (!known.has(id)) selected.delete(id)
    const blank = data.servers.length === 0 && data.groups.length === 0
    empty.hidden = !blank
    list.hidden = blank
    toolbar.hidden = blank
    visible = renderTree(list, data, search.value, {
      selected,
      onSelection: () => {
        syncChecks(list, selected)
        syncActions()
      },
      onConnect: () => parts.dialog.close(),
    })
    syncActions()
  }
  search.addEventListener('input', render)
  search.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || visible.length !== 1) return
    event.preventDefault()
    parts.dialog.close()
    void connectServers(visible)
  })
  bindTreeKeys(list, search)
  const unsubscribe = onProfiles(render)
  parts.dialog.addEventListener('close', () => {
    unsubscribe()
    parts.dialog.remove()
    manager = null
  })
  render()
  parts.dialog.showModal()
  search.focus()
  reloadProfiles().catch(report)
}

/** The dockable connection list: search and tree, no checkboxes. */
export function connectionsPanel(): PanelHost {
  const search = searchBox(t('searchSaved'))
  const list = h('ul', { class: 'conn-tree', role: 'list', 'aria-label': t('savedServers') })
  const empty = emptyState(
    () => openServerDialog(null),
    () => newGroup().catch(report),
  )
  const head = h(
    'div',
    { class: 'conn-panel-head' },
    search,
    h(
      'button',
      {
        type: 'button',
        class: 'icon-button',
        title: common('newConnection'),
        'aria-label': common('newConnection'),
        onclick: () => openServerDialog(null),
      },
      icon('plus'),
    ),
  )
  const element = h('div', { class: 'conn-panel' }, head, list, empty)
  const render = () => {
    const data = profiles()
    const blank = data.servers.length === 0 && data.groups.length === 0
    empty.hidden = !blank
    list.hidden = blank
    head.hidden = blank
    renderTree(list, data, search.value, {})
  }
  search.addEventListener('input', render)
  bindTreeKeys(list, search)
  onProfiles(render)
  render()
  return { element }
}
