import type { PitchStyle } from './pitches'

/**
 * Board is free. There are no accounts, plans, purchases, or trials, and every
 * browser-local editing and export feature is available to everyone.
 *
 * The one exception is the Classic pitch, which is reserved for the Board
 * admin. Board has no accounts to identify an admin with, so it is offered only
 * in a trusted build context: a development build or a Cloudflare Pages preview
 * hostname. Browser-controlled inputs (localStorage, query parameters, cached
 * values) never grant it.
 */
const CLOUDFLARE_PREVIEW_HOST = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.tactics-board-mapper\.pages\.dev$/

export type EntitlementEnvironment = Readonly<{
  development: boolean
  hostname: string
}>

/** True for a development build or a Cloudflare Pages preview hostname. */
export function isTrustedBuildEnvironment(environment: EntitlementEnvironment): boolean {
  if (environment.development) return true
  return CLOUDFLARE_PREVIEW_HOST.test(environment.hostname)
}

/**
 * The trusted build/deployment context, read defensively. Outside a browser
 * bundle there is no `import.meta.env` and no `location`, and an unknown context
 * grants nothing.
 */
function trustedBuildContext(): boolean {
  try {
    return isTrustedBuildEnvironment({
      development: import.meta.env.DEV,
      hostname: location.hostname,
    })
  } catch {
    return false
  }
}

/** True on a development or preview build. */
export function isTrustedPreviewBuild(): boolean {
  return trustedBuildContext()
}

/** The Classic pitch is admin-only, and only a trusted build context is an admin. */
export function hasBoardAdminAccess(): boolean {
  return trustedBuildContext()
}

// Every browser-local editor and export capability is free.
export function canImport(): boolean { return true }
export function canPlaceCone(): boolean { return true }
export function canUploadBackground(): boolean { return true }
export function canExportAnimation(): boolean { return true }

export function canPickPitch(style: PitchStyle): boolean {
  return !style.adminOnly || hasBoardAdminAccess()
}
