// Arrow weight is a property of the pitch, not of the app. A drawn pitch keeps
// the heavier line the board has always put on grass; a broadcast still keeps
// the finer line that reads over video. Medium has to mean both, and the
// canvas, the shelf and the exported SVG all have to agree about which.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

import { arrowHeadSize, arrowMediumWidth } from '../src/board-art.ts'
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
  assert.match(main, /arrowPreview\(dash, head, defaults\.arrow\.color, defaults\.arrow\.width, false, liveArrows\(\)\)/)
  // canvas: every rendered arrow asks the scene being rendered
  assert.match(board, /makeArrowShape\(o, this\.iconScale\(\), this\.arrowsAreLive\(\)\)/)
  assert.match(board, /arrowsAreLive\(\) \{ return !!pitchById\(\(this\.renderingScene \?\? this\.store\.scene\)\.pitch\)\.live \}/)
  // export: the same medium, taken from the scene's own pitch
  assert.match(saves, /const mediumWidth = arrowMediumWidth\(sceneIsLive\(scene\)\)/)
  assert.match(saves, /\(width \/ mediumWidth\) \* 14 \* k/)
})
