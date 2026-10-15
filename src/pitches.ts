/**
 * Pitch background styles. The board resizes to each image's aspect:
 * boardH = round(800 * imgH / imgW), so nothing is stretched or cropped.
 * The tacticsjournal.com watermark is baked into the *_marked art; the
 * clean classic pitch is reserved for the board admin account.
 */
/**
 * Where the playing surface sits inside a background, as fractions of the
 * board: x of the board width, y of the style's own boardH. Read off the art
 * by its penalty boxes, six yard boxes and halfway line, then carried out to
 * the goal lines and touchlines, which most of our drawings crop.
 *
 * x holds one span per pitch surface, so the two pitch board can say where
 * each of its pitches is; y is shared, because both are drawn level. A span
 * may fall outside 0 to 1: the surface is where the pitch is, not where the
 * board ends, and a cropped pitch runs off the edge.
 */
export type PitchSpan = { min: number; max: number }
export type PitchSurface = { x: PitchSpan[]; y: PitchSpan }

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
  /** Where the pitch is drawn inside the board. Absent on a screenshot or
      someone's own background, where nobody can know. */
  surface?: PitchSurface
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
  /** built-in sizes for new objects on this pitch */
  defaultSizes?: { player: number; name: number; label: number }
  /** one of the user's own saved backgrounds (backgrounds.ts), not our art */
  custom?: boolean
  /** the id resolves, but the image is not on this device */
  missing?: boolean
  /** kept for old boards, never offered in the picker */
  hidden?: boolean
}

export const PITCHES: PitchStyle[] = [
  { id: 'pitch', label: 'Pitch', src: new URL('../assets/pitch/pitch_marked.jpeg', import.meta.url).href, boardH: 618, pro: false, category: 'pitch', sides: 1, scoreboard: { x: 745, y: 86 }, surface: { x: [{ min: 0.00223, max: 0.99777 }], y: { min: 0.08767, max: 0.90909 } } },
  { id: 'pitch-up', label: 'Vertical', src: new URL('../assets/pitch/pitch_up_marked.jpeg', import.meta.url).href, boardH: 640, pro: false, category: 'vertical', sides: 1, scoreboard: { x: 75, y: 133 }, surface: { x: [{ min: -0.00131, max: 1.00006 }], y: { min: -0.01198, max: 0.93594 } } },
  { id: 'full-pitch', label: 'Full Pitch', src: new URL('../assets/pitch/full_pitch_marked.png', import.meta.url).href, boardH: 1066, pro: false, category: 'fullpitch', sides: 1, scoreboard: { x: 75, y: 133 }, defaultSizes: { player: 15, name: 20, label: 23 }, surface: { x: [{ min: -0.00025, max: 0.999 }], y: { min: -0.00135, max: 1.00041 } } },
  { id: 'training', label: 'Training', src: new URL('../assets/pitch/training_marked.jpeg', import.meta.url).href, boardH: 418, pro: false, category: 'training', sides: 1, scoreboard: { x: 745, y: 86, logo: true }, awayCodeLift: 44, surface: { x: [{ min: 0.05563, max: 0.94312 }], y: { min: 0.11364, max: 0.88636 } } },
  { id: 'sidebyside', label: 'Two pitches', src: new URL('../assets/pitch/sidebyside_marked.jpeg', import.meta.url).href, boardH: 533, pro: false, category: 'sidebyside', sides: 2, scoreboard: { x: 400, y: 95 }, surface: { x: [{ min: 0.03315, max: 0.45372 }, { min: 0.54503, max: 0.9656 }], y: { min: 0.00646, max: 0.99354 } } },
  /* The old single-slot screenshot board. Every screenshot is a saved
     background now, so this is never offered; it stays so boards drawn on it
     keep their art. */
  { id: 'live', label: 'Live', src: '', boardH: 372, pro: false, category: 'live', sides: 1, live: true, hidden: true },
  { id: 'classic', label: 'Classic', src: new URL('../assets/pitch/pitch.jpeg', import.meta.url).href, boardH: 418, pro: true, adminOnly: true, category: 'classic', sides: 1, scoreboard: { x: 745, y: 86, logo: true }, surface: { x: [{ min: 0.00164, max: 0.99649 }], y: { min: -0.1104, max: 1.10203 } } },
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

/**
 * Where each pitch's own lines fall, in board units, measured off the drawing
 * itself. The magnet treats them as snap targets: a back four is placed on the
 * box edge, a striker on the halfway line. A style with no entry - a training
 * grid, a broadcast still, someone's own background - snaps to objects only,
 * because guessing lines onto a photograph would be worse than none.
 */
export type PitchLines = { x: number[]; y: number[] }

const PITCH_LINES: Record<string, PitchLines> = {
  // goal lines, both boxes, both six-yard boxes, halfway; touchlines, box tops
  // and bottoms, six-yard tops and bottoms, and the centre between them
  pitch: {
    x: [42, 125, 155, 401, 645, 673, 758],
    y: [72, 158, 241, 309, 375, 460, 546],
  },
  'pitch-up': {
    x: [161, 295, 400, 510, 637],
    y: [68, 184, 334, 601],
  },
  'full-pitch': {
    x: [163, 292, 400, 508, 637],
    y: [56, 168, 533, 899, 1010],
  },
  sidebyside: {
    x: [96, 150, 240, 295, 401, 504, 560, 650, 705],
    y: [32, 86, 267, 447, 503],
  },
}

/**
 * How a style is laid out, so that anything placed by the app - a formation,
 * the corner codes - knows which way the two goals face. One source of truth:
 * main.ts remaps objects with it and board.ts draws the codes with it.
 *
 * horizontal: goal left, goal right. vertical-half: one attacking half, goal
 * at the top and the halfway line at the bottom. vertical-full: a whole pitch
 * stood up, goal at the top and goal at the bottom. sidebyside: two horizontal
 * pitches next to each other.
 */
export type PitchOrientation = 'horizontal' | 'vertical-half' | 'vertical-full' | 'sidebyside'

export function pitchOrientation(id: string | undefined | null): PitchOrientation {
  if (id === 'pitch-up') return 'vertical-half'
  if (id === 'full-pitch') return 'vertical-full'
  if (id === 'sidebyside') return 'sidebyside'
  return 'horizontal'
}

/** Board width in board units; kept here because types.ts imports this file. */
const BOARD_UNITS_W = 800
const TEAM_CODE_FONT = 24

/**
 * The two corner codes. A board taller than it is wide is fitted to a phone by
 * its height, so its board units come out smaller on screen and the codes grow
 * with the height to stay readable. On a full pitch the two ends are the top
 * and the bottom, so the away code belongs at the far end, not in the other
 * bottom corner where it reads as the same end of the pitch.
 */
export function teamCodeStyle(id: string | undefined | null, boardH: number): { fontSize: number; awayAtTop: boolean } {
  const scale = Math.max(1, (boardH || BOARD_UNITS_W) / BOARD_UNITS_W)
  return {
    fontSize: Math.round(TEAM_CODE_FONT * scale),
    awayAtTop: pitchOrientation(id) === 'vertical-full',
  }
}

export function pitchLines(id: string | undefined | null): PitchLines | null {
  return (id && PITCH_LINES[id]) || null
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

/**
 * The pitch inside a background. A style with no measured surface - a
 * broadcast still, someone's own background - falls back to the whole board,
 * which is the only honest guess when nobody knows where its pitch is.
 */
export const WHOLE_BOARD_SURFACE: PitchSurface = { x: [{ min: 0, max: 1 }], y: { min: 0, max: 1 } }

export function pitchSurface(id: string | undefined | null): PitchSurface {
  return pitchById(id).surface ?? WHOLE_BOARD_SURFACE
}

/**
 * How big the board draws a piece against the size the piece says it is. Two
 * pitches on one board give each of them half the room, so everything drawn on
 * one is drawn at half size; every other style draws a piece as it stands.
 * board.ts and saves.ts draw with this, and the pitch map divides it out when
 * it carries a board over, so a piece arrives the size the pitch asks for
 * rather than half of it.
 */
export function pitchIconScale(id: string | undefined | null): number {
  return (pitchById(id).sides ?? 1) > 1 ? 0.5 : 1
}
