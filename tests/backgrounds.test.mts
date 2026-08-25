import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  boardHeightFor, cleanName, createBackgroundStore, dataUrlBytes, fitSize, freeName, isBackgroundId,
  memoryDriver, memoryMirror, type BackgroundMeta, type StoredBackground,
} from '../src/backgrounds.ts'

const IMAGE = 'data:image/jpeg;base64,' + 'A'.repeat(400)

function newStore(seed: StoredBackground[] = [], mirrorSeed: BackgroundMeta[] = []) {
  let clock = 1_000
  return createBackgroundStore(memoryDriver(seed), memoryMirror(mirrorSeed), () => (clock += 1_000))
}

const shot = (name: string, kind: 'pitch' | 'broadcast' = 'broadcast') =>
  ({ name, kind, full: IMAGE, thumb: IMAGE, w: 1600, h: 900 })

test('a board takes its height from the image it stands on', () => {
  assert.equal(boardHeightFor(1600, 900), 450)
  assert.equal(boardHeightFor(1280, 853), 533)
  // an unreadable size falls back rather than making a board of zero height
  assert.equal(boardHeightFor(0, 0), 418)
  assert.deepEqual(fitSize(4000, 3000, 1600), { w: 1600, h: 1200 })
  // a small image is never blown up
  assert.deepEqual(fitSize(300, 200, 1600), { w: 300, h: 200 })
})

test('names are trimmed, capped, and never carry control characters', () => {
  assert.equal(cleanName('  Wide camera  '), 'Wide camera')
  assert.equal(cleanName(''), 'Background')
  assert.equal(cleanName(null, 'Screenshot'), 'Screenshot')
  assert.equal(cleanName('x'.repeat(200)).length, 60)
  assert.equal(freeName('Wide', ['Wide', 'Wide 2']), 'Wide 3')
})

test('an id says whether it is a saved background', () => {
  assert.equal(isBackgroundId('bg:abc'), true)
  assert.equal(isBackgroundId('pitch'), false)
  assert.equal(isBackgroundId(undefined), false)
  assert.ok(dataUrlBytes(IMAGE) > 250)
  assert.equal(dataUrlBytes('data:image/jpeg;base64,/9j/'), 3)
  assert.equal(dataUrlBytes('data:image/jpeg;base64,AA=='), 1)
  assert.equal(dataUrlBytes('data:image/jpeg;base64,AAA='), 2)
})

test('adding a background keeps the ones already there', async () => {
  const store = newStore()
  const first = await store.add(shot('Wide camera'))
  const second = await store.add(shot('Attacking third'))
  assert.equal(store.count(), 2)
  // newest first, and both are still readable
  assert.deepEqual(store.list().map(m => m.name), ['Attacking third', 'Wide camera'])
  assert.equal(await store.image(first.id), IMAGE)
  assert.equal(await store.image(second.id), IMAGE)
  assert.notEqual(first.id, second.id)
  assert.equal(first.boardH, 450)
})

test('two backgrounds never end up with the same name', async () => {
  const store = newStore()
  await store.add(shot('Rondo grid'))
  const twin = await store.add(shot('Rondo grid'))
  assert.equal(twin.name, 'Rondo grid 2')
  const copy = await store.duplicate(twin.id)
  assert.equal(copy?.name, 'Rondo grid 2 copy')
  assert.equal(store.count(), 3)
})

test('renaming and deleting touch only their own background', async () => {
  const store = newStore()
  const keep = await store.add(shot('Keep'))
  const drop = await store.add(shot('Drop'))
  await store.rename(keep.id, '  Half pitch  ')
  assert.equal(store.get(keep.id)?.name, 'Half pitch')
  await store.remove(drop.id)
  assert.equal(store.count(), 1)
  assert.equal(store.get(drop.id), null)
  assert.equal(await store.image(drop.id), null)
  assert.equal(store.get(keep.id)?.name, 'Half pitch')
})

test('the shelf survives a reload before the database opens', async () => {
  const mirror = memoryMirror()
  const driver = memoryDriver()
  const first = createBackgroundStore(driver, mirror, () => 5_000)
  const meta = await first.add(shot('Broadcast'))

  // A fresh page: the index answers from the mirror at once, so the board
  // knows its height without waiting, and the image follows from the database.
  const second = createBackgroundStore(driver, mirror)
  assert.equal(second.ready, false)
  assert.equal(second.count(), 1)
  assert.equal(second.get(meta.id)?.boardH, 450)
  await second.load()
  assert.equal(second.ready, true)
  assert.equal(await second.image(meta.id), IMAGE)
})

test('storage that throws leaves the shelf usable rather than breaking the board', async () => {
  const broken = {
    async list(): Promise<StoredBackground[]> { throw new Error('blocked') },
    async get() { throw new Error('blocked') },
    async put() { throw new Error('blocked') },
    async remove() { throw new Error('blocked') },
  }
  const store = createBackgroundStore(broken as never, memoryMirror())
  await store.load()
  assert.equal(store.ready, true)
  assert.equal(store.count(), 0)
  assert.equal(await store.image('bg:missing'), null)
})

test('stored rows that are not images are dropped, not rendered', async () => {
  const rows = [
    { id: 'bg:ok', name: 'Fine', w: 1600, h: 900, boardH: 450, bytes: 10, at: 1, full: IMAGE, thumb: IMAGE },
    { id: 'bg:bad', name: 'Script', w: 10, h: 10, boardH: 418, bytes: 1, at: 2, full: 'javascript:alert(1)', thumb: IMAGE },
  ] as StoredBackground[]
  const store = newStore(rows)
  await store.load()
  assert.deepEqual(store.list().map(m => m.id), ['bg:ok'])
})

test('the picker is told about every change', async () => {
  const store = newStore()
  let beats = 0
  const off = store.subscribe(() => { beats++ })
  const meta = await store.add(shot('One'))
  await store.rename(meta.id, 'Two')
  await store.remove(meta.id)
  assert.equal(beats, 3)
  off()
  await store.add(shot('Three'))
  assert.equal(beats, 3)
})

test('a background remembers whether it is a pitch or a broadcast', async () => {
  const store = newStore()
  const pitch = await store.add(shot('Training ground', 'pitch'))
  const camera = await store.add(shot('Wide camera', 'broadcast'))
  assert.equal(store.get(pitch.id)?.kind, 'pitch')
  assert.equal(store.get(camera.id)?.kind, 'broadcast')

  // and a copy is the same kind of thing as what it was copied from
  const copy = await store.duplicate(pitch.id)
  assert.equal(copy?.kind, 'pitch')
})

test('what a background is can be changed after it is saved', async () => {
  const store = newStore()
  const meta = await store.add(shot('Half pitch', 'broadcast'))
  await store.setKind(meta.id, 'pitch')
  assert.equal(store.get(meta.id)?.kind, 'pitch')

  // an unknown answer changes nothing rather than making a third kind
  await store.setKind(meta.id, 'whiteboard' as never)
  assert.equal(store.get(meta.id)?.kind, 'pitch')
})

test('backgrounds saved before the choice existed stay broadcasts', async () => {
  const rows = [
    { id: 'bg:old', name: 'Old', w: 1600, h: 900, boardH: 450, bytes: 10, at: 1, full: IMAGE, thumb: IMAGE },
  ] as StoredBackground[]
  const store = newStore(rows)
  await store.load()
  assert.equal(store.get('bg:old')?.kind, 'broadcast')
})

test('background sync keeps tombstones local, binds accepted rows, and hydrates pulled JPEG bytes', async () => {
  const store = newStore()
  const local = await store.add(shot('Local'))
  const sync = store.librarySyncStore()
  let notices = 0
  store.subscribe(source => { if (source === 'local') notices++ })
  await sync.bind([local.id], 'a'.repeat(64))
  assert.equal((await sync.list())[0].syncAccount, 'a'.repeat(64))

  await sync.apply({
    id: 'bg:remote', kind: 'background', name: 'Remote camera',
    payload: { backgroundKind: 'broadcast', w: 1600, h: 900, boardH: 450, bytes: 300, at: 20 },
    updatedAt: '2026-08-18T12:00:00.000Z', syncAccount: 'a'.repeat(64), src: IMAGE,
  })
  assert.equal(store.get('bg:remote')?.name, 'Remote camera')
  assert.equal(await store.image('bg:remote'), IMAGE)
  assert.equal(store.get('bg:remote')?.bytes, dataUrlBytes(IMAGE), 'pulled size comes from the JPEG')
  assert.equal(notices, 0, 'pulled rows do not look like local edits')

  await sync.apply({
    id: 'bg:remote', kind: 'background', name: 'Deleted background', payload: undefined,
    updatedAt: '2026-08-18T12:00:01.000Z', syncAccount: 'a'.repeat(64), deleted: true,
  })
  assert.equal(store.get('bg:remote'), null, 'a payload-free remote tombstone still removes the image')

  await store.remove(local.id)
  assert.equal(store.get(local.id), null)
  assert.equal((await sync.list()).find(row => row.id === local.id)?.deleted, true)
})

test('the kind decides what the board offers on the image', async () => {
  const { pitchById, setCustomPitches } = await import('../src/pitches.ts')
  const { backgrounds } = await import('../src/background-library.ts')
  const pitch = await backgrounds.add(shot('Training ground', 'pitch'))
  const camera = await backgrounds.add(shot('Wide camera', 'broadcast'))

  // background-library publishes every change to the picker
  const asPitch = pitchById(pitch.id)
  const asBroadcast = pitchById(camera.id)
  assert.equal(asPitch.custom, true)
  assert.equal(asPitch.live, false, 'a pitch is drawn on with teams, not live players')
  assert.equal(asBroadcast.live, true)
  // and the two are separate lanes, so crossing between them asks first
  assert.notEqual(asPitch.category, asBroadcast.category)

  await backgrounds.setKind(pitch.id, 'broadcast')
  assert.equal(pitchById(pitch.id).live, true, 'the picker follows a changed kind')

  setCustomPitches([])
})
