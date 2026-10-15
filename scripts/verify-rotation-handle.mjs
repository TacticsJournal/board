import { chromium } from 'playwright-core'
import { chromePath } from './lib/chrome.mjs'

const baseUrl = new URL(process.env.BOARD_URL || 'http://localhost:4173/').href
const browser = await chromium.launch({ executablePath: chromePath, headless: process.env.HEADFUL !== '1' })
const page = await browser.newPage({ viewport: { width: 900, height: 800 } })
const errors = []
const check = (ok, message) => { if (!ok) errors.push(message) }
const angleDistance = (a, b) => Math.abs((((a - b) + 180) % 360 + 360) % 360 - 180)

await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 45000 })
await page.waitForFunction(() => window.__tbm?.board && window.__tbm?.store, null, { timeout: 45000 })

async function dragTopRight(id, center, snapEnabled) {
  await page.evaluate(({ objectId, snap }) => {
    window.__tbm.board.setSnapEnabled(snap)
    window.__tbm.store.select(objectId)
  }, { objectId: id, snap: snapEnabled })
  await page.waitForTimeout(50)
  const handle = await page.evaluate(center => {
    const board = window.__tbm.board
    const node = board.stage.findOne('.resize-node')
    if (!node) return null
    const point = node.getAbsolutePosition()
    const middle = board.boardToScreen(center)
    const rect = board.stage.container().getBoundingClientRect()
    return {
      x: rect.left + point.x,
      y: rect.top + point.y,
      centerX: rect.left + middle.x,
      centerY: rect.top + middle.y,
    }
  }, center)
  check(handle, `${id} has no top-right rotation node`)
  if (!handle) return
  const startAngle = Math.atan2(handle.y - handle.centerY, handle.x - handle.centerX)
  const radius = Math.hypot(handle.x - handle.centerX, handle.y - handle.centerY)
  const requested = -28
  const endAngle = startAngle + requested * Math.PI / 180
  const end = {
    x: handle.centerX + Math.cos(endAngle) * radius,
    y: handle.centerY + Math.sin(endAngle) * radius,
  }
  await page.mouse.move(handle.x, handle.y)
  await page.mouse.down()
  await page.mouse.move(end.x, end.y, { steps: 8 })
  await page.mouse.up()
  return snapEnabled ? -30 : requested
}

await page.evaluate(() => {
  window.__tbm.store.apply(scene => {
    scene.objects = [{
      id: 'rotation-arrow', type: 'arrow', x1: 220, y1: 300, mx: 300, my: 300, x2: 380, y2: 300,
      curved: true, dash: 'solid', color: '#111111', width: 4.5, head: true, measure: false, headSize: 14,
      points: [{ x: 220, y: 300 }, { x: 300, y: 300, c: 'round' }, { x: 380, y: 300 }],
    }]
  })
})
const expectedArrowAngle = await dragTopRight('rotation-arrow', { x: 300, y: 300 }, false)
const arrow = await page.evaluate(() => structuredClone(window.__tbm.store.obj('rotation-arrow')))
const arrowLength = Math.hypot(arrow.x2 - arrow.x1, arrow.y2 - arrow.y1)
const arrowAngle = Math.atan2(arrow.y2 - arrow.y1, arrow.x2 - arrow.x1) * 180 / Math.PI
check(Math.abs(arrowLength - 160) < 0.1, `arrow resized from 160 to ${arrowLength}`)
check(angleDistance(arrowAngle, expectedArrowAngle) < 1, `arrow rotated to ${arrowAngle} degrees, expected ${expectedArrowAngle}`)

await page.evaluate(() => {
  window.__tbm.store.apply(scene => {
    scene.objects = [{
      id: 'rotation-zone', type: 'box', shape: 'rect', x: 300, y: 280, w: 160, h: 80,
      rotation: 0, fill: '#9ca3af', opacity: 0.45, label: '', labelPos: 'top',
      corners: [{ x: 220, y: 240 }, { x: 380, y: 240 }, { x: 380, y: 320 }, { x: 220, y: 320 }],
    }]
  })
})
const expectedZoneAngle = await dragTopRight('rotation-zone', { x: 300, y: 280 }, true)
const zone = await page.evaluate(() => structuredClone(window.__tbm.store.obj('rotation-zone')))
const zoneTop = Math.hypot(zone.corners[1].x - zone.corners[0].x, zone.corners[1].y - zone.corners[0].y)
check(Math.abs(zone.w - 160) < 0.1 && Math.abs(zone.h - 80) < 0.1, `zone dimensions changed to ${zone.w}x${zone.h}`)
check(Math.abs(zoneTop - 160) < 0.1, `zone edge resized from 160 to ${zoneTop}`)
check(angleDistance(zone.rotation, expectedZoneAngle) < 1, `zone rotated to ${zone.rotation} degrees, expected ${expectedZoneAngle}`)

await browser.close()
if (errors.length) {
  console.log(`BOARD_URL=${baseUrl}`)
  console.log(`ERRORS:\n${errors.join('\n')}`)
  process.exit(1)
}
console.log(`OK ${baseUrl}: arrow and zone rotated without resizing`)
