// A still can arrive three ways now, picked, pasted or dropped, and all of
// them end in the same few outcomes. The decision is made away from the DOM,
// from what arrived and what the board already shows, so it is tested here.

import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

import {
  STILL_COPY,
  dropDecision,
  dropLabel,
  imageFiles,
  isTypingTarget,
  pasteDecision,
  stillRoute,
} from '../src/still-intake.ts'

const main = await readFile(new URL('../src/main.ts', import.meta.url), 'utf8')
const board = await readFile(new URL('../src/board.ts', import.meta.url), 'utf8')

const png = { name: 'a.png', type: 'image/png' }
const jpg = { name: 'b.jpg', type: 'image/jpeg' }
const txt = { name: 'c.txt', type: 'text/plain' }

test('one still onto an empty board goes straight on; onto a still it asks', () => {
  assert.equal(stillRoute(1, false), 'apply')
  assert.equal(stillRoute(1, true), 'choose')
  assert.equal(stillRoute(1, true, true), 'replace', '⌥ answers the question before it is asked')
  assert.equal(stillRoute(1, false, true), 'apply', 'there is nothing to replace on an empty board')
  assert.equal(stillRoute(3, true), 'batch')
  assert.equal(stillRoute(3, false, true), 'batch', 'several are always several boards')
  assert.equal(stillRoute(0, true), null)
})

test('only pictures count, in the order they came', () => {
  assert.deepEqual(imageFiles([txt, jpg, png]), [jpg, png])
})

test('a paste is the board’s only when nothing else wants it', () => {
  const base = { live: true, typing: false, files: [png], hasStill: false }
  assert.deepEqual(pasteDecision(base), { kind: 'route', route: 'apply', count: 1 })
  assert.deepEqual(pasteDecision({ ...base, hasStill: true }), { kind: 'route', route: 'choose', count: 1 })
  assert.deepEqual(pasteDecision({ ...base, files: [png, jpg] }), { kind: 'route', route: 'batch', count: 2 })
  // a field, a text edit on the board, a sheet, or a drawn pitch keep their own paste
  assert.deepEqual(pasteDecision({ ...base, typing: true }), { kind: 'ignore' })
  assert.deepEqual(pasteDecision({ ...base, blocked: true }), { kind: 'ignore' })
  assert.deepEqual(pasteDecision({ ...base, live: false }), { kind: 'ignore' })
  // a paste with no picture says so rather than doing nothing
  assert.deepEqual(pasteDecision({ ...base, files: [] }), { kind: 'empty' })
  assert.deepEqual(pasteDecision({ ...base, files: [txt] }), { kind: 'empty' })
  assert.equal(STILL_COPY.nothingToPaste, 'Nothing to paste. Copy a screenshot first.')
})

test('a drop of anything but pictures is turned away, and ⌥ replaces', () => {
  assert.deepEqual(dropDecision({ files: [txt], hasStill: true, replaceKey: false }), { kind: 'reject' })
  assert.equal(STILL_COPY.imagesOnly, 'Images only: PNG or JPG')
  assert.deepEqual(dropDecision({ files: [txt, png], hasStill: true, replaceKey: true }), { kind: 'route', route: 'replace', count: 1 })
  assert.deepEqual(dropDecision({ files: [png], hasStill: true, replaceKey: false }), { kind: 'route', route: 'choose', count: 1 })
  assert.deepEqual(dropDecision({ files: [png, jpg], hasStill: false, replaceKey: false }), { kind: 'route', route: 'batch', count: 2 })
})

test('the drop label says what letting go will do', () => {
  assert.deepEqual(dropLabel(1, false), { title: 'Drop to add still', hint: null })
  assert.deepEqual(dropLabel(1, true), { title: 'Drop to add as a new board', hint: 'Hold ⌥ to replace this still' })
  assert.deepEqual(dropLabel(1, true, 'Alt'), { title: 'Drop to add as a new board', hint: 'Hold Alt to replace this still' })
  assert.deepEqual(dropLabel(4, true), { title: 'Drop to add 4 boards', hint: null })
})

test('fields and editable text keep their own paste', () => {
  assert.equal(isTypingTarget({ tagName: 'INPUT' }), true)
  assert.equal(isTypingTarget({ tagName: 'textarea' }), true)
  assert.equal(isTypingTarget({ tagName: 'DIV', isContentEditable: true }), true)
  assert.equal(isTypingTarget({ tagName: 'BUTTON' }), false)
  assert.equal(isTypingTarget(null), false)
})

test('picked, pasted and dropped stills all take the one route', () => {
  assert.match(main, /function takeStills\(files: File\[\], replace = false\)/)
  assert.match(main, /const route = stillRoute\(1, boardHasStill\(\), replace\)/)
  assert.match(main, /document\.addEventListener\('paste', \(e\) => \{[\s\S]*?takeStills\(/)
  assert.match(main, /document\.addEventListener\('drop', \(e\) => \{[\s\S]*?takeStills\(files, e\.altKey\)/)
  // the camera is a plain icon that says what it does
  assert.match(main, /data-top="live-shot" aria-label="Add still" title="Add still"/)
  // the empty frame is controls on the page, not words on the canvas
  assert.doesNotMatch(board, /import a screenshot with the camera button/)
  assert.match(main, /<strong>Add a match still<\/strong>/)
  assert.match(main, /class="fileBtn touchOnly" type="button" data-still="paste">Paste</)
})
