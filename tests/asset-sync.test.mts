import assert from 'node:assert/strict'
import test from 'node:test'

import { syncAssetsOnce, type AssetSyncStore, type SyncedAsset } from '../src/asset-sync.ts'

type Remote = { id: string; name: string; cat: 'players'; w: number; h: number; updated_at: string; deleted_at?: string; src?: string }

function device(records: SyncedAsset[]): AssetSyncStore & { records: SyncedAsset[] } {
  const out = {
    records,
    list() { return this.records.map(record => ({ ...record })) },
    apply(record: SyncedAsset) { this.records = [...this.records.filter(item => item.id !== record.id), { ...record }] },
    bind(ids: string[], account: string) {
      this.records = this.records.map(record => ids.includes(record.id) && (!record.syncAccount || record.syncAccount === account)
        ? { ...record, syncAccount: account } : record)
    },
  }
  return out
}

function service() {
  const rows = new Map<string, Remote>()
  return {
    rows,
    async list() { return [...rows.values()].map(({ src: _src, ...row }) => row) },
    async image(id: string) {
      const src = rows.get(id)?.src
      if (!src) throw new Error('missing image')
      return src
    },
    async push(record: any) {
      const old = rows.get(record.id)
      if (old && Date.parse(old.updated_at) >= Date.parse(record.updated_at)) return
      rows.set(record.id, {
        id: record.id, name: record.name, cat: record.cat, w: record.w, h: record.h, updated_at: record.updated_at,
        ...(record.deleted ? { deleted_at: record.updated_at } : { src: record.src }),
      })
    },
  }
}

const image = 'data:image/png;base64,AA=='

test('uploaded assets converge and preserve tombstones', async () => {
  const api = service()
  const first = device([{ id: 'as-one', name: 'Press', cat: 'players', w: 20, h: 20, src: image, updatedAt: '2026-08-18T10:00:00.000Z' }])
  const second = device([])

  assert.equal((await syncAssetsOnce(first, api, 'a'.repeat(64))).pushed, 1)
  assert.equal(first.records[0].syncAccount, 'a'.repeat(64))
  assert.equal((await syncAssetsOnce(second, api, 'a'.repeat(64))).pulled, 1)
  assert.equal(second.records[0].src, image)

  second.records[0] = { ...second.records[0], name: 'Counter press', updatedAt: '2026-08-18T11:00:00.000Z' }
  await syncAssetsOnce(second, api, 'a'.repeat(64))
  await syncAssetsOnce(first, api, 'a'.repeat(64))
  assert.equal(first.records[0].name, 'Counter press')

  second.records[0] = { ...second.records[0], deleted: true, src: undefined, updatedAt: '2026-08-18T12:00:00.000Z' }
  await syncAssetsOnce(second, api, 'a'.repeat(64))
  await syncAssetsOnce(first, api, 'a'.repeat(64))
  assert.equal(first.records[0].deleted, true)
  assert.equal(first.records[0].src, undefined)
})

test('an asset bound to another account is never pushed or overwritten', async () => {
  const api = service()
  api.rows.set('as-private', { id: 'as-private', name: 'Remote', cat: 'players', w: 10, h: 10, updated_at: '2026-08-18T12:00:00.000Z', src: image })
  const local = device([{ id: 'as-private', name: 'Private', cat: 'players', w: 10, h: 10, src: image, updatedAt: '2026-08-18T13:00:00.000Z', syncAccount: 'b'.repeat(64) }])

  const result = await syncAssetsOnce(local, api, 'a'.repeat(64))
  assert.equal(result.pushed, 0)
  assert.equal(local.records[0].name, 'Private')
  assert.equal(api.rows.get('as-private')!.name, 'Remote')
})
