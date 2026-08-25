// B6: Test premium feature gates — screenshot import, custom backgrounds,
// premium layouts, transfer (export/import file), and that excluded cloud
// and team tools stay out.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import {
  isAutomaticProEnvironment,
  setServerEntitlement,
  hasServerEntitlement,
  resetServerEntitlement,
  canExportAnimation,
} from '../src/entitlements.ts'

import { PITCHES } from '../src/pitches.ts'

import {
  FREE_EDITABLE_BOARD_LIMIT,
  editableBoardNames,
  swapEditableSlot,
} from '../src/saved-board-policy.ts'

// isPro() depends on import.meta.env.DEV (Vite) which is unavailable in
// Node tests. These tests verify the gate logic via the exported pure
// functions (isAutomaticProEnvironment, hasServerEntitlement) and the
// pitch metadata flags directly.

const PRODUCTION = { development: false, hostname: 'board.tacticsjournal.com' }

// -- Entitlement gate tests --

test('screenshot import and background upload gates match isPro logic', () => {
  resetServerEntitlement()
  // canImport/canUploadBackground both return isPro() which is
  // isAutomaticProEnvironment || _serverPro. Test each path.
  assert.equal(isAutomaticProEnvironment(PRODUCTION), false, 'production is not auto-pro')
  assert.equal(hasServerEntitlement(), false, 'no server entitlement')

  setServerEntitlement(true)
  assert.equal(hasServerEntitlement(), true, 'server grants Pro for import/upload')
  resetServerEntitlement()
})

// -- Premium pitch layout tests --

test('pitch metadata correctly marks free vs Pro layouts', () => {
  const free = PITCHES.filter(p => !p.pro && !p.adminOnly)
  const pro = PITCHES.filter(p => p.pro && !p.adminOnly)
  assert.ok(free.length > 0, 'at least one free pitch')
  assert.ok(pro.length > 0, 'at least one Pro pitch')
})

test('expected premium layouts exist: Vertical, Training, Two pitches, Live', () => {
  const expectedPro = ['Vertical', 'Training', 'Two pitches', 'Live']
  for (const label of expectedPro) {
    const pitch = PITCHES.find(p => p.label === label)
    assert.ok(pitch, `${label} pitch should exist`)
    assert.equal(pitch!.pro, true, `${label} should be Pro`)
  }
})

test('Classic is reserved for the board admin account', () => {
  const classic = PITCHES.find(p => p.id === 'classic')
  assert.ok(classic)
  assert.equal(classic.adminOnly, true)
})

// -- Transfer tests (export/import file format) --

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

// -- Excluded features test --

test('no cloud sync, team sharing, or collaborative editing references exist in entitlements', () => {
  // These features are explicitly excluded from Pro per the tracker
  const fns = [isAutomaticProEnvironment, setServerEntitlement, hasServerEntitlement, resetServerEntitlement]
  const source = fns.map(f => f.toString()).join('\n')
  assert.doesNotMatch(source, /cloud.?sync|team.?share|collab|realtime|cloud.?storage/i,
    'no cloud-sync/team-share/collaborative/realtime features in entitlement gates')
})

// -- Saved board Pro restoration --

test('Pro restoration makes all boards editable after downgrade', () => {
  const boards = Object.fromEntries(
    Array.from({ length: 10 }, (_, i) => [`Board ${i}`, { savedAt: new Date(2026, 0, i + 1).toISOString() }])
  )

  // Free: only 3 editable
  const freeEditable = editableBoardNames(boards, false)
  assert.equal(freeEditable.size, FREE_EDITABLE_BOARD_LIMIT)

  // Pro: all 10 editable
  const proEditable = editableBoardNames(boards, true)
  assert.equal(proEditable.size, 10)

  // After swap during free, all still restore with Pro
  const swapResult = swapEditableSlot(boards, [...freeEditable][0], 'Board 0')
  assert.equal(swapResult.ok, true)
  if (swapResult.ok) {
    const postSwapPro = editableBoardNames(swapResult.boards, true)
    assert.equal(postSwapPro.size, 10, 'Pro restores all boards after swap')
  }
})

// Branding rule: our mark rides on our pitch artwork. A user-supplied
// background — an uploaded image or an imported broadcast screenshot —
// replaces our graphics, so it carries no Tactics Journal logo or domain.
test('exports on a user background carry no Tactics Journal branding', async () => {
  const { readFile } = await import('node:fs/promises')
  const board = await readFile(new URL('../src/board.ts', import.meta.url), 'utf8')
  const main = await readFile(new URL('../src/main.ts', import.meta.url), 'utf8')

  assert.match(board, /private brandsExport\(\) \{ return !this\.userBackground\(\) \}/)
  // A saved background and an imported screenshot are the same thing here.
  assert.match(board, /return !!\(style\.custom \|\| style\.live\)/)

  // Both places that draw the mark must be gated on it.
  assert.match(board, /if \(this\.brandsExport\(\)\) \{/)
  assert.match(board, /if \(sb\.logo && this\.brandsExport\(\)\) \{/)

  // No unguarded draw of the domain text survives.
  for (const match of board.matchAll(/text: 'tacticsjournal\.com'/g)) {
    const before = board.slice(0, match.index)
    assert.match(before.slice(-600), /brandsExport\(\)/, 'domain text must sit inside a brandsExport() guard')
  }

  // The terms must state the rule rather than demand the mark unconditionally.
  assert.match(main, /Where an export uses Tactics Journal pitch artwork/)
  assert.match(main, /carries no Tactics Journal branding and no such condition/)
})

// The one-time license and the Pro subscription are separate products. The
// license lifts the paid board gates; it does not grant Pro-only features.
test('a Board license unlocks paid gates without granting Pro', async () => {
  const { hasBoardLicense, hasPaidBoardAccess } = await import('../src/entitlements.ts')
  resetServerEntitlement()

  assert.equal(hasBoardLicense(), false, 'starts fail-closed')
  assert.equal(hasPaidBoardAccess(), false)

  setServerEntitlement(false, true)
  assert.equal(hasBoardLicense(), true, 'server grants the license')
  assert.equal(hasServerEntitlement(), false, 'a license is never Pro')
  assert.equal(hasPaidBoardAccess(), true, 'paid gates open for a license')

  // Pro includes the licence: a Pro subscriber who holds no separate licence
  // entitlement still gets every paid board feature. The flag stays false
  // because it reports what was bought, not what it unlocks.
  setServerEntitlement(true, false)
  assert.equal(hasServerEntitlement(), true)
  assert.equal(hasBoardLicense(), false, 'the flag reports the licence product itself')
  assert.equal(hasPaidBoardAccess(), true, 'Pro is never worth less than a licence')

  // Non-boolean input is coerced to false, and reset clears both products.
  setServerEntitlement('yes' as unknown as boolean, 'yes' as unknown as boolean)
  assert.equal(hasServerEntitlement(), false)
  assert.equal(hasBoardLicense(), false)

  setServerEntitlement(true, true)
  resetServerEntitlement()
  assert.equal(hasServerEntitlement(), false)
  assert.equal(hasBoardLicense(), false)
  assert.equal(hasPaidBoardAccess(), false)
})

test('the license gates paid features including screenshot import', async () => {
  const source = await (await import('node:fs/promises')).readFile(
    new URL('../src/entitlements.ts', import.meta.url), 'utf8')

  // Import follows paid access: the Live board is unlocked by the licence and is
  // useless without its screenshot, so the two must open together.
  assert.match(source, /export function canImport\(\): boolean \{ return hasPaidBoardAccess\(\) \}/)
  assert.match(source, /export function canUploadBackground\(\): boolean \{ return hasPaidBoardAccess\(\) \}/)
  assert.match(source, /return !style\.pro \|\| hasPaidBoardAccess\(\)/)
  // The admin pitch stays closed to both products.
  assert.match(source, /if \(style\.adminOnly\) return hasBoardAdminAccess\(\)/)
})

// Cones are a paid feature. The gate covers placing a new one; a cone already on
// a saved board must keep rendering, stay editable and still export.
test('placing a cone needs paid access, and existing cones are untouched', async () => {
  const { canPlaceCone, hasPaidBoardAccess } = await import('../src/entitlements.ts')
  const { readFile } = await import('node:fs/promises')
  resetServerEntitlement()

  assert.equal(canPlaceCone(), false, 'free cannot place a cone')
  setServerEntitlement(false, true)
  assert.equal(canPlaceCone(), true, 'a licence can place a cone')
  setServerEntitlement(true, false)
  assert.equal(canPlaceCone(), true, 'Pro includes it')
  resetServerEntitlement()
  assert.equal(canPlaceCone(), hasPaidBoardAccess())

  // Enforced where the object is created, not only in the toolbar.
  const board = await readFile(new URL('../src/board.ts', import.meta.url), 'utf8')
  assert.match(board, /this\.defaults\.place === 'cone' && canPlaceCone\(\)/)
  // Rendering, editing and migration of existing cones stay ungated.
  assert.match(board, /case 'cone': return this\.buildCone\(o\)/)
  assert.doesNotMatch(board, /canPlaceCone\(\)[\s\S]{0,80}buildCone/)

  const main = await readFile(new URL('../src/main.ts', import.meta.url), 'utf8')
  assert.match(main, /Cones and goals need a License\. Your saved cones and goals stay on their boards\./)
})

// Goals ride the same licence as cones: placing one is gated, drawing an
// existing one is not.
test('placing a goal needs paid access, and existing goals are untouched', async () => {
  const { readFile } = await import('node:fs/promises')
  const board = await readFile(new URL('../src/board.ts', import.meta.url), 'utf8')
  assert.match(board, /this\.defaults\.place === 'goal' && canPlaceCone\(\)/)
  assert.match(board, /case 'goal': return this\.buildGoal\(o\)/)
  assert.doesNotMatch(board, /canPlaceCone\(\)[\s\S]{0,80}buildGoal/)
})

// The Live board needs an imported screenshot to be usable at all, so whatever
// unlocks the board must also unlock the import.
test('every tier that can pick the Live board can also import into it', async () => {
  const { canImport, canPickPitch } = await import('../src/entitlements.ts')
  const { PITCHES } = await import('../src/pitches.ts')
  const live = PITCHES.find(p => p.id === 'live')!
  assert.ok(live, 'the live pitch exists')

  resetServerEntitlement()
  assert.equal(canPickPitch(live), false, 'free cannot pick it')
  assert.equal(canImport(), false, 'and cannot import')

  for (const [pro, license] of [[false, true], [true, false], [true, true]] as [boolean, boolean][]) {
    setServerEntitlement(pro, license)
    assert.equal(canPickPitch(live), true)
    assert.equal(canImport(), true, 'picking the live board always implies importing')
  }
  resetServerEntitlement()
})

test('the preview plan override can only ever show less, never grant', () => {
  // Production hostname: the query parameter is inert.
  assert.equal(isAutomaticProEnvironment({ development: false, hostname: 'board.tacticsjournal.com' }), false)

  const source = readFileSync(new URL('../src/entitlements.ts', import.meta.url), 'utf8')
  const fn = source.match(/function previewPlan\(\)[\s\S]*?\n}/)?.[0] ?? ''
  // It refuses outright unless the build context already grants Pro, which is
  // development and preview hosts only.
  assert.match(fn, /if \(!buildContextGrantsPro\(\)\) return null/)
  // And it reads nothing but the plan parameter.
  assert.doesNotMatch(fn, /localStorage|sessionStorage|document\.cookie/)

  // `server` exists so a purchase can be tested on a preview: it drops the
  // automatic grant and reports what the account holds, in both directions.
  assert.match(fn, /value === 'server'/)
  const source2 = readFileSync(new URL('../src/entitlements.ts', import.meta.url), 'utf8')
  const pro = source2.match(/export function isPro\(\)[\s\S]*?\n}/)?.[0] ?? ''
  const licence = source2.match(/export function hasBoardLicense\(\)[\s\S]*?\n}/)?.[0] ?? ''
  assert.match(pro, /if \(preview === 'server'\) return _serverPro/)
  assert.match(licence, /if \(preview === 'server'\) return _serverLicense/)
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

test('an existing session reaches the whole app, not just the header', () => {
  const header = readFileSync(new URL('../src/tjheader.ts', import.meta.url), 'utf8')
  const fetchFn = header.match(/function fetchAccountSession\(\)[\s\S]*?\n  }/)?.[0] ?? ''
  // Returning to an existing session is not a sign-in event, so without this
  // the panel knew the visitor held Pro while the rest of the app did not.
  assert.equal((fetchFn.match(/announceSession\(\)/g) ?? []).length, 2)
  assert.match(header, /function announceSession\(\)[\s\S]*?tacticsjournal:auth-changed/)
})

test('the protected author can sign in to Board through the dashboard', () => {
  const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8')
  const header = readFileSync(new URL('../src/tjheader.ts', import.meta.url), 'utf8')

  assert.match(main, /href="https:\/\/dash\.tacticsjournal\.com\/\?signin=board"/)
  assert.match(main, /Sign in as @kyleboas via dashboard/)
  assert.match(header, /window\.open\(DASHBOARD_START, 'tj-dashboard-signin'/)
  assert.match(header, /dashboardStartLink\.addEventListener\('click', startDashboardSignIn\)/)
  assert.match(header, /watchGoogleSignIn\(popup, previousSessionBinding, true\)/)
  assert.match(header, /sessionBinding === previousSessionBinding/)
})

test('nobody is sold what they already hold', () => {
  const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8')

  const licence = main.match(/function renderLicenseCta\(\)[\s\S]*?\n}/)?.[0] ?? ''
  const pro = main.match(/function renderProCta\(\)[\s\S]*?\n}/)?.[0] ?? ''

  // A holder is told what they have and where to change it, and the buy button
  // is cleared rather than left under the card.
  for (const fn of [licence, pro]) {
    assert.match(fn, /manageLink\(\)/)
  }
  assert.match(licence, /cardCta\.innerHTML = ''/)
  assert.match(main, /Manage or cancel on Tactics Journal/)
})

test('a signed-in member is not invited to sign in again', () => {
  const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8')
  const row = main.match(/function renderAccountRow\(\)[\s\S]*?\n}/)?.[0] ?? ''
  assert.match(row, /if \(accountEmail\)/)
  assert.match(row, /Tactics Journal account/)
  // The email comes from the server's session, never from anything local.
  assert.match(main, /accountEmail = data && data\.authenticated === true/)
  assert.doesNotMatch(row, /localStorage|sessionStorage/)
})

test('the board header matches the site header link for link', async () => {
  const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8')
  const site = readFileSync('/home/kyle/tj-board-license/_includes/header.html', 'utf8')

  const names = (block: string) =>
    [...block.matchAll(/<a[^>]*>([^<]+)<\/a>/g)].map((m) => m[1].trim())

  const siteNav = names(site.match(/<nav class="site-nav"[\s\S]*?<\/nav>/)?.[0] ?? '')
  const boardNav = names(main.match(/<nav class="site-nav"[\s\S]*?<\/nav>/)?.[0] ?? '')
  assert.deepEqual(boardNav, siteNav)

  const sitePanel = names(site.match(/site-menu-primary[\s\S]*?site-menu-theme/)?.[0] ?? '')
  const boardPanel = names(main.match(/site-menu-primary[\s\S]*?site-menu-theme/)?.[0] ?? '')
  assert.deepEqual(boardPanel, sitePanel)
})

test('billing is not managed anywhere that cannot manage it', () => {
  const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8')
  // Gumroad never handled this and cannot cancel a Polar subscription.
  assert.doesNotMatch(main, /gumroad/i)
  assert.match(main, /const LICENSE_MANAGE_URL = `\$\{TJ_ORIGIN\}\/settings\/`/)
  assert.match(main, /href="\$\{LICENSE_MANAGE_URL\}" target="_blank" rel="noopener">Manage or cancel on Tactics Journal/)
})

test('production sells the Licence and Pro', () => {
  const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8')
  const checkout = readFileSync(new URL('../src/checkout.ts', import.meta.url), 'utf8')

  assert.match(main, /LICENSE_CHECKOUT_OPEN\s*=\s*true/)
  assert.match(main, /PRO_CHECKOUT_OPEN\s*=\s*true/)
  const licence = main.match(/function renderLicenseCta\(\)[\s\S]*?\n}/)?.[0] ?? ''
  const pro = main.match(/function renderProCta\(\)[\s\S]*?\n}/)?.[0] ?? ''
  assert.match(licence, /licenseCheckoutOpen\(\)/)
  assert.match(licence, /buyButton\([\s\S]*['\"]license['\"]\)/)
  assert.match(pro, /proCheckoutOpen\(\)/)
  assert.match(pro, /Pro is coming soon/)
  assert.match(pro, /buyButton\([\s\S]*['\"]pro_monthly['\"]\)/)
  assert.match(pro, /buyButton\([\s\S]*['\"]pro_yearly['\"]\)/)

  // If the server has not opened an endpoint, the button cannot charge.
  assert.match(checkout, /response\.status === 503/)
  assert.match(checkout, /reason: 'unavailable'/)
})

test('a preview board talks to the sandbox, and production never does', () => {
  const origin = readFileSync(new URL('../src/origin.ts', import.meta.url), 'utf8')

  // Production is the default and the fallback. An unrecognised host, or any
  // failure reading the build context, must resolve to the real site rather
  // than to a sandbox that would quietly show the wrong entitlements.
  assert.match(origin, /catch \{\s*return false\s*\}/)
  assert.match(origin, /isPreviewBuild\(\) \? SANDBOX : PRODUCTION/)

  // Every call to the site goes through it: no origin is hardcoded any more.
  for (const file of ['main.ts', 'tjheader.ts', 'tjsearch.ts', 'sync.ts']) {
    const source = readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8')
    const functional = source
      .split('\n')
      .filter((line) => /https:\/\/tacticsjournal\.com/.test(line))
      .filter((line) => /\/api\/|\/settings\/|const TJ|SYNC_URL|BUY_URL/.test(line))
    assert.deepEqual(functional, [], `${file} still hardcodes the site origin`)
  }
})

test('animation export is a licence feature, and a still image is not', () => {
  resetServerEntitlement()
  assert.equal(canExportAnimation(), false)
  setServerEntitlement(false, true)
  assert.equal(canExportAnimation(), true, 'a licence exports the animation')
  setServerEntitlement(true, false)
  assert.equal(canExportAnimation(), true, 'Pro includes the licence')
  resetServerEntitlement()
})
