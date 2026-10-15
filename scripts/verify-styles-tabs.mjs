/* Styles, a tab at a time: draw a zone, open the room, and check that the tabs
   are what a zone offers, that a rail writes the zone itself, that every tab is
   the same height, and that use on another board and the colour sit in the same
   column on each of them.

     npm run dev -- --port 5188
     BOARD_URL=http://localhost:5188/ node scripts/verify-styles-tabs.mjs
*/
import { chromium } from 'playwright-core'
import { chromePath } from './lib/chrome.mjs'

const baseUrl = new URL(process.env.BOARD_URL || 'http://localhost:5188/').href
const out = []
const check = (ok, msg) => out.push(`${ok ? 'ok  ' : 'FAIL'} ${msg}`)

const browser = await chromium.launch({ executablePath: chromePath, headless: true })
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
const page = await ctx.newPage()
const errs = []
page.on('pageerror', e => errs.push(String(e)))
await page.goto(baseUrl, { waitUntil: 'load' })
await page.waitForSelector('#actionRow', { timeout: 30000 })
await page.waitForTimeout(1500)

// draw a zone: arm the box tool from the shapes shelf, then drag on the stage
await page.keyboard.press('4')
await page.waitForTimeout(400)
const box = await page.$('#stage')
const r = await box.boundingBox()
await page.mouse.move(r.x + 90, r.y + 160)
await page.mouse.down()
await page.mouse.move(r.x + 230, r.y + 280, { steps: 8 })
await page.mouse.up()
await page.waitForTimeout(600)
await page.mouse.click(r.x + 160, r.y + 220)
await page.waitForTimeout(400)
await page.click('[data-room="styles"]')
await page.waitForTimeout(400)
if (await page.$eval('#stylesShelf', e => e.classList.contains('hidden'))) {
  await page.click('[data-room="styles"]')
  await page.waitForTimeout(400)
}
const shot = async (name) => page.screenshot({ path: `/tmp/tbm-styles-${name}.png` })

const tabs = await page.$$eval('#stylesShelf [data-style-tab]', els => els.map(e => e.textContent))
check(tabs.join(',') === 'Fill,Border', `zone tabs are Fill and Border (got ${tabs.join(',') || 'none'})`)
const h1 = await page.$eval('#stylesShelf .styleBody', e => e.getBoundingClientRect().height)
check(await page.$('#stylesShelf .styleBody [data-style="carry"]') !== null, 'use on another board is in line with the rail')
check(await page.$('#stylesShelf .styleTabs [data-style="kit"]') !== null, 'the colour is in line with the tabs')
await shot('zone-fill')
await page.click('#stylesShelf [data-style-tab="border"]')
await page.waitForTimeout(250)
await shot('zone-border-row')
await page.click('#stylesShelf [data-style-tab="fill"]')
await page.waitForTimeout(250)

// drag the fill rail and watch the scene follow
const before = await page.evaluate(() => JSON.parse(localStorage.getItem('tbm-scene-v2') || '{}').objects?.find(o => o.type === 'box')?.opacity)
const rail = await page.$('#stylesShelf [data-style-rail]')
const rb = await rail.boundingBox()
await page.mouse.move(rb.x + rb.width * 0.9, rb.y + rb.height / 2)
await page.mouse.down(); await page.mouse.move(rb.x + rb.width * 0.95, rb.y + rb.height / 2, { steps: 4 }); await page.mouse.up()
await page.waitForTimeout(400)
const after = await page.evaluate(() => JSON.parse(localStorage.getItem('tbm-scene-v2') || '{}').objects?.find(o => o.type === 'box')?.opacity)
check(after !== before, `the fill rail writes the zone (${before} -> ${after})`)

check(await page.$eval('#stylesShelf [data-style-tab="fill"]', e => e.classList.contains('on')), 'the open tab is lit')
await page.click('#stylesShelf [data-style-tab="border"]')
await page.waitForTimeout(350)
const h2 = await page.$eval('#stylesShelf .styleBody', e => e.getBoundingClientRect().height)
check(Math.abs(h1 - h2) < 1, `both tabs are the same height (${Math.round(h1)} vs ${Math.round(h2)})`)
check((await page.$$('#stylesShelf .styleRing')).length === 2, 'the border tab draws solid and dashed')
check(await page.$eval('#stylesShelf [data-style-tab="border"]', e => e.classList.contains('on')), 'switching tabs lights the new one')
await shot('zone-border')
const rail2 = await page.$('#stylesShelf [data-style-rail]')
const rb2 = await rail2.boundingBox()
await page.mouse.move(rb2.x + rb2.width * 0.4, rb2.y + rb2.height / 2)
await page.mouse.down(); await page.mouse.move(rb2.x + rb2.width * 0.45, rb2.y + rb2.height / 2, { steps: 4 }); await page.mouse.up()
await page.waitForTimeout(400)
const border = await page.evaluate(() => JSON.parse(localStorage.getItem('tbm-scene-v2') || '{}').objects?.find(o => o.type === 'box')?.border)
check(typeof border === 'number' && border > 0, `the border rail writes the zone (${border})`)

/* An arrow, and the way back to the one the board draws. */
await page.click('[data-room="shapes"]')
await page.waitForTimeout(300)
await page.keyboard.press('3')
await page.waitForTimeout(300)
await page.mouse.move(r.x + 80, r.y + 320)
await page.mouse.down()
await page.mouse.move(r.x + 250, r.y + 350, { steps: 8 })
await page.mouse.up()
await page.waitForTimeout(500)
await page.mouse.click(r.x + 165, r.y + 335)
await page.waitForTimeout(400)
await page.click('[data-room="styles"]')
await page.waitForTimeout(400)
if (await page.$eval('#stylesShelf', e => e.classList.contains('hidden'))) {
  await page.click('[data-room="styles"]')
  await page.waitForTimeout(400)
}
const arrowTabs = await page.$$eval('#stylesShelf [data-style-tab]', els => els.map(e => e.textContent))
check(arrowTabs.join(',') === 'Line,Head,Shadow', `arrow tabs are Line, Head and Shadow (got ${arrowTabs.join(',') || 'none'})`)
check(await page.$('#stylesShelf [data-style="reset"]') !== null, 'the arrow can be put back to the default')
const arrowOf = () => page.evaluate(() => (JSON.parse(localStorage.getItem('tbm-scene-v2') || '{}').objects || []).find(o => o.type === 'arrow'))
await page.click('#stylesShelf [data-style-ring="dash-dashed"]')
await page.waitForTimeout(300)
const railA = await page.$('#stylesShelf [data-style-rail="arrow-width"]')
const ra = await railA.boundingBox()
await page.mouse.move(ra.x + ra.width * 0.95, ra.y + ra.height / 2)
await page.mouse.down(); await page.mouse.move(ra.x + ra.width, ra.y + ra.height / 2, { steps: 4 }); await page.mouse.up()
await page.waitForTimeout(300)
const changed = await arrowOf()
check(changed.dash === 'dashed', `the ring writes the arrow (${changed.dash})`)
await shot('arrow-line')
check(await page.$eval('#stylesShelf .styleTab.on', e => getComputedStyle(e).borderTopLeftRadius === '0px'),
  'a tab is square, so the rule under it does not bend')
/* A ring draws its own choice: moving a rail must not redraw the row. */
const ringArt = () => page.$$eval('#stylesShelf .styleRing', els => els.map(e => e.innerHTML).join('|'))
const artBefore = await ringArt()
const railW = await page.$('#stylesShelf [data-style-rail="arrow-width"]')
const rw = await railW.boundingBox()
await page.mouse.move(rw.x + rw.width * 0.1, rw.y + rw.height / 2)
await page.mouse.down(); await page.mouse.move(rw.x + rw.width * 0.15, rw.y + rw.height / 2, { steps: 4 }); await page.mouse.up()
await page.waitForTimeout(300)
check(await ringArt() === artBefore, 'the rings hold still while a rail moves')
const arrowHeights = []
for (const id of ['line', 'head', 'shadow']) {
  await page.click(`#stylesShelf [data-style-tab="${id}"]`)
  await page.waitForTimeout(200)
  arrowHeights.push(await page.$eval('#stylesShelf .styleBody', e => e.getBoundingClientRect().height))
}
check(new Set(arrowHeights).size === 1, `Line, Head and Shadow are the same height (${arrowHeights.join(', ')})`)
await page.click('#stylesShelf [data-style-tab="line"]')
await page.waitForTimeout(200)
await page.click('#stylesShelf [data-style="reset"]')
await page.waitForTimeout(400)
const back = await arrowOf()
check(back.dash === 'solid', `reset puts the dash back (${back.dash})`)
check(back.width !== changed.width, `reset puts the width back too (${changed.width} -> ${back.width})`)
check(await page.$eval('#stylesShelf [data-style-tab="head"]', e => e !== null), 'the tabs are still there after a reset')

console.log(out.join('\n'))
if (errs.length) console.log('page errors:\n' + errs.join('\n'))
await browser.close()
process.exit(out.some(l => l.startsWith('FAIL')) || errs.length ? 1 : 0)
