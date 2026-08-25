import { chromium } from 'playwright-core'
import { chromePath } from './lib/chrome.mjs'

const url = process.env.BOARD_URL || 'http://localhost:4173/'
const browser = await chromium.launch({ executablePath: chromePath, headless: true })
const page = await browser.newPage({ viewport: { width: 1100, height: 760 } })
const failures = []
const check = (condition, message) => { if (!condition) failures.push(message) }

await page.goto(url, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => window.__tbm?.saves)
await page.evaluate(() => localStorage.clear())
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => window.__tbm?.saves)

const seed = async (names) => page.evaluate((names) => {
  const scene = structuredClone(window.__tbm.store.scene)
  const projects = Object.fromEntries(names.map((name, index) => [name, {
    savedAt: new Date(Date.UTC(2026, 0, index + 1)).toISOString(),
    scene: {
      ...structuredClone(scene),
      match: { ...scene.match, date: name },
      objects: [{ id: `ball-${index}`, type: 'ball', x: 100 + index, y: 100, size: 20 }],
    },
  }]))
  return window.__tbm.saves.resetProjects(projects)
}, names)

check(await page.evaluate(() => window.__tbm.entitlements.isPro()) === false, 'production localhost build must fail closed to Free')

await seed(['Oldest', 'Older', 'Recent', 'Newest'])
await page.evaluate(() => window.__tbm.saves.open())
let state = await page.evaluate(() => ({
  count: Object.keys(JSON.parse(localStorage.getItem('tbm-projects-v1'))).length,
  locked: [...document.querySelectorAll('.saveItemLocked .saveMeta strong')].map(el => el.textContent.trim()),
}))
check(state.count === 4, `downgrade must preserve all four boards, got ${state.count}`)
check(state.locked.length === 1 && state.locked[0].includes('Oldest'), `oldest board should be read-only: ${JSON.stringify(state.locked)}`)

await page.click('[data-sv="load"][data-name="Oldest"]')
const lockedBefore = await page.evaluate(() => JSON.parse(localStorage.getItem('tbm-projects-v1')).Oldest)
check(await page.evaluate(() => window.__tbm.saves.autosaveCurrent()) === true,
  'an unchanged read-only board should not be reported as unsaved')

await page.evaluate(() => window.__tbm.saves.open())
await page.click('[data-sv="new-teams"]')
check(await page.inputValue('[data-sv="name"]') === 'Oldest',
  'opening team configuration must preserve the current board name')
await page.click('[data-set="close"]')

await page.evaluate(() => window.__tbm.store.apply(scene => {
  scene.objects.push({ id: 'unsaved-locked', type: 'ball', x: 250, y: 100, size: 20 })
}))
await page.waitForTimeout(650)
const lockedAfter = await page.evaluate(() => JSON.parse(localStorage.getItem('tbm-projects-v1')).Oldest)
check(JSON.stringify(lockedAfter) === JSON.stringify(lockedBefore), 'loading a read-only board must not let live autosave mutate it')

page.once('dialog', dialog => dialog.dismiss())
await page.click('[data-top="new"]')
state = await page.evaluate(() => ({
  objects: window.__tbm.store.scene.objects.length,
  name: document.querySelector('[data-sv="name"]').value,
}))
check(state.objects === 2 && state.name === 'Oldest',
  'cancelling discard must preserve changed canvas and saved-board identity')

page.once('dialog', dialog => dialog.accept())
await page.click('[data-top="new"]')
state = await page.evaluate(() => ({
  objects: window.__tbm.store.scene.objects.length,
  name: document.querySelector('[data-sv="name"]').value,
}))
check(state.objects === 0 && state.name === '', 'confirmed discard should start an unsaved canvas at the Free limit')

await page.evaluate(() => window.__tbm.saves.open())
page.once('dialog', dialog => dialog.accept())
await page.click('[data-sv="delete"][data-name="Newest"]')
state = await page.evaluate(() => ({
  names: Object.keys(JSON.parse(localStorage.getItem('tbm-projects-v1'))),
  locked: document.querySelectorAll('.saveItemLocked').length,
}))
check(!state.names.includes('Newest') && state.names.length === 3, 'confirmed delete should remove only its named record')
check(state.locked === 0, 'deleting an editable board should promote the next preserved board')

await seed(['One', 'Two', 'Three'])
const fourthSaved = await page.evaluate(() => window.__tbm.saves.registerNew())
state = await page.evaluate(() => ({
  count: Object.keys(JSON.parse(localStorage.getItem('tbm-projects-v1'))).length,
  status: document.querySelector('[data-sv="status"]').textContent,
}))
check(fourthSaved === false && state.count === 3, 'Free must block a fourth new saved board without eviction')
check(state.status.includes('three editable saved boards'), 'blocked fourth save should explain the limit')

await seed(['One', 'Two', 'Three', 'Four'])
const imported = await page.evaluate(() => {
  const scene = structuredClone(window.__tbm.store.scene)
  return window.__tbm.saves.importFile(JSON.stringify({ boards: {
    Five: { savedAt: '2026-05-01T00:00:00Z', scene },
    Six: { savedAt: '2026-06-01T00:00:00Z', scene: { ...scene, pitch: 'training' } },
  } }))
})
state = await page.evaluate(() => ({
  count: Object.keys(JSON.parse(localStorage.getItem('tbm-projects-v1'))).length,
  locked: document.querySelectorAll('.saveItemLocked').length,
}))
check(imported === 2 && state.count === 6 && state.locked === 3, 'imports must preserve overflow without silently evicting records')

await seed(['One', 'Two'])
await page.evaluate(() => window.__tbm.saves.open())
await page.click('[data-sv="load"][data-name="Two"]')
await page.evaluate(() => {
  window.__originalStorageSetItem = Storage.prototype.setItem
  Storage.prototype.setItem = function () { throw new DOMException('quota', 'QuotaExceededError') }
  window.__tbm.store.apply(scene => {
    scene.objects.push({ id: 'unsaved-quota', type: 'ball', x: 300, y: 100, size: 20 })
  })
})
await page.waitForTimeout(650)
page.once('dialog', dialog => dialog.dismiss())
await page.click('[data-top="new"]')
state = await page.evaluate(() => ({
  objects: window.__tbm.store.scene.objects.length,
  name: document.querySelector('[data-sv="name"]').value,
}))
await page.evaluate(() => { Storage.prototype.setItem = window.__originalStorageSetItem })
check(state.objects === 2 && state.name === 'Two',
  'a storage failure must not replace the canvas unless discard is explicitly confirmed')

const prior = await page.evaluate(() => localStorage.getItem('tbm-projects-v1'))
const failedWrite = await page.evaluate(() => {
  const original = Storage.prototype.setItem
  Storage.prototype.setItem = function () { throw new DOMException('quota', 'QuotaExceededError') }
  try { return window.__tbm.saves.registerNew() } finally { Storage.prototype.setItem = original }
})
const afterFailure = await page.evaluate(() => localStorage.getItem('tbm-projects-v1'))
check(failedWrite === false && afterFailure === prior, 'quota failure must preserve the prior stored set')

const malformed = '{"Broken":'
await page.evaluate(value => localStorage.setItem('tbm-projects-v1', value), malformed)
const malformedWrite = await page.evaluate(() => window.__tbm.saves.registerNew())
const malformedAfter = await page.evaluate(() => localStorage.getItem('tbm-projects-v1'))
check(malformedWrite === false && malformedAfter === malformed, 'malformed storage must not be overwritten by a later save')

await browser.close()
if (failures.length) {
  console.error(failures.map(message => `FAIL: ${message}`).join('\n'))
  process.exit(1)
}
console.log('Saved-board policy integration checks passed.')
