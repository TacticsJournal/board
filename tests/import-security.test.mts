import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const types = await readFile(new URL('../src/types.ts', import.meta.url), 'utf8')
const saves = await readFile(new URL('../src/saves.ts', import.meta.url), 'utf8')

test('imported scenes are projected onto a closed bounded schema', () => {
  assert.match(types, /function sanitizeObject/)
  assert.match(types, /const MAX_IMPORTED_OBJECTS = 2000/)
  assert.match(types, /Number\.isFinite/)
  assert.match(types, /normalizeHex/)
  // an unknown type falls off the end of the shape sanitizer as null
  assert.match(types, /return null\n}\n\nexport function sanitizeObjects/)
  // and nothing reaches an object without going through it first
  assert.match(types, /const clean = sanitizeShape\(value\)\n  if \(!clean\) return null/)
  assert.match(types, /objects: sanitizeObjects\(objects\)/)
})

test('SVG previews encode dynamic attributes and reject non-finite values', () => {
  assert.ok(saves.includes('fill="${escXml(o.color)}"'))
  assert.match(saves, /function svgNumber/)
  assert.match(saves, /Number\.isFinite/)
  assert.equal(saves.includes('fill="${o.color}"'), false)
  assert.equal(saves.includes('fill="${o.fill}"'), false)
})
