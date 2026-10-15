import assert from 'node:assert/strict'
import test from 'node:test'

import { PITCHES, pitchById } from '../src/pitches.ts'
import { mapPitchPoint, remapObjects } from '../src/pitch-map.ts'
import { nodeSegments, segmentPoint } from '../src/path-nodes.ts'
import {
  cornersFromRect,
  type ArrowObj, type BoardSizes, type PlayerObj, type SceneObj, type TextObj,
} from '../src/types.ts'

/**
 * A board is not only where its objects stand. The way a player is turned, the
 * path a bent arrow takes and how big everything is all have to make the trip
 * too, or a board arrives in the right places looking wrong.
 *
 * Size is the board's own word rather than the pitch's: each pitch says how
 * big a player, a name, an arrow and a label are, and a piece still standing
 * at the size its board gave it is handed the next board's word instead.
 *
 * The training grid is in here to be sure it keeps working, not to be right:
 * it is a blank rectangle rather than a pitch, and nothing about it is to a
 * football scale.
 */
const H: Record<string, number> = Object.fromEntries(PITCHES.map(style => [style.id, style.boardH]))
const IDS = PITCHES.map(style => style.id)
const START = 'pitch'

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

const move = (objects: readonly SceneObj[], from: string, to: string, sizes = settings(from, to)) =>
  remapObjects(objects, from, H[from], to, H[to], newId, sizes)

/** A bent arrow with a handle dragged by hand, and its ends kept in step. */
function bentArrow(): ArrowObj {
  const points = [
    { x: 160, y: 200 },
    { x: 380, y: 400, c: 'free' as const, h1: { x: -60, y: -20 }, h2: { x: 70, y: 24 } },
    { x: 620, y: 240 },
  ]
  const segs = nodeSegments(points, false)
  const mid = segmentPoint(segs[Math.floor(segs.length / 2)], 0)
  return {
    id: 'a2', type: 'arrow', points,
    x1: points[0].x, y1: points[0].y, x2: points[2].x, y2: points[2].y, mx: mid.x, my: mid.y,
    curved: true, dash: 'dashed', color: '#111111', width: 5, head: true, headSize: 16,
  }
}

/** One of everything a board can hold. */
const everything = (): SceneObj[] => [
  {
    id: 'p1', type: 'player', x: 220, y: 180, r: 13, color: '#e02020', label: '7', name: 'Silva',
    facing: 0, arms: 30, namePos: 'bottom', nameSize: 18, nameDisplay: 'last', rotation: 0,
  },
  { id: 'b1', type: 'ball', x: 400, y: 309, size: 20, rotation: 0 },
  { id: 'c1', type: 'cone', x: 300, y: 420, size: 22, rotation: 0 },
  { id: 'g1', type: 'goal', x: 90, y: 309, size: 120, variant: 'normal', rotation: 0 },
  { id: 'm1', type: 'marker', x: 520, y: 240, w: 54, name: 'GK', namePos: 'bottom', rotation: 0 },
  {
    id: 'a1', type: 'arrow', x1: 120, y1: 460, mx: 300, my: 380, x2: 520, y2: 200,
    curved: false, dash: 'solid', color: '#111111', width: 4, head: true, headSize: 13,
  },
  bentArrow(),
  ...(['rect', 'ellipse', 'triangle', 'outline'] as const).map((shape, i): SceneObj => ({
    id: `z${i}`, type: 'box', shape, x: 260 + i * 90, y: 250, w: 120, h: 70, rotation: 15 * i,
    fill: '#9ca3af', opacity: 0.45, labelPos: 'top',
    ...(shape === 'rect' || shape === 'outline'
      ? { corners: cornersFromRect(260 + i * 90, 250, 120, 70, 15 * i) }
      : {}),
  })),
  { id: 't1', type: 'text', x: 430, y: 150, text: 'Press', size: 23, bold: true, color: '#111111', rotation: 0 },
  { id: 'i1', type: 'image', x: 600, y: 430, size: 90, aspect: 0.6, assetId: 'asset-1', rotation: 0 },
]

/** Every number in an object, by where it sits, so a new field cannot escape. */
function numbers(value: unknown): Record<string, number> {
  const found: Record<string, number> = {}
  const walk = (v: unknown, at: string) => {
    if (typeof v === 'number') { found[at] = v; return }
    if (Array.isArray(v)) { v.forEach((item, i) => walk(item, `${at}[${i}]`)); return }
    if (v && typeof v === 'object') {
      for (const key of Object.keys(v)) walk((v as Record<string, unknown>)[key], at ? `${at}.${key}` : key)
    }
  }
  walk(value, '')
  return found
}

test('every number on every kind of object comes home', () => {
  for (const a of IDS) {
    const home = move(everything(), START, a)
    // the fields really are being read, not an empty list quietly passing
    assert.ok(Object.keys(numbers(home[0])).length >= 8, 'a player carries its numbers')
    for (const b of IDS) {
      if (b === a) continue
      const back = move(move(home, a, b), b, a)
      assert.equal(back.length, home.length, `${a} -> ${b} -> ${a}: object count`)
      back.forEach((o, i) => {
        const want = numbers(home[i])
        const got = numbers(o)
        assert.deepEqual(Object.keys(got).sort(), Object.keys(want).sort(), `${a} -> ${b} -> ${a}: fields on ${o.id}`)
        for (const field of Object.keys(want)) {
          const slack = field.startsWith('onPitch') ? 1e-6 : 0.5
          assert.ok(
            Math.abs(got[field] - want[field]) <= slack,
            `${a} -> ${b} -> ${a}: ${o.id} ${field} came back ${got[field]}, left at ${want[field]}`,
          )
        }
      })
    }
  }
})

test('a player facing the away goal still faces the away goal', () => {
  const player = everything()[0] as PlayerObj
  assert.equal(player.facing, 0, 'he starts pointed at the goal on the right')
  for (const id of IDS) {
    const there = move([player], START, id)[0] as PlayerObj
    const goalward = mapPitchPoint(700, 308, START, H[START], id, H[id])
    const back = mapPitchPoint(500, 308, START, H[START], id, H[id])
    const want = Math.atan2(goalward.y - back.y, goalward.x - back.x) * 180 / Math.PI
    const off = ((there.facing! - want) % 360 + 540) % 360 - 180
    assert.ok(Math.abs(off) < 0.5, `${id}: facing ${there.facing}, the away goal is ${want.toFixed(1)}`)
    // and the arms turned with him, keeping the angle between them
    assert.ok(Math.abs((((there.arms! - there.facing!) % 360) + 360) % 360 - 30) < 0.5, `${id}: arms ${there.arms}`)
  }
})

test('a bent arrow still runs through the same ground, ends and all', () => {
  for (const id of IDS) {
    const arrow = move([bentArrow()], START, id)[0] as ArrowObj
    const path = arrow.points!
    assert.equal(path.length, 3, id)
    assert.ok(Math.hypot(path[0].x - arrow.x1, path[0].y - arrow.y1) < 0.001, `${id}: the path starts where the arrow does`)
    assert.ok(Math.hypot(path[2].x - arrow.x2, path[2].y - arrow.y2) < 0.001, `${id}: the path ends where the arrow does`)
    assert.ok(path[1].h1 && path[1].h2, `${id}: the dragged handles came too`)
    // the middle the older readers use is still a point on the drawn path
    let nearest = Infinity
    for (const seg of nodeSegments(path, false)) {
      for (let step = 0; step <= 40; step++) {
        const p = segmentPoint(seg, step / 40)
        nearest = Math.min(nearest, Math.hypot(p.x - arrow.mx, p.y - arrow.my))
      }
    }
    assert.ok(nearest < 1, `${id}: the middle sits ${nearest.toFixed(2)}px off the path`)
  }
})

test('an image keeps its proportions, which are not the pitch\'s business', () => {
  const image = everything().find(o => o.type === 'image')!
  for (const id of IDS) {
    const there = move([image], START, id)[0] as typeof image
    assert.equal(there.aspect, image.aspect, `${id}: aspect is a ratio, not a length`)
    assert.ok(there.size > 0, id)
  }
})

/** The one pitch with sizes of its own, so adopting them is visible. */
const BIGGER = 'full-pitch'

test('a piece still at its board size is handed the next board size', () => {
  const [player, , , , , plain, bent] = everything()
  const label = everything().find(o => o.type === 'text') as TextObj
  const rule = everything().find(o => o.type === 'arrow' && o.id === 'a1') as ArrowObj
  const measured: ArrowObj = { ...rule, id: 'm2', measure: true, width: sizesFor(START).measure }
  const board = [
    { ...player, r: sizesFor(START).player, nameSize: sizesFor(START).name },
    { ...plain, width: sizesFor(START).arrow },
    measured,
    { ...label, size: sizesFor(START).text },
  ] as SceneObj[]

  const [there, arrow, line, text] = move(board, START, BIGGER) as [PlayerObj, ArrowObj, ArrowObj, TextObj]
  assert.equal(there.r, sizesFor(BIGGER).player)
  assert.equal(there.nameSize, sizesFor(BIGGER).name)
  assert.equal(arrow.width, sizesFor(BIGGER).arrow)
  assert.equal(line.width, sizesFor(BIGGER).measure)
  assert.equal(text.size, sizesFor(BIGGER).text)
  assert.ok(bent, 'the scene really did hold every kind')

  // and it comes home to the size the board it started on gives
  const [home] = move([there], BIGGER, START) as [PlayerObj]
  assert.equal(home.r, sizesFor(START).player)
})

test('a piece the user sized by hand keeps its proportion, not its pixels', () => {
  const player = everything()[0] as PlayerObj
  const big: PlayerObj = { ...player, r: sizesFor(START).player * 1.5, nameSize: sizesFor(START).name * 1.5 }
  const [there] = move([big], START, BIGGER) as [PlayerObj]
  assert.ok(Math.abs(there.r - sizesFor(BIGGER).player * 1.5) < 1e-9, `${there.r}`)
  assert.ok(there.r > sizesFor(BIGGER).player, 'and he is still the bigger player on the bigger board')
  const [home] = move([there], BIGGER, START) as [PlayerObj]
  assert.ok(Math.abs(home.r - big.r) < 1e-9, `came home ${home.r}, left at ${big.r}`)
  assert.ok(Math.abs(home.nameSize - big.nameSize) < 1e-9, `${home.nameSize}`)
})

test('what has no size of its own holds its place among the players', () => {
  const kinds = everything().filter(o => ['ball', 'cone', 'goal', 'marker', 'image'].includes(o.type))
  assert.equal(kinds.length, 5, 'a ball, a cone, a goal, a marker and an image')
  const ratio = sizesFor(BIGGER).player / sizesFor(START).player
  for (const o of move(kinds, START, BIGGER)) {
    const was = kinds.find(k => k.id === o.id)!
    const had = was.type === 'marker' ? was.w : (was as { size: number }).size
    const has = o.type === 'marker' ? o.w : (o as { size: number }).size
    assert.ok(Math.abs(has - had * ratio) < 1e-9, `${o.type}: ${has} rather than ${had * ratio}`)
  }
  // an arrow's head follows its own shaft, which has a setting of its own
  const [arrow] = move([everything()[5]], START, BIGGER) as [ArrowObj]
  assert.equal(arrow.headSize, 13 * (sizesFor(BIGGER).arrow / sizesFor(START).arrow))
})

test('a resize made on the far board wins, and is not undone coming back', () => {
  const player = everything()[0] as PlayerObj
  const [there] = move([player], START, BIGGER) as [PlayerObj]
  assert.equal(there.r, sizesFor(BIGGER).player, 'he took the board size on the way out')
  const resized = { ...there, r: there.r * 2 }
  const [home] = move([resized], BIGGER, START) as [PlayerObj]
  assert.ok(Math.abs(home.r - sizesFor(START).player * 2) < 1e-9, `${home.r}`)
  assert.ok(home.r > sizesFor(START).player, 'the resize was not thrown away')
})

test('the sizes the caller hands in are the sizes that land', () => {
  const odd: BoardSizes = { player: 41, name: 37, arrow: 11, measure: 7, text: 29 }
  const player = everything()[0] as PlayerObj
  const [there] = move([player], START, BIGGER, { from: sizesFor(START), to: odd }) as [PlayerObj]
  assert.equal(there.r, 41, 'a stub or a fallback could not produce this')
  assert.equal(there.nameSize, 37)
  const [ball] = move([everything()[1]], START, BIGGER, { from: sizesFor(START), to: odd }) as [{ size: number }]
  assert.equal(ball.size, 20 * (41 / 13))
})
