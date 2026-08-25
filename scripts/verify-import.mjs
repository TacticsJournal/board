// Screenshot import end-to-end, fully client-side. The synthetic frame
// (scripts/make-test-screenshot.py -> /tmp/tbm-screenshot.png) exercises the
// browser's canvas-based player and pitch-corner detection.
import { chromium } from 'playwright-core'
import { chromePath } from './lib/chrome.mjs'

const browser = await chromium.launch({
  executablePath: chromePath,
  headless: true,
})

const errors = []
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
const page = await ctx.newPage()
page.on('pageerror', e => errors.push(`pageerror: ${e.message}`))
await page.goto('http://localhost:4173/')
await page.waitForTimeout(600)

const statusText = () => page.evaluate(() => document.querySelector('[data-imp="status"]').textContent)
const waitDetect = async () => {
  // Wait for the browser's detection pass to report a result.
  await page.waitForFunction(
    () => /Detected \d+|Could not auto-detect|reference corners but no players/.test(
      document.querySelector('[data-imp="status"]').textContent),
    null, { timeout: 90000 },
  )
  return statusText()
}
// ---- synthetic screenshot, browser heuristic detection ----
await page.evaluate(() => window.__tbm.importer.open())
await page.setInputFiles('[data-imp="file"]', '/tmp/tbm-screenshot.png')
const status1 = await waitDetect()
const detected = Number(/Detected (\d+)/.exec(status1)?.[1] ?? 0)
console.log('synthetic auto-detect:', detected, 'marks')
if (detected < 18 || detected > 26) errors.push(`expected ~22 detections, got ${detected} (${status1})`)
if (!/4 pitch (reference )?corners/.test(status1)) errors.push(`expected automatic corner detection (${status1})`)
await page.click('[data-imp="map"]')
await page.waitForTimeout(300)
const mapped = await page.evaluate(() => {
  const ps = window.__tbm.store.scene.objects.filter(o => o.type === 'player')
  return { count: ps.length, inBounds: ps.every(p => p.x >= 0 && p.x <= 800 && p.y >= 0 && p.y <= window.__tbm.store.scene.board.h) }
})
console.log('synthetic mapped:', JSON.stringify(mapped))
if (mapped.count !== detected) errors.push(`mapped ${mapped.count} of ${detected} detections`)
if (!mapped.inBounds) errors.push('mapped players landed outside the board')

await page.screenshot({ path: '/tmp/tbm-import.png' })
await browser.close()
if (errors.length) { console.log('ERRORS:\n' + errors.join('\n')); process.exit(1) }
console.log('OK')
