// Proposed versions, client side. The things that can hurt here are a request
// leaving without its cookie, a document this build cannot draw reaching the
// screen, and an accepted version reaching local storage unchecked.

import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

import {
  boardProposalReviewUrl,
  boardProposalsListUrl,
  canReviewBoardProposals,
  changeSummary,
  compareBoardDocuments,
  createBoardProposalsApi,
  parseAcceptedBoard,
  parseBoardProposalReview,
  parseBoardProposals,
  proposalTimeLabel,
} from '../src/board-proposals.ts'
import { boardProposalsUrl } from '../src/board-api.ts'
import type { BoardHistoryContext } from '../src/board-history.ts'
import { emptyScene } from '../src/types.ts'
import type { BoardDocument } from '../src/projects.ts'
import { upstreamRequest } from '../functions/api/board/[[path]].js'

const saves = readFileSync(new URL('../src/saves.ts', import.meta.url), 'utf8')
const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8')
const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8')
const panel = readFileSync(new URL('../src/board-proposals.ts', import.meta.url), 'utf8')

const PRO: BoardHistoryContext = { pro: true, signedIn: true, selfHosted: false, accountBinding: 'account-1' }
const OWNED = { id: 'b-1', syncAccount: 'account-1' }
const scene = emptyScene()
const WAITING = {
  id: 'p-1', author: 'Agent link abc123', name: 'Press', note: 'Pushed the pivot up',
  created_at: '2026-08-30T10:00:00.000Z', stale: false,
}

function responseOf(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body } as unknown as Response
}

function project(boards: { id: string; title: string; objects?: unknown[] }[]): BoardDocument {
  return {
    id: 'proj-1',
    name: 'Press',
    updated: 0,
    boards: boards.map(board => ({
      id: board.id,
      title: board.title,
      view: { x: 0, y: 0, w: 800, h: 618 },
      scene: { ...scene, objects: (board.objects ?? []) as never[] },
      note: '',
      link: { dur: 1200, ease: 'in-out' as const },
    })),
  }
}

test('proposal requests stay on the board host and carry the session cookie', async () => {
  assert.equal(boardProposalsUrl(), '/api/board/proposals')
  assert.equal(boardProposalsListUrl('b 1/2'), '/api/board/proposals?board_id=b%201%2F2')
  assert.equal(boardProposalReviewUrl('b-1', 'p 1'), '/api/board/proposals?board_id=b-1&proposal_id=p%201')

  const calls: [string, RequestInit | undefined][] = []
  const api = createBoardProposalsApi((async (input: any, init: any) => {
    calls.push([String(input), init])
    return responseOf(calls.length === 1
      ? { proposals: [] }
      : { proposal: { id: 'p-1', status: 'rejected' } })
  }) as unknown as typeof fetch)

  await api.list('b-1')
  assert.equal(calls[0][0], '/api/board/proposals?board_id=b-1')
  assert.equal(calls[0][1]?.credentials, 'include')

  await api.reject('b-1', 'p-1')
  assert.equal(calls[1][0], '/api/board/proposals')
  assert.equal(calls[1][1]?.method, 'POST')
  assert.equal(calls[1][1]?.credentials, 'include')
  assert.deepEqual(JSON.parse(String(calls[1][1]?.body)), { board_id: 'b-1', proposal_id: 'p-1', decision: 'reject' })
})

test('the Board proxy allows only its own browser origin to decide a proposal', () => {
  const decision = JSON.stringify({ board_id: 'b-1', proposal_id: 'p-1', decision: 'accept' })
  const own = new Request('https://board.tacticsjournal.com/api/board/proposals?board_id=b-1', {
    method: 'POST',
    headers: { Origin: 'https://board.tacticsjournal.com', 'Content-Type': 'application/json' },
    body: decision,
  })
  const upstream = upstreamRequest(own, { path: 'proposals' })
  assert.ok(upstream)
  assert.equal(new URL(upstream.url).pathname, '/api/board/proposals')

  const foreign = new Request('https://board.tacticsjournal.com/api/board/proposals?board_id=b-1', {
    method: 'POST',
    headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json' },
    body: decision,
  })
  assert.equal(upstreamRequest(foreign, { path: 'proposals' }), null)
})

test('a failed proposal response surfaces the bounded server message', async () => {
  const named = createBoardProposalsApi((async () => responseOf({ error: 'x'.repeat(400) }, false, 403)) as unknown as typeof fetch)
  await assert.rejects(named.list('b-1'), (error: Error) => error.message.length === 256)
  const bare = createBoardProposalsApi((async () => responseOf(null, false, 500)) as unknown as typeof fetch)
  await assert.rejects(bare.accept('b-1', 'p-1'), (error: Error) => error.message === '500')
})

test('the waiting list keeps only rows a reader can act on', () => {
  assert.equal(parseBoardProposals(null), null)
  assert.equal(parseBoardProposals({ proposals: 'nope' }), null)
  const proposals = parseBoardProposals({
    proposals: [
      WAITING,
      { ...WAITING, id: '' },
      { ...WAITING, id: 'p-2', created_at: 'whenever' },
      'not a row',
    ],
  })
  assert.deepEqual(proposals, [{
    id: 'p-1',
    author: 'Agent link abc123',
    name: 'Press',
    note: 'Pushed the pivot up',
    createdAt: '2026-08-30T10:00:00.000Z',
    stale: false,
  }])
  assert.equal(parseBoardProposals({ proposals: [{ ...WAITING, author: '', note: '  ', stale: 'yes' }] })?.[0].author, 'An agent')
  assert.equal(parseBoardProposals({ proposals: [{ ...WAITING, note: '  ', stale: 'yes' }] })?.[0].note, null)
  assert.equal(parseBoardProposals({ proposals: [{ ...WAITING, stale: 'yes' }] })?.[0].stale, false, 'only a true flag is stale')
})

test('a review this build cannot draw on both sides is refused', () => {
  const good = { proposal: { ...WAITING, document: scene }, current: { name: 'Press', document: scene } }
  assert.equal(parseBoardProposalReview(good)?.currentName, 'Press')
  assert.equal(parseBoardProposalReview({ ...good, current: { name: 'Press', document: { objects: 'no' } } }), null)
  assert.equal(parseBoardProposalReview({ ...good, proposal: { ...WAITING, document: null } }), null)
  assert.equal(parseBoardProposalReview({ proposal: { ...WAITING, document: scene } }), null)
})

test('a malformed accepted board is refused before anything local changes', () => {
  const good = { id: 'b-1', name: 'Press', scene, updated_at: '2026-01-02T03:04:05.000Z', cursor: 'c', device: null, access: 'owner' }
  assert.equal(parseAcceptedBoard({ board: good }, 'b-1')?.name, 'Press')
  assert.equal(parseAcceptedBoard({ board: good }, 'b-2'), null, 'another board id is refused')
  assert.equal(parseAcceptedBoard({ board: { ...good, access: 'shared' } }, 'b-1'), null)
  assert.equal(parseAcceptedBoard({ board: { ...good, scene: { objects: 'no' } } }, 'b-1'), null)
  assert.equal(parseAcceptedBoard({ board: { ...good, updated_at: 'whenever' } }, 'b-1'), null)
  assert.equal(parseAcceptedBoard({}, 'b-1'), null)
})

test('proposals belong to owned synced projects on a signed-in Pro account', () => {
  assert.equal(canReviewBoardProposals(OWNED, PRO), true)
  assert.equal(canReviewBoardProposals(OWNED, { ...PRO, pro: false }), false)
  assert.equal(canReviewBoardProposals(OWNED, { ...PRO, signedIn: false }), false)
  assert.equal(canReviewBoardProposals(OWNED, { ...PRO, selfHosted: true }), false)
  assert.equal(canReviewBoardProposals({ ...OWNED, access: 'shared' }, PRO), false)
  assert.equal(canReviewBoardProposals({ ...OWNED, locked: true }, PRO), false)
  assert.equal(canReviewBoardProposals(OWNED, { ...PRO, accountBinding: 'account-2' }), false)
})

test('the two versions are matched board by board, by id rather than by position', () => {
  const current = project([
    { id: 'b1', title: 'Start' },
    { id: 'b2', title: 'Press', objects: [{ id: 'p1', type: 'player' }] },
    { id: 'b3', title: 'Dropped' },
  ])
  const proposed = project([
    { id: 'b2', title: 'Press', objects: [{ id: 'p1', type: 'player' }, { id: 'p2', type: 'player' }] },
    { id: 'b1', title: 'Start' },
    { id: 'b4', title: 'New' },
  ])
  const changes = compareBoardDocuments(current, proposed)
  assert.deepEqual(changes.map(change => [change.key, change.state]), [
    ['b2', 'changed'],
    ['b1', 'unchanged'],
    ['b4', 'added'],
    ['b3', 'removed'],
  ], 'a reordered board is the same board, and a dropped one is still named')
  assert.equal(changes[2].current, null)
  assert.equal(changes[3].proposed, null)
  assert.equal(changeSummary(changes), '1 board redrawn, 1 added, 1 removed')
})

test('a single-scene project compares as one board', () => {
  const unchanged = compareBoardDocuments(scene, scene)
  assert.deepEqual(unchanged.map(change => [change.key, change.state]), [['board', 'unchanged']])
  assert.equal(changeSummary(unchanged), 'No boards changed')
  const changed = compareBoardDocuments(scene, { ...scene, objects: [{ id: 'p1', type: 'player' } as never] })
  assert.equal(changed[0].state, 'changed')
  assert.equal(changeSummary(changed), '1 board redrawn')
})

test('a proposal time is shown in the reader\'s own locale, or admits it cannot be', () => {
  assert.equal(proposalTimeLabel('nonsense'), 'Date unavailable')
  assert.equal(proposalTimeLabel('2026-01-02T03:04:05.000Z'), new Date('2026-01-02T03:04:05.000Z').toLocaleString())
})

test('the saved list offers Proposals only where the policy allows it', () => {
  assert.match(saves, /canReviewBoardProposals\(\{ \.\.\.project, locked \}, this\.historyContext\(\)\)[\s\S]*?data-sv="proposals"[\s\S]*?aria-label="Proposed versions of \$\{safe\}"/)
  assert.match(saves, /private openProposals\(name: string\): void \{[\s\S]*?if \(!canReviewBoardProposals\(\{ \.\.\.saved, locked \}, this\.historyContext\(\)\)\) return[\s\S]*?this\.onOpenProposals\(/)
  assert.match(saves, /k === 'proposals'\) this\.openProposals\(btn\.dataset\.name!\)/)
})

test('proposals is a Settings screen with a back arrow, not a window of its own', () => {
  assert.match(main, /type SetScreen = [^\n]*\| 'proposals'/)
  assert.match(main, /proposals: 'Proposals'/)
  assert.match(main, /<div class="setPane hidden" data-pane="proposals">\s*<div data-proposals-host><\/div>/)
  assert.match(main, /screen === 'history' \|\| screen === 'proposals' \? 'boards' : 'root'/)
  assert.match(main, /boardProposals\.start\(target\)\s*showScreen\('proposals'\)/)
  // a lapsed or signed-out account is not left standing on the screen
  assert.match(main, /\(screen === 'history' \|\| screen === 'proposals'\)\s*&& !\(authenticated && entitlements\.isPro\(\) && !BOARD_SELF_HOSTED\)\) showScreen\('boards'\)/)
})

test('an accepted version takes the same path a restored version takes', () => {
  assert.match(main, /onAccepted: \(board: AcceptedBoard, target: BoardProposalsTarget\) => applyRestoredVersion\(board, \{ \.\.\.target, savedAt: board\.updatedAt \}\)/)
  assert.match(main, /onDone: \(message, boardId\) => \{\s*showScreen\('boards'\)\s*saves\.refresh\(\)\s*saves\.announce\(message\)\s*if \(!saves\.focusProposalsAction\(boardId\)\)/)
  assert.match(saves, /focusProposalsAction\(boardId: string\): boolean \{/)
})

test('an agent link is issued with the permission the owner picked', () => {
  assert.match(main, /function makeAgentLink\(body: HTMLElement\) \{[\s\S]*?data-agent-mode="propose"[\s\S]*?data-agent-mode="edit"/)
  assert.match(main, /Its work waits in Proposals until you accept it/)
  assert.match(main, /issueAgentLink\(body, button\.dataset\.agentMode === 'edit' \? 'edit' : 'propose'\)/)
  assert.match(main, /body: JSON\.stringify\(\{ board_id: finalBoardId, access_mode: mode \}\)/)
  assert.match(saves, /currentAgentLink\(mode: AgentAccessMode = 'propose'\)/)
  // the saved-list shortcut mints the safer of the two without asking
  assert.match(saves, /this\.onCreateAgentLink\(boardId, 'propose'\)/)
})

test('the proposals screen keeps its states, its confirmation and its live region', () => {
  assert.match(panel, /data-prop-status role="status" aria-live="polite"/)
  assert.match(panel, /aria-busy/)
  assert.match(panel, /data-prop="retry"[\s\S]*?Try again/)
  assert.match(panel, /No proposals waiting/)
  // one confirmation, in place, before the accept; and no second decision
  // while the first is in flight
  assert.match(panel, /this\.confirming[\s\S]*?Replace the current project\?[\s\S]*?data-prop="accept"/)
  assert.match(panel, /if \(decision === 'accept' && !this\.confirming\) return/)
  assert.match(panel, /busy \? ' disabled' : ''/)
  assert.match(panel, /event\.key !== 'Escape'[\s\S]*?event\.stopPropagation\(\)/)
  // the stale case is stated on the screen rather than left for the reader
  assert.match(panel, /The project changed after this was proposed/)
  assert.match(css, /\.propPanes \{ display: grid; grid-template-columns: 1fr 1fr;/)
  assert.match(css, /@media \(max-width: 430px\) \{[\s\S]*?\.propPanes \{ grid-template-columns: 1fr; \}/)
})
