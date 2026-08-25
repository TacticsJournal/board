import { boardLiveUrl } from './board-api.ts'

/**
 * The live half of board sync.
 *
 * Sync itself still goes through the sync endpoint; this only removes the
 * waiting. A device holds one socket open, and when another device pushes, the
 * server sends "changed" and this device syncs at once instead of at the next
 * time the tab is brought forward.
 *
 * The channel is a nudge and nothing more. It carries no board data, so a
 * dropped message costs a moment rather than an edit: the fallback sync on
 * visibility still converges. That is what lets the reconnect be lazy and the
 * failure handling be quiet.
 *
 * Nothing here touches the DOM or localStorage, so the reconnect and heartbeat
 * paths can be tested without a browser.
 */

const PING = JSON.stringify({ type: 'ping' })

/** Backoff between reconnects: quick at first, then out of the way. */
export const RETRY_DELAYS = [1_000, 2_000, 5_000, 10_000, 30_000]

/** Far enough inside Cloudflare's idle timeout to keep the socket from dying. */
export const PING_INTERVAL = 45_000

/** A pong is answered by the runtime while the object sleeps, so it is fast. */
export const PONG_TIMEOUT = 10_000

/** Browsers can leave a WebSocket CONNECTING forever without reporting failure. */
export const OPEN_TIMEOUT = 10_000

export type Socket = {
  readyState: number
  send(data: string): void
  close(): void
  onopen: ((event: unknown) => void) | null
  onclose: ((event: unknown) => void) | null
  onerror: ((event: unknown) => void) | null
  onmessage: ((event: { data: unknown }) => void) | null
}

export type LiveOptions = {
  /** The device's own id, so the server can skip echoing its own push back. */
  deviceId: string
  /** Something changed elsewhere: sync now. */
  onChanged: () => void
  /** False when the member is not Pro, or is signed out. Checked every attempt. */
  enabled: () => boolean
  open?: (url: string) => Socket
  setTimer?: (fn: () => void, ms: number) => number
  clearTimer?: (handle: number) => void
  /** Injectable for tests; the delays are otherwise identical every run. */
  jitter?: () => number
}

export type LiveChannel = {
  /** Connect, or do nothing if already connected or not entitled. */
  start(): void
  /** Close and stop retrying. Called when Pro goes away or the tab does. */
  stop(): void
  /** Reconnect now rather than on the next backoff step. */
  poke(): void
  /** True only once the server has accepted the socket. */
  readonly connected: boolean
  readonly attempts: number
}

export function liveUrl(origin: string = typeof location === 'undefined' ? 'https://board.tacticsjournal.com' : location.origin): string {
  return new URL(boardLiveUrl(), origin).href.replace(/^http/, 'ws')
}

export function createLiveChannel(options: LiveOptions): LiveChannel {
  const openSocket = options.open ?? ((url: string) => new WebSocket(url) as unknown as Socket)
  const setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms) as unknown as number)
  const clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle))
  const jitter = options.jitter ?? Math.random

  let socket: Socket | null = null
  let retryTimer: number | null = null
  let openTimer: number | null = null
  let pingTimer: number | null = null
  let pongTimer: number | null = null
  let attempts = 0
  let stopped = true
  let opened = false

  function clear(handle: number | null): null {
    if (handle !== null) clearTimer(handle)
    return null
  }

  function teardown(): void {
    openTimer = clear(openTimer)
    pingTimer = clear(pingTimer)
    pongTimer = clear(pongTimer)
    if (socket) {
      socket.onopen = socket.onclose = socket.onerror = socket.onmessage = null
      try { socket.close() } catch { /* already gone */ }
    }
    socket = null
    opened = false
  }

  function scheduleRetry(): void {
    if (stopped || retryTimer !== null) return
    const step = RETRY_DELAYS[Math.min(attempts, RETRY_DELAYS.length - 1)]
    attempts += 1
    // Spread reconnects out, so a server restart is not met by every device at
    // the same instant.
    const delay = step + Math.floor(jitter() * step * 0.5)
    retryTimer = setTimer(() => { retryTimer = null; connect() }, delay)
  }

  function heartbeat(): void {
    pingTimer = setTimer(() => {
      if (!socket) return
      try { socket.send(PING) } catch { drop(); return }
      // A socket that has gone away without a close event answers nothing.
      pongTimer = setTimer(drop, PONG_TIMEOUT)
      heartbeat()
    }, PING_INTERVAL)
  }

  function drop(): void {
    teardown()
    scheduleRetry()
  }

  function connect(): void {
    if (stopped || socket || !options.enabled()) return
    let candidate: Socket
    try {
      candidate = openSocket(`${liveUrl()}?device=${encodeURIComponent(options.deviceId)}`)
    } catch {
      scheduleRetry()
      return
    }
    socket = candidate

    candidate.onopen = () => {
      if (socket !== candidate) return
      openTimer = clear(openTimer)
      attempts = 0
      opened = true
      heartbeat()
    }
    candidate.onmessage = (event) => {
      if (socket !== candidate) return
      let message: { type?: string } = {}
      try { message = JSON.parse(String(event.data)) } catch { return }
      if (message.type === 'pong') pongTimer = clear(pongTimer)
      if (message.type === 'changed') options.onChanged()
    }
    candidate.onerror = () => { if (socket === candidate) drop() }
    candidate.onclose = () => { if (socket === candidate) drop() }
    openTimer = setTimer(() => {
      if (socket === candidate && !opened) drop()
    }, OPEN_TIMEOUT)
  }

  return {
    start() {
      stopped = false
      if (socket) return
      retryTimer = clear(retryTimer)
      connect()
    },
    stop() {
      stopped = true
      retryTimer = clear(retryTimer)
      attempts = 0
      teardown()
    },
    poke() {
      if (stopped || socket) return
      retryTimer = clear(retryTimer)
      attempts = 0
      connect()
    },
    get connected() { return opened },
    get attempts() { return attempts },
  }
}
