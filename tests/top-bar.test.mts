import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  DEFAULT_TOP_BAR,
  FIXED_TOP_BAR,
  defaultTopBarState,
  isTopBarVisible,
  loadTopBarState,
  moveTopBarItem,
  normalizeTopBarState,
  saveTopBarState,
  setTopBarVisible,
  visibleTopBar,
  TOP_BAR_KEY,
} from '../src/top-bar.ts'

const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8')
const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8')

const KNOWN = [...DEFAULT_TOP_BAR, 'match', 'ext:3d-view:toggle']

test('the bar ships in the order the design asks for', () => {
  assert.deepEqual([...DEFAULT_TOP_BAR], ['snap', 'export', 'previous-board', 'undo', 'redo', 'boards', 'more', 'note'])
  // Board settings and extension controls exist but are not on the bar.
  const state = normalizeTopBarState(defaultTopBarState(), KNOWN)
  assert.deepEqual(visibleTopBar(state), [...DEFAULT_TOP_BAR])
  assert.equal(isTopBarVisible(state, 'match'), false)
  assert.equal(isTopBarVisible(state, 'ext:3d-view:toggle'), false)
})

test('a control this build does not ship is dropped, and a new one arrives off the bar', () => {
  const state = normalizeTopBarState({ version: 1, order: ['note', 'gone', 'snap'], hidden: ['snap'] }, KNOWN)
  assert.equal(state.order.includes('gone'), false)
  assert.deepEqual(state.order.slice(0, 2), ['note', 'snap'])
  // Everything known but unsaid keeps its default: on the bar, or off it.
  assert.equal(isTopBarVisible(state, 'export'), true)
  assert.equal(isTopBarVisible(state, 'match'), false)
  assert.equal(isTopBarVisible(state, 'snap'), false)
})

test('the menu cannot be switched off, because it is the way back to Tool settings', () => {
  assert.deepEqual([...FIXED_TOP_BAR], ['more'])
  const state = setTopBarVisible(normalizeTopBarState(defaultTopBarState(), KNOWN), 'more', false)
  assert.equal(isTopBarVisible(state, 'more'), true)
  assert.equal(state.hidden.includes('more'), false)
})

test('switching a control off keeps its place for when it comes back', () => {
  const start = normalizeTopBarState(defaultTopBarState(), KNOWN)
  const off = setTopBarVisible(start, 'boards', false)
  assert.deepEqual(off.order, start.order)
  assert.deepEqual(visibleTopBar(off), ['snap', 'export', 'previous-board', 'undo', 'redo', 'more', 'note'])
  assert.deepEqual(visibleTopBar(setTopBarVisible(off, 'boards', true)), [...DEFAULT_TOP_BAR])
})

test('moving a control walks it one place and stops at the ends', () => {
  const start = normalizeTopBarState(defaultTopBarState(), KNOWN)
  assert.deepEqual(moveTopBarItem(start, 'export', -1).order.slice(0, 3), ['export', 'snap', 'previous-board'])
  assert.deepEqual(moveTopBarItem(start, 'snap', -1).order, start.order)
  const last = start.order[start.order.length - 1]
  assert.deepEqual(moveTopBarItem(start, last, 1).order, start.order)
})

test('the bar is a device preference, read and written whole', () => {
  const store = new Map<string, string>()
  const storage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v) },
  } as unknown as Storage

  // A device that has never set a bar gets the shipping one.
  assert.deepEqual(visibleTopBar(loadTopBarState(KNOWN, storage)), [...DEFAULT_TOP_BAR])

  const edited = setTopBarVisible(moveTopBarItem(normalizeTopBarState(defaultTopBarState(), KNOWN), 'note', -1), 'snap', false)
  assert.equal(saveTopBarState(edited, KNOWN, storage), true)
  assert.equal(store.has(TOP_BAR_KEY), true)
  assert.deepEqual(loadTopBarState(KNOWN, storage), edited)

  // Nonsense in storage falls back rather than throwing.
  store.set(TOP_BAR_KEY, '{')
  assert.deepEqual(visibleTopBar(loadTopBarState(KNOWN, storage)), [...DEFAULT_TOP_BAR])
})

test('the bar never travels with a board', () => {
  const source = readFileSync(new URL('../src/top-bar.ts', import.meta.url), 'utf8')
  assert.match(source, /never enters a board[\s\S]{0,6}document/)
  assert.doesNotMatch(source, /scene|Scene/)
})

test('the row is one list of buttons the reader orders', () => {
  assert.doesNotMatch(main, /class="actGroup"/)
  assert.match(main, /data-top="more"/)
  assert.match(main, /data-bar-menu="extensions"/)
  assert.match(main, /data-bar-menu="tools"/)
  // The cog leaves the bar; Settings opens the same compact sheet.
  assert.match(main, /data-top="match" aria-label="Board settings"/)
  assert.match(main, /k === 'board-settings'\) openMatchSheet\(\)/)
  assert.match(main, /<strong>Board settings<\/strong>/)
  // Reordering moves the nodes that are already there, so held references live.
  assert.match(main, /actionRowEl\.appendChild\(el\)/)
  assert.match(styles, /\.iconBtn\.barGap \{ margin-left: 14px; \}/)
})

test('a control switched off the bar waits in the menu', () => {
  // Switching a control off has to leave it somewhere, or the switch is a
  // delete. The menu is that somewhere, and the built-in rows click the real
  // button so a control behaves the same in both places.
  assert.match(main, /data-bar-overflow/)
  assert.match(main, /function renderBarMenu\(\)/)
  assert.match(main, /if \(isTopBarVisible\(topBar, id\)\) continue/)
  assert.match(main, /builtInBarButton\(overflow\.dataset\.barOverflow\)\?\.click\(\)/)
  assert.match(styles, /\.barMenuOverflow:empty \{ display: none; \}/)
})

test('Tool settings is a screen, reachable from the bar and from Settings', () => {
  assert.match(main, /data-pane="tools"/)
  assert.match(main, /tools: 'Tool settings'/)
  assert.match(main, /data-goto="tools"/)
  assert.match(main, /function renderToolsScreen\(\): void/)
  assert.match(main, /data-tools-move=/)
  assert.match(main, /data-tools-show=/)
  assert.match(main, /k === 'tools-reset'\) saveTopBar\(defaultTopBarState\(\)\)/)
  // A row wears the mark the control wears on the bar.
  assert.match(main, /function barIconMarkup\(id: string\): string/)
  assert.match(main, /<span class="setToolIcon" aria-hidden="true">\$\{barIconMarkup\(id\)\}<\/span>/)
  // `button` is 40px tall with 8px of padding by default, which is why the
  // three pieces of a row each state their own size.
  assert.match(styles, /\.sheet \.setToolMove button \{[^}]*min-height: 0;/)
  assert.match(styles, /\.sheet \.setToolSwitch \{[^}]*min-height: 0;/)
})
