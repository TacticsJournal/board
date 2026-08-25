// Desktop/iPad-pointer experience: wheel pans, ctrl/cmd+wheel (trackpad
// pinch) zooms, number keys pick tools, F/0 fit the view, Escape closes
// sheets, and the canvas cursor reflects what a press would do.
import { chromium } from 'playwright-core'
import { chromePath } from './lib/chrome.mjs'

const browser = await chromium.launch({
  executablePath: chromePath,
  headless: true,
})
const errors = []
const check = (ok, msg) => { if (!ok) errors.push(msg) }

const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
const page = await ctx.newPage()
page.on('pageerror', e => errors.push(`pageerror: ${e.message}`))
await page.goto('http://localhost:4173/')
await page.waitForTimeout(700)

const view = () => page.evaluate(() => {
  const s = window.__tbm.board.stage
  return { x: s.x(), y: s.y(), scale: s.scaleX(), fit: window.__tbm.board.isFitView() }
})
const cursor = () => page.evaluate(() => document.querySelector('#stage').style.cursor)

// center of the stage, for wheel events
const c = await page.evaluate(() => {
  const r = document.querySelector('#stage').getBoundingClientRect()
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
})
await page.mouse.move(c.x, c.y)

// 1. ctrl+wheel zooms in (trackpad pinches arrive exactly like this)
const v0 = await view()
await page.keyboard.down('Control')
for (let i = 0; i < 12; i++) await page.mouse.wheel(0, -60)
await page.keyboard.up('Control')
await page.waitForTimeout(120)
let v = await view()
check(v.scale > v0.scale * 1.2, `ctrl+wheel should zoom in (${v0.scale.toFixed(3)} -> ${v.scale.toFixed(3)})`)

// 2. plain wheel pans without changing zoom
const before = await view()
await page.mouse.wheel(80, 60)
await page.waitForTimeout(120)
v = await view()
check(Math.abs(v.scale - before.scale) < 1e-6, `plain wheel must not zoom (${before.scale} -> ${v.scale})`)
check(Math.abs(v.x - (before.x - 80)) < 1 && Math.abs(v.y - (before.y - 60)) < 1,
  `plain wheel should pan by the scroll delta (${JSON.stringify({ dx: v.x - before.x, dy: v.y - before.y })})`)

// 3. "0" resets to the fit view
await page.keyboard.press('0')
await page.waitForTimeout(120)
v = await view()
check(v.fit, '"0" should reset to the fit view')

// 4. "=" zooms in, "f" fits again
await page.keyboard.press('=')
await page.waitForTimeout(120)
v = await view()
check(!v.fit && v.scale > v0.scale, '"=" should zoom in from fit')
await page.keyboard.press('f')
await page.waitForTimeout(120)
v = await view()
check(v.fit, '"f" should reset to the fit view')

// 5. number keys pick tools: 3 = Arrows, 1 = Players
await page.keyboard.press('3')
let tool = await page.evaluate(() => window.__tbm.board.tool)
check(tool === 'arrow', `"3" should pick the arrow tool (${tool})`)
check((await cursor()) === 'crosshair', `arrow tool should show a crosshair over the board (${await cursor()})`)
await page.keyboard.press('1')
tool = await page.evaluate(() => window.__tbm.board.tool)
check(tool === 'player', `"1" should pick the player tool (${tool})`)

// 6. hovering an object shows the move cursor
await page.evaluate(() => {
  window.__tbm.store.apply(s => s.objects.push({
    id: 'cur-test', type: 'player', x: 400, y: 300, r: 14,
    color: '#d33', label: '7', name: '', namePos: 'bottom', nameSize: 18,
    nameDisplay: 'last', team: 'home', flipX: false, flipY: false,
  }))
})
await page.waitForTimeout(150)
const onPlayer = await page.evaluate(() => {
  const stage = window.__tbm.board.stage
  const t = stage.getAbsoluteTransform().point({ x: 400, y: 300 })
  const r = stage.container().getBoundingClientRect()
  return { x: r.x + t.x, y: r.y + t.y }
})
await page.mouse.move(c.x, c.y - 200)
await page.mouse.move(onPlayer.x, onPlayer.y, { steps: 4 })
await page.waitForTimeout(120)
check((await cursor()) === 'move', `hovering a player should show the move cursor (${await cursor()})`)
await page.mouse.move(c.x, c.y - 220, { steps: 4 })
await page.waitForTimeout(120)
check((await cursor()) === '', `empty board with the player tool keeps the default cursor (${await cursor()})`)

// 7. with a sheet open, Escape closes it and tool shortcuts stay inert
await page.click('[data-bar="settings"]')
await page.waitForTimeout(250)
check(await page.evaluate(() => !!document.querySelector('.modal:not(.hidden)')), 'settings sheet should open')
await page.keyboard.press('3')
tool = await page.evaluate(() => window.__tbm.board.tool)
check(tool === 'player', `tool shortcuts must not fire under an open sheet (${tool})`)
await page.keyboard.press('Escape')
await page.waitForTimeout(250)
check(await page.evaluate(() => !document.querySelector('.modal:not(.hidden)')), 'Escape should close the settings sheet')

// 8. desktop layout: the sheet floats centered (not glued to the bottom edge)
await page.click('[data-bar="settings"]')
await page.waitForTimeout(250)
const sheetBox = await page.evaluate(() => {
  const el = document.querySelector('.modal:not(.hidden) .sheet')
  const r = el.getBoundingClientRect()
  return { bottomGap: window.innerHeight - r.bottom, radius: getComputedStyle(el).borderBottomLeftRadius }
})
check(sheetBox.bottomGap > 8, `sheet should float off the bottom edge on desktop (gap ${sheetBox.bottomGap}px)`)
check(parseFloat(sheetBox.radius) > 0, `sheet should have rounded bottom corners on desktop (${sheetBox.radius})`)
await page.keyboard.press('Escape')

await ctx.close()
await browser.close()
if (errors.length) { console.log('ERRORS:\n' + errors.join('\n')); process.exit(1) }
console.log('OK')
