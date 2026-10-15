import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const view = await readFile(new URL('../src/boards-view.ts', import.meta.url), 'utf8')
const main = await readFile(new URL('../src/main.ts', import.meta.url), 'utf8')

test('deleting a board saves the editor before indices shift', () => {
  const start = view.indexOf("case 'del':")
  const end = view.indexOf("case 'dur':", start)
  const flow = view.slice(start, end)

  assert.ok(start >= 0 && end > start)
  assert.match(flow, /const liveId = project\.boards\[this\.host\.currentIndex\(\)\]\?\.id/)
  assert.match(flow, /this\.host\.stashBoard\(\)[\s\S]*?removeBoard\(project, id\)/)
  assert.match(flow, /liveId === id[\s\S]*?Math\.min\(deletedIndex, project\.boards\.length - 1\)/)
  assert.match(flow, /findIndex\(board => board\.id === liveId\)/)
  assert.match(flow, /this\.host\.openBoard\(next, \{ stash: false \}\)/)
})

test('the host can open after a structural change without stashing through a stale index', () => {
  assert.match(view, /openBoard: \(index: number, options\?: \{ stash\?: boolean \}\) => void/)
  assert.match(view, /stashBoard: \(\) => void/)
  assert.match(main, /stashBoard: \(\) => stashEditedBoard\(false\)/)
  assert.match(main, /if \(options\?\.stash !== false\) stashEditedBoard\(\)/)
})

test('reorder and insert use the same identity-safe handoff', () => {
  const moveStart = view.indexOf("case 'up':")
  const moveEnd = view.indexOf("case 'del':", moveStart)
  const move = view.slice(moveStart, moveEnd)
  assert.match(move, /this\.host\.stashBoard\(\)[\s\S]*?moveBoard\(project, index, to\)/)
  assert.match(move, /findIndex\(board => board\.id === liveId\)/)
  assert.match(move, /openBoard\(next, \{ stash: false \}\)/)

  const addStart = view.indexOf('private addBoardHere')
  const addEnd = view.indexOf('private closeAddSheet', addStart)
  const add = view.slice(addStart, addEnd)
  assert.match(add, /this\.host\.stashBoard\(\)[\s\S]*?addBoard\(project, index, copy, scene\)/)
  assert.match(add, /openBoard\(index \+ 1, \{ stash: false \}\)/)
})
