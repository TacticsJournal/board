import { Store } from './store'
import { BOARD_W, Scene, objectsInDrawOrder, isLight, headNeedsLine, paperInk, sceneIsDark, sceneLook, scenePaper, armPoints, headPoints, playerDisplayName, resolveNamePos } from './types'
import { pitchArt, pitchById, pitchIconScale, PITCH_PAPER } from './pitches'
import { nodeSegments, nodesToSvgPath, segmentEndTangent } from './path-nodes'
import { savedBoardNamesByRecency, writeSavedBoards } from './saved-board-policy'
import { icon } from './icons'
import { fontFaceCss } from './fonts.ts'
import { fontStack, haloAgainst, inkOn } from './appearance.ts'
import { getAsset } from './assets'
import { ballSrc, coneSrc, goalFullSrc, goalSmallSrc, livePlayerSrc, CONE_ASPECT, GOAL_ASPECT, LIVE_ART_SHEET, LIVE_MARKER_ELLIPSE, LIVE_PLAYER_CROP, MARKER_ASPECT } from './board-art'
import { arrowRenderedHeadSize, arrowShaftWidth, ARROW_DOT_GAP } from './board-art'
import { remoteCurrentDecision, type RemoteCurrentDecision } from './remote-current'
import {
  copyDocumentForConflict, documentScene, migrateProject, normalizeBoardDocument, normalizeDocumentArrowLegends, preserveDocumentFields, tryNormalizeBoardDocument,
  type BoardDocument, type Project,
} from './projects'

const KEY = 'tbm-projects-v1'
const STORAGE_ERROR_MESSAGE = 'Could not save boards on this device. Free some browser storage and try again; your existing saved boards were not changed.'

function escXml(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function svgNumber(value: unknown, fallback = 0): string {
  return Number.isFinite(value) ? String(value) : String(fallback)
}

/** SVG transform for a piece that carries an angle, about its own centre. */
function spin(o: any): string {
  const deg = Number(o.rotation)
  if (!Number.isFinite(deg) || deg === 0) return ''
  return ` transform="rotate(${svgNumber(deg)} ${svgNumber(o.x)} ${svgNumber(o.y)})"`
}

/** How the board turns and flips a piece about its own centre. */
function turn(o: any): string {
  const deg = Number(o.rotation)
  const sx = o.flipX ? -1 : 1
  const sy = o.flipY ? -1 : 1
  const parts: string[] = []
  if (Number.isFinite(deg) && deg !== 0) parts.push(`rotate(${svgNumber(deg)} ${svgNumber(o.x)} ${svgNumber(o.y)})`)
  if (sx < 0 || sy < 0) {
    parts.push(`translate(${svgNumber(o.x)} ${svgNumber(o.y)}) scale(${sx} ${sy}) translate(${svgNumber(-o.x)} ${svgNumber(-o.y)})`)
  }
  return parts.length ? ` transform="${parts.join(' ')}"` : ''
}

/**
 * A piece of the board's own art, centred on the object the way the board
 * centres it. The ball is the ball everywhere it is drawn; a shape traced in
 * SVG is a drawing of the ball, which is a different thing.
 *
 * A still draws the picture. A player that redraws sixty times a second points
 * at one instead: an <image> element never paints in the frame it is written,
 * even with the bytes already in hand, so a piece written fresh each frame is
 * always a frame behind the vector shapes beside it.
 */
function art(o: any, ref: string, src: string, w: number, h: number, refs: boolean): string {
  const box = ` x="${svgNumber(Number(o.x) - w / 2)}" y="${svgNumber(Number(o.y) - h / 2)}"`
    + ` width="${svgNumber(w, 1)}" height="${svgNumber(h, 1)}"`
  return refs
    ? `<use${turn(o)} href="#${ref}"${box}/>`
    : `<image${turn(o)} href="${escXml(src)}"${box} preserveAspectRatio="xMidYMid meet"/>`
}

/** Where each piece of art is kept when a renderer points at it rather than
    writing it out. An asset's id is its own, so two of a user's shapes on one
    board are two symbols. */
const ART = { ball: 'tbmArtBall', cone: 'tbmArtCone', small: 'tbmArtGoalSmall', normal: 'tbmArtGoalNormal', marker: 'tbmArtMarker' }
const assetRef = (id: string) => `tbmArtAsset-${id}`

/** A window into an art sheet, in the sheet's own pixels. */
type ArtCrop = { x: number; y: number; width: number; height: number; sheet: number }
const MARKER_CROP: ArtCrop = { ...LIVE_PLAYER_CROP, sheet: LIVE_ART_SHEET }

/** A cropped sheet, drawn through a viewport that shows only the window. */
function cropped(src: string, crop: ArtCrop): string {
  return `<image href="${escXml(src)}" x="${svgNumber(-crop.x)}" y="${svgNumber(-crop.y)}"`
    + ` width="${svgNumber(crop.sheet, 1)}" height="${svgNumber(crop.sheet, 1)}"/>`
}

/**
 * A piece of art in a box of its own rather than centred on the object: the
 * marker hangs off its ground ellipse, so its box is nowhere near its anchor
 * (board.ts buildMarker, LIVE_MARKER_ELLIPSE).
 *
 * A crop is a window on a larger sheet. Pointing at it costs nothing — the
 * symbol is already a viewport — and drawing it needs one of its own, which a
 * nested <svg> is; both show the same window at the same size, and neither
 * fetches the sheet more than once.
 */
function artBox(o: any, ref: string, src: string, box: { x: number; y: number; w: number; h: number }, refs: boolean, crop?: ArtCrop): string {
  const at = ` x="${svgNumber(box.x)}" y="${svgNumber(box.y)}" width="${svgNumber(box.w, 1)}" height="${svgNumber(box.h, 1)}"`
  if (refs) return `<use${turn(o)} href="#${ref}"${at}/>`
  if (crop) {
    return `<svg${turn(o)}${at} viewBox="0 0 ${svgNumber(crop.width, 1)} ${svgNumber(crop.height, 1)}"`
      + ` preserveAspectRatio="xMidYMid meet" overflow="hidden">${cropped(src, crop)}</svg>`
  }
  return `<image${turn(o)} href="${escXml(src)}"${at} preserveAspectRatio="xMidYMid meet"/>`
}

/**
 * Every picture the given scenes draw: what it is called, where it comes from
 * and the shape of it. The player writes these as symbols and fetches them up
 * front, because a picture only starts loading once something points at it —
 * a piece first drawn mid-move would otherwise arrive a download late.
 */
export function boardArt(scenes: (Scene | undefined)[]): { id: string, src: string, aspect: number, crop?: ArtCrop }[] {
  const objs = scenes.flatMap(s => s?.objects ?? [])
  const art: { id: string, src: string, aspect: number, crop?: ArtCrop }[] = []
  if (objs.some(o => o.type === 'ball')) art.push({ id: ART.ball, src: ballSrc, aspect: 1 })
  if (objs.some(o => o.type === 'cone')) art.push({ id: ART.cone, src: coneSrc, aspect: CONE_ASPECT })
  if (objs.some(o => o.type === 'goal' && o.variant === 'small')) art.push({ id: ART.small, src: goalSmallSrc, aspect: GOAL_ASPECT.small })
  if (objs.some(o => o.type === 'goal' && o.variant !== 'small')) art.push({ id: ART.normal, src: goalFullSrc, aspect: GOAL_ASPECT.normal })
  if (objs.some(o => o.type === 'marker')) art.push({ id: ART.marker, src: livePlayerSrc, aspect: MARKER_ASPECT, crop: MARKER_CROP })
  const seen = new Set<string>()
  for (const o of objs) {
    if (o.type !== 'image' || seen.has(String(o.assetId))) continue
    seen.add(String(o.assetId))
    const asset = getAsset(String(o.assetId))
    if (asset) art.push({ id: assetRef(String(o.assetId)), src: asset.src, aspect: Number(o.aspect) > 0 ? Number(o.aspect) : 1 })
  }
  return art
}

/**
 * Every picture the given scenes draw, as symbols to point at. Written once by
 * the player and left alone, so the pieces paint the frame they are asked for.
 */
export function boardArtDefs(scenes: (Scene | undefined)[]): string {
  const parts = boardArt(scenes).map(({ id, src, aspect, crop }) =>
    crop
      // a symbol is a viewport, so the window is all of the sheet that shows
      ? `<symbol id="${id}" viewBox="0 0 ${svgNumber(crop.width, 1)} ${svgNumber(crop.height, 1)}" preserveAspectRatio="xMidYMid meet">`
        + `${cropped(src, crop)}</symbol>`
      : `<symbol id="${id}" viewBox="0 0 100 ${svgNumber(100 * aspect, 100)}" preserveAspectRatio="xMidYMid meet">`
        + `<image href="${escXml(src)}" width="100" height="${svgNumber(100 * aspect, 100)}"/></symbol>`)
  return parts.length ? `<defs>${parts.join('')}</defs>` : ''
}

/**
 * The scene's objects as SVG shapes in draw order, without the pitch or any
 * wrapper. The saved-board thumbnail and the sequence row share it so a board
 * looks the same wherever it is drawn.
 */
/** How a board's own text is set, so the SVG reads like the board. The family
    and its tracking come off the scene, as they do on the board itself. */
function labelFont(scene: Scene | undefined): string {
  const look = sceneLook(scene)
  const tracking = look['tracking'] ? ` letter-spacing="${svgNumber(look['tracking'] as number)}"` : ''
  return `font-family="${escXml(fontStack(look['font'] as string))}" font-weight="700" text-anchor="middle"${tracking}`
}

/** Two pitches on one board draw every piece at half size, as the board does. */
function iconScale(scene: Scene | undefined): number {
  return pitchIconScale(scene?.pitch)
}

/** Arrow heads follow the scene's own pitch, as they do on the board. */
function sceneIsLive(scene: Scene | undefined): boolean {
  return !!pitchById(scene?.pitch).live
}

export function sceneShapesSvg(scene: Scene | undefined, opts: { fading?: Set<string>; fade?: number; arriving?: Set<string>; arrive?: number; riding?: Set<string>; ride?: number; art?: 'draw' | 'point' } = {}): string {
  const objs = objectsInDrawOrder(scene?.objects ?? [])
  const k = iconScale(scene)
  /* The board's family, as bytes. An SVG painted into an `<img>` is its own
     document and cannot see a font the page has loaded, so a thumbnail in a
     searched family would silently come back in the fallback. Carrying the
     file makes what is exported what was drawn. */
  const look = sceneLook(scene)
  const face = fontFaceCss(look['font'] as string)
  const LABEL_FONT = labelFont(scene)
  const refs = opts.art === 'point'
  const onDark = sceneIsDark(scene)
  const parts: string[] = []
  if (face) parts.push(`<style>${face}</style>`)
  for (const o of objs) {
    const start = parts.length
    if (o.type === 'box') {
      const x = Number(o.x), y = Number(o.y), w = Number(o.w), h = Number(o.h), rotation = Number(o.rotation)
      const tr = Number.isFinite(rotation) && rotation !== 0 ? ` transform="rotate(${svgNumber(rotation)} ${svgNumber(x)} ${svgNumber(y)})"` : ''
      const tri = `${svgNumber(x)},${svgNumber(y - h / 2)} ${svgNumber(x + w / 2)},${svgNumber(y + h / 2)} ${svgNumber(x - w / 2)},${svgNumber(y + h / 2)}`
      const zoneNodes = Array.isArray(o.corners) && o.corners.length >= 3 ? o.corners : null
      parts.push(zoneNodes
        ? `<path d="${nodesToSvgPath(zoneNodes, true, n => svgNumber(n))}" fill="${escXml(o.fill)}" opacity="${svgNumber(o.opacity, 1)}"/>`
        : o.shape === 'ellipse'
        ? `<ellipse cx="${svgNumber(x)}" cy="${svgNumber(y)}" rx="${svgNumber(w / 2)}" ry="${svgNumber(h / 2)}" fill="${escXml(o.fill)}" opacity="${svgNumber(o.opacity, 1)}"${tr}/>`
        : o.shape === 'triangle'
        ? `<polygon points="${tri}" fill="${escXml(o.fill)}" opacity="${svgNumber(o.opacity, 1)}"${tr}/>`
        : `<rect x="${svgNumber(x - w / 2)}" y="${svgNumber(y - h / 2)}" width="${svgNumber(w)}" height="${svgNumber(h)}" fill="${escXml(o.fill)}" opacity="${svgNumber(o.opacity, 1)}"${tr}/>`)
    } else if (o.type === 'arrow') {
      /* the same shaft, dash, shortening and head the board draws (board.ts
         makeArrowShape): an arrow is the one object a reader traces with a
         finger, so it cannot be a near-enough version of itself */
      const x1 = Number(o.x1), y1 = Number(o.y1), x2 = Number(o.x2), y2 = Number(o.y2)
      const width = Number(o.width)
      const shaft = arrowShaftWidth(width, o.dash, sceneIsLive(scene)) * k
      const dash = o.dash === 'dotted' ? ` stroke-dasharray="0.001 ${svgNumber(shaft * ARROW_DOT_GAP)}" stroke-linecap="round"`
        : o.dash === 'dashed' ? ` stroke-dasharray="${svgNumber(width * 2.4)} ${svgNumber(width * 2)}"` : ''
      const arrowNodes = Array.isArray(o.points) && o.points.length >= 2 ? o.points : null
      const control = o.curved ? { x: 2 * Number(o.mx) - (x1 + x2) / 2, y: 2 * Number(o.my) - (y1 + y2) / 2 } : null
      const tangent = arrowNodes
        ? (() => { const segs = nodeSegments(arrowNodes, false); return segs.length ? segmentEndTangent(segs[segs.length - 1]) : { x: 1, y: 0 } })()
        : (() => {
          const dx = control ? x2 - control.x : x2 - x1
          const dy = control ? y2 - control.y : y2 - y1
          const len = Math.hypot(dx, dy) || 1
          return { x: dx / len, y: dy / len }
        })()
      const head = o.head && !o.measure ? arrowRenderedHeadSize(width, o.dash, sceneIsLive(scene)) * k * (look['arrow.head'] as number) : 0
      // the shaft stops short of the head rather than running underneath it
      const back = head * 0.8
      const d = arrowNodes
        ? nodesToSvgPath(arrowNodes, false, n => svgNumber(n), back)
        : (() => {
          const ex = x2 - tangent.x * back, ey = y2 - tangent.y * back
          return control
            ? `M ${svgNumber(x1)} ${svgNumber(y1)} Q ${svgNumber(control.x)} ${svgNumber(control.y)} ${svgNumber(ex)} ${svgNumber(ey)}`
            : `M ${svgNumber(x1)} ${svgNumber(y1)} L ${svgNumber(ex)} ${svgNumber(ey)}`
        })()
      parts.push(`<path d="${d}" fill="none" stroke="${escXml(o.color)}" stroke-width="${svgNumber(shaft, 6)}"${dash}/>`)
      if (head) {
        const px = -tangent.y, py = tangent.x
        const bx = x2 - tangent.x * head, by = y2 - tangent.y * head
        const hw = head * 0.62
        // a concave back, so the head reads as a point rather than a wedge
        parts.push(`<path d="M ${svgNumber(x2)} ${svgNumber(y2)}`
          + ` L ${svgNumber(bx + px * hw)} ${svgNumber(by + py * hw)}`
          + ` Q ${svgNumber(bx + tangent.x * head * 0.3)} ${svgNumber(by + tangent.y * head * 0.3)}`
          + ` ${svgNumber(bx - px * hw)} ${svgNumber(by - py * hw)} Z" fill="${escXml(o.color)}"/>`)
      }
    } else if (o.type === 'player') {
      // the dot says what it says on the board: its number inside, its name under
      const x = Number(o.x), y = Number(o.y)
      const r = Math.max(Number(o.r) * k, 14 * k)
      if (Number.isFinite(o.arms)) {
        for (const side of [-1, 1] as const) {
          const pts = armPoints(Number(o.arms), side, r)
          const d = pts.reduce((acc, _v, i) => i % 2 === 0
            ? `${acc}${i ? ' L' : 'M'} ${svgNumber(x + pts[i])} ${svgNumber(y + pts[i + 1])}`
            : acc, '')
          parts.push(`<path d="${d} Z" fill="#0b0b0e"/>`)
        }
      }
      if (Number.isFinite(o.facing)) {
        const pts = headPoints(Number(o.facing), r)
        const pale = headNeedsLine(String(o.color), onDark)
        const d = `M ${svgNumber(x + pts[0])} ${svgNumber(y + pts[1])}`
          + ` L ${svgNumber(x + pts[2])} ${svgNumber(y + pts[3])}`
          + ` L ${svgNumber(x + pts[4])} ${svgNumber(y + pts[5])} Z`
        parts.push(`<path d="${d}" fill="${escXml(o.color)}"`
          + (pale ? ` stroke="${paperInk(onDark)}" stroke-width="${svgNumber(Math.max(0.75, r * 0.12), 1.5)}" stroke-linejoin="round"` : '')
          + `/>`)
      }
      const outline = look['player.outline'] as number
      const ring = outline > 0 ? Math.max(1.25, r * outline) : 0
      parts.push(`<circle cx="${svgNumber(x)}" cy="${svgNumber(y)}" r="${svgNumber(r, 14)}" fill="${escXml(o.color)}"${ring ? ` stroke="${escXml(look['player.outlineColor'] as string)}" stroke-width="${svgNumber(ring, 3.5)}"` : ''}/>`)
      if (o.label && o.showLabel !== false) {
        const size = r * 1.05
        parts.push(`<text x="${svgNumber(x)}" y="${svgNumber(y + size * 0.35)}" ${LABEL_FONT} font-size="${svgNumber(size, 14)}" fill="${escXml(inkOn(look['player.numberColor'], String(o.color)))}">${escXml(o.label)}</text>`)
      }
      const name = playerDisplayName(String(o.name ?? ''), o.nameDisplay)
      if (name) {
        const size = Math.max(Number(o.nameSize) || 18, 8) * k
        const gap = 5 * k
        const baseline = resolveNamePos(o) === 'top' ? y - (r + gap + size * 0.2) : y + r + gap + size * 0.8
        const nameColor = look['player.nameColor'] as string
        const nameHalo = (look['player.nameHalo'] as number) * k
        parts.push(`<text x="${svgNumber(x)}" y="${svgNumber(baseline)}" ${LABEL_FONT} font-size="${svgNumber(size, 18)}" fill="${escXml(nameColor)}"`
          + (nameHalo > 0 ? ` stroke="${escXml(haloAgainst(look['player.nameHaloColor'], nameColor))}" stroke-width="${svgNumber(nameHalo, 2)}" paint-order="stroke" stroke-linejoin="round"` : '')
          + `>${escXml(name)}</text>`)
      }
    } else if (o.type === 'ball') {
      const size = Number(o.size) * k
      parts.push(art(o, ART.ball, ballSrc, size, size, refs))
    } else if (o.type === 'cone') {
      const w = Number(o.size) * k
      parts.push(art(o, ART.cone, coneSrc, w, w * CONE_ASPECT, refs))
    } else if (o.type === 'goal') {
      const w = Number(o.size) * k
      const small = o.variant === 'small'
      parts.push(art(o, small ? ART.small : ART.normal, small ? goalSmallSrc : goalFullSrc, w, w * GOAL_ASPECT[o.variant], refs))
    } else if (o.type === 'image') {
      const w = Number(o.size) * k
      const h = w * (Number(o.aspect) > 0 ? Number(o.aspect) : 1)
      const asset = getAsset(String(o.assetId))
      parts.push(asset
        ? art(o, assetRef(String(o.assetId)), asset.src, w, h, refs)
        // the shape is on another device: the frame it occupies is all there is
        : `<rect${spin(o)} x="${svgNumber(Number(o.x) - w / 2)}" y="${svgNumber(Number(o.y) - h / 2)}" width="${svgNumber(w, 20)}" height="${svgNumber(h, 20)}" rx="${svgNumber(Math.min(w, h) * 0.12, 2)}" fill="#cbc3b6" opacity="0.55"/>`)
    } else if (o.type === 'marker') {
      /* the board's own live-player photograph, cropped, sized and hung the
         way board.ts buildMarker hangs it: the object's x/y is the centre of
         the ground ellipse inside the art, not the centre of the art, so the
         picture's box is offset by the ellipse's place in the crop. Rotation
         and flip turn about that same anchor, as the board's group does. */
      const x = Number(o.x), y = Number(o.y)
      const w = Number(o.w) * k
      const h = w * MARKER_ASPECT
      const ry = h * LIVE_MARKER_ELLIPSE.ry
      const box = { x: x - w * LIVE_MARKER_ELLIPSE.cx, y: y - h * LIVE_MARKER_ELLIPSE.cy, w, h }
      parts.push(artBox(o, ART.marker, livePlayerSrc, box, refs, MARKER_CROP))
      const name = playerDisplayName(String(o.name ?? ''), 'last')
      if (name) {
        // the name turns with the marker but is never mirrored with it, the
        // way the board's text rides the group the flipped picture sits in
        const size = 15 * k, gap = 7 * k
        const baseline = o.namePos === 'top' ? y - (ry + gap + size * 0.2) : y + ry + gap + size * 0.8
        parts.push(`<text${spin(o)} x="${svgNumber(x)}" y="${svgNumber(baseline)}" ${LABEL_FONT} font-size="${svgNumber(size, 15)}" fill="#ffffff" stroke="rgba(0,0,0,0.55)" stroke-width="${svgNumber(2.5 * k, 2.5)}" paint-order="stroke">${escXml(name)}</text>`)
      }
    } else if (o.type === 'text') {
      const size = Math.max(Number(o.size), 20)
      const rotation = Number(o.rotation)
      const tr = Number.isFinite(rotation) && rotation !== 0 ? ` transform="rotate(${svgNumber(rotation)} ${svgNumber(o.x)} ${svgNumber(o.y)})"` : ''
      parts.push(`<text x="${svgNumber(o.x)}" y="${svgNumber(Number(o.y) + size * 0.85)}" font-size="${svgNumber(size, 20)}" font-weight="${o.bold ? 700 : 400}" fill="${escXml(o.color)}"${tr}>${escXml(o.text)}</text>`)
    }
    // The canvas puts the whole player in its rotated group. Keep the SVG's
    // mark and automatically placed name on the same rendered sides.
    if (o.type === 'player' && Number.isFinite(o.rotation) && o.rotation !== 0) {
      const inner = parts.splice(start).join('')
      parts.push(`<g${spin(o)}>${inner}</g>`)
    }
    // an object on its way out of a sequence fades where it stands, and one
    // on its way in fades up where it will be
    const alpha = opts.fading?.has(o.id) ? opts.fade
      : opts.arriving?.has(o.id) ? opts.arrive
      : opts.riding?.has(o.id) ? opts.ride
      : undefined
    if (alpha !== undefined && parts.length > start) {
      const inner = parts.splice(start).join('')
      parts.push(`<g opacity="${svgNumber(alpha, 1)}">${inner}</g>`)
    }
  }
  return parts.join('')
}

/** Board height the pitch style asks for, or the live board's own height. */
export function sceneBoardHeight(scene: Scene | undefined): number {
  const style = pitchById(scene?.pitch)
  const candidate = Number(scene?.board?.h)
  return style.live && Number.isFinite(candidate) ? candidate : style.boardH
}

/**
 * The pitch image element for a scene, empty for pitch styles without art.
 *
 * An uploaded background keeps its bytes in storage rather than in the pitch
 * style, so its style carries no `src`. Whoever is drawing owns that read and
 * hands the bytes in here as `resolved`; until they arrive the board is drawn
 * without art, exactly as it always was.
 */
export function scenePitchImage(scene: Scene | undefined, resolved?: string | null): string {
  const style = pitchById(scene?.pitch)
  const bh = sceneBoardHeight(scene)
  const paper = scenePaper(scene)
  const src = pitchArt(style, paper) || (style.custom ? resolved || '' : '')
  // Dark paper goes down first, so a thumbnail whose art has not arrived is
  // not a white card with white lettering on it.
  const under = paper !== 'white' ? `<rect width="${BOARD_W}" height="${svgNumber(bh, style.boardH)}" fill="${PITCH_PAPER[paper]}"/>` : ''
  return under + (src ? `<image href="${escXml(src)}" width="${BOARD_W}" height="${svgNumber(bh, style.boardH)}"/>` : '')
}

export function previewSvg(scene: Scene | undefined, resolved?: string | null): string {
  const style = pitchById(scene?.pitch)
  const bh = sceneBoardHeight(scene)
  return `<svg viewBox="0 0 ${BOARD_W} ${svgNumber(bh, style.boardH)}" preserveAspectRatio="xMidYMid slice">${scenePitchImage(scene, resolved)}${sceneShapesSvg(scene)}</svg>`
}

/** `id` is what survives a rename, so sync knows this is the same board. */
export type SavedProject = { savedAt: string; scene: BoardDocument; id?: string; importId?: string }

/** Ids are opaque and only have to be unique and URL-safe. */
export function newId(random: () => number = Math.random): string {
  let out = ''
  while (out.length < 20) out += Math.floor(random() * 36 ** 6).toString(36)
  return `b-${out.slice(0, 20)}`
}

/** A name that says where the kept copy came from, without growing every time. */
export function conflictName(name: string): string {
  return /\(this device\)$/.test(name) ? name : `${name} (this device)`
}

/** A full Project document and the stable id of the saved row that carries it. */
export type SavedProjectDocument = {
  name: string
  rowId: string
  project: Project
  savedAt: string
  importId?: string
}

export type BoardDocumentAdapter = {
  getDocument: () => BoardDocument
  loadDocument: (document: BoardDocument, saved: { name: string; id: string | null }) => void
}

type SavedProjects = Record<string, SavedProject>

function isSavedProject(value: unknown): value is SavedProject {
  return !!value && typeof value === 'object'
    && typeof (value as SavedProject).savedAt === 'string'
    && !!(value as SavedProject).scene && typeof (value as SavedProject).scene === 'object'
}

/**
 * Every saved row is a local project. Rows written while Board had accounts
 * may still carry sync and sharing fields; they mean nothing now, so a copy
 * shared from someone else is simply a local project this browser keeps.
 */
function localRow(saved: SavedProject): SavedProject {
  const { savedAt, scene, id, importId } = saved
  return { savedAt, scene, ...(typeof id === 'string' && id ? { id } : {}), ...(typeof importId === 'string' ? { importId } : {}) }
}

function readAll(storageKey = KEY): SavedProjects {
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey) ?? '{}')
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return Object.fromEntries(Object.entries(parsed)
      .filter((entry): entry is [string, SavedProject] => isSavedProject(entry[1]))
      .map(([name, saved]) => [name, localRow(saved)]))
  } catch { return {} }
}

/** Refuse to replace malformed data; a later write must not turn recovery into data loss. */
function storedSetIsWritable(storageKey: string): boolean {
  try {
    const raw = localStorage.getItem(storageKey)
    if (raw === null) return true
    const parsed = JSON.parse(raw)
    return !!parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      && Object.values(parsed).every(isSavedProject)
  } catch { return false }
}

function writeAll(all: SavedProjects, storageKey = KEY): boolean {
  return storedSetIsWritable(storageKey) && writeSavedBoards(localStorage, storageKey, all).ok
}

export type SavesPanelOptions = {
  /** Optional localStorage key override. */
  storageKey?: string
  /** Optional seed data. */
  seedProjects?: Record<string, SavedProject>
  /** Replace the storage key with seedProjects on construction. */
  resetToSeed?: boolean
  /** Board name whose live edits should be written back to the save list. */
  currentName?: string
}

export class SavesPanel {
  el: HTMLDivElement
  /** Saves-list entry the board on screen belongs to; live edits flow into it. */
  private currentName: string | null = null
  /** Stable across a remote rename; null means the canvas is detached. */
  private currentId: string | null = null
  /** The outstanding remote choice, including the special deleted-record case. */
  private pendingRemoteDecision: RemoteCurrentDecision = 'none'
  /** Last document known not to need saving; also tracks a fresh unsaved canvas. */
  private currentSavedSceneJson: string | null = null
  /** Raw document last loaded, retained so future fields survive an edit here. */
  private currentDocumentTemplate: unknown = null
  private storageKey: string
  private documentAdapter: BoardDocumentAdapter
  /**
   * Set by main: starts a new working board. 'blank' clears it; 'teams'
   * builds a home-vs-away kickoff. Returns false when it could not run
   * (teams not configured yet - the Teams sheet opens instead).
   */
  onNewBoard: (kind: 'blank' | 'teams') => boolean = () => false
  /** Set by main: the panel lives in the Settings sheet (Saves tab), so
      open/close delegate to the sheet's tab navigation. */
  onOpen: () => void = () => {}
  onClose: () => void = () => {}
  /** Set by main: fires when another tab wrote a newer version of the
      board currently on screen (same saved-board name, different scene
      than what this tab last knew about). Lets the caller offer to load
      the newer version, keep the local copy, or export a backup first. */
  onExternalConflict: (name: string, state?: RemoteCurrentDecision) => void = () => {}
  /** Set by main: what to call a board saved without anyone naming it. */
  defaultBoardName: () => string = () => ''

  constructor(private store: Store, host: HTMLElement, options: SavesPanelOptions = {}) {
    this.storageKey = options.storageKey ?? KEY
    this.documentAdapter = {
      getDocument: () => this.store.scene,
      loadDocument: (document) => this.store.loadScene(documentScene(document)),
    }
    this.currentName = options.currentName ?? null
    const currentSaved = this.currentName ? readAll(this.storageKey)[this.currentName] : undefined
    this.currentId = currentSaved?.id ?? null
    this.currentDocumentTemplate = currentSaved ? JSON.parse(JSON.stringify(currentSaved.scene)) : null
    if (options.seedProjects && (options.resetToSeed || !Object.keys(readAll(this.storageKey)).length)) {
      writeAll({ ...options.seedProjects }, this.storageKey)
    }
    this.currentSavedSceneJson = this.sceneJson()
    this.el = document.createElement('div')
    this.el.className = 'svPane'
    this.el.innerHTML = `
      <div class="setGroup">
        <label class="setItem setSearchItem">
          ${icon('file-text')}
          <input class="setSearch" data-sv="name" maxlength="40" placeholder="Board name">
        </label>
        <button class="setItem" data-sv="save">${icon('check')}<span class="setItemLabel">Save the board on screen</span></button>
      </div>
      <div class="setGroupHead">New board</div>
      <div class="setGroup">
        <button class="setItem" data-sv="new-blank">${icon('file-plus')}<span class="setItemLabel">Blank</span></button>
        <button class="setItem" data-sv="new-teams">${icon('users')}<span class="setItemLabel">Home vs Away</span></button>
      </div>
      <p class="setNote">Home vs Away starts a kickoff board from the teams you have set. The board on screen is saved here automatically before a new one starts.</p>
      <div class="setNote saveStatus" data-sv="status" role="status" aria-live="polite"></div>
      <div class="saveList" data-sv="list"></div>`
    host.appendChild(this.el)
    if (this.currentName) this.nameInput().value = this.currentName
    this.el.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest('[data-sv]') as HTMLElement | null
      if (!btn) return
      const k = btn.dataset.sv
      if (k === 'new-blank' || k === 'new-teams') this.startNew(k === 'new-blank' ? 'blank' : 'teams')
      else if (k === 'save') this.save()
      else if (k === 'load') this.load(btn.dataset.name!)
      else if (k === 'delete') this.remove(btn.dataset.name!)
    })
    window.addEventListener('storage', (event) => {
      if (event.storageArea !== localStorage || event.key !== this.storageKey) return
      const all = readAll(this.storageKey)
      const found = this.currentId && Object.entries(all).find(([, project]) => project.id === this.currentId)
      const changed = !!this.currentId && (!found || found[0] !== this.currentName
        || JSON.stringify(found[1].scene) !== JSON.stringify(this.currentDocumentTemplate))
      if (changed) {
        const decision = remoteCurrentDecision([this.currentId!], this.currentId, !!found, !this.isCurrentSaved())
        this.pendingRemoteDecision = decision
        if (decision === 'load') { this.applyLoad(found![0], all, false); this.pendingRemoteDecision = 'none' }
        else if (decision === 'detach') { this.detachCurrent('Deleted in another tab. The board remains on screen to export or save as a new board.'); this.pendingRemoteDecision = 'none' }
        else this.onExternalConflict(this.currentName ?? found?.[0] ?? 'this board', decision)
      }
      this.renderList()
    })
  }

  private startNew(kind: 'blank' | 'teams') {
    // onNewBoard owns the state transition. A blocked save or incomplete
    // teams setup must leave the current board name and identity untouched.
    if (this.onNewBoard(kind)) this.close()
  }

  /** Keep the current board before it is replaced. */
  autosaveCurrent(_quiet = false, defaultName?: string): boolean {
    if (this.pendingRemoteDecision === 'conflict' || this.pendingRemoteDecision === 'conflict-delete') return false
    const all = readAll(this.storageKey)
    const sceneJson = this.sceneJson()
    // "unchanged" only means anything once there is a board to be unchanged
    // from: on a fresh canvas this marker matches and no board exists
    if (this.currentName && this.currentSavedSceneJson === sceneJson) return true
    if (this.currentName && all[this.currentName]) return this.autosaveNamed(this.currentName, all)
    if (Object.values(all).some(p => JSON.stringify(p.scene) === sceneJson)) return true
    // a board saved in the background is named after the board it is, not
    // after the moment it happened to be saved
    const base = this.nameInput().value.trim() || defaultName?.trim() || this.defaultBoardName().trim() || `Board ${new Date().toLocaleString()}`
    const name = this.uniqueName(base, all)
    all[name] = this.snapshot()
    if (!this.commit(all)) return false
    this.currentDocumentTemplate = JSON.parse(JSON.stringify(all[name].scene))
    this.currentName = name
    this.currentId = all[name].id ?? null
    this.currentSavedSceneJson = this.sceneJson()
    this.nameInput().value = name
    return true
  }

  open() {
    this.onOpen()
    this.renderList()
  }
  close() { this.onClose() }

  /** Refresh the list in place (called when the Saves tab is shown). */
  refresh() { this.reconcileCurrent(); this.renderList() }

  /**
   * Enumerate only full Project documents. Legacy one-scene saves remain out
   * of the library bridge. Every returned row id has been durably assigned.
   */
  projectDocuments(): SavedProjectDocument[] {
    const all = readAll(this.storageKey)
    const next: SavedProjects = { ...all }
    let assigned = false
    for (const [name, saved] of Object.entries(all)) {
      if (!migrateProject(saved.scene) || typeof saved.id === 'string' && saved.id) continue
      next[name] = { ...saved, id: newId() }
      assigned = true
    }
    if (assigned && !writeAll(next, this.storageKey)) return []
    const source = assigned ? next : all
    return Object.entries(source).flatMap(([name, saved]) => {
      const project = migrateProject(saved.scene)
      if (!project || !saved.id) return []
      return [{
        name, rowId: saved.id, project, savedAt: saved.savedAt,
        ...(saved.importId ? { importId: saved.importId } : {}),
      }]
    })
  }

  /**
   * Write Project documents by Project id, never by their display name. A
   * rename therefore keeps its row id and every row-owned bit of metadata.
   */
  persistProjectDocuments(projects: readonly Project[]): boolean {
    const all = readAll(this.storageKey)
    const next: SavedProjects = { ...all }
    const now = new Date().toISOString()
    let changed = false
    for (const project of projects) {
      const found = Object.entries(next).find(([, saved]) => migrateProject(saved.scene)?.id === project.id)
      const oldName = found?.[0]
      const existing = found?.[1]
      const scene = existing ? preserveDocumentFields(existing.scene, project) : project
      const base = project.name.trim() || 'Untitled project'
      let name = base
      let suffix = 2
      while (next[name] && name !== oldName) name = `${base} (${suffix++})`
      if (existing && oldName === name && JSON.stringify(existing.scene) === JSON.stringify(scene)) continue
      if (oldName && oldName !== name) delete next[oldName]
      next[name] = {
        ...(existing ?? {}),
        id: existing?.id || newId(),
        savedAt: now,
        scene,
      }
      changed = true
    }
    if (!changed) return true
    return this.commit(next)
  }

  private nameInput() { return this.el.querySelector('[data-sv="name"]') as HTMLInputElement }
  private showStatus(message: string) {
    const status = this.el.querySelector('[data-sv="status"]') as HTMLElement
    status.textContent = message
  }
  /** True when the on-screen board matches the last persisted state. */
  isCurrentSaved(): boolean {
    return this.currentSavedSceneJson === this.sceneJson()
  }

  /** The stable id of the saved board on screen, assigning one to a legacy row when needed. */
  currentBoardId(): string | null {
    if (this.currentId || !this.currentName) return this.currentId
    const all = readAll(this.storageKey)
    const saved = all[this.currentName]
    if (!saved) return null
    if (!saved.id) {
      saved.id = newId()
      if (!this.commit(all)) return null
    }
    this.currentId = saved.id
    return this.currentId
  }

  /** Delete the owned durable row that belongs to a project removed from the library. */
  removeDocument(documentId: string): boolean {
    const all = readAll(this.storageKey)
    const found = Object.entries(all).find(([, saved]) => {
      const project = 'boards' in saved.scene ? saved.scene : null
      return project?.id === documentId || (!project && saved.id === documentId)
    })
    if (!found) return true
    const next = { ...all }
    delete next[found[0]]
    if (!this.commit(next)) return false
    if (this.currentId === found[1].id) this.detachCurrent()
    return true
  }

  /**
   * Follow a project selected in the local library to its durable saved row.
   * A project with no row stays detached until autosave creates one.
   */
  activateDocument(documentId: string): boolean {
    const all = readAll(this.storageKey)
    const found = Object.entries(all).find(([, saved]) => {
      const project = 'boards' in saved.scene ? saved.scene : null
      return project?.id === documentId || (!project && saved.id === documentId)
    })
    if (!found) {
      this.detachCurrent()
      return false
    }
    // The saved row may have changed in another tab while another project was
    // open. Load that durable copy instead of blessing a stale local project.
    return this.applyLoad(found[0], all, false)
  }

  /** Legacy name retained while saved `scene` can hold a whole document. */
  private sceneJson(): string { return JSON.stringify(normalizeBoardDocument(this.documentAdapter.getDocument())) }
  private documentForSave(): BoardDocument {
    const current = normalizeBoardDocument(this.documentAdapter.getDocument())
    return preserveDocumentFields(this.currentDocumentTemplate, current)
  }

  /** Bind persistence to a multi-board editor; standalone use remains a Scene. */
  setDocumentAdapter(getDocument: BoardDocumentAdapter['getDocument'], loadDocument: BoardDocumentAdapter['loadDocument']): void {
    this.documentAdapter = { getDocument, loadDocument }
    this.currentSavedSceneJson = this.sceneJson()
  }
  private detachCurrent(status = ''): void {
    this.currentName = null
    this.currentId = null
    this.currentDocumentTemplate = null
    this.currentSavedSceneJson = this.sceneJson()
    this.nameInput().value = ''
    this.showStatus(status)
  }
  private snapshot(): SavedProject {
    // Saving over a board, or renaming one, keeps its id: it is the same board
    // edited, not a new one appearing.
    const all = readAll(this.storageKey)
    const existing = (this.currentName ? all[this.currentName] : undefined)
      ?? Object.values(all).find((project) => project.id === this.currentId)
    return {
      savedAt: new Date().toISOString(),
      scene: this.documentForSave(),
      id: existing?.id || newId(),
    }
  }
  private commit(all: SavedProjects): boolean {
    if (!writeAll(all, this.storageKey)) { this.showStatus(STORAGE_ERROR_MESSAGE); return false }
    this.showStatus('')
    return true
  }
  private uniqueName(base: string, all: SavedProjects): string {
    if (!all[base]) return base
    let i = 2
    while (all[`${base} (${i})`]) i++
    return `${base} (${i})`
  }
  private reconcileCurrent() {
    if (!this.currentId) return
    const found = Object.entries(readAll(this.storageKey)).find(([, project]) => project.id === this.currentId)
    if (!found) {
      if (this.isCurrentSaved()) this.detachCurrent()
      return
    }
    // A clean canvas follows a rename in another tab by id. A dirty canvas keeps
    // its old label until the conflict decision makes a safe local copy.
    if (this.isCurrentSaved()) {
      this.currentName = found[0]
      this.nameInput().value = found[0]
    }
  }
  private autosaveNamed(name: string, all: SavedProjects): boolean {
    const sceneJson = this.sceneJson()
    if (this.currentSavedSceneJson === sceneJson) return true
    all[name] = this.snapshot()
    if (!this.commit(all)) return false
    this.currentDocumentTemplate = JSON.parse(JSON.stringify(all[name].scene))
    this.currentSavedSceneJson = sceneJson
    return true
  }

  private save() {
    const all = readAll(this.storageKey)
    const name = this.nameInput().value.trim() || `Board ${new Date().toLocaleDateString()}`
    const currentExists = !!this.currentName && !!all[this.currentName]
    if (all[name] && !confirm(`Overwrite saved board "${name}"?`)) return

    const next = { ...all }
    if (currentExists && this.currentName !== name) delete next[this.currentName!]
    next[name] = this.snapshot()
    if (!this.commit(next)) return
    this.currentDocumentTemplate = JSON.parse(JSON.stringify(next[name].scene))
    this.nameInput().value = name
    this.currentName = name
    this.currentId = next[name].id ?? null
    this.currentSavedSceneJson = this.sceneJson()
    this.renderList()
  }

  private load(name: string) {
    const all = readAll(this.storageKey)
    const p = all[name]
    if (!p) return
    this.applyLoad(name, all)
  }

  private applyLoad(name: string, all: SavedProjects, close = true): boolean {
    const p = all[name]
    if (!p) return false
    const template = JSON.parse(JSON.stringify(p.scene))
    const document = tryNormalizeBoardDocument(template)
    if (!document) {
      this.detachCurrent('This board uses a document format this version cannot open. The stored copy was not changed.')
      this.renderList()
      return false
    }
    this.currentDocumentTemplate = template
    this.documentAdapter.loadDocument(document, { name, id: p.id ?? null })
    this.nameInput().value = name
    this.currentName = name
    this.currentId = p.id ?? null
    this.currentSavedSceneJson = this.sceneJson()
    this.showStatus('')
    this.renderList()
    if (close) this.close()
    return true
  }

  /** Give a new canvas its own saved board. */
  registerNew(): boolean {
    const all = readAll(this.storageKey)
    let n = 1
    while (all[`Board ${n}`]) n++
    const name = `Board ${n}`
    all[name] = this.snapshot()
    if (!this.commit(all)) {
      this.detachCurrent()
      return false
    }
    this.currentDocumentTemplate = JSON.parse(JSON.stringify(all[name].scene))
    this.nameInput().value = name
    this.currentName = name
    this.currentId = all[name].id ?? null
    this.currentSavedSceneJson = this.sceneJson()
    return true
  }

  /** Debounced from main: only the current editable saved record is updated. */
  autosaveLive(): boolean {
    if (!this.currentName) return false
    const all = readAll(this.storageKey)
    if (!all[this.currentName]) {
      if (this.pendingRemoteDecision === 'conflict' || this.pendingRemoteDecision === 'conflict-delete') return false
      this.detachCurrent()
      return false
    }
    return this.autosaveNamed(this.currentName, all)
  }

  /** Reload the current board from its latest stored record, discarding
      any local changes this tab made since it last saved or loaded it.
      Used when the user resolves an open-board conflict by choosing the
      newer version from another tab. */
  reloadCurrentFromStorage(): boolean {
    if (this.pendingRemoteDecision === 'conflict-delete') return this.acceptRemoteDeletion()
    const all = readAll(this.storageKey)
    const found = this.currentId && Object.entries(all).find(([, project]) => project.id === this.currentId)
    if (!found) return false
    this.pendingRemoteDecision = 'none'
    return this.applyLoad(found[0], all)
  }

  /** Keep a dirty conflicting canvas without overwriting the other tab's id. */
  keepCurrentConflict(): boolean {
    if (this.pendingRemoteDecision !== 'conflict' && this.pendingRemoteDecision !== 'conflict-delete') return false
    const all = readAll(this.storageKey)
    const name = this.uniqueName(conflictName(this.currentName ?? 'Board'), all)
    const id = newId()
    const document = copyDocumentForConflict(this.documentForSave(), id)
    all[name] = { id, savedAt: new Date().toISOString(), scene: document }
    if (!this.commit(all)) return false
    this.currentDocumentTemplate = JSON.parse(JSON.stringify(document))
    this.documentAdapter.loadDocument(normalizeBoardDocument(document), { name, id })
    this.currentName = name
    this.currentId = all[name].id ?? null
    this.currentSavedSceneJson = this.sceneJson()
    this.nameInput().value = name
    this.pendingRemoteDecision = 'none'
    this.renderList()
    return true
  }

  /** Accept a delete in another tab while leaving the visible scene available to export. */
  acceptRemoteDeletion(): boolean {
    if (this.pendingRemoteDecision !== 'conflict-delete') return false
    this.pendingRemoteDecision = 'none'
    this.detachCurrent('Deleted in another tab. The board remains on screen to export or save as a new board.')
    this.renderList()
    return true
  }

  /** Single-board backup of the on-screen scene, independent of what is
      committed to storage. Used so a user facing an open-board conflict
      can keep a copy of their local edits before loading another tab's
      newer version. */
  exportCurrentScene(): string {
    return JSON.stringify({
      app: 'tactics-board-mapper',
      version: 1,
      exportedAt: new Date().toISOString(),
      boards: { [this.currentName ?? 'Untitled board']: this.snapshot() },
    })
  }

  /** Device-transfer file containing every saved board. */
  exportFile(): string {
    return JSON.stringify({
      app: 'tactics-board-mapper',
      version: 1,
      exportedAt: new Date().toISOString(),
      boards: readAll(this.storageKey),
    })
  }

  /** Merge without eviction. */
  importFile(text: string): number {
    const data = JSON.parse(text)
    const incoming = data?.boards && typeof data.boards === 'object' && !Array.isArray(data.boards) ? data.boards : null
    if (!incoming) throw new Error('not a boards file')
    const all = readAll(this.storageKey)
    let added = 0
    for (const [rawName, p] of Object.entries<any>(incoming)) {
      if (!p || typeof p !== 'object' || !p.scene) continue
      const importId = typeof p.importId === 'string' && /^[A-Za-z0-9_-]{24}$/.test(p.importId) ? p.importId : undefined
      if (importId && Object.values(all).some(saved => saved.importId === importId)) continue
      const name = rawName.trim().slice(0, 40) || 'Imported board'
      const normalized = tryNormalizeBoardDocument(p.scene)
      if (!normalized) continue
      // Keep future JSON intact while projecting the known closed legend field.
      const rawDocument = JSON.parse(JSON.stringify(p.scene)) as BoardDocument
      const document = normalizeDocumentArrowLegends(rawDocument, normalized)
      const json = JSON.stringify(document)
      let key = name
      let i = 2
      while (all[key] && JSON.stringify(all[key].scene) !== json) key = `${name} (${i++})`
      if (all[key]) continue
      const incomingTime = typeof p.savedAt === 'string' && Number.isFinite(Date.parse(p.savedAt))
        ? p.savedAt : new Date().toISOString()
      let id = typeof p.id === 'string' && p.id ? p.id : undefined
      const rowCollision = id ? Object.values(all).find(saved => saved.id === id) : undefined
      if (rowCollision) {
        if (JSON.stringify(rowCollision.scene) === json) continue
        id = newId()
      }
      let storedDocument = document
      if ('boards' in storedDocument) {
        const projectCollision = Object.values(all).some(saved => saved.id === storedDocument.id
          || ('boards' in saved.scene && saved.scene.id === storedDocument.id))
        if (projectCollision) {
          id ??= newId()
          storedDocument = copyDocumentForConflict(storedDocument, id)
        }
      }
      all[key] = {
        savedAt: incomingTime,
        scene: storedDocument,
        ...(id ? { id } : {}),
        ...(importId ? { importId } : {}),
      }
      added++
    }
    if (added && !this.commit(all)) throw new Error('board storage write failed')
    this.renderList()
    return added
  }

  hasImport(importId: string): boolean {
    return Object.values(readAll(this.storageKey)).some(saved => saved.importId === importId)
  }

  resetProjects(projects: Record<string, SavedProject>, currentName: string | null = null): boolean {
    if (!this.commit({ ...projects })) return false
    this.currentName = currentName
    this.currentId = currentName ? projects[currentName]?.id ?? null : null
    this.currentDocumentTemplate = currentName && projects[currentName]
      ? JSON.parse(JSON.stringify(projects[currentName].scene)) : null
    this.currentSavedSceneJson = this.sceneJson()
    this.nameInput().value = currentName ?? ''
    this.renderList()
    return true
  }

  private remove(name: string) {
    const all = readAll(this.storageKey)
    if (!all[name]) return
    if (!confirm(`Delete saved board "${name}"?`)) return
    const next = { ...all }
    delete next[name]
    if (!this.commit(next)) return
    if (this.currentName === name) this.detachCurrent()
    this.renderList()
  }

  /** Root-list summary for unlimited local saved boards. */
  countLabel(): string {
    const all = readAll(this.storageKey)
    const total = savedBoardNamesByRecency(all).length
    return total ? `${total}` : 'None yet'
  }

  /** Say something in the saved-list status line, where a reader is looking. */
  announce(message: string): void { this.showStatus(message) }

  private renderList() {
    const all = readAll(this.storageKey)
    const names = savedBoardNamesByRecency(all)
    const list = this.el.querySelector('[data-sv="list"]')!
    if (!names.length) {
      list.innerHTML = '<p class="setNote">No saved boards yet. Local saved boards are unlimited.</p>'
      return
    }
    const row = (n: string) => {
      const project = all[n]
      const d = new Date(project.savedAt)
      const dateText = Number.isFinite(d.getTime()) ? d.toLocaleString() : 'Date unavailable'
      const preview = documentScene(project.scene)
      const count = preview.objects.length
      const safe = n.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
      return `<div class="setItem saveItem">
        <span class="savePrev" data-sv="load" data-name="${safe}">${previewSvg(preview)}</span>
        <span class="saveMeta" data-sv="load" data-name="${safe}"><strong>${safe}</strong><span>${dateText} - ${count} objects</span></span>
        <button class="setItemAction" data-sv="load" data-name="${safe}">Load</button>
        <button class="setItemAction danger" data-sv="delete" data-name="${safe}" aria-label="Delete ${safe}">${icon('trash')}</button>
      </div>`
    }
    list.innerHTML = `<div class="setGroupHead">Saved boards</div><div class="setGroup">${names.map(row).join('')}</div>`
  }
}
