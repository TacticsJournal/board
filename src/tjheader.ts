/**
 * Port of the tacticsjournal.com header behavior (_includes/header.html
 * inline script): the search icon opens the inline search panel on phones, the
 * hamburger opens the slide-down menu, Escape and outside taps close
 * everything, and the body scroll locks while a panel is open.
 *
 * Board has no accounts. The header never signs anyone in, never asks
 * tacticsjournal.com who is signed in, and sends no cookies anywhere.
 * Re-sync against the site header when it changes.
 */

type TjHeaderOptions = {
  /** Called once the What's new panel has been closed, whichever way it closed. */
  onChangelogClose?: () => void
}

export function initTjHeader(options: TjHeaderOptions = {}): { closeMenu: () => void; closeInline: () => void; openChangelog: () => void } {
  const header = document.querySelector<HTMLElement>('.site-header')
  if (!header) return { closeMenu: () => {}, closeInline: () => {}, openChangelog: () => {} }
  const actions = header.querySelector<HTMLElement>('.site-actions')!
  const toggles = header.querySelectorAll<HTMLElement>('[data-inline-toggle]')
  const searchPanel = header.querySelector<HTMLElement>('#site-search-panel')
  const changelogPanel = header.querySelector<HTMLElement>('#site-changelog-panel')

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
    const changelogWasOpen = !!changelogPanel && !changelogPanel.hidden
    ;[searchPanel, changelogPanel].forEach((panel) => {
      if (!panel || panel.hidden) return
      panel.classList.remove('active', 'is-open')
      panel.classList.add('closing')
      setTimeout(() => { panel.hidden = true; panel.classList.remove('closing') }, duration)
    })
    document.body.classList.remove('site-panel-open')
    releaseBodyScrollIfClear()
    if (changelogWasOpen) options.onChangelogClose?.()
  }

  function openInline(name: string) {
    if (!actions) return
    actions.setAttribute('data-inline-open', name)
    header!.setAttribute('data-inline-open', name)
    setExpanded(name)

    let panel: HTMLElement | null = null
    if (name === 'search') panel = searchPanel
    if (name === 'changelog') panel = changelogPanel

    if (panel) {
      panel.hidden = false
      panel.classList.remove('closing')
      window.requestAnimationFrame(() => { panel!.classList.add('is-open') })
      if (name === 'search') animatePanelContent(panel)
    }

    if (name === 'search') {
      document.body.classList.add('site-panel-open')
      lockBodyScroll()
      const question = searchPanel ? searchPanel.querySelector<HTMLElement>('[data-search-input]') : null
      if (question) window.requestAnimationFrame(() => { question.focus() })
      return
    }
    if (name === 'changelog') {
      document.body.classList.add('site-panel-open')
      lockBodyScroll()
      animatePanelContent(panel)
    }
  }

  function openChangelog() {
    if (actions.getAttribute('data-inline-open') === 'changelog') return
    closeMenu()
    // Callers are board buttons, which sit outside the header, so the click
    // that asked for the panel is still travelling up to the document handler
    // that closes panels on an outside click. Open once it has passed.
    window.setTimeout(() => { openInline('changelog') }, 0)
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
      // What's new is inline everywhere; search still hands
      // desktop over to the site's own search page, which the board does not
      // carry.
      if (!mobileQuery.matches && name === 'search') return

      e.preventDefault()
      if (actions.getAttribute('data-inline-open') === name) {
        closeInline()
        return
      }
      closeMenu()
      openInline(name)
    })
  })

  document.addEventListener('click', (e) => {
    if (!actions.contains(e.target as Node)) closeInline()
  })

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return
    closeInline()
    closeMenu()
  })

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

  if (mobileQuery.addEventListener) mobileQuery.addEventListener('change', () => { closeInline() })

  return { closeMenu, closeInline, openChangelog }
}
