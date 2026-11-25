/** Local saved boards are unlimited, and every one of them is editable. */
export type SavedBoardRecord = Readonly<{ savedAt: string }>
export type SavedBoardCollection = Readonly<Record<string, SavedBoardRecord>>

function savedTime(record: SavedBoardRecord | undefined): number | null {
  if (!record || typeof record.savedAt !== 'string') return null
  const time = Date.parse(record.savedAt)
  return Number.isFinite(time) ? time : null
}

function compareNames(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/** Newest first. Invalid dates rank oldest; names make every tie deterministic. */
export function savedBoardNamesByRecency(boards: SavedBoardCollection): string[] {
  return Object.keys(boards).sort((a, b) => {
    const aTime = savedTime(boards[a])
    const bTime = savedTime(boards[b])
    if (aTime === null && bTime !== null) return 1
    if (aTime !== null && bTime === null) return -1
    if (aTime !== null && bTime !== null && aTime !== bTime) return bTime < aTime ? -1 : 1
    return compareNames(a, b)
  })
}

export type StorageWriter = Pick<Storage, 'setItem'>

/** localStorage setItem is atomic: report failure and leave the prior value untouched. */
export function writeSavedBoards(
  storage: StorageWriter,
  storageKey: string,
  boards: unknown,
): { ok: true } | { ok: false; error: unknown } {
  try {
    const serialized = JSON.stringify(boards)
    storage.setItem(storageKey, serialized)
    return { ok: true }
  } catch (error) {
    return { ok: false, error }
  }
}
