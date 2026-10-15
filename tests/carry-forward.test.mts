// Carrying used to start with a menu and then ask what was being carried. The
// common path is one click now: the scope is read off the board, everything
// after this board takes the copies, and the toast can put it back.

import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const main = await readFile(new URL('../src/main.ts', import.meta.url), 'utf8')
const boardsView = await readFile(new URL('../src/boards-view.ts', import.meta.url), 'utf8')
const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8')

test('the strip leads with one action, whether or not anything is picked', () => {
  assert.match(main, /data-carry-forward/)
  assert.match(main, /Carry forward<\/button>/)
  // it is drawn from the board, not from the selection
  assert.match(main, /function carryStripHtml\(\)[\s\S]*?const objects = store\.scene\.objects\.length/)
  assert.match(main, /if \(!source \|\| !objects \|\| board\.interactionState === 'node-edit'\) return ''/)
  // nowhere to carry to leaves it in place but unavailable
  assert.match(main, /const ready = index >= 0 && index < project\.boards\.length - 1/)
  assert.match(main, /Carry forward<\/button>/)
})

test('scope is inferred once and never asked in the common path', () => {
  assert.match(main, /function carryScope\(\): CarrySelection \{\s*const ids = selectedObjects\(\)\.map\(object => object\.id\)\s*return ids\.length \? ids : 'all'/)
  assert.match(main, /function carryForward\(\)[\s\S]*?project\.boards\.slice\(index \+ 1\)\.map\(item => item\.id\)[\s\S]*?carrySelectionToBoards\(source\.id, targets, carryScope\(\)\)/)
  assert.match(main, /carrySelectionToBoards\(source\.id, \[next\.id\], carryScope\(\)\)/)
  assert.match(main, /boardsView\.openCarry\(source\.id, scope, count\)/)
})

test('the dropdown is down to the two secondary choices', () => {
  const menu = main.slice(main.indexOf('id="carryMenu"'), main.indexOf('id="carryMenu"') + 400)
  assert.match(menu, /data-carry="next">Next board/)
  assert.match(menu, /data-carry="choose">Choose boards/)
  assert.doesNotMatch(menu, /data-carry="following"/)
  assert.doesNotMatch(main, /All following boards/)
  // still a real dropdown: expanded state, outside click, Escape, focus back
  assert.match(main, /trigger\.setAttribute\('aria-expanded', 'true'\)/)
  assert.match(main, /if \(restoreFocus && trigger\?\.isConnected\) trigger\.focus\(\)/)
  assert.match(main, /function renderOptions\(\) \{[\s\S]*?if \(carryMenuOpen\(\)\) closeCarryMenu\(false\)/)
  assert.match(main, /if \(carryMenuOpen\(\)\) \{ e\.preventDefault\(\); closeCarryMenu\(\); return \}/)
})

test('the target picker only asks where, and only offers later boards', () => {
  assert.doesNotMatch(boardsView, /carry-scope/)
  assert.match(boardsView, /private carryTargetIds\(project: Project\): string\[\][\s\S]*?project\.boards\.slice\(at \+ 1\)\.map\(board => board\.id\)/)
  assert.match(boardsView, /const takeable = !!carry && i > sourceIndex/)
  assert.match(boardsView, /this\.carryMode\.targets = new Set\(this\.carryTargetIds\(project\)\)/)
  assert.match(boardsView, /if \(!this\.carryMode \|\| !this\.carryTargetIds\(project\)\.includes\(id\)\) return/)
  // select all, clear, count, cancel and apply all survive
  assert.match(boardsView, /data-act="carry-select-all"/)
  assert.match(boardsView, /data-act="carry-clear"/)
  assert.match(boardsView, /case 'carry-clear':[\s\S]*?renderCarryAndFocus\('\[data-act="carry-select-all"\]'\)/)
  assert.match(boardsView, /data-act="carry-cancel"/)
  assert.match(boardsView, /data-act="carry-apply"/)
  assert.match(boardsView, /role="status" aria-live="polite">\$\{carry\.targets\.size\} of/)
})

test('undo is offered on a real button and takes back only what was added', () => {
  assert.match(main, /toastActionEl\.addEventListener\('click'/)
  assert.match(main, /toastActionEl = document\.createElement\('button'\)/)
  assert.match(main, /function hideToast\(\) \{\s*window\.clearTimeout\(toastTimer\)/)
  assert.match(main, /undoCarryAction\(project\.id, result\.added\)/)
  assert.match(main, /const removed = undoCarry\(project, added\)/)
  // a target board the editor is holding is shown again after the undo
  assert.match(main, /if \(openId && added\.some\(entry => entry\.boardId === openId\)\)[\s\S]*?loadBoardIntoEditor\(board\.scene\)/)
  assert.match(main, /saveProjectChanges\(project\)/)
  assert.match(styles, /\.toast--action \{/)
})
