import { chromium } from 'playwright-core'
import { chromePath } from './lib/chrome.mjs'
const browser = await chromium.launch({ executablePath: chromePath, headless: true })
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
const errors = []
const page = await ctx.newPage()
page.on('pageerror', e => errors.push(`pageerror: ${e.message}`))
// teams loaded in a past session (no `short` stored, like pre-update data)
await page.addInitScript(() => {
  localStorage.setItem('tbm-teams-v1', JSON.stringify([
    { name: 'Chelsea', color: '#034694', colours: ['#034694'], roster: [{ name: 'Reece James', number: '24', position: 'Defender' }], side: 'home' },
    { name: 'AFC Bournemouth', color: '#d3151b', colours: ['#d3151b'], roster: [{ name: 'Justin Kluivert', number: '19', position: 'Midfielder' }], side: 'away' },
  ]))
})
await page.goto('http://localhost:4173/')
await page.waitForTimeout(700)

// 1. startup fills the blank codes from the already-loaded sides
const m0 = await page.evaluate(() => window.__tbm.store.scene.match)
console.log('startup codes:', JSON.stringify(m0))
if (m0?.home !== 'CHE' || m0?.away !== 'BOU' || !m0?.showTeams)
  errors.push(`startup did not fill codes from stored teams: ${JSON.stringify(m0)}`)
const drawn = await page.evaluate(() => window.__tbm.board.overlayLayer.find('Text').map(t => t.text()))
if (!drawn.includes('CHE') || !drawn.includes('BOU')) errors.push(`corner codes not drawn: ${JSON.stringify(drawn)}`)

// 2. typing in the cog updates live and switches the section on
await page.click('[data-top="match"]')
await page.waitForTimeout(200)
await page.fill('[data-match-f="clock"]', '24:19')
await page.waitForTimeout(150)
const m1 = await page.evaluate(() => window.__tbm.store.scene.match)
console.log('after typing clock:', JSON.stringify({ clock: m1.clock, showScoreboard: m1.showScoreboard }))
if (m1.clock !== '24:19' || !m1.showScoreboard) errors.push(`typing the clock did not show the scoreboard: ${JSON.stringify(m1)}`)
const sb = await page.evaluate(() => window.__tbm.board.overlayLayer.find('Text').map(t => t.text()))
if (!sb.some(t => t.includes('24:19'))) errors.push(`scoreboard not drawn after typing: ${JSON.stringify(sb)}`)
// manual code override applies as you type
await page.fill('[data-match-f="home"]', 'CFC')
await page.waitForTimeout(150)
const m2 = await page.evaluate(() => window.__tbm.store.scene.match.home)
if (m2 !== 'CFC') errors.push(`typing a team code did not apply (${m2})`)

// 3. a board that already carries codes is left alone on reload
await page.evaluate(() => window.__tbm.store.apply(s => { s.match = { ...s.match, home: 'XXX', away: 'YYY' } }))
await page.waitForTimeout(300)
await page.reload()
await page.waitForTimeout(700)
const m3 = await page.evaluate(() => window.__tbm.store.scene.match)
console.log('after reload:', JSON.stringify({ home: m3?.home, away: m3?.away }))
if (m3?.home !== 'XXX' || m3?.away !== 'YYY') errors.push(`reload overwrote manual codes: ${JSON.stringify(m3)}`)

await browser.close()
if (errors.length) { console.log('ERRORS:\n' + errors.join('\n')); process.exit(1) }
console.log('OK')
