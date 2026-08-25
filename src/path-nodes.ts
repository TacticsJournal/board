import type { Pt } from './types.ts'

/**
 * A path node. Zones and arrows are both a list of these: a point, how the
 * line behaves through it, and — once someone has bent it by hand — the two
 * handles that shape the segments either side.
 *
 * `h1` runs back toward the previous node, `h2` on toward the next, both as
 * offsets from the node itself. They are only stored for a `free` node; every
 * other curve derives its handles from the neighbours, so an untouched shape
 * saves exactly what it saved before.
 */
export type NodeCurve = 'corner' | 'smooth' | 'round' | 'free'
export type PathNode = Pt & { c?: NodeCurve; h1?: Pt; h2?: Pt }

/** How far a curve reaches, as a fraction of the span between its neighbours. */
export const CURVE_REACH: Record<NodeCurve, number> = { corner: 0, smooth: 1, round: 1.7, free: 1 }

/** A zone keeps at least a triangle; an arrow keeps at least its two ends. */
export const MIN_NODES = { closed: 3, open: 2 }

export function nodeCurve(n: PathNode): NodeCurve {
  return n.c === 'smooth' || n.c === 'round' || n.c === 'free' ? n.c : 'corner'
}

function at(nodes: PathNode[], i: number, closed: boolean): PathNode {
  if (closed) return nodes[(i + nodes.length) % nodes.length]
  return nodes[Math.max(0, Math.min(nodes.length - 1, i))]
}

/** The two handles for node `i`: stored when free, derived otherwise. */
export function nodeHandles(nodes: PathNode[], i: number, closed: boolean): { h1: Pt; h2: Pt } {
  const n = nodes[i]
  const curve = nodeCurve(n)
  if (curve === 'free' && n.h1 && n.h2) return { h1: { ...n.h1 }, h2: { ...n.h2 } }
  const prev = at(nodes, i - 1, closed)
  const next = at(nodes, i + 1, closed)
  const s = CURVE_REACH[curve] / 6
  const dx = (next.x - prev.x) * s
  const dy = (next.y - prev.y) * s
  return { h1: { x: -dx, y: -dy }, h2: { x: dx, y: dy } }
}

export type NodeSegment = { i: number; a: Pt; b: Pt; c1: Pt; c2: Pt }

/** One cubic per segment, in order. A closed path wraps back to the start. */
export function nodeSegments(nodes: PathNode[], closed: boolean): NodeSegment[] {
  const out: NodeSegment[] = []
  if (nodes.length < 2) return out
  const last = closed ? nodes.length : nodes.length - 1
  for (let i = 0; i < last; i++) {
    const ai = i, bi = (i + 1) % nodes.length
    const a = nodes[ai], b = nodes[bi]
    const ha = nodeHandles(nodes, ai, closed), hb = nodeHandles(nodes, bi, closed)
    out.push({
      i,
      a: { x: a.x, y: a.y },
      b: { x: b.x, y: b.y },
      c1: { x: a.x + ha.h2.x, y: a.y + ha.h2.y },
      c2: { x: b.x + hb.h1.x, y: b.y + hb.h1.y },
    })
  }
  return out
}

export function segmentPoint(s: NodeSegment, t: number): Pt {
  const u = 1 - t
  const k0 = u * u * u, k1 = 3 * u * u * t, k2 = 3 * u * t * t, k3 = t * t * t
  return {
    x: k0 * s.a.x + k1 * s.c1.x + k2 * s.c2.x + k3 * s.b.x,
    y: k0 * s.a.y + k1 * s.c1.y + k2 * s.c2.y + k3 * s.b.y,
  }
}

/** Direction of travel at the end of a segment, for an arrow head. */
export function segmentEndTangent(s: NodeSegment): Pt {
  let tx = s.b.x - s.c2.x, ty = s.b.y - s.c2.y
  if (Math.hypot(tx, ty) < 0.001) { tx = s.b.x - s.c1.x; ty = s.b.y - s.c1.y }
  if (Math.hypot(tx, ty) < 0.001) { tx = s.b.x - s.a.x; ty = s.b.y - s.a.y }
  const len = Math.hypot(tx, ty) || 1
  return { x: tx / len, y: ty / len }
}

type TraceCtx = {
  beginPath(): void
  moveTo(x: number, y: number): void
  bezierCurveTo(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number): void
  closePath?(): void
}

/**
 * Draw the path into a canvas context. `shorten` pulls the far end back along
 * its tangent, which is how an arrow leaves room for its head.
 */
export function traceNodes(ctx: TraceCtx, nodes: PathNode[], closed: boolean, shorten = 0) {
  const segs = nodeSegments(nodes, closed)
  if (!segs.length) return
  ctx.beginPath()
  ctx.moveTo(segs[0].a.x, segs[0].a.y)
  segs.forEach((s, idx) => {
    const isLast = idx === segs.length - 1
    let bx = s.b.x, by = s.b.y
    if (isLast && shorten > 0) {
      const t = segmentEndTangent(s)
      bx -= t.x * shorten
      by -= t.y * shorten
    }
    ctx.bezierCurveTo(s.c1.x, s.c1.y, s.c2.x, s.c2.y, bx, by)
  })
  if (closed) ctx.closePath?.()
}

export type NodeHit = { seg: number; t: number; pt: Pt; dist: number }

/** Nearest point on the drawn line: which segment, where along it, how far. */
export function nearestOnPath(nodes: PathNode[], closed: boolean, p: Pt, steps = 24): NodeHit | null {
  const segs = nodeSegments(nodes, closed)
  let best: NodeHit | null = null
  let bestSeg: NodeSegment | null = null
  for (const s of segs) {
    for (let k = 0; k <= steps; k++) {
      const t = k / steps
      const q = segmentPoint(s, t)
      const dist = Math.hypot(q.x - p.x, q.y - p.y)
      if (!best || dist < best.dist) { best = { seg: s.i, t, pt: q, dist }; bestSeg = s }
    }
  }
  if (!best || !bestSeg) return best
  // The coarse scan gets within a sample; a few narrowing passes put the point
  // where the finger actually was, rather than at the nearest sample to it.
  let span = 1 / steps
  for (let pass = 0; pass < 6; pass++) {
    span /= 2
    for (const t of [best.t - span, best.t + span]) {
      if (t < 0 || t > 1) continue
      const q = segmentPoint(bestSeg, t)
      const dist = Math.hypot(q.x - p.x, q.y - p.y)
      if (dist < best.dist) best = { seg: best.seg, t, pt: q, dist }
    }
  }
  return best
}

/**
 * Put a node on the line where it was tapped. The new node lands on the path
 * itself, so the shape does not jump, and it inherits the curve of the
 * segment it split unless both ends of that segment were corners.
 */
export function insertNodeAt(nodes: PathNode[], hit: NodeHit): number {
  const a = nodes[hit.seg]
  const b = nodes[(hit.seg + 1) % nodes.length]
  const both = nodeCurve(a) === 'corner' && nodeCurve(b) === 'corner'
  const index = hit.seg + 1
  nodes.splice(index, 0, { x: hit.pt.x, y: hit.pt.y, c: both ? 'corner' : 'smooth' })
  return index
}

/** Store node `i`'s handles so they can be dragged instead of derived. */
export function freezeHandles(nodes: PathNode[], i: number, closed: boolean) {
  const n = nodes[i]
  const wasCorner = nodeCurve(n) === 'corner'
  let { h1, h2 } = nodeHandles(nodes, i, closed)
  if (Math.hypot(h2.x, h2.y) < 9) {
    // a corner has no handles to inherit: lay them along the run, so there is
    // something to take hold of the moment the node is tapped
    const prev = at(nodes, i - 1, closed)
    const next = at(nodes, i + 1, closed)
    let vx = next.x - prev.x, vy = next.y - prev.y
    if (Math.hypot(vx, vy) < 0.001) { vx = 1; vy = 0 }
    const m = Math.hypot(vx, vy)
    const reach = Math.max(22, Math.min(48, m / 5))
    h1 = { x: -vx / m * reach, y: -vy / m * reach }
    h2 = { x: vx / m * reach, y: vy / m * reach }
  }
  n.c = 'free'
  n.h1 = h1
  n.h2 = h2
  return wasCorner
}

/** Drop stored handles and go back to a derived curve. */
export function setNodeCurve(nodes: PathNode[], i: number, curve: NodeCurve, closed: boolean) {
  if (curve === 'free') { freezeHandles(nodes, i, closed); return }
  const n = nodes[i]
  n.c = curve
  delete n.h1
  delete n.h2
}

/** The box the drawn path actually occupies, curves included. */
export function nodesBBox(nodes: PathNode[], closed: boolean) {
  const segs = nodeSegments(nodes, closed)
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  const take = (p: Pt) => {
    if (p.x < minX) minX = p.x
    if (p.y < minY) minY = p.y
    if (p.x > maxX) maxX = p.x
    if (p.y > maxY) maxY = p.y
  }
  if (!segs.length) {
    for (const n of nodes) take(n)
  } else {
    for (const s of segs) for (let k = 0; k <= 12; k++) take(segmentPoint(s, k / 12))
  }
  if (minX === Infinity) return { x: 0, y: 0, width: 0, height: 0 }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

/** The same path as an SVG `d`, for the thumbnails and the sequence player. */
export function nodesToSvgPath(nodes: PathNode[], closed: boolean, round = (n: number) => String(Math.round(n * 100) / 100), shorten = 0): string {
  const segs = nodeSegments(nodes, closed)
  if (!segs.length) return ''
  let d = `M ${round(segs[0].a.x)} ${round(segs[0].a.y)}`
  segs.forEach((s, i) => {
    let bx = s.b.x, by = s.b.y
    // an open path can stop short of its last node, the way traceNodes leaves
    // room for an arrow head rather than running the shaft under it
    if (shorten > 0 && !closed && i === segs.length - 1) {
      const t = segmentEndTangent(s)
      bx -= t.x * shorten
      by -= t.y * shorten
    }
    d += ` C ${round(s.c1.x)} ${round(s.c1.y)} ${round(s.c2.x)} ${round(s.c2.y)} ${round(bx)} ${round(by)}`
  })
  return closed ? `${d} Z` : d
}

export function nodesCentroid(nodes: PathNode[]): Pt {
  if (!nodes.length) return { x: 0, y: 0 }
  return {
    x: nodes.reduce((s, n) => s + n.x, 0) / nodes.length,
    y: nodes.reduce((s, n) => s + n.y, 0) / nodes.length,
  }
}

/** Turn a handle by `deg` about the node, for a rotated or flipped object. */
export function transformHandles(n: PathNode, fn: (p: Pt) => Pt) {
  if (n.h1) n.h1 = fn(n.h1)
  if (n.h2) n.h2 = fn(n.h2)
}
