import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  APPEARANCE_KEYS,
  AUTO,
  SYSTEM_FONTS,
  appearanceDefault,
  appearanceGroup,
  appearanceSpec,
  coerce,
  fontStack,
  haloAgainst,
  inkOn,
  isDefaultAppearance,
  keysInGroup,
  normalizeAppearance,
  objectAppearance,
  orOwn,
  resolveAppearance,
  withAppearance,
} from '../src/appearance.ts'
import { migrate } from '../src/types.ts'

const board = readFileSync(new URL('../src/board.ts', import.meta.url), 'utf8')
const saves = readFileSync(new URL('../src/saves.ts', import.meta.url), 'utf8')
const store = readFileSync(new URL('../src/store.ts', import.meta.url), 'utf8')

test('every property is declared once and reached the same way', () => {
  // The point of the spec: adding a property is a line, not five.
  assert.ok(APPEARANCE_KEYS.length >= 24, `expected a full surface, got ${APPEARANCE_KEYS.length}`)
  for (const key of APPEARANCE_KEYS) {
    assert.notEqual(appearanceDefault(key), undefined, `${key} has no default`)
    assert.equal(resolveAppearance(undefined)[key], appearanceDefault(key))
  }
  // Groups are how the editor divides itself, and they cover everything.
  const groups = ['type', 'player', 'marker', 'arrow', 'zone', 'text'] as const
  assert.deepEqual(
    APPEARANCE_KEYS.slice().sort(),
    groups.flatMap(g => keysInGroup(g)).sort(),
  )
  assert.equal(appearanceGroup('font'), 'type')
  assert.equal(appearanceGroup('player.nameHalo'), 'player')
})

test('a number carries its own step, so no property is unreachable', () => {
  for (const key of APPEARANCE_KEYS) {
    const spec = appearanceSpec(key)
    if (spec.kind !== 'number') continue
    assert.ok(spec.step > 0, `${key} has no step`)
    // A step derived from the range left a zone border able to land on four of
    // its values and nothing between them.
    const stops = (spec.max - spec.min) / spec.step
    assert.ok(stops >= 8, `${key} has only ${stops} stops`)
    // The default has to be one of them: a slider given a value off its step
    // reports the nearest stop instead, so the control would lie about the
    // board the moment the screen opened.
    const off = Math.abs(Math.round((spec.def - spec.min) / spec.step) * spec.step - (spec.def - spec.min))
    assert.ok(off < 1e-9, `${key} default ${spec.def} is between two stops`)
  }
})

test('a board nobody has styled carries no appearance at all', () => {
  assert.equal(normalizeAppearance(undefined), undefined)
  assert.equal(normalizeAppearance({}), undefined)
  assert.equal(normalizeAppearance(resolveAppearance(undefined)), undefined)
  assert.equal(isDefaultAppearance(undefined), true)
  assert.equal(normalizeAppearance('nope'), undefined)
  assert.equal(normalizeAppearance(['nope']), undefined)
})

test('only what differs from the default is written down, as a tree', () => {
  assert.deepEqual(normalizeAppearance({ font: 'serif' }), { font: 'serif' })
  assert.deepEqual(
    normalizeAppearance({ player: { shadow: 0, outline: appearanceDefault('player.outline') } }),
    { player: { shadow: 0 } },
  )
  const one = withAppearance(undefined, 'zone.border', 3)
  assert.deepEqual(one, { zone: { border: 3 } })
  // Setting a property back to its default drops it again.
  assert.equal(withAppearance(one, 'zone.border', appearanceDefault('zone.border') as number), undefined)
})

test('nonsense is read as the default, and out of range is clamped', () => {
  assert.equal(coerce('font', 'Comic Sans'), 'default')
  assert.equal(coerce('tracking', 'lots'), appearanceDefault('tracking'))
  assert.equal(coerce('player.outline', 99), 1.2)
  assert.equal(coerce('player.outline', -5), 0)
  assert.equal(coerce('player.outlineColor', 'red'), appearanceDefault('player.outlineColor'))
  assert.equal(coerce('player.outlineColor', '0B0B0E'), '#0b0b0e')
  assert.equal(coerce('zone.borderStyle', 'wiggly'), 'solid')
})

test('a colour that was a rule keeps being one until it is set', () => {
  // `auto` is how the board's old automatic behaviour survives being settable.
  assert.equal(appearanceDefault('player.numberColor'), AUTO)
  assert.equal(inkOn(AUTO, '#ffffff'), '#111827')
  assert.equal(inkOn(AUTO, '#1e2f6f'), '#ffffff')
  assert.equal(inkOn('#ff0000', '#ffffff'), '#ff0000')
  assert.equal(haloAgainst(AUTO, '#ffffff'), '#111827')
  assert.equal(haloAgainst(AUTO, '#111111'), '#ffffff')
  assert.equal(orOwn(AUTO, '#fde047'), '#fde047')
  assert.equal(orOwn('#000000', '#fde047'), '#000000')
})

test('the device families need no network, and anything unknown still draws', () => {
  assert.equal(SYSTEM_FONTS.length, 5)
  for (const font of SYSTEM_FONTS) {
    assert.equal(fontStack(font.id), font.stack)
    assert.doesNotMatch(font.stack, /https?:|url\(/)
  }
  assert.equal(fontStack(undefined), SYSTEM_FONTS[0].stack)
  // A family this device has not fetched yet falls back at paint time rather
  // than being thrown away, which is what lets a shared board keep its type.
  assert.equal(fontStack('made-up'), SYSTEM_FONTS[0].stack)
  assert.equal(coerce('font', 'playfair-display'), 'playfair-display')
  assert.equal(coerce('font', 'Playfair Display'), 'default')
  assert.equal(coerce('font', '../../etc/passwd'), 'default')
  assert.equal(coerce('font', 42), 'default')
})

test('an object follows the board unless it has said otherwise', () => {
  assert.equal(objectAppearance(undefined, 2), 2)
  assert.equal(objectAppearance(0, 2), 0)
  assert.equal(objectAppearance('dashed', 'solid'), 'dashed')
})

test('appearance survives a save and comes back sanitised', () => {
  const scene = migrate({
    version: 4, board: { w: 800, h: 418 }, pitch: 'full', objects: [],
    appearance: { font: 'mono', zone: { border: 200, borderStyle: 'wiggly' }, junk: { nope: 1 } },
  })
  assert.equal(scene.appearance?.font, 'mono')
  assert.equal(scene.appearance?.zone?.border, 16)
  assert.equal(scene.appearance?.zone?.borderStyle, undefined)
  assert.equal((scene.appearance as any)?.junk, undefined)
  assert.equal(migrate({ version: 4, board: { w: 800, h: 418 }, objects: [] }).appearance, undefined)
})

test('an object keeps its own finish through a save', () => {
  const scene = migrate({
    version: 4, board: { w: 800, h: 418 }, objects: [
      { id: 'a', type: 'arrow', x1: 0, y1: 0, x2: 10, y2: 10, mx: 5, my: 5, curved: false, dash: 'solid', color: '#111111', width: 4, head: true, shadow: 2 },
      { id: 'b', type: 'box', shape: 'ellipse', x: 0, y: 0, w: 10, h: 10, rotation: 0, fill: '#fde047', opacity: 0.25, border: 3, borderStyle: 'dashed' },
      { id: 'c', type: 'text', x: 0, y: 0, text: 'hi', size: 18, bold: true, color: '#ffffff', rotation: 0, halo: 2 },
      { id: 'd', type: 'arrow', x1: 0, y1: 0, x2: 10, y2: 10, mx: 5, my: 5, curved: false, dash: 'solid', color: '#111111', width: 4, head: true },
    ],
  })
  const [a, b, c, d] = scene.objects as any[]
  assert.equal(a.shadow, 2)
  assert.equal(b.border, 3)
  assert.equal(b.borderStyle, 'dashed')
  assert.equal(c.halo, 2)
  assert.equal('shadow' in d, false)
})

test('the board is drawn with it, everywhere a board is drawn', () => {
  // The Konva board takes it off the scene, not off the device, and never asks
  // what the reader has paid for.
  assert.match(board, /private look\(\): ResolvedAppearance/)
  assert.doesNotMatch(board, /hasPaidBoardAccess|isPro\(\)/)
  assert.equal((board.match(/fontFamily: 'Inter, system-ui, sans-serif'/g) ?? []).length, 3)
  assert.match(board, /fontFamily: this\.boardFont\(\)/)
  // The colours that used to be rules now go through the rule-keeping helpers.
  assert.match(board, /inkOn\(look\['player\.numberColor'\], o\.color\)/)
  assert.match(board, /haloAgainst\(look\['player\.nameHaloColor'\], nameColor\)/)
  assert.match(board, /haloAgainst\(look\['text\.haloColor'\], o\.color\)/)
  assert.match(board, /orOwn\(this\.look\(\)\['zone\.labelColor'\], o\.fill\)/)
  assert.match(board, /shadowColor: look\['player\.shadowColor'\]/)
  // And so does the SVG the thumbnails and the sequence row are drawn from.
  assert.match(saves, /function labelFont\(scene: Scene \| undefined\)/)
  assert.match(saves, /look\['player\.outline'\]/)
  assert.match(saves, /inkOn\(look\['player\.numberColor'\]/)
})

test('an appearance change is a board change: it undoes, and it syncs', () => {
  assert.match(store, /appearance: s\.appearance/)
  assert.match(store, /if \(parsed\.appearance\) this\.scene\.appearance = parsed\.appearance/)
})

test('appearance is a panel screen, over the board rather than across it', () => {
  const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8')
  // It lives in the dock, which sits over the board, not in the full sheet.
  assert.match(main, /type PanelScreen = 'root' \| 'appearance'/)
  assert.match(main, /function panelAppearanceHtml/)
  assert.match(main, /quickSetRow\('appearance', 'Appearance'/)
  assert.match(main, /if \(key === 'appearance'\) \{ showPanelScreen\('appearance'\)/)
  // And nothing of it is left in the sheet.
  assert.doesNotMatch(main, /data-pane="appearance"/)
  assert.doesNotMatch(main, /data-goto="appearance"/)
  // There is no preview: the board behind the panel is the preview.
  assert.doesNotMatch(main, /lookPreviewSvg|lookPreviewScene|data-pack-preview/)
  // Groups scroll rather than divide a fixed track between them.
  assert.match(main, /const LOOK_GROUPS/)
  assert.match(main, /class="panelChips"/)
  assert.match(main, /keysInGroup\(lookGroup\)/)
  // Every number is a slider across the row, with the value a box when tapped.
  assert.match(main, /data-look-range=/)
  assert.match(main, /data-look-edit=/)
  assert.match(main, /function editLookValue/)
  // A colour offers the six answers inline, and the wheel one tap further.
  assert.match(main, /const LOOK_SWATCHES/)
  assert.match(main, /data-look-wheel=/)
  assert.match(main, /function openLookWheel[\s\S]*?setPickerOpen\(true\)/)
  // A drag is one undo entry, not one per pointer move.
  assert.match(main, /quickSetEl\.addEventListener\('pointerdown'[\s\S]{0,300}?store\.beginGesture\(\)/)
  assert.match(main, /function endLookDrag[\s\S]*?store\.endGesture\(\)/)
  // Writing a property repaints the row, not the whole list.
  assert.match(main, /function writeLook[\s\S]*?refreshLookRow\(key\)/)
  /* How a board is drawn is a local edit, like every other one: free. Pro is
     what carries it off this device - a board only syncs with Pro, and the
     appearance rides on the board. So nothing here asks to be paid for. */
  assert.doesNotMatch(main, /function setBoardAppearance[\s\S]{0,200}?hasPaidBoardAccess/)
  assert.doesNotMatch(main, /function writeLook[\s\S]{0,200}?hasPaidBoardAccess/)
  assert.doesNotMatch(main, /function panelAppearanceHtml[\s\S]{0,300}?hasPaidBoardAccess/)
  assert.doesNotMatch(main, /panelLock|panelListLocked/)
  /* Styles no longer asks where a finish lands: it goes on what is picked, and
     Appearance is where a finish is set for every zone on the board. */
  assert.doesNotMatch(main, /type StyleScope/)
  assert.match(main, /function setFinish[\s\S]{0,200}?if \(!store\.selected\)/)
  // A rail there is the same slider, on the same range, dragged as one entry.
  assert.match(main, /stylesShelfEl\.addEventListener\('pointerdown'[\s\S]{0,300}?store\.beginGesture\(\)/)
  assert.match(main, /function endStyleRailDrag[\s\S]*?store\.endGesture\(\)/)
})
