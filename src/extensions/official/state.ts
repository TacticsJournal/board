/* Official extension activation is a device preference. It never enters a
 * board document, export, sync payload, or shared scene. */

export const OFFICIAL_EXTENSIONS_KEY = 'tbm-official-extensions-v1'

export type OfficialExtensionState = {
  version: 1
  enabled: string[]
}

const plainObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)

/** Keep only ids this build actually ships, once each, in registry order. */
export function normalizeOfficialExtensionState(raw: unknown, known: readonly string[]): OfficialExtensionState {
  const input = plainObject(raw) ? raw : {}
  const wanted = new Set((Array.isArray(input.enabled) ? input.enabled : []).filter(id => typeof id === 'string'))
  return { version: 1, enabled: known.filter(id => wanted.has(id)) }
}

export function defaultOfficialExtensionState(known: readonly string[]): OfficialExtensionState {
  return { version: 1, enabled: [...known] }
}

export function isOfficialExtensionEnabled(state: OfficialExtensionState, id: string): boolean {
  return state.enabled.includes(id)
}

export function setOfficialExtensionEnabled(state: OfficialExtensionState, id: string, enabled: boolean, known: readonly string[]): OfficialExtensionState {
  if (!known.includes(id)) return state
  const next = new Set(state.enabled)
  if (enabled) next.add(id)
  else next.delete(id)
  return { version: 1, enabled: known.filter(item => next.has(item)) }
}

/** An absent key is a first-run device, so bundled extensions start enabled. */
export function loadOfficialExtensionState(known: readonly string[], storage: Storage | null = safeStorage()): OfficialExtensionState {
  try {
    const stored = storage?.getItem(OFFICIAL_EXTENSIONS_KEY)
    if (stored === null || stored === undefined) return defaultOfficialExtensionState(known)
    return normalizeOfficialExtensionState(JSON.parse(stored), known)
  } catch {
    return normalizeOfficialExtensionState(null, known)
  }
}

export function saveOfficialExtensionState(state: OfficialExtensionState, known: readonly string[], storage: Storage | null = safeStorage()): boolean {
  try {
    if (!storage) return false
    storage.setItem(OFFICIAL_EXTENSIONS_KEY, JSON.stringify(normalizeOfficialExtensionState(state, known)))
    return true
  } catch {
    return false
  }
}

function safeStorage(): Storage | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage } catch { return null }
}
