/**
 * The wide-window layout: a rail of tools, the panel beside it, and one bar
 * over the board. Checks the pieces land where they belong, that opening and
 * folding the panel never moves the board, and that the selection's buttons move into
 * the bar rather than floating over the pitch.
 */
import { chromium } from 'playwright-core'
import { chromePath } from './lib/chrome.mjs'
import { createServer } from 'vite'

const fail = (m) => { console.error('FAIL:', m); process.exitCode = 1 }
const near = (a, b, slack = 2) => Math.abs(a - b) <= slack

const server = await createServer({ server: { port: 5188 } })
await server.listen()
const browser = await chromium.launch({ executablePath: chromePath })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
page.on('pageerror', (e) => fail(`page error: ${e}`))

const box = (sel) => page.evaluate((s) => {
  const el = document.querySelector(s)
  if (!el || el.classList.contains('hidden')) return null
  const b = el.getBoundingClientRect()
  if (!b.width && !b.height) return null
  return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }
}, sel)

try {
  await page.goto('http://localhost:5188/?e2e=1', { waitUntil: 'load' })
  await page.waitForTimeout(1800)

  if (!(await page.evaluate(() => document.body.classList.contains('deskMode')))) fail('1440px did not enter deskMode')

  // the rail carries every shelf category plus text and settings
  const railKeys = await page.$$eval('#toolbar button', (bs) => bs.map(b => b.dataset.rail ?? b.dataset.bar))
  for (const key of ['players', 'arrows', 'zones', 'equipment', 'text', 'settings']) {
    if (!railKeys.includes(key)) fail(`rail is missing ${key}`)
  }

  // folded is the desktop default: rail and bar only
  let panel = await box('#panelDock')
  if (panel && panel.w > 0) fail(`panel should start folded, is ${panel.w}px`)
  const wideStage = await box('#stage')
  const bar = await box('#ctxDock')
  if (!bar) fail('the context bar is missing')
  if (bar && !near(bar.x, 52, 4)) fail(`bar should start beside the rail, is at ${bar.x}`)
  // the board sits under the bar with a margin of surround between them
  if (wideStage && !near(wideStage.y, (bar?.y ?? 0) + (bar?.h ?? 0) + 16, 3)) fail('the board is not under the bar')

  // picking a tool opens the panel over the board's area; the board stays put
  const pitchAt = () => page.evaluate(() => {
    const st = window.Konva?.stages?.[0]
    return st ? { x: Math.round(st.x()), y: Math.round(st.y()), s: st.scaleX() } : null
  })
  const widePitch = await pitchAt()
  await page.click('[data-rail="players"]')
  await page.waitForTimeout(500)
  panel = await box('#panelDock')
  const openStage = await box('#stage')
  if (!panel || panel.w < 100) fail(`panel did not open, width ${panel?.w}`)
  if (!near(wideStage.x, openStage.x, 1) || !near(wideStage.w, openStage.w, 1)) fail(`opening the panel moved the board area from ${wideStage.x}/${wideStage.w} to ${openStage.x}/${openStage.w}`)
  if (JSON.stringify(widePitch) !== JSON.stringify(await pitchAt())) fail('opening the panel moved the pitch')
  if (!(await box('#panelFold'))) fail('the panel has no way to fold itself away')
  // folded keeps its shapes and clips them, so nothing in there takes a tab stop
  const foldedInert = await page.evaluate(() => {
    const p = document.querySelector('#panelDock')
    return { mounted: !!document.querySelector('#shelf .cell'), inert: p.inert, folded: p.classList.contains('folded') }
  })
  if (!foldedInert.mounted) fail('the open panel has no shapes in it')
  if (await box('.shelfRail')) fail('the category rail should be gone; the tool rail replaces it')

  // and the lit tool folds it again
  await page.click('[data-rail="players"]')
  await page.waitForTimeout(500)
  panel = await box('#panelDock')
  if (panel && panel.w > 0) fail('clicking the lit tool did not fold the panel')
  if (JSON.stringify(widePitch) !== JSON.stringify(await pitchAt())) fail('folding the panel moved the pitch')
  const folded = await page.evaluate(() => {
    const p = document.querySelector('#panelDock')
    return { mounted: !!document.querySelector('#shelf .cell'), inert: p.inert }
  })
  if (!folded.mounted) fail('folding threw the shelf away instead of clipping it')
  if (!folded.inert) fail('the folded panel is still in the tab order')

  // a selection puts its buttons in the bar, not over the pitch
  await page.click('[data-rail="players"]')
  await page.waitForTimeout(400)
  const board = await box('#stage')
  if (!(await box('#shelf .cell'))) await page.click('[data-rail="players"]')
  await page.waitForTimeout(300)
  // the bar holds the tool's settings only: the panel adds players
  if (await page.$('#options [data-opt="d-add-player"]')) fail('the bar repeats the panel\'s add button')
  await page.click('#shelf .cell:not(.cellTeam):not(.cellUtil)')
  await page.waitForTimeout(300)
  if (!(await page.evaluate(() => window.__tbm.store.selected))) await page.mouse.click(board.x + board.w / 2, board.y + board.h / 2)
  await page.waitForFunction(() => window.__tbm.store.selected?.type === 'player')
  await page.waitForTimeout(300)
  // selecting must not move the pitch: a bar that grows a row rescales it
  const selectedId = await page.evaluate(() => window.__tbm.store.selectedId)
  const selectedBar = await box('#ctxDock')
  const selectedStage = await box('#stage')
  await page.mouse.click(selectedStage.x + 8, selectedStage.y + 8)
  await page.waitForTimeout(300)
  const idleBar = await box('#ctxDock')
  const idleStage = await box('#stage')
  if (selectedBar.h !== idleBar.h) fail(`the bar changed height with the selection: ${idleBar.h} to ${selectedBar.h}`)
  if (selectedStage.y !== idleStage.y || selectedStage.h !== idleStage.h) fail('selecting moved or resized the board')
  await page.evaluate((id) => window.__tbm.store.select(id), selectedId)
  await page.waitForTimeout(300)
  // a strip longer than the bar stays reachable with a mouse wheel
  await page.hover('#options')
  await page.mouse.wheel(0, 300)
  await page.waitForTimeout(100)
  const reach = await page.evaluate(() => { const o = document.querySelector('#options'); return { over: o.scrollWidth - o.clientWidth, left: o.scrollLeft } })
  if (reach.over > 0 && reach.left === 0) fail('the wheel does not move a long strip')
  const fabs = await box('#fabCol')
  if (!fabs) fail('the selection tools never appeared')
  else {
    const inBar = await page.evaluate(() => !!document.querySelector('#ctxDock #fabCol'))
    if (!inBar) fail('the selection tools are not in the bar')
    if (fabs.y > board.y) fail('the selection tools are still over the pitch')
  }

  // the phone layout is untouched
  await page.setViewportSize({ width: 420, height: 860 })
  await page.waitForTimeout(700)
  if (await page.evaluate(() => document.body.classList.contains('deskMode'))) fail('420px stayed in deskMode')
  const dock = await box('#panelDock')
  if (!dock || dock.x !== 0) fail('the phone panel is not back across the bottom')
  const phoneFabs = await box('#fabCol')
  if (phoneFabs && await page.evaluate(() => !!document.querySelector('#ctxDock #fabCol'))) fail('the selection tools stayed in the bar on a phone')

  console.log(process.exitCode ? 'desktop layout: FAILED' : 'OK')
} finally {
  await browser.close()
  await server.close()
}
