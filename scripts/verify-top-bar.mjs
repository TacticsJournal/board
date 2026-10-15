/* The bar above the board, driven the way someone would: read its order, open
   its menu, reorder from Tool settings, reload, and reach Board settings from
   both places it now lives. Run against a preview build:

     npm run build && npm run preview -- --port 4173
     node scripts/verify-top-bar.mjs
*/
import { chromium } from 'playwright-core'
import { chromePath } from './lib/chrome.mjs'

const baseUrl = new URL(process.env.BOARD_URL || 'http://localhost:4173/').href
const DEFAULT_BAR = ['snap', 'export', 'previous-board', 'undo', 'redo', 'boards', 'more', 'note']

const errors = []
const check = (ok, msg) => { if (!ok) errors.push(msg) }
const same = (actual, expected, msg) =>
  check(JSON.stringify(actual) === JSON.stringify(expected), `${msg}: got ${JSON.stringify(actual)}, wanted ${JSON.stringify(expected)}`)

const browser = await chromium.launch({ executablePath: chromePath, headless: process.env.HEADFUL !== '1' })
const ctx = await browser.newContext({ viewport: { width: 430, height: 900 }, isMobile: true, hasTouch: true })
const page = await ctx.newPage()
const pageErrors = []
page.on('pageerror', e => pageErrors.push(String(e)))

const visibleBar = () => page.$$eval('#actionRow > button:not(.hidden)', els => els.map(e => e.dataset.top))

await page.goto(baseUrl, { waitUntil: 'load' })
await page.waitForSelector('#actionRow', { timeout: 20000 })
await page.waitForTimeout(2000)

same(await visibleBar(), DEFAULT_BAR, 'the bar ships in the designed order')
const gaps = await page.$$eval('#actionRow > button:not(.hidden)', els =>
  els.filter(e => e.classList.contains('barGap')).map(e => e.dataset.top))
same(gaps, ['undo', 'boards'], 'the wider gap falls where the run changes kind')

await page.click('#barMoreBtn')
await page.waitForTimeout(350)
// Board settings ships off the bar, so the menu is where it waits.
same(await page.$$eval('#barMenu button', els => els.map(e => e.textContent.trim())),
  ['Board settings', '3D view', 'Extensions', 'Tool settings'],
  'a control off the bar waits in the menu, extension controls included')
const menu = await page.$eval('#barMenu', e => {
  const r = e.getBoundingClientRect()
  return { left: r.left, right: r.right, opacity: Number(getComputedStyle(e).opacity) }
})
check(menu.opacity === 1, 'the menu is on screen once opened')
check(menu.left >= 0 && menu.right <= 430, 'the menu stays inside a phone screen')

await page.click('[data-bar-menu="tools"]')
await page.waitForTimeout(500)
check(await page.$eval('[data-set-title]', e => e.textContent.trim()) === 'Tool settings', 'the menu opens Tool settings')
const listed = await page.$$eval('[data-tools-list] [data-tools-move$=" up"]', els =>
  els.map(e => e.dataset.toolsMove.replace(/ up$/, '')))
check(listed.includes('match'), 'Board settings is listed as a control you may put back on the bar')
check(listed.some(id => id.startsWith('ext:')), 'extension controls are listed too')
check(await page.$eval('[data-tools-list]', e => !e.querySelector('[data-tools-show="more"]')),
  'the menu itself cannot be switched off')

// A row of three controls has to fit on one line of a phone.
const toolRow = await page.$eval('.setToolRow', e => {
  const move = e.querySelector('.setToolMove button').getBoundingClientRect()
  const track = e.querySelector('.mTrack')?.getBoundingClientRect()
  return { height: e.getBoundingClientRect().height, move: move.height, track: track && track.width }
})
check(toolRow.height <= 64, `a Tool settings row is ${toolRow.height}px tall`)
check(toolRow.move <= 32, `a move arrow is ${toolRow.move}px tall`)
check(toolRow.track === 40, `the switch is ${toolRow.track}px wide, not the 40px track`)

await page.click('[data-tools-show="snap"]')
await page.click('[data-tools-move="note up"]')
await page.waitForTimeout(300)
await page.click('[data-set="close"]')
await page.waitForTimeout(400)
const edited = ['export', 'previous-board', 'undo', 'redo', 'boards', 'note', 'more']
same(await visibleBar(), edited, 'the bar follows Tool settings straight away')

// Switched off is not gone: it moved into the menu, and still works there.
await page.click('#barMoreBtn')
await page.waitForTimeout(350)
check(await page.$eval('#barMenu', e => !!e.querySelector('[data-bar-overflow="snap"]')),
  'a control switched off the bar appears in the menu')
const snapWas = await page.$eval('#snapBtn', e => e.classList.contains('active'))
await page.click('[data-bar-overflow="snap"]')
await page.waitForTimeout(250)
check(await page.$eval('#snapBtn', e => e.classList.contains('active')) !== snapWas,
  'the menu row does what the button would have done')
check(await page.$eval('#barMenu', e => e.hidden), 'choosing a control shuts the menu')

await page.reload({ waitUntil: 'load' })
await page.waitForSelector('#actionRow', { timeout: 20000 })
await page.waitForTimeout(2000)
same(await visibleBar(), edited, 'the bar is remembered on this device')

/* Board settings left the bar for two places: the compact strip under the
   bottom nav's Settings tab, and the Settings sheet itself. */
await page.click('#toolbar button[data-room="settings"]')
await page.waitForTimeout(500)
await page.click('[data-quick="board-settings"]')
await page.waitForTimeout(400)
check(await page.$eval('.matchSheet .sheetHead strong', e => e.textContent.trim()) === 'Board settings',
  'the compact strip opens the board settings sheet')
await page.click('[data-match="close"]')
await page.waitForTimeout(300)

await page.click('[data-quick="more"]')
await page.waitForTimeout(600)
await page.click('[data-set="board-settings"]')
await page.waitForTimeout(400)
check(await page.$eval('.matchSheet .sheetHead strong', e => e.textContent.trim()) === 'Board settings',
  'Settings opens the same sheet')

await page.click('[data-match="close"]')
await page.waitForTimeout(200)
await page.click('[data-set="tools-reset"]').catch(() => {})
await page.waitForTimeout(200)

check(pageErrors.length === 0, `the page threw: ${pageErrors.join(' | ')}`)

await browser.close()

if (errors.length) {
  console.error(`verify-top-bar: ${errors.length} problem(s)`)
  for (const error of errors) console.error(`  - ${error}`)
  process.exit(1)
}
console.log('verify-top-bar: ok')
