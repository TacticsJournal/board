// The live channel, client side. What matters is that it comes back: a channel
// that dies quietly turns real-time sync back into the old wait-and-see, and
// nothing on screen would say so.

import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

import { createLiveChannel, liveUrl, OPEN_TIMEOUT, PING_INTERVAL, PONG_TIMEOUT, RETRY_DELAYS, type Socket } from '../src/live.ts'

class FakeSocket implements Socket {
  readyState = 0
  sent: string[] = []
  closed = false
  onopen: any = null
  onclose: any = null
  onerror: any = null
  onmessage: any = null
  url: string
  constructor(url: string) { this.url = url }
  send(data: string) { this.sent.push(data) }
  close() { this.closed = true }
  open() { this.readyState = 1; this.onopen?.({}) }
  deliver(data: unknown) { this.onmessage?.({ data: typeof data === 'string' ? data : JSON.stringify(data) }) }
  fail() { this.onclose?.({}) }
}

/** A clock the test drives, so backoff and heartbeats are exact, not slept. */
function clock() {
  let now = 0
  let next = 1
  const timers = new Map<number, { at: number; fn: () => void }>()
  return {
    setTimer(fn: () => void, ms: number) { const id = next++; timers.set(id, { at: now + ms, fn }); return id },
    clearTimer(id: number) { timers.delete(id) },
    advance(ms: number) {
      const until = now + ms
      for (;;) {
        const due = [...timers.entries()].filter(([, t]) => t.at <= until).sort((a, b) => a[1].at - b[1].at)[0]
        if (!due) break
        timers.delete(due[0])
        now = due[1].at
        due[1].fn()
      }
      now = until
    },
    get pending() { return timers.size },
  }
}

function channel(options: any = {}) {
  const time = clock()
  const sockets: FakeSocket[] = []
  const changed: number[] = []
  const live = createLiveChannel({
    deviceId: 'd-device-1',
    enabled: options.enabled ?? (() => true),
    onChanged: () => changed.push(1),
    open: (url: string) => { const socket = new FakeSocket(url); sockets.push(socket); return socket },
    setTimer: time.setTimer,
    clearTimer: time.clearTimer,
    jitter: () => 0,
  })
  return { live, sockets, changed, time }
}

test('the socket uses the board host WebSocket route, carrying the device', () => {
  assert.equal(liveUrl('https://preview.tactics-board-mapper.pages.dev'), 'wss://preview.tactics-board-mapper.pages.dev/api/board/live')
  const { live, sockets } = channel()
  live.start()
  assert.match(sockets[0].url, /^wss:\/\/board\.tacticsjournal\.com\/api\/board\/live\?device=d-device-1$/)
})

test('the CSP permits same-origin live WebSocket connections', () => {
  const headers = readFileSync(new URL('../public/_headers', import.meta.url), 'utf8')
  assert.match(headers, /connect-src[^\n]*'self'/)
  assert.match(headers, /connect-src[^\n]*wss:\/\/board\.tacticsjournal\.com/)
})

test('a nudge from the server syncs, and anything else is ignored', () => {
  const { live, sockets, changed } = channel()
  live.start()
  sockets[0].open()
  sockets[0].deliver({ type: 'changed', at: '2026-08-20T00:00:00.000Z' })
  assert.equal(changed.length, 1)
  sockets[0].deliver({ type: 'pong' })
  sockets[0].deliver('not json at all')
  assert.equal(changed.length, 1)
})

test('a device that is not Pro never opens a socket', () => {
  const { live, sockets } = channel({ enabled: () => false })
  live.start()
  assert.equal(sockets.length, 0)
  assert.equal(live.connected, false)
})

test('a dropped socket comes back, backing off as it keeps failing', () => {
  const { live, sockets, time } = channel()
  live.start()
  sockets[0].open()
  sockets[0].fail()
  assert.equal(sockets.length, 1)

  time.advance(RETRY_DELAYS[0])
  assert.equal(sockets.length, 2)
  sockets[1].fail()

  // A reconnect that fails again waits longer, and keeps stepping down the
  // ladder until the connection holds.
  time.advance(RETRY_DELAYS[0])
  assert.equal(sockets.length, 2)
  time.advance(RETRY_DELAYS[1])
  assert.equal(sockets.length, 3)
  sockets[2].fail()
  time.advance(RETRY_DELAYS[2])
  assert.equal(sockets.length, 4)
})

test('a socket stuck CONNECTING is dropped and retried after the open timeout', () => {
  const { live, sockets, time } = channel()
  live.start()
  time.advance(OPEN_TIMEOUT - 1)
  assert.equal(sockets.length, 1)
  assert.equal(sockets[0].closed, false)
  time.advance(1)
  assert.equal(sockets[0].closed, true)
  time.advance(RETRY_DELAYS[0])
  assert.equal(sockets.length, 2)
  sockets[1].open()
  time.advance(OPEN_TIMEOUT + RETRY_DELAYS[0])
  assert.equal(sockets.length, 2)
  live.stop()
})

test('a connection that opens clears the backoff it had reached', () => {
  const { live, sockets, time } = channel()
  live.start()
  sockets[0].fail()
  time.advance(RETRY_DELAYS[0])
  sockets[1].open()
  assert.equal(live.attempts, 0)
  sockets[1].fail()
  time.advance(RETRY_DELAYS[0])
  assert.equal(sockets.length, 3)
})

test('a socket that stops answering is replaced rather than trusted', () => {
  const { live, sockets, time } = channel()
  live.start()
  sockets[0].open()
  time.advance(PING_INTERVAL)
  assert.deepEqual(sockets[0].sent, [JSON.stringify({ type: 'ping' })])
  // No pong: the connection is gone even though no close event arrived.
  time.advance(PONG_TIMEOUT)
  assert.equal(sockets[0].closed, true)
  time.advance(RETRY_DELAYS[0])
  assert.equal(sockets.length, 2)
})

test('a change message does not masquerade as the heartbeat pong', () => {
  const { live, sockets, time } = channel()
  live.start()
  sockets[0].open()
  time.advance(PING_INTERVAL)
  sockets[0].deliver({ type: 'changed' })
  time.advance(PONG_TIMEOUT)
  assert.equal(sockets[0].closed, true)
})

test('an answered ping keeps the same socket', () => {
  const { live, sockets, time } = channel()
  live.start()
  sockets[0].open()
  time.advance(PING_INTERVAL)
  sockets[0].deliver({ type: 'pong' })
  time.advance(PONG_TIMEOUT)
  assert.equal(sockets[0].closed, false)
  assert.equal(sockets.length, 1)
})

test('stopping closes the socket and stops retrying', () => {
  const { live, sockets, time } = channel()
  live.start()
  sockets[0].open()
  live.stop()
  assert.equal(sockets[0].closed, true)
  time.advance(RETRY_DELAYS[4] * 2)
  assert.equal(sockets.length, 1)
  assert.equal(time.pending, 0)
})

test('a poke reconnects now instead of at the end of the backoff', () => {
  const { live, sockets, time } = channel()
  live.start()
  sockets[0].fail()
  time.advance(RETRY_DELAYS[0] + 1)
  sockets[1].fail()
  live.poke()
  assert.equal(sockets.length, 3)
  sockets[2].open()
  // And it does not leave the old backoff timer to fire a second socket.
  time.advance(RETRY_DELAYS[4])
  assert.equal(sockets.length, 3)
})

test('a poke while connected changes nothing', () => {
  const { live, sockets } = channel()
  live.start()
  sockets[0].open()
  live.poke()
  assert.equal(sockets.length, 1)
})

test('a socket that cannot even be constructed is retried', () => {
  const time = clock()
  let attempts = 0
  const live = createLiveChannel({
    deviceId: 'd-device-1',
    enabled: () => true,
    onChanged: () => {},
    open: () => { attempts += 1; throw new Error('blocked') },
    setTimer: time.setTimer,
    clearTimer: time.clearTimer,
    jitter: () => 0,
  })
  live.start()
  assert.equal(attempts, 1)
  time.advance(RETRY_DELAYS[0])
  assert.equal(attempts, 2)
  live.stop()
})
