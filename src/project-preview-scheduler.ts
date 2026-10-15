/** Run expensive preview work one frame at a time, and drop work from an old render. */
export function createIncrementalTaskQueue(
  schedule: (run: () => void) => number,
  cancel: (handle: number) => void,
) {
  let generation = 0
  let pending: number | null = null
  let tasks: Array<() => void> = []

  const invalidate = () => {
    generation += 1
    tasks = []
    if (pending !== null) {
      cancel(pending)
      pending = null
    }
  }

  const enqueue = (next: readonly (() => void)[]) => {
    invalidate()
    tasks = [...next]
    if (!tasks.length) return
    const ownGeneration = generation
    const tick = () => {
      pending = null
      if (ownGeneration !== generation) return
      const task = tasks.shift()
      if (!task) return
      task()
      if (ownGeneration === generation && tasks.length) pending = schedule(tick)
    }
    pending = schedule(tick)
  }

  return { enqueue, invalidate }
}
