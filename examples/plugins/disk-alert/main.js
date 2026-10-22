// Disk alert example: polls `df -P` on the active SSH session and warns in the status bar.

const STATUS_ID = 'disk'
const MIN_INTERVAL = 15
// Pseudo filesystems that are always full or meaningless for disk space.
const SKIP_FS = /^(tmpfs|devtmpfs|overlay|squashfs|none|udev|shm|efivarfs)$/

// Texts this script shows, in the app's interface language (`gx.lang`).
const TEXT = {
  zh: {
    notSsh: '当前标签不是已连接的 SSH 会话',
    disk: '磁盘 {used}%',
    diskAt: '磁盘 {used}% {mount}',
    unknown: '磁盘 ?',
    unparsed: '无法解析 df 的输出',
    unparsedDetail: '无法解析 df 的输出：{error}',
    title: '{session}（阈值 {limit}%）',
    over: '{count} 个挂载点超过 {limit}%',
    fine: '磁盘空间正常',
    failed: '检查失败：{error}',
  },
  en: {
    notSsh: 'The current tab is not a connected SSH session',
    disk: 'Disk {used}%',
    diskAt: 'Disk {used}% {mount}',
    unknown: 'Disk ?',
    unparsed: 'Could not read the df output',
    unparsedDetail: 'Could not read the df output: {error}',
    title: '{session} (threshold {limit}%)',
    over: ({ count, limit }) =>
      `${count} mount point${count === 1 ? ' is' : 's are'} over ${limit}%`,
    fine: 'Disk space is fine',
    failed: 'Check failed: {error}',
  },
  ug: {
    notSsh: 'نۆۋەتتىكى بەتكۈچ ئۇلانغان SSH ئەڭگىمىسى ئەمەس',
    disk: 'دىسكا {used}%',
    diskAt: 'دىسكا {used}% {mount}',
    unknown: 'دىسكا ?',
    unparsed: 'df نىڭ چىقىرىشىنى ئوقۇيالمىدى',
    unparsedDetail: 'df نىڭ چىقىرىشىنى ئوقۇيالمىدى: {error}',
    title: '{session} (چەك {limit}%)',
    over: '{count} ئېگەرلەش نۇقتىسى {limit}% تىن ئېشىپ كەتتى',
    fine: 'دىسكا بوشلۇقى نورمال',
    failed: 'تەكشۈرۈش مەغلۇپ بولدى: {error}',
  },
}
const text = (key, values = {}) => {
  const entry = TEXT[gx.lang][key]
  if (typeof entry === 'function') return entry(values)
  return entry.replace(/\{(\w+)\}/g, (_, name) => String(values[name] ?? ''))
}
// Names and paths stay in one left-to-right piece inside Uyghur text.
const ltr = (value) => (gx.lang === 'ug' ? `\u2066${value}\u2069` : value)

let timer = null
let running = false
let stopped = false

/** Parses POSIX `df -P` output into `{ mount, used }` rows, `used` in percent. */
function parseDf(text) {
  const rows = []
  for (const line of text.split('\n').slice(1)) {
    const parts = line.trim().split(/\s+/)
    if (parts.length < 6) continue
    const used = Number.parseInt(parts[4], 10)
    if (!Number.isFinite(used) || SKIP_FS.test(parts[0])) continue
    rows.push({ mount: parts.slice(5).join(' '), used })
  }
  return rows.sort((a, b) => b.used - a.used)
}

async function threshold() {
  const value = Number(await gx.config.get('threshold'))
  return Number.isFinite(value) && value > 0 ? Math.min(value, 100) : 90
}

async function check(manual) {
  if (running || stopped) return
  running = true
  try {
    const session = await gx.sessions.active()
    if (session?.kind !== 'ssh' || session.state !== 'live') {
      await gx.statusBar.remove(STATUS_ID)
      if (manual) await gx.ui.status(text('notSsh'), 'error')
      return
    }
    const result = await gx.sessions.exec(session.id, 'LC_ALL=C df -P', { timeout: 15 })
    const rows = parseDf(result.stdout)
    if (rows.length === 0) {
      await gx.statusBar.set({
        id: STATUS_ID,
        text: text('unknown'),
        title: result.stderr.trim()
          ? text('unparsedDetail', { error: ltr(result.stderr.trim()) })
          : text('unparsed'),
        tone: 'error',
        command: 'check',
        icon: 'warning-circle',
      })
      return
    }
    const limit = await threshold()
    const full = rows.filter((row) => row.used >= limit)
    const top = rows[0]
    const details = rows
      .slice(0, 8)
      .map((row) => `${row.mount}  ${row.used}%`)
      .join('\n')
    await gx.statusBar.set({
      id: STATUS_ID,
      text:
        full.length > 0
          ? text('diskAt', { used: top.used, mount: ltr(top.mount) })
          : text('disk', { used: top.used }),
      title: `${text('title', { session: ltr(session.title), limit })}\n${details}`,
      tone: full.length > 0 ? 'warn' : 'info',
      command: 'check',
      icon: full.length > 0 ? 'warning' : 'hard-drive',
    })
    if (manual) {
      await gx.ui.status(
        full.length > 0 ? text('over', { count: full.length, limit }) : text('fine'),
      )
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    // A refused permission will not change until the user grants it in settings. The message is
    // in the app's language, so the check goes by `code`.
    if (error?.code === 'permission') {
      stopped = true
      clearTimeout(timer)
      await gx.statusBar.remove(STATUS_ID)
    }
    gx.log(text('failed', { error: message }))
    if (manual) await gx.ui.status(text('failed', { error: message }), 'error')
  } finally {
    running = false
  }
}

async function schedule() {
  clearTimeout(timer)
  if (stopped) return
  const seconds = Math.max(MIN_INTERVAL, Number(await gx.config.get('interval')) || 60)
  timer = setTimeout(async () => {
    await check(false)
    schedule()
  }, seconds * 1000)
}

gx.onActivate(async () => {
  await gx.commands.register('check', () => {
    stopped = false
    return check(true).then(schedule)
  })
  gx.config.onChange(({ key }) => {
    if (key === 'interval') schedule()
    if (key === 'threshold') check(false)
  })
  gx.sessions.onChange(() => check(false))
  // Not awaited: the first check may wait on the permission prompt, which must not hold up startup.
  check(false).then(schedule)
})
