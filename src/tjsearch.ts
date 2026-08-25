/**
 * Port of tacticsjournal.com's js/baldy.js: the AI search chat that lives
 * in the header's inline search panel. Identical behavior - session
 * history, streaming-free Q&A, sources list, Kyle escalations, and the
 * inline sign-in gate - with every call pointed at the live site API
 * (the board runs on board.tacticsjournal.com, same site, so the
 * tj_session cookie is included). Re-sync against js/baldy.js when the
 * site version changes.
 */

import { TJ_ORIGIN } from './origin'

const TJ = TJ_ORIGIN

export function initTjSearch(): void {
  const roots = document.querySelectorAll<HTMLElement>('.search-page, #site-search-panel')
  roots.forEach(initSearch)
}

function initSearch(root: HTMLElement) {
  const form = root.querySelector<HTMLFormElement>('[data-search-form]')
  const initialHeader = root.querySelector<HTMLElement>('[data-search-initial-header]')
  const question = root.querySelector<HTMLTextAreaElement>('[data-search-question]')
  const submit = root.querySelector<HTMLButtonElement>('[data-search-submit]')
  const status = root.querySelector<HTMLElement>('[data-search-status]')
  const answer = root.querySelector<HTMLElement>('[data-search-answer]')
  const sources = root.querySelector<HTMLElement>('[data-search-sources]')
  const storageKey = 'tacticsjournal.search.sessionId'

  if (!form || !question || !submit || !status || !answer || !sources || form.dataset.searchInitialized === '1') return
  form.dataset.searchInitialized = '1'

  function uuid() {
    if (window.crypto && (window.crypto as any).randomUUID) return (window.crypto as any).randomUUID()
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = Math.random() * 16 | 0
      const v = c === 'x' ? r : (r & 0x3 | 0x8)
      return v.toString(16)
    })
  }

  function getSessionId() {
    const existing = window.localStorage.getItem(storageKey)
    if (existing) return existing
    const next = uuid()
    window.localStorage.setItem(storageKey, next)
    return next
  }

  let sessionId = getSessionId()
  let escalationStorageKey = 'tacticsjournal.search.pendingEscalations.' + sessionId
  const activePolls: Record<string, number> = {}

  function getPendingEscalations(): string[] {
    try {
      const parsed = JSON.parse(window.localStorage.getItem(escalationStorageKey) || '[]')
      return Array.isArray(parsed) ? parsed.filter(Boolean) : []
    } catch {
      return []
    }
  }

  function setPendingEscalations(ids: string[]) {
    window.localStorage.setItem(escalationStorageKey, JSON.stringify(Array.from(new Set(ids || []))))
  }

  function addPendingEscalation(id: string) {
    if (!id) return
    setPendingEscalations(getPendingEscalations().concat(id))
  }

  function removePendingEscalation(id: string) {
    setPendingEscalations(getPendingEscalations().filter((existing) => existing !== id))
  }

  function escapeHtml(text: string) {
    const map: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }
    return String(text || '').replace(/[&<>"']/g, (m) => map[m])
  }

  function formatText(text: string) {
    const linkTokens: string[] = []
    const html = escapeHtml(text)
      .replace(/([^\n(]+?)\s*\((https?:\/\/[^\s)]+)\)/g, (_match, label, url) => {
        const token = '%%SEARCH_LINK_' + linkTokens.length + '%%'
        linkTokens.push('<a href="' + url + '" target="_blank" rel="noopener noreferrer">' + label.trim() + '</a>')
        return token
      })
      .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>')
      .replace(/%%SEARCH_LINK_(\d+)%%/g, (_match, index) => linkTokens[Number(index)] || '')
      .replace(/\n\n/g, '</p><p>')
      .replace(/\n/g, '<br>')
    return html.startsWith('<p>') ? html : '<p>' + html + '</p>'
  }

  function appendMessage(role: string, text: string, options?: { scroll?: boolean }) {
    const shouldScroll = !options || options.scroll !== false
    answer!.hidden = false
    let displayName = role === 'user' ? 'You' : 'Answer'
    let displayText = text
    const isKyle = role !== 'user' && String(text || '').indexOf('Kyle answered:\n\n') === 0
    if (isKyle) {
      displayName = 'Kyle Boas'
      displayText = String(text || '').replace(/^Kyle answered:\n\n/, '')
    }

    const item = document.createElement('div')
    item.className = 'search-message search-message-' + role + (isKyle ? ' search-message-kyle' : '')
    const row = document.createElement('div')
    row.className = 'search-message-row'

    if (isKyle) {
      const avatar = document.createElement('div')
      avatar.className = 'search-message-avatar'
      const img = document.createElement('img')
      img.src = TJ + '/assets/kyleboas.jpeg'
      img.alt = 'Kyle Boas'
      avatar.appendChild(img)
      row.appendChild(avatar)
    }

    const content = document.createElement('div')
    content.className = 'search-message-content'
    if (role === 'user' || isKyle) {
      const label = document.createElement('div')
      label.className = 'search-message-label'
      label.textContent = displayName
      if (isKyle) {
        const sublabel = document.createElement('div')
        sublabel.className = 'search-message-sublabel'
        sublabel.textContent = 'Author of the Tactics Journal'
        label.appendChild(sublabel)
      }
      content.appendChild(label)
    }
    const body = document.createElement('div')
    body.className = 'search-message-body'
    body.innerHTML = formatText(displayText)
    content.appendChild(body)
    row.appendChild(content)
    item.appendChild(row)
    answer!.appendChild(item)
    if (shouldScroll) scrollToElement(item)
  }

  function renderMessages(messages: Array<{ role: string; content: string }>) {
    if (!messages || !messages.length) return
    answer!.innerHTML = ''
    answer!.hidden = false
    messages.forEach((message) => { appendMessage(message.role, message.content, { scroll: false }) })
  }

  function scrollToElement(element: HTMLElement) {
    window.requestAnimationFrame(() => {
      if (element && element.scrollIntoView) {
        element.scrollIntoView({ behavior: 'smooth', block: 'end' })
      }
    })
  }

  function renderSources(items: any[]) {
    sources!.innerHTML = ''
    const articleItems = (items || []).filter((source) => source && source.url)
    if (!articleItems.length) { sources!.hidden = true; return }

    const feed = document.createElement('div')
    feed.className = 'hub-feed search-results-feed'
    articleItems.forEach((source, index) => {
      const item = document.createElement('article')
      item.className = 'hub-feed-item search-source-item' + (index >= 5 ? ' hidden' : '')

      const title = document.createElement('h3')
      title.className = 'hub-feed-title'
      const a = document.createElement('a')
      a.href = source.url
      a.target = '_blank'
      a.rel = 'noopener noreferrer'
      a.textContent = source.title || source.path || 'Post'
      title.appendChild(a)
      item.appendChild(title)

      if (source.excerpt) {
        const excerpt = document.createElement('div')
        excerpt.className = 'hub-feed-excerpt'
        const p = document.createElement('p')
        p.textContent = source.excerpt
        excerpt.appendChild(p)
        item.appendChild(excerpt)
      }

      feed.appendChild(item)
    })
    sources!.appendChild(feed)

    if (articleItems.length > 5) {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'search-show-more'
      button.textContent = 'Show more'
      button.addEventListener('click', (event) => {
        event.preventDefault()
        event.stopPropagation()
        feed.querySelectorAll('.search-source-item.hidden').forEach((item) => { item.classList.remove('hidden') })
        button.remove()
      })
      sources!.appendChild(button)
    }

    sources!.hidden = false
  }

  const POLL_TIMEOUT_MS = 10 * 60 * 1000

  function pollEscalation(escalation: { id: string }) {
    if (!escalation || !escalation.id || activePolls[escalation.id]) return
    addPendingEscalation(escalation.id)
    const startedAt = Date.now()
    let lastAnswer = ''
    activePolls[escalation.id] = window.setInterval(() => {
      if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
        window.clearInterval(activePolls[escalation.id])
        delete activePolls[escalation.id]
        removePendingEscalation(escalation.id)
        return
      }
      fetch(TJ + '/api/baldy-escalation?id=' + encodeURIComponent(escalation.id), { credentials: 'include' })
        .then((response) => response.ok ? response.json() : null)
        .then((data) => {
          if (!data || data.status !== 'answered' || !data.answer || data.answer === lastAnswer) return
          const nextAnswer = String(data.answer || '')
          const newAnswer = lastAnswer && nextAnswer.indexOf(lastAnswer) === 0 ? nextAnswer.slice(lastAnswer.length).trim() : nextAnswer
          lastAnswer = nextAnswer
          if (!newAnswer) return
          appendMessage('assistant', 'Kyle answered:\n\n' + newAnswer)
          status!.textContent = ''
        })
        .catch(() => {})
    }, 5000)
  }

  function resumePendingEscalations() {
    getPendingEscalations().forEach((id) => { pollEscalation({ id }) })
  }

  function loadHistory() {
    fetch(TJ + '/api/baldy?sessionId=' + encodeURIComponent(sessionId), { credentials: 'include' })
      .then((response) => response.ok ? response.json() : null)
      .then((data) => {
        if (data && data.messages && data.messages.length) renderMessages(data.messages)
      })
      .catch(() => {})
  }

  function showSearchFormAfterSignIn() {
    const gate = root.querySelector<HTMLElement>('.search-signin-gate')
    if (gate) {
      gate.hidden = true
      gate.style.display = 'none'
    }
    form!.hidden = false
    form!.style.display = ''
    submit!.disabled = false
    question!.disabled = false
    question!.placeholder = 'Ask Tactics Journal'
    status!.style.display = ''
    status!.textContent = ''
    window.requestAnimationFrame(() => { question!.focus() })
  }

  function notifySearchSignedIn(user?: any) {
    window.dispatchEvent(new CustomEvent('tacticsjournal:auth-changed', {
      detail: Object.assign({ authenticated: true, source: 'search' }, user || {}),
    }))
  }

  function initInlineSignInGate() {
    let gate = root.querySelector<HTMLElement>('.search-signin-gate')
    if (!gate) {
      const gateParent = (root.classList && root.classList.contains('search-page')) ? root : root.querySelector<HTMLElement>('.search-page')
      gate = document.createElement('div')
      gate.id = 'search-signin-gate'
      gate.className = 'research-login-form search-signin-gate'
      gate.innerHTML = '<div id="search-gate-error" class="research-gate-message research-gate-message--error" style="display:none;"></div><div id="search-gate-success" class="research-gate-message research-gate-message--success" style="display:none;"></div><div class="signin-google"><a id="search-google-signin" href="' + TJ + '/api/account/google/start?next=%2Fsearch%2F" class="signin-google-button"><span class="signin-google-button__logo" aria-hidden="true"><svg viewBox="0 0 18 18" focusable="false"><path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z"/><path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.33-1.58-5.04-3.71H.94v2.33A9 9 0 0 0 9 18z"/><path fill="#FBBC05" d="M3.96 10.71A5.41 5.41 0 0 1 3.68 9c0-.59.1-1.16.28-1.71V4.96H.94A9 9 0 0 0 0 9c0 1.45.34 2.82.94 4.04l3.02-2.33z"/><path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.9 11.43 0 9 0A9 9 0 0 0 .94 4.96l3.02 2.33C4.67 5.16 6.66 3.58 9 3.58z"/></svg></span><span>Continue with Google</span></a></div><div class="signin-divider" aria-hidden="true"><span>or</span></div><form id="search-gate-form" class="site-account-start-form" novalidate><input type="text" name="website" value="" tabindex="-1" autocomplete="off" aria-hidden="true" style="position:absolute;left:-9999px;opacity:0;" /><input id="search-gate-email" type="email" name="email" placeholder="Enter your email..." autocomplete="email" required aria-label="Email address" /><button id="search-gate-btn" type="submit">Send code</button></form><form id="search-gate-code-form" novalidate style="display:none;"><input id="search-gate-code" type="text" name="code" placeholder="Enter code..." autocomplete="one-time-code" inputmode="numeric" pattern="[0-9]*" maxlength="6" required aria-label="6-digit sign-in code" /><button id="search-gate-code-btn" type="submit">Sign in</button></form><p class="research-gate-note research-gate-legal">Sign in to use search for free. No credit card required. By continuing, you agree to our <a href="' + TJ + '/privacy/">Privacy Policy</a> and <a href="' + TJ + '/terms/">Terms of Service</a>.</p>'
      if (status && status.parentNode) status.parentNode.insertBefore(gate, status.nextSibling)
      else if (gateParent) gateParent.appendChild(gate)
    }
    if (!gate || gate.dataset.initialized === '1') return gate
    gate.dataset.initialized = '1'

    const gateForm = gate.querySelector<HTMLFormElement>('.site-account-start-form')
    const btn = gateForm ? gateForm.querySelector<HTMLButtonElement>('button[type="submit"]') : null
    const codeForm = gate.querySelector<HTMLFormElement>('form[id$="gate-code-form"]')
    const emailInput = gateForm ? (gateForm.querySelector<HTMLInputElement>('input[type="email"]') || gateForm.querySelector<HTMLInputElement>('input[name="code"]') || gateForm.querySelector<HTMLInputElement>('input[type="text"]:not([name="website"])')) : null
    const errorEl = gate.querySelector<HTMLElement>('.research-gate-message--error')
    const successEl = gate.querySelector<HTMLElement>('.research-gate-message--success')
    let pendingEmail = ''
    if (codeForm) codeForm.style.display = 'none'

    function setGateFormMode(mode: string) {
      if (!emailInput || !btn) return
      gateForm!.dataset.mode = mode
      if (mode === 'code') {
        emailInput.type = 'text'
        emailInput.name = 'code'
        emailInput.placeholder = '6-digit code'
        emailInput.setAttribute('aria-label', '6-digit sign-in code')
        emailInput.setAttribute('autocomplete', 'one-time-code')
        emailInput.setAttribute('inputmode', 'numeric')
        emailInput.setAttribute('pattern', '[0-9]*')
        emailInput.setAttribute('maxlength', '6')
        emailInput.value = ''
        btn.textContent = 'Sign in'
      } else {
        emailInput.type = 'email'
        emailInput.name = 'email'
        emailInput.placeholder = 'Enter your email...'
        emailInput.setAttribute('aria-label', 'Email address')
        emailInput.setAttribute('autocomplete', 'email')
        emailInput.removeAttribute('inputmode')
        emailInput.removeAttribute('pattern')
        emailInput.removeAttribute('maxlength')
        emailInput.value = pendingEmail || ''
        btn.textContent = 'Send code'
      }
    }
    if (!gateForm || !btn || !emailInput || !errorEl || !successEl) return gate

    gateForm.addEventListener('submit', (e) => {
      e.preventDefault()
      const mode = gateForm.dataset.mode === 'code' ? 'code' : 'email'
      errorEl.style.display = 'none'
      successEl.style.display = 'none'

      if (mode === 'code') {
        const code = (emailInput.value || '').trim()
        if (!pendingEmail || !code) return
        btn.disabled = true
        btn.textContent = 'Signing in...'
        fetch(TJ + '/api/account/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ email: pendingEmail, code, next: '/' }),
        })
          .then((res) => res.json().then((d) => ({ ok: res.ok, data: d })))
          .then((result) => {
            if (result.ok && result.data.ok) {
              showSearchFormAfterSignIn()
              notifySearchSignedIn({ email: pendingEmail })
              return
            }
            throw new Error(result.data.error || 'That code is invalid or expired.')
          })
          .catch((err) => {
            errorEl.textContent = err.message || 'That code is invalid or expired.'
            errorEl.style.display = 'block'
          })
          .finally(() => { btn.disabled = false; btn.textContent = 'Sign in' })
        return
      }

      const email = (emailInput.value || '').trim()
      if (!email) return
      pendingEmail = email
      btn.disabled = true
      btn.textContent = 'Sending...'
      fetch(TJ + '/api/account/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email: pendingEmail, next: '/' }),
      })
        .then((res) => res.json().then((d) => ({ ok: res.ok, data: d })))
        .then((result) => {
          if (!result.ok || !result.data.ok) throw new Error(result.data.error || 'Could not send code.')
          setGateFormMode('code')
          emailInput.focus()
        })
        .catch((err) => {
          errorEl.textContent = err.message || 'Could not send code.'
          errorEl.style.display = 'block'
        })
        .finally(() => { btn.disabled = false; btn.textContent = gateForm.dataset.mode === 'code' ? 'Sign in' : 'Send code' })
    })

    return gate
  }

  function showSignInGate() {
    const gate = initInlineSignInGate()
    submit!.disabled = true
    question!.disabled = true
    question!.placeholder = 'Sign in to search Tactics Journal'
    form!.hidden = true
    form!.style.display = 'none'
    status!.style.display = 'none'
    if (gate) {
      gate.hidden = false
      gate.style.display = ''
    }
  }

  function requireSignedIn() {
    fetch(TJ + '/api/account/session', { credentials: 'include' })
      .then((response) => response.ok ? response.json() : null)
      .then((data) => {
        if (data && data.authenticated) {
          showSearchFormAfterSignIn()
          return
        }
        showSignInGate()
      })
      .catch(showSignInGate)
  }

  function resizeQuestion() {
    question!.style.height = 'auto'
    question!.style.height = question!.scrollHeight + 'px'
  }

  question.addEventListener('input', resizeQuestion)
  question.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      form!.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }))
    }
  })

  form.addEventListener('submit', (event) => {
    event.preventDefault()
    const text = question!.value.trim()
    if (!text) return
    if (initialHeader) initialHeader.hidden = true
    appendMessage('user', text)
    question!.value = ''
    resizeQuestion()
    submit!.disabled = true
    status!.innerHTML = 'Reading Tactics Journal opinion posts, research posts, and approved about pages.'
    fetch(TJ + '/api/baldy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ sessionId, question: text }),
    })
      .then((response) => {
        return response.json().then((data) => {
          if (!response.ok && response.status === 401 && data.signInRequired) {
            showSignInGate()
            throw new Error('Please sign in to search.')
          }
          if (!response.ok) throw new Error(data.error || 'Search is unavailable.')
          return data
        })
      })
      .then((data) => {
        status!.textContent = ''
        if (data.sessionId) {
          sessionId = data.sessionId
          window.localStorage.setItem(storageKey, sessionId)
          escalationStorageKey = 'tacticsjournal.search.pendingEscalations.' + sessionId
        }
        appendMessage('assistant', data.answer || 'I could not find an answer in the approved Tactics Journal content.')
        renderSources(data.sources || [])
        if (data.escalation && data.escalation.id) pollEscalation(data.escalation)
      })
      .catch((err) => {
        status!.textContent = ''
        appendMessage('assistant', err.message || 'Search is unavailable.')
      })
      .finally(() => { submit!.disabled = false })
  })

  requireSignedIn()
  loadHistory()
  resumePendingEscalations()
}
