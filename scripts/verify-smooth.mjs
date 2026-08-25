// Focused smoke test for the gesture smoothness work: hit testing must
// still resolve correctly after drags, pans and pinches now that the hit
// canvas is only repainted on gesture release.
import { chromium } from 'playwright-core'
import { chromePath } from './lib/chrome.mjs'

const browser = await chromium.launch({
  executablePath: chromePath,
  headless: true,
})

const errors = []
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
const page = await ctx.newPage()
page.on('pageerror', e => errors.push(`pageerror: ${e.message}`))
// the header pings the live tacticsjournal.com API; on localhost those
// calls are CORS-blocked (the board origins only work in production) and
// the app handles it, so that noise is not a failure
const benign = (t) => t.includes('tacticsjournal.com/api') || t.includes('Failed to load resource')
page.on('console', m => { if (m.type() === 'error' && !benign(m.text())) errors.push(`console: ${m.text()}`) })
await page.goto('http://localhost:4173/')
await page.waitForTimeout(800)

const cdp = await ctx.newCDPSession(page)
const touch = (type, points) =>
  cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(p => ({ x: p.x, y: p.y })) })
const sb = await page.locator('#stage').boundingBox()

// seed a scene programmatically (players are added from the menu now)
await page.evaluate(() => {
  const { store } = window.__tbm
  store.apply(s => {
    s.objects.push(
      { id: 'p1', type: 'player', x: 300, y: 150, r: 13, color: '#e02020', label: '7', name: 'Saka', namePos: 'bottom' },
      { id: 'p2', type: 'player', x: 500, y: 250, r: 13, color: '#1e2f6f', label: '', name: '', namePos: 'bottom' },
      { id: 'b1', type: 'ball', x: 400, y: 200, size: 20 },
      { id: 'a1', type: 'arrow', x1: 200, y1: 300, x2: 350, y2: 320, mx: 275, my: 310, curved: false, dash: 'solid', color: '#111111', width: 4, head: true },
    )
  })
})
await page.waitForTimeout(200)

const screenOf = (id) => page.evaluate((id) => {
  const { store, board } = window.__tbm
  const o = store.obj(id)
  return board.boardToScreen({ x: o.x, y: o.y })
}, id)
const listening = () => page.evaluate(() => window.__tbm.board.objLayer.listening())

// 1. tap selects (baseline hit test)
let s = await screenOf('p1')
await touch('touchStart', [{ x: sb.x + s.x, y: sb.y + s.y }])
await touch('touchEnd', [])
await page.waitForTimeout(150)
let sel = await page.evaluate(() => window.__tbm.store.selectedId)
if (sel !== 'p1') errors.push(`tap-select got ${sel}, expected p1`)

// 2. drag moves the player; hit painting pauses mid-drag, resumes on release
const from = { x: sb.x + sb.width - 50, y: sb.y + 150 }
await touch('touchStart', [from])
let pausedMid = null
for (let i = 1; i <= 6; i++) {
  await touch('touchMove', [{ x: from.x - i * 14, y: from.y + i * 10 }])
  if (i === 4) pausedMid = await listening()
  await page.waitForTimeout(20)
}
await touch('touchEnd', [])
await page.waitForTimeout(250)
if (pausedMid !== false) errors.push(`hit painting not paused mid-drag (listening=${pausedMid})`)
if (await listening() !== true) errors.push('hit painting not resumed after drag')
const moved = await page.evaluate(() => { const o = window.__tbm.store.obj('p1'); return { x: o.x, y: o.y } })
if (Math.hypot(moved.x - 300, moved.y - 150) < 10) errors.push('drag did not move p1')

// 3. after the drag, tapping the OTHER player must still hit (hit canvas fresh)
await page.evaluate(() => window.__tbm.store.select(null))
await page.waitForTimeout(100)
s = await screenOf('p2')
await touch('touchStart', [{ x: sb.x + s.x, y: sb.y + s.y }])
await touch('touchEnd', [])
await page.waitForTimeout(150)
sel = await page.evaluate(() => window.__tbm.store.selectedId)
if (sel !== 'p2') errors.push(`post-drag tap-select got ${sel}, expected p2`)
await page.evaluate(() => window.__tbm.store.select(null))

// 4. pinch zoom, then tap must hit at the new transform
const px = sb.x + 100, py = sb.y + 600
await touch('touchStart', [{ x: px - 40, y: py }, { x: px + 40, y: py }])
for (let i = 1; i <= 5; i++) {
  await touch('touchMove', [{ x: px - 40 - i * 12, y: py }, { x: px + 40 + i * 12, y: py }])
  await page.waitForTimeout(20)
}
await touch('touchEnd', [])
await page.waitForTimeout(200)
const zoom = await page.evaluate(() => window.__tbm.board.zoom)
if (zoom <= 1.01) errors.push(`pinch did not zoom (${zoom})`)
if (await listening() !== true) errors.push('hit painting not resumed after pinch')

// 5. one-finger pan (hold-drag past the hold timer is a marquee, quick drag pans)
const posA = await page.evaluate(() => window.__tbm.board.stage.position())
const pf = { x: sb.x + sb.width / 2, y: sb.y + 400 }
await touch('touchStart', [pf])
for (let i = 1; i <= 6; i++) { await touch('touchMove', [{ x: pf.x - i * 15, y: pf.y + i * 8 }]); await page.waitForTimeout(15) }
await touch('touchEnd', [])
await page.waitForTimeout(200)
const posB = await page.evaluate(() => window.__tbm.board.stage.position())
if (Math.hypot(posB.x - posA.x, posB.y - posA.y) < 10) errors.push('one-finger pan did not move the view')
if (await listening() !== true) errors.push('hit painting not resumed after pan')

// 6. after the pan, tap-select still resolves correctly
s = await screenOf('p1')
const tp = { x: sb.x + s.x, y: sb.y + s.y }
if (tp.x > sb.x + 10 && tp.x < sb.x + sb.width - 10 && tp.y > sb.y + 10 && tp.y < sb.y + sb.height - 10) {
  await touch('touchStart', [tp])
  await touch('touchEnd', [])
  await page.waitForTimeout(150)
  sel = await page.evaluate(() => window.__tbm.store.selectedId)
  if (sel !== 'p1') errors.push(`post-pan tap-select got ${sel}, expected p1`)
}

// 7. export unaffected by the pixelRatio cap
const exp = await page.evaluate(() => new Promise(res => {
  const url = window.__tbm.board.exportPng()
  const img = new Image()
  img.onload = () => res({ w: img.width, h: img.height })
  img.src = url
}))
if (exp.w !== 2048) errors.push(`export width ${exp.w}, expected 2048`)

console.log('zoom:', zoom, 'export:', JSON.stringify(exp))
await browser.close()
if (errors.length) { console.log('ERRORS:\n' + errors.join('\n')); process.exit(1) }
console.log('OK')
