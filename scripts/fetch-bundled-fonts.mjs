/**
 * Download the bundled families into `public/fonts/`.
 *
 * These sixteen are the only fonts the board ships. They are served from our
 * own origin so they work offline, in a self-hosted build, and behind a
 * network that cannot reach a CDN. Every other family in the catalogue is
 * fetched on the tap that chooses it.
 *
 *   node scripts/fetch-bundled-fonts.mjs
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { BUNDLED_FONTS, fontFileName, fontCdnUrl } from '../src/fonts-shared.mjs'

const DIR = new URL('../public/fonts/', import.meta.url)
await mkdir(DIR, { recursive: true })

let bytes = 0
for (const font of BUNDLED_FONTS) {
  for (const weight of [font.regular ?? 400, font.bold ?? 700]) {
    const name = fontFileName(font.id, weight)
    const res = await fetch(fontCdnUrl(font.id, weight))
    if (!res.ok) throw new Error(`${name}: ${res.status}`)
    const buf = Buffer.from(await res.arrayBuffer())
    await writeFile(new URL(name, DIR), buf)
    bytes += buf.length
    console.log(`${name} ${buf.length}`)
  }
}
console.log(`${Math.round(bytes / 1024)}KB total`)
