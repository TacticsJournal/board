// Arrow weight is a property of the pitch, not of the app. A drawn pitch keeps
// the heavier line the board has always put on grass; a broadcast still keeps
// the finer line that reads over video. Medium has to mean both, and the
// canvas, the shelf and the exported SVG all have to agree about which.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

import { arrowHeadSize, arrowMediumWidth, arrowRenderedHeadSize, arrowShaftWidth } from '../src/board-art.ts'
import { pitchById, setCustomPitches } from '../src/pitches.ts'

const main = await readFile(new URL('../src/main.ts', import.meta.url), 'utf8')
const board = await readFile(new URL('../src/board.ts', import.meta.url), 'utf8')
const saves = await readFile(new URL('../src/saves.ts', import.meta.url), 'utf8')

test('medium is a 14 head on both ladders, over a different shaft', () => {
  assert.equal(arrowMediumWidth(false), 4.5)
  assert.equal(arrowMediumWidth(true), 3)
  // a drawn pitch: the old medium, 4.5 under 14
  assert.equal(arrowHeadSize(4.5), 14)
  // a broadcast still: the newer medium, 3 under 14
  assert.equal(arrowHeadSize(3, true), 14)
  // small and large stay proportional to their own medium
  assert.equal(arrowHeadSize(3), (3 / 4.5) * 14)
  assert.equal(arrowHeadSize(6.5), (6.5 / 4.5) * 14)
  assert.equal(arrowHeadSize(2, true), (2 / 3) * 14)
  assert.equal(arrowHeadSize(4.5, true), 21)
})

test('a broadcast dot stays near its own line, a drawn one stays fat', () => {
  // solid and dashed are stroked at the width the arrow was drawn with
  for (const live of [false, true]) {
    for (const width of [2, 3, 4.5, 6.5]) {
      assert.equal(arrowShaftWidth(width, 'solid', live), width)
      assert.equal(arrowShaftWidth(width, 'dashed', live), width)
    }
  }
  // grass: the heavy dot the board has always drawn, floor included
  assert.equal(arrowShaftWidth(3, 'dotted'), 7)
  assert.equal(arrowShaftWidth(6.5, 'dotted'), 6.5 * 1.8)
  // broadcast: no floor, and a dot only a little fatter than the line
  assert.equal(arrowShaftWidth(2, 'dotted', true), 2 * 1.3)
  assert.equal(arrowShaftWidth(3, 'dotted', true), 3 * 1.3)
  assert.equal(arrowShaftWidth(4.5, 'dotted', true), 4.5 * 1.3)
  // every broadcast rung is finer than the old 7 the export ballooned to
  for (const [w] of [[2], [3], [4.5]]) {
    assert.ok(arrowShaftWidth(w, 'dotted', true) < 7, `${w} must not balloon`)
  }
  // the canvas and the exported SVG stroke and space dots from the same rule
  assert.match(board, /strokeWidth: shaftWidth\(o, live\) \* visualScale/)
  assert.match(board, /dash: o\.measure \? undefined : arrowDash\(o, live\)/)
  assert.match(board, /\[0\.001, shaftWidth\(o, live\) \* ARROW_DOT_GAP\]/)
  assert.match(saves, /arrowShaftWidth\(width, o\.dash, sceneIsLive\(scene\)\) \* k/)
  assert.match(saves, /shaft \* ARROW_DOT_GAP/)
  // and no copy of the old inflated rule is left behind
  assert.doesNotMatch(board, /1\.8, 7/)
  assert.doesNotMatch(saves, /1\.8, 7/)
})

test('a stored width draws at that width, with no migration', () => {
  // the head follows the shaft an arrow was saved with, so a 3 stays a 3
  assert.doesNotMatch(board, /width\s*===\s*[0-9.]+\s*\?/)
  assert.match(board, /headSize: arrowHeadSize\(d\.width, live\)/)
  // the same arrow drawn on the other kind of pitch keeps its shaft either way
  assert.notEqual(arrowHeadSize(3), arrowHeadSize(3, true))
})

test('every broadcast pitch asks for the finer ladder, custom ones included', () => {
  assert.equal(pitchById('live').live, true)
  // a saved background is a pitch style like any other, and is marked broadcast
  setCustomPitches([{
    id: 'bg:x', label: 'My clip', src: '', boardH: 418,
    category: 'custom', sides: 1, pro: false, live: true, custom: true,
  } as any])
  assert.equal(pitchById('bg:x').live, true)
  setCustomPitches([])
  // one whose image is gone is still the board it was drawn on
  assert.equal(pitchById('bg:x').live, true)
  for (const id of ['pitch', 'pitch-up', 'training', 'sidebyside']) {
    assert.notEqual(pitchById(id).live, true, `${id} is a drawn pitch`)
  }
})

test('the two ladders live in one place and follow the scene', () => {
  assert.match(main, /const ARROW_WIDTH_OPTIONS[^\n]+\[\['3', 'S'\], \['4\.5', 'M'\], \['6\.5', 'L'\]\]/)
  assert.match(main, /const ARROW_WIDTH_OPTIONS_LIVE[^\n]+\[\['2', 'S'\], \['3', 'M'\], \['4\.5', 'L'\]\]/)
  assert.match(main, /arrow: \{ dash: 'solid', color: '#111111', width: 4\.5, head: true \}/)
  assert.match(main, /const liveArrows = \(\) => !!pitchById\(store\.scene\.pitch\)\.live/)
  // new-arrow and selected-arrow controls both show the scene's own ladder
  assert.equal(main.match(/seg\(sceneArrowWidths\(\),/g)?.length, 2,
    'the arrow width controls must read the ladder off the scene')
  // a measuring line has no head and is on neither arrow ladder
  assert.equal(main.match(/seg\(MEASURE_WIDTH_OPTIONS,/g)?.length, 2)
  assert.match(main, /measure: \{ color: '#111827', width: 3 \}/)
})

test('a pitch change moves the new-arrow default to the same rung', () => {
  assert.match(main, /arrowDefaultsLive = live\n  defaults\.arrow\.width = retuneArrowWidth\(defaults\.arrow\.width, live\)/)
  // and a board load reaches the same code, without touching saved arrows
  assert.match(main, /store\.subscribe\(\(\) => \{\n  if \(store\.scene\.pitch === arrowDefaultPitch\) return/)
})

test('the shelf, the canvas and the exported SVG share one head scale', () => {
  // shelf preview draws the arrow the board would draw, on the board's pitch
  assert.match(main, /arrowHeadSize\(width, live\)/)
  assert.match(main, /arrowPreview\(dash, head, shelfArrowColor\(\), defaults\.arrow\.width, false, liveArrows\(\)\)/)
  // canvas: every rendered arrow asks the scene being rendered
  // (the fourth argument is the arrow's finish, which the scene also decides)
  assert.match(board, /makeArrowShape\(\n      o, this\.iconScale\(\), this\.arrowsAreLive\(\),/)
  assert.match(board, /arrowsAreLive\(\) \{ return !!pitchById\(\(this\.renderingScene \?\? this\.store\.scene\)\.pitch\)\.live \}/)
  // export: the same rule, taken from the scene's own pitch
  assert.match(saves, /arrowRenderedHeadSize\(width, o\.dash, sceneIsLive\(scene\)\) \* k/)
  // no copy of the old dash-blind head is left in the export
  assert.doesNotMatch(saves, /\(width \/ mediumWidth\) \* 14 \* k/)
})

test('the broadcast deck shows arrows in shelf ink, but draws them white', () => {
  // the deck preview swaps the pitch's white for the shelf's own ink, so no
  // arrow choice arrives on a dark plate
  assert.match(main, /const shelfArrowColor = \(\) =>\n  liveArrows\(\) && defaults\.arrow\.color === '#ffffff' \? '#111111' : defaults\.arrow\.color/)
  // the arrow that is actually placed still defaults to white on a broadcast
  assert.match(main, /if \(style\.live && defaults\.arrow\.color === '#111111'\) defaults\.arrow\.color = '#ffffff'/)
  // and the preview still draws on the scene's ladder, head scale included
  assert.match(main, /arrowPreview\(dash, head, shelfArrowColor\(\), defaults\.arrow\.width, false, liveArrows\(\)\)/)
  assert.match(main, /headSize: arrowHeadSize\(width, live\)/)
})

test('a broadcast dotted head comes down with its dots', () => {
  // grass is untouched, dotted included: the head the board has always drawn
  for (const dash of ['solid', 'dashed', 'dotted']) {
    for (const width of [2, 3, 4.5, 6.5]) {
      assert.equal(arrowRenderedHeadSize(width, dash), arrowHeadSize(width))
    }
  }
  // broadcast solid and dashed keep the head their width earns
  for (const dash of ['solid', 'dashed', undefined]) {
    for (const width of [2, 3, 4.5]) {
      assert.equal(arrowRenderedHeadSize(width, dash, true), arrowHeadSize(width, true))
    }
  }
  // only the broadcast dotted head shrinks, and by half
  assert.equal(arrowRenderedHeadSize(3, 'dotted', true), 7)
  assert.equal(arrowRenderedHeadSize(2, 'dotted', true), arrowHeadSize(2, true) * 0.5)
  assert.equal(arrowRenderedHeadSize(4.5, 'dotted', true), 10.5)
  // and it lands back at the head-to-dot proportion a drawn dotted arrow has
  const grass = arrowRenderedHeadSize(4.5, 'dotted') / arrowShaftWidth(4.5, 'dotted')
  const live = arrowRenderedHeadSize(3, 'dotted', true) / arrowShaftWidth(3, 'dotted', true)
  assert.ok(Math.abs(grass - live) < 0.1, `${grass} vs ${live}`)
})

test('every renderer asks the one dash-aware head rule', () => {
  // canvas geometry, so the shape, its shortening and the shelf preview agree
  assert.match(board, /function headSize\(o: ArrowObj, live: boolean\): number \{\n  return arrowRenderedHeadSize\(o\.width, o\.dash, live\)/)
  // (times the board's own head scale, which every renderer also applies)
  assert.equal(board.match(/o\.head \? headSize\(o, live\) \* visualScale \* headScale : 0/g)?.length, 2)
  assert.match(saves, /\* k \* \(look\['arrow\.head'\] as number\)/)
  assert.doesNotMatch(board, /o\.head \? arrowHeadSize\(o\.width, live\)/)
  // SVG export, which PNG and animation frames are drawn from
  assert.match(saves, /arrowRenderedHeadSize\(width, o\.dash, sceneIsLive\(scene\)\)/)
})
