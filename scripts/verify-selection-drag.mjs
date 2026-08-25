import { chromium } from 'playwright-core'
import { chromePath } from './lib/chrome.mjs'

const baseUrl = new URL(process.env.BOARD_URL || 'http://localhost:4173/').href
const browser = await chromium.launch({ executablePath: chromePath, headless: process.env.HEADFUL !== '1' })
const page = await browser.newPage({ viewport: { width: 900, height: 800 } })
const errors = []
const check = (ok, message) => { if (!ok) errors.push(message) }

await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 45000 })
await page.waitForFunction(() => window.__tbm?.board && window.__tbm?.store, null, { timeout: 45000 })
await page.waitForTimeout(400)

const toScreen = p => page.evaluate(({ x, y }) => {
  const board = window.__tbm.board
  const rect = board.stage.container().getBoundingClientRect()
  const scale = board.stage.scaleX()
  return {
    x: rect.left + board.stage.x() + x * scale,
    y: rect.top + board.stage.y() + y * scale,
    scale,
  }
}, p)

const snapshot = () => page.evaluate(() => {
  const { board, store } = window.__tbm
  return {
    boxes: board.stage.find('.selbox').map(node => ({
      id: node.getAttr('selectionId'),
      x: node.x(),
      y: node.y(),
    })),
    arrow: structuredClone(store.obj('drag-arrow')),
    arrowNode: board.objLayer.findOne('#drag-arrow')?.position() ?? null,
  }
})

const arrow = (y = 260) => ({
  id: 'drag-arrow', type: 'arrow',
  x1: 220, y1: y, mx: 300, my: y, x2: 380, y2: y,
  curved: false, dash: 'solid', color: '#111111', width: 4.5,
  head: true, measure: false, headSize: 14,
})

await page.evaluate(arrowObj => {
  const { store } = window.__tbm
  store.apply(scene => { scene.objects = [arrowObj] })
  store.select(arrowObj.id)
}, arrow())

const singleBefore = await snapshot()
const arrowStart = await toScreen({ x: 300, y: 260 })
await page.mouse.move(arrowStart.x, arrowStart.y)
await page.mouse.down()
await page.mouse.move(arrowStart.x + 90, arrowStart.y + 55, { steps: 6 })
const singleMid = await snapshot()
const singleDx = 90 / arrowStart.scale
const singleDy = 55 / arrowStart.scale
check(
  Math.abs(singleMid.arrow.x1 - singleBefore.arrow.x1 - singleDx) < 1,
  `single arrow data moved by the wrong amount: ${JSON.stringify({ singleBefore, singleMid, singleDx })}`,
)
check(
  Math.abs(singleMid.boxes[0].x - singleBefore.boxes[0].x - singleDx) < 1
    && Math.abs(singleMid.boxes[0].y - singleBefore.boxes[0].y - singleDy) < 1,
  `single outline detached: ${JSON.stringify({ singleBefore, singleMid, singleDx, singleDy })}`,
)
check(
  Math.abs(singleMid.arrowNode.x) < 0.01 && Math.abs(singleMid.arrowNode.y) < 0.01,
  `single arrow received a second translation: ${JSON.stringify(singleMid.arrowNode)}`,
)
await page.mouse.up()

await page.evaluate(arrowObj => {
  const { store } = window.__tbm
  store.apply(scene => {
    scene.objects = [
      {
        id: 'drag-player', type: 'player', x: 260, y: 220, r: 14,
        color: '#ffffff', label: '', name: '', namePos: 'bottom', nameSize: 18, nameDisplay: 'last',
      },
      arrowObj,
    ]
  })
  store.selectMany(['drag-player', arrowObj.id])
}, arrow(300))

const multiBefore = await snapshot()
const playerStart = await toScreen({ x: 260, y: 220 })
await page.mouse.move(playerStart.x, playerStart.y)
await page.mouse.down()
await page.mouse.move(playerStart.x + 75, playerStart.y + 40, { steps: 6 })
const multiMid = await snapshot()
const multiDx = 75 / playerStart.scale
const multiDy = 40 / playerStart.scale
for (const before of multiBefore.boxes) {
  const after = multiMid.boxes.find(box => box.id === before.id)
  check(
    !!after
      && Math.abs(after.x - before.x - multiDx) < 1
      && Math.abs(after.y - before.y - multiDy) < 1,
    `multi-select outline ${before.id} detached: ${JSON.stringify({ before, after, multiDx, multiDy })}`,
  )
}
check(
  Math.abs(multiMid.arrowNode.x) < 0.01 && Math.abs(multiMid.arrowNode.y) < 0.01,
  `multi-select arrow received a second translation: ${JSON.stringify(multiMid.arrowNode)}`,
)
await page.mouse.up()

await browser.close()
if (errors.length) {
  console.log(`BOARD_URL=${baseUrl}`)
  console.log(`ERRORS:\n${errors.join('\n')}`)
  process.exit(1)
}
console.log(`OK ${baseUrl}`)
