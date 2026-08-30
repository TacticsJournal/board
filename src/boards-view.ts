import { icon } from './icons'
import { renderMarkdown } from './markdown'
import { sceneShapesSvg, scenePitchImage, boardArtDefs, boardArt } from './saves'
import { pitchById } from './pitches'
import { AddBoardChoice, AddBoardChoices } from './add-board-options'
import { isBackgroundId } from './backgrounds'
import { createBackgroundCache } from './background-cache'
import { BOARD_W, Scene } from './types'
import {
  Board, EASES, HOLD_MS, LINK_DURATIONS, Library, Project, UNTITLED,
  addBoard, boardLabel, boardName, canAnimate, canCreateProject, currentProject, firstLine, noteBody,
  easings, frameAtPos, moveBoard, newProject, orderedProjects, projectDuration, removeBoard, touch,
} from './projects'

export type BoardsHost = {
  /** Put a board of the current project into the editor. */
  openBoard: (index: number) => void
  /** Make another project current, opening its first board. */
  openProject: (id: string) => void
  /** Scene a "New board" should start from: empty, on the pitch in the editor. */
  blankScene: () => Scene
  /** Scene for a board started on a chosen pitch or saved background. */
  blankSceneOn: (pitchId: string) => Scene
  /** Everything a new board may start on. `changed` fires when a thumbnail lands. */
  addBoardChoices: (changed: () => void) => AddBoardChoices
  /**
   * Open the native picker and save what comes back as a background. Called
   * straight from the tap, because mobile Safari only opens a file chooser
   * inside the gesture. Resolves with null when the picker was backed out of.
   */
  uploadBackground: () => Promise<AddBoardUpload>
  /** The library changed; the affected Project is provided for durable saves. */
  changed: (project?: Project) => void
  /** Remove the owned durable row for a deleted project. */
  deleteProject: (id: string) => void
  /** Index of the board the editor is holding. */
  currentIndex: () => number
  /** Legacy paid-account status used by compatibility paths. */
  paid: () => boolean
  /** Open the Pro pane. */
  openPro: () => void
  /**
   * Bytes for an uploaded background, which live outside the Project: on the
   * server for a shared Project and in this device's shelf for its own. The
   * host knows which, so it does the reading; this view only caches what it
   * is given.
   */
  resolveBackground: (id: string, projectId: string) => Promise<string | null>
}

/** null is the user backing out of the native picker: nothing to say about it. */
export type AddBoardUpload = { pitchId: string } | { error: string } | null

type Screen = 'boards' | 'projects'

const ENTER_MS = 240

export class BoardsView {
  private lib!: Library
  private root: HTMLElement
  private host: BoardsHost
  private listEl!: HTMLElement
  private titleEl!: HTMLElement
  private upEl!: HTMLElement
  private footEl!: HTMLElement
  private screen: Screen = 'boards'
  private addSheet: HTMLElement | null = null
  private addIndex = 0
  private addTrigger: HTMLElement | null = null
  /** Uploaded background bytes already in hand, read once each. */
  private bg = createBackgroundCache(
    (id, projectId) => this.host.resolveBackground(id, projectId),
    () => this.backgroundArrived(),
  )
  /** Anyone drawing outside a render pass, waiting for bytes to land. */
  private bgWaiting = new Set<() => void>()

  constructor(root: HTMLElement, host: BoardsHost) {
    this.root = root
    this.host = host
    this.build()
  }

  private build() {
    this.root.classList.add('lib')
    this.root.hidden = true
    this.root.innerHTML = `
      <div class="libHead">
        <button class="libUp" data-lib="to-projects" hidden>${icon('chevron-left')}<span>Projects</span></button>
        <span class="libTitleSlot" data-lib-title></span>
        <button class="libClose" data-lib="close">Done</button>
      </div>
      <div class="libList" data-lib-list></div>
      <div class="libFoot" data-lib-foot></div>`
    this.listEl = this.root.querySelector('[data-lib-list]')!
    this.titleEl = this.root.querySelector('[data-lib-title]')!
    this.upEl = this.root.querySelector('[data-lib="to-projects"]')!
    this.footEl = this.root.querySelector('[data-lib-foot]')!
    this.root.addEventListener('click', e => this.onClick(e))
  }

  setLibrary(lib: Library) {
    this.lib = lib
    if (!this.root.hidden) this.render()
  }

  get isOpen() { return !this.root.hidden }

  /** Show Boards, or Projects, or neither. */
  open(screen: Screen | null) {
    this.closeAddSheet(false)
    if (!screen) {
      this.root.hidden = true
      document.body.classList.remove('lib-open')
      return
    }
    this.screen = screen
    this.root.hidden = false
    document.body.classList.add('lib-open')
    this.render()
    this.root.querySelectorAll<HTMLElement>('.libCard').forEach((el, i) => this.playEnter(el, i))
  }

  toggleBoards() { this.open(this.isOpen && this.screen === 'boards' ? null : 'boards') }

  /** Redraw after the editor changed the board it is holding. */
  refresh() { if (!this.root.hidden) this.render() }

  /* ---------- render ---------- */

  private preview(board: Board, projectId: string): string {
    const v = board.view
    return `<svg viewBox="${v.x} ${v.y} ${v.w} ${v.h}" preserveAspectRatio="xMidYMid meet" class="libShot">`
      + scenePitchImage(board.scene, this.background(board.scene, projectId))
      + sceneShapesSvg(board.scene) + '</svg>'
  }

  /**
   * The bytes for a scene's uploaded background, or '' until they arrive.
   *
   * The cache does the reading once; a card redrawn on every change, and a
   * frame redrawn sixty times a second, are answered from memory. What
   * arrives redraws whatever is on screen, so a view opened before the read
   * finished fills in by itself rather than waiting for a reload.
   */
  private background(scene: Scene | undefined, projectId: string): string {
    const id = scene?.pitch
    return isBackgroundId(id) ? this.bg.get(projectId, id!) : ''
  }

  private backgroundArrived() {
    if (!this.root.hidden) this.render()
    this.bgWaiting.forEach(redraw => redraw())
  }

  /** Forget resolved bytes: the account, or a shared Project's art, changed. */
  clearBackgroundCache() {
    this.bg.clear()
    this.backgroundArrived()
  }

  private render() {
    if (this.screen === 'boards') this.renderBoards()
    else this.renderProjects()
  }

  private renderBoards() {
    const project = currentProject(this.lib)
    const live = this.host.currentIndex()
    this.upEl.hidden = false
    const title = document.createElement('button')
    title.type = 'button'
    title.className = 'libTitle'
    title.dataset.lib = 'rename-current'
    title.textContent = project.name
    title.setAttribute('aria-label', `Rename project, currently ${project.name}`)
    this.titleEl.replaceChildren(title)
    this.listEl.innerHTML = project.boards.map((board, i) => {
      const line = firstLine(noteBody(board.note))
      const last = i === project.boards.length - 1
      return `<div class="libCard boardCard${i === live ? ' is-live' : ''}" data-board="${board.id}">
          <span class="boardNum">${boardLabel(project, i)}</span>
          <span class="boardShot">${this.preview(board, project.id)}</span>
          <span class="boardMeta">
            <span class="boardTitle">${escapeText(boardName(project, i))}</span>
            ${line ? `<span class="boardNote">${escapeText(line)}</span>` : '<span class="boardNote boardNote--empty">No note</span>'}
          </span>
          <span class="boardActs">
            <button data-act="up" data-id="${board.id}" title="Move earlier"${i === 0 ? ' disabled' : ''}>${icon('chevron-up')}</button>
            <button data-act="down" data-id="${board.id}" title="Move later"${last ? ' disabled' : ''}>${icon('chevron-down')}</button>
            <button data-act="del" data-id="${board.id}" title="Delete this board"${project.boards.length < 2 ? ' disabled' : ''}>${icon('trash')}</button>
          </span>
        </div>
        ${last ? '' : `<div class="libLink">
          <button data-act="dur" data-i="${i}" title="How long this move takes">${(board.link.dur / 1000).toFixed(1)}s</button>
          <button data-act="ease" data-i="${i}" title="How this move accelerates">${board.link.ease}</button>
          <button data-act="insert" data-i="${i}" title="Add a board here">${icon('plus')}</button>
        </div>`}`
    }).join('')
    const many = canAnimate(project)
    this.footEl.innerHTML = `
      <button data-act="add">${icon('plus')}Add board</button>
      <button data-act="play"${many ? '' : ' disabled title="A project needs two boards to animate"'}>${icon('player-play')}View animation</button>`
  }

  private renderProjects() {
    this.upEl.hidden = true
    const title = document.createElement('b')
    title.className = 'libTitle'
    title.textContent = 'Projects'
    this.titleEl.replaceChildren(title)
    this.listEl.innerHTML = orderedProjects(this.lib).map(project => `
      <div class="libCard projCard${project.id === this.lib.currentId ? ' is-live' : ''}" data-project="${project.id}">
        <span class="projTop">
          <span class="projName">${escapeText(project.name)}</span>
          <span class="projMeta">${project.boards.length} · ${ago(project.updated)}</span>
          <button class="projMore" data-act="rename" data-id="${project.id}" title="Rename">${icon('pencil')}</button>
          <button class="projMore" data-act="del-project" data-id="${project.id}" title="Delete"${this.lib.projects.length < 2 ? ' disabled' : ''}>${icon('trash')}</button>
        </span>
        <span class="projStrip">${project.boards.slice(0, 6).map(b => `<span>${this.preview(b, project.id)}</span>`).join('')}</span>
      </div>`).join('')
    this.footEl.innerHTML = `<button data-act="new-project">${icon('plus')}New project</button>`
      + `<span class="libCount">${this.lib.projects.length} local</span>`
  }

  private playEnter(el: HTMLElement, i: number) {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    el.animate(
      [{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }],
      { duration: ENTER_MS, delay: Math.min(i * 40, 200), easing: 'cubic-bezier(.23,1,.32,1)', fill: 'backwards' },
    )
  }

  private commit() {
    const project = currentProject(this.lib)
    touch(project)
    this.host.changed(project)
    this.render()
  }

  private renameCurrentProject() {
    const project = currentProject(this.lib)
    const input = document.createElement('input')
    input.className = 'libTitleInput'
    input.type = 'text'
    input.value = project.name
    input.placeholder = UNTITLED
    input.maxLength = 80
    input.setAttribute('aria-label', 'Project name')
    input.setAttribute('enterkeyhint', 'done')
    input.setAttribute('autocapitalize', 'sentences')
    input.setAttribute('autocorrect', 'off')
    input.spellcheck = false

    let cancelled = false
    let restoreFocus = false
    const finish = () => {
      if (!input.isConnected) return
      if (!cancelled) {
        const name = input.value.trim() || UNTITLED
        if (name !== project.name) {
          project.name = name
          touch(project)
          this.host.changed(project)
        }
      }
      this.render()
      if (restoreFocus) this.titleEl.querySelector<HTMLElement>('.libTitle')?.focus()
    }

    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault()
        restoreFocus = true
        input.blur()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        cancelled = true
        restoreFocus = true
        input.blur()
      }
    })
    input.addEventListener('blur', finish, { once: true })
    this.titleEl.replaceChildren(input)
    input.focus()
    if (project.name === UNTITLED) input.select()
    else input.setSelectionRange(input.value.length, input.value.length)
  }

  /* ---------- clicks ---------- */

  private onClick(e: MouseEvent) {
    const target = e.target as HTMLElement
    const btn = target.closest<HTMLElement>('[data-act], [data-lib]')
    if (btn) {
      const act = btn.dataset.act ?? btn.dataset.lib
      const id = btn.dataset.id ?? ''
      const i = Number(btn.dataset.i)
      const project = currentProject(this.lib)
      switch (act) {
        case 'to-projects': this.open('projects'); return
        case 'close': this.open(null); return
        case 'rename-current': this.renameCurrentProject(); return
        case 'add': this.addAfter(project.boards.length - 1, btn); return
        case 'insert': this.addAfter(i, btn); return
        case 'play': this.play(); return
        case 'up':
        case 'down': {
          const index = project.boards.findIndex(b => b.id === id)
          const to = act === 'up' ? index - 1 : index + 1
          if (index < 0 || to < 0 || to >= project.boards.length) return
          const live = this.host.currentIndex()
          moveBoard(project, index, to)
          this.commit()
          // the editor follows the board it was holding, not the position
          if (live === index) this.host.openBoard(to)
          else if (live === to) this.host.openBoard(index)
          return
        }
        case 'del': {
          if (removeBoard(project, id)) {
            const live = Math.min(this.host.currentIndex(), project.boards.length - 1)
            this.commit()
            this.host.openBoard(live)
          }
          return
        }
        case 'dur': {
          const link = project.boards[i].link
          link.dur = LINK_DURATIONS[(LINK_DURATIONS.indexOf(link.dur) + 1) % LINK_DURATIONS.length]
          this.commit()
          return
        }
        case 'ease': {
          const link = project.boards[i].link
          link.ease = EASES[(EASES.indexOf(link.ease) + 1) % EASES.length]
          this.commit()
          return
        }
        case 'new-project': {
          const project = newProject(this.host.blankScene())
          this.lib.projects.push(project)
          // Opening first lets the normal current-project save path enforce
          // the saved-board limit before this Project receives a durable row.
          this.host.openProject(project.id)
          this.host.changed(project)
          this.open('boards')
          return
        }
        case 'rename': {
          const found = this.lib.projects.find(p => p.id === id)
          if (!found) return
          const name = window.prompt('Name this project:', found.name === UNTITLED ? '' : found.name)
          if (name === null) return
          found.name = name.trim() || UNTITLED
          touch(found)
          this.host.changed(found)
          this.render()
          return
        }
        case 'del-project': {
          if (this.lib.projects.length < 2) return
          const found = this.lib.projects.find(p => p.id === id)
          if (!found) return
          if (!window.confirm(`Delete "${found.name}" and its ${found.boards.length} board${found.boards.length === 1 ? '' : 's'}?`)) return
          this.host.deleteProject(found.id)
          this.lib.projects = this.lib.projects.filter(p => p.id !== id)
          this.host.changed()
          if (this.lib.currentId === id) this.host.openProject(orderedProjects(this.lib)[0].id)
          this.render()
          return
        }
      }
    }

    const boardCard = target.closest<HTMLElement>('[data-board]')
    if (boardCard) {
      const project = currentProject(this.lib)
      const index = project.boards.findIndex(b => b.id === boardCard.dataset.board)
      if (index >= 0) { this.host.openBoard(index); this.open(null) }
      return
    }
    const projCard = target.closest<HTMLElement>('[data-project]')
    if (projCard) {
      this.host.openProject(projCard.dataset.project!)
      this.open('boards')
    }
  }

  /**
   * The Add board chooser. A new board is nearly always a new drawing rather
   * than a copy, and the pitch it is drawn on is the first decision, so the
   * pitches are here rather than a screen away in Settings. It is a sheet, not
   * a floating menu: a grid of pictures has to be able to scroll on a phone
   * without being pushed off the top of the screen.
   */
  private addAfter(index: number, trigger?: HTMLElement | null) {
    this.closeAddSheet(false)
    const current = this.host.addBoardChoices(() => this.drawAddChoices()).current
    const sheet = document.createElement('div')
    sheet.className = 'modal addBoard'
    sheet.innerHTML = `
      <div class="sheet addBoardSheet" role="dialog" aria-modal="true" aria-label="Add a board">
        <div class="sheetHead">
          <strong>Add a board</strong>
          <button data-add="close">Close</button>
        </div>
        <button class="kindOpt" data-add="copy">
          <span class="kindName">Copy this board</span>
          <span class="kindWhat">Same players, same positions.</span>
        </button>
        <button class="kindOpt" data-add="same">
          <span class="kindName">New board on ${escapeText(current.label)}</span>
          <span class="kindWhat">Empty, the pitch you are drawing on now.</span>
        </button>
        <div class="addBoardLabel">Start on another pitch</div>
        <div class="pitchGrid" data-add-grid="pitches"></div>
        <div class="addBoardLabel" data-add-bg-label>Your backgrounds</div>
        <div class="pitchGrid" data-add-grid="backgrounds"></div>
        <p class="addBoardNote" role="status" aria-live="polite" data-add-note></p>
      </div>`
    document.body.appendChild(sheet)
    this.addSheet = sheet
    this.addIndex = index
    this.addTrigger = trigger ?? null
    this.drawAddChoices()
    sheet.addEventListener('click', e => this.onAddClick(e))
    sheet.addEventListener('keydown', e => this.onAddKey(e))
    sheet.querySelector<HTMLElement>('[data-add="copy"]')?.focus()
  }

  private drawAddChoices() {
    const sheet = this.addSheet
    if (!sheet) return
    const choices = this.host.addBoardChoices(() => this.drawAddChoices())
    sheet.querySelector('[data-add-grid="pitches"]')!.innerHTML = choices.pitches.map(addTile).join('')
    sheet.querySelector('[data-add-grid="backgrounds"]')!.innerHTML =
      choices.backgrounds.map(addTile).join('') + uploadTile(choices.uploadLocked)
    // With nothing saved yet, the heading would be naming an empty shelf.
    sheet.querySelector('[data-add-bg-label]')!.textContent =
      choices.backgrounds.length ? 'Your backgrounds' : 'Your own image'
  }

  private addNote(message: string) {
    const note = this.addSheet?.querySelector<HTMLElement>('[data-add-note]')
    if (note) note.textContent = message
  }

  private onAddKey(e: KeyboardEvent) {
    if (e.key === 'Escape') { e.preventDefault(); this.closeAddSheet(); return }
    if (e.key !== 'Tab') return
    // A dialog keeps the keyboard inside itself; the board list behind it is
    // not reachable until this closes.
    const stops = Array.from(this.addSheet?.querySelectorAll<HTMLElement>('button:not([disabled])') ?? [])
    if (!stops.length) return
    const edge = e.shiftKey ? stops[0] : stops[stops.length - 1]
    if (document.activeElement !== edge) return
    e.preventDefault()
    ;(e.shiftKey ? stops[stops.length - 1] : stops[0]).focus()
  }

  private onAddClick(e: MouseEvent) {
    const sheet = this.addSheet
    if (!sheet) return
    if (e.target === sheet) { this.closeAddSheet(); return }
    const pick = (e.target as HTMLElement).closest<HTMLElement>('[data-add]')
    if (!pick) return
    const act = pick.dataset.add
    if (act === 'close') { this.closeAddSheet(); return }
    if (act === 'copy' || act === 'same') { this.addBoardHere(undefined, act === 'copy'); return }
    if (act === 'upload') { void this.uploadForNewBoard(pick); return }
    if (act !== 'pitch') return
    if (pick.dataset.locked === '1') { this.addNote('That pitch is not available for this account.'); return }
    this.addBoardHere(pick.dataset.pitch)
  }

  private async uploadForNewBoard(tile: HTMLElement) {
    if (tile.dataset.locked === '1') { this.addNote('Uploads are not available for this account.'); return }
    tile.classList.add('is-busy')
    // The picker has to be opened from inside this click, so nothing may be
    // awaited before it: the host clicks the input and hands back the promise.
    const result = await this.host.uploadBackground()
    tile.classList.remove('is-busy')
    if (!this.addSheet) return
    if (!result) return                       // the picker was backed out of
    if ('error' in result) { this.addNote(result.error); return }
    this.addBoardHere(result.pitchId)
  }

  /** Every route out of the chooser lands here: insert, open, save, close. */
  private addBoardHere(pitchId?: string, copy = false) {
    const index = this.addIndex
    const project = currentProject(this.lib)
    const scene = pitchId ? this.host.blankSceneOn(pitchId) : this.host.blankScene()
    this.closeAddSheet(false)
    addBoard(project, index, copy, scene)
    this.commit()
    this.host.openBoard(index + 1)
    this.open(null)
  }

  private closeAddSheet(restoreFocus = true) {
    const sheet = this.addSheet
    if (!sheet) return
    this.addSheet = null
    const trigger = this.addTrigger
    this.addTrigger = null
    sheet.classList.add('hidden')
    window.setTimeout(() => sheet.remove(), 400)
    if (restoreFocus && trigger?.isConnected) trigger.focus()
  }

  /* ---------- playback ---------- */

  play() {
    const project = currentProject(this.lib)
    if (!canAnimate(project)) return
    const last = project.boards.length - 1
    const total = projectDuration(project)
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)')

    const player = document.createElement('div')
    player.className = 'seqPlayer'
    player.innerHTML = `
      <div class="seqPlayer__wrap">
        <div class="seqPlayer__board" data-play="board">
          <div class="seqPlayer__stage" data-play="stage">
            <svg class="seqPlayer__svg" data-play="svg" preserveAspectRatio="xMidYMid meet">
              <g data-play="art"></g>
              <g data-play="ground"></g>
              <g data-play="shapes"></g>
            </svg>
          </div>
          <div class="seqPlayer__note" data-play="note">
            <div class="seqPlayer__noteText" data-play="caption"></div>
            <div class="seqPlayer__noteMeasure" data-play="measure" aria-hidden="true"></div>
            <div class="seqPlayer__veil"></div>
            <button class="seqPlayer__more" data-play="more" aria-label="Open the note" aria-expanded="false">${icon('chevron-up')}</button>
          </div>
        </div>
        <div class="seqPlayer__bar">
          <button class="seqPlayer__step" data-play="prev" aria-label="Previous board">${icon('chevron-left')}</button>
          <button class="seqPlayer__toggle" data-play="toggle" aria-label="Play">${icon('player-play')}</button>
          <button class="seqPlayer__step" data-play="next" aria-label="Next board">${icon('chevron-right')}</button>
          <div class="seqPlayer__dots" data-play="dots"></div>
          <span class="seqPlayer__name" data-play="name"></span>
          <span class="seqPlayer__count" data-play="count"></span>
          <button class="seqPlayer__close" data-play="close">Close</button>
        </div>
      </div>
      <div class="seqPlayer__scrim" data-play="scrim"></div>
      <div class="seqPlayer__sheet" data-play="sheet" role="dialog" aria-modal="true" aria-label="Board note" aria-hidden="true">
        <div class="seqPlayer__grip" data-play="grip"><span></span></div>
        <div class="seqPlayer__sheetHead">
          <b data-play="sheetName"></b>
          <span data-play="sheetCount"></span>
          <span class="seqPlayer__spacer"></span>
          <button class="seqPlayer__sheetClose" data-play="shut">Close</button>
        </div>
        <div class="seqPlayer__sheetBody" data-play="sheetBody"></div>
      </div>`
    document.body.appendChild(player)

    const pick = (key: string) => player.querySelector<HTMLElement>(`[data-play="${key}"]`)!
    const board = pick('board')
    const stage = pick('stage')
    const svg = pick('svg')
    const ground = pick('ground')
    const artDefs = pick('art')
    const shapes = pick('shapes')

    /* Off-screen, where each frame's markup is parsed before it is compared
       with what is already on the board. */
    const scratch = document.createElementNS('http://www.w3.org/2000/svg', 'g')

    /**
     * Put a frame's shapes on the board without replacing the shapes already
     * there. A board's objects do not come and go inside a move, so frame to
     * frame the layer is the same elements in the same order and only their
     * numbers differ: change the numbers and every element survives the move.
     *
     * This is what lets a picture stay on the board. An <image> is never
     * painted in the frame it is created, so a piece rebuilt sixty times a
     * second is forever a frame away from appearing and, on a slower device,
     * simply never arrives until the movement stops.
     */
    const paintShapes = (markup: string) => {
      scratch.innerHTML = markup
      const next = scratch.children, live = shapes.children
      let matched = next.length === live.length
      for (let i = 0; matched && i < next.length; i++) matched = next[i].tagName === live[i].tagName
      if (!matched) { shapes.replaceChildren(...Array.from(next)); return }
      for (let i = 0; i < next.length; i++) syncAttributes(live[i], next[i])
      scratch.replaceChildren()
    }

    const note = pick('note')
    const caption = pick('caption')
    const measure = pick('measure')
    const more = pick('more')
    const dots = pick('dots')
    const name = pick('name')
    const count = pick('count')
    const toggle = pick('toggle')
    const prev = pick('prev')
    const next = pick('next')
    const scrim = pick('scrim')
    const sheet = pick('sheet')
    const sheetBody = pick('sheetBody')
    const sheetName = pick('sheetName')
    const sheetCount = pick('sheetCount')

    const fills: HTMLElement[] = []
    project.boards.forEach((_, i) => {
      const dot = document.createElement('button')
      dot.className = 'seqPlayer__dot'
      dot.dataset.play = 'dot'
      dot.dataset.index = String(i)
      dot.setAttribute('aria-label', `Board ${i + 1}: ${boardName(project, i)}`)
      dot.innerHTML = '<span class="seqPlayer__dotFill"></span>'
      dots.appendChild(dot)
      fills.push(dot.firstElementChild as HTMLElement)
    })

    /* ---------- state ----------
       Two scalars carry the whole player: `pos`, where the deck stands in
       boards, and `open`, how far the note has been pulled up. Springing a
       scalar rather than a set of positions means an interrupted move carries
       on from the value on screen with the speed it already had, and a drag
       hands its release velocity straight over. */
    let pos = 0, posV = 0, posTarget = 0, posZeta = 1, posResp = 0.42
    let open = 0, openV = 0, openTarget = 0, openZeta = 1, openResp = 0.4
    let noteH = 0
    let raf = 0, lastT = 0
    let dragX = false, dragY = false
    let playing = false, playedFrom = 0
    let noteFor = -1
    let groundFor = ''

    /* Keep a useful minimum everywhere, then spend any height the full-width
       board cannot use on the note instead of leaving it blank. */
    const noteRoom = (spare: number) => {
      const viewport = window.visualViewport?.height ?? window.innerHeight
      const minimum = Math.max(76, Math.min(136, Math.round(viewport * 0.17)))
      const free = Math.max(0, Math.floor(spare))
      return { cap: Math.max(minimum, free), fill: free >= minimum ? free : 0 }
    }
    const hasProjectNotes = project.boards.some(item => item.note.trim())

    const noteHtml = (index: number) => {
      const body = renderMarkdown(project.boards[index].note).trim()
      return body || '<p class="seqPlayer__noNote">No notes on this board.</p>'
    }

    /* One band height for the whole project, measured from its longest note
       and never shorter than the room a full-width board leaves unused. A board
       with a short note, or none at all, keeps the space: the pitch is the same
       size on every board, and moving between them moves the players rather
       than the board under them.

       A note is only as tall as its column is narrow, so the band has to be
       measured at the width the board will actually have — measure it before
       the board has one and every note wraps to a ribbon. */
    let bandFor = ''
    const measureBand = (width: number, cap: number, fill: number) => {
      const key = `${width}:${cap}:${fill}`
      if (bandFor === key) return
      bandFor = key
      /* The first frame has no board width yet. Give the hidden measure its
         actual final width directly rather than relying on its parent. */
      measure.style.width = `${Math.max(1, width)}px`
      let tallest = 0
      project.boards.forEach((_, i) => {
        measure.innerHTML = noteHtml(i)
        tallest = Math.max(tallest, Math.min(measure.offsetHeight, cap))
      })
      noteH = hasProjectNotes ? Math.max(tallest, fill) : 0
      // the measure is left holding the board it was borrowed from
      if (noteFor >= 0) {
        measure.innerHTML = noteHtml(noteFor)
        note.classList.toggle('is-clipped', measure.offsetHeight > noteH + 2)
      }
    }

    /* Playback still belongs to the project: each link keeps its own duration
       and easing, so a board written to move slowly still moves slowly. */
    const posAtMs = (ms: number) => {
      let acc = 0
      for (let i = 0; i <= last; i++) {
        if (ms < acc + HOLD_MS) return i
        acc += HOLD_MS
        if (i === last) return last
        const dur = project.boards[i].link.dur
        if (ms < acc + dur) return i + easings[project.boards[i].link.ease]((ms - acc) / dur)
        acc += dur
      }
      return last
    }
    const msAtPos = (p: number) => {
      let acc = 0
      for (let i = 0; i <= last; i++) {
        if (p < i + 1 || i === last) return acc + HOLD_MS * (p >= i ? 1 : 0) + (p > i ? project.boards[i].link.dur * (p - i) : 0)
        acc += HOLD_MS + project.boards[i].link.dur
      }
      return acc
    }

    /* The player has to fit the phone it is on, not a desktop guess: the
       visual viewport is what is actually visible once the browser's own bars
       are counted, and the bar under the board is measured rather than
       assumed. The board takes the whole width and everything above the bar,
       and the note band takes a strip of that height below it. */
    const room = () => {
      const vv = window.visualViewport
      const width = vv?.width ?? window.innerWidth
      const chrome = player.querySelector<HTMLElement>('.seqPlayer__bar')?.offsetHeight ?? 52
      const height = (vv?.height ?? window.innerHeight) - chrome
      return { width: Math.max(1, width), height: Math.max(1, height) }
    }

    const setNote = (index: number) => {
      if (noteFor === index) return
      noteFor = index
      const body = noteHtml(index)
      caption.innerHTML = body
      measure.innerHTML = body
      sheetBody.innerHTML = body
      // only a note with more to it than the band holds is worth pulling up
      note.classList.toggle('is-clipped', measure.offsetHeight > noteH + 2)
      const label = boardName(project, index)
      name.textContent = label
      sheetName.textContent = label
      count.textContent = `${index + 1} / ${project.boards.length}`
      sheetCount.textContent = `Board ${index + 1} of ${project.boards.length}`
    }

    const spring = (x: number, v: number, target: number, zeta: number, response: number, dt: number): [number, number] => {
      const w = (2 * Math.PI) / response
      let steps = Math.max(1, Math.ceil(dt / (1 / 240)))
      const h = dt / steps
      while (steps--) {
        v += (-w * w * (x - target) - 2 * zeta * w * v) * h
        x += v * h
      }
      return [x, v]
    }

    const draw = () => {
      const frame = frameAtPos(project, pos)
      /* the note is written before the pitch is measured: it is part of the
         height the pitch has to fit inside, and measuring it after leaves the
         first frame taller than the screen */
      setNote(frame.current)
      const v = frame.view
      const fit = room()
      /* The board is as big as the screen allows once the note band under it
         has been paid for. The band's height depends on the board's width, and
         the width depends on the band's height, so this is two passes and no
         more: measure the band at a provisional width, fit the board around
         it, and if that changed the width enough to rewrap a note, measure and
         fit once again. */
      const stageH = (h: number) => Math.max(1, fit.height - h)
      const fitK = () => Math.min(fit.width / v.w, stageH(noteH) / v.h, 2.1)
      const fullK = Math.min(fit.width / v.w, fit.height / v.h, 2.1)
      const fullW = Math.round(v.w * fullK)
      const spare = Math.max(0, fit.height - Math.round(v.h * fullK))
      const { cap, fill } = noteRoom(spare)
      measureBand(fullW, cap, fill)
      let k = fitK()
      let w = Math.round(v.w * k)
      if (!bandFor.startsWith(`${w}:`)) {
        measureBand(w, cap, fill)
        k = fitK()
        w = Math.round(v.w * k)
      }
      stage.style.width = `${w}px`
      stage.style.height = `${Math.round(v.h * k)}px`
      /* the board keeps the view's shape; the bar under it spans the screen */
      board.style.width = `${w}px`
      svg.setAttribute('viewBox', `${v.x} ${v.y} ${v.w} ${v.h}`)
      /* the pitch is the one thing on the board that does not move, so it is
         written once and left alone: an <image> rewritten every frame has to
         be fetched and decoded again, and blinks out while it is */
      const pitch = scenePitchImage(frame.scene, this.background(frame.scene, project.id))
      if (pitch !== groundFor) { groundFor = pitch; ground.innerHTML = pitch }
      paintShapes(sceneShapesSvg(frame.scene, {
        fading: frame.fading, fade: frame.exitAlpha,
        arriving: frame.arriving, arrive: frame.enterAlpha,
        riding: frame.riding, ride: frame.rideAlpha,
        art: 'point',
      }))
      /* the words fade through the middle of a move, so the swap and the height
         change both happen while there is nothing to read */
      caption.style.opacity = frame.noteAlpha.toFixed(3)
      note.style.height = `${Math.round(noteH)}px`
      note.classList.toggle('is-bare', noteH === 0)
      fills.forEach((el, i) => {
        el.style.transform = `scaleX(${Math.max(0, Math.min(1, pos - i + 1)).toFixed(3)})`
      })

      const live = open > 0.001
      sheet.style.transform = `translate3d(0, ${((1 - open) * 100).toFixed(3)}%, 0)`
      sheet.classList.toggle('is-live', live)
      sheet.setAttribute('aria-hidden', live ? 'false' : 'true')
      scrim.style.opacity = (open * 0.55).toFixed(3)
      scrim.classList.toggle('is-live', open > 0.5)
      more.setAttribute('aria-expanded', open > 0.5 ? 'true' : 'false')
      board.style.transform = `scale(${(1 - 0.035 * open).toFixed(4)})`
      ;(prev as HTMLButtonElement).disabled = !playing && posTarget <= 0.001
      ;(next as HTMLButtonElement).disabled = !playing && posTarget >= last - 0.001
    }

    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - lastT) / 1000 || 0)
      lastT = now
      if (playing) {
        const ms = now - playedFrom
        pos = posAtMs(ms)
        posTarget = Math.round(pos)
        posV = 0
        if (ms >= total) { pos = last; stop() }
      } else if (!dragX) {
        ;[pos, posV] = spring(pos, posV, posTarget, posZeta, posResp, dt)
      }
      if (!dragY) [open, openV] = spring(open, openV, openTarget, openZeta, openResp, dt)
      draw()

      const still = !dragX && !dragY && !playing
        && Math.abs(pos - posTarget) < 0.0015 && Math.abs(posV) < 0.0015
        && Math.abs(open - openTarget) < 0.0015 && Math.abs(openV) < 0.0015
      if (still) {
        pos = posTarget; posV = 0
        open = openTarget; openV = 0
        draw()
        raf = 0
        return
      }
      raf = requestAnimationFrame(tick)
    }
    const run = () => { if (!raf) { lastT = performance.now(); raf = requestAnimationFrame(tick) } }

    const goTo = (index: number, opts: { bounce?: boolean; response?: number } = {}) => {
      posTarget = Math.max(0, Math.min(last, index))
      posZeta = opts.bounce ? 0.86 : 1
      posResp = opts.response ?? 0.42
      if (reduce.matches) { pos = posTarget; posV = 0 }
      run()
    }
    const step = (by: number) => { stop(); goTo(Math.round(posTarget) + by) }

    const openNote = (opts: { bounce?: boolean; response?: number; keepScroll?: boolean } = {}) => {
      openTarget = 1
      openZeta = opts.bounce ? 0.86 : 1
      openResp = opts.response ?? 0.4
      if (!opts.keepScroll) sheetBody.scrollTop = 0
      if (reduce.matches) { open = 1; openV = 0 }
      run()
    }
    const shutNote = (opts: { bounce?: boolean; response?: number } = {}) => {
      openTarget = 0
      openZeta = opts.bounce ? 0.86 : 1
      openResp = opts.response ?? 0.4
      if (reduce.matches) { open = 0; openV = 0 }
      run()
    }

    function start() {
      playing = true
      playedFrom = performance.now() - (pos >= last ? 0 : msAtPos(pos))
      toggle.innerHTML = icon('player-pause')
      toggle.setAttribute('aria-label', 'Pause')
      run()
    }
    function stop() {
      if (!playing) return
      playing = false
      posTarget = Math.round(pos)
      posV = 0
      toggle.innerHTML = icon('player-play')
      toggle.setAttribute('aria-label', 'Play')
      run()
    }

    /* ---------- gestures ----------
       Land where the flick was going rather than where it stopped, the way a
       scroll view decides where to come to rest. */
    const rubber = (over: number, dim: number, c = 0.55) => (over * dim * c) / (dim + c * Math.abs(over))
    const project_ = (vel: number, d = 0.996) => (vel / 1000) * d / (1 - d)

    let fromX = 0, fromPos = 0, trailX: { v: number; t: number }[] = []
    stage.addEventListener('pointerdown', (e) => {
      if (e.button) return
      stop()
      dragX = true
      stage.classList.add('is-dragging')
      stage.setPointerCapture(e.pointerId)
      fromX = e.clientX
      fromPos = pos
      posV = 0
      trailX = [{ v: e.clientX, t: performance.now() }]
      run()
    })
    stage.addEventListener('pointermove', (e) => {
      if (!dragX) return
      const width = stage.getBoundingClientRect().width
      let at = fromPos - (e.clientX - fromX) / width
      if (at < 0) at = rubber(at, 1)
      if (at > last) at = last + rubber(at - last, 1)
      pos = at
      trailX.push({ v: e.clientX, t: performance.now() })
      if (trailX.length > 6) trailX.shift()
    })
    const endX = (e: PointerEvent) => {
      if (!dragX) return
      dragX = false
      stage.classList.remove('is-dragging')
      const width = stage.getBoundingClientRect().width
      const a = trailX[0], b = trailX[trailX.length - 1]
      const vel = -((b.v - a.v) / width) / (Math.max(16, b.t - a.t) / 1000)
      posV = vel
      /* a deck moves one board at a time however hard it is thrown */
      const landing = Math.max(fromPos - 1, Math.min(fromPos + 1, pos + project_(vel)))
      goTo(Math.round(landing), { bounce: Math.abs(vel) > 0.6, response: 0.4 })
      if (stage.hasPointerCapture(e.pointerId)) stage.releasePointerCapture(e.pointerId)
    }
    stage.addEventListener('pointerup', endX)
    stage.addEventListener('pointercancel', endX)

    /* the note, pulled up: tracked against the distance it travels, so it is
       glued to the finger the whole way */
    let fromY = 0, fromOpen = 0, trailY: { v: number; t: number }[] = []
    const travel = () => Math.max(240, (window.visualViewport?.height ?? window.innerHeight) - noteH)
    const startY = (e: PointerEvent) => {
      dragY = true
      fromY = e.clientY
      fromOpen = open
      openV = 0
      trailY = [{ v: e.clientY, t: performance.now() }]
      run()
    }
    const moveY = (e: PointerEvent) => {
      if (!dragY) return
      let at = fromOpen + (fromY - e.clientY) / travel()
      if (at > 1) at = 1 + rubber(at - 1, 1) * 0.4
      if (at < 0) at = rubber(at, 1) * 0.4
      open = at
      trailY.push({ v: e.clientY, t: performance.now() })
      if (trailY.length > 6) trailY.shift()
    }
    const endY = () => {
      if (!dragY) return
      dragY = false
      const a = trailY[0], b = trailY[trailY.length - 1]
      const vel = ((a.v - b.v) / travel()) / (Math.max(16, b.t - a.t) / 1000)
      openV = vel
      const landing = open + project_(vel)
      const opts = { bounce: Math.abs(vel) > 0.8, response: 0.4, keepScroll: true }
      landing > 0.5 ? openNote(opts) : shutNote(opts)
    }

    note.addEventListener('pointerdown', (e) => {
      if (e.button || !note.classList.contains('is-clipped')) return
      if ((e.target as HTMLElement).closest('[data-play="more"]')) return
      note.setPointerCapture(e.pointerId)
      startY(e)
    })
    note.addEventListener('pointermove', moveY)
    note.addEventListener('pointerup', endY)
    note.addEventListener('pointercancel', endY)

    const grip = pick('grip')
    grip.addEventListener('pointerdown', (e) => {
      if (e.button) return
      grip.setPointerCapture(e.pointerId)
      startY(e)
    })
    grip.addEventListener('pointermove', moveY)
    grip.addEventListener('pointerup', endY)
    grip.addEventListener('pointercancel', endY)

    /* the sheet itself closes on a pull down, but only once the words are
       already scrolled back to the top */
    sheetBody.addEventListener('pointerdown', (e) => {
      if (e.button || sheetBody.scrollTop > 0) return
      startY(e)
    })
    sheetBody.addEventListener('pointermove', (e) => {
      if (!dragY) return
      if (open >= 1 && e.clientY < fromY) { endY(); return }
      moveY(e)
    })
    sheetBody.addEventListener('pointerup', endY)
    sheetBody.addEventListener('pointercancel', endY)

    let settle = 0
    const wheelSettle = () => {
      window.clearTimeout(settle)
      settle = window.setTimeout(() => {
        dragY = false
        const opts = { response: 0.34, keepScroll: true }
        open > 0.5 ? openNote(opts) : shutNote(opts)
      }, 110)
    }
    note.addEventListener('wheel', (e) => {
      if (!note.classList.contains('is-clipped') || e.deltaY <= 0) return
      e.preventDefault()
      dragY = true
      open = Math.max(0, Math.min(1, open + e.deltaY / travel()))
      run()
      wheelSettle()
    }, { passive: false })
    sheetBody.addEventListener('wheel', (e) => {
      if (e.deltaY >= 0 || sheetBody.scrollTop > 0) return
      e.preventDefault()
      dragY = true
      open = Math.max(0, Math.min(1, open + e.deltaY / travel()))
      run()
      wheelSettle()
    }, { passive: false })

    /* a new width or height is a new band: notes wrap differently and the
       board may leave a different amount of the page free for them */
    const onResize = () => { bandFor = ''; noteFor = -1; setNote(frameAtPos(project, pos).current); run() }
    /* bytes that land mid-playback are drawn as soon as they do: the board
       fills in where it stands rather than waiting for the next movement */
    const onBackground = () => draw()
    this.bgWaiting.add(onBackground)
    const close = () => {
      playing = false
      if (raf) cancelAnimationFrame(raf)
      this.bgWaiting.delete(onBackground)
      player.remove()
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', onResize)
      window.visualViewport?.removeEventListener('resize', onResize)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === 'Escape') {
        e.stopPropagation()
        openTarget > 0.5 ? shutNote() : close()
        return
      }
      if (e.key === 'ArrowRight') { e.preventDefault(); step(1) }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1) }
      else if (e.key === 'Home') { e.preventDefault(); stop(); goTo(0, { response: 0.5 }) }
      else if (e.key === 'End') { e.preventDefault(); stop(); goTo(last, { response: 0.5 }) }
      else if (e.key === ' ') {
        e.preventDefault()
        if (openTarget > 0.5) { shutNote(); return }
        if (playing) stop()
        else start()
      }
    }

    player.addEventListener('click', (e) => {
      const hit = (e.target as HTMLElement).closest<HTMLElement>('[data-play]')
      const act = hit?.dataset.play
      if (act === 'close') close()
      else if (act === 'toggle') playing ? stop() : start()
      else if (act === 'prev') step(-1)
      else if (act === 'next') step(1)
      else if (act === 'more') openNote()
      else if (act === 'shut' || act === 'scrim') shutNote()
      else if (act === 'dot') { stop(); goTo(Number(hit!.dataset.index)) }
    })
    document.addEventListener('keydown', onKey)
    window.addEventListener('resize', onResize)
    window.visualViewport?.addEventListener('resize', onResize)

    /* every picture this project draws, written once so that the pieces point
       at art already in hand rather than each carrying its own copy, and every
       one of them fetched now: a picture only loads once something points at
       it, so a cone first drawn mid-move would arrive a download late */
    const scenes = project.boards.map(b => b.scene)
    artDefs.innerHTML = boardArtDefs(scenes)
    /* an uploaded background is read from storage rather than fetched, so the
       read for every board is started here too, once each */
    for (const scene of scenes) this.background(scene, project.id)
    const pictures = [...project.boards.map(b => pitchById(b.scene.pitch).src), ...boardArt(scenes).map(a => a.src)]
    for (const src of pictures) {
      if (!src) continue
      const img = new Image()
      img.src = src
      // fetched is not ready: decoding is what a piece waits on when it is drawn
      img.decode?.().catch(() => {})
    }

    setNote(0)
    draw()
  }
}

/* ---------- helpers ---------- */

/** One pitch or saved background, as a picture of the board it makes. */
function addTile(choice: AddBoardChoice): string {
  const shot = choice.art
    ? `<img class="pitchShotImg" src="${escapeText(choice.art)}" alt="">`
    : '<span class="pitchShotEmpty"></span>'
  const tag = choice.locked ? '<span class="setTag pitchTag">Unavailable</span>' : ''
  const tick = choice.current && !choice.locked ? `<span class="pitchTick">${icon('check', 'ic')}</span>` : ''
  const size = `${BOARD_W} \u00d7 ${choice.boardH}`
  return `<button class="pitchTile${choice.current ? ' on' : ''}" data-add="pitch" data-pitch="${escapeText(choice.id)}"${choice.locked ? ' data-locked="1"' : ''}
      aria-label="${escapeText(choice.label)}, ${size}${choice.locked ? ', unavailable' : ''}">
    <span class="pitchShot">${shot}${tick}${tag}</span>
    <span class="pitchTileName">${escapeText(choice.label)}</span>
    <span class="pitchTileSub">${size}</span>
  </button>`
}

function uploadTile(locked: boolean): string {
  return `<button class="pitchTile pitchAdd" data-add="upload"${locked ? ' data-locked="1"' : ''}
      aria-label="Upload image${locked ? ', unavailable' : ''}">
    <span class="pitchShot pitchAddShot">${icon('plus')}${locked ? '<span class="setTag pitchTag">Unavailable</span>' : ''}</span>
    <span class="pitchTileName">Upload image</span>
    <span class="pitchTileSub">Photo or screenshot</span>
  </button>`
}

function escapeText(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** Rough, friendly, and never wrong enough to matter. */
function ago(ms: number): string {
  const mins = Math.max(0, Math.round((Date.now() - ms) / 60000))
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.round(hours / 24)
  if (days === 1) return 'yesterday'
  if (days < 7) return `${days} days ago`
  const weeks = Math.round(days / 7)
  return weeks < 5 ? `${weeks} week${weeks === 1 ? '' : 's'} ago` : new Date(ms).toLocaleDateString()
}

export type { Project, Library }

/** Make one element read like another without replacing it. */
function syncAttributes(live: Element, next: Element): void {
  for (const attr of Array.from(next.attributes)) {
    if (live.getAttribute(attr.name) !== attr.value) live.setAttribute(attr.name, attr.value)
  }
  for (const attr of Array.from(live.attributes)) {
    if (!next.hasAttribute(attr.name)) live.removeAttribute(attr.name)
  }
  // a label is its text; nothing this layer draws nests any deeper
  if (!next.children.length && !live.children.length && live.textContent !== next.textContent) {
    live.textContent = next.textContent
  }
}
