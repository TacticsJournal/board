// Pro gating + waitlist, two phases:
//  A. forced free tier (tbm-force-free): import locked to Settings, pitch
//     picker and background upload locked, waitlist form posts to the TJ
//     subscribe worker (intercepted), transfer export/import roundtrip.
//  B. dev unlock (plain localhost): everything open, pitch switching
//     resizes the board, classic clean pitch available, export follows.
import { chromium } from 'playwright-core'
import { chromePath } from './lib/chrome.mjs'

/** Settings is one list with push screens; step back to root before pushing again. */
const pushScreen = async (page, screen) => {
  const atRoot = await page.evaluate(() => {
    const root = document.querySelector('[data-pane="root"]')
    return !!root && !root.classList.contains('hidden')
  })
  if (!atRoot) { await page.click('.setBack'); await page.waitForTimeout(80) }
  await page.locator(`[data-goto="${screen}"]`).first().click()
  await page.waitForTimeout(120)
}


const BASE = process.env.BOARD_URL ?? 'http://localhost:4173/'

const browser = await chromium.launch({
  executablePath: chromePath,
  headless: true,
})
const errors = []
const check = (ok, msg) => { if (!ok) errors.push(msg) }

/* ---------- phase A: free tier ---------- */
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const page = await ctx.newPage()
  page.on('pageerror', e => errors.push(`A pageerror: ${e.message}`))
  await page.addInitScript(() => localStorage.setItem('tbm-force-free', '1'))

  // the form posts to the board's own /api/waitlist Pages Function, which
  // bridges to tacticsjournal.com/api/subscribe in production
  let waitlistPost = null
  await page.route('**/api/waitlist', r => {
    waitlistPost = r.request().postData()
    r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'ok' }),
    })
  })

  await page.goto(BASE)
  await page.waitForTimeout(700)

  check(await page.evaluate(() => window.__tbm.entitlements.isPro()) === false, 'force-free should report free tier')
  const h = await page.evaluate(() => window.__tbm.store.scene.board.h)
  check(h === 618, `free default board should be the watermarked pitch (618), got ${h}`)

  // screenshot import is Pro-only: the button is not rendered at all
  check(await page.evaluate(() => !document.querySelector('[data-top="import"]')),
    'free tier must not render the import button')

  // pitch picker (Configure > Pitch tab): no classic, pro styles tagged and locked
  await page.click('[data-bar="settings"]')
  await pushScreen(page, 'pitch')
  const seg = await page.evaluate(() => ({
    ids: [...document.querySelectorAll('[data-pitch]')].map(b => b.dataset.pitch),
    tags: document.querySelectorAll('[data-pitch] .setTag').length,
  }))
  check(!seg.ids.includes('classic'), `free picker must not list the clean classic pitch (${seg.ids})`)
  check(seg.tags === 3, `expected 3 licensed styles (vertical/training/two pitches), got ${seg.tags}`)
  await page.click('[data-pitch="training"]')
  await page.waitForTimeout(100)
  const afterLockedPick = await page.evaluate(() => ({
    pitch: window.__tbm.store.scene.pitch,
    note: document.querySelector('[data-set-note]').textContent,
  }))
  check(afterLockedPick.pitch === 'pitch', `locked style must not switch the pitch (${afterLockedPick.pitch})`)
  check(/Pro/.test(afterLockedPick.note), `locked pick should explain Pro (${afterLockedPick.note})`)

  // adding a background is locked
  await page.click('[data-bg-add]')
  await page.waitForTimeout(100)
  const bgNote = await page.evaluate(() => document.querySelector('[data-set-note]').textContent)
  check(/License/.test(bgNote), `adding a background should be locked (${bgNote})`)

  // waitlist signup (worker intercepted) on the Pro tab
  await pushScreen(page, 'pro')
  await page.fill('[data-wl-email]', 'test@example.com')
  await page.click('[data-wl-join]')
  await page.waitForTimeout(400)
  check(!!waitlistPost && waitlistPost.includes('test@example.com') && waitlistPost.includes('board-waitlist'),
    `waitlist POST should carry the email and the board-waitlist tag (${waitlistPost})`)
  const joined = await page.evaluate(() => ({
    done: !!document.querySelector('.wlDone'),
    text: document.querySelector('.wlDone')?.textContent || '',
  }))
  check(joined.done, 'waitlist area should switch to the joined state')
  check(/confirm/i.test(joined.text), `joined state should ask to confirm by email (${joined.text})`)
  await page.screenshot({ path: '/tmp/tbm-waitlist-free.png' })
  await page.reload()
  await page.waitForTimeout(600)
  check(await page.evaluate(() => !!document.querySelector('.wlDone')), 'joined state should survive a reload')

  // transfer roundtrip: save -> export -> wipe -> import
  await page.evaluate(() => {
    window.__tbm.store.apply(s => s.objects.push({ id: 'tp1', type: 'player', x: 100, y: 100, r: 13, color: '#e02020', label: '', name: '', namePos: 'bottom', nameSize: 18, nameDisplay: 'last' }))
  })
  const file = await page.evaluate(() => {
    window.__tbm.saves.autosaveCurrent()
    return window.__tbm.saves.exportFile()
  })
  check(JSON.parse(file).boards && Object.keys(JSON.parse(file).boards).length >= 1, 'export file should contain the autosaved board')
  await page.evaluate(() => localStorage.removeItem('tbm-projects-v1'))
  await page.click('[data-bar="settings"]')
  await pushScreen(page, 'boards')
  await page.setInputFiles('[data-boards-file]', { name: 'tactics-boards.json', mimeType: 'application/json', buffer: Buffer.from(file) })
  await page.waitForTimeout(200)
  const xfer = await page.evaluate(() => ({
    note: document.querySelector('[data-set-note]').textContent,
    boards: Object.keys(JSON.parse(localStorage.getItem('tbm-projects-v1') ?? '{}')).length,
  }))
  check(/Imported 1 board/.test(xfer.note), `import note should report 1 board (${xfer.note})`)
  check(xfer.boards === 1, `boards should be restored after import (${xfer.boards})`)
  console.log('phase A (free tier): done')
  await ctx.close()
}

/* ---------- phase B: dev unlock ---------- */
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const page = await ctx.newPage()
  page.on('pageerror', e => errors.push(`B pageerror: ${e.message}`))
  await page.goto(BASE)
  await page.waitForTimeout(700)

  check(await page.evaluate(() => window.__tbm.entitlements.isPro()) === true, 'localhost should be dev-unlocked')
  await page.click('[data-bar="settings"]')
  await pushScreen(page, 'pitch')
  const ids = await page.evaluate(() => [...document.querySelectorAll('[data-pitch]')].map(b => b.dataset.pitch))
  check(ids.includes('classic'), `dev picker should include the clean classic pitch (${ids})`)
  check(await page.evaluate(() => document.querySelectorAll('[data-pitch] .setTag').length) === 0, 'no Pro tags when unlocked')

  const expectH = { 'pitch-up': 640, sidebyside: 533, classic: 418, pitch: 618 }
  for (const [id, want] of Object.entries(expectH)) {
    await page.click(`[data-pitch="${id}"]`)
    await page.waitForTimeout(250)
    const got = await page.evaluate(() => ({ scene: window.__tbm.store.scene.board.h, board: window.__tbm.board.boardH }))
    check(got.scene === want && got.board === want, `${id}: board should be ${want}, got ${JSON.stringify(got)}`)
  }

  // export keeps 2048px width and follows the current aspect
  await page.click('[data-pitch="pitch-up"]')
  await page.waitForTimeout(250)
  const dims = await page.evaluate(() => new Promise(res => {
    const url = window.__tbm.board.exportPng()
    const img = new Image()
    img.onload = () => res({ w: img.naturalWidth, h: img.naturalHeight })
    img.src = url
  }))
  check(dims.w === 2048 && Math.abs(dims.h - 1638) <= 2, `vertical export should be 2048x~1638, got ${JSON.stringify(dims)}`)

  // import opens directly, upload works
  await page.click('[data-set="close"]')
  await page.click('[data-top="import"]')
  await page.waitForTimeout(150)
  check(await page.evaluate(() => !document.querySelector('[data-imp="file"]').closest('.modal').classList.contains('hidden')),
    'dev import tap should open the importer')
  await page.evaluate(() => document.querySelector('[data-imp="file"]').closest('.modal').classList.add('hidden'))
  await page.click('[data-bar="settings"]')
  await page.setInputFiles('[data-set-file]', new URL('./fixtures/match-real.jpg', import.meta.url).pathname)
  await page.waitForTimeout(900)
  const bgNote = await page.evaluate(() => document.querySelector('[data-set-note]').textContent)
  check(/Background applied and saved/.test(bgNote), `dev bg upload should work (${bgNote})`)
  check(await page.evaluate(() => window.__tbm.store.scene.pitch.startsWith('bg:')), 'the upload should go behind the board')

  // The old production ?pro=dev/localStorage unlock is retired. Localhost is
  // still unlocked, but the stale key is removed so it cannot leak to prod.
  await page.evaluate(() => localStorage.setItem('tbm-pro-v1', 'dev'))
  await page.goto(new URL('?pro=dev', BASE).href)
  await page.waitForTimeout(300)
  check(await page.evaluate(() => localStorage.getItem('tbm-pro-v1')) === null, '?pro=dev must not preserve the old production unlock key')
  check(await page.evaluate(() => window.__tbm.entitlements.isPro()) === true, 'localhost remains dev-unlocked without ?pro=dev')
  console.log('phase B (dev unlock): done')
  await ctx.close()
}

await browser.close()
if (errors.length) { console.log('ERRORS:\n' + errors.join('\n')); process.exit(1) }
console.log('OK')
