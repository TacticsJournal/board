import assert from 'node:assert/strict'
import test from 'node:test'

import { pushReferencedBackgrounds, syncLibrariesOnce, type LibrarySyncStore, type SyncedLibraryRecord } from '../src/library-sync.ts'

type Remote = { id: string; kind: SyncedLibraryRecord['kind']; name: string; payload: unknown; updated_at: string; deleted_at?: string; src?: string }

function device(records: SyncedLibraryRecord[]): LibrarySyncStore & { records: SyncedLibraryRecord[]; applies: number } {
  return {
    records, applies: 0,
    list() { return this.records.map(row => ({ ...row })) },
    apply(row) { this.applies++; this.records = [...this.records.filter(item => item.id !== row.id), { ...row }] },
    bind(ids, account) {
      this.records = this.records.map(row => ids.includes(row.id) && (!row.syncAccount || row.syncAccount === account)
        ? { ...row, syncAccount: account } : row)
    },
  }
}

function service() {
  const rows = new Map<string, Remote>()
  return {
    rows,
    async list() { return [...rows.values()].map(({ src: _src, ...row }) => row) },
    async image(id: string) {
      const src = rows.get(id)?.src
      if (!src) throw new Error('missing jpeg')
      return src
    },
    async push(record: any) {
      const old = rows.get(record.id)
      if (old && Date.parse(old.updated_at) >= Date.parse(record.updated_at)) return
      rows.set(record.id, {
        id: record.id, kind: record.kind, name: record.name, payload: record.payload, updated_at: record.updated_at,
        ...(record.deleted ? { deleted_at: record.updated_at } : record.kind === 'background' ? { src: record.src } : {}),
      })
    },
  }
}

const account = 'a'.repeat(64)
const payload = { cat: 'players', objects: [], w: 10, h: 10, at: 1 }

test('first library pass uploads old unbound rows and binds them', async () => {
  const api = service()
  const local = device([{ id: 'st-abc12345', kind: 'stamp', name: 'Press', payload, updatedAt: '2000-01-01T00:00:01.000Z' }])
  const result = await syncLibrariesOnce(local, api, account)
  assert.equal(result.status, 'ok')
  assert.equal(result.pushed, 1)
  assert.equal(api.rows.get('st-abc12345')?.name, 'Press')
  assert.equal(local.records[0].syncAccount, account)
})

test('newer remote rows pull and a background fetches JPEG bytes only for its winning revision', async () => {
  const api = service()
  api.rows.set('bg:one', {
    id: 'bg:one', kind: 'background', name: 'Camera',
    payload: { backgroundKind: 'broadcast', w: 800, h: 450, boardH: 450, bytes: 2, at: 1 },
    updated_at: '2026-08-18T12:00:00.000Z', src: 'data:image/jpeg;base64,AA==',
  })
  const local = device([{ id: 'bg:one', kind: 'background', name: 'Old', payload: {}, updatedAt: '2026-08-18T11:00:00.000Z', src: 'data:image/jpeg;base64,old' }])
  const result = await syncLibrariesOnce(local, api, account)
  assert.equal(result.pulled, 1)
  assert.equal(local.records[0].src, 'data:image/jpeg;base64,AA==')
  assert.equal(local.records[0].syncAccount, account)

  const noFetch = device([{ ...local.records[0], updatedAt: '2026-08-18T13:00:00.000Z' }])
  let images = 0
  await syncLibrariesOnce(noFetch, { ...api, image: async id => { images++; return api.image(id) } }, account)
  assert.equal(images, 0)
})

test('strict timestamps preserve tombstones and never notify/apply an equal revision', async () => {
  const api = service()
  const first = device([{ id: 'st-delete', kind: 'stamp', name: 'Delete', payload, updatedAt: '2026-08-18T10:00:00.000Z', deleted: true }])
  const second = device([])
  await syncLibrariesOnce(first, api, account)
  await syncLibrariesOnce(second, api, account)
  assert.equal(second.records[0].deleted, true)

  const equal = device([{ ...second.records[0] }])
  await syncLibrariesOnce(equal, api, account)
  assert.equal(equal.applies, 0, 'accepted equal revision does not cause a remote-application loop')
  assert.equal(equal.records[0].syncAccount, account)
})

test('sharing uploads only referenced background rows and refuses missing bytes', async () => {
  const api = service()
  const pushes: string[] = []
  api.push = async (record: any) => { pushes.push(record.id); return service().push(record) }
  const local = device([
    { id: 'bg:used', kind: 'background', name: 'Used', payload: { backgroundKind: 'pitch' }, updatedAt: '2026-08-18T12:00:00.000Z', src: 'data:image/jpeg;base64,/9j/2Q==' },
    { id: 'bg:other', kind: 'background', name: 'Other', payload: {}, updatedAt: '2026-08-18T12:00:00.000Z', src: 'data:image/jpeg;base64,/9j/2Q==' },
  ])
  await pushReferencedBackgrounds({ boards: [{ scene: { pitch: 'bg:used' } }, { scene: { pitch: 'pitch' } }] }, local, api, account)
  assert.deepEqual(pushes, ['bg:used'])
  await assert.rejects(
    pushReferencedBackgrounds({ boards: [{ scene: { pitch: 'bg:missing' } }] }, local, api, account),
    /bg:missing.*unavailable/,
  )
})

test('a record bound to another account is neither pushed nor overwritten', async () => {
  const api = service()
  api.rows.set('team-setup', { id: 'team-setup', kind: 'team_setup', name: 'Remote', payload: { teams: [] }, updated_at: '2026-08-18T12:00:00.000Z' })
  const local = device([{ id: 'team-setup', kind: 'team_setup', name: 'Private', payload: { teams: ['x'] }, updatedAt: '2026-08-18T13:00:00.000Z', syncAccount: 'b'.repeat(64) }])
  const result = await syncLibrariesOnce(local, api, account)
  assert.equal(result.pushed, 0)
  assert.equal(result.pulled, 0)
  assert.equal(local.records[0].name, 'Private')
})
