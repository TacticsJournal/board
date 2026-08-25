import { agentImportFile, agentImportSource, boardImportReadyRows, decodeAgentImport, fetchAgentImport, STORED_PROJECT_IMPORT_LIMITS, type AgentImportDraft, type BoardImportReadyRow } from './agent-import.ts'
import { previewSvg } from './saves.ts'

type ImportSaves = {
  hasImport: (id: string) => boolean
  importFile: (text: string) => number
}

export type BoardImportDestination = { id: string; name: string; boardCount: number }
export type BoardImportResult = {
  status: 'added' | 'failed'
  projectId?: string
  projectName?: string
  boardId?: string
  message?: string
}

type Options = {
  saves: ImportSaves
  isPro: () => boolean
  openSignIn: () => void
  openPro: () => void
  openProjects: () => void
  boardDestinations: () => BoardImportDestination[]
  canCreateProject: () => boolean
  addBoard: (draft: AgentImportDraft, projectId: string | null) => BoardImportResult
  addProject: (draft: AgentImportDraft) => BoardImportResult
  openProject: (id: string, boardId?: string) => void
}

type Access = 'checking' | 'signed-out' | 'locked' | 'ready'
type Result = 'added' | 'existing' | 'failed' | null

/** Start the add prompt only for a generated project or shared-copy URL. */
export function startAgentImport(options: Options): boolean {
  if (window.location.pathname !== '/import') return false
  const source = agentImportSource(window.location)
  const boardLink = source?.kind === 'board' || source?.kind === 'stored-board'
  const projectCopyLink = source?.kind === 'project-copy' || source?.kind === 'stored-project-copy'
  const copyLink = boardLink || projectCopyLink

  const dialog = document.createElement('dialog')
  dialog.className = copyLink ? 'agentImportDialog agentImportBoard' : 'agentImportDialog'
  dialog.setAttribute('aria-labelledby', 'agent-import-title')
  dialog.innerHTML = copyLink ? `
    <button type="button" class="agentImportClose" data-agent-import="close" aria-label="Close without adding">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><path d="M3.5 3.5l9 9M12.5 3.5l-9 9"/></svg>
    </button>
    <div class="agentImportPreview" data-agent-import-preview></div>
    <div class="agentImportStep">
      <div class="agentImportStepHead">
        <button type="button" class="agentImportBack" data-agent-import="destination-back" hidden>
          <svg width="9" height="14" viewBox="0 0 8 14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M6.5 1l-5 6 5 6"/></svg>
          Back
        </button>
        <h2 id="agent-import-title" class="agentImportPrompt" data-agent-import-title tabindex="-1">Opening ${projectCopyLink ? 'project' : 'board'}…</h2>
      </div>
      <p class="agentImportSub" data-agent-import-copy role="status" aria-live="polite"></p>
      <div class="agentImportRows" data-agent-import-rows hidden></div>
      <div class="agentImportProjects" data-agent-import-projects hidden></div>
    </div>` : `
    <div class="agentImportHead">
      <h2 id="agent-import-title" data-agent-import-title>Add to Projects</h2>
    </div>
    <div class="agentImportMeta" data-agent-import-meta hidden>
      <strong data-agent-import-name></strong>
      <span data-agent-import-count></span>
    </div>
    <div class="agentImportPreview" data-agent-import-preview hidden></div>
    <div class="agentImportCopy">
      <p data-agent-import-copy role="status" aria-live="polite">Opening project link…</p>
    </div>
    <div class="agentImportProjects" data-agent-import-projects hidden></div>
    <div class="agentImportActions" data-agent-import-actions></div>`
  document.body.appendChild(dialog)

  const title = dialog.querySelector<HTMLElement>('[data-agent-import-title]')!
  const meta = dialog.querySelector<HTMLElement>('[data-agent-import-meta]')
  const name = dialog.querySelector<HTMLElement>('[data-agent-import-name]')
  const count = dialog.querySelector<HTMLElement>('[data-agent-import-count]')
  const preview = dialog.querySelector<HTMLElement>('[data-agent-import-preview]')!
  const copy = dialog.querySelector<HTMLElement>('[data-agent-import-copy]')!
  const projects = dialog.querySelector<HTMLElement>('[data-agent-import-projects]')!
  const actions = dialog.querySelector<HTMLElement>('[data-agent-import-actions]')
  const rows = dialog.querySelector<HTMLElement>('[data-agent-import-rows]')
  const back = dialog.querySelector<HTMLButtonElement>('.agentImportBack')
  let draft: AgentImportDraft | null = null
  let error = source ? '' : `This ${copyLink ? projectCopyLink ? 'project' : 'board' : 'project'} link is invalid.`
  let access: Access = copyLink ? 'ready' : options.isPro() ? 'ready' : 'checking'
  let result: Result = null
  let adding = false
  let picking = false
  let suspended = false
  let addedProjectId = ''
  let addedProjectName = ''
  let addedBoardId = ''
  let failureMessage = ''

  const button = (label: string, action: string, primary = false) => {
    const element = document.createElement('button')
    element.type = 'button'
    element.dataset.agentImport = action
    element.textContent = label
    if (primary) element.className = 'agentImportPrimary'
    return element
  }
  const setActions = (...buttons: HTMLButtonElement[]) => {
    actions!.replaceChildren(...buttons)
    const preferred = buttons.find(item => item.classList.contains('agentImportPrimary')) ?? buttons[0]
    queueMicrotask(() => { if (dialog.open && preferred?.isConnected) preferred.focus() })
  }
  const projectSummary = () => `${draft!.boardCount} board${draft!.boardCount === 1 ? '' : 's'}`
  const hideProjects = () => { projects.hidden = true; projects.replaceChildren() }
  const hideRows = () => { if (rows) { rows.hidden = true; rows.replaceChildren() } }
  const focusHeading = () => queueMicrotask(() => { if (dialog.open && title.isConnected) title.focus({ preventScroll: true }) })

  const boardRow = (item: BoardImportReadyRow) => {
    const element = document.createElement('button')
    element.type = 'button'
    element.className = `agentImportRow${item.primary ? ' agentImportRowPrimary' : ''}`
    element.dataset.agentImport = item.action
    const text = document.createElement('span')
    text.className = 'agentImportRowText'
    const label = document.createElement('b')
    label.textContent = item.label
    const detail = document.createElement('span')
    detail.textContent = item.detail
    text.append(label, detail)
    element.append(text)
    if (item.chevron) {
      const chevron = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
      chevron.classList.add('agentImportChev')
      chevron.setAttribute('width', '9')
      chevron.setAttribute('height', '14')
      chevron.setAttribute('viewBox', '0 0 8 14')
      chevron.setAttribute('fill', 'none')
      chevron.setAttribute('stroke', 'currentColor')
      chevron.setAttribute('stroke-width', '1.8')
      chevron.setAttribute('stroke-linecap', 'round')
      chevron.setAttribute('aria-hidden', 'true')
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
      path.setAttribute('d', 'M1.5 1l5 6-5 6')
      chevron.append(path)
      element.append(chevron)
    }
    return element
  }
  const setRows = (...items: BoardImportReadyRow[]) => {
    hideProjects()
    rows!.hidden = items.length === 0
    rows!.replaceChildren(...items.map(boardRow))
  }

  function renderCopyLink() {
    hideRows()
    hideProjects()
    back!.hidden = true
    preview.hidden = !!error || picking
    if (draft && !error && !preview.hasChildNodes()) preview.innerHTML = previewSvg(draft.previewScene)

    if (error) {
      dialog.dataset.agentImportState = 'error'
      title.textContent = projectCopyLink ? "Can't open project" : "Can't open board"
      copy.textContent = error
      setRows({ label: 'Close', detail: 'Return to the board', action: 'close', primary: true })
      focusHeading()
      return
    }
    if (!draft) {
      dialog.dataset.agentImportState = 'loading'
      title.textContent = projectCopyLink ? 'Opening project…' : 'Opening board…'
      copy.textContent = ''
      focusHeading()
      return
    }
    if (picking) {
      dialog.dataset.agentImportState = 'picking'
      preview.hidden = true
      back!.hidden = false
      title.textContent = `Add “${draft.name}” to…`
      copy.textContent = ''
      projects.hidden = false
      projects.replaceChildren(...options.boardDestinations().map(item => {
        const element = document.createElement('button')
        element.type = 'button'
        element.dataset.agentImportProject = item.id
        const label = document.createElement('strong')
        label.textContent = item.name
        const detail = document.createElement('span')
        detail.textContent = `${item.boardCount} board${item.boardCount === 1 ? '' : 's'}`
        element.append(label, detail)
        return element
      }))
      focusHeading()
      return
    }
    if (adding) {
      dialog.dataset.agentImportState = 'adding'
      title.textContent = projectCopyLink ? 'Add a copy to your projects' : 'Add a copy to your boards'
      copy.textContent = projectCopyLink ? 'Adding project…' : 'Adding board…'
      focusHeading()
      return
    }
    if (result === 'added') {
      dialog.dataset.agentImportState = 'added'
      title.textContent = `Added to ${addedProjectName}`
      copy.textContent = "It's yours to edit now."
      setRows(
        { label: addedProjectId ? 'Open project' : 'View Projects', detail: addedProjectId ? 'Go straight to the board' : 'Find your imported board', action: addedProjectId ? 'open-project' : 'projects', primary: true },
        { label: 'Done', detail: 'Keep browsing', action: 'close' },
      )
      focusHeading()
      return
    }
    if (result === 'failed') {
      dialog.dataset.agentImportState = 'failed'
      title.textContent = projectCopyLink ? "Couldn't add project" : "Couldn't add board"
      copy.textContent = failureMessage || 'Free some browser storage and try again.'
      setRows(
        { label: 'Try again', detail: projectCopyLink ? 'Add it as a new project' : 'Choose where it goes', action: 'destination-back', primary: true },
        { label: 'Close', detail: 'Keep browsing', action: 'close' },
      )
      focusHeading()
      return
    }

    dialog.dataset.agentImportState = 'ready'
    title.textContent = projectCopyLink ? 'Add a copy to your projects' : 'Add a copy to your boards'
    copy.textContent = 'The original stays with whoever shared it.'
    if (projectCopyLink) {
      if (options.canCreateProject()) {
        setRows({
          label: 'New project', detail: `Creates “${draft.name}” with ${projectSummary()}`,
          action: 'new-project', primary: true,
        })
      } else {
        copy.textContent = 'Free keeps three projects. This shared project has not been added.'
        setRows(
          { label: 'View Projects', detail: 'Delete a project to make room', action: 'projects', primary: true },
          { label: 'See License', detail: 'Keep unlimited projects on this device', action: 'pro' },
        )
      }
    } else {
      const destinations = options.boardDestinations()
      setRows(...boardImportReadyRows(draft.name, destinations.length, options.canCreateProject()))
    }
    focusHeading()
  }

  function render() {
    if (copyLink) { renderCopyLink(); return }
    hideProjects()
    meta!.hidden = !draft || !!error
    preview.hidden = !draft || !!error || result === 'added' || result === 'existing'
    if (draft && !error) {
      name!.textContent = draft.name
      count!.textContent = projectSummary()
      if (!preview.hasChildNodes()) preview.innerHTML = previewSvg(draft.previewScene)
    }
    if (error) {
      title.textContent = "Can't open project"
      copy.textContent = error
      setActions(button('Close', 'close', true))
      return
    }
    if (!draft) {
      title.textContent = 'Add to Projects'
      copy.textContent = 'Opening project link…'
      setActions(button('Cancel', 'close'))
      return
    }
    if (result === 'added' || result === 'existing') {
      title.textContent = result === 'added' ? 'Added to Projects' : 'Already in Projects'
      copy.textContent = result === 'added' ? 'You can find it in Projects.' : 'This link has already been added.'
      setActions(button('Done', 'close'), button('View Projects', 'projects', true))
      return
    }
    if (result === 'failed') {
      title.textContent = "Couldn't add project"
      copy.textContent = failureMessage || 'Free some browser storage and try again.'
      setActions(button('Cancel', 'close'), button('Try again', 'add', true))
      return
    }
    if (access === 'checking') {
      copy.textContent = 'Checking Pro access…'
      setActions(button('Cancel', 'close'))
      return
    }
    if (access === 'signed-out') {
      copy.textContent = 'Sign in to Tactics Journal to add this project.'
      setActions(button('Cancel', 'close'), button('Sign in', 'signin', true))
      return
    }
    if (access === 'locked') {
      copy.textContent = 'Adding projects from Claude or ChatGPT comes with Pro.'
      setActions(button('Cancel', 'close'), button('See Pro', 'pro', true))
      return
    }
    copy.textContent = 'Your current board stays open.'
    const add = button('Add to Projects', 'add', true)
    add.autofocus = true
    setActions(button('Cancel', 'close'), add)
  }

  function destroy() {
    history.replaceState(null, '', window.location.pathname)
    window.removeEventListener('tacticsjournal:auth-changed', onAuth)
    dialog.remove()
  }
  function closeTemporarily() {
    suspended = true
    dialog.close()
    suspended = false
  }
  function onAuth(event: Event) {
    if (copyLink) return
    const detail = (event as CustomEvent).detail
    access = options.isPro() || detail?.site_access === 'pro'
      ? 'ready'
      : detail?.authenticated === true ? 'locked' : 'signed-out'
    render()
    if (!dialog.open) dialog.showModal()
  }

  function addCopy(projectId: string | null) {
    if (!draft || adding) return
    adding = true
    picking = false
    result = null
    failureMessage = ''
    render()
    const outcome = projectCopyLink ? options.addProject(draft) : options.addBoard(draft, projectId)
    adding = false
    result = outcome.status
    addedProjectId = outcome.projectId ?? ''
    addedProjectName = outcome.projectName ?? 'Projects'
    addedBoardId = outcome.boardId ?? ''
    failureMessage = outcome.message ?? ''
    render()
  }

  dialog.addEventListener('close', () => { if (!suspended) destroy() })
  dialog.addEventListener('cancel', () => { destroy() })
  dialog.addEventListener('click', (event) => {
    const projectId = (event.target as HTMLElement).closest<HTMLElement>('[data-agent-import-project]')?.dataset.agentImportProject
    if (projectId && boardLink) { addCopy(projectId); return }
    const action = (event.target as HTMLElement).closest<HTMLElement>('[data-agent-import]')?.dataset.agentImport
    if (!action || adding) return
    if (action === 'close') { dialog.close(); return }
    if (action === 'projects') { dialog.close(); options.openProjects(); return }
    if (action === 'open-project' && addedProjectId) { dialog.close(); options.openProject(addedProjectId, addedBoardId); return }
    if (action === 'pro') { dialog.close(); options.openPro(); return }
    if (action === 'signin') { closeTemporarily(); options.openSignIn(); return }
    if (copyLink && action === 'new-project') { addCopy(null); return }
    if (boardLink && action === 'existing') { picking = true; render(); return }
    if (copyLink && action === 'destination-back') { picking = false; result = null; render(); return }
    if (action !== 'add' || !draft || access !== 'ready') return
    adding = true
    result = null
    copy.textContent = 'Adding to Projects…'
    setActions(button('Adding…', 'none', true))
    try {
      if (options.saves.hasImport(draft.draftId)) result = 'existing'
      else result = options.saves.importFile(agentImportFile(draft)) > 0 ? 'added' : 'existing'
    } catch { result = 'failed' }
    adding = false
    render()
  })

  window.addEventListener('tacticsjournal:auth-changed', onAuth)
  dialog.showModal()
  if (source) {
    const payload = source.kind === 'stored' || source.kind === 'stored-board' || source.kind === 'stored-project-copy'
      ? fetchAgentImport(source.value)
      : Promise.resolve(source.value)
    const limits = source.kind === 'stored-project-copy' ? STORED_PROJECT_IMPORT_LIMITS : undefined
    void payload.then(value => decodeAgentImport(value, limits)).then(value => {
      if (boardLink && (!('boards' in value.document) || value.document.boards.length !== 1)) {
        throw new Error('This board link is invalid.')
      }
      if (projectCopyLink && !('boards' in value.document)) throw new Error('This project link is invalid.')
      draft = value
      render()
    }).catch(reason => {
      error = reason instanceof Error ? reason.message : `This ${projectCopyLink ? 'project' : boardLink ? 'board' : 'project'} link is invalid.`
      render()
    })
  } else render()
  return true
}
