/**
 * Port of the tacticsjournal.com header behavior (_includes/header.html
 * inline script): the search/account icons open the same inline overlay
 * panels, the hamburger opens the slide-down menu, Escape and outside taps
 * close everything, and the body scroll locks while a panel is open.
 *
 * One deliberate departure from the site: the account icon opens the panel
 * at every width. On the site a desktop click goes to the real /account/
 * page; here that would leave the board - and the unsaved work on it -
 * for another origin, which is the one thing a sign-in must never do.
 *
 * The board runs on board.tacticsjournal.com (same site as the API), so
 * every call goes to the live API with credentials - the tj_session
 * cookie rides along and sign-in works exactly like on the site.
 * Re-sync against the site header when it changes.
 */

import { TJ_ORIGIN } from './origin'
import { clearBoardSession } from './board-api'
import { googleSignInUrl } from './signin-return'

const TJ = TJ_ORIGIN

function api(path: string, init?: RequestInit): Promise<Response> {
  return fetch(TJ + path, { credentials: 'include', ...init })
}

export function initTjHeader(): { closeMenu: () => void; closeInline: () => void; openAccount: () => void; signOut: () => Promise<void> } {
  const header = document.querySelector<HTMLElement>('.site-header')
  if (!header) return { closeMenu: () => {}, closeInline: () => {}, openAccount: () => {}, signOut: async () => {} }
  const actions = header.querySelector<HTMLElement>('.site-actions')!
  const toggles = header.querySelectorAll<HTMLElement>('[data-inline-toggle]')
  const searchPanel = header.querySelector<HTMLElement>('#site-search-panel')
  const accountPanel = header.querySelector<HTMLElement>('#site-account-panel')
  const q = <T extends HTMLElement>(sel: string) => accountPanel ? accountPanel.querySelector<T>(sel) : null
  const accountLoading = q('.site-account-loading')
  const accountLoggedOut = q('.site-account-logged-out')
  const accountLoggedIn = q('.site-account-logged-in')
  const accountStartForm = q<HTMLFormElement>('.site-account-start-form')
  const accountVerifyForm = q<HTMLFormElement>('.site-account-verify-form')
  const accountError = q('.site-account-error')
  const accountNotice = q('.site-account-notice')
  const notifFeed = q('.site-account-notif-feed')
  const notifEmpty = q('.site-account-notif-empty')
  const notifSettingsToggleBtn = q('.site-notif-settings-toggle')
  const notifSettingsPanel = q('.site-notif-settings')
  const notifPrefInputs = accountPanel ? accountPanel.querySelectorAll<HTMLInputElement>('[data-notif-pref]') : ([] as unknown as NodeListOf<HTMLInputElement>)
  let notifPrefSaveTimeout: number | undefined
  let accountSessionData: any = null
  let accountSessionLoaded = false
  let accountSessionPromise: Promise<any> | null = null
  let pendingEmail = ''
  const googleStartLink = q<HTMLAnchorElement>('.signin-google-button')
  const dashboardStartLink = q<HTMLAnchorElement>('.site-account-dashboard-signin')

  const DASHBOARD_START = 'https://dash.tacticsjournal.com/?signin=board'

  function currentGoogleStart() {
    return googleSignInUrl(TJ, window.location.href)
  }

  function updateGoogleStartLink() {
    if (googleStartLink) googleStartLink.href = currentGoogleStart()
  }

  // Keep the board open while Google handles sign-in. If the popup is blocked,
  // the anchor uses the same return URL in this tab and comes back to this page.
  function startGoogleSignIn(event: Event) {
    const width = 480
    const height = 640
    const left = Math.max(0, Math.round(window.screenX + (window.outerWidth - width) / 2))
    const top = Math.max(0, Math.round(window.screenY + (window.outerHeight - height) / 2))
    const popup = window.open(currentGoogleStart(), 'tj-google-signin', `width=${width},height=${height},left=${left},top=${top}`)
    if (!popup) return // blocked: let the anchor navigate, which still signs in
    event.preventDefault()
    clearAccountError()
    watchGoogleSignIn(popup)
  }

  function startDashboardSignIn(event: Event) {
    const width = 720
    const height = 720
    const left = Math.max(0, Math.round(window.screenX + (window.outerWidth - width) / 2))
    const top = Math.max(0, Math.round(window.screenY + (window.outerHeight - height) / 2))
    const popup = window.open(DASHBOARD_START, 'tj-dashboard-signin', `width=${width},height=${height},left=${left},top=${top}`)
    if (!popup) return
    event.preventDefault()
    clearAccountError()
    const previousSessionBinding = typeof accountSessionData?.session_binding === 'string'
      ? accountSessionData.session_binding
      : null
    watchGoogleSignIn(popup, previousSessionBinding, true)
  }

  function watchGoogleSignIn(popup: Window, previousSessionBinding: string | null = null, requireNewSession = false) {
    const deadline = Date.now() + 5 * 60 * 1000
    let closedAt = 0
    const timer = window.setInterval(() => {
      // One last check after the window goes away: the cookie may have been
      // set by the redirect that immediately preceded the close.
      if (popup.closed && !closedAt) closedAt = Date.now()
      if (Date.now() > deadline || (closedAt && Date.now() > closedAt + 2500)) {
        window.clearInterval(timer)
        return
      }
      refreshAccountSession().then((data) => {
        if (!data || !data.authenticated) return
        const sessionBinding = typeof data.session_binding === 'string' ? data.session_binding : null
        if (requireNewSession && (!sessionBinding || sessionBinding === previousSessionBinding)) return
        window.clearInterval(timer)
        try { popup.close() } catch { /* already gone */ }
      })
    }, 1500)
  }
  const menu = document.querySelector<HTMLElement>('.site-menu')!
  const summary = menu ? menu.querySelector<HTMLElement>('summary') : null
  const overlay = menu ? menu.querySelector<HTMLElement>('.site-menu-overlay') : null
  const duration = 400
  const mobileQuery = window.matchMedia('(max-width: 767px)')
  let lockedScrollY = 0

  function lockBodyScroll() {
    if (document.body.classList.contains('site-scroll-locked')) return
    lockedScrollY = window.scrollY || document.documentElement.scrollTop || 0
    document.body.classList.add('site-scroll-locked')
    document.body.style.position = 'fixed'
    document.body.style.top = '-' + lockedScrollY + 'px'
    document.body.style.left = '0'
    document.body.style.right = '0'
    document.body.style.width = '100%'
    document.body.style.overflow = 'hidden'
  }

  function unlockBodyScroll() {
    if (!document.body.classList.contains('site-scroll-locked')) {
      document.body.style.overflow = ''
      return
    }
    document.body.classList.remove('site-scroll-locked')
    document.body.style.position = ''
    document.body.style.top = ''
    document.body.style.left = ''
    document.body.style.right = ''
    document.body.style.width = ''
    document.body.style.overflow = ''
    window.scrollTo(0, lockedScrollY || 0)
  }

  function releaseBodyScrollIfClear() {
    const inlineOpen = header!.getAttribute('data-inline-open')
    const menuOpen = menu && menu.hasAttribute('open')
    if (!inlineOpen && !menuOpen) unlockBodyScroll()
  }

  function setExpanded(openName: string | null) {
    toggles.forEach((toggle) => {
      toggle.setAttribute('aria-expanded', toggle.getAttribute('data-inline-toggle') === openName ? 'true' : 'false')
    })
  }

  function animatePanelContent(panel: HTMLElement | null) {
    if (!panel) return
    panel.classList.remove('active')
    panel.querySelectorAll<HTMLElement>('.site-panel-animate').forEach((el) => { el.style.transitionDelay = '' })
    void panel.offsetHeight
    window.requestAnimationFrame(() => { panel.classList.add('active') })
  }

  function closeInline() {
    if (!actions) return
    actions.removeAttribute('data-inline-open')
    header!.removeAttribute('data-inline-open')
    setExpanded(null)
    ;[searchPanel, accountPanel].forEach((panel) => {
      if (!panel || panel.hidden) return
      panel.classList.remove('active', 'is-open')
      panel.classList.add('closing')
      setTimeout(() => { panel.hidden = true; panel.classList.remove('closing') }, duration)
    })
    document.body.classList.remove('site-account-open', 'site-panel-open')
    releaseBodyScrollIfClear()
  }

  function showAccountError(message: string) {
    if (!accountError) return
    accountError.textContent = message
    accountError.hidden = false
  }

  function clearAccountError() {
    showAccountNotice('')
    if (!accountError) return
    accountError.textContent = ''
    accountError.hidden = true
  }

  // The email field simply became a code field, with nothing saying a code had
  // been sent, or to which address - the one moment in the flow where the next
  // step is happening in another application entirely.
  function showAccountNotice(message: string) {
    if (!accountNotice) return
    accountNotice.textContent = message
    accountNotice.hidden = !message
  }

  function showAccountLoggedOut(animate?: boolean) {
    if (accountLoading) accountLoading.hidden = true
    if (accountLoggedIn) accountLoggedIn.hidden = true
    if (accountLoggedOut) accountLoggedOut.hidden = false
    if (accountStartForm) accountStartForm.hidden = false
    if (accountVerifyForm) accountVerifyForm.hidden = true
    if (animate !== false && accountPanel && !accountPanel.hidden) animatePanelContent(accountPanel)
  }

  // The account panel is the site's notification hub, matched one for one. The
  // account details it used to duplicate - plan, RSS, email subscriptions -
  // live on the site's account page, which the person icon links to.
  if (notifSettingsToggleBtn && notifSettingsPanel) {
    notifSettingsToggleBtn.addEventListener('click', () => {
      const open = notifSettingsPanel.hidden !== false
      notifSettingsPanel.hidden = !open
      notifSettingsToggleBtn.setAttribute('aria-expanded', open ? 'true' : 'false')
      notifSettingsToggleBtn.classList.toggle('active', open)
    })
  }

  function saveNotifPreferences() {
    clearTimeout(notifPrefSaveTimeout)
    notifPrefSaveTimeout = window.setTimeout(() => {
      const prefs: Record<string, boolean> = {}
      notifPrefInputs.forEach((input) => { prefs[input.getAttribute('data-notif-pref')!] = input.checked })
      api('/api/account/notification-preferences', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(prefs),
      }).catch(() => {})
    }, 500)
  }

  function loadNotifPreferences() {
    api('/api/account/notification-preferences')
      .then((res) => res.json())
      .then((data) => {
        if (!data || !data.preferences) return
        notifPrefInputs.forEach((input) => {
          const key = input.getAttribute('data-notif-pref')!
          if (key in data.preferences) input.checked = data.preferences[key] !== false
        })
      })
      .catch(() => {})
  }

  notifPrefInputs.forEach((input) => { input.addEventListener('change', saveNotifPreferences) })

  function showNotifEmpty(message: string) {
    if (!notifFeed) return
    notifFeed.innerHTML = ''
    if (!notifEmpty) return
    const text = notifEmpty.querySelector('.notif-empty-text')
    if (text) text.textContent = message
    notifFeed.appendChild(notifEmpty)
  }

  function loadAccountNotifications() {
    if (!notifFeed) return
    api('/api/account/notifications')
      .then((response) => {
        if (!response.ok) throw new Error('Notifications unavailable')
        return response.json()
      })
      .then((data) => {
        const rows = data.rows || []
        if (!rows.length) {
          showNotifEmpty('No notifications yet')
          return
        }
        notifFeed.innerHTML = ''
        rows.slice(0, 20).forEach((row: any) => {
          const item = document.createElement(row.linkUrl ? 'a' : 'div') as HTMLAnchorElement
          item.className = 'notif-item'
          // The board is a different origin from the site the links point at.
          if (row.linkUrl) item.href = /^https?:/.test(row.linkUrl) ? row.linkUrl : TJ + row.linkUrl
          const icon = document.createElement('span')
          icon.className = 'notif-item-icon notif-item-icon--reply'
          icon.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M4 6h16v12H4z"/><path d="m4 7l8 6l8-6"/></svg>'
          const content = document.createElement('span')
          content.className = 'notif-item-body'
          const title = document.createElement('span')
          title.className = 'notif-item-text'
          const strong = document.createElement('strong')
          strong.textContent = row.title || 'Tactics Journal'
          title.appendChild(strong)
          const time = document.createElement('span')
          time.className = 'notif-item-time'
          time.textContent = row.createdAt ? ' · ' + new Date(row.createdAt).toLocaleDateString() : ''
          title.appendChild(time)
          content.appendChild(title)
          if (row.body) {
            const preview = document.createElement('span')
            preview.className = 'notif-item-preview'
            preview.textContent = row.body
            content.appendChild(preview)
          }
          item.appendChild(icon)
          item.appendChild(content)
          notifFeed.appendChild(item)
        })
      })
      .catch(() => { showNotifEmpty('Notifications are unavailable') })
  }

  function showAccountLoggedIn(_data: any, animate?: boolean) {
    if (accountLoading) accountLoading.hidden = true
    if (accountLoggedOut) accountLoggedOut.hidden = true
    if (accountLoggedIn) accountLoggedIn.hidden = false
    loadNotifPreferences()
    loadAccountNotifications()
    if (animate !== false && accountPanel && !accountPanel.hidden) animatePanelContent(accountPanel)
  }
  function renderAccountSession(data: any, animate?: boolean) {
    if (data && data.authenticated) showAccountLoggedIn(data, animate)
    else showAccountLoggedOut(animate)
  }

  function setAuthenticatedEverywhere(data: any) {
    accountSessionData = data || { authenticated: true }
    accountSessionLoaded = true
    if (accountPanel && !accountPanel.hidden) renderAccountSession(accountSessionData, true)
    if (!data || data.source !== 'auth-event') {
      announcedSignature = sessionSignature(accountSessionData)
      window.dispatchEvent(new CustomEvent('tacticsjournal:auth-changed', { detail: accountSessionData }))
    }
  }

  // The session is now re-read on a timer during a popup sign-in and every
  // time the tab is looked at again, so the same answer arrives many times
  // over. Only a changed answer is worth an event: the listeners restart sync
  // and re-evaluate entitlements, which is not free.
  let announcedSignature: string | null = null

  function sessionSignature(data: any): string {
    if (!data || data.authenticated !== true) return 'anonymous'
    return [data.email || '', data.site_access || '', data.board_license === true ? '1' : '0', data.account_binding || '', data.plan_name || ''].join('|')
  }

  function announceSession() {
    const signature = sessionSignature(accountSessionData)
    if (signature === announcedSignature) return
    announcedSignature = signature
    try {
      window.dispatchEvent(new CustomEvent('tacticsjournal:auth-changed', { detail: accountSessionData }))
    } catch { /* no window in a non-browser context */ }
  }

  // A session earned somewhere else - the Google popup, or a sign-in on
  // tacticsjournal.com in another tab - is invisible here until the board asks
  // again, and the board only asked once, at load.
  function refreshAccountSession() {
    const before = sessionSignature(accountSessionData)
    return fetchAccountSession().then((data) => {
      // Only a changed answer redraws. Re-rendering the same signed-out panel
      // every poll would replay its fade-in animation on the visitor's screen
      // while they are still typing in it.
      if (sessionSignature(data) === before) return data
      if (accountPanel && !accountPanel.hidden) renderAccountSession(data, true)
      return data
    })
  }

  function fetchAccountSession() {
    if (accountSessionPromise) return accountSessionPromise
    accountSessionPromise = api('/api/account/session')
      .then((res) => res.json())
      .then((data) => {
        accountSessionData = data || { authenticated: false }
        accountSessionLoaded = true
        // Everything outside this header learns about entitlements from this
        // event. Without it the panel knew the visitor held Pro while the rest
        // of the app still believed they were on Free, because only an explicit
        // sign-in dispatched, and returning to an existing session is not one.
        announceSession()
        return accountSessionData
      })
      .catch(() => {
        accountSessionData = { authenticated: false }
        accountSessionLoaded = true
        announceSession()
        return accountSessionData
      })
      .finally(() => { accountSessionPromise = null })
    return accountSessionPromise
  }

  async function loadCanonicalAccountSessionAfterSignIn() {
    // The verify response proves the code and sets the cookie, but it is not the
    // account snapshot. In particular it has no account_binding, site_access,
    // or Board licence. Wait out any request started before the cookie landed,
    // then read the canonical snapshot that board sync and its scoped cursor use.
    if (accountSessionPromise) await accountSessionPromise
    accountSessionLoaded = false
    accountSessionData = null
    const data = await fetchAccountSession()
    renderAccountSession(data, true)
    return data
  }

  function loadAccountSession() {
    if (!accountPanel) return
    clearAccountError()
    if (accountLoading) accountLoading.hidden = true
    if (accountSessionLoaded) {
      renderAccountSession(accountSessionData, true)
      return
    }
    if (accountLoggedOut) accountLoggedOut.hidden = true
    if (accountLoggedIn) accountLoggedIn.hidden = true
    fetchAccountSession().then((data) => { renderAccountSession(data, true) })
  }

  function openInline(name: string) {
    if (!actions) return
    actions.setAttribute('data-inline-open', name)
    header!.setAttribute('data-inline-open', name)
    setExpanded(name)

    let panel: HTMLElement | null = null
    if (name === 'search') panel = searchPanel
    if (name === 'account') panel = accountPanel

    if (panel) {
      panel.hidden = false
      panel.classList.remove('closing')
      window.requestAnimationFrame(() => { panel!.classList.add('is-open') })
      if (name === 'search') animatePanelContent(panel)
    }

    if (name === 'search') {
      document.body.classList.add('site-panel-open')
      lockBodyScroll()
      const question = searchPanel ? searchPanel.querySelector<HTMLElement>('[data-search-question]') : null
      if (question) window.requestAnimationFrame(() => { question.focus() })
      return
    }
    if (name === 'account') {
      document.body.classList.add('site-account-open', 'site-panel-open')
      lockBodyScroll()
      loadAccountSession()
      updateGoogleStartLink()
    }
  }

  function openAccount() {
    if (actions.getAttribute('data-inline-open') === 'account') return
    closeMenu()
    // Callers are board buttons, which sit outside the header, so the click
    // that asked for the panel is still travelling up to the document handler
    // that closes panels on an outside click. Open once it has passed.
    window.setTimeout(() => { openInline('account') }, 0)
  }

  function openSearchFromSigninReturn() {
    const params = new URLSearchParams(window.location.search || '')
    if (params.get('searchOpen') !== '1' || !mobileQuery.matches) return
    params.delete('searchOpen')
    const nextQuery = params.toString()
    const nextUrl = window.location.pathname + (nextQuery ? '?' + nextQuery : '') + window.location.hash
    window.history.replaceState({}, '', nextUrl)
    closeMenu()
    openInline('search')
  }

  function closeMenu() {
    if (!menu.hasAttribute('open') || menu.classList.contains('closing')) return
    menu.classList.add('closing')
    setTimeout(() => {
      menu.removeAttribute('open')
      menu.classList.remove('closing')
      releaseBodyScrollIfClear()
    }, duration)
  }

  toggles.forEach((toggle) => {
    toggle.addEventListener('click', (e) => {
      const name = toggle.getAttribute('data-inline-toggle')!
      // Account is inline everywhere; search still hands desktop over to the
      // site's own search page, which is a page the board does not carry.
      if (!mobileQuery.matches && name !== 'account') return

      e.preventDefault()
      if (actions.getAttribute('data-inline-open') === name) {
        closeInline()
        return
      }
      closeMenu()
      openInline(name)
    })
  })

  if (accountPanel) {
    const changeEmailBtn = accountPanel.querySelector<HTMLElement>('.site-account-change-email')

    const setAccountStartFormMode = (mode: string) => {
      if (!accountStartForm) return
      const input = accountStartForm.querySelector('input')
      const btn = accountStartForm.querySelector<HTMLButtonElement>('button[type="submit"]')
      accountStartForm.dataset.mode = mode
      if (mode === 'code') {
        if (input) {
          input.type = 'text'
          input.name = 'code'
          input.placeholder = '6-digit code'
          input.setAttribute('aria-label', '6-digit sign-in code')
          input.setAttribute('autocomplete', 'one-time-code')
          input.setAttribute('inputmode', 'numeric')
          input.setAttribute('pattern', '[0-9]*')
          input.setAttribute('maxlength', '6')
          input.value = ''
        }
        if (btn) btn.textContent = 'Sign in'
        if (changeEmailBtn) changeEmailBtn.hidden = false
      } else {
        if (input) {
          input.type = 'email'
          input.name = 'email'
          input.placeholder = 'Enter your email...'
          input.setAttribute('aria-label', 'Email address')
          input.setAttribute('autocomplete', 'email')
          input.removeAttribute('inputmode')
          input.removeAttribute('pattern')
          input.removeAttribute('maxlength')
          input.value = pendingEmail || ''
        }
        if (btn) btn.textContent = 'Send code'
        if (changeEmailBtn) changeEmailBtn.hidden = true
      }
    }

    if (changeEmailBtn) changeEmailBtn.addEventListener('click', () => {
      pendingEmail = ''
      clearAccountError()
      if (accountVerifyForm) accountVerifyForm.hidden = true
      if (accountStartForm) accountStartForm.hidden = false
      setAccountStartFormMode('email')
      const emailInput = accountStartForm ? accountStartForm.querySelector<HTMLInputElement>('input[name="email"]') : null
      if (emailInput) emailInput.focus()
    })

    if (accountStartForm) {
      accountStartForm.addEventListener('submit', (e) => {
        e.preventDefault()
        clearAccountError()
        const input = accountStartForm.querySelector('input')
        const btn = accountStartForm.querySelector<HTMLButtonElement>('button[type="submit"]')
        const mode = accountStartForm.dataset.mode === 'code' ? 'code' : 'email'
        if (mode === 'code') {
          const code = input ? input.value.trim() : ''
          if (!pendingEmail || !code) return
          if (btn) { btn.disabled = true; btn.textContent = 'Signing in...' }
          api('/api/account/verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: pendingEmail, code, next: '/' }),
          })
            .then((res) => res.json().then((data) => ({ ok: res.ok, data })))
            .then((result) => {
              if (!result.ok) throw new Error(result.data && result.data.error ? result.data.error : 'That code is invalid or expired.')
              return loadCanonicalAccountSessionAfterSignIn()
            })
            .catch((err) => { showAccountError(err.message || 'That code is invalid or expired.') })
            .finally(() => { if (btn) { btn.disabled = false; btn.textContent = 'Sign in' } })
          return
        }
        pendingEmail = input ? input.value.trim() : ''
        if (!pendingEmail) return
        if (btn) { btn.disabled = true; btn.textContent = 'Sending...' }
        api('/api/account/start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: pendingEmail, next: '/' }),
        })
          .then((res) => res.json().then((data) => ({ ok: res.ok, data })))
          .then((result) => {
            if (!result.ok) throw new Error(result.data && result.data.error ? result.data.error : 'Could not send code.')
            setAccountStartFormMode('code')
            showAccountNotice('Code sent to ' + pendingEmail + '. It expires in 15 minutes.')
            animatePanelContent(accountPanel)
            const codeInput = accountStartForm.querySelector<HTMLInputElement>('input[name="code"]')
            if (codeInput) codeInput.focus()
          })
          .catch((err) => { showAccountError(err.message || 'Could not send code.') })
          .finally(() => { if (btn) { btn.disabled = false; btn.textContent = accountStartForm.dataset.mode === 'code' ? 'Sign in' : 'Send code' } })
      })
    }

    if (accountVerifyForm) {
      accountVerifyForm.addEventListener('submit', (e) => {
        e.preventDefault()
        clearAccountError()
        const codeInput = accountVerifyForm.querySelector<HTMLInputElement>('input[name="code"]')
        const btn = accountVerifyForm.querySelector<HTMLButtonElement>('button[type="submit"]')
        const code = codeInput ? codeInput.value.trim() : ''
        if (!pendingEmail || !code) return
        if (btn) { btn.disabled = true; btn.textContent = 'Signing in...' }
        api('/api/account/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: pendingEmail, code, next: '/' }),
        })
          .then((res) => res.json().then((data) => ({ ok: res.ok, data })))
          .then((result) => {
            if (!result.ok) throw new Error(result.data && result.data.error ? result.data.error : 'That code is invalid or expired.')
            return loadCanonicalAccountSessionAfterSignIn()
          })
          .catch((err) => { showAccountError(err.message || 'That code is invalid or expired.') })
          .finally(() => { if (btn) { btn.disabled = false; btn.textContent = 'Sign in' } })
      })
    }

  }

  document.addEventListener('click', (e) => {
    if (!actions.contains(e.target as Node)) closeInline()
  })

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return
    closeInline()
    closeMenu()
  })

  window.addEventListener('tacticsjournal:auth-changed', ((event: CustomEvent) => {
    if (event.detail && event.detail.authenticated) {
      // unlike upstream, the source marker is applied after the merge so the
      // handler cannot re-dispatch its own event (infinite recursion)
      setAuthenticatedEverywhere(Object.assign({ site_access: 'free', plan_name: null }, accountSessionData || {}, event.detail, { source: 'auth-event' }))
    }
  }) as EventListener)

  if (summary) {
    summary.addEventListener('click', (e) => {
      const inlineOpen = header!.getAttribute('data-inline-open')
      if (inlineOpen) {
        e.preventDefault()
        closeInline()
        return
      }
      closeInline()
      if (menu.hasAttribute('open')) {
        e.preventDefault()
        closeMenu()
      } else {
        lockBodyScroll()
      }
    })
  }

  if (overlay) overlay.addEventListener('click', closeMenu)

  // Crossing the breakpoint used to close whatever was open, because above it
  // the panels were not meant to exist. Account is now the same panel at every
  // width, so a resize mid-sign-in must not throw away what has been typed.
  if (mobileQuery.addEventListener) mobileQuery.addEventListener('change', () => {
    if (actions.getAttribute('data-inline-open') !== 'account') closeInline()
  })

  if (googleStartLink) googleStartLink.addEventListener('click', startGoogleSignIn)
  if (dashboardStartLink) dashboardStartLink.addEventListener('click', startDashboardSignIn)

  // main.ts asks for this after a network drop; the board also asks whenever
  // the tab is looked at again, which is when a sign-in done elsewhere is
  // most likely to be waiting.
  header.addEventListener('tj:refresh-session', () => { void refreshAccountSession() })
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void refreshAccountSession()
  })

  // Warm the account state as soon as the header loads so opening the
  // account panel can render immediately without showing a loading state.
  fetchAccountSession()
  openSearchFromSigninReturn()

  // The site signs out from its account page, so its panel carries no sign-out
  // button and neither does this one. The board still needs to clear its own
  // cookie, so the board's settings screen owns the control instead.
  async function signOut(): Promise<void> {
    const response = await api('/api/account/signout', { method: 'POST' })
    if (!response.ok) throw new Error('Sign out failed.')
    // The apex and Board cookies carry the same server session. Once apex
    // sign-out succeeds, clearing the Board cookie is cleanup, not a second
    // security boundary.
    await clearBoardSession()
    accountSessionData = { authenticated: false }
    accountSessionLoaded = true
    showAccountLoggedOut()
    announceSession()
  }

  return { closeMenu, closeInline, openAccount, signOut }
}
