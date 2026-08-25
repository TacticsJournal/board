/** The action an open board needs after a remote update to its stable id. */
export type RemoteCurrentDecision = 'none' | 'load' | 'conflict' | 'detach' | 'conflict-delete'

/**
 * Names are mutable, so an open board is matched by id. A deleted remote
 * record needs its own conflict state: the normal "load newer" action has
 * nothing to load.
 */
export function remoteCurrentDecision(
  remoteIds: readonly string[],
  currentId: string | null,
  existsRemotely: boolean,
  dirty: boolean,
): RemoteCurrentDecision {
  if (!currentId || !remoteIds.includes(currentId)) return 'none'
  if (!existsRemotely) return dirty ? 'conflict-delete' : 'detach'
  return dirty ? 'conflict' : 'load'
}
