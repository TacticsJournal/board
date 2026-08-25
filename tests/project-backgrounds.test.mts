import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { createBackgroundCache } from '../src/background-cache.ts'

const saves = await readFile(new URL('../src/saves.ts', import.meta.url), 'utf8')
const view = await readFile(new URL('../src/boards-view.ts', import.meta.url), 'utf8')
const main = await readFile(new URL('../src/main.ts', import.meta.url), 'utf8')

const settle = () => new Promise(resolve => setTimeout(resolve))

test('a background is read once and answered from memory after that', async () => {
  const reads: string[] = []
  let arrivals = 0
  const cache = createBackgroundCache(async id => { reads.push(id); return `data:image/jpeg;base64,${id}` }, () => { arrivals++ })

  // the first ask draws nothing and starts one read, however many times it is asked
  assert.equal(cache.get('p1', 'bg:a'), '')
  assert.equal(cache.get('p1', 'bg:a'), '')
  assert.equal(cache.get('p1', 'bg:a'), '')
  await settle()

  assert.deepEqual(reads, ['bg:a'])
  assert.equal(arrivals, 1)
  assert.equal(cache.get('p1', 'bg:a'), 'data:image/jpeg;base64,bg:a')
  // a frame redrawn again does not go back to storage
  cache.get('p1', 'bg:a')
  await settle()
  assert.deepEqual(reads, ['bg:a'])
})

test('the same background in another project is read through that project', async () => {
  const reads: [string, string][] = []
  const cache = createBackgroundCache(async (id, projectId) => { reads.push([id, projectId]); return `${projectId}:${id}` }, () => {})
  cache.get('shared', 'bg:a')
  cache.get('mine', 'bg:a')
  await settle()
  assert.deepEqual(reads, [['bg:a', 'shared'], ['bg:a', 'mine']])
  assert.equal(cache.get('shared', 'bg:a'), 'shared:bg:a')
  assert.equal(cache.get('mine', 'bg:a'), 'mine:bg:a')
})

test('a background that cannot be read fails quietly and is not asked for again', async () => {
  let reads = 0
  let arrivals = 0
  const cache = createBackgroundCache(async () => { reads++; throw new Error('storage is gone') }, () => { arrivals++ })
  assert.equal(cache.get('p1', 'bg:a'), '')
  await settle()
  assert.equal(cache.get('p1', 'bg:a'), '')
  await settle()
  assert.equal(reads, 1)
  // nothing arrived, so nothing was redrawn
  assert.equal(arrivals, 0)
})

test('a cleared cache drops bytes read through the scope it was cleared for', async () => {
  const answers = ['first', 'second']
  const cache = createBackgroundCache(async () => answers.shift() ?? null, () => {})
  cache.get('p1', 'bg:a')
  await settle()
  assert.equal(cache.get('p1', 'bg:a'), 'first')
  cache.clear()
  assert.equal(cache.get('p1', 'bg:a'), '')
  await settle()
  assert.equal(cache.get('p1', 'bg:a'), 'second')
})

test('a read in flight when the cache is cleared is dropped rather than kept', async () => {
  let release: (src: string | null) => void = () => {}
  const cache = createBackgroundCache(() => new Promise<string | null>(resolve => { release = resolve }), () => {})
  cache.get('p1', 'bg:a')
  await settle()
  cache.clear()
  release('stale bytes from the old account')
  await settle()
  assert.equal(cache.get('p1', 'bg:a'), '')
})

test('a scene draws the background bytes handed to it, not the pitch style src', () => {
  assert.match(saves, /export function scenePitchImage\(scene: Scene \| undefined, resolved\?: string \| null\): string/)
  assert.match(saves, /const src = style\.src \|\| \(style\.custom \? resolved \|\| '' : ''\)/)
  assert.match(saves, /return src \? `<image href="\$\{escXml\(src\)\}"/)
  // the preview passes the bytes through rather than dropping them
  assert.match(saves, /export function previewSvg\(scene: Scene \| undefined, resolved\?: string \| null\): string/)
  assert.match(saves, /\$\{scenePitchImage\(scene, resolved\)\}/)
})

test('board cards, the project strip and the player all draw uploaded backgrounds', () => {
  assert.match(view, /import \{ createBackgroundCache \} from '\.\/background-cache'/)
  assert.match(view, /private bg = createBackgroundCache\(\s*\(id, projectId\) => this\.host\.resolveBackground\(id, projectId\)/)
  assert.match(view, /scenePitchImage\(board\.scene, this\.background\(board\.scene, projectId\)\)/)
  // a board card and a strip thumbnail both say which project they belong to
  assert.match(view, /this\.preview\(board, project\.id\)/)
  assert.match(view, /this\.preview\(b, project\.id\)/)
  assert.match(view, /const pitch = scenePitchImage\(frame\.scene, this\.background\(frame\.scene, project\.id\)\)/)
  // the ground is still only rewritten when the markup changes
  assert.match(view, /if \(pitch !== groundFor\) \{ groundFor = pitch; ground\.innerHTML = pitch \}/)
})

test('bytes that arrive later redraw what is already on screen', () => {
  assert.match(view, /private backgroundArrived\(\) \{\s*if \(!this\.root\.hidden\) this\.render\(\)\s*this\.bgWaiting\.forEach\(redraw => redraw\(\)\)/)
  // the player joins the waiting list while it is open and leaves when it closes
  assert.match(view, /const onBackground = \(\) => draw\(\)\s*this\.bgWaiting\.add\(onBackground\)/)
  assert.match(view, /this\.bgWaiting\.delete\(onBackground\)/)
  // and every board's read starts when the player opens
  assert.match(view, /for \(const scene of scenes\) this\.background\(scene, project\.id\)/)
})

test('the host reads shared backgrounds through the shared scope and its own from the shelf', () => {
  assert.match(main, /resolveBackground: \(id, projectId\) => \(\s*sharedBackgroundScope && projectId === sharedBackgroundProjectId\s*\? sharedBackgroundScope\(id\)\s*: backgrounds\.image\(id\)\s*\)/)
  assert.match(main, /sharedBackgroundProjectId = row\.project\.id/)
  // a scope that changes or goes away takes the bytes read through it with it
  assert.match(main, /boardsView\.clearBackgroundCache\(\)/)
})
