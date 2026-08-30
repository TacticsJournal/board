export type FreeBackupSource = 'fourth_save' | 'settings'
export type FreeBackupIntent = Readonly<{ boardId: string; source: FreeBackupSource }>
export type BackupStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

const SELECTIONS_KEY = 'tbm:free-backups:v1'
const INTENT_KEY = 'tbm:free-backup-intent:v1'
const ID = /^[A-Za-z0-9_-]{8,64}$/

function selections(storage: Pick<Storage, 'getItem'>): Record<string, string> {
  try {
    const value = JSON.parse(storage.getItem(SELECTIONS_KEY) || '{}')
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
    return Object.fromEntries(Object.entries(value)
      .filter(([binding, boardId]) => binding.length <= 256 && typeof boardId === 'string' && ID.test(boardId)))
  } catch { return {} }
}

export function selectedFreeBackup(storage: Pick<Storage, 'getItem'>, binding: string | null): string | null {
  if (!binding || binding.length > 256) return null
  return selections(storage)[binding] || null
}

export function setSelectedFreeBackup(storage: Pick<Storage, 'getItem' | 'setItem'>, binding: string, boardId: string): boolean {
  if (!binding || binding.length > 256 || !ID.test(boardId)) return false
  try {
    const all = selections(storage)
    all[binding] = boardId
    const entries = Object.entries(all).slice(-10)
    storage.setItem(SELECTIONS_KEY, JSON.stringify(Object.fromEntries(entries)))
    return true
  } catch { return false }
}

export function saveFreeBackupIntent(storage: Pick<Storage, 'setItem'>, intent: FreeBackupIntent): boolean {
  if (!ID.test(intent.boardId)) return false
  try { storage.setItem(INTENT_KEY, JSON.stringify(intent)); return true } catch { return false }
}

export function takeFreeBackupIntent(storage: BackupStorage): FreeBackupIntent | null {
  let intent: FreeBackupIntent | null = null
  try {
    const value = JSON.parse(storage.getItem(INTENT_KEY) || 'null')
    if (value && ID.test(value.boardId) && (value.source === 'fourth_save' || value.source === 'settings')) intent = value
  } catch { /* malformed intent is discarded */ }
  try { storage.removeItem(INTENT_KEY) } catch { /* one later read may repeat the harmless prompt */ }
  return intent
}
