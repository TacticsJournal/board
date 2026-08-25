import type { Scene } from './types'

export const LEGACY_CATEGORY_SCENES_KEY = 'tbm-category-scenes-v1'
export const CATEGORY_SCENES_RECOVERED_SUFFIX = ':recovered-v1'
export const MAX_LEGACY_SNAPSHOTS = 12

type RecoveredBoard = { savedAt: string; scene: Scene }
export type CategoryRecoveryPlan = {
  boards: Record<string, RecoveredBoard>
  valid: boolean
}

export type CategoryRecoveryDeps = {
  migrateScene: (raw: unknown) => Scene
  pitchLabel: (pitch: string | undefined) => string
}

function sceneIdentity(scene: Scene): string {
  return JSON.stringify({ pitch: scene.pitch, board: scene.board, match: scene.match, objects: scene.objects })
}

/**
 * Turn the retired per-pitch snapshots into an ordinary saved-board import.
 * The caller owns storage and only removes the legacy record after the import
 * succeeds. Recovered timestamps stay behind normal user-created boards.
 */
export function planCategorySnapshotRecovery(
  raw: unknown,
  deps: CategoryRecoveryDeps,
): CategoryRecoveryPlan {
  const boards: Record<string, RecoveredBoard> = {}
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { boards, valid: false }

  const identities = new Set<string>()
  const entries = Object.entries(raw as Record<string, unknown>)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(0, MAX_LEGACY_SNAPSHOTS)
  let stamp = Date.UTC(2000, 0, 1)

  for (const [, value] of entries) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue
    let scene: Scene
    try { scene = deps.migrateScene(JSON.parse(JSON.stringify(value))) } catch { continue }
    if (!scene.objects.length) continue
    const identity = sceneIdentity(scene)
    if (identities.has(identity)) continue
    identities.add(identity)

    const base = `Recovered ${deps.pitchLabel(scene.pitch)} board`.slice(0, 40)
    let name = base
    let i = 2
    while (boards[name]) name = `${base} (${i++})`
    stamp -= 1000
    boards[name] = { savedAt: new Date(stamp).toISOString(), scene }
  }

  return { boards, valid: true }
}
