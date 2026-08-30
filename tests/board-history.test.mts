// Version history, client side. These cover the two things that can hurt: the
// request going somewhere without its cookie, and a bad response reaching
// local storage.

import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

import {
  boardHistoryListUrl,
  canOpenBoardHistory,
  createBoardHistoryApi,
  parseBoardVersions,
  parseRestoredBoard,
  versionTimeLabel,
  type BoardHistoryContext,
} from '../src/board-history.ts'
import { boardHistoryUrl } from '../src/board-api.ts'
import { emptyScene } from '../src/types.ts'
import { upstreamRequest } from '../functions/api/board/[[path]].js'

const saves = readFileSync(new URL('../src/saves.ts', import.meta.url), 'utf8')
const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8')
const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8')

const PRO: BoardHistoryContext = { pro: true, signedIn: true, selfHosted: false, accountBinding: 'account-1' }
const OWNED = { id: 'b-1', syncAccount: 'account-1' }
const scene = emptyScene()

function responseOf(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body } as unknown as Response
}

test('history requests stay on the board host and carry the session cookie', async () => {
  assert.equal(boardHistoryUrl(), '/api/board/history')
  assert.equal(boardHistoryListUrl('b 1/2'), '/api/board/history?board_id=b%201%2F2')
  const calls: [string, RequestInit | undefined][] = []
  const api = createBoardHistoryApi((async (input: any, init: any) => {
    calls.push([String(input), init])
    return responseOf(calls.length === 1
      ? { versions: [] }
      : { board: { id: 'b-1', name: 'Press', scene, updated_at: '2026-01-02T03:04:05.000Z', cursor: 'c', device: null, access: 'owner' } })
  }) as unknown as typeof fetch)

  await api.list('b-1')
  assert.equal(calls[0][0], '/api/board/history?board_id=b-1')
  assert.equal(calls[0][1]?.credentials, 'include')

  await api.restore('b-1', 'v-9')
  assert.equal(calls[1][0], '/api/board/history')
  assert.equal(calls[1][1]?.method, 'POST')
  assert.equal(calls[1][1]?.credentials, 'include')
  assert.deepEqual(JSON.parse(String(calls[1][1]?.body)), { board_id: 'b-1', version_id: 'v-9' })
})

test('the Board proxy allows only its own browser origin to reach history', () => {
  const own = new Request('https://board.tacticsjournal.com/api/board/history?board_id=b-1', {
    method: 'POST',
    headers: { Origin: 'https://board.tacticsjournal.com', 'Content-Type': 'application/json' },
    body: JSON.stringify({ board_id: 'b-1', version_id: 'v-1' }),
  })
  const upstream = upstreamRequest(own, { path: 'history' })
  assert.ok(upstream)
  assert.equal(new URL(upstream.url).pathname, '/api/board/history')
  assert.equal(new URL(upstream.url).search, '?board_id=b-1')

  const foreign = new Request('https://board.tacticsjournal.com/api/board/history?board_id=b-1', {
    method: 'POST',
    headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json' },
    body: JSON.stringify({ board_id: 'b-1', version_id: 'v-1' }),
  })
  assert.equal(upstreamRequest(foreign, { path: 'history' }), null)
})

test('a failed history response surfaces the bounded server message', async () => {
  const named = createBoardHistoryApi((async () => responseOf({ error: 'x'.repeat(400) }, false, 403)) as unknown as typeof fetch)
  await assert.rejects(named.list('b-1'), (error: Error) => error.message.length === 256)
  const bare = createBoardHistoryApi((async () => responseOf(null, false, 500)) as unknown as typeof fetch)
  await assert.rejects(bare.restore('b-1', 'v-1'), (error: Error) => error.message === '500')
})

test('the version list keeps only rows that can be shown and restored', () => {
  assert.equal(parseBoardVersions(null), null)
  assert.equal(parseBoardVersions({ versions: 'nope' }), null)
  const versions = parseBoardVersions({
    versions: [
      { id: 'v-1', name: 'Press', version_at: '2026-01-02T00:00:00.000Z', captured_at: '2026-01-02T00:01:00.000Z' },
      { id: '', name: 'No id', version_at: '2026-01-02T00:00:00.000Z', captured_at: '2026-01-02T00:00:00.000Z' },
      { id: 'v-2', name: 'Bad time', version_at: 'later', captured_at: '2026-01-02T00:00:00.000Z' },
      'not a row',
    ],
  })
  assert.deepEqual(versions, [{
    id: 'v-1', name: 'Press',
    versionAt: '2026-01-02T00:00:00.000Z', capturedAt: '2026-01-02T00:01:00.000Z',
  }])
  assert.equal(parseBoardVersions({ versions: [] })?.length, 0)
})

test('a malformed restore response is refused before anything local changes', () => {
  const good = { id: 'b-1', name: 'Press', scene, updated_at: '2026-01-02T03:04:05.000Z', cursor: 'c', device: null, access: 'owner' }
  assert.equal(parseRestoredBoard({ board: good }, 'b-1')?.name, 'Press')
  assert.equal(parseRestoredBoard({ board: good }, 'b-2'), null, 'another board id is refused')
  assert.equal(parseRestoredBoard({ board: { ...good, access: 'shared' } }, 'b-1'), null)
  assert.equal(parseRestoredBoard({ board: { ...good, scene: { objects: 'no' } } }, 'b-1'), null)
  assert.equal(parseRestoredBoard({ board: { ...good, updated_at: 'whenever' } }, 'b-1'), null)
  assert.equal(parseRestoredBoard({ board: { ...good, name: 7 } }, 'b-1'), null)
  assert.equal(parseRestoredBoard({}, 'b-1'), null)
  assert.equal(parseRestoredBoard({ board: { ...good, name: '  ' } }, 'b-1')?.name, 'Untitled project')
})

test('history belongs to owned synced projects on a signed-in Pro account', () => {
  assert.equal(canOpenBoardHistory(OWNED, PRO), true)
  assert.equal(canOpenBoardHistory(OWNED, { ...PRO, pro: false }), false)
  assert.equal(canOpenBoardHistory(OWNED, { ...PRO, signedIn: false }), false)
  assert.equal(canOpenBoardHistory(OWNED, { ...PRO, selfHosted: true }), false)
  assert.equal(canOpenBoardHistory({ ...OWNED, access: 'shared' }, PRO), false)
  assert.equal(canOpenBoardHistory({ ...OWNED, readOnly: true }, PRO), false)
  assert.equal(canOpenBoardHistory({ ...OWNED, locked: true }, PRO), false)
  assert.equal(canOpenBoardHistory(OWNED, { ...PRO, accountBinding: 'account-2' }), false)
  assert.equal(canOpenBoardHistory({ id: 'b-1' }, PRO), false, 'a row that never synced has no versions')
  assert.equal(canOpenBoardHistory({ syncAccount: 'account-1' }, PRO), false)
})

test('a version time is shown in the reader\'s own locale, or admits it cannot be', () => {
  assert.equal(versionTimeLabel('nonsense'), 'Date unavailable')
  assert.equal(versionTimeLabel('2026-01-02T03:04:05.000Z'), new Date('2026-01-02T03:04:05.000Z').toLocaleString())
})

test('the saved list offers History only where the policy allows it', () => {
  assert.match(saves, /historyContext: \(\) => BoardHistoryContext = \(\) => \(\{ pro: false, signedIn: false, selfHosted: true, accountBinding: null \}\)/)
  assert.match(saves, /canOpenBoardHistory\(\{ \.\.\.project, locked \}, this\.historyContext\(\)\)[\s\S]*?data-sv="history"[\s\S]*?aria-label="Version history for \$\{safe\}"/)
  // the row action and the opener both consult the policy, so a stale row
  // cannot open a screen it was never allowed to show
  assert.match(saves, /private openHistory\(name: string\): void \{[\s\S]*?if \(!canOpenBoardHistory\(\{ \.\.\.saved, locked \}, this\.historyContext\(\)\)\) return[\s\S]*?this\.onOpenHistory\(/)
  assert.match(saves, /k === 'history'\) this\.openHistory\(btn\.dataset\.name!\)/)
  assert.match(main, /saves\.historyContext = \(\) => \(\{\s*pro: entitlements\.isPro\(\),\s*signedIn: authenticated,\s*selfHosted: BOARD_SELF_HOSTED,\s*accountBinding,\s*\}\)/)
})

test('the Pro offer names version history', () => {
  assert.match(main, /Pro adds automatic cloud sync, version history/)
  assert.match(main, /<li>Restore earlier project versions<\/li>/)
})

test('history is a Settings screen with a back arrow, not a window of its own', () => {
  assert.match(main, /type SetScreen = [^\n]*\| 'history'/)
  assert.match(main, /history: 'Version history'/)
  assert.match(main, /<div class="setPane hidden" data-pane="history">\s*<div data-history-host><\/div>/)
  assert.match(main, /screen === 'history' \? 'boards' : 'root'/)
  assert.match(main, /boardHistory\.open\(target\)\s*showScreen\('history'\)\s*settingsEl\.querySelector<HTMLElement>\('\.setBack'\)\?\.focus\(\)/)
  assert.doesNotMatch(main, /alert\(`?[^`)]*version history/i)
})

test('a restored version goes through the sync store and the usual reconciliation', () => {
  const applied = main.match(/function applyRestoredVersion\(board: RestoredBoard, target: BoardHistoryTarget\): boolean \{[\s\S]*?\n\}/)?.[0] ?? ''
  assert.match(applied, /target\.accountBinding !== accountBinding\) return false/)
  assert.match(applied, /if \(!saves\.flushCurrentForSync\(\)\) return false/)
  assert.match(applied, /syncStore\.upsert\(\{[\s\S]*?id: board\.id,[\s\S]*?savedAt: board\.updatedAt,[\s\S]*?scene: board\.scene,[\s\S]*?syncAccount: accountBinding/)
  assert.match(applied, /if \(!stored\) return false/)
  assert.match(applied, /reconcileProjectSync\(rowsBeforeRestore, \{[\s\S]*?remoteIds: \[board\.id\]/)
  // success is announced where the reader is put down, not in a pane that is
  // about to be hidden
  assert.match(main, /onDone: \(message, boardId\) => \{\s*showScreen\('boards'\)\s*saves\.refresh\(\)\s*saves\.announce\(message\)/)
  assert.match(saves, /announce\(message: string\): void \{ this\.showStatus\(message\) \}/)
  assert.match(main, /if \(screen === 'history' && !\(authenticated && entitlements\.isPro\(\) && !BOARD_SELF_HOSTED\)\) showScreen\('boards'\)/)
})

test('the history screen keeps its states, its confirmation and its live region', () => {
  const panel = readFileSync(new URL('../src/board-history.ts', import.meta.url), 'utf8')
  assert.match(panel, /data-history-status role="status" aria-live="polite"/)
  assert.match(panel, /aria-busy/)
  assert.match(panel, /Loading earlier versions…/)
  assert.match(panel, /data-history="retry"[\s\S]*?Try again/)
  assert.match(panel, /No earlier versions yet/)
  assert.match(panel, /On this device now[\s\S]*?histCurrent[\s\S]*?Current/)
  // one confirmation, in place, before the POST; and no second action while
  // the first is in flight
  assert.match(panel, /this\.confirming === version\.id[\s\S]*?Replace the current project\?[\s\S]*?data-history="restore"/)
  assert.match(panel, /if \(!target \|\| this\.restoring \|\| this\.confirming !== versionId\) return/)
  assert.match(panel, /busy \? ' disabled' : ''/)
  assert.match(panel, /event\.key !== 'Escape' \|\| !this\.confirming[\s\S]*?event\.stopPropagation\(\)/)
  // the endpoint sends no scenes, so the screen must not pretend to preview one
  assert.doesNotMatch(panel, /previewSvg|sceneShapesSvg/)
  assert.match(css, /\.histItem \{/)
  assert.match(css, /@media \(max-width: 430px\) \{[\s\S]*?\.histItem \{ flex-wrap: wrap;[\s\S]*?\.histConfirm \{ flex-basis: 100%/)
})
