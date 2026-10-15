/**
 * Rebuild `src/font-catalogue.json` from the Fontsource index.
 *
 * The catalogue is committed rather than fetched, so searching for a family
 * works offline, on the first paint, and without an API key. Google's own Web
 * Fonts API wants a key, and a key shipped to a browser is not a key.
 *
 * Only what the picker needs is kept — an id, the name to show, the category
 * to group by, and the two weights the board draws with where they are not the
 * usual 400 and 700. That is about 130KB of JSON, near 22KB over the wire.
 *
 * Run it by hand when the list should be refreshed:
 *   node scripts/build-font-catalogue.mjs
 */
import { writeFile } from 'node:fs/promises'

const SOURCE = 'https://api.fontsource.org/v1/fonts'
const OUT = new URL('../src/font-catalogue.json', import.meta.url)

/** The weight nearest the one we want, so a family without a 700 still bolds. */
function nearest(weights, want) {
  return weights.reduce((best, w) => Math.abs(w - want) < Math.abs(best - want) ? w : best, weights[0])
}

const res = await fetch(SOURCE)
if (!res.ok) throw new Error(`fontsource index: ${res.status}`)
const all = await res.json()

const rows = []
for (const font of all) {
  // Only Google's own families, only those that can draw latin text, and never
  // an icon set: a board's labels are words.
  if (font.type !== 'google') continue
  if (!font.subsets?.includes('latin')) continue
  if (font.category === 'icons') continue
  if (!font.styles?.includes('normal')) continue
  const weights = (font.weights ?? []).slice().sort((a, b) => a - b)
  if (!weights.length) continue
  const regular = nearest(weights, 400)
  const bold = nearest(weights, 700)
  rows.push({
    i: font.id,
    f: font.family,
    c: font.category,
    ...(regular === 400 ? {} : { r: regular }),
    ...(bold === 700 ? {} : { b: bold }),
  })
}
rows.sort((a, b) => a.f.localeCompare(b.f, 'en'))

await writeFile(OUT, JSON.stringify(rows) + '\n')
console.log(`${rows.length} families -> ${new URL(OUT).pathname}`)
