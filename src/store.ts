import { Scene, SceneObj, emptyScene, emptyMatch, migrate } from './types'

const KEY = 'tbm-scene-v2'
const UNDO_CAP = 100

export type StoreOptions = {
  /** localStorage key for the autosaved working scene. */
  storageKey?: string
  /** Scene to use when no autosave exists, or every time when forceInitial is true. */
  initialScene?: Scene
  /** Ignore any existing autosave for this storage key and start from initialScene. */
  forceInitial?: boolean
  /** Disable autosave writes entirely (tests/private embedding). */
  persist?: boolean
}

export class Store {
  scene: Scene
  selectedId: string | null = null
  selectedIds: string[] = []
  private undoStack: string[] = []
  private redoStack: string[] = []
  private listeners = new Set<() => void>()
  private gestureDepth = 0
  private storageKey: string
  private persistEnabled: boolean

  constructor(options: StoreOptions = {}) {
    this.storageKey = options.storageKey ?? KEY
    this.persistEnabled = options.persist ?? true
    let saved: Scene | null = null
    if (!options.forceInitial) {
      try {
        const raw = localStorage.getItem(this.storageKey)
        if (raw) saved = migrate(JSON.parse(raw))
      } catch { /* corrupted autosave: start fresh */ }
    }
    this.scene = saved ?? (options.initialScene ? migrate(options.initialScene) : emptyScene())
    if (options.forceInitial && this.persistEnabled) this.persist()
  }

  subscribe(fn: () => void) { this.listeners.add(fn); return () => this.listeners.delete(fn) }
  emit() { this.listeners.forEach(fn => fn()) }

  /** Selection-only listeners: fired without a scene rebuild so an in-flight
      drag on the newly selected node is not destroyed mid-gesture. */
  private selListeners = new Set<() => void>()
  onSelect(fn: () => void) { this.selListeners.add(fn); return () => this.selListeners.delete(fn) }

  obj(id: string | null): SceneObj | undefined {
    return id ? this.scene.objects.find(o => o.id === id) : undefined
  }
  get selected(): SceneObj | undefined { return this.obj(this.selectedId) }

  select(id: string | null) {
    if (!id) return this.selectMany([])
    this.selectMany([id])
  }

  /** Ids in the same group as anything already listed, so a group selects whole. */
  private withGroups(ids: string[]): string[] {
    const groups = new Set<string>()
    for (const id of ids) {
      const g = this.obj(id)?.group
      if (g) groups.add(g)
    }
    if (!groups.size) return ids
    // scene order, so the first selected object is a stable one to anchor on
    return this.scene.objects
      .filter(o => ids.includes(o.id) || (o.group && groups.has(o.group)))
      .map(o => o.id)
  }

  selectMany(ids: string[]) {
    const next = Array.from(new Set(this.withGroups(ids.filter(Boolean))))
      .filter(id => this.obj(id) !== undefined)
    if (this.selectedIds.length === next.length && this.selectedIds.every((id, i) => id === next[i])) return
    this.selectedIds = next
    this.selectedId = this.selectedIds[0] ?? null
    this.selListeners.forEach(fn => fn())
  }

  private pruneSelection(): boolean {
    const next = this.selectedIds.filter(id => this.obj(id))
    const changed = this.selectedIds.length !== next.length || this.selectedIds.some((id, i) => id !== next[i])
    this.selectedIds = next
    this.selectedId = this.selectedIds[0] ?? null
    return changed
  }

  /** Full-scene snapshot for undo, including the optional arrow legend. */
  private snap(): string {
    const s = this.scene
    return JSON.stringify({ objects: s.objects, match: s.match, pitch: s.pitch, board: s.board, arrowLegend: s.arrowLegend })
  }

  /** Snapshot + mutate + persist + emit, for discrete edits. */
  apply(fn: (scene: Scene) => void) {
    if (this.gestureDepth === 0) this.pushUndo()
    fn(this.scene)
    // drop no-op entries
    if (this.gestureDepth === 0 && this.undoStack.length && this.undoStack[this.undoStack.length - 1] === this.snap()) {
      this.undoStack.pop()
    }
    const selectionChanged = this.pruneSelection()
    this.persist()
    if (selectionChanged) this.selListeners.forEach(fn => fn())
    this.emit()
  }

  /** For drags: snapshot once at gesture start, mutate freely, emit at end. */
  beginGesture() { if (this.gestureDepth++ === 0) this.pushUndo() }
  endGesture() {
    if (this.gestureDepth > 0 && --this.gestureDepth === 0) {
      // no-op gesture (tap that started a drag but moved nothing): drop the snapshot
      if (this.undoStack[this.undoStack.length - 1] === this.snap()) {
        this.undoStack.pop()
        return
      }
      this.persist()
      this.emit()
    }
  }

  get canUndo() { return this.undoStack.length > 0 }
  get canRedo() { return this.redoStack.length > 0 }
  get undoDepth() { return this.undoStack.length }

  undo() {
    const snap = this.undoStack.pop()
    if (snap === undefined) return
    this.redoStack.push(this.snap())
    const parsed = JSON.parse(snap)
    this.scene.objects = parsed.objects
    this.scene.match = parsed.match ?? emptyMatch()
    this.scene.pitch = parsed.pitch ?? this.scene.pitch
    this.scene.board = parsed.board ?? this.scene.board
    if (parsed.arrowLegend) this.scene.arrowLegend = parsed.arrowLegend
    else delete this.scene.arrowLegend
    this.afterHistory()
  }
  redo() {
    const snap = this.redoStack.pop()
    if (snap === undefined) return
    this.undoStack.push(this.snap())
    const parsed = JSON.parse(snap)
    this.scene.objects = parsed.objects
    this.scene.match = parsed.match ?? emptyMatch()
    this.scene.pitch = parsed.pitch ?? this.scene.pitch
    this.scene.board = parsed.board ?? this.scene.board
    if (parsed.arrowLegend) this.scene.arrowLegend = parsed.arrowLegend
    else delete this.scene.arrowLegend
    this.afterHistory()
  }
  private afterHistory() {
    const selectionChanged = this.pruneSelection()
    this.persist()
    if (selectionChanged) this.selListeners.forEach(fn => fn())
    this.emit()
  }

  private pushUndo() {
    this.undoStack.push(this.snap())
    if (this.undoStack.length > UNDO_CAP) this.undoStack.shift()
    this.redoStack.length = 0
  }

  persist() {
    if (!this.persistEnabled) return
    try { localStorage.setItem(this.storageKey, JSON.stringify(this.scene)) } catch { /* storage full/blocked */ }
  }

  loadScene(scene: Scene) {
    this.pushUndo()
    this.scene = scene
    this.selectedIds = []
    this.selectedId = null
    this.persist()
    this.emit()
  }
}
