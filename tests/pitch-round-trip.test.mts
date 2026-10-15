import assert from 'node:assert/strict'
import test from 'node:test'

import { PITCHES, pitchById } from '../src/pitches.ts'
import { mapPitchPoint, remapObjects } from '../src/pitch-map.ts'
import { migrate, type BoardSizes, type SceneObj } from '../src/types.ts'

/**
 * Changing pitch has to be reversible. A half pitch clamps whatever falls off
 * the end it does not draw, and the two-pitch board copies everything onto its
 * second pitch, so both used to lose something on the way over. Every board
 * here goes out to another pitch and comes back to the coordinates it left on.
 */
const H: Record<string, number> = Object.fromEntries(PITCHES.map(style => [style.id, style.boardH]))
const IDS = PITCHES.map(style => style.id)

let made = 0
const newId = () => `copy${++made}`

/**
 * What each pitch says a player, a name, an arrow, a measurement line and a
 * label are, for someone who has customised nothing. This mirrors pitchSizes
 * in main.ts, which lays a pitch's saved styles over the same fallbacks.
 */
const sizesFor = (id: string): BoardSizes => {
  const built = pitchById(id).defaultSizes ?? { player: 13, name: 18, label: 22 }
  return { player: built.player, name: built.name, arrow: 4.5, measure: 3, text: built.label }
}
const settings = (from: string, to: string) => ({ from: sizesFor(from), to: sizesFor(to) })

const move = (objects: readonly SceneObj[], from: string, to: string) =>
  remapObjects(objects, from, H[from], to, H[to], newId, settings(from, to))

/** One of everything that owns a coordinate: a point, three points, corners. */
const board = (): SceneObj[] => [
  {
    id: 'p1', type: 'player', x: 220, y: 180, r: 13, color: '#e02020', label: '7', name: '',
    namePos: 'bottom', nameSize: 18, nameDisplay: 'last',
  },
  { id: 'b1', type: 'ball', x: 400, y: 309, size: 20 },
  {
    id: 'a1', type: 'arrow', x1: 120, y1: 460, mx: 300, my: 380, x2: 520, y2: 200,
    curved: true, dash: 'solid', color: '#111111', width: 4, head: true, headSize: 13,
  },
  {
    id: 'z1', type: 'box', shape: 'rect', x: 500, y: 120, w: 160, h: 90, rotation: 18,
    fill: '#9ca3af', opacity: 0.45, labelPos: 'top',
    corners: [{ x: 496, y: 128 }, { x: 648, y: 176 }, { x: 620, y: 262 }, { x: 468, y: 214 }],
  },
]

/** Every number an object's shape is made of, in one settled order. */
function coords(o: SceneObj): number[] {
  if (o.type === 'arrow') return [o.x1, o.y1, o.mx, o.my, o.x2, o.y2]
  const out = [o.x, o.y]
  if (o.type === 'box') {
    out.push(o.w, o.h)
    for (const c of o.corners ?? []) out.push(c.x, c.y)
  }
  return out
}

function assertSameShapes(actual: readonly SceneObj[], expected: readonly SceneObj[], what: string) {
  assert.equal(actual.length, expected.length, `${what}: object count`)
  actual.forEach((o, i) => {
    const want = coords(expected[i])
    const got = coords(o)
    assert.equal(o.type, expected[i].type, `${what}: object ${i} type`)
    assert.equal(got.length, want.length, `${what}: object ${i} coordinate count`)
    got.forEach((n, j) => assert.ok(
      Math.abs(n - want[j]) <= 0.5,
      `${what}: object ${i} coordinate ${j} came back ${n.toFixed(3)}, left at ${want[j].toFixed(3)}`,
    ))
  })
}

test('every pitch gives a board back exactly as it took it', () => {
  for (const a of IDS) {
    // a board only ever reaches a style by being carried there, and the
    // two-pitch board is only two pitches because the trip made it two
    const home = move(board(), 'pitch', a)
    for (const b of IDS) {
      if (b === a) continue
      const away = move(home, a, b)
      assertSameShapes(move(away, b, a), home, `${a} -> ${b} -> ${a}`)
    }
  }
})

test('a board carried through three styles still comes home', () => {
  const home = board()
  const one = move(home, 'pitch', 'pitch-up')
  const two = move(one, 'pitch-up', 'sidebyside')
  assert.equal(two.length, home.length * 2, 'the two-pitch board holds both copies')
  assertSameShapes(move(move(two, 'sidebyside', 'pitch'), 'pitch', 'pitch'), home, 'the long way round')
})

test('a half pitch keeps what it cannot show on the board it draws', () => {
  const half = move(board(), 'pitch', 'pitch-up')
  const halfway = pitchById('pitch-up').surface!.y.max * H['pitch-up']
  // the arrow starts in the half this board does not draw, so it is pinned to
  // the halfway line rather than left off the bottom of the board
  const arrow = half.find(o => o.id === 'a1') as Extract<SceneObj, { type: 'arrow' }>
  assert.ok(Math.abs(arrow.y1 - halfway) < 0.5, `pinned to the halfway line: ${arrow.y1}`)
  assert.ok(arrow.onPitch, 'and it still knows where it really was')
  assert.ok(arrow.onPitch!.points[0].u < 0.5, 'in the half this board does not draw')
})

test('moving something on the far board is what comes back, not where it was', () => {
  const home = move(board(), 'pitch', 'full-pitch')
  const moved = home.map(o => (o.id === 'b1' ? { ...o, x: o.x + 120, y: o.y - 200 } : o))
  const back = move(moved, 'full-pitch', 'pitch')
  const ball = back.find(o => o.id === 'b1')!
  const want = mapPitchPoint(moved[1].x, moved[1].y, 'full-pitch', H['full-pitch'], 'pitch', H.pitch)
  assert.ok(Math.abs(ball.x - want.x) <= 0.5 && Math.abs(ball.y - want.y) <= 0.5, `the move carried: ${ball.x}, ${ball.y}`)
  const started = move(board(), 'pitch', 'full-pitch').find(o => o.id === 'b1')!
  assert.ok(Math.abs(ball.x - started.x) > 50, 'and the old place did not come back with it')
})

test('something drawn on the far board carries over on its own coordinates', () => {
  const fresh: SceneObj = { id: 'n1', type: 'ball', x: 480, y: 300, size: 20 }
  const [back] = move([fresh], 'full-pitch', 'pitch')
  const want = mapPitchPoint(fresh.x, fresh.y, 'full-pitch', H['full-pitch'], 'pitch', H.pitch)
  assert.ok(Math.abs(back.x - want.x) <= 0.5 && Math.abs(back.y - want.y) <= 0.5, `${back.x}, ${back.y}`)
  assert.ok(back.onPitch, 'and it leaves with a reading of its own')
})

test('the two-pitch board drops only the copies it made', () => {
  const two = move(board(), 'pitch', 'sidebyside')
  assert.equal(two.length, 8)
  assert.equal(two.filter(o => o.mirrorOf).length, 4)
  assert.equal(move(two, 'sidebyside', 'pitch').length, 4)

  // a copy the user has moved is their own object now, and it stays
  const edited = two.map(o => (o.mirrorOf && o.type === 'ball' ? { ...o, x: o.x + 40 } : o))
  const kept = move(edited, 'sidebyside', 'pitch')
  assert.equal(kept.length, 5)
  assert.equal(kept.filter(o => o.mirrorOf).length, 0, 'and it is nobody\'s copy any more')

  // so is one whose source has been deleted since
  const orphaned = two.filter(o => o.id !== 'b1')
  assert.equal(move(orphaned, 'sidebyside', 'pitch').length, 4)
})

test('a board saved and read back still knows where it stood', () => {
  const carried = move(board(), 'pitch', 'sidebyside')
  const scene = migrate(JSON.parse(JSON.stringify({
    version: 4, board: { w: 800, h: H.sidebyside }, pitch: 'sidebyside', objects: carried,
  })))
  const stashed = scene.objects.find(o => o.id === 'z1')!
  assert.deepEqual(stashed.onPitch, carried.find(o => o.id === 'z1')!.onPitch)
  assert.equal(scene.objects.filter(o => o.mirrorOf).length, 4)
  assertSameShapes(move(scene.objects, 'sidebyside', 'sidebyside'), carried, 'a reloaded board')
  assert.equal(move(scene.objects, 'sidebyside', 'pitch').length, 4)
})

test('a wide object spilling onto the other pitch is still its own object', () => {
  // the far bottom corner of a horizontal pitch is past the left pitch's
  // touchline, so its copy sits in the half the right pitch is drawn in
  const corner: SceneObj[] = [{ id: 'c1', type: 'cone', x: 800, y: 618, size: 22 }]
  const two = move(corner, 'pitch', 'sidebyside')
  assert.ok(two[0].x > 400, `it spills over: ${two[0].x}`)
  assertSameShapes(move(two, 'sidebyside', 'pitch'), corner, 'a spilled object')
  assert.equal(move(two, 'sidebyside', 'pitch').length, 1, 'and its copy is still a copy')
})
