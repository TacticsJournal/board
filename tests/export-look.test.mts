import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { AS_DRAWN, canRestyle, exportLookProject, exportLookScene, isAsDrawn, type CarryPitch } from '../src/export-look.ts'
import { pitchById } from '../src/pitches.ts'
import { makeBoard, type Project } from '../src/projects.ts'
import { emptyScene, sceneIsDark, type Scene, type SceneObj } from '../src/types.ts'

const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8')

/** The editor's carry, reduced to what this module asks of it. */
const carry: CarryPitch = (scene, pitch, h) => { scene.pitch = pitch; scene.board = { w: 800, h } }

function drawn(pitch = 'pitch'): Scene {
  const scene = emptyScene(pitch)
  scene.objects = [
    { id: 'a', type: 'arrow', x1: 10, y1: 10, mx: 20, my: 20, x2: 30, y2: 30, curved: false, dash: 'solid', color: '#111111', width: 4.5, head: true },
    { id: 'b', type: 'arrow', x1: 10, y1: 40, mx: 20, my: 40, x2: 30, y2: 40, curved: false, dash: 'solid', color: '#e02020', width: 4.5, head: true },
  ] as unknown as SceneObj[]
  return scene
}
const colours = (scene: Scene) => scene.objects.map(o => (o as { color: string }).color)

test('an export as drawn is the board as it is', () => {
  assert.equal(isAsDrawn(AS_DRAWN), true)
  assert.equal(isAsDrawn({ pitch: 'pitch-up', paper: 'drawn' }), false)
  assert.equal(isAsDrawn({ pitch: null, paper: 'dark' }), false)
  const project: Project = { id: 'p', name: 'P', boards: [makeBoard(drawn())], updated: 0 }
  assert.equal(exportLookProject(project, AS_DRAWN, carry), project)
})

test('a look is worn by a copy, never by the board', () => {
  const scene = drawn()
  const out = exportLookScene(scene, { pitch: 'pitch-up', paper: 'grass' }, carry)
  assert.equal(out.paper, 'grass')
  assert.equal(out.pitch, 'pitch-up')
  assert.equal(out.board.h, pitchById('pitch-up').boardH)
  assert.equal(sceneIsDark(out), true)
  // the ink that would vanish goes with the paper, and nothing else does
  assert.deepEqual(colours(out), ['#ffffff', '#e02020'])
  assert.equal(scene.pitch, 'pitch')
  assert.equal('dark' in scene, false)
  assert.deepEqual(colours(scene), ['#111111', '#e02020'])
})

test('pitch and paper are chosen apart', () => {
  const dark: Scene = { ...drawn(), paper: 'dark' }
  const light = exportLookScene(dark, { pitch: null, paper: 'white' }, carry)
  assert.equal(light.pitch, 'pitch')
  assert.equal(sceneIsDark(light), false)
  const stoodUp = exportLookScene(dark, { pitch: 'full-pitch', paper: 'drawn' }, carry)
  assert.equal(stoodUp.pitch, 'full-pitch')
  assert.equal(sceneIsDark(stoodUp), true)
  // the pitch it is already on is not a change
  let carried = 0
  exportLookScene(dark, { pitch: 'pitch', paper: 'drawn' }, () => { carried++ })
  assert.equal(carried, 0)
})

test('a board on a photograph is exported as the picture it is on', () => {
  const shot = emptyScene('live')
  assert.equal(canRestyle(shot), false)
  const out = exportLookScene(shot, { pitch: 'pitch-up', paper: 'dark' }, carry)
  assert.equal(out.pitch, 'live')
  assert.equal(sceneIsDark(out), false)
  // and a photograph is never a pitch to export onto
  assert.equal(exportLookScene(drawn(), { pitch: 'live', paper: 'drawn' }, carry).pitch, 'pitch')
})

test('a board whose pitch changes is shown whole', () => {
  const zoomed = makeBoard(drawn())
  zoomed.view = { x: 100, y: 50, w: 400, h: 309 }
  const project: Project = { id: 'p', name: 'P', boards: [zoomed, makeBoard(drawn('pitch-up'))], updated: 0 }
  const out = exportLookProject(project, { pitch: 'pitch-up', paper: 'dark' }, carry)
  assert.deepEqual(out.boards[0].view, { x: 0, y: 0, w: 800, h: pitchById('pitch-up').boardH })
  // one already on that pitch keeps the frame its author gave it
  assert.equal(out.boards[1].view, project.boards[1].view)
  assert.equal(out.boards.every(b => sceneIsDark(b.scene)), true)
  // a change of paper alone moves nothing
  const repapered = exportLookProject(project, { pitch: null, paper: 'dark' }, carry)
  assert.equal(repapered.boards[0].view, zoomed.view)
  assert.equal(project.boards.some(b => sceneIsDark(b.scene)), false)
})

test('the export sheet offers the look, for every kind of export', () => {
  assert.match(main, /data-exp-pitch/)
  assert.match(main, /data-exp-paper/)
  assert.match(main, /exportLookScene\(store\.scene, look, setPitchPreservingLayout\)/)
  assert.match(main, /const styled = \(\) => exportLookProject\(currentProject\(library\), look, setPitchPreservingLayout\)/)
  assert.match(main, /await exportProjectImages\(styled\(\), defaults/)
  assert.match(main, /await exportAnimation\(kind, styled\(\), defaults/)
  // an export as drawn still takes the path it always did
  assert.match(main, /if \(!restyles\(\)\) \{ close\(\); exportPng\(\); return \}/)
})
