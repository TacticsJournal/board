/* ---------- match stills arriving by paste, drop or pick ----------
   A live board takes its pictures three ways now: the camera button's picker,
   a paste, and a drop. All three end in the same few outcomes, and which one
   is decided from what arrived and what the board already shows, never from
   how it arrived. That decision lives here, away from the DOM, so the rules
   can be read and tested in one place; the screen only gathers the facts and
   carries out the answer. */

/** Just enough of a File to decide with: what it is called and what it is. */
export type IncomingFile = { name?: string; type: string }

/** The only words the intake says, so the screen and the tests agree. */
export const STILL_COPY = {
  nothingToPaste: 'Nothing to paste. Copy a screenshot first.',
  imagesOnly: 'Images only: PNG or JPG',
  added: 'Still added.',
  addedAsBoard: 'Still added as a new board.',
  replaced: 'Still replaced.',
  dropEmpty: 'Drop to add still',
  dropNew: 'Drop to add as a new board',
} as const

/** Whether a file is a picture the board can put behind itself. */
export function isImageFile(file: IncomingFile): boolean {
  return /^image\//i.test(file.type)
}

/** The pictures in what arrived, in the order they arrived. */
export function imageFiles<F extends IncomingFile>(files: readonly F[]): F[] {
  return files.filter(isImageFile)
}

/**
 * What happens to the pictures that arrived.
 *
 * - `apply`: one picture onto an empty board goes straight behind it.
 * - `choose`: one picture onto a board that already has a still asks whether
 *   it is a new board or a replacement.
 * - `replace`: the same, with ⌥ held on the drop, which is the answer given
 *   before the question.
 * - `batch`: several pictures are several boards, through the import sheet.
 */
export type StillRoute = 'apply' | 'choose' | 'replace' | 'batch'

export function stillRoute(count: number, hasStill: boolean, replaceKey = false): StillRoute | null {
  if (count <= 0) return null
  if (count > 1) return 'batch'
  if (!hasStill) return 'apply'
  return replaceKey ? 'replace' : 'choose'
}

/** What the board is being asked to do with a paste. */
export type PasteDecision =
  | { kind: 'ignore' }
  | { kind: 'empty' }
  | { kind: 'route'; route: StillRoute; count: number }

/**
 * A paste is the board's only while nothing else wants it: a field being
 * typed in, a text edit on the board, or a sheet open over it all keep their
 * own paste. A paste with no picture in it says so, so the shortcut never
 * looks like it did nothing.
 */
export function pasteDecision(input: {
  live: boolean
  typing: boolean
  blocked?: boolean
  files: readonly IncomingFile[]
  hasStill: boolean
}): PasteDecision {
  if (!input.live || input.typing || input.blocked) return { kind: 'ignore' }
  const images = imageFiles(input.files)
  if (!images.length) return { kind: 'empty' }
  return { kind: 'route', route: stillRoute(images.length, input.hasStill)!, count: images.length }
}

/** The outcome of a drop: turned away, or routed like any other arrival. */
export type DropDecision =
  | { kind: 'reject' }
  | { kind: 'route'; route: StillRoute; count: number }

export function dropDecision(input: {
  files: readonly IncomingFile[]
  hasStill: boolean
  replaceKey: boolean
}): DropDecision {
  const images = imageFiles(input.files)
  if (!images.length) return { kind: 'reject' }
  return { kind: 'route', route: stillRoute(images.length, input.hasStill, input.replaceKey)!, count: images.length }
}

/**
 * The label over the board while something is dragged across it: what
 * letting go will do. The small line is only there when there is a second
 * thing it could do instead.
 */
export function dropLabel(count: number, hasStill: boolean, replaceKey = '⌥'): { title: string; hint: string | null } {
  if (count > 1) return { title: `Drop to add ${count} boards`, hint: null }
  if (hasStill) return { title: STILL_COPY.dropNew, hint: `Hold ${replaceKey} to replace this still` }
  return { title: STILL_COPY.dropEmpty, hint: null }
}

/** True for anything a person types into, which keeps its own paste. */
export function isTypingTarget(el: { tagName?: string; isContentEditable?: boolean } | null | undefined): boolean {
  if (!el) return false
  if (el.isContentEditable) return true
  return /^(INPUT|TEXTAREA|SELECT)$/i.test(el.tagName ?? '')
}
