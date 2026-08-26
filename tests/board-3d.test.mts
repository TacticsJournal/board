import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const board = await readFile(new URL('../src/board.ts', import.meta.url), 'utf8')
const main = await readFile(new URL('../src/main.ts', import.meta.url), 'utf8')
const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8')
const extension = await readFile(new URL('../src/extensions/official/3d-view/index.ts', import.meta.url), 'utf8')

 test('the official extension owns the accessible 3D toolbar control and preference', () => {
  assert.match(main, /data-ext-toolbar/)
  assert.match(main, /new OfficialExtensions\(/)
  assert.doesNotMatch(main, /id="tiltBtn"|data-top="tilt"|setBoardTilt/)
  assert.match(extension, /tbm-board-3d-v1/)
  assert.match(extension, /pressed: \(\) => host\.is3D\(\)/)
  assert.match(extension, /writePreference\(on\)/)
})

test('3D camera movement comes from native mouse and touch gestures', () => {
  assert.match(main, /id="boardReset"[^>]*aria-label="Reset 3D camera"/)
  assert.match(main, /Drag to orbit · pinch to zoom/)
  assert.doesNotMatch(main, /boardTiltRange|boardCameraButtons|data-camera-zoom/)
  assert.match(board, /private bindCameraGestures\(\)/)
  assert.match(board, /addEventListener\('pointermove'/)
  assert.match(board, /addEventListener\('wheel'/)
  assert.match(board, /addEventListener\('touchmove'/)
  assert.match(board, /this\.set3DCamera\(\{[\s\S]*?yaw:/)
  assert.match(board, /this\.set3DCamera\(\{ zoom:/)
})

test('camera state is bounded, fitted, centred, and resettable', () => {
  assert.match(board, /export const BOARD_3D_CAMERA = \{[\s\S]*?tiltMin: 0, tiltMax: 66/)
  assert.match(board, /function wrapCameraYaw\(degrees: number\)/)
  assert.match(board, /const yaw = Number\.isFinite\(yawValue\) \? wrapCameraYaw\(yawValue\)/)
  assert.doesNotMatch(board, /yawMin|yawMax/)
  assert.match(board, /zoomMin: 0\.4, zoomMax: 1/)
  assert.match(board, /cameraFitScale/)
  assert.match(board, /cameraSpan/)
  assert.match(board, /this\.zoom = 1[\s\S]*?this\.fit\(\)/)
  assert.match(board, /reset3DCamera\(\)/)
  assert.match(board, /parentElement\?\.classList\.toggle\('is3d', on\)/)
  assert.match(css, /\.boardArea\.is3d \{ background: var\(--board-3d-space\); \}/)
  assert.match(css, /rotateX\(var\(--cam-tilt/)
  assert.match(css, /rotateZ\(var\(--cam-yaw/)
  assert.match(css, /\.boardReset[\s\S]*?min-width: 44px;[\s\S]*?min-height: 44px;/)
  assert.match(css, /\.boardReset:focus-visible[\s\S]*?outline:/)
})

test('3D stays on the live Konva content and remaps pointers through the inverse', () => {
  assert.match(board, /mountTiltMarkers\(\)/)
  assert.match(board, /homographyFromBox\(w, h, corners\)/)
  assert.match(board, /invertHomography\(forward\)/)
  assert.match(board, /\.setPointersPositions = \(evt: any\)/)
  assert.match(board, /this\.tiltPoint\(from\.clientX, from\.clientY\)/)
  assert.match(board, /if \(!p1 \|\| !p2\) \{ this\.pinch = null; return \}/)
  assert.match(board, /invalidateTilt\(\)/)
  assert.match(board, /private tiltActive\(\) \{ return this\.tilted \}/)
})

test('the CSS keeps extension controls out of the camera transform', () => {
  assert.match(css, /\.iconBtn\.extBtn::after[\s\S]*?width: 44px;[\s\S]*?height: 44px;/)
  assert.match(css, /#stage\.is3d \.konvajs-content[\s\S]*?transform: rotateX\(/)
  assert.doesNotMatch(css, /#stage\.tiltAnim|#stage\.is3d \.konvajs-content\s*\{[^}]*transition/)
  assert.doesNotMatch(css, /#stage\.is3d[^\{]*\.actionRow|\.actionRow[^\{]*#stage\.is3d/)
})
