import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  addBoard, boardHeight, boardView, coverView, exportAspect, frameAt, isFullView, migrateProject,
  newProject, projectDuration, viewAfterScene,
} from '../src/projects.ts'
import { BOARD_W, emptyScene } from '../src/types.ts'
import type { Scene } from '../src/types.ts'

const animation = await readFile(new URL('../src/animate-export.ts', import.meta.url), 'utf8')
const main = await readFile(new URL('../src/main.ts', import.meta.url), 'utf8')
const playerView = await readFile(new URL('../src/boards-view.ts', import.meta.url), 'utf8')

/** A broadcast still is as tall as the photograph it was cut from. */
function shotScene(id: string, h: number): Scene {
  const scene = emptyScene()
  scene.pitch = id
  scene.board = { w: BOARD_W, h }
  return scene
}

function player(id: string, x: number, y: number) {
  return { id, type: 'player', x, y, num: '1', name: '', color: '#2f6fed', shape: 'circle', size: 22 }
}

test('a held board is drawn at its own shape, not the project’s tallest', () => {
  // the project from the rejected screenshot: a tall board, then a 16:9 shot
  const project = newProject(shotScene('bg:tall', 640))
  addBoard(project, 0, false, shotScene('bg:wide', 450))
  project.boards[1].scene.objects = [player('p1', 400, 300) as never]

  const total = projectDuration(project)
  const held = frameAt(project, total).view
  assert.deepEqual(held, { x: 0, y: 0, w: BOARD_W, h: 450 })
  assert.equal(held.h / held.w, 450 / BOARD_W, 'the stage is the photograph, with no band under it')

  const first = frameAt(project, 0).view
  assert.deepEqual(first, { x: 0, y: 0, w: BOARD_W, h: 640 }, 'and the tall board is its own shape too')
})

test('a move between two shapes travels through them, never outside them', () => {
  const project = newProject(shotScene('bg:tall', 640))
  addBoard(project, 0, false, shotScene('bg:wide', 450))
  const total = projectDuration(project)
  let seen = 0
  for (let ms = 0; ms <= total; ms += 20) {
    const v = frameAt(project, ms).view
    const aspect = v.h / v.w
    assert.ok(aspect >= 450 / BOARD_W - 1e-9 && aspect <= 640 / BOARD_W + 1e-9,
      'the frame only ever holds a shape between the two boards')
    assert.equal(v.w, BOARD_W, 'the width is the board the whole way')
    if (aspect > 450 / BOARD_W + 1e-9 && aspect < 640 / BOARD_W - 1e-9) seen++
  }
  assert.ok(seen > 0, 'the shape is interpolated across the move, not snapped at one end')
})

test('a project of one shape never changes shape', () => {
  const project = newProject(shotScene('bg:wide', 450))
  addBoard(project, 0, true)
  const total = projectDuration(project)
  const shapes = new Set<string>()
  for (let ms = 0; ms <= total; ms += 25) {
    const v = frameAt(project, ms).view
    shapes.add((v.h / v.w).toFixed(6))
  }
  assert.deepEqual([...shapes], [(450 / BOARD_W).toFixed(6)])
})

test('the player draws the stage and the viewBox from the same view', () => {
  const view = playerView
  // one view for both, so the picture inside can never be stretched by the box
  assert.match(view, /stage\.style\.width = `\$\{w\}px`/)
  assert.match(view, /stage\.style\.height = `\$\{Math\.round\(v\.h \* k\)\}px`/)
  assert.match(view, /svg\.setAttribute\('viewBox', `\$\{v\.x\} \$\{v\.y\} \$\{v\.w\} \$\{v\.h\}`\)/)
  // the photograph is written once and left alone: never decoded per frame
  assert.match(view, /if \(pitch !== groundFor\)/)
})

test('a deliberate zoom keeps its shape and stays inside the board', () => {
  const project = newProject(shotScene('bg:tall', 600))
  const board = project.boards[0]
  board.view = { x: 120, y: 80, w: 400, h: 300 }
  assert.deepEqual(boardView(board), { x: 120, y: 80, w: 400, h: 300 }, 'a valid zoom is left alone')

  board.view = { x: 0, y: 0, w: 1600, h: 1200 }
  const shrunk = boardView(board)
  assert.equal(shrunk.w / shrunk.h, 1600 / 1200, 'an oversized zoom keeps its shape')
  assert.ok(shrunk.w <= BOARD_W && shrunk.h <= 600, 'and fits inside the board')

  board.view = { x: 0, y: 0, w: Number.NaN, h: 0 }
  assert.deepEqual(boardView(board), { x: 0, y: 0, w: BOARD_W, h: 600 }, 'nonsense falls back to the whole board')
})

test('a saved view is only repaired where it cannot be right', () => {
  const project = newProject(emptyScene())
  addBoard(project, 0, false, shotScene('bg:wide', 450))
  addBoard(project, 1, false, shotScene('bg:other', 500))
  const saved = JSON.parse(JSON.stringify(project))
  saved.boards[0].view = { x: 40, y: 20, w: 300, h: 160 }
  // written while the board was still a drawn pitch
  saved.boards[1].view = { x: 0, y: 0, w: BOARD_W, h: 418 }
  // a full-width camera the user framed on purpose, at no pitch's height
  saved.boards[2].view = { x: 0, y: 0, w: BOARD_W, h: 320 }

  const read = migrateProject(saved)!
  assert.deepEqual(read.boards[0].view, { x: 40, y: 20, w: 300, h: 160 }, 'a zoom is not touched')
  assert.equal(read.boards[1].view.h, 450, 'a stale full view follows the background')
  assert.deepEqual(read.boards[2].view, { x: 0, y: 0, w: BOARD_W, h: 320 }, 'a custom camera survives')
})

test('a scene swap moves a full view and leaves a camera alone', () => {
  const project = newProject(shotScene('bg:wide', 450))
  const board = project.boards[0]
  assert.ok(isFullView(board))
  assert.deepEqual(viewAfterScene(board, shotScene('bg:tall', 600)), { x: 0, y: 0, w: BOARD_W, h: 600 })

  board.view = { x: 0, y: 0, w: BOARD_W, h: 320 }
  assert.deepEqual(viewAfterScene(board, shotScene('bg:tall', 600)), { x: 0, y: 0, w: BOARD_W, h: 320 },
    'a camera framed on purpose is kept, even though it spans the width')

  board.view = { x: 100, y: 300, w: 400, h: 140 }
  const kept = viewAfterScene(board, shotScene('bg:short', 380))
  assert.equal(kept.w, 400, 'the camera keeps its shape')
  assert.equal(kept.h, 140)
  assert.ok(kept.y + kept.h <= 380 + 1e-9, 'and slides inside the shorter board')
})

test('the editor writes the view from the scene it is replacing', () => {
  const writes = main.match(/board\.view = viewAfterScene\(board, nextScene\)\n\s*board\.scene = nextScene/g) ?? []
  assert.equal(writes.length, 2, 'both the subscriber and the stash move the view with the scene')
})

test('a drawn pitch is the height of its art, whatever an old scene carries', () => {
  const scene = emptyScene()
  const drawn = boardHeight(scene)
  scene.board = { w: BOARD_W, h: 900 }
  assert.equal(boardHeight(scene), drawn, 'a stale height on a drawn pitch is ignored')
  assert.equal(boardHeight(shotScene('bg:wide', 900)), 900, 'a photograph keeps its own')
})

test('a film takes its shape from the photographs, not the tallest board', () => {
  const project = newProject(emptyScene())            // a drawn pitch, 618 tall
  addBoard(project, 0, false, shotScene('bg:wide', 450))
  addBoard(project, 1, false, shotScene('bg:wide2', 450))
  assert.equal(exportAspect(project), 450 / BOARD_W)

  const drawn = newProject(emptyScene())
  addBoard(drawn, 0, true)
  assert.equal(exportAspect(drawn), boardHeight(drawn.boards[0].scene) / BOARD_W,
    'a project with no photograph is framed by its own boards')
})

test('every frame is cropped to the film, never squashed into it', () => {
  const project = newProject(shotScene('bg:tall', 640))
  addBoard(project, 0, false, shotScene('bg:wide', 450))
  const aspect = exportAspect(project)
  const total = projectDuration(project)
  for (let ms = 0; ms <= total; ms += 25) {
    const view = frameAt(project, ms).view
    const shot = coverView(view, aspect)
    assert.ok(Math.abs(shot.h / shot.w - aspect) < 1e-9, 'the shot is exactly the film’s shape')
    assert.ok(shot.w <= view.w + 1e-9 && shot.h <= view.h + 1e-9, 'it is a crop of the frame, never a pad')
    assert.ok(Math.abs((shot.x + shot.w / 2) - (view.x + view.w / 2)) < 1e-9, 'cropped around the middle')
    assert.ok(Math.abs((shot.y + shot.h / 2) - (view.y + view.h / 2)) < 1e-9)
  }
})

test('a crop wider or taller than the film takes only one side', () => {
  const tall = coverView({ x: 0, y: 0, w: BOARD_W, h: 640 }, 450 / BOARD_W)
  assert.deepEqual(tall, { x: 0, y: (640 - 450) / 2, w: BOARD_W, h: 450 }, 'a taller board loses its edges')

  const wide = coverView({ x: 0, y: 0, w: BOARD_W, h: 450 }, 640 / BOARD_W)
  assert.equal(wide.h, 450, 'a wider board keeps its height')
  assert.equal(wide.w, 450 * BOARD_W / 640, 'and narrows instead of gaining a blank band')
})

test('the export sizes its film once and scales each frame evenly', () => {
  assert.match(animation, /const aspect = exportAspect\(project\)/)
  assert.doesNotMatch(animation, /first\.view/)
  assert.match(animation, /toFrameCanvas\(width, coverView\(frame\.view, aspect\), alpha\)/)
  // one factor for both directions is what makes the drawing uniform
  assert.match(animation, /const k = Math\.max\(width \/ shot\.width, boardH \/ shot\.height\)/)
  assert.match(animation, /shot\.width \* k, shot\.height \* k\)/)
  assert.doesNotMatch(animation, /drawImage\(shot, 0, 0, width, boardH\)/)
})
