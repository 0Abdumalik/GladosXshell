import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import {
  type ActiveTab,
  applySnapshot,
  NO_TAB,
  newTrack,
  type SnapshotEvent,
  type StatusState,
  type Track,
  trackFromState,
} from './model'

/** A session id whose data changed, or null when the active tab did. */
type Listener = (change: number | null) => void

type Incoming =
  | { kind: 'snapshot'; event: SnapshotEvent }
  | { kind: 'active'; active: ActiveTab }
  | { kind: 'ended'; sessionId: number }
  | { kind: 'watched'; ids: number[] }

const tracks = new Map<number, Track>()
/** A poll can land just after its session ended; it must not bring the session back. */
const ended = new Set<number>()
const listeners = new Set<Listener>()
let active: ActiveTab = NO_TAB
let watched: ReadonlySet<number> = new Set()
let loading: Promise<void> | null = null

export function statusActive(): ActiveTab {
  return active
}

/** Sessions with an advanced window open. */
export function statusWatched(): ReadonlySet<number> {
  return watched
}

export function statusTrack(id: number | null): Track | null {
  return id === null ? null : (tracks.get(id) ?? null)
}

/** Returns an unsubscribe function. */
export function onStatusChange(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function notify(change: number | null): void {
  for (const listener of listeners) listener(change)
}

function apply(incoming: Incoming): void {
  switch (incoming.kind) {
    case 'snapshot': {
      const { sessionId, seq, snapshot } = incoming.event
      if (ended.has(sessionId)) return
      let track = tracks.get(sessionId)
      if (!track) {
        track = newTrack(sessionId)
        tracks.set(sessionId, track)
      }
      if (applySnapshot(track, seq, snapshot)) notify(sessionId)
      return
    }
    case 'active':
      active = incoming.active
      notify(null)
      return
    case 'watched':
      watched = new Set(incoming.ids)
      notify(null)
      return
    case 'ended':
      ended.add(incoming.sessionId)
      tracks.delete(incoming.sessionId)
      notify(incoming.sessionId)
  }
}

/**
 * Listens first and buffers, then loads the backend's full state, then replays what arrived in
 * between. Snapshots already in the state are dropped by their sequence number.
 */
async function load(): Promise<void> {
  let buffer: Incoming[] | null = []
  const take = (incoming: Incoming) => {
    if (buffer) buffer.push(incoming)
    else apply(incoming)
  }
  await Promise.all([
    listen<SnapshotEvent>('status://snapshot', (e) => take({ kind: 'snapshot', event: e.payload })),
    listen<ActiveTab>('status://active', (e) => take({ kind: 'active', active: e.payload })),
    listen<{ sessionId: number }>('status://ended', (e) =>
      take({ kind: 'ended', sessionId: e.payload.sessionId }),
    ),
    listen<number[]>('status://watched', (e) => take({ kind: 'watched', ids: e.payload })),
  ])
  const state = await invoke<StatusState>('status_state')
  active = state.active
  watched = new Set(state.watched)
  tracks.clear()
  for (const session of state.sessions) tracks.set(session.id, trackFromState(session))
  const queued = buffer
  buffer = null
  for (const incoming of queued) apply(incoming)
  notify(null)
}

/** Safe to call more than once; every caller waits for the same load. */
export function initStatusStore(): Promise<void> {
  loading ??= load()
  return loading
}
