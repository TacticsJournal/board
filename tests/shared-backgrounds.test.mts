import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  createSharedBackgroundResolver, MAX_SHARED_BACKGROUND_BYTES, readSharedBackground,
  sharedBackgroundPitchStyle,
} from '../src/shared-backgrounds.ts'
import { allPitches, clearActiveSharedPitches, customPitches, pitchById, setActiveSharedPitches, setCustomPitches } from '../src/pitches.ts'

const boardSource = await readFile(new URL('../src/board.ts', import.meta.url), 'utf8')
const mainSource = await readFile(new URL('../src/main.ts', import.meta.url), 'utf8')

const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x01, 0xff, 0xd9])
const headers = (extra: Record<string, string> = {}) => ({
  'Content-Type': 'image/jpeg', 'Content-Length': String(JPEG.length), ETag: '"one"',
  'X-Board-Background-Kind': 'pitch', 'X-Board-Background-Height': '618',
  'X-Board-Background-Updated-At': '2026-08-18T12:00:00.000Z', ...extra,
})

function response(extra: Record<string, string> = {}, body: BodyInit = JPEG) {
  return new Response(body, { status: 200, headers: headers(extra) })
}

test('shared JPEG validation checks headers, size, and magic bytes', async () => {
  const valid = await readSharedBackground(response())
  assert.equal(valid?.kind, 'pitch')
  assert.equal(valid?.boardH, 618)
  assert.match(valid?.src ?? '', /^data:image\/jpeg;base64,/)

  assert.equal(await readSharedBackground(response({ 'Content-Type': 'text/plain' })), null)
  assert.equal(await readSharedBackground(response({ ETag: '' })), null)
  assert.equal(await readSharedBackground(response({ 'X-Board-Background-Height': '32769' })), null)
  assert.equal(await readSharedBackground(response({}, Uint8Array.from([1, 2, 3, 4]))), null)
  assert.equal(MAX_SHARED_BACKGROUND_BYTES, 5 * 1024 * 1024)
})

test('shared resolver uses conditional requests and never returns an unauthorized cache', async () => {
  const requests: { url: string; init?: RequestInit }[] = []
  let next: Response = response()
  const resolver = createSharedBackgroundResolver('saved-row', {
    fetchImpl: async (url, init) => { requests.push({ url, init }); return next },
  })
  const first = await resolver('bg:one')
  assert.ok(first)
  next = new Response(null, { status: 304 })
  assert.equal(await resolver('bg:one'), first)
  assert.equal((requests[1].init?.headers as Record<string, string>)['If-None-Match'], '"one"')
  next = new Response(null, { status: 404 })
  assert.equal(await resolver('bg:one'), null)
  next = new Response(null, { status: 304 })
  assert.equal(await resolver('bg:one'), null)
})

test('an invitation preview carries its bearer token only on scoped background reads', async () => {
  let requested = ''
  const resolver = createSharedBackgroundResolver('saved-row', {
    invitationToken: 'invite.secret',
    fetchImpl: async (url) => { requested = String(url); return response() },
  })
  assert.ok(await resolver('bg:one'))
  const url = new URL(requested, 'https://board.tacticsjournal.com')
  assert.equal(url.searchParams.get('shared_board_id'), 'saved-row')
  assert.equal(url.searchParams.get('id'), 'bg:one')
  assert.equal(url.searchParams.get('invite'), 'invite.secret')
})

test('an older request cannot replace a newer image in the same scope', async () => {
  const releases: ((value: Response) => void)[] = []
  const resolved: string[] = []
  const resolver = createSharedBackgroundResolver('row', {
    fetchImpl: async () => new Promise<Response>(resolve => { releases.push(resolve) }),
    onResolved: background => { resolved.push(background.etag) },
  })
  const older = resolver('bg:one')
  const newer = resolver('bg:one')
  releases[1](response({ ETag: '"newer"', 'X-Board-Background-Updated-At': '2026-08-18T12:00:01.000Z' }))
  assert.ok(await newer)
  releases[0](response({ ETag: '"older"' }))
  assert.equal(await older, null)
  assert.deepEqual(resolved, ['"newer"'])
  assert.equal(resolver.cached()[0]?.etag, '"newer"')
})

test('clearing a scope drops late responses and the active shared style wins collisions', async () => {
  let release!: (value: Response) => void
  const pending = new Promise<Response>(resolve => { release = resolve })
  const resolver = createSharedBackgroundResolver('row', { fetchImpl: async () => pending })
  const late = resolver('bg:collision')
  resolver.clear()
  release(response())
  assert.equal(await late, null)

  setCustomPitches([{ id: 'bg:collision', label: 'Personal', src: 'personal', boardH: 100, category: 'custom', pro: true }])
  setActiveSharedPitches([{ ...sharedBackgroundPitchStyle({ id: 'bg:collision', src: 'shared', etag: 'e', kind: 'pitch', boardH: 200, updatedAt: '2026-08-18T12:00:00.000Z' }) }])
  assert.equal(pitchById('bg:collision').src, 'shared')
  assert.equal(customPitches().some(style => style.id === 'bg:collision'), true)
  assert.equal(allPitches().some(style => style.src === 'shared'), false)
  clearActiveSharedPitches()
  setCustomPitches([])
})

test('Board accepts a project-scoped resolver and clears it after remote access loss', () => {
  assert.match(boardSource, /private backgroundResolver:.*backgrounds\.image/)
  assert.match(boardSource, /setBackgroundResolver\(resolver:/)
  assert.match(boardSource, /this\.backgroundResolver\(style\.id\)/)
  assert.match(mainSource, /const activeRowId = saves\.currentBoardId\(\)/)
  assert.match(mainSource, /reconcileProjectSync[\s\S]*selectProjectBackgroundResolver\(currentProject\(library\)\)[\s\S]*board\.refreshBackground\(\)/)
})
