import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { movedObjects, objectCentre, PREVIOUS_BOARD_MOVEMENT_OPACITY, PREVIOUS_BOARD_OPACITY } from '../src/previous-board.ts'

const main = await readFile(new URL('../src/main.ts', import.meta.url), 'utf8')
const board = await readFile(new URL('../src/board.ts', import.meta.url), 'utf8')

const player = (id: string, x: number, y: number) => ({ id, type: 'player', x, y, r: 20, color: '#e02020', rotation: 0 }) as any
const arrow = (id: string, x: number, y: number) => ({
  id, type: 'arrow', x1: x, y1: y, mx: x + 30, my: y + 10, x2: x + 60, y2: y,
  curved: true, dash: 'solid', color: '#111', width: 4, head: true,
}) as any

test('centres cover arrows, corner boxes, and ordinary objects', () => {
  assert.deepEqual(objectCentre(arrow('a', 0, 0)), { x: 30, y: 10 / 3 })
  assert.deepEqual(objectCentre({
    id: 'box', type: 'box', shape: 'outline', x: 0, y: 0, w: 40, h: 40, rotation: 0,
    fill: '#fff', opacity: 0, corners: [{ x: 10, y: 10 }, { x: 30, y: 10 }, { x: 20, y: 30 }],
  } as any), { x: 20, y: 50 / 3 })
  assert.deepEqual(objectCentre(player('p', 8, 9)), { x: 8, y: 9 })
})

test('movement matches id and type, skips removed/new and negligible moves', () => {
  const previous = [player('same', 10, 10), player('removed', 2, 2), arrow('arrow', 0, 0)]
  const current = [player('same', 20, 10), player('added', 2, 2), { ...arrow('arrow', 0, 0), x1: 0.001, mx: 30.001, x2: 60.001 }]
  const moves = movedObjects(previous, current)
  assert.deepEqual(moves.map(move => move.current.id), ['same'])
  assert.equal(moves[0].from.x, 10)
  assert.equal(moves[0].to.x, 20)
})

test('toolbar wiring replaces fit view and keeps the shortcut', () => {
  assert.match(main, /data-top="previous-board"[\s\S]*aria-pressed="false"[\s\S]*disabled/)
  assert.match(main, /previousBoard: svg\([\s\S]*stroke-dasharray/)
  assert.match(main, /k === 'previous-board'\) togglePreviousBoard\(\)/)
  assert.doesNotMatch(main, /data-top="fit"/)
  assert.match(main, /e\.key === 'f' \|\| e\.key === 'F' \|\| e\.key === '0'[\s\S]*board\.resetView\(\)/)
  assert.match(main, /let previousBoardEnabled = false/)
  assert.match(main, /editingBoard - 1\]\?\.scene/)
  assert.match(main, /function loadBoardIntoEditor[\s\S]*?syncPreviousBoard\(\)/)
  assert.match(main, /function saveProjectChanges[\s\S]*?syncPreviousBoard\(\)/)
})

test('previous board layers are local paint below current objects', () => {
  assert.match(board, /previousMovementLayer = new Konva\.Layer\(\{ listening: false/)
  assert.match(board, /previousBoardLayer = new Konva\.Layer\(\{ listening: false/)
  assert.match(board, /this\.stage\.add\(this\.bgLayer, this\.previousMovementLayer, this\.previousBoardLayer,[\s\S]*this\.objLayer/)
  assert.match(board, /opacity\(PREVIOUS_BOARD_OPACITY\)/)
  assert.equal(PREVIOUS_BOARD_OPACITY, 0.22)
  assert.equal(PREVIOUS_BOARD_MOVEMENT_OPACITY, 0.38)
  assert.match(board, /movedObjects\(previous, this\.store\.scene\)/)
})

test('remote preview and captures hide then restore the local aid', () => {
  assert.match(board, /this\.previousBoardLayer\.visible\(false\)[\s\S]*this\.previousMovementLayer\.visible\(false\)/)
  assert.match(board, /remoteLocalPreviousVisibility/)
  assert.match(board, /if \(this\.remotePreviewActive && this\.remoteLocalPreviousVisibility\)[\s\S]*?visible = !!this\.previousScene/)
  assert.match(board, /previousBoardLayer\.visible\(previousVisibility\.board\)/)
  assert.match(board, /previousMovementLayer\.visible\(previousVisibility\.movement\)/)
  assert.match(board, /toFrameCanvas\([\s\S]*previousMovementLayer\.visible\(false\)/)
  assert.match(board, /exportPng\(\)[\s\S]*previousBoardLayer\.visible\(false\)/)
})

test('movement connectors redraw during live object gestures', () => {
  assert.match(board, /private rebuildPreviousMovement\(\)/)
  assert.match(board, /this\.syncSelectionUiDuringMove\(\)\s+this\.rebuildPreviousMovement\(\)/)
  assert.match(board, /obj\.x = g\.x\(\); obj\.y = g\.y\(\)\s+this\.rebuildPreviousMovement\(\)/)
  assert.match(board, /obj\.x = node\.x\(\); obj\.y = node\.y\(\)\s+this\.rebuildPreviousMovement\(\)/)
})
