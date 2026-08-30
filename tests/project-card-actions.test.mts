// The project card's own actions. What matters here is that the library shows
// only what the account may use, that the count it draws comes from one read,
// and that nothing about eligibility is decided by the library itself.

import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

import { createBoardProposalsApi, parseBoardProposalCounts } from '../src/board-proposals.ts'

const saves = readFileSync(new URL('../src/saves.ts', import.meta.url), 'utf8')
const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8')
const view = readFileSync(new URL('../src/boards-view.ts', import.meta.url), 'utf8')
const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8')

function responseOf(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body } as unknown as Response
}

test('the counts answer keeps only boards with something waiting', () => {
  assert.equal(parseBoardProposalCounts(null), null)
  assert.equal(parseBoardProposalCounts({ counts: [] }), null)
  assert.deepEqual(parseBoardProposalCounts({ counts: {} }), {})
  assert.deepEqual(
    parseBoardProposalCounts({ counts: { 'b-1': 2, 'b-2': 0, 'b-3': 'many', 'b-4': 1.7, '': 3 } }),
    { 'b-1': 2, 'b-4': 1 },
  )
})

test('the counts read is one request, with the session cookie', async () => {
  const calls: [string, RequestInit | undefined][] = []
  const api = createBoardProposalsApi((async (input: any, init: any) => {
    calls.push([String(input), init])
    return responseOf({ counts: { 'b-1': 1 } })
  }) as unknown as typeof fetch)
  assert.deepEqual(await api.counts(), { 'b-1': 1 })
  assert.equal(calls.length, 1)
  assert.equal(calls[0][0], '/api/board/proposals')
  assert.equal(calls[0][1]?.credentials, 'include')
})

test('eligibility stays in saves, where the two screens are governed', () => {
  const actions = saves.slice(saves.indexOf('projectActions(projectId: string)'), saves.indexOf('private openProposals('))
  assert.match(actions, /migrateProject\(saved\.scene\)\?\.id === projectId/)
  assert.match(actions, /const history = canOpenBoardHistory\(row, context\)/)
  assert.match(actions, /const proposals = canReviewBoardProposals\(row, context\)/)
  assert.match(actions, /if \(!history && !proposals\) return none/)
  assert.match(actions, /editableBoardNames\(all, hasPaidBoardAccess\(\)\)/)
})

test('the card carries one menu button and, only when it is news, a chip', () => {
  assert.match(view, /data-act="proj-menu"[\s\S]*?aria-label="More for \$\{escapeText\(project\.name\)\}"/)
  assert.doesNotMatch(view, /data-act="rename" data-id/, 'rename moved into the menu')
  assert.doesNotMatch(view, /data-act="del-project" data-id/, 'delete moved into the menu')
  const chip = view.slice(view.indexOf('private waitingChip(projectId: string'), view.indexOf('private projectMenu('))
  assert.match(chip, /if \(waiting < 1\) return ''/)
  assert.match(chip, /waiting === 1 \? '1 waiting'/)
})

test('the menu offers only what the account may use, and never sells Pro', () => {
  const menu = view.slice(view.indexOf('private projectMenu(projectId: string'), view.indexOf('private onProjectSheetClick('))
  assert.match(menu, /const actions = this\.host\.projectActions\(projectId\)/)
  assert.match(menu, /\$\{actions\.history \? `<button class="projOpt" data-proj="history"/)
  assert.match(menu, /\$\{actions\.proposals \? `<button class="projOpt" data-proj="proposals"/)
  assert.match(menu, /data-proj="rename"/)
  assert.match(menu, /data-proj="delete"/)
  assert.doesNotMatch(menu, /openPro|Pro\b/, 'an unavailable action is absent, not an advert')
  // a sheet, for the reason Add board is a sheet
  assert.match(menu, /sheet\.className = 'modal projSheet'/)
  assert.match(menu, /role="dialog" aria-modal="true"/)
  assert.match(view, /if \(e\.key === 'Escape'\) \{ e\.stopPropagation\(\); this\.closeProjectSheet\(true\) \}/)
  assert.match(view, /if \(!button\) \{ if \(target === this\.projSheet\) this\.closeProjectSheet\(true\); return \}/)
})

test('the library asks the host to open the screens, and never decides itself', () => {
  assert.match(view, /openProjectHistory: \(projectId: string\) => void/)
  assert.match(view, /openProjectProposals: \(projectId: string\) => void/)
  const opener = main.match(/function openProjectScreen\(projectId: string, screen: 'history' \| 'proposals'\): void \{[\s\S]*?\n\}/)?.[0] ?? ''
  assert.match(opener, /if \(!actions\.target\) return/)
  assert.match(opener, /if \(screen === 'history' \? !actions\.history : !actions\.proposals\) return/)
  assert.match(opener, /boardsView\.close\(\)/)
  assert.match(opener, /openSettings\(screen\)/)
  assert.match(opener, /boardHistory\.open\(actions\.target\)/)
  assert.match(opener, /boardProposals\.start\(actions\.target\)/)
})

test('counts are read when the library opens, by an account that can have them', () => {
  const refresh = main.match(/async function refreshProposalCounts\(\): Promise<void> \{[\s\S]*?\n\}/)?.[0] ?? ''
  assert.match(refresh, /if \(BOARD_SELF_HOSTED \|\| !authenticated \|\| !entitlements\.isPro\(\) \|\| !accountBinding\)/)
  assert.match(refresh, /proposalCounts = await createBoardProposalsApi\(\)\.counts\(\)/)
  assert.match(refresh, /catch \{\s*proposalCounts = \{\}/, 'a failed read says nothing rather than guessing')
  assert.match(refresh, /boardsView\.refreshProjects\(\)/)
  assert.match(main, /boardsView\.open\('projects'\)\s*void refreshProposalCounts\(\)/)
})

test('the chip and the menu have styles of their own in both themes', () => {
  assert.match(css, /\.projWait \{[\s\S]*?color: var\(--propose\);/)
  assert.match(css, /\.projOpt \{[\s\S]*?min-height: 46px;/)
  assert.match(css, /\.projOptDanger, \.projOptDanger svg \{ color: #c2554b; \}/)
})
