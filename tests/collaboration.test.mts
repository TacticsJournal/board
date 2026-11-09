import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

import {
  AUTH_REFRESH_INTERVAL,
  OPEN_TIMEOUT,
  PING_INTERVAL,
  PONG_TIMEOUT,
  PREVIEW_INTERVAL,
  PREVIEW_KEYFRAME_INTERVAL,
  RETRY_DELAYS,
  collaborationUrl,
  createCollaborationChannel,
  createPreviewModel,
  createPreviewOrder,
  createPreviewPainter,
  interpolatePreviewObject,
  isPreviewScene,
  parsePreview,
  parseCollaborationControl,
  previewCapabilities,
  sanitizePreviewScene,
  type CollaborationSocket,
} from '../src/collaboration.ts'
import { emptyScene, insertByTier, type Scene, type SceneObj } from '../src/types.ts'

class FakeSocket implements CollaborationSocket {
  readyState = 0
  sent: string[] = []
  closed = false
  onopen: any = null
  onclose: any = null
  onerror: any = null
  onmessage: any = null
  readonly url: string
  constructor(url: string) { this.url = url }
  send(data: string) { this.sent.push(data) }
  close() { this.readyState = 3; this.closed = true }
  open() { this.readyState = 1; this.onopen?.({}) }
  deliver(data: unknown) { this.onmessage?.({ data: typeof data === 'string' ? data : JSON.stringify(data) }) }
  fail() { this.onclose?.({}) }
}

function clock() {
  let now = 0
  let next = 1
  const timers = new Map<number, { at: number; fn: () => void }>()
  return {
    now: () => now,
    setTimer(fn: () => void, ms: number) { const id = next++; timers.set(id, { at: now + ms, fn }); return id },
    clearTimer(id: number) { timers.delete(id) },
    advance(ms: number) {
      const until = now + ms
      for (;;) {
        const due = [...timers.entries()].filter(([, timer]) => timer.at <= until).sort((a, b) => a[1].at - b[1].at)[0]
        if (!due) break
        timers.delete(due[0])
        now = due[1].at
        due[1].fn()
      }
      now = until
    },
  }
}

function scene(x = 1) {
  const value = emptyScene()
  value.objects.push({ id: 'ball-one', type: 'ball', x, y: 2, size: 20 })
  return value
}

function players(...xs: number[]) {
  const value = emptyScene()
  xs.forEach((x, i) => value.objects.push({
    id: `player-${i}`, type: 'player', x, y: 100, r: 13, color: '#e02020', label: String(i),
    name: '', namePos: 'bottom', nameSize: 18, nameDisplay: 'last',
  }))
  return value
}

function activate(socket: FakeSocket, devices = 2) {
  socket.deliver({ type: 'collaboration', active: true, devices })
}

/** A relay that knows delta frames says so once, as soon as the socket opens. */
function capable(socket: FakeSocket) {
  socket.deliver({ type: 'capabilities', delta: true })
}

function frames(socket: FakeSocket) {
  return socket.sent.map(value => JSON.parse(value)).filter(value => value.type === 'preview')
}

const FULL_KEYS = ['gesture', 'page', 'phase', 'scene', 'sequence', 'type']
const DELTA_KEYS = ['base', 'delta', 'gesture', 'page', 'phase', 'sequence', 'type']

function wire(frame: Record<string, unknown>, source = 'peer-device') {
  return parsePreview({ ...frame, source })!
}

function channel() {
  const time = clock()
  const sockets: FakeSocket[] = []
  const received: any[] = []
  const live = createCollaborationChannel({
    deviceId: 'device-local',
    enabled: () => true,
    onPreview: (message) => received.push(message),
    open: (url) => { const socket = new FakeSocket(url); sockets.push(socket); return socket },
    now: time.now,
    setTimer: time.setTimer,
    jitter: () => 0,
    clearTimer: time.clearTimer,
  })
  return { live, sockets, received, time }
}

test('collaboration uses the board room URL and validates complete preview messages', () => {
  assert.equal(
    collaborationUrl('saved-board', 'device one', 'https://preview.tactics-board-mapper.pages.dev'),
    'wss://preview.tactics-board-mapper.pages.dev/api/board/collaboration?board_id=saved-board&device=device+one',
  )
  const raw = { type: 'preview', page: 'inner-board', gesture: 'gesture-1', sequence: 0, phase: 'update', scene: scene(), source: 'other' }
  assert.equal(parsePreview(raw)?.scene.version, 4)
  assert.equal(parsePreview(raw)?.scene.pitch, 'pitch')
  assert.equal(isPreviewScene(scene()), true)
  assert.equal(isPreviewScene({ ...scene(), objects: [{ id: 'bad', type: 'unknown' }] }), false)
  assert.equal(parsePreview({ ...raw, gesture: 'short' }), null)
  assert.equal(parsePreview({ ...raw, sequence: -1 }), null)
  assert.equal(parsePreview({ ...raw, scene: { objects: [] } }), null)
})

test('updates are throttled to a bounded 30 fps, the newest scene is serialized, and end is trailing', () => {
  assert.equal(PREVIEW_INTERVAL, 34)
  const { live, sockets, time } = channel()
  live.start('saved-board')
  sockets[0].open()
  activate(sockets[0])
  live.preview('inner-board', 'gesture-1', 'update', () => scene(1))
  live.preview('inner-board', 'gesture-1', 'update', () => scene(2))
  assert.equal(sockets[0].sent.length, 1)
  time.advance(PREVIEW_INTERVAL)
  assert.equal(sockets[0].sent.length, 2)
  assert.equal(JSON.parse(sockets[0].sent[1]).scene.objects[0].x, 2)

  live.preview('inner-board', 'gesture-1', 'update', () => scene(3))
  live.preview('inner-board', 'gesture-1', 'end', () => scene(4))
  assert.equal(sockets[0].sent.length, 2)
  time.advance(PREVIEW_INTERVAL)
  assert.equal(sockets[0].sent.length, 3)
  const final = JSON.parse(sockets[0].sent[2])
  assert.equal(final.phase, 'end')
  assert.equal(final.scene.objects[0].x, 4)
  assert.deepEqual(sockets[0].sent.map(value => JSON.parse(value).sequence), [0, 1, 2])
})

test('rapid discrete edits cannot exceed 30 transmitted frames in one second', () => {
  const { live, sockets, time } = channel()
  live.start('saved-board')
  sockets[0].open()
  activate(sockets[0])
  for (let i = 0; i < 100; i += 1) {
    live.preview('inner-board', `gesture-${i.toString().padStart(4, '0')}`, 'end', () => scene(i))
    time.advance(10)
  }
  assert.equal(sockets[0].sent.length, 30)
  live.stop()
})

test('an open single-device socket stays inactive and does not evaluate a preview', () => {
  const { live, sockets } = channel()
  live.start('saved-board')
  sockets[0].open()
  let evaluated = false
  assert.equal(live.connected, true)
  assert.equal(live.active, false)
  assert.equal(live.preview('inner-board', 'gesture-1', 'update', () => { evaluated = true; return scene() }), false)
  assert.equal(evaluated, false)
  assert.equal(sockets[0].sent.length, 0)
})

test('activity loss cancels a queued preview and weekly limits keep the socket open', () => {
  const { live, sockets, time } = channel()
  live.start('saved-board')
  sockets[0].open()
  activate(sockets[0])
  live.preview('inner-board', 'gesture-1', 'update', () => scene())
  time.advance(1)
  live.preview('inner-board', 'gesture-1', 'update', () => scene(2))
  assert.equal(live.active, true)
  sockets[0].deliver({ type: 'collaboration', active: false, devices: 1 })
  assert.equal(live.active, false)
  time.advance(PREVIEW_INTERVAL)
  assert.equal(sockets[0].sent.length, 1)

  activate(sockets[0])
  assert.equal(live.active, true)
  sockets[0].deliver({ type: 'collaboration', active: false, devices: 1, reason: 'weekly_limit', resets_at: '2030-01-01T00:00:00.000Z' })
  assert.equal(live.connected, true)
  assert.equal(live.active, false)
  live.stop()
})

test('malformed activity controls do nothing and reconnects start inactive', () => {
  const { live, sockets, time } = channel()
  live.start('saved-board')
  sockets[0].open()
  for (const message of [
    { type: 'collaboration', active: true, devices: 1 },
    { type: 'collaboration', active: true, devices: 2, reason: 'weekly_limit', resets_at: '2030-01-01T00:00:00.000Z' },
    { type: 'collaboration', active: false, devices: 1, extra: true },
    { type: 'collaboration', active: false, devices: 1, resets_at: '2030-01-01T00:00:00.000Z' },
  ]) sockets[0].deliver(message)
  assert.equal(live.active, false)
  assert.equal(parseCollaborationControl({ type: 'collaboration', active: true, devices: 2, extra: true }), null)
  assert.equal(parseCollaborationControl({ type: 'collaboration', active: false, devices: 1, reason: 'weekly_limit', resets_at: 'not-a-date' }), null)
  assert.deepEqual(parseCollaborationControl({ type: 'collaboration', active: false, devices: 1, reason: 'weekly_limit', resets_at: '2030-01-01T00:00:00.000Z' }), {
    type: 'collaboration', active: false, devices: 1, reason: 'weekly_limit', resets_at: '2030-01-01T00:00:00.000Z',
  })

  activate(sockets[0])
  assert.equal(live.active, true)
  sockets[0].deliver({ type: 'collaboration', active: true, devices: 1 })
  assert.equal(live.active, true)
  sockets[0].fail()
  time.advance(RETRY_DELAYS[0])
  sockets[1].open()
  assert.equal(live.connected, true)
  assert.equal(live.active, false)
  assert.equal(live.preview('inner-board', 'gesture-1', 'update', () => scene()), false)
  activate(sockets[1])
  assert.equal(live.preview('inner-board', 'gesture-1', 'update', () => scene()), true)
  live.stop()
})

test('a collaboration socket has an open timeout and bounded reconnect', () => {
  const { live, sockets, time } = channel()
  live.start('saved-board')
  time.advance(OPEN_TIMEOUT)
  assert.equal(sockets[0].closed, true)
  time.advance(RETRY_DELAYS[0])
  assert.equal(sockets.length, 2)
  sockets[1].fail()
  time.advance(RETRY_DELAYS[1] - 1)
  assert.equal(sockets.length, 2)
  time.advance(1)
  assert.equal(sockets.length, 3)
  sockets[2].fail()
  time.advance(RETRY_DELAYS[2])
  assert.equal(sockets.length, 4)
  live.stop()
})

test('a collaboration heartbeat drops an idle socket, while pong keeps it', () => {
  const { live, sockets, time } = channel()
  live.start('saved-board')
  sockets[0].open()
  time.advance(PING_INTERVAL)
  assert.deepEqual(sockets[0].sent, [JSON.stringify({ type: 'ping' })])
  time.advance(PONG_TIMEOUT)
  assert.equal(sockets[0].closed, true)

  time.advance(RETRY_DELAYS[0])
  sockets[1].open()
  time.advance(PING_INTERVAL)
  sockets[1].deliver({ type: 'pong' })
  time.advance(PONG_TIMEOUT)
  assert.equal(sockets[1].closed, false)
  live.stop()
})

test('the room reconnects before its server authorization expires', () => {
  const { live, sockets, time } = channel()
  live.start('saved-board')
  sockets[0].open()
  let elapsed = 0
  while (elapsed + PING_INTERVAL < AUTH_REFRESH_INTERVAL) {
    time.advance(PING_INTERVAL)
    elapsed += PING_INTERVAL
    sockets[0].deliver({ type: 'pong' })
  }
  time.advance(AUTH_REFRESH_INTERVAL - elapsed - 1)
  assert.equal(sockets.length, 1)
  time.advance(1)
  assert.equal(sockets[0].closed, true)
  assert.equal(sockets.length, 2)
  live.stop()
})

test('preview order is scoped to source and gesture and suppresses ended gestures', () => {
  const order = createPreviewOrder(2)
  const frame = (source: string, gesture: string, sequence: number, phase: 'update' | 'end' = 'update') => ({ source, gesture, sequence, phase })
  assert.equal(order.accept(frame('source-a', 'gesture-a', 4)), true)
  assert.equal(order.accept(frame('source-a', 'gesture-a', 3)), false)
  assert.equal(order.accept(frame('source-a', 'gesture-b', 0)), true)
  assert.equal(order.accept(frame('source-b', 'gesture-a', 0)), true)
  assert.equal(order.accept(frame('source-a', 'gesture-b', 1, 'end')), true)
  assert.equal(order.accept(frame('source-a', 'gesture-b', 0)), false)
  assert.ok(order.size <= 4)
  order.clear()
  assert.equal(order.accept(frame('source-a', 'gesture-a', 0)), true)
})

test('disconnected previews are dropped and self/stale wire frames stay out', () => {
  const { live, sockets, received } = channel()
  live.start('saved-board')
  assert.equal(live.preview('inner-board', 'gesture-1', 'update', () => scene()), false)
  sockets[0].open()
  const wire = { type: 'preview', page: 'inner-board', gesture: 'gesture-1', sequence: 1, phase: 'update', scene: scene(), source: 'device-local' }
  sockets[0].deliver(wire)
  sockets[0].deliver({ ...wire, source: 'other-device' })
  assert.equal(received.length, 1)
})

test('sanitizing a received scene makes an isolated copy before rendering', () => {
  const raw = scene(12)
  const safe = sanitizePreviewScene(raw)!
  safe.objects[0].x = 99
  assert.equal(raw.objects[0].x, 12)
  const boardSource = readFileSync(new URL('../src/board.ts', import.meta.url), 'utf8')
  assert.match(boardSource, /renderRemotePreview\(scene: Scene\)/)
  assert.match(boardSource, /clearRemotePreview\(\)/)
  assert.match(boardSource, /private remoteLayer/)
  assert.match(boardSource, /private remoteBackgroundLayer/)
  assert.match(boardSource, /private remoteOverlayLayer/)
  assert.match(boardSource, /drawOverlay\(scene, this\.remoteOverlayLayer, true\)/)
  assert.match(boardSource, /this\.objLayer\.opacity\(0\)/)
  assert.doesNotMatch(boardSource, /this\.noteLayer\.opacity\(0\)/)
  assert.match(boardSource, /onPointerActivity: \(active: boolean\)/)
  assert.match(boardSource, /arrow\.points = src\.points\.map/)
  assert.match(boardSource, /stage\.on\('pointercancel'/)
  assert.match(boardSource, /this\.clearRemotePreview\(\)\n    const prevScale/)
  assert.match(boardSource, /remoteHeight\(scene: Scene\)/)
  assert.match(boardSource, /const visibleHeight = this\.remotePreviewActive \? this\.remoteBoardH : this\.boardH/)
  assert.match(boardSource, /this\.remoteLocalView = heightChanged/)
  assert.match(boardSource, /resetView\(\) \{ this\.clearRemotePreview\(\)/)
  assert.match(boardSource, /zoomBy\(factor: number\) \{\n    this\.clearRemotePreview\(\)/)
  assert.match(boardSource, /remotePitchImages = new Map/)
  assert.match(boardSource, /The collaborator’s own background image is not shared/)
  // A delta replaces only the nodes it names: patching never clears the
  // remote layers, and a full render keeps the id map the patch relies on.
  assert.match(boardSource, /patchRemotePreview\(scene: Scene, objects: readonly SceneObj\[\], removed: readonly string\[\]\): boolean/)
  assert.match(boardSource, /this\.remoteNodes\.set\(object\.id, node\)/)
  const patch = boardSource.slice(boardSource.indexOf('patchRemotePreview(scene: Scene'), boardSource.indexOf('clearRemotePreview() {'))
  assert.doesNotMatch(patch, /destroyChildren|drawRemoteBackground|drawOverlay/)
  assert.match(patch, /node\.zIndex\(index\)/)

  const mainSource = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8')
  assert.match(mainSource, /let localPointerActive = false/)
  assert.match(mainSource, /if \(localPointerActive\) return/)
  // The model takes every accepted frame, even under local control, so a
  // delta that arrives after the pointer lifts still has its base.
  assert.match(mainSource, /const update = remoteModel\.apply\(message\)\n    if \(!update\) return\n    expireRemotePreview\(message\.phase\)\n    if \(localPointerActive\) return\n    remotePainter\.paint\(update\)/)
  assert.match(mainSource, /patch: \(scene, objects, removed\) => board\.patchRemotePreview\(scene, objects, removed\)/)
  assert.match(mainSource, /if \(!visible\) remotePainter\.reset\(\)/)
  assert.match(mainSource, /remotePainter\.reset\(\)\n  board\.clearRemotePreview\(\)/)
  assert.match(mainSource, /phase === 'end' \? 10_000 : 2_000/)
  assert.match(mainSource, /result\.remoteIds\.includes\(saves\.currentBoardId\(\) \?\? ''\)/)
  assert.match(mainSource, /role="status" aria-live="polite" aria-atomic="true"><\/div>/)
  assert.match(mainSource, /if \(saves\.isCurrentReadOnly\(\)\) return/)
})

test('against a relay that never announces deltas, every frame keeps the old six-key whole-scene shape', () => {
  const { live, sockets, time } = channel()
  live.start('saved-board')
  sockets[0].open()
  activate(sockets[0])
  const value = players(10, 20, 30)
  for (let i = 0; i < 5; i += 1) {
    value.objects[0].x += 5
    live.preview('inner-board', 'gesture-1', 'update', () => value)
    time.advance(PREVIEW_INTERVAL)
  }
  live.preview('inner-board', 'gesture-1', 'end', () => value)
  time.advance(PREVIEW_INTERVAL)
  const sent = frames(sockets[0])
  assert.equal(sent.length, 6)
  for (const frame of sent) assert.deepEqual(Object.keys(frame).sort(), FULL_KEYS)
  assert.equal(sent[4].scene.objects[0].x, 35)
  assert.equal(previewCapabilities({ type: 'capabilities' }).delta, false)
  assert.equal(previewCapabilities({ type: 'capabilities', delta: 'yes' }).delta, false)
  assert.equal(previewCapabilities({ type: 'capabilities', delta: true, later: 1 }).delta, true)
  live.stop()
})

test('a gesture sends a whole scene first, then only what changed since the frame actually sent', () => {
  const { live, sockets, time } = channel()
  live.start('saved-board')
  sockets[0].open()
  capable(sockets[0])
  activate(sockets[0])
  const value = players(10, 20, 30)
  live.preview('inner-board', 'gesture-1', 'update', () => value)
  // The editor moves objects in place: the base must be what was serialized.
  value.objects[1].x = 25
  live.preview('inner-board', 'gesture-1', 'update', () => value)
  time.advance(PREVIEW_INTERVAL)
  let sent = frames(sockets[0])
  assert.deepEqual(Object.keys(sent[0]).sort(), FULL_KEYS)
  assert.deepEqual(Object.keys(sent[1]).sort(), DELTA_KEYS)
  assert.equal(sent[1].phase, 'update')
  assert.equal(sent[1].base, sent[0].sequence)
  assert.deepEqual(sent[1].delta, { objects: [{ ...value.objects[1] }], removed: [] })

  // Newest wins: the replaced frame was never sent, so player-0 moving out
  // and back is no change at all against the last frame on the wire.
  value.objects[0].x = 11
  live.preview('inner-board', 'gesture-1', 'update', () => value)
  value.objects[0].x = 10
  value.objects[2].x = 35
  live.preview('inner-board', 'gesture-1', 'update', () => value)
  time.advance(PREVIEW_INTERVAL)
  sent = frames(sockets[0])
  assert.equal(sent.length, 3)
  assert.equal(sent[2].base, sent[1].sequence)
  assert.deepEqual(sent[2].delta.objects.map((object: SceneObj) => [object.id, object.x]), [['player-2', 35]])

  live.preview('inner-board', 'gesture-1', 'end', () => value)
  time.advance(PREVIEW_INTERVAL)
  sent = frames(sockets[0])
  assert.deepEqual(Object.keys(sent[3]).sort(), FULL_KEYS)
  assert.equal(sent[3].phase, 'end')
  assert.deepEqual(sent.map(frame => frame.sequence), [0, 1, 2, 3])

  // A full delta frame is a fraction of the scene it updates.
  const full = new TextEncoder().encode(sockets[0].sent.at(-1)!).byteLength
  const delta = new TextEncoder().encode(sockets[0].sent.at(-2)!).byteLength
  assert.ok(delta < full / 2, `${delta} < ${full} / 2`)
  live.stop()
})

test('a long gesture repeats its whole scene each second, and a room change asks for one at once', () => {
  const { live, sockets, time } = channel()
  live.start('saved-board')
  sockets[0].open()
  capable(sockets[0])
  activate(sockets[0])
  const value = players(10, 20)
  const step = () => {
    value.objects[0].x += 1
    live.preview('inner-board', 'gesture-1', 'update', () => value)
    time.advance(PREVIEW_INTERVAL)
  }
  for (let i = 0; i < 40; i += 1) step()
  let sent = frames(sockets[0])
  const whole = sent.map((frame, i) => frame.scene ? i : -1).filter(i => i >= 0)
  assert.equal(whole[0], 0)
  assert.equal(whole.length, 2)
  assert.ok((whole[1] - whole[0]) * PREVIEW_INTERVAL >= PREVIEW_KEYFRAME_INTERVAL)

  // Someone joined: they have no base for the next delta.
  step()
  assert.ok(frames(sockets[0]).at(-1).delta)
  activate(sockets[0], 3)
  step()
  sent = frames(sockets[0])
  assert.ok(sent.at(-1).scene)
  step()
  assert.ok(frames(sockets[0]).at(-1).delta)

  // A new socket has to be told again before it sends a delta.
  sockets[0].fail()
  time.advance(RETRY_DELAYS[0])
  sockets[1].open()
  activate(sockets[1])
  step()
  step()
  assert.ok(frames(sockets[1]).every(frame => frame.scene && !frame.delta))
  live.stop()
})

test('a delta carries new and removed objects, and anything it cannot rebuild goes whole', () => {
  const { live, sockets, time } = channel()
  live.start('saved-board')
  sockets[0].open()
  capable(sockets[0])
  activate(sockets[0])
  let value = players(10, 20, 30)
  const send = (gesture = 'gesture-1') => {
    live.preview('inner-board', gesture, 'update', () => value)
    time.advance(PREVIEW_INTERVAL)
    return frames(sockets[0]).at(-1)
  }
  send()
  // An object being drawn: a zone goes to the top of its tier, under players.
  insertByTier(value.objects, { id: 'zone-new', type: 'box', shape: 'rect', x: 50, y: 50, w: 10, h: 10, rotation: 0, fill: '#9ca3af', opacity: 0.45, label: '', labelPos: 'top' } as SceneObj)
  let frame = send()
  assert.deepEqual(frame.delta.objects.map((object: SceneObj) => object.id), ['zone-new'])
  value.objects = value.objects.filter(object => object.id !== 'player-0')
  frame = send()
  assert.deepEqual(frame.delta, { objects: [], removed: ['player-0'] })

  // An order the receiver would not rebuild by itself.
  value.objects.reverse()
  assert.ok(send().scene)
  // The board around the objects changed.
  value = { ...value, board: { ...value.board, h: 500 } }
  assert.ok(send().scene)
  // A different gesture has no base on the wire.
  assert.ok(send('gesture-2').scene)
  // A repeated id has no single slot.
  value.objects.push({ ...value.objects[0] })
  assert.ok(send('gesture-2').scene)
  live.stop()
})

test('delta frames parse strictly, and an old client sees no scene in one', () => {
  const header = { type: 'preview', page: 'inner-board', gesture: 'gesture-1', sequence: 4, phase: 'update', base: 3 }
  const moved = { ...players(10).objects[0], x: 40 }
  const ok = wire({ ...header, delta: { objects: [moved], removed: ['ball-one'] } })
  assert.ok(ok && 'delta' in ok)
  assert.equal(ok.delta.objects[0].x, 40)
  assert.deepEqual(ok.delta.removed, ['ball-one'])
  // The import sanitizer runs on every object it carries.
  assert.equal((wire({ ...header, delta: { objects: [{ ...moved, nameSize: 900 }], removed: [] } }) as any).delta.objects[0].nameSize, 96)

  for (const bad of [
    { ...header, phase: 'end', delta: { objects: [], removed: [] } },
    { ...header, base: 4, delta: { objects: [], removed: [] } },
    { ...header, base: -1, delta: { objects: [], removed: [] } },
    { ...header, base: undefined, delta: { objects: [], removed: [] } },
    { ...header, delta: { objects: [], removed: [] }, scene: scene() },
    { ...header, delta: { objects: [] } },
    { ...header, delta: { objects: [], removed: [], extra: 1 } },
    { ...header, delta: { objects: [moved, moved], removed: [] } },
    { ...header, delta: { objects: [moved], removed: [moved.id] } },
    { ...header, delta: { objects: [{ ...moved, id: 'bad id' }], removed: [] } },
    { ...header, delta: { objects: [{ ...moved, type: 'unknown' }], removed: [] } },
    { ...header, delta: { objects: [], removed: ['x'.repeat(101)] } },
    { ...header, delta: { objects: [], removed: Array.from({ length: 2001 }, (_, i) => `gone-${i}`) } },
  ]) assert.equal(parsePreview({ ...bad, source: 'peer-device' }), null, JSON.stringify(bad).slice(0, 120))

  // A client from before deltas parses a frame only through
  // sanitizePreviewScene(raw.scene). A delta has no scene, so it is dropped
  // rather than drawn as a board of only the moved objects.
  const frame = { ...header, delta: { objects: [moved], removed: [] } }
  assert.equal('scene' in frame, false)
  assert.equal(sanitizePreviewScene((frame as Record<string, unknown>).scene), null)
  // The relay's capability message is not a preview or control either.
  assert.equal(parsePreview({ type: 'capabilities', delta: true }), null)
  assert.equal(parseCollaborationControl({ type: 'capabilities', delta: true }), null)
})

test('the received model applies a delta only to the frame it names', () => {
  const model = createPreviewModel()
  const frame = (sequence: number, rest: Record<string, unknown>, gesture = 'gesture-1') =>
    wire({ type: 'preview', page: 'inner-board', gesture, sequence, phase: 'update', ...rest })
  const first = model.apply(frame(0, { scene: players(10, 20) }))!
  assert.equal(first.changes, null)
  const kept = first.scene.objects[0]

  const moved = { ...players(10, 25).objects[1] }
  const update = model.apply(frame(1, { base: 0, delta: { objects: [moved], removed: [] } }))!
  assert.deepEqual(update.scene.objects.map(object => object.x), [10, 25])
  assert.equal(update.scene.objects[0], kept, 'an untouched object is the same object')
  assert.deepEqual([...update.changes!.keys()], ['player-1'])
  assert.equal(update.changes!.get('player-1')!.x, 20)
  assert.equal(first.scene.objects[1].x, 20, 'an earlier update is never mutated')

  // Joined mid-gesture: nothing to build on, so nothing is drawn.
  const late = createPreviewModel()
  assert.equal(late.apply(frame(1, { base: 0, delta: { objects: [moved], removed: [] } })), null)
  // A missed frame drops the model until the next whole scene.
  assert.equal(model.apply(frame(3, { base: 2, delta: { objects: [], removed: [] } })), null)
  assert.equal(model.apply(frame(4, { base: 1, delta: { objects: [], removed: [] } })), null)
  const again = model.apply(frame(5, { scene: players(10, 30) }))!
  assert.equal(again.changes, null)

  // A whole scene that continues the gesture is diffed, so it patches too.
  const continued = model.apply(frame(6, { scene: players(12, 30) }))!
  assert.deepEqual([...continued.changes!.keys()], ['player-0'])
  assert.equal(continued.settle, false)
  const removed = model.apply(frame(7, { base: 6, delta: { objects: [], removed: ['player-0'] } }))!
  assert.deepEqual(removed.scene.objects.map(object => object.id), ['player-1'])
  assert.equal(removed.changes!.get('player-0')!.x, 12)
  const end = model.apply({ ...frame(8, { scene: players(30) }), phase: 'end' } as any)!
  assert.equal(end.settle, true)
  assert.equal(end.changes, null, 'a different object list draws whole')

  // A repeated id is never patched, and gives a later delta no base.
  const twice = players(10)
  twice.objects.push({ ...twice.objects[0] })
  assert.equal(model.apply(frame(0, { scene: twice }, 'gesture-2'))!.changes, null)
  assert.equal(model.apply(frame(1, { base: 0, delta: { objects: [], removed: [] } }, 'gesture-2')), null)
  model.clear()
  assert.equal(model.size, 0)
})

test('only position and size glide; anything else snaps', () => {
  const from = players(0).objects[0]
  assert.equal(interpolatePreviewObject(from, { ...from, x: 100, y: 200 }, 0.25)!.x, 25)
  assert.equal(interpolatePreviewObject(from, { ...from, x: 100, y: 200 }, 0.25)!.y, 125)
  assert.equal(interpolatePreviewObject(from, { ...from, x: 100, color: '#000000' }, 0.5), null)
  assert.equal(interpolatePreviewObject(from, { ...from }, 0.5), null)
  const arrow = {
    id: 'arrow-one', type: 'arrow', x1: 0, y1: 0, mx: 5, my: 0, x2: 10, y2: 0, curved: false, dash: 'solid',
    color: '#111111', width: 4, head: true, points: [{ x: 0, y: 0 }, { x: 10, y: 0, h1: { x: -2, y: 0 } }],
  } as SceneObj
  const shifted = { ...arrow, x1: 10, mx: 15, x2: 20, points: [{ x: 10, y: 0 }, { x: 20, y: 0, h1: { x: -2, y: 0 } }] } as SceneObj
  const half = interpolatePreviewObject(arrow, shifted, 0.5) as any
  assert.equal(half.x2, 15)
  assert.deepEqual(half.points, [{ x: 5, y: 0 }, { x: 15, y: 0, h1: { x: -2, y: 0 } }])
  const bent = { ...shifted, points: [{ x: 10, y: 0 }, { x: 20, y: 0, h1: { x: -5, y: 0 } }] } as SceneObj
  assert.equal(interpolatePreviewObject(arrow, bent, 0.5), null)
})

test('the painter draws a delta as a patch, glides it between frames, and stops when idle', () => {
  let time = 0
  let handles = 1
  const queue = new Map<number, () => void>()
  const tick = (ms = 16) => {
    time += ms
    const due = [...queue.entries()]
    queue.clear()
    for (const [, fn] of due) fn()
  }
  const calls: any[] = []
  let patchable = true
  const painter = createPreviewPainter({
    target: {
      render: (value: Scene) => calls.push({ render: value.objects.map(object => object.x) }),
      patch: (_value: Scene, objects: SceneObj[], removed: string[]) => {
        if (!patchable) return false
        calls.push({ patch: objects.map(object => [object.id, Math.round(object.x)]), removed })
        return true
      },
    },
    frame: (fn) => { const id = handles++; queue.set(id, fn); return id },
    cancel: (id) => { queue.delete(id) },
    now: () => time,
  })
  const model = createPreviewModel()
  let sequence = 0
  const send = (rest: Record<string, unknown>, phase = 'update', gesture = 'gesture-1') => {
    const update = model.apply(wire({ type: 'preview', page: 'inner-board', gesture, sequence: sequence++, phase, ...rest }))
    painter.paint(update!)
  }
  const move = (x: number) => send({ base: sequence - 1, delta: { objects: [{ ...players(0, x).objects[1] }], removed: [] } })

  send({ scene: players(0, 0) })
  tick()
  assert.deepEqual(calls.splice(0), [{ render: [0, 0] }], 'the first frame snaps whole')
  assert.equal(painter.busy, false)

  move(34)
  tick()
  assert.deepEqual(calls.splice(0), [{ patch: [['player-1', 0]], removed: [] }])
  tick()
  tick()
  // Between two received frames the object keeps moving on screen.
  assert.deepEqual(calls.splice(0).map(call => call.patch[0][1]), [16, 32])
  tick()
  assert.deepEqual(calls.splice(0), [{ patch: [['player-1', 34]], removed: [] }])
  assert.equal(painter.busy, false, 'no loop once the glide lands')

  // A frame mid-glide carries on from where the glide has got to by now,
  // rather than jumping back to the last frame or ahead to the new one.
  move(68)
  tick()
  tick()
  move(102)
  tick()
  assert.deepEqual(calls.splice(0).map(call => call.patch[0][1]), [34, 50, 66])

  // Two frames before one paint merge into one patch from what is on screen.
  tick(100)
  calls.length = 0
  move(150)
  move(200)
  tick()
  assert.deepEqual(calls.splice(0), [{ patch: [['player-1', 102]], removed: [] }])

  // An end frame lands exactly.
  send({ scene: players(0, 260) }, 'end')
  tick()
  assert.deepEqual(calls.splice(0), [{ patch: [['player-1', 260]], removed: [] }])
  assert.equal(painter.busy, false)

  // Another gesture draws whole; a board that lost the scene is drawn again.
  send({ scene: players(5, 5) }, 'update', 'gesture-2')
  tick()
  assert.deepEqual(calls.splice(0), [{ render: [5, 5] }])
  patchable = false
  send({ base: sequence - 1, delta: { objects: [{ ...players(0, 9).objects[1] }], removed: [] } }, 'update', 'gesture-2')
  tick()
  assert.deepEqual(calls.splice(0), [{ render: [5, 9] }])
  patchable = true

  // Reset stops a glide at once and the next frame draws whole.
  send({ base: sequence - 1, delta: { objects: [{ ...players(0, 40).objects[1] }], removed: [] } }, 'update', 'gesture-2')
  tick()
  assert.equal(painter.busy, true)
  painter.reset()
  assert.equal(painter.busy, false)
  assert.equal(queue.size, 0)
  calls.length = 0
  send({ base: sequence - 1, delta: { objects: [{ ...players(0, 50).objects[1] }], removed: [] } }, 'update', 'gesture-2')
  tick()
  assert.deepEqual(calls.splice(0), [{ render: [5, 50] }])
})
