import type { PitchStyle } from './pitches'

/**
 * What a new board can start on. The Add board chooser and the settings pitch
 * shelf offer the same things, so the rules about what is offered and what is
 * locked live here, away from either piece of markup.
 */
export type AddBoardChoice = {
  id: string
  label: string
  boardH: number
  /** picture for the tile; '' when this device has none */
  art: string
  /** unavailable art: the tile explains that it cannot be selected */
  locked: boolean
  /** one of the user's own saved backgrounds */
  custom: boolean
  /** the board on screen is already drawn on this one */
  current: boolean
}

export type AddBoardChoices = {
  /** the pitch the editor is holding: the fast path row */
  current: AddBoardChoice
  pitches: AddBoardChoice[]
  backgrounds: AddBoardChoice[]
  /** saving an uploaded image is a paid feature too */
  uploadLocked: boolean
}

export type AddBoardChoiceInput = {
  /** our own art, hidden and admin-only styles included */
  builtIn: PitchStyle[]
  /** the user's saved backgrounds */
  saved: PitchStyle[]
  currentPitch: PitchStyle
  admin: boolean
  canPick: (style: PitchStyle) => boolean
  canUpload: boolean
  /** thumbnail for a saved background, read from whatever cache holds it */
  thumb?: (id: string) => string
}

export function addBoardChoices(input: AddBoardChoiceInput): AddBoardChoices {
  const art = (style: PitchStyle) => style.src || input.thumb?.(style.id) || ''
  const toChoice = (style: PitchStyle): AddBoardChoice => ({
    id: style.id,
    label: style.label,
    boardH: style.boardH,
    art: art(style),
    locked: !input.canPick(style),
    custom: style.custom === true,
    current: style.id === input.currentPitch.id,
  })
  return {
    // Already on screen, so it is never locked: whatever put the board on this
    // pitch is what says it was allowed, not this list.
    current: { ...toChoice(input.currentPitch), locked: false, current: true },
    pitches: input.builtIn
      .filter(style => !style.hidden && (!style.adminOnly || input.admin))
      .map(toChoice),
    // A background whose image is not on this device makes a board nobody can
    // see, so it is not offered here even though old boards keep it.
    backgrounds: input.saved.filter(style => !style.missing).map(toChoice),
    uploadLocked: !input.canUpload,
  }
}
