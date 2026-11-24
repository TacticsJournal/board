import assert from 'node:assert/strict'
import test from 'node:test'

import { readFile } from 'node:fs/promises'
import { collectChanges, syncOnce, type LocalBoard, type SyncStore } from '../src/sync.ts'

function store(rows: LocalBoard[]): SyncStore & { rows: LocalBoard[] } {
  let cursor: string | null = null
  return {
    rows,
    list: () => rows,
    upsert(board) {
      const i = rows.findIndex(row => row.id === board.id)
      if (i >= 0) rows[i] = board
      else rows.push(board)
    },
    remove() {},
    removeById(id: string) {
      const i = rows.findIndex(row => row.id === id)
      if (i >= 0) rows.splice(i, 1)
    },
    tombstones: () => [],
    dropTombstones() {},
    pushedAt: () => null,
    setPushedAt() {},
    sharedPushedAt: () => null,
    setSharedPushedAt() {},
    cursor: () => cursor,
    setCursor: value => { cursor = value },
    deviceId: () => 'device-12345678',
    accountBinding: () => 'account-a',
    claimOwned() {},
  } as SyncStore & { rows: LocalBoard[] }
}

const rows = (): LocalBoard[] => [
  { id: 'board-one1', name: 'One', scene: {}, savedAt: '2026-01-01T00:00:00.000Z', syncAccount: 'account-a' },
  { id: 'board-two2', name: 'Two', scene: {}, savedAt: '2026-01-02T00:00:00.000Z', syncAccount: 'account-a' },
  { id: 'board-share3', name: 'Shared', scene: {}, savedAt: '2026-01-03T00:00:00.000Z', access: 'shared', syncAccount: 'account-a' },
]

test('Free sync sends only shared work, never an owned project', () => {
  const changes = collectChanges(store(rows()), { includeOwned: false }) as Array<{ id: string }>
  assert.deepEqual(changes.map(row => row.id), ['board-share3'])
})

test('Free sync neither restores nor deletes owned projects from the account', async () => {
  const local = store(rows())
  const pull = async () => ({
        boards: [
          { id: 'board-cloud9', name: 'Cloud', scene: {}, updated_at: '2026-02-01T00:00:00.000Z', device: 'other-device' },
          { id: 'board-one1', name: 'One', scene: {}, updated_at: '2026-02-01T00:00:00.000Z', deleted_at: '2026-02-01T00:00:00.000Z', device: 'other-device' },
          { id: 'board-share3', name: 'Shared v2', scene: {}, updated_at: '2026-02-01T00:00:00.000Z', access: 'shared', device: 'other-device' },
        ],
        cursor: 'cursor-1', has_more: false,
      })
  const api = {
    async push(body: { boards: Array<{ id: string }> }) {
      assert.deepEqual(body.boards.map(row => row.id), ['board-share3'])
      return { ...(await pull()), applied: body.boards.map(row => ({ id: row.id })) }
    },
    pull,
  }
  const result = await syncOnce(local, api as any, '2026-02-02T00:00:00.000Z', undefined, { includeOwned: false })
  assert.equal(result.status, 'ok')
  assert.deepEqual(result.remoteIds, ['board-share3'])
  assert.deepEqual(local.rows.map(row => row.id).sort(), ['board-one1', 'board-share3', 'board-two2'])
  assert.equal(local.rows.find(row => row.id === 'board-share3')?.name, 'Shared v2')
})

test('the editor offers Free no account backup', async () => {
  const main = await readFile(new URL('../src/main.ts', import.meta.url), 'utf8')
  assert.doesNotMatch(main, /free-backup|requestFreeBackup|Back up one project/)
  assert.match(main, /includeOwned: entitlements\.isPro\(\),/)
})
