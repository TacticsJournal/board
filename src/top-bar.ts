/* Which controls sit above the board, and in what order. This is a device
 * preference, like the official-extension switches: it never enters a board
 * document, an export, or a sync payload. Someone opening your shared project
 * sees their own bar, not yours. */

export const TOP_BAR_KEY = 'tbm-top-bar-v1'

export type TopBarState = {
  version: 1
  /** Ids in bar order. Ids this build does not know are dropped on load. */
  order: string[]
  /** Ids switched off. Fixed ids are never in here. */
  hidden: string[]
}

/**
 * The bar as it ships. Extension controls are known ids too, but they are not
 * in this list: they arrive switched off and are added from Tool settings, so
 * turning an extension on no longer rearranges the bar on its own.
 */
export const DEFAULT_TOP_BAR: readonly string[] = [
  'snap', 'export', 'previous-board', 'undo', 'redo', 'boards', 'more', 'note',
]

/** The menu is the way back to this screen, so it cannot be switched off. */
export const FIXED_TOP_BAR: readonly string[] = ['more']

/** Controls the board shows or hides for itself; the user never orders these. */
export const UNLISTED_TOP_BAR: readonly string[] = ['live-shot']

const plainObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)

const strings = (value: unknown): string[] =>
  (Array.isArray(value) ? value : []).filter((item): item is string => typeof item === 'string')

export function defaultTopBarState(): TopBarState {
  return { version: 1, order: [...DEFAULT_TOP_BAR], hidden: [] }
}

/**
 * Keep only ids this build ships, once each. Anything known but unlisted goes
 * to the end switched off, which is how a newly installed extension arrives and
 * how a control added in a later release reaches someone with a saved bar.
 */
export function normalizeTopBarState(raw: unknown, known: readonly string[]): TopBarState {
  const input = plainObject(raw) ? raw : {}
  const seen = new Set<string>()
  const order: string[] = []
  for (const id of strings(input.order)) {
    if (!known.includes(id) || seen.has(id)) continue
    seen.add(id)
    order.push(id)
  }
  const hidden = new Set(strings(input.hidden).filter(id => known.includes(id) && !FIXED_TOP_BAR.includes(id)))
  for (const id of known) {
    if (seen.has(id)) continue
    order.push(id)
    // A control the saved bar has never met is off unless it ships on the bar.
    if (!DEFAULT_TOP_BAR.includes(id)) hidden.add(id)
  }
  return { version: 1, order, hidden: order.filter(id => hidden.has(id)) }
}

export function topBarOrder(state: TopBarState): readonly string[] { return state.order }

export function isTopBarVisible(state: TopBarState, id: string): boolean {
  return FIXED_TOP_BAR.includes(id) || !state.hidden.includes(id)
}

export function visibleTopBar(state: TopBarState): string[] {
  return state.order.filter(id => isTopBarVisible(state, id))
}

export function setTopBarVisible(state: TopBarState, id: string, visible: boolean): TopBarState {
  if (!state.order.includes(id) || FIXED_TOP_BAR.includes(id)) return state
  const hidden = new Set(state.hidden)
  if (visible) hidden.delete(id)
  else hidden.add(id)
  return { ...state, hidden: state.order.filter(item => hidden.has(item)) }
}

/** Move one control one place along the bar. Off the ends is a no-op. */
export function moveTopBarItem(state: TopBarState, id: string, delta: -1 | 1): TopBarState {
  const from = state.order.indexOf(id)
  const to = from + delta
  if (from < 0 || to < 0 || to >= state.order.length) return state
  const order = [...state.order]
  order.splice(to, 0, ...order.splice(from, 1))
  return { ...state, order }
}

function safeStorage(): Storage | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage } catch { return null }
}

export function loadTopBarState(known: readonly string[], storage: Storage | null = safeStorage()): TopBarState {
  try {
    const stored = storage?.getItem(TOP_BAR_KEY)
    if (stored === null || stored === undefined) return normalizeTopBarState(defaultTopBarState(), known)
    return normalizeTopBarState(JSON.parse(stored), known)
  } catch {
    return normalizeTopBarState(defaultTopBarState(), known)
  }
}

export function saveTopBarState(state: TopBarState, known: readonly string[], storage: Storage | null = safeStorage()): boolean {
  try {
    if (!storage) return false
    storage.setItem(TOP_BAR_KEY, JSON.stringify(normalizeTopBarState(state, known)))
    return true
  } catch {
    return false
  }
}
