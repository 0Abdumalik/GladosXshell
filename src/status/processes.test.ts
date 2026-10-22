import { describe, expect, it } from 'vitest'
import type { ProcessInfo } from '../protocol'
import {
  filterProcesses,
  processTree,
  shortTime,
  sortProcesses,
  stateGroup,
  validNice,
} from './processes'

function proc(pid: number, ppid: number, patch: Partial<ProcessInfo> = {}): ProcessInfo {
  return {
    pid,
    name: `p${pid}`,
    cpuPercent: 0,
    memBytes: 0,
    state: 'S',
    ppid,
    uid: 0,
    user: 'root',
    threads: 1,
    nice: 0,
    startSecs: pid,
    cmdline: null,
    ...patch,
  }
}

const list = [
  proc(1, 0, { name: 'systemd', cmdline: '/sbin/init splash' }),
  proc(812, 1, { name: 'sshd', cpuPercent: 0.3, memBytes: 7_340_032 }),
  proc(2045, 812, { name: 'bash', user: 'deploy', uid: 1001, state: 'R', cpuPercent: 1.7 }),
  proc(2311, 2045, {
    name: 'node',
    user: 'deploy',
    uid: 1001,
    cpuPercent: 1.7,
    memBytes: 183_500_800,
    cmdline: 'node /srv/api/server.js --port 8080',
  }),
  proc(3170, 1, { name: 'defunct', state: 'Z' }),
]

describe('filterProcesses', () => {
  it('matches name, user and command line anywhere, PID from the start', () => {
    const pids = (q: string) => filterProcesses(list, q, 'all').map((p) => p.pid)
    expect(pids('SSH')).toEqual([812])
    expect(pids('deploy')).toEqual([2045, 2311])
    expect(pids('server.js')).toEqual([2311])
    expect(pids('20')).toEqual([2045])
    expect(pids('  ')).toHaveLength(list.length)
  })

  it('filters by state group', () => {
    expect(filterProcesses(list, '', 'running').map((p) => p.pid)).toEqual([2045])
    expect(filterProcesses(list, '', 'zombie').map((p) => p.pid)).toEqual([3170])
    expect(stateGroup('D')).toBe('sleeping')
    expect(stateGroup('t')).toBe('stopped')
    expect(stateGroup('W')).toBeNull()
  })
})

describe('sortProcesses', () => {
  it('sorts figures biggest first and breaks CPU ties by memory', () => {
    expect(sortProcesses(list, 'cpu').map((p) => p.pid)).toEqual([2311, 2045, 812, 1, 3170])
  })

  it('honours an explicit direction and keeps PID order on ties', () => {
    expect(sortProcesses(list, 'user', 'ascending').map((p) => p.pid)).toEqual([
      2045, 2311, 1, 812, 3170,
    ])
    expect(sortProcesses(list, 'pid', 'descending')[0].pid).toBe(3170)
  })
})

describe('processTree', () => {
  it('nests children under parents in the given order', () => {
    const rows = processTree(sortProcesses(list, 'pid'))
    expect(rows.map((r) => [r.process.pid, r.depth])).toEqual([
      [1, 0],
      [812, 1],
      [2045, 2],
      [2311, 3],
      [3170, 1],
    ])
  })

  it('makes orphans roots and survives parent loops', () => {
    const rows = processTree([proc(2311, 2045), proc(5, 6), proc(6, 5)])
    expect(rows.map((r) => r.process.pid).sort()).toEqual([2311, 5, 6].sort())
    expect(rows[0]).toEqual({ process: expect.objectContaining({ pid: 2311 }), depth: 0 })
  })
})

describe('shortTime', () => {
  const now = new Date(2026, 9, 2, 16, 45).getTime()

  it('drops what the reader already knows', () => {
    expect(shortTime(new Date(2026, 9, 2, 8, 5).getTime(), now)).toBe('08:05')
    expect(shortTime(new Date(2026, 8, 28, 23, 10).getTime(), now)).toBe('09-28 23:10')
    expect(shortTime(new Date(2025, 11, 31, 9, 0).getTime(), now)).toBe('2025-12-31')
  })
})

describe('validNice', () => {
  it('accepts integers from -20 to 19', () => {
    expect(validNice('-20')).toBe('')
    expect(validNice(' 19 ')).toBe('')
    expect(validNice('20')).not.toBe('')
    expect(validNice('1.5')).not.toBe('')
    expect(validNice('')).not.toBe('')
  })
})
