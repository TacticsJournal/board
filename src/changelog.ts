declare const __BOARD_CHANGELOG__: readonly ChangelogEntry[] | undefined

export type ChangelogEntry = {
  id: string
  date: string
  title: string
  body: string
  tag: string
  major: boolean
}

export const CHANGELOG_SEEN_KEY = 'tbm-changelog-seen-v1'

function valid(entry: any): entry is ChangelogEntry {
  return !!entry && typeof entry.id === 'string' && typeof entry.date === 'string' && typeof entry.title === 'string'
}

/** Build-time entries, newest first. Anything unreadable is an empty history. */
export function entries(): ChangelogEntry[] {
  const built = typeof __BOARD_CHANGELOG__ !== 'undefined' ? __BOARD_CHANGELOG__ : undefined
  if (!Array.isArray(built)) return []
  return built.filter(valid).map(entry => ({
    id: entry.id,
    date: entry.date,
    title: entry.title,
    body: typeof entry.body === 'string' ? entry.body : '',
    tag: typeof entry.tag === 'string' ? entry.tag : '',
    major: entry.major === true,
  }))
}

export function seenId(): string | null {
  try { return localStorage.getItem(CHANGELOG_SEEN_KEY) } catch { return null }
}

function storeSeen(id: string) {
  try { localStorage.setItem(CHANGELOG_SEEN_KEY, id) } catch { /* private mode */ }
}

/**
 * Someone opening the board for the first time has nothing to catch up on, so
 * the newest entry is marked seen before anything can announce it.
 */
export function unreadEntries(list = entries()): ChangelogEntry[] {
  if (!list.length) return []
  const marker = seenId()
  if (marker === null) {
    storeSeen(list[0].id)
    return []
  }
  const index = list.findIndex(entry => entry.id === marker)
  if (index >= 0) return list.slice(0, index)
  // A marker from an entry that has since been rewritten still fixes a date,
  // which is enough to tell what came after it.
  const markerDate = marker.slice(0, 10)
  return list.filter(entry => entry.date > markerDate)
}

export function markAllSeen(list = entries()) {
  if (!list.length) return
  storeSeen(list[0].id)
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/** Formatted from the ISO parts, so a timezone cannot shift the day. */
export function entryDate(iso: string): string {
  const [year, month, day] = iso.split('-')
  const name = MONTHS[Number(month) - 1]
  return name ? `${name} ${Number(day)}, ${year}` : iso
}

export function entryMonth(iso: string): string {
  const [year, month] = iso.split('-')
  const name = MONTHS[Number(month) - 1]
  return name ? `${name} ${year}` : iso
}
