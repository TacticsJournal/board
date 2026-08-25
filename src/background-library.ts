/**
 * The browser half of the background library: the one store instance, the
 * image work that needs a canvas, and the move from the two old single-image
 * slots to the shelf.
 *
 * backgrounds.ts holds the storage and the rules and stays free of the DOM.
 * This is where the app plugs that into the pitch picker: every saved
 * background is published to pitches.ts as a pitch style, so the scene, the
 * board, the export and the picker all treat it as one.
 */
import {
  MAX_EDGE, THUMB_EDGE, browserDriver, createBackgroundStore, fitSize, localStorageMirror,
  memoryDriver, memoryMirror,
  type BackgroundKind, type BackgroundMeta, type BackgroundStore, type NewBackground,
} from './backgrounds.ts'
import { LIVE_BG_KEY, setCustomPitches, type PitchStyle } from './pitches.ts'

/** A browser that refuses IndexedDB (some private modes) still gets a session shelf. */
function store(): BackgroundStore {
  try {
    if (typeof indexedDB !== 'undefined') {
      return createBackgroundStore(browserDriver(), localStorageMirror())
    }
  } catch { /* blocked; fall through */ }
  return createBackgroundStore(memoryDriver(), memoryMirror())
}

export const backgrounds: BackgroundStore = store()

function toStyle(meta: BackgroundMeta): PitchStyle {
  const broadcast = meta.kind === 'broadcast'
  return {
    id: meta.id,
    label: meta.name,
    src: '',
    boardH: meta.boardH,
    // Two lanes, because the two kinds are drawn on with different pieces:
    // swapping the art under your icons stays free, while crossing between a
    // pitch and a camera frame asks, the way our own styles do.
    category: broadcast ? 'live' : 'custom',
    sides: 1,
    pro: true,
    // A broadcast behaves the way an imported screenshot always has: single
    // live players, a flip, light arrows, no team overlay. A pitch is drawn on
    // like our own art.
    live: broadcast,
    custom: true,
  }
}

function publish() {
  setCustomPitches(backgrounds.list().map(toStyle))
}

publish()
backgrounds.subscribe(publish)

/** Read the database, then republish: the picker fills in as soon as it lands. */
export function loadBackgrounds(): Promise<void> {
  return backgrounds.load()
}

/* ---------- image work ---------- */

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('image decode failed'))
    img.src = src
  })
}

function encode(img: HTMLImageElement, edge: number, quality: number): string {
  const size = fitSize(img.naturalWidth, img.naturalHeight, edge)
  const canvas = document.createElement('canvas')
  canvas.width = size.w
  canvas.height = size.h
  canvas.getContext('2d')!.drawImage(img, 0, 0, size.w, size.h)
  return canvas.toDataURL('image/jpeg', quality)
}

/** A decoded image, downscaled once for the board and once for its tile. */
export function prepare(img: HTMLImageElement, name: string, kind: BackgroundKind): NewBackground {
  return {
    name,
    kind,
    full: encode(img, MAX_EDGE, 0.85),
    thumb: encode(img, THUMB_EDGE, 0.7),
    w: img.naturalWidth,
    h: img.naturalHeight,
  }
}

/** A file the user picked, saved to the shelf under a name taken from it. */
export async function addBackgroundFromFile(file: File, kind: BackgroundKind, name?: string): Promise<BackgroundMeta> {
  const url = URL.createObjectURL(file)
  try {
    const img = await loadImage(url)
    return await backgrounds.add(prepare(img, name ?? nameFromFile(file.name), kind))
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** An image already decoded elsewhere, such as an imported screenshot. */
export function addBackgroundFromImage(img: HTMLImageElement, name: string, kind: BackgroundKind): Promise<BackgroundMeta> {
  return backgrounds.add(prepare(img, name, kind))
}

export function nameFromFile(fileName: string): string {
  const base = fileName.replace(/\.[a-z0-9]{1,5}$/i, '').replace(/[_-]+/g, ' ').trim()
  return base || 'Background'
}

/* ---------- the old single slots ---------- */

/** The one custom background the board used to hold. */
const LEGACY_BG_KEY = 'tbm-bg-v1'
const MIGRATED_KEY = 'tbm-bg-migrated-v1'

function readKey(key: string): string | null {
  try { return localStorage.getItem(key) } catch { return null }
}

/**
 * Move what the two old slots held onto the shelf, once.
 *
 * The uploaded background is taken over entirely: it was one image applied on
 * top of every board, which is the thing the shelf replaces, so its key is
 * cleared afterwards. The screenshot key is left where it is, because boards
 * saved on the `live` pitch still draw from it.
 *
 * Returns the background the current board should switch to, if the old
 * upload was the thing being shown.
 */
export async function migrateLegacyBackgrounds(): Promise<BackgroundMeta | null> {
  if (readKey(MIGRATED_KEY)) return null
  let switchTo: BackgroundMeta | null = null
  const legacy = readKey(LEGACY_BG_KEY)
  if (legacy?.startsWith('data:image/')) {
    try {
      // The old upload sat under the board's own pitch tools, so it is a pitch.
      switchTo = await addBackgroundFromImage(await loadImage(legacy), 'Saved background', 'pitch')
      try { localStorage.removeItem(LEGACY_BG_KEY) } catch { /* private mode */ }
    } catch { /* undecodable; leave the key alone */ }
  }
  const shot = readKey(LIVE_BG_KEY)
  if (shot?.startsWith('data:image/')) {
    try { await addBackgroundFromImage(await loadImage(shot), 'Broadcast screenshot', 'broadcast') } catch { /* ignore */ }
  }
  try { localStorage.setItem(MIGRATED_KEY, '1') } catch { /* private mode: it runs again next time */ }
  return switchTo
}
