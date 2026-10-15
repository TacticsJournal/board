/**
 * The type a board can be set in.
 *
 * Three sources, one shape. A handful of stacks already on the device; sixteen
 * families we ship; and the rest of Google's library, searched from a
 * catalogue that is in the bundle and fetched a file at a time. Whichever it
 * came from, a family ends up as bytes in this module, which is what makes an
 * export work: a thumbnail is an SVG painted into an `<img>`, and an `<img>`
 * cannot see the page's loaded fonts, so the bytes have to travel inside it.
 *
 * A board stores only the id. Someone opening a shared board fetches the same
 * file from the same place, so a board carries its type without carrying a
 * font in every save.
 *
 * Nothing here is gated. Styling a board is a local edit like any other.
 */

import { BOARD_SELF_HOSTED } from './build-mode.ts'
import { BUNDLED_FONTS, fontCdnUrl, fontLocalUrl, isFontId } from './fonts-shared.mjs'

export { BUNDLED_FONTS, isFontId }

export type FontCategory = 'sans-serif' | 'serif' | 'display' | 'handwriting' | 'monospace'

export type FontChoice = {
  id: string
  family: string
  category: string
  /** Present only where the family has no 400 or no 700. */
  regular?: number
  bold?: number
}

/**
 * Families that need no file at all, because every device already has
 * something for them. The first is the board's own default, and it is what
 * anything unknown falls back to, so a board always draws.
 */
export const SYSTEM_FONTS: readonly { id: string; label: string; stack: string }[] = [
  { id: 'default', label: 'Board default', stack: 'Inter, system-ui, sans-serif' },
  { id: 'condensed', label: 'Condensed', stack: '"Arial Narrow", "Roboto Condensed", "Helvetica Neue Condensed", "Liberation Sans Narrow", system-ui, sans-serif' },
  { id: 'humanist', label: 'Humanist', stack: '"Trebuchet MS", "Segoe UI", Optima, system-ui, sans-serif' },
  { id: 'serif', label: 'Serif', stack: 'Georgia, "Times New Roman", "Liberation Serif", serif' },
  { id: 'mono', label: 'Mono', stack: 'ui-monospace, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace' },
]

export const DEFAULT_BOARD_FONT = SYSTEM_FONTS[0].stack

const BUNDLED_BY_ID = new Map<string, FontChoice>((BUNDLED_FONTS as FontChoice[]).map(f => [f.id, f]))

export function isSystemFont(id: string): boolean {
  return SYSTEM_FONTS.some(font => font.id === id)
}

export function isBundledFont(id: string): boolean {
  return BUNDLED_BY_ID.has(id)
}

/**
 * Family names we have learned, so `fontStack` can stay synchronous. A board
 * saved in a searched family knows only its id, and the id is not reliably the
 * family name — `im-fell-english` is not `Im Fell English`. Names are kept
 * across reloads so a board opens in its own type rather than in the fallback
 * for a frame.
 */
const NAMES_KEY = 'tbm-font-names-v1'
const known = new Map<string, FontChoice>(BUNDLED_BY_ID)

function loadKnown(): void {
  try {
    const raw = JSON.parse(localStorage.getItem(NAMES_KEY) || '[]')
    if (!Array.isArray(raw)) return
    for (const row of raw) {
      if (!row || !isFontId(row.i) || typeof row.f !== 'string' || known.has(row.i)) continue
      known.set(row.i, { id: row.i, family: row.f, category: String(row.c || 'sans-serif'), ...(row.r ? { regular: row.r } : {}), ...(row.b ? { bold: row.b } : {}) })
    }
  } catch { /* a browser with no storage still draws, in the fallback */ }
}

function rememberName(font: FontChoice): void {
  if (known.get(font.id)?.family === font.family) return
  known.set(font.id, font)
  try {
    const rows = [...known.values()].filter(f => !BUNDLED_BY_ID.has(f.id))
      .map(f => ({ i: f.id, f: f.family, c: f.category, ...(f.regular ? { r: f.regular } : {}), ...(f.bold ? { b: f.bold } : {}) }))
    localStorage.setItem(NAMES_KEY, JSON.stringify(rows.slice(-200)))
  } catch { /* ignore */ }
}

if (typeof localStorage !== 'undefined') loadKnown()

const GENERIC: Record<string, string> = {
  'serif': 'Georgia, serif',
  'monospace': 'ui-monospace, Menlo, monospace',
  'handwriting': 'cursive',
  'display': 'system-ui, sans-serif',
  'sans-serif': 'system-ui, sans-serif',
}

/**
 * What to set text in, right now. It never waits: a family whose file has not
 * arrived draws in the nearest generic until it has, and the board redraws
 * when it does.
 */
export function fontStack(id: string | undefined): string {
  const system = SYSTEM_FONTS.find(font => font.id === id)
  if (system) return system.stack
  const font = id ? known.get(id) : undefined
  if (!font) return DEFAULT_BOARD_FONT
  return `"${font.family.replace(/"/g, '')}", ${GENERIC[font.category] ?? GENERIC['sans-serif']}`
}

/** The name to show for a family, which is its own name where we know it. */
export function fontLabel(id: string): string {
  return SYSTEM_FONTS.find(font => font.id === id)?.label ?? known.get(id)?.family ?? id
}

/* ---------- the catalogue ---------- */

let catalogue: Promise<FontChoice[]> | null = null

/**
 * Every Google family that can draw latin, loaded on the first search. It is
 * in the bundle rather than behind an API, so search works offline and asks
 * nobody for a key; it is a separate chunk so the board does not pay for it
 * until someone goes looking.
 */
export function allFonts(): Promise<FontChoice[]> {
  if (!catalogue) {
    catalogue = import('./font-catalogue.json').then(mod => {
      const rows = (mod.default ?? mod) as { i: string; f: string; c: string; r?: number; b?: number }[]
      return rows.map(r => ({ id: r.i, family: r.f, category: r.c, ...(r.r ? { regular: r.r } : {}), ...(r.b ? { bold: r.b } : {}) }))
    }).catch(() => [])
  }
  return catalogue
}

/** True where searching can reach anything: a self-hosted build cannot. */
export const FONT_SEARCH_AVAILABLE = !BOARD_SELF_HOSTED

/**
 * Families matching what has been typed. A name is matched from the start of
 * any of its words, so "cond" finds Barlow Condensed and "plex" finds IBM Plex
 * Sans, while "an" does not offer four hundred families containing an A.
 */
export function matchFonts(rows: readonly FontChoice[], query: string, limit = 60): FontChoice[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const out: FontChoice[] = []
  const second: FontChoice[] = []
  for (const font of rows) {
    const name = font.family.toLowerCase()
    if (name.startsWith(q)) out.push(font)
    else if (name.split(/[\s-]+/).some(word => word.startsWith(q))) second.push(font)
    if (out.length >= limit) break
  }
  return [...out, ...second].slice(0, limit)
}

export async function searchFonts(query: string, limit = 60): Promise<FontChoice[]> {
  return matchFonts(await allFonts(), query, limit)
}

/** A family by id, from the catalogue if it is not one we already know. */
export async function lookupFont(id: string): Promise<FontChoice | null> {
  if (!isFontId(id)) return null
  const have = known.get(id)
  if (have) return have
  const found = (await allFonts()).find(font => font.id === id)
  if (found) rememberName(found)
  return found ?? null
}

/* ---------- the bytes ---------- */

/** Where a file is fetched from and kept, so the two sources share one path. */
export type FontDriver = {
  get(key: string): Promise<string | null>
  put(key: string, base64: string): Promise<void>
}

const DB_NAME = 'tbm-fonts'
const DB_STORE = 'files'

export function memoryFontDriver(seed: Record<string, string> = {}): FontDriver {
  const rows = new Map(Object.entries(seed))
  return {
    async get(key) { return rows.get(key) ?? null },
    async put(key, base64) { rows.set(key, base64) },
  }
}

export function browserFontDriver(factory: IDBFactory = indexedDB): FontDriver {
  let connection: Promise<IDBDatabase> | null = null
  function openDb(): Promise<IDBDatabase> {
    if (connection) return connection
    connection = new Promise<IDBDatabase>((resolve, reject) => {
      const request = factory.open(DB_NAME, 1)
      request.onupgradeneeded = () => {
        const db = request.result
        if (!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE)
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    connection.catch(() => { connection = null })
    return connection
  }
  return {
    async get(key) {
      const db = await openDb()
      return new Promise((resolve) => {
        const request = db.transaction(DB_STORE, 'readonly').objectStore(DB_STORE).get(key)
        request.onsuccess = () => resolve(typeof request.result === 'string' ? request.result : null)
        request.onerror = () => resolve(null)
      })
    },
    async put(key, base64) {
      const db = await openDb()
      await new Promise<void>((resolve) => {
        const tx = db.transaction(DB_STORE, 'readwrite')
        tx.objectStore(DB_STORE).put(base64, key)
        tx.oncomplete = () => resolve()
        tx.onerror = () => resolve()
      })
    },
  }
}

let driver: FontDriver | null = null
export function setFontDriver(next: FontDriver | null): void { driver = next }
function fontDriver(): FontDriver {
  if (!driver) driver = typeof indexedDB === 'undefined' ? memoryFontDriver() : browserFontDriver()
  return driver
}

/** Base64 for a loaded face, which is what an export embeds. */
const bytes = new Map<string, string>()
const loading = new Map<string, Promise<boolean>>()

function weightsOf(font: FontChoice): [number, number] {
  return [font.regular ?? 400, font.bold ?? 700]
}

function toBase64(buffer: ArrayBuffer): string {
  const view = new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < view.length; i += 0x8000) {
    binary += String.fromCharCode(...view.subarray(i, i + 0x8000))
  }
  return btoa(binary)
}

function fontUrl(id: string, weight: number): string | null {
  const bundled = isBundledFont(id)
  // A self-hosted build has no CDN to reach, so it only ever has what it ships.
  if (!bundled && BOARD_SELF_HOSTED) return null
  return bundled ? fontLocalUrl(id, weight) : fontCdnUrl(id, weight)
}

/**
 * A face for a picker row: the file, handed to the browser as it arrived.
 *
 * Deliberately none of the keeping. Base64 and a database write are what an
 * export needs, not what a row of a list needs, and doing them for sixty rows
 * put a second of encoding between a file landing and its name being set in
 * it - long enough that a list scrolled past still read in the fallback. The
 * browser's own cache means choosing the family afterwards costs no fetch.
 */
async function loadPreview(id: string, family: string, weight: number): Promise<boolean> {
  const url = fontUrl(id, weight)
  if (!url || typeof FontFace === 'undefined' || typeof document === 'undefined') return false
  try {
    const res = await fetch(url)
    if (!res.ok) return false
    const face = new FontFace(family, await res.arrayBuffer(), { weight: '400' })
    document.fonts.add(await face.load())
    return true
  } catch { return false }
}

async function loadOne(id: string, weight: number): Promise<string | null> {
  const key = `${id}-${weight}`
  const cached = await fontDriver().get(key).catch(() => null)
  if (cached) return cached
  const url = fontUrl(id, weight)
  if (!url) return null
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    const base64 = toBase64(await res.arrayBuffer())
    await fontDriver().put(key, base64).catch(() => {})
    return base64
  } catch { return null }
}

/**
 * Make a family drawable: its file fetched, kept, and registered with the
 * document so canvas and CSS both have it. Called once per family; the second
 * caller waits on the first rather than fetching it again.
 *
 * `preview` is the cheap half, for a row of the picker: the regular weight
 * alone, registered as it arrives and kept by nothing. Choosing the family
 * runs the whole thing, which is what gets the bold and the bytes an export
 * carries.
 */
export function ensureFont(id: string, opts: { preview?: boolean } = {}): Promise<boolean> {
  if (!isFontId(id) || isSystemFont(id)) return Promise.resolve(true)
  const running = loading.get(opts.preview ? `preview:${id}` : id)
  if (running) return running
  const job = (async () => {
    const font = await lookupFont(id)
    if (!font) return false
    rememberName(font)
    const [regular, bold] = weightsOf(font)
    if (opts.preview) return loadPreview(id, font.family, regular)
    const weights = regular === bold ? [regular] : [regular, bold]
    let any = false
    for (const weight of weights) {
      const base64 = await loadOne(id, weight)
      if (!base64) continue
      bytes.set(`${id}-${weight}`, base64)
      any = true
      if (typeof FontFace === 'undefined' || typeof document === 'undefined') continue
      try {
        const face = new FontFace(font.family, `url(data:font/woff2;base64,${base64}) format("woff2")`, {
          weight: String(weight === regular ? 400 : 700),
        })
        document.fonts.add(await face.load())
      } catch { /* the face still exports; it just draws in the fallback here */ }
    }
    return any
  })()
  loading.set(opts.preview ? `preview:${id}` : id, job)
  return job
}

/**
 * The `@font-face` rules an SVG needs to draw in this family. An SVG painted
 * into an `<img>` is its own document with no access to the page, so the file
 * travels with it. Synchronous on purpose: a family being drawn is a family
 * already loaded, and one that is not simply exports in the fallback.
 */
export function fontFaceCss(id: string | undefined): string {
  if (!id || isSystemFont(id)) return ''
  const font = known.get(id)
  if (!font) return ''
  const [regular, bold] = weightsOf(font)
  const family = font.family.replace(/["\\<>&]/g, '')
  const rules: string[] = []
  for (const [weight, css] of [[regular, 400], [bold, 700]] as const) {
    const base64 = bytes.get(`${id}-${weight}`)
    if (!base64) continue
    rules.push(`@font-face{font-family:"${family}";font-weight:${css};font-style:normal;`
      + `src:url(data:font/woff2;base64,${base64}) format("woff2");}`)
  }
  return rules.join('')
}

/** Test seam: pretend a family's bytes have arrived. */
export function primeFont(font: FontChoice, files: Record<number, string>): void {
  rememberName(font)
  for (const [weight, base64] of Object.entries(files)) bytes.set(`${font.id}-${weight}`, base64)
}
