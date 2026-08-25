// Background board + cone + marker + match overlay (dev unlock on localhost):
//  - Ball menu places a cone (and hands the toolbar back)
//  - adding a background asks for an image; the board resizes to it,
//    the camera button appears, and the image is saved to the shelf
//  - + Marker drops a ground ellipse; its name renders
//  - the cog sheet edits clock/score/teams and draws the overlay
//  - export keeps 2048px width at the screenshot's aspect; reload persists
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


const fixture = new URL('./fixtures/match-real.jpg', import.meta.url).pathname
const FIX_H = 533 // round(800 * 853 / 1280)

const browser = await chromium.launch({
  executablePath: chromePath,
  headless: true,
})
const errors = []
const check = (ok, msg) => { if (!ok) errors.push(msg) }

const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
const page = await ctx.newPage()
page.on('pageerror', e => errors.push(`pageerror: ${e.message}`))
await page.goto(process.env.BOARD_URL ?? 'http://localhost:4173/')
await page.waitForTimeout(700)

// 1. cone from the ball menu, on the default pitch
await page.click('[data-tool="ball"]')
await page.click('[data-opt="d-place"][data-v="cone"]')
const stage = await page.locator('#stage').boundingBox()
await page.mouse.click(stage.x + stage.width / 2, stage.y + stage.height / 2)
await page.waitForTimeout(200)
const coneState = await page.evaluate(() => ({
  cones: window.__tbm.store.scene.objects.filter(o => o.type === 'cone').length,
  tool: window.__tbm.board.tool,
}))
check(coneState.cones === 1, `expected 1 cone, got ${coneState.cones}`)
check(coneState.tool === 'player', `cone placement should hand the toolbar back (${coneState.tool})`)

// 2. a background: adding one opens the chooser and the board takes its shape
await page.click('[data-bar="settings"]')
await pushScreen(page, 'pitch')
await page.click('[data-bg-add]')
await page.waitForTimeout(200)
const [chooser] = await Promise.all([
  page.waitForEvent('filechooser', { timeout: 5000 }),
  page.click('[data-kind="broadcast"]'),
])
await chooser.setFiles(fixture)
await page.waitForTimeout(900)
const live = await page.evaluate(() => ({
  pitch: window.__tbm.store.scene.pitch,
  h: window.__tbm.store.scene.board.h,
  boardH: window.__tbm.board.boardH,
  saved: JSON.parse(localStorage.getItem('tbm-bg-index-v1') ?? '[]').length,
  camera: !document.querySelector('[data-top="live-shot"]').classList.contains('hidden'),
}))
check(live.pitch.startsWith('bg:'), `pitch should be the saved background (${live.pitch})`)
check(live.h === FIX_H && live.boardH === FIX_H, `board should match the screenshot aspect (${JSON.stringify(live)})`)
check(live.saved === 1, `the image should be saved to the shelf (${live.saved})`)
check(live.camera, 'camera button should appear on a background board')
await page.click('[data-set="close"]')

// 3. marker from the player menu (live only) with a name
await page.click('[data-tool="player"]')
check(await page.evaluate(() => !!document.querySelector('[data-opt="d-add-marker"]')), 'live player menu should offer + Marker')
await page.click('[data-opt="d-add-marker"]')
await page.waitForTimeout(150)
await page.fill('[data-opt="mname"]', 'Mbeumo')
await page.dispatchEvent('[data-opt="mname"]', 'change')
await page.waitForTimeout(150)
const marker = await page.evaluate(() => window.__tbm.store.scene.objects.find(o => o.type === 'marker'))
check(!!marker && marker.name === 'Mbeumo', `marker with name expected (${JSON.stringify(marker)})`)

// 4. match info: scoreboard + team codes drawn on the overlay
// (the cog button was removed from the icon row; the sheet itself still
// exists, so the overlay is driven through the scene here)
await page.keyboard.press('Escape')
await page.evaluate(() => {
  window.__tbm.store.apply(s => {
    s.match = { home: 'LIV', away: 'MUN', homeScore: '0', awayScore: '0', clock: '24:19', date: '2 Mar 2024', showScoreboard: true, showTeams: true }
  })
})
await page.waitForTimeout(200)
const match = await page.evaluate(() => ({
  m: window.__tbm.store.scene.match,
  overlayNodes: window.__tbm.board.overlayLayer.getChildren().length,
}))
check(match.m.home === 'LIV' && match.m.clock === '24:19', `match info should persist (${JSON.stringify(match.m)})`)
check(match.overlayNodes >= 3, `scoreboard card + two team codes expected on the overlay (${match.overlayNodes})`)

// 5. export follows the screenshot aspect at 2048 wide
const dims = await page.evaluate(() => new Promise(res => {
  const url = window.__tbm.board.exportPng()
  const img = new Image()
  img.onload = () => res({ w: img.naturalWidth, h: img.naturalHeight })
  img.src = url
}))
check(dims.w === 2048 && Math.abs(dims.h - Math.round(2048 * FIX_H / 800)) <= 2,
  `live export should be 2048x~${Math.round(2048 * FIX_H / 800)}, got ${JSON.stringify(dims)}`)
await page.screenshot({ path: '/tmp/tbm-live.png' })

// 6. reload keeps the live board; switching away and back reuses the shot
await page.reload()
await page.waitForTimeout(700)
const after = await page.evaluate(() => ({
  pitch: window.__tbm.store.scene.pitch,
  h: window.__tbm.store.scene.board.h,
  markers: window.__tbm.store.scene.objects.filter(o => o.type === 'marker').length,
  overlayNodes: window.__tbm.board.overlayLayer.getChildren().length,
}))
check(after.pitch.startsWith('bg:') && after.h === FIX_H, `background board should survive reload (${JSON.stringify(after)})`)
check(after.markers === 1, 'marker should survive reload')
check(after.overlayNodes >= 3, 'overlay should redraw after reload')
await page.click('[data-bar="settings"]')
await pushScreen(page, 'pitch')
await page.click('[data-pitch="pitch"]')
await page.waitForTimeout(250)
check(await page.evaluate(() => window.__tbm.store.scene.board.h) === 618, 'switching back to the default pitch should resize')
await page.click('[data-pitch^="bg:"]') // no chooser this time: the saved background is reused
await page.waitForTimeout(500)
const back = await page.evaluate(() => ({ pitch: window.__tbm.store.scene.pitch, h: window.__tbm.store.scene.board.h }))
check(back.pitch.startsWith('bg:') && back.h === FIX_H, `the saved background should be reused (${JSON.stringify(back)})`)

await ctx.close()
await browser.close()
if (errors.length) { console.log('ERRORS:\n' + errors.join('\n')); process.exit(1) }
console.log('OK')
