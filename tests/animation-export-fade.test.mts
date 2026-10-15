import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { HANDOFF, addBoard, frameAt, newProject, projectDuration } from '../src/projects.ts'
import { emptyScene } from '../src/types.ts'

const animation = await readFile(new URL('../src/animate-export.ts', import.meta.url), 'utf8')
const board = await readFile(new URL('../src/board.ts', import.meta.url), 'utf8')

/** Board 1 draws an arrow, board 2 deletes it. */
function projectWithDeletedArrow() {
  const project = newProject(emptyScene())
  project.boards[0].scene.objects.push({
    id: 'a1', type: 'arrow',
    x1: 100, y1: 200, mx: 200, my: 150, x2: 300, y2: 200,
    curved: true, dash: 'solid', color: '#111111', width: 4, head: true,
  } as never)
  addBoard(project, 0, true)
  project.boards[1].scene.objects = []
  project.boards[0].link.dur = 1000
  return project
}

test('an object the next board deletes leaves the animated frames', () => {
  const project = projectWithDeletedArrow()
  const start = 700
  const move = 1000

  assert.equal(frameAt(project, 0).fading.size, 0, 'nothing leaves while a board is held')

  let last = 1
  for (let ms = start + 50; ms <= start + move; ms += 50) {
    const frame = frameAt(project, ms)
    assert.ok(frame.fading.has('a1'), 'the deleted arrow is marked as leaving')
    assert.ok(frame.exitAlpha <= last, `the fade only falls (${frame.exitAlpha} after ${last})`)
    last = frame.exitAlpha
  }
  assert.equal(frameAt(project, start + move).exitAlpha, 0, 'gone by the end of the move')
  assert.equal(frameAt(project, projectDuration(project)).scene.objects.length, 0)
})

test('the animation export dims leaving and arriving objects instead of drawing them solid', () => {
  // the frame scene carries them both, so an export that ignores the alphas
  // keeps a deleted arrow at full strength for the whole move
  assert.match(animation, /frame\.fading\.forEach\(id => alpha\.set\(id, frame\.exitAlpha\)\)/)
  assert.match(animation, /frame\.arriving\.forEach\(id => alpha\.set\(id, frame\.enterAlpha\)\)/)
  assert.match(animation, /frame\.riding\.forEach\(id => alpha\.set\(id, frame\.rideAlpha\)\)/)
  assert.match(animation, /toFrameCanvas\(width, coverView\(frame\.view, aspect\), alpha\)/)
  assert.doesNotMatch(animation, /objects: frame\.scene\.objects\.filter/)
})

test('a frame capture puts every opacity it borrowed back', () => {
  assert.match(board, /toFrameCanvas\(\s*width: number,\s*view\?: \{[^}]*\},\s*opacity\?: Map<string, number>,\s*\)/)
  assert.match(board, /dimmed\.push\(\{ node, was: node\.opacity\(\) \}\)/)
  assert.match(board, /for \(const \{ node, was \} of dimmed\) node\.opacity\(was\)/)
})

test('the exported film cuts the photograph where nothing of either board shows', () => {
  // the export reads frameAt, so it takes the same handover the player draws
  const project = newProject(emptyScene())
  project.boards[0].scene.pitch = 'bg:one'
  project.boards[0].scene.objects.push({ id: 'old', type: 'player', x: 100, y: 100, r: 14, color: '#e02020' } as never)
  addBoard(project, 0, true)
  project.boards[1].scene.pitch = 'bg:two'
  project.boards[1].scene.objects = [{ id: 'new', type: 'player', x: 500, y: 100, r: 14, color: '#e02020' }] as never
  project.boards[0].link.dur = 1000
  project.boards[0].link.ease = 'linear'

  const total = projectDuration(project)
  const grounds: string[] = []
  for (let ms = 0; ms <= total; ms += 1000 / 30) {
    const frame = frameAt(project, Math.min(ms, total))
    const pitch = String(frame.scene.pitch)
    if (pitch !== grounds[grounds.length - 1]) grounds.push(pitch)
    if (frame.arriving.size && frame.enterAlpha > 0) assert.equal(pitch, 'bg:two', `arriving over the old photograph at ${ms}ms`)
    if (frame.fading.size && frame.exitAlpha > 0) assert.equal(pitch, 'bg:one', `leaving over the new photograph at ${ms}ms`)
  }
  assert.deepEqual(grounds, ['bg:one', 'bg:two'], 'the photograph is cut once, in one direction')

  // the cut is at the handoff of the move itself, not a hardcoded moment
  const move = 700
  assert.equal(frameAt(project, move + 1000 * HANDOFF - 1).scene.pitch, 'bg:one')
  assert.equal(frameAt(project, move + 1000 * HANDOFF + 1).scene.pitch, 'bg:two')
})
