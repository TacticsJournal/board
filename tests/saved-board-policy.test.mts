import assert from 'node:assert/strict'
import test from 'node:test'
import { savedBoardNamesByRecency, writeSavedBoards } from '../src/saved-board-policy.ts'

const records = (...entries: Array<[string, string]>) => Object.fromEntries(entries.map(([name, savedAt]) => [name, { savedAt }]))

test('every local saved board is listed, with no limit', () => {
  const boards = records(...Array.from({ length: 125 }, (_, i) => [`Board ${i}`, new Date(2026, 0, i + 1).toISOString()] as [string, string]))
  assert.equal(savedBoardNamesByRecency(boards).length, 125)
})

test('recency ties and malformed timestamps have deterministic name ordering', () => {
  const boards = records(['Zulu', 'not-a-date'], ['Beta', '2026-03-01T12:00:00.000Z'], ['Alpha', '2026-03-01T12:00:00.000Z'], ['Able', 'also-invalid'])
  assert.deepEqual(savedBoardNamesByRecency(boards), ['Alpha', 'Beta', 'Able', 'Zulu'])
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
