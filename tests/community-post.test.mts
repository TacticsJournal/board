import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import {
  agentImportSource, MAX_COMMUNITY_POST_CAPTION_CHARS, postBoardToCommunity,
} from '../src/agent-import.ts'
import { newProject } from '../src/projects.ts'

const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8')
const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8')

const scene = { version: 4, board: { w: 800, h: 418 }, pitch: 'training', objects: [] }
const preview = 'data:image/jpeg;base64,/9j/2Q=='
const origin = 'https://board.tacticsjournal.com'
const postId = 'p'.repeat(22)

function success(overrides: Record<string, unknown> = {}) {
  return {
    post_id: postId,
    community_url: `https://tacticsjournal.com/community/?post=${postId}`,
    board_url: `https://board.tacticsjournal.com/import?community=${postId}`,
    moderation_pending: false,
    message: 'Posted to Community.',
    ...overrides,
  }
}

function board() {
  const project = newProject(scene as never, 'Pressing trigger')
  project.boards[0].title = 'Jump to the full-back'
  return project
}

test('an empty caption posts the bounded board and preview to the community endpoint', async () => {
  let request: { url: string; init: RequestInit } | null = null
  const result = await postBoardToCommunity('Pressing trigger', board(), preview, '', origin, (async (input, init) => {
    request = { url: String(input), init: init ?? {} }
    return Response.json(success())
  }) as typeof fetch)

  assert.ok(request)
  const { url, init } = request as { url: string; init: RequestInit }
  assert.equal(url, 'https://board.tacticsjournal.com/api/board/community-posts')
  assert.equal(init.method, 'POST')
  assert.equal(init.credentials, 'include')
  assert.equal((init.headers as Record<string, string>)['Content-Type'], 'application/json')
  const body = JSON.parse(String(init.body))
  assert.deepEqual(Object.keys(body).sort(), ['caption', 'payload', 'preview'])
  assert.equal(body.caption, '')
  assert.equal(body.preview, preview)
  assert.match(body.payload, /^[A-Za-z0-9_-]+$/)
  assert.ok(body.payload.length <= 4000)

  assert.equal(result.postId, postId)
  assert.equal(result.moderationPending, false)
  assert.equal(result.communityUrl, `https://tacticsjournal.com/community/?post=${postId}`)
  assert.equal(result.boardUrl, `https://board.tacticsjournal.com/import?community=${postId}`)
})

test('a moderated post keeps the backend message and a too-long caption never leaves the browser', async () => {
  const held = await postBoardToCommunity('Pressing trigger', board(), preview, 'A note', origin, (async () =>
    Response.json(success({ moderation_pending: true, message: 'This post is waiting for review.' }))) as typeof fetch)
  assert.equal(held.moderationPending, true)
  assert.equal(held.message, 'This post is waiting for review.')

  let called = false
  await assert.rejects(
    postBoardToCommunity('Pressing trigger', board(), preview, 'x'.repeat(MAX_COMMUNITY_POST_CAPTION_CHARS + 1), origin, (async () => {
      called = true
      return Response.json(success())
    }) as typeof fetch),
    /at most 5000 characters/,
  )
  assert.equal(called, false)
})

test('unsafe or malformed answers fail closed with a short message', async () => {
  await assert.rejects(
    postBoardToCommunity('Pressing trigger', board(), preview, '', origin, (async () =>
      Response.json({ error: 'Sign in to the Community to post.' }, { status: 403 })) as typeof fetch),
    /Sign in to the Community to post\./,
  )
  await assert.rejects(
    postBoardToCommunity('Pressing trigger', board(), preview, '', origin, (async () =>
      Response.json({ error: 'x'.repeat(500) }, { status: 500 })) as typeof fetch),
    /This board could not be posted\. Try again\./,
  )
  for (const override of [
    { community_url: 'javascript:alert(1)' },
    { community_url: `https://attacker.example/community/?post=${postId}` },
    { community_url: `https://tacticsjournal.com/community/?post=another` },
    { board_url: `https://attacker.example/import?community=${postId}` },
    { board_url: `https://board.tacticsjournal.com/import?community=${postId}&extra=1` },
  ]) await assert.rejects(
    postBoardToCommunity('Pressing trigger', board(), preview, '', origin, (async () =>
      Response.json(success(override))) as typeof fetch),
    /This board could not be posted\. Try again\./,
  )
  await assert.rejects(
    postBoardToCommunity('Pressing trigger', board(), preview, '', origin, (async () =>
      Response.json(success({ moderation_pending: 'yes' }))) as typeof fetch),
    /This board could not be posted\. Try again\./,
  )
  await assert.rejects(
    postBoardToCommunity('Pressing trigger', board(), 'data:text/html,<script>', '', origin, (async () => {
      throw new Error('the preview should never be sent')
    }) as typeof fetch),
    /preview could not be created/,
  )
})

test('community post links open as stored board imports and nothing else does', () => {
  assert.deepEqual(
    agentImportSource({ pathname: '/import', search: `?community=${postId}`, hash: '' } as Location),
    { kind: 'stored-board', value: postId },
  )
  assert.deepEqual(
    agentImportSource({ pathname: '/import', search: `?board=${'b'.repeat(22)}`, hash: '' } as Location),
    { kind: 'stored-board', value: 'b'.repeat(22) },
  )
  assert.equal(agentImportSource({ pathname: '/import', search: '?community=short', hash: '' } as Location), null)
  assert.equal(agentImportSource({ pathname: '/import', search: `?community=${postId}&x=1`, hash: '' } as Location), null)
  assert.equal(agentImportSource({ pathname: '/import', search: `?community=${postId}`, hash: '#board=abc' } as Location), null)
  assert.equal(agentImportSource({ pathname: '/import', search: '', hash: `#community=${postId}` } as Location), null)
  assert.equal(agentImportSource({ pathname: '/community', search: `?community=${postId}`, hash: '' } as Location), null)
})

test('the share row is a hosted-only step that keeps the sheet, the editor and a live status', () => {
  const entries = main.slice(main.indexOf('function shareEntries()'), main.indexOf('type CopyLinkScope'))
  const selfHosted = entries.slice(entries.indexOf('if (BOARD_SELF_HOSTED) return ['), entries.indexOf(']', entries.indexOf('if (BOARD_SELF_HOSTED) return [')))
  assert.doesNotMatch(selfHosted, /Post to Community/)
  // the row sits immediately after Copy link, and carries no plan tag
  assert.ok(entries.indexOf("key: 'board-link'") < entries.indexOf("key: 'community'"))
  assert.ok(entries.indexOf("key: 'community'") < entries.indexOf("key: 'agent'"))
  const row = entries.slice(entries.indexOf("key: 'community'"), entries.indexOf("key: 'agent'"))
  // The row reads as the board's state; with no post on this device it reads
  // exactly as it always has.
  assert.match(row, /label: communityRowLabel\(\)/)
  assert.match(row, /note: communityRowNote\(\)/)
  const rowState = main.slice(main.indexOf('function communityRowLabel'), main.indexOf('function shareEntries()'))
  assert.match(rowState, /record \? `Posted \$\{postedAgo\(record\.at\)\}` : 'Post to Community'/)
  assert.match(rowState, /'Update the post with this board'\s*:\s*'Share this board as a normal Community post'/)
  assert.doesNotMatch(row, /locked/)

  const step = main.slice(main.indexOf('function makeCommunityPost'), main.indexOf('function makeAgentLink'))
  assert.match(step, /role="status" aria-live="polite"/)
  assert.match(step, /if \(working \|\| posted\) return/)
  assert.match(step, /submit\.disabled = true/)
  assert.match(step, /stashEditedBoard\(\)[\s\S]*?await board\.imagesReady\(\)[\s\S]*?boardLinkPreview\(\)/)
  assert.match(step, /'Posted to Community\.'/)
  assert.match(step, /result\.moderationPending \? result\.message/)
  assert.match(step, /if \(!result\.moderationPending && !existing\) \{[\s\S]*?link\.textContent = 'View post'/)
  assert.match(step, /link\.rel = 'noopener noreferrer'/)
  // failure stays in the sheet: no alert, no redirect, no close
  assert.doesNotMatch(step, /alert\(|closeShareMenu\(|location\.(href|assign)/)

  // the step stays inside the share sheet
  assert.match(main, /entry\.key !== 'agent' && entry\.key !== 'community'\) closeShareMenu\(\)/)
  assert.match(styles, /\.communityPostLink \{[\s\S]*?min-height: 44px/)
  assert.match(styles, /\.communityPostLink:focus-visible \{ outline: 2px solid var\(--action\)/)
})
