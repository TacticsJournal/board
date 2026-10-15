import type { ArrowObj, BoxObj, Pt, Scene, SceneObj } from './types.ts'

export const PREVIOUS_BOARD_OPACITY = 0.22
export const PREVIOUS_BOARD_MOVEMENT_OPACITY = 0.38
export const PREVIOUS_BOARD_MOVE_EPSILON = 0.01

export type BoardMovement = {
  previous: SceneObj
  current: SceneObj
  from: Pt
  to: Pt
}

/** The point used to compare an object across two ordered boards. */
export function objectCentre(object: SceneObj): Pt {
  if (object.type === 'arrow') return arrowCentre(object)
  if (object.type === 'box') return boxCentre(object)
  return { x: object.x, y: object.y }
}

function arrowCentre(object: ArrowObj): Pt {
  return {
    x: (object.x1 + object.mx + object.x2) / 3,
    y: (object.y1 + object.my + object.y2) / 3,
  }
}

function boxCentre(object: BoxObj): Pt {
  if (object.corners?.length) {
    return {
      x: object.corners.reduce((sum, corner) => sum + corner.x, 0) / object.corners.length,
      y: object.corners.reduce((sum, corner) => sum + corner.y, 0) / object.corners.length,
    }
  }
  return { x: object.x, y: object.y }
}

/** Find persistent objects that moved between adjacent scenes. */
export function movedObjects(
  previous: Scene | readonly SceneObj[],
  current: Scene | readonly SceneObj[],
  epsilon = PREVIOUS_BOARD_MOVE_EPSILON,
): BoardMovement[] {
  const previousObjects = Array.isArray(previous) ? previous : previous.objects
  const currentObjects = Array.isArray(current) ? current : current.objects
  const priorByKey = new Map<string, SceneObj>()
  for (const object of previousObjects) priorByKey.set(objectKey(object), object)

  const movements: BoardMovement[] = []
  for (const object of currentObjects) {
    const prior = priorByKey.get(objectKey(object))
    if (!prior) continue
    const from = objectCentre(prior)
    const to = objectCentre(object)
    if (Math.hypot(to.x - from.x, to.y - from.y) <= epsilon) continue
    movements.push({ previous: prior, current: object, from, to })
  }
  return movements
}

function objectKey(object: SceneObj) {
  return `${object.type}:${object.id}`
}
