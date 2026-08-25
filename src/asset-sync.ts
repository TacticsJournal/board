import type { AssetCategory } from './assets.ts'
import { boardAssetsUrl } from './board-api.ts'

export type SyncedAsset = {
  id: string
  name: string
  cat: AssetCategory
  w: number
  h: number
  updatedAt: string
  src?: string
  deleted?: boolean
  syncAccount?: string
}

export type RemoteAsset = {
  id: string
  name: string
  cat: AssetCategory
  w: number
  h: number
  updated_at: string
  deleted_at?: string | null
}

export type AssetSyncStore = {
  list(): SyncedAsset[]
  apply(record: SyncedAsset): void
  bind(ids: string[], account: string): void
}

export type AssetSyncApi = {
  list(): Promise<RemoteAsset[]>
  image(id: string): Promise<string>
  push(record: { id: string; name: string; cat: AssetCategory; w: number; h: number; updated_at: string; deleted?: true; src?: string }): Promise<void>
}

export type AssetSyncResult = { status: 'ok' | 'failed' | 'skipped'; pushed: number; pulled: number }

const later = (left: string, right: string) => {
  const a = Date.parse(left)
  const b = Date.parse(right)
  return Number.isFinite(a) && (!Number.isFinite(b) || a > b)
}

function validRemote(value: unknown): value is RemoteAsset {
  if (!value || typeof value !== 'object') return false
  const a = value as Record<string, unknown>
  return typeof a.id === 'string' && typeof a.name === 'string'
    && (a.cat === 'players' || a.cat === 'arrows' || a.cat === 'zones' || a.cat === 'equipment')
    && typeof a.w === 'number' && Number.isFinite(a.w) && typeof a.h === 'number' && Number.isFinite(a.h)
    && typeof a.updated_at === 'string' && Number.isFinite(Date.parse(a.updated_at))
    && (a.deleted_at == null || typeof a.deleted_at === 'string')
}

/** Reconcile image records independently from projects. All failures leave local bytes untouched. */
export function createAssetSyncApi(fetchImpl: typeof fetch = fetch): AssetSyncApi {
  const call = async (url: string, init?: RequestInit) => {
    const response = await fetchImpl(url, { credentials: 'include', ...init })
    if (!response.ok) throw new Error(String(response.status))
    return response
  }
  return {
    async list() {
      const body = await (await call(boardAssetsUrl())).json() as { assets?: unknown }
      return Array.isArray(body.assets) ? body.assets as RemoteAsset[] : []
    },
    async image(id) {
      const response = await call(`${boardAssetsUrl()}?id=${encodeURIComponent(id)}`)
      const bytes = new Uint8Array(await response.arrayBuffer())
      let binary = ''
      for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
      return `data:image/png;base64,${btoa(binary)}`
    },
    async push(record) {
      await call(boardAssetsUrl(), {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(record),
      })
    },
  }
}

export async function syncAssetsOnce(store: AssetSyncStore, api: AssetSyncApi, account: string | null): Promise<AssetSyncResult> {
  if (!account) return { status: 'skipped', pushed: 0, pulled: 0 }
  let remote: RemoteAsset[]
  try { remote = (await api.list()).filter(validRemote) } catch { return { status: 'failed', pushed: 0, pulled: 0 } }

  let pushed = 0
  let pulled = 0
  try {
    const local = new Map(store.list().map(asset => [asset.id, asset]))
    const remoteById = new Map(remote.map(asset => [asset.id, asset]))
    const protectedIds = new Set([...local.values()]
      .filter(asset => asset.syncAccount && asset.syncAccount !== account).map(asset => asset.id))

    for (const asset of local.values()) {
      if (protectedIds.has(asset.id)) continue
      const server = remoteById.get(asset.id)
      if (!server || later(asset.updatedAt, server.updated_at)) {
        if (!asset.deleted && !asset.src) continue
        await api.push({
          id: asset.id, name: asset.name, cat: asset.cat, w: asset.w, h: asset.h, updated_at: asset.updatedAt,
          ...(asset.deleted ? { deleted: true as const } : { src: asset.src! }),
        })
        store.bind([asset.id], account)
        pushed += 1
      } else if (!server || !later(server.updated_at, asset.updatedAt)) {
        // An equal remote revision confirms an old unbound local upload.
        store.bind([asset.id], account)
      }
    }

    // Work from the list captured before writes. The server keeps older/equal
    // writes as no-ops, so no response is needed to safely retain a local win.
    for (const server of remote) {
      if (protectedIds.has(server.id)) continue
      const asset = local.get(server.id)
      if (asset && !later(server.updated_at, asset.updatedAt)) continue
      const record: SyncedAsset = {
        id: server.id, name: server.name, cat: server.cat, w: server.w, h: server.h,
        updatedAt: server.updated_at, syncAccount: account,
      }
      if (server.deleted_at) record.deleted = true
      else record.src = await api.image(server.id)
      store.apply(record)
      pulled += 1
    }
  } catch {
    return { status: 'failed', pushed, pulled }
  }
  return { status: 'ok', pushed, pulled }
}
