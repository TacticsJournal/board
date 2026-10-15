// Full Pitch is height-driven, so a stale first fit shows it at a tiny scale
// on mobile Safari while 100dvh and the visual viewport finish settling.
// These source checks cover the wiring. The browser symptom needs a real
// layout engine and an iOS Safari check.

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const board = await readFile(new URL('../src/board.ts', import.meta.url), 'utf8')
const main = await readFile(new URL('../src/main.ts', import.meta.url), 'utf8')

test('the board refits after the startup layout settles', () => {
  const ctor = board.slice(board.indexOf('  constructor('), board.indexOf('  setTool('))
  assert.match(ctor, /this\.fit\(\)/)
  assert.match(ctor, /requestAnimationFrame\(\(\) => this\.refit\(\)\)/)
  assert.match(ctor, /window\.setTimeout\(\(\) => this\.refit\(\), \d+\)/)
})

test('refit coalesces a burst of size changes into one fit', () => {
  const refit = board.slice(board.indexOf('  refit() {'), board.indexOf('  /* ---------- the 3D view ---------- */'))
  assert.match(refit, /if \(this\.refitFrame\) return/)
  assert.match(refit, /requestAnimationFrame\(/)
  assert.match(refit, /this\.refitFrame = 0[\s\S]*this\.fit\(\)/)
  assert.match(board, /new ResizeObserver\(\(\) => this\.refit\(\)\)/)
})

test('viewport changes refit the board as well as the gate', () => {
  assert.match(main, /window\.addEventListener\('resize', refitBoard\)/)
  assert.match(main, /window\.visualViewport\?\.addEventListener\('resize', refitBoard\)/)
  assert.match(main, /window\.addEventListener\('orientationchange', \(\) => \{[\s\S]*?refitBoard\(\)/)
  assert.match(main, /window\.addEventListener\('resize', updateViewportGate\)/)
  assert.match(main, /window\.visualViewport\?\.addEventListener\('resize', updateViewportGate\)/)
})
