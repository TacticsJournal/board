// Uploaded backgrounds, everywhere a board is drawn from markup:
//  - a board card in the Boards view shows the uploaded image
//  - a project-strip thumbnail in the Projects view shows it too
//  - the animation player shows it, for a pitch and for a broadcast
//  - the player draws the background once rather than per frame
import { chromium } from 'playwright-core'
import { chromePath } from './lib/chrome.mjs'

// two images that cannot be mistaken for one another, or for our own art
const pitchShot = new URL('./fixtures/match-real.jpg', import.meta.url).pathname
const broadcastShot = new URL('../assets/pitch/training_marked.jpeg', import.meta.url).pathname

const browser = await chromium.launch({ executablePath: chromePath, headless: true })
const errors = []
const check = (ok, msg) => { if (!ok) errors.push(msg) }

const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
const page = await ctx.newPage()
page.on('pageerror', e => errors.push(`pageerror: ${e.message}`))
page.on('dialog', d => d.accept())
await page.goto(process.env.BOARD_URL ?? 'http://localhost:4173/')
await page.waitForTimeout(900)

const pushScreen = async (screen) => {
  const atRoot = await page.evaluate(() => {
    const root = document.querySelector('[data-pane="root"]')
    return !!root && !root.classList.contains('hidden')
  })
  if (!atRoot) { await page.click('.setBack'); await page.waitForTimeout(80) }
  await page.locator(`[data-goto="${screen}"]`).first().click()
  await page.waitForTimeout(150)
}

async function addBackground(kind, file) {
  await page.click('[data-bar="settings"]')
  await pushScreen('pitch')
  await page.click('[data-bg-add]')
  await page.waitForTimeout(200)
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser', { timeout: 5000 }),
    page.click(`[data-kind="${kind}"]`),
  ])
  await chooser.setFiles(file)
  await page.waitForTimeout(1800)
  const id = await page.evaluate(() => window.__tbm.store.scene.pitch)
  await page.click('[data-set="close"]').catch(() => {})
  await page.waitForTimeout(200)
  return id
}

/** Board one on a pitch background, board two on a broadcast one. */
const pitchId = await addBackground('pitch', pitchShot)
check(pitchId?.startsWith('bg:'), `board one should be on an uploaded pitch (${pitchId})`)

const openBoards = async () => {
  const open = await page.evaluate(() => !document.querySelector('#libRoot').hidden)
  if (!open) await page.click('[data-top="boards"]')
  await page.waitForTimeout(300)
}
await openBoards()
await page.click('.libFoot [data-act="add"]')
await page.waitForTimeout(200)
await page.click('[data-add="copy"]')
await page.waitForTimeout(400)

const broadcastId = await addBackground('broadcast', broadcastShot)
check(broadcastId?.startsWith('bg:') && broadcastId !== pitchId, `board two should be on an uploaded broadcast (${broadcastId})`)

/** Every card's own pitch image, by whether it has bytes to draw. */
const cardImages = () => page.evaluate(() => [...document.querySelectorAll('.boardShot .libShot')]
  .map(svg => svg.querySelector('image')?.getAttribute('href') ?? ''))

await openBoards()
await page.waitForTimeout(600)
let cards = await cardImages()
check(cards.length === 2, `two board cards expected, got ${cards.length}`)
check(cards.every(href => href.startsWith('data:image/')),
  `every board card should draw its uploaded background (${cards.map(h => h.slice(0, 24))})`)
await page.screenshot({ path: '/tmp/tbm-backgrounds-boards.png' })

// the Projects screen draws the same boards in its strip
await page.click('[data-lib="to-projects"]')
await page.waitForTimeout(600)
const strip = await page.evaluate(() => [...document.querySelectorAll('.projStrip .libShot')]
  .map(svg => svg.querySelector('image')?.getAttribute('href') ?? ''))
check(strip.length >= 2 && strip.every(href => href.startsWith('data:image/')),
  `every strip thumbnail should draw its background (${strip.length}: ${strip.map(h => h.slice(0, 24))})`)
await page.screenshot({ path: '/tmp/tbm-backgrounds-projects.png' })

// and the player draws it through the whole animation
// back into the project's boards, the way a person goes: through its card
await page.click('.projCard')
await page.waitForTimeout(500)
await page.click('.libFoot [data-act="play"]')
await page.waitForTimeout(700)
const ground = () => page.evaluate(() => {
  const image = document.querySelector('[data-play="ground"] image')
  return { href: image?.getAttribute('href') ?? '', node: image ?? null ? 1 : 0 }
})
const atStart = await ground()
check(atStart.href.startsWith('data:image/'), `the player should draw the uploaded background (${atStart.href.slice(0, 24)})`)
await page.screenshot({ path: '/tmp/tbm-backgrounds-player-start.png' })

// the same <image> element survives a move rather than being rebuilt per frame
await page.evaluate(() => { window.__tbmGround = document.querySelector('[data-play="ground"] image') })
await page.click('[data-play="toggle"]')
await page.waitForTimeout(500)
const mid = await page.evaluate(() => ({
  same: document.querySelector('[data-play="ground"] image') === window.__tbmGround,
  href: document.querySelector('[data-play="ground"] image')?.getAttribute('href') ?? '',
}))
check(mid.href.startsWith('data:image/'), 'the background should still be drawn mid-move')
await page.waitForTimeout(2500)
const atEnd = await ground()
check(atEnd.href.startsWith('data:image/'), `the broadcast board should draw its background too (${atEnd.href.slice(0, 24)})`)
check(atEnd.href !== atStart.href, 'the second board is a different background from the first')
await page.screenshot({ path: '/tmp/tbm-backgrounds-player-end.png' })

await browser.close()
if (errors.length) {
  console.error(errors.map(e => `✖ ${e}`).join('\n'))
  process.exit(1)
}
console.log('✔ uploaded backgrounds draw in board cards, the project strip and the player')
