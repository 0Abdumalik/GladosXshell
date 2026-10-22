/** Lines a paste would run as separate commands; 0 when it has no line break. */
export function pastedLines(text: string): number {
  if (!/[\r\n]/.test(text)) return 0
  return text.replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n').length
}

/**
 * The directory in an OSC 7 report (`file://host/path`, percent-encoded), or null if it isn't
 * a usable absolute path.
 */
export function parseOsc7(data: string): string | null {
  const match = /^file:\/\/[^/]*(\/.*)$/.exec(data.trim())
  if (!match) return null
  let path: string
  try {
    path = decodeURIComponent(match[1])
  } catch {
    return null
  }
  if (/[\0\r\n]/.test(path)) return null
  // Windows shells report `/C:/Users/me`.
  if (/^\/[A-Za-z]:(\/|$)/.test(path)) {
    const win = path.slice(1).replace(/\//g, '\\')
    return win.length > 3 ? win.replace(/\\+$/, '') : `${win.slice(0, 2)}\\`
  }
  return path.length > 1 ? path.replace(/\/+$/, '') : path
}
