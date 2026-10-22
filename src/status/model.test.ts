import { describe, expect, it } from 'vitest'
import type { NetRate, StatusSnapshot } from '../protocol'
import {
  type ActiveTab,
  applySnapshot,
  bootTime,
  chosenInterfaces,
  memoryParts,
  NO_TAB,
  newTrack,
  placeholder,
  processStart,
  trackFromState,
} from './model'

function nic(name: string, rx: number | null, total = 0): NetRate {
  return { name, rxTotal: total, txTotal: 0, rxRate: rx, txRate: rx === null ? null : rx / 2 }
}

function snapshot(patch: Partial<StatusSnapshot> = {}): StatusSnapshot {
  return {
    address: '10.0.3.17',
    unsupported: false,
    error: null,
    uptimeSecs: 86_517,
    load: [0.42, 0.37, 0.31],
    cpuPercent: 12.7,
    cpuCores: null,
    mem: { used: 1_843_200_000, total: 4_096_000_000 },
    swap: { used: 0, total: 0 },
    memory: {
      total: 4_096_000_000,
      free: 1_212_416_000,
      available: 2_252_800_000,
      buffers: 96_468_992,
      cached: 943_718_400,
      shmem: 12_582_912,
      swapTotal: 0,
      swapFree: 0,
    },
    processes: [],
    processTotal: 143,
    threadTotal: 291,
    users: null,
    net: [nic('eth0', 2048)],
    latencyMs: 23.4,
    disks: null,
    system: null,
    connections: null,
    ...patch,
  }
}

const live: ActiveTab = { sessionId: 7, tab: 'live', monitored: true, paused: false }

describe('applySnapshot', () => {
  it('drops snapshots the track already holds', () => {
    const track = newTrack(7)
    expect(applySnapshot(track, 3, snapshot())).toBe(true)
    expect(applySnapshot(track, 3, snapshot({ cpuPercent: 99 }))).toBe(false)
    expect(applySnapshot(track, 2, snapshot({ cpuPercent: 99 }))).toBe(false)
    expect(track.last?.cpuPercent).toBe(12.7)
    expect(track.latency).toEqual([23.4])
  })

  it('keeps the last good snapshot when a poll fails', () => {
    const track = newTrack(7)
    applySnapshot(track, 1, snapshot())
    applySnapshot(track, 2, snapshot({ error: 'timed out', latencyMs: null }))
    expect(track.error).toBe('timed out')
    expect(track.last?.address).toBe('10.0.3.17')
    expect(track.net.get('eth0')?.rx).toEqual([2048, null])
    expect(track.latency).toEqual([23.4, null])
    expect(track.cpu).toEqual([12.7, null])
    expect(track.mem).toEqual([45, null])
  })

  it('keeps system and disks until a poll brings new ones', () => {
    const track = newTrack(7)
    const disks = [
      {
        filesystem: '/dev/vda1',
        mount: '/',
        total: 42_949_672_960,
        avail: 9e9,
        fsType: null,
        inodesTotal: null,
        inodesUsed: null,
      },
    ]
    applySnapshot(track, 1, snapshot({ disks }))
    applySnapshot(track, 2, snapshot())
    expect(track.disks).toEqual(disks)
  })
})

describe('trackFromState', () => {
  it('backfills interfaces that appear later so every series stays aligned', () => {
    const track = trackFromState({
      id: 7,
      seq: 3,
      last: null,
      error: null,
      system: null,
      disks: null,
      history: [
        { latency: 20, cpu: 4.2, mem: 41.3, net: [{ name: 'eth0', rx: 100, tx: 50 }] },
        { latency: 21, cpu: null, mem: null, net: [] },
        {
          latency: 19,
          cpu: 7.9,
          mem: 41.6,
          net: [
            { name: 'eth0', rx: 300, tx: 70 },
            { name: 'wg0', rx: 12, tx: 8 },
          ],
        },
      ],
    })
    expect(track.latency).toEqual([20, 21, 19])
    expect(track.cpu).toEqual([4.2, null, 7.9])
    expect(track.mem).toEqual([41.3, null, 41.6])
    expect(track.net.get('eth0')?.rx).toEqual([100, null, 300])
    expect(track.net.get('wg0')?.tx).toEqual([null, null, 8])
    expect(applySnapshot(track, 3, snapshot())).toBe(false)
    expect(applySnapshot(track, 4, snapshot())).toBe(true)
    expect(track.net.get('wg0')?.rx).toEqual([null, null, 12, null])
  })
})

describe('placeholder', () => {
  it('explains every tab that has nothing to draw', () => {
    expect(placeholder(NO_TAB, null)).toContain('连接服务器')
    expect(placeholder({ ...live, tab: 'local' }, null)).toContain('本地终端')
    expect(placeholder({ ...live, tab: 'ended' }, null)).toContain('断开')
    expect(placeholder({ ...live, monitored: false }, null)).toContain('关闭了状态监控')
    expect(placeholder(live, null)).toContain('启动')
  })

  it('is empty once there is a snapshot, even after a later failure', () => {
    const track = newTrack(7)
    expect(placeholder(live, track)).toBe('正在读取状态…')
    applySnapshot(track, 1, snapshot({ error: 'denied' }))
    expect(placeholder(live, track)).toContain('denied')
    applySnapshot(track, 2, snapshot())
    applySnapshot(track, 3, snapshot({ error: 'denied' }))
    expect(placeholder(live, track)).toBe('')
  })

  it('reports systems without /proc', () => {
    const track = newTrack(7)
    applySnapshot(track, 1, snapshot({ unsupported: true }))
    expect(placeholder(live, track)).toContain('/proc')
  })
})

describe('bootTime and processStart', () => {
  const now = Date.UTC(2026, 9, 2, 8, 30, 0)

  it('count back from the uptime at the time of the snapshot', () => {
    expect(bootTime(86_517, now)).toBe(now - 86_517_000)
    expect(processStart(3_600, 86_517, now)).toBe(now - 82_917_000)
  })

  it('never put a process start after now', () => {
    expect(processStart(90_000, 86_517, now)).toBe(now)
  })
})

describe('memoryParts', () => {
  const detail = {
    total: 8_000,
    free: 1_200,
    available: 4_700,
    buffers: 300,
    cached: 3_100,
    shmem: 90,
    swapTotal: 0,
    swapFree: 0,
  }

  it('leaves used as what free, buffers and cache do not cover', () => {
    expect(memoryParts(detail)).toEqual({ used: 3_400, buffers: 300, cached: 3_100, free: 1_200 })
  })

  it('never lets the parts overflow the total', () => {
    const parts = memoryParts({ ...detail, cached: 9_000 })
    expect(parts.used).toBe(0)
    expect(parts.used + parts.buffers + parts.cached + parts.free).toBe(8_000)
  })
})

describe('chosenInterfaces', () => {
  const snap = snapshot({ net: [nic('lo', 1, 9e9), nic('eth0', 1, 5e6), nic('eth1', 1, 8e6)] })

  it('keeps saved names the server has, in saved order', () => {
    expect(chosenInterfaces(['eth1', 'gone', 'eth0'], snap)).toEqual(['eth1', 'eth0'])
  })

  it('falls back to the busiest interface other than loopback', () => {
    expect(chosenInterfaces([], snap)).toEqual(['eth1'])
    expect(chosenInterfaces(['gone'], snap)).toEqual(['eth1'])
  })

  it('uses loopback when it is all there is', () => {
    expect(chosenInterfaces([], snapshot({ net: [nic('lo', 1)] }))).toEqual(['lo'])
    expect(chosenInterfaces([], snapshot({ net: [] }))).toEqual([])
  })
})
