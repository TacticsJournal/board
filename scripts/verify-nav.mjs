// The ported tacticsjournal.com header: on mobile the search icon opens the
// site's inline search panel against a mocked search API; on desktop it
// navigates to the real search page. The hamburger keeps the curtain behavior
// and closes when a panel opens. Board has no accounts, so the header has no
// account control and never asks tacticsjournal.com who is signed in.
import { chromium } from 'playwright-core'
import { chromePath } from './lib/chrome.mjs'

const browser = await chromium.launch({
  executablePath: chromePath,
  headless: true,
})
const errors = []
const check = (ok, msg) => { if (!ok) errors.push(msg) }

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Accept',
}

/** Route the TJ API, recording every request and the cookies it carried. */
async function mockTjApi(page, calls) {
  await page.route('https://tacticsjournal.com/api/**', async (route) => {
    const req = route.request()
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
    const url = new URL(req.url())
    const headers = await req.allHeaders()
    calls.push({ path: url.pathname, cookie: headers.cookie ?? '', referer: headers.referer ?? '' })
    const reply = (body, status = 200) => route.fulfill({ status, headers: CORS, contentType: 'application/json', body: JSON.stringify(body) })
    if (url.pathname === '/api/search') {
      return reply({ total: 1, results: [{ url: 'https://tacticsjournal.com/x/', title: 'Mock post', date: '2026-01-01' }] })
    }
    return reply({ error: 'unmocked ' + url.pathname }, 500)
  })
}

/* ---------- A. mobile: search opens inline, menu still works ---------- */
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  await ctx.addCookies([{ name: 'tj_session', value: 'should-not-be-sent', domain: 'tacticsjournal.com', path: '/', secure: true }])
  const page = await ctx.newPage()
  page.on('pageerror', e => errors.push(`A pageerror: ${e.message}`))
  const calls = []
  await mockTjApi(page, calls)
  await page.goto('http://localhost:4173/')
  await page.waitForTimeout(700)

  check(await page.$('[data-inline-toggle="account"]') === null, 'the header should have no account toggle')
  check(await page.$('#site-account-panel') === null, 'the header should have no account panel')

  await page.click('[data-inline-toggle="search"]')
  await page.waitForTimeout(450)
  check(await page.evaluate(() => !document.querySelector('#site-search-panel').hidden), 'search panel should open inline')
  await page.fill('#site-search-panel [data-search-input]', 'pressing')
  await page.waitForTimeout(700)
  const result = await page.evaluate(() => document.querySelector('#site-search-panel [data-search-results] a')?.textContent ?? '')
  check(result === 'Mock post', `the mocked search result should render (${result})`)
  const searches = calls.filter(call => call.path === '/api/search')
  check(searches.length > 0, 'typing should query /api/search')
  check(searches.every(call => !call.cookie && !call.referer), `search should send no cookies or referrer (${JSON.stringify(searches)})`)
  check(calls.every(call => call.path === '/api/search'), `the header should call nothing but search (${JSON.stringify(calls.map(c => c.path))})`)

  await page.keyboard.press('Escape')
  await page.waitForTimeout(500)
  check(await page.evaluate(() => document.querySelector('#site-search-panel').hidden), 'Escape should close the search panel')

  // hamburger curtain still works; Escape closes it
  await page.click('.site-menu summary')
  await page.waitForTimeout(200)
  check(await page.evaluate(() => document.querySelector('.site-menu').hasAttribute('open')), 'hamburger should open the menu')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(500)
  check(await page.evaluate(() => !document.querySelector('.site-menu').hasAttribute('open')), 'Escape should close the menu')
  await ctx.close()
  console.log('phase A (mobile search + menu): done')
}

/* ---------- B. desktop: the search icon navigates to the real page ---------- */
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const page = await ctx.newPage()
  const calls = []
  await mockTjApi(page, calls)
  await page.route('https://tacticsjournal.com/search/', r => r.fulfill({ status: 200, contentType: 'text/html', body: '<title>TJ Search</title>' }))
  await page.goto('http://localhost:4173/')
  await page.waitForTimeout(700)
  await page.click('[data-inline-toggle="search"]')
  await page.waitForTimeout(400)
  check(page.url() === 'https://tacticsjournal.com/search/', `desktop search click should navigate (${page.url()})`)
  await ctx.close()
  console.log('phase B (desktop navigates): done')
}

await browser.close()
if (errors.length) { console.log('ERRORS:\n' + errors.join('\n')); process.exit(1) }
console.log('OK')
