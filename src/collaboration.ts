import { boardCollaborationUrl } from './board-api.ts'
import { insertByTier, migrate, sanitizeObjects, type Scene, type SceneObj } from './types.ts'

/** Visual board collaboration is deliberately separate from the durable-sync nudge socket. */
/**
 * A 34 ms cadence sends about 30 frames a second. Receivers tween between
 * frames, so motion still paints at the display's own refresh rate.
 */
export const PREVIEW_INTERVAL = 34
export const PREVIEW_MAX_BYTES = 131_072
/**
 * A gesture sends its whole scene first and then only what changed. It sends
 * the whole scene again at least this often, so a receiver that missed the
 * start (it joined late, or it is an older client that ignores deltas)
 * catches up within a second.
 */
export const PREVIEW_KEYFRAME_INTERVAL = 1_000

/** Keep a dead preview socket quiet, but retry it with the same bounded ladder as live sync. */
export const RETRY_DELAYS = [1_000, 2_000, 5_000, 10_000, 30_000]
export const PING_INTERVAL = 45_000
export const PONG_TIMEOUT = 10_000
export const OPEN_TIMEOUT = 10_000
/** Reconnect before the server's five-minute room authorization expires. */
export const AUTH_REFRESH_INTERVAL = 4 * 60 * 1_000

const PING = JSON.stringify({ type: 'ping' })
const MAX_PREVIEW_OBJECTS = 2_000
const PREVIEW_TYPES = new Set(['player', 'ball', 'cone', 'goal', 'image', 'marker', 'arrow', 'box', 'text'])
/** The ids migrate() keeps as they are. A delta is keyed by id, so it can carry no other kind. */
const OBJECT_ID = /^[A-Za-z0-9_-]{1,100}$/

export type PreviewPhase = 'update' | 'end'
/**
 * What changed in a gesture since the frame named by `base`: each new or
 * changed object whole, and the ids that went. A new object goes on top of
 * its tier, where insertByTier puts it; a sender whose order differs from that
 * sends the whole scene instead, so the order never has to travel.
 */
export type PreviewDelta = { objects: SceneObj[]; removed: string[] }
type PreviewHeader = { type: 'preview'; page: string; gesture: string; sequence: number; source?: string }
export type PreviewSceneMessage = PreviewHeader & { phase: PreviewPhase; scene: Scene }
export type PreviewDeltaMessage = PreviewHeader & { phase: 'update'; base: number; delta: PreviewDelta }
export type PreviewMessage = PreviewSceneMessage | PreviewDeltaMessage

export type CollaborationControlMessage = {
  type: 'collaboration'
  active: boolean
  devices: number
  reason?: 'weekly_limit'
  resets_at?: string
}

export type CollaborationSocket = {
  readyState: number
  send(data: string): void
  close(): void
  onopen: ((event: unknown) => void) | null
  onclose: ((event: unknown) => void) | null
  onerror: ((event: unknown) => void) | null
  onmessage: ((event: { data: unknown }) => void) | null
}

export type CollaborationOptions = {
  deviceId: string
  enabled: () => boolean
  onPreview: (message: PreviewMessage & { source: string }) => void
  /** The room disappeared or its socket died; callers restore their local view. */
  onExpired?: () => void
  open?: (url: string) => CollaborationSocket
  setTimer?: (fn: () => void, ms: number) => number
  clearTimer?: (handle: number) => void
  now?: () => number
  jitter?: () => number
}

export type CollaborationChannel = {
  start(boardId: string | null): void
  setRoom(boardId: string | null): void
  stop(): void
  /** Does nothing while disconnected: previews are never durable work. */
  preview(page: string, gesture: string, phase: PreviewPhase, scene: () => Scene): boolean
  readonly connected: boolean
  readonly active: boolean
  readonly room: string | null
}

export function collaborationUrl(boardId: string, deviceId: string, origin: string = typeof location === 'undefined' ? 'https://board.tacticsjournal.com' : location.origin): string {
  const url = new URL(boardCollaborationUrl(), origin)
  url.searchParams.set('board_id', boardId)
  url.searchParams.set('device', deviceId)
  return url.href.replace(/^http/, 'ws')
}

function safeGesture(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{8,80}$/.test(value)
}

function safePage(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 160
}

function safePreviewValue(value: unknown, seen: Set<object>, depth = 0): boolean {
  if (value === null || typeof value === 'boolean' || value === undefined) return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (typeof value === 'string') return value.length <= 8_192
  if (depth > 8 || typeof value !== 'object') return false
  const object = value as object
  if (seen.has(object)) return false
  seen.add(object)
  const ok = Array.isArray(value)
    ? value.length <= MAX_PREVIEW_OBJECTS * 4 && value.every(item => safePreviewValue(item, seen, depth + 1))
    : Object.keys(value).length <= 96 && Object.values(value).every(item => safePreviewValue(item, seen, depth + 1))
  seen.delete(object)
  return ok
}

function finiteFields(object: Record<string, unknown>, fields: string[]): boolean {
  return fields.every(field => Number.isFinite(object[field]))
}
function stringFields(object: Record<string, unknown>, fields: string[]): boolean {
  return fields.every(field => typeof object[field] === 'string' && (object[field] as string).length <= 8_192)
}
function booleanFields(object: Record<string, unknown>, fields: string[]): boolean {
  return fields.every(field => typeof object[field] === 'boolean')
}
function optionalFields(object: Record<string, unknown>): boolean {
  return (object.flipX === undefined || typeof object.flipX === 'boolean')
    && (object.flipY === undefined || typeof object.flipY === 'boolean')
    && (object.rotation === undefined || Number.isFinite(object.rotation))
    && (object.group === undefined || (typeof object.group === 'string' && object.group.length <= 160))
}
function validPreviewObject(object: Record<string, unknown>): boolean {
  if (!optionalFields(object)) return false
  switch (object.type) {
    case 'player': return finiteFields(object, ['x', 'y', 'r', 'nameSize'])
      && stringFields(object, ['color', 'label', 'name', 'namePos', 'nameDisplay'])
      && (object.namePos === 'top' || object.namePos === 'bottom' || object.namePos === 'auto')
      && (object.nameDisplay === 'first' || object.nameDisplay === 'last' || object.nameDisplay === 'full')
    case 'ball':
    case 'cone': return finiteFields(object, ['x', 'y', 'size'])
    case 'goal': return finiteFields(object, ['x', 'y', 'size']) && (object.variant === 'small' || object.variant === 'normal')
    case 'marker': return finiteFields(object, ['x', 'y', 'w'])
      && stringFields(object, ['name', 'namePos']) && (object.namePos === 'top' || object.namePos === 'bottom')
    case 'arrow': return finiteFields(object, ['x1', 'y1', 'mx', 'my', 'x2', 'y2', 'width'])
      && stringFields(object, ['dash', 'color']) && booleanFields(object, ['curved', 'head'])
      && (object.dash === 'solid' || object.dash === 'dashed' || object.dash === 'dotted')
      && (object.measure === undefined || typeof object.measure === 'boolean')
    case 'box': {
      const corners = object.corners
      return finiteFields(object, ['x', 'y', 'w', 'h', 'rotation', 'opacity'])
        && stringFields(object, ['shape', 'fill'])
        && (object.shape === 'rect' || object.shape === 'ellipse' || object.shape === 'triangle' || object.shape === 'outline')
        && (corners === undefined || (Array.isArray(corners) && corners.length === 4 && corners.every(point => point && typeof point === 'object'
          && Number.isFinite((point as Record<string, unknown>).x) && Number.isFinite((point as Record<string, unknown>).y))))
    }
    case 'text': return finiteFields(object, ['x', 'y', 'size', 'rotation'])
      && stringFields(object, ['text', 'color']) && booleanFields(object, ['bold'])
    case 'image': return finiteFields(object, ['x', 'y', 'size', 'aspect']) && stringFields(object, ['assetId'])
    default: return false
  }
}

function validPreviewMatch(value: unknown): boolean {
  if (value === undefined) return true
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const match = value as Record<string, unknown>
  return stringFields(match, ['home', 'away', 'homeScore', 'awayScore', 'clock', 'date'])
    && booleanFields(match, ['showScoreboard', 'showTeams'])
}
function validPreviewLegend(value: unknown): boolean {
  if (value === undefined) return true
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  return Object.values(value).every(item => typeof item === 'string' && item.length <= 8_192)
}

/**
 * A local scene is already trusted by the editor, but its shape is checked
 * before it can enter the wire serializer. This deliberately does not migrate
 * or clone: each collaboration flush only walks the values and JSON-encodes them.
 */
export function isPreviewScene(value: unknown): value is Scene {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const scene = value as Record<string, unknown>
  const board = scene.board
  if (scene.version !== 4 || !board || typeof board !== 'object' || Array.isArray(board)) return false
  const b = board as Record<string, unknown>
  if (!Number.isFinite(b.w) || !Number.isFinite(b.h) || b.w !== 800 || (b.h as number) < 100 || (b.h as number) > 4_000) return false
  if (scene.pitch !== undefined && !safePage(scene.pitch)) return false
  if (!validPreviewMatch(scene.match) || !validPreviewLegend(scene.arrowLegend)) return false
  if (!Array.isArray(scene.objects) || scene.objects.length > MAX_PREVIEW_OBJECTS) return false
  const seen = new Set<object>()
  return scene.objects.every(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return false
    const object = item as Record<string, unknown>
    return typeof object.id === 'string' && safePage(object.id)
      && typeof object.type === 'string' && PREVIEW_TYPES.has(object.type)
      && validPreviewObject(object) && safePreviewValue(object, seen)
  }) && safePreviewValue({ match: scene.match, arrowLegend: scene.arrowLegend }, seen)
}

/** Project every wire scene through the normal import sanitizer before drawing it. */
export function sanitizePreviewScene(value: unknown): Scene | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as { version?: unknown; objects?: unknown }
  if (raw.version !== 4 || !Array.isArray(raw.objects)) return null
  return migrate(value)
}

/**
 * A delta's objects take the same import sanitizer as a scene. One that it
 * would drop or give a fresh id has no slot to land in, so the frame is refused.
 */
function parsePreviewDelta(value: unknown): PreviewDelta | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  if (!exactKeys(raw, ['objects', 'removed']) || !Array.isArray(raw.objects) || !Array.isArray(raw.removed)
    || raw.objects.length + raw.removed.length > MAX_PREVIEW_OBJECTS) return null
  const ids = new Set<string>()
  const fresh = (id: unknown) => {
    if (typeof id !== 'string' || !OBJECT_ID.test(id) || ids.has(id)) return false
    ids.add(id)
    return true
  }
  if (!raw.removed.every(fresh)) return null
  if (!raw.objects.every(item => !!item && typeof item === 'object' && !Array.isArray(item) && fresh((item as { id?: unknown }).id))) return null
  const objects = sanitizeObjects(raw.objects)
  if (objects.length !== raw.objects.length || objects.some((object, i) => object.id !== (raw.objects as { id: string }[])[i].id)) return null
  return { objects, removed: raw.removed as string[] }
}

export function parsePreview(value: unknown): (PreviewMessage & { source: string }) | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  if (raw.type !== 'preview' || !safePage(raw.page) || !safeGesture(raw.gesture)
    || !Number.isSafeInteger(raw.sequence) || (raw.sequence as number) < 0
    || (raw.phase !== 'update' && raw.phase !== 'end') || !safePage(raw.source)) return null
  const header = { type: 'preview' as const, page: raw.page, gesture: raw.gesture, sequence: raw.sequence as number, source: raw.source }
  if (raw.delta !== undefined || raw.base !== undefined) {
    // A delta only ever continues a moving gesture; an end is always whole.
    if (raw.scene !== undefined || raw.phase !== 'update' || !Number.isSafeInteger(raw.base)
      || (raw.base as number) < 0 || (raw.base as number) >= header.sequence) return null
    const delta = parsePreviewDelta(raw.delta)
    return delta ? { ...header, phase: 'update', base: raw.base as number, delta } : null
  }
  const scene = sanitizePreviewScene(raw.scene)
  if (!scene) return null
  return { ...header, phase: raw.phase, scene }
}

/**
 * Applies a delta to an ordered list. Sender and receiver both rebuild a
 * gesture's order with this one function, so the two cannot disagree.
 */
function applyPreviewDelta<T extends { id: string; type: SceneObj['type'] }>(base: readonly T[], objects: readonly T[], removed: readonly string[]): T[] {
  const gone = new Set(removed)
  const next = base.filter(item => !gone.has(item.id))
  const index = new Map(next.map((item, i) => [item.id, i]))
  const added: T[] = []
  for (const item of objects) {
    const at = index.get(item.id)
    if (at === undefined) added.push(item)
    else next[at] = item
  }
  // insertByTier reads only each entry's type.
  for (const item of added) insertByTier(next as unknown as SceneObj[], item as unknown as SceneObj)
  return next
}

function sceneHead(scene: Scene): string {
  const { objects: _objects, ...head } = scene
  return JSON.stringify(head)
}

function uniqueIds(objects: readonly { id: string }[]): boolean {
  return new Set(objects.map(object => object.id)).size === objects.length
}

type SentItem = { id: string; type: SceneObj['type']; json: string }
type SentPreview = { page: string; gesture: string; sequence: number; keyframeAt: number; head: string; items: SentItem[] }

/**
 * What changed since the frame last put on the wire. Null asks for a whole
 * scene: the board around the objects changed, an id is duplicated or one a
 * delta cannot carry, or the order is not the one the receiver would rebuild.
 */
function previewDelta(sent: SentPreview, head: string, items: SentItem[], scene: Scene): PreviewDelta | null {
  if (head !== sent.head || !uniqueIds(items) || !uniqueIds(sent.items)) return null
  const before = new Map(sent.items.map(item => [item.id, item.json]))
  const now = new Set(items.map(item => item.id))
  const changed: SentItem[] = []
  const objects: SceneObj[] = []
  for (let i = 0; i < items.length; i += 1) {
    if (before.get(items[i].id) === items[i].json) continue
    if (!OBJECT_ID.test(items[i].id)) return null
    changed.push(items[i])
    objects.push(scene.objects[i])
  }
  const removed = sent.items.filter(item => !now.has(item.id)).map(item => item.id)
  if (removed.some(id => !OBJECT_ID.test(id))) return null
  const rebuilt = applyPreviewDelta(sent.items, changed, removed)
  if (rebuilt.length !== items.length || rebuilt.some((item, i) => item.id !== items[i].id)) return null
  return { objects, removed }
}

/* ---------- receiving ---------- */

/**
 * One received frame, ready to paint. `changes` maps every id that changed
 * or went to what it was before, or is null when the scene must be drawn
 * whole (a first frame, or one whose board or object order changed).
 */
export type PreviewUpdate = {
  key: string
  scene: Scene
  changes: Map<string, SceneObj | null> | null
  /** An end frame is final, so it is shown exactly rather than tweened to. */
  settle: boolean
}

function sceneChanges(before: Scene, after: Scene): Map<string, SceneObj | null> | null {
  if (before.objects.length !== after.objects.length || sceneHead(before) !== sceneHead(after)) return null
  const changes = new Map<string, SceneObj | null>()
  for (let i = 0; i < after.objects.length; i += 1) {
    const was = before.objects[i]
    const now = after.objects[i]
    if (was.id !== now.id) return null
    if (JSON.stringify(was) !== JSON.stringify(now)) changes.set(now.id, was)
  }
  return changes
}

/**
 * The scene each sender is showing, rebuilt from its frames. A delta applies
 * only to the frame it names; without that base (this device joined late, or
 * missed a frame) it is ignored until the sender's next whole scene.
 */
export function createPreviewModel(maxSources = 16) {
  const models = new Map<string, { page: string; gesture: string; sequence: number; scene: Scene }>()
  return {
    apply(message: PreviewMessage & { source: string }): PreviewUpdate | null {
      const current = models.get(message.source)
      const same = current && current.page === message.page && current.gesture === message.gesture ? current : null
      models.delete(message.source)
      let scene: Scene
      let changes: Map<string, SceneObj | null> | null
      if ('delta' in message) {
        if (!same || same.sequence !== message.base) return null
        const before = new Map(same.scene.objects.map(object => [object.id, object]))
        changes = new Map()
        for (const id of message.delta.removed) if (before.has(id)) changes.set(id, before.get(id)!)
        for (const object of message.delta.objects) changes.set(object.id, before.get(object.id) ?? null)
        scene = { ...same.scene, objects: applyPreviewDelta(same.scene.objects, message.delta.objects, message.delta.removed) }
      } else {
        scene = message.scene
        changes = same ? sceneChanges(same.scene, scene) : null
      }
      // A scene with a repeated id has no single slot per id: never patch it.
      if (uniqueIds(scene.objects)) {
        models.set(message.source, { page: message.page, gesture: message.gesture, sequence: message.sequence, scene })
        while (models.size > maxSources) models.delete(models.keys().next().value!)
      } else changes = null
      return { key: `${message.source} ${message.gesture}`, scene, changes, settle: message.phase === 'end' }
    },
    clear() { models.clear() },
    get size() { return models.size },
  }
}

const TWEEN_FIELDS = new Set(['x', 'y', 'x1', 'y1', 'mx', 'my', 'x2', 'y2', 'w', 'h', 'r', 'size'])
const TWEEN_NODES = new Set(['points', 'corners'])

function tweenNodes(from: unknown[], to: unknown[], k: number): unknown[] | null {
  const out: unknown[] = []
  for (let i = 0; i < to.length; i += 1) {
    const a = from[i] as Record<string, unknown> | null
    const b = to[i] as Record<string, unknown> | null
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return null
    const { x: ax, y: ay, ...aRest } = a
    const { x: bx, y: by, ...bRest } = b
    if (typeof ax !== 'number' || typeof ay !== 'number' || typeof bx !== 'number' || typeof by !== 'number'
      || JSON.stringify(aRest) !== JSON.stringify(bRest)) return null
    out.push({ ...b, x: ax + (bx - ax) * k, y: ay + (by - ay) * k })
  }
  return out
}

/**
 * The object part way (k, 0..1) from one frame to the next, or null when
 * the two differ in anything but position and size. Those snap, and so does
 * an object that did not change at all.
 */
export function interpolatePreviewObject(from: SceneObj, to: SceneObj, k: number): SceneObj | null {
  if (from.id !== to.id || from.type !== to.type) return null
  const a = from as Record<string, unknown>
  const b = to as Record<string, unknown>
  const out: Record<string, unknown> = { ...b }
  let moved = false
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const was = a[key]
    const now = b[key]
    if (was === now) continue
    if (TWEEN_FIELDS.has(key) && typeof was === 'number' && typeof now === 'number') {
      out[key] = was + (now - was) * k
      moved = true
    } else if (TWEEN_NODES.has(key) && Array.isArray(was) && Array.isArray(now) && was.length === now.length) {
      const nodes = tweenNodes(was, now, k)
      if (!nodes) return null
      out[key] = nodes
      moved = true
    } else if (JSON.stringify(was) !== JSON.stringify(now)) return null
  }
  return moved ? out as SceneObj : null
}

export type PreviewTarget = {
  /** Draw a scene whole, replacing whatever remote scene is on screen. */
  render(scene: Scene): void
  /**
   * Redraw only these objects, which may be in-between copies of the
   * scene's, and drop these ids. False when no remote scene is on screen.
   */
  patch(scene: Scene, objects: SceneObj[], removed: string[]): boolean
}

export type PreviewPainterOptions = {
  target: PreviewTarget
  frame?: (paint: () => void) => number
  cancel?: (handle: number) => void
  now?: () => number
}

/**
 * Paints received frames at most once per display frame. Only what changed
 * is redrawn, and a moved object glides to its new place over one send
 * interval, so a 30 fps stream reads as continuous motion. The loop runs
 * only while a frame is queued or an object is still gliding.
 */
export function createPreviewPainter(options: PreviewPainterOptions) {
  const frame = options.frame ?? ((paint: () => void) => requestAnimationFrame(() => paint()))
  const cancel = options.cancel ?? ((handle: number) => cancelAnimationFrame(handle))
  const now = options.now ?? (() => performance.now())
  type Tween = { from: SceneObj; to: SceneObj; start: number }
  let handle: number | null = null
  let shown: { key: string; scene: Scene } | null = null
  let queued: { key: string; scene: Scene; whole: boolean; settle: boolean; changes: Map<string, SceneObj | null> } | null = null
  const tweens = new Map<string, Tween>()

  const at = (tween: Tween, time: number) => interpolatePreviewObject(tween.from, tween.to, Math.min(1, Math.max(0, (time - tween.start) / PREVIEW_INTERVAL))) ?? tween.to
  const schedule = () => { if (handle === null) handle = frame(paint) }
  const paint = () => {
    handle = null
    const time = now()
    const next = queued
    queued = null
    const objects: SceneObj[] = []
    const removed: string[] = []
    if (next) {
      if (next.whole || !shown || shown.key !== next.key) {
        tweens.clear()
        shown = { key: next.key, scene: next.scene }
        options.target.render(next.scene)
        return
      }
      shown = { key: next.key, scene: next.scene }
      const byId = new Map(next.scene.objects.map(object => [object.id, object]))
      for (const [id, before] of next.changes) {
        const to = byId.get(id)
        const tween = tweens.get(id)
        tweens.delete(id)
        if (!to) { removed.push(id); continue }
        const from = tween ? at(tween, time) : before
        if (from && !next.settle && interpolatePreviewObject(from, to, 0)) tweens.set(id, { from, to, start: time })
        else objects.push(to)
      }
    }
    if (!shown) { tweens.clear(); return }
    for (const [id, tween] of tweens) {
      if (next?.settle || time - tween.start >= PREVIEW_INTERVAL) {
        objects.push(tween.to)
        tweens.delete(id)
      } else objects.push(at(tween, time))
    }
    if ((objects.length || removed.length) && !options.target.patch(shown.scene, objects, removed)) {
      // The board dropped the remote scene without saying so: draw it again.
      tweens.clear()
      options.target.render(shown.scene)
      return
    }
    if (tweens.size) schedule()
  }

  return {
    /** Queue a frame. Frames that land between two paints merge, never queue. */
    paint(update: PreviewUpdate) {
      if (!queued || queued.key !== update.key || !update.changes) {
        const whole = !update.changes || (!!queued && queued.key !== update.key) || !!queued?.whole
        queued = { key: update.key, scene: update.scene, whole, settle: update.settle, changes: new Map(update.changes ?? []) }
      } else {
        queued.scene = update.scene
        queued.settle ||= update.settle
        // Keep the first "before" for an id: that is what is on screen.
        for (const [id, before] of update.changes) if (!queued.changes.has(id)) queued.changes.set(id, before)
      }
      schedule()
    },
    /** Nothing remote is on screen any more: stop, and start whole next time. */
    reset() {
      if (handle !== null) cancel(handle)
      handle = null
      queued = null
      shown = null
      tweens.clear()
    },
    get busy() { return handle !== null },
  }
}

function validIsoDate(value: unknown): value is string {
  const match = typeof value === 'string'
    ? /^(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.exec(value)
    : null
  if (!match) return false
  const calendar = new Date(0)
  calendar.setUTCFullYear(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  calendar.setUTCHours(0, 0, 0, 0)
  if (calendar.getUTCFullYear() !== Number(match[1]) || calendar.getUTCMonth() !== Number(match[2]) - 1 || calendar.getUTCDate() !== Number(match[3])) return false
  return Number.isFinite(Date.parse(value))
}

function exactKeys(object: Record<string, unknown>, keys: string[]): boolean {
  const actual = Object.keys(object).sort()
  return actual.length === keys.length && actual.every((key, index) => key === keys[index])
}

/** Parse room activity without allowing unknown fields or ambiguous control states. */
export function parseCollaborationControl(value: unknown): CollaborationControlMessage | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  if (raw.type !== 'collaboration' || typeof raw.active !== 'boolean'
    || !Number.isSafeInteger(raw.devices) || (raw.devices as number) < 0 || (raw.devices as number) > 64) return null

  const hasReason = Object.prototype.hasOwnProperty.call(raw, 'reason')
  const hasResetsAt = Object.prototype.hasOwnProperty.call(raw, 'resets_at')
  if (raw.active && (raw.devices as number) < 2) return null
  if (!hasReason) {
    if (hasResetsAt || !exactKeys(raw, ['active', 'devices', 'type'])) return null
    return { type: 'collaboration', active: raw.active, devices: raw.devices as number }
  }
  if (raw.reason !== 'weekly_limit' || raw.active || !hasResetsAt || !validIsoDate(raw.resets_at)
    || !exactKeys(raw, ['active', 'devices', 'reason', 'resets_at', 'type'])) return null
  return {
    type: 'collaboration',
    active: false,
    devices: raw.devices as number,
    reason: 'weekly_limit',
    resets_at: raw.resets_at as string,
  }
}

/**
 * What this socket's relay accepts beyond whole-scene frames. Unlike the
 * control message, unknown fields are ignored: a relay that learns something
 * new must not switch off what an older client already uses. Anything other
 * than an explicit true means no, which is also what a relay that never sends
 * this message means.
 */
export function previewCapabilities(value: unknown): { delta: boolean } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { delta: false }
  const raw = value as Record<string, unknown>
  return { delta: raw.type === 'capabilities' && raw.delta === true }
}

/** Sequence state is scoped to the sender and gesture, not just the sender. */
export function createPreviewOrder(maxEntries = 100) {
  const sequences = new Map<string, number>()
  const ended = new Set<string>()
  const trim = () => {
    while (sequences.size > maxEntries) sequences.delete(sequences.keys().next().value!)
    while (ended.size > maxEntries) ended.delete(ended.values().next().value!)
  }
  return {
    accept(message: Pick<PreviewMessage, 'source' | 'gesture' | 'sequence' | 'phase'>): boolean {
      const key = `${message.source}:${message.gesture}`
      if (ended.has(key) || message.sequence <= (sequences.get(key) ?? -1)) return false
      sequences.set(key, message.sequence)
      if (message.phase === 'end') ended.add(key)
      trim()
      return true
    },
    clear() { sequences.clear(); ended.clear() },
    get size() { return sequences.size + ended.size },
  }
}

export function createCollaborationChannel(options: CollaborationOptions): CollaborationChannel {
  const openSocket = options.open ?? ((url: string) => new WebSocket(url) as unknown as CollaborationSocket)
  const setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms) as unknown as number)
  const clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle))
  const now = options.now ?? Date.now
  const jitter = options.jitter ?? Math.random
  let socket: CollaborationSocket | null = null
  let room: string | null = null
  let stopped = true
  let opened = false
  let active = false
  let retryTimer: number | null = null
  let openTimer: number | null = null
  let pingTimer: number | null = null
  let pongTimer: number | null = null
  let authTimer: number | null = null
  let attempts = 0
  let lastPreviewAt = -PREVIEW_INTERVAL
  let sequence = 0
  let previewTimer: number | null = null
  let pending: { page: string; gesture: string; phase: PreviewPhase; scene: () => Scene } | null = null
  // Deltas are sent only once this socket's server has said it relays them:
  // an older relay closes the socket on any frame shape it does not know.
  let deltas = false
  // The last frame actually put on the wire, which the next delta builds on.
  let lastSent: SentPreview | null = null

  const clear = (timer: number | null): null => {
    if (timer !== null) clearTimer(timer)
    return null
  }
  const clearPreview = () => {
    previewTimer = clear(previewTimer)
    pending = null
  }
  const setActive = (value: boolean) => {
    if (!value) clearPreview()
    active = value
  }
  const teardown = () => {
    openTimer = clear(openTimer)
    pingTimer = clear(pingTimer)
    pongTimer = clear(pongTimer)
    authTimer = clear(authTimer)
    deltas = false
    lastSent = null
    setActive(false)
    if (socket) {
      socket.onopen = socket.onclose = socket.onerror = socket.onmessage = null
      try { socket.close() } catch { /* already closed */ }
    }
    socket = null
    opened = false
  }
  const retry = () => {
    if (stopped || !room || retryTimer !== null || !options.enabled()) return
    const step = RETRY_DELAYS[Math.min(attempts, RETRY_DELAYS.length - 1)]
    attempts += 1
    const delay = step + Math.floor(jitter() * step * 0.5)
    retryTimer = setTimer(() => { retryTimer = null; connect() }, delay)
  }
  const heartbeat = () => {
    pingTimer = setTimer(() => {
      if (!socket || !opened) return
      try { socket.send(PING) } catch { dropped(); return }
      pongTimer = setTimer(dropped, PONG_TIMEOUT)
      heartbeat()
    }, PING_INTERVAL)
  }
  const expire = () => options.onExpired?.()
  const dropped = () => {
    teardown()
    expire()
    retry()
  }
  const flush = () => {
    previewTimer = null
    const next = pending
    pending = null
    if (!next || !socket || !opened || socket.readyState !== 1) return
    let scene: Scene
    try { scene = next.scene() } catch { return }
    if (!isPreviewScene(scene)) return
    const at = now()
    let text: string
    let sent: SentPreview
    try {
      // The editor moves objects in place, so the base is kept as text.
      const head = sceneHead(scene)
      const items = scene.objects.map(object => ({ id: object.id, type: object.type, json: JSON.stringify(object) }))
      const base = deltas && next.phase === 'update' && lastSent && lastSent.page === next.page && lastSent.gesture === next.gesture
        && at - lastSent.keyframeAt < PREVIEW_KEYFRAME_INTERVAL ? lastSent : null
      const delta = base ? previewDelta(base, head, items, scene) : null
      const frame = base && delta
        ? { type: 'preview', page: next.page, gesture: next.gesture, sequence, phase: 'update', base: base.sequence, delta }
        : { type: 'preview', page: next.page, gesture: next.gesture, sequence, phase: next.phase, scene }
      text = JSON.stringify(frame)
      sent = { page: next.page, gesture: next.gesture, sequence, keyframeAt: base && delta ? base.keyframeAt : at, head, items }
      sequence += 1
    } catch { return }
    if (new TextEncoder().encode(text).byteLength > PREVIEW_MAX_BYTES) return
    try {
      socket.send(text)
      lastPreviewAt = now()
      lastSent = sent
    } catch { dropped() }
  }
  const connect = () => {
    if (stopped || socket || !room || !options.enabled()) return
    setActive(false)
    let candidate: CollaborationSocket
    try { candidate = openSocket(collaborationUrl(room, options.deviceId)) } catch { expire(); retry(); return }
    socket = candidate
    candidate.onopen = () => {
      if (socket !== candidate) return
      openTimer = clear(openTimer)
      attempts = 0
      opened = true
      heartbeat()
      authTimer = setTimer(() => {
        authTimer = null
        if (socket !== candidate) return
        teardown()
        expire()
        connect()
      }, AUTH_REFRESH_INTERVAL)
    }
    candidate.onmessage = (event) => {
      if (socket !== candidate || typeof event.data !== 'string' || new TextEncoder().encode(event.data).byteLength > PREVIEW_MAX_BYTES) return
      let message: (PreviewMessage & { source: string }) | null = null
      try {
        const value = JSON.parse(event.data)
        if (value && typeof value === 'object' && (value as { type?: unknown }).type === 'pong') {
          pongTimer = clear(pongTimer)
          return
        }
        if (value && typeof value === 'object' && (value as { type?: unknown }).type === 'collaboration') {
          const control = parseCollaborationControl(value)
          if (control) {
            setActive(control.active)
            // The room changed. Whoever just arrived has no base for a delta.
            lastSent = null
          }
          return
        }
        if (value && typeof value === 'object' && (value as { type?: unknown }).type === 'capabilities') {
          deltas = previewCapabilities(value).delta
          return
        }
        message = parsePreview(value)
      } catch { return }
      if (message && message.source !== options.deviceId) options.onPreview(message)
    }
    candidate.onerror = () => { if (socket === candidate) dropped() }
    candidate.onclose = () => { if (socket === candidate) dropped() }
    openTimer = setTimer(() => {
      if (socket === candidate && !opened) dropped()
    }, OPEN_TIMEOUT)
  }

  return {
    start(boardId) {
      stopped = false
      this.setRoom(boardId)
    },
    setRoom(boardId) {
      if (room === boardId && socket) return
      const changed = room !== boardId
      room = boardId
      retryTimer = clear(retryTimer)
      if (changed) { teardown(); expire() }
      if (!room || !options.enabled()) return
      connect()
    },
    stop() {
      stopped = true
      room = null
      retryTimer = clear(retryTimer)
      attempts = 0
      teardown()
      expire()
    },
    preview(page, gesture, phase, scene) {
      if (!active || !opened || !socket || socket.readyState !== 1 || !safePage(page) || !safeGesture(gesture)) return false
      // End and discrete frames share the same cadence as movement updates.
      // Replacing the pending frame keeps the newest complete scene while
      // preventing quick gesture finishes or key repeat from exceeding 30 fps.
      // A replaced frame was never sent, so flush diffs against the last
      // frame that was, not against the one it replaced.
      pending = { page, gesture, phase, scene }
      const wait = Math.max(0, PREVIEW_INTERVAL - (now() - lastPreviewAt))
      if (previewTimer === null) {
        if (wait === 0) flush()
        else previewTimer = setTimer(flush, wait)
      }
      return true
    },
    get connected() { return opened },
    get active() { return active },
    get room() { return room },
  }
}
