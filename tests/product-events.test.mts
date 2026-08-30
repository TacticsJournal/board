import assert from 'node:assert/strict'
import test, { afterEach, beforeEach } from 'node:test'

import { recordProductEvent, resolveProductPlan } from '../src/product-events.ts'
import { resetServerEntitlement, setServerEntitlement } from '../src/entitlements.ts'
import { BOARD_SELF_HOSTED } from '../src/build-mode.ts'

let captured: Request[]
let fetcher: typeof fetch

beforeEach(() => {
  captured = []
  fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : new URL(String(input), 'https://board.tacticsjournal.com').toString()
    captured.push(new Request(url, init))
    return new Response(null, { status: 204 })
  }) as typeof fetch
  resetServerEntitlement()
})

afterEach(() => resetServerEntitlement())

async function body(): Promise<Record<string, unknown>> {
  assert.equal(captured.length, 1)
  return captured[0].json() as Promise<Record<string, unknown>>
}

test('resolveProductPlan reports the current trusted entitlement', () => {
  assert.equal(resolveProductPlan(), 'free')
  setServerEntitlement(false, true)
  assert.equal(resolveProductPlan(), 'license')
  setServerEntitlement(true, true)
  assert.equal(resolveProductPlan(), 'pro')
  if (BOARD_SELF_HOSTED) assert.equal(resolveProductPlan(), 'self_hosted')
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

test('every event sends one allowlisted scalar detail', async () => {
  const cases = [
    ['board_exported', 'gif'],
    ['paid_gate_hit', 'screenshot_import'],
    ['pricing_opened', ''],
    ['checkout_opened', 'pro_yearly'],
    ['trial_used', 'gif_export'],
    ['free_backup_prompted', 'fourth_save'],
    ['free_backup_enabled', 'settings'],
  ] as const
  for (const [event, detail] of cases) {
    captured = []
    await recordProductEvent(event, detail, fetcher)
    assert.deepEqual(await body(), { event, detail, plan: 'free' })
  }
})

test('the request body has no visitor or browsing identifiers', async () => {
  await recordProductEvent('paid_gate_hit', 'gif_export', fetcher)
  const payload = await body()
  for (const key of ['visitor_id', 'local_id', 'url', 'referrer', 'account_id']) {
    assert.equal(key in payload, false)
  }
})

test('event delivery failures never reject the caller', async () => {
  const failed = (async () => { throw new Error('network down') }) as typeof fetch
  await assert.doesNotReject(() => recordProductEvent('editor_opened', '', failed))
  const serverError = (async () => new Response('bad', { status: 500 })) as typeof fetch
  await assert.doesNotReject(() => recordProductEvent('editor_opened', '', serverError))
})
