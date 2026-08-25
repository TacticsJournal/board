/**
 * What an uploaded background's bytes are, once, for whoever is drawing.
 *
 * A saved background keeps its image in storage rather than in the pitch
 * style, so anything drawing a board from markup, the Boards cards, the
 * Projects strip and the animation player alike, has to read it. Reading is
 * asynchronous and drawing is not, so this holds the answer: the first ask
 * starts one read and returns nothing, every ask after it is answered from
 * memory, and what arrives calls back so the view can draw again.
 */
export type BackgroundCache = {
  /** Bytes for a background, or '' while they are still being read. */
  get(projectId: string, id: string): string
  /** Forget everything read so far: the account, or a Project's art, changed. */
  clear(): void
}

export function createBackgroundCache(
  resolve: (id: string, projectId: string) => Promise<string | null>,
  onArrive: () => void,
): BackgroundCache {
  /* A Project carries where its backgrounds are read from as much as which
     ones: the same id is one row's server art in a shared Project and this
     device's shelf in an owned one, so the key holds both. */
  const known = new Map<string, string>()
  const asked = new Set<string>()
  let generation = 0

  return {
    get(projectId, id) {
      const key = `${projectId}\u0000${id}`
      const cached = known.get(key)
      if (cached !== undefined) return cached
      if (!asked.has(key)) {
        asked.add(key)
        const at = generation
        void Promise.resolve()
          .then(() => resolve(id, projectId))
          .catch(() => null)
          .then(src => {
            if (at !== generation) return
            // a background that cannot be read is remembered as missing, so a
            // failed read is not repeated on every redraw
            known.set(key, src ?? '')
            if (src) onArrive()
          })
      }
      return ''
    },
    clear() {
      generation += 1
      known.clear()
      asked.clear()
    },
  }
}
