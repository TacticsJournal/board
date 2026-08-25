// End-to-end test of the home/away team setup: Teams sheet cards, player
// menu chips, +Player / +XI, swap, kit recolor, and the Saves "New board"
// flows. Uses the live TheSportsDB and Wikipedia APIs.
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
// the header pings the live tacticsjournal.com API; on localhost those
// calls are CORS-blocked (the board origins only work in production) and
// the app handles it, so that noise is not a failure
const benign = (t) => t.includes('tacticsjournal.com/api') || t.includes('Failed to load resource')
page.on('console', m => { if (m.type() === 'error' && !benign(m.text())) errors.push(`console: ${m.text()}`) })
await page.goto('http://localhost:4173/')
await page.waitForTimeout(800)

const W = 800
const players = () => page.evaluate(() =>
  window.__tbm.store.scene.objects.filter(o => o.type === 'player')
    .map(o => ({ x: o.x, team: o.team, color: o.color, name: o.name, label: o.label })))

// teams and boards are push screens in the bottom-bar Settings list
const gotoScreen = async (screen) => {
  await page.click('[data-bar="settings"]')
  const atRoot = await page.evaluate(() => !document.querySelector('[data-pane="root"]').classList.contains('hidden'))
  if (!atRoot) { await page.click('.setBack'); await page.waitForTimeout(80) }
  await page.locator(`[data-goto="${screen}"]`).first().click()
  await page.waitForTimeout(150)
}
const openTeams = () => gotoScreen('teams')
const openSaves = () => gotoScreen('boards')

// 1. Teams screen: both sides on one page, each with its own search field, both unset
await openTeams()
const cards0 = await page.evaluate(() => Array.from(document.querySelectorAll('.tmCard')).map(c => ({
  side: c.dataset.side, text: c.textContent.trim().slice(0, 40),
  fields: c.querySelectorAll('[data-tm="query"]').length,
})))
console.log('cards initial:', JSON.stringify(cards0))
if (cards0.length !== 2 || !/Not set/.test(cards0[0].text)) errors.push(`bad initial cards: ${JSON.stringify(cards0)}`)
if (!cards0.every(c => c.fields === 1)) errors.push(`each side needs its own search field: ${JSON.stringify(cards0)}`)

// 2. load Arsenal as home, typing into the home side's own field
await page.fill('[data-tm="query"][data-side="home"]', 'Arsenal')
await page.press('[data-tm="query"][data-side="home"]', 'Enter')
await page.waitForSelector('[data-tm="team"]', { timeout: 15000 })
await page.click('[data-tm="team"]')
await page.waitForFunction(() => /players/.test(document.querySelector('.tmCard[data-side="home"]')?.textContent ?? ''), { timeout: 20000 })
const homeCard = await page.evaluate(() => {
  const c = document.querySelector('.tmCard[data-side="home"]')
  return { text: c.textContent, kit: c.querySelectorAll('[data-tm="color"]').length }
})
console.log('home card kit swatches:', homeCard.kit)
if (!/Arsenal/.test(homeCard.text) || homeCard.kit < 1 || !/players/.test(homeCard.text)) errors.push('home card not populated after load')

// 3. load Liverpool as away by typing into the away side's own field
await page.fill('[data-tm="query"][data-side="away"]', 'Liverpool')
await page.press('[data-tm="query"][data-side="away"]', 'Enter')
await page.waitForSelector('[data-tm="team"]', { timeout: 15000 })
await page.click('[data-tm="team"]')
await page.waitForFunction(() => /players/.test(document.querySelector('.tmCard[data-side="away"]')?.textContent ?? ''), { timeout: 20000 })
const awayName = await page.evaluate(() => document.querySelector('.tmCard[data-side="away"] .tmCardName').textContent.trim())
console.log('away card:', awayName)
if (!/Liverpool/.test(awayName)) errors.push(`away card shows ${awayName}`)

// 3b. loading the sides auto-fills the team codes in the bottom corners
const codes0 = await page.evaluate(() => {
  const m = window.__tbm.store.scene.match
  return { home: m?.home, away: m?.away, showTeams: m?.showTeams }
})
console.log('auto codes:', JSON.stringify(codes0))
if (codes0.home !== 'ARS' || codes0.away !== 'LIV' || !codes0.showTeams)
  errors.push(`team codes not auto-filled: ${JSON.stringify(codes0)}`)
const corner = await page.evaluate(() => {
  const bh = window.__tbm.board.boardH
  const texts = window.__tbm.board.overlayLayer.find('Text').map(t => ({ text: t.text(), x: t.x(), y: t.y() }))
  return { bh, texts }
})
console.log('overlay:', JSON.stringify(corner))
const left = corner.texts.find(t => t.text === 'ARS')
const right = corner.texts.find(t => t.text === 'LIV')
if (!left || left.x > 100 || left.y < corner.bh * 0.8) errors.push('home code not drawn in the bottom-left corner')
if (!right || right.x < 700 - 100 || right.y < corner.bh * 0.8) errors.push('away code not drawn in the bottom-right corner')
await page.click('[data-set="close"]')

// 4. player menu: two chips, + Player, + XI
const strip = await page.evaluate(() => ({
  chips: Array.from(document.querySelectorAll('#options .teamChip')).map(c => c.textContent.trim()),
  ghosts: document.querySelectorAll('#options .teamChip.ghost').length,
  adds: Array.from(document.querySelectorAll('#options .addChip')).map(c => c.textContent.trim()),
}))
console.log('player menu:', JSON.stringify(strip))
if (strip.chips.length !== 2 || strip.ghosts !== 0) errors.push(`expected 2 configured chips: ${JSON.stringify(strip)}`)
if (!strip.adds.includes('+ Player') || !strip.adds.includes('+ XI')) errors.push(`missing add buttons: ${JSON.stringify(strip.adds)}`)

// 5. home XI lands on the left half with names and numbers
await page.click('#options .teamChip')
await page.click('[data-opt="d-add-xi"]')
await page.waitForTimeout(200)
let ps = await players()
console.log('home XI:', ps.length)
if (ps.length !== 11) errors.push(`home XI placed ${ps.length} players`)
if (ps.some(p => p.x > W / 2)) errors.push('home XI crossed the halfway line')
if (ps.some(p => p.name)) errors.push('XI dots should be plain (no names)')
if (ps.some(p => p.label)) errors.push('XI dots should not carry shirt numbers')

// 6. away XI lands on the right half
await page.keyboard.press('Escape')
await page.evaluate(() => { document.querySelectorAll('#options .teamChip')[1].click() })
await page.click('[data-opt="d-add-xi"]')
await page.waitForTimeout(200)
ps = await players()
const away = ps.slice(11)
if (away.length !== 11 || away.some(p => p.x < W / 2)) errors.push('away XI not on the right half')

// 7. + Player adds a single dot in the active team color
await page.keyboard.press('Escape')
await page.click('[data-opt="d-add-player"]')
await page.waitForTimeout(150)
ps = await players()
if (ps.length !== 23) errors.push(`+ Player did not add one dot (${ps.length})`)

// 8. swap mirrors the whole board: players, arrows, zones, ball
await page.evaluate(() => {
  window.__tbm.store.apply(s => {
    s.objects.push(
      { id: 'arr1', type: 'arrow', x1: 100, y1: 200, x2: 300, y2: 220, mx: 200, my: 210, curved: false, dash: 'solid', color: '#111111', width: 4, head: true },
      { id: 'box1', type: 'box', shape: 'rect', x: 200, y: 150, w: 80, h: 60, rotation: 0, fill: '#9ca3af', opacity: 0.45 },
      { id: 'ball1', type: 'ball', x: 250, y: 200, size: 20 },
    )
  })
})
const beforeSwap = await players()
await page.keyboard.press('Escape')
await openTeams()
await page.click('[data-tm="swap"]')
await page.waitForTimeout(200)
const afterSwap = await players()
const mirroredOk = beforeSwap.slice(0, 22).every((p, i) => Math.abs((W - p.x) - afterSwap[i].x) < 0.01)
const extras = await page.evaluate(() => {
  const get = id => window.__tbm.store.obj(id)
  return { arrow: get('arr1'), box: get('box1'), ball: get('ball1') }
})
console.log('swap mirrored 22 players:', mirroredOk, 'arrow:', extras.arrow.x1, extras.arrow.x2, 'box:', extras.box.x, 'ball:', extras.ball.x)
if (!mirroredOk) errors.push('swap did not mirror team players')
if (extras.arrow.x1 !== W - 100 || extras.arrow.x2 !== W - 300 || extras.arrow.mx !== W - 200) errors.push('swap did not mirror the arrow')
if (extras.box.x !== W - 200 || extras.ball.x !== W - 250) errors.push('swap did not mirror zone/ball')
const codesSwap = await page.evaluate(() => ({ home: window.__tbm.store.scene.match.home, away: window.__tbm.store.scene.match.away }))
console.log('codes after swap:', JSON.stringify(codesSwap))
if (codesSwap.home !== 'LIV' || codesSwap.away !== 'ARS') errors.push(`swap did not swap the corner codes: ${JSON.stringify(codesSwap)}`)

// 8b. flip board mirrors everything back
await page.click('[data-tm="flip-board"]')
await page.waitForTimeout(200)
const afterFlip = await page.evaluate(() => ({
  arrowX1: window.__tbm.store.obj('arr1').x1,
  ballX: window.__tbm.store.obj('ball1').x,
  firstPlayerX: window.__tbm.store.scene.objects.find(o => o.type === 'player').x,
  codes: { home: window.__tbm.store.scene.match.home, away: window.__tbm.store.scene.match.away },
}))
console.log('flip board restored:', JSON.stringify(afterFlip))
if (afterFlip.arrowX1 !== 100 || afterFlip.ballX !== 250) errors.push('flip board did not mirror all objects')
if (Math.abs(afterFlip.firstPlayerX - beforeSwap[0].x) > 0.01) errors.push('flip board did not mirror players back')
if (afterFlip.codes.home !== 'ARS' || afterFlip.codes.away !== 'LIV') errors.push(`flip board did not swap the corner codes: ${JSON.stringify(afterFlip.codes)}`)
// flip board closes the team sheet; reopen it for the kit recolor step
await openTeams()
// leave the board mirrored the same way as before swap for the next steps

// 9. kit recolor changes outfielders, keeps the GK color
const kit = await page.evaluate(() => {
  const card = document.querySelector('.tmCard[data-side="away"]') // Arsenal after swap
  const sws = Array.from(card.querySelectorAll('[data-tm="color"]'))
  const next = sws.find(s => !s.classList.contains('active'))
  return next ? { v: next.dataset.v, name: card.querySelector('.tmCardName').textContent.trim() } : null
})
if (kit) {
  const gkBefore = (await players()).filter(p => p.team === kit.name && (p.color === '#6b7280' || p.color === '#d1d5db')).length
  await page.click(`.tmCard[data-side="away"] [data-tm="color"][data-v="${kit.v}"]`)
  await page.waitForTimeout(200)
  const after = (await players()).filter(p => p.team === kit.name)
  const recolored = after.filter(p => p.color === kit.v).length
  const gkAfter = after.filter(p => p.color === '#6b7280' || p.color === '#d1d5db').length
  console.log('recolor:', JSON.stringify({ recolored, gkBefore, gkAfter }))
  if (recolored < 9) errors.push(`kit recolor changed only ${recolored} dots`)
  if (gkBefore !== gkAfter) errors.push('kit recolor overwrote the goalkeeper color')
} else {
  console.log('skip recolor: club exposes a single kit color')
}
await page.click('[data-set="close"]')

// 9b. flip tool fab: a selected arrow mirrors in place around its center
await page.evaluate(() => window.__tbm.store.select('arr1'))
await page.waitForTimeout(150)
const fabState = await page.evaluate(() => ({
  flipVisible: !document.querySelector('#flipHBtn').classList.contains('hidden'),
  x1: window.__tbm.store.obj('arr1').x1, x2: window.__tbm.store.obj('arr1').x2,
}))
if (!fabState.flipVisible) errors.push('flip fab not shown for a selected arrow')
await page.click('#flipHBtn')
await page.waitForTimeout(150)
const flipped = await page.evaluate(() => {
  const a = window.__tbm.store.obj('arr1')
  return { x1: a.x1, x2: a.x2 }
})
console.log('flip fab:', JSON.stringify({ before: { x1: fabState.x1, x2: fabState.x2 }, after: flipped }))
if (Math.abs(flipped.x1 - fabState.x2) > 0.01 || Math.abs(flipped.x2 - fabState.x1) > 0.01)
  errors.push('flip fab did not mirror the arrow in place')
// flip fab hidden for a lone player
await page.evaluate(() => {
  const pl = window.__tbm.store.scene.objects.find(o => o.type === 'player')
  window.__tbm.store.select(pl.id)
})
await page.waitForTimeout(150)
if (await page.evaluate(() => !document.querySelector('#flipHBtn').classList.contains('hidden')))
  errors.push('flip fab should be hidden for a lone player dot')
await page.keyboard.press('Escape')

// 10. Saves: new blank board autosaves the old one silently (no dialog)
const savedBefore = await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('tbm-projects-v1') ?? '{}')).length)
await openSaves()
await page.click('[data-sv="new-blank"]')
await page.waitForTimeout(200)
const blankCount = await page.evaluate(() => window.__tbm.store.scene.objects.length)
const savedAfter = await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('tbm-projects-v1') ?? '{}')).length)
console.log('new blank: objects', blankCount, 'saved boards', savedBefore, '->', savedAfter)
if (blankCount !== 0) errors.push(`new blank board has ${blankCount} objects`)
// +2: the old board is autosaved and the new board registers its own entry
if (savedAfter !== savedBefore + 2) errors.push('starting a new board did not autosave the old board and register the new one')
// 11. placing the ball hands the toolbar back to Player
await page.click('[data-tool="ball"]')
const stage = await page.locator('#stage').boundingBox()
await page.mouse.click(stage.x + stage.width / 2, stage.y + stage.height / 2)
await page.waitForTimeout(200)
const ballState = await page.evaluate(() => ({
  balls: window.__tbm.store.scene.objects.filter(o => o.type === 'ball').length,
  tool: window.__tbm.board.tool,
}))
console.log('ball placed:', JSON.stringify(ballState))
if (ballState.balls !== 1 || ballState.tool !== 'player') errors.push(`ball tool did not reset: ${JSON.stringify(ballState)}`)

// 12. defaults: arrow medium, zone 25%
const defs = await page.evaluate(() => window.__tbm.board.defaults)
if (defs.arrow.width !== 4.5) errors.push(`arrow default width ${defs.arrow.width}, expected 4.5`)
if (defs.box.opacity !== 0.25) errors.push(`zone default opacity ${defs.box.opacity}, expected 0.25`)

await openSaves()
await page.click('[data-sv="new-teams"]')
await page.waitForTimeout(300)
const kickoff = await page.evaluate(() => ({
  players: window.__tbm.store.scene.objects.filter(o => o.type === 'player').length,
  balls: window.__tbm.store.scene.objects.filter(o => o.type === 'ball').length,
}))
console.log('kickoff board:', JSON.stringify(kickoff))
if (kickoff.players !== 22 || kickoff.balls !== 1) errors.push(`kickoff board wrong: ${JSON.stringify(kickoff)}`)
const kickCodes = await page.evaluate(() => {
  const m = window.__tbm.store.scene.match
  return { home: m?.home, away: m?.away, showTeams: m?.showTeams }
})
console.log('kickoff codes:', JSON.stringify(kickCodes))
if (kickCodes.home !== 'LIV' || kickCodes.away !== 'ARS' || !kickCodes.showTeams)
  errors.push(`kickoff board missing the corner codes: ${JSON.stringify(kickCodes)}`)

// 12b. the cog in the top tools opens the match sheet prefilled with the codes
await page.click('[data-top="match"]')
await page.waitForTimeout(200)
const cog = await page.evaluate(() => ({
  open: !!document.querySelector('.modal:not(.hidden) [data-match-f="clock"]'),
  home: document.querySelector('[data-match-f="home"]')?.value,
  away: document.querySelector('[data-match-f="away"]')?.value,
}))
console.log('match cog:', JSON.stringify(cog))
if (!cog.open) errors.push('the match cog did not open the match sheet')
if (cog.home !== 'LIV' || cog.away !== 'ARS') errors.push(`match sheet not prefilled with the codes: ${JSON.stringify(cog)}`)
await page.keyboard.press('Escape')
await page.waitForTimeout(200)

// 13. every saved board shows an svg preview, and tapping it loads the board
await openSaves()
const prev = await page.evaluate(() => {
  const items = [...document.querySelectorAll('.saveItem')]
  return {
    items: items.length,
    withShapes: items.filter(i => i.querySelector('.savePrev svg circle, .savePrev svg path, .savePrev svg rect')).length,
  }
})
console.log('save previews:', JSON.stringify(prev))
if (!prev.items || prev.withShapes !== prev.items) errors.push(`save previews missing shapes: ${JSON.stringify(prev)}`)
await page.click('.saveItem .savePrev')
await page.waitForTimeout(200)
const previewLoaded = await page.evaluate(() => window.__tbm.store.scene.objects.length)
console.log('preview tap loaded objects:', previewLoaded)
if (!previewLoaded) errors.push('tapping a save preview did not load that board')

// 14. arrow tool: one-shot draw, transform box, drag-anywhere moves
await page.evaluate(() => window.__tbm.store.loadScene({ version: 2, board: { w: 800, h: 618 }, pitch: 'pitch', objects: [] }))
await page.click('[data-tool="arrow"]')
const st = await page.locator('#stage').boundingBox()
const drag = async (x1, y1, x2, y2) => {
  await page.mouse.move(st.x + x1, st.y + y1)
  await page.mouse.down()
  await page.mouse.move(st.x + x2, st.y + y2, { steps: 8 })
  await page.mouse.up()
  await page.waitForTimeout(150)
}
const arrowState = () => page.evaluate(() => {
  const arrows = window.__tbm.store.scene.objects.filter(o => o.type === 'arrow')
  return {
    count: arrows.length,
    tool: window.__tbm.board.tool,
    selected: window.__tbm.store.selectedId,
    editMode: window.__tbm.board.editMode,
    transformBox: !!window.__tbm.board.uiLayer.findOne('.arrow-transform-box'),
    x1: arrows[0]?.x1, curved: arrows[0]?.curved, mx: arrows[0]?.mx, my: arrows[0]?.my,
  }
})
// drawing one arrow hands the toolbar back and leaves the arrow selected
// with the resize/rotate transform box attached
await drag(st.width * 0.2, st.height * 0.3, st.width * 0.4, st.height * 0.3)
let a = await arrowState()
console.log('after draw:', JSON.stringify(a))
if (a.count !== 1) errors.push(`expected 1 arrow after draw, got ${a.count}`)
if (a.tool !== 'player') errors.push(`arrow tool stayed armed after drawing (tool ${a.tool})`)
if (!a.selected || a.editMode !== 'resize') errors.push(`drawn arrow not selected for editing (${a.selected}, ${a.editMode})`)
if (!a.transformBox) errors.push('drawn arrow should carry the transform box')
// drag anywhere moves the whole arrow, it does not draw another one
const x1Before = a.x1
await drag(st.width * 0.7, st.height * 0.7, st.width * 0.75, st.height * 0.7)
a = await arrowState()
console.log('after move drag:', JSON.stringify(a))
if (a.count !== 1) errors.push(`drag drew another arrow instead of moving (${a.count})`)
if (!(a.x1 > x1Before)) errors.push('drag anywhere did not move the selected arrow')
// picking the arrow tool again draws a second arrow
await page.click('[data-tool="arrow"]')
await drag(st.width * 0.2, st.height * 0.6, st.width * 0.4, st.height * 0.6)
a = await arrowState()
console.log('second draw:', JSON.stringify({ count: a.count, tool: a.tool }))
if (a.count !== 2) errors.push(`expected 2 arrows after re-picking the tool, got ${a.count}`)

await page.screenshot({ path: '/tmp/tbm-teams.png' })
await browser.close()
if (errors.length) { console.log('ERRORS:\n' + errors.join('\n')); process.exit(1) }
console.log('OK')
