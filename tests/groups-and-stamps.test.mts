import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const main = await readFile(new URL('../src/main.ts', import.meta.url), 'utf8')
const store = await readFile(new URL('../src/store.ts', import.meta.url), 'utf8')
const stamps = await readFile(new URL('../src/stamps.ts', import.meta.url), 'utf8')
const types = await readFile(new URL('../src/types.ts', import.meta.url), 'utf8')

test('a group id rides on every kind of object and survives a reload', () => {
  assert.match(types, /export type Grouped = \{ group\?: string \}/)
  assert.match(types, /export type SceneObj = \([\s\S]{0,200}\) & Grouped/)
  // sanitize keeps it, so a saved board comes back grouped
  assert.match(types, /const group = boundedString\(\(value as Record<string, any>\)\.group, 64\)\.trim\(\)/)
  assert.match(types, /return group \? \{ \.\.\.clean, group \} : clean/)
})

test('touching one member of a group takes the whole group', () => {
  assert.match(store, /private withGroups\(ids: string\[\]\): string\[\]/)
  assert.match(store, /const next = Array\.from\(new Set\(this\.withGroups\(ids\.filter\(Boolean\)\)\)\)/)
})

test('a copy of a group is its own group', () => {
  assert.match(main, /if \(!regroup\.has\(copy\.group\)\) regroup\.set\(copy\.group, uid\('g'\)\)/)
})

test('the link button only appears with more than one thing selected', () => {
  assert.match(main, /const linkable = show && store\.selectedIds\.length > 1/)
  assert.match(main, /document\.querySelector\('#fabBL'\)!\.classList\.toggle\('hidden', !linkable\)/)
})

test('the menu offers ungroup once the selection is one whole group', () => {
  assert.match(main, /const grouped = !!selectionGroup\(\)/)
  assert.match(main, /grouped \? 'unlink' : 'link'/)
  assert.match(main, /if \(selectionGroup\(\)\) ungroupSelection\(\)/)
})

test('a saved combination stores shapes, not a picture of them', () => {
  assert.match(stamps, /objects: SceneObj\[\]/)
  assert.equal(/src: string/.test(stamps), false)
  // and it comes back through the same sanitizer every stored scene uses
  assert.match(stamps, /sanitizeObjects\(Array\.isArray\(s\.objects\) \? s\.objects : \[\]\)/)
  assert.match(stamps, /MAX_STAMP_OBJECTS = 60/)
})

test('a combination is stored at its own origin so it lands the same anywhere', () => {
  assert.match(main, /moveObject\(copy, -box\.x, -box\.y\)/)
  assert.match(main, /const dx = BOARD_W \/ 2 - st\.w \/ 2/)
})

test('a stamp arrives as a group of its own', () => {
  assert.match(main, /const g = uid\('g'\)[\s\S]{0,300}copy\.group = g/)
  assert.match(main, /delete copy\.group/)
})

test('a user category is a short plain name, and it gets its own shelf row', () => {
  assert.match(stamps, /export function normalizeCat/)
  assert.match(stamps, /MAX_CAT_LENGTH = 18/)
  assert.match(main, /for \(const cat of customCats\(ASSET_CATEGORIES\)\) rows\.push\(\{ cat, label: cat, items: stampItems\(cat\) \}\)/)
})

test('saving to the shelf is licensed, grouping is not', () => {
  assert.match(main, /function saveSelectionToShelf\(\) \{\s*\n\s*if \(!canUseAssets\(\)\)/)
  assert.equal(/function groupSelection\(\) \{[\s\S]{0,200}canUseAssets/.test(main), false)
})

test('saving asks for nothing: no sheet, no name, the row you are in', () => {
  // the confirmation is the cell arriving, lit for a beat
  assert.match(main, /const cat = shelfCat \|\| 'players'/)
  assert.match(main, /justSavedId = saved\.id/)
  assert.match(main, /`stamp-\$\{justSavedId\}` === it\.id \? 'cellLanded' : ''/)
  // nothing opens
  assert.equal(/stampSheet/.test(main), false)
})

test('a saved combination can be renamed and moved after the fact', () => {
  assert.match(main, /data-stamp-manage="name"/)
  assert.match(main, /data-stamp-manage="move"/)
  // the empty option is the one that lets you name a row of your own
  assert.match(main, /if \(!target\.value\) \{ namingRow = true; renderPanel\(\); return \}/)
  assert.match(main, /const cat = normalizeCat\(target\.value\)/)
})

test('the one-time hint says where renaming lives, then never again', () => {
  assert.match(main, /if \(saveHintShown \|\| !justSavedId\) return ''/)
  assert.match(main, /localStorage\.setItem\(SAVE_HINT_KEY, '1'\)/)
})
