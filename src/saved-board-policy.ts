export const FREE_EDITABLE_BOARD_LIMIT = 3

export type SavedBoardRecord = Readonly<{ savedAt: string; access?: 'shared' }>
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

/** Shared boards are editable for their collaborator and do not use a personal Free slot. */
export function sharedBoardNames(boards: SavedBoardCollection): ReadonlySet<string> {
  return new Set(Object.entries(boards).flatMap(([name, board]) => board.access === 'shared' ? [name] : []))
}

/** Free keeps every record, but only its three most recently edited personal records are writable. */
export function editableBoardNames(boards: SavedBoardCollection, pro: boolean): ReadonlySet<string> {
  const names = savedBoardNamesByRecency(boards)
  const shared = sharedBoardNames(boards)
  const personal = names.filter((name) => !shared.has(name))
  return new Set(pro ? names : [...shared, ...personal.slice(0, FREE_EDITABLE_BOARD_LIMIT)])
}

export function canCreateSavedBoard(boards: SavedBoardCollection, pro: boolean): boolean {
  return pro || Object.values(boards).filter((board) => board.access !== 'shared').length < FREE_EDITABLE_BOARD_LIMIT
}

export type SlotSwapResult =
  | { ok: true; boards: Record<string, SavedBoardRecord> }
  | { ok: false; reason: string }

/**
 * Swap one editable slot with a read-only board. The sacrifice board
 * becomes read-only and the target board takes its editable slot.
 * Neither board is deleted or overwritten -- only savedAt timestamps
 * change so the target ranks among the three most recent.
 *
 * Pro users never need this (all boards are editable).
 */
export function swapEditableSlot(
  boards: SavedBoardCollection,
  sacrificeName: string,
  targetName: string,
): SlotSwapResult {
  if (sacrificeName === targetName) return { ok: false, reason: 'Cannot swap a board with itself.' }
  if (!boards[sacrificeName]) return { ok: false, reason: 'The board to swap out does not exist.' }
  if (!boards[targetName]) return { ok: false, reason: 'The board to swap in does not exist.' }
  if (boards[sacrificeName].access === 'shared') {
    return { ok: false, reason: 'Shared boards do not use a personal editable slot.' }
  }

  const editable = editableBoardNames(boards, false)
  if (!editable.has(sacrificeName)) return { ok: false, reason: 'The board to swap out is not currently editable.' }
  if (editable.has(targetName)) return { ok: false, reason: 'The board to swap in is already editable.' }

  // Give the target the sacrifice's timestamp and push the sacrifice
  // just behind the oldest editable board so it drops out of the top 3.
  const recency = savedBoardNamesByRecency(boards)
  const editableList = recency.filter((n) => editable.has(n))
  const oldestEditable = editableList[editableList.length - 1]

  // The target takes the sacrifice's position by inheriting its savedAt.
  // The sacrifice gets a timestamp one millisecond before the oldest
  // editable board, ensuring it drops below the free limit.
  const oldestTime = savedTime(boards[oldestEditable])
  const demotedTime = oldestTime !== null
    ? new Date(oldestTime - 1).toISOString()
    : boards[sacrificeName].savedAt

  const updated = { ...boards }
  updated[targetName] = { ...boards[targetName], savedAt: boards[sacrificeName].savedAt }
  updated[sacrificeName] = { ...boards[sacrificeName], savedAt: demotedTime }

  // Verify the swap achieved its goal
  const newEditable = editableBoardNames(updated, false)
  if (!newEditable.has(targetName)) {
    return { ok: false, reason: 'Swap did not produce the expected result.' }
  }

  return { ok: true, boards: updated }
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
