import assert from 'node:assert/strict'
import test from 'node:test'

import { upstreamRequest } from '../functions/api/board/[[path]].js'

const BOARD = 'https://board.tacticsjournal.com'

test('the Board proxy forwards aggregate events only from its own browser origin', async () => {
  const request = new Request(`${BOARD}/api/board/events`, {
    method: 'POST',
    headers: { Origin: BOARD, 'Content-Type': 'application/json' },
    body: JSON.stringify({ event: 'editor_opened', detail: '', plan: 'free' }),
  })
  const upstream = upstreamRequest(request, { path: 'events' })
  assert.ok(upstream)
  assert.equal(new URL(upstream.url).pathname, '/api/board/events')
  assert.equal(upstream.method, 'POST')

  const foreign = new Request(`${BOARD}/api/board/events`, {
    method: 'POST',
    headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json' },
    body: '{}',
  })
  assert.equal(upstreamRequest(foreign, { path: 'events' }), null)
})
