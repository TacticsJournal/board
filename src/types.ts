import { DEFAULT_PITCH, pitchById } from './pitches.ts'
import type { PathNode, NodeCurve } from './path-nodes.ts'

export type { PathNode, NodeCurve }

export type Pt = { x: number; y: number }

export type Dash = 'solid' | 'dashed' | 'dotted'
export type ArrowLegend = Partial<Record<Dash, string>>

type Flippable = {
  flipX?: boolean
  flipY?: boolean
  /** Degrees clockwise about the object's centre. Absent in older saves. */
  rotation?: number
}

export type PlayerNameDisplay = 'first' | 'last' | 'full'

export type PlayerObj = {
  id: string; type: 'player'
  x: number; y: number; r: number
  color: string
  label: string
  name: string
  namePos: 'top' | 'bottom'
  nameSize: number
  nameDisplay: PlayerNameDisplay
  team?: string
} & Flippable
export type BallObj = {
  id: string; type: 'ball'
  x: number; y: number; size: number
} & Flippable
export type ConeObj = {
  id: string; type: 'cone'
  x: number; y: number; size: number
} & Flippable
/** Training goal seen head-on: `size` is the frame width. */
export type GoalObj = {
  id: string; type: 'goal'
  x: number; y: number; size: number
  variant: GoalVariant
} & Flippable
export type GoalVariant = 'small' | 'normal'
/** Live-pitch ground marker: white ellipse under a player in the
    screenshot, with an optional name caption (TJ live annotation style). */
export type MarkerObj = {
  id: string; type: 'marker'
  x: number; y: number; w: number
  name: string
  namePos: 'top' | 'bottom'
} & Flippable
export type ArrowObj = {
  id: string; type: 'arrow'
  x1: number; y1: number
  mx: number; my: number
  x2: number; y2: number
  /** Node path, once the arrow has been given more than one bend or a handle
      dragged by hand. Absent on every arrow that has not been node-edited, and
      x1/y1/mx/my/x2/y2 stay in step with it so older readers still draw it. */
  points?: PathNode[]
  curved: boolean
  dash: Dash
  color: string
  width: number
  head: boolean
  /** Measurement lines behave like arrows/lines but have no middle bend handle. */
  measure?: boolean
  headSize?: number
}
export type BoxObj = {
  id: string; type: 'box'
  shape: 'rect' | 'ellipse' | 'triangle' | 'outline'
  x: number; y: number; w: number; h: number
  rotation: number
  fill: string
  opacity: number
  label?: string
  labelPos?: 'top' | 'right' | 'bottom' | 'left'
  /** Free-form nodes, clockwise from the top left. Rect/outline only; ovals
      and triangles stay x/y/w/h. Absent in v2 saves until migrated. Four of
      them is only where a zone starts: node editing adds and removes them,
      and each one carries its own curve. */
  corners?: PathNode[]
} & Flippable
/**
 * Which zone shapes are four draggable corners. The others are a box the
 * Transformer turns and scales: an oval and a triangle have no corner to
 * drag that would still be that shape.
 */
export function boxHasCorners(shape: BoxObj['shape']) {
  return shape === 'rect' || shape === 'outline'
}

export type TextObj = {
  id: string; type: 'text'
  x: number; y: number
  text: string
  size: number
  bold: boolean
  color: string
  rotation: number
} & Flippable

/**
 * One of the licensed user's own assets, placed on the board. The board stores
 * the asset's id, never its bytes, so a shared board stays readable by someone
 * who does not own it. `size` is the width; `aspect` is height over width, kept
 * on the object so the frame is right before the image has loaded.
 */
export type ImageObj = {
  id: string; type: 'image'
  x: number; y: number; size: number
  assetId: string
  aspect: number
} & Flippable

/**
 * Objects saved or grouped together carry the same group id, so a tap on one
 * takes the whole arrangement and a saved combination comes back as a unit.
 */
export type Grouped = { group?: string }

export type SceneObj = (PlayerObj | BallObj | ConeObj | GoalObj | MarkerObj | ArrowObj | BoxObj | TextObj | ImageObj) & Grouped

/** Draw-order tier: zones and arrows always sit behind tactical assets. */
export const TYPE_Z: Record<SceneObj['type'], number> = { box: 0, arrow: 1, goal: 2, marker: 2, cone: 3, image: 3, player: 4, ball: 5, text: 6 }

/** Render by tactical tier without changing the durable object order. */
export function objectsInDrawOrder<T extends SceneObj>(objects: readonly T[]): T[] {
  return [...objects].sort((a, b) => TYPE_Z[a.type] - TYPE_Z[b.type])
}

/** Insert obj into the array at the top of its tier (below higher tiers). */
export function insertByTier(objects: SceneObj[], obj: SceneObj) {
  const tier = TYPE_Z[obj.type]
  let i = objects.length
  while (i > 0 && TYPE_Z[objects[i - 1].type] > tier) i--
  objects.splice(i, 0, obj)
}

/** Match overlay (cog tool): scoreboard and team codes drawn on the board. */
export type MatchInfo = {
  home: string
  away: string
  homeScore: string
  awayScore: string
  clock: string
  date: string
  showScoreboard: boolean
  showTeams: boolean
}

export function emptyMatch(): MatchInfo {
  return { home: '', away: '', homeScore: '0', awayScore: '0', clock: '', date: '', showScoreboard: false, showTeams: false }
}

export type Scene = {
  version: 4
  board: { w: number; h: number }
  /** pitch style id (see pitches.ts); absent in old saves -> default */
  pitch?: string
  match?: MatchInfo
  /** Optional user-defined meanings for arrow line styles. */
  arrowLegend?: ArrowLegend
  objects: SceneObj[]
}

export const BOARD_W = 800
/** Classic-pitch height; the live board height comes from the scene's
    pitch style (scene.board.h), which migrate() keeps in sync. */
export const BOARD_H = 418

/** Legacy team slot colors, still used to migrate old saves. */
export const TEAM_COLORS: Record<string, string> = {
  red: '#e02020',
  blue: '#1e2f6f',
  grey: '#9ca3af',
}

export const PLAYER_PALETTE = [
  '#e02020', // red
  '#1e2f6f', // navy
  '#3b82f6', // blue
  '#7c3aed', // purple
  '#16a34a', // green
  '#facc15', // yellow
  '#9ca3af', // grey
  '#ffffff', // white
  '#111827', // black
]

export function normalizeHex(v: string): string | null {
  const m = v.trim().replace(/^#/, '')
  return /^[0-9a-fA-F]{6}$/.test(m) ? `#${m.toLowerCase()}` : null
}

export function uid(prefix = 'o') {
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`
}

/** Compute 4 corner points from a centered rect (TL, TR, BR, BL clockwise). */
/* The two things a player's dot says about itself, shared by everything
   that draws a board: the Konva board, and the SVG the thumbnails and the
   sequence player are drawn from. */
export function isLight(hex: string): boolean {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex)
  if (!m) return false
  const n = parseInt(m[1], 16)
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.62
}

export function playerDisplayName(name: string, mode: PlayerObj['nameDisplay'] = 'last'): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (mode === 'full') return parts.join(' ')
  if (parts.length <= 1) return parts[0] ?? ''
  if (mode === 'first') return parts[0]
  const suffixes = new Set(['jr', 'jr.', 'sr', 'sr.', 'ii', 'iii', 'iv'])
  while (parts.length > 1 && suffixes.has(parts[parts.length - 1].toLowerCase())) parts.pop()
  if (parts.length <= 1) return parts[0] ?? ''

  const last = parts[parts.length - 1]
  const prev = parts[parts.length - 2]
  const prevLower = prev.toLowerCase()
  const particles = new Set(['da', 'de', 'del', 'der', 'di', 'dos', 'du', 'la', 'le', 'van', 'von'])
  if (particles.has(prevLower)) return `${prev} ${last}`
  if (prev === 'Mac' || prev === 'Mc') return `${prev} ${last}`
  return last
}

export function cornersFromRect(x: number, y: number, w: number, h: number, rotation: number): PathNode[] {
  const cos = Math.cos(rotation * Math.PI / 180)
  const sin = Math.sin(rotation * Math.PI / 180)
  const hw = w / 2, hh = h / 2
  const r = (lx: number, ly: number): Pt => ({ x: x + lx * cos - ly * sin, y: y + lx * sin + ly * cos })
  return [r(-hw, -hh), r(hw, -hh), r(hw, hh), r(-hw, hh)]
}

/** Bezier reach that turns four nodes into a true ellipse. */
const KAPPA = 0.5522847498307936

/**
 * The nodes a zone shape starts from. Every shape is a node path once it has
 * been node-edited; this is what each one looks like before anyone has moved
 * a node. An oval is exact, not an approximation: four nodes with the classic
 * bezier reach draw the same ellipse Konva does.
 */
export function nodesForShape(shape: BoxObj['shape'], x: number, y: number, w: number, h: number, rotation: number): PathNode[] {
  if (shape === 'rect' || shape === 'outline') return cornersFromRect(x, y, w, h, rotation)
  const cos = Math.cos(rotation * Math.PI / 180)
  const sin = Math.sin(rotation * Math.PI / 180)
  const place = (lx: number, ly: number): Pt => ({ x: x + lx * cos - ly * sin, y: y + lx * sin + ly * cos })
  const turn = (lx: number, ly: number): Pt => ({ x: lx * cos - ly * sin, y: lx * sin + ly * cos })
  if (shape === 'triangle') {
    const pts = trianglePoints(w, h)
    const nodes: PathNode[] = []
    for (let i = 0; i < pts.length; i += 2) nodes.push(place(pts[i], pts[i + 1]))
    return nodes
  }
  const rx = w / 2, ry = h / 2
  const kx = KAPPA * rx, ky = KAPPA * ry
  const arc = (lx: number, ly: number, h1x: number, h1y: number, h2x: number, h2y: number): PathNode => ({
    ...place(lx, ly), c: 'free', h1: turn(h1x, h1y), h2: turn(h2x, h2y),
  })
  return [
    arc(0, -ry, -kx, 0, kx, 0),
    arc(rx, 0, 0, -ky, 0, ky),
    arc(0, ry, kx, 0, -kx, 0),
    arc(-rx, 0, 0, ky, 0, -ky),
  ]
}

/** A triangle in a w by h box: apex at the top, base along the bottom. */
export function trianglePoints(w: number, h: number) {
  return [0, -h / 2, w / 2, h / 2, -w / 2, h / 2]
}

/**
 * The w/h box a set of corners stands for, measured with the corners turned
 * back to square. Changing a zone's shape reads it, because corners drift from
 * the w/h that made them once they have been dragged.
 */
export function rectFromCorners(corners: PathNode[], rotation: number) {
  const cx = corners.reduce((a, c) => a + c.x, 0) / corners.length
  const cy = corners.reduce((a, c) => a + c.y, 0) / corners.length
  const cos = Math.cos(-rotation * Math.PI / 180)
  const sin = Math.sin(-rotation * Math.PI / 180)
  const local = corners.map(c => {
    const dx = c.x - cx, dy = c.y - cy
    return { x: dx * cos - dy * sin, y: dx * sin + dy * cos }
  })
  const xs = local.map(p => p.x), ys = local.map(p => p.y)
  return {
    x: cx, y: cy,
    w: Math.max(8, Math.max(...xs) - Math.min(...xs)),
    h: Math.max(8, Math.max(...ys) - Math.min(...ys)),
  }
}

export function emptyScene(pitch: string = DEFAULT_PITCH): Scene {
  const style = pitchById(pitch)
  return { version: 4, board: { w: BOARD_W, h: style.boardH }, pitch: style.id, match: emptyMatch(), objects: [] }
}

const MAX_IMPORTED_OBJECTS = 2000

function finiteNumber(value: unknown, fallback: number, min = -10000, max = 10000): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback
}

function boundedString(value: unknown, max: number): string {
  return typeof value === 'string'
    ? value.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, max)
    : ''
}

function safeId(value: unknown): string {
  const id = boundedString(value, 100).trim()
  return /^[A-Za-z0-9_-]{1,100}$/.test(id) ? id : uid()
}

function safeColor(value: unknown, fallback: string): string {
  return normalizeHex(typeof value === 'string' ? value : '') || fallback
}

function safePoint(value: unknown): Pt | null {
  if (!value || typeof value !== 'object') return null
  const point = value as Record<string, unknown>
  if (typeof point.x !== 'number' || !Number.isFinite(point.x) || typeof point.y !== 'number' || !Number.isFinite(point.y)) return null
  return { x: finiteNumber(point.x, 0), y: finiteNumber(point.y, 0) }
}

/** A node keeps its point, its curve, and its handles if it has any. */
function safeNode(value: unknown): PathNode | null {
  const pt = safePoint(value)
  if (!pt) return null
  const raw = value as Record<string, unknown>
  const node: PathNode = { x: pt.x, y: pt.y }
  const curve = raw.c
  if (curve === 'smooth' || curve === 'round' || curve === 'free') node.c = curve
  if (node.c === 'free') {
    const h1 = safePoint(raw.h1), h2 = safePoint(raw.h2)
    if (h1 && h2) { node.h1 = h1; node.h2 = h2 } else delete node.c
  }
  return node
}

/** A node list of at least `min` points, or null if the save has none. */
function safeNodes(value: unknown, min: number, max = 200): PathNode[] | null {
  if (!Array.isArray(value) || value.length < min) return null
  const nodes = value.slice(0, max).map(safeNode)
  if (nodes.some(n => !n) || nodes.length < min) return null
  return nodes as PathNode[]
}

/** Every type keeps its own fields; the group id rides along on all of them. */
function sanitizeObject(value: unknown): SceneObj | null {
  const clean = sanitizeShape(value)
  if (!clean) return null
  const group = boundedString((value as Record<string, any>).group, 64).trim()
  return group ? { ...clean, group } : clean
}

function sanitizeShape(value: unknown): SceneObj | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const o = value as Record<string, any>
  const id = safeId(o.id)
  const x = finiteNumber(o.x, 0)
  const y = finiteNumber(o.y, 0)
  const flips = { flipX: o.flipX === true, flipY: o.flipY === true }
  // pieces without their own rotation field (box and text keep theirs)
  const spin = { rotation: finiteNumber(o.rotation, 0, -3600, 3600) }

  if (o.type === 'player') {
    const team = boundedString(o.team, 100).trim() || undefined
    return {
      id, type: 'player', x, y, r: finiteNumber(o.r, 13, 2, 100),
      color: safeColor(o.color, TEAM_COLORS[team || ''] || '#e02020'),
      label: boundedString(o.label, 20), name: boundedString(o.name, 120),
      namePos: o.namePos === 'top' ? 'top' : 'bottom',
      nameSize: finiteNumber(o.nameSize, 18, 8, 96),
      nameDisplay: ['first', 'last', 'full'].includes(o.nameDisplay) ? o.nameDisplay : 'last',
      ...(team ? { team } : {}), ...flips, ...spin,
    }
  }
  if (o.type === 'ball') return { id, type: 'ball', x, y, size: finiteNumber(o.size, 20, 2, 200), ...flips, ...spin }
  if (o.type === 'cone') return { id, type: 'cone', x, y, size: finiteNumber(o.size, 22, 2, 200), ...flips, ...spin }
  if (o.type === 'goal') {
    return {
      id, type: 'goal', x, y,
      size: finiteNumber(o.size, 120, 8, 1200),
      variant: o.variant === 'normal' ? 'normal' : 'small',
      ...flips, ...spin,
    }
  }
  if (o.type === 'image') {
    const assetId = boundedString(o.assetId, 64).trim()
    if (!assetId) return null
    return {
      id, type: 'image', x, y,
      size: finiteNumber(o.size, 90, 8, 1200),
      aspect: finiteNumber(o.aspect, 1, 0.05, 20),
      assetId,
      ...flips, ...spin,
    }
  }
  if (o.type === 'marker') {
    return { id, type: 'marker', x, y, w: finiteNumber(o.w, 54, 2, 500), name: boundedString(o.name, 120), namePos: o.namePos === 'top' ? 'top' : 'bottom', ...flips, ...spin }
  }
  if (o.type === 'arrow') {
    const width = finiteNumber(o.width, 4, 1, 50)
    const points = safeNodes(o.points, 2)
    return {
      id, type: 'arrow',
      ...(points ? { points } : {}),
      x1: finiteNumber(o.x1, x), y1: finiteNumber(o.y1, y),
      mx: finiteNumber(o.mx, x), my: finiteNumber(o.my, y),
      x2: finiteNumber(o.x2, x), y2: finiteNumber(o.y2, y),
      curved: o.curved === true,
      dash: ['solid', 'dashed', 'dotted'].includes(o.dash) ? o.dash : 'solid',
      color: safeColor(o.color, '#111111'), width, head: o.head !== false,
      measure: o.measure === true,
      headSize: finiteNumber(o.headSize, Math.max(12, width * 3.2), 2, 200),
    }
  }
  if (o.type === 'box') {
    const shape = ['rect', 'ellipse', 'triangle', 'outline'].includes(o.shape) ? o.shape : 'rect'
    const w = finiteNumber(o.w, 100, 2, 4000)
    const h = finiteNumber(o.h, 100, 2, 4000)
    const rotation = finiteNumber(o.rotation, 0, -3600, 3600)
    const saved = safeNodes(o.corners, 3)
    const corners = saved ?? (boxHasCorners(shape) ? cornersFromRect(x, y, w, h, rotation) : null)
    return {
      id, type: 'box', shape, x, y, w, h, rotation,
      fill: safeColor(o.fill, '#9ca3af'), opacity: finiteNumber(o.opacity, 0.45, 0, 1),
      label: boundedString(o.label, 120),
      labelPos: ['top', 'right', 'bottom', 'left'].includes(o.labelPos) ? o.labelPos : 'top',
      ...(corners ? { corners } : {}), ...flips,
    }
  }
  if (o.type === 'text') {
    return {
      id, type: 'text', x, y, text: boundedString(o.text, 500),
      size: finiteNumber(o.size, 18, 6, 200), bold: o.bold === true,
      color: safeColor(o.color, '#111111'), rotation: finiteNumber(o.rotation, 0, -3600, 3600), ...flips,
    }
  }
  return null
}

export function sanitizeObjects(values: unknown[]): SceneObj[] {
  return values.slice(0, MAX_IMPORTED_OBJECTS).map(sanitizeObject).filter((value): value is SceneObj => value !== null)
}

function sanitizeArrowLegend(value: unknown): ArrowLegend | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const raw = value as Record<string, unknown>
  const legend: ArrowLegend = {}
  for (const dash of ['solid', 'dashed', 'dotted'] as const) {
    const meaning = boundedString(raw[dash], 100).trim()
    if (meaning) legend[dash] = meaning
  }
  return Object.keys(legend).length ? legend : undefined
}

function sanitizeMatch(value: unknown): MatchInfo {
  const raw = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
  return {
    home: boundedString(raw.home, 100), away: boundedString(raw.away, 100),
    homeScore: boundedString(raw.homeScore, 8) || '0', awayScore: boundedString(raw.awayScore, 8) || '0',
    clock: boundedString(raw.clock, 20), date: boundedString(raw.date, 40),
    showScoreboard: raw.showScoreboard === true, showTeams: raw.showTeams === true,
  }
}

/** Accepts a v2/v3/v4 scene, a v1 project file, or a bare objects array. */
export function migrate(data: any): Scene {
  if (!data) return emptyScene()
  if ((data.version === 4 || data.version === 2 || data.version === 3) && Array.isArray(data.objects)) {
    const objects = sanitizeObjects(data.objects)
    if (data.version !== 4) objects.sort((a, b) => TYPE_Z[a.type] - TYPE_Z[b.type])
    const style = pitchById(typeof data.pitch === 'string' ? data.pitch : undefined)
    const h = style.live ? finiteNumber(data.board?.h, style.boardH, 100, 4000) : style.boardH
    const arrowLegend = sanitizeArrowLegend(data.arrowLegend)
    return {
      version: 4, board: { w: BOARD_W, h }, pitch: style.id, match: sanitizeMatch(data.match),
      ...(arrowLegend ? { arrowLegend } : {}), objects,
    }
  }
  const v1 = Array.isArray(data.objects) ? data.objects.slice(0, MAX_IMPORTED_OBJECTS) : Array.isArray(data) ? data.slice(0, MAX_IMPORTED_OBJECTS) : []
  const v1Color: Record<string, string> = { home: TEAM_COLORS.blue, away: TEAM_COLORS.red, neutral: TEAM_COLORS.grey }
  const objects: SceneObj[] = []
  for (const o of v1) {
    if (o.type === 'player') {
      objects.push({ id: o.id ?? uid(), type: 'player', x: o.x, y: o.y, r: 13, color: v1Color[o.team] ?? TEAM_COLORS.grey, label: '', name: '', namePos: 'bottom', nameSize: 18, nameDisplay: 'last', flipX: false, flipY: false })
    } else if (o.type === 'ball') {
      objects.push({ id: o.id ?? uid(), type: 'ball', x: o.x, y: o.y, size: 20, flipX: false, flipY: false })
    } else if (o.type === 'arrow') {
      const width = 4
      const x2 = o.x2 ?? o.x, y2 = o.y2 ?? o.y
      const headSize = Math.max(12, width * 3.2)
      objects.push({
        id: o.id ?? uid(), type: 'arrow', x1: o.x, y1: o.y, x2, y2,
        mx: (o.x + x2) / 2, my: (o.y + y2) / 2,
        curved: false, dash: 'solid', color: o.color ?? '#111111', width, head: true, headSize,
      })
    } else if (o.type === 'text') {
      objects.push({ id: o.id ?? uid(), type: 'text', x: o.x, y: o.y, text: o.text ?? '', size: 18, bold: true, color: '#111111', rotation: 0, flipX: false, flipY: false })
    } else if (o.type === 'box') {
      const box: BoxObj = { id: o.id ?? uid(), type: 'box', shape: o.shape ?? 'rect', x: o.x, y: o.y, w: o.w, h: o.h, rotation: o.rotation ?? 0, fill: o.fill ?? '#9ca3af', opacity: o.opacity ?? 0.45, label: o.label ?? '', labelPos: o.labelPos ?? 'top', flipX: false, flipY: false }
      if (boxHasCorners(box.shape)) box.corners = cornersFromRect(box.x, box.y, box.w, box.h, box.rotation)
      objects.push(box)
    }
  }
  // v1 types are already pushed in tier order above. Run the same strict
  // projection used by modern transfer files before anything reaches the DOM.
  const style = pitchById(undefined)
  return { version: 4, board: { w: BOARD_W, h: style.boardH }, pitch: style.id, match: emptyMatch(), objects: sanitizeObjects(objects) }
}
