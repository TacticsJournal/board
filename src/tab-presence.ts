/**
 * Notice when the same board is open in another tab of this browser.
 *
 * Tabs share one sync device, so the collaboration room counts them as a single
 * editor and relays nothing between them: each only sees the other's edits once
 * they are saved. Rather than let that look like broken live editing, the tabs
 * find each other here and the page asks the person to close one.
 *
 * Nothing leaves the browser. Each tab announces its board on a
 * BroadcastChannel; a tab showing the same board answers, and a closing tab
 * says goodbye. No DOM here, so the protocol can be tested with a fake channel.
 */

export const TAB_CHANNEL = 'tbm-board-tabs-v1'

export type TabMessage =
  | { type: 'open'; tab: string; board: string | null }
  | { type: 'here'; tab: string; board: string | null }
  | { type: 'gone'; tab: string }

export type TabChannel = {
  postMessage(message: TabMessage): void
  onmessage: ((event: { data: unknown }) => void) | null
  close(): void
}

export type TabPresenceOptions = {
  tabId: string
  /** True when another tab has this tab's board open, false once none does. */
  onChange: (duplicate: boolean) => void
  channel?: TabChannel | null
}

export type TabPresence = {
  /** This tab is now showing a board (or none). Repeating the same board is free. */
  setBoard(board: string | null): void
  /**
   * The page is being hidden or unloaded: tell the others. A page restored
   * from the back/forward cache calls setBoard again to rejoin.
   */
  leave(): void
  readonly duplicate: boolean
}

function parse(value: unknown): TabMessage | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  if (typeof raw.tab !== 'string' || raw.tab.length === 0 || raw.tab.length > 80) return null
  if (raw.type === 'gone') return { type: 'gone', tab: raw.tab }
  if (raw.type !== 'open' && raw.type !== 'here') return null
  if (raw.board !== null && (typeof raw.board !== 'string' || raw.board.length > 160)) return null
  return { type: raw.type, tab: raw.tab, board: raw.board as string | null }
}

function defaultChannel(): TabChannel | null {
  try {
    return typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(TAB_CHANNEL) as unknown as TabChannel
  } catch { return null }
}

export function createTabPresence(options: TabPresenceOptions): TabPresence {
  const channel = options.channel === undefined ? defaultChannel() : options.channel
  const peers = new Map<string, string | null>()
  let board: string | null = null
  let duplicate = false
  let joined = false
  const post = (message: TabMessage) => {
    if (!channel) return
    try { channel.postMessage(message) } catch { /* the other tabs just miss one update */ }
  }
  const recompute = () => {
    const next = board !== null && [...peers.values()].some(peer => peer === board)
    if (next === duplicate) return
    duplicate = next
    options.onChange(next)
  }

  if (channel) {
    channel.onmessage = (event) => {
      const message = parse(event.data)
      if (!message || message.tab === options.tabId) return
      if (message.type === 'gone') peers.delete(message.tab)
      else {
        peers.set(message.tab, message.board)
        // Answer an announcement so a newly opened tab learns about this one.
        // An answer is never answered, so two tabs cannot ping-pong.
        if (message.type === 'open') post({ type: 'here', tab: options.tabId, board })
      }
      recompute()
    }
  }

  return {
    setBoard(next) {
      if (joined && next === board) return
      joined = true
      board = next
      post({ type: 'open', tab: options.tabId, board })
      recompute()
    },
    leave() {
      joined = false
      post({ type: 'gone', tab: options.tabId })
      // While away this tab cannot hear a peer leave, so forget them all;
      // rejoining re-learns whoever is still open.
      peers.clear()
      recompute()
    },
    get duplicate() { return duplicate },
  }
}
