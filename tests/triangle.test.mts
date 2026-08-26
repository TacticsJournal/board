import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const types = await readFile(new URL('../src/types.ts', import.meta.url), 'utf8')
const board = await readFile(new URL('../src/board.ts', import.meta.url), 'utf8')
const main = await readFile(new URL('../src/main.ts', import.meta.url), 'utf8')
const saves = await readFile(new URL('../src/saves.ts', import.meta.url), 'utf8')

// A triangle is a zone shape like the box and the oval: on the shelf, in the
// styles strip, saved, and drawn wherever a board is drawn.
test('a triangle is a zone shape everywhere a zone is', () => {
  assert.match(types, /shape: 'rect' \| 'ellipse' \| 'triangle' \| 'outline'/)
  assert.ok(types.includes("['rect', 'ellipse', 'triangle', 'outline'].includes(o.shape)"), 'a saved triangle survives the sanitizer')
  assert.match(main, /id: 'triangle', title: 'Triangle'/)
  assert.equal(main.match(/\['triangle', 'Triangle'\]/g)?.length, 2, 'both styles strips offer it')
  assert.match(board, /o\.shape === 'triangle'[\s\S]{0,120}trianglePoints/)
  assert.match(saves, /o\.shape === 'triangle'\s*\n\s*\? `<polygon/)
})

// Nodes are what a zone is once it has been edited, whatever shape it started
// as. Its w/h box is only what it is until then, and the two never overlap.
test('a zone is its nodes, or its w/h box, never both', () => {
  assert.match(types, /export function boxHasCorners\(shape: BoxObj\['shape'\]\) \{\s*\n\s*return shape === 'rect' \|\| shape === 'outline'/)
  assert.match(types, /export function nodesForShape\(shape: BoxObj\['shape'\]/, 'every shape can say what its nodes are')
  // picking a shape measures the old nodes back to a box and draws the new
  // shape into it, so nothing stale is left beside the new shape
  assert.match(main, /key === 'shape'[\s\S]{0,700}rectFromCorners\(o\.corners, o\.rotation\)[\s\S]{0,200}o\.corners = nodesForShape\(v as BoxObj\['shape'\]/)
  assert.match(main, /key === 'shape'[\s\S]{0,900}o\.corners = cornersFromRect\(o\.x, o\.y, o\.w, o\.h, o\.rotation\)/)
  // a box and an outline are one shape filled or stroked: switching between
  // those two must not throw away nodes that have been moved
  assert.match(main, /const sameFamily = boxHasCorners\(o\.shape\) && boxHasCorners\(v as BoxObj\['shape'\]\)/)
  // Every zone opens with the same dashed selection, resize node, and pencil.
  // The pencil materializes an oval or triangle's nodes only when it is used.
  assert.doesNotMatch(board, /if \(sel\.type === 'box' && !sel\.corners\)/)
  assert.match(board, /this\.addSelectionOutline\(sel\)[\s\S]{0,100}this\.addResizeNode\(sel\)[\s\S]{0,100}if \(hasNodeEdit\(sel\)\) this\.addEditIcon\(sel\)/)
  assert.match(board, /function hasNodeEdit\(obj: SceneObj\): boolean \{\s*return obj\.type === 'arrow' \|\| obj\.type === 'box'/)
})
