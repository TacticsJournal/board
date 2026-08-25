import { BOARD_W, emptyScene, migrate, uid } from './types.ts'
import type { ArrowObj, PlayerObj, Pt, Scene, SceneObj } from './types.ts'
import { nodeSegments, segmentPoint } from './path-nodes.ts'
import { pitchById } from './pitches.ts'

/**
 * A project is an ordered set of boards with a link between each pair. Each
 * board is a still: nothing moves inside one. Movement is what the links
 * describe, and it is derived, never stored — an object keeps its id when a
 * board is copied, so the same id in two boards is the same object and the
 * distance between its two positions is the movement.
 *
 * Projects is the library, Boards is one project's contents, and the board
 * screen is the editor. The three words are the whole model.
 */

/** Visible rectangle in board coordinates: the whole pitch, or a zoom. */
export type BoardView = { x: number; y: number; w: number; h: number }

export type LinkEase = 'in-out' | 'linear' | 'out'
/** How long the move off this board takes, and how it accelerates. */
export type BoardLink = { dur: number; ease: LinkEase }

export type Board = {
  id: string
  title: string
  /** Manual number, e.g. "3a". Absent means the project numbers it. */
  label?: string
  view: BoardView
  scene: Scene
  /** One note per board, in Markdown, any length. */
  note: string
  /**
   * The move that leaves this board. It belongs to the board rather than to
   * the gap, so a board moved elsewhere takes its timing with it. The last
   * board's link is unused until something follows it.
   */
  link: BoardLink
}

export type Project = {
  id: string
  name: string
  boards: Board[]
  /** Epoch ms of the last edit, for ordering the library. */
  updated: number
}

/** What saved boards and sync carry: an old single scene or a full sequence. */
export type BoardDocument = Scene | Project

export type Library = {
  version: 2
  currentId: string
  projects: Project[]
  /**
   * Navigation only: the board last open in each project, by project id. It
   * lets a refresh come back to the same board rather than to board 0, and it
   * is never part of a synced Project document.
   */
  lastBoardIds?: Record<string, string>
}

export const DEFAULT_LINK: BoardLink = { dur: 1200, ease: 'in-out' }
/** Time held on a board before the next move starts. */
export const HOLD_MS = 700
export const LINK_DURATIONS = [600, 1000, 1200, 1600, 2200, 3000]
export const EASES: LinkEase[] = ['in-out', 'linear', 'out']
export const UNTITLED = 'Untitled project'

const KEY = 'tbm-board-projects-v1'
/** Where a single sequence lived before there were projects. */
const LEGACY_KEY = 'tbm-sequence-v1'

export function boardHeight(scene: Scene): number {
  const style = pitchById(scene.pitch)
  const h = Number(scene.board?.h)
  return Number.isFinite(h) && h > 0 ? h : style.boardH
}

export function fullView(scene: Scene): BoardView {
  return { x: 0, y: 0, w: BOARD_W, h: boardHeight(scene) }
}

export function isFullView(board: Board): boolean {
  const full = fullView(board.scene)
  return board.view.x === full.x && board.view.y === full.y
    && board.view.w === full.w && board.view.h === full.h
}

export function cloneScene(scene: Scene): Scene {
  return migrate(JSON.parse(JSON.stringify(scene)))
}

export function makeBoard(scene: Scene, title = ''): Board {
  const copy = cloneScene(scene)
  return {
    id: uid(),
    title,
    view: fullView(copy),
    scene: copy,
    note: '',
    link: { ...DEFAULT_LINK },
  }
}

export function newProject(scene: Scene, name = UNTITLED): Project {
  return { id: uid(), name, boards: [makeBoard(scene)], updated: Date.now() }
}

/** Copy one shared board without carrying its project identity with it. */
export function copyBoard(board: Board): Board {
  const scene = cloneScene(board.scene)
  return {
    id: uid(),
    title: board.title,
    ...(board.label ? { label: board.label } : {}),
    view: { ...board.view },
    scene,
    note: board.note,
    link: { ...DEFAULT_LINK },
  }
}

export function newProjectFromBoard(board: Board, name = UNTITLED): Project {
  return { id: uid(), name, boards: [copyBoard(board)], updated: Date.now() }
}

/** Add a shared board to the end. Object ids stay stable so it can animate. */
export function appendBoardCopy(project: Project, board: Board): Board {
  const copy = copyBoard(board)
  project.boards.push(copy)
  touch(project)
  return copy
}

/**
 * Copying keeps every object id, which is what lets the player know that a
 * player on board 1 and the one on board 4 are the same man. A new board
 * starts from `blank` instead, so nothing is carried across.
 */
export function addBoard(project: Project, afterIdx: number, copy: boolean, blank?: Scene): Board {
  const src = project.boards[afterIdx]
  const board = copy && src
    ? { ...makeBoard(src.scene), view: { ...src.view } }
    : makeBoard(blank ?? emptyScene())
  project.boards.splice(afterIdx + 1, 0, board)
  return board
}

export function removeBoard(project: Project, id: string): boolean {
  if (project.boards.length < 2) return false
  const i = project.boards.findIndex(b => b.id === id)
  if (i < 0) return false
  project.boards.splice(i, 1)   // the board's own link leaves with it
  return true
}

/** `to` counts the project with the moved board already taken out of it. */
export function moveBoard(project: Project, from: number, to: number) {
  if (from === to || from < 0 || from >= project.boards.length) return
  const [board] = project.boards.splice(from, 1)
  project.boards.splice(Math.min(Math.max(to, 0), project.boards.length), 0, board)
}

/** Automatic numbers flow around any board given a manual label. */
export function boardLabel(project: Project, index: number): string {
  const board = project.boards[index]
  if (board?.label) return board.label
  let n = 0
  for (let i = 0; i <= index; i++) if (!project.boards[i].label) n++
  return String(n)
}

export function boardName(project: Project, index: number): string {
  const title = (project.boards[index]?.title ?? '').trim()
  if (title) return title
  const heading = noteHeading(project.boards[index]?.note ?? '')
  return heading || `Board ${boardLabel(project, index)}`
}

/* A note can name the board it belongs to, but only deliberately: a leading
   Markdown heading is the board's name, and any other opening line is just
   the first line of the note. Places that already show the board name can use
   `noteBody` to avoid repeating that heading. */

/** The board's name as written at the top of its note, if it was written. */
export function noteHeading(note: string): string {
  const line = note.split('\n').map(s => s.trim()).find(Boolean) ?? ''
  if (!/^#{1,6}\s+\S/.test(line)) return ''
  return line.replace(/^#{1,6}\s*/, '').replace(/[*_`>]/g, '').trim()
}

/** The note without the heading that names the board. */
export function noteBody(note: string): string {
  if (!noteHeading(note)) return note
  const lines = note.split('\n')
  const at = lines.findIndex(l => l.trim())
  return lines.slice(at + 1).join('\n').replace(/^\s+/, '')
}

/** The first line of a note, with its Markdown marks taken off. */
export function firstLine(note: string): string {
  const line = note.split('\n').map(s => s.trim()).find(Boolean) ?? ''
  return line.replace(/^#{1,6}\s*/, '').replace(/[*_`>]/g, '').trim()
}

/** Total playback time: a hold on every board plus every link's duration. */
export function projectDuration(project: Project): number {
  const moves = project.boards.slice(0, -1).reduce((sum, b) => sum + b.link.dur, 0)
  return project.boards.length * HOLD_MS + moves
}

/**
 * Free keeps three projects on this device, the same number it keeps editable
 * saved boards. A licence or Pro removes the limit; nothing is ever deleted
 * when access lapses, it just stops taking new ones.
 */
export const FREE_PROJECT_LIMIT = 3

export function canCreateProject(lib: Library, paid: boolean): boolean {
  return paid || lib.projects.length < FREE_PROJECT_LIMIT
}

export function canAnimate(project: Project): boolean {
  return project.boards.length > 1
}

/* ---------- persistence ---------- */

type LooseBoard = Partial<Board> & { notes?: Record<string, string> }

function migrateBoard(raw: LooseBoard, links?: BoardLink[], index = 0): Board | null {
  if (!raw || typeof raw !== 'object' || !raw.scene) return null
  const scene = migrate(raw.scene)
  const view = raw.view && Number.isFinite(raw.view.w) && raw.view.w > 0 ? raw.view : fullView(scene)
  const stored = raw.link ?? links?.[index]
  // four note slots collapsed into one: keep what was written, in reading order
  const note = typeof raw.note === 'string'
    ? raw.note
    : ['top', 'left', 'right', 'bottom'].map(s => raw.notes?.[s] ?? '').filter(Boolean).join('\n\n')
  return {
    id: raw.id || uid(),
    title: typeof raw.title === 'string' ? raw.title : '',
    label: typeof raw.label === 'string' && raw.label ? raw.label : undefined,
    view: { x: Number(view.x) || 0, y: Number(view.y) || 0, w: Number(view.w), h: Number(view.h) },
    scene,
    note,
    link: {
      dur: Number.isFinite(stored?.dur) ? Math.max(120, Number(stored!.dur)) : DEFAULT_LINK.dur,
      ease: stored && EASES.includes(stored.ease as LinkEase) ? stored.ease as LinkEase : DEFAULT_LINK.ease,
    },
  }
}

export function migrateProject(raw: unknown): Project | null {
  const p = raw as Partial<Project> & { links?: BoardLink[] }
  if (!p || typeof p !== 'object' || !Array.isArray(p.boards)) return null
  const boards = p.boards
    .map((b, i) => migrateBoard(b as LooseBoard, p.links, i))
    .filter((b): b is Board => !!b)
  if (!boards.length) return null
  return {
    id: p.id || uid(),
    name: typeof p.name === 'string' && p.name.trim() ? p.name : UNTITLED,
    boards,
    updated: Number.isFinite(p.updated) ? Number(p.updated) : Date.now(),
  }
}

/** Recognize a durable document without turning unknown future data into a blank scene. */
export function tryNormalizeBoardDocument(raw: unknown): BoardDocument | null {
  const project = migrateProject(raw)
  if (project) return project
  if (!raw || typeof raw !== 'object' || !Array.isArray((raw as Partial<Scene>).objects)) return null
  return migrate(raw)
}

/** Migrate a known document. Editor-owned callers always provide one. */
export function normalizeBoardDocument(raw: unknown): BoardDocument {
  return tryNormalizeBoardDocument(raw) ?? migrate(raw)
}

/** The first board is the representative scene for saved-board previews. */
export function documentScene(document: BoardDocument): Scene {
  return migrateProject(document)?.boards[0].scene ?? migrate(document)
}

/** A conflict copy is a separate project while its boards and objects stay linked. */
export function copyDocumentForConflict(document: BoardDocument, projectId: string): BoardDocument {
  const copy = JSON.parse(JSON.stringify(document)) as BoardDocument
  if ('boards' in copy) copy.id = projectId
  return copy
}

function mergeDocumentValue(template: unknown, current: unknown, key = ''): unknown {
  // arrowLegend is a known closed object. Keep its normalized value rather
  // than merging invalid old keys back in with future document fields.
  if (key === 'arrowLegend') return JSON.parse(JSON.stringify(current))
  if (Array.isArray(current)) {
    if ((key === 'boards' || key === 'objects') && Array.isArray(template)) {
      const oldById = new Map(template
        .filter(item => item && typeof item === 'object' && typeof (item as { id?: unknown }).id === 'string')
        .map(item => [(item as { id: string }).id, item]))
      return current.map(item => {
        const id = item && typeof item === 'object' ? (item as { id?: unknown }).id : null
        return mergeDocumentValue(typeof id === 'string' ? oldById.get(id) : undefined, item)
      })
    }
    return JSON.parse(JSON.stringify(current))
  }
  if (current && typeof current === 'object') {
    const old = template && typeof template === 'object' && !Array.isArray(template)
      ? template as Record<string, unknown> : {}
    const result: Record<string, unknown> = { ...old }
    if (Array.isArray((current as { objects?: unknown }).objects) && !('arrowLegend' in current)) {
      delete result.arrowLegend
    }
    for (const [childKey, value] of Object.entries(current as Record<string, unknown>)) {
      result[childKey] = mergeDocumentValue(old[childKey], value, childKey)
    }
    return result
  }
  return current
}

/** Normalize the known legend field in otherwise untouched imported JSON. */
export function normalizeDocumentArrowLegends(template: BoardDocument, current: BoardDocument): BoardDocument {
  const copy = JSON.parse(JSON.stringify(template)) as BoardDocument
  const apply = (target: Scene, normalized: Scene) => {
    if (normalized.arrowLegend) target.arrowLegend = JSON.parse(JSON.stringify(normalized.arrowLegend))
    else delete target.arrowLegend
  }
  if ('boards' in copy && 'boards' in current) {
    copy.boards.forEach((board, index) => {
      const normalized = current.boards[index]
      if (normalized) apply(board.scene, normalized.scene)
    })
  } else if (!('boards' in copy) && !('boards' in current)) apply(copy, current)
  return copy
}

/** Keep fields from a newer producer while applying edits made by this version. */
export function preserveDocumentFields(template: unknown, current: BoardDocument): BoardDocument {
  const oldProject = !!template && typeof template === 'object' && Array.isArray((template as Partial<Project>).boards)
  const newProject = 'boards' in current
  if (!oldProject && newProject && current.boards[0]) {
    const copy = mergeDocumentValue(undefined, current) as Project
    copy.boards[0].scene = mergeDocumentValue(template, current.boards[0].scene) as Scene
    return copy
  }
  if (oldProject && !newProject) {
    const copy = JSON.parse(JSON.stringify(template)) as Project
    if (copy.boards[0]) copy.boards[0].scene = mergeDocumentValue(copy.boards[0].scene, current) as Scene
    return copy
  }
  return mergeDocumentValue(template, current) as BoardDocument
}

/** Keep only string board ids belonging to projects that still exist. */
function sanitizeLastBoardIds(
  raw: unknown,
  projects: readonly Project[],
): Record<string, string> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const known = new Set(projects.map(p => p.id))
  const out: Record<string, string> = {}
  for (const [projectId, boardId] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof boardId === 'string' && boardId && known.has(projectId)) out[projectId] = boardId
  }
  return Object.keys(out).length ? out : undefined
}

/** The stored board's index, or -1 when nothing usable is remembered. */
export function storedBoardIndex(lib: Library, project: Project): number {
  const boardId = lib.lastBoardIds?.[project.id]
  return boardId ? project.boards.findIndex(board => board.id === boardId) : -1
}

/** Remember the board a project is left on. Navigation state, not document state. */
export function rememberBoard(lib: Library, projectId: string, boardId: string | undefined) {
  if (!boardId) return
  lib.lastBoardIds = { ...(lib.lastBoardIds ?? {}), [projectId]: boardId }
}

export function migrateLibrary(raw: unknown): Library | null {
  const lib = raw as Partial<Library>
  if (!lib || typeof lib !== 'object' || !Array.isArray(lib.projects)) return null
  const projects = lib.projects.map(migrateProject).filter((p): p is Project => !!p)
  if (!projects.length) return null
  const currentId = projects.some(p => p.id === lib.currentId) ? lib.currentId! : projects[0].id
  const lastBoardIds = sanitizeLastBoardIds(lib.lastBoardIds, projects)
  return { version: 2, currentId, projects, ...(lastBoardIds ? { lastBoardIds } : {}) }
}

export function loadLibrary(storageKey = KEY, legacyKey = LEGACY_KEY): Library | null {
  try {
    const raw = localStorage.getItem(storageKey)
    const lib = raw ? migrateLibrary(JSON.parse(raw)) : null
    if (lib) return lib
  } catch { /* unreadable: fall through to the old single sequence */ }
  try {
    // whatever was in the sequence becomes the first project
    const old = localStorage.getItem(legacyKey)
    const project = old ? migrateProject(JSON.parse(old)) : null
    if (project) return { version: 2, currentId: project.id, projects: [project] }
  } catch { /* nothing to carry over */ }
  return null
}

export function saveLibrary(lib: Library, storageKey = KEY) {
  try { localStorage.setItem(storageKey, JSON.stringify(lib)) } catch { /* storage full or blocked */ }
}

export function currentProject(lib: Library): Project {
  return lib.projects.find(p => p.id === lib.currentId) ?? lib.projects[0]
}

/** Newest first, which is how the library reads. */
export function orderedProjects(lib: Library): Project[] {
  return [...lib.projects].sort((a, b) => b.updated - a.updated)
}

function projectHasContent(project: Project): boolean {
  return project.name !== UNTITLED || project.boards.length > 1 || project.boards.some(board =>
    !!board.title.trim() || !!board.label || !!board.note.trim() || board.scene.objects.length > 0)
}

/**
 * A brand-new device starts with one temporary blank Project so the editor has
 * something to draw. Once account rows arrive, prefer real account work and
 * discard that untouched placeholder instead of leaving a signed-in device on
 * an empty pitch.
 */
export function freshDeviceDestination(
  lib: Library,
  starter: { id: string; updated: number } | null,
  remoteProjectIds: ReadonlySet<string>,
): Project | null {
  if (!starter) return null
  const currentStarter = lib.projects.find(project => project.id === starter.id)
  if (!currentStarter || currentStarter.updated !== starter.updated) return null
  const remote = orderedProjects(lib).filter(project => project.id !== starter.id && remoteProjectIds.has(project.id))
  return remote.find(projectHasContent) ?? remote[0] ?? null
}

export function touch(project: Project) {
  project.updated = Date.now()
}

/** A full Project document paired with its durable saved-board row id. */
export type ProjectDocumentRow = { rowId: string; project: Project }

/**
 * Reconcile the visible Project library with full Project documents in saved
 * rows. This does not touch storage: callers persist `persist` themselves.
 */
export function reconcileProjectLibrary(
  library: Library,
  savedRows: readonly ProjectDocumentRow[],
  options: {
    /** Only startup may turn a local-only Project into a saved row. */
    seedMissing?: boolean
    /** Project ids whose pre-sync durable row was remotely deleted. */
    removeProjectIds?: readonly string[]
    /** applyRemoteCurrent, rather than this merge, owns the open Project. */
    skipCurrent?: boolean
  } = {},
): { library: Library; persist: Project[] } {
  const removed = new Set(options.removeProjectIds ?? [])
  const projects = library.projects.filter(project => project.id === library.currentId || !removed.has(project.id))
  let changed = projects.length !== library.projects.length
  const localById = new Map(projects.map((project, index) => [project.id, index]))
  const savedByProject = new Map<string, ProjectDocumentRow>()
  for (const row of savedRows) {
    const earlier = savedByProject.get(row.project.id)
    if (!earlier || row.project.updated > earlier.project.updated) savedByProject.set(row.project.id, row)
  }

  const persist: Project[] = []
  for (const row of savedByProject.values()) {
    const index = localById.get(row.project.id)
    if (index === undefined) {
      localById.set(row.project.id, projects.length)
      projects.push(row.project)
      changed = true
      continue
    }
    const local = projects[index]
    if (options.skipCurrent && local.id === library.currentId) continue
    if (row.project.updated > local.updated) {
      projects[index] = row.project
      changed = true
    } else if (local.updated > row.project.updated) {
      persist.push(local)
    }
  }

  if (options.seedMissing) {
    for (const project of projects) {
      if (!savedByProject.has(project.id)) persist.push(project)
    }
  }

  return { library: changed ? { ...library, projects } : library, persist }
}

/* ---------- movement between two boards ---------- */

const POINT_KEYS = ['x', 'y', 'x1', 'y1', 'mx', 'my', 'x2', 'y2', 'w', 'h'] as const

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

/* ---------- arrows as rails ---------- */

const PATH_STEPS = 32
const PATHS = new WeakMap<ArrowObj, Pt[]>()

/** An arrow as points spaced evenly along it, tail first, tip last. */
function arrowPath(arrow: ArrowObj): Pt[] {
  const held = PATHS.get(arrow)
  if (held) return held
  const raw: Pt[] = []
  const nodes = Array.isArray(arrow.points) && arrow.points.length >= 2 ? arrow.points : null
  if (nodes) {
    const segs = nodeSegments(nodes, false)
    segs.forEach((seg, i) => {
      for (let n = i ? 1 : 0; n <= PATH_STEPS; n++) raw.push(segmentPoint(seg, n / PATH_STEPS))
    })
  } else {
    // the same quadratic the board and every export draw
    const cx = 2 * arrow.mx - (arrow.x1 + arrow.x2) / 2
    const cy = 2 * arrow.my - (arrow.y1 + arrow.y2) / 2
    for (let n = 0; n <= PATH_STEPS * 2; n++) {
      const u = n / (PATH_STEPS * 2), v = 1 - u
      raw.push({
        x: v * v * arrow.x1 + 2 * v * u * cx + u * u * arrow.x2,
        y: v * v * arrow.y1 + 2 * v * u * cy + u * u * arrow.y2,
      })
    }
  }
  /* resampled by length, so a player rides a bend at the speed it rides a
     straight: an evenly-spaced parameter on a curve is not even in distance */
  const run: number[] = [0]
  for (let i = 1; i < raw.length; i++) run.push(run[i - 1] + Math.hypot(raw[i].x - raw[i - 1].x, raw[i].y - raw[i - 1].y))
  const total = run[run.length - 1]
  const out: Pt[] = []
  let at = 1
  for (let n = 0; n <= PATH_STEPS; n++) {
    const want = (n / PATH_STEPS) * total
    while (at < run.length - 1 && run[at] < want) at++
    const span = run[at] - run[at - 1]
    const k = span > 0 ? (want - run[at - 1]) / span : 0
    out.push({ x: lerp(raw[at - 1].x, raw[at].x, k), y: lerp(raw[at - 1].y, raw[at].y, k) })
  }
  if (total > 0) PATHS.set(arrow, out)
  return out
}

/** A point along an arrow, 0 at its tail and 1 at its tip. */
export function pointOnArrow(arrow: ArrowObj, t: number): Pt {
  const path = arrowPath(arrow)
  const at = Math.max(0, Math.min(1, t)) * (path.length - 1)
  const i = Math.min(path.length - 2, Math.floor(at))
  const k = at - i
  return { x: lerp(path[i].x, path[i + 1].x, k), y: lerp(path[i].y, path[i + 1].y, k) }
}

/**
 * An arrow drawn from where a player stands to where that player is going is
 * the rail it travels on. The arrow is already on the board being left, so it
 * is read first and ridden second, and the player arrives at its tip.
 */
function railsBetween(a: Scene, b: Scene): Map<string, ArrowObj> {
  const target = new Map(b.objects.map(o => [o.id, o]))
  const rails = new Map<string, ArrowObj>()
  const ridden = new Set<string>()
  for (const arrow of a.objects) {
    if (arrow.type !== 'arrow' || arrow.head === false || arrow.measure) continue
    const path = arrowPath(arrow)
    const tail = path[0], tip = path[path.length - 1]
    let best: { id: string; gap: number } | null = null
    for (const obj of a.objects) {
      if (obj.type !== 'player' || ridden.has(obj.id)) continue
      const to = target.get(obj.id)
      if (!to || to.type !== 'player') continue
      const moved = Math.hypot(to.x - obj.x, to.y - obj.y)
      // a player who stays put is not travelling anywhere, arrow or no arrow
      if (moved < Math.max(2, obj.r)) continue
      const reach = Math.max(30, obj.r * 2.2)
      const start = Math.hypot(obj.x - tail.x, obj.y - tail.y)
      const end = Math.hypot(to.x - tip.x, to.y - tip.y)
      if (start > reach || end > reach) continue
      if (!best || start + end < best.gap) best = { id: obj.id, gap: start + end }
    }
    if (best) { rails.set(best.id, arrow); ridden.add(best.id) }
  }
  return rails
}

/**
 * The scene shown `t` of the way from `a` to `b`: an object present in both
 * travels, one that only exists in `a` fades out where it stands, and one that
 * only exists in `b` fades in where it will be. A player with an arrow to its
 * destination travels along the arrow rather than straight across.
 */
export function tweenScene(a: Scene, b: Scene, t: number): { scene: Scene; fading: Set<string>; arriving: Set<string>; riding: Set<string> } {
  const target = new Map(b.objects.map(o => [o.id, o]))
  const fading = new Set<string>()
  const arriving = new Set<string>()
  const riding = new Set<string>()
  const rails = railsBetween(a, b)
  const objects = a.objects.map((obj) => {
    const to = target.get(obj.id)
    if (!to || to.type !== obj.type) { fading.add(obj.id); return obj }
    const next = { ...obj } as Record<string, unknown>
    for (const key of POINT_KEYS) {
      const from = (obj as Record<string, unknown>)[key]
      const dest = (to as Record<string, unknown>)[key]
      if (typeof from === 'number' && typeof dest === 'number') next[key] = lerp(from, dest, t)
    }
    const rail = obj.type === 'player' ? rails.get(obj.id) : undefined
    if (rail) {
      /* the rail carries the shape of the journey; the ends are still the
         player's own, so it neither jumps on nor jumps off */
      const path = arrowPath(rail)
      const tail = path[0], tip = path[path.length - 1]
      const at = pointOnArrow(rail, t)
      const end = to as PlayerObj
      next.x = at.x + lerp(obj.x - tail.x, end.x - tip.x, t)
      next.y = at.y + lerp(obj.y - tail.y, end.y - tip.y, t)
    }
    return next as SceneObj
  })
  for (const obj of b.objects) {
    const was = a.objects.find(o => o.id === obj.id)
    if (was && was.type === obj.type) continue
    arriving.add(obj.id)
    objects.push(obj)
  }
  // a rail is read for as long as it is ridden, then leaves as its rider lands
  for (const arrow of rails.values()) if (fading.delete(arrow.id)) riding.add(arrow.id)
  return { scene: { ...a, objects }, fading, arriving, riding }
}

/**
 * The camera between two views. The centre travels linearly and the zoom
 * travels geometrically, so a 4x zoom in and a 4x zoom out take the same time
 * and neither end of the move rushes.
 */
export function tweenView(a: BoardView, b: BoardView, t: number): BoardView {
  if (t <= 0) return a
  if (t >= 1) return b
  const w = a.w * Math.pow(b.w / a.w, t)
  const h = a.h * Math.pow(b.h / a.h, t)
  const cx = lerp(a.x + a.w / 2, b.x + b.w / 2, t)
  const cy = lerp(a.y + a.h / 2, b.y + b.h / 2, t)
  return { x: cx - w / 2, y: cy - h / 2, w, h }
}

export const easings: Record<LinkEase, (t: number) => number> = {
  'in-out': t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  linear: t => t,
  out: t => 1 - Math.pow(1 - t, 3),
}

/* An object leaving is gone before the halfway mark and one arriving is fully
   there before the move ends, so the two never sit on top of each other. */
function exitAlpha(p: number): number { return Math.max(0, 1 - p / 0.45) }
function enterAlpha(p: number): number { return Math.max(0, Math.min(1, (p - 0.45) / 0.35)) }
/* A rail is still the thing being read while it is being ridden, so it holds
   its ink until the last stretch and goes as the player reaches the tip. */
function rideAlpha(p: number): number { return Math.max(0, 1 - Math.max(0, p - 0.82) / 0.18) }

export type PlayFrame = {
  index: number
  /** Board the caption should be showing. */
  current: number
  view: BoardView
  scene: Scene
  /** Objects on their way out, and how visible they still are. */
  fading: Set<string>
  exitAlpha: number
  /** Objects on their way in, and how far in they are. */
  arriving: Set<string>
  enterAlpha: number
  /** Arrows being ridden: they hold until their rider reaches the tip. */
  riding: Set<string>
  rideAlpha: number
  /** 1 while a board is held, dipping to 0 across a move. */
  noteAlpha: number
  moving: boolean
  /** Eased progress through the current move, 0 while a board is held. */
  p: number
}

/**
 * What the player should draw at board position `pos`: the whole part is the
 * board being held, the fraction is progress into the next one. The deck moves
 * on a spring, so the fraction arrives already eased and nothing is eased twice.
 */
export function frameAtPos(project: Project, pos: number): PlayFrame {
  const last = project.boards.length - 1
  const held = Math.max(0, Math.min(last, pos))
  const index = Math.min(last, Math.floor(held))
  const p = Math.max(0, Math.min(1, held - index))
  const from = project.boards[index]
  const to = project.boards[Math.min(index + 1, last)]
  const { scene, fading, arriving, riding } = tweenScene(from.scene, to.scene, p)
  // the note leaves with the board it belongs to and arrives with the next
  const noteAlpha = p === 0 ? 1 : p < 0.42 ? 1 - p / 0.42 : p > 0.58 ? (p - 0.58) / 0.42 : 0
  return {
    index,
    current: p > 0.5 ? Math.min(index + 1, last) : index,
    view: tweenView(from.view, to.view, p),
    scene,
    fading,
    exitAlpha: exitAlpha(p),
    arriving,
    enterAlpha: enterAlpha(p),
    riding,
    rideAlpha: rideAlpha(p),
    noteAlpha,
    moving: p > 0,
    p,
  }
}

/** What the player should draw `ms` into the project. */
export function frameAt(project: Project, ms: number): PlayFrame {
  const segments: { move: boolean; index: number; dur: number }[] = []
  project.boards.forEach((_, i) => {
    segments.push({ move: false, index: i, dur: HOLD_MS })
    if (i < project.boards.length - 1) segments.push({ move: true, index: i, dur: project.boards[i].link.dur })
  })
  const total = segments.reduce((sum, s) => sum + s.dur, 0)
  const t = Math.max(0, Math.min(ms, total))
  let acc = 0
  let seg = segments[0]
  let local = 0
  for (const s of segments) {
    if (t <= acc + s.dur) { seg = s; local = s.dur ? (t - acc) / s.dur : 0; break }
    acc += s.dur
  }
  const from = project.boards[seg.index]
  const to = project.boards[Math.min(seg.index + (seg.move ? 1 : 0), project.boards.length - 1)]
  const p = seg.move ? easings[project.boards[seg.index].link.ease](Math.min(1, local)) : 0
  const { scene, fading, arriving, riding } = tweenScene(from.scene, to.scene, p)
  // the note leaves with the board it belongs to and arrives with the next
  const noteAlpha = seg.move ? (p < 0.42 ? 1 - p / 0.42 : p > 0.58 ? (p - 0.58) / 0.42 : 0) : 1
  return {
    index: seg.index,
    current: seg.move && p > 0.5 ? seg.index + 1 : seg.index,
    view: tweenView(from.view, to.view, p),
    scene,
    fading,
    exitAlpha: exitAlpha(p),
    arriving,
    enterAlpha: enterAlpha(p),
    riding,
    rideAlpha: rideAlpha(p),
    noteAlpha,
    moving: seg.move,
    p,
  }
}
