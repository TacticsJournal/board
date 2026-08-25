import { chromium } from 'playwright-core'
import { chromePath } from './lib/chrome.mjs'

const url = process.env.BOARD_URL || 'http://localhost:4173/'
const browser = await chromium.launch({ executablePath: chromePath, headless: true })
const page = await browser.newPage({ viewport: { width: 1100, height: 760 } })

try {
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => window.__tbm?.saves)
  const result = await page.evaluate(async () => {
    localStorage.clear()
    window.__tbmImportExecuted = 0
    const scene = structuredClone(window.__tbm.store.scene)
    scene.objects = [{
      id: 'malicious-color', type: 'player', x: 100, y: 100, r: 18,
      color: '\"><image href="x" onerror="window.__tbmImportExecuted=1">',
      label: '', name: '</text><image href="x" onerror="window.__tbmImportExecuted=1">',
      namePos: 'bottom', nameSize: 18, nameDisplay: 'last',
    }]
    const added = window.__tbm.saves.importFile(JSON.stringify({ boards: {
      '\"><img src=x onerror="window.__tbmImportExecuted=1">': {
        savedAt: new Date().toISOString(), scene,
      },
    } }))
    window.__tbm.saves.open()
    await new Promise(resolve => setTimeout(resolve, 100))
    const stored = Object.values(JSON.parse(localStorage.getItem('tbm-projects-v1') || '{}'))[0]
    return {
      added,
      executed: window.__tbmImportExecuted,
      color: stored?.scene?.objects?.[0]?.color,
      renderedHandlers: document.querySelector('[data-sv="list"]')?.querySelectorAll('[onerror]').length || 0,
    }
  })
  if (result.added !== 1 || result.executed !== 0 || result.renderedHandlers !== 0 || !/^#[0-9a-f]{6}$/i.test(result.color || '')) {
    throw new Error(`malicious transfer was not contained: ${JSON.stringify(result)}`)
  }
  console.log('Malicious transfer import remained inert.')
} finally {
  await browser.close()
}
