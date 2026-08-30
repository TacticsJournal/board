import assert from 'node:assert/strict'
import test from 'node:test'
import { FREE_EDITABLE_BOARD_LIMIT, canCreateSavedBoard, editableBoardNames, savedBoardNamesByRecency, writeSavedBoards } from '../src/saved-board-policy.ts'

const records = (...entries: Array<[string, string]>) => Object.fromEntries(entries.map(([name, savedAt]) => [name, { savedAt }]))

test('Free keeps every local saved board editable and creation unlimited', () => {
  const boards = records(...Array.from({ length: 125 }, (_, i) => [`Board ${i}`, new Date(2026, 0, i + 1).toISOString()] as [string, string]))
  assert.equal(FREE_EDITABLE_BOARD_LIMIT, 3, 'legacy limit remains export-compatible only')
  assert.equal(editableBoardNames(boards, false).size, 125)
  assert.equal(canCreateSavedBoard(boards, false), true)
})

test('Pro also keeps every saved board editable', () => {
  const boards = records(['One', '2026-01-01T00:00:00Z'], ['Two', '2026-02-01T00:00:00Z'])
  assert.deepEqual([...editableBoardNames(boards, true)], ['Two', 'One'])
})

test('recency ties and malformed timestamps have deterministic name ordering', () => {
  const boards = records(['Zulu', 'not-a-date'], ['Beta', '2026-03-01T12:00:00.000Z'], ['Alpha', '2026-03-01T12:00:00.000Z'], ['Able', 'also-invalid'])
  assert.deepEqual(savedBoardNamesByRecency(boards), ['Alpha', 'Beta', 'Able', 'Zulu'])
})

test('shared boards remain editable', () => {
  const boards = { Shared: { savedAt: '2026-04-01T00:00:00Z', access: 'shared' as const } }
  assert.deepEqual([...editableBoardNames(boards, false)], ['Shared'])
})

test('storage writes large sets without truncation and preserves prior storage on failure', () => {
  const large = records(...Array.from({ length: 150 }, (_, i) => [`Board ${i}`, new Date(2026, 0, i + 1).toISOString()] as [string, string]))
  let stored = 'prior-value'
  assert.deepEqual(writeSavedBoards({ setItem: (_key, value) => { stored = value } }, 'boards', large), { ok: true })
  assert.equal(Object.keys(JSON.parse(stored)).length, 150)
  const failed = writeSavedBoards({ setItem: () => { throw new Error('quota exceeded') } }, 'boards', large)
  assert.equal(failed.ok, false)
  assert.equal(stored !== 'prior-value', true)
})
