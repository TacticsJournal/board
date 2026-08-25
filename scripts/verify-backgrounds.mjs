// The background library, in a real browser (dev unlock on localhost):
//  - adding an image saves it, names it, and puts it behind the board
//  - a second image does not replace the first: both stay on the shelf
//  - a background survives a reload, image and board height with it
//  - rename, duplicate and delete act on one tile and leave the rest alone
//  - deleting the background on screen leaves the board on our own pitch
import { chromium } from 'playwright-core'
import { chromePath } from './lib/chrome.mjs'

const pushScreen = async (page, screen) => {
  const atRoot = await page.evaluate(() => {
    const root = document.querySelector('[data-pane="root"]')
    return !!root && !root.classList.contains('hidden')
  })
  if (!atRoot) { await page.click('.setBack'); await page.waitForTimeout(80) }
  await page.locator(`[data-goto="${screen}"]`).first().click()
  await page.waitForTimeout(120)
}

const shot = new URL('./fixtures/match-real.jpg', import.meta.url).pathname
const SHOT_H = 533 // round(800 * 853 / 1280)
const pitchShot = new URL('../assets/pitch/training_marked.jpeg', import.meta.url).pathname

const browser = await chromium.launch({ executablePath: chromePath, headless: true })
const errors = []
const check = (ok, msg) => { if (!ok) errors.push(msg) }

const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
const page = await ctx.newPage()
page.on('pageerror', e => errors.push(`pageerror: ${e.message}`))
// rename answers with a fixed name; delete is confirmed
page.on('dialog', d => d.type() === 'prompt' ? d.accept('Wide camera') : d.accept())
await page.goto(process.env.BOARD_URL ?? 'http://localhost:4173/')
await page.waitForTimeout(700)

/** Add a background the way a person does: choose what it is, then the file. */
async function addBackground(page, kind, file) {
  await page.click('[data-bg-add]')
  await page.waitForTimeout(200)
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser', { timeout: 5000 }),
    page.click(`[data-kind="${kind}"]`),
  ])
  await chooser.setFiles(file)
  await page.waitForTimeout(1800)
}

const tiles = () => page.evaluate(() => [...document.querySelectorAll('[data-bg-grid] [data-pitch]')].map(el => ({
  id: el.dataset.pitch,
  name: el.querySelector('.pitchTileName').textContent,
  sub: el.querySelector('.pitchTileSub').textContent,
  on: el.classList.contains('on'),
  thumb: !!el.querySelector('.pitchShotImg'),
})))

// 1. the first background: saved, named, and behind the board
await page.click('[data-bar="settings"]')
await pushScreen(page, 'pitch')
await addBackground(page, 'broadcast', shot)
let list = await tiles()
check(list.length === 1, `one saved background expected, got ${list.length}`)
check(list[0]?.name === 'match real', `the file name should name the background (${list[0]?.name})`)
check(list[0]?.sub === `Broadcast · 800 × ${SHOT_H}`, `the tile should say what it is and what board it makes (${list[0]?.sub})`)
check(list[0]?.on, 'the new background should be the one on the board')
const first = await page.evaluate(() => ({
  pitch: window.__tbm.store.scene.pitch,
  h: window.__tbm.store.scene.board.h,
  boardH: window.__tbm.board.boardH,
  live: !!window.__tbm.pitchById(window.__tbm.store.scene.pitch).live,
}))
check(first.live, 'a broadcast board should offer the broadcast pieces')
check(first.pitch.startsWith('bg:'), `the scene should hold the background id (${first.pitch})`)
check(first.h === SHOT_H && first.boardH === SHOT_H, `the board should take the image's shape (${JSON.stringify(first)})`)

// 2. a second image does not replace the first, and can be a different thing
await addBackground(page, 'pitch', pitchShot)
list = await tiles()
const second = await page.evaluate(() => ({
  live: !!window.__tbm.pitchById(window.__tbm.store.scene.pitch).live,
  sub: [...document.querySelectorAll('[data-bg-grid] .pitchTileSub')].map(e => e.textContent),
}))
check(second.live === false, 'a pitch background should be drawn on like our own pitch art')
check(second.sub.some(t => t.startsWith('Pitch ·')) && second.sub.some(t => t.startsWith('Broadcast ·')),
  `each tile should say which it is (${second.sub})`)
check(list.length === 2, `both backgrounds should be on the shelf, got ${list.length}`)
check(list.filter(t => t.on).length === 1, 'exactly one tile is the one on the board')
const usage = await page.evaluate(() => document.querySelector('[data-bg-usage]').textContent)
check(/2 saved, \d+\.\d MB/.test(usage), `the shelf should report what it holds (${usage})`)
check(list.every(t => t.thumb), 'every saved tile should show its own thumbnail')

// 3. a reload brings the shelf and the board back
const beforeReload = await page.evaluate(() => window.__tbm.store.scene.pitch)
await page.reload()
await page.waitForTimeout(2500)
const after = await page.evaluate(() => ({
  pitch: window.__tbm.store.scene.pitch,
  h: window.__tbm.store.scene.board.h,
  painted: window.__tbm.board.bgLayer.getChildren().some(n => n.className === 'Image'),
}))
check(after.pitch === beforeReload, `the board should stay on its background (${after.pitch})`)
check(after.painted, 'the background image should be drawn again after a reload')

// 4. rename and duplicate act on one tile
await page.click('[data-bar="settings"]')
await pushScreen(page, 'pitch')
list = await tiles()
const target = list[1].id
await page.click(`[data-pitch="${target}"] [data-bg-menu]`)
await page.click('[data-bg-act="rename"]')
await page.waitForTimeout(400)
list = await tiles()
check(list.find(t => t.id === target)?.name === 'Wide camera', `rename should land on its own tile (${JSON.stringify(list)})`)
check(list.length === 2, 'renaming should not add or drop a background')

await page.click(`[data-pitch="${target}"] [data-bg-menu]`)
await page.click('[data-bg-act="duplicate"]')
await page.waitForTimeout(1200)
list = await tiles()
check(list.length === 3, `duplicate should add a third background, got ${list.length}`)
check(list.some(t => t.name === 'Wide camera copy'), `the copy should say so (${list.map(t => t.name)})`)

// 5. what a background is can be changed from its own tile
const flipTarget = await page.evaluate(() => window.__tbm.store.scene.pitch)
await page.click(`[data-pitch="${flipTarget}"] [data-bg-menu]`)
await page.click('[data-bg-act="kind"][data-bg-kind="broadcast"]')
await page.waitForTimeout(600)
const flipped = await page.evaluate(() => ({
  live: !!window.__tbm.pitchById(window.__tbm.store.scene.pitch).live,
  kind: window.__tbm.backgrounds.get(window.__tbm.store.scene.pitch)?.kind,
  sub: document.querySelector(`[data-pitch="${window.__tbm.store.scene.pitch}"] .pitchTileSub`)?.textContent,
}))
check(flipped.kind === 'broadcast', `the tile should hold its new kind (${flipped.kind})`)
check(flipped.live, 'the board on screen should follow the change')
check(flipped.sub?.startsWith('Broadcast ·'), `the tile should say so (${flipped.sub})`)

// 6. deleting the one on screen leaves the board on our own pitch
const showing = await page.evaluate(() => window.__tbm.store.scene.pitch)
await page.click(`[data-pitch="${showing}"] [data-bg-menu]`)
await page.click('[data-bg-act="delete"]')
await page.waitForTimeout(1200)
list = await tiles()
const ended = await page.evaluate(() => ({
  pitch: window.__tbm.store.scene.pitch,
  note: document.querySelector('[data-set-note]').textContent,
}))
check(list.length === 2, `the other two backgrounds should be untouched, got ${list.length}`)
check(!list.some(t => t.id === showing), 'the deleted background should be gone from the shelf')
check(ended.pitch === 'pitch', `deleting what was on screen should fall back to the pitch (${ended.pitch})`)
check(/Deleted/.test(ended.note), `the delete should be reported (${ended.note})`)

// 7. and the shelf is still two after another reload
await page.reload()
await page.waitForTimeout(2500)
await page.click('[data-bar="settings"]')
await pushScreen(page, 'pitch')
list = await tiles()
check(list.length === 2, `the shelf should still hold two after a reload, got ${list.length}`)
await page.screenshot({ path: '/tmp/tbm-backgrounds.png' })

await ctx.close()
await browser.close()
if (errors.length) { console.log('ERRORS:\n' + errors.join('\n')); process.exit(1) }
console.log('OK')
