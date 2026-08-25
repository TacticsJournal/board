// Armed arrow anchors: after tapping a node, a drag starting ANYWHERE -
// including on the arrow shaft / inside the protected edit zone - must move
// that node (the bug was isProtectedEditPoint swallowing the press first).
import { chromium } from 'playwright-core'
import { chromePath } from './lib/chrome.mjs'

const browser = await chromium.launch({
  executablePath: chromePath,
  headless: true,
})
const errors = []
const check = (ok, msg) => { if (!ok) errors.push(msg) }

const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, hasTouch: true })
const page = await ctx.newPage()
page.on('pageerror', e => errors.push(`pageerror: ${e.message}`))
await page.goto('http://localhost:4173/')
await page.waitForTimeout(700)

// board point -> screen point, via the stage transform
const toScreen = (p) => page.evaluate(({ x, y }) => {
  const stage = window.__tbm.board.stage
  const t = stage.getAbsoluteTransform().point({ x, y })
  const rect = stage.container().getBoundingClientRect()
  return { x: rect.x + t.x, y: rect.y + t.y }
}, p)

const drag = async (from, to, steps = 8) => {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(from.x + (to.x - from.x) * i / steps, from.y + (to.y - from.y) * i / steps)
    await page.waitForTimeout(20)
  }
  await page.mouse.up()
  await page.waitForTimeout(150)
}

// 1. draw an arrow across the middle of the pitch
await page.click('[data-tool="arrow"]')
const A = { x: 250, y: 300 }, B = { x: 550, y: 300 }
await drag(await toScreen(A), await toScreen(B))
const arrow = await page.evaluate(() => window.__tbm.store.scene.objects.find(o => o.type === 'arrow'))
check(!!arrow, 'arrow should be created')

// 2. double-tap the shaft for node edit (anchors visible)
const mid = await toScreen({ x: (A.x + B.x) / 2, y: A.y })
await page.mouse.click(mid.x, mid.y)
await page.waitForTimeout(120)
await page.mouse.click(mid.x, mid.y)
await page.waitForTimeout(120)
await page.mouse.click(mid.x, mid.y, { clickCount: 2 })
await page.waitForTimeout(300)
const anchors = await page.evaluate(() => window.__tbm.board.uiLayer.find('.anchor').length)
check(anchors === 3, `three node dots expected after double-tap (${anchors})`)

// 3. tap the end node to arm it
const endPt = await page.evaluate(() => {
  const o = window.__tbm.store.scene.objects.find(v => v.type === 'arrow')
  return { x: o.x2, y: o.y2 }
})
const endScr = await toScreen(endPt)
await page.mouse.click(endScr.x, endScr.y)
await page.waitForTimeout(200)

// 4. drag starting ON THE SHAFT (deep inside the protected zone) - the
//    armed node must follow the drag delta
const shaftFrom = await toScreen({ x: 350, y: 300 })
const shaftTo = await toScreen({ x: 350, y: 180 })
await drag(shaftFrom, shaftTo)
let o = await page.evaluate(() => window.__tbm.store.scene.objects.find(v => v.type === 'arrow'))
check(Math.abs(o.y2 - (endPt.y - 120)) <= 4 && Math.abs(o.x2 - endPt.x) <= 4,
  `armed end node should follow a shaft-start drag (expected y2~${endPt.y - 120}, got ${JSON.stringify({ x2: o.x2, y2: o.y2 })})`)
check(Math.abs(o.x1 - 250) <= 4 && Math.abs(o.y1 - 300) <= 4,
  `start node should not move (${JSON.stringify({ x1: o.x1, y1: o.y1 })})`)

// 5. drag starting near (but off) the arrow - still inside the padded zone
const nearFrom = await toScreen({ x: 400, y: 312 })
const nearTo = await toScreen({ x: 480, y: 360 })
const before = { x: o.x2, y: o.y2 }
await drag(nearFrom, nearTo)
o = await page.evaluate(() => window.__tbm.store.scene.objects.find(v => v.type === 'arrow'))
check(Math.abs(o.x2 - (before.x + 80)) <= 4 && Math.abs(o.y2 - (before.y + 48)) <= 4,
  `armed node should follow a near-arrow drag (${JSON.stringify({ x2: o.x2, y2: o.y2 })})`)

// 6. a plain tap on empty space releases the armed node; the next
//    empty-space drag moves the whole selected arrow rigidly, not the node
const releaseAt = await toScreen({ x: 650, y: 500 })
await page.mouse.click(releaseAt.x, releaseAt.y)
await page.waitForTimeout(200)
const span = { x: o.x2 - o.x1, y: o.y2 - o.y1 }
await drag(await toScreen({ x: 150, y: 500 }), await toScreen({ x: 200, y: 550 }))
o = await page.evaluate(() => window.__tbm.store.scene.objects.find(v => v.type === 'arrow'))
check(!!o && Math.abs((o.x2 - o.x1) - span.x) <= 2 && Math.abs((o.y2 - o.y1) - span.y) <= 2,
  `after release, drags must move the arrow rigidly (span was ${JSON.stringify(span)}, now ${JSON.stringify(o && { x: o.x2 - o.x1, y: o.y2 - o.y1 })})`)

await ctx.close()
await browser.close()
if (errors.length) { console.log('ERRORS:\n' + errors.join('\n')); process.exit(1) }
console.log('OK')
