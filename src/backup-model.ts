/** Shapes of the configuration backup commands (src-tauri/src/backup.rs). */

import { joinList, ltr, messages, pl } from './i18n'

const t = messages({
  partSettings: {
    zh: '设置与自定义 CSS',
    en: 'Settings and custom CSS',
    ug: 'تەڭشەك ۋە ئۆزلەشتۈرۈلگەن CSS',
  },
  partConnections: {
    zh: '连接（服务器和分组）',
    en: 'Connections (servers and groups)',
    ug: 'ئۇلىنىشلار (مۇلازىمېتىر ۋە گۇرۇپپىلار)',
  },
  partFavorites: { zh: '指令收藏', en: 'Command favorites', ug: 'بۇيرۇق يىغقۇچ' },
  partKnownHosts: { zh: '已信任的主机', en: 'Trusted hosts', ug: 'ئىشەنچلىك ئاساسىي ماشىنىلار' },
  bundleSettingsCss: {
    zh: '设置和自定义 CSS',
    en: 'Settings and custom CSS',
    ug: 'تەڭشەك ۋە ئۆزلەشتۈرۈلگەن CSS',
  },
  bundleSettings: { zh: '设置', en: 'Settings', ug: 'تەڭشەك' },
  bundleServersSecrets: {
    zh: '{servers} 台服务器、{groups} 个分组，含加密的密码',
    en: (p) =>
      `${pl('server')({ n: p.servers })}, ${pl('group')({ n: p.groups })}, with encrypted passwords`,
    ug: '{servers} مۇلازىمېتىر، {groups} گۇرۇپپا، شىفىرلانغان ئىملار بىلەن',
  },
  bundleServers: {
    zh: '{servers} 台服务器、{groups} 个分组，不含密码',
    en: (p) =>
      `${pl('server')({ n: p.servers })}, ${pl('group')({ n: p.groups })}, without passwords`,
    ug: '{servers} مۇلازىمېتىر، {groups} گۇرۇپپا، ئىمسىز',
  },
  bundleFavorites: { zh: '{n} 条指令收藏', en: pl('favorite command'), ug: '{n} يىغىلغان بۇيرۇق' },
  bundleKnownHosts: {
    zh: '{n} 个已信任的主机',
    en: pl('trusted host'),
    ug: '{n} ئىشەنچلىك ئاساسىي ماشىنا',
  },
  exportServersSecrets: {
    zh: '{n} 台服务器（{secrets} 台带密码）',
    en: (p) => `${pl('server')(p)} (${p.secrets} with passwords)`,
    ug: '{n} مۇلازىمېتىر (ئىملىقى {secrets})',
  },
  exportServers: { zh: '{n} 台服务器', en: pl('server'), ug: '{n} مۇلازىمېتىر' },
  exportFavorites: { zh: '{n} 条收藏', en: pl('favorite'), ug: '{n} يىغىلغان بۇيرۇق' },
  exportHostKeys: { zh: '{n} 个主机密钥', en: pl('host key'), ug: '{n} ئاساسىي ماشىنا ئاچقۇچى' },
  exportedItems: { zh: '已导出 {items}', en: 'Exported {items}', ug: '{items} چىقىرىلدى' },
  exported: { zh: '已导出', en: 'Exported', ug: 'چىقىرىلدى' },
  importSettingsCss: {
    zh: '设置和自定义 CSS 已替换',
    en: 'Settings and custom CSS replaced',
    ug: 'تەڭشەك ۋە ئۆزلەشتۈرۈلگەن CSS ئالماشتۇرۇلدى',
  },
  importSettings: { zh: '设置已替换', en: 'Settings replaced', ug: 'تەڭشەك ئالماشتۇرۇلدى' },
  importServers: {
    zh: '服务器：新增 {added} 台，已有 {skipped} 台未改动',
    en: 'Servers: {added} added, {skipped} already here and left unchanged',
    ug: 'مۇلازىمېتىر: {added} قوشۇلدى، بار بولغان {skipped} ئۆزگەرتىلمىدى',
  },
  importServersSecrets: {
    zh: '服务器：新增 {added} 台，已有 {skipped} 台未改动，{secrets} 台带密码',
    en: 'Servers: {added} added, {skipped} already here and left unchanged, {secrets} with passwords',
    ug: 'مۇلازىمېتىر: {added} قوشۇلدى، بار بولغان {skipped} ئۆزگەرتىلمىدى، ئىملىقى {secrets}',
  },
  importFailed: {
    zh: '未导入 {name}：{reason}',
    en: 'Did not import {name}: {reason}',
    ug: '{name} ئەكىرىلمىدى: {reason}',
  },
  importFavorites: {
    zh: '指令收藏：新增 {added} 条，跳过 {skipped} 条',
    en: 'Command favorites: {added} added, {skipped} skipped',
    ug: 'بۇيرۇق يىغقۇچ: {added} قوشۇلدى، {skipped} ئاتلاپ ئۆتۈلدى',
  },
  importKnownHosts: {
    zh: '已信任的主机：新增 {added} 个，已有 {present} 个',
    en: 'Trusted hosts: {added} added, {present} already here',
    ug: 'ئىشەنچلىك ئاساسىي ماشىنىلار: {added} قوشۇلدى، {present} بۇرۇنلا بار',
  },
  importConflicts: {
    zh: '这些主机在本机记录的密钥不同，保留了本机的：{hosts}',
    en: 'These hosts have a different key saved on this computer, so the local key was kept: {hosts}',
    ug: 'بۇ ئاساسىي ماشىنىلارنىڭ بۇ كومپيۇتېردا خاتىرىلەنگەن ئاچقۇچى ئوخشىمايدۇ، بۇ يەردىكىسى ساقلاپ قېلىندى: {hosts}',
  },
})

export interface BackupParts {
  settings: boolean
  connections: boolean
  favorites: boolean
  knownHosts: boolean
}

export interface BundleInfo {
  appVersion: string
  exportedAt: number
  settings: boolean
  customCss: boolean
  groups: number
  servers: number
  secrets: boolean
  favorites: number
  knownHosts: number
}

export interface ExportSummary {
  servers: number
  secrets: number
  favorites: number
  knownHosts: number
}

export interface ImportSummary {
  settings: boolean
  customCss: boolean
  connections: {
    added: number
    skipped: number
    failed: { name: string; reason: string }[]
    withSecrets: number
  } | null
  favorites: { added: number; skipped: number } | null
  knownHosts: { added: number; present: number; conflicts: string[]; invalid: number } | null
}

export const PART_LABELS: Record<keyof BackupParts, string> = {
  settings: t('partSettings'),
  connections: t('partConnections'),
  favorites: t('partFavorites'),
  knownHosts: t('partKnownHosts'),
}

/** Which parts a file actually carries; the import dialog only offers those. */
export function partsIn(info: BundleInfo): BackupParts {
  return {
    settings: info.settings || info.customCss,
    connections: info.servers > 0 || info.groups > 0,
    favorites: info.favorites > 0,
    knownHosts: info.knownHosts > 0,
  }
}

export function describeBundle(info: BundleInfo): string[] {
  const lines: string[] = []
  if (info.settings || info.customCss) {
    lines.push(t(info.customCss ? 'bundleSettingsCss' : 'bundleSettings'))
  }
  if (info.servers > 0 || info.groups > 0) {
    const counts = { servers: info.servers, groups: info.groups }
    lines.push(t(info.secrets ? 'bundleServersSecrets' : 'bundleServers', counts))
  }
  if (info.favorites > 0) lines.push(t('bundleFavorites', { n: info.favorites }))
  if (info.knownHosts > 0) lines.push(t('bundleKnownHosts', { n: info.knownHosts }))
  return lines
}

export function describeExport(summary: ExportSummary): string {
  const parts: string[] = []
  if (summary.servers > 0) {
    parts.push(
      summary.secrets > 0
        ? t('exportServersSecrets', { n: summary.servers, secrets: summary.secrets })
        : t('exportServers', { n: summary.servers }),
    )
  }
  if (summary.favorites > 0) parts.push(t('exportFavorites', { n: summary.favorites }))
  if (summary.knownHosts > 0) parts.push(t('exportHostKeys', { n: summary.knownHosts }))
  return parts.length ? t('exportedItems', { items: joinList(parts) }) : t('exported')
}

export function describeImport(summary: ImportSummary): string[] {
  const lines: string[] = []
  if (summary.settings || summary.customCss) {
    lines.push(t(summary.customCss ? 'importSettingsCss' : 'importSettings'))
  }
  const c = summary.connections
  if (c) {
    const counts = { added: c.added, skipped: c.skipped, secrets: c.withSecrets }
    lines.push(t(c.withSecrets > 0 ? 'importServersSecrets' : 'importServers', counts))
    for (const failure of c.failed) {
      lines.push(t('importFailed', { name: failure.name, reason: failure.reason }))
    }
  }
  const f = summary.favorites
  if (f) lines.push(t('importFavorites', { added: f.added, skipped: f.skipped }))
  const k = summary.knownHosts
  if (k) {
    lines.push(t('importKnownHosts', { added: k.added, present: k.present }))
    if (k.conflicts.length > 0) {
      lines.push(t('importConflicts', { hosts: joinList(k.conflicts.map(ltr)) }))
    }
  }
  return lines
}
