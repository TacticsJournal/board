/**
 * The background library: every image someone puts behind the board, kept.
 *
 * The board used to hold exactly one uploaded background and one imported
 * screenshot, both in localStorage, both overwritten by the next upload. A
 * background is a saved thing here instead of a slot: it has a name, it stays
 * until it is deleted, and it appears in the pitch picker beside our own pitch
 * art as `bg:<id>`.
 *
 * Images live in IndexedDB, because localStorage is a ~5MB budget the saved
 * boards already share and one 1600px photo is a sizeable slice of it. Only
 * the small index — name, size, board height — is mirrored to localStorage, so
 * the first paint after a reload knows how tall the board is without waiting
 * for a database to open.
 *
 * Nothing here touches the DOM. The storage driver is injectable, so add,
 * rename, duplicate and delete are all testable without a browser.
 */

import type { LibrarySyncStore, SyncedLibraryRecord } from './library-sync.ts'

const INDEX_KEY = 'tbm-bg-index-v1'
export const BG_PREFIX = 'bg:'

/** Long edge kept for a stored background. An 800-wide board never needs more. */
export const MAX_EDGE = 1600
/** Long edge of the picker thumbnail. */
export const THUMB_EDGE = 360
/** Board width, repeated rather than imported: this module stays free of the scene. */
const BOARD_W = 800
export const MAX_NAME = 60

/**
 * What the image behind the board is, which decides what the board offers on
 * top of it. A pitch is drawn on like our own pitch art: teams, an XI, cones
 * and goals, dark arrows. A broadcast is a camera frame: single live players,
 * a flip, light arrows, and no team overlay.
 */
export type BackgroundKind = 'pitch' | 'broadcast'

export const BACKGROUND_KINDS: BackgroundKind[] = ['pitch', 'broadcast']

export function isBackgroundKind(value: unknown): value is BackgroundKind {
  return value === 'pitch' || value === 'broadcast'
}

export type BackgroundMeta = {
  /** `bg:<something>`; this is also the pitch style id the scene stores. */
  id: string
  name: string
  kind: BackgroundKind
  /** natural size of the stored image */
  w: number
  h: number
  /** board height this image gives an 800-wide board */
  boardH: number
  /** approximate stored size of the full image */
  bytes: number
  at: number
  /** Durable revision used by account sync. */
  updatedAt: string
  syncAccount?: string
  /** Deleted rows remain locally so their delete can reach another device. */
  deleted?: boolean
}

export type StoredBackground = BackgroundMeta & {
  /** data: URL, so it is same-origin and never taints a PNG export. */
  full?: string
  thumb?: string
}

/** Storage for the images themselves. IndexedDB in a browser, memory in tests. */
export type BackgroundDriver = {
  list(): Promise<StoredBackground[]>
  get(id: string): Promise<StoredBackground | null>
  put(record: StoredBackground): Promise<void>
  remove(id: string): Promise<void>
}

export type IndexMirror = {
  read(): BackgroundMeta[]
  write(list: BackgroundMeta[]): void
}

export function isBackgroundId(id: string | undefined | null): boolean {
  return typeof id === 'string' && id.startsWith(BG_PREFIX)
}

/** A name that fits a tile and cannot smuggle control characters into the DOM. */
export function cleanName(value: unknown, fallback = 'Background'): string {
  const text = typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, '').trim() : ''
  return text ? text.slice(0, MAX_NAME) : fallback
}

/** Downscale box for a long edge, never scaling an image up. */
export function fitSize(w: number, h: number, edge: number): { w: number; h: number } {
  const s = Math.min(1, edge / Math.max(w, h))
  return { w: Math.max(1, Math.round(w * s)), h: Math.max(1, Math.round(h * s)) }
}

/** The board an image of this shape makes: the width is fixed, the height follows. */
export function boardHeightFor(w: number, h: number): number {
  if (!(w > 0) || !(h > 0)) return 418
  return Math.max(100, Math.min(4000, Math.round(BOARD_W * h / w)))
}

/** Exact decoded bytes for the base64 image data URLs stored here. */
export function dataUrlBytes(dataUrl: string): number {
  const comma = dataUrl.indexOf(',')
  if (comma < 0 || !/;base64,/i.test(dataUrl.slice(0, comma + 1))) return 0
  const body = dataUrl.slice(comma + 1)
  const padding = body.endsWith('==') ? 2 : body.endsWith('=') ? 1 : 0
  return Math.max(0, Math.floor(body.length * 3 / 4) - padding)
}

/** "Wide camera", then "Wide camera 2": a name the shelf does not already hold. */
export function freeName(base: string, taken: string[]): string {
  const names = new Set(taken)
  if (!names.has(base)) return base
  for (let n = 2; n < 500; n++) {
    const candidate = cleanName(`${base} ${n}`)
    if (!names.has(candidate)) return candidate
  }
  return base
}

function sanitizeMeta(value: unknown): BackgroundMeta | null {
  if (!value || typeof value !== 'object') return null
  const m = value as Record<string, unknown>
  if (typeof m.id !== 'string' || !isBackgroundId(m.id)) return null
  const num = (v: unknown, fallback: number) => typeof v === 'number' && Number.isFinite(v) ? v : fallback
  const w = num(m.w, 800), h = num(m.h, 418)
  const syncEpoch = Date.UTC(2000, 0, 1)
  const at = Math.max(syncEpoch, num(m.at, syncEpoch))
  const legacyTime = new Date(at).toISOString()
  return {
    id: m.id,
    name: cleanName(m.name),
    // Backgrounds saved before the choice existed all behaved as broadcasts.
    kind: isBackgroundKind(m.kind) ? m.kind : 'broadcast',
    w, h,
    boardH: num(m.boardH, boardHeightFor(w, h)),
    bytes: Math.max(0, num(m.bytes, 0)),
    at,
    // Existing shelf rows need a real (old) revision so they upload when no
    // server record exists, without winning over a newer remote revision.
    updatedAt: typeof m.updatedAt === 'string' && Number.isFinite(Date.parse(m.updatedAt)) ? m.updatedAt : legacyTime,
    ...(typeof m.syncAccount === 'string' && m.syncAccount ? { syncAccount: m.syncAccount } : {}),
    ...(m.deleted === true ? { deleted: true } : {}),
  }
}

function sanitizeStored(value: unknown): StoredBackground | null {
  const meta = sanitizeMeta(value)
  if (!meta) return null
  const r = value as Record<string, unknown>
  if (meta.deleted) return meta
  // Only an image data URL is ever handed back to an <img>: bytes that came out
  // of storage are no more trusted than bytes off the wire.
  if (typeof r.full !== 'string' || !r.full.startsWith('data:image/')) return null
  const thumb = typeof r.thumb === 'string' && r.thumb.startsWith('data:image/') ? r.thumb : r.full
  return { ...meta, full: r.full, thumb }
}

/* ---------- drivers ---------- */

export function memoryDriver(seed: StoredBackground[] = []): BackgroundDriver {
  const rows = new Map(seed.map(r => [r.id, r]))
  return {
    async list() { return [...rows.values()] },
    async get(id) { return rows.get(id) ?? null },
    async put(record) { rows.set(record.id, record) },
    async remove(id) { rows.delete(id) },
  }
}

const DB_NAME = 'tbm-backgrounds'
const DB_STORE = 'items'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE, { keyPath: 'id' })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('indexeddb open failed'))
    request.onblocked = () => reject(new Error('indexeddb blocked'))
  })
}

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(db => new Promise<T>((resolve, reject) => {
    const request = run(db.transaction(DB_STORE, mode).objectStore(DB_STORE))
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('indexeddb write failed'))
  }))
}

/** IndexedDB, where the browser gives us one. */
export function browserDriver(): BackgroundDriver {
  return {
    async list() {
      const rows = await tx<unknown[]>('readonly', s => s.getAll() as IDBRequest<unknown[]>)
      return rows.flatMap(row => { const r = sanitizeStored(row); return r ? [r] : [] })
    },
    async get(id) {
      const row = await tx<unknown>('readonly', s => s.get(id) as IDBRequest<unknown>)
      return sanitizeStored(row)
    },
    async put(record) { await tx('readwrite', s => s.put(record) as IDBRequest<IDBValidKey>) },
    async remove(id) { await tx('readwrite', s => s.delete(id) as IDBRequest<undefined>) },
  }
}

export function localStorageMirror(): IndexMirror {
  return {
    read() {
      try {
        const raw = JSON.parse(localStorage.getItem(INDEX_KEY) ?? '[]')
        return Array.isArray(raw) ? raw.flatMap(v => { const m = sanitizeMeta(v); return m ? [m] : [] }) : []
      } catch { return [] }
    },
    write(list) {
      try { localStorage.setItem(INDEX_KEY, JSON.stringify(list)) } catch { /* full or blocked */ }
    },
  }
}

export function memoryMirror(seed: BackgroundMeta[] = []): IndexMirror {
  let rows = seed
  return { read: () => rows, write: (list) => { rows = list } }
}

/* ---------- the library ---------- */

export type NewBackground = {
  name: string
  kind: BackgroundKind
  full: string
  thumb: string
  w: number
  h: number
}

export type BackgroundStore = {
  list(): BackgroundMeta[]
  get(id: string): BackgroundMeta | null
  has(id: string): boolean
  count(): number
  bytes(): number
  readonly ready: boolean
  subscribe(fn: (source?: 'local' | 'remote') => void): () => void
  load(): Promise<void>
  image(id: string): Promise<string | null>
  thumb(id: string): Promise<string | null>
  add(input: NewBackground): Promise<BackgroundMeta>
  rename(id: string, name: string): Promise<void>
  setKind(id: string, kind: BackgroundKind): Promise<void>
  duplicate(id: string): Promise<BackgroundMeta | null>
  remove(id: string): Promise<void>
  /** Async adapter used by library-sync; remote application never announces a local edit. */
  librarySyncStore(): LibrarySyncStore
}

export function createBackgroundStore(
  driver: BackgroundDriver,
  mirror: IndexMirror,
  now: () => number = Date.now,
): BackgroundStore {
  // The index is what the picker and the scene read, and it answers
  // synchronously: the mirror holds it across reloads while the database opens.
  let index: BackgroundMeta[] = mirror.read().filter(meta => !meta.deleted)
  // The mirror is intentionally live-only, but it still gives legacy records
  // an old revision until IndexedDB supplies their bytes and tombstones.
  let records = new Map(index.map(meta => [meta.id, meta]))
  let loaded = false
  const listeners = new Set<(source?: 'local' | 'remote') => void>()
  const images = new Map<string, string>()
  let seq = 0

  function publish(source: 'local' | 'remote' = 'local') {
    mirror.write(index)
    for (const fn of listeners) fn(source)
  }

  function newest(list: BackgroundMeta[]): BackgroundMeta[] {
    return [...list].filter(meta => !meta.deleted).sort((a, b) => b.at - a.at)
  }

  const revision = (previous?: string) => {
    const prior = previous ? Date.parse(previous) : Number.NaN
    return new Date(Math.max(now(), Number.isFinite(prior) ? prior + 1 : 0, Date.UTC(2000, 0, 1))).toISOString()
  }
  const payload = (meta: BackgroundMeta) => ({
    backgroundKind: meta.kind, w: meta.w, h: meta.h, boardH: meta.boardH, bytes: meta.bytes, at: meta.at,
  })
  function replace(meta: BackgroundMeta, source: 'local' | 'remote' = 'local') {
    records.set(meta.id, meta)
    index = newest([...records.values()])
    publish(source)
  }

  async function add(input: NewBackground): Promise<BackgroundMeta> {
    const id = `${BG_PREFIX}${now().toString(36)}-${(seq++).toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`
    const meta: BackgroundMeta = {
      id,
      name: freeName(cleanName(input.name), index.map(m => m.name)),
      kind: isBackgroundKind(input.kind) ? input.kind : 'broadcast',
      w: input.w, h: input.h,
      boardH: boardHeightFor(input.w, input.h),
      bytes: dataUrlBytes(input.full),
      at: now(),
      updatedAt: revision(),
    }
    await driver.put({ ...meta, full: input.full, thumb: input.thumb })
    images.set(id, input.full)
    replace(meta)
    return meta
  }

  return {
    /** Newest first. Safe to call before the database has opened. */
    list() { return index },
    get(id) { return index.find(m => m.id === id) ?? null },
    has(id) { return index.some(m => m.id === id) },
    count() { return index.length },
    bytes() { return index.reduce((n, m) => n + m.bytes, 0) },
    /** True once the database has been read; false while the mirror stands in. */
    get ready() { return loaded },

    subscribe(fn) {
      listeners.add(fn)
      return () => { listeners.delete(fn) }
    },

    /** Read the database and reconcile the mirror with it. */
    async load() {
      let rows: StoredBackground[]
      try { rows = await driver.list() } catch { loaded = true; return }
      // Whatever a driver hands back is checked here too: a row that is not an
      // image never reaches a tile, whichever storage it came out of.
      records = new Map(rows.flatMap(row => {
        const clean = sanitizeStored(row)
        if (!clean) return []
        const { full: _full, thumb: _thumb, ...meta } = clean
        return [[meta.id, meta] as const]
      }))
      index = newest([...records.values()])
      loaded = true
      publish('remote')
    },

    /** The full image, cached: switching back to a background should not re-read it. */
    async image(id) {
      if (records.get(id)?.deleted) return null
      const cached = images.get(id)
      if (cached) return cached
      let row: StoredBackground | null = null
      try { row = sanitizeStored(await driver.get(id)) } catch { return null }
      if (!row?.full) return null
      // A handful is plenty; this is a switching cache, not a store.
      if (images.size > 4) images.delete(images.keys().next().value as string)
      images.set(id, row.full)
      return row.full
    },

    async thumb(id) {
      try { return sanitizeStored(await driver.get(id))?.thumb ?? null } catch { return null }
    },

    add,

    async rename(id, name) {
      const meta = index.find(m => m.id === id)
      if (!meta) return
      const next = freeName(cleanName(name, meta.name), index.filter(m => m.id !== id).map(m => m.name))
      if (next === meta.name) return
      const changed = { ...meta, name: next, updatedAt: revision(meta.updatedAt) }
      const row = await driver.get(id)
      if (row) await driver.put({ ...row, ...changed })
      replace(changed)
    },

    async setKind(id, kind) {
      const meta = index.find(m => m.id === id)
      if (!meta || !isBackgroundKind(kind) || meta.kind === kind) return
      const changed = { ...meta, kind, updatedAt: revision(meta.updatedAt) }
      const row = await driver.get(id)
      if (row) await driver.put({ ...row, ...changed })
      replace(changed)
    },

    async duplicate(id) {
      const row = await driver.get(id)
      if (!row?.full) return null
      return add({ name: `${row.name} copy`, kind: row.kind, full: row.full, thumb: row.thumb ?? row.full, w: row.w, h: row.h })
    },

    async remove(id) {
      const meta = records.get(id)
      if (!meta || meta.deleted) return
      const deleted = { ...meta, deleted: true, updatedAt: revision(meta.updatedAt) }
      try { await driver.put(deleted) } catch { /* keep the local tombstone in memory */ }
      images.delete(id)
      replace(deleted)
    },

    librarySyncStore(): LibrarySyncStore {
      return {
        async list() {
          // Include IndexedDB tombstones even if authentication completed before
          // the normal picker startup had finished opening the database.
          if (!loaded) await thisLoad()
          const out: SyncedLibraryRecord[] = []
          for (const meta of records.values()) {
            const src = meta.deleted ? null : await thisImage(meta.id)
            const record: SyncedLibraryRecord = {
              id: meta.id, kind: 'background', name: meta.name,
              payload: { ...payload(meta), ...(src ? { bytes: dataUrlBytes(src) } : {}) },
              updatedAt: meta.updatedAt, ...(meta.syncAccount ? { syncAccount: meta.syncAccount } : {}),
            }
            if (meta.deleted) record.deleted = true
            else if (src) record.src = src
            out.push(record)
          }
          return out
        },
        async apply(record) {
          if (record.kind !== 'background') return
          const current = records.get(record.id)
          if (current && Date.parse(current.updatedAt) >= Date.parse(record.updatedAt)) return
          const data = record.payload && typeof record.payload === 'object'
            ? record.payload as Record<string, unknown> : {}
          const w = typeof data.w === 'number' && data.w > 0 ? data.w : current?.w ?? 800
          const h = typeof data.h === 'number' && data.h > 0 ? data.h : current?.h ?? 418
          const meta: BackgroundMeta = {
            id: record.id, name: cleanName(record.name),
            kind: isBackgroundKind(data.backgroundKind) ? data.backgroundKind : current?.kind ?? 'broadcast', w, h,
            boardH: typeof data.boardH === 'number' && data.boardH > 0 ? data.boardH : current?.boardH ?? boardHeightFor(w, h),
            bytes: typeof record.src === 'string' ? dataUrlBytes(record.src)
              : typeof data.bytes === 'number' && data.bytes >= 0 ? data.bytes : current?.bytes ?? 0,
            at: typeof data.at === 'number' && Number.isFinite(data.at) ? data.at : current?.at ?? Date.parse(record.updatedAt),
            updatedAt: record.updatedAt, ...(record.syncAccount ? { syncAccount: record.syncAccount } : {}),
            ...(record.deleted ? { deleted: true } : {}),
          }
          if (meta.deleted) {
            await driver.put(meta)
            images.delete(meta.id)
          } else if (typeof record.src === 'string' && record.src.startsWith('data:image/jpeg')) {
            // A full JPEG is a valid tile until a browser has made a smaller one.
            await driver.put({ ...meta, full: record.src, thumb: record.src })
            images.set(meta.id, record.src)
          } else return
          replace(meta, 'remote')
        },
        async bind(ids, account) {
          for (const id of ids) {
            const meta = records.get(id)
            if (!meta || (meta.syncAccount && meta.syncAccount !== account)) continue
            const bound = { ...meta, syncAccount: account }
            const row = await driver.get(id)
            if (row) await driver.put({ ...row, syncAccount: account })
            records.set(id, bound)
          }
          index = newest([...records.values()])
          mirror.write(index)
        },
      }
    },
  }

  // Avoid exposing the image cache through the adapter object and keep list()
  // safe when it is called after methods have been detached.
  async function thisLoad() {
    let rows: StoredBackground[]
    try { rows = await driver.list() } catch { loaded = true; return }
    records = new Map(rows.flatMap(row => {
      const clean = sanitizeStored(row)
      if (!clean) return []
      const { full: _full, thumb: _thumb, ...meta } = clean
      return [[meta.id, meta] as const]
    }))
    index = newest([...records.values()])
    loaded = true
    publish('remote')
  }

  async function thisImage(id: string) {
    if (records.get(id)?.deleted) return null
    const cached = images.get(id)
    if (cached) return cached
    try {
      const row = sanitizeStored(await driver.get(id))
      if (!row?.full) return null
      images.set(id, row.full)
      return row.full
    } catch { return null }
  }
}
