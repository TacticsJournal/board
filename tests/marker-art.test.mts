import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { LIVE_ART_SHEET, LIVE_MARKER_ELLIPSE, LIVE_PLAYER_CROP, MARKER_ASPECT } from '../src/board-art.ts'

const art = await readFile(new URL('../src/board-art.ts', import.meta.url), 'utf8')
const board = await readFile(new URL('../src/board.ts', import.meta.url), 'utf8')
const saves = await readFile(new URL('../src/saves.ts', import.meta.url), 'utf8')
const view = await readFile(new URL('../src/boards-view.ts', import.meta.url), 'utf8')

// The marker is a photograph of a player, not a white puck. Wherever a scene
// is drawn — the editor, the player, a thumbnail, an exported film — it has to
// be the same cut of that photograph, hung on the same point of the ground.
test('the marker’s art, crop and anchor are one set of numbers', () => {
  // one home for them, so no renderer can drift its own copy
  assert.match(art, /export const livePlayerSrc = new URL\('\.\.\/assets\/icons\/live\/live_player\.png'/)
  assert.match(art, /export const LIVE_PLAYER_CROP = \{ x: 752, y: 1486, width: 2844, height: 1563 \}/)
  assert.match(art, /export const MARKER_ASPECT = LIVE_PLAYER_CROP\.height \/ LIVE_PLAYER_CROP\.width/)
  assert.match(art, /export const LIVE_MARKER_ELLIPSE = \{/)
  // the board still hands the shelf and main.ts the same names it always did
  assert.match(board, /export \{[^\n]*livePlayerSrc[^\n]*LIVE_PLAYER_CROP, LIVE_MARKER_ELLIPSE, MARKER_ASPECT \} from '\.\/board-art'/)
  assert.doesNotMatch(board, /^export const LIVE_PLAYER_CROP/m)

  // the crop is a window on a square sheet, and the ellipse sits off its centre
  assert.equal(LIVE_ART_SHEET, 4096)
  assert.ok(LIVE_PLAYER_CROP.x + LIVE_PLAYER_CROP.width <= LIVE_ART_SHEET)
  assert.ok(LIVE_PLAYER_CROP.y + LIVE_PLAYER_CROP.height <= LIVE_ART_SHEET)
  assert.equal(MARKER_ASPECT, 1563 / 2844)
  assert.notEqual(LIVE_MARKER_ELLIPSE.cx, 0.5, 'the anchor is the ellipse, never the picture’s middle')
  assert.notEqual(LIVE_MARKER_ELLIPSE.cy, 0.5)
})

test('a drawn scene hangs the marker where the board hangs it', () => {
  // board.ts buildMarker: a box of o.w * k by that times the crop's aspect,
  // offset so the object's x/y lands on the ground ellipse's centre
  assert.match(board, /const w = o\.w \* k\n\s*const h = w \* MARKER_ASPECT\n\s*const ex = w \* LIVE_MARKER_ELLIPSE\.cx\n\s*const ey = h \* LIVE_MARKER_ELLIPSE\.cy/)
  // saves.ts writes that same box, in SVG
  assert.match(saves, /const w = Number\(o\.w\) \* k\n\s*const h = w \* MARKER_ASPECT/)
  assert.match(saves, /const box = \{ x: x - w \* LIVE_MARKER_ELLIPSE\.cx, y: y - h \* LIVE_MARKER_ELLIPSE\.cy, w, h \}/)
  assert.match(saves, /parts\.push\(artBox\(o, ART\.marker, livePlayerSrc, box, refs, MARKER_CROP\)\)/)
  // rotation and the flips turn about that anchor, exactly as the board's group does
  assert.match(saves, /function artBox[\s\S]{0,900}<use\$\{turn\(o\)\} href="#\$\{ref\}"/)
  assert.match(saves, /function artBox[\s\S]{0,900}<svg\$\{turn\(o\)\}/)
  // and the white puck that stood in for the photograph is gone
  assert.doesNotMatch(saves, /<ellipse\$\{spin\(o\)\}[^\n]*fill="#ffffff"/)
})

test('the marker’s name is set the way the board sets it', () => {
  // board.ts: the surname, bold white on a dark shadow, 15 and a 7 gap, both
  // scaled with the pitch, above or below the ground ellipse
  assert.match(board, /text: playerDisplayName\(o\.name, 'last'\)/)
  assert.match(board, /const fontSize = 15 \* k\n\s*const gap = 7 \* k/)
  assert.match(saves, /const name = playerDisplayName\(String\(o\.name \?\? ''\), 'last'\)/)
  assert.match(saves, /const size = 15 \* k, gap = 7 \* k/)
  assert.match(saves, /const baseline = o\.namePos === 'top' \? y - \(ry \+ gap \+ size \* 0\.2\) : y \+ ry \+ gap \+ size \* 0\.8/)
  assert.match(saves, /const ry = h \* LIVE_MARKER_ELLIPSE\.ry/)
  // the name rides the marker's angle but is never mirrored with the picture
  assert.match(saves, /parts\.push\(`<text\$\{spin\(o\)\}[^\n]*fill="#ffffff" stroke="rgba\(0,0,0,0\.55\)"/)
})

test('the player points at one cropped marker rather than cutting it per frame', () => {
  // a symbol is a viewport, so the crop costs one element and no raster work:
  // the sheet is fetched once, up front, and every frame is a <use> of it
  assert.match(saves, /if \(objs\.some\(o => o\.type === 'marker'\)\) art\.push\(\{ id: ART\.marker, src: livePlayerSrc, aspect: MARKER_ASPECT, crop: MARKER_CROP \}\)/)
  assert.match(saves, /function cropped\(src: string, crop: ArtCrop\): string \{[\s\S]{0,320}x="\$\{svgNumber\(-crop\.x\)\}" y="\$\{svgNumber\(-crop\.y\)\}"[\s\S]{0,160}width="\$\{svgNumber\(crop\.sheet, 1\)\}"/)
  assert.match(saves, /viewBox="0 0 \$\{svgNumber\(crop\.width, 1\)\} \$\{svgNumber\(crop\.height, 1\)\}"[\s\S]{0,200}cropped\(src, crop\)\}<\/symbol>/)
  // the player writes the defs once and repaints by attribute, never by rebuild
  assert.match(view, /artDefs\.innerHTML = boardArtDefs\(scenes\)/)
  assert.match(view, /paintShapes\(sceneShapesSvg\(frame\.scene/)
  assert.match(view, /art: 'point',/)
  assert.doesNotMatch(view, /createElementNS\([^\n]*'image'\)/)
})

test('an exported film draws its markers with the board itself', async () => {
  const animation = await readFile(new URL('../src/animate-export.ts', import.meta.url), 'utf8')
  const image = await readFile(new URL('../src/project-image-export.ts', import.meta.url), 'utf8')
  // a film and a still are photographs of the board's own renderer, so the
  // marker they draw is buildMarker's, cropped image and all
  for (const source of [animation, image]) {
    assert.match(source, /new OffscreenBoard\(defaults, cachedBackground\)/)
    assert.match(source, /toFrameCanvas\(/)
  }
  assert.match(board, /private buildMarker\(o: MarkerObj\): Konva\.Node[\s\S]{0,600}crop: LIVE_PLAYER_CROP/)
})
