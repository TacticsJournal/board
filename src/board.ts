import Konva from 'konva'
import {
  ArrowObj, BallObj, BoxObj, ConeObj, GoalObj, ImageObj, MarkerObj, PlayerObj, Scene, SceneObj, TextObj, Pt,
  BOARD_W, BOARD_H, uid, cornersFromRect, nodesForShape, insertByTier, objectsInDrawOrder, boxHasCorners, isLight, playerDisplayName, trianglePoints,
} from './types'
export { trianglePoints }
import {
  PathNode, NodeCurve, nodeCurve, nodeHandles, nodeSegments, traceNodes, segmentEndTangent,
  nearestOnPath, insertNodeAt, freezeHandles, setNodeCurve, nodesBBox, MIN_NODES,
} from './path-nodes'
import { Store } from './store'
import { pitchById, LIVE_BG_KEY } from './pitches'
import { backgrounds } from './background-library.ts'
import { getAsset } from './assets'
import { canPlaceCone } from './entitlements'
import { arrowHeadSize, ballSrc, coneSrc, goalFullSrc, goalSmallSrc, CONE_ASPECT, GOAL_ASPECT } from './board-art'
import { boardNoteText } from './board-note'
import { applyHomography, homographyFromBox, invertHomography, type Homography, type Quad } from './perspective'

export { ballSrc, coneSrc, goalFullSrc, goalSmallSrc, CONE_ASPECT, GOAL_ASPECT } from './board-art'
export { arrowHeadSize, arrowMediumWidth, ARROW_WIDTH_MEDIUM, ARROW_WIDTH_MEDIUM_LIVE } from './board-art'

export const livePlayerSrc = new URL('../assets/icons/live/live_player.png', import.meta.url).href
const liveScoreboardSrc = new URL('../assets/icons/live/live_scoreboard.png', import.meta.url).href
const tjLogoSrc = new URL('../assets/brand/tj-logo.png', import.meta.url).href
export const LIVE_PLAYER_CROP = { x: 752, y: 1486, width: 2844, height: 1563 }
const LIVE_SCOREBOARD_CROP = { x: 460, y: 1659, width: 3176, height: 778 }
/**
 * The ground ellipse inside the live-player crop, as fractions of that crop.
 * The art carries a soft drop shadow well past the ellipse and off to one
 * side, so the crop's own centre is neither where the ellipse looks like it
 * sits nor how big it looks. Everything that has to line up with the ellipse
 * — the anchor, the tap target, the selection box, the name — measures here.
 */
export const LIVE_MARKER_ELLIPSE = {
  cx: 1300 / 2844,
  cy: 561 / 1563,
  rx: 1013 / 2844,
  ry: 314.5 / 1563,
}
const MIN_ZOOM = 0.25
const MAX_ZOOM = 6

/* ---------- the 3D camera ----------
   In 3D the board is one physical object standing still in the middle of the
   board area, and the only thing that moves is the camera looking at it. So
   the camera is all the state there is: how far round the board it has walked
   (yaw), how high its eye is above the near touchline (tilt), and how much of
   the room the board fills (zoom).

   Zoom is deliberately a fraction, not a scale. One is "as large as this board
   can be drawn with all four corners still inside the board area at this yaw
   and tilt", and that fitting scale is re-measured from the real projected
   corners after every camera change, so no gesture can put a corner off the
   board - it can only make the board smaller. */
export const BOARD_3D_CAMERA = {
  tiltMin: 0, tiltMax: 66, tiltDefault: 38,
  yawDefault: 0,
  zoomMin: 0.4, zoomMax: 1, zoomDefault: 0.95,
} as const

/** Keep equivalent full-circle headings small without limiting rotation. */
function wrapCameraYaw(degrees: number) {
  const wrapped = ((degrees + 180) % 360 + 360) % 360 - 180
  return Object.is(wrapped, -0) ? 0 : wrapped
}

/** Degrees of camera movement per pixel of drag. */
const ORBIT_YAW_PER_PX = 0.28
const ORBIT_TILT_PER_PX = 0.24
/** A drag is an orbit, not a tap, once it has gone this far in screen pixels. */
const ORBIT_SLOP = 6

/* ---------- the 3D view ----------
   3D is the same board, tilted. The CSS below leans the one Konva content
   element back in perspective; nothing is copied, redrawn or frozen, so every
   tool, handle and gesture still acts on the live stage. What does have to
   change is how a finger or a cursor becomes a board coordinate: Konva turns a
   client point into a stage point by splitting the content element's bounding
   box into even X and Y steps, and a tilted board is a trapezoid, where even
   steps are wrong everywhere except the middle. These four markers sit at the
   element's logical corners, so their screen positions are the trapezoid, and
   the inverse of the projective map through it is the true client-to-stage
   map. */
const TILT_CORNERS: [string, string][] = [['0', '0'], ['100%', '0'], ['100%', '100%'], ['0', '100%']]
/** Corners only move in whole-ish pixels; below this the solved map still holds. */
const TILT_CORNER_EPS = 0.02

function sameTiltCorners(a: Quad, b: Quad): boolean {
  for (let i = 0; i < 4; i++) {
    if (Math.abs(a[i].x - b[i].x) > TILT_CORNER_EPS) return false
    if (Math.abs(a[i].y - b[i].y) > TILT_CORNER_EPS) return false
  }
  return true
}

// cap canvas density: 3x phones repaint 2.25x the pixels of 2x with no
// visible gain, which is the main source of drag jank (export sets its own)
Konva.pixelRatio = Math.min(window.devicePixelRatio || 1, 2)

export type Tool = 'player' | 'ball' | 'arrow' | 'box' | 'text'

/** Any angle as a whole number of degrees from 0 to 359. */
function normalizeDeg(deg: number) {
  return ((Math.round(deg) % 360) + 360) % 360
}

export type ToolDefaults = {
  playerColor: string
  arrow: { dash: ArrowObj['dash']; color: string; width: number; head: boolean }
  measure: { color: string; width: number }
  box: { shape: BoxObj['shape']; fill: string; opacity: number }
  text: { bold: boolean; size: number; color: string }
  /** Icons menu places a ball, training cone, goal, live marker, or straight measuring line. */
  place: 'ball' | 'cone' | 'goal' | 'marker' | 'measure'
  goal: { variant: GoalObj['variant'] }
}

export type InteractionState = 'none' | 'selected' | 'node-edit'

type AnchorKind = 'start' | 'mid' | 'end'

/** Dotted shafts read better with fat dots; the head never changes size. */
function arrowShaftWidth(o: ArrowObj): number {
  return o.dash === 'dotted' ? Math.max(o.width * 1.8, 7) : o.width
}

function arrowDash(o: ArrowObj): number[] | undefined {
  if (o.dash === 'dashed') return [o.width * 2.4, o.width * 2]
  if (o.dash === 'dotted') return [0.001, arrowShaftWidth(o) * 2.1]
  return undefined
}

function arrowControl(o: ArrowObj): Pt | null {
  if (!o.curved) return null
  // control point of the quadratic that passes through (mx,my) at t=0.5
  return { x: 2 * o.mx - (o.x1 + o.x2) / 2, y: 2 * o.my - (o.y1 + o.y2) / 2 }
}

/**
 * The arrow as a node path. Every arrow keeps a middle node so it can bend
 * from the centre immediately. Measurement lines are the one exception.
 */
export function arrowNodes(o: ArrowObj): PathNode[] {
  if (o.points && o.points.length >= (o.measure ? 2 : 3)) return o.points
  if (o.points?.length === 2 && !o.measure) {
    const [first, last] = o.points
    if (nodeCurve(first) === 'corner' && nodeCurve(last) === 'corner') {
      return [first, { x: (first.x + last.x) / 2, y: (first.y + last.y) / 2, c: 'round' }, last]
    }
    // Split an existing two-node cubic at t=0.5. The third node appears
    // without changing the curve that was already drawn.
    const segment = nodeSegments(o.points, false)[0]
    const q0 = { x: (segment.a.x + segment.c1.x) / 2, y: (segment.a.y + segment.c1.y) / 2 }
    const q1 = { x: (segment.c1.x + segment.c2.x) / 2, y: (segment.c1.y + segment.c2.y) / 2 }
    const q2 = { x: (segment.c2.x + segment.b.x) / 2, y: (segment.c2.y + segment.b.y) / 2 }
    const r0 = { x: (q0.x + q1.x) / 2, y: (q0.y + q1.y) / 2 }
    const r1 = { x: (q1.x + q2.x) / 2, y: (q1.y + q2.y) / 2 }
    const mid = { x: (r0.x + r1.x) / 2, y: (r0.y + r1.y) / 2 }
    return [
      { ...first, c: 'free', h2: { x: q0.x - first.x, y: q0.y - first.y }, h1: first.h1 ? { ...first.h1 } : { x: 0, y: 0 } },
      { ...mid, c: 'free', h1: { x: r0.x - mid.x, y: r0.y - mid.y }, h2: { x: r1.x - mid.x, y: r1.y - mid.y } },
      { ...last, c: 'free', h1: { x: q2.x - last.x, y: q2.y - last.y }, h2: last.h2 ? { ...last.h2 } : { x: 0, y: 0 } },
    ]
  }
  if (o.measure) return [{ x: o.x1, y: o.y1 }, { x: o.x2, y: o.y2 }]
  if (!o.curved) {
    return [
      { x: o.x1, y: o.y1 },
      { x: (o.x1 + o.x2) / 2, y: (o.y1 + o.y2) / 2, c: 'round' },
      { x: o.x2, y: o.y2 },
    ]
  }
  // The stored curve is a quadratic through (mx,my); split it at its middle
  // and raise both halves to cubics, so converting bends nothing by a pixel.
  const C = arrowControl(o)!
  const A = { x: (o.x1 + C.x) / 2, y: (o.y1 + C.y) / 2 }
  const B = { x: (C.x + o.x2) / 2, y: (C.y + o.y2) / 2 }
  const M = { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 }
  const k = 2 / 3
  return [
    { x: o.x1, y: o.y1, c: 'free', h1: { x: 0, y: 0 }, h2: { x: (A.x - o.x1) * k, y: (A.y - o.y1) * k } },
    { x: M.x, y: M.y, c: 'free', h1: { x: (A.x - M.x) * k, y: (A.y - M.y) * k }, h2: { x: (B.x - M.x) * k, y: (B.y - M.y) * k } },
    { x: o.x2, y: o.y2, c: 'free', h1: { x: (B.x - o.x2) * k, y: (B.y - o.y2) * k }, h2: { x: 0, y: 0 } },
  ]
}

/** Give an arrow its own nodes, so they can be added to and bent. */
export function materializeArrowNodes(o: ArrowObj): PathNode[] {
  const minimum = o.measure ? 2 : 3
  if (!o.points || o.points.length < minimum) {
    o.points = arrowNodes(o).map(n => ({
      ...n,
      ...(n.h1 ? { h1: { ...n.h1 } } : {}),
      ...(n.h2 ? { h2: { ...n.h2 } } : {}),
    }))
  }
  return o.points
}

/**
 * Keep x1/y1/mx/my/x2/y2 in step with the nodes. Everything outside the board
 * — saves, the sequence player, thumbnails — still reads those, so they have to
 * stay true for the ends and near enough in the middle.
 */
export function syncArrowLegacy(o: ArrowObj) {
  const nodes = o.points
  if (!nodes || nodes.length < 2) return
  const first = nodes[0], last = nodes[nodes.length - 1]
  o.x1 = first.x; o.y1 = first.y
  o.x2 = last.x; o.y2 = last.y
  const segs = nodeSegments(nodes, false)
  const mid = segs[Math.floor(segs.length / 2)]
  const t = segs.length % 2 === 0 ? 0 : 0.5
  const p = mid ? segmentPointOf(mid, t) : { x: (o.x1 + o.x2) / 2, y: (o.y1 + o.y2) / 2 }
  o.mx = p.x; o.my = p.y
  o.curved = nodes.length > 2 || nodes.some(n => nodeCurve(n) !== 'corner')
}

function segmentPointOf(s: { a: Pt; b: Pt; c1: Pt; c2: Pt }, t: number): Pt {
  const u = 1 - t
  const k0 = u * u * u, k1 = 3 * u * u * t, k2 = 3 * u * t * t, k3 = t * t * t
  return {
    x: k0 * s.a.x + k1 * s.c1.x + k2 * s.c2.x + k3 * s.b.x,
    y: k0 * s.a.y + k1 * s.c1.y + k2 * s.c2.y + k3 * s.b.y,
  }
}

/** Whether this arrow draws from nodes rather than its three legacy points. */
function arrowIsPath(o: ArrowObj): boolean {
  return !o.measure && !!o.points && o.points.length >= 2
}

function arrowGeometry(o: ArrowObj, visualScale = 1, live = false) {
  if (arrowIsPath(o)) {
    const segs = nodeSegments(o.points!, false)
    const t = segs.length ? segmentEndTangent(segs[segs.length - 1]) : { x: 1, y: 0 }
    const head = o.head ? arrowHeadSize(o.width, live) * visualScale : 0
    return { C: null as Pt | null, tx: t.x, ty: t.y, head }
  }
  const C = arrowControl(o)
  let tx = C ? o.x2 - C.x : o.x2 - o.x1
  let ty = C ? o.y2 - C.y : o.y2 - o.y1
  const len = Math.hypot(tx, ty) || 1
  tx /= len; ty /= len
  const head = o.head ? arrowHeadSize(o.width, live) * visualScale : 0
  return { C, tx, ty, head }
}

function tracePath(ctx: { beginPath(): void; moveTo(x: number, y: number): void; lineTo(x: number, y: number): void; quadraticCurveTo(cx: number, cy: number, x: number, y: number): void; bezierCurveTo(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number): void }, o: ArrowObj, shorten: number, visualScale = 1, live = false) {
  if (arrowIsPath(o)) {
    traceNodes(ctx as any, o.points!, false, shorten)
    return
  }
  const { C, tx, ty } = arrowGeometry(o, visualScale, live)
  const ex = o.x2 - tx * shorten
  const ey = o.y2 - ty * shorten
  ctx.beginPath()
  ctx.moveTo(o.x1, o.y1)
  if (C) ctx.quadraticCurveTo(C.x, C.y, ex, ey)
  else ctx.lineTo(ex, ey)
}

export function makeArrowShape(o: ArrowObj, visualScale = 1, live = false): Konva.Shape {
  const shape = new Konva.Shape({
    id: o.id,
    stroke: o.color,
    fill: o.color,
    strokeWidth: arrowShaftWidth(o) * visualScale,
    perfectDrawEnabled: false,
    dash: o.measure ? undefined : arrowDash(o),
    lineCap: o.measure || o.dash === 'dotted' ? 'round' : 'butt',
    sceneFunc(ctx, sh) {
      const { tx, ty, head } = arrowGeometry(o, visualScale, live)
      if (o.measure) {
        const px = -ty, py = tx
        const tick = 22 * visualScale
        ctx.beginPath()
        ctx.moveTo(o.x1, o.y1)
        ctx.lineTo(o.x2, o.y2)
        for (const p of [
          { x: o.x1, y: o.y1, len: tick },
          { x: o.x2, y: o.y2, len: tick },
        ]) {
          ctx.moveTo(p.x - px * p.len, p.y - py * p.len)
          ctx.lineTo(p.x + px * p.len, p.y + py * p.len)
        }
        ctx.strokeShape(sh)
        return
      }
      tracePath(ctx, o, head * 0.8, visualScale, live)
      ctx.strokeShape(sh)
      if (head) {
        const px = -ty, py = tx
        const bx = o.x2 - tx * head, by = o.y2 - ty * head
        const hw = head * 0.62
        ctx.beginPath()
        ctx.moveTo(o.x2, o.y2)
        ctx.lineTo(bx + px * hw, by + py * hw)
        ctx.quadraticCurveTo(bx + tx * head * 0.3, by + ty * head * 0.3, bx - px * hw, by - py * hw)
        ctx.closePath()
        ctx.fillShape(sh)
      }
    },
    hitFunc(ctx, sh) {
      // fat, dash-free stroke along the shaft so thin/dotted arrows are tappable
      const native = (ctx as any)._context as CanvasRenderingContext2D
      tracePath(native, o, 0, visualScale, live)
      native.save()
      native.lineWidth = Math.max(44, o.width * 8)
      native.lineCap = 'round'
      native.strokeStyle = (sh as any).colorKey
      native.setLineDash([])
      native.stroke()
      native.restore()
    },
  })
  return shape
}

/** Whether this object type supports node editing (pencil icon). */
function hasNodeEdit(obj: SceneObj): boolean {
  return obj.type === 'arrow' || obj.type === 'box'
}

/**
 * The nodes of a zone, made on the spot for an oval or a triangle that has
 * never been edited. Their shape is exact either way, so opening the editor
 * changes what you can do to the zone and nothing about how it looks.
 */
export function materializeBoxNodes(o: BoxObj): PathNode[] {
  if (!o.corners || o.corners.length < 3) o.corners = nodesForShape(o.shape, o.x, o.y, o.w, o.h, o.rotation)
  return o.corners
}

/** Centroid of a box's corners (or fallback to x/y). */
function boxCentroid(o: BoxObj): Pt {
  if (o.corners?.length) {
    return {
      x: o.corners.reduce((s, c) => s + c.x, 0) / o.corners.length,
      y: o.corners.reduce((s, c) => s + c.y, 0) / o.corners.length,
    }
  }
  return { x: o.x, y: o.y }
}

/** Center of an arrow (midpoint of all 3 control points). */
function arrowCenter(o: ArrowObj): Pt {
  return { x: (o.x1 + o.mx + o.x2) / 3, y: (o.y1 + o.my + o.y2) / 3 }
}

/** Center point of any object. */
function objCenter(o: SceneObj): Pt {
  if (o.type === 'arrow') return arrowCenter(o)
  if (o.type === 'box') return boxCentroid(o)
  return { x: o.x, y: o.y }
}

export class Board {
  stage: Konva.Stage
  bgLayer = new Konva.Layer({ listening: false })
  objLayer = new Konva.Layer()
  /** Full-scene remote layers are visual only; they never become Store state. */
  private remoteBackgroundLayer = new Konva.Layer({ listening: false })
  private remoteLayer = new Konva.Layer({ listening: false })
  private remoteOverlayLayer = new Konva.Layer({ listening: false })
  overlayLayer = new Konva.Layer({ listening: false })
  noteLayer = new Konva.Layer()
  uiLayer = new Konva.Layer()
  transformer: Konva.Transformer
  tool: Tool = 'player'
  defaults: ToolDefaults
  zoom = 1
  interactionState: InteractionState = 'none'
  /** The single object being node-edited (only valid when interactionState === 'node-edit'). */
  nodeEditId: string | null = null
  snapEnabled = false
  /** Selected node names in node-edit mode (e.g. 'anchor-start', 'anchor-corner-0'). */
  private selectedNodes = new Set<string>()
  /** Node-edit: arm for dragging selected nodes. */
  private nodeArm: { start: Pt; origPositions: Record<string, Pt>; began: boolean } | null = null
  /** Node-edit: the handle square being dragged, which is not a node selection. */
  private grabbedHandle: string | null = null
  /** Node-edit: whether we're in multi-select mode (hold triggered). */
  private nodeMultiSelect = false
  /** Node-edit: the + button is armed, so the next tap on the outline adds. */
  addNodeArmed = false
  onRequestTextEdit: (id: string | null, boardPos: Pt) => void = () => {}
  onInteractionStateChange: () => void = () => {}
  onBallPlaced: () => void = () => {}
  onViewChange: () => void = () => {}
  /** Fired after an arrow or zone is drawn, so the toolbar can hand back. */
  onShapeDrawn: () => void = () => {}
  /** A visual-only local scene source. The caller decides how often to serialize it. */
  onLivePreview: (phase: 'update' | 'end', scene: () => Scene) => void = () => {}
  /** Lets the screen suppress remote frames for the lifetime of a local pointer gesture. */
  onPointerActivity: (active: boolean) => void = () => {}
  /** Keeps non-canvas collaboration UI in step with this visual-only layer. */
  onRemotePreviewVisibilityChange: (visible: boolean) => void = () => {}
  /**
   * True only while a selection change comes from picking on the board, so the
   * panel can tell a pick from a selection something made for itself.
   */
  picking = false
  private pick(fn: () => void) {
    this.picking = true
    try { fn() } finally { this.picking = false }
  }
  /**
   * The angle a turn is passing through, so the screen can read it out, and
   * null when the turn is over. Objects that carry an angle report their own;
   * an arrow has none to carry, so it reports how far it has come round.
   */
  onRotation: (deg: number | null) => void = () => {}
  /** Current board height: tracks the scene's pitch style (width is fixed). */
  boardH = BOARD_H
  /* The board's note is part of the board, not part of the screen: a band
     drawn under the pitch, so it pans and zooms with everything else and
     never covers the play. */
  noteH = 0
  onNoteTap: () => void = () => {}
  private noteSource = ''
  private noteHeading = ''
  private noteText = ''
  private noteGroup = new Konva.Group()
  private pitchId = ''
  private container: HTMLDivElement
  private ballImg: HTMLImageElement
  private coneImg!: HTMLImageElement
  private goalImgs!: Record<GoalObj['variant'], HTMLImageElement>
  private livePlayerImg!: HTMLImageElement
  private liveScoreboardImg!: HTMLImageElement
  private logoImg!: HTMLImageElement
  private pitchImg: HTMLImageElement
  /** Remote pitch art is shared by frames; never create an Image per preview. */
  private remotePitchImages = new Map<string, HTMLImageElement>()
  private remoteScene: Scene | null = null
  private remoteBoardH = BOARD_H
  private remoteLocalOpacity: { bg: number; obj: number; overlay: number; ui: number } | null = null
  private remoteLocalView: { zoom: number; scale: Konva.Vector2d; position: Konva.Vector2d } | null = null
  /** bumped by setLiveBackground so syncPitch reloads the screenshot */
  private liveVersion = 0
  /** Bumped on every pitch switch, so a slow background read knows it is stale. */
  private pitchToken = 0
  private loadedLiveVersion = -1
  private backgroundResolver: (id: string) => Promise<string | null> = id => backgrounds.image(id)
  private creating: { kind: 'arrow' | 'box'; start: Pt; node: Konva.Node; obj: any } | null = null
  private tapStart: Pt | null = null
  /** Object id tapped on pointerdown but not yet selected (consumed on pointerup). */
  private tapTargetId: string | null = null
  private pinch: {
    ids: [number, number]
    startDist: number
    startZoom: number
    startScale: number
    world: Pt
    lastCenter: Pt
    lastDist: number
  } | null = null
  private holdTimer: number | null = null
  private selecting = false
  private selectingKind: 'objects' | 'nodes' | null = null
  private selectRect: Konva.Rect | null = null
  private selectStart: Pt | null = null
  private moveArm: { ids: string[]; start: Pt; orig: Record<string, any>; objs: Record<string, SceneObj>; nodes: Record<string, Konva.Node | null>; began: boolean } | null = null
  private panArm: { start: Pt; origin: Pt; began: boolean } | null = null
  private lastTap: { id: string | null; time: number } | null = null
  /** Ignore synthetic mouse events that some mobile browsers emit after touch. */
  private suppressMouseUntil = 0
  /** Last node under the mouse (never set by touch); drives cursor feedback. */
  private hoverTarget: Konva.Node | null = null
  private renderingScene: Scene | null = null
  private remotePreviewActive = false
  /** True while the board is tilted into the 3D view. */
  private tilted = false
  /** Zero-size probes at the content element's logical corners. */
  private tiltMarkers: HTMLElement[] | null = null
  /** The solved client-to-stage map, kept until the corners actually move. */
  private tiltMap: { w: number; h: number; corners: Quad; inverse: Homography } | null = null
  /** Where the 3D camera stands. Degrees, degrees, and a fraction of the fit. */
  private cam = {
    yaw: BOARD_3D_CAMERA.yawDefault,
    tilt: BOARD_3D_CAMERA.tiltDefault,
    zoom: BOARD_3D_CAMERA.zoomDefault,
  }
  /** An empty-space drag that is turning into an orbit. Screen pixels. */
  private orbitArm: { x0: number; y0: number; yaw: number; tilt: number; began: boolean } | null = null
  /** A two-finger camera zoom. Screen pixels, never mapped through the tilt. */
  private camPinch: { ids: [number, number]; startDist: number; startZoom: number } | null = null
  /** Fires the first time a camera gesture moves the camera, for the hint. */
  onCameraGesture: () => void = () => {}

  constructor(private store: Store, container: HTMLDivElement, defaults: ToolDefaults) {
    this.container = container
    this.defaults = defaults
    this.stage = new Konva.Stage({ container, width: 100, height: 100 })
    this.stage.add(this.bgLayer, this.remoteBackgroundLayer, this.objLayer, this.remoteLayer, this.overlayLayer, this.remoteOverlayLayer, this.noteLayer, this.uiLayer)

    this.transformer = new Konva.Transformer({
      rotateAnchorOffset: 14,
      anchorSize: 6,
      anchorCornerRadius: 4,
      anchorStroke: '#4a90d9',
      borderStroke: '#4a90d9',
      ignoreStroke: true,
    })
    this.uiLayer.add(this.transformer)
    // The Transformer turns text and ellipses; only its rotate handle is a turn.
    this.transformer.on('transform', () => {
      if (this.transformer.getActiveAnchor() !== 'rotater') return
      const node = this.transformer.nodes()[0]
      if (node) this.onRotation(normalizeDeg(node.rotation()))
    })
    this.transformer.on('transformend', () => {
      this.onRotation(null)
      this.onPointerActivity(false)
    })

    this.pitchImg = new Image()
    this.syncPitch()
    this.ballImg = new Image()
    this.ballImg.src = ballSrc
    this.ballImg.onload = () => this.rebuild()
    this.coneImg = new Image()
    this.coneImg.src = coneSrc
    this.coneImg.onload = () => this.rebuild()
    this.goalImgs = { small: new Image(), normal: new Image() }
    this.goalImgs.small.src = goalSmallSrc
    this.goalImgs.normal.src = goalFullSrc
    for (const img of Object.values(this.goalImgs)) img.onload = () => this.rebuild()
    this.livePlayerImg = new Image()
    this.livePlayerImg.src = livePlayerSrc
    this.livePlayerImg.onload = () => this.rebuild()
    this.liveScoreboardImg = new Image()
    this.liveScoreboardImg.src = liveScoreboardSrc
    this.liveScoreboardImg.onload = () => this.rebuild()
    this.logoImg = new Image()
    this.logoImg.src = tjLogoSrc
    this.logoImg.onload = () => this.drawOverlay()
    this.drawBackground()

    this.bindStage()
    store.subscribe(() => this.rebuild())
    store.onSelect(() => {
      if (this.store.selectedIds.length) {
        // if node-editing and selection changed to a different object, exit node edit
        if (this.interactionState === 'node-edit' && this.store.selectedId !== this.nodeEditId) {
          this.interactionState = 'selected'
          this.nodeEditId = null
        } else if (this.interactionState === 'none') {
          this.interactionState = 'selected'
        }
      } else {
        if (this.interactionState === 'node-edit') {
          this.nodeEditId = null
        }
        this.interactionState = 'none'
      }
      this.attachSelectionUi()
      this.stage.batchDraw()
    })
    new ResizeObserver(() => this.fit()).observe(container)
    this.fit()
    this.rebuild()
  }

  setTool(tool: Tool) {
    this.tool = tool
    this.interactionState = 'none'
    this.nodeEditId = null
    this.store.select(null)
    this.rebuild()
    this.syncCursor()
  }

  /** Mouse/trackpad cursor feedback; touch never fires the hover events that feed it. */
  private syncCursor() {
    const t = this.hoverTarget
    // Konva's Transformer manages its own resize cursors on its anchors
    if (t?.findAncestor?.('Transformer')) return
    const style = this.container.style
    if (this.panArm?.began || this.moveArm?.began || this.orbitArm?.began) {
      style.cursor = 'grabbing'
      return
    }
    if (t?.hasName?.('anchor') || t?.hasName?.('resize-node') || t?.hasName?.('edit-icon')) { style.cursor = 'pointer'; return }
    const overId = t ? this.objectIdAt(t) : null
    if (this.tool === 'arrow' || this.tool === 'box' || (this.tool === 'ball' && this.defaults.place === 'measure')) {
      style.cursor = overId && this.store.selectedIds.includes(overId) ? 'move' : 'crosshair'
      return
    }
    if (overId && this.interactionState === 'selected' && this.store.selectedIds.includes(overId)) { style.cursor = 'move'; return }
    if (overId) { style.cursor = 'pointer'; return }
    if (this.tool === 'ball') { style.cursor = 'crosshair'; return }
    if (this.tool === 'text') { style.cursor = 'text'; return }
    style.cursor = ''
  }

  enterNodeEdit(id: string) {
    const obj = this.store.obj(id)
    if (!obj || !hasNodeEdit(obj)) return
    this.store.select(id)
    this.interactionState = 'node-edit'
    this.nodeEditId = id
    this.addNodeArmed = false
    this.selectedNodes.clear()
    this.nodeMultiSelect = false
    this.nodeArm = null
    this.grabbedHandle = null
    this.attachSelectionUi()
    this.stage.batchDraw()
    this.onInteractionStateChange()
  }

  exitNodeEdit() {
    this.interactionState = this.store.selectedIds.length ? 'selected' : 'none'
    this.nodeEditId = null
    this.selectedNodes.clear()
    this.nodeMultiSelect = false
    this.nodeArm = null
    this.grabbedHandle = null
    this.addNodeArmed = false
    this.attachSelectionUi()
    this.stage.batchDraw()
    this.onInteractionStateChange()
  }

  setSnapEnabled(v: boolean) {
    this.snapEnabled = v
  }

  /** Draw a received full scene above the local scene without changing durable state. */
  renderRemotePreview(scene: Scene) {
    // collaboration.ts has already migrated this untrusted wire scene. Do not
    // migrate or clone it again on every 30 fps frame.
    const remoteHeight = this.remoteHeight(scene)
    const visibleHeight = this.remotePreviewActive ? this.remoteBoardH : this.boardH
    const heightChanged = remoteHeight !== visibleHeight
    if (!this.remotePreviewActive) {
      this.remoteLocalOpacity = {
        bg: this.bgLayer.opacity(), obj: this.objLayer.opacity(), overlay: this.overlayLayer.opacity(), ui: this.uiLayer.opacity(),
      }
      // The view only changes when the remote pitch has a different height.
      // An ordinary player move must not pull someone out of their zoom.
      this.remoteLocalView = heightChanged
        ? { zoom: this.zoom, scale: this.stage.scale(), position: this.stage.position() }
        : null
    }
    this.remotePreviewActive = true
    this.remoteBoardH = remoteHeight
    this.noteGroup.y(remoteHeight)
    this.remoteScene = scene
    this.remoteBackgroundLayer.destroyChildren()
    this.remoteLayer.destroyChildren()
    this.remoteOverlayLayer.destroyChildren()
    this.drawRemoteBackground(scene)
    this.renderingScene = scene
    for (const object of objectsInDrawOrder(scene.objects)) {
      const node = this.buildNode(object)
      if (node) this.remoteLayer.add(node as any)
    }
    this.renderingScene = null
    this.drawOverlay(scene, this.remoteOverlayLayer, true)
    // Opacity, rather than visible(false), preserves the local Konva hit maps.
    // The first pointerdown can therefore clear this layer and select locally.
    // Notes deliberately stay visible: they are local-only and not in frames.
    this.bgLayer.opacity(0)
    this.objLayer.opacity(0)
    this.overlayLayer.opacity(0)
    this.uiLayer.opacity(0)
    this.remoteBackgroundLayer.opacity(1)
    this.remoteLayer.opacity(1)
    this.remoteOverlayLayer.opacity(1)
    this.remoteBackgroundLayer.batchDraw()
    this.remoteLayer.batchDraw()
    this.remoteOverlayLayer.batchDraw()
    if (heightChanged) {
      // A remote scene can use a different live-pitch height. Fit once per
      // height transition, never once per 30 fps preview frame.
      this.zoom = 1
      this.fit()
    } else this.stage.batchDraw()
    this.onRemotePreviewVisibilityChange(true)
  }

  /** Restore the local rendering. This never calls Store or changes selection/history. */
  clearRemotePreview() {
    if (!this.remotePreviewActive) return
    this.remotePreviewActive = false
    this.remoteScene = null
    this.remoteBackgroundLayer.destroyChildren()
    this.remoteLayer.destroyChildren()
    this.remoteOverlayLayer.destroyChildren()
    const opacity = this.remoteLocalOpacity
    this.remoteLocalOpacity = null
    if (opacity) {
      this.bgLayer.opacity(opacity.bg)
      this.objLayer.opacity(opacity.obj)
      this.overlayLayer.opacity(opacity.overlay)
      this.uiLayer.opacity(opacity.ui)
    }
    this.noteGroup.y(this.boardH)
    const view = this.remoteLocalView
    this.remoteLocalView = null
    if (view) {
      this.zoom = view.zoom
      this.stage.scale(view.scale)
      this.stage.position(view.position)
      this.clampPan()
    }
    this.stage.batchDraw()
    this.onViewChange()
    this.onRemotePreviewVisibilityChange(false)
  }

  private previewScene(): Scene {
    // The editor owns this scene. A shallow scene/objects-array projection is
    // enough for the trusted outbound check and avoids migrate/deep-clone work
    // on every collaboration frame.
    const scene: Scene = { ...this.store.scene, objects: [...this.store.scene.objects] }
    if (this.creating) insertByTier(scene.objects, this.creating.obj)
    return scene
  }

  private publishPreview(phase: 'update' | 'end') {
    this.onLivePreview(phase, () => this.previewScene())
  }

  /* ---------- view transform ---------- */

  /** What the view has to hold: the visible pitch, plus the local note band. */
  private contentH() { return (this.remotePreviewActive ? this.remoteBoardH : this.boardH) + this.noteH }

  private remoteHeight(scene: Scene) {
    const style = pitchById(scene.pitch)
    return style.live ? (scene.board?.h || style.boardH) : style.boardH
  }

  setNote(markdown: string) {
    const source = markdown ?? ''
    if (source === this.noteSource) return
    const note = boardNoteText(source)
    this.noteSource = source
    this.noteHeading = note.heading
    this.noteText = note.body
    this.rebuildNote()
    this.fit()
  }

  private rebuildNote() {
    this.noteGroup.destroy()
    this.noteGroup = new Konva.Group({ y: this.boardH })
    this.noteLayer.add(this.noteGroup)
    if (!this.noteHeading && !this.noteText) {
      this.noteH = 0
      this.noteLayer.batchDraw()
      return
    }
    const pad = 22
    const width = BOARD_W - pad * 2
    const fill = this.dark ? '#f5f5f7' : '#1d1d1f'
    const family = '-apple-system, "Helvetica Neue", Arial, sans-serif'
    const content: Konva.Text[] = []
    let y = pad

    if (this.noteHeading) {
      const heading = new Konva.Text({
        x: pad,
        y,
        width,
        text: this.noteHeading,
        fontSize: 24,
        fontStyle: 'bold',
        lineHeight: 1.2,
        fontFamily: family,
        fill,
        wrap: 'word',
      })
      content.push(heading)
      y += heading.height()
      if (this.noteText) y += 10
    }

    if (this.noteText) {
      const body = new Konva.Text({
        x: pad,
        y,
        width,
        text: this.noteText,
        fontSize: 19,
        lineHeight: 1.45,
        fontFamily: family,
        fill,
        wrap: 'word',
      })
      content.push(body)
      y += body.height()
    }

    this.noteH = Math.round(y + pad)
    const band = new Konva.Rect({ x: 0, y: 0, width: BOARD_W, height: this.noteH, fill: this.dark ? '#1c1c1e' : '#f5f5f7' })
    const rule = new Konva.Rect({ x: 0, y: 0, width: BOARD_W, height: 1, fill: this.dark ? '#38383a' : '#d2d2d7' })
    this.noteGroup.add(band, rule, ...content)
    this.noteGroup.on('click tap', () => this.onNoteTap())
    this.noteLayer.batchDraw()
  }

  /**
   * Height of the bottom panel that floats over the stage. The stage keeps the
   * full container - opening a panel must never resize or move the board - so
   * fitting centres the board in what is left visible above it.
   */
  private inset = 0
  get bottomInset() { return this.inset }
  set bottomInset(v: number) {
    const next = Number.isFinite(v) ? Math.max(0, v) : 0
    if (next === this.inset) return
    this.inset = next
    // The board area just changed shape. In 3D that has to refit the camera or
    // the pitch can end up behind the panel, which is the whole failure this
    // camera exists to prevent.
    if (this.container.clientWidth) this.fit()
  }

  fit() {
    const cw = this.container.clientWidth, full = this.container.clientHeight
    if (!cw || !full) return
    this.stage.size({ width: cw, height: full })
    const ch = Math.max(120, full - this.inset)
    const base = Math.min(cw / BOARD_W, ch / this.contentH())
    const scale = base * this.zoom
    const old = this.stage.scaleX()
    this.stage.scale({ x: scale, y: scale })
    if (this.zoom === 1 || !old) {
      this.stage.position({ x: (cw - BOARD_W * scale) / 2, y: (ch - this.contentH() * scale) / 2 })
    }
    this.clampPan()
    this.invalidateTilt()
    // A resize or an orientation change lands here, so refitting the camera
    // from the new board area is what keeps the whole pitch visible.
    if (this.tilted) { this.recomputeCamera(); return }
    this.stage.batchDraw()
    this.onViewChange()
  }

  /* ---------- the 3D view ---------- */

  /**
   * Lean the live board back in perspective, or set it flat again. This is a
   * view state and nothing else: the scene is untouched, so it is never saved,
   * exported or sent to anyone else as 3D.
   */
  set3D(on: boolean) {
    if (on === this.tilted) return
    this.tilted = on
    this.container.classList.toggle('is3d', on)
    // The contrasting mat belongs to the board area, outside the transformed
    // element, so it can never become a white slab lying over the pitch.
    this.container.parentElement?.classList.toggle('is3d', on)
    this.drawBackground()
    if (this.remoteScene) this.drawRemoteBackground(this.remoteScene)
    this.orbitArm = null
    this.camPinch = null
    this.panArm = null
    if (on) {
      this.mountTiltMarkers()
      this.cam = { yaw: BOARD_3D_CAMERA.yawDefault, tilt: BOARD_3D_CAMERA.tiltDefault, zoom: BOARD_3D_CAMERA.zoomDefault }
      // The Konva stage keeps the plain fit view in 3D. Everything the camera
      // does happens in the CSS transform, which is the only way the whole
      // board can be guaranteed visible: a panned or zoomed stage crops.
      this.zoom = 1
      this.fit()
    } else {
      // Switching flat is immediate. A transform transition would leave the
      // drawing between two camera matrices while pointer mapping has already
      // changed, which makes the first 2D tap miss.
      this.tiltMap = null
      this.zoom = 1
      this.fit()
    }
    this.invalidateTilt()
    this.attachSelectionUi()
    this.stage.batchDraw()
  }

  is3D() { return this.tilted }

  /* ---------- the 3D camera ---------- */

  /** Where the camera stands right now. */
  get3DCamera() { return { ...this.cam } }

  /**
   * Move the camera. Tilt and zoom are clamped, yaw wraps through a full turn,
   * and the whole board is refitted afterwards. No camera heading can lose a
   * corner; a demanding angle only makes the fitted board smaller.
   */
  set3DCamera(next: Partial<{ yaw: number; tilt: number; zoom: number }>) {
    const c = BOARD_3D_CAMERA
    const clamp = (v: number, lo: number, hi: number, fallback: number) =>
      Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback
    const yawValue = next.yaw ?? this.cam.yaw
    const yaw = Number.isFinite(yawValue) ? wrapCameraYaw(yawValue) : this.cam.yaw
    const tilt = clamp(next.tilt ?? this.cam.tilt, c.tiltMin, c.tiltMax, this.cam.tilt)
    const zoom = clamp(next.zoom ?? this.cam.zoom, c.zoomMin, c.zoomMax, this.cam.zoom)
    if (yaw === this.cam.yaw && tilt === this.cam.tilt && zoom === this.cam.zoom) return
    this.cam = { yaw, tilt, zoom }
    if (this.tilted) this.recomputeCamera()
  }

  /** Walk the camera round and up by a gesture's worth of degrees. */
  orbit3D(dYaw: number, dTilt: number) {
    this.set3DCamera({ yaw: this.cam.yaw + dYaw, tilt: this.cam.tilt + dTilt })
  }

  /** Camera zoom, as a multiplier on the current fraction of the fit. */
  zoom3D(factor: number) {
    if (!Number.isFinite(factor) || factor <= 0) return
    this.set3DCamera({ zoom: this.cam.zoom * factor })
  }

  /** Put the camera back where entering 3D leaves it. The scene is untouched. */
  reset3DCamera() {
    this.clearRemotePreview()
    this.cam = { yaw: BOARD_3D_CAMERA.yawDefault, tilt: BOARD_3D_CAMERA.tiltDefault, zoom: BOARD_3D_CAMERA.zoomDefault }
    this.zoom = 1
    this.fit()
  }

  /**
   * The board area the whole pitch has to stay inside, the pitch rectangle in
   * the transformed element's own pixels, and the point the camera turns
   * about. Null before the board has a size.
   */
  private cameraGeometry() {
    const cw = this.container.clientWidth
    const full = this.container.clientHeight
    if (!cw || !full) return null
    const usableH = Math.max(120, full - this.inset)
    const s = this.stage.scaleX() || 1
    // The pitch carries a drawn shadow past its own touchlines, and objects
    // sit near the edges, so the rectangle that has to stay visible is a
    // little larger than the pitch itself.
    const pad = BOARD_W * 0.01 * s
    const x0 = this.stage.x() - pad, x1 = this.stage.x() + BOARD_W * s + pad
    const y0 = this.stage.y() - pad, y1 = this.stage.y() + this.boardH * s + pad
    const corners: Pt[] = [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }]
    const margin = Math.max(6, Math.min(cw, usableH) * 0.018)
    return {
      corners,
      origin: { x: (x0 + x1) / 2, y: (y0 + y1) / 2 },
      room: {
        w: Math.max(40, cw - margin * 2),
        h: Math.max(40, usableH - margin * 2),
        cx: cw / 2,
        cy: usableH / 2,
      },
      // A shallower box wants a nearer eye, or the tilt reads as a flat skew.
      persp: Math.max(1300, Math.min(2600, Math.min(cw, usableH) * 3.4)),
    }
  }

  /**
   * The same arithmetic the browser does for
   * `perspective(d) rotateX(tilt) rotateZ(yaw) scale(s)` about one origin.
   * Null for a point at or behind the horizon, where there is no finite answer
   * and so no honest way to say it is on screen.
   */
  private projectCamera(p: Pt, origin: Pt, scale: number, tilt: number, yaw: number, persp: number): Pt | null {
    const qx = (p.x - origin.x) * scale, qy = (p.y - origin.y) * scale
    const cz = Math.cos(yaw), sz = Math.sin(yaw)
    const rx = qx * cz - qy * sz
    const ry = qx * sz + qy * cz
    const w = 1 - (ry * Math.sin(tilt)) / persp
    if (!(w > 0.02) || !Number.isFinite(w)) return null
    const x = origin.x + rx / w
    const y = origin.y + (ry * Math.cos(tilt)) / w
    return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null
  }

  /** The projected pitch's screen box at one camera scale, or null off-horizon. */
  private cameraSpan(g: NonNullable<ReturnType<Board['cameraGeometry']>>, scale: number, tilt: number, yaw: number) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const c of g.corners) {
      const q = this.projectCamera(c, g.origin, scale, tilt, yaw, g.persp)
      if (!q) return null
      if (q.x < minX) minX = q.x
      if (q.x > maxX) maxX = q.x
      if (q.y < minY) minY = q.y
      if (q.y > maxY) maxY = q.y
    }
    return { w: maxX - minX, h: maxY - minY, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 }
  }

  /**
   * The largest camera scale whose projected pitch still fits the board area
   * at this yaw and tilt. Found by bisection on the real projected corners
   * rather than by a guessed factor, because the perspective divide makes the
   * near edge grow faster than the far edge shrinks.
   */
  private cameraFitScale(g: NonNullable<ReturnType<Board['cameraGeometry']>>, tilt: number, yaw: number) {
    const fits = (scale: number) => {
      const b = this.cameraSpan(g, scale, tilt, yaw)
      return !!b && b.w <= g.room.w && b.h <= g.room.h
    }
    let lo = 0.02, hi = 4
    if (!fits(lo)) return lo
    for (let i = 0; i < 32; i++) {
      const mid = (lo + hi) / 2
      if (fits(mid)) lo = mid
      else hi = mid
    }
    return lo
  }

  /**
   * Fit the board to the camera and hand the result to CSS. The centring is
   * done by moving the Konva stage rather than by a CSS translate: a shift of
   * the stage moves the turning point and the corners together, so it comes
   * out as an exact screen-space translation instead of the shear a translate
   * inside the perspective would give.
   */
  private recomputeCamera() {
    const g = this.cameraGeometry()
    if (!g) return
    const tilt = (this.cam.tilt * Math.PI) / 180
    const yaw = (this.cam.yaw * Math.PI) / 180
    const scale = this.cameraFitScale(g, tilt, yaw) * this.cam.zoom
    const box = this.cameraSpan(g, scale, tilt, yaw)
    let origin = g.origin
    if (box) {
      const dx = g.room.cx - box.cx, dy = g.room.cy - box.cy
      if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
        this.stage.position({ x: this.stage.x() + dx, y: this.stage.y() + dy })
        origin = { x: origin.x + dx, y: origin.y + dy }
      }
    }
    const vars: [string, string][] = [
      ['--cam-tilt', `${this.cam.tilt}deg`],
      ['--cam-yaw', `${this.cam.yaw}deg`],
      ['--cam-scale', String(Math.round(scale * 10000) / 10000)],
      ['--cam-origin-x', `${Math.round(origin.x * 100) / 100}px`],
      ['--cam-origin-y', `${Math.round(origin.y * 100) / 100}px`],
      ['--cam-persp', `${Math.round(g.persp)}px`],
    ]
    for (const [k, v] of vars) this.container.style.setProperty(k, v)
    // Safari composites the transform from the element that carries it, so put
    // the same values there too: without this a gesture can lag a frame behind.
    const content = this.contentEl()
    if (content) for (const [k, v] of vars) content.style.setProperty(k, v)
    this.invalidateTilt()
    this.stage.batchDraw()
    this.onViewChange()
  }

  /** True while screen positions on this board are projective, not affine. */
  private tiltActive() { return this.tilted }

  private invalidateTilt() { this.tiltMap = null }

  private contentEl(): HTMLElement | null {
    return this.container.querySelector<HTMLElement>('.konvajs-content')
  }

  private mountTiltMarkers() {
    const content = this.contentEl()
    if (!content) return
    if (!this.tiltMarkers) {
      this.tiltMarkers = TILT_CORNERS.map(([left, top]) => {
        const el = document.createElement('div')
        el.className = 'boardTiltMark'
        el.setAttribute('aria-hidden', 'true')
        el.style.cssText = `position:absolute;left:${left};top:${top};width:0;height:0;pointer-events:none;`
        return el
      })
    }
    for (const el of this.tiltMarkers) if (el.parentElement !== content) content.appendChild(el)
  }

  /**
   * Where a client point lands in untransformed stage pixels, or null when the
   * board is flat or the map cannot be solved. The corners are measured on
   * every call because a page scroll moves them with no event of ours; the
   * eight-unknown solve behind them only runs again once they have moved.
   */
  private tiltPoint(clientX: number, clientY: number): Pt | null {
    if (!this.tiltActive()) return null
    if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return null
    const content = this.contentEl()
    let markers = this.tiltMarkers
    if (!content) return null
    if (!markers || markers[0].parentElement !== content) {
      this.mountTiltMarkers()
      markers = this.tiltMarkers
    }
    if (!markers || markers.length !== 4) return null
    const corners = markers.map(el => {
      const r = el.getBoundingClientRect()
      return { x: r.left, y: r.top }
    }) as unknown as Quad
    const w = content.clientWidth, h = content.clientHeight
    const cached = this.tiltMap
    if (!cached || cached.w !== w || cached.h !== h || !sameTiltCorners(cached.corners, corners)) {
      const forward = homographyFromBox(w, h, corners)
      const inverse = forward ? invertHomography(forward) : null
      this.tiltMap = inverse ? { w, h, corners, inverse } : null
    }
    return this.tiltMap ? applyHomography(this.tiltMap.inverse, { x: clientX, y: clientY }) : null
  }

  /** A client point in stage-element pixels, through the tilt when it is on. */
  private clientToStage(clientX: number, clientY: number): Pt | null {
    if (this.tiltActive()) return this.tiltPoint(clientX, clientY)
    const rect = this.container.getBoundingClientRect()
    const p = { x: clientX - rect.left, y: clientY - rect.top }
    return Number.isFinite(p.x) && Number.isFinite(p.y) ? p : null
  }

  resetView() { this.clearRemotePreview()
    // In 3D the stage is always at fit already; what "fit" means there is the
    // camera, so this is the same reset the toolbar's Reset button performs.
    if (this.tilted) { this.reset3DCamera(); return }
    this.zoom = 1; this.fit()
  }

  /** Keyboard zoom: the camera in 3D, the stage when the board is flat. */
  zoomBy(factor: number) {
    this.clearRemotePreview()
    if (this.tilted) { this.zoom3D(factor); return }
    this.zoomAt({ x: this.stage.width() / 2, y: this.stage.height() / 2 }, factor)
  }

  isFitView(): boolean {
    if (this.tilted) {
      // In 3D the stage never leaves its fit; the view is the camera, so this
      // is the question the Fit control is really asking.
      return this.cam.yaw === BOARD_3D_CAMERA.yawDefault
        && this.cam.tilt === BOARD_3D_CAMERA.tiltDefault
        && this.cam.zoom === BOARD_3D_CAMERA.zoomDefault
    }
    const cw = this.container.clientWidth, full = this.container.clientHeight
    if (!cw || !full || Math.abs(this.zoom - 1) > 0.001) return false
    const ch = Math.max(120, full - this.inset)
    const scale = Math.min(cw / BOARD_W, ch / this.contentH())
    return Math.abs(this.stage.x() - (cw - BOARD_W * scale) / 2) < 1
      && Math.abs(this.stage.y() - (ch - this.contentH() * scale) / 2) < 1
  }

  private clampPan() {
    const s = this.stage.scaleX()
    const cw = this.stage.width(), ch = this.stage.height()
    const bw = BOARD_W * s, bh = this.contentH() * s
    let { x, y } = this.stage.position()
    const visible = Math.min(80, Math.max(28, Math.min(cw, ch) * 0.08))
    const minX = Math.min(cw - visible, visible - bw)
    const maxX = Math.max(cw - visible, visible - bw)
    const minY = Math.min(ch - visible, visible - bh)
    const maxY = Math.max(ch - visible, visible - bh)
    x = Math.min(Math.max(x, minX), maxX)
    y = Math.min(Math.max(y, minY), maxY)
    this.stage.position({ x, y })
  }

  private zoomAt(screen: Pt, factor: number, clamp = true) {
    const cw = this.container.clientWidth, ch = this.container.clientHeight
    const base = Math.min(cw / BOARD_W, ch / this.contentH())
    const oldScale = this.stage.scaleX()
    this.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, this.zoom * factor))
    const scale = base * this.zoom
    const world = { x: (screen.x - this.stage.x()) / oldScale, y: (screen.y - this.stage.y()) / oldScale }
    this.stage.scale({ x: scale, y: scale })
    this.stage.position({ x: screen.x - world.x * scale, y: screen.y - world.y * scale })
    if (clamp) this.clampPan()
    // rebuild selection UI so scale-dependent sizes (stroke, anchors) update
    this.attachSelectionUi()
    this.stage.batchDraw()
    this.onViewChange()
  }

  private pointer(): Pt | null {
    return this.stage.getRelativePointerPosition()
  }

  boardToScreen(p: Pt): Pt {
    const s = this.stage.scaleX()
    return { x: this.stage.x() + p.x * s, y: this.stage.y() + p.y * s }
  }
  screenScale() { return this.stage.scaleX() }

  /* ---------- background ---------- */

  private surround = '#f5f5f7'
  /* The mat, the note band and its rule follow the theme. None of them are
     exported: toFrameCanvas hides the note layer and clips to the board. */
  private dark = false

  private syncPitch() {
    const style = pitchById(this.store.scene.pitch)
    const wantH = style.live ? (this.store.scene.board.h || style.boardH) : style.boardH
    const liveStale = !!style.live && this.loadedLiveVersion !== this.liveVersion
    if (style.id === this.pitchId && this.boardH === wantH && !liveStale) return
    this.pitchId = style.id
    this.boardH = wantH
    this.noteGroup.y(wantH)
    const img = new Image()
    this.pitchImg = img
    img.onload = () => this.drawBackground()
    if (style.custom) {
      // A saved background comes out of the database, so it arrives a frame or
      // two later. The token drops an image whose pitch has been switched away
      // from while it was being read.
      const token = ++this.pitchToken
      this.loadedLiveVersion = this.liveVersion
      void this.backgroundResolver(style.id).then(src => {
        if (token !== this.pitchToken || this.pitchImg !== img) return
        if (src) img.src = src
        else this.drawBackground()
      })
    } else if (style.live) {
      this.pitchToken++
      this.loadedLiveVersion = this.liveVersion
      try { img.src = localStorage.getItem(LIVE_BG_KEY) ?? '' } catch { /* private mode */ }
    } else {
      this.pitchToken++
      img.src = style.src
    }
    this.zoom = 1
    this.fit()
    this.drawBackground()
  }

  /** Select the image source for custom backgrounds without changing the scene. */
  setBackgroundResolver(resolver: (id: string) => Promise<string | null>) {
    this.backgroundResolver = resolver
    this.pitchId = ''
    this.pitchToken++
  }

  setLiveBackground() {
    this.liveVersion++
    this.syncPitch()
  }

  setDarkSurround(dark: boolean) {
    this.dark = dark
    this.surround = dark ? '#000000' : '#f5f5f7'
    this.drawBackground()
    this.rebuildNote()
  }

  /** Reload the background art: a saved background was replaced under us. */
  refreshBackground() {
    this.pitchId = ''
    this.syncPitch()
    this.drawBackground()
  }

  /** True when what is behind the board is one of the user's own images. */
  private userBackground() {
    const style = pitchById(this.store.scene.pitch)
    return !!(style.custom || style.live)
  }

  /** Our mark belongs on our pitch art only. A user-supplied background — a
      saved photograph or an imported broadcast screenshot — replaces our
      graphics entirely, so it carries none of our branding either. */
  private brandsExport() { return !this.userBackground() }

  private drawBackground() {
    const bh = this.boardH
    this.bgLayer.destroyChildren()
    this.bgLayer.add(new Konva.Rect({ x: -2000, y: -2000, width: BOARD_W + 4000, height: bh + 4000, fill: this.tilted ? 'rgba(0,0,0,0)' : this.surround }))
    this.bgLayer.add(new Konva.Rect({ x: 0, y: 0, width: BOARD_W, height: bh, fill: '#ffffff', shadowColor: 'rgba(0,0,0,0.16)', shadowBlur: 14 }))
    const style = pitchById(this.store.scene.pitch)
    if (this.pitchImg.complete && this.pitchImg.naturalWidth) {
      this.bgLayer.add(new Konva.Image({ image: this.pitchImg, x: 0, y: 0, width: BOARD_W, height: bh }))
    } else if (style.missing) {
      this.bgLayer.add(new Konva.Text({
        text: 'This background is not saved on this device.\nPick another one in Settings, Pitch.',
        x: 0, y: bh / 2 - 24, width: BOARD_W,
        align: 'center', fontSize: 20, lineHeight: 1.4,
        fontFamily: 'Inter, system-ui, sans-serif', fill: '#9ca3af',
      }))
    } else if (style.live) {
      this.bgLayer.add(new Konva.Text({
        text: 'Add a background image in Settings, Pitch,\nor import a screenshot with the camera button.',
        x: 0, y: bh / 2 - 24, width: BOARD_W,
        align: 'center', fontSize: 20, lineHeight: 1.4,
        fontFamily: 'Inter, system-ui, sans-serif', fill: '#9ca3af',
      }))
    }
    this.bgLayer.batchDraw()
  }

  /**
   * Remote collaboration previews carry a pitch id, not private account image
   * bytes. Built-in pitch art is cached by id/source; custom backgrounds and
   * live screenshots use a neutral live-pitch fallback.
   */
  private drawRemoteBackground(scene: Scene) {
    const style = pitchById(scene.pitch)
    const bh = style.live ? (scene.board?.h || style.boardH) : style.boardH
    this.remoteBackgroundLayer.destroyChildren()
    this.remoteBackgroundLayer.add(new Konva.Rect({ x: -2000, y: -2000, width: BOARD_W + 4000, height: bh + 4000, fill: this.tilted ? 'rgba(0,0,0,0)' : this.surround }))
    this.remoteBackgroundLayer.add(new Konva.Rect({ x: 0, y: 0, width: BOARD_W, height: bh, fill: '#ffffff', shadowColor: 'rgba(0,0,0,0.16)', shadowBlur: 14 }))
    if (style.src) {
      const key = `${style.id}:${style.src}`
      let image = this.remotePitchImages.get(key)
      if (!image) {
        image = new Image()
        image.onload = () => {
          if (this.remoteScene?.pitch === scene.pitch) {
            this.drawRemoteBackground(this.remoteScene)
            this.remoteBackgroundLayer.batchDraw()
            this.stage.batchDraw()
          }
        }
        image.src = style.src
        this.remotePitchImages.set(key, image)
      }
      if (image.complete && image.naturalWidth) {
        this.remoteBackgroundLayer.add(new Konva.Image({ image, x: 0, y: 0, width: BOARD_W, height: bh, listening: false }))
      }
    } else if (style.live) {
      this.remoteBackgroundLayer.add(new Konva.Text({
        text: 'The collaborator’s own background image is not shared.',
        x: 0, y: bh / 2 - 14, width: BOARD_W, align: 'center', fontSize: 18,
        fontFamily: 'Inter, system-ui, sans-serif', fill: '#9ca3af', listening: false,
      }))
    }
    this.remoteBackgroundLayer.batchDraw()
  }

  /* ---------- match overlay (cog tool): scoreboard + team codes ---------- */

  private drawOverlay(scene: Scene = this.store.scene, layer: Konva.Layer = this.overlayLayer, remote = false) {
    const m = scene.match
    const style = pitchById(scene.pitch)
    const bh = style.live ? (scene.board?.h || style.boardH) : style.boardH
    // Remote pitch art is built in; private custom backgrounds never alter
    // the local export branding rule.
    const FONT = 'Inter, system-ui, sans-serif'
    const SB_FONT = 'Helvetica, Arial, sans-serif'
    layer.destroyChildren()
    if (!m) { layer.batchDraw(); return }
    const live = style.live
    const score = `${m.home || 'Home'} ${m.homeScore || '0'}-${m.awayScore || '0'} ${m.away || 'Away'}`

    if (m.showTeams) {
      const attrs = { fontSize: 24, fontStyle: 'bold', fontFamily: FONT, fill: '#b0b4ba', listening: false }
      const awayLift = style.awayCodeLift ?? 0
      const mk = (text: string, right: boolean) => {
        const t = new Konva.Text({ ...attrs, text: text.toUpperCase() })
        t.y(bh - 18 - t.height() - (right ? awayLift : 0))
        t.x(right ? BOARD_W - 18 - t.width() : 18)
        layer.add(t)
      }
      if (m.home) mk(m.home, false)
      if (m.away) mk(m.away, true)
    }

    if (m.showScoreboard && live) {
      const w = 200
      const h = w * (LIVE_SCOREBOARD_CROP.height / LIVE_SCOREBOARD_CROP.width)
      const g = new Konva.Group({ x: BOARD_W - w, y: bh - h, listening: false })
      g.add(new Konva.Rect({ width: w, height: h, fill: '#ffffff' }))
      const textRight = w * 0.640
      const colCenter = w * 0.831
      const right = (t: Konva.Text, y: number) => { t.position({ x: textRight - t.width(), y }); g.add(t) }

      const clock = new Konva.Text({
        text: m.clock || '', fontSize: 12, fontStyle: 'bold',
        fontFamily: SB_FONT, fill: '#000000', listening: false,
      })
      right(clock, h * 0.151)

      const scoreLine = [m.home, `${m.homeScore || '0'}-${m.awayScore || '0'}`, m.away].filter(Boolean).join(' ')
      const scoreText = new Konva.Text({
        text: scoreLine, fontSize: 8, fontFamily: SB_FONT,
        fill: '#000000', listening: false,
      })
      right(scoreText, h * 0.456)

      if (m.date) {
        const dateText = new Konva.Text({
          text: m.date, fontSize: 8, fontFamily: SB_FONT,
          fill: '#000000', listening: false,
        })
        right(dateText, h * 0.654)
      }

      // The local-only form is: if (this.brandsExport()) {
      if (this.brandsExport() || remote) {
        if (this.logoImg.complete && this.logoImg.naturalWidth) {
          const logoW = w * 0.1225
          const logoH = logoW * (this.logoImg.naturalHeight / this.logoImg.naturalWidth)
          g.add(new Konva.Image({ image: this.logoImg, x: colCenter - logoW / 2, y: h * 0.154, width: logoW, height: logoH, listening: false }))
        }
        const domain = new Konva.Text({
          text: 'tacticsjournal.com', fontSize: 6.5, fontStyle: 'bold',
          fontFamily: SB_FONT, fill: '#000000', listening: false,
        })
        domain.position({ x: colCenter - domain.width() / 2, y: h * 0.687 })
        g.add(domain)
      }

      layer.add(g)
    } else if (m.showScoreboard) {
      const sb = style.scoreboard
      if (sb) {
        const SIZE = 11
        const LINE = 13
        // Local export remains guarded by: if (sb.logo && this.brandsExport()) {
        if (sb.logo && (this.brandsExport() || remote)) {
          const domain = new Konva.Text({
            text: 'tacticsjournal.com', fontSize: SIZE, fontStyle: 'bold',
            fontFamily: FONT, fill: '#000000', listening: false,
          })
          domain.position({ x: sb.x - domain.width() / 2, y: sb.y - 6 - SIZE })
          layer.add(domain)
          if (this.logoImg.complete && this.logoImg.naturalWidth) {
            const lw = 34
            const lh = lw * (this.logoImg.naturalHeight / this.logoImg.naturalWidth)
            layer.add(new Konva.Image({
              image: this.logoImg, x: sb.x - lw / 2, y: domain.y() - 7 - lh,
              width: lw, height: lh, listening: false,
            }))
          }
        }
        const lines = [m.date, score, m.clock].filter(Boolean) as string[]
        let ty = sb.y
        for (const text of lines) {
          const t = new Konva.Text({
            text, fontSize: SIZE, fontFamily: FONT, fill: '#000000', listening: false, y: ty,
          })
          t.x(sb.x - t.width() / 2)
          layer.add(t)
          ty += LINE
        }
      }
    }
    layer.batchDraw()
  }

  /* ---------- scene -> nodes ---------- */

  rebuild() {
    this.syncPitch()
    this.objLayer.destroyChildren()
    for (const o of objectsInDrawOrder(this.store.scene.objects)) {
      const node = this.buildNode(o)
      if (node) this.objLayer.add(node as any)
    }
    this.drawOverlay()
    this.attachSelectionUi()
    this.stage.batchDraw()
  }

  /** Replace a single object's Konva node in-place (for live resize/scale). */
  private rebuildObjectNode(o: SceneObj) {
    const old = this.objLayer.findOne(`#${o.id}`)
    if (!old) return
    const newNode = this.buildNode(o)
    if (!newNode) return
    // insert at same z-index
    const idx = old.zIndex()
    old.destroy()
    this.objLayer.add(newNode as any)
    try { (newNode as any).zIndex(idx) } catch { /* ignore if out of range */ }
    this.objLayer.batchDraw()
  }

  private iconScale() { return (pitchById((this.renderingScene ?? this.store.scene).pitch).sides ?? 1) > 1 ? 0.5 : 1 }
  /** Broadcast stills keep the finer arrow scale; drawn pitches keep the heavier one. */
  private arrowsAreLive() { return !!pitchById((this.renderingScene ?? this.store.scene).pitch).live }

  private buildNode(o: SceneObj): Konva.Node | null {
    switch (o.type) {
      case 'player': return this.buildPlayer(o)
      case 'ball': return this.buildBall(o)
      case 'cone': return this.buildCone(o)
      case 'goal': return this.buildGoal(o)
      case 'image': return this.buildImage(o)
      case 'marker': return this.buildMarker(o)
      case 'arrow': return this.buildArrow(o)
      case 'box': return this.buildBox(o)
      case 'text': return this.buildText(o)
    }
  }

  private common(node: Konva.Node, o: SceneObj) {
    node.id(o.id)
  }

  private buildPlayer(o: PlayerObj): Konva.Node {
    const k = this.iconScale()
    const r = o.r * k
    const g = new Konva.Group({ x: o.x, y: o.y, rotation: o.rotation ?? 0 })
    const hitR = Math.max(r + 14, 28)
    const sx = o.flipX ? -1 : 1
    const sy = o.flipY ? -1 : 1
    g.add(new Konva.Circle({
      radius: r,
      fill: o.color,
      stroke: '#0b0b0e',
      strokeWidth: Math.max(1.25, r * 0.38),
      perfectDrawEnabled: false,
      shadowForStrokeEnabled: false,
      shadowColor: 'rgba(0,0,0,0.3)',
      shadowBlur: r * 0.35,
      shadowOffset: { x: r * 0.12, y: r * 0.18 },
      scaleX: sx,
      scaleY: sy,
      hitFunc(ctx, sh) {
        ctx.beginPath()
        ctx.arc(0, 0, hitR, 0, Math.PI * 2)
        ctx.closePath()
        ctx.fillStrokeShape(sh)
      },
    }))
    if (o.label) {
      g.add(new Konva.Text({
        text: o.label,
        fontSize: r * 1.05,
        fontStyle: 'bold',
        fontFamily: 'Inter, system-ui, sans-serif',
        fill: isLight(o.color) ? '#111827' : '#ffffff',
        align: 'center', verticalAlign: 'middle',
        width: r * 2, height: r * 2,
        offset: { x: r, y: r - 0.5 },
        listening: false,
        perfectDrawEnabled: false,
      }))
    }
    if (o.name) {
      const fontSize = (o.nameSize ?? 18) * k
      const gap = 5 * k
      g.add(new Konva.Text({
        text: playerDisplayName(o.name, o.nameDisplay ?? 'last'),
        fontSize,
        fontStyle: 'bold',
        fontFamily: 'Inter, system-ui, sans-serif',
        fill: '#111827',
        align: 'center',
        width: 160,
        offset: { x: 80, y: 0 },
        y: o.namePos === 'top' ? -(r + gap + fontSize) : r + gap,
        listening: false,
        perfectDrawEnabled: false,
      }))
    }
    this.common(g, o)
    return g
  }

  private buildBall(o: BallObj): Konva.Node {
    const size = o.size * this.iconScale()
    const pad = Math.max(14, (52 - size) / 2)
    const node = new Konva.Image({
      image: this.ballImg,
      rotation: o.rotation ?? 0,
      x: o.x, y: o.y,
      width: size, height: size,
      offset: { x: size / 2, y: size / 2 },
      perfectDrawEnabled: false,
      scaleX: o.flipX ? -1 : 1,
      scaleY: o.flipY ? -1 : 1,
      hitFunc(ctx, sh) {
        ctx.beginPath()
        ctx.rect(-pad, -pad, size + pad * 2, size + pad * 2)
        ctx.closePath()
        ctx.fillStrokeShape(sh)
      },
    })
    this.common(node, o)
    return node
  }

  private buildCone(o: ConeObj): Konva.Node {
    const size = o.size * this.iconScale()
    const w = size, h = size * CONE_ASPECT
    const pad = Math.max(14, (52 - w) / 2)
    const node = new Konva.Image({
      image: this.coneImg,
      rotation: o.rotation ?? 0,
      x: o.x, y: o.y,
      width: w, height: h,
      offset: { x: w / 2, y: h / 2 },
      perfectDrawEnabled: false,
      scaleX: o.flipX ? -1 : 1,
      scaleY: o.flipY ? -1 : 1,
      hitFunc(ctx, sh) {
        ctx.beginPath()
        ctx.rect(-pad, -pad, w + pad * 2, h + pad * 2)
        ctx.closePath()
        ctx.fillStrokeShape(sh)
      },
    })
    this.common(node, o)
    return node
  }

  private buildGoal(o: GoalObj): Konva.Node {
    const w = o.size * this.iconScale()
    const h = w * GOAL_ASPECT[o.variant]
    const pad = 8
    const node = new Konva.Image({
      image: this.goalImgs[o.variant],
      rotation: o.rotation ?? 0,
      x: o.x, y: o.y,
      width: w, height: h,
      offset: { x: w / 2, y: h / 2 },
      perfectDrawEnabled: false,
      scaleX: o.flipX ? -1 : 1,
      scaleY: o.flipY ? -1 : 1,
      hitFunc(ctx, sh) {
        ctx.beginPath()
        ctx.rect(-pad, -pad, w + pad * 2, h + pad * 2)
        ctx.closePath()
        ctx.fillStrokeShape(sh)
      },
    })
    this.common(node, o)
    return node
  }

  /**
   * A user asset. The bitmap is loaded once per asset and cached; a board that
   * references an asset this device does not have draws nothing rather than
   * failing, which is what makes a shared board safe to open.
   */
  private assetImgs = new Map<string, HTMLImageElement>()
  private assetImage(assetId: string): HTMLImageElement | undefined {
    const hit = this.assetImgs.get(assetId)
    if (hit) return hit
    const asset = getAsset(assetId)
    if (!asset) return undefined
    const img = new Image()
    img.onload = () => {
      this.rebuild()
      // An end frame may wait for durable sync for several seconds. Repaint it
      // when its local asset becomes available rather than leaving a gap.
      if (this.remotePreviewActive && this.remoteScene) this.renderRemotePreview(this.remoteScene)
    }
    img.src = asset.src
    this.assetImgs.set(assetId, img)
    return img
  }

  private buildImage(o: ImageObj): Konva.Node {
    const w = o.size * this.iconScale()
    const h = w * (o.aspect || 1)
    const pad = 6
    const node = new Konva.Image({
      image: this.assetImage(o.assetId),
      rotation: o.rotation ?? 0,
      x: o.x, y: o.y,
      width: w, height: h,
      offset: { x: w / 2, y: h / 2 },
      perfectDrawEnabled: false,
      scaleX: o.flipX ? -1 : 1,
      scaleY: o.flipY ? -1 : 1,
      hitFunc(ctx, sh) {
        ctx.beginPath()
        ctx.rect(-pad, -pad, w + pad * 2, h + pad * 2)
        ctx.closePath()
        ctx.fillStrokeShape(sh)
      },
    })
    this.common(node, o)
    return node
  }

  private buildMarker(o: MarkerObj): Konva.Node {
    const k = this.iconScale()
    const g = new Konva.Group({ x: o.x, y: o.y, rotation: o.rotation ?? 0 })
    const w = o.w * k
    const h = w * (LIVE_PLAYER_CROP.height / LIVE_PLAYER_CROP.width)
    const ex = w * LIVE_MARKER_ELLIPSE.cx
    const ey = h * LIVE_MARKER_ELLIPSE.cy
    const rx = w * LIVE_MARKER_ELLIPSE.rx
    const ry = h * LIVE_MARKER_ELLIPSE.ry
    g.add(new Konva.Image({
      image: this.livePlayerImg,
      crop: LIVE_PLAYER_CROP,
      width: w,
      height: h,
      offset: { x: ex, y: ey },
      scaleX: o.flipX ? -1 : 1,
      scaleY: o.flipY ? -1 : 1,
      perfectDrawEnabled: false,
      // hit shapes are traced in the image's own space, where (0,0) is its
      // top-left corner, not the anchor the offset moved it to
      hitFunc(ctx, sh) {
        ctx.beginPath()
        ctx.ellipse(ex, ey, Math.max(rx + 14, 28), Math.max(ry + 14, 24), 0, 0, Math.PI * 2)
        ctx.closePath()
        ctx.fillStrokeShape(sh)
      },
    }))
    if (o.name) {
      const fontSize = 15 * k
      const gap = 7 * k
      g.add(new Konva.Text({
        text: playerDisplayName(o.name, 'last'),
        fontSize,
        fontStyle: 'bold',
        fontFamily: 'Inter, system-ui, sans-serif',
        fill: '#ffffff',
        shadowColor: 'rgba(0,0,0,0.55)',
        shadowBlur: 4,
        align: 'center',
        width: 160,
        offset: { x: 80, y: 0 },
        y: o.namePos === 'top' ? -(ry + gap + fontSize) : ry + gap,
        listening: false,
        perfectDrawEnabled: false,
      }))
    }
    this.common(g, o)
    return g
  }

  private buildArrow(o: ArrowObj): Konva.Node {
    const g = new Konva.Group({ x: 0, y: 0 })
    g.add(makeArrowShape(o, this.iconScale(), this.arrowsAreLive()))
    this.common(g, o)
    return g
  }

  private buildBox(o: BoxObj): Konva.Node {
    const k = this.iconScale()
    // corner-based rendering for rect/outline
    if (o.corners && o.corners.length >= 3) {
      const g = new Konva.Group({ x: 0, y: 0 })
      const nodes = o.corners
      const outline = o.shape === 'outline'
      g.add(new Konva.Shape({
        fill: outline ? undefined : o.fill,
        stroke: outline ? o.fill : undefined,
        strokeWidth: outline ? 4 * k : 0,
        opacity: outline ? 1 : o.opacity,
        perfectDrawEnabled: false,
        sceneFunc(ctx, sh) {
          traceNodes(ctx as any, nodes, true)
          if (outline) ctx.strokeShape(sh)
          else ctx.fillShape(sh)
        },
        hitFunc(ctx, sh) {
          traceNodes(ctx as any, nodes, true)
          ctx.fillStrokeShape(sh)
        },
      }))
      if (o.shape === 'outline' && o.label) {
        const bb = nodesBBox(o.corners, true)
        const cx = bb.x + bb.width / 2
        const cy = bb.y + bb.height / 2
        const minY = bb.y, maxY = bb.y + bb.height
        const minX = bb.x, maxX = bb.x + bb.width
        const text = new Konva.Text({
          text: o.label,
          fontSize: 18 * k,
          fontStyle: 'bold',
          fontFamily: 'Inter, system-ui, sans-serif',
          fill: o.fill,
          listening: false,
        })
        const tw = text.width(), th = text.height()
        const gap = 8 * k
        const pos = o.labelPos || 'top'
        if (pos === 'top') text.position({ x: cx - tw / 2, y: minY - th - gap })
        else if (pos === 'bottom') text.position({ x: cx - tw / 2, y: maxY + gap })
        else if (pos === 'left') text.position({ x: minX - tw - gap, y: cy - th / 2 })
        else text.position({ x: maxX + gap, y: cy - th / 2 })
        g.add(text)
      }
      this.common(g, o)
      return g
    }
    // ovals and triangles (no corners)
    const w = o.w * k
    const h = o.h * k
    const g = new Konva.Group({
      x: o.x, y: o.y,
      rotation: o.rotation,
      scaleX: o.flipX ? -1 : 1,
      scaleY: o.flipY ? -1 : 1,
    })
    const shapeAttrs = {
      fill: o.shape === 'outline' ? undefined : o.fill,
      stroke: o.shape === 'outline' ? o.fill : undefined,
      strokeWidth: o.shape === 'outline' ? 4 * k : 0,
      opacity: o.shape === 'outline' ? 1 : o.opacity,
      perfectDrawEnabled: false,
    }
    const shape: Konva.Shape = o.shape === 'triangle'
      ? new Konva.Line({ ...shapeAttrs, points: trianglePoints(w, h), closed: true })
      : new Konva.Ellipse({ ...shapeAttrs, radiusX: w / 2, radiusY: h / 2 })
    g.add(shape)
    this.common(g, o)
    // Transformer changes are copied into the gesture scene, but Store emits
    // only at its end. That gives collaboration a real scene between frames.
    let initial: BoxObj | null = null
    g.on('transformstart', () => {
      initial = JSON.parse(JSON.stringify(this.store.obj(o.id))) as BoxObj
      this.store.beginGesture()
      this.onPointerActivity(true)
    })
    g.on('transform', () => {
      const obj = this.store.obj(o.id) as BoxObj | undefined
      if (!obj || !initial) return
      const sx = g.scaleX(), sy = g.scaleY()
      obj.flipX = Boolean(initial.flipX) !== (sx < 0)
      obj.flipY = Boolean(initial.flipY) !== (sy < 0)
      obj.w = Math.max(8, initial.w * Math.abs(sx))
      obj.h = Math.max(8, initial.h * Math.abs(sy))
      obj.rotation = g.rotation()
      obj.x = g.x(); obj.y = g.y()
      this.publishPreview('update')
    })
    g.on('transformend', () => {
      if (!initial) return
      g.scale({ x: 1, y: 1 })
      this.publishPreview('end')
      this.store.endGesture()
      this.onPointerActivity(false)
      initial = null
    })
    return g
  }

  private buildText(o: TextObj): Konva.Node {
    const k = this.iconScale()
    const node = new Konva.Text({
      x: o.x, y: o.y,
      text: o.text,
      fontSize: o.size * k,
      fontStyle: o.bold ? 'bold' : 'normal',
      fontFamily: 'Inter, system-ui, sans-serif',
      fill: o.color,
      rotation: o.rotation,
      perfectDrawEnabled: false,
      scaleX: o.flipX ? -1 : 1,
      scaleY: o.flipY ? -1 : 1,
      hitFunc(ctx, sh) {
        const pad = 16
        ctx.beginPath()
        ctx.rect(-pad, -pad, sh.width() + pad * 2, sh.height() + pad * 2)
        ctx.closePath()
        ctx.fillStrokeShape(sh)
      },
    })
    this.common(node, o)
    let initial: TextObj | null = null
    node.on('transformstart', () => {
      initial = JSON.parse(JSON.stringify(this.store.obj(o.id))) as TextObj
      this.store.beginGesture()
      this.onPointerActivity(true)
    })
    node.on('transform', () => {
      const obj = this.store.obj(o.id) as TextObj | undefined
      if (!obj || !initial) return
      const sx = node.scaleX(), sy = node.scaleY()
      obj.flipX = Boolean(initial.flipX) !== (sx < 0)
      obj.flipY = Boolean(initial.flipY) !== (sy < 0)
      obj.size = Math.max(8, initial.size * Math.abs(sy))
      obj.rotation = node.rotation()
      obj.x = node.x(); obj.y = node.y()
      this.publishPreview('update')
    })
    node.on('transformend', () => {
      if (!initial) return
      node.scale({ x: 1, y: 1 })
      this.publishPreview('end')
      this.store.endGesture()
      this.onPointerActivity(false)
      initial = null
    })
    return node
  }

  /* ---------- selection ui ---------- */

  private attachSelectionUi() {
    this.uiLayer.find('.anchor, .anchor-stem, .selbox, .resize-node, .edit-icon').forEach(n => n.destroy())
    const ids = this.store.selectedIds

    // node-edit mode: show anchors for the locked object
    if (this.interactionState === 'node-edit' && this.nodeEditId) {
      this.transformer.nodes([])
      const obj = this.store.obj(this.nodeEditId)
      if (!obj) return
      this.addNodeAnchors(obj.id)
      return
    }

    if (!ids.length) {
      this.transformer.nodes([])
      return
    }

    // multi-select: outlines only
    if (ids.length > 1) {
      this.transformer.nodes([])
      for (const id of ids) {
        const sel = this.store.obj(id)
        if (sel) this.addSelectionOutline(sel)
      }
      return
    }

    // single selection
    const sel = this.store.selected!

    // text: use Konva Transformer
    if (sel.type === 'text') {
      const node = this.objLayer.findOne(`#${sel.id}`)
      if (!node) { this.transformer.nodes([]); return }
      this.transformer.setAttrs({ enabledAnchors: ['top-left', 'top-right', 'bottom-left', 'bottom-right'], rotateEnabled: true, keepRatio: true })
      // The Transformer draws its own border in the same blue, so the dashed
      // halo would only be a second box around the same letters.
      this.transformer.nodes([node as any])
      return
    }

    // Dashed outline, resize node, and edit icon where supported. Every zone
    // uses these controls. Ovals and triangles keep their exact native shape
    // until the pencil materializes their edit nodes.
    this.transformer.nodes([])
    this.addSelectionOutline(sel)
    this.addResizeNode(sel)
    if (hasNodeEdit(sel)) this.addEditIcon(sel)
  }

  /** Dashed halo so a selected object is visibly selected. */
  private addSelectionOutline(sel: SceneObj) {
    const r = this.objectRect(sel)
    const pad = 5
    const outline = new Konva.Rect({
      name: 'selbox',
      x: r.x - pad, y: r.y - pad,
      width: r.width + pad * 2, height: r.height + pad * 2,
      stroke: '#4a90d9',
      strokeWidth: 1.5 / this.screenScale(),
      dash: [6 / this.screenScale(), 4 / this.screenScale()],
      cornerRadius: 6,
      listening: false,
    })
    outline.setAttr('selectionId', sel.id)
    this.uiLayer.add(outline)
  }

  /** Keep every selected object's halo attached while gesture data changes. */
  private syncSelectionUiDuringMove() {
    const pad = 5
    this.uiLayer.find('.selbox').forEach(node => {
      const id = node.getAttr('selectionId')
      if (typeof id !== 'string') return
      const obj = this.store.obj(id)
      if (!obj) return
      const rect = this.objectRect(obj)
      node.setAttrs({
        x: rect.x - pad,
        y: rect.y - pad,
        width: rect.width + pad * 2,
        height: rect.height + pad * 2,
      })
    })
    if (this.transformer.nodes().length) this.transformer.forceUpdate()
  }

  /** Draggable circle at top-right of selection box for scaling. */
  private addResizeNode(sel: SceneObj) {
    const rect = this.objectRect(sel)
    const pad = 5
    const r = Math.min(12, Math.max(5, 8 / this.screenScale()))
    const hitR = Math.max(r * 1.5, 18 / this.screenScale())
    const cx = rect.x + rect.width + pad
    const cy = rect.y - pad
    const center = objCenter(sel)
    const startDist = Math.hypot(cx - center.x, cy - center.y) || 1
    // snapshot the original state so we always scale from the original, not compounding
    const origSnapshot = JSON.parse(JSON.stringify(sel))

    const a = new Konva.Circle({
      name: 'resize-node',
      x: cx, y: cy,
      radius: r,
      fill: '#ffffff',
      stroke: '#4a90d9', strokeWidth: 2,
      draggable: true,
      dragDistance: 8,
      hitFunc(ctx, sh) {
        ctx.beginPath()
        ctx.arc(0, 0, hitR, 0, Math.PI * 2)
        ctx.closePath()
        ctx.fillStrokeShape(sh)
      },
    })
    // Press and hold the node, then drag, to rotate instead of resize.
    const startAngle = Math.atan2(cy - center.y, cx - center.x)
    let mode: 'scale' | 'rotate' = 'scale'
    let holdTimer: number | null = null
    const clearHold = () => {
      if (holdTimer !== null) { clearTimeout(holdTimer); holdTimer = null }
    }
    {
      a.on('pointerdown', () => {
        clearHold()
        holdTimer = window.setTimeout(() => {
          holdTimer = null
          mode = 'rotate'
          a.fill('#4a90d9')
          this.uiLayer.batchDraw()
        }, 350)
      })
      a.on('pointerup pointercancel', () => {
        clearHold()
        // a hold that never became a drag leaves the node highlighted
        if (mode === 'rotate') { mode = 'scale'; this.rebuild() }
      })
    }
    a.on('dragstart', () => { clearHold(); this.store.beginGesture() })
    a.on('dragmove', () => {
      const p = a.position()
      if (mode === 'rotate') {
        const angle = Math.atan2(p.y - center.y, p.x - center.x)
        let deg = ((angle - startAngle) * 180) / Math.PI
        // ease onto the straight angles coaches actually want
        const near = Math.round(deg / 15) * 15
        if (Math.abs(deg - near) < 5) deg = near
        this.restoreObject(sel, origSnapshot)
        this.rotateObject(sel, deg, center)
        this.rebuildObjectNode(sel)
        const rotRect = this.objectRect(sel)
        const rotBox = this.uiLayer.findOne('.selbox') as Konva.Rect | null
        if (rotBox) {
          const sp = 5
          rotBox.setAttrs({ x: rotRect.x - sp, y: rotRect.y - sp, width: rotRect.width + sp * 2, height: rotRect.height + sp * 2 })
        }
        this.uiLayer.batchDraw()
        this.onRotation(this.angleOf(sel, deg))
        this.publishPreview('update')
        return
      }
      const dist = Math.hypot(p.x - center.x, p.y - center.y) || 1
      const scale = dist / startDist
      // restore from snapshot first, then apply scale (no compounding)
      this.restoreObject(sel, origSnapshot)
      this.scaleObject(sel, scale, center)
      // rebuild the object's visual node so it renders at the new size
      this.rebuildObjectNode(sel)
      // update the dashed selection box to follow
      const newRect = this.objectRect(sel)
      const selbox = this.uiLayer.findOne('.selbox') as Konva.Rect | null
      if (selbox) {
        const sp = 5
        selbox.setAttrs({ x: newRect.x - sp, y: newRect.y - sp, width: newRect.width + sp * 2, height: newRect.height + sp * 2 })
      }
      this.uiLayer.batchDraw()
      this.publishPreview('update')
    })
    a.on('dragend', () => {
      clearHold()
      mode = 'scale'
      this.onRotation(null)
      this.publishPreview('end')
      this.store.endGesture()
      this.rebuild()
    })
    this.uiLayer.add(a)
  }

  /** Restore an object's geometry from a snapshot (for non-compounding resize). */
  private restoreObject(sel: SceneObj, snap: any) {
    if (sel.type === 'arrow') {
      sel.x1 = snap.x1; sel.y1 = snap.y1
      sel.mx = snap.mx; sel.my = snap.my
      sel.x2 = snap.x2; sel.y2 = snap.y2
    } else if (sel.type === 'box') {
      sel.x = snap.x; sel.y = snap.y; sel.w = snap.w; sel.h = snap.h
      if (snap.corners) {
        sel.corners = JSON.parse(JSON.stringify(snap.corners))
      }
    } else if (sel.type === 'player') {
      sel.r = snap.r
    } else if (sel.type === 'ball' || sel.type === 'cone' || sel.type === 'goal' || sel.type === 'image') {
      (sel as any).size = snap.size
    } else if (sel.type === 'marker') {
      sel.w = snap.w
    }
    if (typeof snap.rotation === 'number') (sel as any).rotation = snap.rotation
  }

  /**
   * The angle to read out for an object mid-turn: its own, or for an arrow -
   * which keeps its bearing in its points rather than an angle - how far the
   * drag has carried it.
   */
  angleOf(sel: SceneObj, delta: number) {
    const own = (sel as any).rotation as number | undefined
    return normalizeDeg(typeof own === 'number' ? own : delta)
  }

  /** Turn an object by a number of degrees about a center point. */
  private rotateObject(sel: SceneObj, deg: number, center: Pt) {
    const rad = (deg * Math.PI) / 180
    const cos = Math.cos(rad), sin = Math.sin(rad)
    const turn = (x: number, y: number) => ({
      x: center.x + (x - center.x) * cos - (y - center.y) * sin,
      y: center.y + (x - center.x) * sin + (y - center.y) * cos,
    })
    const spin = (h: Pt) => ({ x: h.x * cos - h.y * sin, y: h.x * sin + h.y * cos })
    if (sel.type === 'arrow') {
      const p1 = turn(sel.x1, sel.y1), pm = turn(sel.mx, sel.my), p2 = turn(sel.x2, sel.y2)
      sel.x1 = p1.x; sel.y1 = p1.y
      sel.mx = pm.x; sel.my = pm.y
      sel.x2 = p2.x; sel.y2 = p2.y
      if (sel.points) {
        for (const n of sel.points) {
          const p = turn(n.x, n.y)
          n.x = p.x; n.y = p.y
          if (n.h1) n.h1 = spin(n.h1)
          if (n.h2) n.h2 = spin(n.h2)
        }
        syncArrowLegacy(sel)
      }
      return
    }
    if (sel.type === 'box' && sel.corners) {
      // free-form boxes keep their angle in the corners themselves
      for (const c of sel.corners) {
        const p = turn(c.x, c.y)
        c.x = p.x; c.y = p.y
        if (c.h1) c.h1 = spin(c.h1)
        if (c.h2) c.h2 = spin(c.h2)
      }
      sel.x = sel.corners.reduce((a, c) => a + c.x, 0) / sel.corners.length
      sel.y = sel.corners.reduce((a, c) => a + c.y, 0) / sel.corners.length
      sel.rotation = (((sel.rotation + deg) % 360) + 360) % 360
      return
    }
    const o = sel as any
    o.rotation = ((((o.rotation ?? 0) + deg) % 360) + 360) % 360
    // pieces off the centre of rotation also travel around it
    const p = turn(o.x, o.y)
    o.x = p.x; o.y = p.y
  }

  /** Scale an object uniformly around a center point by a factor. */
  private scaleObject(sel: SceneObj, scale: number, center: Pt) {
    const s = (x: number, y: number) => ({
      x: center.x + (x - center.x) * scale,
      y: center.y + (y - center.y) * scale,
    })
    const grow = (h: Pt) => ({ x: h.x * scale, y: h.y * scale })
    if (sel.type === 'arrow') {
      const p1 = s(sel.x1, sel.y1), pm = s(sel.mx, sel.my), p2 = s(sel.x2, sel.y2)
      sel.x1 = p1.x; sel.y1 = p1.y
      sel.mx = pm.x; sel.my = pm.y
      sel.x2 = p2.x; sel.y2 = p2.y
      if (sel.points) {
        for (const n of sel.points) {
          const p = s(n.x, n.y)
          n.x = p.x; n.y = p.y
          if (n.h1) n.h1 = grow(n.h1)
          if (n.h2) n.h2 = grow(n.h2)
        }
        syncArrowLegacy(sel)
      }
    } else if (sel.type === 'box' && sel.corners) {
      for (const c of sel.corners) {
        const p = s(c.x, c.y)
        c.x = p.x; c.y = p.y
        if (c.h1) c.h1 = grow(c.h1)
        if (c.h2) c.h2 = grow(c.h2)
      }
      sel.x = sel.corners.reduce((a, c) => a + c.x, 0) / sel.corners.length
      sel.y = sel.corners.reduce((a, c) => a + c.y, 0) / sel.corners.length
      sel.w = Math.max(8, sel.w * scale)
      sel.h = Math.max(8, sel.h * scale)
    } else if (sel.type === 'player') {
      sel.r = Math.max(5, sel.r * scale)
    } else if (sel.type === 'ball' || sel.type === 'cone' || sel.type === 'goal' || sel.type === 'image') {
      (sel as any).size = Math.max(8, (sel as any).size * scale)
    } else if (sel.type === 'marker') {
      sel.w = Math.max(16, sel.w * scale)
    }
  }

  /** Pencil icon at bottom-right of selection box; tap enters node editing. */
  private addEditIcon(sel: SceneObj) {
    const rect = this.objectRect(sel)
    const pad = 5
    const r = Math.min(16, Math.max(8, 12 / this.screenScale()))
    // generous hit area: at least 24px in screen space
    const hitR = Math.max(r * 2, 24 / this.screenScale())
    const cx = rect.x + rect.width + pad
    const cy = rect.y + rect.height + pad

    const self = this
    // single circle with pencil drawn inside; the circle IS the hit target
    const circle = new Konva.Circle({
      name: 'edit-icon',
      x: cx, y: cy,
      radius: r,
      fill: '#4a90d9',
      stroke: '#ffffff',
      strokeWidth: 1.5,
      hitFunc(ctx, sh) {
        ctx.beginPath()
        ctx.arc(0, 0, hitR, 0, Math.PI * 2)
        ctx.closePath()
        ctx.fillStrokeShape(sh)
      },
      sceneFunc(ctx, sh) {
        // draw the blue circle
        ctx.beginPath()
        ctx.arc(0, 0, r, 0, Math.PI * 2)
        ctx.closePath()
        ctx.fillStrokeShape(sh)
        // draw pencil icon inside
        const s = r * 0.45
        const native = (ctx as any)._context as CanvasRenderingContext2D
        native.save()
        native.strokeStyle = '#ffffff'
        native.fillStyle = '#ffffff'
        native.lineWidth = Math.max(1.5, r * 0.18)
        native.lineCap = 'round'
        native.lineJoin = 'round'
        // pencil shaft
        native.beginPath()
        native.moveTo(-s, s)
        native.lineTo(s, -s)
        native.stroke()
        // pencil tip
        native.beginPath()
        native.moveTo(-s * 1.15, s * 1.15)
        native.lineTo(-s * 0.6, s * 1.15)
        native.lineTo(-s * 1.15, s * 0.6)
        native.closePath()
        native.fill()
        native.restore()
      },
    })
    circle.on('pointerdown', (e) => {
      // stop the stage's pointerdown from processing this as a board tap
      e.cancelBubble = true
    })
    circle.on('pointerup click tap', (e) => {
      e.cancelBubble = true
      self.enterNodeEdit(sel.id)
    })
    this.uiLayer.add(circle)
  }

  /**
   * Node editing works on one list of nodes, whatever the object is: a zone's
   * corners closed into a loop, an arrow's points left open. Anchors are named
   * `anchor-node-<i>`, and the handles either side of the selected node
   * `anchor-h1-<i>` / `anchor-h2-<i>`.
   */
  private editPath(id: string | null = this.nodeEditId): { obj: SceneObj; nodes: PathNode[]; closed: boolean } | null {
    if (!id) return null
    const obj = this.store.obj(id)
    if (!obj) return null
    if (obj.type === 'arrow') return { obj, nodes: materializeArrowNodes(obj), closed: false }
    if (obj.type === 'box') return { obj, nodes: materializeBoxNodes(obj), closed: true }
    return null
  }

  /** After any node edit: keep the legacy fields and the centre in step. */
  private afterNodeChange(obj: SceneObj) {
    if (obj.type === 'arrow') syncArrowLegacy(obj)
    else if (obj.type === 'box' && obj.corners?.length) {
      obj.x = obj.corners.reduce((a, c) => a + c.x, 0) / obj.corners.length
      obj.y = obj.corners.reduce((a, c) => a + c.y, 0) / obj.corners.length
    }
  }

  private nodeIndexOf(name: string): { kind: 'node' | 'h1' | 'h2'; i: number } | null {
    const m = /^anchor-(node|h1|h2)-(\d+)$/.exec(name)
    if (!m) return null
    return { kind: m[1] as 'node' | 'h1' | 'h2', i: Number(m[2]) }
  }

  /** The one selected node, when exactly one is selected and still exists. */
  selectedNodeIndex(): number | null {
    if (this.selectedNodes.size !== 1) return null
    const only = this.selectedNodes.values().next().value as string
    const parsed = this.nodeIndexOf(only)
    if (!parsed || parsed.kind !== 'node') return null
    const path = this.editPath()
    if (path && parsed.i >= path.nodes.length) return null
    return parsed.i
  }

  /** What the options tray needs to draw itself: the node and what it allows. */
  nodeEditInfo(): { count: number; index: number | null; curve: NodeCurve | null; canRemove: boolean; canAdd: boolean } | null {
    const path = this.editPath()
    if (!path) return null
    const i = this.selectedNodeIndex()
    const measure = path.obj.type === 'arrow' && !!path.obj.measure
    const min = path.obj.type === 'arrow' ? 3 : path.closed ? MIN_NODES.closed : MIN_NODES.open
    return {
      count: path.nodes.length,
      index: i,
      curve: i === null ? null : nodeCurve(path.nodes[i]),
      canRemove: !measure && i !== null && path.nodes.length > min,
      canAdd: !measure,
    }
  }

  /** Set the curve through the selected node. */
  setSelectedNodeCurve(curve: NodeCurve) {
    const path = this.editPath()
    const i = this.selectedNodeIndex()
    if (!path || i === null) return
    this.store.apply(() => {
      setNodeCurve(path.nodes, i, curve, path.closed)
      this.afterNodeChange(path.obj)
    })
    this.rebuild()
  }

  /** Remove the selected node, so long as the shape survives it. */
  removeSelectedNode() {
    const path = this.editPath()
    const i = this.selectedNodeIndex()
    const info = this.nodeEditInfo()
    if (!path || i === null || !info?.canRemove) return
    // let go of the node first: the store notifies while it is being removed,
    // and a listener asking about a node that is no longer there is a crash
    this.selectedNodes.clear()
    this.nodeMultiSelect = false
    this.store.apply(() => {
      path.nodes.splice(i, 1)
      this.afterNodeChange(path.obj)
    })
    this.rebuild()
    this.onInteractionStateChange()
  }

  /**
   * Put a node on the outline nearest a board point, and select it. Returns
   * false when the tap was nowhere near the line.
   */
  addNodeNear(p: Pt, reach: number): boolean {
    const path = this.editPath()
    if (!path || !this.nodeEditInfo()?.canAdd) return false
    const hit = nearestOnPath(path.nodes, path.closed, p)
    if (!hit || hit.dist > reach / this.screenScale()) return false
    let index = 0
    this.store.apply(() => {
      index = insertNodeAt(path.nodes, hit)
      this.afterNodeChange(path.obj)
    })
    this.selectedNodes.clear()
    this.selectedNodes.add(`anchor-node-${index}`)
    this.nodeMultiSelect = false
    this.rebuild()
    this.onInteractionStateChange()
    return true
  }

  /** Whether a board point is close enough to the edited outline to count. */
  nearEditedPath(p: Pt, reach: number): boolean {
    const path = this.editPath()
    if (!path) return false
    const hit = nearestOnPath(path.nodes, path.closed, p)
    return !!hit && hit.dist <= reach / this.screenScale()
  }

  /**
   * A zone always shows its curve handles. An arrow shows them only while its
   * selected node is set to Free. Automatic arrow modes keep all of the
   * surrounding handles hidden, even when a neighbouring node is hand-bent.
   */
  private showsHandles(obj: SceneObj, nodes: PathNode[], selectedIndex: number): boolean {
    if (obj.type !== 'arrow') return true
    return nodeCurve(nodes[selectedIndex]) === 'free'
  }

  /** One dot per node, plus the handles around the selected one. */
  private addNodeAnchors(id: string) {
    const path = this.editPath(id)
    if (!path) return
    const { nodes, closed } = path
    const scale = this.screenScale()

    const selectedIndex = this.selectedNodeIndex()
    if (selectedIndex !== null && selectedIndex < nodes.length) {
      // the selected node's own two handles, and the one square each
      // neighbour turns toward it: the handles shaping the segments in view
      const around: Array<{ i: number; key: 'h1' | 'h2'; lead: boolean }> = [
        { i: selectedIndex, key: 'h1', lead: true },
        { i: selectedIndex, key: 'h2', lead: true },
      ]
      const prev = closed ? (selectedIndex - 1 + nodes.length) % nodes.length : selectedIndex - 1
      const next = closed ? (selectedIndex + 1) % nodes.length : selectedIndex + 1
      if (prev >= 0) around.push({ i: prev, key: 'h2', lead: false })
      if (next < nodes.length) around.push({ i: next, key: 'h1', lead: false })

      for (const item of around) {
        if (!this.showsHandles(path.obj, nodes, selectedIndex)) continue
        const node = nodes[item.i]
        const h = nodeHandles(nodes, item.i, closed)[item.key]
        if (Math.hypot(h.x, h.y) < 5) continue
        const at = { x: node.x + h.x, y: node.y + h.y }
        this.uiLayer.add(new Konva.Line({
          name: 'anchor-stem',
          points: [node.x, node.y, at.x, at.y],
          stroke: '#e07a1f',
          strokeWidth: (item.lead ? 1.4 : 1.1) / scale,
          opacity: item.lead ? 1 : 0.75,
          listening: false,
        }))
        const size = Math.min(16, Math.max(7, 10 / scale))
        const hitR = Math.max(size, 20 / scale)
        this.uiLayer.add(new Konva.Rect({
          name: `anchor anchor-${item.key}-${item.i}`,
          x: at.x - size / 2, y: at.y - size / 2,
          width: size, height: size,
          fill: '#ffffff',
          stroke: '#e07a1f',
          strokeWidth: 1.8 / scale,
          hitFunc(ctx, sh) {
            ctx.beginPath()
            ctx.rect(-hitR + size / 2, -hitR + size / 2, hitR * 2, hitR * 2)
            ctx.closePath()
            ctx.fillStrokeShape(sh)
          },
        }))
      }
    }

    nodes.forEach((node, i) => {
      const anchorName = `anchor-node-${i}`
      const arrowName = path.obj.type === 'arrow' && nodes.length === 3
        ? ` anchor-${i === 0 ? 'start' : i === 1 ? 'mid' : 'end'}`
        : ''
      const selected = this.selectedNodes.has(anchorName)
      const r = Math.min(12, Math.max(4.5, 7 / scale)) * (selected ? 1.3 : 1)
      const hitR = Math.max(r * 1.5, 20 / scale)
      this.uiLayer.add(new Konva.Circle({
        name: `anchor ${anchorName}${arrowName}`,
        x: node.x, y: node.y,
        radius: r,
        fill: selected ? '#e07a1f' : '#ffffff',
        stroke: selected ? '#ffffff' : '#4a90d9',
        strokeWidth: (selected ? 2 : 1.5) / scale,
        hitFunc(ctx, sh) {
          ctx.beginPath()
          ctx.arc(0, 0, hitR, 0, Math.PI * 2)
          ctx.closePath()
          ctx.fillStrokeShape(sh)
        },
      }))
    })
  }

  /** Get the anchor name from a hit target (e.g. 'anchor-start', 'anchor-corner-0'). */
  private anchorNameAt(target: any): string | null {
    if (!(target instanceof Konva.Node)) return null
    let n: Konva.Node | null = target
    while (n && !(n instanceof Konva.Stage)) {
      if (n.hasName('anchor')) {
        // the node has multiple names like "anchor anchor-start"; extract the specific one
        const names = n.name().split(/\s+/)
        return names.find(nm => nm.startsWith('anchor-')) || null
      }
      n = n.getParent()
    }
    return null
  }

  /** Where a named anchor sits on the board (a handle square by its centre). */
  private anchorPosition(name: string): Pt | null {
    const node = this.uiLayer.findOne(`.${name}`)
    if (!node) return null
    const p = node.position()
    if (node instanceof Konva.Rect) return { x: p.x + node.width() / 2, y: p.y + node.height() / 2 }
    return { x: p.x, y: p.y }
  }

  /** Get current positions of all selected nodes. */
  private selectedNodePositions(): Record<string, Pt> {
    const result: Record<string, Pt> = {}
    for (const name of this.selectedNodes) {
      const pos = this.anchorPosition(name)
      if (pos) result[name] = { x: pos.x, y: pos.y }
    }
    return result
  }

  /** Move selected nodes by a delta, updating the object data. */
  private moveSelectedNodes(dx: number, dy: number, origPositions: Record<string, Pt>) {
    const path = this.editPath()
    if (!path) return
    const { obj, nodes, closed } = path

    const names = this.grabbedHandle ? [this.grabbedHandle] : Array.from(this.selectedNodes)
    for (const name of names) {
      const orig = origPositions[name]
      if (!orig) continue
      const parsed = this.nodeIndexOf(name)
      if (!parsed || parsed.i >= nodes.length) continue
      const node = nodes[parsed.i]

      if (parsed.kind === 'node') {
        const target = this.snapPoint({ x: orig.x + dx, y: orig.y + dy })
        node.x = target.x
        node.y = target.y
        continue
      }

      // a handle: the node keeps its place, the curve either side opens up.
      // The opposite handle turns and stretches with this one, in the
      // proportion the node had when the drag began, unless the node is a
      // corner - there the two sides move independently and the point stays.
      const wasCorner = freezeHandles(nodes, parsed.i, closed)
      const target = { x: orig.x + dx, y: orig.y + dy }
      const v = { x: target.x - node.x, y: target.y - node.y }
      const other = parsed.kind === 'h1' ? 'h2' : 'h1'
      const prevThis = node[parsed.kind]!
      const prevOther = node[other]!
      const thisLen = Math.hypot(prevThis.x, prevThis.y)
      const otherLen = Math.hypot(prevOther.x, prevOther.y)
      node[parsed.kind] = v
      if (!wasCorner) {
        const ratio = thisLen > 4 ? otherLen / thisLen : 1
        node[other] = { x: -v.x * ratio, y: -v.y * ratio }
      }
    }

    this.afterNodeChange(obj)
    this.rebuildObjectNode(obj)
    this.attachSelectionUi()
    this.uiLayer.batchDraw()
    this.publishPreview('update')
  }

  /** Apply snap grid if enabled. */
  private snapPoint(p: Pt): Pt {
    if (!this.snapEnabled) return p
    const grid = 10
    return { x: Math.round(p.x / grid) * grid, y: Math.round(p.y / grid) * grid }
  }

  /* ---------- bounding rects ---------- */

  private selectionRectForObject(obj: SceneObj): { x: number; y: number; width: number; height: number } {
    // Text hangs off its top-left corner and turns about it, so the shared
    // centre-and-rotate maths below would put its box half a line up and left
    // of the letters. It measures its own.
    if (obj.type === 'text') return this.textRect(obj)
    const rect = this.unrotatedRectForObject(obj)
    // arrows and free-form boxes carry rotation in their points, not an angle
    if (obj.type === 'arrow' || (obj.type === 'box' && obj.corners)) return rect
    const deg = (obj as any).rotation as number | undefined
    if (!deg) return rect
    const rad = (deg * Math.PI) / 180
    const c = Math.abs(Math.cos(rad)), sn = Math.abs(Math.sin(rad))
    const w = rect.width * c + rect.height * sn
    const h = rect.width * sn + rect.height * c
    const cx = rect.x + rect.width / 2, cy = rect.y + rect.height / 2
    return { x: cx - w / 2, y: cy - h / 2, width: w, height: h }
  }

  private unrotatedRectForObject(obj: SceneObj): { x: number; y: number; width: number; height: number } {
    if (obj.type === 'player') {
      const pad = 4
      return { x: obj.x - obj.r - pad, y: obj.y - obj.r - pad, width: obj.r * 2 + pad * 2, height: obj.r * 2 + pad * 2 }
    }
    if (obj.type === 'ball') {
      const pad = 8
      return { x: obj.x - obj.size / 2 - pad, y: obj.y - obj.size / 2 - pad, width: obj.size + pad * 2, height: obj.size + pad * 2 }
    }
    if (obj.type === 'goal') {
      const pad = 6
      const h = obj.size * GOAL_ASPECT[obj.variant]
      return { x: obj.x - obj.size / 2 - pad, y: obj.y - h / 2 - pad, width: obj.size + pad * 2, height: h + pad * 2 }
    }
    if (obj.type === 'image') {
      const pad = 6
      const h = obj.size * (obj.aspect || 1)
      return { x: obj.x - obj.size / 2 - pad, y: obj.y - h / 2 - pad, width: obj.size + pad * 2, height: h + pad * 2 }
    }
    if (obj.type === 'cone') {
      const pad = 6
      const h = obj.size * CONE_ASPECT
      return { x: obj.x - obj.size / 2 - pad, y: obj.y - h / 2 - pad, width: obj.size + pad * 2, height: h + pad * 2 }
    }
    if (obj.type === 'marker') {
      const pad = 6
      const rx = obj.w * LIVE_MARKER_ELLIPSE.rx
      const ry = obj.w * (LIVE_PLAYER_CROP.height / LIVE_PLAYER_CROP.width) * LIVE_MARKER_ELLIPSE.ry
      return { x: obj.x - rx - pad, y: obj.y - ry - pad, width: rx * 2 + pad * 2, height: ry * 2 + pad * 2 }
    }
    if (obj.type === 'box') {
      if (obj.corners?.length) {
        const pad = 4
        const bb = nodesBBox(obj.corners, true)
        return { x: bb.x - pad, y: bb.y - pad, width: Math.max(4, bb.width + pad * 2), height: Math.max(4, bb.height + pad * 2) }
      }
      const pad = 4
      const w = Math.abs(obj.w) + pad * 2
      const h = Math.abs(obj.h) + pad * 2
      return { x: obj.x - w / 2, y: obj.y - h / 2, width: Math.max(4, w), height: Math.max(4, h) }
    }
    // arrow
    let minX: number, maxX: number, minY: number, maxY: number
    if (obj.points && obj.points.length >= 2) {
      const bb = nodesBBox(obj.points, false)
      minX = bb.x; maxX = bb.x + bb.width
      minY = bb.y; maxY = bb.y + bb.height
    } else {
      const mx = obj.mx ?? (obj.x1 + obj.x2) / 2
      const my = obj.my ?? (obj.y1 + obj.y2) / 2
      const xs = [obj.x1, obj.x2, mx]
      const ys = [obj.y1, obj.y2, my]
      minX = Math.min(...xs); maxX = Math.max(...xs)
      minY = Math.min(...ys); maxY = Math.max(...ys)
    }
    const linePad = 8
    const strokePad = Number.isFinite(obj.width) ? obj.width : 4
    const pad = Math.max(linePad, strokePad + 8)
    return {
      x: minX - pad, y: minY - pad,
      width: Math.max(4, maxX - minX + pad * 2),
      height: Math.max(4, maxY - minY + pad * 2),
    }
  }

  private objectRect(obj: SceneObj): { x: number; y: number; width: number; height: number } {
    return this.selectionRectForObject(obj)
  }

  /** Board-space box an object occupies. Saving a combination measures with it. */
  rectFor(obj: SceneObj) {
    return this.selectionRectForObject(obj)
  }

  private intersects(sel: { x: number; y: number; width: number; height: number }, objRect: { x: number; y: number; width: number; height: number }) {
    return !(objRect.x + objRect.width < sel.x || objRect.y + objRect.height < sel.y || objRect.x > sel.x + sel.width || objRect.y > sel.y + sel.height)
  }

  private oTextWidth(text: string, size: number) {
    return text.length * size * 0.62
  }

  /**
   * The box the letters actually occupy. Konva measures the drawn text, so the
   * estimate is only there for the moment before the node exists. Flips mirror
   * about the origin and rotation turns about it, which is what the corners
   * below are walked through.
   */
  private textRect(obj: TextObj) {
    const pad = 12
    const node = this.objLayer.findOne(`#${obj.id}`) as Konva.Text | undefined
    const k = this.iconScale()
    const w = node ? node.width() : Math.max(24, this.oTextWidth(obj.text, obj.size * k))
    const h = node ? node.height() : Math.max(12, obj.size * k * 1.3)
    const sx = obj.flipX ? -1 : 1
    const sy = obj.flipY ? -1 : 1
    const rad = ((obj.rotation ?? 0) * Math.PI) / 180
    const cos = Math.cos(rad), sin = Math.sin(rad)
    const corners: [number, number][] = [[-pad, -pad], [w + pad, -pad], [w + pad, h + pad], [-pad, h + pad]]
    const xs: number[] = [], ys: number[] = []
    for (const [lx, ly] of corners) {
      const px = lx * sx, py = ly * sy
      xs.push(obj.x + px * cos - py * sin)
      ys.push(obj.y + px * sin + py * cos)
    }
    const minX = Math.min(...xs), minY = Math.min(...ys)
    return { x: minX, y: minY, width: Math.max(4, Math.max(...xs) - minX), height: Math.max(4, Math.max(...ys) - minY) }
  }

  /* ---------- stage gestures ---------- */

  /** Scene object id for whatever Konva node was hit, walking up groups. */
  private objectIdAt(target: any): string | null {
    if (!(target instanceof Konva.Node) || target instanceof Konva.Stage) return null
    const ids = new Set(this.store.scene.objects.map(o => o.id))
    let n: Konva.Node | null = target
    while (n && !(n instanceof Konva.Stage)) {
      const id = n.id()
      if (id && ids.has(id)) return id
      n = n.getParent()
    }
    return null
  }

  private pauseHit(pause: boolean) {
    if (pause) {
      this.objLayer.listening(false)
      this.uiLayer.listening(false)
    } else if (!this.objLayer.listening()) {
      this.objLayer.listening(true)
      this.uiLayer.listening(true)
      // Camera movement redraws layers while hit testing is paused. Rebuild
      // the hit canvases now, not on the next animation frame, so the first
      // click after an orbit can hit an object.
      this.objLayer.drawHit()
      this.uiLayer.drawHit()
    }
  }

  private cancelMoveArm(revert: boolean) {
    const a = this.moveArm
    this.moveArm = null
    if (!a?.began) return
    if (revert) {
      for (const id of a.ids) {
        const snapshot = a.orig[id]
        const obj = a.objs[id] as any
        if (!obj || !snapshot) continue
        Object.assign(obj, snapshot)
        this.rebuildObjectNode(obj)
      }
      this.attachSelectionUi()
      this.stage.batchDraw()
    }
    this.store.endGesture()
  }

  private beginSelectionRect(start: Pt, kind: 'objects' | 'nodes' = 'objects') {
    this.clearSelectionRect()
    this.selectStart = start
    this.selecting = true
    this.selectingKind = kind
    this.pauseHit(true)
    this.selectRect = new Konva.Rect({
      name: 'selbox',
      x: start.x, y: start.y,
      width: 0,
      height: 0,
      stroke: '#4a90d9',
      strokeWidth: 1.25 / this.screenScale(),
      dash: [6 / this.screenScale(), 4 / this.screenScale()],
      listening: false,
    })
    this.uiLayer.add(this.selectRect)
  }

  private updateSelectionRect(to: Pt) {
    if (!this.selectRect || !this.selectStart) return
    const x = Math.min(this.selectStart.x, to.x)
    const y = Math.min(this.selectStart.y, to.y)
    const w = Math.abs(to.x - this.selectStart.x)
    const h = Math.abs(to.y - this.selectStart.y)
    this.selectRect.setAttrs({ x, y, width: w, height: h })
    this.uiLayer.batchDraw()
  }

  private selectObjectsInRect(to: Pt) {
    if (!this.selectStart) return
    const x = Math.min(this.selectStart.x, to.x)
    const y = Math.min(this.selectStart.y, to.y)
    const w = Math.abs(to.x - this.selectStart.x)
    const h = Math.abs(to.y - this.selectStart.y)
    this.selectStart = null
    const ids: string[] = []
    if (w >= 4 && h >= 4) {
      const sel = { x, y, width: w, height: h }
      for (const obj of this.store.scene.objects) {
        const r = this.objectRect(obj)
        if (!this.intersects(sel, r)) continue
        ids.push(obj.id)
      }
    }
    this.pick(() => this.store.selectMany(ids))
    this.clearSelectionRect()
  }

  private selectNodesInRect(to: Pt) {
    if (!this.selectStart) return
    const x = Math.min(this.selectStart.x, to.x)
    const y = Math.min(this.selectStart.y, to.y)
    const w = Math.abs(to.x - this.selectStart.x)
    const h = Math.abs(to.y - this.selectStart.y)
    this.selectStart = null
    this.selectedNodes.clear()
    if (w >= 4 && h >= 4) {
      const sel = { x, y, width: w, height: h }
      this.uiLayer.find('.anchor').forEach(n => {
        const anchorName = this.anchorNameAt(n)
        if (!anchorName) return
        const p = n.position()
        if (p.x >= sel.x && p.x <= sel.x + sel.width && p.y >= sel.y && p.y <= sel.y + sel.height) {
          this.selectedNodes.add(anchorName)
        }
      })
    }
    this.nodeMultiSelect = this.selectedNodes.size > 1
    this.clearSelectionRect()
    this.attachSelectionUi()
    this.uiLayer.batchDraw()
  }

  private clearSelectionRect() {
    if (this.selectRect) {
      this.selectRect.destroy()
      this.selectRect = null
    }
    if (this.holdTimer !== null) {
      clearTimeout(this.holdTimer)
      this.holdTimer = null
    }
    this.selecting = false
    this.selectingKind = null
    this.selectStart = null
  }

  private armMove(ids: string[], p: Pt) {
    const uniq = Array.from(new Set(ids)).filter(id => this.store.obj(id))
    if (!uniq.length) return
    const orig: Record<string, any> = {}
    const objs: Record<string, SceneObj> = {}
    const nodes: Record<string, Konva.Node | null> = {}
    for (const id of uniq) {
      const obj = this.store.obj(id)
      if (!obj) continue
      orig[id] = JSON.parse(JSON.stringify(obj))
      objs[id] = obj
      nodes[id] = this.objLayer.findOne(`#${id}`)
    }
    if (!Object.keys(orig).length) return
    this.moveArm = { ids: uniq, start: p, orig, objs, nodes, began: false }
  }

  private isUiHandle(t: any): boolean {
    if (!(t instanceof Konva.Node)) return false
    // check the node itself and its ancestors for UI handle names
    let n: Konva.Node | null = t
    while (n && !(n instanceof Konva.Stage)) {
      if (n.hasName('anchor') || n.hasName('resize-node') || n.hasName('edit-icon')) return true
      if (n.findAncestor?.('Transformer')) return true
      n = n.getParent()
    }
    return false
  }

  private isDrawTool(): boolean {
    return this.tool === 'arrow' || this.tool === 'box' || (this.tool === 'ball' && this.defaults.place === 'measure')
  }

  /**
   * A drag that started on empty space and belongs to the view rather than to
   * anything on the board. In 3D that walks the camera round the pitch; when
   * the board is flat it is the pan it has always been.
   */
  private beginViewGesture(ev: { clientX: number; clientY: number } | null) {
    if (this.tilted) {
      if (this.orbitArm || !ev) return
      if (!Number.isFinite(ev.clientX) || !Number.isFinite(ev.clientY)) return
      this.orbitArm = { x0: ev.clientX, y0: ev.clientY, yaw: this.cam.yaw, tilt: this.cam.tilt, began: false }
      return
    }
    const sp = this.stage.getPointerPosition()
    if (sp) this.panArm = { start: sp, origin: this.stage.position(), began: false }
  }

  /**
   * The camera gestures live on the stage element, not on the Konva stage.
   *
   * Konva listens on the content element, and in 3D that element is turned:
   * once the board has been orbited any distance its rendered quad no longer
   * covers the board area, so a press in the corner of the screen never
   * reaches Konva at all, and a drag that starts on the board and leaves the
   * quad stops being delivered halfway through. Both make an orbit feel
   * broken. The stage element is square to the screen and covers the whole
   * board area, so it is the honest place for a gesture about the camera.
   *
   * Editing is untouched: a press that lands on the turned canvas is Konva's,
   * and this only arms an orbit for presses that missed it. Once an orbit has
   * really begun the pointer is captured here, because from that moment the
   * gesture is about the camera and nothing else.
   */
  private bindCameraGestures() {
    const el = this.container

    el.addEventListener('pointerdown', (e) => {
      if (!this.tilted || this.orbitArm) return
      // A press that hit the turned canvas has already been through Konva,
      // which arms the orbit itself when the press was on empty space. This
      // is only for the board area around it.
      if (e.target !== el) return
      if (this.moveArm || this.nodeArm || this.creating || this.selecting || this.tapTargetId) return
      this.beginViewGesture(e)
    })

    el.addEventListener('pointermove', (e) => {
      const a = this.orbitArm
      if (!a || !this.tilted) return
      const dx = e.clientX - a.x0, dy = e.clientY - a.y0
      if (!Number.isFinite(dx) || !Number.isFinite(dy)) return
      if (!a.began) {
        if (Math.hypot(dx, dy) <= ORBIT_SLOP) return
        a.began = true
        if (this.holdTimer !== null) { clearTimeout(this.holdTimer); this.holdTimer = null }
        this.tapTargetId = null
        this.clearRemotePreview()
        this.pauseHit(true)
        this.syncCursor()
        this.onCameraGesture()
        // From here the gesture belongs to the camera, so keep every later
        // move even when the finger leaves the turned canvas or the window.
        try { el.setPointerCapture(e.pointerId) } catch { /* no capture, no harm */ }
      }
      // Direct manipulation: the near touchline follows the finger round, and
      // pulling down lays the board flatter towards a plan view.
      this.set3DCamera({
        yaw: a.yaw - dx * ORBIT_YAW_PER_PX,
        tilt: a.tilt - dy * ORBIT_TILT_PER_PX,
      })
    })

    const endOrbit = (e: PointerEvent) => {
      const a = this.orbitArm
      if (!a) return
      this.orbitArm = null
      if (!a.began) return
      try { el.releasePointerCapture(e.pointerId) } catch { /* already gone */ }
      // Konva never saw this pointerup, because the capture was here.
      this.pauseHit(false)
      this.tapStart = null
      this.tapTargetId = null
      this.onPointerActivity(false)
      this.syncCursor()
    }
    el.addEventListener('pointerup', endOrbit)
    el.addEventListener('pointercancel', endOrbit)

    el.addEventListener('wheel', (e) => {
      if (!this.tilted) return
      e.preventDefault()
      this.clearRemotePreview()
      const unit = e.deltaMode === 1 ? 16 : 1
      const dy = Math.max(-60, Math.min(60, ((e.deltaY || 0) + (e.deltaX || 0) * 0.2) * unit))
      if (!dy) return
      this.onCameraGesture()
      this.zoom3D(Math.exp(-dy * 0.006))
    }, { passive: false })

    /* Two fingers on a 3D board are camera zoom and nothing else. The distance
       is taken in screen pixels rather than through the tilt: the camera is
       what the gesture is changing, so mapping the fingers through it would
       feed the gesture its own output. A two-finger drag is deliberately
       ignored - the board is centred by definition, and letting fingers
       translate it is exactly how it used to end up half off the screen. */
    el.addEventListener('touchmove', (e) => {
      if (!this.tilted) return
      const t = e.touches
      if (t.length !== 2) { this.camPinch = null; return }
      e.preventDefault()
      this.orbitArm = null
      this.cancelMoveArm(true)
      this.panArm = null
      this.tapTargetId = null
      if (this.creating) { this.creating.node.destroy(); this.creating = null; this.uiLayer.batchDraw() }
      this.pauseHit(true)
      const dist = Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY)
      const ids: [number, number] = [t[0].identifier, t[1].identifier]
      const same = !!this.camPinch && this.camPinch.ids.includes(ids[0]) && this.camPinch.ids.includes(ids[1])
      if (!same || !(dist > 24) || !Number.isFinite(dist)) {
        this.camPinch = { ids, startDist: Math.max(1, dist), startZoom: this.cam.zoom }
        return
      }
      this.onCameraGesture()
      this.set3DCamera({ zoom: this.camPinch.startZoom * (dist / this.camPinch.startDist) })
    }, { passive: false })

    const endPinch = (e: TouchEvent) => {
      if (e.touches.length >= 2) return
      this.camPinch = null
      if (e.touches.length === 0 && this.tilted) this.pauseHit(false)
    }
    el.addEventListener('touchend', endPinch)
    el.addEventListener('touchcancel', endPinch)
  }

  private bindStage() {
    const stage = this.stage
    this.bindCameraGestures()

    /* Konva turns a client point into a stage point by splitting the content
       element's bounding box into even X and Y steps. That is exact for a
       rectangle and wrong everywhere but the centre of a tilted one, so while
       3D is on, re-derive every point Konva just registered from the same
       client coordinates through the inverse perspective map. Ids, ordering
       and the changedTouches bookkeeping stay as Konva built them - only the
       coordinates change - and a point the map cannot place is left alone
       rather than replaced with a guess. */
    const registerPointers = stage.setPointersPositions.bind(stage)
    const bookkeeping = stage as unknown as {
      pointerPos: Pt | null
      _pointerPositions: (Pt & { id: number })[]
      _changedPointerPositions: (Pt & { id: number })[]
    }
    type ClientPoint = { clientX: number; clientY: number }
    ;(stage as unknown as { setPointersPositions: (evt: any) => void }).setPointersPositions = (evt: any) => {
      registerPointers(evt)
      if (!this.tiltActive()) return
      const source = evt ?? window.event
      if (!source) return
      const place = (list: (Pt & { id: number })[] | undefined, touches: ArrayLike<ClientPoint> | null) => {
        if (!list) return
        for (let i = 0; i < list.length; i++) {
          const from: ClientPoint | undefined = touches ? touches[i] : source
          if (!from) continue
          const p = this.tiltPoint(from.clientX, from.clientY)
          if (!p) continue
          list[i].x = p.x
          list[i].y = p.y
        }
      }
      if (source.touches !== undefined) {
        place(bookkeeping._pointerPositions, source.touches)
        place(bookkeeping._changedPointerPositions, source.changedTouches ?? source.touches)
        const first = bookkeeping._pointerPositions[0] ?? bookkeeping._changedPointerPositions[0]
        if (first) bookkeeping.pointerPos = { x: first.x, y: first.y }
      } else {
        const p = this.tiltPoint(source.clientX, source.clientY)
        if (!p) return
        bookkeeping.pointerPos = { x: p.x, y: p.y }
        place(bookkeeping._pointerPositions, null)
        place(bookkeeping._changedPointerPositions, null)
      }
    }

    // hover feedback (mouse only)
    stage.on('mouseover', (e) => {
      this.hoverTarget = e.target instanceof Konva.Stage ? null : e.target
      this.syncCursor()
    })
    this.container.addEventListener('mouseleave', () => {
      this.hoverTarget = null
      this.syncCursor()
    })

    /* ---- pointerdown ---- */
    stage.on('pointerdown', (e) => {
      const evt = e.evt as PointerEvent | MouseEvent
      if ('pointerType' in evt && evt.pointerType === 'mouse' && Date.now() < this.suppressMouseUntil) return
      this.onPointerActivity(true)
      if (this.pinch) return
      if (this.holdTimer !== null) { clearTimeout(this.holdTimer); this.holdTimer = null }
      const p = this.pointer()
      if (!p) { this.onPointerActivity(false); return }

      // --- node-edit state: handle before isUiHandle check ---
      if (this.interactionState === 'node-edit') {
        this.tapStart = p

        const anchorName = this.anchorNameAt(e.target)

        if (anchorName && this.nodeIndexOf(anchorName)?.kind !== 'node') {
          // A handle square belongs to the node that is already selected.
          // Taking hold of one must not take the selection off that node, or
          // the squares and their stems vanish the moment you touch them.
          this.grabbedHandle = anchorName
          const at = this.anchorPosition(anchorName)
          this.nodeArm = { start: p, origPositions: at ? { [anchorName]: at } : {}, began: false }
          this.tapTargetId = anchorName as any
        } else if (anchorName) {
          // Pressing a node should be enough to drag it. A plain tap still
          // selects/toggles it on pointerup; movement starts a node drag.
          this.grabbedHandle = null
          if (this.nodeMultiSelect) {
            if (this.selectedNodes.has(anchorName)) {
              this.nodeArm = { start: p, origPositions: this.selectedNodePositions(), began: false }
            }
          } else {
            this.selectedNodes.clear()
            this.selectedNodes.add(anchorName)
            this.nodeArm = { start: p, origPositions: this.selectedNodePositions(), began: false }
          }
          this.tapTargetId = anchorName as any
        } else if (this.selectedNodes.size > 0) {
          // Once nodes are selected, empty-space drag moves those nodes. A
          // no-move tap still clears selected nodes / exits multi-select.
          this.tapTargetId = null
          this.nodeArm = { start: p, origPositions: this.selectedNodePositions(), began: false }
        } else {
          // With no selected nodes, empty-space drag marquee-selects nodes.
          this.tapTargetId = null
          this.beginSelectionRect(p, 'nodes')
        }
        return
      }

      if (this.isUiHandle(e.target)) return // let Konva handle resize-node/edit-icon/transformer
      this.tapStart = p
      this.tapTargetId = null
      const hitId = this.objectIdAt(e.target)
      const drawTool = this.isDrawTool()

      // --- selected state ---
      if (this.interactionState === 'selected') {
        if (hitId && !drawTool) {
          // Cache the pointerdown object for tap resolution. On touch devices
          // Konva/browser pointerup can report the stage/layer instead of the
          // original object; without this, tapping a selected player can look
          // like an empty-space tap and clear selection.
          this.tapTargetId = hitId
        }
        if (hitId && !this.store.selectedIds.includes(hitId) && !drawTool) {
          // If something is already selected, a drag should move the current
          // selection even when the press starts over another object. A no-move
          // tap still switches selection on pointerup via tapTargetId.
          this.armMove(this.store.selectedIds, p)
          return
        }
        if (!hitId && drawTool) {
          // draw on empty space while something is selected
          this.store.selectMany([])
          this.startCreate(p, drawTool)
          return
        }
        if (hitId && drawTool) {
          // draw tool starting on an object (e.g. arrow from a player)
          this.startCreate(p, drawTool)
          return
        }
        if (!hitId && this.tilted) {
          // Empty space in 3D belongs to the camera. A still tap here still
          // deselects on pointerup; only movement becomes an orbit.
          this.beginViewGesture(evt)
          return
        }
        // press anywhere (selected object, empty space, etc.): arm move.
        // taps resolve on pointerup (deselect if empty space, no movement).
        this.armMove(this.store.selectedIds, p)
        return
      }

      // --- none state ---
      if (hitId && !drawTool) {
        // Selection only happens on tap (pointerup without meaningful
        // movement). A press-drag may move the object, but it must not select
        // it just because the gesture started on it.
        this.tapTargetId = hitId
        this.armMove([hitId], p)
        return
      }
      if (drawTool) {
        // draw tool: start creating
        this.startCreate(p, drawTool)
        return
      }
      // Empty space, no draw tool. In 3D that space belongs to the camera and
      // to nothing else: a press-and-hold marquee would race the orbit, and a
      // gesture that does one thing or the other depending on how quickly a
      // finger got moving is not a gesture anyone can rely on. Marquee select
      // stays exactly as it was on the flat board.
      this.beginViewGesture(evt)
      if (this.tilted) return
      this.holdTimer = window.setTimeout(() => {
        if (!this.tapStart) return
        this.beginSelectionRect(this.tapStart)
        this.holdTimer = null
      }, 240)
    })

    /* ---- pointermove ---- */
    stage.on('pointermove', (e) => {
      const moveEvt = e.evt as PointerEvent | MouseEvent
      const p = this.pointer()
      if (!p) return

      // node-edit: drag selected nodes
      if (this.nodeArm) {
        const a = this.nodeArm
        const dx = p.x - a.start.x, dy = p.y - a.start.y
        if (!a.began) {
          if (Math.hypot(dx, dy) <= 5 / this.screenScale()) return
          a.began = true
          this.store.beginGesture()

        }
        this.moveSelectedNodes(dx, dy, a.origPositions)
        return
      }

      // node-edit: cancel hold timer if moved too much (and start pan for empty-space press)
      if (this.interactionState === 'node-edit' && this.tapStart && this.tapTargetId) {
        const dx = p.x - this.tapStart.x, dy = p.y - this.tapStart.y
        if (Math.hypot(dx, dy) > 8 / this.screenScale()) {

          // cancel tap -- too much movement on an unselected node
          this.tapTargetId = null
        }
      }

      // move arm (dragging selected objects)
      if (this.moveArm) {
        const a = this.moveArm
        let dx = p.x - a.start.x, dy = p.y - a.start.y
        if (!a.began) {
          if (Math.hypot(dx, dy) <= 4 / this.screenScale()) return
          a.began = true
          this.store.beginGesture()
          // hide edit handles but keep the selection outline
          this.uiLayer.find('.resize-node, .edit-icon').forEach(n => n.visible(false))
          this.pauseHit(true)
          this.syncCursor()
        }
        // snap: compute delta from the primary object's anchor
        if (this.snapEnabled) {
          const primarySrc = a.orig[a.ids[0]]
          if (primarySrc) {
            const px = primarySrc.type === 'arrow' ? primarySrc.x1 : primarySrc.x
            const py = primarySrc.type === 'arrow' ? primarySrc.y1 : primarySrc.y
            const snapped = this.snapPoint({ x: px + dx, y: py + dy })
            dx = snapped.x - px
            dy = snapped.y - py
          }
        }
        for (const id of a.ids) {
          const src = a.orig[id]
          if (!src) continue
          const obj = a.objs[id]
          if (!obj) continue
          const node = a.nodes[id]
          if (obj.type === 'arrow') {
            const arrow = obj as ArrowObj
            arrow.x1 = src.x1 + dx; arrow.y1 = src.y1 + dy
            arrow.mx = src.mx + dx; arrow.my = src.my + dy
            arrow.x2 = src.x2 + dx; arrow.y2 = src.y2 + dy
            if (arrow.points && src.points) {
              arrow.points = src.points.map((point: PathNode) => ({ ...point, x: point.x + dx, y: point.y + dy }))
            }
            // Arrow shapes read their geometry from the live object on every
            // draw. Translating the group as well would move them twice.
            node?.position({ x: 0, y: 0 })
          } else if (obj.type === 'box' && (obj as BoxObj).corners) {
            const box = obj as BoxObj
            box.x = src.x + dx; box.y = src.y + dy
            for (let i = 0; i < 4; i++) {
              box.corners![i].x = src.corners[i].x + dx
              box.corners![i].y = src.corners[i].y + dy
            }
            // Corner shapes also draw directly from their live point array.
            node?.position({ x: 0, y: 0 })
          } else {
            ;(obj as any).x = src.x + dx
            ;(obj as any).y = src.y + dy
            node?.position({ x: (obj as any).x, y: (obj as any).y })
          }
        }
        this.syncSelectionUiDuringMove()
        this.objLayer.batchDraw()
        this.uiLayer.batchDraw()
        this.publishPreview('update')
        return
      }

      // tap target set but moved too far: cancel tap, start pan
      if (this.tapTargetId && this.tapStart) {
        const dx = p.x - this.tapStart.x, dy = p.y - this.tapStart.y
        if (Math.hypot(dx, dy) > 8 / this.screenScale()) {
          this.tapTargetId = null
          this.beginViewGesture(moveEvt)
        }
      }

      // hold timer: movement before timer fires cancels it and starts pan
      if (this.holdTimer !== null && this.tapStart && !this.selecting) {
        const dx = p.x - this.tapStart.x, dy = p.y - this.tapStart.y
        if (Math.hypot(dx, dy) > 5 / this.screenScale()) {
          clearTimeout(this.holdTimer)
          this.holdTimer = null
          this.beginViewGesture(moveEvt)
        }
      }

      // selection rect
      if (this.selecting) {
        this.orbitArm = null
        this.updateSelectionRect(p)
        return
      }

      // An armed orbit is driven from the stage element, not from here; see
      // bindCameraGestures for why.
      if (this.orbitArm) return

      // pan
      if (this.panArm) {
        const sp = stage.getPointerPosition()
        if (!sp) return
        const a = this.panArm
        const dx = sp.x - a.start.x, dy = sp.y - a.start.y
        if (!a.began && Math.hypot(dx, dy) <= 6) return
        if (!a.began) { a.began = true; this.pauseHit(true); this.syncCursor() }
        stage.position({ x: a.origin.x + dx, y: a.origin.y + dy })
        this.clampPan()
        stage.batchDraw()
        this.onViewChange()
        return
      }

      // creating (drawing arrow or box)
      if (!this.creating) return
      const c = this.creating
      const ep = this.snapPoint(p)
      if (c.kind === 'arrow') {
        c.obj.x2 = ep.x; c.obj.y2 = ep.y
        c.obj.mx = (c.obj.x1 + ep.x) / 2; c.obj.my = (c.obj.y1 + ep.y) / 2
      } else {
        if (!boxHasCorners(c.obj.shape)) {
          // an oval and a triangle both grow from the middle of the drag
          const dx = ep.x - c.start.x, dy = ep.y - c.start.y
          c.obj.w = Math.abs(dx); c.obj.h = Math.abs(dy)
          c.obj.x = c.start.x + dx / 2
          c.obj.y = c.start.y + dy / 2
          c.node.position({ x: c.obj.x, y: c.obj.y })
          if (c.obj.shape === 'triangle') {
            ;(c.node as Konva.Line).points(trianglePoints(Math.max(1, c.obj.w), Math.max(1, c.obj.h)))
          } else {
            ;(c.node as Konva.Ellipse).radius({ x: Math.max(1, c.obj.w / 2), y: Math.max(1, c.obj.h / 2) })
          }
        } else {
          const x = Math.min(c.start.x, ep.x), y = Math.min(c.start.y, ep.y)
          const w = Math.abs(ep.x - c.start.x), h = Math.abs(ep.y - c.start.y)
          c.obj.x = x + w / 2; c.obj.y = y + h / 2; c.obj.w = w; c.obj.h = h
          ;(c.node as Konva.Rect).setAttrs({ x, y, width: Math.max(1, w), height: Math.max(1, h) })
        }
      }
      this.uiLayer.batchDraw()
      this.publishPreview('update')
    })

    /* ---- finishCreate ---- */
    const finishCreate = (): boolean => {
      if (!this.creating) return false
      const c = this.creating
      this.creating = null
      c.node.destroy()
      this.uiLayer.batchDraw()
      if (c.kind === 'arrow') {
        if (Math.hypot(c.obj.x2 - c.obj.x1, c.obj.y2 - c.obj.y1) < 10) return false
        this.store.apply(s => insertByTier(s.objects, c.obj))
      } else {
        if (c.obj.w < 8 || c.obj.h < 8) return false
        // compute corners for new rect/outline boxes
        if (boxHasCorners(c.obj.shape)) {
          c.obj.corners = cornersFromRect(c.obj.x, c.obj.y, c.obj.w, c.obj.h, 0)
        }
        this.store.apply(s => insertByTier(s.objects, c.obj))
      }
      this.store.select(c.obj.id)
      this.onShapeDrawn()
      return true
    }

    /* ---- pointerup ---- */
    stage.on('pointerup', (e) => {
      // This is deliberately first: every return below must release local
      // control so a simultaneous remote drag cannot keep the board muted.
      this.onPointerActivity(false)
      this.pauseHit(false)
      queueMicrotask(() => this.syncCursor())
      const move = this.moveArm
      this.moveArm = null
      const nodeArmSnap = this.nodeArm
      this.nodeArm = null
      this.grabbedHandle = null
      const pan = this.panArm
      const orbit = this.orbitArm
      this.orbitArm = null
      const start = this.tapStart
      const selecting = this.selecting
      const selectingKind = this.selectingKind
      const tapTarget = this.tapTargetId
      this.panArm = null
      this.tapStart = null
      this.tapTargetId = null
      if (this.holdTimer !== null) { clearTimeout(this.holdTimer); this.holdTimer = null }

      const p = this.pointer()

      if (selecting) {
        const moved = p && start ? Math.hypot(p.x - start.x, p.y - start.y) : 0
        if (selectingKind === 'nodes' && moved <= 8 / this.screenScale()) {
          // A no-move tap in node-edit mode is still a tap, not a marquee.
          // This lets double-tap exit work from empty space too.
          this.clearSelectionRect()
        } else {
          if (p) {
            if (selectingKind === 'nodes') this.selectNodesInRect(p)
            else this.selectObjectsInRect(p)
          }
          this.clearSelectionRect()
          return
        }
      }
      if (nodeArmSnap?.began) { this.publishPreview('end'); this.store.endGesture(); this.rebuild(); return }

      if (move?.began) {
        // Final snap correction for arrows/corner-boxes, which have already
        // updated their gesture scene while their group moved.
        let dx = (p?.x ?? 0) - move.start.x, dy = (p?.y ?? 0) - move.start.y
        if (this.snapEnabled) {
          const primarySrc = move.orig[move.ids[0]]
          if (primarySrc) {
            const px = primarySrc.type === 'arrow' ? primarySrc.x1 : primarySrc.x
            const py = primarySrc.type === 'arrow' ? primarySrc.y1 : primarySrc.y
            const snapped = this.snapPoint({ x: px + dx, y: py + dy })
            dx = snapped.x - px
            dy = snapped.y - py
          }
        }
        for (const id of move.ids) {
          const src = move.orig[id]
          const obj = move.objs[id]
          if (!src || !obj) continue
          if (obj.type === 'arrow') {
            const aObj = obj as ArrowObj
            aObj.x1 = src.x1 + dx; aObj.y1 = src.y1 + dy
            aObj.mx = src.mx + dx; aObj.my = src.my + dy
            aObj.x2 = src.x2 + dx; aObj.y2 = src.y2 + dy
            if (aObj.points && src.points) {
              aObj.points = src.points.map((n: PathNode) => ({ ...n, x: n.x + dx, y: n.y + dy }))
            }
          } else if (obj.type === 'box' && (obj as BoxObj).corners) {
            const box = obj as BoxObj
            ;(obj as any).x = src.x + dx
            ;(obj as any).y = src.y + dy
            box.corners = (src.corners as PathNode[]).map(n => ({ ...n, x: n.x + dx, y: n.y + dy }))
          }
        }
        this.publishPreview('end')
        this.store.endGesture()
        return
      }
      if (pan?.began) return
      if (orbit?.began) return
      if (this.creating && finishCreate()) return

      if (!p || !start) return
      const moved = Math.hypot(p.x - start.x, p.y - start.y)
      if (moved > 8 / this.screenScale()) return // was a drag, not a tap

      // node-edit taps
      if (this.interactionState === 'node-edit') {
        const now = Date.now()
        const anchorName = tapTarget as string | null
        const onAnchor = !!anchorName && anchorName.startsWith('anchor-')

        // Armed by the + button: the next tap on the outline places the node.
        if (this.addNodeArmed && !onAnchor) {
          if (this.addNodeNear(p, 40)) { this.addNodeArmed = false; this.lastTap = null; return }
        }

        // A double-tap on the line adds a node there; anywhere else it means
        // "done", which is how leaving node editing has always worked.
        const dblTap = !!this.lastTap && now - this.lastTap.time < 500
        if (dblTap) {
          this.lastTap = null
          if (!onAnchor && this.addNodeNear(p, 22)) return
          this.exitNodeEdit()
          return
        }
        this.lastTap = { id: null, time: now }

        if (anchorName && this.nodeIndexOf(anchorName)?.kind !== 'node') {
          return
        }
        if (anchorName && anchorName.startsWith('anchor-')) {
          if (this.nodeMultiSelect) {
            // multi-select mode: toggle this node
            if (this.selectedNodes.has(anchorName)) this.selectedNodes.delete(anchorName)
            else this.selectedNodes.add(anchorName)
          } else {
            // single select: select just this node
            this.selectedNodes.clear()
            this.selectedNodes.add(anchorName)
          }
          this.attachSelectionUi()
          this.uiLayer.batchDraw()
          this.onInteractionStateChange()
        } else if (!anchorName) {
          // tap on empty space in node-edit: deselect nodes, exit multi-select mode
          if (this.selectedNodes.size > 0 || this.nodeMultiSelect) {
            this.selectedNodes.clear()
            this.nodeMultiSelect = false
            this.attachSelectionUi()
            this.uiLayer.batchDraw()
            this.onInteractionStateChange()
          }
        }
        return
      }

      const hitId = tapTarget || this.objectIdAt(e.target)
      const evt = e.evt as PointerEvent | MouseEvent | TouchEvent
      if (hitId && 'pointerType' in evt && evt.pointerType && evt.pointerType !== 'mouse') {
        // iOS/Chrome touch can be followed by a compatibility mouse click. The
        // real touch already selected the player; ignore the synthetic mouse
        // sequence so it cannot immediately look like an empty-board tap and
        // clear selection.
        this.suppressMouseUntil = Date.now() + 700
      }
      const modifierMulti = 'shiftKey' in evt && (evt.shiftKey || evt.ctrlKey || evt.metaKey)

      if (hitId) {
        const now = Date.now()
        const dbl = !!this.lastTap && this.lastTap.id === hitId && now - this.lastTap.time < 400
        const hitObj = this.store.obj(hitId)

        if (modifierMulti) {
          const selectedIds = this.store.selectedIds
          const next = selectedIds.includes(hitId)
            ? selectedIds.filter(id => id !== hitId)
            : [...selectedIds, hitId]
          this.pick(() => this.store.selectMany(next))
          this.lastTap = { id: hitId, time: now }
          return
        }

        // double-tap text: open editor
        if (dbl && hitObj?.type === 'text') {
          this.onRequestTextEdit(hitId, { x: hitObj.x, y: hitObj.y })
          this.lastTap = { id: hitId, time: now }
          return
        }

        // select the tapped object
        this.pick(() => this.store.select(hitId))
        this.lastTap = { id: hitId, time: now }
        return
      }

      // tap on empty space
      this.lastTap = { id: null, time: Date.now() }
      if (this.store.selectedIds.length) {
        this.pick(() => this.store.selectMany([]))
        return
      }

      // place objects (no selection, no draw tool)
      if (this.tool === 'ball') {
        const sp = this.snapPoint(p)
        // The toolbar hides the cone without a licence; this refuses it too, so a
        // stale selection cannot place one. Cones already on the board are
        // untouched.
        const obj = this.defaults.place === 'cone' && canPlaceCone()
          ? { id: uid(), type: 'cone' as const, x: sp.x, y: sp.y, size: 30 }
          : this.defaults.place === 'goal' && canPlaceCone()
            ? { id: uid(), type: 'goal' as const, x: sp.x, y: sp.y, size: this.defaults.goal.variant === 'normal' ? 160 : 55, rotation: 0, variant: this.defaults.goal.variant }
          : this.defaults.place === 'marker'
            ? { id: uid(), type: 'marker' as const, x: sp.x, y: sp.y, w: 86, name: '', namePos: 'bottom' as const }
            : { id: uid(), type: 'ball' as const, x: sp.x, y: sp.y, size: 20 }
        this.store.apply(s => insertByTier(s.objects, obj as any))
        this.onBallPlaced()
      } else if (this.tool === 'text') {
        this.onRequestTextEdit(null, this.snapPoint(p))
      }
    })

    // Konva can cancel a touch/pen gesture without delivering pointerup.
    // Local preview suppression has no business surviving that cancellation.
    stage.on('pointercancel', () => {
      this.onPointerActivity(false)
      this.pauseHit(false)
      this.cancelMoveArm(true)
      const nodeArm = this.nodeArm
      this.nodeArm = null
      this.grabbedHandle = null
      if (nodeArm?.began) { this.store.endGesture(); this.rebuild() }
      this.panArm = null
      this.orbitArm = null
      this.camPinch = null
      this.tapStart = null
      this.tapTargetId = null
      if (this.creating) {
        this.creating.node.destroy()
        this.creating = null
        this.uiLayer.batchDraw()
      }
      this.clearSelectionRect()
    })

    // wheel: zoom/pan
    stage.on('wheel', (e) => {
      e.evt.preventDefault()
      this.clearRemotePreview()
      const unit = e.evt.deltaMode === 1 ? 16 : 1
      // In 3D the wheel is camera zoom, and the stage element handles it for
      // the whole board area rather than only where the turned canvas lands.
      if (this.tilted) return
      if (e.evt.ctrlKey || e.evt.metaKey) {
        const pos = stage.getPointerPosition()
        if (!pos) return
        const dy = Math.max(-40, Math.min(40, e.evt.deltaY * unit))
        this.zoomAt(pos, Math.exp(-dy * 0.008))
        return
      }
      let dx = e.evt.deltaX * unit
      let dy = e.evt.deltaY * unit
      if (e.evt.shiftKey && !dx) { dx = dy; dy = 0 }
      stage.position({ x: stage.x() - dx, y: stage.y() - dy })
      this.clampPan()
      stage.batchDraw()
      this.onViewChange()
    })

    // pinch zoom + two-finger pan (mobile)
    stage.on('touchmove', (e) => {
      const t = e.evt.touches
      if (t.length !== 2) { this.pinch = null; this.camPinch = null; return }
      e.evt.preventDefault()
      this.cancelMoveArm(true)
      this.panArm = null
      this.orbitArm = null
      this.tapTargetId = null
      if (this.creating) { this.creating.node.destroy(); this.creating = null; this.uiLayer.batchDraw() }

      // A pinch in 3D is camera zoom, handled on the stage element so that it
      // works anywhere in the board area, not only over the turned canvas.
      if (this.tilted) { this.pinch = null; return }
      // Two fingers on a tilted board are two trapezoid points; the pinch maths
      // below is all in stage pixels, so map them the same way taps are mapped.
      const p1 = this.clientToStage(t[0].clientX, t[0].clientY)
      const p2 = this.clientToStage(t[1].clientX, t[1].clientY)
      // A collapsed or horizon-crossing map must not turn a pinch into a
      // guessed jump. Wait for a later touch frame with a valid map.
      if (!p1 || !p2) { this.pinch = null; return }
      const center = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 }
      const dist = Math.hypot(p1.x - p2.x, p1.y - p2.y)
      const ids: [number, number] = [t[0].identifier, t[1].identifier]
      const sameTouches = !!this.pinch
        && this.pinch.ids.includes(ids[0])
        && this.pinch.ids.includes(ids[1])
      const armPinch = () => {
        const scale = this.stage.scaleX() || Math.min(this.container.clientWidth / BOARD_W, this.container.clientHeight / this.contentH()) * this.zoom
        this.pinch = {
          ids,
          startDist: dist,
          startZoom: this.zoom,
          startScale: scale,
          world: { x: (center.x - this.stage.x()) / scale, y: (center.y - this.stage.y()) / scale },
          lastCenter: center,
          lastDist: dist,
        }
      }
      this.pauseHit(true)
      if (!sameTouches || dist < 36) { armPinch(); return }
      const pinch = this.pinch!
      const frameFactor = dist / Math.max(1, pinch.lastDist)
      const frameMove = Math.hypot(center.x - pinch.lastCenter.x, center.y - pinch.lastCenter.y)
      if (frameFactor < 0.7 || frameFactor > 1.4 || frameMove > 160) { armPinch(); return }

      const cw = this.container.clientWidth, ch = this.container.clientHeight
      const base = Math.min(cw / BOARD_W, ch / this.contentH())
      this.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, pinch.startZoom * (dist / Math.max(1, pinch.startDist))))
      const scale = base * this.zoom
      this.stage.scale({ x: scale, y: scale })
      this.stage.position({ x: center.x - pinch.world.x * scale, y: center.y - pinch.world.y * scale })
      this.clampPan()
      this.stage.batchDraw()
      this.onViewChange()
      pinch.lastCenter = center
      pinch.lastDist = dist
    })
    stage.on('touchend', (e) => {
      if (e.evt.touches.length < 2) {
        this.pinch = null
        this.camPinch = null
        if (e.evt.touches.length === 0) this.pauseHit(false)
      }
    })
  }

  /** Start drawing an arrow or box from the given point. */
  private startCreate(p: Pt, _drawTool: boolean) {
    const sp = this.snapPoint(p)
    if (this.tool === 'arrow' || (this.tool === 'ball' && this.defaults.place === 'measure')) {
      const measuring = this.tool === 'ball' && this.defaults.place === 'measure'
      const d = measuring ? { dash: 'solid' as const, color: this.defaults.measure.color, width: this.defaults.measure.width, head: false } : this.defaults.arrow
      const live = this.arrowsAreLive()
      const obj: ArrowObj = {
        id: uid(), type: 'arrow',
        x1: sp.x, y1: sp.y, x2: sp.x, y2: sp.y, mx: sp.x, my: sp.y,
        curved: false, dash: d.dash, color: d.color, width: d.width, head: d.head, measure: measuring, headSize: arrowHeadSize(d.width, live),
      }
      const node = makeArrowShape(obj, 1, live)
      this.uiLayer.add(node)
      this.creating = { kind: 'arrow', start: sp, node, obj }
    } else if (this.tool === 'box') {
      const d = this.defaults.box
      const obj: BoxObj = { id: uid(), type: 'box', shape: d.shape, x: sp.x, y: sp.y, w: 0, h: 0, rotation: 0, fill: d.fill, opacity: d.opacity, label: '', labelPos: 'top' }
      const node = d.shape === 'ellipse'
        ? new Konva.Ellipse({ x: sp.x, y: sp.y, radiusX: 1, radiusY: 1, fill: d.fill, opacity: d.opacity })
        : d.shape === 'triangle'
        ? new Konva.Line({ x: sp.x, y: sp.y, points: trianglePoints(1, 1), closed: true, fill: d.fill, opacity: d.opacity })
        : new Konva.Rect({ x: sp.x, y: sp.y, width: 1, height: 1, fill: d.shape === 'outline' ? undefined : d.fill, stroke: d.shape === 'outline' ? d.fill : undefined, strokeWidth: d.shape === 'outline' ? 4 : 0, opacity: d.shape === 'outline' ? 1 : d.opacity })
      this.uiLayer.add(node)
      this.creating = { kind: 'box', start: sp, node, obj }
    }
  }

  /* ---------- export ---------- */

  /**
   * One frame, drawn at `width` pixels wide, optionally cropped to a view.
   * Used by the animation export, which needs many frames quickly and cannot
   * afford a data URL round trip for each one.
   */
  /**
   * Resolve once every image this board draws with has decoded. An export
   * asks a fresh board for frames the moment it is built, and a board that
   * has not got its artwork yet draws no pitch, no ball and no goals - the
   * on-screen board never shows this because it has been up for a while.
   * A stalled file must not hold an export hostage, so the wait is bounded.
   */
  async imagesReady(timeoutMs = 4000): Promise<void> {
    const imgs = [
      this.pitchImg, this.ballImg, this.coneImg,
      this.goalImgs.small, this.goalImgs.normal,
      this.livePlayerImg, this.liveScoreboardImg, this.logoImg,
      ...this.assetImgs.values(),
    ].filter((img): img is HTMLImageElement => !!img && !!img.src && !img.complete)
    if (imgs.length) {
      const settled = imgs.map(img => new Promise<void>(resolve => {
        img.addEventListener('load', () => resolve(), { once: true })
        img.addEventListener('error', () => resolve(), { once: true })
      }))
      let timer = 0
      await Promise.race([
        Promise.all(settled),
        new Promise<void>(resolve => { timer = window.setTimeout(resolve, timeoutMs) }),
      ])
      window.clearTimeout(timer)
    }
    this.drawBackground()
    this.rebuild()
  }

  /**
   * `opacity` dims individual objects for this capture alone — an animation
   * export uses it to fade an object out as the next board drops it, the way
   * the player does. Every entry is put back before the canvas is returned.
   */
  toFrameCanvas(
    width: number,
    view?: { x: number; y: number; w: number; h: number },
    opacity?: Map<string, number>,
  ): HTMLCanvasElement {
    // Captures are always the durable local board, never a translucent local
    // layer under a received visual frame.
    this.clearRemotePreview()
    const dimmed: { node: Konva.Node; was: number }[] = []
    opacity?.forEach((value, id) => {
      const node = this.objLayer.findOne(`#${id}`)
      if (!node) return
      dimmed.push({ node, was: node.opacity() })
      node.opacity(Math.max(0, Math.min(1, value)))
    })
    const prevScale = this.stage.scale()
    const prevPos = this.stage.position()
    const prevSize = this.stage.size()
    const box = view ?? { x: 0, y: 0, w: BOARD_W, h: this.boardH }
    this.transformer.nodes([])
    this.uiLayer.visible(false)
    this.noteLayer.visible(false)
    this.stage.scale({ x: 1, y: 1 })
    this.stage.position({ x: 0, y: 0 })
    this.stage.size({ width: BOARD_W, height: this.boardH })
    const canvas = this.stage.toCanvas({
      x: box.x, y: box.y, width: box.w, height: box.h, pixelRatio: width / box.w,
    })
    this.stage.size(prevSize)
    this.stage.scale(prevScale)
    this.stage.position(prevPos)
    this.uiLayer.visible(true)
    this.noteLayer.visible(true)
    for (const { node, was } of dimmed) node.opacity(was)
    return canvas
  }

  exportPng(): string {
    // Keep this safety at the capture boundary for animation/share callers
    // that bypass main.ts.
    this.clearRemotePreview()
    const prevScale = this.stage.scale()
    const prevPos = this.stage.position()
    const prevSize = this.stage.size()
    this.transformer.nodes([])
    this.uiLayer.visible(false)
    this.noteLayer.visible(false)
    this.stage.scale({ x: 1, y: 1 })
    this.stage.position({ x: 0, y: 0 })
    this.stage.size({ width: BOARD_W, height: this.boardH })
    const url = this.stage.toDataURL({ x: 0, y: 0, width: BOARD_W, height: this.boardH, pixelRatio: 2048 / BOARD_W })
    this.stage.size(prevSize)
    this.stage.scale(prevScale)
    this.stage.position(prevPos)
    this.uiLayer.visible(true)
    this.noteLayer.visible(true)
    this.rebuild()
    return url
  }
}
