// The ported tacticsjournal.com header: on mobile the search and account
// icons open the site's inline overlay panels (account session, email-code
// sign-in, AI search chat) against a mocked live API; on desktop the icons
// navigate to the real pages. The hamburger keeps the curtain behavior and
// closes when a panel opens.
import { chromium } from 'playwright-core'
import { chromePath } from './lib/chrome.mjs'

/** Settings is one list with push screens; step back to root before pushing again. */
const pushScreen = async (page, screen) => {
  const atRoot = await page.evaluate(() => {
    const root = document.querySelector('[data-pane="root"]')
    return !!root && !root.classList.contains('hidden')
  })
  if (!atRoot) { await page.click('.setBack'); await page.waitForTimeout(80) }
  await page.locator(`[data-goto="${screen}"]`).first().click()
  await page.waitForTimeout(120)
}


const browser = await chromium.launch({
  executablePath: chromePath,
  headless: true,
})
const errors = []
const check = (ok, msg) => { if (!ok) errors.push(msg) }

const CORS = {
  'Access-Control-Allow-Origin': 'http://localhost:4173',
  'Access-Control-Allow-Credentials': 'true',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

/** Route the TJ API with a per-test session/baldy behavior. */
async function mockTjApi(page, opts) {
  await page.route('https://tacticsjournal.com/api/**', (route) => {
    const req = route.request()
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
    const url = new URL(req.url())
    const reply = (body, status = 200) => route.fulfill({ status, headers: CORS, contentType: 'application/json', body: JSON.stringify(body) })
    if (url.pathname === '/api/account/session') return reply(opts.session)
    if (url.pathname === '/api/account/preferences') {
      if (req.method() === 'POST') return reply({ ok: true })
      return reply({ preferences: { opinion: true, research: false, weekly_recap: false } })
    }
    if (url.pathname === '/api/account/rss') return reply({ feed_url: 'https://tacticsjournal.com/feed/private?token=x', token_preview: 'abcd' })
    if (url.pathname === '/api/account/start') { opts.calls.push('start'); return reply({ ok: true }) }
    if (url.pathname === '/api/account/verify') {
      opts.calls.push('verify')
      return reply({ ok: true, email: 'fan@example.com', site_access: 'free', launch_access_active: true })
    }
    if (url.pathname === '/api/account/signout') { opts.calls.push('signout'); return reply({ ok: true }) }
    if (url.pathname === '/api/baldy') {
      if (req.method() === 'POST') {
        opts.calls.push('baldy-post')
        return reply({ answer: 'Pressing traps work best near the touchline.', sources: [{ url: 'https://tacticsjournal.com/x/', title: 'Mock post', excerpt: 'About pressing.' }], sessionId: 'mock-session' })
      }
      return reply({ messages: [] })
    }
    if (url.pathname === '/api/baldy-escalation') return reply({ status: 'pending' })
    return reply({ error: 'unmocked ' + url.pathname }, 500)
  })
}

/* ---------- A. mobile, logged out: panels open inline ---------- */
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const page = await ctx.newPage()
  page.on('pageerror', e => errors.push(`A pageerror: ${e.message}`))
  const calls = []
  await mockTjApi(page, { session: { authenticated: false }, calls })
  await page.goto('http://localhost:4173/')
  await page.waitForTimeout(700)

  // account icon opens the inline panel with the sign-in card
  await page.click('[data-inline-toggle="account"]')
  await page.waitForTimeout(450)
  const acct = await page.evaluate(() => ({
    open: !document.querySelector('#site-account-panel').hidden,
    isOpen: document.querySelector('#site-account-panel').classList.contains('is-open'),
    signin: !document.querySelector('.site-account-logged-out').hidden,
    expanded: document.querySelector('[data-inline-toggle="account"]').getAttribute('aria-expanded'),
    url: location.hostname,
  }))
  check(acct.open && acct.isOpen, `account panel should open inline (${JSON.stringify(acct)})`)
  check(acct.signin, 'logged out: the sign-in card should show')
  check(acct.expanded === 'true', 'account toggle aria-expanded should be true')
  check(acct.url === 'localhost', 'must not navigate away on mobile')

  // email -> code sign-in flow against the mocked API
  await page.fill('#site-account-panel .site-account-start-form input', 'fan@example.com')
  await page.click('#site-account-panel .site-account-start-form button[type="submit"]')
  await page.waitForTimeout(300)
  check(calls.includes('start'), 'submitting the email should call /api/account/start')
  await page.fill('#site-account-panel .site-account-start-form input', '123456')
  await page.click('#site-account-panel .site-account-start-form button[type="submit"]')
  await page.waitForTimeout(300)
  check(calls.includes('verify'), 'submitting the code should call /api/account/verify')
  const loggedIn = await page.evaluate(() => ({
    shown: !document.querySelector('.site-account-logged-in').hidden,
    email: document.querySelector('.site-account-email').textContent,
  }))
  check(loggedIn.shown && loggedIn.email === 'fan@example.com', `code sign-in should reach the account view (${JSON.stringify(loggedIn)})`)

  // sign out returns to the sign-in card
  await page.click('.site-account-signout')
  await page.waitForTimeout(300)
  check(calls.includes('signout'), 'sign out should call /api/account/signout')
  check(await page.evaluate(() => !document.querySelector('.site-account-logged-out').hidden), 'sign out should show the sign-in card')

  // with a panel open the icons fade out and the hamburger becomes an X
  // that closes the panel (same as the site)
  const toggleState = await page.evaluate(() => ({
    inlineOpen: document.querySelector('.site-header').getAttribute('data-inline-open'),
    iconHidden: getComputedStyle(document.querySelector('[data-inline-toggle="search"]')).opacity === '0',
  }))
  check(toggleState.inlineOpen === 'account' && toggleState.iconHidden, `open panel should fade the toggles (${JSON.stringify(toggleState)})`)
  await page.click('.site-menu summary')
  await page.waitForTimeout(500)
  check(await page.evaluate(() => document.querySelector('#site-account-panel').hidden), 'the hamburger X should close the account panel')

  // search icon: logged out -> panel opens with the sign-in gate
  await page.click('[data-inline-toggle="search"]')
  await page.waitForTimeout(450)
  const search = await page.evaluate(() => ({
    open: !document.querySelector('#site-search-panel').hidden,
    gate: !!document.querySelector('#site-search-panel .search-signin-gate'),
    formHidden: document.querySelector('[data-search-form]').hidden,
  }))
  check(search.open, 'search panel should open inline')
  check(search.gate && search.formHidden, `logged out search should show the sign-in gate (${JSON.stringify(search)})`)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(500)
  check(await page.evaluate(() => document.querySelector('#site-search-panel').hidden), 'Escape should close the search panel')

  // hamburger curtain still works; the overlay tap closes it
  await page.click('.site-menu summary')
  await page.waitForTimeout(200)
  check(await page.evaluate(() => document.querySelector('.site-menu').hasAttribute('open')), 'hamburger should open the menu')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(500)
  check(await page.evaluate(() => !document.querySelector('.site-menu').hasAttribute('open')), 'Escape should close the menu')
  await ctx.close()
  console.log('phase A (mobile logged-out + sign-in + menu): done')
}

/* ---------- B. mobile, signed in: account view + search chat ---------- */
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const page = await ctx.newPage()
  page.on('pageerror', e => errors.push(`B pageerror: ${e.message}`))
  const calls = []
  await mockTjApi(page, { session: { authenticated: true, email: 'kyle@example.com', site_access: 'pro', plan_name: 'pro_annual' }, calls })
  await page.goto('http://localhost:4173/')
  await page.waitForTimeout(700)

  await page.click('[data-inline-toggle="account"]')
  await page.waitForTimeout(450)
  const acct = await page.evaluate(() => ({
    email: document.querySelector('.site-account-email').textContent,
    badge: document.querySelector('.site-account-plan-badge').textContent,
    rss: !document.querySelector('.site-account-rss').hidden,
    prefOpinion: document.querySelector('[data-pref="opinion"]').checked,
  }))
  check(acct.email === 'kyle@example.com', `signed-in email should render (${acct.email})`)
  check(acct.badge === 'Research', `pro plan badge should render (${acct.badge})`)
  check(acct.rss, 'pro account should show the RSS section')
  check(acct.prefOpinion, 'email preferences should load from the API')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(500)

  // search chat: ask a question, mocked answer + source render
  await page.click('[data-inline-toggle="search"]')
  await page.waitForTimeout(450)
  check(await page.evaluate(() => !document.querySelector('[data-search-form]').hidden), 'signed in: the ask form should be enabled')
  await page.fill('[data-search-question]', 'Where do pressing traps work?')
  await page.click('[data-search-submit]')
  await page.waitForTimeout(500)
  const chat = await page.evaluate(() => ({
    user: document.querySelector('.search-message-user .search-message-body')?.textContent ?? '',
    answer: document.querySelector('.search-message-assistant .search-message-body')?.textContent ?? '',
    source: document.querySelector('.search-source-item .hub-feed-title a')?.textContent ?? '',
  }))
  check(calls.includes('baldy-post'), 'asking should POST to /api/baldy')
  check(/pressing traps/i.test(chat.user), `the question should render (${chat.user})`)
  check(/touchline/.test(chat.answer), `the mocked answer should render (${chat.answer})`)
  check(chat.source === 'Mock post', `the source card should render (${chat.source})`)
  await ctx.close()
  console.log('phase B (signed-in account + search chat): done')
}

/* ---------- C. desktop: the icons navigate to the real pages ---------- */
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const page = await ctx.newPage()
  const calls = []
  await mockTjApi(page, { session: { authenticated: false }, calls })
  await page.route('https://tacticsjournal.com/search/', r => r.fulfill({ status: 200, contentType: 'text/html', body: '<title>TJ Search</title>' }))
  await page.goto('http://localhost:4173/')
  await page.waitForTimeout(700)
  await page.click('[data-inline-toggle="search"]')
  await page.waitForTimeout(400)
  check(page.url() === 'https://tacticsjournal.com/search/', `desktop search click should navigate (${page.url()})`)
  await ctx.close()
  console.log('phase C (desktop navigates): done')
}

await browser.close()
if (errors.length) { console.log('ERRORS:\n' + errors.join('\n')); process.exit(1) }
console.log('OK')
