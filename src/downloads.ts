export type RecordKind = 'download' | 'preview' | 'edit'
export type RecordState = 'running' | 'done' | 'failed' | 'cancelled'

export interface TabRef {
  key: number
  title: string
}

/** One local copy of a remote file: a download, an image preview or an editing copy. */
export interface DownloadRecord {
  readonly id: number
  readonly kind: RecordKind
  readonly tab: TabRef
  readonly name: string
  readonly remote: string
  /** Final local path, once known. */
  local: string
  state: RecordState
  bytesDone: number
  bytesTotal: number
  rate: number | null
  readonly startedAt: number
  finishedAt: number | null
  message: string
  /** Backend transfer id while a download runs, for cancelling. */
  transferId: number | null
  /** Previews and edits never show in the global manager. */
  inGlobal: boolean
  inTab: boolean
}

export type Scope = { type: 'global' } | { type: 'tab'; key: number }

type Listener = (record: DownloadRecord | null) => void

const KEEP_FINISHED = 200
const records: DownloadRecord[] = []
const listeners = new Set<Listener>()
let nextId = 1

/** `record` is the one that changed in place; null means the list itself changed. */
export function onRecords(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function emit(record: DownloadRecord | null): void {
  for (const listener of listeners) listener(record)
}

export function inScope(record: DownloadRecord, scope: Scope): boolean {
  return scope.type === 'global' ? record.inGlobal : record.inTab && record.tab.key === scope.key
}

/** Newest first. */
export function recordsIn(scope: Scope): DownloadRecord[] {
  return records.filter((r) => inScope(r, scope)).reverse()
}

function prune(): void {
  const finished = records.filter((r) => r.state !== 'running')
  const excess = new Set(finished.slice(0, Math.max(0, finished.length - KEEP_FINISHED)))
  for (let i = records.length - 1; i >= 0; i--) {
    const r = records[i]
    if (excess.has(r) || (!r.inGlobal && !r.inTab)) records.splice(i, 1)
  }
}

export function addRecord(kind: RecordKind, tab: TabRef, name: string, remote: string) {
  const record: DownloadRecord = {
    id: nextId++,
    kind,
    tab: { ...tab },
    name,
    remote,
    local: '',
    state: 'running',
    bytesDone: 0,
    bytesTotal: 0,
    rate: null,
    startedAt: Date.now(),
    finishedAt: null,
    message: '',
    transferId: null,
    inGlobal: kind === 'download',
    inTab: true,
  }
  records.push(record)
  prune()
  emit(null)
  return record
}

export function updateRecord(record: DownloadRecord, patch: Partial<DownloadRecord>): void {
  Object.assign(record, patch)
  if (patch.state && patch.state !== 'running') record.finishedAt ??= Date.now()
  emit(record)
}

/** Drops a record that never really started (for example, retried with overwrite). */
export function discardRecord(record: DownloadRecord): void {
  const index = records.indexOf(record)
  if (index < 0) return
  records.splice(index, 1)
  emit(null)
}

/** Hides finished records from one view; they are dropped once no view shows them. */
export function dismiss(scope: Scope, which: (record: DownloadRecord) => boolean): void {
  let changed = false
  for (const record of records) {
    if (record.state === 'running' || !inScope(record, scope) || !which(record)) continue
    if (scope.type === 'global') record.inGlobal = false
    else record.inTab = false
    changed = true
  }
  if (!changed) return
  prune()
  emit(null)
}

/** A closed tab takes its own manager with it; its downloads stay in the global one. */
export function closeTabRecords(key: number): void {
  for (const record of records) if (record.tab.key === key) record.inTab = false
  prune()
  emit(null)
}

export function matchesRecord(record: DownloadRecord, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  const haystack = `${record.name}\n${record.remote}\n${record.local}\n${record.tab.title}`
  return words.every((w) => haystack.toLowerCase().includes(w))
}
