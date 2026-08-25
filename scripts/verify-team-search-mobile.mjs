// Phone-sized check of the Teams picker with the on-screen keyboard up: the
// query, the side it belongs to, and the first result all have to stay on
// screen and stay tappable. Chromium has no keyboard, so the shortened
// visual viewport is emulated by shrinking the window while a field is
// focused, which is the state the board reacts to.
import { chromium } from 'playwright-core'
import { chromePath } from './lib/chrome.mjs'

const URL_BASE = process.env.BOARD_URL ?? 'http://localhost:4173/'
const TALL = { width: 390, height: 844 }
const KEYBOARD_VIEW = 265 // what an iPhone leaves above the keys

const browser = await chromium.launch({ executablePath: chromePath, headless: true })
const ctx = await browser.newContext({ viewport: TALL, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })
const page = await ctx.newPage()
const errors = []
page.on('pageerror', e => errors.push(`pageerror: ${e.message}`))

// the endpoint is not what is under test: answer it empty so the shipped
// index supplies the rows and the run works offline
await page.route('**/searchteams.php*', route => route.fulfill({ status: 200, contentType: 'application/json', body: '{"teams":[]}' }))

await page.goto(URL_BASE)
await page.waitForTimeout(800)

await page.click('[data-bar="settings"]')
await page.waitForTimeout(200)
await page.locator('[data-goto="teams"]').first().click()
await page.waitForTimeout(250)

// go to Away, so a wrong-side pick would be a real mistake
await page.click('[data-tm="pick-side"][data-side="away"]')
await page.waitForTimeout(150)
await page.click('[data-tm="query"]')
// iOS does not shrink the window when the keyboard opens, it shrinks the
// visual viewport and scrolls the page under the keys. Chromium has no
// keyboard, so the visual viewport is stubbed to the same shape.
await page.evaluate((h) => {
  const vv = window.visualViewport
  Object.defineProperty(vv, 'height', { configurable: true, get: () => h })
  window.__shrinkViewport = (next) => {
    Object.defineProperty(vv, 'height', { configurable: true, get: () => next })
    vv.dispatchEvent(new Event('resize'))
  }
  vv.dispatchEvent(new Event('resize'))
}, KEYBOARD_VIEW)
await page.waitForTimeout(200)
await page.type('[data-tm="query"]', 'Ar', { delay: 60 })
await page.waitForTimeout(900) // debounce, endpoint, and the smooth scroll

const view = await page.evaluate(() => {
  const vv = window.visualViewport
  const top = vv?.offsetTop ?? 0
  const bottom = top + (vv?.height ?? window.innerHeight)
  const box = (el) => {
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { top: r.top, bottom: r.bottom, left: r.left, height: r.height, width: r.width }
  }
  const input = document.querySelector('[data-tm="query"]')
  const row = document.querySelector('.tmTeam')
  const hit = row ? (() => {
    const r = row.getBoundingClientRect()
    const el = document.elementFromPoint(r.left + r.width / 2, r.top + Math.min(r.height, 40) / 2)
    return !!el && !!el.closest('.tmTeam')
  })() : false
  return {
    top,
    bottom,
    kbOpen: document.body.classList.contains('kb-open'),
    focused: document.activeElement === input,
    value: input?.value ?? '',
    sideTag: document.querySelector('.tmSearchSide')?.textContent?.trim() ?? '',
    sideTagVisible: !!document.querySelector('.tmSearchSide')?.getClientRects().length,
    input: box(input),
    row: box(row),
    rowName: row?.querySelector('.tmTeamName')?.textContent?.trim() ?? '',
    rows: document.querySelectorAll('.tmTeam').length,
    hit,
  }
})
console.log('viewport state:', JSON.stringify(view, null, 1))

const visible = (b) => b && b.top >= view.top - 0.5 && b.bottom <= view.bottom + 0.5
if (!view.kbOpen) errors.push('short viewport while editing did not set body.kb-open')
if (!view.focused) errors.push('the search field lost focus while results arrived')
if (view.value !== 'Ar') errors.push(`the typed query was lost: ${JSON.stringify(view.value)}`)
if (!view.rows) errors.push('no results rendered for "Ar"')
if (!visible(view.input)) errors.push(`the query is off screen: ${JSON.stringify(view.input)}`)
if (!visible(view.row)) errors.push(`the first result is off screen: ${JSON.stringify(view.row)}`)
if (!view.hit) errors.push('the first result is not the element at its own centre')
if (view.sideTag !== 'Away' || !view.sideTagVisible) errors.push(`the side of the field is not shown: ${view.sideTag}`)

// tapping the first row with the keyboard still up starts that squad load
const picked = view.rowName
await page.click('.tmTeam')
const answered = await page.locator('.tmResults .tmEmpty')
  .waitFor({ timeout: 8000 }).then(() => true).catch(() => false)
const after = await page.evaluate(() => ({
  results: document.querySelector('.tmResults')?.textContent?.trim().slice(0, 60) ?? '',
  gated: document.body.classList.contains('board-viewport-too-small'),
}))
console.log('after tap:', JSON.stringify(after), 'picked:', picked)
if (!answered) errors.push(`tapping ${picked} did not start a squad load`)
if (after.gated) errors.push('the keyboard-short viewport tripped the "screen too small" gate')

// keyboard down: the condensed state has to let go
await page.evaluate(() => window.__shrinkViewport(window.innerHeight))
await page.waitForTimeout(300)
const relaxed = await page.evaluate(() => document.body.classList.contains('kb-open'))
if (relaxed) errors.push('kb-open stayed on after the keyboard closed')

await browser.close()
if (errors.length) {
  console.error('FAIL\n' + errors.join('\n'))
  process.exit(1)
}
console.log('team search stays visible with the keyboard up: OK')
