import assert from 'node:assert/strict'
import test from 'node:test'

import {
  nodeCurve, nodeHandles, nodeSegments, segmentPoint, nearestOnPath, insertNodeAt,
  freezeHandles, setNodeCurve, nodesBBox, MIN_NODES,
} from '../src/path-nodes.ts'
import { migrate, nodesForShape } from '../src/types.ts'

const square = () => [
  { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 },
]

// A corner is a straight line into and out of the node; anything else reaches
// toward its neighbours. That is the whole curve model.
test('a corner has no reach and a curve has some', () => {
  const nodes = square()
  const corner = nodeHandles(nodes, 1, true)
  assert.deepEqual(corner.h1, { x: -0, y: -0 })
  assert.deepEqual(corner.h2, { x: 0, y: 0 })

  nodes[1].c = 'smooth'
  const smooth = nodeHandles(nodes, 1, true)
  nodes[1].c = 'round'
  const round = nodeHandles(nodes, 1, true)
  assert.ok(Math.hypot(round.h2.x, round.h2.y) > Math.hypot(smooth.h2.x, smooth.h2.y), 'round reaches further than smooth')
  assert.deepEqual(round.h1, { x: -round.h2.x, y: -round.h2.y }, 'a derived curve is symmetric')
})

// A new node has to land on the line it was tapped on, or the shape jumps
// under the finger that added it.
test('a node added to a segment lands on the line', () => {
  const nodes = square()
  const hit = nearestOnPath(nodes, true, { x: 50, y: 3 })!
  assert.equal(hit.seg, 0)
  assert.ok(hit.dist < 4)
  const index = insertNodeAt(nodes, hit)
  assert.equal(index, 1)
  assert.equal(nodes.length, 5)
  assert.equal(Math.round(nodes[1].x), 50)
  assert.equal(Math.round(nodes[1].y), 0)
  assert.equal(nodeCurve(nodes[1]), 'corner', 'splitting two corners gives a corner')
})

// The coarse scan alone puts a node at the nearest sample, which on a long
// segment is a couple of pixels from the finger.
test('the nearest point is refined, not just sampled', () => {
  const nodes = square()
  for (const x of [7, 23.5, 51, 88.25]) {
    const hit = nearestOnPath(nodes, true, { x, y: 0 })!
    assert.ok(Math.abs(hit.pt.x - x) < 0.05, `landed at ${hit.pt.x} for a tap at ${x}`)
  }
})

test('a node added between curves is itself a curve', () => {
  const nodes = square()
  nodes[0].c = 'smooth'
  nodes[1].c = 'smooth'
  const hit = nearestOnPath(nodes, true, { x: 50, y: 0 })!
  insertNodeAt(nodes, hit)
  assert.equal(nodeCurve(nodes[1]), 'smooth')
})

// Dragging a handle stores it; choosing a curve again throws it away.
test('handles are stored only for a free node', () => {
  const nodes = square()
  nodes[1].c = 'smooth'
  const wasCorner = freezeHandles(nodes, 1, true)
  assert.equal(wasCorner, false)
  assert.equal(nodes[1].c, 'free')
  assert.ok(nodes[1].h1 && nodes[1].h2)

  setNodeCurve(nodes, 1, 'round', true)
  assert.equal(nodes[1].c, 'round')
  assert.equal(nodes[1].h1, undefined)
  assert.equal(nodes[1].h2, undefined)
})

// A corner has nothing to inherit, so it is given handles to take hold of.
test('freezing a corner still leaves something to drag', () => {
  const nodes = square()
  const wasCorner = freezeHandles(nodes, 1, true)
  assert.equal(wasCorner, true, 'a corner stays independent on both sides')
  assert.ok(Math.hypot(nodes[1].h2!.x, nodes[1].h2!.y) >= 22)
})

test('a closed path wraps and an open one does not', () => {
  assert.equal(nodeSegments(square(), true).length, 4)
  assert.equal(nodeSegments(square(), false).length, 3)
  assert.equal(MIN_NODES.closed, 3)
  assert.equal(MIN_NODES.open, 2)
})

// The selection box has to hold the drawn curve, not just the node points.
test('the bounding box follows the curve past its nodes', () => {
  const nodes = square()
  const flat = nodesBBox(nodes, true)
  nodes[1].c = 'round'
  const curved = nodesBBox(nodes, true)
  assert.ok(curved.width > flat.width || curved.height > flat.height)
})

// Old saves keep opening, and node paths survive the trip out and back.
test('a saved zone keeps however many nodes it has', () => {
  const nodes = square().map((n, i) => (i === 1 ? { ...n, c: 'free', h1: { x: -10, y: 0 }, h2: { x: 10, y: 0 } } : n))
  nodes.push({ x: -20, y: 50 })
  const scene = migrate({
    version: 4, board: { w: 800, h: 418 }, objects: [
      { id: 'z', type: 'box', shape: 'rect', x: 40, y: 50, w: 100, h: 100, rotation: 0, fill: '#9ca3af', opacity: 0.45, corners: nodes },
    ],
  })
  const box = scene.objects[0] as any
  assert.equal(box.corners.length, 5)
  assert.equal(box.corners[1].c, 'free')
  assert.deepEqual(box.corners[1].h2, { x: 10, y: 0 })
})

test('a free node without handles falls back to a plain corner', () => {
  const scene = migrate({
    version: 4, board: { w: 800, h: 418 }, objects: [
      {
        id: 'z', type: 'box', shape: 'rect', x: 40, y: 50, w: 100, h: 100, rotation: 0, fill: '#9ca3af', opacity: 0.45,
        corners: [{ x: 0, y: 0, c: 'free' }, { x: 10, y: 0 }, { x: 10, y: 10 }],
      },
    ],
  })
  const box = scene.objects[0] as any
  assert.equal(box.corners[0].c, undefined)
})

test('a saved arrow keeps its node path', () => {
  const scene = migrate({
    version: 4, board: { w: 800, h: 418 }, objects: [
      {
        id: 'a', type: 'arrow', x1: 0, y1: 0, mx: 50, my: 20, x2: 100, y2: 0,
        curved: true, dash: 'solid', color: '#111111', width: 4, head: true,
        points: [{ x: 0, y: 0 }, { x: 50, y: 20, c: 'round' }, { x: 100, y: 0 }],
      },
    ],
  })
  const arrow = scene.objects[0] as any
  assert.equal(arrow.points.length, 3)
  assert.equal(arrow.points[1].c, 'round')
})

test('an arrow saved with one point is not a path', () => {
  const scene = migrate({
    version: 4, board: { w: 800, h: 418 }, objects: [
      {
        id: 'a', type: 'arrow', x1: 0, y1: 0, mx: 50, my: 20, x2: 100, y2: 0,
        curved: false, dash: 'solid', color: '#111111', width: 4, head: true,
        points: [{ x: 0, y: 0 }],
      },
    ],
  })
  assert.equal((scene.objects[0] as any).points, undefined)
})

// An oval and a triangle are node paths too: opening the editor on one has to
// change what you can do to it, not how it looks.
test('an oval starts as four nodes on the ellipse', () => {
  const nodes = nodesForShape('ellipse', 100, 50, 200, 100, 0)
  assert.equal(nodes.length, 4)
  assert.deepEqual(nodes.map(n => [n.x, n.y]), [[100, 0], [200, 50], [100, 100], [0, 50]])
  assert.ok(nodes.every(n => n.c === 'free' && n.h1 && n.h2), 'the reach is exact, not derived')
  // every sample sits on the ellipse it stands for
  for (const s of nodeSegments(nodes, true)) {
    for (let k = 1; k < 8; k++) {
      const p = segmentPoint(s, k / 8)
      const r = ((p.x - 100) / 100) ** 2 + ((p.y - 50) / 50) ** 2
      assert.ok(Math.abs(r - 1) < 0.002, `sample off the ellipse: ${r}`)
    }
  }
})

test('a triangle starts as three corners', () => {
  const nodes = nodesForShape('triangle', 100, 50, 200, 100, 0)
  assert.equal(nodes.length, 3)
  assert.deepEqual(nodes.map(n => [n.x, n.y]), [[100, 0], [200, 100], [0, 100]])
  assert.ok(nodes.every(n => n.c === undefined), 'a triangle has no curves to start with')
})

test('a turned shape carries its angle in its nodes', () => {
  const nodes = nodesForShape('ellipse', 0, 0, 200, 100, 90)
  assert.equal(Math.round(nodes[0].x), 50)
  assert.ok(Math.abs(nodes[0].y) < 0.001)
  assert.ok(Math.abs(nodes[0].h2!.x) < 0.001)
  assert.ok(nodes[0].h2!.y > 0, 'the reach turns with the shape')
})

test('a saved oval keeps the nodes it was given', () => {
  const scene = migrate({
    version: 4, board: { w: 800, h: 418 }, objects: [
      {
        id: 'z', type: 'box', shape: 'ellipse', x: 100, y: 50, w: 200, h: 100, rotation: 0,
        fill: '#9ca3af', opacity: 0.45,
        corners: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }],
      },
    ],
  })
  assert.equal((scene.objects[0] as any).corners.length, 4)
})

test('an unedited oval saves no nodes', () => {
  const scene = migrate({
    version: 4, board: { w: 800, h: 418 }, objects: [
      { id: 'z', type: 'box', shape: 'ellipse', x: 100, y: 50, w: 200, h: 100, rotation: 0, fill: '#9ca3af', opacity: 0.45 },
    ],
  })
  assert.equal((scene.objects[0] as any).corners, undefined)
})
