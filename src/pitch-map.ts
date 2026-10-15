/**
 * Where a point on one pitch lands on another. Everything the app places by
 * itself - a switched-over board, an eleven in formation, which way a side
 * plays - goes through here, so a board only ever has one idea of which way
 * its goals face.
 *
 * The shared frame is the pitch itself: u runs 0 at the home goal to 1 at the
 * away goal, v runs 0 to 1 across the pitch. A point gets there through the
 * surface its own background draws, not through the board rectangle: every
 * drawing leaves a different margin around its pitch, so reading the board as
 * the pitch is what used to walk a player off the touchline on the way over.
 */
import { pitchOrientation, pitchSurface, type PitchOrientation, type PitchSurface } from './pitches.ts'
import { BOARD_W, type BoardSizeName, type BoardSizes, type BoxObj, type PitchMark, type PlayerObj, type Pt, type SceneObj } from './types.ts'
import { transformHandles } from './path-nodes.ts'

export type PitchLayout = PitchOrientation

/** A pitch style id, as a scene holds it: an old board may not name one. */
export type PitchId = string | undefined | null

export const pitchLayout = (id: string | undefined | null): PitchLayout => pitchOrientation(id)

export const clamp01 = (n: number) => Math.max(0, Math.min(1, n))

export const isVerticalLayout = (layout: PitchLayout) => layout !== 'horizontal'

/** A board to read a point off or write one onto: its style and its height. */
type Frame = { pitch: PitchId; layout: PitchLayout; surface: PitchSurface; boardH: number }

const frameOf = (pitch: PitchId, boardH: number): Frame =>
  ({ pitch, layout: pitchOrientation(pitch), surface: pitchSurface(pitch), boardH })

/** Which of the drawn pitches a point is on; only the two pitch board has two. */
const spanX = (f: Frame, side: 0 | 1) => f.surface.x[Math.min(side, f.surface.x.length - 1)]

const sideAt = (f: Frame, x: number): 0 | 1 => (f.layout === 'sidebyside' && x >= BOARD_W / 2 ? 1 : 0)

/** Board px into the shared pitch frame. */
function toCanonical(x: number, y: number, f: Frame, side: 0 | 1) {
  const sx = spanX(f, side)
  const sy = f.surface.y
  const alongX = (x / BOARD_W - sx.min) / (sx.max - sx.min)
  const alongY = (y / f.boardH - sy.min) / (sy.max - sy.min)
  if (f.layout === 'horizontal') return { u: alongX, v: alongY }
  // Half-pitch vertical boards draw only the attacking half of the pitch:
  // their surface runs from the away goal line down to the halfway line, so it
  // covers u 1 down to u 0.5.
  if (f.layout === 'vertical-half') return { u: 1 - alongY / 2, v: alongX }
  return { u: 1 - alongY, v: alongX }
}

/** The shared pitch frame back onto a board. */
function fromCanonical(u: number, v: number, f: Frame, side: 0 | 1) {
  const sx = spanX(f, side)
  const sy = f.surface.y
  const bx = (t: number) => (sx.min + t * (sx.max - sx.min)) * BOARD_W
  const by = (t: number) => (sy.min + t * (sy.max - sy.min)) * f.boardH
  if (f.layout === 'horizontal') return { x: bx(u), y: by(v) }
  if (f.layout === 'vertical-half') return { x: bx(v), y: by(clamp01((1 - u) * 2)) }
  return { x: bx(v), y: by(1 - u) }
}

export function mapPitchPoint(x: number, y: number, from: PitchId, fromH: number, to: PitchId, toH: number, side: 0 | 1 = 0) {
  const src = frameOf(from, fromH)
  const dst = frameOf(to, toH)
  const { u, v } = toCanonical(x, y, src, sideAt(src, x))
  return fromCanonical(u, v, dst, side)
}

/** How many board px one whole pitch is worth, along it and across it. */
function frameScale(f: Frame, side: 0 | 1) {
  const sx = spanX(f, side)
  const xPx = (sx.max - sx.min) * BOARD_W
  const yPx = (f.surface.y.max - f.surface.y.min) * f.boardH
  if (f.layout === 'horizontal') return { u: xPx, v: yPx }
  return { u: f.layout === 'vertical-half' ? yPx * 2 : yPx, v: xPx }
}

/**
 * How much bigger a shape is on the far board, and how far the board turns
 * under it.
 *
 * Where a shape stands belongs to the pitch, but its size and its angle are
 * its own. Our drawings are not all to one scale - a full pitch is squashed an
 * eighth lengthwise, the training grid far more - so stretching a shape along
 * and across the pitch by the two different amounts would bend a circle into
 * an oval and shear a turned square into a rhombus. One factor, the geometric
 * mean of the two, keeps the ground a shape covers honest and leaves the shape
 * itself alone. A quarter turn is the whole of the difference between a board
 * with the pitch across it and a board with the pitch up it, so a shape turns
 * with the board rather than having its w and h swapped, which only ever drew
 * right for a rectangle standing square to the board.
 */
function shapeChange(from: Frame, to: Frame) {
  const src = frameScale(from, 0)
  const dst = frameScale(to, 0)
  const turn = isVerticalLayout(from.layout) === isVerticalLayout(to.layout) ? 0
    : isVerticalLayout(to.layout) ? -90 : 90
  return { scale: Math.sqrt((dst.u / src.u) * (dst.v / src.v)), turn }
}

/** An angle carried round with the board, kept inside one turn of it. */
const aimed = (deg: number, turn: number) => ((deg + turn) % 360 + 360) % 360

/** A quarter turn done by swapping, so going out and back is exact. */
function turned(dx: number, dy: number, turn: number): Pt {
  if (turn === -90) return { x: dy, y: -dx }
  if (turn === 90) return { x: -dy, y: dx }
  return { x: dx, y: dy }
}

/**
 * A formation is written along the pitch, so it is laid out along the pitch:
 * the same slots run left to right on a horizontal board and bottom to top on
 * a full pitch stood up, where the home goal is at the bottom. The half-pitch
 * and side-by-side boards keep the horizontal placement they have always had,
 * because only part of a pitch, or two of them, is on the board.
 */
export function formationSlotPoint(depth: number, across: number, pitch: PitchId, boardH: number) {
  const f = frameOf(pitch, boardH)
  if (f.layout === 'vertical-full') return fromCanonical(depth, across, f, 0)
  return { x: depth * BOARD_W, y: across * boardH }
}

/** Which way a side plays on the board it is on: up the board on a full pitch. */
export function attackAngle(layout: PitchLayout, isAway: boolean) {
  if (layout === 'vertical-full') return isAway ? 90 : 270
  return isAway ? 180 : 0
}

/**
 * Carrying a whole board of objects over to another pitch.
 *
 * Two things used to make the trip one-way. A half pitch has to clamp what
 * falls off the end it does not draw, and a clamped point has forgotten where
 * it came from; and a board on its way to the two-pitch art is copied onto
 * both pitches, so coming back folded two objects onto one spot. So every
 * object carries its own reading of the pitch, and every copy says which
 * object it was made from.
 *
 * Neither note is taken on trust. The reading only stands in for an object's
 * coordinates when replaying it onto the board the object is on now reproduces
 * them, and a copy is only dropped while it still sits exactly where mirroring
 * would have put it. Anyone who moves, resizes or restyles either one breaks
 * the match, and their own work is what carries over.
 */

/** How far apart two board coordinates can be and still be the same one. */
const SAME_PX = 0.01

/** Kept short enough to save, and far finer than anything anyone can drag. */
const mark = (n: number) => Math.round(n * 1e6) / 1e6

/**
 * Every point an object stands on, in board px, in one settled order.
 *
 * An arrow is three places on the pitch rather than a shape, so all three
 * carry over through the surface on their own: an arrow drawn from the corner
 * flag to the penalty spot should still run corner flag to penalty spot,
 * whatever that does to its length. Everything else stands at one point, and
 * whatever it is made of hangs off that point.
 */
function objectPoints(o: SceneObj): Pt[] {
  if (o.type !== 'arrow') return [{ x: o.x, y: o.y }]
  const points: Pt[] = [{ x: o.x1, y: o.y1 }, { x: o.mx, y: o.my }, { x: o.x2, y: o.y2 }]
  // A bent arrow's nodes are places too, and so is the far end of each handle:
  // taking the handles as whole points keeps the drawn curve running through
  // the same ground, and keeps x1/y1/mx/my/x2/y2 true to the path.
  for (const node of o.points ?? []) {
    points.push({ x: node.x, y: node.y })
    if (node.h1) points.push({ x: node.x + node.h1.x, y: node.y + node.h1.y })
    if (node.h2) points.push({ x: node.x + node.h2.x, y: node.y + node.h2.y })
  }
  return points
}

function placeObject(o: SceneObj, points: readonly Pt[]) {
  if (o.type !== 'arrow') {
    o.x = points[0].x; o.y = points[0].y
    return
  }
  o.x1 = points[0].x; o.y1 = points[0].y
  o.mx = points[1].x; o.my = points[1].y
  o.x2 = points[2].x; o.y2 = points[2].y
  let at = 3
  for (const node of o.points ?? []) {
    node.x = points[at].x; node.y = points[at].y; at++
    transformHandles(node, () => {
      const tip = points[at++]
      return { x: tip.x - node.x, y: tip.y - node.y }
    })
  }
}

/**
 * A zone is a piece of the pitch, so it takes the pitch's scale and turn. An
 * angle that means a direction on the pitch turns with the board too. What is
 * left alone: the finishes - a border, a halo, a shadow - because they are the
 * weight of a line rather than the size of a thing, and a line stays readable
 * by staying the weight it was; and the plain `rotation` on everything but a
 * zone, because that one spins the whole drawing, name and letters and all,
 * and a label reading bottom to top after a change of pitch is worse than a
 * caption that no longer lies along the grass.
 */
function reshapeObject(o: SceneObj, was: SceneObj, change: { scale: number; turn: number }) {
  if (o.type === 'box') return reshapeBox(o, was as BoxObj, change.scale, change.turn)
  if (o.type !== 'player') return
  const from = was as PlayerObj
  if (typeof from.facing === 'number') o.facing = aimed(from.facing, change.turn)
  if (typeof from.arms === 'number') o.arms = aimed(from.arms, change.turn)
}

/**
 * Which of a board's sizes each kind of object is handed. A measurement line
 * has its own weight; a zone, a ball and the rest have no setting of their own
 * and follow the players around them.
 */
function sizeNames(o: SceneObj): BoardSizeName[] {
  if (o.type === 'player') return ['player', 'name']
  if (o.type === 'arrow') return [o.measure ? 'measure' : 'arrow']
  if (o.type === 'text') return ['text']
  return []
}

const sizeOn = (o: SceneObj, name: BoardSizeName) =>
  name === 'player' ? (o as PlayerObj).r
    : name === 'name' ? (o as PlayerObj).nameSize
      : name === 'text' ? (o as { size: number }).size
        : (o as { width: number }).width

function putSizeOn(o: SceneObj, name: BoardSizeName, value: number) {
  if (name === 'player') (o as PlayerObj).r = value
  else if (name === 'name') (o as PlayerObj).nameSize = value
  else if (name === 'text') (o as { size: number }).size = value
  else (o as { width: number }).width = value
}

/**
 * How big an object is on the board it lands on.
 *
 * Size is the board's word, not the pitch's: a player is 13px on one pitch and
 * 15px on another because that is what those boards say a player is. So an
 * object still standing at the size its board handed it takes the next board's
 * word outright. One the user has sized by hand keeps the proportion instead
 * of the pixels - half again as big stays half again as big - because keeping
 * the pixels would land a deliberately big player smaller than a plain one on
 * a board that draws its players bigger.
 *
 * Whether it was handed or chosen is not taken on trust. The object carries
 * what it was handed when it arrived, and where that is missing or no longer
 * matches, the board it is leaving is asked what it hands out now.
 */
function carriedSize(had: number, handed: number | undefined, from: number, to: number) {
  const given = (handed !== undefined && Math.abs(had - handed) <= SAME_PX) || Math.abs(had - from) <= SAME_PX
  return given ? to : had * (to / from)
}

/** Every size an object holds, on the board it is going to. */
function resizeToBoard(o: SceneObj, sizes: { from: BoardSizes; to: BoardSizes }, handed?: Partial<BoardSizes>) {
  const names = sizeNames(o)
  for (const name of names) {
    putSizeOn(o, name, carriedSize(sizeOn(o, name), handed?.[name], sizes.from[name], sizes.to[name]))
  }
  // A head is drawn off its own shaft, and a ball, a cone, a goal, a marker
  // and an image have no setting at all, so they hold their place among the
  // players rather than picking up a size of their own.
  const ladder = names[0] ?? 'player'
  const along = sizes.to[ladder] / sizes.from[ladder]
  if (o.type === 'arrow') { if (typeof o.headSize === 'number') o.headSize *= along }
  else if (o.type === 'marker') o.w *= along
  else if (o.type === 'ball' || o.type === 'cone' || o.type === 'goal' || o.type === 'image') o.size *= along
}

/** What the board this object is landing on hands out for its kind. */
function handedSizes(o: SceneObj, to: BoardSizes): Partial<BoardSizes> | undefined {
  const names = sizeNames(o)
  if (!names.length) return undefined
  const handed: Partial<BoardSizes> = {}
  for (const name of names) handed[name] = to[name]
  return handed
}

/** A zone is drawn from its corners, so they are carried with the shape. */
function reshapeBox(o: BoxObj, was: BoxObj, scale: number, turn: number) {
  o.w = was.w * scale
  o.h = was.h * scale
  o.rotation = ((was.rotation + turn) % 360 + 360) % 360
  if (!was.corners) return
  const hang = (dx: number, dy: number) => turned(dx * scale, dy * scale, turn)
  o.corners = was.corners.map(node => {
    const at = hang(node.x - was.x, node.y - was.y)
    return {
      ...node, x: o.x + at.x, y: o.y + at.y,
      ...(node.h1 ? { h1: hang(node.h1.x, node.h1.y) } : {}),
      ...(node.h2 ? { h2: hang(node.h2.x, node.h2.y) } : {}),
    }
  })
}

const samePlace = (a: readonly Pt[], b: readonly Pt[]) =>
  a.length === b.length && a.every((p, i) => Math.abs(p.x - b[i].x) <= SAME_PX && Math.abs(p.y - b[i].y) <= SAME_PX)

const onBoard = (points: readonly PitchMark[], f: Frame, side: 0 | 1) =>
  points.map(p => fromCanonical(p.u, p.v, f, side))

/** Everything about an object except which one it is and where it stands. */
function mirrorLook(o: SceneObj): string {
  const rest = { ...o } as Record<string, unknown>
  for (const key of ['id', 'mirrorOf', 'onPitch', 'group', 'x', 'y', 'x1', 'y1', 'mx', 'my', 'x2', 'y2', 'corners', 'points']) {
    delete rest[key]
  }
  return JSON.stringify(rest)
}

/**
 * The object's own reading of the pitch, and which of the drawn pitches it is
 * standing on. The reading only holds while replaying it puts the object back
 * where it is; anything else means the object has been moved since. A wide
 * object can spill past its own touchline into the other half of the two-pitch
 * board, so the side it looks like it is on is only the first guess.
 */
function readObject(o: SceneObj, f: Frame): { marks: PitchMark[]; side: 0 | 1 } {
  const points = objectPoints(o)
  const guess = sideAt(f, points[0].x)
  const stash = o.onPitch
  if (stash && stash.pitch === f.pitch && stash.points.length === points.length) {
    for (const side of [guess, (1 - guess) as 0 | 1]) {
      if (samePlace(onBoard(stash.points, f, side), points)) return { marks: stash.points, side }
    }
  }
  return {
    side: guess,
    marks: points.map(p => {
      const { u, v } = toCanonical(p.x, p.y, f, guess)
      return { u: mark(u), v: mark(v) }
    }),
  }
}

/** The object as the far board holds it, with a fresh reading of the pitch. */
function carryObject<T extends SceneObj>(obj: T, marks: readonly PitchMark[], to: Frame, side: 0 | 1, from: Frame, sizes: { from: BoardSizes; to: BoardSizes }, id?: string): T {
  const handed = obj.onPitch?.pitch === from.pitch ? obj.onPitch?.sizes : undefined
  const o = JSON.parse(JSON.stringify(obj)) as T
  if (id) o.id = id
  placeObject(o, onBoard(marks, to, side))
  reshapeObject(o, obj, shapeChange(from, to))
  resizeToBoard(o, sizes, handed)
  const gave = handedSizes(o, sizes.to)
  if (to.pitch) o.onPitch = { pitch: to.pitch, points: [...marks], ...(gave ? { sizes: gave } : {}) }
  else delete o.onPitch
  delete o.mirrorOf
  return o
}

/**
 * A board's objects on the pitch it is moving to. Copies onto the second
 * pitch of the two-pitch art get a new id from `newId`, and the copies made
 * that way are dropped again on the way back out.
 */
export function remapObjects(
  objects: readonly SceneObj[],
  from: PitchId, fromH: number, to: PitchId, toH: number,
  newId: () => string,
  sizes: { from: BoardSizes; to: BoardSizes },
): SceneObj[] {
  const src = frameOf(from, fromH)
  const dst = frameOf(to, toH)
  const sides = new Map<string, 0 | 1>()
  const marks = new Map<string, PitchMark[]>()
  for (const o of objects) {
    const read = readObject(o, src)
    sides.set(o.id, read.side)
    marks.set(o.id, read.marks)
  }

  const leaving = src.layout === 'sidebyside' && dst.layout !== 'sidebyside'
  const stale = (o: SceneObj) => {
    if (!leaving || !o.mirrorOf || sides.get(o.id) !== 1) return false
    const source = objects.find(other => other.id === o.mirrorOf)
    if (!source || sides.get(source.id) !== 0 || mirrorLook(source) !== mirrorLook(o)) return false
    return samePlace(onBoard(marks.get(source.id)!, src, 1), objectPoints(o))
  }

  // between two-pitch boards an object stays on the pitch it is already on
  const holds = src.layout === 'sidebyside' && dst.layout === 'sidebyside'
  const kept = objects.filter(o => !stale(o))
  const one = kept.map(o => {
    const carried = carryObject(o, marks.get(o.id)!, dst, holds ? sides.get(o.id)! : 0, src, sizes)
    if (holds && o.mirrorOf) carried.mirrorOf = o.mirrorOf
    return carried
  })
  if (dst.layout !== 'sidebyside' || src.layout === 'sidebyside') return one
  return [...one, ...kept.map(o => {
    const copy = carryObject(o, marks.get(o.id)!, dst, 1, src, sizes, newId())
    copy.mirrorOf = o.id
    return copy
  })]
}
