import assert from 'node:assert/strict'
import test from 'node:test'

import { WHOLE_BOARD_SURFACE, pitchById, pitchSurface } from '../src/pitches.ts'
import { mapPitchPoint } from '../src/pitch-map.ts'
import { BOARD_W } from '../src/types.ts'

/**
 * Every background draws its pitch somewhere different inside the board, so a
 * point carries over through the drawn surface rather than through the board
 * rectangle. The lines below were read off the art itself: where the drawings
 * agree, a point on one lands on the same line on the next.
 *
 * The art is not perfectly to scale - a penalty box can sit a couple of board
 * px from where the goal lines say it should - so the lines a drawing really
 * has are checked to 2px and the frame itself to 1px.
 */
const H = { pitch: 618, classic: 418, 'pitch-up': 640, 'full-pitch': 1066, sidebyside: 533 } as const

/** Board px of the lines on the horizontal pitch, the board everything starts on. */
const PITCH = {
  homeGoal: 1.8, awayGoal: 798.2, halfway: 400.5,
  homeBox: 126, awayBox: 673.5,
  topTouch: 54.2, bottomTouch: 561.8, middle: 308,
  topBoxSide: 157.5,
}

const near = (actual: number, expected: number, tol: number, what: string) =>
  assert.ok(Math.abs(actual - expected) <= tol, `${what}: ${actual.toFixed(2)}, wanted ${expected} +/- ${tol}`)

const onto = (x: number, y: number, to: keyof typeof H, side: 0 | 1 = 0) =>
  mapPitchPoint(x, y, 'pitch', H.pitch, to, H[to], side)

test('the same point on the pitch is the same point on a full pitch', () => {
  const halfway = onto(PITCH.halfway, PITCH.middle, 'full-pitch')
  near(halfway.y, 532.5, 1, 'halfway line')
  near(halfway.x, 399.5, 1, 'centre spot across')
  near(onto(PITCH.homeGoal, PITCH.middle, 'full-pitch').y, 1066.4, 1, 'home goal line')
  near(onto(PITCH.awayGoal, PITCH.middle, 'full-pitch').y, -1.4, 1, 'away goal line')
  near(onto(PITCH.halfway, PITCH.topTouch, 'full-pitch').x, -0.2, 1, 'one touchline')
  near(onto(PITCH.halfway, PITCH.bottomTouch, 'full-pitch').x, 799.2, 1, 'the other touchline')
  // and the boxes the drawing actually has line up with the boxes it has
  near(onto(PITCH.homeBox, PITCH.middle, 'full-pitch').y, 898, 2, 'home penalty box')
  near(onto(PITCH.awayBox, PITCH.middle, 'full-pitch').y, 167.5, 2, 'away penalty box')
  near(onto(PITCH.halfway, PITCH.topBoxSide, 'full-pitch').x, 162.5, 2, 'penalty box side')
})

test('the clean classic pitch is the same pitch cropped, not a different one', () => {
  const halfway = onto(PITCH.halfway, PITCH.middle, 'classic')
  near(halfway.x, 400, 1, 'halfway line')
  near(halfway.y, 207.25, 1, 'centre spot across')
  near(onto(PITCH.homeGoal, PITCH.middle, 'classic').x, 1.3, 1, 'home goal line')
  near(onto(PITCH.awayGoal, PITCH.middle, 'classic').x, 797.2, 1, 'away goal line')
  // the classic board is shorter, so its touchlines are off the top and bottom
  near(onto(PITCH.halfway, PITCH.topTouch, 'classic').y, -46.1, 1, 'one touchline')
  near(onto(PITCH.halfway, PITCH.bottomTouch, 'classic').y, 460.6, 1, 'the other touchline')
  near(onto(PITCH.homeBox, PITCH.middle, 'classic').x, 125.5, 2, 'home penalty box')
  near(onto(PITCH.halfway, PITCH.topBoxSide, 'classic').y, 57, 2, 'penalty box side')
})

test('the half pitch matches the half of the pitch it draws', () => {
  near(onto(PITCH.halfway, PITCH.middle, 'pitch-up').y, 599, 1, 'halfway line')
  near(onto(PITCH.halfway, PITCH.middle, 'pitch-up').x, 399.5, 1, 'centre spot across')
  near(onto(PITCH.awayGoal, PITCH.middle, 'pitch-up').y, -7.6, 1, 'away goal line')
  near(onto(PITCH.halfway, PITCH.topTouch, 'pitch-up').x, -1, 1, 'one touchline')
  near(onto(PITCH.halfway, PITCH.bottomTouch, 'pitch-up').x, 800, 1, 'the other touchline')
  near(onto(PITCH.awayBox, PITCH.middle, 'pitch-up').y, 183, 2, 'away penalty box')
  near(onto(PITCH.halfway, PITCH.topBoxSide, 'pitch-up').x, 162, 2, 'penalty box side')
  // the home half is not on this board at all, so it stops at the halfway line
  near(onto(PITCH.homeGoal, PITCH.middle, 'pitch-up').y, 599, 1, 'the far end of a half pitch')
})

test('both pitches on the two-pitch board are the whole pitch', () => {
  const sides: [0 | 1, number, number][] = [[0, 26.5, 363], [1, 436, 772.5]]
  for (const [side, left, right] of sides) {
    near(onto(PITCH.halfway, PITCH.middle, 'sidebyside', side).y, 265.5, 1, `halfway line, side ${side}`)
    near(onto(PITCH.homeGoal, PITCH.middle, 'sidebyside', side).y, 529.6, 1, `home goal line, side ${side}`)
    near(onto(PITCH.awayGoal, PITCH.middle, 'sidebyside', side).y, 3.4, 1, `away goal line, side ${side}`)
    near(onto(PITCH.halfway, PITCH.topTouch, 'sidebyside', side).x, left, 1, `one touchline, side ${side}`)
    near(onto(PITCH.halfway, PITCH.bottomTouch, 'sidebyside', side).x, right, 1, `the other touchline, side ${side}`)
    near(onto(PITCH.homeBox, PITCH.middle, 'sidebyside', side).y, 447, 2, `home penalty box, side ${side}`)
  }
})

/** Points spread over the pitch, including its corners and its margins. */
const TRIP = [
  [PITCH.halfway, PITCH.middle], [PITCH.homeGoal, PITCH.topTouch], [PITCH.awayGoal, PITCH.bottomTouch],
  [PITCH.homeBox, PITCH.topBoxSide], [700, 100], [40, 500], [0, 0], [800, 618],
] as const

test('a point sent to the full pitch and back is where it started', () => {
  for (const [x, y] of TRIP) {
    const there = mapPitchPoint(x, y, 'pitch', H.pitch, 'full-pitch', H['full-pitch'])
    const back = mapPitchPoint(there.x, there.y, 'full-pitch', H['full-pitch'], 'pitch', H.pitch)
    near(back.x, x, 0.5, `x of ${x},${y}`)
    near(back.y, y, 0.5, `y of ${x},${y}`)
  }
})

test('the left copy on the two-pitch board comes home unchanged', () => {
  // the far bottom corner of the board is past the left pitch's touchline, and
  // a two-pitch board reads anything in its right half as the other pitch
  for (const [x, y] of TRIP.filter(([x]) => x < BOARD_W)) {
    const there = mapPitchPoint(x, y, 'pitch', H.pitch, 'sidebyside', H.sidebyside, 0)
    assert.ok(there.x < 400, `the left copy stays on the left pitch: ${there.x}`)
    const back = mapPitchPoint(there.x, there.y, 'sidebyside', H.sidebyside, 'pitch', H.pitch)
    near(back.x, x, 0.5, `x of ${x},${y}`)
    near(back.y, y, 0.5, `y of ${x},${y}`)
  }
})

test('a background nobody has measured is still read as the whole board', () => {
  assert.equal(pitchById('live').surface, undefined)
  assert.deepEqual(pitchSurface('live'), WHOLE_BOARD_SURFACE)
  assert.deepEqual(pitchSurface('bg:someone-elses'), WHOLE_BOARD_SURFACE)
  // so its own corner is its own corner, and the pitch's corner is the pitch's
  assert.deepEqual(mapPitchPoint(400, 186, 'live', 372, 'live', 372), { x: 400, y: 186 })
  const corner = mapPitchPoint(0, 0, 'live', 372, 'pitch', H.pitch)
  near(corner.x, PITCH.homeGoal, 0.5, 'home goal line')
  near(corner.y, PITCH.topTouch, 0.5, 'top touchline')
})
