import assert from 'node:assert/strict'
import test from 'node:test'

import {
  FREE_PROJECT_LIMIT,
  addBoard,
  appendBoardCopy,
  appendProjectCopy,
  boardLabel,
  boardName,
  canAnimate,
  canCreateProject,
  carryObjects,
  undoCarry,
  copyDocumentForConflict,
  documentScene,
  firstLine,
  frameAt,
  frameAtPos,
  HANDOFF,
  pointOnArrow,
  tweenScene,
  freshDeviceDestination,
  loadLibrary,
  migrateLibrary,
  rememberBoard,
  saveLibrary,
  storedBoardIndex,
  migrateProject,
  moveBoard,
  newProject,
  newProjectFromBoard,
  newProjectFromProjectCopy,
  normalizeBoardDocument,
  normalizeDocumentArrowLegends,
  noteBody,
  noteHeading,
  preserveDocumentFields,
  projectDuration,
  reconcileProjectLibrary,
  removeBoard,
  tryNormalizeBoardDocument,
  type Library,
} from '../src/projects.ts'
import { emptyScene } from '../src/types.ts'

const scene = () => emptyScene()

function libraryOf(count: number): Library {
  const projects = Array.from({ length: count }, (_, i) => ({ ...newProject(scene(), `P${i}`), updated: i }))
  return { version: 2, currentId: projects[0]?.id ?? '', projects }
}

test('a clean device opens meaningful remote work instead of its untouched starter', () => {
  const starter = newProject(scene())
  const emptyRemote = newProject(scene())
  emptyRemote.updated = starter.updated + 2
  const work = newProject(scene(), 'Session plan')
  work.updated = starter.updated + 1
  work.boards[0].scene.objects.push({ id: 'ball', type: 'ball', x: 100, y: 100, size: 20, flipX: false, flipY: false })
  const lib: Library = { version: 2, currentId: starter.id, projects: [starter, emptyRemote, work] }
  const remoteIds = new Set([emptyRemote.id, work.id])

  assert.equal(freshDeviceDestination(lib, { id: starter.id, updated: starter.updated }, remoteIds)?.id, work.id)
  starter.updated += 1
  assert.equal(freshDeviceDestination(lib, { id: starter.id, updated: starter.updated - 1 }, remoteIds), null)
})

test('Free and Pro both allow unlimited local projects', () => {
  assert.equal(FREE_PROJECT_LIMIT, 3, 'legacy display constant remains import-compatible')
  for (const count of [0, 3, 4, 100]) {
    const lib = libraryOf(count)
    assert.equal(canCreateProject(lib, false), true)
    assert.equal(canCreateProject(lib, true), true)
  }
})

test('a project needs two boards before it can animate', () => {
  const project = newProject(scene())
  assert.equal(canAnimate(project), false)
  addBoard(project, 0, true)
  assert.equal(canAnimate(project), true)
})

test('Project library reconciliation seeds once and picks the newer full document', () => {
  const a = newProject(scene(), 'Local A')
  const b = newProject(scene(), 'Local B')
  a.id = 'a'
  b.id = 'b'
  a.updated = 100
  b.updated = 200
  const library: Library = { version: 2, currentId: 'a', projects: [a, b] }

  const seeded = reconcileProjectLibrary(library, [], { seedMissing: true })
  assert.deepEqual(seeded.persist.map(project => project.id).sort(), ['a', 'b'])

  const savedA = { ...a, name: 'Saved A', updated: 300 }
  const savedB = { ...b, name: 'Stale B', updated: 150 }
  const merged = reconcileProjectLibrary(library, [
    { rowId: 'row-a', project: savedA },
    { rowId: 'row-b', project: savedB },
    { rowId: 'row-c', project: { ...newProject(scene(), 'Pulled C'), id: 'c', updated: 250 } },
  ])
  assert.equal(merged.library.projects.find(project => project.id === 'a')!.name, 'Saved A')
  assert.equal(merged.library.projects.find(project => project.id === 'c')!.name, 'Pulled C')
  assert.deepEqual(merged.persist.map(project => project.id), ['b'])
})

test('post-sync reconciliation removes a remotely deleted non-current Project without reseeding it', () => {
  const a = newProject(scene(), 'Current')
  const b = newProject(scene(), 'Deleted elsewhere')
  a.id = 'a'
  b.id = 'b'
  const library: Library = { version: 2, currentId: 'a', projects: [a, b] }
  const result = reconcileProjectLibrary(library, [], {
    removeProjectIds: ['a', 'b'],
    skipCurrent: true,
  })
  assert.deepEqual(result.library.projects.map(project => project.id), ['a'])
  assert.deepEqual(result.persist, [])
})

test('durable documents keep direct scenes compatible and preserve full projects', () => {
  const direct = scene()
  assert.deepEqual(normalizeBoardDocument(direct), direct)
  assert.deepEqual(documentScene(direct), direct)

  const project = newProject(scene(), 'Set-piece sequence')
  project.id = 'project-stable'
  project.updated = 1234
  project.boards[0].id = 'board-one'
  project.boards[0].title = 'Corner setup'
  project.boards[0].note = 'Pin the keeper'
  project.boards[0].view = { x: 20, y: 30, w: 400, h: 209 }
  project.boards[0].link = { dur: 2200, ease: 'linear' }
  project.boards[0].scene.objects.push({ id: 'player-stable', type: 'ball', x: 100, y: 100, size: 20, flipX: false, flipY: false } as never)
  const second = addBoard(project, 0, true)
  second.id = 'board-two'
  second.note = 'Attack the near post'
  second.link = { dur: 600, ease: 'out' }

  const document = normalizeBoardDocument(JSON.parse(JSON.stringify(project)))
  assert.ok('boards' in document)
  assert.equal(document.id, 'project-stable')
  assert.equal(document.name, 'Set-piece sequence')
  assert.equal(document.updated, 1234)
  assert.deepEqual(document.boards.map(board => board.id), ['board-one', 'board-two'])
  assert.equal(document.boards[0].note, 'Pin the keeper')
  assert.deepEqual(document.boards[0].view, { x: 20, y: 30, w: 400, h: 209 })
  assert.deepEqual(document.boards.map(board => board.link), [{ dur: 2200, ease: 'linear' }, { dur: 600, ease: 'out' }])
  assert.equal(documentScene(document).objects[0].id, 'player-stable')
  assert.equal(tryNormalizeBoardDocument({ future: true }), null)

  const conflict = copyDocumentForConflict(document, 'project-copy')
  assert.ok('boards' in conflict)
  assert.equal(conflict.id, 'project-copy')
  assert.deepEqual(conflict.boards.map(board => board.id), ['board-one', 'board-two'])
  assert.equal(document.id, 'project-stable')
})

test('editing a known project preserves fields from a newer producer', () => {
  const raw: any = projectDocumentWithFutureFields()
  const current = normalizeBoardDocument(raw)
  assert.ok('boards' in current)
  current.boards[0].scene.objects[0].x = 240
  const merged: any = preserveDocumentFields(raw, current)
  assert.equal(merged.futureProject, 'keep')
  assert.equal(merged.boards[0].futureBoard, 'keep')
  assert.equal(merged.boards[0].scene.futureScene, 'keep')
  assert.equal(merged.boards[0].scene.objects[0].futureObject, 'keep')
  assert.equal(merged.boards[0].scene.objects[0].x, 240)

  raw.boards[0].scene.arrowLegend = { dotted: 'passes', dashed: ' ', future: 'drop' }
  const normalizedLegend = normalizeBoardDocument(raw)
  assert.ok('boards' in normalizedLegend)
  assert.deepEqual(normalizedLegend.boards[0].scene.arrowLegend, { dotted: 'passes' })
  const mergedLegend: any = preserveDocumentFields(raw, normalizedLegend)
  assert.deepEqual(mergedLegend.boards[0].scene.arrowLegend, { dotted: 'passes' })
  const importedLegend: any = normalizeDocumentArrowLegends(raw, normalizedLegend)
  assert.deepEqual(importedLegend.boards[0].scene.arrowLegend, { dotted: 'passes' })
  delete normalizedLegend.boards[0].scene.arrowLegend
  const removedLegend: any = preserveDocumentFields(raw, normalizedLegend)
  assert.equal('arrowLegend' in removedLegend.boards[0].scene, false)

  const direct: any = scene()
  direct.futureScene = 'direct-keep'
  const wrapped = newProject(normalizeBoardDocument(direct) as any)
  const converted: any = preserveDocumentFields(direct, wrapped)
  assert.equal(converted.boards[0].scene.futureScene, 'direct-keep')
})

function projectDocumentWithFutureFields(): any {
  const project: any = newProject(scene(), 'Future')
  project.futureProject = 'keep'
  project.boards[0].futureBoard = 'keep'
  project.boards[0].scene.futureScene = 'keep'
  project.boards[0].scene.objects.push({
    id: 'future-player', type: 'ball', x: 100, y: 100, size: 20,
    flipX: false, flipY: false, rotation: 0, futureObject: 'keep',
  })
  return project
}

test('copying a board keeps object ids, so movement can be derived', () => {
  const start = scene()
  start.objects.push({ id: 'p1', type: 'player', x: 100, y: 100, color: '#1e2f6f', label: '', shape: 'circle' } as never)
  const project = newProject(start)
  const copy = addBoard(project, 0, true)
  assert.equal(copy.scene.objects[0].id, 'p1')
  const fresh = addBoard(project, 1, false, scene())
  assert.equal(fresh.scene.objects.length, 0)
})

test('carrying selected or all objects preserves order, ids, and target edits', () => {
  const start = scene()
  start.objects.push(
    { id: 'first', type: 'ball', x: 10, y: 20, size: 18, flipX: false, flipY: false } as never,
    { id: 'second', type: 'ball', x: 30, y: 40, size: 18, flipX: false, flipY: false } as never,
  )
  const project = newProject(start)
  const next = addBoard(project, 0, false, scene())
  const later = addBoard(project, 1, false, scene())
  later.scene.objects.push({ id: 'first', type: 'ball', x: 900, y: 900, size: 9, flipX: false, flipY: false } as never)
  project.updated = 1
  const before = project.updated
  const result = carryObjects(project, project.boards[0], [next.id, later.id], ['first', 'missing'])
  assert.deepEqual(result, { boards: 1, objects: 1, skipped: 1, added: [{ boardId: next.id, objectIds: ['first'] }] })
  assert.deepEqual(next.scene.objects.map(object => object.id), ['first'])
  assert.deepEqual(later.scene.objects.map(object => object.x), [900])
  assert.notEqual(project.updated, before)
  assert.notEqual(next.scene.objects[0], project.boards[0].scene.objects[0])
  ;(next.scene.objects[0] as any).x = 999
  assert.equal(project.boards[0].scene.objects[0].x, 10)
  later.scene.objects.push(JSON.parse(JSON.stringify(project.boards[0].scene.objects[1])))

  const untouched = project.updated
  const none = carryObjects(project, 'missing', [next.id], 'all')
  assert.deepEqual(none, { boards: 0, objects: 0, skipped: 0, added: [] })
  assert.equal(project.updated, untouched)
  const duplicate = carryObjects(project, project.boards[0].id, [later.id], 'all')
  assert.deepEqual(duplicate, { boards: 0, objects: 0, skipped: 2, added: [] })
  assert.equal(project.updated, untouched)

  const allTarget = addBoard(project, project.boards.length - 1, false, scene())
  project.updated = 2
  const all = carryObjects(project, project.boards[0].id, [allTarget.id, allTarget.id], 'all')
  assert.deepEqual(all, { boards: 1, objects: 2, skipped: 0, added: [{ boardId: allTarget.id, objectIds: ['first', 'second'] }] })
  assert.deepEqual(allTarget.scene.objects.map(object => object.id), ['first', 'second'])
  assert.notEqual(project.updated, 2)
})

test('a shared board can start a project or join one without reusing its board id', () => {
  const sourceProject = newProject(scene(), 'Source')
  const source = sourceProject.boards[0]
  source.title = 'Rest defence'
  source.note = 'Keep three behind the ball.'
  source.scene.objects.push({ id: 'same-player', type: 'player', x: 100, y: 100, color: '#1e2f6f', label: '', shape: 'circle' } as never)

  const created = newProjectFromBoard(source, 'Shared board')
  assert.equal(created.name, 'Shared board')
  assert.notEqual(created.boards[0].id, source.id)
  assert.equal(created.boards[0].scene.objects[0].id, 'same-player')
  assert.equal(created.boards[0].note, source.note)

  const existing = newProject(scene(), 'Existing')
  const appended = appendBoardCopy(existing, source)
  assert.equal(existing.boards.length, 2)
  assert.notEqual(appended.id, source.id)
  assert.equal(appended.scene.objects[0].id, 'same-player')
  assert.equal(appended.link.dur, 1200)
})

test('a whole-project copy gets new board ids and keeps its sequence timings', () => {
  const source = newProject(scene(), 'Shared sequence')
  source.boards[0].link = { dur: 2200, ease: 'linear' }
  const second = addBoard(source, 0, true)
  second.link = { dur: 600, ease: 'out' }

  const created = newProjectFromProjectCopy(source)
  assert.notEqual(created.id, source.id)
  assert.deepEqual(created.boards.map(board => board.link), source.boards.map(board => board.link))
  assert.notDeepEqual(created.boards.map(board => board.id), source.boards.map(board => board.id))

  const existing = newProject(scene(), 'Existing')
  const appended = appendProjectCopy(existing, source)
  assert.equal(existing.boards.length, 3)
  assert.deepEqual(appended.map(board => board.link), source.boards.map(board => board.link))
  assert.notDeepEqual(appended.map(board => board.id), source.boards.map(board => board.id))
})

test('a board takes its link with it when it moves', () => {
  const project = newProject(scene())
  addBoard(project, 0, true)
  addBoard(project, 1, true)
  project.boards[0].link.dur = 2200
  moveBoard(project, 0, 2)
  assert.equal(project.boards[2].link.dur, 2200)
})

test('the last board cannot be deleted, and numbering flows around manual labels', () => {
  const project = newProject(scene())
  assert.equal(removeBoard(project, project.boards[0].id), false)
  addBoard(project, 0, true)
  addBoard(project, 1, true)
  project.boards[1].label = '1a'
  assert.deepEqual([0, 1, 2].map(i => boardLabel(project, i)), ['1', '1a', '2'])
})

test('a board is named by its title, then its note heading, then its number', () => {
  const project = newProject(scene())
  assert.equal(boardName(project, 0), 'Board 1')
  // a note without a heading leaves the board on its number
  project.boards[0].note = '**Back three splits.** Keeper steps in.'
  assert.equal(boardName(project, 0), 'Board 1')
  project.boards[0].note = '# Back three splits\n\nKeeper steps in.'
  assert.equal(boardName(project, 0), 'Back three splits')
  project.boards[0].title = 'Build-up'
  assert.equal(boardName(project, 0), 'Build-up')
})

test('firstLine strips the markdown a card should not show', () => {
  assert.equal(firstLine('## Heading\n\nbody'), 'Heading')
  assert.equal(firstLine('\n\n*italic* and `code`'), 'italic and code')
  assert.equal(firstLine(''), '')
})

test('the four note slots collapse into one note, in reading order', () => {
  const project = migrateProject({
    id: 'p', name: 'Old', boards: [{
      id: 'b', scene: scene(), notes: { top: 'above', right: 'right', bottom: 'below', left: 'left' },
    }],
  })
  assert.ok(project)
  assert.equal(project!.boards[0].note, 'above\n\nleft\n\nright\n\nbelow')
})

test('a sequence stored with a links array keeps its timings', () => {
  const project = migrateProject({
    id: 'p', name: 'Old', boards: [{ id: 'a', scene: scene() }, { id: 'b', scene: scene() }],
    links: [{ dur: 2200, ease: 'linear' }],
  })
  assert.equal(project!.boards[0].link.dur, 2200)
  assert.equal(project!.boards[0].link.ease, 'linear')
})

test('a library with an unknown current project falls back to the first', () => {
  const lib = migrateLibrary({ version: 2, currentId: 'gone', projects: [newProject(scene(), 'Only')] })
  assert.equal(lib!.currentId, lib!.projects[0].id)
  assert.equal(migrateLibrary({ version: 2, currentId: 'x', projects: [] }), null)
  assert.equal(migrateLibrary(null), null)
})

test('the last opened project survives a failed full-library write', () => {
  const storageKey = 'test-project-library'
  const values = new Map<string, string>()
  let rejectLibraryWrite = false
  const storage = {
    get length() { return values.size },
    clear() { values.clear() },
    getItem(key: string) { return values.get(key) ?? null },
    key(index: number) { return Array.from(values.keys())[index] ?? null },
    removeItem(key: string) { values.delete(key) },
    setItem(key: string, value: string) {
      if (rejectLibraryWrite && key === storageKey) throw new Error('quota exceeded')
      values.set(key, value)
    },
  }
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage })
  try {
    const lib = libraryOf(2)
    const firstId = lib.projects[0].id
    const secondId = lib.projects[1].id
    saveLibrary(lib, storageKey)

    lib.currentId = secondId
    rejectLibraryWrite = true
    saveLibrary(lib, storageKey)

    assert.equal(JSON.parse(values.get(storageKey)!).currentId, firstId, 'the large value stayed stale')
    assert.equal(loadLibrary(storageKey, 'unused-legacy')!.currentId, secondId)

    values.set(`${storageKey}:active-project`, 'deleted-project')
    assert.equal(loadLibrary(storageKey, 'unused-legacy')!.currentId, firstId, 'a stale pointer is ignored')
  } finally {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous)
    else delete (globalThis as { localStorage?: unknown }).localStorage
  }
})

test('the library stores durable Projects as small refs and keeps dirty work inline', () => {
  const libraryKey = 'test-compact-library'
  const savedKey = 'test-durable-projects'
  const values = new Map<string, string>()
  const storage = {
    get length() { return values.size },
    clear() { values.clear() },
    getItem(key: string) { return values.get(key) ?? null },
    key(index: number) { return Array.from(values.keys())[index] ?? null },
    removeItem(key: string) { values.delete(key) },
    setItem(key: string, value: string) { values.set(key, value) },
  }
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage })
  try {
    const durable = newProject(scene(), 'Durable')
    const dirty = newProject(scene(), 'Dirty')
    const olderDirty = structuredClone(dirty)
    dirty.boards[0].note = 'An edit that has not reached the durable row'
    dirty.updated += 1
    // A clock correction must not let the durable timestamp erase inline work.
    olderDirty.updated = dirty.updated + 100
    values.set(savedKey, JSON.stringify({
      Durable: { savedAt: '2026-01-01T00:00:00.000Z', scene: durable },
      Dirty: { savedAt: '2026-01-01T00:00:00.000Z', scene: olderDirty },
    }))
    const library: Library = { version: 2, currentId: dirty.id, projects: [durable, dirty] }

    assert.equal(saveLibrary(library, libraryKey, savedKey), true)
    const stored = JSON.parse(values.get(libraryKey)!)
    assert.equal(stored.version, 3)
    assert.deepEqual(stored.projects[0], { id: durable.id })
    assert.equal(stored.projects[1].boards[0].note, dirty.boards[0].note)

    const loaded = loadLibrary(libraryKey, 'unused-legacy', savedKey)!
    assert.equal(loaded.currentId, dirty.id)
    assert.equal(loaded.projects.find(project => project.id === durable.id)?.name, 'Durable')
    const loadedDirty = loaded.projects.find(project => project.id === dirty.id)!
    assert.equal(loadedDirty.boards[0].note, dirty.boards[0].note)
    assert.ok(loadedDirty.updated > olderDirty.updated)
  } finally {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous)
    else delete (globalThis as { localStorage?: unknown }).localStorage
  }
})

test('reload restores a newly durable active Project when the old library write missed it', () => {
  const libraryKey = 'test-stale-library'
  const savedKey = 'test-new-durable-project'
  const values = new Map<string, string>()
  const storage = {
    get length() { return values.size },
    clear() { values.clear() },
    getItem(key: string) { return values.get(key) ?? null },
    key(index: number) { return Array.from(values.keys())[index] ?? null },
    removeItem(key: string) { values.delete(key) },
    setItem(key: string, value: string) { values.set(key, value) },
  }
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage })
  try {
    const oldProject = newProject(scene(), 'Old project')
    const newProjectDocument = newProject(scene(), 'New project')
    values.set(libraryKey, JSON.stringify({ version: 3, currentId: oldProject.id, projects: [{ id: oldProject.id }] }))
    values.set(savedKey, JSON.stringify({
      Old: { savedAt: '2026-01-01T00:00:00.000Z', scene: oldProject },
      New: { savedAt: '2026-01-02T00:00:00.000Z', scene: newProjectDocument },
    }))
    values.set(`${libraryKey}:active-project`, newProjectDocument.id)

    const loaded = loadLibrary(libraryKey, 'unused-legacy', savedKey)!
    assert.equal(loaded.currentId, newProjectDocument.id)
    assert.deepEqual(new Set(loaded.projects.map(project => project.id)), new Set([oldProject.id, newProjectDocument.id]))
  } finally {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous)
    else delete (globalThis as { localStorage?: unknown }).localStorage
  }
})

test('compacting durable Projects makes room for the next library write', () => {
  const libraryKey = 'test-quota-library'
  const savedKey = 'test-quota-durable'
  const values = new Map<string, string>()
  const storage = {
    get length() { return values.size },
    clear() { values.clear() },
    getItem(key: string) { return values.get(key) ?? null },
    key(index: number) { return Array.from(values.keys())[index] ?? null },
    removeItem(key: string) { values.delete(key) },
    setItem(key: string, value: string) {
      if (key === libraryKey && value.length > 500) throw new Error('quota exceeded')
      values.set(key, value)
    },
  }
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage })
  try {
    const first = newProject(scene(), 'First')
    const second = newProject(scene(), 'Second')
    first.boards[0].note = 'x'.repeat(2_000)
    second.boards[0].note = 'y'.repeat(2_000)
    values.set(savedKey, JSON.stringify({
      First: { savedAt: '2026-01-01T00:00:00.000Z', scene: first },
      Second: { savedAt: '2026-01-02T00:00:00.000Z', scene: second },
    }))
    const library: Library = { version: 2, currentId: second.id, projects: [first, second] }

    assert.equal(saveLibrary(library, libraryKey, savedKey), true)
    assert.ok(values.get(libraryKey)!.length < 500)
    assert.deepEqual(JSON.parse(values.get(libraryKey)!).projects, [{ id: first.id }, { id: second.id }])
  } finally {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous)
    else delete (globalThis as { localStorage?: unknown }).localStorage
  }
})

test('a library keeps the last board of each project it still has', () => {
  const a = newProject(scene(), 'A')
  const b = newProject(scene(), 'B')
  const lib = migrateLibrary({
    version: 2,
    currentId: a.id,
    projects: [a, b],
    lastBoardIds: { [a.id]: a.boards[0].id, [b.id]: 7, gone: 'x' },
  })
  assert.deepEqual(lib!.lastBoardIds, { [a.id]: a.boards[0].id })
  assert.equal(migrateLibrary({ version: 2, currentId: a.id, projects: [a] }).lastBoardIds, undefined)
  assert.equal(migrateLibrary({ version: 2, currentId: a.id, projects: [a], lastBoardIds: 'no' }).lastBoardIds, undefined)
})

test('a stored board resolves by id and a stale one falls back to board 0', () => {
  const project = newProject(scene(), 'A')
  addBoard(project, 0, true)
  const lib = { version: 2 as const, currentId: project.id, projects: [project] }
  assert.equal(storedBoardIndex(lib, project), -1)
  rememberBoard(lib, project.id, project.boards[1].id)
  assert.equal(storedBoardIndex(lib, project), 1)
  rememberBoard(lib, project.id, undefined)
  assert.equal(storedBoardIndex(lib, project), 1)
  removeBoard(project, project.boards[1].id)
  assert.equal(storedBoardIndex(lib, project), -1)
})

test('playback holds on every board and spends every link', () => {
  const project = newProject(scene())
  addBoard(project, 0, true)
  project.boards[0].link.dur = 1000
  assert.equal(projectDuration(project), 700 * 2 + 1000)

  const held = frameAt(project, 0)
  assert.equal(held.moving, false)
  assert.equal(held.noteAlpha, 1)

  const middle = frameAt(project, 700 + 500)
  assert.equal(middle.moving, true)
  assert.ok(middle.noteAlpha < 1, 'the note fades while the board is moving')

  const end = frameAt(project, projectDuration(project))
  assert.equal(end.current, 1)
})

test('the deck draws a board position, and the note swaps at the halfway mark', () => {
  const project = newProject(scene())
  addBoard(project, 0, true)

  const first = frameAtPos(project, 0)
  assert.equal(first.current, 0)
  assert.equal(first.moving, false)
  assert.equal(first.noteAlpha, 1)

  const halfway = frameAtPos(project, 0.5)
  assert.equal(halfway.moving, true)
  assert.equal(halfway.noteAlpha, 0, 'nothing is readable at the middle of a move')

  // the note belongs to the board the deck has arrived at
  assert.equal(frameAtPos(project, 0.49).current, 0)
  assert.equal(frameAtPos(project, 0.51).current, 1)

  // a deck pulled past either end stays on the board at that end
  assert.equal(frameAtPos(project, -3).current, 0)
  assert.equal(frameAtPos(project, 9).current, 1)
  assert.equal(frameAtPos(project, 9).noteAlpha, 1)
})

test('an object arriving fades in where it will be, one leaving fades out', () => {
  const project = newProject(scene())
  addBoard(project, 0, true)
  const gone = { id: 'old-one', type: 'player', x: 100, y: 100, r: 14, color: '#e02020' }
  const fresh = { ...gone, id: 'new-one', x: 500 }
  project.boards[0].scene.objects = [gone] as never
  project.boards[1].scene.objects = [fresh] as never

  const mid = frameAtPos(project, 0.5)
  assert.ok(mid.fading.has('old-one'), 'the object with no counterpart is leaving')
  assert.ok(mid.arriving.has('new-one'), 'the object with no origin is arriving')
  assert.ok(mid.scene.objects.some(o => o.id === 'new-one'), 'it is drawn during the move, not after it')

  // the two never sit on top of each other
  assert.equal(frameAtPos(project, 0.5).exitAlpha, 0)
  assert.equal(frameAtPos(project, 0).enterAlpha, 0)
  assert.equal(frameAtPos(project, 0.9).enterAlpha, 1, 'it is fully there before the move ends')
})

test('the ground hands over at the one moment neither board has anything to show', () => {
  const project = newProject(scene())
  addBoard(project, 0, true)
  project.boards[0].scene.pitch = 'bg:one'
  project.boards[0].scene.board = { w: 800, h: 640 }
  project.boards[1].scene.pitch = 'bg:two'
  project.boards[1].scene.board = { w: 800, h: 450 }
  const gone = { id: 'old-one', type: 'player', x: 100, y: 100, r: 14, color: '#e02020' }
  const fresh = { ...gone, id: 'new-one', x: 500 }
  const both = { ...gone, id: 'stays', x: 200, y: 200 }
  project.boards[0].scene.objects = [gone, both] as never
  project.boards[1].scene.objects = [fresh, { ...both, x: 600, y: 300 }] as never

  // before it: board one's photograph, and nothing of board two is visible yet
  const before = frameAtPos(project, HANDOFF - 0.01)
  assert.equal(before.scene.pitch, 'bg:one')
  assert.equal(before.scene.board.h, 640)
  assert.equal(before.enterAlpha, 0, 'no arriving asset over the outgoing photograph')
  assert.ok(before.exitAlpha > 0, 'the old board is still fading out on its own ground')

  // at it: both boards' own assets are invisible, so the cut shows neither
  const at = frameAtPos(project, HANDOFF)
  assert.equal(at.exitAlpha, 0)
  assert.equal(at.enterAlpha, 0)
  assert.equal(at.scene.pitch, 'bg:two', 'the ground changes exactly here')
  assert.equal(at.scene.board.h, 450)

  // after it: board two's photograph, and nothing of board one is left
  const after = frameAtPos(project, HANDOFF + 0.01)
  assert.equal(after.scene.pitch, 'bg:two')
  assert.equal(after.exitAlpha, 0, 'no outgoing asset over the arriving photograph')

  // the ground is written once across the whole move, not per frame
  const grounds: string[] = []
  for (let i = 0; i <= 100; i++) {
    const frame = frameAtPos(project, i / 100)
    const pitch = String(frame.scene.pitch)
    if (pitch !== grounds[grounds.length - 1]) grounds.push(pitch)
    if (frame.arriving.size && frame.enterAlpha > 0) assert.equal(pitch, 'bg:two', `arriving over the wrong ground at p=${frame.p}`)
    if (frame.fading.size && frame.exitAlpha > 0) assert.equal(pitch, 'bg:one', `leaving over the wrong ground at p=${frame.p}`)
  }
  assert.deepEqual(grounds, ['bg:one', 'bg:two'], 'one cut, in one direction')

  // an object on both boards keeps travelling right through the handoff
  const path = [0.2, HANDOFF - 0.01, HANDOFF, HANDOFF + 0.01, 0.8].map(p => {
    const obj = frameAtPos(project, p).scene.objects.find(o => o.id === 'stays') as { x: number }
    return obj.x
  })
  for (let i = 1; i < path.length; i++) {
    assert.ok(path[i] > path[i - 1], `the common object keeps moving (${path.join(', ')})`)
  }
  assert.ok(Math.abs(path[2] - path[1]) < 20, 'and does not jump at the cut')
})

test('a player with an arrow to its destination rides the arrow', () => {
  const project = newProject(scene())
  addBoard(project, 0, true)
  const player = { id: 'p', type: 'player', x: 100, y: 100, r: 14, color: '#e02020' }
  const arrow = {
    id: 'a', type: 'arrow', x1: 100, y1: 100, x2: 300, y2: 100,
    mx: 200, my: 0, curved: true, dash: 'solid', color: '#111', width: 6, head: true,
  }
  project.boards[0].scene.objects = [player, arrow] as never
  project.boards[1].scene.objects = [{ ...player, x: 300, y: 100 }] as never

  const half = tweenScene(project.boards[0].scene, project.boards[1].scene, 0.5)
  const at = half.scene.objects.find(o => o.id === 'p') as { x: number; y: number }
  // straight across would leave it on y=100; the arrow bows it well above
  assert.ok(at.y < 60, `the player follows the bend, not the shortcut (y=${at.y})`)
  assert.ok(at.x > 150 && at.x < 250, 'and is halfway along it')
  assert.ok(half.riding.has('a'), 'the arrow is being ridden, so it is not just fading out')
  assert.ok(!half.fading.has('a'), 'a rail keeps its ink while it is the thing being read')

  // both ends are the player's own, so it neither jumps on nor jumps off
  const start = tweenScene(project.boards[0].scene, project.boards[1].scene, 0).scene.objects.find(o => o.id === 'p') as { x: number; y: number }
  const end = tweenScene(project.boards[0].scene, project.boards[1].scene, 1).scene.objects.find(o => o.id === 'p') as { x: number; y: number }
  assert.deepEqual([Math.round(start.x), Math.round(start.y)], [100, 100])
  assert.deepEqual([Math.round(end.x), Math.round(end.y)], [300, 100])

  // and the tip of that arrow is where it lands
  const tip = pointOnArrow(arrow as never, 1)
  assert.deepEqual([Math.round(tip.x), Math.round(tip.y)], [300, 100])
})

test('only a heading names the board, and the note keeps the rest', () => {
  assert.equal(noteHeading('# Back three splits\n\nKeeper steps in.'), 'Back three splits')
  assert.equal(noteBody('# Back three splits\n\nKeeper steps in.'), 'Keeper steps in.')
  // an ordinary opening line is the note, not a name
  assert.equal(noteHeading('Back three splits\n\nKeeper steps in.'), '')
  assert.equal(noteBody('Back three splits\n\nKeeper steps in.'), 'Back three splits\n\nKeeper steps in.')
  // a bare hash is not a heading
  assert.equal(noteHeading('#hashtag'), '')
  assert.equal(noteHeading(''), '')
})

test('a board named by its note heading, and one not named at all', () => {
  const project = newProject(emptyScene('horizontal'))
  project.boards[0].note = '## Third man runs\n\nThe pivot drops.'
  assert.equal(boardName(project, 0), 'Third man runs')
  project.boards[0].note = 'The pivot drops.'
  assert.equal(boardName(project, 0), 'Board 1')
  project.boards[0].title = 'Named by hand'
  assert.equal(boardName(project, 0), 'Named by hand')
})

test('undo takes back only the copies one carry added', () => {
  const start = scene()
  start.objects.push(
    { id: 'first', type: 'ball', x: 10, y: 20, size: 18, flipX: false, flipY: false } as never,
    { id: 'second', type: 'ball', x: 30, y: 40, size: 18, flipX: false, flipY: false } as never,
  )
  const project = newProject(start)
  const target = addBoard(project, 0, false, scene())
  // a target object that was already there keeps its id and is never a copy
  target.scene.objects.push({ id: 'first', type: 'ball', x: 900, y: 900, size: 9, flipX: false, flipY: false } as never)
  target.scene.objects.push({ id: 'own', type: 'ball', x: 5, y: 5, size: 18, flipX: false, flipY: false } as never)

  const result = carryObjects(project, project.boards[0].id, [target.id], 'all')
  assert.deepEqual(result.added, [{ boardId: target.id, objectIds: ['second'] }])
  assert.deepEqual(target.scene.objects.map(object => object.id), ['first', 'own', 'second'])

  assert.equal(undoCarry(project, result.added), 1)
  assert.deepEqual(target.scene.objects.map(object => object.id), ['first', 'own'])
  assert.deepEqual(target.scene.objects.map(object => object.x), [900, 5])
  // the source is untouched, and a second undo has nothing left to take
  assert.deepEqual(project.boards[0].scene.objects.map(object => object.id), ['first', 'second'])
  assert.equal(undoCarry(project, result.added), 0)
  assert.equal(undoCarry(project, [{ boardId: 'missing', objectIds: ['first'] }]), 0)
})
