import type { SyncedAsset } from './asset-sync'

/** A user's own shapes: crests, coaching keys, custom tokens. */
export type AssetCategory = 'players' | 'arrows' | 'zones' | 'equipment'
export const ASSET_CATEGORIES: AssetCategory[] = ['players', 'arrows', 'zones', 'equipment']

export type UserAsset = {
  id: string
  name: string
  cat: AssetCategory
  /** data: URL, so it is same-origin and never taints a PNG export. */
  src: string
  w: number
  h: number
  at: number
  /** Last local or accepted remote revision. */
  updatedAt: string
  /** Account that accepted this asset. Unbound old assets are claimed on first Pro sync. */
  syncAccount?: string
}

type StoredAsset = Omit<UserAsset, 'src'> & { src?: string; deleted?: true }

const KEY = 'tbm-assets-v1'
/** Comfortably inside the 5MB localStorage budget most browsers give an origin. */
export const ASSET_BUDGET_BYTES = 4_200_000
/** Long edge after downscaling. A crest on a 800-wide board never needs more. */
const MAX_EDGE = 512

export class AssetQuotaError extends Error {
  constructor() { super('There is no room left for another asset.') }
}

let cache: StoredAsset[] | null = null
const listeners = new Set<() => void>()
const timestamp = (value: unknown, fallback = new Date(0).toISOString()) =>
  typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : fallback

function normalize(value: unknown): StoredAsset | null {
  if (!value || typeof value !== 'object') return null
  const a = value as Record<string, unknown>
  if (typeof a.id !== 'string' || typeof a.name !== 'string' || !ASSET_CATEGORIES.includes(a.cat as AssetCategory)) return null
  const at = typeof a.at === 'number' && Number.isFinite(a.at) ? a.at : Date.now()
  const common = {
    id: a.id, name: a.name, cat: a.cat as AssetCategory,
    w: typeof a.w === 'number' && Number.isFinite(a.w) ? a.w : 1,
    h: typeof a.h === 'number' && Number.isFinite(a.h) ? a.h : 1,
    at, updatedAt: timestamp(a.updatedAt, new Date(at).toISOString()),
    ...(typeof a.syncAccount === 'string' ? { syncAccount: a.syncAccount } : {}),
  }
  if (a.deleted === true) return { ...common, deleted: true }
  // Keep this explicit validation: remote bytes and old storage never become
  // renderable unless they are an image data URL.
  if (typeof a.src !== 'string' || !a.src.startsWith('data:image/')) return null
  return { ...common, src: a.src }
}

function read(): StoredAsset[] {
  if (cache) return cache
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]')
    cache = Array.isArray(raw) ? raw.flatMap(value => {
      const asset = normalize(value)
      return asset ? [asset] : []
    }) : []
  } catch { cache = [] }
  return cache
}

function write(next: StoredAsset[], notify = true) {
  cache = next
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    cache = null
    throw new AssetQuotaError()
  }
  if (notify) for (const fn of listeners) fn()
}

export function subscribe(fn: () => void) { listeners.add(fn); return () => listeners.delete(fn) }

export function listAssets(cat?: AssetCategory): UserAsset[] {
  const all = read().filter((a): a is UserAsset => !a.deleted && typeof a.src === 'string')
  return cat ? all.filter(a => a.cat === cat) : all
}

export function getAsset(id: string): UserAsset | undefined { return listAssets().find(a => a.id === id) }
export function usedBytes(): number { return listAssets().reduce((sum, a) => sum + a.src.length, 0) }

export function addAsset(a: Omit<UserAsset, 'id' | 'at' | 'updatedAt' | 'syncAccount'>): UserAsset {
  if (usedBytes() + a.src.length > ASSET_BUDGET_BYTES) throw new AssetQuotaError()
  const now = new Date().toISOString()
  const asset: UserAsset = { ...a, id: `as-${Math.random().toString(36).slice(2, 10)}`, at: Date.now(), updatedAt: now }
  write([...read(), asset])
  return asset
}

export function updateAsset(id: string, patch: Partial<Pick<UserAsset, 'name' | 'cat' | 'src' | 'w' | 'h'>>) {
  const now = new Date().toISOString()
  const next = read().map(a => (a.id === id && !a.deleted ? { ...a, ...patch, updatedAt: now } : a))
  const size = next.reduce((sum, a) => sum + (a.deleted ? 0 : a.src?.length ?? 0), 0)
  if (size > ASSET_BUDGET_BYTES) throw new AssetQuotaError()
  write(next)
}

/** Keep delete records until the account service accepts them. */
export function removeAsset(id: string) {
  const now = new Date().toISOString()
  write(read().map(a => a.id === id && !a.deleted ? { ...a, src: undefined, deleted: true as const, updatedAt: now } : a))
}

/** Internal adapter for account sync. Remote writes deliberately do not notify/schedule another pass. */
export function assetSyncStore() {
  return {
    list: (): SyncedAsset[] => read().map(a => ({
      id: a.id, name: a.name, cat: a.cat, w: a.w, h: a.h, updatedAt: a.updatedAt,
      ...(a.src ? { src: a.src } : {}), ...(a.deleted ? { deleted: true as const } : {}),
      ...(a.syncAccount ? { syncAccount: a.syncAccount } : {}),
    })),
    apply(record: SyncedAsset) {
      const incoming = normalize({ ...record, at: Date.parse(record.updatedAt), src: record.src })
      if (!incoming) return
      const next = read().filter(a => a.id !== incoming.id)
      if (!incoming.deleted && usedBytes() - (getAsset(incoming.id)?.src.length ?? 0) + (incoming.src?.length ?? 0) > ASSET_BUDGET_BYTES) return
      write([...next, incoming], false)
    },
    bind(ids: string[], account: string) {
      const wanted = new Set(ids)
      const next = read().map(a => wanted.has(a.id) && (!a.syncAccount || a.syncAccount === account) ? { ...a, syncAccount: account } : a)
      write(next, false)
    },
  }
}

/** Read a picked file into a downscaled PNG data URL. */
export function readImageFile(file: File): Promise<{ src: string; w: number; h: number }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('That file could not be read.'))
    reader.onload = () => {
      const img = new Image()
      img.onerror = () => reject(new Error('That file is not an image the board can use.'))
      img.onload = () => {
        const scale = Math.min(1, MAX_EDGE / Math.max(img.width, img.height))
        const w = Math.max(1, Math.round(img.width * scale))
        const h = Math.max(1, Math.round(img.height * scale))
        const canvas = document.createElement('canvas')
        canvas.width = w; canvas.height = h
        const ctx = canvas.getContext('2d')
        if (!ctx) { reject(new Error('That file could not be prepared.')); return }
        ctx.drawImage(img, 0, 0, w, h)
        resolve({ src: canvas.toDataURL('image/png'), w, h })
      }
      img.src = String(reader.result)
    }
    reader.readAsDataURL(file)
  })
}
