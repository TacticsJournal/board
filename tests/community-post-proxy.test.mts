import assert from 'node:assert/strict'
import test, { mock } from 'node:test'

import { onRequest, upstreamRequest } from '../functions/api/board/[[path]].js'

const BOARD = 'https://board.tacticsjournal.com'
const SITE_ENDPOINT = 'https://tacticsjournal.com/api/board/community-posts'
const body = {
  payload: 'H4sIA_board_payload_123',
  preview: 'data:image/jpeg;base64,/9j/2Q==',
  caption: '',
}

function request(value: unknown = body, origin = BOARD) {
  return new Request(`${BOARD}/api/board/community-posts`, {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json', Cookie: 'tj_session=session-member' },
    body: JSON.stringify(value),
  })
}

test('the fixed Board proxy sends Community publications only to Tactics Journal', async () => {
  const proxied = upstreamRequest(request(), { path: 'community-posts' })
  assert.ok(proxied)
  assert.equal(proxied.url, SITE_ENDPOINT)
  assert.equal(proxied.method, 'POST')
  assert.equal(proxied.headers.get('Origin'), BOARD)
  assert.equal(proxied.headers.get('Cookie'), 'tj_session=session-member')
  assert.equal(upstreamRequest(request(), { path: 'community-posts/elsewhere' }), null)
})

test('the proxy validates the exact bounded body before forwarding it', async (t) => {
  let calls = 0
  mock.method(globalThis, 'fetch', async (upstream: Request) => {
    calls += 1
    assert.equal(upstream.url, SITE_ENDPOINT)
    assert.deepEqual(await upstream.json(), body)
    return Response.json({
      post_id: 'a'.repeat(32),
      community_url: 'https://tacticsjournal.com/community/?post=' + 'a'.repeat(32),
      board_url: 'https://board.tacticsjournal.com/import?community=' + 'b'.repeat(22),
      moderation_pending: false,
      message: 'Posted to Community.',
    }, { status: 201 })
  })
  t.after(() => mock.restoreAll())

  const response = await onRequest({ request: request(), params: { path: 'community-posts' } })
  assert.equal(response.status, 201)
  assert.equal(calls, 1)

  for (const invalid of [
    { ...body, extra: true },
    { ...body, caption: 'x'.repeat(5001) },
    { ...body, payload: 'not allowed!' },
    { ...body, preview: 'data:image/png;base64,AAAA' },
  ]) {
    const denied = await onRequest({ request: request(invalid), params: { path: 'community-posts' } })
    assert.equal(denied.status, 400)
  }
  assert.equal(calls, 1)
})

test('a foreign origin is rejected before an upstream request exists', async () => {
  let called = false
  mock.method(globalThis, 'fetch', async () => { called = true; return new Response() })
  try {
    const response = await onRequest({ request: request(body, 'https://attacker.example'), params: { path: 'community-posts' } })
    assert.equal(response.status, 403)
    assert.equal(called, false)
  } finally {
    mock.restoreAll()
  }
})

test('the proxy forwards an update of an existing board post and nothing looser', async () => {
  const { onRequest } = await import('../functions/api/board/[[path]].js')
  const id = 'c'.repeat(22)
  const send = (body: unknown) => new Request('https://board.tacticsjournal.com/api/board/community-posts', {
    method: 'POST',
    headers: { Origin: 'https://board.tacticsjournal.com', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const good = { id, payload: 'AAAA', preview: 'data:image/jpeg;base64,/9j/2Q==', caption: 'Updated.' }

  let forwarded: Request | null = null
  const original = globalThis.fetch
  globalThis.fetch = (async (request: Request) => {
    forwarded = request
    return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } })
  }) as typeof fetch
  try {
    const response = await onRequest({ request: send(good), params: { path: ['community-posts'] } } as never)
    assert.equal(response.status, 200)
    assert.equal(new URL(forwarded!.url).origin, 'https://tacticsjournal.com')

    // An id that is not a board copy id, and an extra key, are both refused
    // before any upstream request exists.
    forwarded = null
    assert.equal((await onRequest({
      request: send({ ...good, id: 'short' }), params: { path: ['community-posts'] },
    } as never)).status, 400)
    assert.equal((await onRequest({
      request: send({ ...good, extra: 1 }), params: { path: ['community-posts'] },
    } as never)).status, 400)
    assert.equal(forwarded, null)
  } finally {
    globalThis.fetch = original
  }
})
