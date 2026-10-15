import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  BUNDLED_FONTS, SYSTEM_FONTS, fontFaceCss, fontLabel, fontStack, isFontId, matchFonts, primeFont,
} from '../src/fonts.ts'
import { fontCdnUrl, fontFileName, fontLocalUrl } from '../src/fonts-shared.mjs'

const catalogue = JSON.parse(readFileSync(new URL('../src/font-catalogue.json', import.meta.url), 'utf8'))
  .map((r: any) => ({ id: r.i, family: r.f, category: r.c, regular: r.r, bold: r.b }))
const saves = readFileSync(new URL('../src/saves.ts', import.meta.url), 'utf8')
const board = readFileSync(new URL('../src/board.ts', import.meta.url), 'utf8')

test('the catalogue is a searchable list of Google families, not an API call', () => {
  assert.ok(catalogue.length > 1500, `only ${catalogue.length} families`)
  for (const font of catalogue) {
    assert.ok(isFontId(font.id), font.id)
    assert.ok(font.family.length > 0)
  }
  // It is in the repository, so search works offline and asks nobody for a key.
  const fonts = readFileSync(new URL('../src/fonts.ts', import.meta.url), 'utf8')
  assert.doesNotMatch(fonts, /googleapis\.com|key=/)
})

test('a search matches from the start of a word, not anywhere in one', () => {
  const names = (rows: any[]) => rows.map(r => r.family)
  assert.ok(names(matchFonts(catalogue, 'cond')).includes('Barlow Condensed'))
  assert.ok(names(matchFonts(catalogue, 'plex')).includes('IBM Plex Sans'))
  // An exact name is first, ahead of every family that merely contains the word.
  assert.equal(matchFonts(catalogue, 'oswald')[0].family, 'Oswald')
  assert.equal(matchFonts(catalogue, '').length, 0)
  assert.ok(matchFonts(catalogue, 'a', 20).length <= 20)
})

test('every bundled family is in the catalogue and has its files on our origin', () => {
  assert.equal(BUNDLED_FONTS.length, 16)
  for (const font of BUNDLED_FONTS) {
    const row = catalogue.find((r: any) => r.id === font.id)
    assert.ok(row, `${font.id} is offered but not a Google family`)
    assert.equal(row.family, font.family)
    for (const weight of [font.regular ?? 400, font.bold ?? 700]) {
      const path = new URL(`../public/fonts/${fontFileName(font.id, weight)}`, import.meta.url)
      assert.ok(readFileSync(path).length > 1000, `${font.id} ${weight} is missing`)
    }
  }
})

test('a family id is all that ever reaches a URL', () => {
  for (const bad of ['../evil', 'a b', 'A', '', 'x'.repeat(65), 'a--b', '-a']) {
    assert.equal(isFontId(bad), false, bad)
  }
  assert.equal(fontLocalUrl('oswald', 400), '/fonts/oswald-400.woff2')
  assert.match(fontCdnUrl('oswald', 400), /^https:\/\/cdn\.jsdelivr\.net\/npm\/@fontsource\/oswald\//)
})

test('a loaded family travels inside an export, because an SVG cannot see the page', () => {
  // A thumbnail is painted into an <img>, which is its own document: a family
  // named but not carried comes back in the fallback with no error anywhere.
  assert.match(saves, /fontFaceCss/)
  assert.match(board, /ensureFont/)

  assert.equal(fontFaceCss('default'), '')
  assert.equal(fontFaceCss('never-fetched'), '')
  primeFont({ id: 'playfair-display', family: 'Playfair Display', category: 'serif' }, { 400: 'AAAA', 700: 'BBBB' })
  const css = fontFaceCss('playfair-display')
  assert.match(css, /font-family:"Playfair Display"/)
  assert.match(css, /font-weight:400/)
  assert.match(css, /font-weight:700/)
  assert.match(css, /base64,AAAA/)
  assert.equal(fontStack('playfair-display'), '"Playfair Display", Georgia, serif')
  assert.equal(fontLabel('playfair-display'), 'Playfair Display')
  assert.equal(fontLabel(SYSTEM_FONTS[1].id), SYSTEM_FONTS[1].label)
})
