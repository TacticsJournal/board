import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const main = await readFile(new URL('../src/main.ts', import.meta.url), 'utf8')
const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8')

test('the shelf renders every category in one continuous track with section rules', () => {
  assert.match(main, /class="shelfScroll" data-shelf-scroll><div class="shelfTrack">/)
  assert.match(main, /<section class="shelfSec" id="shelf-section-\$\{index\}" data-cat="\$\{esc\(c\.cat\)\}">/)
  assert.match(main, /class="shelfSecRule" aria-hidden="true"/)
  assert.match(css, /\.shelfSecRule \{ flex: 0 0 1px; width: 1px/)
  assert.match(css, /body\.deskMode \.shelfSecRule \{ width: auto; height: 1px/)
  assert.doesNotMatch(main, /let swipeStart/)
  assert.doesNotMatch(css, /scroll-snap/)
})

test('category tabs expose their sections and support anchored keyboard navigation', () => {
  assert.match(main, /class="shelfRailList" role="tablist" aria-label="Shape categories"/)
  assert.match(main, /role="tab" data-shelf-cat=.*aria-controls="shelf-section-\$\{index\}" aria-selected="\$\{active\}"/)
  assert.match(main, /\['ArrowLeft', 'ArrowRight', 'Home', 'End'\]/)
  assert.match(main, /activateShelfCat\(cats\[nextIndex\]\.cat, true\)/)
  assert.match(main, /requestAnimationFrame\(\(\) => shelfEl\.querySelector<HTMLButtonElement>/)
  assert.match(main, /tab\.setAttribute\('aria-selected', String\(active\)\)/)
  assert.match(main, /button\.setAttribute\('aria-pressed', String\(active\)\)/)
  assert.match(main, /syncCurrentColorDots\(currentPickerColor\(\)\)/)
})

test('scroll position is captured in both axes and restored across normal renders', () => {
  assert.match(main, /shelfScrollX = oldScroll\.scrollLeft; shelfScrollY = oldScroll\.scrollTop/)
  assert.match(main, /shelfScrollX = scroll\.scrollLeft/)
  assert.match(main, /shelfScrollY = scroll\.scrollTop/)
  assert.match(main, /const restoreX = shelfScrollX, restoreY = shelfScrollY/)
  assert.match(main, /scroll\.scrollLeft = restoreX/)
  assert.match(main, /scroll\.scrollTop = restoreY/)
  assert.match(main, /probe <= axisOffset\(sections\[0\]\).*probe >= axisOffset\(sections\[sections\.length - 1\]\)/)
  assert.doesNotMatch(main, /shelfSectionSignature/)
})

test('the mobile picker docks at the viewport edge with its complete controls', () => {
  assert.match(css, /\.colorPicker \{[^}]*height: 264px/)
  assert.match(css, /\.panelDock\.pickerOpen \{ bottom: env\(safe-area-inset-bottom\); height: 300px/)
  assert.match(css, /\.colorDock\.open \{[^}]*width: 128px/)
  assert.match(css, /\.panelDock\.pickerOpen \.pickerCurrentDot \{[^}]*bottom: 276px; left: 16px/)
  assert.match(main, /class="colorDockCurrent" data-color-dock-dot/)
  assert.match(main, /class="colorDockChip" type="button" disabled/g)
  assert.match(main, /class="colorDockClose" type="button" data-color-close/)
  assert.match(css, /\.pickerHeader \{ position: relative; z-index: 3/)
  assert.match(css, /\.pickerFooter \{ position: absolute; z-index: 2/)
  assert.match(css, /\.colorDockClose::before \{[^}]*width: 30px; height: 30px/)
  assert.match(css, /\.pickerEye::before \{[^}]*width: 44px; height: 44px/)
})

test('picker visual sync rotates its grouped triangle and keeps previews local', () => {
  assert.match(main, /<g data-picker-triangle-group>/)
  assert.equal((main.match(/gradientUnits="userSpaceOnUse"/g) ?? []).length, 2)
  assert.match(main, /function hueOf\(hex: string\)/)
  assert.match(main, /triangleGroup\.setAttribute\('transform', `rotate\(\$\{-hue\} 50 50\)`\)/)
  assert.match(main, /ring\.style\.left = `\$\{50 - 44\.8 \* Math\.sin\(radians\)\}%`/)
  assert.match(main, /ring\.style\.top = `\$\{50 - 44\.8 \* Math\.cos\(radians\)\}%`/)
  assert.match(main, /triangleHandle\.style\.transform = `translate\(-50%, -50%\) rotate\(\$\{-hue\}deg\)`/)
  assert.match(main, /\[data-picker-swatch\].*aria-pressed/)
  assert.match(main, /pointercancel.*endHuePreview/)
  assert.match(main, /else setPickerVisual\(pickerColor\)/)
  assert.match(main, /catch \{ \/\* The browser reports cancellation/)
  assert.match(main, /e\.preventDefault\(\); e\.stopImmediatePropagation\(\); setPickerOpen\(false\)/)
})

test('the utility arrows use the same dedicated 22 by 18 SVG helper', () => {
  assert.match(main, /const OPPOSED_ARROWS_PATH =/)
  assert.match(main, /const opposedArrows = \(\) =>\s*`<svg viewBox="0 0 22 18"/)
  assert.match(main, /flip: opposedArrows\(\)/)
  assert.match(main, /swap: `<span class="swapArt">\$\{opposedArrows\(\)\}<\/span>`/)
  assert.match(css, /\.cell\.cellUtil svg \{ width: 22px; height: 18px; \}/)
})

test('project switches rebuild the shelf when pitch and broadcast shapes differ', () => {
  const pitchSync = main.slice(main.indexOf('let renderedPanelLive'), main.indexOf('/**\n * The panel floats'))
  assert.match(pitchSync, /const live = liveArrows\(\)/)
  assert.match(pitchSync, /if \(live === renderedPanelLive\) return false/)
  assert.match(pitchSync, /renderedPanelLive = live\s+renderPanel\(\)/)
  assert.match(main, /store\.subscribe\(\(\) => \{\s+if \(!syncPanelPitchMode\(\)\) renderOptions\(\)/)
  // Background metadata can arrive after the first paint, including for a
  // project restored directly onto an uploaded broadcast still.
  assert.match(main, /backgrounds\.subscribe\(\(\) => \{ renderRootValues\(\); syncPanelPitchMode\(\) \}\)/)
})
