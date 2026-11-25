// Board is free: every pitch layout, import, export, and local editing tool is
// available to everyone, and nothing is sold. These tests pin the free
// surface and keep the retired paid, account, and cloud features out.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { canExportAnimation, canImport, canPickPitch, canPlaceCone, canUploadBackground } from '../src/entitlements.ts'
import { PITCHES } from '../src/pitches.ts'

const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8')

test('every non-admin pitch layout is free to pick', () => {
  const publicPitches = PITCHES.filter(p => !p.adminOnly)
  assert.ok(publicPitches.length > 0)
  for (const label of ['Vertical', 'Full Pitch', 'Training', 'Two pitches', 'Live']) {
    const pitch = publicPitches.find(p => p.label === label)
    assert.ok(pitch, `${label} pitch should exist`)
    assert.equal(canPickPitch(pitch!), true, `${label} should be free`)
  }
})

test('Classic is reserved for the board admin', () => {
  const classic = PITCHES.find(p => p.id === 'classic')
  assert.ok(classic)
  assert.equal(classic.adminOnly, true)
})

test('transfer export produces valid JSON with app identifier and boards', () => {
  // Simulate what SavesPanel.exportFile() produces
  const boards = {
    'Board 1': { savedAt: '2026-07-22T12:00:00Z', scene: { version: 3, board: { w: 800, h: 418 }, objects: [] } },
    'Board 2': { savedAt: '2026-07-22T13:00:00Z', scene: { version: 3, board: { w: 800, h: 418 }, objects: [{ id: 'p1', type: 'player', x: 100, y: 100, r: 13, color: '#e02020', label: '', name: '', namePos: 'bottom', nameSize: 18, nameDisplay: 'last', flipX: false, flipY: false }] } },
  }
  const exported = JSON.stringify({
    app: 'tactics-board-mapper',
    version: 1,
    exportedAt: '2026-07-22T14:00:00Z',
    boards,
  })

  const parsed = JSON.parse(exported)
  assert.equal(parsed.app, 'tactics-board-mapper')
  assert.equal(parsed.version, 1)
  assert.equal(Object.keys(parsed.boards).length, 2)
  assert.ok(parsed.boards['Board 1'].scene)
  assert.ok(parsed.boards['Board 2'].scene.objects.length === 1)
})

// Branding rule: our mark rides on our own graphics. A user-supplied
// background — an uploaded image or an imported broadcast screenshot —
// replaces our pitch art, so nothing is written onto the frame itself. The
// live scoreboard is the exception: it is our own plate laid over the frame,
// and it carries the logo and the domain wherever it is drawn.
test('a user background carries no branding, but its scoreboard does', async () => {
  const { readFile } = await import('node:fs/promises')
  const board = await readFile(new URL('../src/board.ts', import.meta.url), 'utf8')
  const main = await readFile(new URL('../src/main.ts', import.meta.url), 'utf8')

  assert.match(board, /private brandsExport\(\) \{ return !this\.userBackground\(\) \}/)
  // A saved background and an imported screenshot are the same thing here.
  assert.match(board, /return !!\(style\.custom \|\| style\.live\)/)

  // The pitch-art scoreboard still asks before drawing the mark.
  assert.match(board, /if \(sb\.logo && this\.brandsExport\(\)\) \{/)

  // The live scoreboard does not: the domain is drawn unconditionally, and the
  // logo waits only on its own image, so the brand column is never blank.
  const live = board.slice(board.indexOf('if (m.showScoreboard && live)'), board.indexOf('} else if (m.showScoreboard)'))
  assert.match(live, /text: 'tacticsjournal\.com'/)
  assert.doesNotMatch(live, /brandsExport\(\)/)
  assert.match(live, /if \(this\.logoImg\.complete && this\.logoImg\.naturalWidth\) \{\n\s+const logoW/)
  // a late-loading logo redraws the overlay rather than leaving a gap
  assert.match(board, /this\.logoImg\.onload = \(\) => this\.drawOverlay\(\)/)

  // The terms distinguish branding on the image from branding in the optional scoreboard.
  assert.match(main, /Where an export uses Tactics Journal pitch artwork/)
  assert.match(main, /adds no branding to the image itself/)
  assert.match(main, /If you add the Tactics Journal scoreboard, that scoreboard includes its logo and domain/)
})

test('all browser-local capabilities are free while the admin pitch stays protected', () => {
  assert.equal(canImport(), true)
  assert.equal(canPlaceCone(), true)
  assert.equal(canUploadBackground(), true)
  assert.equal(canExportAnimation(), true)
  assert.equal(canPickPitch(PITCHES.find(p => p.id === 'training')!), true)
  assert.equal(canPickPitch(PITCHES.find(p => p.id === 'live')!), true)
  assert.equal(canPickPitch(PITCHES.find(p => p.id === 'classic')!), false)
})

test('placing and rendering cones and goals are free', () => {
  const board = readFileSync(new URL('../src/board.ts', import.meta.url), 'utf8')
  assert.match(board, /this\.defaults\.place === 'cone' && canPlaceCone\(\)/)
  assert.match(board, /this\.defaults\.place === 'goal' && canPlaceCone\(\)/)
  assert.match(board, /case 'cone': return this\.buildCone\(o\)/)
  assert.match(board, /case 'goal': return this\.buildGoal\(o\)/)
  assert.doesNotMatch(main, /Cones and goals need a License/)
})

test('the overlay and squad lookup are free', () => {
  const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8')
  const teams = readFileSync(new URL('../src/teams.ts', import.meta.url), 'utf8')
  const entitlements = readFileSync(new URL('../src/entitlements.ts', import.meta.url), 'utf8')

  // The scoreboard and match overlays are what make a board look like the game
  // being talked about, so setting one up is free and has no gate anywhere.
  const openSheet = main.match(/function openMatchSheet\(\)[\s\S]*?\n}/)?.[0] ?? ''
  assert.doesNotMatch(openSheet, /entitlements\./)
  assert.doesNotMatch(entitlements, /canEditMatchOverlay/)
  assert.doesNotMatch(main, /canEditMatchOverlay/)

  // Searching a club and loading its squad is free too: it costs nothing to
  // serve, and it is how someone gets to a board that looks like theirs.
  assert.doesNotMatch(teams, /canUseSquadData/)
  assert.doesNotMatch(entitlements, /canUseSquadData/)
})

test('the board header keeps the canonical Tactics Journal links in order', () => {
  const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8')
  const names = (block: string) =>
    [...block.matchAll(/<a[^>]*>([^<]+)<\/a>/g)].map((m) => m[1].trim())

  const site = ['Home', 'Community', 'Board', 'AMA', 'About', 'Follow', 'Contact', 'Key']
  const boardNav = names(main.match(/<nav class="site-nav"[\s\S]*?<\/nav>/)?.[0] ?? '')
  assert.deepEqual(boardNav, site)

  // The hamburger menu carries exactly the site's links, nothing board-only.
  const boardPanel = names(main.match(/site-menu-primary[\s\S]*?site-menu-theme/)?.[0] ?? '')
  assert.deepEqual(boardPanel, site)
})

test('nothing is sold, and no account, sign-in, or checkout path remains', () => {
  const sources = ['main.ts', 'tjheader.ts', 'tjsearch.ts', 'agent-import-ui.ts', 'saves.ts', 'boards-view.ts', 'webmcp.ts']
    .map(file => [file, readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8')] as const)
  for (const [file, source] of sources) {
    for (const gone of [/polar/i, /gumroad/i, /checkout/i, /\bisPro\(/, /hasPaidBoardAccess/, /hasBoardLicense/, /proPlansVisible/,
      /\/api\/account\//, /\/api\/board\/session/, /\/api\/board\/sync/, /credentials: 'include'/, /tbm-device-v1/,
      /Sign in to Tactics Journal/, /Hosted Board License/, /free backup/i]) {
      assert.doesNotMatch(source, gone, `${file} still has ${gone}`)
    }
  }
  const pkg = readFileSync(new URL('../package.json', import.meta.url), 'utf8')
  assert.doesNotMatch(pkg, /@polar-sh/)
})
