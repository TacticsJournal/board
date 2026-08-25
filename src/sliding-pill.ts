/**
 * The moving pill behind a segmented control (transitions.dev "tabs sliding").
 *
 * The bars already draw their selected side as a filled pill; this replaces
 * that static fill with one pill element that travels between the options, so
 * a change of selection is something you watch happen rather than something
 * you find already done. JS only measures — `translateX` and `width` are
 * written onto the pill and CSS owns the tween.
 *
 * Nothing here changes what a control means: selection still lives in
 * `aria-selected` / `aria-checked` / `aria-pressed` / `.active`, and a bar that
 * is never measured (no layout, no JS) keeps its original selected-button fill
 * because the fallback is only suppressed once `.is-measured` is set.
 */

/** Every segmented control on the board that reads as a track plus options. */
const PILL_BARS = '.shareWays, .setSeg, .proBilling'
const mountedBars = new WeakMap<HTMLElement, () => void>()
let removalObserver: MutationObserver | null = null

function watchRemovals(): void {
  if (removalObserver || !document.body) return
  removalObserver = new MutationObserver(records => {
    for (const record of records) for (const node of record.removedNodes) {
      if (!(node instanceof HTMLElement)) continue
      const bars = node.matches(PILL_BARS)
        ? [node]
        : Array.from(node.querySelectorAll<HTMLElement>(PILL_BARS))
      bars.forEach(bar => mountedBars.get(bar)?.())
    }
  })
  removalObserver.observe(document.body, { childList: true, subtree: true })
}

function isActive(tab: HTMLElement): boolean {
  return tab.getAttribute('aria-selected') === 'true'
    || tab.getAttribute('aria-checked') === 'true'
    || tab.getAttribute('aria-pressed') === 'true'
    || tab.classList.contains('active')
}

function mountBar(bar: HTMLElement): void {
  if (bar.dataset.tabsPill) return
  const tabs = Array.from(bar.children).filter((el): el is HTMLElement => el instanceof HTMLElement && el.tagName === 'BUTTON')
  if (tabs.length < 2) return
  bar.dataset.tabsPill = 'on'

  const pill = document.createElement('span')
  pill.className = 't-tabs-pill'
  pill.setAttribute('aria-hidden', 'true')
  bar.prepend(pill)

  // A selected option can change its own width (bolder label), which makes the
  // bar resize mid-travel. Re-target without snapping while that is happening.
  let travelling = false
  pill.addEventListener('transitionend', () => { travelling = false })
  pill.addEventListener('transitioncancel', () => { travelling = false })

  const place = (animate: boolean) => {
    const active = tabs.find(isActive) ?? tabs[0]
    const width = active.offsetWidth
    // A bar inside a closed sheet has no box yet. Leave the fallback fill on
    // until it does, so the selected side is never invisible.
    if (!width) { bar.classList.remove('is-measured'); travelling = false; return }
    const first = !bar.classList.contains('is-measured')
    if (animate) travelling = !first
    if ((animate || travelling) && !first) {
      pill.style.transform = `translateX(${active.offsetLeft}px)`
      pill.style.width = `${width}px`
    } else {
      // First paint and every resize: write the position with the transition
      // suspended, or the pill flies in from translateX(0) / width 0.
      const previous = pill.style.transition
      pill.style.transition = 'none'
      pill.style.transform = `translateX(${active.offsetLeft}px)`
      pill.style.width = `${width}px`
      void pill.offsetWidth
      pill.style.transition = previous
    }
    bar.classList.add('is-measured')
  }

  // The observer fires once on observe, which is the first measurement, and
  // again when the bar gains or loses its box (a sheet opening, a resize).
  const sizes = new ResizeObserver(() => place(false))
  sizes.observe(bar)
  tabs.forEach(tab => sizes.observe(tab))

  // Selection is written by each control's own code, in several places; watch
  // the state attributes rather than asking every call site to tell us.
  const states = new MutationObserver(() => place(true))
  tabs.forEach(tab => states.observe(tab, {
    attributes: true,
    attributeFilter: ['aria-selected', 'aria-checked', 'aria-pressed', 'class'],
  }))

  mountedBars.set(bar, () => {
    sizes.disconnect()
    states.disconnect()
    mountedBars.delete(bar)
  })
  watchRemovals()
}

/** Give every segmented control inside `root` its moving pill, once. */
export function mountSlidingPills(root: ParentNode): void {
  if (root instanceof HTMLElement && root.matches(PILL_BARS)) mountBar(root)
  root.querySelectorAll<HTMLElement>(PILL_BARS).forEach(mountBar)
}
