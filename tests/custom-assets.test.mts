import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const assets = await readFile(new URL('../src/assets.ts', import.meta.url), 'utf8')
const types = await readFile(new URL('../src/types.ts', import.meta.url), 'utf8')
const main = await readFile(new URL('../src/main.ts', import.meta.url), 'utf8')
const board = await readFile(new URL('../src/board.ts', import.meta.url), 'utf8')

test('a board stores which asset it uses, never the bytes', () => {
  // The object carries an id and a frame; the artwork lives in the store.
  assert.match(types, /type: 'image'[\s\S]{0,200}assetId: string/)
  assert.equal(/type: 'image'[\s\S]{0,200}src: string/.test(types), false)
  // and an object without an asset id is not a valid object at all
  assert.match(types, /if \(!assetId\) return null/)
})

test('assets are sanitized on the way in like every other object', () => {
  assert.match(types, /if \(o\.type === 'image'\)/)
  assert.match(types, /size: finiteNumber\(o\.size, 90, 8, 1200\)/)
  assert.match(types, /aspect: finiteNumber\(o\.aspect, 1, 0\.05, 20\)/)
  assert.match(types, /image: 3/)
})

test('only stored images are accepted, and only inside a budget', () => {
  assert.match(assets, /a\.src\.startsWith\('data:image\/'\)/)
  assert.match(assets, /ASSET_BUDGET_BYTES/)
  assert.match(assets, /throw new AssetQuotaError\(\)/)
  // uploads are downscaled rather than kept at camera resolution
  assert.match(assets, /MAX_EDGE = 512/)
  assert.match(assets, /canvas\.toDataURL\('image\/png'\)/)
})

test('adding an asset needs the licence', () => {
  assert.match(main, /const canUseAssets = \(\) => entitlements\.canPlaceCone\(\)/)
  assert.match(main, /if \(!canUseAssets\(\)\) \{\s*\n\s*return \[\{ id: 'asset-add'/)
  assert.match(main, /data-lock-tag="assets"/)
})

test('the add cell uses the open shelf category', () => {
  assert.match(main, /const currentItems = shelfCategories\(\)\.find\(c => c\.cat === shelfCat\)\?\.items \?\? \[\]/)
  assert.match(main, /const item = currentItems\.find\(i => i\.id === cell\.dataset\.shelf\)/)
  assert.doesNotMatch(main, /shelfCategories\(\)\.flatMap\(c => c\.items\)\.find/)
})

test('a missing asset leaves a hole rather than breaking the board', () => {
  assert.match(board, /const asset = getAsset\(assetId\)\s*\n\s*if \(!asset\) return undefined/)
})
