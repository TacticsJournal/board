/**
 * The board's own art, and the proportions it is drawn at.
 *
 * It lives apart from board.ts so that anything drawing a scene can reach the
 * same pictures without pulling Konva in with them: the saved-board thumbnail,
 * the sequence rows and the player all draw the objects the board draws, and a
 * cone has to be the cone wherever it is drawn.
 */
import type { GoalObj } from './types.ts'

export const ballSrc = new URL('../assets/web/ball.png', import.meta.url).href
export const coneSrc = new URL('../assets/web/cone.png', import.meta.url).href
export const goalSmallSrc = new URL('../assets/web/goal-small.png', import.meta.url).href
export const goalFullSrc = new URL('../assets/web/goal-full.png', import.meta.url).href

/** cone art aspect (cropped): height / width */
export const CONE_ASPECT = 154 / 256
/** goal art aspect (cropped): height / width, per variant */
export const GOAL_ASPECT: Record<GoalObj['variant'], number> = { small: 288 / 512, normal: 209 / 512 }

// The head scales with the shaft, so S, M and L differ at the tip as well as
// along the line. Medium is the anchor and always wears a 14 head; what a
// medium shaft measures depends on the pitch. A drawn pitch keeps the heavier
// 4.5 line the board has always drawn on grass; a broadcast still frame keeps
// the finer 3 line that reads over video. Stored per-object headSize is
// ignored so old arrows follow their width.
export const ARROW_HEAD_MEDIUM = 14
export const ARROW_WIDTH_MEDIUM = 4.5
export const ARROW_WIDTH_MEDIUM_LIVE = 3
export function arrowMediumWidth(live: boolean | undefined): number {
  return live ? ARROW_WIDTH_MEDIUM_LIVE : ARROW_WIDTH_MEDIUM
}
export function arrowHeadSize(width: number, live = false): number {
  return (width / arrowMediumWidth(live)) * ARROW_HEAD_MEDIUM
}
