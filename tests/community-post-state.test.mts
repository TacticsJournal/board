/* What the editor remembers about a board's Community post, and what the
   share sheet does with it. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8')
const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8')

/* The module reads window.localStorage on call, so a fake store installed
   before the import is what it uses. */
function withStorage(items: Record<string, string> = {}) {
  const store = new Map(Object.entries(items))
  ;(globalThis as Record<string, unknown>).window = {
    localStorage: {
      getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
      setItem: (key: string, value: string) => { store.set(key, value) },
      removeItem: (key: string) => { store.delete(key) },
    },
  }
  return store
}

const POSTED_KEY = 'tj.board.communityPosts.v1'
const HINT_KEY = 'tj.board.communityHint.v1'
const SHARE_ID = 'c'.repeat(22)

function record(at = '2026-08-29T00:00:00.000Z') {
  return { shareId: SHARE_ID, postId: 'post-1', communityUrl: 'https://tacticsjournal.com/community/?post=post-1', at }
}

test('a posted board is remembered per board of each project', async () => {
  const store = withStorage()
  const state = await import('../src/community-post-state.ts')
  const key = state.boardPostKey('project-1', 'board-1')
  assert.equal(state.boardPostKey('project-1', 'board-2') === key, false)
  assert.equal(state.communityPostFor(key), null)

  state.rememberCommunityPost(key, record())
  assert.deepEqual(state.communityPostFor(key), record())
  assert.equal(state.communityPostFor(state.boardPostKey('project-2', 'board-1')), null)
  assert.equal(JSON.parse(store.get(POSTED_KEY)!)[key].shareId, SHARE_ID)

  state.forgetCommunityPost(key)
  assert.equal(state.communityPostFor(key), null)
})

test('a record that is not this app’s shape is ignored rather than trusted', async () => {
  withStorage({
    [POSTED_KEY]: JSON.stringify({
      'a:b': { shareId: 'too-short', postId: 'p', communityUrl: 'https://tacticsjournal.com/community/?post=p', at: '2026-08-29T00:00:00.000Z' },
      'c:d': { shareId: SHARE_ID, postId: 'p', communityUrl: 'https://example.com/community/?post=p', at: '2026-08-29T00:00:00.000Z' },
      'e:f': { shareId: SHARE_ID, postId: 'p', communityUrl: 'https://tacticsjournal.com/community/?post=p', at: 'not a date' },
      'g:h': { shareId: SHARE_ID, postId: 'p', communityUrl: 'https://tacticsjournal.com/community/?post=p', at: '2026-08-29T00:00:00.000Z' },
    }),
  })
  const state = await import('../src/community-post-state.ts?shapes')
  assert.equal(state.communityPostFor('a:b'), null)
  assert.equal(state.communityPostFor('c:d'), null)
  assert.equal(state.communityPostFor('e:f'), null)
  assert.equal(state.communityPostFor('g:h')?.shareId, SHARE_ID)
})

test('the hint is due once and never again', async () => {
  const store = withStorage()
  const state = await import('../src/community-post-state.ts?hint')
  assert.equal(state.communityHintDue(), true)
  state.retireCommunityHint()
  assert.equal(state.communityHintDue(), false)
  assert.equal(store.get(HINT_KEY), 'done')
})

test('a post’s age is said the way the Community says it', async () => {
  const state = await import('../src/community-post-state.ts?ago')
  const now = Date.parse('2026-08-29T12:00:00.000Z')
  assert.equal(state.postedAgo('2026-08-29T11:59:30.000Z', now), 'just now')
  assert.equal(state.postedAgo('2026-08-29T11:30:00.000Z', now), '30m ago')
  assert.equal(state.postedAgo('2026-08-29T10:00:00.000Z', now), '2h ago')
  assert.equal(state.postedAgo('2026-08-26T12:00:00.000Z', now), '3d ago')
  assert.equal(state.postedAgo('2026-08-01T12:00:00.000Z', now), '4w ago')
  assert.equal(state.postedAgo('not a date', now), '')
})

test('posting the same board again updates its post instead of making a second one', () => {
  const step = main.slice(main.indexOf('function makeCommunityPost'), main.indexOf('async function makeAgentLink'))
  // The board copy the post already points at is what the update rewrites.
  assert.match(step, /existing \? existing\.shareId : null/)
  assert.match(step, /submit>\$\{existing \? 'Update the post' : 'Post'\}/)
  assert.match(step, /Posted \$\{esc\(postedAgo\(existing\.at\)\)\}/)
  assert.match(step, /rememberCommunityPost\(key, \{/)
  // Posting a board is itself proof the member knows they can.
  assert.match(step, /retireCommunityHint\(\)/)

  const agentImport = readFileSync(new URL('../src/agent-import.ts', import.meta.url), 'utf8')
  assert.match(agentImport, /shareId \? \{ id: shareId, payload, preview, caption \} : \{ payload, preview, caption \}/)
  assert.match(agentImport, /shareId !== null && !\/\^\[A-Za-z0-9_-\]\{22\}\$\/\.test\(shareId\)/)
})

test('the board being posted is shown before it is sent', () => {
  const step = main.slice(main.indexOf('function makeCommunityPost'), main.indexOf('async function makeAgentLink'))
  assert.match(step, /class="communityPreview" src="\$\{esc\(preview\)\}"/)
  assert.match(styles, /\.communityPreview \{/)
})

test('the one-time hint sits under a copy link and never interrupts it', () => {
  const hint = main.slice(main.indexOf('function appendCommunityHint'), main.indexOf('/* Posting is the same board'))
  assert.match(hint, /if \(BOARD_SELF_HOSTED \|\| !communityHintDue\(\)\) return/)
  assert.match(hint, /body\.appendChild\(hint\)/)
  assert.match(hint, /retireCommunityHint\(\)\s*\n\s*hint\.remove\(\)/)
  // No dialog, no toast, no interception of the action it appears under.
  assert.doesNotMatch(hint, /alert\(|confirm\(|showToast\(/)
  // It is appended to the copy-link step, after that step has been built.
  assert.match(main, /appendCommunityHint\(body\)\s*\n\s*void generate\('board'\)/)
  assert.match(styles, /\.communityHint \{/)
})

test('exporting and copying a link still ask nothing', () => {
  const copy = main.slice(main.indexOf('function makeCopyLink'), main.indexOf('function appendCommunityHint'))
  // The hint is the only Community mention in the copy-link step, and it is a
  // line in the sheet rather than a question about publishing.
  assert.doesNotMatch(copy, /Post to Community/)
  assert.equal((copy.match(/appendCommunityHint/g) || []).length, 1)
  const exportSheet = main.slice(main.indexOf('function openExportSheet'))
  assert.doesNotMatch(exportSheet.slice(0, 4000), /makeCommunityPost|postBoardToCommunity/)
})
