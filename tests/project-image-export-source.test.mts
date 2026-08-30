import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const main = await readFile(new URL('../src/main.ts', import.meta.url), 'utf8')
const exporter = await readFile(new URL('../src/project-image-export.ts', import.meta.url), 'utf8')
const animation = await readFile(new URL('../src/animate-export.ts', import.meta.url), 'utf8')
const offscreen = await readFile(new URL('../src/offscreen-board.ts', import.meta.url), 'utf8')

test('the export sheet offers every board as individual PNG images', () => {
  assert.match(main, /type ExportKind = 'board' \| 'images' \| 'gif' \| 'video'/)
  assert.match(main, /label: 'All project images'/)
  assert.match(main, /one for every board/)
  assert.match(main, /if \(kind === 'images'\)[\s\S]*?exportProjectImages\(currentProject\(library\)/)
  assert.match(main, /data-exp-status role="status" aria-live="polite"/)
  assert.match(main, /role="group" aria-label="Export format"/)
  assert.match(main, /aria-pressed=/)
  assert.match(main, /setBusy\(true\)[\s\S]*?exportProjectImages/)
  assert.match(main, /sharedBackgroundScope \?\? undefined/)
  assert.match(main, /project\.boards\.length < 10/)
  assert.match(main, /openProjectImageSheet\(files\)/)
  const imageBranch = main.indexOf("if (kind === 'images')")
  const licenseGate = main.indexOf("if (!licensed && !usingGifTrial)", imageBranch)
  assert.ok(imageBranch >= 0 && licenseGate > imageBranch, 'project image export must stay available before the animation licence gate')
})

test('project image export renders each board away from the live editor', () => {
  assert.match(exporter, /for \(let index = 0; index < project\.boards\.length; index\+\+\)/)
  assert.match(exporter, /isBackgroundId\(item\.scene\.pitch\).*await cachedBackground\(item\.scene\.pitch\)/)
  assert.match(exporter, /renderer\.store\.loadScene\(item\.scene\)/)
  assert.match(exporter, /await Promise\.resolve\(\)[\s\S]*await renderer\.board\.imagesReady\(\)/)
  assert.match(exporter, /toFrameCanvas\(EXPORT_WIDTH\)/)
  assert.match(exporter, /new File\(\[file\.data\], file\.name, \{ type: 'image\/png' \}\)/)
  assert.match(exporter, /nav\.share\(\{[\s\S]*files: shareFiles/)
  assert.match(exporter, /if \(await shareImages\(result\.files, project\.name\)\) return/)
  assert.match(exporter, /export type ProjectImageFile = \{[\s\S]*name: string[\s\S]*blob: Blob/)
  assert.match(exporter, /export function downloadProjectImage\(file: ProjectImageFile\)/)
  assert.match(exporter, /if \(onUnsupportedShare\) \{[\s\S]*onUnsupportedShare\(result\.imageFiles\)[\s\S]*return/)
  assert.match(exporter, /zipFiles\(result\.files\)/)
  assert.match(exporter, /-images\.zip/)
  assert.match(offscreen, /new Store\(\{ persist: false \}\)/)
  assert.match(offscreen, /setBackgroundResolver\(resolveBackground\)/)
  assert.match(animation, /import \{ OffscreenBoard \} from '\.\/offscreen-board'/)
})

test('GIF export uses the full animation resolution at 30 fps', () => {
  assert.match(animation, /const GIF_FPS = 30/)
  assert.match(animation, /const GIF_WIDTH = 1040/)
})

test('animation export waits for local and shared project backgrounds', () => {
  assert.match(animation, /const backgroundIds = \[\.\.\.new Set\(project\.boards/)
  assert.match(animation, /await Promise\.all\(backgroundIds\.map\(cachedBackground\)\)/)
  assert.match(animation, /new OffscreenBoard\(defaults, cachedBackground\)/)
  assert.match(animation, /await Promise\.resolve\(\)[\s\S]*await offscreen\.board\.imagesReady\(\)/)
  assert.match(main, /exportAnimation\([\s\S]*?sharedBackgroundScope \?\? undefined, usingGifTrial\)/)
})

test('unsupported multi-file sharing offers one explicit download per image', () => {
  const fallback = main.match(/function openProjectImageSheet\([\s\S]*?\n}\n\nasync function openExportSheet/)?.[0] ?? ''
  assert.match(fallback, /Download project images/)
  assert.match(fallback, /This device cannot share multiple files at once\. Download the images you need below\./)
  assert.match(fallback, /files\.map\(\(file, i\)/)
  assert.match(fallback, /downloadProjectImage\(file\)/)
  assert.match(fallback, /go\.textContent = 'Downloaded'/)
  assert.match(fallback, /role="status" aria-live="polite"/)
  assert.doesNotMatch(fallback, /Download all|ZIP/)
})
