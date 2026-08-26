import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const main = await readFile(new URL('../src/main.ts', import.meta.url), 'utf8')

test('duplicating a node-based arrow keeps its line and controls together', () => {
  const duplicate = main.slice(
    main.indexOf('function duplicateSelected()'),
    main.indexOf('function bringForward()'),
  )
  const move = main.slice(
    main.indexOf('function moveObject('),
    main.indexOf('function nudgeSelected('),
  )

  assert.match(duplicate, /moveObject\(copy, 16, 16\)/)
  assert.match(move, /o\.x1 \+= dx; o\.y1 \+= dy; o\.mx \+= dx; o\.my \+= dy; o\.x2 \+= dx; o\.y2 \+= dy/)
  assert.match(move, /if \(o\.points\) for \(const p of o\.points\) \{ p\.x \+= dx; p\.y \+= dy \}/)
})
