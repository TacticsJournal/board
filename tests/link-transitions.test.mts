// A link now has a style: a move carries the players, a dissolve blends one
// still into the next, and a cut swaps at once. What matters here is that a
// project written before there was a choice still plays the way it did on the
// same ground and dissolves between stills, that new links start sensibly,
// and that the frames every player and the exported film read draw each
// style the way the Transition sheet describes it.

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DEFAULT_LINK,
  DISSOLVE_IN,
  DISSOLVE_OUT,
  HANDOFF,
  HOLD_MS,
  LINK_DURATIONS,
  addBoard,
  defaultLinkBetween,
  frameAt,
  frameAtPos,
  isDefaultLink,
  linkStyle,
  migrateProject,
  newProject,
  stillGroups,
  transitionPlace,
  tweenScene,
  type Project,
} from '../src/projects.ts'
import { registerWebMcp, type ModelContextTarget, type WebMcpAdapter } from '../src/webmcp.ts'
import { emptyScene, type Scene } from '../src/types.ts'

/** A board on a still of its own (an uploaded background id). */
function still(id: string, objects: unknown[] = []): Scene {
  const scene = emptyScene()
  scene.pitch = id
  scene.board = { w: 800, h: 450 }
  scene.objects = objects as never
  return scene
}
const player = (id: string, x: number, y = 200) => ({ id, type: 'player', x, y, r: 14, color: '#e02020' })

/** Two boards, the same player on both, as a link of `style` joins them. */
function pair(a: Scene, b: Scene, link: Partial<Project['boards'][0]['link']> = {}): Project {
  const project = newProject(a)
  addBoard(project, 0, false, b)
  Object.assign(project.boards[0].link, link)
  return project
}

/* ---------- defaults and old projects ---------- */

test('a link with no style moves on the same ground and dissolves between two stills', () => {
  const pitch = emptyScene()
  assert.equal(linkStyle({ ...DEFAULT_LINK }, pitch, emptyScene()), 'move')
  assert.equal(linkStyle({ ...DEFAULT_LINK }, still('bg:one'), still('bg:one')), 'move', 'two steps on one still')
  assert.equal(linkStyle({ ...DEFAULT_LINK }, still('bg:one'), still('bg:two')), 'dissolve', 'two stills')
  // a drawn pitch to a still is not two moments of a match: it keeps moving, as it always has
  assert.equal(linkStyle({ ...DEFAULT_LINK }, pitch, still('bg:two')), 'move')
  // a chosen style is never second-guessed
  assert.equal(linkStyle({ ...DEFAULT_LINK, style: 'cut' }, still('bg:one'), still('bg:two')), 'cut')
  assert.equal(linkStyle({ ...DEFAULT_LINK, style: 'move' }, still('bg:one'), still('bg:two')), 'move')
})

test('a stored project keeps a valid style, drops a bad one, and plays an old one as before', () => {
  const raw = {
    id: 'p', name: 'Old', updated: 1,
    boards: [
      { id: 'a', title: '', view: { x: 0, y: 0, w: 800, h: 450 }, scene: still('bg:one'), note: '', link: { dur: 1200, ease: 'in-out' } },
      { id: 'b', title: '', view: { x: 0, y: 0, w: 800, h: 450 }, scene: still('bg:two'), note: '', link: { dur: 600, ease: 'out', style: 'cut' } },
      { id: 'c', title: '', view: { x: 0, y: 0, w: 800, h: 450 }, scene: still('bg:two'), note: '', link: { dur: 900, ease: 'linear', style: 'wipe' } },
    ],
  }
  const project = migrateProject(raw)!
  assert.deepEqual(project.boards[0].link, { dur: 1200, ease: 'in-out' }, 'no style is written for an old link')
  assert.deepEqual(project.boards[1].link, { dur: 600, ease: 'out', style: 'cut' })
  assert.deepEqual(project.boards[2].link, { dur: 900, ease: 'linear' }, 'an unknown style is dropped, not guessed')
  // and the old one is read from its boards
  assert.equal(frameAt(project, HOLD_MS + 600).style, 'dissolve')
  // a style survives a round trip through JSON, as sync and saves carry it
  assert.deepEqual(migrateProject(JSON.parse(JSON.stringify(project)))!.boards[1].link.style, 'cut')
})

test('the sheet offers four lengths, and a new link between stills is a short dissolve', () => {
  assert.deepEqual(LINK_DURATIONS, [300, 600, 1200, 2200])
  assert.deepEqual(defaultLinkBetween(still('bg:one'), still('bg:two')), { dur: 600, ease: 'in-out', style: 'dissolve' })
  // the same ground keeps the plain default, which reads as a 1.2s move
  const same = defaultLinkBetween(still('bg:one'), still('bg:one'))
  assert.deepEqual(same, { dur: 1200, ease: 'in-out' })
  assert.equal(linkStyle(same, still('bg:one'), still('bg:one')), 'move')
})

test('adding a still after a still sets the link into it, unless someone chose that link', () => {
  const project = newProject(still('bg:one'))
  addBoard(project, 0, false, still('bg:two'))
  assert.deepEqual(project.boards[0].link, { dur: 600, ease: 'in-out', style: 'dissolve' })

  // a board put between two others takes a link to the board after it
  addBoard(project, 0, true)
  assert.equal(project.boards[1].scene.pitch, 'bg:one')
  assert.equal(linkStyle(project.boards[0].link, project.boards[0].scene, project.boards[1].scene), 'move', 'a step on the same still')
  assert.equal(project.boards[1].link.style, 'dissolve', 'the copy dissolves into the next still')

  // a link someone chose is left alone
  const chosen = newProject(still('bg:one'))
  chosen.boards[0].link = { dur: 2200, ease: 'linear', style: 'cut' }
  addBoard(chosen, 0, false, still('bg:two'))
  assert.deepEqual(chosen.boards[0].link, { dur: 2200, ease: 'linear', style: 'cut' })
  assert.equal(isDefaultLink({ dur: 2200, ease: 'linear', style: 'cut' }), false)
  assert.equal(isDefaultLink({ dur: 1200, ease: 'in-out' }), true)
  assert.equal(isDefaultLink({ dur: 600, ease: 'in-out', style: 'dissolve' }), true)
})

test('the strip groups the steps drawn on one still', () => {
  const project = newProject(still('bg:one'))
  addBoard(project, 0, true)
  addBoard(project, 1, false, still('bg:two'))
  addBoard(project, 2, false, still('bg:three'))
  addBoard(project, 3, true)
  assert.deepEqual(stillGroups(project), [{ start: 0, end: 1 }, { start: 2, end: 2 }, { start: 3, end: 4 }])
})

/* ---------- the frames each style draws ---------- */

test('a move is drawn exactly as before', () => {
  const a = still('bg:one', [player('p', 100)])
  const b = still('bg:one', [player('p', 500)])
  const legacy = tweenScene(a, b, 0.5)
  const move = tweenScene(a, b, 0.5, 'move')
  assert.deepEqual(move, legacy)
  assert.equal(move.blend, null, 'a move never blends two grounds')
  assert.equal((move.scene.objects[0] as { x: number }).x, 300, 'the player travels')
})

test('a cut swaps to the next board the moment the move starts', () => {
  const project = pair(still('bg:one', [player('p', 100)]), still('bg:two', [player('p', 500)]), { style: 'cut', dur: 600 })
  const held = frameAt(project, HOLD_MS - 1)
  assert.equal(held.scene.pitch, 'bg:one')
  const just = frameAt(project, HOLD_MS + 1)
  assert.equal(just.scene.pitch, 'bg:two', 'the next still is there at once')
  assert.equal((just.scene.objects[0] as { x: number }).x, 500, 'nothing travels')
  assert.equal(just.current, 1)
  assert.equal(just.blend, null)
  assert.equal(just.fading.size + just.arriving.size, 0)
  assert.equal(just.noteAlpha, 1, 'the words swap with the board, they do not fade')
  assert.equal(frameAtPos(project, 0.01).scene.pitch, 'bg:two', 'the deck cuts the same way')
})

test('a dissolve blends the grounds and lets nothing travel', () => {
  const project = pair(
    still('bg:one', [player('p', 100), player('gone', 300)]),
    still('bg:two', [player('p', 500), player('new', 700)]),
    { style: 'dissolve', dur: 1000, ease: 'linear' },
  )
  const at = (p: number) => frameAt(project, HOLD_MS + 1000 * p)

  // the outgoing drawings stand still and fade out over the first stretch
  const early = at(0.2)
  assert.equal(early.style, 'dissolve')
  assert.equal(early.scene.pitch, 'bg:one')
  assert.deepEqual(early.scene.objects.map(o => o.id), ['p', 'gone'])
  assert.equal((early.scene.objects[0] as { x: number }).x, 100, 'the shared player does not travel')
  assert.ok(early.fading.has('p') && early.fading.has('gone'), 'every outgoing drawing is leaving, shared or not')
  assert.ok(Math.abs(early.exitAlpha - (1 - 0.2 / DISSOLVE_OUT)) < 1e-9)
  assert.equal(at(DISSOLVE_OUT).exitAlpha, 0, 'gone by the end of the first stretch')

  // the ground crossfades right across: the other still over this one at its share
  assert.equal(early.blend?.scene.pitch, 'bg:two')
  assert.ok(Math.abs(early.blend!.alpha - 0.2) < 1e-9)

  // after the swap the incoming drawings stand where they will be, still hidden
  const late = at(0.5)
  assert.equal(late.scene.pitch, 'bg:two')
  assert.deepEqual(late.scene.objects.map(o => o.id), ['p', 'new'])
  assert.equal((late.scene.objects[0] as { x: number }).x, 500)
  assert.equal(late.enterAlpha, 0, 'nothing arrives before the last stretch')
  assert.equal(late.blend?.scene.pitch, 'bg:one', 'the old still is laid over the new one now')
  assert.ok(Math.abs(late.blend!.alpha - 0.5) < 1e-9)

  const arriving = at(0.8)
  assert.ok(arriving.arriving.has('p') && arriving.arriving.has('new'))
  assert.ok(Math.abs(arriving.enterAlpha - (0.8 - DISSOLVE_IN) / (1 - DISSOLVE_IN)) < 1e-9)
  assert.equal(at(1).enterAlpha, 1)

  // the share of the new still only ever grows: one blend, one direction
  let last = 0
  for (let p = 0.01; p < 1; p += 0.01) {
    const frame = at(p)
    const share = frame.scene.pitch === 'bg:two' ? 1 - (frame.blend?.alpha ?? 0) : frame.blend?.alpha ?? 0
    assert.ok(share >= last - 1e-9, `the blend never turns back (p=${p.toFixed(2)})`)
    last = share
    // and the same id is never drawn twice
    assert.equal(new Set(frame.scene.objects.map(o => o.id)).size, frame.scene.objects.length)
  }
  // held boards are not blended
  assert.equal(frameAt(project, 0).blend, null)
  assert.equal(frameAt(project, HOLD_MS * 2 + 1000).blend, null)
})

test('a move between two stills still hands the ground over once, at the handoff', () => {
  const project = pair(still('bg:one'), still('bg:two'), { style: 'move', dur: 1000, ease: 'linear' })
  assert.equal(frameAt(project, HOLD_MS + 1000 * HANDOFF - 1).scene.pitch, 'bg:one')
  assert.equal(frameAt(project, HOLD_MS + 1000 * HANDOFF + 1).scene.pitch, 'bg:two')
  assert.equal(frameAt(project, HOLD_MS + 500).blend, null)
})

/* ---------- the agent's door ---------- */

function agent() {
  const project = newProject(emptyScene(), 'Plan')
  project.boards[0].id = 'board-a'
  const adapter: WebMcpAdapter = {
    snapshot: () => project,
    revision: () => 'r1',
    editable: () => true,
    activeBoard: () => 'board-a',
    blankScene: () => emptyScene(),
    commit: (next) => { project.boards = next.boards },
  }
  const registered: Record<string, any> = {}
  const target: ModelContextTarget = { registerTool: tool => { registered[tool.name] = tool } }
  registerWebMcp(adapter, target)
  return { project, registered }
}

test('an agent can set a link style, and only one of the three', async () => {
  const { project, registered } = agent()
  await registered.edit_current_project.execute({
    revision: 'r1',
    edits: [{ type: 'update_board', boardId: 'board-a', link: { dur: 600, ease: 'in-out', style: 'dissolve' } }],
  })
  assert.deepEqual(project.boards[0].link, { dur: 600, ease: 'in-out', style: 'dissolve' })
  await assert.rejects(() => registered.edit_current_project.execute({
    revision: 'r1',
    edits: [{ type: 'update_board', boardId: 'board-a', link: { dur: 600, ease: 'in-out', style: 'wipe' } }],
  }), /link\.style must be cut, dissolve, or move/)
  const schema = JSON.stringify(registered.edit_current_project.inputSchema)
  assert.match(schema, /"style":\{"type":"string","enum":\["cut","dissolve","move"\]\}/)
})

test('the sheet names a transition in the strip’s own numbers', () => {
  const project = newProject(still('bg:one'))
  addBoard(project, 0, true)
  addBoard(project, 1, false, still('bg:two'))
  assert.equal(transitionPlace(project, 0), 'Slide 1, step 1 to step 2')
  assert.equal(transitionPlace(project, 1), 'Slide 1 to slide 2')
})
