import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { onRequest as proxyBoard, upstreamRequest } from '../functions/api/board/[[path]].js'
import { onRequestDelete as clearSession, onRequestGet as getSession, onRequestPost as consumeSession } from '../functions/api/board/session.js'
import { ensureBoardSession, resetBoardSession } from '../src/board-api.ts'
import { onRequestPost as mcpPost } from '../functions/mcp.js'
import { accountOrigin } from '../functions/lib/board-origin.js'
import { onRequest as rejectOAuthDiscovery } from '../functions/.well-known/[[path]].js'
import { onRequest as importPage } from '../functions/import.js'
import { decodeAgentImport } from '../src/agent-import.ts'

const capability = 'a'.repeat(22) + '.' + 'b'.repeat(43)
const boardPreview = `data:image/jpeg;base64,${Buffer.from('board preview').toString('base64')}`

function request(url: string, init: RequestInit = {}) {
  return new Request(url, init)
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

test('OAuth discovery fails as JSON instead of falling through to the Board app', async () => {
  const response = rejectOAuthDiscovery()
  assert.equal(response.status, 404)
  assert.equal(response.headers.get('Content-Type'), 'application/json; charset=utf-8')
  assert.match(await response.text(), /OAuth is not configured/)
})

test('board proxy has a fixed allowlist and preserves board request shape', async () => {
  const input = request('https://preview.tactics-board-mapper.pages.dev/api/board/agent?x=1', {
    method: 'PUT', body: '{"document":{}}',
    headers: { Cookie: 'tj_session=board', Authorization: 'Bearer capability', Origin: 'https://preview.tactics-board-mapper.pages.dev', Host: 'attacker.test' },
  })
  const proxied = upstreamRequest(input, { path: 'agent' })!
  assert.equal(proxied.url, 'https://billing-sandbox.tacticsjournal.pages.dev/api/board/agent?x=1')
  assert.equal(proxied.method, 'PUT')
  assert.equal(proxied.headers.get('Cookie'), 'tj_session=board')
  assert.equal(proxied.headers.get('Authorization'), 'Bearer capability')
  assert.equal(proxied.headers.get('Origin'), 'https://preview.tactics-board-mapper.pages.dev')
  assert.equal(proxied.headers.get('Host'), null)
  assert.equal(proxied.headers.get('User-Agent'), 'TacticsBoardAgent/1.0')
  assert.equal(await proxied.text(), '{"document":{}}')
  assert.equal(upstreamRequest(request('https://board.tacticsjournal.com/api/board/nope'), { path: 'nope' }), null)
  const originless = upstreamRequest(request('https://board.tacticsjournal.com/api/board/agent-links'), { path: 'agent-links' })!
  assert.equal(originless.headers.get('Origin'), 'https://board.tacticsjournal.com')
  const originlessWrite = upstreamRequest(request('https://board.tacticsjournal.com/api/board/sync', { method: 'PUT', body: '{}' }), { path: 'sync' })
  assert.equal(originlessWrite, null)
  const storedDraft = upstreamRequest(request('https://board.tacticsjournal.com/api/board/import-drafts?id=abc'), { path: 'import-drafts' })!
  assert.equal(storedDraft.url, 'https://tacticsjournal.com/api/board/import-drafts?id=abc')
  const assets = upstreamRequest(request('https://board.tacticsjournal.com/api/board/assets?id=asset-1'), { path: 'assets' })!
  assert.equal(assets.url, 'https://tacticsjournal.com/api/board/assets?id=asset-1')
  const libraries = upstreamRequest(request('https://board.tacticsjournal.com/api/board/libraries?id=bg%3Amy-pitch'), { path: 'libraries' })!
  assert.equal(libraries.url, 'https://tacticsjournal.com/api/board/libraries?id=bg%3Amy-pitch')
  const users = upstreamRequest(request('https://board.tacticsjournal.com/api/board/user-search?q=%40coach'), { path: 'user-search' })!
  assert.equal(users.url, 'https://tacticsjournal.com/api/community/user-search?q=%40coach')
})

test('board proxy validates bounded same-origin browser links before storing them', async () => {
  const original = globalThis.fetch
  let upstream: Request | null = null
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    upstream = input instanceof Request ? input : new Request(input, init)
    return Response.json({ id: 'b'.repeat(22), expires_at: '2026-08-30T00:00:00.000Z' }, { status: 201 })
  }) as typeof fetch
  try {
    const response = await proxyBoard({
      request: request('https://board.tacticsjournal.com/api/board/import-drafts', {
        method: 'POST',
        headers: { Origin: 'https://board.tacticsjournal.com', 'Content-Type': 'application/json' },
        body: JSON.stringify({ payload: 'H4sIA_board_payload', preview: boardPreview }),
      }),
      params: { path: 'import-drafts' },
      env: {},
    })
    assert.equal(response.status, 201)
    assert.equal(upstream!.url, 'https://tacticsjournal.com/api/board/import-drafts')
    assert.equal(upstream!.headers.get('Origin'), 'https://board.tacticsjournal.com')
    assert.equal(upstream!.headers.get('User-Agent'), 'TacticsBoardAgent/1.0')
    assert.equal(upstream!.headers.get('X-Tactics-Board-Timestamp'), null)
    assert.equal(upstream!.headers.get('X-Tactics-Board-Signature'), null)
    assert.deepEqual(await upstream!.json(), { payload: 'H4sIA_board_payload', preview: boardPreview })
  } finally { globalThis.fetch = original }
})

test('board proxy accepts a large project payload without a preview and keeps the cap', async () => {
  const original = globalThis.fetch
  let upstream: Request | null = null
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    upstream = input instanceof Request ? input : new Request(input, init)
    return Response.json({ id: 'p'.repeat(22) }, { status: 201 })
  }) as typeof fetch
  try {
    const payload = 'a'.repeat(350_000)
    const response = await proxyBoard({
      request: request('https://board.tacticsjournal.com/api/board/import-drafts', {
        method: 'POST',
        headers: {
          Origin: 'https://board.tacticsjournal.com',
          'Content-Type': 'application/json',
          'X-Tactics-Board-Link-Scope': 'project-copy',
        },
        body: JSON.stringify({ payload }),
      }),
      params: { path: 'import-drafts' },
      env: {},
    })
    assert.equal(response.status, 201)
    assert.equal(upstream!.headers.get('X-Tactics-Board-Link-Scope'), 'project-copy')
    assert.deepEqual(await upstream!.json(), { payload })

    const missingScope = await proxyBoard({
      request: request('https://board.tacticsjournal.com/api/board/import-drafts', {
        method: 'POST',
        headers: { Origin: 'https://board.tacticsjournal.com', 'Content-Type': 'application/json' },
        body: JSON.stringify({ payload: 'a'.repeat(4001) }),
      }),
      params: { path: 'import-drafts' },
      env: {},
    })
    assert.equal(missingScope.status, 400)

    const tooLarge = await proxyBoard({
      request: request('https://board.tacticsjournal.com/api/board/import-drafts', {
        method: 'POST',
        headers: {
          Origin: 'https://board.tacticsjournal.com',
          'Content-Type': 'application/json',
          'X-Tactics-Board-Link-Scope': 'project-copy',
        },
        body: JSON.stringify({ payload: 'a'.repeat(350_001) }),
      }),
      params: { path: 'import-drafts' },
      env: {},
    })
    assert.equal(tooLarge.status, 400)
  } finally { globalThis.fetch = original }
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

test('board proxy rejects originless and foreign browser writes before proxying', async () => {
  const original = globalThis.fetch
  let calls = 0
  globalThis.fetch = (async () => {
    calls += 1
    return Response.json({ ok: true })
  }) as typeof fetch
  try {
    const originless = await proxyBoard({
      request: request('https://board.tacticsjournal.com/api/board/sync', { method: 'PUT', body: '{}' }),
      params: { path: 'sync' }, env: {},
    })
    assert.equal(originless.status, 403)

    const foreign = await proxyBoard({
      request: request('https://board.tacticsjournal.com/api/board/sync', {
        method: 'PUT', headers: { Origin: 'https://attacker.test' }, body: '{}',
      }),
      params: { path: 'sync' }, env: {},
    })
    assert.equal(foreign.status, 403)
    assert.equal(calls, 0)
  } finally { globalThis.fetch = original }
})

test('capability-authenticated agent writes do not need a browser Origin', async () => {
  const original = globalThis.fetch
  let upstream: Request | null = null
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    upstream = input instanceof Request ? input : new Request(input, init)
    return Response.json({ ok: true })
  }) as typeof fetch
  try {
    const response = await proxyBoard({
      request: request('https://board.tacticsjournal.com/api/board/agent', {
        method: 'PUT',
        headers: { Authorization: `Bearer ${capability}`, 'Content-Type': 'application/json' },
        body: '{}',
      }),
      params: { path: 'agent' }, env: {},
    })
    assert.equal(response.status, 200)
    assert.equal(upstream!.headers.get('Origin'), null)
    assert.equal(upstream!.headers.get('Authorization'), `Bearer ${capability}`)
  } finally { globalThis.fetch = original }
})

test('board proxy selects production for stable hosts and strips upstream cookies', async () => {
  assert.equal(accountOrigin(request('https://tactics-board-mapper.pages.dev/api/board/sync')), 'https://tacticsjournal.com')
  const original = globalThis.fetch
  globalThis.fetch = (async () => new Response('{}', {
    headers: { 'Set-Cookie': 'tj_session=must-not-cross; Path=/' },
  })) as typeof fetch
  try {
    const response = await proxyBoard({
      request: request('https://board.tacticsjournal.com/api/board/sync'),
      params: { path: 'sync' },
    })
    assert.equal(response.headers.get('Set-Cookie'), null)
  } finally { globalThis.fetch = original }
})

test('board proxy retains Upgrade headers for the live WebSocket route', () => {
  const proxied = upstreamRequest(request('https://board.tacticsjournal.com/api/board/live?device=d1', {
    headers: { Upgrade: 'websocket', Connection: 'Upgrade' },
  }), { path: 'live' })!
  assert.equal(proxied.url, 'https://tacticsjournal.com/api/board/live?device=d1')
  assert.equal(proxied.headers.get('Upgrade'), 'websocket')
})

test('board proxy rejects a WebSocket handshake that tries to set a cookie', async () => {
  const original = globalThis.fetch
  globalThis.fetch = (async () => ({
    status: 101,
    headers: new Headers({ 'Set-Cookie': 'tj_session=attacker; Domain=.tacticsjournal.com' }),
  })) as typeof fetch
  try {
    const response = await proxyBoard({
      request: request('https://board.tacticsjournal.com/api/board/live?device=d1', {
        headers: { Upgrade: 'websocket', Connection: 'Upgrade' },
      }),
      params: { path: 'live' },
    })
    assert.equal(response.status, 502)
    assert.equal(response.headers.get('Set-Cookie'), null)
  } finally { globalThis.fetch = original }
})

test('session GET forwards board cookie with its exact board origin', async () => {
  const original = globalThis.fetch
  let upstream: Request | null = null
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    upstream = input instanceof Request ? input : new Request(input, init)
    return new Response(JSON.stringify({ authenticated: true, account_binding: 'a'.repeat(64) }))
  }) as typeof fetch
  try {
    const response = await getSession({ request: request('https://board.tacticsjournal.com/api/board/session', { headers: { Cookie: 'tj_session=board', Origin: 'https://board.tacticsjournal.com' } }) })
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { authenticated: true, account_binding: 'a'.repeat(64) })
    assert.equal(upstream!.url, 'https://tacticsjournal.com/api/account/session')
    assert.equal(upstream!.headers.get('Cookie'), 'tj_session=board')
    assert.equal(upstream!.headers.get('Origin'), 'https://board.tacticsjournal.com')
  } finally { globalThis.fetch = original }
})

test('session GET omits malformed upstream account bindings', async () => {
  const original = globalThis.fetch
  globalThis.fetch = (async () => Response.json({ authenticated: true, account_binding: 'not-a-binding' })) as typeof fetch
  try {
    const response = await getSession({ request: request('https://board.tacticsjournal.com/api/board/session') })
    assert.deepEqual(await response.json(), { authenticated: true })
  } finally { globalThis.fetch = original }
})

test('session consume bounds input and forwards only the board session cookie', async () => {
  const original = globalThis.fetch
  const calls: Request[] = []
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push(input instanceof Request ? input : new Request(input, init))
    return new Response(JSON.stringify({ ignored: 'value' }), { status: 200, headers: { 'Set-Cookie': 'tj_session=opaque; HttpOnly; Secure; SameSite=Lax' } })
  }) as typeof fetch
  try {
    const response = await consumeSession({ request: request('https://board.tacticsjournal.com/api/board/session', {
      method: 'POST', headers: { Origin: 'https://board.tacticsjournal.com', 'Content-Type': 'application/json' }, body: JSON.stringify({ token: 'a'.repeat(64) }),
    }) })
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('Set-Cookie'), 'tj_session=opaque; Path=/; HttpOnly; Secure; SameSite=Lax')
    assert.deepEqual(await response.json(), { authenticated: true })
    assert.equal(calls[0].url, 'https://tacticsjournal.com/api/account/board-session')
    assert.deepEqual(await calls[0].json(), { action: 'consume', token: 'a'.repeat(64), audience: 'https://board.tacticsjournal.com' })
    const invalid = await consumeSession({ request: request('https://board.tacticsjournal.com/api/board/session', { method: 'POST', headers: { Origin: 'https://board.tacticsjournal.com' }, body: JSON.stringify({ token: 'x', extra: true }) }) })
    assert.equal(invalid.status, 400)
    assert.equal(calls.length, 1)
  } finally { globalThis.fetch = original }
})

test('session consume canonicalizes valid tokens and ignores combined cookie attributes', async () => {
  const original = globalThis.fetch
  globalThis.fetch = (async () => new Response('{}', {
    headers: {
      'Set-Cookie': 'other=ignored; Path=/, tj_session=combined-token; Domain=.tacticsjournal.com; Path=/; SameSite=None, injected=bad',
    },
  })) as typeof fetch
  try {
    const response = await consumeSession({ request: request('https://board.tacticsjournal.com/api/board/session', {
      method: 'POST',
      headers: { Origin: 'https://board.tacticsjournal.com', 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'a'.repeat(64) }),
    }) })
    assert.equal(response.headers.get('Set-Cookie'), 'tj_session=combined-token; Path=/; HttpOnly; Secure; SameSite=Lax')
  } finally { globalThis.fetch = original }
})

test('session deletion signs out upstream with POST and forwards the cleared board cookie', async () => {
  const original = globalThis.fetch
  let upstream: Request | null = null
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    upstream = input instanceof Request ? input : new Request(input, init)
    return new Response(JSON.stringify({ ok: true }), {
      headers: { 'Set-Cookie': 'tj_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0' },
    })
  }) as typeof fetch
  try {
    const response = await clearSession({ request: request('https://board.tacticsjournal.com/api/board/session', {
      method: 'DELETE', headers: { Origin: 'https://board.tacticsjournal.com', Cookie: 'tj_session=board' },
    }) })
    assert.equal(upstream!.url, 'https://tacticsjournal.com/api/account/signout')
    assert.equal(upstream!.method, 'POST')
    assert.match(response.headers.get('Set-Cookie') || '', /^tj_session=;/)
  } finally { globalThis.fetch = original }

  globalThis.fetch = (async () => new Response('{}', {
    headers: { 'Set-Cookie': 'tj_session=still-valid; Domain=attacker.test; Path=/' },
  })) as typeof fetch
  try {
    const response = await clearSession({ request: request('https://board.tacticsjournal.com/api/board/session', {
      method: 'DELETE', headers: { Origin: 'https://board.tacticsjournal.com', Cookie: 'tj_session=board' },
    }) })
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('Set-Cookie'), 'tj_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0')
  } finally { globalThis.fetch = original }

  globalThis.fetch = (async () => { throw new Error('offline') }) as typeof fetch
  try {
    const response = await clearSession({ request: request('https://board.tacticsjournal.com/api/board/session', {
      method: 'DELETE', headers: { Origin: 'https://board.tacticsjournal.com', Cookie: 'tj_session=board' },
    }) })
    assert.equal(response.status, 502)
    assert.match(response.headers.get('Set-Cookie') || '', /^tj_session=;/)
  } finally { globalThis.fetch = original }
})

test('board session helper deduplicates exchange and does not persist a token', async () => {
  resetBoardSession()
  const calls: { url: string; body?: string }[] = []
  let ready = false
  const fake = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    calls.push({ url, body: typeof init?.body === 'string' ? init.body : undefined })
    if (url === '/api/board/session' && !init?.method) return Response.json({ authenticated: ready })
    if (url.includes('/board-session')) return Response.json({ token: 'never-persist-me' })
    ready = true
    return Response.json({ authenticated: true })
  }) as typeof fetch
  assert.equal(await Promise.all([ensureBoardSession(fake), ensureBoardSession(fake)]).then((values) => values.every(Boolean)), true)
  assert.equal(calls.filter((call) => call.url.includes('/board-session')).length, 1)
  assert.equal(calls.filter((call) => call.url === '/api/board/session' && call.body?.includes('never-persist-me')).length, 1)
  const source = readFileSync(new URL('../src/board-api.ts', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /localStorage|sessionStorage/)
})

test('an apex account change replaces a valid Board cookie from the previous account', async () => {
  resetBoardSession()
  const calls: string[] = []
  let boardBinding = 'account-a'
  let apexBinding = 'account-a'
  const fake = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    calls.push(`${init?.method || 'GET'} ${url}`)
    if (url === '/api/board/session' && !init?.method) {
      return Response.json({ authenticated: true, account_binding: boardBinding })
    }
    if (url.includes('/board-session')) return Response.json({ token: `token-for-${apexBinding}` })
    boardBinding = apexBinding
    return Response.json({ authenticated: true })
  }) as typeof fetch

  assert.equal(await ensureBoardSession(fake, 'account-a'), true)
  assert.equal(calls.filter((call) => call.includes('/board-session')).length, 0)

  apexBinding = 'account-b'
  resetBoardSession()
  assert.equal(await ensureBoardSession(fake, 'account-b'), true)
  assert.equal(boardBinding, 'account-b')
  assert.equal(calls.filter((call) => call.includes('/board-session')).length, 1)
  assert.equal(calls.filter((call) => call === 'POST /api/board/session').length, 1)
})

test('MCP uses the incoming canonical board origin and never returns a capability', async () => {
  const original = globalThis.fetch
  let called: Request | null = null
  const draftRequests: Request[] = []
  const storedPayloads: string[] = []
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const outgoing = input instanceof Request ? input : new Request(input, init)
    if (new URL(outgoing.url).pathname === '/api/board/import-drafts') {
      draftRequests.push(outgoing)
      const { payload } = await outgoing.clone().json() as { payload: string }
      storedPayloads.push(payload)
      return Response.json({ id: `${'a'.repeat(21)}${storedPayloads.length}`, expires_at: '2026-08-29T00:00:00.000Z' }, { status: 201 })
    }
    called = outgoing
    return new Response(JSON.stringify({
      board: { id: 'board-1', name: 'Press', document: {} }, revision: 'r1',
      project_skills: [{ id: 'pressing', name: 'Pressing', instructions: 'Use dashed arrows.' }], skills_revision: 's1',
    }))
  }) as typeof fetch
  try {
    const rpc = async (id: number, method: string, params: object) => {
      const response = await mcpPost({
        request: request('https://branch.tactics-board-mapper.pages.dev/mcp', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
        }),
        env: {},
      })
      return response.json() as Promise<any>
    }
    const initialized = await rpc(1, 'initialize', { protocolVersion: '2025-11-25' })
    assert.equal(initialized.result.serverInfo.name, 'tacticsjournal-board')
    assert.match(initialized.result.instructions, /new session or project, use create_project_link/)
    assert.match(initialized.result.instructions, /project uses document\.boards/)
    assert.match(initialized.result.instructions, /Follow projectSkills/)
    assert.match(initialized.result.instructions, /both returned revisions/)
    const tools = (await rpc(2, 'tools/list', {})).result.tools
    assert.deepEqual(tools.map((tool: any) => tool.name), ['create_project_link', 'read_board', 'replace_board'])
    const createSchema = tools[0].inputSchema.properties.document
    const publicScene = JSON.parse(readFileSync(new URL('../public/agent/v1.scene.schema.json', import.meta.url), 'utf8'))
    const publicProject = JSON.parse(readFileSync(new URL('../public/agent/v1.project.schema.json', import.meta.url), 'utf8'))
    const embedded = (schema: unknown, publicId: string, embeddedId: string) => JSON.parse(JSON.stringify(schema).replaceAll(publicId, embeddedId))
    const expectedScene = embedded(publicScene, 'https://board.tacticsjournal.com/agent/v1.scene.schema.json', 'urn:tacticsjournal:board:create-scene')
    const expectedProject = embedded(publicProject, 'https://board.tacticsjournal.com/agent/v1.project.schema.json', 'urn:tacticsjournal:board:create-project')
    expectedProject.$defs.board.properties.scene = embedded(publicScene, 'https://board.tacticsjournal.com/agent/v1.scene.schema.json', 'urn:tacticsjournal:board:create-project-scene')
    assert.deepEqual(createSchema.oneOf[0], expectedScene)
    assert.deepEqual(createSchema.oneOf[1], expectedProject)
    assert.deepEqual(createSchema.oneOf[1].required, ['id', 'name', 'boards', 'updated'])
    assert.deepEqual(createSchema.oneOf[1].$defs.board.required, ['id', 'title', 'view', 'scene', 'note', 'link'])
    assert.match(createSchema.description, /Do not use type, scenes, or session in place of document\.boards/)
    const generated = await rpc(3, 'tools/call', { name: 'create_project_link', arguments: {
      name: 'Third-man run',
      document: { version: 4, board: { w: 800, h: 418 }, pitch: 'training', objects: [] },
    } })
    const created = generated.result.structuredContent
    assert.match(created.url, /^https:\/\/branch\.tactics-board-mapper\.pages\.dev\/import#project=[A-Za-z0-9_-]{22}$/)
    assert.ok(created.url.length < 100)
    assert.equal(created.name, 'Third-man run')
    assert.equal(created.boardCount, 1)
    assert.match(generated.result.content[0].text, /expires after 24 hours/)
    const decoded = await decodeAgentImport(storedPayloads[0])
    assert.equal(decoded.name, 'Third-man run')
    assert.equal(decoded.boardCount, 1)
    assert.equal(draftRequests[0].url, 'https://billing-sandbox.tacticsjournal.pages.dev/api/board/import-drafts')
    assert.equal(draftRequests[0].headers.get('Origin'), 'https://branch.tactics-board-mapper.pages.dev')
    assert.equal(draftRequests[0].headers.get('User-Agent'), 'TacticsBoardAgent/1.0')
    assert.equal(draftRequests[0].headers.get('X-Tactics-Board-Timestamp'), null)
    assert.equal(draftRequests[0].headers.get('X-Tactics-Board-Signature'), null)
    assert.equal(called, null)
    assert.doesNotMatch(JSON.stringify(generated), new RegExp(capability.replace('.', '\\.')))
    const projectDocument = {
      id: 'third_man_session', name: 'Third-man run', updated: 1,
      boards: [1, 2].map((step) => ({
        id: `step_${step}`, title: `Step ${step}`, view: { x: 0, y: 0, w: 800, h: 418 },
        scene: { version: 4, board: { w: 800, h: 418 }, pitch: 'training', objects: [{
          id: 'runner_c', type: 'player', x: 300 + step * 40, y: 260, r: 13, color: '#6cabdd', label: 'C', name: '', namePos: 'bottom', nameSize: 18, nameDisplay: 'last', flipX: false, flipY: false, rotation: 0,
        }] },
        note: `# Step ${step}`, link: { dur: 1200, ease: 'in-out' },
      })),
    }
    const multi = await rpc(30, 'tools/call', { name: 'create_project_link', arguments: { name: 'Third-man session', document: projectDocument } })
    assert.equal(multi.result.structuredContent.boardCount, 2)
    const multiDecoded = await decodeAgentImport(storedPayloads[1])
    assert.equal(multiDecoded.boardCount, 2)
    assert.deepEqual(multiDecoded.document, projectDocument)
    const wrongWrapper = await rpc(31, 'tools/call', { name: 'create_project_link', arguments: { name: 'Wrong', document: { type: 'project', scenes: [] } } })
    assert.equal(wrongWrapper.result.isError, true)
    assert.match(wrongWrapper.result.content[0].text, /document must be \{id,name,updated,boards:/)
    assert.match(wrongWrapper.result.content[0].text, /Do not use type, scenes, or session/)
    const badBoard = await rpc(32, 'tools/call', { name: 'create_project_link', arguments: { name: 'Wrong board', document: {
      id: 'bad_project', name: 'Wrong board', updated: 1,
      boards: [{ id: 'bad_board', title: 'Wrong', view: { x: 0, y: 0, w: 800, h: 418 }, scene: {}, note: '', link: { dur: 1200, ease: 'in-out' } }],
    } } })
    assert.match(badBoard.result.content[0].text, /Board 1 scene does not match the complete v4 scene schema/)
    const badObject = await rpc(33, 'tools/call', { name: 'create_project_link', arguments: {
      name: 'Wrong object', document: { version: 4, board: { w: 800, h: 418 }, pitch: 'training', objects: [{}] },
    } })
    assert.equal(badObject.result.isError, true)
    assert.match(badObject.result.content[0].text, /complete v4 scene schema/)
    const tooLarge = await rpc(4, 'tools/call', { name: 'create_project_link', arguments: {
      name: 'Too large', document: { version: 4, board: { w: 800, h: 418 }, pitch: 'training', objects: [], note: 'x'.repeat(33 * 1024) },
    } })
    assert.equal(tooLarge.result.isError, true)
    assert.match(tooLarge.result.content[0].text, /too large/)
    const readResult = await rpc(5, 'tools/call', { name: 'read_board', arguments: { capabilityUrl: `https://board.tacticsjournal.com/agent/v1.md#access=${capability}` } })
    const body = JSON.stringify(readResult)
    assert.deepEqual(readResult.result.structuredContent.projectSkills, [{ id: 'pressing', name: 'Pressing', instructions: 'Use dashed arrows.' }])
    assert.equal(readResult.result.structuredContent.skillsRevision, 's1')
    assert.equal(called!.url, 'https://billing-sandbox.tacticsjournal.pages.dev/api/board/agent')
    assert.equal(called!.headers.get('User-Agent'), 'TacticsBoardAgent/1.0')
    assert.equal(called!.headers.get('Authorization'), `Bearer ${capability}`)
    assert.doesNotMatch(body, new RegExp(capability.replace('.', '\\.')))
    await rpc(6, 'tools/call', { name: 'replace_board', arguments: { capabilityUrl: `https://board.tacticsjournal.com/agent/v1.md#access=${capability}`, revision: 'r1', skillsRevision: 's1', document: {} } })
    assert.equal(called!.method, 'PUT')
    assert.equal(called!.headers.get('If-Match'), 'r1')
    assert.deepEqual(await called!.clone().json(), { document: {}, skills_revision: 's1' })
  } finally { globalThis.fetch = original }
})
