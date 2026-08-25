import assert from 'node:assert/strict'
import test from 'node:test'

const values = new Map<string, string>()
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem(key: string) { return values.get(key) ?? null },
    setItem(key: string, value: string) { values.set(key, value) },
  },
})

const { addStamp, listStamps, removeStamp, stampLibrarySyncStore } = await import('../src/stamps.ts')

const ball = { id: 'o1', type: 'ball' as const, x: 10, y: 20, size: 16 }

test('stamp deletes keep only a compact tombstone until account sync accepts them', async () => {
  const stamp = addStamp({ name: 'Press', cat: 'players', objects: [ball], w: 20, h: 20 })
  removeStamp(stamp.id)
  assert.equal(listStamps().length, 0)
  const row = (await stampLibrarySyncStore().list()).find(item => item.id === stamp.id)!
  assert.equal(row.deleted, true)
  assert.deepEqual((row.payload as { objects: unknown[] }).objects, [])
})

test('a payload-free remote stamp tombstone removes an older visible stamp', async () => {
  const stamp = addStamp({ name: 'Block', cat: 'players', objects: [ball], w: 20, h: 20 })
  await stampLibrarySyncStore().apply({
    id: stamp.id, kind: 'stamp', name: 'Deleted stamp', payload: undefined,
    updatedAt: new Date(Date.parse(stamp.updatedAt) + 1000).toISOString(), deleted: true,
  })
  assert.equal(listStamps().some(item => item.id === stamp.id), false)
  const row = (await stampLibrarySyncStore().list()).find(item => item.id === stamp.id)!
  assert.equal(row.deleted, true)
  assert.deepEqual((row.payload as { objects: unknown[] }).objects, [])
})
