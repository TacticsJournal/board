import { boardCollaborationUrl } from './board-api.ts'
import { migrate, type Scene } from './types.ts'

/** Visual board collaboration is deliberately separate from the durable-sync nudge socket. */
/** A 34 ms cadence stays just below the server's bounded 30 fps rate. */
export const PREVIEW_INTERVAL = 34
export const PREVIEW_MAX_BYTES = 131_072

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

export type PreviewPhase = 'update' | 'end'
export type PreviewMessage = {
  type: 'preview'
  page: string
  gesture: string
  sequence: number
  phase: PreviewPhase
  scene: Scene
  source?: string
}

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
      && (object.namePos === 'top' || object.namePos === 'bottom')
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

export function parsePreview(value: unknown): (PreviewMessage & { source: string }) | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  if (raw.type !== 'preview' || !safePage(raw.page) || !safeGesture(raw.gesture)
    || !Number.isSafeInteger(raw.sequence) || (raw.sequence as number) < 0
    || (raw.phase !== 'update' && raw.phase !== 'end') || !safePage(raw.source)) return null
  const scene = sanitizePreviewScene(raw.scene)
  if (!scene) return null
  return { type: 'preview', page: raw.page, gesture: raw.gesture, sequence: raw.sequence, phase: raw.phase, scene, source: raw.source }
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
    let text: string
    try { text = JSON.stringify({ type: 'preview', page: next.page, gesture: next.gesture, sequence: sequence++, phase: next.phase, scene }) } catch { return }
    if (new TextEncoder().encode(text).byteLength > PREVIEW_MAX_BYTES) return
    try {
      socket.send(text)
      lastPreviewAt = now()
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
          if (control) setActive(control.active)
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
