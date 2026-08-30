import { BOARD_SELF_HOSTED } from './build-mode.ts'
import { hasBoardLicense, isPro } from './entitlements.ts'

export type ProductPlan = 'self_hosted' | 'pro' | 'license' | 'free'

export type BoardExportFormat = 'png' | 'gif' | 'video'

export type PaidGateFeature =
  | 'screenshot_import'
  | 'gif_export'
  | 'video_export'
  | 'pitch'
  | 'cone'
  | 'custom_asset'
  | 'custom_background'
  | 'unlimited_boards'
  | 'sync'
  | 'collaboration'
  | 'agent'

export type TrialFeature = 'screenshot_import' | 'gif_export'

export type CheckoutPlan = 'license' | 'pro_monthly' | 'pro_yearly'

export type FreeBackupSource = 'fourth_save' | 'settings'

export type ProductEventName =
  | 'editor_opened'
  | 'board_exported'
  | 'paid_gate_hit'
  | 'pricing_opened'
  | 'checkout_opened'
  | 'trial_used'
  | 'free_backup_prompted'
  | 'free_backup_enabled'

export type ProductEventDetail = BoardExportFormat | PaidGateFeature | TrialFeature | CheckoutPlan | FreeBackupSource | ''

export function resolveProductPlan(): ProductPlan {
  if (BOARD_SELF_HOSTED) return 'self_hosted'
  if (isPro()) return 'pro'
  if (hasBoardLicense()) return 'license'
  return 'free'
}

export async function recordProductEvent(
  event: ProductEventName,
  detail: ProductEventDetail = '',
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  try {
    await fetchImpl('/api/board/events', {
      method: 'POST',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event, detail, plan: resolveProductPlan() }),
    })
  } catch {
    // Best-effort telemetry must never disturb the caller.
  }
}
