import { TJ_ORIGIN } from './origin.ts'

/** Canonical board APIs stay on the board host, including preview hosts. */
export const BOARD_API = '/api/board'
export const BOARD_SESSION_URL = `${BOARD_API}/session`
export const boardSyncUrl = () => `${BOARD_API}/sync`
export const boardSkillsUrl = () => `${BOARD_API}/skills`
export const boardAssetsUrl = () => `${BOARD_API}/assets`
export const boardLibrariesUrl = () => `${BOARD_API}/libraries`
export const sharedBoardLibraryUrl = (rowId: string, backgroundId: string, invitationToken?: string) =>
  `${boardLibrariesUrl()}?shared_board_id=${encodeURIComponent(rowId)}&id=${encodeURIComponent(backgroundId)}`
    + (invitationToken ? `&invite=${encodeURIComponent(invitationToken)}` : '')
export const boardSharesUrl = () => `${BOARD_API}/shares`
export const boardUserSearchUrl = () => `${BOARD_API}/user-search`
export const boardInvitationsUrl = () => `${BOARD_API}/invitations`
export const boardInvitationUrl = () => `${BOARD_API}/invitation`
export const boardPresenceUrl = () => `${BOARD_API}/presence`
export const boardTransferUrl = () => `${BOARD_API}/transfer`
export const boardAgentLinksUrl = () => `${BOARD_API}/agent-links`
export const boardAgentUrl = () => `${BOARD_API}/agent`
export const boardLiveUrl = () => `${BOARD_API}/live`
export const boardCollaborationUrl = () => `${BOARD_API}/collaboration`
export const boardHistoryUrl = () => `${BOARD_API}/history`

type FetchLike = typeof fetch

type PendingSession = { binding: string | null; promise: Promise<boolean> }

let pendingSession: PendingSession | null = null
let confirmedUntil = 0
let confirmedBinding: string | null = null
let sessionGeneration = 0
const SESSION_CHECK_TTL_MS = 60_000

async function authenticatedBinding(fetchImpl: FetchLike): Promise<string | null | false> {
  try {
    const response = await fetchImpl(BOARD_SESSION_URL, { credentials: 'include' })
    if (!response.ok) return false
    const data = await response.json()
    if (data?.authenticated !== true) return false
    return typeof data.account_binding === 'string' ? data.account_binding : null
  } catch { return false }
}

function bindingMatches(actual: string | null | false, expected: string | null): boolean {
  return actual !== false && (!expected || actual === expected)
}

/** Forget a cached Board-host session when the canonical apex account changes. */
export function resetBoardSession(): void {
  sessionGeneration += 1
  confirmedUntil = 0
  confirmedBinding = null
}

/**
 * Give this board host its host-only account session cookie. The one-time
 * token never leaves this function's stack and concurrent callers share one
 * exchange rather than creating several tokens.
 */
export function ensureBoardSession(
  fetchOrBinding: FetchLike | string | null = fetch,
  requiredBinding: string | null = null,
): Promise<boolean> {
  const fetchImpl = typeof fetchOrBinding === 'function' ? fetchOrBinding : fetch
  const expectedBinding = typeof fetchOrBinding === 'function' ? requiredBinding : fetchOrBinding
  if (Date.now() < confirmedUntil && (!expectedBinding || confirmedBinding === expectedBinding)) return Promise.resolve(true)
  if (pendingSession) {
    if (pendingSession.binding === expectedBinding) return pendingSession.promise
    return pendingSession.promise.then(() => ensureBoardSession(fetchImpl, expectedBinding))
  }

  const generation = sessionGeneration
  const entry: PendingSession = { binding: expectedBinding, promise: Promise.resolve(false) }
  entry.promise = (async () => {
    const existingBinding = await authenticatedBinding(fetchImpl)
    if (bindingMatches(existingBinding, expectedBinding)) {
      if (generation === sessionGeneration) {
        confirmedBinding = existingBinding || expectedBinding
        confirmedUntil = Date.now() + SESSION_CHECK_TTL_MS
      }
      return true
    }
    let created: Response
    try {
      created = await fetchImpl(`${TJ_ORIGIN}/api/account/board-session`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create' }),
      })
    } catch { return false }
    if (!created.ok) return false
    let token: unknown
    try { token = (await created.json())?.token } catch { return false }
    if (typeof token !== 'string' || !token || token.length > 2048) return false
    try {
      const consumed = await fetchImpl(BOARD_SESSION_URL, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      })
      if (!consumed.ok || (await consumed.json())?.authenticated !== true) return false
      const consumedBinding = await authenticatedBinding(fetchImpl)
      const ready = bindingMatches(consumedBinding, expectedBinding)
      if (ready && generation === sessionGeneration) {
        confirmedBinding = consumedBinding || expectedBinding
        confirmedUntil = Date.now() + SESSION_CHECK_TTL_MS
      }
      return ready
    } catch { return false }
  })().finally(() => {
    if (pendingSession === entry) pendingSession = null
  })
  pendingSession = entry
  return entry.promise
}

/** Clear only the board host cookie; account sign-out remains at TJ. */
export async function clearBoardSession(fetchImpl: FetchLike = fetch): Promise<void> {
  resetBoardSession()
  try { await fetchImpl(BOARD_SESSION_URL, { method: 'DELETE', credentials: 'include' }) } catch { /* best effort */ }
}
