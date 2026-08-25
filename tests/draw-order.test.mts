import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { TYPE_Z, migrate, objectsInDrawOrder } from '../src/types.ts'

const boardSource = await readFile(new URL('../src/board.ts', import.meta.url), 'utf8')
const savesSource = await readFile(new URL('../src/saves.ts', import.meta.url), 'utf8')
const storeSource = await readFile(new URL('../src/store.ts', import.meta.url), 'utf8')

test('zones and arrows always render behind players and tactical assets', () => {
  for (const background of ['box', 'arrow'] as const) {
    for (const foreground of ['goal', 'marker', 'cone', 'image', 'player', 'ball', 'text'] as const) {
      assert.ok(TYPE_Z[background] < TYPE_Z[foreground], `${background} must stay behind ${foreground}`)
    }
  }

  const input = [
    { id: 'player', type: 'player' },
    { id: 'goal', type: 'goal' },
    { id: 'arrow-a', type: 'arrow' },
    { id: 'box', type: 'box' },
    { id: 'arrow-b', type: 'arrow' },
    { id: 'image', type: 'image' },
  ] as any[]
  const ordered = objectsInDrawOrder(input)
  assert.deepEqual(ordered.map(object => object.id), ['box', 'arrow-a', 'arrow-b', 'goal', 'image', 'player'])
  assert.deepEqual(input.map(object => object.id), ['player', 'goal', 'arrow-a', 'box', 'arrow-b', 'image'])
})

test('a user-defined arrow legend survives scene normalization', () => {
  const scene = migrate({
    version: 4,
    board: { w: 800, h: 418 },
    pitch: 'training',
    objects: [],
    arrowLegend: { dotted: 'passes', dashed: 'pressing runs', solid: 'supporting runs', ignored: 'no' },
  })
  assert.deepEqual(scene.arrowLegend, { dotted: 'passes', dashed: 'pressing runs', solid: 'supporting runs' })
})

test('the editor and SVG previews enforce tactical draw order', () => {
  assert.match(boardSource, /objectsInDrawOrder\(this\.store\.scene\.objects\)/)
  assert.match(savesSource, /objectsInDrawOrder\(scene\?\.objects \?\? \[\]\)/)
  assert.match(storeSource, /arrowLegend: s\.arrowLegend/)
  assert.equal(storeSource.match(/this\.scene\.arrowLegend = parsed\.arrowLegend/g)?.length, 2)
  assert.equal(storeSource.match(/delete this\.scene\.arrowLegend/g)?.length, 2)
})
