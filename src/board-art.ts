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
export const livePlayerSrc = new URL('../assets/icons/live/live_player.png', import.meta.url).href

/** The live art sheet is square, and every piece of it is a window into it. */
export const LIVE_ART_SHEET = 4096
/** The window the marker's player is cut from, in the sheet's own pixels. */
export const LIVE_PLAYER_CROP = { x: 752, y: 1486, width: 2844, height: 1563 }
/** marker art aspect (cropped): height / width */
export const MARKER_ASPECT = LIVE_PLAYER_CROP.height / LIVE_PLAYER_CROP.width
/**
 * The ground ellipse inside the live-player crop, as fractions of that crop.
 * The art carries a soft drop shadow well past the ellipse and off to one
 * side, so the crop's own centre is neither where the ellipse looks like it
 * sits nor how big it looks. Everything that has to line up with the ellipse
 * — the anchor, the tap target, the selection box, the name — measures here.
 */
export const LIVE_MARKER_ELLIPSE = {
  cx: 1300 / 2844,
  cy: 561 / 1563,
  rx: 1013 / 2844,
  ry: 314.5 / 1563,
}

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

// A dotted shaft draws fatter than the line it replaces, so the dots keep their
// weight on the page. On grass that is the heavy dot the board has always
// drawn. Over video it is not: a broadcast dot has to stay near the fine line
// it belongs to, or the path reads as a row of balls rather than a pass.
export const ARROW_DOT_SCALE = 1.8
export const ARROW_DOT_SCALE_LIVE = 1.3
export const ARROW_DOT_MIN = 7
/** The width a shaft is stroked at: the arrow's own width, unless it is dotted. */
export function arrowShaftWidth(width: number, dash: string | undefined, live = false): number {
  if (dash !== 'dotted') return width
  return live ? width * ARROW_DOT_SCALE_LIVE : Math.max(width * ARROW_DOT_SCALE, ARROW_DOT_MIN)
}
/** Gap between dot centres, as a multiple of the dot itself. */
export const ARROW_DOT_GAP = 2.1

// The head belongs to the dots it ends, not to the line the dots replaced. On
// grass a dotted head is about 1.75 dots wide and always has been. Over video
// the dot came down to 1.3 of the line, so a full head would sit over the path
// like a spearhead; halving it puts the broadcast head back at that same 1.75
// dots. Solid and dashed arrows, and every drawn-pitch arrow, are untouched.
export const ARROW_DOT_HEAD_SCALE_LIVE = 0.5
/** The size a head is drawn at: the width's head, unless it ends broadcast dots. */
export function arrowRenderedHeadSize(width: number, dash: string | undefined, live = false): number {
  const head = arrowHeadSize(width, live)
  return live && dash === 'dotted' ? head * ARROW_DOT_HEAD_SCALE_LIVE : head
}
