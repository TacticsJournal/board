/**
 * Proposed versions of a synced project.
 *
 * An agent link can be given permission to propose rather than to edit. What
 * it saves then goes nowhere near the project: it waits here as a complete
 * alternate version until the owner looks at it. This screen is where they
 * look. It shows the project as it is and as it is proposed, board by board,
 * and asks for one decision about the whole thing.
 *
 * There is no merging. Accepting replaces the project and keeps the version it
 * displaced in Version history; rejecting leaves the project untouched. That
 * is deliberate: picking objects out of somebody else's board is impossible to
 * describe honestly once boards have been renamed, reordered, or deleted.
 */

import { boardProposalsUrl } from './board-api.ts'
import { canOpenBoardHistory, type BoardHistoryContext, type BoardHistoryRow } from './board-history.ts'
import { tryNormalizeBoardDocument, type BoardDocument } from './projects.ts'
import type { Scene } from './types.ts'

/** One waiting proposal, as the server describes it. Never carries a document. */
export type BoardProposal = {
  id: string
  /** Who made it, in the server's words. */
  author: string
  /** The name the project would carry if this were accepted. */
  name: string
  note: string | null
  createdAt: string
  /** The project changed after this was proposed, so its author never saw it. */
  stale: boolean
}

/** One proposal opened for review, with both documents to draw. */
export type BoardProposalReview = {
  proposal: BoardProposal
  proposed: BoardDocument
  current: BoardDocument
  currentName: string
}

/** The project the server made current after an accepted proposal. */
export type AcceptedBoard = {
  id: string
  name: string
  scene: BoardDocument
  updatedAt: string
}

const MAX_ID_LENGTH = 128
const MAX_NAME_LENGTH = 200
const MAX_NOTE_LENGTH = 500
const MAX_PROPOSALS = 50
const ERROR_MAX_LENGTH = 256

function boundedString(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function isTime(value: string): boolean {
  return !!value && Number.isFinite(Date.parse(value))
}

function parseProposal(row: unknown): BoardProposal | null {
  if (!row || typeof row !== 'object') return null
  const value = row as Record<string, unknown>
  const id = boundedString(value.id, MAX_ID_LENGTH)
  const createdAt = boundedString(value.created_at, MAX_NAME_LENGTH)
  if (!id || !isTime(createdAt)) return null
  return {
    id,
    author: boundedString(value.author, MAX_NAME_LENGTH) || 'An agent',
    name: boundedString(value.name, MAX_NAME_LENGTH) || 'Untitled project',
    note: boundedString(value.note, MAX_NOTE_LENGTH) || null,
    createdAt,
    stale: value.stale === true,
  }
}

/** The waiting list, or null when the payload is not a proposal list at all. */
export function parseBoardProposals(payload: unknown): BoardProposal[] | null {
  const rows = (payload as { proposals?: unknown } | null)?.proposals
  if (!Array.isArray(rows)) return null
  const proposals: BoardProposal[] = []
  for (const row of rows.slice(0, MAX_PROPOSALS)) {
    const proposal = parseProposal(row)
    if (proposal) proposals.push(proposal)
  }
  return proposals
}

/**
 * One proposal and the project it would replace. Strict on both documents:
 * a review that cannot draw both sides is not a review, and a reader must not
 * be asked to accept a version this build could not show them.
 */
export function parseBoardProposalReview(payload: unknown): BoardProposalReview | null {
  const body = payload as { proposal?: unknown; current?: unknown } | null
  const proposal = parseProposal(body?.proposal)
  if (!proposal) return null
  const proposed = tryNormalizeBoardDocument((body?.proposal as { document?: unknown }).document)
  const currentValue = body?.current as { document?: unknown; name?: unknown } | undefined
  const current = tryNormalizeBoardDocument(currentValue?.document)
  if (!proposed || !current) return null
  return {
    proposal,
    proposed,
    current,
    currentName: boundedString(currentValue?.name, MAX_NAME_LENGTH) || 'Untitled project',
  }
}

/**
 * The project the server made current, or null. This replaces work on the
 * device, so a response short of a field, carrying another project's id, or
 * holding a document this build cannot read leaves everything as it was.
 */
export function parseAcceptedBoard(payload: unknown, expectedBoardId: string): AcceptedBoard | null {
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

/**
 * Who gets the Review action. Proposals live on the server beside the project
 * they belong to, so the rule is the one Version history uses: a project this
 * account owns and syncs, on a Pro account, on the hosted build.
 */
export function canReviewBoardProposals(row: BoardHistoryRow, context: BoardHistoryContext): boolean {
  return canOpenBoardHistory(row, context)
}

export const boardProposalsListUrl = (boardId: string): string =>
  `${boardProposalsUrl()}?board_id=${encodeURIComponent(boardId)}`

export const boardProposalReviewUrl = (boardId: string, proposalId: string): string =>
  `${boardProposalsListUrl(boardId)}&proposal_id=${encodeURIComponent(proposalId)}`

export type BoardProposalsApi = {
  list(boardId: string): Promise<BoardProposal[]>
  review(boardId: string, proposalId: string): Promise<BoardProposalReview>
  accept(boardId: string, proposalId: string): Promise<AcceptedBoard>
  reject(boardId: string, proposalId: string): Promise<void>
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

function decide(fetchImpl: typeof fetch, boardId: string, proposalId: string, decision: 'accept' | 'reject') {
  return fetchImpl(boardProposalsUrl(), {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ board_id: boardId, proposal_id: proposalId, decision }),
  })
}

export function createBoardProposalsApi(fetchImpl: typeof fetch = fetch): BoardProposalsApi {
  return {
    async list(boardId) {
      const response = await fetchImpl(boardProposalsListUrl(boardId), { credentials: 'include' })
      if (!response.ok) throw await failure(response)
      const proposals = parseBoardProposals(await response.json())
      if (!proposals) throw new Error('The server sent a list this version cannot read.')
      return proposals
    },
    async review(boardId, proposalId) {
      const response = await fetchImpl(boardProposalReviewUrl(boardId, proposalId), { credentials: 'include' })
      if (!response.ok) throw await failure(response)
      const review = parseBoardProposalReview(await response.json())
      if (!review) throw new Error('The server sent a proposal this version cannot draw.')
      return review
    },
    async accept(boardId, proposalId) {
      const response = await decide(fetchImpl, boardId, proposalId, 'accept')
      if (!response.ok) throw await failure(response)
      const board = parseAcceptedBoard(await response.json(), boardId)
      if (!board) throw new Error('The server sent a project this version cannot read. Nothing on this device was changed.')
      return board
    },
    async reject(boardId, proposalId) {
      const response = await decide(fetchImpl, boardId, proposalId, 'reject')
      if (!response.ok) throw await failure(response)
    },
  }
}

export type BoardChangeState = 'unchanged' | 'changed' | 'added' | 'removed'

/** One board of the project, as it is now and as it is proposed. */
export type BoardChange = {
  key: string
  title: string
  state: BoardChangeState
  current: Scene | null
  proposed: Scene | null
}

function projectBoards(document: BoardDocument): { id: string; title: string; scene: Scene }[] | null {
  if (!('boards' in document) || !Array.isArray(document.boards)) return null
  return document.boards.map((board, index) => ({
    id: board.id,
    title: board.title || `Board ${index + 1}`,
    scene: board.scene,
  }))
}

function sameScene(a: Scene | null, b: Scene | null): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/**
 * Match the two versions board by board.
 *
 * Boards carry stable ids, so a board that moved in the order is the same
 * board rather than a deletion and an addition. The proposed order is the one
 * a reader sees; boards the proposal drops are listed after it, so nothing
 * disappears from the screen without being named.
 */
export function compareBoardDocuments(current: BoardDocument, proposed: BoardDocument): BoardChange[] {
  const currentBoards = projectBoards(current)
  const proposedBoards = projectBoards(proposed)
  if (!currentBoards || !proposedBoards) {
    const currentScene = currentBoards ? currentBoards[0]?.scene ?? null : current as Scene
    const proposedScene = proposedBoards ? proposedBoards[0]?.scene ?? null : proposed as Scene
    return [{
      key: 'board',
      title: 'Board',
      state: sameScene(currentScene, proposedScene) ? 'unchanged' : 'changed',
      current: currentScene,
      proposed: proposedScene,
    }]
  }
  const byId = new Map(currentBoards.map(board => [board.id, board]))
  const seen = new Set<string>()
  const changes: BoardChange[] = proposedBoards.map(board => {
    const existing = byId.get(board.id)
    if (existing) seen.add(board.id)
    return {
      key: board.id,
      title: board.title,
      state: !existing ? 'added' : sameScene(existing.scene, board.scene) ? 'unchanged' : 'changed',
      current: existing?.scene ?? null,
      proposed: board.scene,
    }
  })
  for (const board of currentBoards) {
    if (seen.has(board.id)) continue
    changes.push({ key: board.id, title: board.title, state: 'removed', current: board.scene, proposed: null })
  }
  return changes
}

/** What the review screen says above the boards, in the reader's own terms. */
export function changeSummary(changes: BoardChange[]): string {
  const counted = (state: BoardChangeState) => changes.filter(change => change.state === state).length
  const parts: string[] = []
  const edited = counted('changed')
  const added = counted('added')
  const removed = counted('removed')
  if (edited) parts.push(`${edited} board${edited === 1 ? '' : 's'} redrawn`)
  if (added) parts.push(`${added} added`)
  if (removed) parts.push(`${removed} removed`)
  return parts.length ? parts.join(', ') : 'No boards changed'
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
export function proposalTimeLabel(value: string): string {
  const time = new Date(value)
  return Number.isFinite(time.getTime()) ? time.toLocaleString() : 'Date unavailable'
}

export type BoardProposalsTarget = { id: string; name: string; accountBinding: string }

export type BoardProposalsPanelOptions = {
  api: BoardProposalsApi
  /** Draw one board of a project at thumbnail size. Owned by main. */
  renderScene: (scene: Scene | null) => string
  /**
   * Put the accepted project onto this device. False means the device refused
   * the write, so the screen must say so rather than claim a change that did
   * not happen.
   */
  onAccepted: (board: AcceptedBoard, target: BoardProposalsTarget) => boolean
  /** Leave for the saved list, carrying the sentence that announces the result. */
  onDone: (message: string, boardId: string) => void
}

type Phase = 'loading' | 'ready' | 'failed'
type View = 'current' | 'proposed' | 'both'

/**
 * The proposals screen. It holds one project at a time and two views of it:
 * the list of what is waiting, and one proposal opened beside the project it
 * would replace. Everything it knows is on the screen.
 */
export class BoardProposalsPanel {
  el: HTMLDivElement
  private target: BoardProposalsTarget | null = null
  private proposals: BoardProposal[] = []
  private review: BoardProposalReview | null = null
  private phase: Phase = 'loading'
  private error = ''
  private view: View = 'both'
  private confirming = false
  private deciding: 'accept' | 'reject' | null = null
  /** Only the newest request may draw; a reopened screen ignores older replies. */
  private request = 0

  private options: BoardProposalsPanelOptions

  constructor(options: BoardProposalsPanelOptions) {
    this.options = options
    this.el = document.createElement('div')
    this.el.className = 'svPane propPane'
    this.el.innerHTML = `
      <p class="setNote" data-prop-intro></p>
      <div class="setNote saveStatus" data-prop-status role="status" aria-live="polite"></div>
      <div class="saveList" data-prop-body></div>`
    this.el.addEventListener('click', (event) => {
      const button = (event.target as HTMLElement).closest<HTMLElement>('[data-prop]')
      if (!button) return
      const action = button.dataset.prop
      const proposalId = button.dataset.proposalId ?? ''
      if (action === 'retry') void this.load()
      else if (action === 'open') void this.open(proposalId)
      else if (action === 'back') this.backToList()
      else if (action === 'view') this.setView(button.dataset.view as View)
      else if (action === 'ask') this.ask(true)
      else if (action === 'cancel') this.ask(false)
      else if (action === 'accept') void this.decide('accept')
      else if (action === 'reject') void this.decide('reject')
    })
    // Escape backs out of the confirmation first, then out of one proposal.
    // Only when the screen is a plain list does it reach the sheet.
    this.el.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || this.deciding) return
      if (this.confirming) { event.stopPropagation(); this.ask(false); return }
      if (this.review) { event.stopPropagation(); this.backToList() }
    })
  }

  /** Show this project's proposals and start loading them. */
  start(target: BoardProposalsTarget): void {
    this.target = target
    this.proposals = []
    this.review = null
    this.confirming = false
    this.deciding = null
    this.error = ''
    this.view = 'both'
    this.phase = 'loading'
    this.render()
    void this.load()
  }

  /** The project on the screen, for a caller deciding whether to reopen it. */
  currentTarget(): BoardProposalsTarget | null { return this.target }

  private async load(): Promise<void> {
    const target = this.target
    if (!target) return
    const request = ++this.request
    this.phase = 'loading'
    this.error = ''
    this.review = null
    this.confirming = false
    this.render()
    try {
      const proposals = await this.options.api.list(target.id)
      if (request !== this.request) return
      this.proposals = proposals
      this.phase = 'ready'
    } catch (error) {
      if (request !== this.request) return
      this.error = error instanceof Error ? error.message : 'Could not load proposals.'
      this.phase = 'failed'
    }
    this.render()
  }

  private async open(proposalId: string): Promise<void> {
    const target = this.target
    if (!target || !proposalId) return
    const request = ++this.request
    this.phase = 'loading'
    this.error = ''
    this.render()
    try {
      const review = await this.options.api.review(target.id, proposalId)
      if (request !== this.request) return
      this.review = review
      this.view = 'both'
      this.confirming = false
      this.phase = 'ready'
    } catch (error) {
      if (request !== this.request) return
      this.error = error instanceof Error ? error.message : 'Could not open that proposal.'
      this.phase = 'failed'
    }
    this.render()
  }

  private backToList(): void {
    if (this.deciding) return
    void this.load()
  }

  private setView(view: View): void {
    if (view !== 'current' && view !== 'proposed' && view !== 'both') return
    this.view = view
    this.render()
  }

  private ask(confirming: boolean): void {
    if (this.deciding) return
    this.confirming = confirming
    this.render()
    this.el.querySelector<HTMLElement>(confirming ? '[data-prop="accept"]' : '[data-prop="ask"]')?.focus()
  }

  private async decide(decision: 'accept' | 'reject'): Promise<void> {
    const target = this.target
    const review = this.review
    if (!target || !review || this.deciding) return
    if (decision === 'accept' && !this.confirming) return
    this.deciding = decision
    const request = ++this.request
    this.render()

    if (decision === 'reject') {
      try {
        await this.options.api.reject(target.id, review.proposal.id)
      } catch (error) {
        if (request !== this.request) return
        this.deciding = null
        this.error = error instanceof Error ? error.message : 'Could not reject that proposal.'
        this.render()
        return
      }
      if (request !== this.request) return
      this.deciding = null
      this.options.onDone(`Rejected the version proposed by ${review.proposal.author}. ${target.name} is unchanged.`, target.id)
      return
    }

    let board: AcceptedBoard
    try {
      board = await this.options.api.accept(target.id, review.proposal.id)
    } catch (error) {
      if (request !== this.request) return
      this.deciding = null
      this.error = error instanceof Error ? error.message : 'Could not accept that proposal.'
      this.render()
      return
    }
    if (request !== this.request) return
    const applied = this.options.onAccepted(board, target)
    this.deciding = null
    if (!applied) {
      this.error = 'That version could not be saved on this device. It is the current version on your account; open the project again to pull it.'
      this.render()
      return
    }
    this.confirming = false
    // settle the screen before leaving it: a caller that stays put must not be
    // left reading "Accepting…" about a decision that is made
    this.render()
    this.options.onDone(`${board.name} now uses the version proposed by ${review.proposal.author}. The version it replaced is in Version history.`, board.id)
  }

  private render(): void {
    const target = this.target
    const intro = this.el.querySelector<HTMLElement>('[data-prop-intro]')!
    const status = this.el.querySelector<HTMLElement>('[data-prop-status]')!
    const body = this.el.querySelector<HTMLElement>('[data-prop-body]')!
    if (!target) {
      intro.textContent = ''
      status.textContent = ''
      body.replaceChildren()
      return
    }
    intro.innerHTML = this.review
      ? `Proposed for <strong>${esc(target.name)}</strong> by ${esc(this.review.proposal.author)}.`
        + ' Accepting replaces the project everywhere you sync it.'
      : `Versions of <strong>${esc(target.name)}</strong> waiting for you.`
        + ' Nothing here has changed the project.'
    status.textContent = this.deciding === 'accept'
      ? 'Accepting this version…'
      : this.deciding === 'reject'
        ? 'Rejecting this version…'
        : this.phase === 'failed'
          ? `Could not load proposals: ${this.error}`
          : this.error || ''
    body.setAttribute('aria-busy', this.phase === 'loading' || !!this.deciding ? 'true' : 'false')
    body.innerHTML = this.bodyHtml()
  }

  private bodyHtml(): string {
    if (this.phase === 'loading') {
      return `<div class="setGroup"><div class="setItem setItemStatic propEmpty">Loading…</div></div>`
    }
    if (this.phase === 'failed') {
      // the reason is in the status line above, where it is also announced
      return `<div class="setGroup">
        <button class="setItem" data-prop="retry"><span class="setItemLabel">Try again</span></button>
      </div>`
    }
    return this.review ? this.reviewHtml(this.review) : this.listHtml()
  }

  private listHtml(): string {
    if (!this.proposals.length) {
      return `<div class="setGroup"><div class="setItem setItemStatic propEmpty">
        No proposals waiting. An agent link set to propose changes leaves its work here instead of changing the project.
      </div></div>`
    }
    return `<div class="setGroupHead">Waiting for you</div>
      <div class="setGroup">${this.proposals.map(proposal => this.rowHtml(proposal)).join('')}</div>`
  }

  private rowHtml(proposal: BoardProposal): string {
    const id = esc(proposal.id)
    return `<div class="setItem propItem">
      <span class="propMeta">
        <strong>${esc(proposal.author)}</strong>
        <span>${esc(proposalTimeLabel(proposal.createdAt))}${proposal.note ? ` &middot; ${esc(proposal.note)}` : ''}</span>
      </span>
      ${proposal.stale ? '<span class="propTag propStale">Out of date</span>' : ''}
      <button class="setItemAction" data-prop="open" data-proposal-id="${id}"
        aria-label="Review the version proposed by ${esc(proposal.author)}">Review changes</button>
    </div>`
  }

  private reviewHtml(review: BoardProposalReview): string {
    const changes = compareBoardDocuments(review.current, review.proposed)
    const busy = !!this.deciding
    const renamed = review.proposal.name !== review.currentName
    const views: [View, string][] = [['current', 'Current'], ['proposed', 'Proposed'], ['both', 'Side by side']]
    // the same segmented control Settings uses for theme, so the choice of
    // what is on screen reads as a setting rather than three buttons
    const toggle = `<span class="setSeg propViews" role="group" aria-label="What to show">
      ${views.map(([value, label]) => `<button type="button"${this.view === value ? ' class="active"' : ''}
        data-prop="view" data-view="${value}" aria-pressed="${this.view === value}">${label}</button>`).join('')}
    </span>`
    const summary = `<div class="propSummary">
      <span>${esc(changeSummary(changes))}</span>
      ${renamed ? `<span class="propRenamed">Renamed to "${esc(review.proposal.name)}"</span>` : ''}
      ${review.proposal.stale ? `<span class="propStaleNote">The project changed after this was proposed.
        Your version is kept in Version history if you accept it.</span>` : ''}
    </div>`
    const boards = changes.map(change => this.changeHtml(change)).join('')
    const decision = this.confirming
      ? `<span class="propConfirm" role="group" aria-label="Accept this version">
          <span class="propConfirmText">Replace the current project?</span>
          <button class="setItemAction propDo" data-prop="accept"${busy ? ' disabled' : ''}>${this.deciding === 'accept' ? 'Accepting…' : 'Accept'}</button>
          <button class="setItemAction" data-prop="cancel"${busy ? ' disabled' : ''}>Cancel</button>
        </span>`
      : `<button class="setItemAction propDo" data-prop="ask"${busy ? ' disabled' : ''}>Accept</button>
         <button class="setItemAction" data-prop="reject"${busy ? ' disabled' : ''}>${this.deciding === 'reject' ? 'Rejecting…' : 'Reject'}</button>`
    return `<div class="propHead">
        <button class="setItemAction" data-prop="back"${busy ? ' disabled' : ''}>All proposals</button>
        ${toggle}
      </div>
      ${summary}
      <div class="propBoards">${boards}</div>
      <div class="propActions">${decision}</div>`
  }

  private changeHtml(change: BoardChange): string {
    // Side by side is a comparison, so it holds only what differs. Either
    // single view is the project itself, and a project is all of its boards.
    if (change.state === 'unchanged' && this.view === 'both') return ''
    const render = this.options.renderScene
    const label = change.state === 'added' ? 'Added'
      : change.state === 'removed' ? 'Removed'
        : change.state === 'changed' ? 'Changed' : 'Unchanged'
    const pane = (title: string, scene: Scene | null, kind: string) => `<figure class="propSide${kind}">
        <figcaption>${esc(title)}</figcaption>
        ${scene ? `<span class="propPrev">${render(scene)}</span>` : '<span class="propPrev propGone">Not in this version</span>'}
      </figure>`
    const panes = this.view === 'current'
      ? pane('Current', change.current, ' propSideCurrent')
      : this.view === 'proposed'
        ? pane('Proposed', change.proposed, ' propSideProposed')
        : pane('Current', change.current, ' propSideCurrent') + pane('Proposed', change.proposed, ' propSideProposed')
    return `<section class="propBoard propBoard${change.state[0].toUpperCase()}${change.state.slice(1)}">
      <h4 class="propBoardHead">${esc(change.title)}<span class="propTag">${label}</span></h4>
      <div class="propPanes">${panes}</div>
    </section>`
  }
}
