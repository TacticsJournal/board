import assert from 'node:assert/strict'
import test from 'node:test'

import { PITCHES, pitchById } from '../src/pitches.ts'
import { mapPitchPoint, remapObjects } from '../src/pitch-map.ts'
import { cornersFromRect, type BoardSizes, type BoxObj, type Pt, type SceneObj } from '../src/types.ts'

/**
 * A shape's place belongs to the pitch; its shape belongs to itself. Our
 * drawings are not all to one scale, so carrying a zone's corners over one at
 * a time used to bend a circle into an oval and shear a turned square into a
 * rhombus. One scale factor and one quarter turn carry the shape instead.
 */
const H: Record<string, number> = Object.fromEntries(PITCHES.map(style => [style.id, style.boardH]))
const IDS = PITCHES.map(style => style.id)
const START = 'pitch'

const newId = () => 'copy'

/** A zone on the centre spot of the horizontal pitch. */
const zone = (w: number, h: number, rotation: number, shape: BoxObj['shape'] = 'rect'): BoxObj => ({
  id: 'z1', type: 'box', shape, x: 400.5, y: 308, w, h, rotation,
  fill: '#9ca3af', opacity: 0.45, labelPos: 'top',
  ...(shape === 'rect' ? { corners: cornersFromRect(400.5, 308, w, h, rotation) } : {}),
})

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

const carry = (o: SceneObj, to: string) =>
  remapObjects([o], START, H[START], to, H[to], newId, settings(START, to))[0] as BoxObj

const away = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y)

/** The inside angle at corner `i`, in degrees. */
function corner(corners: readonly Pt[], i: number) {
  const back = corners[(i + corners.length - 1) % corners.length]
  const on = corners[(i + 1) % corners.length]
  const one = { x: back.x - corners[i].x, y: back.y - corners[i].y }
  const two = { x: on.x - corners[i].x, y: on.y - corners[i].y }
  const cos = (one.x * two.x + one.y * two.y) / (Math.hypot(one.x, one.y) * Math.hypot(two.x, two.y))
  return Math.acos(Math.max(-1, Math.min(1, cos))) * 180 / Math.PI
}

/**
 * A place on the pitch, given as a point on the horizontal board. Everything
 * measured here sits in the attacking half, which is the only half a half
 * pitch draws, so no reading is taken off a clamped point.
 */
const surface = pitchById(START).surface!
const at = (u: number, v: number): Pt => ({
  x: (surface.x[0].min + u * (surface.x[0].max - surface.x[0].min)) * 800,
  y: (surface.y.min + v * (surface.y.max - surface.y.min)) * H[START],
})
const onto = (p: Pt, to: string) => mapPitchPoint(p.x, p.y, START, H[START], to, H[to])

/** Which way the pitch runs on a board, as a unit vector in board px. */
function alongPitch(to: string): Pt {
  const back = onto(at(0.7, 0.5), to)
  const on = onto(at(0.9, 0.5), to)
  const len = away(back, on)
  return { x: (on.x - back.x) / len, y: (on.y - back.y) / len }
}

/** How much of the pitch a zone covers, so two boards can be compared. */
function shareOfPitch(o: BoxObj, on: string) {
  const along = away(onto(at(0.7, 0.5), on), onto(at(0.9, 0.5), on)) / 0.2
  const across = away(onto(at(0.8, 0.4), on), onto(at(0.8, 0.6), on)) / 0.2
  return (o.w * o.h) / (along * across)
}

test('a circle stays a circle on every pitch', () => {
  for (const id of IDS) {
    const round = carry(zone(100, 100, 0, 'ellipse'), id)
    assert.ok(Math.abs(round.w / round.h - 1) < 0.001, `${id}: ${round.w} by ${round.h}`)
  }
})

for (const turned of [0, 45]) {
  test(`a square turned ${turned} degrees stays a square on every pitch`, () => {
    for (const id of IDS) {
      const box = carry(zone(100, 100, turned, 'rect'), id)
      const corners = box.corners!
      assert.equal(corners.length, 4, id)
      const sides = corners.map((c, i) => away(c, corners[(i + 1) % 4]))
      for (const side of sides) {
        assert.ok(Math.abs(side - sides[0]) <= 0.5, `${id}: sides ${sides.map(n => n.toFixed(2)).join(', ')}`)
      }
      for (let i = 0; i < 4; i++) {
        assert.ok(Math.abs(corner(corners, i) - 90) <= 0.5, `${id}: corner ${i} is ${corner(corners, i).toFixed(2)} degrees`)
      }
      assert.ok(Math.abs(box.w / box.h - 1) < 0.001, `${id}: ${box.w} by ${box.h}`)
    }
  })
}

test('a zone lying along the pitch still lies along the pitch', () => {
  const long = zone(240, 60, 0, 'rect')
  for (const id of IDS) {
    const box = carry(long, id)
    const corners = box.corners!
    // the long edge of the zone against the way the pitch runs on that board
    const edge = away(corners[0], corners[1]) > away(corners[1], corners[2])
      ? { x: corners[1].x - corners[0].x, y: corners[1].y - corners[0].y }
      : { x: corners[2].x - corners[1].x, y: corners[2].y - corners[1].y }
    const len = Math.hypot(edge.x, edge.y)
    const pitch = alongPitch(id)
    const across = Math.abs((edge.x / len) * pitch.y - (edge.y / len) * pitch.x)
    assert.ok(across < 0.01, `${id}: the zone lies ${(Math.asin(across) * 180 / Math.PI).toFixed(1)} degrees off the pitch`)
  }
})

test('a zone covers the same share of the pitch it did', () => {
  const start = zone(160, 90, 30, 'rect')
  const home = shareOfPitch(start, START)
  for (const id of IDS) {
    const share = shareOfPitch(carry(start, id), id)
    assert.ok(Math.abs(share / home - 1) < 0.01, `${id}: covers ${(share / home).toFixed(4)} of what it did`)
  }
})

test('and the zone is still standing where it stood on the pitch', () => {
  const start = zone(160, 90, 30, 'rect')
  for (const id of IDS) {
    const box = carry(start, id)
    const want = mapPitchPoint(start.x, start.y, START, H[START], id, H[id])
    assert.ok(away(box, want) <= 0.5, `${id}: ${box.x}, ${box.y} rather than ${want.x}, ${want.y}`)
    // and its corners hang off that point, not off some other one
    const centre = box.corners!.reduce((a, c) => ({ x: a.x + c.x / 4, y: a.y + c.y / 4 }), { x: 0, y: 0 })
    assert.ok(away(centre, box) <= 0.5, `${id}: corners centre on ${centre.x}, ${centre.y}`)
  }
})
