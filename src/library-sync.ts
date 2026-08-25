import { boardLibrariesUrl } from './board-api.ts'

export type LibraryKind = 'background' | 'stamp' | 'team_setup' | 'category_scenes'

export type SyncedLibraryRecord = {
  id: string
  kind: LibraryKind
  name: string
  payload: unknown
  updatedAt: string
  deleted?: boolean
  src?: string
  syncAccount?: string
}

export type RemoteLibraryRecord = {
  id: string
  kind: LibraryKind
  name: string
  payload: unknown
  updated_at: string
  deleted_at?: string | null
}

export type LibrarySyncStore = {
  list(): SyncedLibraryRecord[] | Promise<SyncedLibraryRecord[]>
  apply(record: SyncedLibraryRecord): void | Promise<void>
  bind(ids: string[], account: string): void | Promise<void>
}

export type LibrarySyncApi = {
  list(): Promise<RemoteLibraryRecord[]>
  image(id: string): Promise<string>
  push(record: { id: string; kind: LibraryKind; name: string; payload: unknown; updated_at: string; deleted?: true; src?: string }): Promise<void>
}

export type ReferencedBackgroundProject = {
  boards?: readonly { scene?: { pitch?: unknown } }[]
}

export function referencedBackgroundIds(project: ReferencedBackgroundProject): string[] {
  const ids = new Set<string>()
  for (const board of project.boards ?? []) {
    const id = board.scene?.pitch
    if (typeof id === 'string' && id.startsWith('bg:')) ids.add(id)
  }
  return [...ids]
}

/** Push only the JPEG rows named by a Project that is about to be shared. */
export async function pushReferencedBackgrounds(
  project: ReferencedBackgroundProject,
  store: LibrarySyncStore,
  api: LibrarySyncApi,
  account: string | null,
  options: { stillCurrent?: () => boolean } = {},
): Promise<void> {
  const rows = new Map((await store.list()).filter(row => row.kind === 'background').map(row => [row.id, row]))
  for (const id of referencedBackgroundIds(project)) {
    if (options.stillCurrent && !options.stillCurrent()) throw new Error('The account changed while preparing the Project.')
    const row = rows.get(id)
    if (!row || row.deleted || typeof row.src !== 'string' || !row.src.startsWith('data:image/jpeg')) {
      throw new Error(`The background ${id} is unavailable on this device.`)
    }
    if (row.syncAccount && row.syncAccount !== account) {
      throw new Error(`The background ${id} belongs to another account.`)
    }
    await api.push({
      id: row.id, kind: row.kind, name: row.name, payload: row.payload,
      updated_at: row.updatedAt, src: row.src,
    })
    if (options.stillCurrent && !options.stillCurrent()) throw new Error('The account changed while preparing the Project.')
    if (account) await store.bind([row.id], account)
  }
}

export type LibrarySyncResult = { status: 'ok' | 'failed' | 'skipped'; pushed: number; pulled: number }

const kinds = new Set<LibraryKind>(['background', 'stamp', 'team_setup', 'category_scenes'])
const later = (left: string, right: string) => {
  const a = Date.parse(left)
  const b = Date.parse(right)
  return Number.isFinite(a) && (!Number.isFinite(b) || a > b)
}

function validRemote(value: unknown): value is RemoteLibraryRecord {
  if (!value || typeof value !== 'object') return false
  const row = value as Record<string, unknown>
  return typeof row.id === 'string' && kinds.has(row.kind as LibraryKind)
    && typeof row.name === 'string' && typeof row.updated_at === 'string'
    && Number.isFinite(Date.parse(row.updated_at))
    && (row.deleted_at == null || typeof row.deleted_at === 'string')
}

/** Board-host API for durable, non-Project library records. */
export function createLibrarySyncApi(fetchImpl: typeof fetch = fetch): LibrarySyncApi {
  const call = async (url: string, init?: RequestInit) => {
    const response = await fetchImpl(url, { credentials: 'include', ...init })
    if (!response.ok) throw new Error(String(response.status))
    return response
  }
  return {
    async list() {
      const body = await (await call(boardLibrariesUrl())).json() as { items?: unknown }
      return Array.isArray(body.items) ? body.items.filter(validRemote) : []
    },
    async image(id) {
      const response = await call(`${boardLibrariesUrl()}?id=${encodeURIComponent(id)}`)
      const bytes = new Uint8Array(await response.arrayBuffer())
      let binary = ''
      for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
      return `data:image/jpeg;base64,${btoa(binary)}`
    },
    async push(record) {
      await call(boardLibrariesUrl(), {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(record),
      })
    },
  }
}

/**
 * Reconcile durable personal-library rows. A record bound to a different
 * account is completely invisible to this pass; this keeps account switches
 * from uploading or overwriting private local work.
 */
export async function syncLibrariesOnce(store: LibrarySyncStore, api: LibrarySyncApi, account: string | null): Promise<LibrarySyncResult> {
  if (!account) return { status: 'skipped', pushed: 0, pulled: 0 }
  let remote: RemoteLibraryRecord[]
  try { remote = (await api.list()).filter(validRemote) } catch { return { status: 'failed', pushed: 0, pulled: 0 } }

  let pushed = 0
  let pulled = 0
  try {
    const local = new Map((await store.list()).map(row => [row.id, row]))
    const remoteById = new Map(remote.map(row => [row.id, row]))
    const protectedIds = new Set([...local.values()]
      .filter(row => row.syncAccount && row.syncAccount !== account).map(row => row.id))

    for (const row of local.values()) {
      if (protectedIds.has(row.id)) continue
      const server = remoteById.get(row.id)
      if (!server || later(row.updatedAt, server.updated_at)) {
        // A live background without bytes cannot safely replace the server.
        if (!row.deleted && row.kind === 'background' && !row.src) continue
        await api.push({
          id: row.id, kind: row.kind, name: row.name, payload: row.payload, updated_at: row.updatedAt,
          ...(row.deleted ? { deleted: true as const } : row.kind === 'background' ? { src: row.src! } : {}),
        })
        await store.bind([row.id], account)
        pushed += 1
      } else if (!later(server.updated_at, row.updatedAt)) {
        // Equal revisions accept legacy, unbound rows without changing bytes.
        await store.bind([row.id], account)
      }
    }

    for (const server of remote) {
      if (protectedIds.has(server.id)) continue
      const row = local.get(server.id)
      if (row && !later(server.updated_at, row.updatedAt)) continue
      const next: SyncedLibraryRecord = {
        id: server.id, kind: server.kind, name: server.name, payload: server.payload,
        updatedAt: server.updated_at, syncAccount: account,
      }
      if (server.deleted_at) next.deleted = true
      else if (server.kind === 'background') next.src = await api.image(server.id)
      await store.apply(next)
      pulled += 1
    }
  } catch {
    return { status: 'failed', pushed, pulled }
  }
  return { status: 'ok', pushed, pulled }
}
