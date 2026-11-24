/** Reusable object arrangements, stored in this browser. */
import type { SceneObj } from './types.ts'
import { sanitizeObjects } from './types.ts'

export type Stamp = {
  id: string
  name: string
  /** One of the built-in shelf rows, or a name the user typed. */
  cat: string
  objects: SceneObj[]
  w: number
  h: number
  at: number
  updatedAt: string
  /** Old delete records from retired account sync. Never shown. */
  deleted?: boolean
}

const KEY = 'tbm-stamps-v1'
/** Well inside what an origin gets, and shared with nothing else here. */
export const STAMP_BUDGET_BYTES = 400_000
export const MAX_STAMP_OBJECTS = 60
export const MAX_CAT_LENGTH = 18

export class StampQuotaError extends Error {
  constructor() { super('There is no room left for another saved combination.') }
}

let cache: Stamp[] | null = null
const listeners = new Set<() => void>()
const SYNC_EPOCH = Date.UTC(2000, 0, 1)

function timestamp(at: number) { return new Date(Math.max(SYNC_EPOCH, at)).toISOString() }
function nextTimestamp(previous: string, at = Date.now()) {
  const prior = Date.parse(previous)
  return new Date(Math.max(SYNC_EPOCH, at, Number.isFinite(prior) ? prior + 1 : 0)).toISOString()
}

function read(): Stamp[] {
  if (cache) return cache
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]')
    cache = Array.isArray(raw) ? raw.map(clean).filter(Boolean) as Stamp[] : []
  } catch { cache = [] }
  return cache
}

/** Stamps come back through the scene sanitizer, like any other stored scene. */
function clean(value: unknown): Stamp | null {
  if (!value || typeof value !== 'object') return null
  const s = value as Record<string, any>
  if (typeof s.id !== 'string' || typeof s.name !== 'string') return null
  const cat = normalizeCat(s.cat)
  if (!cat) return null
  const objects = sanitizeObjects(Array.isArray(s.objects) ? s.objects : []).slice(0, MAX_STAMP_OBJECTS)
  // Old delete records may have no payload; keep them so they stay hidden.
  if (!objects.length && !s.deleted) return null
  const at = Number.isFinite(s.at) ? s.at : 0
  return {
    id: s.id, name: s.name.slice(0, 40), cat, objects,
    w: Number.isFinite(s.w) && s.w > 0 ? s.w : 100,
    h: Number.isFinite(s.h) && s.h > 0 ? s.h : 100,
    at,
    updatedAt: typeof s.updatedAt === 'string' && Number.isFinite(Date.parse(s.updatedAt)) ? s.updatedAt : timestamp(at),
    ...(s.deleted === true ? { deleted: true } : {}),
  }
}

/** A category is a plain short name; anything unusable falls back to nothing. */
export function normalizeCat(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value.replace(/[^\p{L}\p{N} '&-]/gu, '').trim().slice(0, MAX_CAT_LENGTH)
}

function write(next: Stamp[], notify = true) {
  // Deletes do not take space away from the visible-library limit.
  if (JSON.stringify(next.filter(stamp => !stamp.deleted)).length > STAMP_BUDGET_BYTES) throw new StampQuotaError()
  cache = next
  try { localStorage.setItem(KEY, JSON.stringify(next)) } catch { cache = null; throw new StampQuotaError() }
  if (notify) for (const fn of listeners) fn()
}

export function subscribe(fn: () => void) { listeners.add(fn); return () => listeners.delete(fn) }

export function listStamps(cat?: string): Stamp[] {
  const all = read().filter(stamp => !stamp.deleted)
  return cat ? all.filter(s => s.cat === cat) : all
}

/** Categories the user invented, in the order they first used them. */
export function customCats(builtIn: readonly string[]): string[] {
  const seen: string[] = []
  for (const s of listStamps()) {
    if (builtIn.includes(s.cat) || seen.includes(s.cat)) continue
    seen.push(s.cat)
  }
  return seen
}

export function usedBytes(): number { return JSON.stringify(listStamps()).length }

export function addStamp(s: Omit<Stamp, 'id' | 'at' | 'updatedAt' | 'deleted'>): Stamp {
  const at = Date.now()
  const stamp: Stamp = { ...s, id: `st-${Math.random().toString(36).slice(2, 10)}`, at, updatedAt: timestamp(at) }
  write([...read(), stamp])
  return stamp
}

export function removeStamp(id: string) {
  write(read().filter(stamp => stamp.id !== id))
}

export function updateStamp(id: string, patch: Partial<Pick<Stamp, 'name' | 'cat'>>) {
  const now = Date.now()
  write(read().map(stamp => stamp.id === id && !stamp.deleted
    ? { ...stamp, ...patch, updatedAt: nextTimestamp(stamp.updatedAt, now) } : stamp))
}

