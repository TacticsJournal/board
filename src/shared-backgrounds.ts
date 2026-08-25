import { sharedBoardLibraryUrl } from './board-api.ts'
import type { PitchStyle } from './pitches.ts'

export const MAX_SHARED_BACKGROUND_BYTES = 5 * 1024 * 1024
export const MAX_SHARED_BACKGROUND_HEIGHT = 32768

export type SharedBackground = {
  id: string
  src: string
  etag: string
  kind: 'pitch' | 'broadcast'
  boardH: number
  updatedAt: string
}

export type SharedBackgroundResolver = ((id: string) => Promise<string | null>) & {
  clear(): void
  cached(): SharedBackground[]
}

type FetchLike = typeof fetch

type SharedBackgroundOptions = {
  fetchImpl?: FetchLike
  invitationToken?: string
  onResolved?: (background: SharedBackground) => void
  onMissing?: (id: string) => void
}

function header(response: Response, name: string): string | null {
  const value = response.headers.get(name)
  return value && value.trim() ? value.trim() : null
}

function validHeight(value: string | null): number | null {
  if (!value || !/^\d+$/.test(value)) return null
  const height = Number(value)
  return Number.isInteger(height) && height >= 1 && height <= MAX_SHARED_BACKGROUND_HEIGHT ? height : null
}

function validUpdatedAt(value: string | null): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) return null
  return value
}

function base64(bytes: Uint8Array): string {
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  }
  return btoa(binary)
}

/** Validate the complete response before making bytes available to an image. */
export async function readSharedBackground(response: Response): Promise<SharedBackground | null> {
  if (response.status !== 200) return null
  const contentType = header(response, 'Content-Type')?.split(';', 1)[0].toLowerCase()
  if (contentType !== 'image/jpeg') return null

  const contentLength = response.headers.get('Content-Length')
  if (contentLength !== null && (!/^\d+$/.test(contentLength.trim()) || Number(contentLength) > MAX_SHARED_BACKGROUND_BYTES)) return null

  const etag = header(response, 'ETag')
  const kind = header(response, 'X-Board-Background-Kind')
  const boardH = validHeight(header(response, 'X-Board-Background-Height'))
  const updatedAt = validUpdatedAt(header(response, 'X-Board-Background-Updated-At'))
  if (!etag || (kind !== 'pitch' && kind !== 'broadcast') || boardH === null || !updatedAt) return null

  let bytes: Uint8Array
  try { bytes = new Uint8Array(await response.arrayBuffer()) } catch { return null }
  if (bytes.length > MAX_SHARED_BACKGROUND_BYTES || bytes.length < 4) return null
  if (contentLength !== null && Number(contentLength.trim()) !== bytes.length) return null
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9) return null

  return {
    id: '', src: `data:image/jpeg;base64,${base64(bytes)}`, etag, kind, boardH, updatedAt,
  }
}

/** Build a memory-only resolver for one durable shared-Project row. */
export function createSharedBackgroundResolver(
  rowId: string,
  options: SharedBackgroundOptions = {},
): SharedBackgroundResolver {
  const fetchImpl = options.fetchImpl ?? fetch
  const cache = new Map<string, SharedBackground>()
  const requestSequences = new Map<string, number>()
  let generation = 0

  const resolve = async (id: string): Promise<string | null> => {
    const key = `${rowId}\u0000${id}`
    const prior = cache.get(key)
    const requestGeneration = generation
    const requestSequence = (requestSequences.get(key) ?? 0) + 1
    requestSequences.set(key, requestSequence)
    const isCurrent = () => requestGeneration === generation && requestSequences.get(key) === requestSequence
    const headers: HeadersInit = {}
    if (prior?.etag) headers['If-None-Match'] = prior.etag

    let response: Response
    try {
      response = await fetchImpl(sharedBoardLibraryUrl(rowId, id, options.invitationToken), { credentials: 'include', headers })
    } catch {
      if (!isCurrent()) return null
      cache.delete(key)
      options.onMissing?.(id)
      return null
    }
    if (!isCurrent()) return null

    if (response.status === 404) {
      cache.delete(key)
      options.onMissing?.(id)
      return null
    }
    if (response.status === 304) {
      if (prior?.src) return prior.src
      options.onMissing?.(id)
      return null
    }
    if (response.status !== 200) {
      cache.delete(key)
      options.onMissing?.(id)
      return null
    }

    const result = await readSharedBackground(response)
    if (!isCurrent()) return null
    if (!result) {
      cache.delete(key)
      options.onMissing?.(id)
      return null
    }
    const background = { ...result, id }
    cache.set(key, background)
    options.onResolved?.(background)
    return background.src
  }

  resolve.clear = () => {
    generation += 1
    cache.clear()
    requestSequences.clear()
  }
  resolve.cached = () => [...cache.values()]
  return resolve
}

export function sharedBackgroundPitchStyle(background: SharedBackground): PitchStyle {
  const live = background.kind === 'broadcast'
  return {
    id: background.id,
    label: 'Shared background',
    src: background.src,
    boardH: background.boardH,
    category: live ? 'live' : 'custom',
    sides: 1,
    pro: false,
    custom: true,
    ...(live ? { live: true } : {}),
  }
}
