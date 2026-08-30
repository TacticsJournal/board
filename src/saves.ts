import { Store } from './store'
import { BOARD_W, Scene, objectsInDrawOrder, isLight, playerDisplayName } from './types'
import { pitchById } from './pitches'
import { nodeSegments, nodesToSvgPath, segmentEndTangent } from './path-nodes'
import { canCreateAgentLink, hasPaidBoardAccess, isPro } from './entitlements'
import { boardInvitationsUrl, boardSharesUrl, boardUserSearchUrl } from './board-api'
import { canCreateSavedBoard, editableBoardNames, savedBoardNamesByRecency, sharedBoardNames, swapEditableSlot, writeSavedBoards } from './saved-board-policy'
import { canOpenBoardHistory, type BoardHistoryContext } from './board-history'
import { icon } from './icons'
import { mountSlidingPills } from './sliding-pill'
import { getAsset } from './assets'
import { ballSrc, coneSrc, goalFullSrc, goalSmallSrc, CONE_ASPECT, GOAL_ASPECT } from './board-art'
import { arrowMediumWidth } from './board-art'
import { conflictName, newId, recordTombstones } from './sync'
import { remoteCurrentDecision, type RemoteCurrentDecision } from './remote-current'
import {
  copyDocumentForConflict, documentScene, migrateProject, normalizeBoardDocument, normalizeDocumentArrowLegends, preserveDocumentFields, tryNormalizeBoardDocument,
  type BoardDocument, type Project,
} from './projects'

const KEY = 'tbm-projects-v1'
const FREE_LIMIT_MESSAGE = 'Free includes three editable saved boards. Delete saved boards until fewer than three remain, or export this board without saving.'
const STORAGE_ERROR_MESSAGE = 'Could not save boards on this device. Free some browser storage and try again; your existing saved boards were not changed.'
let shareUserSearchId = 0

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
const ART = { ball: 'tbmArtBall', cone: 'tbmArtCone', small: 'tbmArtGoalSmall', normal: 'tbmArtGoalNormal' }
const assetRef = (id: string) => `tbmArtAsset-${id}`

/**
 * Every picture the given scenes draw: what it is called, where it comes from
 * and the shape of it. The player writes these as symbols and fetches them up
 * front, because a picture only starts loading once something points at it —
 * a piece first drawn mid-move would otherwise arrive a download late.
 */
export function boardArt(scenes: (Scene | undefined)[]): { id: string, src: string, aspect: number }[] {
  const objs = scenes.flatMap(s => s?.objects ?? [])
  const art: { id: string, src: string, aspect: number }[] = []
  if (objs.some(o => o.type === 'ball')) art.push({ id: ART.ball, src: ballSrc, aspect: 1 })
  if (objs.some(o => o.type === 'cone')) art.push({ id: ART.cone, src: coneSrc, aspect: CONE_ASPECT })
  if (objs.some(o => o.type === 'goal' && o.variant === 'small')) art.push({ id: ART.small, src: goalSmallSrc, aspect: GOAL_ASPECT.small })
  if (objs.some(o => o.type === 'goal' && o.variant !== 'small')) art.push({ id: ART.normal, src: goalFullSrc, aspect: GOAL_ASPECT.normal })
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
  const parts = boardArt(scenes).map(({ id, src, aspect }) =>
    `<symbol id="${id}" viewBox="0 0 100 ${svgNumber(100 * aspect, 100)}" preserveAspectRatio="xMidYMid meet">`
    + `<image href="${escXml(src)}" width="100" height="${svgNumber(100 * aspect, 100)}"/></symbol>`)
  return parts.length ? `<defs>${parts.join('')}</defs>` : ''
}

/**
 * The scene's objects as SVG shapes in draw order, without the pitch or any
 * wrapper. The saved-board thumbnail and the sequence row share it so a board
 * looks the same wherever it is drawn.
 */
/** How a board's own text is set, so the SVG reads like the board. */
const LABEL_FONT = 'font-family="Inter, system-ui, sans-serif" font-weight="700" text-anchor="middle"'

/** Two pitches on one board draw every piece at half size, as the board does. */
function iconScale(scene: Scene | undefined): number {
  return (pitchById(scene?.pitch).sides ?? 1) > 1 ? 0.5 : 1
}

/** Arrow heads follow the scene's own pitch, as they do on the board. */
function sceneIsLive(scene: Scene | undefined): boolean {
  return !!pitchById(scene?.pitch).live
}

export function sceneShapesSvg(scene: Scene | undefined, opts: { fading?: Set<string>; fade?: number; arriving?: Set<string>; arrive?: number; riding?: Set<string>; ride?: number; art?: 'draw' | 'point' } = {}): string {
  const objs = objectsInDrawOrder(scene?.objects ?? [])
  const k = iconScale(scene)
  const mediumWidth = arrowMediumWidth(sceneIsLive(scene))
  const refs = opts.art === 'point'
  const parts: string[] = []
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
      const shaft = (o.dash === 'dotted' ? Math.max(width * 1.8, 7) : width) * k
      const dash = o.dash === 'dotted' ? ` stroke-dasharray="0.001 ${svgNumber(shaft * 2.1)}" stroke-linecap="round"`
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
      const head = o.head && !o.measure ? (width / mediumWidth) * 14 * k : 0
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
      parts.push(`<circle cx="${svgNumber(x)}" cy="${svgNumber(y)}" r="${svgNumber(r, 14)}" fill="${escXml(o.color)}" stroke="#0b0b0e" stroke-width="${svgNumber(Math.max(1.25, r * 0.38), 3.5)}"/>`)
      if (o.label) {
        const size = r * 1.05
        parts.push(`<text x="${svgNumber(x)}" y="${svgNumber(y + size * 0.35)}" ${LABEL_FONT} font-size="${svgNumber(size, 14)}" fill="${isLight(String(o.color)) ? '#111827' : '#ffffff'}">${escXml(o.label)}</text>`)
      }
      const name = playerDisplayName(String(o.name ?? ''), o.nameDisplay)
      if (name) {
        const size = Math.max(Number(o.nameSize) || 18, 8) * k
        const gap = 5 * k
        const baseline = o.namePos === 'top' ? y - (r + gap + size * 0.2) : y + r + gap + size * 0.8
        parts.push(`<text x="${svgNumber(x)}" y="${svgNumber(baseline)}" ${LABEL_FONT} font-size="${svgNumber(size, 18)}" fill="#111827">${escXml(name)}</text>`)
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
      // the board's ground ellipse is a fraction of the marker's crop width,
      // and the marker sits on the ellipse's centre (see LIVE_MARKER_ELLIPSE)
      const rx = Math.max(Number(o.w) * 0.356, 12)
      const ry = rx * 0.31
      parts.push(`<ellipse${spin(o)} cx="${svgNumber(o.x)}" cy="${svgNumber(o.y)}" rx="${svgNumber(rx, 12)}" ry="${svgNumber(ry, 3.72)}" fill="#ffffff" opacity="0.9"/>`)
      const name = playerDisplayName(String(o.name ?? ''))
      if (name) {
        const y = Number(o.y)
        const size = 15, gap = 7
        const baseline = o.namePos === 'top' ? y - (ry + gap + size * 0.2) : y + ry + gap + size * 0.8
        parts.push(`<text x="${svgNumber(o.x)}" y="${svgNumber(baseline)}" ${LABEL_FONT} font-size="15" fill="#ffffff" stroke="rgba(0,0,0,0.55)" stroke-width="2.5" paint-order="stroke">${escXml(name)}</text>`)
      }
    } else if (o.type === 'text') {
      const size = Math.max(Number(o.size), 20)
      const rotation = Number(o.rotation)
      const tr = Number.isFinite(rotation) && rotation !== 0 ? ` transform="rotate(${svgNumber(rotation)} ${svgNumber(o.x)} ${svgNumber(o.y)})"` : ''
      parts.push(`<text x="${svgNumber(o.x)}" y="${svgNumber(Number(o.y) + size * 0.85)}" font-size="${svgNumber(size, 20)}" font-weight="${o.bold ? 700 : 400}" fill="${escXml(o.color)}"${tr}>${escXml(o.text)}</text>`)
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
  const src = style.src || (style.custom ? resolved || '' : '')
  return src ? `<image href="${escXml(src)}" width="${BOARD_W}" height="${svgNumber(bh, style.boardH)}"/>` : ''
}

export function previewSvg(scene: Scene | undefined, resolved?: string | null): string {
  const style = pitchById(scene?.pitch)
  const bh = sceneBoardHeight(scene)
  return `<svg viewBox="0 0 ${BOARD_W} ${svgNumber(bh, style.boardH)}" preserveAspectRatio="xMidYMid slice">${scenePitchImage(scene, resolved)}${sceneShapesSvg(scene)}</svg>`
}

/** `id` is what survives a rename, so sync knows this is the same board. */
export type SavedProject = { savedAt: string; scene: BoardDocument; id?: string; importId?: string; access?: 'shared'; ownerUsername?: string | null; readOnly?: boolean; syncAccount?: string }

/** A full Project document and the stable id of the saved row that carries it. */
export type SavedProjectDocument = {
  name: string
  rowId: string
  project: Project
  savedAt: string
  importId?: string
  access?: 'shared'
  ownerUsername?: string | null
  readOnly?: boolean
  syncAccount?: string
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

function readAll(storageKey = KEY): SavedProjects {
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey) ?? '{}')
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return Object.fromEntries(Object.entries(parsed)
      .filter((entry): entry is [string, SavedProject] => isSavedProject(entry[1])))
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

export type SavesLocalChange = { shared: boolean }

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

/** The copy shortcut, named for the keyboard in front of the reader. */
function copyKeys(): string {
  const apple = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)
  return apple ? '\u2318C' : 'Ctrl+C'
}

/**
 * One way of handing a link over, wherever a link is handed over: an agent's,
 * a person's invitation, the link an email could not carry. The link is shown
 * as well as copied, because the clipboard is refused often enough - a browser
 * that wants a gesture, an insecure context - that a copy nobody can see is a
 * copy nobody has.
 */
function linkField(ariaLabel: string, placeholder = ''): string {
  return `<span class="linkField">
    <input type="text" readonly data-link-out aria-label="${escXml(ariaLabel)}" placeholder="${escXml(placeholder)}">
    <button type="button" class="copyIconButton" data-link-copy aria-label="Copy ${escXml(ariaLabel.toLowerCase())}">
      <span class="t-icon-swap" data-state="a" aria-hidden="true">
        <span class="t-icon" data-icon="a">${icon('copy')}</span>
        <span class="t-icon" data-icon="b">${icon('check')}</span>
      </span>
    </button>
  </span>`
}

/**
 * Copy what the field holds, however this browser will let us. The button
 * swaps to a check for two seconds. A refusal leaves the link selected and
 * names the keyboard shortcut through the button label.
 */
async function copyLinkField(field: HTMLElement): Promise<boolean> {
  const input = field.querySelector<HTMLInputElement>('[data-link-out]')!
  const button = field.querySelector<HTMLButtonElement>('[data-link-copy]')!
  let done = false
  try {
    if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable')
    await navigator.clipboard.writeText(input.value)
    done = true
  } catch { /* the older selection copy still works where the new one is off */ }
  if (!done) {
    input.focus()
    input.select()
    try { done = document.execCommand('copy') } catch { done = false }
  }
  const swap = button.querySelector<HTMLElement>('.t-icon-swap')!
  swap.dataset.state = done ? 'b' : 'a'
  button.setAttribute('aria-label', done ? 'Copied' : `Press ${copyKeys()} to copy the selected link`)
  if (done) window.setTimeout(() => {
    if (!button.isConnected) return
    swap.dataset.state = 'a'
    button.setAttribute('aria-label', `Copy ${input.getAttribute('aria-label')?.toLowerCase() || 'link'}`)
  }, 2000)
  else { input.focus(); input.select() }
  return done
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
  /** Set by main: fires after any write to the saved-boards record — a save,
      a rename, a delete, an autosave. Board sync listens for it so an edit
      reaches the member's other devices as it happens rather than when this
      tab is next put away. */
  onLocalChange: (change?: SavesLocalChange) => void = () => {}
  /** Set by main: flushes and syncs this saved Project, returning its final row id. */
  onPrepareShare: (boardId: string) => Promise<string> = async () => {
    throw new Error('Board sharing is unavailable.')
  }
  /** Set by main: flushes/syncs all saved boards and returns the issued link URL. */
  onCreateAgentLink: (boardId: string) => Promise<string> = async () => {
    throw new Error('Agent links are unavailable.')
  }
  /** Set by main: offer account backup when an explicit save reaches Free's limit. */
  onFreeLimit: () => void = () => {}
  /**
   * Set by main: who this device is signed in as and what they hold. Version
   * history belongs to owned, synced projects on a Pro account, so the default
   * grants nothing and the action never appears until main says otherwise.
   */
  historyContext: () => BoardHistoryContext = () => ({ pro: false, signedIn: false, selfHosted: true, accountBinding: null })
  /** Set by main: open the version-history screen for one owned saved project. */
  onOpenHistory: (target: { id: string; name: string; savedAt: string; accountBinding: string }) => void = () => {}
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
      else if (k === 'agent-link') void this.createAgentLink(btn.dataset.id!)
      else if (k === 'history') this.openHistory(btn.dataset.name!)
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

  /** Keep the current editable board before it is replaced. Locked boards are never changed. */
  /**
   * `quiet` is for the background save that runs as you draw: it must never
   * interrupt with the free-limit notice, which belongs to a save you asked
   * for. Everything else about the two is the same.
   */
  autosaveCurrent(quiet = false, defaultName?: string): boolean {
    if (this.pendingRemoteDecision === 'conflict' || this.pendingRemoteDecision === 'conflict-delete') return false
    const all = readAll(this.storageKey)
    const sceneJson = this.sceneJson()
    // "unchanged" only means anything once there is a board to be unchanged
    // from: on a fresh canvas this marker matches and no board exists
    if (this.currentName && this.currentSavedSceneJson === sceneJson) return true
    if (this.currentName && all[this.currentName]) return this.autosaveNamed(this.currentName, all)
    if (Object.values(all).some(p => JSON.stringify(p.scene) === sceneJson)) return true
    if (!canCreateSavedBoard(all, hasPaidBoardAccess())) {
      if (!quiet) { this.showStatus(FREE_LIMIT_MESSAGE); this.onFreeLimit() }
      return false
    }
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
        ...(saved.access === 'shared'
          ? { access: 'shared' as const, ownerUsername: saved.ownerUsername ?? null, ...(saved.readOnly ? { readOnly: true } : {}) }
          : {}),
        ...(saved.syncAccount ? { syncAccount: saved.syncAccount } : {}),
      }]
    })
  }

  /** Open a bearer invitation as a local read-only copy before account access is claimed. */
  openInvitationPreview(preview: {
    id: string
    name: string
    document: BoardDocument
    ownerUsername?: string | null
    updatedAt?: string
  }): boolean {
    const template = JSON.parse(JSON.stringify(preview.document))
    if (!tryNormalizeBoardDocument(template)) {
      this.showStatus('This invitation uses a document format this version cannot open.')
      return false
    }
    const all = readAll(this.storageKey)
    const existing = Object.entries(all).find(([, saved]) => saved.id === preview.id)
    // A link must never replace an owned row or accepted collaborator work.
    // Reopening the same unclaimed preview simply restores its stored copy.
    if (existing) return this.applyLoad(existing[0], all, false)
    const name = this.uniqueName(preview.name.trim() || 'Shared project', all)
    all[name] = {
      id: preview.id,
      savedAt: preview.updatedAt || new Date().toISOString(),
      scene: template,
      access: 'shared',
      ownerUsername: preview.ownerUsername ?? null,
      readOnly: true,
    }
    if (!writeAll(all, this.storageKey)) {
      this.showStatus(STORAGE_ERROR_MESSAGE)
      return false
    }
    return this.applyLoad(name, all, false)
  }

  /** Discard canvas-only preview changes before claiming its account access. */
  restoreInvitationPreview(id: string): boolean {
    const all = readAll(this.storageKey)
    const found = Object.entries(all).find(([, saved]) => saved.id === id
      && saved.access === 'shared' && saved.readOnly === true && !saved.syncAccount)
    return found ? this.applyLoad(found[0], all, false) : false
  }

  /**
   * Write Project documents by Project id, never by their display name. A
   * rename therefore keeps its D1 row id and every row-owned bit of metadata.
   */
  persistProjectDocuments(projects: readonly Project[]): boolean {
    const all = readAll(this.storageKey)
    const next: SavedProjects = { ...all }
    const now = new Date().toISOString()
    let changed = false
    let blocked = false
    for (const project of projects) {
      const found = Object.entries(next).find(([, saved]) => migrateProject(saved.scene)?.id === project.id)
      const oldName = found?.[0]
      const existing = found?.[1]
      if (existing?.readOnly) { blocked = true; continue }
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
    if (!changed) return !blocked
    return this.commit(next) && !blocked
  }

  private nameInput() { return this.el.querySelector('[data-sv="name"]') as HTMLInputElement }
  private showStatus(message: string) {
    const status = this.el.querySelector('[data-sv="status"]') as HTMLElement
    status.textContent = message
  }
  /** Return an agent link for the board on screen without opening Settings. */
  async currentAgentLink(): Promise<
    { status: 'ok'; url: string } | { status: 'save-first' | 'not-allowed' }
  > {
    if (!canCreateAgentLink()) return { status: 'not-allowed' }
    // an unsaved board is not a reason to refuse: save it and carry on. A board
    // nobody has drawn on yet reads as "not dirty", so ask whether a saved
    // board exists rather than whether this one has changed.
    if (!this.currentName || !this.currentId || !this.isCurrentSaved()) this.autosaveCurrent(true)
    const id = this.currentBoardId()
    if (!id || !this.isCurrentSaved()) return { status: 'save-first' }
    const url = await this.onCreateAgentLink(id)
    if (!url) throw new Error('The server returned no agent link.')
    return { status: 'ok', url }
  }

  private async createAgentLink(boardId: string): Promise<void> {
    if (!boardId) {
      this.showStatus('Could not create agent link. This saved board has no stable id; your work was kept locally.')
      return
    }
    this.showStatus('Saving and creating agent link…')
    try {
      const url = await this.onCreateAgentLink(boardId)
      if (!url) throw new Error('The server returned no agent link.')
      try {
        if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable')
        await navigator.clipboard.writeText(url)
        this.showStatus('Agent instructions copied to your clipboard. Paste it in your coding agent. The link expires in 24 hours.')
      } catch {
        this.showManualAgentLink(url)
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'The request failed.'
      this.showStatus(`Could not create agent link: ${reason} Your saved work was kept locally.`)
    }
  }
  private showManualAgentLink(url: string): void {
    const dialog = document.createElement('dialog')
    dialog.className = 'agentLinkDialog'
    dialog.innerHTML = `<form method="dialog">
      <p>The agent link is below. Paste it in your coding agent; it expires in 24 hours.</p>
      ${linkField('Agent link')}
      <button type="submit">Done</button>
    </form>`
    dialog.addEventListener('close', () => dialog.remove())
    document.body.appendChild(dialog)
    dialog.showModal()
    const field = dialog.querySelector<HTMLElement>('.linkField')!
    const input = field.querySelector('input') as HTMLInputElement
    input.value = url
    input.focus()
    input.select()
    field.querySelector('[data-link-copy]')!.addEventListener('click', () => { void copyLinkField(field) })
    this.showStatus('The agent link is ready to copy.')
  }
  /** True when the on-screen board matches the last persisted state. */
  isCurrentSaved(): boolean {
    return this.currentSavedSceneJson === this.sceneJson()
  }

  /** Whether the project on screen belongs to someone else. */
  isCurrentShared(): boolean {
    const id = this.currentId
    if (!id) return false
    return Object.values(readAll(this.storageKey)).some((project) => project.id === id && project.access === 'shared')
  }

  /** Whether the project on screen is one this account may only read. */
  isCurrentReadOnly(): boolean {
    const id = this.currentId
    if (!id) return false
    return Object.values(readAll(this.storageKey))
      .some((project) => project.id === id && project.access === 'shared' && project.readOnly === true)
  }

  /**
   * Give one locally owned row a fresh sync id without recording a delete.
   * The old id may belong to another account on the server, so a tombstone for
   * it would be an unauthorized delete. The document and its Project id stay
   * unchanged.
   */
  reidentifySavedBoard(boardId: string): string {
    const all = readAll(this.storageKey)
    const found = Object.entries(all).find(([, project]) => project.id === boardId)
    if (!found) throw new Error('This saved Project is no longer on this device.')
    const [name, saved] = found
    if (saved.access === 'shared' || saved.readOnly === true) {
      throw new Error('Only a locally owned saved Project can be reidentified.')
    }

    const used = new Set(Object.values(all).flatMap((project) => project.id ? [project.id] : []))
    let replacement = ''
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const candidate = newId()
      if (!used.has(candidate)) { replacement = candidate; break }
    }
    if (!replacement) throw new Error('Could not create a fresh local id for this Project.')

    const { syncAccount: _previousAccount, ...local } = saved
    const next = { ...all, [name]: { ...local, id: replacement } }
    if (!writeAll(next, this.storageKey)) throw new Error(STORAGE_ERROR_MESSAGE)
    if (this.currentId === boardId) this.currentId = replacement
    // Deliberately bypass commit: replacing a foreign account's id is not a
    // local deletion and must not create a tombstone for the old row.
    this.onLocalChange({ shared: false })
    return replacement
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
    if (found[1].access === 'shared') return false
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
    // The saved row may have changed through sync while another project was
    // open. Load that durable copy instead of blessing a stale local project.
    return this.applyLoad(found[0], all, false)
  }

  /**
   * Sync starts by writing a dirty named board synchronously. An unnamed
   * canvas has no saved-board record and is deliberately not a sync candidate.
   */
  flushCurrentForSync(): boolean {
    if (!this.currentName) return true
    this.currentBoardId()
    const all = readAll(this.storageKey)
    if (!all[this.currentName]) {
      if (this.pendingRemoteDecision === 'conflict' || this.pendingRemoteDecision === 'conflict-delete') return false
      this.detachCurrent()
      return true
    }
    return this.autosaveNamed(this.currentName, all)
  }

  /**
   * localStorage does not send a storage event back to the tab that wrote it.
   * After sync changes the currently open record, update a clean canvas now;
   * for a dirty canvas use the normal external-conflict choice instead.
   */
  applyRemoteCurrent(remoteIds: readonly string[], currentId: string | null): boolean {
    // The sync request may have started while a different board was open. Do
    // not trust a stale id from its caller: loading or detaching it could
    // replace the board that is actually on screen now.
    if (currentId !== this.currentId) return false
    const all = readAll(this.storageKey)
    const found = currentId ? Object.entries(all).find(([, project]) => project.id === currentId) : undefined
    const decision = remoteCurrentDecision(remoteIds, currentId, !!found, !this.isCurrentSaved())
    if (decision === 'none') return false
    this.pendingRemoteDecision = decision
    if (decision === 'detach') {
      // Keep the on-screen scene exportable, but never let autosave recreate a
      // board that another device cleanly deleted.
      this.detachCurrent('Deleted on another device. The board remains on screen to export or save as a new board.')
      this.pendingRemoteDecision = 'none'
    } else if (decision === 'load') {
      this.applyLoad(found![0], all, false)
      this.pendingRemoteDecision = 'none'
    } else {
      this.onExternalConflict(this.currentName ?? found?.[0] ?? 'this board', decision)
      this.renderList()
    }
    return decision === 'conflict' || decision === 'conflict-delete'
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
    // Saving over a board, or renaming one, keeps its id: to every other device
    // this is the same board edited, not a new one appearing.
    const all = readAll(this.storageKey)
    const existing = (this.currentName ? all[this.currentName] : undefined)
      ?? Object.values(all).find((project) => project.id === this.currentId)
    return {
      savedAt: new Date().toISOString(),
      scene: this.documentForSave(),
      id: existing?.id || newId(),
      ...(existing?.syncAccount ? { syncAccount: existing.syncAccount } : {}),
      ...(existing?.access === 'shared' ? {
        access: 'shared' as const,
        ownerUsername: existing.ownerUsername ?? null,
        ...(existing.readOnly ? { readOnly: true } : {}),
      } : {}),
    }
  }
  private commit(all: SavedProjects): boolean {
    const before = readAll(this.storageKey)
    const nextIds = new Set(Object.values(all).map((entry) => entry.id).filter(Boolean))
    if (Object.values(before).some((entry) => entry.access === 'shared' && entry.id && !nextIds.has(entry.id))) {
      this.showStatus('A shared board cannot be replaced or deleted. Load it before editing, or save under another name.')
      return false
    }
    if (!writeAll(all, this.storageKey)) { this.showStatus(STORAGE_ERROR_MESSAGE); return false }
    // A board that has left the record is a delete, and a delete has to travel
    // or it comes back from whichever device has not synced yet.
    const surviving = new Set(Object.values(all).map((entry) => entry.id).filter(Boolean) as string[])
    const removed = Object.entries(before)
      // Removing a shared row locally is never a deletion on the server. In
      // normal use the UI does not offer this; this guard also protects an
      // import/reset or a future management path from revoking someone else's board.
      .filter(([, entry]) => entry.access !== 'shared')
      .filter(([, entry]) => entry.id && !surviving.has(entry.id))
      .map(([name, entry]) => ({ id: entry.id as string, name, ...(entry.syncAccount ? { syncAccount: entry.syncAccount } : {}) }))
    if (removed.length) recordTombstones(removed, new Date().toISOString())
    const sharedChanged = Object.entries(before).some(([name, entry]) => entry.access === 'shared'
      && (!all[name] || JSON.stringify(all[name]) !== JSON.stringify(entry)))
      || Object.entries(all).some(([name, entry]) => entry.access === 'shared'
        && (!before[name] || JSON.stringify(before[name]) !== JSON.stringify(entry)))
    this.showStatus('')
    this.onLocalChange({ shared: sharedChanged })
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
    // A clean canvas follows a remote rename by id. A dirty canvas keeps its
    // old label until the conflict decision makes a safe local copy.
    if (this.isCurrentSaved()) {
      this.currentName = found[0]
      this.nameInput().value = found[0]
    }
  }
  private autosaveNamed(name: string, all: SavedProjects): boolean {
    const sceneJson = this.sceneJson()
    if (this.currentSavedSceneJson === sceneJson) return true
    if (all[name]?.readOnly === true) {
      this.showStatus('This shared project is read-only. Canvas changes are not saved.')
      return false
    }
    if (!editableBoardNames(all, hasPaidBoardAccess()).has(name)) {
      this.showStatus('This saved board is read-only. Export the current canvas as an image to keep these changes.')
      return false
    }
    all[name] = this.snapshot()
    if (!this.commit(all)) return false
    this.currentDocumentTemplate = JSON.parse(JSON.stringify(all[name].scene))
    this.currentSavedSceneJson = sceneJson
    return true
  }

  private save() {
    const all = readAll(this.storageKey)
    const name = this.nameInput().value.trim() || `Board ${new Date().toLocaleDateString()}`
    const editable = editableBoardNames(all, hasPaidBoardAccess())
    const currentExists = !!this.currentName && !!all[this.currentName]

    if (currentExists && all[this.currentName!]?.readOnly === true) {
      this.showStatus('This shared project is read-only. Canvas changes are not saved.')
      return
    }
    if (currentExists && !editable.has(this.currentName!)) {
      this.showStatus('This saved board is read-only. Delete newer saved boards until it becomes editable, or export the current canvas as an image.')
      return
    }
    if (all[name]?.readOnly === true) {
      this.showStatus('That shared project is read-only and cannot be overwritten.')
      return
    }
    if (all[name] && !editable.has(name)) {
      this.showStatus('That saved board is read-only. Load or delete it, or choose another name when a save slot is available.')
      return
    }
    if (all[name]?.access === 'shared' && all[name].id !== this.currentId) {
      this.showStatus('Load that shared board before editing it, or save this board under another name.')
      return
    }
    if (all[name] && !confirm(`Overwrite saved board "${name}"?`)) return

    if (!all[name] && !currentExists && !canCreateSavedBoard(all, hasPaidBoardAccess())) {
      this.showStatus(FREE_LIMIT_MESSAGE)
      this.onFreeLimit()
      return
    }

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
    const editable = editableBoardNames(all, hasPaidBoardAccess())
    if (!editable.has(name) && !hasPaidBoardAccess()) {
      this.promptSwap(name, all, editable)
      return
    }
    this.applyLoad(name, all)
  }

  private promptSwap(targetName: string, all: SavedProjects, editable: ReadonlySet<string>) {
    // Shared boards are independently editable and never a personal slot to
    // sacrifice when a Free user opens a read-only personal board.
    const editableNames = savedBoardNamesByRecency(all).filter(n => all[n].access !== 'shared' && editable.has(n))
    if (!editableNames.length) {
      this.showStatus('No editable boards available to swap.')
      return
    }

    const dialog = document.createElement('dialog')
    dialog.className = 'swapDialog'
    const safe = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')
    dialog.innerHTML = `
      <form method="dialog">
        <p>Make <strong>${safe(targetName)}</strong> editable by swapping it with one of your current editable boards.</p>
        <p>Choose a board to move to read-only:</p>
        <ul class="swapChoices">${editableNames.map(n =>
          `<li><button type="button" class="swapPick" data-sacrifice="${safe(n)}">Make <strong>${safe(targetName)}</strong> editable by moving <strong>${safe(n)}</strong> to read-only?</button></li>`
        ).join('')}</ul>
        <button type="button" class="swapCancel">Cancel</button>
      </form>`

    dialog.addEventListener('click', (e) => {
      const pick = (e.target as HTMLElement).closest('.swapPick') as HTMLElement | null
      if (pick) {
        const sacrificeName = pick.dataset.sacrifice!
        const result = swapEditableSlot(all, sacrificeName, targetName)
        if (!result.ok) {
          this.showStatus(result.reason)
        } else {
          const updated = result.boards as SavedProjects
          if (!this.commit(updated)) { dialog.close(); return }
          this.applyLoad(targetName, updated)
        }
        dialog.close()
        return
      }
      if ((e.target as HTMLElement).closest('.swapCancel')) {
        dialog.close()
      }
    })
    dialog.addEventListener('close', () => dialog.remove())
    document.body.appendChild(dialog)
    dialog.showModal()
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
    const editable = editableBoardNames(all, hasPaidBoardAccess())
    if (!editable.has(name)) {
      this.showStatus('Read-only saved board. You can view or change it and export the current canvas as an image, but moving boards to another device exports only the stored copy.')
    } else this.showStatus('')
    this.renderList()
    if (close) this.close()
    return true
  }

  /** New canvases remain usable when Free has no available saved-board slot. */
  registerNew(): boolean {
    const all = readAll(this.storageKey)
    if (!canCreateSavedBoard(all, hasPaidBoardAccess())) {
      this.detachCurrent()
      this.showStatus(FREE_LIMIT_MESSAGE)
      this.onFreeLimit()
      return false
    }
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

  /** Keep a dirty remote-conflict canvas without overwriting the remote id. */
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

  /** Accept a remote delete while leaving the visible scene available to export. */
  acceptRemoteDeletion(): boolean {
    if (this.pendingRemoteDecision !== 'conflict-delete') return false
    this.pendingRemoteDecision = 'none'
    this.detachCurrent('Deleted on another device. The board remains on screen to export or save as a new board.')
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

  /** Device-transfer file containing personal boards. Shared boards come from their owner through sync. */
  exportFile(): string {
    const personal = Object.fromEntries(Object.entries(readAll(this.storageKey))
      .filter(([, project]) => project.access !== 'shared'))
    return JSON.stringify({
      app: 'tactics-board-mapper',
      version: 1,
      exportedAt: new Date().toISOString(),
      boards: personal,
    })
  }

  /** Merge without eviction. Free overflow is preserved and classified by recency. */
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
    if (!all[name] || all[name].access === 'shared') return
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
    const total = savedBoardNamesByRecency(all).filter(name => all[name].access !== 'shared').length
    return total ? `${total}` : 'None yet'
  }

  /** Open collaborator management for the owned board currently on screen. */
  inviteCurrentByUsername(): 'opened' | 'save-first' | 'owner-only' {
    // as with the agent link: save it rather than sending the person away
    if (!this.currentName || !this.currentId) this.autosaveCurrent(true)
    if (!this.currentName || !this.currentId) return 'save-first'
    const found = Object.entries(readAll(this.storageKey)).find(([, project]) => project.id === this.currentId)
    if (!found) return 'save-first'
    if (found[1].access === 'shared') return 'owner-only'
    this.openShare(found[0])
    return 'opened'
  }

  /**
   * Put the sharing form somewhere. The saved-boards list gives it a dialog of
   * its own; the share sheet hands it the sheet it is already standing in, so
   * choosing "Invite @username" stays where the reader is instead of throwing
   * a second window over the first.
   */
  embedShareForm(host: HTMLElement): 'ok' | 'save-first' | 'owner-only' {
    if (!this.currentName || !this.currentId) this.autosaveCurrent(true)
    if (!this.currentName || !this.currentId) return 'save-first'
    const found = Object.entries(readAll(this.storageKey)).find(([, project]) => project.id === this.currentId)
    if (!found) return 'save-first'
    if (found[1].access === 'shared') return 'owner-only'
    host.appendChild(this.shareForm(found[0]))
    host.querySelector<HTMLInputElement>('input[name="username"]')?.focus()
    return 'ok'
  }

  private openShare(name: string) {
    const form = this.shareForm(name, () => dialog.close())
    if (!form) return
    const dialog = document.createElement('dialog')
    dialog.className = 'shareDialog'
    dialog.setAttribute('aria-labelledby', 'shareTitle')
    dialog.appendChild(form)
    dialog.addEventListener('close', () => dialog.remove())
    document.body.appendChild(dialog)
    dialog.showModal()
    dialog.querySelector<HTMLInputElement>('input[name="username"]')?.focus()
  }

  /**
   * The form itself: the same one wherever it is put.
   *
   * Three ways to name someone and one question about what they may do, over a
   * single list of everyone who can already reach the board. The list holds
   * accepted collaborators and invitations still in flight together, because
   * to the owner they are one question: who can open this, and what can they
   * do with it?
   */
  private shareForm(name: string, onCancel?: () => void): HTMLFormElement {
    const board = readAll(this.storageKey)[name]
    const canInvite = isPro()
    const safe = (value: string) => escXml(value)
    const userListId = `shareUserList${++shareUserSearchId}`
    const form = document.createElement('form')
    form.className = 'shareForm'
    form.innerHTML = `
      <h2 id="shareTitle">Share ${safe(name)}</h2>
      <div class="shareWays" role="tablist">
        ${[['email', 'Email'], ['username', '@username'], ['link', 'Copy link']].map(([key, label], index) => `
          <button type="button" role="tab" data-share-way="${key}" aria-selected="${index === 0}"${canInvite ? '' : ' disabled'}>${label}</button>`).join('')}
      </div>
      <label data-share-field="email">Email address
        <input name="email" type="email" autocomplete="off" maxlength="254" placeholder="coach@club.com" ${canInvite ? '' : 'disabled'}>
      </label>
      <label data-share-field="username" hidden>Username
        <span class="shareUserCombo" data-share-user-combo>
          <input name="username" autocomplete="off" maxlength="80" placeholder="Search name or @username" role="combobox" aria-autocomplete="list" aria-haspopup="listbox" aria-expanded="false" aria-controls="${userListId}" ${canInvite ? '' : 'disabled'}>
          <span class="shareUserPanel" data-share-user-panel hidden>
            <span class="shareUserOptions" id="${userListId}" role="listbox" aria-label="User suggestions"></span>
            <span class="shareUserEmpty" data-share-user-empty hidden>No users found.</span>
          </span>
        </span>
        <span class="shareUserLive" data-share-user-live role="status" aria-live="polite"></span>
      </label>
      <div class="shareLinkField" data-share-field="link" hidden>
        <span class="shareRoleLabel">Invitation link</span>
        ${linkField('Invitation link', 'Made when you copy it')}
      </div>
      <div class="shareRole">
        <span class="shareRoleLabel" id="shareRoleLabel">They can</span>
        <div class="shareWays" role="radiogroup" aria-labelledby="shareRoleLabel">
          ${[['write', 'Edit the project'], ['read', 'Read only']].map(([value, label], index) => `
            <button type="button" role="radio" data-share-role-pick="${value}" aria-checked="${index === 0}"${canInvite ? '' : ' disabled'}>${label}</button>`).join('')}
        </div>
      </div>
      <div class="shareActions">
        <button type="submit" ${canInvite ? '' : 'disabled'} data-share-submit>Share</button>
        ${onCancel ? '<button type="button" data-share-close>Cancel</button>' : ''}
      </div>
      <p class="shareStatus" role="status" aria-live="polite">${canInvite ? '' : 'Pro is needed to invite someone. You can still remove access.'}</p>
      <h3>People with access</h3><ul class="shareList"></ul>`
    mountSlidingPills(form)
    const dialog = { close: () => onCancel?.() }
    const status = form.querySelector('.shareStatus') as HTMLElement
    const list = form.querySelector('.shareList') as HTMLElement
    const submit = form.querySelector<HTMLButtonElement>('[data-share-submit]')!
    const field = (key: string) => form.querySelector<HTMLElement>(`[data-share-field="${key}"]`)!
    const input = (key: string) => field(key).querySelector('input') as HTMLInputElement
    const usernameInput = input('username')
    const userCombo = form.querySelector<HTMLElement>('[data-share-user-combo]')!
    const userPanel = form.querySelector<HTMLElement>('[data-share-user-panel]')!
    const userOptions = form.querySelector<HTMLElement>('.shareUserOptions')!
    const userEmpty = form.querySelector<HTMLElement>('[data-share-user-empty]')!
    const userLive = form.querySelector<HTMLElement>('[data-share-user-live]')!
    const linkBox = form.querySelector<HTMLElement>('.linkField')!
    const linkOut = linkBox.querySelector('input') as HTMLInputElement
    const copyButton = linkBox.querySelector<HTMLButtonElement>('[data-link-copy]')!
    copyButton.disabled = !canInvite
    let way = 'email'
    let shareId = board.id
    let shareReady = false
    let preparingShare: Promise<void> | null = null

    type UserSuggestion = { displayName: string; username: string; title: string; avatarUrl: string | null }
    let userSearchTimer: ReturnType<typeof setTimeout> | null = null
    let userSearchController: AbortController | null = null
    let userSearchVersion = 0
    let userSuggestions: UserSuggestion[] = []
    let activeUser = -1

    const userQuery = () => usernameInput.value.trim().replace(/^@/, '')
    const cancelUserRequest = () => {
      if (userSearchTimer !== null) clearTimeout(userSearchTimer)
      userSearchTimer = null
      userSearchController?.abort()
      userSearchController = null
      userSearchVersion += 1
    }
    const hideUserResults = (clear = false) => {
      userPanel.hidden = true
      userCombo.classList.remove('is-open')
      usernameInput.setAttribute('aria-expanded', 'false')
      usernameInput.removeAttribute('aria-activedescendant')
      activeUser = -1
      if (clear) {
        userSuggestions = []
        userOptions.replaceChildren()
        userEmpty.hidden = true
      }
    }
    const closeUserSearch = (clear = false) => {
      cancelUserRequest()
      hideUserResults(clear)
    }
    const safeAvatarUrl = (raw: unknown) => {
      if (typeof raw !== 'string' || !raw) return null
      try {
        const url = new URL(raw, 'https://tacticsjournal.com')
        if (url.protocol !== 'https:') return null
        if (url.hostname !== 'tacticsjournal.com' && url.hostname !== 'images.tacticsjournal.com') return null
        return url.href
      } catch { return null }
    }
    const initials = (user: UserSuggestion) => {
      const words = user.displayName.split(/\s+/).filter(Boolean)
      return (words.length ? words.slice(0, 2).map((word) => word[0]).join('') : user.username.slice(0, 2)).toUpperCase()
    }
    const setActiveUser = (next: number) => {
      if (!userSuggestions.length) return
      activeUser = (next + userSuggestions.length) % userSuggestions.length
      for (const [index, option] of [...userOptions.querySelectorAll<HTMLElement>('[role="option"]')].entries()) {
        const selected = index === activeUser
        option.classList.toggle('is-active', selected)
        option.setAttribute('aria-selected', String(selected))
      }
      const active = userOptions.querySelector<HTMLElement>(`#${userListId}-${activeUser}`)
      if (active) {
        usernameInput.setAttribute('aria-activedescendant', active.id)
        active.scrollIntoView({ block: 'nearest' })
      }
    }
    const chooseUser = (user: UserSuggestion) => {
      usernameInput.value = `@${user.username}`
      closeUserSearch(true)
      usernameInput.focus()
    }
    const renderUserResults = (users: unknown[]) => {
      userSuggestions = users.flatMap((value): UserSuggestion[] => {
        if (!value || typeof value !== 'object') return []
        const row = value as Record<string, unknown>
        const username = typeof row.username === 'string' ? row.username.trim().slice(0, 80) : ''
        if (!username) return []
        return [{
          username,
          displayName: (typeof row.display_name === 'string' ? row.display_name.trim() : '').slice(0, 160) || `@${username}`,
          title: (typeof row.title === 'string' ? row.title.trim() : '').slice(0, 160),
          avatarUrl: safeAvatarUrl(row.avatar_url),
        }]
      }).slice(0, 30)
      userOptions.replaceChildren()
      userEmpty.hidden = userSuggestions.length > 0
      for (const [index, user] of userSuggestions.entries()) {
        const option = document.createElement('button')
        option.type = 'button'
        option.tabIndex = -1
        option.id = `${userListId}-${index}`
        option.className = 'shareUserOption'
        option.setAttribute('role', 'option')
        option.setAttribute('aria-selected', String(index === 0))

        const avatar = document.createElement('span')
        avatar.className = 'shareUserAvatar'
        if (user.avatarUrl) {
          const image = document.createElement('img')
          image.src = user.avatarUrl
          image.alt = ''
          image.loading = 'lazy'
          image.addEventListener('error', () => {
            image.remove()
            avatar.textContent = initials(user)
          }, { once: true })
          avatar.appendChild(image)
        } else avatar.textContent = initials(user)

        const main = document.createElement('span')
        main.className = 'shareUserMain'
        const identity = document.createElement('span')
        identity.className = 'shareUserIdentity'
        const displayName = document.createElement('strong')
        displayName.textContent = user.displayName
        const handle = document.createElement('span')
        handle.textContent = `@${user.username}`
        identity.append(displayName, handle)
        main.appendChild(identity)
        if (user.title) {
          const title = document.createElement('small')
          title.textContent = user.title
          main.appendChild(title)
        }
        option.append(avatar, main)
        option.addEventListener('mousedown', (event) => event.preventDefault())
        option.addEventListener('click', () => chooseUser(user))
        userOptions.appendChild(option)
      }
      userPanel.hidden = false
      userCombo.classList.add('is-open')
      usernameInput.setAttribute('aria-expanded', 'true')
      userLive.textContent = userSuggestions.length ? `${userSuggestions.length} users found.` : 'No users found.'
      if (userSuggestions.length) setActiveUser(0)
      else usernameInput.removeAttribute('aria-activedescendant')
    }
    const scheduleUserSearch = () => {
      cancelUserRequest()
      const query = userQuery()
      if (way !== 'username' || !canInvite || !query) {
        hideUserResults(true)
        userLive.textContent = ''
        return
      }
      hideUserResults()
      const version = userSearchVersion
      userSearchTimer = setTimeout(async () => {
        userSearchTimer = null
        const controller = new AbortController()
        userSearchController = controller
        try {
          const response = await fetch(`${boardUserSearchUrl()}?q=${encodeURIComponent(query)}`, {
            credentials: 'include', signal: controller.signal,
          })
          if (!response.ok) throw new Error('search_failed')
          const data = await response.json()
          if (version !== userSearchVersion || way !== 'username' || userQuery() !== query) return
          renderUserResults(Array.isArray(data?.users) ? data.users : [])
        } catch (error) {
          if (controller.signal.aborted || version !== userSearchVersion) return
          hideUserResults(true)
          userLive.textContent = ''
        } finally {
          if (userSearchController === controller) userSearchController = null
        }
      }, 200)
    }

    usernameInput.addEventListener('input', scheduleUserSearch)
    usernameInput.addEventListener('focus', scheduleUserSearch)
    usernameInput.addEventListener('blur', () => {
      setTimeout(() => {
        if (!userCombo.contains(document.activeElement)) closeUserSearch()
      }, 0)
    })
    usernameInput.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !userPanel.hidden) {
        event.preventDefault()
        closeUserSearch()
        return
      }
      if (userPanel.hidden || !userSuggestions.length) return
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        setActiveUser(activeUser + (event.key === 'ArrowDown' ? 1 : -1))
      } else if (event.key === 'Enter' && activeUser >= 0) {
        event.preventDefault()
        chooseUser(userSuggestions[activeUser])
      }
    })

    /**
     * A board created on this device may still be waiting for the debounced
     * sync when this form opens. All requests share one preparation pass, and
     * a failed pass remains retryable when the owner submits again.
     */
    const prepareShare = async () => {
      if (shareReady) return
      if (!preparingShare) {
        if (!shareId) throw new Error('This saved Project has no stable id.')
        preparingShare = this.onPrepareShare(shareId)
          .then((finalId) => {
            if (!finalId) throw new Error('This saved Project has no stable id.')
            shareId = finalId
            shareReady = true
          })
          .finally(() => { preparingShare = null })
      }
      try {
        await preparingShare
      } catch (error) {
        // Preparation may have safely replaced the row id before a later
        // network step failed. Keep a retry on this form pointed at that row.
        const latestId = readAll(this.storageKey)[name]?.id
        if (latestId) shareId = latestId
        throw error
      }
    }

    /**
     * A link that was made for one permission cannot stand for another, so
     * changing what the reader may do sends the next copy back to the server.
     */
    const forgetLink = () => {
      linkOut.value = ''
      copyButton.innerHTML = `${icon('copy')}Copy`
    }

    /**
     * One press: the link is made, copied, and left in the field so it can be
     * read or copied again. The button says what happened, briefly, in place -
     * a copy that says nothing is a copy nobody trusts.
     */
    const copyLink = async () => {
      copyButton.disabled = true
      try {
        if (!linkOut.value) {
          const data = await request(boardInvitationsUrl(), 'POST', {
            board_id: shareId, kind: 'link', role: role(), board_name: name,
          })
          if (!data?.url) throw new Error('The link could not be made.')
          linkOut.value = data.url
          await refresh()
        }
        const copied = await copyLinkField(linkBox)
        status.textContent = copied
          ? 'Copied. Anyone with the link can view. One person can join within 24 hours.'
          : 'Copy this link. Anyone with it can view; one person can join within 24 hours.'
      } catch (error) {
        status.textContent = error instanceof Error ? error.message : 'That did not work.'
      } finally {
        copyButton.disabled = !isPro()
      }
    }

    const request = async (url: string, method: string, body?: object, query = '') => {
      await prepareShare()
      const response = await fetch(`${url}${query}`, {
        method, credentials: 'include', headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      })
      let data: any = null
      try { data = await response.json() } catch { /* an empty body is still an answer */ }
      // The server says why. Saying "could not share this board" over the top
      // of it is how an owner ends up with no idea what to fix.
      if (!response.ok) throw new Error(data?.error || 'That did not work.')
      return data
    }

    const roleLabel = (role: string) => (role === 'read' ? 'Read only' : 'Can edit')
    const refresh = async () => {
      const query = `?board_id=${encodeURIComponent(shareId!)}`
      const [shares, invitations] = await Promise.all([
        request(boardSharesUrl(), 'GET', undefined, query).then((data) => data?.shares || []).catch(() => null),
        request(boardInvitationsUrl(), 'GET', undefined, query).then((data) => data?.invitations || []).catch(() => []),
      ])
      if (!shares) { status.textContent = 'Could not load who has access.'; return }
      const people = shares.map((share: any) => {
        const id = typeof share?.id === 'string' ? share.id : ''
        const username = typeof share?.username === 'string' ? share.username : ''
        return `<li>
          <span class="shareWho">${username ? `@${safe(username)}` : 'Account without a username'}</span>
          <button type="button" class="shareRoleBtn" data-share-role="${safe(id)}" data-role="${safe(share?.role || 'write')}">${roleLabel(share?.role)}</button>
          <button type="button" data-share-remove="${safe(id)}" ${id ? '' : 'disabled'}>Remove</button>
        </li>`
      })
      const pending = invitations.map((invitation: any) => {
        const id = typeof invitation?.id === 'string' ? invitation.id : ''
        const to = invitation?.kind === 'email' && invitation?.email ? safe(invitation.email) : 'Invite link'
        return `<li>
          <span class="shareWho">${to}<small>Not accepted yet</small></span>
          <span class="shareRoleBtn is-fixed">${roleLabel(invitation?.role)}</span>
          <button type="button" data-share-withdraw="${safe(id)}" ${id ? '' : 'disabled'}>Revoke</button>
        </li>`
      })
      list.innerHTML = people.length || pending.length
        ? [...people, ...pending].join('')
        : '<li class="shareEmpty">Nobody else yet.</li>'
    }

    const chooseWay = (next: string) => {
      way = next
      for (const tab of form.querySelectorAll<HTMLButtonElement>('[data-share-way]')) {
        tab.setAttribute('aria-selected', String(tab.dataset.shareWay === next))
      }
      field('email').hidden = next !== 'email'
      field('username').hidden = next !== 'username'
      field('link').hidden = next !== 'link'
      // The link has no separate step to press: copying is what makes it, so
      // the form's own button has nothing left to do here.
      submit.hidden = next === 'link'
      submit.textContent = next === 'email' ? 'Send invitation' : 'Share'
      status.textContent = next === 'link'
        ? 'Anyone with the link can view. One person can join the project within 24 hours.'
        : ''
      if (next !== 'username') closeUserSearch()
      if (next !== 'link') input(next).focus()
    }

    // What they may do is one question carried by whichever way named them, so
    // it is held here rather than read back out of the way that is showing.
    let chosenRole = 'write'
    const role = () => chosenRole
    const chooseRole = (next: string) => {
      if (next !== chosenRole) forgetLink()
      chosenRole = next
      for (const option of form.querySelectorAll<HTMLButtonElement>('[data-share-role-pick]')) {
        option.setAttribute('aria-checked', String(option.dataset.shareRolePick === next))
      }
    }

    form.addEventListener('submit', async (event) => {
      event.preventDefault()
      if (!isPro()) return
      closeUserSearch()
      status.textContent = ''
      submit.disabled = true
      try {
        // The link way has no submit: its Copy button is the whole step.
        if (way === 'link') return
        if (way === 'username') {
          const username = input('username').value.trim().replace(/^@/, '')
          if (!username) return
          const data = await request(boardSharesUrl(), 'POST', { board_id: shareId, username, role: role() })
          input('username').value = ''
          status.textContent = `Shared with @${data?.username || username}, ${roleLabel(data?.role).toLowerCase()}.`
        } else if (way === 'email') {
          const email = input('email').value.trim()
          if (!email) return
          const data = await request(boardInvitationsUrl(), 'POST', {
            board_id: shareId, kind: 'email', email, role: role(), board_name: name,
          })
          input('email').value = ''
          status.textContent = data?.delivered === false
            ? 'The invitation was made but the email could not be sent. Copy the link instead.'
            : `Invitation sent to ${email}.`
          if (data?.delivered === false && data?.url) await this.offerCopy(data.url, status)
        }
        await refresh()
      } catch (error) {
        status.textContent = error instanceof Error ? error.message : 'That did not work.'
      } finally {
        submit.disabled = !isPro()
      }
    })

    form.addEventListener('click', async (event) => {
      const target = event.target as HTMLElement
      if (target.closest('[data-share-close]')) dialog.close()
      const tab = target.closest<HTMLElement>('[data-share-way]')
      if (tab?.dataset.shareWay) { chooseWay(tab.dataset.shareWay); return }

      const pick = target.closest<HTMLElement>('[data-share-role-pick]')
      if (pick?.dataset.shareRolePick) { chooseRole(pick.dataset.shareRolePick); return }

      if (target.closest('[data-link-copy]')) { await copyLink(); return }

      const change = target.closest<HTMLElement>('[data-share-role]')
      if (change) {
        // The listed permission is the control: tapping it is what changes it.
        const next = change.dataset.role === 'read' ? 'write' : 'read'
        try {
          const username = change.closest('li')?.querySelector('.shareWho')?.textContent?.trim().replace(/^@/, '')
          if (!username || username.startsWith('Account without')) throw new Error('That account has no username to name.')
          await request(boardSharesUrl(), 'POST', { board_id: shareId, username, role: next })
          status.textContent = ''
          await refresh()
        } catch (error) {
          status.textContent = error instanceof Error ? error.message : 'That did not work.'
        }
        return
      }

      const withdraw = target.closest<HTMLElement>('[data-share-withdraw]')
      if (withdraw) {
        try {
          await request(boardInvitationsUrl(), 'DELETE', {
            board_id: shareId, invitation_id: withdraw.dataset.shareWithdraw,
          })
          status.textContent = 'Invitation withdrawn.'
          await refresh()
        } catch (error) {
          status.textContent = error instanceof Error ? error.message : 'That did not work.'
        }
        return
      }

      const remove = target.closest<HTMLElement>('[data-share-remove]')
      if (!remove) return
      try {
        await request(boardSharesUrl(), 'DELETE', { board_id: shareId, collaborator_id: remove.dataset.shareRemove })
        status.textContent = 'Removed collaborator.'
        await refresh()
      } catch (error) {
        status.textContent = error instanceof Error ? error.message : 'That did not work.'
      }
    })

    chooseWay('email')
    void refresh()
    return form
  }

  /**
   * Hand over a link. The clipboard is refused often enough — a browser that
   * wants a gesture, an insecure context — that the link is always shown as
   * well, ready to select.
   */
  private async offerCopy(url: string, status: HTMLElement): Promise<void> {
    if (!url) { status.textContent = 'The link could not be made.'; return }
    status.parentElement?.querySelector('.linkField.is-loose')?.remove()
    const holder = document.createElement('div')
    holder.innerHTML = linkField('Invitation link')
    const field = holder.firstElementChild as HTMLElement
    field.classList.add('is-loose')
    ;(field.querySelector('input') as HTMLInputElement).value = url
    status.after(field)
    field.querySelector('[data-link-copy]')!.addEventListener('click', () => { void copyLinkField(field) })
    const copied = await copyLinkField(field)
    status.textContent = copied ? 'Invite link copied. It works once.' : 'Copy this link. It works once.'
  }

  /** Say something in the saved-list status line, where a reader is looking. */
  announce(message: string): void { this.showStatus(message) }

  /** Move keyboard focus to one saved row's History button, when it still exists. */
  focusHistoryAction(boardId: string): boolean {
    const button = this.el.querySelector<HTMLElement>(`[data-sv="history"][data-id="${CSS.escape(boardId)}"]`)
    button?.focus()
    return !!button
  }

  private openHistory(name: string): void {
    const saved = readAll(this.storageKey)[name]
    if (!saved?.id) return
    const locked = !editableBoardNames(readAll(this.storageKey), hasPaidBoardAccess()).has(name)
    if (!canOpenBoardHistory({ ...saved, locked }, this.historyContext())) return
    this.onOpenHistory({ id: saved.id, name, savedAt: saved.savedAt, accountBinding: saved.syncAccount! })
  }

  private renderList() {
    const all = readAll(this.storageKey)
    const names = savedBoardNamesByRecency(all)
    const editable = editableBoardNames(all, hasPaidBoardAccess())
    const shared = sharedBoardNames(all)
    const list = this.el.querySelector('[data-sv="list"]')!
    if (!names.length) {
      list.innerHTML = '<p class="setNote">No saved boards yet. Local saved boards are unlimited.</p>'
      return
    }
    const row = (n: string, locked: boolean) => {
      const project = all[n]
      const isShared = project.access === 'shared'
      const d = new Date(project.savedAt)
      const dateText = Number.isFinite(d.getTime()) ? d.toLocaleString() : 'Date unavailable'
      const preview = documentScene(project.scene)
      const count = preview.objects.length
      const safe = n.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
      const owner = project.ownerUsername ? `Shared by @${escXml(project.ownerUsername)}` : 'Shared board'
      const readOnly = isShared && project.readOnly === true
      const safeId = String(project.id ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
      return `<div class="setItem saveItem${locked ? ' saveItemLocked' : ''}">
        <span class="savePrev" data-sv="load" data-name="${safe}">${previewSvg(preview)}</span>
        <span class="saveMeta" data-sv="load" data-name="${safe}"><strong>${safe}</strong><span>${isShared ? `${owner}${readOnly ? ' - read-only' : ''}` : `${dateText} - ${count} objects`}</span></span>
        ${locked || readOnly ? `<span class="saveReadOnly">${icon('lock')}Read-only</span>` : ''}
        ${!locked && canCreateAgentLink() && all[n].id ? `<button class="setItemAction" data-sv="agent-link" data-id="${safeId}">Copy agent link</button>` : ''}
        ${canOpenBoardHistory({ ...project, locked }, this.historyContext()) ? `<button class="setItemAction" data-sv="history" data-name="${safe}" data-id="${safeId}" aria-label="Version history for ${safe}">History</button>` : ''}
        <button class="setItemAction" data-sv="load" data-name="${safe}">${locked ? 'Open' : 'Load'}</button>
        ${!isShared ? `<button class="setItemAction danger" data-sv="delete" data-name="${safe}" aria-label="Delete ${safe}">${icon('trash')}</button>` : ''}
      </div>`
    }
    const sharedNames = names.filter(n => shared.has(n))
    const personal = names.filter(n => !shared.has(n))
    const open = personal.filter(n => editable.has(n))
    const locked = personal.filter(n => !editable.has(n))
    const editableHead = 'Saved boards'
    list.innerHTML = [
      sharedNames.length ? `<div class="setGroupHead">Shared with you</div><div class="setGroup">${sharedNames.map(n => row(n, false)).join('')}</div>` : '',
      open.length ? `<div class="setGroupHead">${editableHead}</div><div class="setGroup">${open.map(n => row(n, false)).join('')}</div>` : '',
      locked.length ? `<div class="setGroupHead">Read-only</div><div class="setGroup">${locked.map(n => row(n, true)).join('')}</div>` : '',
    ].join('')
  }
}
