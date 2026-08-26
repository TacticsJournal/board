import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  applyHomography,
  homographyFromBox,
  homographyFromCorners,
  invertHomography,
  type Pt,
  type Quad,
} from '../src/perspective.ts'

/* A board-shaped element, 800 by 600 CSS pixels, tilted back the way the 3D
   toggle tilts it: the far edge is narrower and higher on screen than the
   near edge, and the whole thing sits at an arbitrary page offset. */
const W = 800
const H = 600
const TRAPEZOID: Quad = [
  { x: 168, y: 92 },   // top-left, receding
  { x: 632, y: 92 },   // top-right, receding
  { x: 792, y: 470 },  // bottom-right, near
  { x: 8, y: 470 },    // bottom-left, near
]

function close(a: Pt | null, b: Pt, tolerance = 1e-6) {
  assert.ok(a, 'expected a mapped point')
  assert.ok(
    Math.hypot(a.x - b.x, a.y - b.y) <= tolerance,
    `expected (${a.x}, ${a.y}) to be within ${tolerance} of (${b.x}, ${b.y})`,
  )
}

test('the forward map puts the box corners on the screen corners', () => {
  const m = homographyFromBox(W, H, TRAPEZOID)
  assert.ok(m)
  const box: Pt[] = [{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: H }, { x: 0, y: H }]
  box.forEach((corner, i) => close(applyHomography(m, corner), TRAPEZOID[i]))
})

test('the inverse map brings screen corners back to box corners', () => {
  const inverse = invertHomography(homographyFromBox(W, H, TRAPEZOID)!)
  assert.ok(inverse)
  const box: Pt[] = [{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: H }, { x: 0, y: H }]
  TRAPEZOID.forEach((corner, i) => close(applyHomography(inverse, corner), box[i], 1e-6))
})

test('interior points survive a round trip through both directions', () => {
  const forward = homographyFromBox(W, H, TRAPEZOID)!
  const inverse = invertHomography(forward)!
  const points: Pt[] = [
    { x: W / 2, y: H / 2 },
    { x: 1, y: 1 },
    { x: W - 1, y: H - 1 },
    { x: 120, y: 480 },
    { x: 640, y: 45 },
    { x: 400, y: 30 },
  ]
  for (const p of points) {
    const screen = applyHomography(forward, p)
    assert.ok(screen)
    close(applyHomography(inverse, screen), p, 1e-6)
  }
})

test('a tilted board is not the even split Konva would have used', () => {
  // The whole reason this module exists: on a trapezoid the centre of the
  // bounding box is not the centre of the board.
  const forward = homographyFromBox(W, H, TRAPEZOID)!
  const centre = applyHomography(forward, { x: W / 2, y: H / 2 })!
  const boxCentre = { x: (8 + 792) / 2, y: (92 + 470) / 2 }
  assert.ok(Math.abs(centre.x - boxCentre.x) < 1e-6) // symmetric left to right
  // Distance compresses towards the far edge, so the halfway line sits well
  // above the middle of the bounding box - the error Konva's even split makes.
  assert.ok(
    centre.y < boxCentre.y - 10,
    `expected the halfway line above the box centre, got ${centre.y} vs ${boxCentre.y}`,
  )
})

test('an untilted rectangle maps exactly like a plain offset and scale', () => {
  const rect: Quad = [
    { x: 40, y: 100 },
    { x: 40 + W / 2, y: 100 },
    { x: 40 + W / 2, y: 100 + H / 2 },
    { x: 40, y: 100 + H / 2 },
  ]
  const inverse = invertHomography(homographyFromBox(W, H, rect)!)!
  close(applyHomography(inverse, { x: 40 + 100, y: 100 + 50 }), { x: 200, y: 100 })
})

test('degenerate corners fail safely instead of guessing', () => {
  const collapsed: Quad = [
    { x: 10, y: 10 }, { x: 10, y: 10 }, { x: 10, y: 10 }, { x: 10, y: 10 },
  ]
  assert.equal(homographyFromBox(W, H, collapsed), null)

  const flat: Quad = [
    { x: 0, y: 50 }, { x: 100, y: 50 }, { x: 200, y: 50 }, { x: 300, y: 50 },
  ]
  assert.equal(homographyFromBox(W, H, flat), null)

  assert.equal(homographyFromBox(0, H, TRAPEZOID), null)
  assert.equal(homographyFromBox(W, 0, TRAPEZOID), null)

  const nan: Quad = [
    { x: Number.NaN, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 },
  ]
  assert.equal(homographyFromBox(W, H, nan), null)
  assert.equal(homographyFromCorners(nan, TRAPEZOID), null)
})

test('a point on the horizon has no finite board position', () => {
  const forward = homographyFromBox(W, H, TRAPEZOID)!
  const inverse = invertHomography(forward)!
  // Walking far past the receding edge crosses the vanishing line, where the
  // projective divide gives up. Somewhere up there the answer must be null or
  // must flip behind the viewer rather than reading as a real board point.
  const far = applyHomography(inverse, { x: 400, y: -4000 })
  assert.ok(far === null || far.y < 0 || far.y > H, 'a point above the horizon must not read as on-pitch')
  assert.equal(applyHomography(forward, { x: Number.POSITIVE_INFINITY, y: 0 }), null)
  assert.equal(invertHomography([0, 0, 0, 0, 0, 0, 0, 0, 1]), null)
})

test('the module stays pure geometry with no DOM of its own', async () => {
  const source = await readFile(new URL('../src/perspective.ts', import.meta.url), 'utf8')
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
  assert.doesNotMatch(code, /document\.|window\.|getBoundingClientRect|^import /m)
})
