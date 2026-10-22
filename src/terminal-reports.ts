const REPORT = [
  '\\x1b\\[\\??\\d+(?:;\\d+)*R', // cursor position
  '\\x1b\\[[IO]', // focus in / out
  '\\x1b\\[[?>=][\\d;]*c', // device attributes
  '\\x1b\\[\\d+n', // device status
  '\\x1b\\[\\??[\\d;]*\\$y', // mode report
  '\\x1b\\[\\d+(?:;\\d+)*t', // window report
  '\\x1b\\[M[\\s\\S]{3}', // X10 mouse
  '\\x1b\\[<\\d+;\\d+;\\d+[Mm]', // SGR mouse
  '\\x1b\\[\\d+;\\d+;\\d+M', // urxvt mouse
  '\\x1b\\][^\\x07\\x1b]*(?:\\x07|\\x1b\\\\)', // OSC reply
  '\\x1bP[^\\x1b]*\\x1b\\\\', // DCS reply
].join('|')

const ONLY_REPORTS = new RegExp(`^(?:${REPORT})+$`)

/**
 * Whether xterm produced this data itself, answering a query from the program or reporting the
 * mouse or focus, rather than the user typing or pasting it.
 */
export function isTerminalReport(data: string): boolean {
  return ONLY_REPORTS.test(data)
}
