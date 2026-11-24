import assert from 'node:assert/strict'
import test, { beforeEach } from 'node:test'
import { readFileSync } from 'node:fs'

import { PRODUCT_PLAN, recordProductEvent } from '../src/product-events.ts'

let captured: Request[]
let fetcher: typeof fetch

beforeEach(() => {
  captured = []
  fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : new URL(String(input), 'https://board.tacticsjournal.com').toString()
    captured.push(new Request(url, init))
    return new Response(null, { status: 204 })
  }) as typeof fetch
})

async function body(): Promise<Record<string, unknown>> {
  assert.equal(captured.length, 1)
  return captured[0].json() as Promise<Record<string, unknown>>
}

test('the plan is always free', () => {
  assert.equal(PRODUCT_PLAN, 'free')
})

test('events use the anonymous aggregate endpoint shape', async () => {
  await recordProductEvent('editor_opened', '', fetcher)
  const request = captured[0]
  assert.equal(request.method, 'POST')
  assert.equal(new URL(request.url).pathname, '/api/board/events')
  assert.equal(request.credentials, 'omit')
  assert.equal(request.referrerPolicy, 'no-referrer')
  assert.equal(request.headers.get('Content-Type'), 'application/json')
  assert.equal(request.headers.get('Cookie'), null)
  assert.deepEqual(await body(), { event: 'editor_opened', detail: '', plan: 'free' })
})

test('exports send only the format', async () => {
  for (const detail of ['png', 'gif', 'video'] as const) {
    captured = []
    await recordProductEvent('board_exported', detail, fetcher)
    assert.deepEqual(await body(), { event: 'board_exported', detail, plan: 'free' })
  }
})

test('the request body has no visitor or browsing identifiers', async () => {
  await recordProductEvent('board_exported', 'gif', fetcher)
  const payload = await body()
  assert.deepEqual(Object.keys(payload).sort(), ['detail', 'event', 'plan'])
})

test('no paywall, pricing, checkout, trial, backup, sign-in, or account events remain', () => {
  const source = readFileSync(new URL('../src/product-events.ts', import.meta.url), 'utf8')
  for (const name of ['paid_gate_hit', 'pricing_opened', 'checkout_opened', 'trial_used', 'free_backup', 'sign_in', 'account']) {
    assert.equal(source.includes(`'${name}`), false, name)
  }
  const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8')
  const events = [...main.matchAll(/recordProductEvent\('([a-z_]+)'/g)].map(match => match[1])
  assert.deepEqual([...new Set(events)].sort(), ['board_exported', 'editor_opened'])
})

test('event delivery failures never reject the caller', async () => {
  const failed = (async () => { throw new Error('network down') }) as typeof fetch
  await assert.doesNotReject(() => recordProductEvent('editor_opened', '', failed))
  const serverError = (async () => new Response('bad', { status: 500 })) as typeof fetch
  await assert.doesNotReject(() => recordProductEvent('editor_opened', '', serverError))
})
