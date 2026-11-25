import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const saves = await readFile(new URL('../src/saves.ts', import.meta.url), 'utf8')
const view = await readFile(new URL('../src/boards-view.ts', import.meta.url), 'utf8')
const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8')
const main = await readFile(new URL('../src/main.ts', import.meta.url), 'utf8')
const header = await readFile(new URL('../src/tjheader.ts', import.meta.url), 'utf8')

test('saved-board writes have no automatic truncation or eviction path', () => {
  assert.doesNotMatch(saves, /MAX_BOARDS|\.slice\(MAX_BOARDS\)|oldest saves are dropped/)
  assert.match(saves, /writeSavedBoards\(localStorage, storageKey, all\)/)
  assert.match(saves, /storedSetIsWritable\(storageKey\)/)
  assert.match(saves, /Merge without eviction/)
})

test('saved documents use the Project-or-Scene union without flattening sequences', () => {
  assert.match(saves, /scene: BoardDocument/)
  assert.match(saves, /setDocumentAdapter\(getDocument: BoardDocumentAdapter\['getDocument'\], loadDocument: BoardDocumentAdapter\['loadDocument'\]\)/)
  assert.match(saves, /loadDocument\(document, \{ name, id: p\.id \?\? null \}\)/)
  assert.match(saves, /activateDocument\(documentId: string\)/)
  assert.match(saves, /removeDocument\(documentId: string\)/)
  assert.match(saves, /if \(!saved\.id\) \{[\s\S]*saved\.id = newId\(\)/)
  assert.match(main, /saves\.setDocumentAdapter\(\(\) => currentProject\(library\), loadSavedDocument\)/)
  assert.match(main, /const migrated = migrateProject\(document\)/)
  assert.match(main, /installProject\(project, preferredBoardId\)/)
  // an explicit board beats the remembered one, which beats board 0
  assert.match(main, /editingBoard = preferred >= 0 \? preferred : Math\.max\(0, storedBoardIndex\(library, project\)\)/)
  assert.match(main, /function saveProjectChanges\(project: Project = currentProject\(library\)\) \{\s*documentChangeGeneration \+= 1/)
  assert.match(saves, /projectDocuments\(\): SavedProjectDocument\[\]/)
  assert.match(saves, /persistProjectDocuments\(projects: readonly Project\[\]\): boolean/)
  assert.match(saves, /id: existing\?\.id \|\| newId\(\)/)
  assert.match(main, /reconcileLibraryProjectDocuments\(\{ seedMissing: !freshStarter \}\)[\s\S]*if \(!saves\.activateDocument\(library\.currentId\)\)/)
  assert.match(main, /if \(!freshStarter\) saves\.registerNew\(\)/)
  // Snapshots and conflict copies serialize the adapter's full normalized document.
  assert.match(saves, /scene: this\.documentForSave\(\)/)
  const imported = saves.match(/importFile\(text: string\)[\s\S]*?\n  }\n\n  resetProjects/)?.[0] ?? ''
  assert.match(imported, /const normalized = tryNormalizeBoardDocument\(p\.scene\)/)
  assert.match(imported, /const rawDocument = JSON\.parse\(JSON\.stringify\(p\.scene\)\)/)
  assert.match(imported, /normalizeDocumentArrowLegends\(rawDocument, normalized\)/)
  assert.match(imported, /scene: storedDocument/)
  assert.match(imported, /const rowCollision = id \? Object\.values\(all\)\.find/)
  assert.match(imported, /id = newId\(\)/)
  assert.match(imported, /const projectCollision = Object\.values\(all\)\.some/)
  const exported = saves.match(/exportFile\(\): string[\s\S]*?\n  }\n\n  \/\*\* Merge/)?.[0] ?? ''
  assert.match(exported, /boards: readAll\(this\.storageKey\)/)
  assert.doesNotMatch(exported, /\.objects/)
  assert.doesNotMatch(saves.match(/function readAll[\s\S]*?\n}/)?.[0] ?? '', /normalizeBoardDocument/)
  assert.match(saves, /copyDocumentForConflict\(this\.documentForSave\(\), id\)/)
  assert.match(saves, /preserveDocumentFields\(this\.currentDocumentTemplate, current\)/)
  assert.match(saves, /this\.currentDocumentTemplate = template/)
})

test('every saved board is editable: no plan, lock, or read-only policy remains', () => {
  for (const gone of [/hasPaidBoardAccess/, /isPro\(/, /editableBoardNames/, /FREE_EDITABLE_BOARD_LIMIT/, /Read-only saved board/, /This saved board is read-only/, /Pro is needed/]) {
    assert.doesNotMatch(saves, gone)
  }
  assert.match(saves, /this\.store\.loadScene/)
  assert.match(saves, /No saved boards yet\. Local saved boards are unlimited\./)
})

test('new-board flow preserves state unless save succeeds or discard is confirmed', () => {
  assert.match(main, /!saves\.autosaveCurrent\(\) && !confirm\(/)
  assert.match(main, /unsaved changes that could not be saved/)
  assert.match(main, /openNewProject\(scene\)/)
  assert.match(main, /saves\.registerNew\(\)/)
  assert.match(main, /if \(!saves\.activateDocument\(id\)\) \{[\s\S]*saves\.registerNew\(\)/)
  assert.match(main, /deleteProject: \(id\) => \{ saves\.removeDocument\(id\) \}/)
  assert.match(main, /const currentStillExists = library\.projects\.some/)
  const blankProject = main.match(/if \(kind === 'blank'\) \{[\s\S]*?\n  } else \{/)?.[0] ?? ''
  assert.match(blankProject, /scene\.objects = \[\]/)
  assert.match(blankProject, /scene\.match = \{ \.\.\.emptyMatch\(\), \.\.\.scene\.match, home: '', away: '', showTeams: false \}/)
  assert.match(blankProject, /teams\.resetTeams\(\[\]\)/)
  // Projects "New project" opens a blank board too, so it must clear the
  // loaded teams as well; blankScene alone leaves them on the new project.
  assert.match(view, /const project = newProject\(this\.host\.blankProjectScene\(\)\)/)
  const blankProjectScene = main.match(/blankProjectScene: \(\) => \{[\s\S]*?\n  \},/)?.[0] ?? ''
  assert.match(blankProjectScene, /teams\.resetTeams\(\[\]\)/)
  assert.match(blankProjectScene, /return blankSceneLike\(store\.scene\.pitch\)/)
  const startNew = saves.match(/private startNew[\s\S]*?\n  }/)?.[0] ?? ''
  assert.doesNotMatch(startNew, /nameInput\(\)\.value\s*=\s*''/)
})

test('the share button offers Copy link and Export, and nothing server-backed', () => {
  // the menu builds itself from what the build can honour, so assert the
  // entries rather than fixed markup
  assert.match(main, /const shareMenu = document\.querySelector<HTMLElement>\('#shareMenu'\)!/)
  assert.match(main, /label: 'Copy link'/)
  assert.match(main, /A copy of this board, or of the whole project/)
  assert.match(main, /role="radiogroup" aria-label="What to copy"/)
  assert.match(main, /data-link-scope="board">This board/)
  assert.match(main, /data-link-scope="project">Whole project/)
  assert.match(main, /createBoardImportUrl\(boardLinkName, newProjectFromBoard\(source, boardLinkName\), boardLinkPreview\(\)\)/)
  assert.match(main, /createProjectImportUrl\(projectName, projectCopy\)/)
  assert.match(main, /The link expires after 24 hours\./)
  assert.doesNotMatch(main, /The link does not expire\./)
  assert.match(main, /function addSharedProject\(draft: AgentImportDraft, projectId: string \| null/)
  assert.match(main, /newProjectFromProjectCopy\(source, draft\.name\)/)
  assert.match(main, /appendProjectCopy\(project, source\)/)
  assert.match(main, /addProject: addSharedProject/)
  assert.match(main, /function boardLinkPreview\(/)
  assert.match(main, /label: 'Export/)
  for (const gone of [/label: 'Invite a person'/, /label: 'Invite an agent'/, /makeAgentLink/, /currentAgentLink/, /embedShareForm/,
    /UPGRADE_TOAST/, /setTagPro/, /Post to Community/i, /postBoardToCommunity/]) {
    assert.doesNotMatch(main, gone)
  }
  assert.doesNotMatch(saves, /embedShareForm|currentAgentLink|reidentifySavedBoard|Shared by @/)
})

test('nothing syncs, signs in, or announces presence', () => {
  for (const gone of [/scheduleSync|runSync|SYNC_DEBOUNCE/, /updatePresence|claimPresence|releasePresence/, /authenticated/, /accountBinding/,
    /openSignIn|signOutFromSettings/, /selectedFreeBackup|requestFreeBackup/, /live\.connect|collaboration\./, /tacticsjournal:auth-changed/]) {
    assert.doesNotMatch(main, gone)
  }
  assert.doesNotMatch(saves, /onLocalChange|flushCurrentForSync|applyRemoteCurrent/)
  assert.doesNotMatch(header, /fetch\(|credentials|session|signin|sign in/i)
})

test('rename and overwrite paths retain confirmation', () => {
  assert.match(saves, /confirm\(`Overwrite saved board/)
  assert.match(saves, /delete next\[this\.currentName!\]/)
})

test('screenshot import is Free without a trial or paid gate', () => {
  const liveButton = main.match(/function syncLiveButton\(\)[\s\S]*?\n}/)?.[0] ?? ''
  assert.match(liveButton, /pitchById\(store\.scene\.pitch\)\.live/)
  assert.match(main, /const files = Array\.from\(input\.files \?\? \[\]\)/)
  assert.doesNotMatch(main, /featureTrials|paid_gate_hit', 'screenshot_import'/)
})

test('a board draws the pieces the board draws, from the board’s own art', () => {
  // the ball is the ball everywhere it is drawn; a circle with a pentagon in it
  // is a drawing of the ball, which is a different thing
  assert.doesNotMatch(saves, /const panel = Array\.from\(\{ length: 5 \}/)
  assert.match(saves, /import \{ ballSrc, coneSrc, goalFullSrc, goalSmallSrc, livePlayerSrc, CONE_ASPECT, GOAL_ASPECT, LIVE_ART_SHEET, LIVE_MARKER_ELLIPSE, LIVE_PLAYER_CROP, MARKER_ASPECT \} from '\.\/board-art'/)
  for (const piece of ['ART.ball, ballSrc', 'ART.cone, coneSrc', 'assetRef(String(o.assetId)), asset.src', 'ART.marker, livePlayerSrc']) {
    assert.ok(saves.includes(piece), `${piece} is drawn from the art the board uses`)
  }
  // the pieces halve on a two-pitch board, the way the board halves them
  assert.match(saves, /function iconScale\(scene: Scene \| undefined\): number/)
})

test('the player points at one copy of each picture rather than writing it per frame', () => {
  // an SVG <image> never paints in the frame it is written, even with the bytes
  // in hand, so a piece rewritten sixty times a second lags the shapes beside it
  assert.match(saves, /art\?: 'draw' \| 'point'/)
  assert.match(saves, /const refs = opts\.art === 'point'/)
  assert.match(saves, /refs\s*\n\s*\? `<use\$\{turn\(o\)\} href="#\$\{ref\}"/)
  assert.match(saves, /export function boardArtDefs\(scenes: \(Scene \| undefined\)\[\]\): string/)
  // one symbol per picture, whatever draws it, and none for art nothing draws
  assert.match(saves, /const seen = new Set<string>\(\)/)
  assert.match(saves, /if \(objs\.some\(o => o\.type === 'ball'\)\) art\.push/)
})

test('the player fetches every picture it will draw when it opens', () => {
  // a picture inside a <symbol> nothing points at yet is not fetched, so a cone
  // that first appears on board two starts downloading mid-move and lands late
  assert.match(saves, /export function boardArt\(scenes: \(Scene \| undefined\)\[\]\): \{ id: string, src: string, aspect: number, crop\?: ArtCrop \}\[\]/)
  assert.match(saves, /export function boardArtDefs[\s\S]{0,200}boardArt\(scenes\)\.map/)
  assert.match(view, /boardArt\(scenes\)\.map\(a => a\.src\)/)
  assert.match(view, /for \(const src of pictures\)[\s\S]{0,220}img\.decode\?\.\(\)/)
})

test('the player keeps the shapes it has drawn instead of rebuilding them', () => {
  // an <image> is never painted in the frame it is created, so a piece rebuilt
  // every frame is always a frame from appearing — and on a slow device it
  // waits for the movement to stop
  assert.match(view, /const paintShapes = \(markup: string\) => \{/)
  assert.match(view, /paintShapes\(sceneShapesSvg\(frame\.scene/)
  assert.doesNotMatch(view, /shapes\.innerHTML = sceneShapesSvg/)
  assert.match(view, /for \(let i = 0; i < next\.length; i\+\+\) syncAttributes\(live\[i\], next\[i\]\)/)
  assert.match(view, /function syncAttributes\(live: Element, next: Element\): void/)
})

test('the player runs the board to the edges and keeps its controls under it', () => {
  // a pitch is wider than a phone is, so width spent on margins is board the
  // reader does not get; a board shorter than the screen — a broadcast frame
  // on a tall phone — sits with the bar under it rather than above a band of
  // empty page
  assert.match(view, /const width = vv\?\.width \?\? window\.innerWidth/)
  assert.doesNotMatch(view, /COLUMN_W/)
  assert.match(view, /const height = \(vv\?\.height \?\? window\.innerHeight\) - chrome$/m)
  assert.doesNotMatch(css, /\.seqPlayer__wrap \{[\s\S]{0,400}padding:/)
  assert.match(css, /\.seqPlayer__wrap \{[\s\S]{0,600}justify-content: center;/)
  assert.match(css, /\.seqPlayer__board \{[\s\S]{0,400}flex: none;/)
  assert.doesNotMatch(css, /place-self: start center;/)
})

test('the note band stays under the board and the board is fitted around it', () => {
  // a band laid over the pitch covers the part most likely to be drawn on, and
  // a board fitted without reserving the band runs off the bottom of the screen
  assert.doesNotMatch(view, /is-noteOver/)
  assert.doesNotMatch(css, /is-noteOver/)
  assert.match(css, /\.seqPlayer__note \{\s*position: relative;/)
  // the hidden measure gets the intended board width even on the first frame,
  // then the band's height is taken out before the scale is chosen
  assert.match(view, /measure\.style\.width = `\$\{Math\.max\(1, width\)\}px`/)
  assert.match(view, /const stageH = \(h: number\) => Math\.max\(1, fit\.height - h\)/)
  assert.match(view, /const fitK = \(\) => Math\.min\(fit\.width \/ v\.w, stageH\(noteH\) \/ v\.h, 2\.1\)/)
  // the note receives the height a full-width board cannot use. Two passes
  // remain because the band's text can wrap differently at the fitted width.
  assert.match(view, /const spare = Math\.max\(0, fit\.height - Math\.round\(v\.h \* fullK\)\)/)
  assert.match(view, /const free = Math\.max\(0, Math\.floor\(spare\)\)/)
  assert.match(view, /return \{ cap: Math\.max\(minimum, free\), fill: free >= minimum \? free : 0 \}/)
  assert.match(view, /noteH = hasProjectNotes \? Math\.max\(tallest, fill\) : 0/)
  assert.match(view, /measureBand\(fullW, cap, fill\)/)
  assert.match(view, /if \(!bandFor\.startsWith\(`\$\{w\}:`\)\) \{\s*measureBand\(w, cap, fill\)\s*k = fitK\(\)\s*w = Math\.round\(v\.w \* k\)\s*\}/)
  assert.match(view, /stage\.style\.width = `\$\{w\}px`/)
})

test('the board note keeps its Markdown heading', () => {
  assert.match(main, /board\.setNote\(note\)/)
  assert.doesNotMatch(main, /board\.setNote\(noteBody\(note\)\)/)
  assert.match(view, /renderMarkdown\(project\.boards\[index\]\.note\)/)
})

test('the open project and its board survive a refresh', () => {
  // navigation state lives on Library, never on a synced Project document
  assert.match(main, /let editingBoard = Math\.max\(0, storedBoardIndex\(library, currentProject\(library\)\)\)/)
  const startup = main.match(/let editingBoard = Math[\s\S]*?saves\.activateDocument\(library\.currentId\)/)?.[0] ?? ''
  assert.ok(startup, 'startup restores the board before activating the document')
  const open = main.match(/function openLibraryProject\(id: string, preferredBoardId\?: string\)[\s\S]*?\n}/)?.[0] ?? ''
  // the outgoing project keeps its board and the incoming one gets its own back
  assert.match(open, /rememberBoard\(library, library\.currentId, currentProject\(library\)\.boards\[editingBoard\]\?\.id\)/)
  assert.match(open, /editingBoard = Math\.max\(0, storedBoardIndex\(library, currentProject\(library\)\)\)/)
  const openBoard = main.match(/openBoard: \(index, options\) => \{[\s\S]*?\n  \},/)?.[0] ?? ''
  assert.match(openBoard, /rememberBoard\(library, project\.id, board\.id\)/)
  assert.match(openBoard, /saveLibrary\(library\)/)
})
