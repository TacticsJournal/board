import assert from 'node:assert/strict'
import test from 'node:test'

import {
  FREE_EDITABLE_BOARD_LIMIT,
  canCreateSavedBoard,
  editableBoardNames,
  savedBoardNamesByRecency,
  swapEditableSlot,
  writeSavedBoards,
} from '../src/saved-board-policy.ts'

const records = (...entries: Array<[string, string]>) => Object.fromEntries(
  entries.map(([name, savedAt]) => [name, { savedAt }]),
)

test('free allows zero through three saved boards and blocks creation of a fourth', () => {
  for (let count = 0; count <= FREE_EDITABLE_BOARD_LIMIT; count++) {
    const boards = records(...Array.from({ length: count }, (_, i) => [`Board ${i + 1}`, `2026-01-0${i + 1}T00:00:00Z`] as [string, string]))
    assert.equal(editableBoardNames(boards, false).size, count)
    assert.equal(canCreateSavedBoard(boards, false), count < FREE_EDITABLE_BOARD_LIMIT)
  }
})

test('shared boards stay editable and do not consume Free personal slots', () => {
  const boards = {
    Shared: { savedAt: '2026-04-01T00:00:00Z', access: 'shared' as const },
    One: { savedAt: '2026-03-01T00:00:00Z' },
    Two: { savedAt: '2026-02-01T00:00:00Z' },
    Three: { savedAt: '2026-01-01T00:00:00Z' },
  }
  assert.deepEqual(new Set(editableBoardNames(boards, false)), new Set(['Shared', 'One', 'Two', 'Three']))
  assert.equal(canCreateSavedBoard(boards, false), false)
})

test('downgrade preserves every record and selects the newest three', () => {
  const boards = records(
    ['Oldest', '2026-01-01T00:00:00Z'],
    ['Middle', '2026-02-01T00:00:00Z'],
    ['Recent', '2026-03-01T00:00:00Z'],
    ['Newer', '2026-04-01T00:00:00Z'],
    ['Newest', '2026-05-01T00:00:00Z'],
  )
  const before = structuredClone(boards)

  assert.deepEqual([...editableBoardNames(boards, false)], ['Newest', 'Newer', 'Recent'])
  assert.deepEqual(boards, before)
  assert.equal(Object.keys(boards).length, 5)
})

test('Pro permits unlimited editable records while Free remains capped', () => {
  const boards = records(...Array.from({ length: 125 }, (_, i) => [`Board ${i}`, new Date(2026, 0, i + 1).toISOString()] as [string, string]))
  assert.equal(editableBoardNames(boards, true).size, 125)
  assert.equal(canCreateSavedBoard(boards, true), true)
  assert.equal(editableBoardNames(boards, false).size, 3)
})

test('recency ties and malformed timestamps have deterministic name ordering', () => {
  const entries: Array<[string, string]> = [
    ['Zulu', 'not-a-date'],
    ['Beta', '2026-03-01T12:00:00.000Z'],
    ['Alpha', '2026-03-01T12:00:00.000Z'],
    ['Able', 'also-invalid'],
  ]
  const expected = ['Alpha', 'Beta', 'Able', 'Zulu']
  assert.deepEqual(savedBoardNamesByRecency(records(...entries)), expected)
  assert.deepEqual(savedBoardNamesByRecency(records(...entries.toReversed())), expected)
  assert.deepEqual([...editableBoardNames(records(...entries), false)], ['Alpha', 'Beta', 'Able'])
})

test('invalid dates always rank behind valid dates without locale-sensitive ordering', () => {
  const entries: Array<[string, string]> = [
    ['ä-invalid', ''],
    ['z-invalid', 'definitely not a timestamp'],
    ['10-valid', '2025-01-01T00:00:00Z'],
    ['2-valid', '2025-01-01T00:00:00Z'],
  ]
  const expected = ['10-valid', '2-valid', 'z-invalid', 'ä-invalid']
  for (const ordered of [entries, entries.toReversed(), [entries[1], entries[3], entries[0], entries[2]]]) {
    assert.deepEqual(savedBoardNamesByRecency(records(...ordered)), expected)
  }
})

test('deleting an editable board naturally promotes the next newest preserved board', () => {
  const boards = records(
    ['One', '2026-01-01T00:00:00Z'],
    ['Two', '2026-02-01T00:00:00Z'],
    ['Three', '2026-03-01T00:00:00Z'],
    ['Four', '2026-04-01T00:00:00Z'],
  )
  assert.deepEqual([...editableBoardNames(boards, false)], ['Four', 'Three', 'Two'])
  delete boards.Four
  assert.deepEqual([...editableBoardNames(boards, false)], ['Three', 'Two', 'One'])
})

// Slot swap tests

test('swap promotes a read-only board and demotes an editable board', () => {
  const boards = records(
    ['Oldest', '2026-01-01T00:00:00Z'],
    ['Middle', '2026-02-01T00:00:00Z'],
    ['Recent', '2026-03-01T00:00:00Z'],
    ['Newest', '2026-04-01T00:00:00Z'],
  )
  assert.deepEqual([...editableBoardNames(boards, false)], ['Newest', 'Recent', 'Middle'])

  const result = swapEditableSlot(boards, 'Newest', 'Oldest')
  assert.equal(result.ok, true)
  if (!result.ok) return

  const newEditable = editableBoardNames(result.boards, false)
  assert.equal(newEditable.has('Oldest'), true, 'Oldest should now be editable')
  assert.equal(newEditable.has('Newest'), false, 'Newest should now be read-only')
  assert.equal(Object.keys(result.boards).length, 4, 'no boards deleted')
})

test('swap never treats a shared board as a personal sacrifice', () => {
  const boards = {
    Shared: { savedAt: '2026-04-01T00:00:00Z', access: 'shared' as const },
    One: { savedAt: '2026-03-01T00:00:00Z' },
    Two: { savedAt: '2026-02-01T00:00:00Z' },
    Three: { savedAt: '2026-01-01T00:00:00Z' },
    Old: { savedAt: '2025-01-01T00:00:00Z' },
  }
  const result = swapEditableSlot(boards, 'Shared', 'Old')
  assert.equal(result.ok, false)
})

test('swap rejects same board, missing boards, wrong direction', () => {
  const boards = records(
    ['A', '2026-01-01T00:00:00Z'],
    ['B', '2026-02-01T00:00:00Z'],
    ['C', '2026-03-01T00:00:00Z'],
    ['D', '2026-04-01T00:00:00Z'],
  )

  // Same board
  const r1 = swapEditableSlot(boards, 'D', 'D')
  assert.equal(r1.ok, false)

  // Missing sacrifice
  const r2 = swapEditableSlot(boards, 'X', 'A')
  assert.equal(r2.ok, false)

  // Missing target
  const r3 = swapEditableSlot(boards, 'D', 'Y')
  assert.equal(r3.ok, false)

  // Sacrifice is read-only (A is oldest, not editable)
  const r4 = swapEditableSlot(boards, 'A', 'D')
  assert.equal(r4.ok, false)

  // Target is already editable
  const r5 = swapEditableSlot(boards, 'D', 'C')
  assert.equal(r5.ok, false)
})

test('swap does not mutate the input collection', () => {
  const boards = records(
    ['A', '2026-01-01T00:00:00Z'],
    ['B', '2026-02-01T00:00:00Z'],
    ['C', '2026-03-01T00:00:00Z'],
    ['D', '2026-04-01T00:00:00Z'],
  )
  const before = structuredClone(boards)
  swapEditableSlot(boards, 'D', 'A')
  assert.deepEqual(boards, before)
})

test('all boards restore to editable when Pro returns after swap', () => {
  const boards = records(
    ['A', '2026-01-01T00:00:00Z'],
    ['B', '2026-02-01T00:00:00Z'],
    ['C', '2026-03-01T00:00:00Z'],
    ['D', '2026-04-01T00:00:00Z'],
  )
  const result = swapEditableSlot(boards, 'D', 'A')
  assert.equal(result.ok, true)
  if (!result.ok) return

  // With Pro, all boards should be editable regardless of swap state
  const proEditable = editableBoardNames(result.boards, true)
  assert.equal(proEditable.size, 4, 'Pro restores all boards')
})

test('storage writes neither truncate large sets nor mutate prior storage on failure', () => {
  const large = records(...Array.from({ length: 150 }, (_, i) => [`Board ${i}`, new Date(2026, 0, i + 1).toISOString()] as [string, string]))
  let stored = 'prior-value'
  const successful = writeSavedBoards({ setItem: (_key, value) => { stored = value } }, 'boards', large)
  assert.deepEqual(successful, { ok: true })
  assert.equal(Object.keys(JSON.parse(stored)).length, 150)

  stored = 'prior-value'
  const failed = writeSavedBoards({ setItem: () => { throw new Error('quota exceeded') } }, 'boards', large)
  assert.equal(failed.ok, false)
  assert.equal(stored, 'prior-value')
})
