import { copyDocumentForConflict, type BoardDocument } from './projects.ts'
import { boardSyncUrl } from './board-api.ts'

/**
 * Board sync for Pro.
 *
 * Saved boards are keyed by name on this device, which is fine for a device
 * and useless across two: renaming would read as a delete and a create, and
 * two people naming a board "Press trigger" would collide. So every board
 * carries an id alongside its name, assigned on first sight and never reused.
 *
 * Everything here is deliberately free of the DOM and of localStorage. The
 * adapter below binds it to the real store; the rules are testable on their
 * own, which is the only way the conflict paths get exercised.
 */

export type BoardAccess = 'owner' | 'shared'

export type LocalBoard = {
  id: string
  name: string
  /** Wall-clock time of the last local edit. Drives conflict resolution. */
  savedAt: string
  scene: BoardDocument
  /** Absent is an owned/personal board, for old local saves. */
  access?: 'shared'
  ownerUsername?: string | null
  /** The owner only granted reading, or their Pro lapsed. Either way: look, don't touch. */
  readOnly?: boolean
  /** Stable account binding that owns this synced local record. */
  syncAccount?: string
  /** Local idempotency marker for a click-to-add project link. */
  importId?: string
}

export type Tombstone = { id: string; name: string; deletedAt: string; syncAccount?: string }

export type SyncStore = {
  list(): LocalBoard[]
  upsert(board: LocalBoard): void
  removeById(id: string): void
  tombstones(): Tombstone[]
  dropTombstones(ids: string[]): void
  cursor(): string | null
  setCursor(cursor: string): void
  pushedAt(): string | null
  setPushedAt(at: string): void
  /** Marker for shared-board pushes; optional for old test adapters. */
  sharedPushedAt?: () => string | null
  setSharedPushedAt?: (at: string) => void
  accountBinding?: () => string | null
  claimOwned?: (ids: string[], accountBinding: string) => void
  /** Move one explicitly shared local owner record to the active account after acceptance. */
  adoptOwned?: (id: string, accountBinding: string) => void
  deviceId(): string
}

export type RemoteBoard = {
  id: string
  name: string
  updated_at: string
  scene?: BoardDocument
  deleted_at?: string
  device?: string | null
  access?: BoardAccess
  owner_username?: string | null
  read_only?: boolean
}

export type SyncResponse = {
  /** Backend error codes are surfaced by createSyncApi on rejected requests. */
  error?: string
  boards?: RemoteBoard[]
  cursor?: string
  /** Changes the server accepted, including exact duplicate replays. */
  applied?: { id: string }[]
  conflicts?: { id: string; kept: string; server_updated_at?: string; winner?: RemoteBoard }[]
  has_more?: boolean
}

export type SyncApi = {
  push(body: { boards: unknown[]; cursor: string | null }): Promise<SyncResponse>
  pull(cursor: string | null): Promise<SyncResponse>
}

export type SyncResult = {
  status: 'ok' | 'skipped' | 'failed'
  pushed: number
  pulled: number
  conflicts: number
  /** Remote board ids seen this pass, for updating an open canvas explicitly. */
  remoteIds: string[]
  reason?: string
}

export type SyncOptions = {
  includeOwned?: boolean
  /** Push only this saved Project. Used by sharing, never by background sync. */
  targetId?: string
  /** Targeted preparation must leave the full-sync markers unchanged. */
  advanceMarkers?: boolean
  /** Share one owned local target even when no current account binding is available. */
  shareTarget?: boolean
  /** Stop a pass before mutation when its account or session is no longer current. */
  stillCurrent?: () => boolean
}

/** The API accepts at most this many changes in one POST. */
export const SYNC_BATCH_SIZE = 50
/** Keep JSON bodies below the endpoint's 2 MiB cap, with room for its envelope. */
export const SYNC_REQUEST_BYTE_LIMIT = 2 * 1024 * 1024
export const SYNC_REQUEST_BYTE_BUDGET = SYNC_REQUEST_BYTE_LIMIT - 16 * 1024

export function syncRequestBytes(boards: unknown[], cursor: string | null): number {
  return new TextEncoder().encode(JSON.stringify({ boards, cursor })).byteLength
}

/** Take the largest count- and byte-bounded batch at this offset. */
export function takeSyncBatch(changes: unknown[], start: number, cursor: string | null): unknown[] {
  const chunk: unknown[] = []
  for (let index = start; index < changes.length && chunk.length < SYNC_BATCH_SIZE; index += 1) {
    const candidate = [...chunk, changes[index]]
    if (chunk.length && syncRequestBytes(candidate, cursor) > SYNC_REQUEST_BYTE_BUDGET) break
    chunk.push(changes[index])
  }
  return chunk
}

/** Stop a malformed endless pagination response from holding the client forever. */
export const SYNC_PAGE_LIMIT = 100

/**
 * Coalesce requests made before a pass starts, then run another pass for any
 * request made while one is in flight. Every caller waits for the full set,
 * including the follow-up pass it requested.
 */
export function createSyncRunner(runPass: () => Promise<void>): () => Promise<void> {
  let requested = false
  let running: Promise<void> | null = null

  const runRequestedPasses = async () => {
    try {
      while (requested) {
        requested = false
        await runPass()
      }
    } finally {
      running = null
    }
  }

  return () => {
    requested = true
    if (!running) running = Promise.resolve().then(runRequestedPasses)
    return running
  }
}

/**
 * Keep the global marker just before this pass's clock tick. A save or
 * preserved conflict stamped in that same millisecond must remain visible to
 * the next pass; this bounded overlap is harmless because the API accepts
 * duplicate replays.
 */
export function pushMarker(now: string): string {
  const time = Date.parse(now)
  return Number.isFinite(time) ? new Date(time - 1).toISOString() : now
}

/** Ids are opaque and only have to be unique and URL-safe. */
export function newId(random: () => number = Math.random): string {
  let out = ''
  while (out.length < 20) out += Math.floor(random() * 36 ** 6).toString(36)
  return `b-${out.slice(0, 20)}`
}

function laterThan(a: string, b: string | null | undefined): boolean {
  if (!b) return true
  const left = Date.parse(a)
  const right = Date.parse(b)
  if (!Number.isFinite(left)) return false
  if (!Number.isFinite(right)) return true
  return left > right
}

/**
 * Boards edited since the last successful push, plus every pending tombstone.
 *
 * A board with no recorded push is always included, which is what makes the
 * first sync upload everything already on the device rather than silently
 * starting from empty.
 */
export function collectChanges(store: SyncStore, options: SyncOptions = {}): unknown[] {
  const includeOwned = options.includeOwned ?? true
  const targetId = options.targetId
  // Free sync must not move the personal marker: those boards remain eligible
  // if the account later becomes Pro. Old adapters have no shared marker yet,
  // so fall back to their existing marker and preserve their old behaviour.
  const since = includeOwned ? store.pushedAt() : store.sharedPushedAt?.() ?? store.pushedAt()
  const device = store.deviceId()
  const accountAware = typeof store.accountBinding === 'function'
  const account = store.accountBinding?.() ?? null
  const changes: unknown[] = []

  for (const board of store.list()) {
    if (targetId && board.id !== targetId) continue
    // Background sync never moves work between accounts. Pressing Share is an
    // explicit exception for its one owned local Project, including when the
    // Board session has no client-visible account binding. Shared Projects
    // still belong to their granting account and cannot use this exception.
    const mayShareTarget = options.shareTarget === true && targetId === board.id
      && includeOwned && board.access !== 'shared'
    if (accountAware && board.syncAccount && board.syncAccount !== account && !mayShareTarget) continue
    if (accountAware && board.access === 'shared' && (!account || board.syncAccount !== account)) continue
    // Free members may edit shared boards, but their personal device boards
    // must never be sent to the service.
    if (!includeOwned && board.access !== 'shared') continue
    // Sharing replays its one required Project even when the full-sync marker
    // says it was already pushed. The API accepts exact duplicate replays.
    if (!targetId && !laterThan(board.savedAt, since)) continue
    changes.push({
      id: board.id,
      name: board.name,
      scene: board.scene,
      updated_at: board.savedAt,
      device,
    })
  }

  if (targetId) return changes

  for (const stone of store.tombstones()) {
    if (!includeOwned) continue
    if (accountAware && stone.syncAccount && stone.syncAccount !== account) continue
    changes.push({
      id: stone.id,
      name: stone.name,
      updated_at: stone.deletedAt,
      deleted_at: stone.deletedAt,
      device,
    })
  }

  return changes
}

/**
 * A name that says where the losing copy came from, without growing every time
 * it happens.
 */
export function conflictName(name: string): string {
  return /\(this device\)$/.test(name) ? name : `${name} (this device)`
}

/**
 * Keep the local edit that lost. The server's copy is about to overwrite this
 * id, so the local version is re-saved under a fresh id first. Nothing the
 * person drew is thrown away; they end up with two boards and a name that
 * explains why.
 */
export function preserveConflicts(
  store: SyncStore,
  conflicts: { id: string }[],
  now: string,
  makeId: () => string = newId,
): number {
  let kept = 0
  const byId = new Map(store.list().map((board) => [board.id, board]))
  for (const conflict of conflicts) {
    const local = byId.get(conflict.id)
    if (!local) continue
    // A copied losing shared edit is this device's personal board, not a new
    // collaborator record. In free mode it must consequently stay local.
    const id = makeId()
    store.upsert({ id, name: conflictName(local.name), savedAt: now, scene: copyDocumentForConflict(local.scene, id) })
    kept += 1
  }
  return kept
}

/** Apply what the server sent. A tombstone removes; anything else replaces. */
export function applyRemote(store: SyncStore, boards: RemoteBoard[]): number {
  let applied = 0
  const local = new Map(store.list().map((board) => [board.id, board]))
  for (const board of boards) {
    if (!board || typeof board.id !== 'string') continue
    // A save can happen while a request is in flight. Do not let an older
    // response erase it; its newer savedAt remains pending for the next pass.
    // A local save normally wins over an older in-flight response. A shared
    // tombstone is different: it is a revocation/owner deletion, so retaining
    // a newer local edit would leave a board the member no longer has.
    if (local.get(board.id) && laterThan(local.get(board.id)!.savedAt, board.updated_at)
      && !(board.deleted_at && board.access === 'shared')) continue
    if (board.deleted_at) {
      store.removeById(board.id)
      applied += 1
      continue
    }
    if (!board.scene || typeof board.scene !== 'object' || typeof board.name !== 'string') continue
    const syncAccount = store.accountBinding?.() ?? undefined
    store.upsert({
      id: board.id, name: board.name, savedAt: board.updated_at, scene: board.scene,
      ...(syncAccount ? { syncAccount } : {}),
      ...(board.access === 'shared'
        ? {
          access: 'shared' as const,
          ownerUsername: board.owner_username ?? null,
          ...(board.read_only ? { readOnly: true } : {}),
        }
        : {}),
    })
    applied += 1
  }
  return applied
}

/**
 * One sync pass: push what changed, apply what came back, keep whatever lost.
 *
 * The push response carries the same page a pull would, so a device that has
 * changes needs one round trip rather than two, and finishes settled.
 */
export async function syncOnce(
  store: SyncStore,
  api: SyncApi,
  now: string,
  makeId: () => string = newId,
  options: SyncOptions = {},
): Promise<SyncResult> {
  const targetId = options.targetId
  const target = targetId ? store.list().find((board) => board.id === targetId) : undefined
  if (targetId && !target) {
    return {
      status: 'failed', pushed: 0, pulled: 0, conflicts: 0, remoteIds: [],
      reason: 'the required Project is not saved on this device',
    }
  }
  const changes = collectChanges(store, options)
  if (targetId && !changes.some((change: any) => change?.id === targetId)) {
    return {
      status: 'failed', pushed: 0, pulled: 0, conflicts: 0, remoteIds: [],
      reason: 'the required Project is not available to this account',
    }
  }
  const account = store.accountBinding?.() ?? null
  const sharedIds = new Set(store.list().filter((board) => board.access === 'shared').map((board) => board.id))
  const assertCurrent = () => {
    if (options.stillCurrent && !options.stillCurrent()) throw new Error('sync account changed')
  }
  let pushed = 0
  let pulled = 0
  let conflictsKept = 0
  const remoteIds = new Set<string>()
  const ids = (items: unknown[] | undefined): string[] => Array.isArray(items)
    ? items.flatMap((item: any) => typeof item?.id === 'string' ? [item.id] : [])
    : []

  /** A malformed push reply is never allowed to consume any part of its page. */
  function requireAcknowledgement(response: SyncResponse, sent: unknown[]): void {
    const acknowledged = new Set([...ids(response.applied), ...ids(response.conflicts)])
    const missing = sent.some((change: any) => typeof change?.id === 'string' && !acknowledged.has(change.id))
    if (missing) throw new Error('sync acknowledgement missing')
  }

  async function consume(first: SyncResponse, sent: unknown[] | null): Promise<void> {
    // A push response starts its own pull chain. Do not let many independent
    // valid push batches consume the pagination safety cap together.
    let pages = 0
    let response = first
    let sentForResponse = sent
    let cursorUsed = store.cursor()
    for (;;) {
      assertCurrent()
      if (++pages > SYNC_PAGE_LIMIT) throw new Error('sync page limit reached')
      const boards = Array.isArray(response.boards) ? response.boards : []
      const conflicts = Array.isArray(response.conflicts) ? response.conflicts : []
      // Push responses can echo this device's own save. It is not an external
      // update to load over a canvas that changed while the request was out.
      // A conflict is different: its winner must reconcile the original id
      // even when it was written by this device (for example, another tab).
      for (const board of boards) {
        if (board && typeof board.id === 'string' && board.device !== store.deviceId()) remoteIds.add(board.id)
      }
      for (const conflict of conflicts) {
        if (conflict && typeof conflict.id === 'string') remoteIds.add(conflict.id)
      }

      const sentVersions = new Map((sentForResponse ?? []).flatMap((change: any) =>
        typeof change?.id === 'string' && !change.deleted_at && typeof change.updated_at === 'string'
          ? [[change.id, change.updated_at] as const] : [],
      ))
      // Preserve only the exact local revision that this POST carried. This
      // makes replayed accepted chunks idempotent and leaves a newer edit for
      // the next pass instead of making a needless conflict copy.
      const eligible = conflicts.filter((conflict) => {
        const local = store.list().find((board) => board.id === conflict.id)
        return !!local && sentVersions.get(conflict.id) === local.savedAt
      })
      // Save the losing revision before its original id is replaced with the
      // supplied winner, including when that winner is older than our cursor.
      conflictsKept += preserveConflicts(store, eligible, now, makeId)
      const winners = conflicts.flatMap((conflict) => conflict?.winner && typeof conflict.winner.id === 'string'
        ? [conflict.winner] : [])
      const winnerIds = new Set(winners.map((winner) => winner.id))
      // The page often repeats the winner. Apply it once, preferring the
      // explicit conflict payload that lets us converge past the cursor.
      pulled += applyRemote(store, [...winners, ...boards.filter((board) => !winnerIds.has(board?.id))])
      if (typeof response.cursor === 'string' && response.cursor) store.setCursor(response.cursor)

      if (sentForResponse) {
        const tombstoneIds = new Set((sentForResponse as any[])
          .filter((change) => change?.deleted_at && typeof change.id === 'string')
          .map((change) => change.id))
        const acknowledged = new Set([...ids(response.applied), ...ids(response.conflicts)])
        store.dropTombstones([...tombstoneIds].filter((id) => acknowledged.has(id)))
      }

      if (!response.has_more) return
      if (pages >= SYNC_PAGE_LIMIT) throw new Error('sync page limit reached')
      if (typeof response.cursor !== 'string' || !response.cursor || response.cursor === cursorUsed) {
        throw new Error('sync cursor did not advance')
      }
      cursorUsed = response.cursor
      response = await api.pull(cursorUsed)
      assertCurrent()
      sentForResponse = null
    }
  }

  try {
    assertCurrent()
    if (!changes.length) {
      const response = await api.pull(store.cursor())
      assertCurrent()
      await consume(response, null)
    } else {
      for (let start = 0; start < changes.length;) {
        assertCurrent()
        const cursor = store.cursor()
        const chunk = takeSyncBatch(changes, start, cursor)
        if (!chunk.length || syncRequestBytes(chunk, cursor) > SYNC_REQUEST_BYTE_BUDGET) {
          throw new Error('one Project exceeds the sync request limit')
        }
        const response = await api.push({ boards: chunk, cursor })
        // Check before remote boards, conflicts, tombstones, or the cursor can
        // mutate local state from this response.
        requireAcknowledgement(response, chunk)
        assertCurrent()
        // Claim or adopt only after the server accepts this exact chunk. A
        // rejected request and a stale account leave local ownership intact.
        if ((options.includeOwned ?? true) && account) {
          const ownedIds = (chunk as any[]).flatMap((change) => typeof change?.id === 'string' && !sharedIds.has(change.id) ? [change.id] : [])
          store.claimOwned?.(ownedIds, account)
          if (options.shareTarget && targetId) store.adoptOwned?.(targetId, account)
        }
        await consume(response, chunk)
        assertCurrent()
        pushed += chunk.length
        start += chunk.length
      }
      // A free member has deliberately not sent personal work. Advancing the
      // global marker here would hide it forever if they later gain Pro.
      // Replaying shared edits is safe because the API accepts duplicates.
      assertCurrent()
      const marker = pushMarker(now)
      const advanceMarkers = options.advanceMarkers ?? !targetId
      if (advanceMarkers && (options.includeOwned ?? true)) {
        store.setPushedAt(marker)
        store.setSharedPushedAt?.(marker)
      } else if (advanceMarkers) {
        store.setSharedPushedAt?.(marker)
      }
    }
  } catch (error) {
    // A rejected local Project must not block this device from receiving the
    // account's other Projects. Pull from the last durable cursor, while
    // leaving the push marker untouched so local work remains pending.
    if (changes.length && (!options.stillCurrent || options.stillCurrent())) {
      try {
        const response = await api.pull(store.cursor())
        assertCurrent()
        await consume(response, null)
      } catch { /* retain the original failure */ }
    }
    // A failed sync must not advance the global push marker. Successfully
    // acknowledged tombstones and cursors are durable and safe to retain.
    return {
      status: 'failed', pushed: 0, pulled, conflicts: conflictsKept,
      remoteIds: [...remoteIds], reason: error instanceof Error ? error.message : 'unavailable',
    }
  }

  return { status: 'ok', pushed, pulled, conflicts: conflictsKept, remoteIds: [...remoteIds] }
}

/* ---------- the device side ---------- */

const PROJECTS_KEY = 'tbm-projects-v1'
const TOMBSTONE_KEY = 'tbm-tombstones-v1'
const CURSOR_KEY = 'tbm-sync-cursor-v1'
const PUSHED_KEY = 'tbm-sync-pushed-v1'
const SHARED_PUSHED_KEY = 'tbm-sync-shared-pushed-v1'
const DEVICE_KEY = 'tbm-device-v1'

type StoredProject = { savedAt: string; scene: BoardDocument; id?: string; importId?: string; access?: 'shared'; ownerUsername?: string | null; readOnly?: boolean; syncAccount?: string }
type StoredProjects = Record<string, StoredProject>

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch { return fallback }
}

function write(key: string, value: unknown): void {
  try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* private mode, or full */ }
}

/**
 * Saved boards predate sync and are keyed by name, with no id. Assigning one on
 * first sight is what lets a rename stay the same board instead of arriving
 * somewhere else as a new one.
 */
export function ensureIds(all: StoredProjects): { all: StoredProjects; changed: boolean } {
  let changed = false
  const next: StoredProjects = {}
  for (const [name, entry] of Object.entries(all)) {
    if (entry && typeof entry === 'object' && typeof entry.id === 'string' && entry.id) {
      next[name] = entry
      continue
    }
    next[name] = { ...entry, id: newId() }
    changed = true
  }
  return { all: next, changed }
}

/** Note a delete so it can reach the other devices. */
export function recordTombstones(removed: { id: string; name: string; syncAccount?: string }[], now: string): void {
  if (!removed.length) return
  const stones = read<Tombstone[]>(TOMBSTONE_KEY, [])
  for (const item of removed) {
    if (stones.some((stone) => stone.id === item.id)) continue
    stones.push({ id: item.id, name: item.name, deletedAt: now, ...(item.syncAccount ? { syncAccount: item.syncAccount } : {}) })
  }
  // Unacknowledged tombstones must survive indefinitely. The server may be
  // unavailable for a long time, and dropping old entries would resurrect
  // deleted boards on another device.
  write(TOMBSTONE_KEY, stones)
}

export function deviceId(): string {
  try {
    const existing = localStorage.getItem(DEVICE_KEY)
    if (existing && /^[A-Za-z0-9_-]{8,64}$/.test(existing)) return existing
  } catch { /* fall through */ }
  const fresh = newId().replace(/^b-/, 'd-')
  write(DEVICE_KEY, fresh)
  try { localStorage.setItem(DEVICE_KEY, fresh) } catch { /* ignore */ }
  return fresh
}

export function createLocalSyncStore(accountBinding: string | null = null): SyncStore {
  function loadAll(): StoredProjects {
    const { all, changed } = ensureIds(read<StoredProjects>(PROJECTS_KEY, {}))
    if (changed) write(PROJECTS_KEY, all)
    return all
  }

  function saveAll(all: StoredProjects): void { write(PROJECTS_KEY, all) }

  return {
    list() {
      return Object.entries(loadAll()).map(([name, entry]) => ({
        id: entry.id as string,
        name,
        savedAt: entry.savedAt,
        scene: entry.scene,
        ...(entry.syncAccount ? { syncAccount: entry.syncAccount } : {}),
        ...(entry.importId ? { importId: entry.importId } : {}),
        ...(entry.access === 'shared'
          ? {
            access: 'shared' as const,
            ownerUsername: entry.ownerUsername ?? null,
            ...(entry.readOnly ? { readOnly: true } : {}),
          }
          : {}),
      }))
    },

    upsert(board) {
      const all = loadAll()
      // The record is keyed by name, so an incoming board has to displace its
      // own old name and step around anyone else's.
      let importId = board.importId
      for (const [name, entry] of Object.entries(all)) {
        if (entry.id === board.id) {
          importId ??= entry.importId
          delete all[name]
        }
      }
      let name = board.name
      let n = 2
      while (all[name] && all[name].id !== board.id) name = `${board.name} (${n++})`
      all[name] = {
        id: board.id, savedAt: board.savedAt, scene: board.scene,
        ...(board.syncAccount ? { syncAccount: board.syncAccount } : {}),
        ...(importId ? { importId } : {}),
        ...(board.access === 'shared'
          ? {
            access: 'shared' as const,
            ownerUsername: board.ownerUsername ?? null,
            ...(board.readOnly ? { readOnly: true } : {}),
          }
          : {}),
      }
      saveAll(all)
    },

    removeById(id) {
      const all = loadAll()
      for (const [name, entry] of Object.entries(all)) {
        if (entry.id === id) delete all[name]
      }
      saveAll(all)
    },

    tombstones() { return read<Tombstone[]>(TOMBSTONE_KEY, []) },
    dropTombstones(ids) {
      const keep = read<Tombstone[]>(TOMBSTONE_KEY, []).filter((stone) => !ids.includes(stone.id))
      write(TOMBSTONE_KEY, keep)
    },

    cursor() { try { return localStorage.getItem(accountBinding ? `${CURSOR_KEY}:${accountBinding}` : CURSOR_KEY) } catch { return null } },
    setCursor(value) { try { localStorage.setItem(accountBinding ? `${CURSOR_KEY}:${accountBinding}` : CURSOR_KEY, value) } catch { /* ignore */ } },
    pushedAt() { try { return localStorage.getItem(accountBinding ? `${PUSHED_KEY}:${accountBinding}` : PUSHED_KEY) } catch { return null } },
    setPushedAt(value) { try { localStorage.setItem(accountBinding ? `${PUSHED_KEY}:${accountBinding}` : PUSHED_KEY, value) } catch { /* ignore */ } },
    sharedPushedAt() { try { return localStorage.getItem(accountBinding ? `${SHARED_PUSHED_KEY}:${accountBinding}` : SHARED_PUSHED_KEY) } catch { return null } },
    setSharedPushedAt(value) { try { localStorage.setItem(accountBinding ? `${SHARED_PUSHED_KEY}:${accountBinding}` : SHARED_PUSHED_KEY, value) } catch { /* ignore */ } },
    accountBinding() { return accountBinding },
    claimOwned(ids, account) {
      if (!ids.length) return
      const wanted = new Set(ids)
      const all = loadAll()
      let changed = false
      for (const entry of Object.values(all)) {
        if (entry.access === 'shared' || !entry.id || !wanted.has(entry.id) || entry.syncAccount) continue
        entry.syncAccount = account
        changed = true
      }
      if (changed) saveAll(all)
    },
    adoptOwned(id, account) {
      const all = loadAll()
      const entry = Object.values(all).find((item) => item.id === id)
      if (!entry || entry.access === 'shared' || entry.syncAccount === account) return
      entry.syncAccount = account
      saveAll(all)
    },
    deviceId,
  }
}

const SYNC_URL = boardSyncUrl()
const SYNC_ERROR_MAX_LENGTH = 256

export function createSyncApi(fetchImpl: typeof fetch = fetch): SyncApi {
  async function call(input: RequestInfo, init?: RequestInit): Promise<SyncResponse> {
    const response = await fetchImpl(input, { credentials: 'include', ...init })
    if (!response.ok) {
      let error: unknown
      try { error = (await response.json())?.error } catch { /* use the status */ }
      const reason = typeof error === 'string' && error.trim()
        ? error.trim().slice(0, SYNC_ERROR_MAX_LENGTH)
        : String(response.status)
      throw new Error(reason)
    }
    return (await response.json()) as SyncResponse
  }
  return {
    pull(cursor) {
      const url = cursor ? `${SYNC_URL}?cursor=${encodeURIComponent(cursor)}` : SYNC_URL
      return call(url)
    },
    push(body) {
      return call(SYNC_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
    },
  }
}
