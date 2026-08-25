import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

import {
  AUTH_REFRESH_INTERVAL,
  OPEN_TIMEOUT,
  PING_INTERVAL,
  PONG_TIMEOUT,
  PREVIEW_INTERVAL,
  RETRY_DELAYS,
  collaborationUrl,
  createCollaborationChannel,
  createPreviewOrder,
  isPreviewScene,
  parsePreview,
  parseCollaborationControl,
  sanitizePreviewScene,
  type CollaborationSocket,
} from '../src/collaboration.ts'
import { emptyScene } from '../src/types.ts'

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

function activate(socket: FakeSocket, devices = 2) {
  socket.deliver({ type: 'collaboration', active: true, devices })
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

  const mainSource = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8')
  assert.match(mainSource, /let localPointerActive = false/)
  assert.match(mainSource, /if \(localPointerActive\) return/)
  assert.match(mainSource, /phase === 'end' \? 10_000 : 2_000/)
  assert.match(mainSource, /result\.remoteIds\.includes\(saves\.currentBoardId\(\) \?\? ''\)/)
  assert.match(mainSource, /role="status" aria-live="polite" aria-atomic="true"><\/div>/)
  assert.match(mainSource, /if \(saves\.isCurrentReadOnly\(\)\) return/)
})
