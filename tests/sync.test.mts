// Board sync, client side. These test the rules that decide whether someone
// loses work: what gets pushed, what a conflict does, and what a failure
// leaves behind.

import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

import {
  applyRemote,
  collectChanges,
  conflictName,
  createLocalSyncStore,
  createSyncApi,
  createSyncRunner,
  newId,
  preserveConflicts,
  pushMarker,
  recordTombstones,
  syncOnce,
  syncRequestBytes,
  SYNC_BATCH_SIZE,
  SYNC_PAGE_LIMIT,
  SYNC_REQUEST_BYTE_BUDGET,
  SYNC_REQUEST_BYTE_LIMIT,
  type LocalBoard,
  type SyncStore,
} from '../src/sync.ts'
import { remoteCurrentDecision } from '../src/remote-current.ts'
import { addBoard, newProject, type Project } from '../src/projects.ts'
import { emptyScene } from '../src/types.ts'

const SCENE = { version: 4, board: { w: 800, h: 418 }, objects: [] } as any

test('sync API keeps an exact bounded backend error and falls back to status', async () => {
  const api = createSyncApi(async () => new Response(JSON.stringify({ error: 'board_not_accessible' }), { status: 403 }))
  await assert.rejects(() => api.push({ boards: [], cursor: null }), (error: Error) => error.message === 'board_not_accessible')

  const long = 'x'.repeat(1000)
  const bounded = createSyncApi(async () => new Response(JSON.stringify({ error: long }), { status: 500 }))
  await assert.rejects(() => bounded.pull(null), (error: Error) => error.message.length === 256)

  const malformed = createSyncApi(async () => new Response('not json', { status: 403 }))
  await assert.rejects(() => malformed.pull(null), (error: Error) => error.message === '403')
})

test('a sync requested in flight runs a follow-up before either caller continues', async () => {
  let startFirst!: () => void
  let finishFirst!: () => void
  const firstStarted = new Promise<void>((resolve) => { startFirst = resolve })
  const firstCanFinish = new Promise<void>((resolve) => { finishFirst = resolve })
  let passes = 0
  const run = createSyncRunner(async () => {
    passes += 1
    if (passes === 1) {
      startFirst()
      await firstCanFinish
    }
  })

  const first = run()
  await firstStarted
  const followUp = run()
  let sharingContinued = false
  void followUp.then(() => { sharingContinued = true })
  await Promise.resolve()
  assert.equal(sharingContinued, false)

  finishFirst()
  await Promise.all([first, followUp])
  assert.equal(passes, 2)
  assert.equal(sharingContinued, true)
})

function store(initial: LocalBoard[] = [], state: any = {}): SyncStore & { boards: Map<string, LocalBoard>; stones: Tombstone[] } {
  const boards = new Map(initial.map((b) => [b.id, b]))
  const stones: any[] = state.tombstones ?? []
  let cursor: string | null = state.cursor ?? null
  let pushedAt: string | null = state.pushedAt ?? null
  let sharedPushedAt: string | null = state.sharedPushedAt ?? null
  return {
    boards,
    stones,
    list: () => [...boards.values()],
    upsert: (board) => { boards.set(board.id, board) },
    removeById: (id) => { boards.delete(id) },
    tombstones: () => stones,
    dropTombstones: (ids) => { for (const id of ids) { const i = stones.findIndex((s) => s.id === id); if (i >= 0) stones.splice(i, 1) } },
    cursor: () => cursor,
    setCursor: (value) => { cursor = value },
    pushedAt: () => pushedAt,
    setPushedAt: (value) => { pushedAt = value },
    sharedPushedAt: () => sharedPushedAt,
    setSharedPushedAt: (value) => { sharedPushedAt = value },
    deviceId: () => 'device-test',
  } as any
}

type Tombstone = { id: string; name: string; deletedAt: string }

function board(overrides: Partial<LocalBoard> = {}): LocalBoard {
  return { id: 'b-1', name: 'Press trigger', savedAt: '2026-08-18T10:00:00.000Z', scene: SCENE, ...overrides }
}

function projectDocument(): Project {
  const project = newProject(emptyScene(), 'Press sequence')
  project.id = 'project-stable'
  project.updated = 1234
  project.boards[0].id = 'board-one'
  project.boards[0].title = 'First action'
  project.boards[0].note = 'Start here'
  project.boards[0].view = { x: 10, y: 20, w: 400, h: 209 }
  project.boards[0].link = { dur: 2200, ease: 'linear' }
  project.boards[0].scene.objects.push({ id: 'ball-stable', type: 'ball', x: 100, y: 100, size: 20, flipX: false, flipY: false })
  const second = addBoard(project, 0, true)
  second.id = 'board-two'
  second.title = 'Second action'
  second.note = 'Finish here'
  second.link = { dur: 600, ease: 'out' }
  return project
}

test('the first sync offers every board on the device', () => {
  const s = store([board({ id: 'b-1' }), board({ id: 'b-2', name: 'Rest defence' })])
  const changes = collectChanges(s) as any[]
  assert.equal(changes.length, 2)
  assert.deepEqual(changes.map((c) => c.id).sort(), ['b-1', 'b-2'])
  // Nothing about a board is invented here; the scene goes up as it is.
  assert.equal(changes[0].scene, SCENE)
})

test('targeted preparation ignores an oversized unrelated Project and leaves markers alone', async () => {
  const oversized = { ...SCENE, objects: [{ id: 'too-big', type: 'text', text: 'x'.repeat(SYNC_REQUEST_BYTE_LIMIT), x: 0, y: 0 }] }
  const s = store([
    board({ id: 'a', name: 'Too big', savedAt: '2026-08-18T12:00:00.000Z', scene: oversized }),
    board({ id: 'b', name: 'Share this', savedAt: '2026-08-18T10:00:00.000Z' }),
  ], { pushedAt: '2026-08-18T11:00:00.000Z', sharedPushedAt: '2026-08-18T11:00:00.000Z' })
  const sent: any[] = []
  const api = {
    async push(body: any) { sent.push(...body.boards); return { applied: body.boards.map((change: any) => ({ id: change.id })) } },
    async pull() { return {} },
  }

  const result = await syncOnce(s, api, '2026-08-18T13:00:00.000Z', undefined, {
    targetId: 'b', advanceMarkers: false,
  })
  assert.equal(result.status, 'ok')
  assert.deepEqual(sent.map(change => change.id), ['b'])
  assert.equal(s.pushedAt(), '2026-08-18T11:00:00.000Z')
  assert.equal(s.sharedPushedAt!(), '2026-08-18T11:00:00.000Z')
  assert.deepEqual((collectChanges(s) as any[]).map(change => change.id), ['a'])
})

test('targeted preparation reports the required oversized Project', async () => {
  const oversized = { ...SCENE, objects: [{ id: 'too-big', type: 'text', text: 'x'.repeat(SYNC_REQUEST_BYTE_LIMIT), x: 0, y: 0 }] }
  const s = store([board({ id: 'a', scene: oversized })], { pushedAt: '2026-08-18T11:00:00.000Z' })
  let pushes = 0
  const api = {
    async push() { pushes += 1; return { applied: [{ id: 'a' }] } },
    async pull() { return {} },
  }

  const result = await syncOnce(s, api, '2026-08-18T13:00:00.000Z', undefined, {
    targetId: 'a', advanceMarkers: false,
  })
  assert.equal(result.status, 'failed')
  assert.equal(result.reason, 'one Project exceeds the sync request limit')
  assert.equal(pushes, 0)
  assert.equal(s.pushedAt(), '2026-08-18T11:00:00.000Z')
})

test('Project documents survive sync and remote round trips unchanged', () => {
  const document = projectDocument()
  const s = store([board({ scene: document })])
  assert.equal((collectChanges(s) as any[])[0].scene, document)

  const remote = projectDocument()
  remote.id = 'remote-project'
  remote.boards[1].id = 'remote-board-two'
  applyRemote(s, [{ id: 'b-1', name: 'Press trigger', updated_at: '2026-08-18T12:00:00.000Z', scene: remote }])
  assert.deepEqual((s as any).boards.get('b-1').scene, remote)
})

test('a later sync offers only what changed since the last push', () => {
  const s = store(
    [board({ id: 'b-1', savedAt: '2026-08-18T09:00:00.000Z' }), board({ id: 'b-2', savedAt: '2026-08-18T12:00:00.000Z' })],
    { pushedAt: '2026-08-18T10:00:00.000Z' },
  )
  const changes = collectChanges(s) as any[]
  assert.deepEqual(changes.map((c) => c.id), ['b-2'])
})

test('free sync sends shared edits but never personal boards or tombstones', () => {
  const s = store([
    board({ id: 'personal' }),
    board({ id: 'shared', access: 'shared', ownerUsername: 'owner' }),
  ], { tombstones: [{ id: 'deleted-personal', name: 'Old', deletedAt: '2026-08-18T11:00:00.000Z' }] })
  const changes = collectChanges(s, { includeOwned: false }) as any[]
  assert.deepEqual(changes.map(change => change.id), ['shared'])
})

test('free shared pushes advance only the shared marker and do not replay', async () => {
  const s = store([board({ id: 'personal' }), board({ id: 'shared', access: 'shared' })])
  const sent: any[] = []
  const api = {
    async push(body: any) { sent.push(...body.boards); return { applied: body.boards.map((change: any) => ({ id: change.id })) } },
    async pull() { return {} },
  }
  await syncOnce(s, api, '2026-08-18T13:00:00.000Z', undefined, { includeOwned: false })
  assert.deepEqual(sent.map(change => change.id), ['shared'])
  assert.equal(s.pushedAt(), null)
  assert.equal(s.sharedPushedAt!(), pushMarker('2026-08-18T13:00:00.000Z'))

  await syncOnce(s, api, '2026-08-18T13:01:00.000Z', undefined, { includeOwned: false })
  assert.deepEqual(sent.map(change => change.id), ['shared'])
  assert.deepEqual((collectChanges(s, { includeOwned: false }) as any[]).map(change => change.id), [])
})

test('personal work saved while free remains eligible when Pro sync begins', async () => {
  const s = store([board({ id: 'personal' }), board({ id: 'shared', access: 'shared' })])
  const calls: any[] = []
  const api = {
    async push(body: any) { calls.push(body); return { applied: body.boards.map((change: any) => ({ id: change.id })) } },
    async pull() { return {} },
  }

  await syncOnce(s, api, '2026-08-18T13:00:00.000Z', undefined, { includeOwned: false })
  await syncOnce(s, api, '2026-08-18T13:01:00.000Z')

  assert.deepEqual(calls.map(call => call.boards.map((change: any) => change.id)), [['shared'], ['personal', 'shared']])
  assert.equal(s.pushedAt(), pushMarker('2026-08-18T13:01:00.000Z'))
  assert.equal(s.sharedPushedAt!(), pushMarker('2026-08-18T13:01:00.000Z'))
})

test('a deleted board is offered as a tombstone', () => {
  const s = store([], { tombstones: [{ id: 'b-9', name: 'Old', deletedAt: '2026-08-18T11:00:00.000Z' }] })
  const changes = collectChanges(s) as any[]
  assert.equal(changes.length, 1)
  assert.equal(changes[0].deleted_at, '2026-08-18T11:00:00.000Z')
  assert.equal(changes[0].scene, undefined)
})

test('local sync storage round-trips shared metadata', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  const values = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
  } })
  try {
    const local = createLocalSyncStore()
    local.upsert(board({ id: 'shared', access: 'shared', ownerUsername: 'owner' }))
    local.setSharedPushedAt!('2026-08-18T13:00:00.000Z')
    assert.deepEqual(local.list()[0].access, 'shared')
    assert.equal(local.list()[0].ownerUsername, 'owner')
    assert.equal(local.sharedPushedAt!(), '2026-08-18T13:00:00.000Z')
  } finally {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous)
    else delete (globalThis as any).localStorage
  }
})

test('sync preserves a click-to-add import marker across remote upserts', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  const values = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
  } })
  try {
    const local = createLocalSyncStore()
    local.upsert(board({ id: 'imported', importId: 'abcdefghijklmnopqrstuvwx' }))
    local.upsert(board({ id: 'imported', name: 'Renamed remotely' }))
    assert.equal(local.list()[0].importId, 'abcdefghijklmnopqrstuvwx')
  } finally {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous)
    else delete (globalThis as any).localStorage
  }
})

test('local sync storage round-trips a full Project document', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  const values = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
  } })
  try {
    const document = projectDocument()
    createLocalSyncStore().upsert(board({ scene: document }))
    assert.deepEqual(createLocalSyncStore().list()[0].scene, document)
  } finally {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous)
    else delete (globalThis as any).localStorage
  }
})

test('synced boards and markers stay scoped to the account that claimed them', async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  const values = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
  } })
  try {
    const accountA = createLocalSyncStore('account-a')
    accountA.upsert(board({ id: 'personal' }))
    accountA.upsert(board({ id: 'shared', access: 'shared', ownerUsername: 'owner', syncAccount: 'account-a' }))
    await syncOnce(accountA, {
      async push(body: any) { return { applied: body.boards.map((item: any) => ({ id: item.id })) } },
      async pull() { return {} },
    }, '2026-08-18T13:00:00.000Z')
    assert.equal(accountA.list().find((item) => item.id === 'personal')?.syncAccount, 'account-a')
    accountA.setCursor('cursor-a')

    const accountB = createLocalSyncStore('account-b')
    assert.deepEqual(collectChanges(accountB).map((item: any) => item.id), [])
    assert.equal(accountB.cursor(), null)
    accountB.setCursor('cursor-b')
    assert.equal(accountA.cursor(), 'cursor-a')
    assert.equal(accountB.cursor(), 'cursor-b')
  } finally {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous)
    else delete (globalThis as any).localStorage
  }
})

test('explicit sharing adopts only the accepted owned Project into the active account', async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  const values = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
  } })
  try {
    const accountA = createLocalSyncStore('account-a')
    accountA.upsert(board({ id: 'share-this', syncAccount: 'account-a' }))
    accountA.upsert(board({ id: 'leave-this', name: 'Leave this', syncAccount: 'account-a' }))
    accountA.upsert(board({ id: 'rejected', name: 'Rejected', syncAccount: 'account-a' }))
    const accountB = createLocalSyncStore('account-b')
    assert.deepEqual(collectChanges(accountB).map((item: any) => item.id), [])

    const sent: string[] = []
    const accepted = await syncOnce(accountB, {
      async push(body: any) {
        sent.push(...body.boards.map((item: any) => item.id))
        return { applied: body.boards.map((item: any) => ({ id: item.id })) }
      },
      async pull() { return {} },
    }, '2026-08-18T13:00:00.000Z', undefined, {
      targetId: 'share-this', advanceMarkers: false, shareTarget: true,
    })
    assert.equal(accepted.status, 'ok')
    assert.deepEqual(sent, ['share-this'])
    assert.equal(accountB.list().find((item) => item.id === 'share-this')?.syncAccount, 'account-b')
    assert.equal(accountB.list().find((item) => item.id === 'leave-this')?.syncAccount, 'account-a')
    assert.equal(accountB.pushedAt(), null)

    const rejected = await syncOnce(accountB, {
      async push() { return { applied: [] } },
      async pull() { return {} },
    }, '2026-08-18T14:00:00.000Z', undefined, {
      targetId: 'rejected', advanceMarkers: false, shareTarget: true,
    })
    assert.equal(rejected.status, 'failed')
    assert.equal(accountB.list().find((item) => item.id === 'rejected')?.syncAccount, 'account-a')

    accountB.upsert(board({ id: 'unbound-rejected', name: 'Unbound rejected' }))
    const unboundRejected = await syncOnce(accountB, {
      async push() { return { applied: [] } },
      async pull() { return {} },
    }, '2026-08-18T15:00:00.000Z', undefined, {
      targetId: 'unbound-rejected', advanceMarkers: false, shareTarget: true,
    })
    assert.equal(unboundRejected.status, 'failed')
    assert.equal(accountB.list().find((item) => item.id === 'unbound-rejected')?.syncAccount, undefined)
  } finally {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous)
    else delete (globalThis as any).localStorage
  }
})

test('explicit sharing works without a client-visible account binding', async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  const values = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
  } })
  try {
    createLocalSyncStore('account-a').upsert(board({ id: 'share-anonymously', syncAccount: 'account-a' }))
    const anonymous = createLocalSyncStore(null)
    assert.deepEqual(collectChanges(anonymous).map((item: any) => item.id), [])
    const sent: string[] = []
    const result = await syncOnce(anonymous, {
      async push(body: any) {
        sent.push(...body.boards.map((item: any) => item.id))
        return { applied: body.boards.map((item: any) => ({ id: item.id })) }
      },
      async pull() { return {} },
    }, '2026-08-18T13:00:00.000Z', undefined, {
      targetId: 'share-anonymously', advanceMarkers: false, shareTarget: true,
    })
    assert.equal(result.status, 'ok')
    assert.deepEqual(sent, ['share-anonymously'])
    assert.equal(anonymous.list().find((item) => item.id === 'share-anonymously')?.syncAccount, 'account-a')
  } finally {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous)
    else delete (globalThis as any).localStorage
  }
})

test('an account change during targeted sync leaves local ownership untouched', async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  const values = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
  } })
  try {
    const accountB = createLocalSyncStore('account-b')
    accountB.upsert(board({ id: 'stale-pass', syncAccount: 'account-a' }))
    let current = true
    let pulls = 0
    const result = await syncOnce(accountB, {
      async push(body: any) {
        current = false
        return { applied: body.boards.map((item: any) => ({ id: item.id })) }
      },
      async pull() { pulls += 1; return {} },
    }, '2026-08-18T13:00:00.000Z', undefined, {
      targetId: 'stale-pass', advanceMarkers: false, shareTarget: true,
      stillCurrent: () => current,
    })
    assert.equal(result.status, 'failed')
    assert.equal(result.reason, 'sync account changed')
    assert.equal(pulls, 0)
    assert.equal(accountB.list().find((item) => item.id === 'stale-pass')?.syncAccount, 'account-a')
  } finally {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous)
    else delete (globalThis as any).localStorage
  }
})

test('explicit sharing never adopts a shared Project from another account', async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  const values = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
  } })
  try {
    createLocalSyncStore('account-a').upsert(board({
      id: 'shared', access: 'shared', ownerUsername: 'owner', syncAccount: 'account-a',
    }))
    const accountB = createLocalSyncStore('account-b')
    let requests = 0
    const result = await syncOnce(accountB, {
      async push() { requests += 1; return {} },
      async pull() { requests += 1; return {} },
    }, '2026-08-18T13:00:00.000Z', undefined, {
      targetId: 'shared', advanceMarkers: false, shareTarget: true,
    })
    assert.equal(result.status, 'failed')
    assert.equal(result.reason, 'the required Project is not available to this account')
    assert.equal(requests, 0)
    assert.equal(accountB.list().find((item) => item.id === 'shared')?.syncAccount, 'account-a')
  } finally {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous)
    else delete (globalThis as any).localStorage
  }
})

test('recordTombstones does not discard unacknowledged entries past 200', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  const values = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value) },
    },
  })
  try {
    recordTombstones(Array.from({ length: 201 }, (_, n) => ({ id: `b-deleted-${n}`, name: `Deleted ${n}` })), '2026-08-18T11:00:00.000Z')
    assert.equal(JSON.parse(values.get('tbm-tombstones-v1')!).length, 201)
  } finally {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous)
    else delete (globalThis as any).localStorage
  }
})

test('a losing edit is kept as its own board, not discarded', async () => {
  const s = store([board({ id: 'b-1', name: 'Press trigger' })])
  let ids = 0
  const api = {
    async push() {
      return {
        conflicts: [{ id: 'b-1', kept: 'server' }],
        boards: [{ id: 'b-1', name: 'Press trigger', updated_at: '2026-08-18T12:00:00.000Z', scene: { ...SCENE, objects: [{ type: 'ball' }] } }],
        cursor: '2026-08-18T12:00:01.000Z',
      }
    },
    async pull() { return {} },
  }

  const result = await syncOnce(s as any, api as any, '2026-08-18T13:00:00.000Z', () => `b-new-${++ids}`)

  assert.equal(result.conflicts, 1)
  // The server's copy took the original id...
  assert.deepEqual((s as any).boards.get('b-1').scene.objects, [{ type: 'ball' }])
  // ...and the local one survived under a name that says where it came from.
  const kept = (s as any).boards.get('b-new-1')
  assert.equal(kept.name, 'Press trigger (this device)')
  assert.deepEqual(kept.scene, SCENE)
})

test('a conflict copy retains every board in a Project document', () => {
  const document = projectDocument()
  const s = store([board({ scene: document })])
  preserveConflicts(s, [{ id: 'b-1' }], '2026-08-18T13:00:00.000Z', () => 'project-copy')
  const copy = (s as any).boards.get('project-copy')
  assert.equal(copy.scene.id, 'project-copy')
  assert.equal(document.id, 'project-stable')
  assert.deepEqual(copy.scene.boards.map((item: any) => item.id), ['board-one', 'board-two'])
  assert.deepEqual(copy.scene.boards.map((item: any) => item.scene.objects[0].id), ['ball-stable', 'ball-stable'])
})

test('a shared conflict copy becomes personal', () => {
  const s = store([board({ access: 'shared', ownerUsername: 'owner' })])
  preserveConflicts(s, [{ id: 'b-1' }], '2026-08-18T13:00:00.000Z', () => 'personal-copy')
  assert.equal((s as any).boards.get('personal-copy').access, undefined)
  assert.equal((s as any).boards.get('personal-copy').ownerUsername, undefined)
  assert.deepEqual((collectChanges(s, { includeOwned: false }) as any[]).map(change => change.id), ['b-1'])
})

test('a conflict winner converges past the cursor and does not duplicate on retry after a later pull failure', async () => {
  const s = store([board({ id: 'b-1', scene: SCENE })])
  const winner = {
    id: 'b-1', name: 'Server winner', updated_at: '2026-08-18T12:00:00.000Z',
    scene: { ...SCENE, objects: [{ type: 'ball' }] }, device: 'device-test',
  }
  let pushes = 0
  const api = {
    async push(body: any) {
      pushes += 1
      if (pushes === 1) {
        return { conflicts: [{ id: 'b-1', kept: 'server', winner }], boards: [winner], cursor: 'after-conflict', has_more: true }
      }
      const original = body.boards.find((change: any) => change.id === 'b-1')
      assert.deepEqual(original.scene, winner.scene)
      return { applied: body.boards.map((change: any) => ({ id: change.id })) }
    },
    async pull() { throw new Error('offline') },
  }

  const first = await syncOnce(s as any, api as any, '2026-08-18T13:00:00.000Z', () => 'b-kept')
  assert.equal(first.status, 'failed')
  assert.deepEqual(first.remoteIds, ['b-1'])
  assert.deepEqual((s as any).boards.get('b-1').scene, winner.scene)
  assert.equal([...((s as any).boards.values())].filter((item: any) => item.name === 'Press trigger (this device)').length, 1)

  const retry = await syncOnce(s as any, api as any, '2026-08-18T13:01:00.000Z', () => 'b-should-not-exist')
  assert.equal(retry.status, 'ok')
  assert.equal(pushes, 2)
  assert.deepEqual((s as any).boards.get('b-1').scene, winner.scene)
  assert.equal([...((s as any).boards.values())].filter((item: any) => item.name === 'Press trigger (this device)').length, 1)
})

test('a board that keeps conflicting does not grow a longer name each time', () => {
  assert.equal(conflictName('Press trigger'), 'Press trigger (this device)')
  assert.equal(conflictName('Press trigger (this device)'), 'Press trigger (this device)')
})

test('shared metadata is applied and a share revocation tombstone removes the row', () => {
  const s = store([])
  applyRemote(s, [{ id: 'shared', name: 'Collaborative', updated_at: '2026-08-18T12:00:00.000Z', scene: SCENE, access: 'shared', owner_username: 'owner' }])
  assert.deepEqual((s as any).boards.get('shared').access, 'shared')
  assert.equal((s as any).boards.get('shared').ownerUsername, 'owner')
  // Revocation is authoritative even if an edit was saved while its response
  // was in flight.
  s.upsert({ ...(s as any).boards.get('shared'), savedAt: '2026-08-18T14:00:00.000Z' })
  applyRemote(s, [{ id: 'shared', name: 'Collaborative', updated_at: '2026-08-18T13:00:00.000Z', deleted_at: '2026-08-18T13:00:00.000Z', access: 'shared' }])
  assert.equal((s as any).boards.has('shared'), false)
})

test('a remote tombstone removes the board here too', () => {
  const s = store([board({ id: 'b-1' })])
  applyRemote(s, [{ id: 'b-1', name: 'Press trigger', updated_at: '2026-08-18T12:00:00.000Z', deleted_at: '2026-08-18T12:00:00.000Z' }])
  assert.equal((s as any).boards.has('b-1'), false)
})

test('a remote board with no scene is ignored rather than blanking a local one', () => {
  const s = store([board({ id: 'b-1' })])
  applyRemote(s, [{ id: 'b-1', name: 'Press trigger', updated_at: '2026-08-18T12:00:00.000Z' } as any])
  assert.equal((s as any).boards.get('b-1').scene, SCENE)
})

test('a remote response never replaces a newer local save made in flight', () => {
  const local = board({ savedAt: '2026-08-18T13:00:00.000Z' })
  const s = store([local])
  applyRemote(s, [{ id: 'b-1', name: 'Press trigger', updated_at: '2026-08-18T12:00:00.000Z', scene: { ...SCENE, objects: [{ type: 'ball' }] } }])
  assert.equal((s as any).boards.get('b-1').savedAt, local.savedAt)
  assert.equal((s as any).boards.get('b-1').scene, SCENE)
})

test('a failed sync changes nothing, so the next attempt still carries the work', async () => {
  const s = store([board({ id: 'b-1' })])
  const api = { async push() { throw new Error('offline') }, async pull() { throw new Error('offline') } }

  const result = await syncOnce(s as any, api as any, '2026-08-18T13:00:00.000Z')

  assert.equal(result.status, 'failed')
  assert.equal(s.cursor(), null)
  assert.equal(s.pushedAt(), null)
  // Still pending, so nothing was lost by trying.
  assert.equal((collectChanges(s) as any[]).length, 1)
})

test('a rejected local push still pulls remote Projects without marking local work sent', async () => {
  const s = store([board({ id: 'b-local' })])
  const api = {
    async push() { throw new Error('413') },
    async pull() {
      return {
        boards: [{ id: 'b-remote', name: 'From another device', updated_at: '2026-08-18T12:00:00.000Z', scene: SCENE }],
        cursor: '2026-08-18T12:00:01.000Z',
      }
    },
  }

  const result = await syncOnce(s as any, api as any, '2026-08-18T13:00:00.000Z')

  assert.equal(result.status, 'failed')
  assert.equal(result.pulled, 1)
  assert.equal(s.pushedAt(), null)
  assert.equal(s.cursor(), '2026-08-18T12:00:01.000Z')
  assert.equal((s as any).boards.get('b-remote').name, 'From another device')
  assert.ok((collectChanges(s) as any[]).some(change => change.id === 'b-local'))
})

test('a sync with nothing to push still pulls', async () => {
  const s = store([], { pushedAt: '2026-08-18T10:00:00.000Z' })
  let pushed = 0
  const api = {
    async push() { pushed += 1; return {} },
    async pull() { return { boards: [{ id: 'b-7', name: 'From the laptop', updated_at: '2026-08-18T11:00:00.000Z', scene: SCENE }], cursor: '2026-08-18T11:00:01.000Z' } },
  }

  const result = await syncOnce(s as any, api as any, '2026-08-18T13:00:00.000Z')

  assert.equal(pushed, 0)
  assert.equal(result.pulled, 1)
  assert.equal(s.cursor(), '2026-08-18T11:00:01.000Z')
  assert.equal((s as any).boards.get('b-7').name, 'From the laptop')
})

test('pushes are chunked at the server limit and only mark all work after every chunk', async () => {
  const boards = Array.from({ length: SYNC_BATCH_SIZE + 1 }, (_, n) => board({ id: `b-${n}`, name: `Board ${n}` }))
  const s = store(boards)
  const calls: any[] = []
  const api = {
    async push(body: any) {
      calls.push(body)
      return { applied: body.boards.map((change: any) => ({ id: change.id })), cursor: `c-${calls.length}` }
    },
    async pull() { throw new Error('not needed') },
  }
  const result = await syncOnce(s as any, api as any, '2026-08-18T13:00:00.000Z')
  assert.deepEqual(calls.map(call => call.boards.length), [SYNC_BATCH_SIZE, 1])
  assert.equal(calls[1].cursor, 'c-1')
  assert.equal(result.pushed, SYNC_BATCH_SIZE + 1)
  assert.equal(s.pushedAt(), pushMarker('2026-08-18T13:00:00.000Z'))
})

test('large Project documents are batched below the request byte limit', async () => {
  const payload = 'x'.repeat(240 * 1024)
  const boards = Array.from({ length: 9 }, (_, n) => board({
    id: `b-large-${n}`,
    name: `Large ${n}`,
    scene: { ...SCENE, note: payload },
  }))
  const s = store(boards)
  const calls: any[] = []
  const api = {
    async push(body: any) {
      calls.push(body)
      return { applied: body.boards.map((change: any) => ({ id: change.id })), cursor: `large-${calls.length}` }
    },
    async pull() { throw new Error('not needed') },
  }

  const result = await syncOnce(s as any, api as any, '2026-08-18T13:00:00.000Z')

  assert.deepEqual(calls.map(call => call.boards.length), [8, 1])
  assert.ok(calls.every(call => syncRequestBytes(call.boards, call.cursor) <= SYNC_REQUEST_BYTE_BUDGET))
  assert.equal(result.status, 'ok')
  assert.equal(result.pushed, boards.length)
})

test('more than the page limit of valid push batches all complete', async () => {
  const count = SYNC_BATCH_SIZE * (SYNC_PAGE_LIMIT + 1)
  const boards = Array.from({ length: count }, (_, n) => board({ id: `b-${n}`, name: `Board ${n}` }))
  const s = store(boards)
  let pushes = 0
  const api = {
    async push(body: any) {
      pushes += 1
      return { applied: body.boards.map((change: any) => ({ id: change.id })) }
    },
    async pull() { throw new Error('not needed') },
  }

  const result = await syncOnce(s, api as any, '2026-08-18T13:00:00.000Z')

  assert.equal(pushes, SYNC_PAGE_LIMIT + 1)
  assert.equal(result.status, 'ok')
  assert.equal(result.pushed, count)
})

test('a push reply missing an acknowledgement is rejected before it consumes the page', async () => {
  const s = store([board({ id: 'b-1' }), board({ id: 'b-2', name: 'Two' })], {
    tombstones: [{ id: 'b-deleted', name: 'Deleted', deletedAt: '2026-08-18T11:00:00.000Z' }],
  })
  const api = {
    async push() {
      return {
        applied: [{ id: 'b-1' }],
        cursor: 'must-not-advance',
        boards: [{ id: 'b-1', name: 'Remote', updated_at: '2026-08-18T12:00:00.000Z', scene: { ...SCENE, objects: [{ type: 'ball' }] } }],
      }
    },
    async pull() { throw new Error('not needed') },
  }
  const result = await syncOnce(s as any, api as any, '2026-08-18T13:00:00.000Z')
  assert.equal(result.status, 'failed')
  assert.equal(s.cursor(), null)
  assert.equal((s as any).boards.get('b-1').name, 'Press trigger')
  assert.equal((s as any).stones.length, 1)
  assert.deepEqual(result.remoteIds, [])
})

test('a failed pass reports remote ids from valid pages it already applied', async () => {
  const s = store([], { pushedAt: '2026-08-18T10:00:00.000Z' })
  const api = {
    async push() { throw new Error('not needed') },
    async pull() {
      if (!s.cursor()) return { cursor: 'next', has_more: true, boards: [{ id: 'b-remote', name: 'Remote', updated_at: '2026-08-18T11:00:00.000Z', scene: SCENE, device: 'other' }] }
      throw new Error('offline')
    },
  }
  const result = await syncOnce(s as any, api as any, '2026-08-18T13:00:00.000Z')
  assert.equal(result.status, 'failed')
  assert.deepEqual(result.remoteIds, ['b-remote'])
  assert.equal((s as any).boards.get('b-remote').name, 'Remote')
})

test('a failed later chunk leaves the global marker unset for retry', async () => {
  const boards = Array.from({ length: SYNC_BATCH_SIZE + 1 }, (_, n) => board({ id: `b-${n}`, name: `Board ${n}` }))
  const s = store(boards)
  let calls = 0
  const api = {
    async push(body: any) {
      calls += 1
      if (calls === 2) throw new Error('offline')
      return { applied: body.boards.map((change: any) => ({ id: change.id })) }
    },
    async pull() { return {} },
  }
  const result = await syncOnce(s as any, api as any, '2026-08-18T13:00:00.000Z')
  assert.equal(result.status, 'failed')
  assert.equal(s.pushedAt(), null)
  assert.equal((collectChanges(s) as any[]).length, SYNC_BATCH_SIZE + 1)
})

test('a preserved conflict copy remains eligible after its pass', async () => {
  const s = store([board()])
  const now = '2026-08-18T13:00:00.000Z'
  const api = {
    async push() { return { conflicts: [{ id: 'b-1', kept: 'server' }], boards: [{ id: 'b-1', name: 'Remote', updated_at: '2026-08-18T12:00:00.000Z', scene: SCENE }] } },
    async pull() { throw new Error('not needed') },
  }
  await syncOnce(s as any, api as any, now, () => 'b-kept')
  assert.equal(s.pushedAt(), pushMarker(now))
  assert.deepEqual((collectChanges(s) as any[]).map((change) => change.id), ['b-kept'])
})

test('a local revision saved in the marker millisecond remains eligible', async () => {
  const s = store([board()])
  const now = '2026-08-18T13:00:00.000Z'
  const api = {
    async push() {
      s.upsert(board({ savedAt: now, scene: { ...SCENE, objects: [{ type: 'ball' }] } }))
      return { applied: [{ id: 'b-1' }] }
    },
    async pull() { throw new Error('not needed') },
  }
  await syncOnce(s as any, api as any, now)
  assert.deepEqual((collectChanges(s) as any[]).map((change) => change.id), ['b-1'])
})

test('more than 200 tombstones remain pending until each is acknowledged', async () => {
  const stones = Array.from({ length: 201 }, (_, n) => ({
    id: `b-deleted-${n}`, name: `Deleted ${n}`, deletedAt: '2026-08-18T11:00:00.000Z',
  }))
  const s = store([], { tombstones: stones })
  const firstId = stones[0].id
  const lastId = stones[200].id
  let attempts = 0
  const api = {
    async push(body: any) {
      attempts += 1
      if (attempts === 2) throw new Error('offline after the first batch')
      return { applied: body.boards.map((change: any) => ({ id: change.id })) }
    },
    async pull() { throw new Error('not needed') },
  }

  const first = await syncOnce(s, api as any, '2026-08-18T13:00:00.000Z')

  assert.equal(first.status, 'failed')
  assert.equal(s.stones.length, 151)
  assert.equal(s.stones.some(stone => stone.id === firstId), false)
  assert.equal(s.stones.some(stone => stone.id === lastId), true)
  assert.equal((collectChanges(s) as any[]).length, 151)

  const second = await syncOnce(s, api as any, '2026-08-18T13:00:00.000Z')
  assert.equal(second.status, 'ok')
  assert.deepEqual(s.stones, [])
})

test('acknowledged deletes are dropped, including deletes resolved as conflicts', async () => {
  const s = store([], { tombstones: [
    { id: 'b-applied', name: 'Applied', deletedAt: '2026-08-18T11:00:00.000Z' },
    { id: 'b-conflict', name: 'Conflict', deletedAt: '2026-08-18T11:00:00.000Z' },
  ] })
  const api = {
    async push() { return { applied: [{ id: 'b-applied' }], conflicts: [{ id: 'b-conflict', kept: 'server' }] } },
    async pull() { return {} },
  }
  await syncOnce(s as any, api as any, '2026-08-18T13:00:00.000Z')
  assert.deepEqual(s.stones, [])
})

test('push and pull pagination advance the cursor through every page', async () => {
  const s = store([board()], { cursor: 'start' })
  const pulls: (string | null)[] = []
  const api = {
    async push(body: any) {
      assert.equal(body.cursor, 'start')
      return { applied: [{ id: 'b-1' }], cursor: 'after-push', has_more: true, boards: [{ id: 'b-remote-1', name: 'One', updated_at: '2026-08-18T11:00:00.000Z', scene: SCENE }] }
    },
    async pull(cursor: string | null) {
      pulls.push(cursor)
      return { cursor: 'after-pull', has_more: false, boards: [{ id: 'b-remote-2', name: 'Two', updated_at: '2026-08-18T12:00:00.000Z', scene: SCENE }] }
    },
  }
  const result = await syncOnce(s as any, api as any, '2026-08-18T13:00:00.000Z')
  assert.deepEqual(pulls, ['after-push'])
  assert.equal(s.cursor(), 'after-pull')
  assert.deepEqual(result.remoteIds.sort(), ['b-remote-1', 'b-remote-2'])
})

test('pull-only sync follows every page', async () => {
  const s = store([], { cursor: 'start', pushedAt: '2026-08-18T10:00:00.000Z' })
  let pulls = 0
  const api = {
    async push() { throw new Error('not needed') },
    async pull(cursor: string | null) {
      pulls += 1
      return pulls === 1 ? { cursor: 'next', has_more: true } : { cursor: 'done', has_more: false }
    },
  }
  const result = await syncOnce(s as any, api as any, '2026-08-18T13:00:00.000Z')
  assert.equal(result.status, 'ok')
  assert.equal(pulls, 2)
  assert.equal(s.cursor(), 'done')
})

test('pagination fails after one page when has_more has no cursor', async () => {
  const s = store([], { pushedAt: '2026-08-18T10:00:00.000Z' })
  let pulls = 0
  const api = {
    async push() { throw new Error('not needed') },
    async pull() { pulls += 1; return { has_more: true } },
  }
  const result = await syncOnce(s as any, api as any, '2026-08-18T13:00:00.000Z')
  assert.equal(result.status, 'failed')
  assert.equal(result.reason, 'sync cursor did not advance')
  assert.equal(pulls, 1)
})

test('pagination fails after one page when has_more repeats the request cursor', async () => {
  const s = store([], { cursor: 'start', pushedAt: '2026-08-18T10:00:00.000Z' })
  let pulls = 0
  const api = {
    async push() { throw new Error('not needed') },
    async pull() { pulls += 1; return { cursor: 'start', has_more: true } },
  }
  const result = await syncOnce(s as any, api as any, '2026-08-18T13:00:00.000Z')
  assert.equal(result.status, 'failed')
  assert.equal(result.reason, 'sync cursor did not advance')
  assert.equal(pulls, 1)
})

test('pagination stops at a defensive page cap', async () => {
  const s = store([], { pushedAt: '2026-08-18T10:00:00.000Z' })
  let pulls = 0
  const api = {
    async push() { throw new Error('not needed') },
    async pull() { pulls += 1; return { cursor: `c-${pulls}`, has_more: true } },
  }
  const result = await syncOnce(s as any, api as any, '2026-08-18T13:00:00.000Z')
  assert.equal(result.status, 'failed')
  assert.equal(pulls, SYNC_PAGE_LIMIT)
})

test('stable-id remote board decisions distinguish rename and delete conflicts', () => {
  assert.equal(remoteCurrentDecision(['b-1'], 'b-1', true, false), 'load')
  assert.equal(remoteCurrentDecision(['b-1'], 'b-1', false, false), 'detach')
  assert.equal(remoteCurrentDecision(['b-1'], 'b-1', true, true), 'conflict')
  assert.equal(remoteCurrentDecision(['b-1'], 'b-1', false, true), 'conflict-delete')
})

test('ids are unique and safe to put in a URL', () => {
  const seen = new Set<string>()
  for (let i = 0; i < 500; i += 1) {
    const id = newId()
    assert.match(id, /^b-[a-z0-9]{20}$/)
    assert.equal(seen.has(id), false)
    seen.add(id)
  }
})

test('preserving a conflict for a board that is gone locally is a no-op', () => {
  const s = store([])
  assert.equal(preserveConflicts(s, [{ id: 'b-missing' }], '2026-08-18T13:00:00.000Z'), 0)
})

test('auth enables shared sync and live independently of Pro', () => {
  const source = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8')
  const reconcile = source.match(/function reconcileProjectSync[\s\S]*?\n}/)?.[0] ?? ''
  const pass = source.match(/async function runSyncPass\(\)[\s\S]*?\n}/)?.[0] ?? ''
  const request = source.match(/function runSync\(\)[\s\S]*?\n}/)?.[0] ?? ''
  assert.match(request, /if \(!\(authenticated \|\| entitlements\.isPro\(\)\)\) return Promise\.resolve\(\)/)
  assert.match(pass, /includeOwned: entitlements\.isPro\(\)/)
  assert.match(source, /enabled: \(\) => authenticated \|\| entitlements\.isPro\(\)/)
  assert.match(source, /authenticated = data\?\.authenticated === true/)
  assert.match(source, /sync\.createSyncRunner\(\(\) => serializeProjectSync\(runSyncPass\)\)/)
  // Personal libraries start before Project validation and still finish when a
  // dirty/conflicted Project cannot safely pull.
  assert.match(pass, /const personalSync = syncPersonalLibraries\(requestedGeneration, requestedBinding\)/)
  assert.match(pass, /if \(!saves\.flushCurrentForSync\(\)\) \{ await personalSync; return \}/)
  assert.match(pass, /await personalSync/)
  assert.doesNotMatch(pass, /result\.status === 'ok'[\s\S]*syncLibrariesOnce/)
  // Read the board identity at completion, not before the awaited request: a
  // switch during sync must not reconcile the board that used to be open.
  assert.match(pass, /const openConflict = reconcileProjectSync\(rowsBeforeSync, result\)/)
  assert.match(reconcile, /const openConflict = saves\.applyRemoteCurrent\(result\.remoteIds, saves\.currentBoardId\(\)\)/)
  assert.doesNotMatch(pass, /openBoardId/)
  assert.match(reconcile, /result\.remoteIds\.length > 0\) \{[\s\S]*saves\.refresh\(\)/)
  // A failure must not raise a banner: nothing was lost by failing to reach
  // the server, and a warning on every flaky connection is noise.
  assert.doesNotMatch(pass, /status === 'failed'/)
})

test('main initializes automatic Pro sync and live after wiring entitlement listeners', () => {
  const source = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8')
  assert.match(source, /void runSync\(\)\nvoid updateLiveChannel\(\)\n\n\/\/ Coming back to the tab/)
})

test('saved-board sync helpers flush named boards and explicitly reconcile remote updates', () => {
  const source = readFileSync(new URL('../src/saves.ts', import.meta.url), 'utf8')
  assert.match(source, /flushCurrentForSync\(\): boolean/)
  assert.match(source, /if \(!this\.currentName\) return true/)
  assert.match(source, /applyRemoteCurrent\(remoteIds: readonly string\[\], currentId: string \| null\)/)
  assert.match(source, /if \(currentId !== this\.currentId\) return false/)
  assert.match(source, /this\.onExternalConflict/)
})

test('a rename keeps the board id, so it is not a new board elsewhere', () => {
  const source = readFileSync(new URL('../src/saves.ts', import.meta.url), 'utf8')
  const snapshot = source.match(/private snapshot\(\)[\s\S]*?\n  }/)?.[0] ?? ''
  assert.match(snapshot, /existing\?\.id \|\| newId\(\)/)
})

test('a delete leaves a tombstone behind', () => {
  const source = readFileSync(new URL('../src/saves.ts', import.meta.url), 'utf8')
  const commit = source.match(/private commit\(all: SavedProjects\)[\s\S]*?\n  }/)?.[0] ?? ''
  assert.match(commit, /recordTombstones\(removed/)
  // And the tombstone is only written once the write actually succeeded.
  assert.match(commit, /if \(!writeAll\(all, this\.storageKey\)\)/)
})
