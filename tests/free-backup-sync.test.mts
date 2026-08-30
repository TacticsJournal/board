import assert from 'node:assert/strict'
import test from 'node:test'

import { readFile } from 'node:fs/promises'
import { collectChanges, syncOnce, type LocalBoard, type SyncStore } from '../src/sync.ts'

function store(rows: LocalBoard[]): SyncStore {
  let cursor: string | null = null
  return {
    list: () => rows,
    upsert() {},
    remove() {},
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
  }
}

const rows: LocalBoard[] = [
  { id: 'board-one1', name: 'One', scene: {}, savedAt: '2026-01-01T00:00:00.000Z', syncAccount: 'account-a' },
  { id: 'board-two2', name: 'Two', scene: {}, savedAt: '2026-01-02T00:00:00.000Z', syncAccount: 'account-a' },
  { id: 'board-share3', name: 'Shared', scene: {}, savedAt: '2026-01-03T00:00:00.000Z', access: 'shared', syncAccount: 'account-a' },
]

test('Free backup sends only the selected owned project and accessible shared work', () => {
  const changes = collectChanges(store(rows), { includeOwned: true, ownedId: 'board-one1' }) as Array<{ id: string }>
  assert.deepEqual(changes.map(row => row.id).sort(), ['board-one1', 'board-share3'])
})

test('the Free backup UI never reports a conflicted selection as backed up', async () => {
  const main = await readFile(new URL('../src/main.ts', import.meta.url), 'utf8')
  assert.match(main, /result\.status === 'ok' && result\.conflicts > 0/)
  assert.match(main, /Another version was already backed up/)
})

test('a targeted Free backup carries the selected id in the sync envelope', async () => {
  const pushed: unknown[] = []
  const api = {
    async push(body: { boards: unknown[]; cursor: string | null; free_backup_id?: string }) {
      pushed.push(body)
      return {
        applied: body.boards.map((item: any) => ({ id: item.id })),
        boards: [], cursor: 'cursor-1', has_more: false,
      }
    },
    async pull() { return { boards: [], cursor: 'cursor-1', has_more: false } },
  }
  const result = await syncOnce(store(rows), api, '2026-01-04T00:00:00.000Z', undefined, {
    includeOwned: true,
    ownedId: 'board-one1',
    targetId: 'board-one1',
    freeBackupId: 'board-one1',
    advanceMarkers: false,
  })
  assert.equal(result.status, 'ok')
  assert.equal((pushed[0] as any).free_backup_id, 'board-one1')
  assert.deepEqual((pushed[0] as any).boards.map((item: any) => item.id), ['board-one1'])
})
