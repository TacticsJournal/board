import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { pitchById, pitchLines, pitchOrientation, teamCodeStyle } from '../src/pitches.ts'
import { attackAngle, formationSlotPoint, mapPitchPoint, pitchLayout } from '../src/pitch-map.ts'

const main = await readFile(new URL('../src/main.ts', import.meta.url), 'utf8')
const board = await readFile(new URL('../src/board.ts', import.meta.url), 'utf8')

const BOARD_W = 800
const FULL_H = pitchById('full-pitch').boardH

// the 4-4-2 in main.ts, and the half it is squeezed into
const SLOTS = [
  { role: 'gk', x: 0.12, y: 0.5 },
  { role: 'def', x: 0.29, y: 0.16 },
  { role: 'def', x: 0.29, y: 0.38 },
  { role: 'def', x: 0.29, y: 0.62 },
  { role: 'def', x: 0.29, y: 0.84 },
  { role: 'mid', x: 0.54, y: 0.16 },
  { role: 'mid', x: 0.54, y: 0.38 },
  { role: 'mid', x: 0.54, y: 0.62 },
  { role: 'mid', x: 0.54, y: 0.84 },
  { role: 'fwd', x: 0.86, y: 0.35 },
  { role: 'fwd', x: 0.86, y: 0.65 },
]
const START = 0.06, END = 0.46
const depth = (slotX: number, isAway: boolean) => {
  const t = (slotX - 0.12) / (0.86 - 0.12)
  const home = START + t * (END - START)
  return isAway ? 1 - home : home
}
const xi = (isAway: boolean, pitch: string, h: number) =>
  SLOTS.map(s => ({ role: s.role, ...formationSlotPoint(depth(s.x, isAway), s.y, pitch, h) }))

test('the full pitch board is no taller than 3:4, so nothing is cropped on X', async () => {
  // 800 x 1066: a hair wider than 3:4, which is the tallest a timeline shows whole
  assert.equal(FULL_H, 1066)
  assert.ok(BOARD_W / FULL_H > 0.75, String(BOARD_W / FULL_H))

  // and the drawing itself is that shape, so the board is never letterboxed
  const png = await readFile(new URL('../assets/pitch/full_pitch_marked.png', import.meta.url))
  const [w, h] = [png.readUInt32BE(16), png.readUInt32BE(20)]
  assert.equal(Math.round(BOARD_W * h / w), FULL_H)
  assert.ok(w / h >= 0.75, `${w}x${h}`)
})

test('the full pitch has readable built-in object sizes', () => {
  assert.deepEqual(pitchById('full-pitch').defaultSizes, { player: 15, name: 20, label: 23 })
  assert.equal(pitchById('pitch').defaultSizes, undefined)
  assert.match(main, /const sizes = style\.defaultSizes \?\? DEFAULT_OBJECT_SIZES/)
  assert.match(main, /defaults\.playerSize = sizes\.player/)
  assert.match(main, /defaults\.nameSize = sizes\.name/)
  assert.match(main, /defaults\.text\.size = sizes\.label/)
  assert.match(main, /if \(applyPitchStyle\(style\.id\)\) \{ arrowDefaultsLive = !!style\.live; return \}/)
})

test('the full pitch is a whole pitch stood up, and the other boards are unchanged', () => {
  assert.equal(pitchOrientation('full-pitch'), 'vertical-full')
  assert.equal(pitchOrientation('pitch-up'), 'vertical-half')
  assert.equal(pitchOrientation('pitch'), 'horizontal')
  assert.equal(pitchOrientation('sidebyside'), 'sidebyside')
  for (const id of ['training', 'live', 'classic', 'bg:mine', undefined]) {
    assert.equal(pitchOrientation(id), 'horizontal')
  }
  assert.equal(pitchLayout('full-pitch'), 'vertical-full')
})

test('an eleven on the full pitch runs up the board, not across it', () => {
  const home = xi(false, 'full-pitch', FULL_H)
  const away = xi(true, 'full-pitch', FULL_H)
  const lines = pitchLines('full-pitch')!
  const halfway = lines.y[2]

  // home defends the bottom goal, away the top one, and neither crosses over
  assert.ok(home.every(p => p.y > halfway), JSON.stringify(home))
  assert.ok(away.every(p => p.y < halfway), JSON.stringify(away))

  // the goalkeepers stand on their own goal lines, at opposite ends
  const homeGk = home[0], awayGk = away[0]
  assert.ok(homeGk.y > FULL_H * 0.9 && homeGk.y < FULL_H)
  assert.ok(awayGk.y < FULL_H * 0.1 && awayGk.y > 0)
  assert.equal(Math.round(homeGk.x), BOARD_W / 2)
  assert.equal(Math.round(awayGk.x), BOARD_W / 2)

  // the back four is a line across the pitch, in front of its own keeper, and
  // it lands on the penalty box line measured off the drawing
  const backFour = home.filter(p => p.role === 'def')
  assert.equal(new Set(backFour.map(p => Math.round(p.y))).size, 1)
  assert.ok(backFour.every(p => p.y < homeGk.y))
  assert.ok(backFour.every(p => Math.abs(p.y - lines.y[3]) < 10), JSON.stringify(backFour))
  // and the keeper stands in his own goal area, not off the end of the drawing
  assert.ok(homeGk.y > lines.y[3] && homeGk.y < FULL_H)
  assert.ok(awayGk.y < lines.y[1] && awayGk.y > 0)

  // nobody is left on a touchline or parked out at the halfway line
  for (const p of [...home, ...away]) {
    assert.ok(p.x > 40 && p.x < BOARD_W - 40, `on the touchline: ${JSON.stringify(p)}`)
    assert.ok(Math.abs(p.y - halfway) > 20, `stranded at halfway: ${JSON.stringify(p)}`)
  }
})

test('the other boards lay an eleven out exactly as they did', () => {
  for (const [id, h] of [['pitch', 618], ['pitch-up', 640], ['training', 418], ['sidebyside', 533]] as const) {
    for (const isAway of [false, true]) {
      for (const slot of SLOTS) {
        const d = depth(slot.x, isAway)
        assert.deepEqual(formationSlotPoint(d, slot.y, id, h), { x: d * BOARD_W, y: slot.y * h })
      }
    }
  }
})

test('each side faces the goal it is attacking', () => {
  assert.equal(attackAngle('vertical-full', false), 270)
  assert.equal(attackAngle('vertical-full', true), 90)
  for (const layout of ['horizontal', 'vertical-half', 'sidebyside'] as const) {
    assert.equal(attackAngle(layout, false), 0)
    assert.equal(attackAngle(layout, true), 180)
  }
})

test('the corner codes sit at opposite ends of a full pitch, and are readable', () => {
  const full = teamCodeStyle('full-pitch', FULL_H)
  assert.equal(full.awayAtTop, true)
  // the board is fitted to a phone by its height, so the codes grow with it
  assert.equal(full.fontSize, 32)

  for (const [id, h] of [['pitch', 618], ['pitch-up', 640], ['training', 418], ['sidebyside', 533], ['live', 372]] as const) {
    const code = teamCodeStyle(id, h)
    assert.equal(code.awayAtTop, false)
    assert.equal(code.fontSize, 24)
  }
})

test('the board draws both codes from that one rule', () => {
  const overlay = board.slice(board.indexOf('if (m.showTeams) {'), board.indexOf('if (m.showScoreboard && live)'))
  assert.match(overlay, /const \{ fontSize, awayAtTop \} = teamCodeStyle\(scene\.pitch, bh\)/)
  assert.match(overlay, /const top = right && awayAtTop/)
  assert.match(overlay, /const alignRight = right \|\| awayAtTop/)
  assert.match(overlay, /t\.y\(top \? pad : bh - pad - t\.height\(\) - \(right \? awayLift : 0\)\)/)
  // A full pitch keeps both codes on the right, at opposite ends. Other
  // pitches keep the home code on the left and the away code on the right.
  assert.match(overlay, /t\.x\(alignRight \? BOARD_W - pad - t\.width\(\) : pad\)/)
})

test('main places an eleven through the shared pitch map, not its own maths', () => {
  assert.match(main, /const \{ x, y \} = formationPoint\(slot, isAway\)/)
  assert.match(main, /return formationSlotPoint\(formationDepth\(slot\.x, isAway\), slot\.y, store\.scene\.pitch, boardH\(\)\)/)
  assert.match(main, /facing: attackAngle\(isAway\)/)
  assert.match(main, /arms: attackAngle\(isAway\)/)
  assert.doesNotMatch(main, /function mapPitchPoint/)
})

test('switching boards still carries a point over the same way', () => {
  // a full pitch and a horizontal pitch are the same pitch, turned
  const there = mapPitchPoint(700, 100, 'pitch', 618, 'full-pitch', FULL_H)
  const back = mapPitchPoint(there.x, there.y, 'full-pitch', FULL_H, 'pitch', 618)
  assert.equal(Math.round(back.x), 700)
  assert.equal(Math.round(back.y), 100)
  // the half-pitch board keeps its own reading of the same point: this one is
  // in the attacking half, so it survives the trip out and back
  const half = mapPitchPoint(700, 100, 'pitch', 618, 'pitch-up', 640)
  const halfBack = mapPitchPoint(half.x, half.y, 'pitch-up', 640, 'pitch', 618)
  assert.equal(Math.round(halfBack.x), 700)
  assert.equal(Math.round(halfBack.y), 100)
})
