import { describe, expect, it } from 'vitest'
import {
  type BundleInfo,
  describeBundle,
  describeExport,
  describeImport,
  partsIn,
} from './backup-model'

const info = (patch: Partial<BundleInfo> = {}): BundleInfo => ({
  appVersion: '0.1.0',
  exportedAt: 0,
  settings: false,
  customCss: false,
  groups: 0,
  servers: 0,
  secrets: false,
  favorites: 0,
  knownHosts: 0,
  ...patch,
})

describe('backup model', () => {
  it('offers only the parts a file carries', () => {
    expect(partsIn(info({ customCss: true, servers: 3 }))).toEqual({
      settings: true,
      connections: true,
      favorites: false,
      knownHosts: false,
    })
    expect(describeBundle(info())).toEqual([])
    expect(describeBundle(info({ servers: 2, groups: 1, secrets: true, knownHosts: 4 }))).toEqual([
      '2 台服务器、1 个分组，含加密的密码',
      '4 个已信任的主机',
    ])
  })

  it('summarises exports and imports', () => {
    expect(describeExport({ servers: 5, secrets: 2, favorites: 0, knownHosts: 1 })).toBe(
      '已导出 5 台服务器（2 台带密码）、1 个主机密钥',
    )
    const lines = describeImport({
      settings: true,
      customCss: false,
      connections: {
        added: 2,
        skipped: 1,
        failed: [{ name: 'bad', reason: '用户名不能为空' }],
        withSecrets: 0,
      },
      favorites: null,
      knownHosts: { added: 0, present: 1, conflicts: ['10.0.0.1:22'], invalid: 0 },
    })
    expect(lines).toEqual([
      '设置已替换',
      '服务器：新增 2 台，已有 1 台未改动',
      '未导入 bad：用户名不能为空',
      '已信任的主机：新增 0 个，已有 1 个',
      '这些主机在本机记录的密钥不同，保留了本机的：10.0.0.1:22',
    ])
  })
})
