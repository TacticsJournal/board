import assert from 'node:assert/strict'
import test from 'node:test'

import { onRequest as proxyBoard, upstreamRequest } from '../functions/api/board/[[path]].js'
import { onRequest as wellKnown } from '../functions/.well-known/[[path]].js'
import { onRequest as importPage } from '../functions/import.js'

const boardPreview = `data:image/jpeg;base64,${Buffer.from('board preview').toString('base64')}`

function request(url: string, init: RequestInit = {}) {
  return new Request(url, init)
}

/** Replace global fetch for one test body and capture the upstream request. */
async function withUpstream(response: () => Response, run: (seen: () => Request | null, calls: () => number) => Promise<void>) {
  const original = globalThis.fetch
  let upstream: Request | null = null
  let calls = 0
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls += 1
    upstream = input instanceof Request ? input : new Request(input, init)
    return response()
  }) as typeof fetch
  try { await run(() => upstream, () => calls) } finally { globalThis.fetch = original }
}

const SENSITIVE = {
  Cookie: 'tj_session=board; other=1',
  Authorization: 'Bearer secret',
  'CF-Connecting-IP': '203.0.113.7',
  'X-Forwarded-For': '203.0.113.7',
  'X-Real-IP': '203.0.113.7',
  'True-Client-IP': '203.0.113.7',
  'CF-IPCountry': 'GB',
  'User-Agent': 'Mozilla/5.0 (Reader Browser)',
  Referer: 'https://board.tacticsjournal.com/?secret=1',
  Host: 'attacker.test',
}

test('a short board page publishes its board preview as social metadata', async () => {
  const id = 'b'.repeat(22)
  const html = `<head>
    <link rel="canonical" href="https://board.tacticsjournal.com/">
    <meta property="og:url" content="https://board.tacticsjournal.com/">
    <meta property="og:image" content="generic.jpg">
    <meta property="og:image:secure_url" content="generic.jpg">
    <meta property="og:image:type" content="image/jpeg">
    <meta property="og:image:width" content="2048">
    <meta property="og:image:height" content="1070">
    <meta property="og:image:alt" content="Generic board">
    <meta name="twitter:image" content="generic.jpg">
    <meta name="twitter:image:alt" content="Generic board">
  </head>`
  const response = await importPage({
    request: request(`https://board.tacticsjournal.com/import?board=${id}`),
    next: async () => new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } }),
  })
  const result = await response.text()
  const image = `https://board.tacticsjournal.com/api/board/import-drafts?id=${id}&amp;preview=1`
  assert.ok(result.includes(`property="og:image" content="${image}"`))
  assert.ok(result.includes(`name="twitter:image" content="${image}"`))
  assert.ok(result.includes(`rel="canonical" href="https://board.tacticsjournal.com/import?board=${id}"`))
  assert.equal(response.headers.get('Cache-Control'), 'no-store')
})


test('unknown well-known paths are a plain 404, not the Board app or OAuth metadata', async () => {
  const response = wellKnown({ request: request('https://board.tacticsjournal.com/.well-known/oauth-authorization-server') })
  assert.equal(response.status, 404)
  assert.equal(response.headers.get('Content-Type'), 'text/plain; charset=utf-8')
  assert.doesNotMatch(await response.text(), /OAuth/)
})

test('security.txt publishes the Board contact and policy metadata', async () => {
  const response = wellKnown({ request: request('https://board.tacticsjournal.com/.well-known/security.txt') })
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('Content-Type'), 'text/plain; charset=utf-8')
  assert.equal(response.headers.get('Cache-Control'), 'public, max-age=3600')
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), null)
  assert.equal(await response.text(), [
    'Contact: mailto:kyle@tacticsjournal.com',
    'Canonical: https://board.tacticsjournal.com/.well-known/security.txt',
    'Preferred-Languages: en',
    'Expires: 2027-08-27T23:59:59Z',
    '',
  ].join('\n'))
})


test('board proxy allows only import drafts and events', () => {
  for (const path of ['sync', 'skills', 'assets', 'libraries', 'shares', 'user-search', 'invitations', 'invitation', 'presence',
    'transfer', 'agent-links', 'agent', 'live', 'collaboration', 'history', 'proposals', 'community-posts', 'session', 'nope']) {
    assert.equal(upstreamRequest(request(`https://board.tacticsjournal.com/api/board/${path}`), { path }), null, path)
  }
  const stored = upstreamRequest(request('https://board.tacticsjournal.com/api/board/import-drafts?id=abc'), { path: 'import-drafts' })!
  assert.equal(stored.url, 'https://tacticsjournal.com/api/board/import-drafts?id=abc')
  assert.equal(stored.headers.get('Origin'), 'https://board.tacticsjournal.com')
  const preview = upstreamRequest(request('https://preview.tactics-board-mapper.pages.dev/api/board/import-drafts?id=abc'), { path: 'import-drafts' })!
  assert.equal(preview.url, 'https://tacticsjournal.com/api/board/import-drafts?id=abc')
  assert.equal(preview.headers.get('Origin'), 'https://preview.tactics-board-mapper.pages.dev')
})

test('import drafts never forward cookies or auth headers, but keep the client IP for rate limiting', () => {
  const read = upstreamRequest(request('https://board.tacticsjournal.com/api/board/import-drafts?id=abc', { headers: { ...SENSITIVE, Accept: 'application/json' } }), { path: 'import-drafts' })!
  const write = upstreamRequest(request('https://board.tacticsjournal.com/api/board/import-drafts', {
    method: 'POST', body: '{}',
    headers: { ...SENSITIVE, Origin: 'https://board.tacticsjournal.com', 'Content-Type': 'application/json' },
  }), { path: 'import-drafts' })!
  for (const proxied of [read, write]) {
    assert.equal(proxied.headers.get('Cookie'), null)
    assert.equal(proxied.headers.get('Authorization'), null)
    assert.equal(proxied.headers.get('Host'), null)
    assert.equal(proxied.headers.get('Referer'), null)
    assert.equal(proxied.headers.get('X-Forwarded-For'), null)
    assert.equal(proxied.headers.get('True-Client-IP'), null)
    assert.equal(proxied.headers.get('CF-Connecting-IP'), '203.0.113.7')
    assert.equal(proxied.headers.get('User-Agent'), 'TacticsBoardAgent/1.0')
  }
  assert.equal(read.headers.get('Accept'), 'application/json')
  assert.equal(write.headers.get('Content-Type'), 'application/json')
})

test('board proxy validates bounded same-origin board links before storing them', async () => {
  await withUpstream(() => Response.json({ id: 'b'.repeat(22) }, { status: 201 }), async (seen) => {
    const response = await proxyBoard({
      request: request('https://board.tacticsjournal.com/api/board/import-drafts', {
        method: 'POST',
        headers: { Origin: 'https://board.tacticsjournal.com', 'Content-Type': 'application/json', Cookie: 'tj_session=x' },
        body: JSON.stringify({ payload: 'H4sIA_board_payload', preview: boardPreview }),
      }),
      params: { path: 'import-drafts' },
    })
    assert.equal(response.status, 201)
    assert.equal(seen()!.url, 'https://tacticsjournal.com/api/board/import-drafts')
    assert.equal(seen()!.headers.get('Cookie'), null)
    assert.deepEqual(await seen()!.json(), { payload: 'H4sIA_board_payload', preview: boardPreview })
  })
})

test('large whole-project links need no scope header and keep their cap; boards with previews keep theirs', async () => {
  await withUpstream(() => Response.json({ id: 'p'.repeat(22) }, { status: 201 }), async (seen, calls) => {
    const post = (body: unknown, headers: Record<string, string> = {}) => proxyBoard({
      request: request('https://board.tacticsjournal.com/api/board/import-drafts', {
        method: 'POST',
        headers: { Origin: 'https://board.tacticsjournal.com', 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(body),
      }),
      params: { path: 'import-drafts' },
    })
    const payload = 'a'.repeat(350_000)
    assert.equal((await post({ payload })).status, 201)
    assert.equal(seen()!.headers.get('X-Tactics-Board-Link-Scope'), null)
    assert.deepEqual(await seen()!.json(), { payload })

    const before = calls()
    assert.equal((await post({ payload }, { 'X-Tactics-Board-Link-Scope': 'project-copy' })).status, 201)
    assert.equal(seen()!.headers.get('X-Tactics-Board-Link-Scope'), null)
    assert.equal(calls(), before + 1)

    assert.equal((await post({ payload: 'a'.repeat(350_001) })).status, 400)
    assert.equal((await post({ payload: 'a'.repeat(4001), preview: boardPreview })).status, 400)
    assert.equal((await post({ payload: 'a', preview: boardPreview, extra: 1 })).status, 400)
    assert.equal(calls(), before + 1)
  })
})

test('board proxy rejects foreign and malformed browser link writes', async () => {
  const foreign = await proxyBoard({
    request: request('https://board.tacticsjournal.com/api/board/import-drafts', {
      method: 'POST', headers: { Origin: 'https://attacker.test', 'Content-Type': 'application/json' }, body: JSON.stringify({ payload: 'H4sIA_board_payload', preview: boardPreview }),
    }),
    params: { path: 'import-drafts' }, env: {},
  })
  assert.equal(foreign.status, 403)

  const malformed = await proxyBoard({
    request: request('https://board.tacticsjournal.com/api/board/import-drafts', {
      method: 'POST', headers: { Origin: 'https://board.tacticsjournal.com', 'Content-Type': 'application/json' }, body: JSON.stringify({ payload: 'not.valid', preview: boardPreview }),
    }),
    params: { path: 'import-drafts' }, env: {},
  })
  assert.equal(malformed.status, 400)
})


test('board proxy rejects originless and foreign writes, and unsupported methods, before proxying', async () => {
  await withUpstream(() => Response.json({ ok: true }), async (_seen, calls) => {
    const originless = await proxyBoard({
      request: request('https://board.tacticsjournal.com/api/board/import-drafts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"payload":"a"}' }),
      params: { path: 'import-drafts' },
    })
    assert.equal(originless.status, 403)
    const foreignEvent = await proxyBoard({
      request: request('https://board.tacticsjournal.com/api/board/events', {
        method: 'POST', headers: { Origin: 'https://attacker.test', 'Content-Type': 'application/json' }, body: '{}',
      }),
      params: { path: 'events' },
    })
    // Board sends no usage counters, so the events path is gone.
    assert.equal(foreignEvent.status, 404)
    const eventRead = await proxyBoard({ request: request('https://board.tacticsjournal.com/api/board/events'), params: { path: 'events' } })
    assert.equal(eventRead.status, 404)
    const removed = await proxyBoard({
      request: request('https://board.tacticsjournal.com/api/board/sync', { method: 'PUT', headers: { Origin: 'https://board.tacticsjournal.com' }, body: '{}' }),
      params: { path: 'sync' },
    })
    assert.equal(removed.status, 404)
    assert.equal(calls(), 0)
  })
})

test('board proxy strips upstream cookies and refuses redirects and upgrades', async () => {
  await withUpstream(() => new Response('{}', { headers: { 'Set-Cookie': 'tj_session=must-not-cross; Path=/' } }), async () => {
    const response = await proxyBoard({ request: request('https://board.tacticsjournal.com/api/board/import-drafts?id=abc'), params: { path: 'import-drafts' } })
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('Set-Cookie'), null)
  })
  await withUpstream(() => new Response(null, { status: 302, headers: { Location: 'https://tacticsjournal.com/' } }), async () => {
    const response = await proxyBoard({ request: request('https://board.tacticsjournal.com/api/board/import-drafts?id=abc'), params: { path: 'import-drafts' } })
    assert.equal(response.status, 502)
  })
  await withUpstream(() => ({ status: 101, headers: new Headers({ 'Set-Cookie': 'tj_session=attacker' }) }) as unknown as Response, async () => {
    const response = await proxyBoard({ request: request('https://board.tacticsjournal.com/api/board/import-drafts?id=abc', { headers: { Upgrade: 'websocket' } }), params: { path: 'import-drafts' } })
    assert.equal(response.status, 502)
    assert.equal(response.headers.get('Set-Cookie'), null)
  })
})
