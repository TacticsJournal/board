import { BOARD_SELF_HOSTED } from './build-mode.ts'
import { hasBoardLicense, hasPaidBoardAccess, isTrustedPreviewBuild } from './entitlements.ts'

export type TrialFeature = 'screenshot_import' | 'gif_export'

export interface FeatureTrialStorage {
  getItem(key: string): string | null | Promise<string | null>
  setItem(key: string, value: string): void | Promise<void>
}

const STORAGE_KEY_PREFIX = 'tbm:trial:v1'

function storageKey(feature: TrialFeature): string {
  return `${STORAGE_KEY_PREFIX}:${feature}`
}

function bypassesTrials(): boolean {
  return BOARD_SELF_HOSTED || isTrustedPreviewBuild() || hasPaidBoardAccess()
}

async function isConsumed(storage: FeatureTrialStorage, feature: TrialFeature): Promise<boolean> {
  try {
    const value = await storage.getItem(storageKey(feature))
    return value !== null
  } catch {
    return true
  }
}

export function createFeatureTrials(storage: FeatureTrialStorage) {
  const blocked = new Set<TrialFeature>()
  const consumed = async (feature: TrialFeature) => {
    if (blocked.has(feature)) return true
    const used = await isConsumed(storage, feature)
    if (used) blocked.add(feature)
    return used
  }
  return {
    async canTry(feature: TrialFeature): Promise<boolean> {
      if (bypassesTrials()) return false
      return !(await consumed(feature))
    },

    async consume(feature: TrialFeature): Promise<boolean> {
      if (bypassesTrials()) return true
      if (await consumed(feature)) return false
      try {
        await storage.setItem(storageKey(feature), 'used')
        blocked.add(feature)
        return true
      } catch {
        blocked.add(feature)
        return false
      }
    },

    async used(feature: TrialFeature): Promise<boolean> {
      if (bypassesTrials()) return false
      return consumed(feature)
    },
  }
}

export type FeatureTrials = ReturnType<typeof createFeatureTrials>
