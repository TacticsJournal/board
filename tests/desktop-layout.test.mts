import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const main = await readFile(new URL('../src/main.ts', import.meta.url), 'utf8')
const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8')

test('the wide layout is a breakpoint, not a second app', () => {
  assert.match(main, /const DESK_QUERY = '\(min-width: 1024px\)'/)
  assert.match(main, /deskQuery\.addEventListener\('change'/)
  // one set of elements, moved between the two arrangements
  assert.match(main, /ctxDockEl\.append\(fabColEl, fabBLEl, optionsEl\)/)
  assert.match(main, /stageWrap\.append\(fabColEl, fabBLEl\)/)
  assert.match(main, /panelDockEl\.append\(optionsEl\)/)
})

test('the rail carries the categories the shelf rail used to', () => {
  assert.match(main, /function renderRail\(\)/)
  assert.match(main, /const cats = shelfCategories\(\)[\s\S]*?data-rail="\$\{esc\(c\.cat\)\}"/)
  assert.match(main, /data-rail="text"/)
  assert.match(main, /data-bar="settings"/)
  // and the shelf stops drawing its own, rather than hiding it in CSS
  assert.match(main, /deskMode \? '' :\s*\n\s*`<div class="shelfRail">`/)
  assert.equal(/body\.deskMode \.shelfRail \{ display: none/.test(css), false)
})

test('a wide window folds the panel by default and remembers otherwise', () => {
  assert.match(main, /const DESK_PANEL_KEY = 'tbm-desk-panel-v1'/)
  assert.match(main, /function deskPanelPref\(\): boolean \{\s*\n\s*try \{ return localStorage\.getItem\(DESK_PANEL_KEY\) === '1' \} catch \{ return false \}/)
  assert.match(main, /panelOpen = deskPanelPref\(\)/)
  assert.match(main, /function setDeskPanel\(open: boolean\) \{[\s\S]*?setDeskPanelPref\(open\)/)
})

test('the lit tool folds the panel, and a drifted tool re-arms instead', () => {
  assert.match(main, /if \(room === 'shapes' && rail === shelfCat\) \{\s*\n\s*if \(tool && board\.tool !== tool\) \{ board\.setTool\(tool\); renderPanel\(\); return \}\s*\n\s*setDeskPanel\(!panelOpen\)/)
})

test('switching tools leaves the panel folded if that is how it was left', () => {
  const rail = main.slice(main.indexOf('const rail = btn.dataset.rail'), main.indexOf('const next = btn.dataset.room'))
  assert.equal(/shelfCat = rail[\s\S]*setDeskPanel\(true\)/.test(rail), false)
})

test('nothing insets the board on a wide window', () => {
  assert.match(main, /const h = deskMode \? 0 : Math\.round\(panelDockEl\.getBoundingClientRect\(\)\.height\)/)
})

test('the options strip is the bar over the board and always shows there', () => {
  assert.match(main, /const hide = !deskMode && \(shelfShowing\(\) \|\| collapsed\)/)
  assert.match(main, /if \(!html && \(room === 'styles' \|\| deskMode\)\)/)
})

test('the phone layout keeps its own rules', () => {
  // the desktop block only ever adds under body.deskMode
  const desk = css.slice(css.indexOf('/* ---------- wide window'))
  for (const line of desk.split('\n')) {
    const selector = line.trim()
    if (!selector || selector.startsWith('/*') || selector.startsWith('*') || selector.startsWith('@media')) continue
    if (!selector.includes('{')) continue
    if (/^(\.workArea|\.boardArea|\.ctxDock|\.panelFold|\.railBtn|\.railFoot|html\[data-theme|body\.deskMode)/.test(selector)) continue
    assert.fail(`desktop block touches a phone selector: ${selector}`)
  }
  assert.match(desk, /body\.deskMode\.lib-open \.stageWrap/)
})

test('folding clips the panel rather than emptying it first', () => {
  assert.match(main, /function shelfHasContent\(\) \{[\s\S]*?\(panelOpen \|\| deskMode\)/)
  assert.match(main, /if \(!shelfHasContent\(\)\) \{ shelfEl\.classList\.add\('hidden'\)/)
  assert.match(main, /panelDockEl\.inert = folded/)
  assert.match(css, /body\.deskMode \.panelDock\.folded > \* \{ opacity: 0; \}/)
  // the movement goes under reduced motion; the fade stays
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\n  body\.deskMode \.panelDock \{ transition: none; \}\n\}/)
})

test('the fold is a push, and the rail answers a press', () => {
  assert.match(css, /transition: width var\(--dur-push, 220ms\) var\(--ease-drawer, ease\)/)
  assert.match(css, /\.railBtn:active \{ transform: scale\(0\.92\); \}/)
})

test('the rail and the panel are the widths the layout was measured at', () => {
  assert.match(css, /body\.deskMode #toolbar \{[\s\S]*?width: 52px/)
  assert.match(css, /body\.deskMode \.panelDock \{[\s\S]*?width: 180px/)
  assert.match(css, /body\.deskMode \.panelDock\.folded \{ width: 0/)
})
