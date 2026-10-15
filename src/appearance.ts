/* How a board is drawn: the type it uses, and how every piece on it is
 * finished. This is not a device preference. It is part of the board, so a
 * board styled here looks the same to whoever opens it, in the editor, in an
 * export, and on a thumbnail.
 *
 * Styling a board is free, like every other local edit. What Pro buys is
 * carrying it off this device: the appearance rides on the scene, and a board
 * only syncs with Pro. Nothing that draws asks an entitlement question, so a
 * shared board reaches whoever opens it looking as its author left it.
 *
 * One thing is not here: the pitch. A pitch is an image rather than a set of
 * values, so a pitch someone makes their own is a background in the library
 * beside their screenshots, not a property on the scene. Everything drawn over
 * it is here.
 *
 * Every property is declared once, in SPEC, and read, clamped, written and
 * compared by the same code. Adding one is a line. */

/* Type lives in its own module: a family is a file to fetch, keep and embed in
 * an export, which is more than a value. Re-exported here so everything that
 * draws still asks appearance for the stack it should use. */
export { BUNDLED_FONTS, DEFAULT_BOARD_FONT, SYSTEM_FONTS, fontLabel, fontStack, isFontId } from './fonts.ts'
import { isFontId, isSystemFont } from './fonts.ts'

/**
 * A colour the board used to work out for itself. `auto` keeps that rule - a
 * number flips black or white against the kit under it, a halo takes whichever
 * of black and white the letters are not - so a board nobody has styled looks
 * exactly as it always did.
 */
export const AUTO = 'auto'

type Spec =
  /* `step` is what one nudge moves, and it belongs to the property rather than
     to its range: an angle wants degrees, a ring wants hundredths. Derived from
     min and max it was wrong at both ends - a shadow angle took seventy taps to
     go round, and a zone border could only ever land on four of its values. */
  | { kind: 'number'; min: number; max: number; step: number; def: number }
  | { kind: 'color'; def: string }
  | { kind: 'autoColor'; def: typeof AUTO }
  | { kind: 'enum'; values: readonly string[]; def: string }
  /* A family is not an enum: the list it comes from is two thousand long and
     loaded on demand, so what is stored is checked for shape rather than for
     membership. An id we cannot draw falls back at paint time, not here, which
     is what lets a board keep a family this device has not fetched yet. */
  | { kind: 'font'; def: string }

/**
 * Every property a board's appearance has, in the order the screens show them.
 * The key is a dotted path; the group in front of the dot is the piece it
 * belongs to, which is also how the editor is divided.
 */
export const SPEC = {
  'font': { kind: 'font', def: 'default' },
  'tracking': { kind: 'number', min: -3, max: 12, step: 0.25, def: 0 },

  /* The token: its ring, and the shadow it throws. */
  'player.outline': { kind: 'number', min: 0, max: 1.2, step: 0.02, def: 0.38 },
  'player.outlineColor': { kind: 'color', def: '#0b0b0e' },
  'player.shadow': { kind: 'number', min: 0, max: 6, step: 0.25, def: 1 },
  'player.shadowColor': { kind: 'color', def: '#000000' },
  'player.shadowAngle': { kind: 'number', min: 0, max: 360, step: 8, def: 56 },

  /* The lettering on and under a player. */
  'player.numberColor': { kind: 'autoColor', def: AUTO },
  'player.nameColor': { kind: 'color', def: '#111827' },
  'player.nameWeight': { kind: 'enum', values: ['normal', 'bold'], def: 'bold' },
  'player.nameHalo': { kind: 'number', min: 0, max: 10, step: 0.5, def: 0 },
  'player.nameHaloColor': { kind: 'autoColor', def: AUTO },

  /* Live-pitch markers carry a name the same way a player does. */
  'marker.nameColor': { kind: 'color', def: '#ffffff' },
  'marker.nameHalo': { kind: 'number', min: 0, max: 10, step: 0.5, def: 4 },
  'marker.nameHaloColor': { kind: 'color', def: '#000000' },

  'arrow.shadow': { kind: 'number', min: 0, max: 6, step: 0.25, def: 0 },
  'arrow.head': { kind: 'number', min: 0.3, max: 3, step: 0.05, def: 1 },
  'arrow.opacity': { kind: 'number', min: 0.1, max: 1, step: 0.05, def: 1 },

  'zone.border': { kind: 'number', min: 0, max: 16, step: 0.5, def: 0 },
  'zone.borderStyle': { kind: 'enum', values: ['solid', 'dashed'], def: 'solid' },
  'zone.borderColor': { kind: 'autoColor', def: AUTO },
  'zone.labelColor': { kind: 'autoColor', def: AUTO },

  'text.halo': { kind: 'number', min: 0, max: 12, step: 0.5, def: 0 },
  'text.haloColor': { kind: 'autoColor', def: AUTO },
} as const satisfies Record<string, Spec>

export type AppearanceKey = keyof typeof SPEC

export const APPEARANCE_KEYS = Object.keys(SPEC) as AppearanceKey[]

/** The pieces the editor is divided into, in the order it shows them. */
export type AppearanceGroup = 'type' | 'player' | 'marker' | 'arrow' | 'zone' | 'text'

export function appearanceGroup(key: AppearanceKey): AppearanceGroup {
  const dot = key.indexOf('.')
  return (dot < 0 ? 'type' : key.slice(0, dot)) as AppearanceGroup
}

export function keysInGroup(group: AppearanceGroup): AppearanceKey[] {
  return APPEARANCE_KEYS.filter(key => appearanceGroup(key) === group)
}

export function appearanceSpec(key: AppearanceKey): Spec { return SPEC[key] as Spec }

/** A stored appearance: a sparse tree holding only what differs from default. */
export type BoardAppearance = Record<string, any>

/** Every property filled in, which is what everything that draws reads. */
export type ResolvedAppearance = Record<AppearanceKey, string | number>

/**
 * Read one property from either shape an appearance comes in: the nested tree
 * a board is saved as, or the flat dotted record `resolveAppearance` returns.
 * Taking both means a resolved look can be handed straight back in.
 */
function readPath(tree: any, key: string): unknown {
  if (!tree || typeof tree !== 'object') return undefined
  if (Object.prototype.hasOwnProperty.call(tree, key)) return tree[key]
  let at = tree
  for (const part of key.split('.')) {
    if (!at || typeof at !== 'object') return undefined
    at = at[part]
  }
  return at
}

function writePath(tree: any, key: string, value: unknown): void {
  const parts = key.split('.')
  let at = tree
  for (let i = 0; i < parts.length - 1; i++) {
    if (!at[parts[i]] || typeof at[parts[i]] !== 'object') at[parts[i]] = {}
    at = at[parts[i]]
  }
  at[parts[parts.length - 1]] = value
}

function hex(value: unknown): string | null {
  const m = typeof value === 'string' ? /^#?([0-9a-f]{6})$/i.exec(value.trim()) : null
  return m ? `#${m[1].toLowerCase()}` : null
}

/** One stored value read back as something safe to draw with. */
export function coerce(key: AppearanceKey, value: unknown): string | number {
  const spec = appearanceSpec(key)
  if (spec.kind === 'number') {
    const n = typeof value === 'number' ? value : Number(value)
    if (!Number.isFinite(n)) return spec.def
    return Math.min(spec.max, Math.max(spec.min, n))
  }
  if (spec.kind === 'color') return hex(value) ?? spec.def
  if (spec.kind === 'autoColor') return value === AUTO ? AUTO : (hex(value) ?? spec.def)
  if (spec.kind === 'font') {
    return typeof value === 'string' && (isSystemFont(value) || isFontId(value)) ? value : spec.def
  }
  return spec.values.includes(value as string) ? (value as string) : spec.def
}

export function appearanceDefault(key: AppearanceKey): string | number {
  return appearanceSpec(key).def
}

/**
 * A board's appearance filled in from the defaults, so nothing that draws has
 * to know which fields an older save happened to carry.
 */
export function resolveAppearance(appearance: BoardAppearance | undefined): ResolvedAppearance {
  const out = {} as ResolvedAppearance
  for (const key of APPEARANCE_KEYS) {
    const stored = appearance ? readPath(appearance, key) : undefined
    out[key] = stored === undefined || stored === null ? appearanceDefault(key) : coerce(key, stored)
  }
  return out
}

/** True when this board is drawn exactly as the board ships. */
export function isDefaultAppearance(appearance: BoardAppearance | undefined): boolean {
  const look = resolveAppearance(appearance)
  return APPEARANCE_KEYS.every(key => look[key] === appearanceDefault(key))
}

/**
 * Read what a save carries, keeping only properties this build knows and only
 * where they differ from the default. An appearance that says nothing is
 * dropped, so a board nobody has styled carries no appearance at all.
 */
export function normalizeAppearance(raw: unknown): BoardAppearance | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const look = resolveAppearance(raw as BoardAppearance)
  const out: BoardAppearance = {}
  let any = false
  for (const key of APPEARANCE_KEYS) {
    if (look[key] === appearanceDefault(key)) continue
    writePath(out, key, look[key])
    any = true
  }
  return any ? out : undefined
}

/** The same appearance with one property set, kept minimal. */
export function withAppearance(
  appearance: BoardAppearance | undefined,
  key: AppearanceKey,
  value: string | number,
): BoardAppearance | undefined {
  const look = resolveAppearance(appearance)
  look[key] = coerce(key, value)
  return normalizeAppearance(look)
}

/* ---------- the rules `auto` keeps ---------- */

/** White, or near enough that ink on it needs to be dark. */
export function isLightHex(value: string): boolean {
  const m = /^#?([0-9a-f]{6})$/i.exec(value)
  if (!m) return false
  const n = parseInt(m[1], 16)
  return (0.299 * (n >> 16 & 255) + 0.587 * (n >> 8 & 255) + 0.114 * (n & 255)) / 255 > 0.62
}

/**
 * Resolve a colour that may be `auto` against the thing it sits on. This is
 * where the board's old automatic behaviour lives, so keeping `auto` keeps it.
 */
export function inkOn(value: string | number, under: string): string {
  return value === AUTO ? (isLightHex(under) ? '#111827' : '#ffffff') : String(value)
}

/** A halo is whichever of black and white the letters are not. */
export function haloAgainst(value: string | number, letters: string): string {
  return value === AUTO ? (isLightHex(letters) ? '#111827' : '#ffffff') : String(value)
}

/** A colour that follows the piece it belongs to unless it has been set. */
export function orOwn(value: string | number, own: string): string {
  return value === AUTO ? own : String(value)
}

/**
 * What one object is drawn with: its own override where it has set one, and
 * the board's own setting everywhere else. Players are not here on purpose -
 * a squad is styled as a squad, so their look only ever comes from the board.
 */
export function objectAppearance<T>(own: T | undefined, board: T): T {
  return own === undefined || own === null ? board : own
}
