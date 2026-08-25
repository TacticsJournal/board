import { chromium } from 'playwright-core'
import { chromePath } from './lib/chrome.mjs'
import { writeFileSync } from 'node:fs'
const browser = await chromium.launch({ executablePath: chromePath, headless: true })
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage()
await page.goto('http://localhost:4173/')
await page.waitForTimeout(700)
// export the default pitch with the example's match info at 2048-wide
const dataUrl = await page.evaluate(() => {
  window.__tbm.store.loadScene({
    version: 2, board: { w: 800, h: 618 }, pitch: 'pitch',
    match: { home: 'BOU', away: 'CHE', homeScore: '0', awayScore: '0', clock: '24:19', date: '15 Sep 2024', showScoreboard: true, showTeams: true },
    objects: [],
  })
  return window.__tbm.board.exportPng()
})
writeFileSync('/tmp/export-pitch.png', Buffer.from(dataUrl.split(',')[1], 'base64'))
await browser.close()
console.log('saved')
