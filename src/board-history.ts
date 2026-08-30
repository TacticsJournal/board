/**
 * Version history for a synced project.
 *
 * The server keeps earlier versions of every project a Pro member owns. This
 * screen is the only place they are visible: a list of when each version was
 * kept, and one deliberate way back to any of them. The endpoint sends no
 * scenes, so there is nothing here to draw -- a date and the name the project
 * carried then is all a reader gets, and all they need to choose.
 *
 * Restoring is the one destructive act on the screen, so it asks once, in
 * place, before anything leaves the browser.
 */

import { boardHistoryUrl } from './board-api.ts'
import { tryNormalizeBoardDocument, type BoardDocument } from './projects.ts'

/** One earlier version, as the server describes it. Never carries a scene. */
export type BoardVersion = {
  id: string
  /** The name the project carried when this version was kept. */
  name: string
  /** When the project itself was last edited in this version. */
  versionAt: string
  /** When the server kept the version. */
  capturedAt: string
}

/** The board the server made current again, shaped like a sync row. */
export type RestoredBoard = {
  id: string
  name: string
  scene: BoardDocument
  updatedAt: string
}

const MAX_ID_LENGTH = 128
const MAX_NAME_LENGTH = 200
const MAX_VERSIONS = 200
const ERROR_MAX_LENGTH = 256

function boundedString(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function isTime(value: string): boolean {
  return !!value && Number.isFinite(Date.parse(value))
}

/**
 * The version list, or null when the payload is not a version list at all.
 * A row missing an id or a usable time is dropped rather than guessed at:
 * nothing here can be restored without both.
 */
export function parseBoardVersions(payload: unknown): BoardVersion[] | null {
  const rows = (payload as { versions?: unknown } | null)?.versions
  if (!Array.isArray(rows)) return null
  const versions: BoardVersion[] = []
  for (const row of rows.slice(0, MAX_VERSIONS)) {
    if (!row || typeof row !== 'object') continue
    const value = row as Record<string, unknown>
    const id = boundedString(value.id, MAX_ID_LENGTH)
    const versionAt = boundedString(value.version_at, MAX_NAME_LENGTH)
    const capturedAt = boundedString(value.captured_at, MAX_NAME_LENGTH)
    if (!id || !isTime(versionAt) || !isTime(capturedAt)) continue
    versions.push({ id, name: boundedString(value.name, MAX_NAME_LENGTH), versionAt, capturedAt })
  }
  return versions
}

/**
 * The restored board, or null. This one is strict on purpose: its result
 * replaces a project on this device, so a response that is short of a field,
 * carries someone else's board id, or holds a document this build cannot read
 * has to leave local work exactly as it was.
 */
export function parseRestoredBoard(payload: unknown, expectedBoardId: string): RestoredBoard | null {
  const board = (payload as { board?: unknown } | null)?.board
  if (!board || typeof board !== 'object') return null
  const value = board as Record<string, unknown>
  if (value.access !== 'owner') return null
  const id = boundedString(value.id, MAX_ID_LENGTH)
  if (!id || id !== expectedBoardId) return null
  if (typeof value.name !== 'string') return null
  const updatedAt = boundedString(value.updated_at, MAX_NAME_LENGTH)
  if (!isTime(updatedAt)) return null
  const scene = tryNormalizeBoardDocument(value.scene)
  if (!scene) return null
  return { id, name: boundedString(value.name, MAX_NAME_LENGTH) || 'Untitled project', scene, updatedAt }
}

export type BoardHistoryRow = Readonly<{
  id?: string | null
  access?: 'shared'
  readOnly?: boolean
  syncAccount?: string | null
  /** Read-only in the list because it sits outside the free editable slots. */
  locked?: boolean
}>

export type BoardHistoryContext = Readonly<{
  pro: boolean
  signedIn: boolean
  selfHosted: boolean
  accountBinding: string | null
}>

/**
 * Who gets the History action. The server keeps versions only for projects an
 * account owns and syncs, so every other row would open a screen with nothing
 * in it and no way to explain why.
 */
export function canOpenBoardHistory(row: BoardHistoryRow, context: BoardHistoryContext): boolean {
  if (context.selfHosted || !context.pro || !context.signedIn || !context.accountBinding) return false
  if (!row.id || row.access === 'shared' || row.readOnly === true || row.locked === true) return false
  return row.syncAccount === context.accountBinding
}

export const boardHistoryListUrl = (boardId: string): string =>
  `${boardHistoryUrl()}?board_id=${encodeURIComponent(boardId)}`

export type BoardHistoryApi = {
  list(boardId: string): Promise<BoardVersion[]>
  restore(boardId: string, versionId: string): Promise<RestoredBoard>
}

/** The server's own words when it has any, the status code when it has none. */
async function failure(response: Response): Promise<Error> {
  let error: unknown
  try { error = (await response.json())?.error } catch { /* use the status */ }
  const reason = typeof error === 'string' && error.trim()
    ? error.trim().slice(0, ERROR_MAX_LENGTH)
    : String(response.status)
  return new Error(reason)
}

export function createBoardHistoryApi(fetchImpl: typeof fetch = fetch): BoardHistoryApi {
  return {
    async list(boardId) {
      const response = await fetchImpl(boardHistoryListUrl(boardId), { credentials: 'include' })
      if (!response.ok) throw await failure(response)
      const versions = parseBoardVersions(await response.json())
      if (!versions) throw new Error('The server sent a version list this version cannot read.')
      return versions
    },
    async restore(boardId, versionId) {
      const response = await fetchImpl(boardHistoryUrl(), {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ board_id: boardId, version_id: versionId }),
      })
      if (!response.ok) throw await failure(response)
      const board = parseRestoredBoard(await response.json(), boardId)
      if (!board) throw new Error('The server sent a project this version cannot read. Nothing on this device was changed.')
      return board
    },
  }
}

function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** The reader's own clock and calendar, or an honest gap where one belongs. */
export function versionTimeLabel(value: string): string {
  const time = new Date(value)
  return Number.isFinite(time.getTime()) ? time.toLocaleString() : 'Date unavailable'
}

export type BoardHistoryTarget = { id: string; name: string; savedAt: string; accountBinding: string }

export type BoardHistoryPanelOptions = {
  api: BoardHistoryApi
  /**
   * Put the restored board into local storage and onto the canvas. False means
   * the device refused the write, so the screen must say so rather than claim
   * a restore that did not happen.
   */
  onRestore: (board: RestoredBoard, target: BoardHistoryTarget) => boolean
  /** Leave for the saved list, carrying the sentence that announces the result. */
  onDone: (message: string, boardId: string) => void
}

type Phase = 'loading' | 'ready' | 'failed'

/**
 * The history screen. It owns one project at a time and holds no state a
 * reader cannot see: what is loaded, which row is asking to be confirmed, and
 * which row is being restored right now.
 */
export class BoardHistoryPanel {
  el: HTMLDivElement
  private target: BoardHistoryTarget | null = null
  private versions: BoardVersion[] = []
  private phase: Phase = 'loading'
  private error = ''
  private confirming: string | null = null
  private restoring: string | null = null
  /** Only the newest request may draw; a reopened screen ignores older replies. */
  private request = 0

  private options: BoardHistoryPanelOptions

  constructor(options: BoardHistoryPanelOptions) {
    this.options = options
    this.el = document.createElement('div')
    this.el.className = 'svPane histPane'
    this.el.innerHTML = `
      <p class="setNote" data-history-intro></p>
      <div class="setNote saveStatus" data-history-status role="status" aria-live="polite"></div>
      <div class="saveList" data-history-list></div>`
    this.el.addEventListener('click', (event) => {
      const button = (event.target as HTMLElement).closest<HTMLElement>('[data-history]')
      if (!button) return
      const action = button.dataset.history
      const versionId = button.dataset.versionId ?? ''
      if (action === 'retry') void this.load()
      else if (action === 'ask') this.ask(versionId)
      else if (action === 'cancel') this.ask(null, button.dataset.returnTo)
      else if (action === 'restore') void this.restore(versionId)
    })
    // Escape backs out of the confirmation first; only then does it reach the
    // sheet, which closes as it does on every other screen.
    this.el.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || !this.confirming || this.restoring) return
      event.stopPropagation()
      this.ask(null, this.confirming)
    })
  }

  /** Show this project's history and start loading it. */
  open(target: BoardHistoryTarget): void {
    this.target = target
    this.versions = []
    this.confirming = null
    this.restoring = null
    this.error = ''
    this.phase = 'loading'
    this.render()
    void this.load()
  }

  /** The project on the screen, for a caller deciding whether to reopen it. */
  currentTarget(): BoardHistoryTarget | null { return this.target }

  private async load(): Promise<void> {
    const target = this.target
    if (!target) return
    const request = ++this.request
    this.phase = 'loading'
    this.error = ''
    this.confirming = null
    this.render()
    try {
      const versions = await this.options.api.list(target.id)
      if (request !== this.request) return
      this.versions = versions
      this.phase = 'ready'
    } catch (error) {
      if (request !== this.request) return
      this.error = error instanceof Error ? error.message : 'Could not load earlier versions.'
      this.phase = 'failed'
    }
    this.render()
  }

  /** Raise or drop the one confirmation the screen allows at a time. */
  private ask(versionId: string | null, focusVersionId?: string): void {
    if (this.restoring) return
    this.confirming = versionId
    this.render()
    const target = versionId
      ? this.el.querySelector<HTMLElement>(`[data-history="restore"][data-version-id="${CSS.escape(versionId)}"]`)
      : focusVersionId
        ? this.el.querySelector<HTMLElement>(`[data-history="ask"][data-version-id="${CSS.escape(focusVersionId)}"]`)
        : null
    target?.focus()
  }

  private async restore(versionId: string): Promise<void> {
    const target = this.target
    if (!target || this.restoring || this.confirming !== versionId) return
    this.restoring = versionId
    const request = ++this.request
    this.render()
    let board: RestoredBoard
    try {
      board = await this.options.api.restore(target.id, versionId)
    } catch (error) {
      if (request !== this.request) return
      this.restoring = null
      this.error = error instanceof Error ? error.message : 'Could not restore that version.'
      this.render()
      return
    }
    if (request !== this.request) return
    const applied = this.options.onRestore(board, target)
    this.restoring = null
    if (!applied) {
      this.error = 'That version could not be saved on this device, so nothing was changed.'
      this.render()
      return
    }
    const version = this.versions.find(row => row.id === versionId)
    const when = version ? versionTimeLabel(version.versionAt) : 'an earlier version'
    this.confirming = null
    // settle the screen before leaving it: a caller that stays put must not be
    // left reading "Restoring…" about a restore that is done
    this.render()
    this.options.onDone(`Restored ${board.name} to its version from ${when}.`, board.id)
  }

  private render(): void {
    const target = this.target
    const intro = this.el.querySelector<HTMLElement>('[data-history-intro]')!
    const status = this.el.querySelector<HTMLElement>('[data-history-status]')!
    const list = this.el.querySelector<HTMLElement>('[data-history-list]')!
    if (!target) {
      intro.textContent = ''
      status.textContent = ''
      list.replaceChildren()
      return
    }
    intro.innerHTML = `Earlier versions of <strong>${esc(target.name)}</strong> are kept on your account.`
      + ' Restoring one replaces the project on this device and on the devices you sync with.'
    status.textContent = this.restoring
      ? 'Restoring this version…'
      : this.phase === 'failed'
        ? `Could not load earlier versions: ${this.error}`
        : this.error || ''
    list.setAttribute('aria-busy', this.phase === 'loading' || !!this.restoring ? 'true' : 'false')
    list.innerHTML = this.listHtml(target)
  }

  private listHtml(target: BoardHistoryTarget): string {
    if (this.phase === 'loading') {
      return `<div class="setGroup"><div class="setItem setItemStatic histEmpty">Loading earlier versions…</div></div>`
    }
    if (this.phase === 'failed') {
      // the reason is in the status line above, where it is also announced;
      // repeating it here would only say the same thing twice
      return `<div class="setGroup">
        <button class="setItem" data-history="retry"><span class="setItemLabel">Try again</span></button>
      </div>`
    }
    const current = `<div class="setGroupHead">On this device now</div>
      <div class="setGroup"><div class="setItem setItemStatic histItem histCurrent">
        <span class="histMeta">
          <strong>${esc(versionTimeLabel(target.savedAt))}</strong>
          <span>${esc(target.name)}</span>
        </span>
        <span class="histTag">Current</span>
      </div></div>`
    const earlier = this.versions.length
      ? `<div class="setGroupHead">Earlier versions</div>
        <div class="setGroup">${this.versions.map(version => this.rowHtml(version)).join('')}</div>`
      : `<div class="setGroup"><div class="setItem setItemStatic histEmpty">
          No earlier versions yet. Board keeps periodic versions as this project changes.
        </div></div>`
    return current + earlier
  }

  private rowHtml(version: BoardVersion): string {
    const when = versionTimeLabel(version.versionAt)
    const id = esc(version.id)
    const restoring = this.restoring === version.id
    const busy = !!this.restoring
    const label = `Restore the version from ${when}`
    const action = this.confirming === version.id
      ? `<span class="histConfirm" role="group" aria-label="${esc(label)}">
          <span class="histConfirmText">Replace the current project?</span>
          <button class="setItemAction histDo" data-history="restore" data-version-id="${id}"${busy ? ' disabled' : ''}>${restoring ? 'Restoring…' : 'Restore'}</button>
          <button class="setItemAction" data-history="cancel" data-return-to="${id}"${busy ? ' disabled' : ''}>Cancel</button>
        </span>`
      : `<button class="setItemAction" data-history="ask" data-version-id="${id}" aria-label="${esc(label)}"${busy ? ' disabled' : ''}>Restore</button>`
    const named = version.name && version.name !== (this.target?.name ?? '')
      ? `<span>Named "${esc(version.name)}" then</span>`
      : `<span>Kept ${esc(versionTimeLabel(version.capturedAt))}</span>`
    return `<div class="setItem histItem">
      <span class="histMeta"><strong>${esc(when)}</strong>${named}</span>
      ${action}
    </div>`
  }
}
