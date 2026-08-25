import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8')
const saves = readFileSync(new URL('../src/saves.ts', import.meta.url), 'utf8')
const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8')
const pills = readFileSync(new URL('../src/sliding-pill.ts', import.meta.url), 'utf8')

test('anchored menus use the dropdown states and clean up after closing', () => {
  assert.match(main, /linkMenu t-dropdown[^>]+data-origin="bottom-left"/)
  assert.match(main, /pitchMenu t-dropdown[^>]+data-origin="bottom-right"/)
  assert.match(main, /classList\.add\('is-closing'\)/)
  assert.match(main, /dropdownCloseMs\(\)/)
  assert.match(styles, /\.t-dropdown\.is-open/)
  assert.match(styles, /\.t-dropdown\.is-closing/)
})

test('segmented controls mount one measured pill and release observers when removed', () => {
  assert.match(pills, /const PILL_BARS = '\.shareWays, \.setSeg, \.proBilling'/)
  assert.match(pills, /pill\.style\.transition = 'none'/)
  assert.match(pills, /new ResizeObserver/)
  assert.match(pills, /new MutationObserver/)
  assert.match(pills, /sizes\.disconnect\(\)/)
  assert.match(pills, /states\.disconnect\(\)/)
  assert.match(main, /mountSlidingPills\(settingsEl\)/)
  assert.match(saves, /mountSlidingPills\(form\)/)
})

test('match controls are semantic switches that animate only after use', () => {
  assert.equal((main.match(/role="switch"/g) ?? []).length, 2)
  assert.match(main, /class="mTrack t-toggle" data-on="false"/)
  assert.match(main, /setAttribute\('aria-checked', String\(on\)\)/)
  assert.match(main, /classList\.add\('is-init'\)/)
  assert.match(styles, /@keyframes t-toggle-on/)
  assert.match(styles, /@keyframes t-toggle-off/)
})

test('transient messages use the reduced-motion-safe toast recipe', () => {
  assert.match(main, /toastEl\.className = 'toast t-toast'/)
  assert.match(main, /classList\.add\('is-open'\)/)
  assert.match(styles, /\.t-toast\.is-open/)
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\) \{\s*\.t-toast \{ transition: none !important; \}/)
})
