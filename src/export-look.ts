/* How an export is drawn when it is not drawn the way the board is. Someone
 * who works on the horizontal pitch in light can hand over the same board
 * stood up, or dark, without touching the board itself: the export restyles a
 * copy, and the copy is thrown away. */
import { pitchById } from './pitches.ts'
import { cloneScene, fullView, type Project } from './projects.ts'
import { setScenePaper, type Scene } from './types.ts'

export type ExportPaper = 'drawn' | 'light' | 'dark'

export type ExportLook = {
  /** one of our own pitch ids, or null to leave each board on its own */
  pitch: string | null
  paper: ExportPaper
}

export const AS_DRAWN: ExportLook = { pitch: null, paper: 'drawn' }

export function isAsDrawn(look: ExportLook): boolean {
  return look.pitch === null && look.paper === 'drawn'
}

/**
 * Moving a board's objects onto another pitch is the editor's own rule, sizes
 * and all (main.ts, setPitchPreservingLayout), so it is handed in rather than
 * done a second way here.
 */
export type CarryPitch = (scene: Scene, pitch: string, boardH: number) => void

/** A board on a photograph or a broadcast still is the picture it is on. */
export function canRestyle(scene: Scene): boolean {
  const style = pitchById(scene.pitch)
  return !style.custom && !style.live
}

/** A copy of the scene wearing the look. The scene handed in is not touched. */
export function exportLookScene(scene: Scene, look: ExportLook, carry: CarryPitch): Scene {
  const copy = cloneScene(scene)
  if (!canRestyle(copy)) return copy
  const target = look.pitch ? pitchById(look.pitch) : null
  if (target && !target.custom && !target.live && target.id !== copy.pitch) carry(copy, target.id, target.boardH)
  if (look.paper !== 'drawn') setScenePaper(copy, look.paper === 'dark')
  return copy
}

/**
 * The project with every board wearing the look. A view is a rectangle on the
 * pitch it was framed on, so a board whose pitch changes is shown whole rather
 * than through a frame that now points somewhere else.
 */
export function exportLookProject(project: Project, look: ExportLook, carry: CarryPitch): Project {
  if (isAsDrawn(look)) return project
  return {
    ...project,
    boards: project.boards.map(board => {
      const scene = exportLookScene(board.scene, look, carry)
      return { ...board, scene, view: scene.pitch === board.scene.pitch ? board.view : fullView(scene) }
    }),
  }
}
