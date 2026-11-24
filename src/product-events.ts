import { BOARD_SELF_HOSTED } from './build-mode.ts'

/**
 * Anonymous aggregate product counters. Each event is one name, one
 * allowlisted scalar detail, and the plan, which is always `free`: Board has
 * no accounts or paid plans. Nothing identifies the visitor, the browser, the
 * page, or the board, and the request carries no cookies or referrer.
 */
export type ProductPlan = 'free'

export type BoardExportFormat = 'png' | 'gif' | 'video'

export type ProductEventName =
  | 'editor_opened'
  | 'board_exported'

export type ProductEventDetail = BoardExportFormat | ''

export const PRODUCT_PLAN: ProductPlan = 'free'

export async function recordProductEvent(
  event: ProductEventName,
  detail: ProductEventDetail = '',
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  // A self-hosted copy is not operated by Tactics Journal and has no counter.
  if (BOARD_SELF_HOSTED) return
  try {
    await fetchImpl('/api/board/events', {
      method: 'POST',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event, detail, plan: PRODUCT_PLAN }),
    })
  } catch {
    // Best-effort telemetry must never disturb the caller.
  }
}
