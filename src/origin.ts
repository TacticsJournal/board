/**
 * Where the board talks to Tactics Journal.
 *
 * The board is a separate site. Its board APIs stay on the current Board host;
 * only account, entitlement, and checkout calls cross to Tactics Journal. That
 * account origin was once hardcoded in several places, which made a preview
 * build untestable. It read production's session and sent buyers to production's
 * checkout, so a sandbox purchase could never be seen from a preview board.
 *
 * A preview build points at the billing sandbox instead. Production is the
 * default and the fallback: an unrecognised host, or any failure reading the
 * build context, resolves to the real site rather than to a sandbox that would
 * quietly show the wrong entitlements.
 */

const PRODUCTION = 'https://tacticsjournal.com'
const SANDBOX = 'https://billing-sandbox.tacticsjournal.pages.dev'

const PREVIEW_HOST = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.tactics-board-mapper\.pages\.dev$/

export function tacticsJournalOrigin(hostname: string, development = false): string {
  // The canonical Board host always uses real accounts and live Polar billing,
  // even if a build flag is accidentally carried into its deployment.
  if (hostname === 'board.tacticsjournal.com') return PRODUCTION
  return development || PREVIEW_HOST.test(hostname) ? SANDBOX : PRODUCTION
}

function currentHostname(): string {
  try { return location.hostname } catch { return '' }
}

/** The Tactics Journal origin this build should use. Resolved once. */
export const TJ_ORIGIN = tacticsJournalOrigin(currentHostname(), import.meta.env?.DEV === true)

/** True when the board is pointed at the billing sandbox rather than the site. */
export function usingBillingSandbox(): boolean {
  return TJ_ORIGIN === SANDBOX
}
