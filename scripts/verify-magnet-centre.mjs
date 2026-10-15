/* The magnet, on the move it is for: a zone dragged over a token centres on it
   rather than parking an edge through the man. Ranks matter more than a couple
   of pixels, so a painted pitch line nearby must not win.

     npm run dev -- --port 5195
     node scripts/verify-magnet-centre.mjs
*/
import { chromium } from 'playwright-core'
import { chromePath } from './lib/chrome.mjs'
const browser = await chromium.launch({ executablePath: chromePath, headless: true })
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
const page = await ctx.newPage()
const errs = []
page.on('pageerror', e => errs.push(String(e)))
await page.goto('http://127.0.0.1:5195/', { waitUntil: 'load' })
await page.waitForSelector('#actionRow', { timeout: 40000 })
await page.waitForTimeout(1600)
const r = await (await page.$('#stage')).boundingBox()
const objs = () => page.evaluate(() => (JSON.parse(localStorage.getItem('tbm-scene-v2') || '{}').objects || []))

await page.click('#snapBtn')
await page.waitForTimeout(300)
console.log('magnet lit:', await page.$eval('#snapBtn', e => e.classList.contains('active')))
// a token: the ball is the one a tap places, and it lines up by its middle
// exactly as a player does
await page.keyboard.press('2')
await page.waitForTimeout(300)
await page.mouse.click(r.x + 250, r.y + 250)
await page.waitForTimeout(700)
let all = await objs()
console.log('objects after the tap:', all.map(o => o.type).join(',') || 'none')

// a circle, drawn well clear of him
await page.keyboard.press('4')
await page.waitForTimeout(250)
await page.evaluate(() => {
  const el = [...document.querySelectorAll('button')].find(b => b.title === 'Circle')
  el?.click()
})
await page.waitForTimeout(300)
await page.mouse.move(r.x + 80, r.y + 120)
await page.mouse.down(); await page.mouse.move(r.x + 150, r.y + 190, { steps: 8 }); await page.mouse.up()
await page.waitForTimeout(600)
all = await objs()
const player = all.find(o => o.type === 'ball')
const zone = all.find(o => o.type === 'box')
console.log('player:', player && `${Math.round(player.x)},${Math.round(player.y)}`, 'zone:', zone && `${Math.round(zone.x)},${Math.round(zone.y)} ${Math.round(zone.w)}`)
if (player && zone) {
  // drag the circle so its centre lands a few pixels off the player
  // move by the difference between the two centres, minus a nudge inside the pull
  const dxBoard = player.x - zone.x - 10, dyBoard = player.y - zone.y - 10
  const start = { x: r.x + 115, y: r.y + 155 }
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(start.x + dxBoard / 2, start.y + dyBoard / 2, { steps: 14 })
  await page.waitForTimeout(120)
  await page.screenshot({ path: '/tmp/tbm-magnet.png' })
  await page.mouse.up()
  await page.waitForTimeout(500)
  const after = (await objs()).find(o => o.type === 'box')
  console.log('landed at:', `${Math.round(after.x)},${Math.round(after.y)}`, 'player at:', `${Math.round(player.x)},${Math.round(player.y)}`)
  console.log('off by:', `${(after.x - player.x).toFixed(2)}, ${(after.y - player.y).toFixed(2)}`)
  const centred = Math.abs(after.x - player.x) < 0.01 && Math.abs(after.y - player.y) < 0.01
  console.log(centred ? 'ok   the zone centred on the token' : 'FAIL the zone did not centre on the token')
}
if (errs.length) console.log('page errors:', errs.join(' | '))
await browser.close()
