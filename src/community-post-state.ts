/* What this device remembers about posting boards to Community.
 *
 * Two small facts, both local to the browser: which of this device's boards
 * already have a post, so the share menu can say so rather than ask again, and
 * whether the one-time line telling a member that boards can go to Community
 * has been shown. Nothing here is authority — the server owns whether a post
 * exists — so a cleared browser costs a reader nothing but the reminder.
 */

const POSTED_KEY = 'tj.board.communityPosts.v1'
const HINT_KEY = 'tj.board.communityHint.v1'

export type CommunityPostRecord = {
  /** The board copy the post points at, which an update rewrites. */
  shareId: string
  postId: string
  communityUrl: string
  /** ISO 8601, written when the post was created or last updated. */
  at: string
}

type PostedMap = Record<string, CommunityPostRecord>

function storage(): Storage | null {
  try { return window.localStorage } catch { return null }
}

function readPosted(): PostedMap {
  const store = storage()
  if (!store) return {}
  let raw: string | null
  try { raw = store.getItem(POSTED_KEY) } catch { return {} }
  if (!raw) return {}
  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch { return {} }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
  const map: PostedMap = {}
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue
    const record = value as Record<string, unknown>
    if (typeof record.shareId !== 'string' || !/^[A-Za-z0-9_-]{22}$/.test(record.shareId)) continue
    if (typeof record.postId !== 'string' || !record.postId) continue
    if (typeof record.communityUrl !== 'string' || !record.communityUrl.startsWith('https://tacticsjournal.com/community/')) continue
    if (typeof record.at !== 'string' || Number.isNaN(Date.parse(record.at))) continue
    map[key] = { shareId: record.shareId, postId: record.postId, communityUrl: record.communityUrl, at: record.at }
  }
  return map
}

function writePosted(map: PostedMap): void {
  const store = storage()
  if (!store) return
  try { store.setItem(POSTED_KEY, JSON.stringify(map)) } catch {}
}

/** One board of one project. Both ids, so a copied board is not the original. */
export function boardPostKey(projectId: string, boardId: string): string {
  return `${projectId}:${boardId}`
}

export function communityPostFor(key: string): CommunityPostRecord | null {
  return readPosted()[key] || null
}

export function rememberCommunityPost(key: string, record: CommunityPostRecord): void {
  const map = readPosted()
  map[key] = record
  writePosted(map)
}

/** Called when the server says the post is gone, so the menu stops claiming it. */
export function forgetCommunityPost(key: string): void {
  const map = readPosted()
  if (!(key in map)) return
  delete map[key]
  writePosted(map)
}

/* The one-time line. It is offered after a member has shared a board
   privately — an export or a copied link — because that is when they have
   shown they want to send this board somewhere. It is never a dialog, never
   interrupts either action, and never returns once it has been dismissed or
   the member has posted a board. */
export function communityHintDue(): boolean {
  const store = storage()
  if (!store) return false
  try { return store.getItem(HINT_KEY) !== 'done' } catch { return false }
}

export function retireCommunityHint(): void {
  const store = storage()
  if (!store) return
  try { store.setItem(HINT_KEY, 'done') } catch {}
}

/** "2h ago", in the words the Community itself uses for a post's age. */
export function postedAgo(at: string, now = Date.now()): string {
  const then = Date.parse(at)
  if (Number.isNaN(then)) return ''
  const seconds = Math.max(0, Math.floor((now - then) / 1000))
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  const weeks = Math.floor(days / 7)
  if (weeks < 5) return `${weeks}w ago`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months}mo ago`
  return `${Math.floor(days / 365)}y ago`
}
