import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const board = await readFile(new URL('../src/board.ts', import.meta.url), 'utf8')
const pitches = await readFile(new URL('../src/pitches.ts', import.meta.url), 'utf8')

test('the magnet aligns to what is on the board, not to a grid', () => {
  // the old whole magnet was Math.round(p / 10) * 10 and nothing else
  assert.doesNotMatch(board, /const grid = 10/)
  assert.match(board, /private snapTargets\(moving: Set<string>, axis: 'x' \| 'y'\): SnapTarget\[\]/)
  assert.match(board, /private snapMove\(ids: string\[\], box: Box, dx: number, dy: number\)/)
})

test('a token offers its centre and a zone offers its sides', () => {
  // a dot lining up by its bounding box would sit a radius off the man it is
  // meant to be level with
  assert.match(board, /private static EDGED = new Set<SceneObj\['type'\]>\(\['box', 'image'\]\)/)
  assert.match(board, /this\.rectEdges\(r, axis, Board\.EDGED\.has\(obj\.type\)\)/)
})

test('a middle lands on a middle, and a side on a side', () => {
  // a zone dragged over a player caught by whichever side was nearest, which
  // parked an edge through the man instead of centring the shape on him
  assert.match(board, /type SnapRole = 'mid' \| 'edge'/)
  assert.match(board, /const middle: SnapLine = \{ at: mid, role: 'mid' \}/)
  assert.match(board, /return \[\{ at: lo, role: 'edge' \}, middle, \{ at: hi, role: 'edge' \}\]/)
  assert.match(board, /if \(t\.role && t\.role !== role\) continue/)
  // a painted line and an equal gap carry no role, so they take either
  assert.doesNotMatch(board, /kind: 'pitch', role:/)
  assert.doesNotMatch(board, /kind: 'gap', role:/)
})

test('a pair already in line offers the gap that matches', () => {
  assert.match(board, /private spacingTargets\(/)
  // between the pair, and one step past either end of the run
  assert.match(board, /at: \(row\[i\]\.at \+ row\[i \+ 1\]\.at\) \/ 2, kind: 'gap'/)
  assert.match(board, /at: last\.at \+ \(last\.at - prev\.at\), kind: 'gap'/)
})

test('an object beats a gap, and a gap beats a painted line', () => {
  assert.match(board, /SNAP_RANK: Record<SnapKind, number> = \{ object: 0, gap: 1, pitch: 2 \}/)
  // and it beats it outright, not only on a tie: everything under test is
  // already inside the pull, so a painted line a shade nearer was winning
  assert.match(board, /const better = !best\s*\n\s*\|\| rank < Board\.SNAP_RANK\[best\.kind\]\s*\n\s*\|\| \(rank === Board\.SNAP_RANK\[best\.kind\] && d < best\.d\)/)
})

test('the pull is the same at every zoom, and does not chatter', () => {
  assert.match(board, /private snapTolerance\(\) \{ return 8 \/ this\.screenScale\(\) \}/)
  assert.match(board, /private snapRelease\(\) \{ return 10 \/ this\.screenScale\(\) \}/)
  assert.match(board, /const held = this\.snapHold\[axis\]/)
  // a loose point holds the same way, or it shakes between the snap and the
  // pointer at the edge of the threshold
  assert.match(board, /private snapHoldPoint: string \| null = null/)
  assert.match(board, /const keep = held && Math\.abs\(held\.at - p\[axis\]\) <= release/)
})

test('the guides are rebuilt only when they change', () => {
  assert.match(board, /if \(key === this\.snapGuideKey\) return/)
  // and once per move, not once per node in the pick
  assert.match(board, /if \(snapped\) this\.drawSnapGuides\(\)/)
})

test('a pick of several snaps by its own box', () => {
  assert.match(board, /this\.moveArm = \{ ids: uniq, start: p, orig, objs, nodes, began: false, box \}/)
  assert.match(board, /if \(this\.snapEnabled && a\.box\)/)
})

test('the guides are feedback, and leave with the gesture', () => {
  assert.match(board, /private drawSnapGuides\(\)/)
  assert.match(board, /private clearSnapGuides\(\)/)
  // a painted line draws its full length; an alignment draws only what it joins
  assert.match(board, /const full = g\.kind === 'pitch'/)
})

test('each pitch carries the lines measured off its own drawing', () => {
  assert.match(pitches, /export function pitchLines\(id: string \| undefined \| null\): PitchLines \| null/)
  assert.match(pitches, /pitch: \{\s*\n\s*x: \[42, 125, 155, 401, 645, 673, 758\]/)
  // a photograph has no known geometry, so it gets none rather than a guess
  assert.doesNotMatch(pitches, /live: \{ x:/)
})

test('an arrow end lands on a player', () => {
  assert.match(board, /obj\.type !== 'player' && obj\.type !== 'marker' && obj\.type !== 'ball'/)
})

test('editing a shape snaps its nodes to the rest of that shape', () => {
  // shaping is about the shape: a corner squares up with its own corners, not
  // with a player somewhere else on the pitch
  assert.match(board, /private snapToOwnNodes\(p: Pt, nodes: readonly PathNode\[\], index: number\): Pt/)
  assert.match(board, /const target = this\.snapToOwnNodes\(\{ x: orig\.x \+ dx, y: orig\.y \+ dy \}, nodes, parsed\.i\)/)
  assert.match(board, /\.filter\(\(\{ i \}\) => i !== index\)/)
  assert.match(board, /snapped = true\n\s*node\.x = target\.x/)
  // and a point landing on a player draws as a cross on the player
  assert.match(board, /for \(const axis of \['x', 'y'\] as const\) \{\n\s*this\.snapGuides\.push\(\{ axis, at: best\.at\[axis\]/)
})

test('an arrow being drawn snaps as it is drawn', () => {
  assert.match(board, /const ep = this\.snapPoint\(p, new Set\(\[c\.obj\.id\]\)\)/)
})
