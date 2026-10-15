/* Appearance, driven the way someone would on a phone: open the panel over the
   board, push into Appearance, drag a slider and watch the board itself follow,
   undo the whole drag in one, pick a colour from the six, and type a number the
   step cannot land on. Run against the dev server, which is where a build
   grants the Pro this screen asks for:

     npm run dev -- --port 5183
     BOARD_URL=http://localhost:5183/ node scripts/verify-appearance.mjs
*/
import { chromium } from 'playwright-core'
import { chromePath } from './lib/chrome.mjs'

const baseUrl = new URL(process.env.BOARD_URL || 'http://localhost:5173/').href

const errors = []
const check = (ok, msg) => { if (!ok) errors.push(msg) }

const browser = await chromium.launch({ executablePath: chromePath, headless: process.env.HEADFUL !== '1' })
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
const page = await ctx.newPage()
const pageErrors = []
page.on('pageerror', e => pageErrors.push(String(e)))

await page.goto(baseUrl, { waitUntil: 'load' })
await page.waitForSelector('#actionRow', { timeout: 20000 })
await page.waitForTimeout(1500)

const look = () => page.evaluate(() => JSON.parse(localStorage.getItem('tbm-scene-v2') || '{}').appearance ?? null)
const boardVisible = async () => page.$eval('#stage', e => {
  const r = e.getBoundingClientRect()
  return r.height > 200 && r.bottom > 0
})

/* The settings room in the band, which is the panel over the board. */
await page.click('[data-room="settings"]')
await page.waitForTimeout(500)
check(await page.$eval('#quickSet', e => !e.classList.contains('hidden')), 'the panel opens over the board')
check(await boardVisible(), 'the board is on screen behind it')

await page.click('[data-quick="appearance"]')
await page.waitForTimeout(400)
check(await page.$eval('.panelNav strong', e => e.textContent.trim()) === 'Appearance',
  'Appearance is a screen inside the panel')
check(await boardVisible(), 'the board is still on screen inside Appearance')
/* The point of the whole move: no sheet ever covers the stage. */
check(await page.$eval('.settingsModal', e => e.classList.contains('hidden')),
  'no full-screen sheet was opened to get here')
/* And no second copy of the board is drawn to stand in for it. */
check(await page.$('#quickSet svg[viewBox^="0 0 800"]') === null, 'there is no preview in the panel')

/* The nav is outside the box that scrolls, so scrolling the list can never
   put a row over it. iOS painted one there while the nav was sticky. */
check(await page.$eval('.panelHead', e => !e.closest('.panelScroll')),
  'the nav is not inside the scrolling body')
const headBefore = await page.$eval('.panelHead', e => e.getBoundingClientRect().top)
await page.evaluate(() => { document.querySelector('.panelScroll').scrollTop = 260 })
await page.waitForTimeout(250)
const headAfter = await page.$eval('.panelHead', e => e.getBoundingClientRect().top)
check(Math.abs(headAfter - headBefore) <= 1, `the nav moved ${Math.round(headAfter - headBefore)}px when the list scrolled`)
const overHead = await page.evaluate(() => {
  const r = document.querySelector('.panelNav').getBoundingClientRect()
  const hit = document.elementsFromPoint(r.left + r.width / 2, r.top + r.height / 2)
  return hit.findIndex(e => e.classList?.contains('panelHead')) < hit.findIndex(e => e.closest?.('.panelScroll'))
    || !hit.some(e => e.closest?.('.panelScroll'))
})
check(overHead, 'nothing from the list paints over the nav')
await page.evaluate(() => { document.querySelector('.panelScroll').scrollTop = 0 })
await page.waitForTimeout(200)

const rows = await page.$$eval('#quickSet .lookRow', els => els.map(e => ({
  key: e.dataset.lookRow,
  ranges: e.querySelectorAll('[data-look-range]').length,
  steppers: e.querySelectorAll('.stepper').length,
  height: e.getBoundingClientRect().height,
})))
check(rows.length >= 4, `expected the player rows, got ${rows.length}`)
check(rows.every(r => r.ranges === 1), 'every numeric row is a slider')
check(rows.every(r => r.steppers === 0), 'no row still carries a stepper')
check(rows.every(r => r.height <= 62), `a row is ${Math.max(...rows.map(r => r.height))}px tall`)

/* More of the list than the sheet ever showed. */
const visibleRows = await page.$$eval('#quickSet .setItem', els => {
  const panel = document.querySelector('.panelScroll').getBoundingClientRect()
  return els.filter(e => {
    const r = e.getBoundingClientRect()
    return r.top >= panel.top - 1 && r.bottom <= panel.bottom + 1
  }).length
})
check(visibleRows >= 4, `only ${visibleRows} rows fit without scrolling`)

/* Groups scroll rather than being divided between six clipped tabs. */
const chips = await page.$$eval('.panelChips button', els => els.map(e => ({
  label: e.textContent.trim(),
  w: e.getBoundingClientRect().width,
})))
check(chips.length === 6, `expected six groups, got ${chips.length}`)
check(chips.every(c => c.w >= 54), 'no group chip is squeezed below its text')

/* Drag the ring, and watch the real board follow the finger. */
const ring = await page.$('[data-look-range="player.outline"]')
const box = await ring.boundingBox()
await page.mouse.move(box.x + box.width * 0.5, box.y + box.height / 2)
await page.mouse.down()
await page.mouse.move(box.x + box.width * 0.85, box.y + box.height / 2, { steps: 12 })
await page.mouse.up()
await page.waitForTimeout(300)

const stored = await look()
check(stored && typeof stored.player?.outline === 'number', 'the drag wrote onto the board')
check(await page.$eval('[data-look-row="player.outline"] [data-look-value]', e => e.textContent.trim()) !== '38%',
  'the row reads back the value it was dragged to')
check(await boardVisible(), 'the board never left the screen during the drag')

/* One drag is one undo entry: one press takes the whole move. */
await page.click('[data-top="undo"]')
await page.waitForTimeout(400)
check((await look())?.player?.outline === undefined,
  'one undo takes the whole drag, back to the board default')

/* A colour is six swatches under its row, not a wheel wedged into the list. */
await page.click('[data-look-color="player.outlineColor"]')
await page.waitForTimeout(300)
const swatches = await page.$$('.lookSwatches .lookSwatch')
check(swatches.length === 6, `expected six swatches, got ${swatches.length}`)
check(await page.$('.lookSwatches .lookMore') !== null, 'the wheel is one tap further, behind More')
await page.click('[data-look-set="player.outlineColor:#f2c744"]')
await page.waitForTimeout(300)
check((await look())?.player?.outlineColor === '#f2c744', 'a swatch sets the colour')

/* Typing reaches a value the step cannot land on. */
await page.click('[data-look-group="arrow"]')
await page.waitForTimeout(300)
await page.click('[data-look-row="arrow.opacity"] [data-look-edit]')
await page.waitForTimeout(200)
check(await page.$('[data-look-row="arrow.opacity"] [data-look-num]') !== null,
  'tapping the value gives you a box')
await page.fill('[data-look-row="arrow.opacity"] [data-look-num]', '0.63')
await page.keyboard.press('Enter')
await page.waitForTimeout(300)
check((await look())?.arrow?.opacity === 0.63, 'a typed value is kept exactly')

/* Type: twenty-one families with nothing fetched, and the rest of Google's
   library behind a search field. The board stays on screen throughout. */
const asked = []
page.on('request', r => { if (/\.woff2/.test(r.url())) asked.push(r.url()) })
await page.click('[data-look-group="type"]')
await page.waitForTimeout(300)
await page.click('[data-panel="font"]')
await page.waitForTimeout(1500)
check(await page.$eval('.panelNav strong', e => e.textContent.trim()) === 'Font',
  'Family pushes to a screen of its own')
check(await boardVisible(), 'the board is still on screen inside Font')
check(await page.$('[data-font-search]') !== null, 'the rest of Google Fonts is searchable')
check(await page.$eval('[data-font-search]', e => !e.closest('.panelScroll')),
  'the search field stays put while the results scroll')
const offline = await page.$$eval('[data-font-preview]', els => els.length)
check(offline === 21, `expected 21 families before any search, got ${offline}`)

/* A row must be fetched before it is reached, or every name reads in the
   fallback and the list says nothing. What is saved is the second weight,
   which no row here draws: choosing a family is what fetches its bold. */
check(asked.length >= 8, `only ${asked.length} families were fetched for a list of twenty-one`)
check(!asked.some(u => /-700\.woff2$|-latin-700-normal\.woff2$/.test(u)),
  `a preview row fetched a bold nothing on the screen draws: ${asked.filter(u => /700/.test(u)).join(', ')}`)

await page.fill('[data-font-search]', 'playfair')
await page.waitForTimeout(900)
const found = await page.$$eval('[data-font-preview]', els => els.map(e => e.dataset.fontPreview))
check(found.includes('playfair-display'), `search did not find Playfair Display: ${found.slice(0, 5).join(', ')}`)

/* And a result reads in its own face, which is the whole point of the row: a
   name is a poor description of a face, and every name in one face is none. */
await page.fill('[data-font-search]', 'a')
await page.waitForTimeout(2500)
const set = await page.$$eval('[data-font-preview]', els =>
  els.slice(0, 8).map(e => ({ id: e.dataset.fontPreview, family: e.style.fontFamily })))
const own = set.filter(r => r.family && !r.family.startsWith('Inter'))
check(set.length === 8 && own.length >= 6,
  `only ${own.length} of the first eight results are drawn in their own face: ${set.map(r => `${r.id}=${r.family || 'none'}`).join(' | ')}`)
await page.fill('[data-font-search]', 'playfair')
await page.waitForTimeout(900)
await page.click('[data-look-set="font:playfair-display"]')
await page.waitForTimeout(1200)
check((await look())?.font === 'playfair-display', 'a searched family is set on the board')
/* Chosen, its file is fetched and registered, which is what an export embeds.
   Measured rather than asked: document.fonts.check() answers true for a family
   that does not exist, so it can only ever confirm itself. Type that has
   arrived is type that measures differently from the fallback. */
const measure = family => page.evaluate(f => {
  const c = document.createElement('canvas').getContext('2d')
  c.font = `700 40px ${f}`
  return Math.round(c.measureText('Rodrigo Bentancur').width)
}, family)
const drawn = await measure('"Playfair Display", serif')
const fallback = await measure('serif')
check(drawn !== fallback, `Playfair Display measures ${drawn}px, the same as the fallback: it never loaded`)
check(await page.$eval('[data-look-set="font:playfair-display"]', e => e.getAttribute('aria-pressed') === 'true'),
  'the chosen row is marked without rebuilding the search')
check(await page.$eval('[data-font-search]', e => e.value) === 'playfair',
  'and what was typed is still there')

await page.click('[data-panel="back"]')
await page.waitForTimeout(400)
check(await page.$eval('.panelNav strong', e => e.textContent.trim()) === 'Appearance',
  'back from Font returns to Appearance, not to the root')
check(await page.$eval('[data-panel="font"] .setItemValue', e => e.textContent.trim()) === 'Playfair Display',
  'and the Family row says what the board is set in')

/* Back returns to the panel it was pushed from, not to a closed panel. */
await page.click('[data-panel="back"]')
await page.waitForTimeout(400)
check(await page.$('[data-quick="appearance"]') !== null, 'back returns to the panel root')
check(await page.$eval('[data-quick="appearance"] .setItemValue', e => e.textContent.trim()) === 'Styled',
  'the root row says the board is styled')

/* A free account styles its board like any other local edit. Pro is what
   carries it off the device, and the appearance travels on the board. */
await page.goto(`${baseUrl}?plan=free`, { waitUntil: 'load' })
await page.waitForSelector('#actionRow', { timeout: 20000 })
await page.waitForTimeout(1500)
await page.click('[data-room="settings"]')
await page.waitForTimeout(400)
await page.click('[data-quick="appearance"]')
await page.waitForTimeout(400)
check(await page.$('.panelLock') === null, 'a free account is not shown a lock')
check(await page.$eval('.panelList', e => !e.hasAttribute('inert')), 'and the list is live')
const freeRange = await page.$('[data-look-range="player.outline"]')
const fb = await freeRange.boundingBox()
await page.mouse.move(fb.x + fb.width * 0.5, fb.y + fb.height / 2)
await page.mouse.down()
await page.mouse.move(fb.x + fb.width * 0.8, fb.y + fb.height / 2, { steps: 10 })
await page.mouse.up()
await page.waitForTimeout(300)
check(typeof (await look())?.player?.outline === 'number', 'and a free account can actually style the board')

/* The board keeps a floor. A short window is the normal case on a phone, where
   the browser's own chrome takes a third of the screen before the app starts. */
for (const height of [560, 640, 844]) {
  const short = await ctx.newPage()
  await short.goto(baseUrl, { waitUntil: 'load' })
  await short.setViewportSize({ width: 390, height })
  await short.waitForSelector('#actionRow', { timeout: 20000 })
  await short.waitForTimeout(1200)
  await short.click('[data-room="settings"]')
  await short.waitForTimeout(300)
  await short.click('[data-quick="appearance"]')
  await short.waitForTimeout(500)
  const m = await short.evaluate(() => {
    const q = document.querySelector('#quickSet').getBoundingClientRect()
    const w = document.querySelector('.workArea').getBoundingClientRect()
    return { work: Math.round(w.height), board: Math.round(q.top - w.top), panel: Math.round(q.height) }
  })
  check(m.board >= Math.min(160, m.work * 0.35),
    `at ${height}px the board is left ${m.board}px of ${m.work}`)
  check(m.panel >= 150, `at ${height}px the panel is only ${m.panel}px`)
  await short.close()
}

check(pageErrors.length === 0, `the page threw: ${pageErrors.join(' | ')}`)

await browser.close()

if (errors.length) {
  console.error(`verify-appearance: ${errors.length} problem(s)`)
  for (const error of errors) console.error(`  - ${error}`)
  process.exit(1)
}
console.log('verify-appearance: ok')
