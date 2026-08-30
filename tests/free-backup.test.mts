import assert from 'node:assert/strict'
import test from 'node:test'

import { saveFreeBackupIntent, selectedFreeBackup, setSelectedFreeBackup, takeFreeBackupIntent } from '../src/free-backup.ts'

class MemoryStorage implements Storage {
  private values = new Map<string, string>()
  get length() { return this.values.size }
  clear() { this.values.clear() }
  getItem(key: string) { return this.values.get(key) ?? null }
  key(index: number) { return [...this.values.keys()][index] ?? null }
  removeItem(key: string) { this.values.delete(key) }
  setItem(key: string, value: string) { this.values.set(key, value) }
}

test('a Free backup selection is scoped to its account binding', () => {
  const storage = new MemoryStorage()
  assert.equal(setSelectedFreeBackup(storage, 'account-a', 'board-aaaa1'), true)
  assert.equal(selectedFreeBackup(storage, 'account-a'), 'board-aaaa1')
  assert.equal(selectedFreeBackup(storage, 'account-b'), null)
  assert.equal(selectedFreeBackup(storage, null), null)
})

test('switching a selection changes only that account', () => {
  const storage = new MemoryStorage()
  setSelectedFreeBackup(storage, 'account-a', 'board-aaaa1')
  setSelectedFreeBackup(storage, 'account-b', 'board-bbbb2')
  setSelectedFreeBackup(storage, 'account-a', 'board-cccc3')
  assert.equal(selectedFreeBackup(storage, 'account-a'), 'board-cccc3')
  assert.equal(selectedFreeBackup(storage, 'account-b'), 'board-bbbb2')
})

test('sign-in intent survives a return and is consumed once', () => {
  const storage = new MemoryStorage()
  assert.equal(saveFreeBackupIntent(storage, { boardId: 'board-aaaa1', source: 'fourth_save' }), true)
  assert.deepEqual(takeFreeBackupIntent(storage), { boardId: 'board-aaaa1', source: 'fourth_save' })
  assert.equal(takeFreeBackupIntent(storage), null)
})

test('invalid and unavailable storage fails closed', () => {
  const bad = {
    getItem() { throw new Error('no storage') },
    setItem() { throw new Error('no storage') },
    removeItem() { throw new Error('no storage') },
  }
  assert.equal(selectedFreeBackup(bad, 'account-a'), null)
  assert.equal(setSelectedFreeBackup(bad, 'account-a', 'board-aaaa1'), false)
  assert.equal(saveFreeBackupIntent(bad, { boardId: 'bad', source: 'settings' }), false)
  assert.equal(takeFreeBackupIntent(bad), null)
})
