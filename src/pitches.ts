/**
 * Pitch background styles. The board resizes to each image's aspect:
 * boardH = round(800 * imgH / imgW), so nothing is stretched or cropped.
 * The tacticsjournal.com watermark is baked into the *_marked art; the
 * clean classic pitch is reserved for the board admin account.
 */
export type PitchCategory = 'classic' | 'pitch' | 'vertical' | 'training' | 'sidebyside' | 'live' | 'custom' | string

export type PitchStyle = {
  id: string
  label: string
  src: string
  boardH: number
  /** Board continuity lane. Variants in the same category share a board; different categories get separate boards. */
  category: PitchCategory
  /** Number of pitch surfaces in the background; mirror duplicates objects onto both sides when this is 2. */
  sides?: 1 | 2
  /** Legacy metadata. Local pitch styles are Free. */
  pro: boolean
  /** clean pitch, shown only to the board admin account */
  adminOnly?: boolean
  /** background is a user-imported broadcast screenshot (localStorage);
      boardH is only the fallback before a screenshot exists */
  live?: boolean
  /** where the date/score/clock column renders (board px, measured from
      the baked tacticsjournal.com mark): x = column center, y = top of
      the first line. logo: no mark there, draw the book + domain above. */
  scoreboard?: { x: number; y: number; logo?: boolean }
  /** raise the away corner code (board px) clear of baked art */
  awayCodeLift?: number
  /** one of the user's own saved backgrounds (backgrounds.ts), not our art */
  custom?: boolean
  /** the id resolves, but the image is not on this device */
  missing?: boolean
  /** kept for old boards, never offered in the picker */
  hidden?: boolean
}

export const PITCHES: PitchStyle[] = [
  { id: 'pitch', label: 'Pitch', src: new URL('../assets/pitch/pitch_marked.jpeg', import.meta.url).href, boardH: 618, pro: false, category: 'pitch', sides: 1, scoreboard: { x: 745, y: 86 } },
  { id: 'pitch-up', label: 'Vertical', src: new URL('../assets/pitch/pitch_up_marked.jpeg', import.meta.url).href, boardH: 640, pro: false, category: 'vertical', sides: 1, scoreboard: { x: 75, y: 133 } },
  { id: 'training', label: 'Training', src: new URL('../assets/pitch/training_marked.jpeg', import.meta.url).href, boardH: 418, pro: false, category: 'training', sides: 1, scoreboard: { x: 745, y: 86, logo: true }, awayCodeLift: 44 },
  { id: 'sidebyside', label: 'Two pitches', src: new URL('../assets/pitch/sidebyside_marked.jpeg', import.meta.url).href, boardH: 533, pro: false, category: 'sidebyside', sides: 2, scoreboard: { x: 400, y: 95 } },
  /* The old single-slot screenshot board. Every screenshot is a saved
     background now, so this is never offered; it stays so boards drawn on it
     keep their art. */
  { id: 'live', label: 'Live', src: '', boardH: 372, pro: false, category: 'live', sides: 1, live: true, hidden: true },
  { id: 'classic', label: 'Classic', src: new URL('../assets/pitch/pitch.jpeg', import.meta.url).href, boardH: 418, pro: true, adminOnly: true, category: 'classic', sides: 1, scoreboard: { x: 745, y: 86, logo: true } },
]

/** Where the imported live screenshot lives (data URL). */
export const LIVE_BG_KEY = 'tbm-live-v1'

export const DEFAULT_PITCH = 'pitch'

/**
 * The user's saved backgrounds, published here by backgrounds.ts so that
 * pitchById stays synchronous. A saved background is a pitch style like any
 * other: the scene stores its id, the board takes its height from the scene,
 * and everything downstream — export, mirroring, the picker — treats it the
 * same as our own art.
 */
let CUSTOM: PitchStyle[] = []
/** A shared background is session data, not a picker item or a personal row. */
let ACTIVE_SHARED: PitchStyle[] = []

export function setCustomPitches(styles: PitchStyle[]): void {
  CUSTOM = styles
}

export function setActiveSharedPitches(styles: PitchStyle[]): void {
  ACTIVE_SHARED = styles.filter(style => style.id.startsWith('bg:'))
}

export function setActiveSharedPitch(style: PitchStyle): void {
  if (!style.id.startsWith('bg:')) return
  ACTIVE_SHARED = [...ACTIVE_SHARED.filter(item => item.id !== style.id), style]
}

export function clearActiveSharedPitches(): void {
  ACTIVE_SHARED = []
}

export function sharedPitchPlaceholder(id: string, boardH = 418): PitchStyle {
  return {
    id, label: 'Shared background', src: '', boardH: Math.max(1, Math.min(32768, boardH)),
    category: 'custom', sides: 1, pro: false, live: true, custom: true, missing: true,
  }
}

export function customPitches(): PitchStyle[] {
  return CUSTOM
}

/** Everything the picker can offer: our art first, then saved backgrounds. */
export function allPitches(): PitchStyle[] {
  return [...PITCHES, ...CUSTOM]
}

/** A background id whose image is not here: a deleted one, or another device's. */
function missingBackground(id: string): PitchStyle {
  return {
    id, label: 'Missing background', src: '', boardH: 418,
    category: 'custom', sides: 1, pro: false, live: true, custom: true, missing: true,
  }
}

export function pitchById(id: string | undefined | null): PitchStyle {
  const shared = ACTIVE_SHARED.find(p => p.id === id)
  if (shared) return shared
  const custom = CUSTOM.find(p => p.id === id)
  if (custom) return custom
  const built = PITCHES.find(p => p.id === id)
  if (built) return built
  // A board drawn on a background keeps its pitch id even where the image is
  // not: losing the id would silently move the board onto our pitch art.
  if (typeof id === 'string' && id.startsWith('bg:')) return missingBackground(id)
  return PITCHES.find(p => p.id === DEFAULT_PITCH)!
}
