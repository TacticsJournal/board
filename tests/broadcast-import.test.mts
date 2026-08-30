// The camera button used to take one image and paint it over the board you
// were on. A pick of several is a set of boards now, so what matters here is
// that the order survives, that a file that will not decode costs only itself,
// and that no object URL is left behind either way.

import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

import { decodeImageFile, importBroadcastShots, shotImportMessage } from '../src/broadcast-import.ts'
import { addBoard, newProject } from '../src/projects.ts'
import { emptyScene } from '../src/types.ts'

const main = await readFile(new URL('../src/main.ts', import.meta.url), 'utf8')
const liveShotSection = main.slice(main.indexOf('/** The browser side of decoding a picked file'), main.indexOf('/* ---------- match settings'))

/** A decoder that hands out URLs and records the ones given back. */
function decoder(load: (url: string) => Promise<unknown>) {
  const created: string[] = []
  const revoked: string[] = []
  let n = 0
  return {
    created,
    revoked,
    create: () => { const url = `blob:${n++}`; created.push(url); return url },
    revoke: (url: string) => { revoked.push(url) },
    load,
  }
}

const file = (name: string) => ({ name }) as unknown as Blob & { name: string }

test('a decoded file gives its object URL back', async () => {
  const env = decoder(async url => ({ url }))
  assert.deepEqual(await decodeImageFile(file('a.png'), env), { url: 'blob:0' })
  assert.deepEqual(env.revoked, env.created)
})

test('a file that will not decode still gives its object URL back', async () => {
  const env = decoder(async () => { throw new Error('image decode failed') })
  await assert.rejects(decodeImageFile(file('a.png'), env))
  assert.deepEqual(env.revoked, env.created)
})

test('every picked image is saved, in the order it was picked', async () => {
  const result = await importBroadcastShots([file('b.png'), file('a.png'), file('c.png')], {
    decode: async f => f,
    save: async (_img, name) => ({ id: `bg:${name}` }),
    name: f => f.name,
  })
  assert.deepEqual(result.saved.map(shot => shot.name), ['b.png', 'a.png', 'c.png'])
  assert.deepEqual(result.saved.map(shot => shot.meta.id), ['bg:b.png', 'bg:a.png', 'bg:c.png'])
  assert.deepEqual(result.failed, [])
})

test('one bad file costs only itself', async () => {
  const env = decoder(async url => (url === 'blob:1' ? Promise.reject(new Error('nope')) : { url }))
  const result = await importBroadcastShots([file('a.png'), file('bad.png'), file('c.png')], {
    decode: f => decodeImageFile(f, env),
    save: async (_img, name) => ({ id: `bg:${name}` }),
    name: f => f.name,
  })
  assert.deepEqual(result.saved.map(shot => shot.name), ['a.png', 'c.png'])
  assert.deepEqual(result.failed, ['bad.png'])
  // three URLs handed out, three handed back: the failure leaks nothing
  assert.equal(env.created.length, 3)
  assert.deepEqual(env.revoked, env.created)
})

test('a quota refusal on one image does not stop the rest', async () => {
  const result = await importBroadcastShots([file('a.png'), file('b.png')], {
    decode: async f => f,
    save: async (_img, name) => { if (name === 'a.png') throw new Error('no room'); return { id: `bg:${name}` } },
    name: f => f.name,
  })
  assert.deepEqual(result.saved.map(shot => shot.name), ['b.png'])
  assert.deepEqual(result.failed, ['a.png'])
})

test('the message says what actually happened', () => {
  const shot = (name: string) => ({ name, meta: {} })
  assert.equal(shotImportMessage({ saved: [shot('a'), shot('b'), shot('c')], failed: [] }), 'Added 3 boards from your images.')
  assert.equal(shotImportMessage({ saved: [shot('a')], failed: [] }), 'Added 1 board from your images.')
  assert.equal(shotImportMessage({ saved: [shot('a')], failed: ['b'] }), 'Added 1 board. 1 image could not be added.')
  assert.equal(shotImportMessage({ saved: [], failed: ['b'] }), 'b could not be added on this device.')
  assert.equal(shotImportMessage({ saved: [], failed: ['b', 'c'] }), 'Those images could not be added on this device.')
})

test('the picked images become boards after the one being edited, in order', () => {
  const project = newProject(emptyScene())
  addBoard(project, 0, false, emptyScene())        // an unrelated board that must survive
  const before = project.boards.map(board => board.id)
  const editing = 0
  let at = editing
  for (const name of ['first', 'second', 'third']) {
    addBoard(project, at, false, emptyScene()).title = name
    at += 1
  }
  assert.deepEqual(project.boards.map(board => board.title), ['', 'first', 'second', 'third', ''])
  assert.equal(project.boards.length, before.length + 3)
  assert.deepEqual([project.boards[0].id, project.boards[4].id], before)
  // the editor lands on the first of the new boards
  assert.equal(project.boards[editing + 1].title, 'first')
})

test('the file button takes more than one image', () => {
  assert.match(main, /<input data-live-file type="file" accept="image\/\*" multiple style="display:none">/)
  assert.match(liveShotSection, /const files = Array\.from\(input\.files \?\? \[\]\)/)
  assert.doesNotMatch(liveShotSection, /trial|featureTrials/)
})

test('one image still changes the board in front of you', () => {
  assert.match(liveShotSection, /if \(files\.length > 1\) \{ void importLiveShots\(files\); return \}/)
  assert.match(liveShotSection, /applyLiveShot\(img, nameFromFile\(file\.name\)\)/)
  assert.match(liveShotSection, /async function applyLiveShot[\s\S]*?useBackground\(await addBackgroundFromImage\(img, name, 'broadcast'\)\)/)
})

test('several images become boards of this project, saved and shown', () => {
  assert.match(liveShotSection, /addBoard\(project, at, false, broadcastShotScene\(shot\.meta\)\)\.title = shot\.name/)
  assert.doesNotMatch(liveShotSection, /newProject|openNewProject/)
  assert.match(liveShotSection, /stashEditedBoard\(\)/)
  assert.match(liveShotSection, /saveProjectChanges\(project\)/)
  assert.match(liveShotSection, /loadBoardIntoEditor\(opened\.scene\)/)
  assert.match(liveShotSection, /showToast\(shotImportMessage\(result\)\)/)
  // named from the file, not "Screenshot" over and over
  assert.match(liveShotSection, /name: file => nameFromFile\(file\.name\)/)
})

test('both paths decode through the one URL-safe helper', () => {
  assert.match(liveShotSection, /decodeImageFile\(file, liveShotDecoder\)/)
  assert.doesNotMatch(liveShotSection, /img\.onerror/)
})
