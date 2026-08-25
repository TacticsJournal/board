import { BOARD_SELF_HOSTED } from './build-mode.ts'
import type { PitchStyle } from './pitches'

/**
 * Entitlement resolution. Pro is granted by either:
 *
 * 1. A trusted build/deployment context (development mode or Cloudflare
 *    Pages preview hostnames), OR
 * 2. A server-derived session from tacticsjournal.com confirming the
 *    user holds an active Pro entitlement.
 *
 * Production fails closed: without a server confirmation, the board
 * runs in free mode. Browser-controlled inputs (localStorage, query
 * parameters, cached values) never grant Pro.
 */
const CLOUDFLARE_PREVIEW_HOST = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.tactics-board-mapper\.pages\.dev$/

export type EntitlementEnvironment = Readonly<{
  development: boolean
  hostname: string
}>

/** Resolve Pro from trusted build/deployment context only. */
export function isAutomaticProEnvironment(environment: EntitlementEnvironment): boolean {
  if (environment.development) return true
  return CLOUDFLARE_PREVIEW_HOST.test(environment.hostname)
}

/**
 * Server-derived entitlement state. Updated when the TJ session
 * confirms an active Pro entitlement via the account/session API.
 * Starts false (fail closed) and stays false until the server says
 * otherwise.
 */
let _serverPro = false

/**
 * The one-time Board license, reported by the server as `board_license`. It is a
 * separate product from Pro and never implies it: a license unlocks the paid
 * board features below, while Pro-only features stay closed.
 */
let _serverLicense = false

let _serverBoardAdmin = false

/** Record the admin flag returned by the authenticated server session. */
export function setServerBoardAdmin(boardAdmin: boolean): void {
  _serverBoardAdmin = boardAdmin === true
}

/** The clean Classic pitch belongs only to the server-designated board admin. */
export function hasBoardAdminAccess(): boolean {
  return _serverBoardAdmin
}

/**
 * Called by the auth integration when the server session resolves.
 * Dispatches a change event so the UI can update dynamically.
 *
 * @param pro - true only when the server session confirms active Pro
 * @param license - true only when the server session confirms a Board license
 */
export function setServerEntitlement(pro: boolean, license: boolean = false, boardAdmin: boolean = false): void {
  // Compare the raw server flags, not the resolved getters: resolution reads
  // build context that does not exist outside a browser bundle.
  const wasPro = _serverPro
  const wasLicense = _serverLicense
  const wasBoardAdmin = _serverBoardAdmin
  _serverPro = pro === true
  _serverLicense = license === true
  _serverBoardAdmin = boardAdmin === true
  if (wasPro !== _serverPro || wasLicense !== _serverLicense || wasBoardAdmin !== _serverBoardAdmin) {
    try {
      window.dispatchEvent(new CustomEvent('tbm:entitlements-changed', {
        detail: { pro: isPro(), license: hasBoardLicense(), paid: hasPaidBoardAccess(), board_admin: hasBoardAdminAccess() },
      }))
    } catch { /* SSR or test environment without window */ }
  }
}

/** True when the server has confirmed active Pro for this session. */
export function hasServerEntitlement(): boolean {
  return _serverPro
}

/** Reset server entitlement to fail-closed default. For tests only. */
export function resetServerEntitlement(): void {
  _serverPro = false
  _serverLicense = false
  _serverBoardAdmin = false
}

/**
 * The trusted build/deployment context, read defensively. Outside a browser
 * bundle there is no `import.meta.env` and no `location`, and an unknown context
 * grants nothing.
 */
function buildContextGrantsPro(): boolean {
  try {
    return isAutomaticProEnvironment({
      development: import.meta.env.DEV,
      hostname: location.hostname,
    })
  } catch {
    return false
  }
}

/**
 * Preview-only plan override, for looking at the paid gates without holding a
 * licence. It reads `?plan=free|license|pro|server`, and only where the build
 * context already grants Pro, which is development and Cloudflare preview
 * hosts. On production it returns null and changes nothing, so a query
 * parameter can never grant access. On a preview it can only ever show less
 * than the Pro that host already hands out.
 *
 * `server` is the one to test a purchase with. It drops the automatic grant and
 * reports exactly what the account holds, so the board shows Free before paying
 * and the licence after, which is the whole thing being tested. The other three
 * pin a plan and ignore the account, so a licence bought under them stays
 * invisible.
 */
type PreviewPlan = 'free' | 'license' | 'pro' | 'server'

function previewPlan(): PreviewPlan | null {
  if (!buildContextGrantsPro()) return null
  try {
    const value = new URLSearchParams(location.search).get('plan')
    return value === 'free' || value === 'license' || value === 'pro' || value === 'server' ? value : null
  } catch {
    return null
  }
}

/**
 * True on a development or preview build. Exposed so surfaces that are not yet
 * switched on for everyone can still be reviewed before launch.
 */
export function isTrustedPreviewBuild(): boolean {
  return buildContextGrantsPro()
}

export function isPro(): boolean {
  const preview = previewPlan()
  if (preview === 'server') return _serverPro
  if (preview) return preview === 'pro'
  return buildContextGrantsPro() || _serverPro
}

/** True when the server has confirmed a Board license. */
export function hasBoardLicense(): boolean {
  const preview = previewPlan()
  if (preview === 'server') return _serverLicense
  if (preview) return preview === 'license'
  return _serverLicense
}

/**
 * Paid board features: every pitch style, custom backgrounds, and unlimited
 * saved boards. Either product unlocks them, because Pro includes the licence —
 * buying Pro must never leave a subscriber with less than a licence holder. A
 * trusted build context unlocks them too, so development and preview builds are
 * unaffected.
 *
 * The reverse does not hold: a licence alone never opens Pro-only features.
 */
export function resolvePaidBoardAccess(selfHosted: boolean, pro: boolean, license: boolean): boolean {
  return selfHosted || pro || license
}

export function hasPaidBoardAccess(): boolean {
  return resolvePaidBoardAccess(BOARD_SELF_HOSTED, isPro(), _serverLicense)
}

/**
 * Agent links are created only from the production board after the account
 * service confirms Pro. Preview builds share a billing sandbox, so their
 * automatic Pro grant must never mint a production capability.
 */
export function canCreateAgentLink(): boolean {
  try { return _serverPro && location.hostname === 'board.tacticsjournal.com' }
  catch { return false }
}

/**
 * Importing a broadcast screenshot is a paid feature, not a Pro-only one. The
 * Live board is unlocked by the licence and is useless without its screenshot,
 * so the two must open together.
 *
 * Automatic player detection is a separate, unbuilt thing and is not implied.
 */
export function canImport(): boolean { return hasPaidBoardAccess() }

/**
 * Placing a cone is a paid feature. Existing cones on a saved board always keep
 * rendering, staying editable and exporting: the gate covers placing a new one,
 * never the boards someone already drew.
 */
export function canPlaceCone(): boolean { return hasPaidBoardAccess() }

export function canUploadBackground(): boolean { return hasPaidBoardAccess() }

/**
 * Exporting a project as an animation — a GIF or a video. Both render on this
 * device, so both belong to the licence: the split between the two products is
 * local power against the account, not one file format against another.
 *
 * Free keeps the still image. Animation is what every comparable board charges
 * for, so it sits above the free line from the day it exists rather than being
 * taken back later.
 */
export function canExportAnimation(): boolean { return hasPaidBoardAccess() }

export function canPickPitch(style: PitchStyle): boolean {
  if (style.adminOnly) return hasBoardAdminAccess()
  return !style.pro || hasPaidBoardAccess()
}
