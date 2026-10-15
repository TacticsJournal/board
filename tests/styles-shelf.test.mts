import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const main = await readFile(new URL('../src/main.ts', import.meta.url), 'utf8')
const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8')
const types = await readFile(new URL('../src/types.ts', import.meta.url), 'utf8')
const board = await readFile(new URL('../src/board.ts', import.meta.url), 'utf8')
const saves = await readFile(new URL('../src/saves.ts', import.meta.url), 'utf8')

test('Styles is a shelf of its own, and the strip stands down under it', () => {
  assert.match(main, /const stylesShelfEl = document\.querySelector<HTMLDivElement>\('#stylesShelf'\)!/)
  assert.match(main, /function stylesShowing\(\) \{[\s\S]*?!deskMode && panelOpen && room === 'styles'/)
  // the shelf is drawn with the rest of the panel, not on its own schedule
  assert.match(main, /renderShelf\(\)\n  renderStylesShelf\(\)/)
  // and the options strip gives up the room rather than drawing behind it
  assert.match(main, /if \(stylesShowing\(\) \|\| quickSetShowing\(\)\) \{ optionsEl\.classList\.add\('hidden'\)/)
})

test('a wide window keeps the strip it already had', () => {
  // stylesShowing is false on the desktop, so nothing about the dock changes
  assert.match(main, /function stylesShowing\(\) \{\s*return !deskMode/)
})

test('the cells draw the setting, at the shelf grid the shapes shelf uses', () => {
  assert.match(css, /\.styleGroup \{[\s\S]*?grid-auto-flow: column;[\s\S]*?grid-template-rows: repeat\(2, 40px\)/)
  assert.match(main, /styleArt\.arrow\(dash, sel\.head, shelfArrowColor\(\), sel\.width, live\)/)
})

test('a white swatch keeps the stroke the board draws round a token', () => {
  // a ring round the swatch plus a lit cell turns a chosen white into a hole
  assert.match(css, /\.styleGroup \.cell \.dot \{[\s\S]*?border: 1\.6px solid #0b0b0e/)
  assert.doesNotMatch(css, /html\[data-theme-resolved="dark"\] \.sw \{ border-color/)
})

test('both the strip and the shelf write a setting the same way', () => {
  assert.match(main, /function applySelectionOption\(key: string, v: string \| undefined, sel: SceneObj\)/)
  assert.match(main, /applySelectionOption\(key, v, o\)/)
})

test('a player is the row, and nothing else', () => {
  assert.match(main, /function nameBoxHtml\(\)/)
  assert.match(main, /seg\(\[\['auto', 'Auto'\], \['top', 'Above'\], \['bottom', 'Below'\]\], sel\.namePos, 'namepos'\)/)
  // no cells under a picked player: the kit is the swatch at the row's end
  assert.match(main, /if \(sel\?\.type === 'player'\) return groups/)
  // the shelf rail's own dot-and-chevron, not a second colour control
  assert.match(main, /class="shelfRailRight rowKit" data-style="kit" data-color-trigger/)
  assert.match(main, /panelDockEl\.querySelectorAll<HTMLButtonElement>\('\[data-color-trigger\]'\)/)
  // and the swatch paints what is picked rather than the next shape
  assert.match(main, /function selectionColorTarget\(\)/)
  assert.match(main, /set: c => styleAll\(o => \{ o\.color = c \}\)/)
  // carry keeps a home in the room that no longer has a shelf
  assert.match(main, /function carryRowButton\(\)/)
})

test('the sizes live where they act: the project, not the selection', () => {
  assert.match(main, /quickSizeRow\('playerSize', 'Players'\)/)
  assert.match(main, /quickSizeRow\('nameSize', 'Names'\)/)
  assert.match(main, /quickSizeRow\('textSize', 'Labels'\)/)
  // one clamp per size, matching what a scene will accept
  assert.match(main, /nameSize: \[8, 96\], playerSize: \[2, 100\], textSize: \[8, 200\]/)
  assert.doesNotMatch(main, /data-style="namesize"/)
})

test('the squad opens without a keyboard, in shirt-number order, with the position', () => {
  assert.match(main, /data-style="roster-toggle"/)
  // getRosterForPicker already sorts by number; the row shows what it sorted by
  assert.match(main, /class="rPos">\$\{esc\(positionTag\(p\.position\)\)\}/)
  // goalkeeper rows wear the same side-specific color as the keeper on the board
  assert.match(main, /isGoalkeeperPosition\(p\.position\) && pickedTeam\?\.side \? keeperColor\(pickedTeam\.side\)/)
  // and picking a player brings the number the row was showing
  assert.match(main, /sel\.name = normalizePlayerName\(pick\.name\)\s*\n\s*if \(pick\.number\) sel\.label = pick\.number/)
})

test('typing filters the same list rather than replacing it', () => {
  assert.match(main, /rosterFilter = target\.value/)
  assert.match(main, /function rosterMatches\(name: string, filter: string\)/)
  // an accent or a second name should not hide a player
  assert.match(main, /normalize\('NFD'\)/)
})

test('a size belongs to the project, and undoes in one step', () => {
  assert.match(main, /function setProjectSize\(key: ProjectSizeKey, size: number\)/)
  // the open board and every other board in the project, in one step
  assert.match(main, /for \(const o of s\.objects\) if \(o\.type === rule\.type\)/)
  assert.match(main, /for \(const item of project\.boards\)[\s\S]*?\(o as any\)\[rule\.field\] = size/)
  assert.match(main, /label: 'Undo',\s*\n\s*run: \(\) => setProjectSize\(key, before\)/)
  // and the next one made wears it
  assert.match(main, /nameSize: defaults\.nameSize/)
  assert.match(main, /r: defaults\.playerSize/)
})

test('the three shared sizes read and write one place each', () => {
  // no second copy of a size to drift from the one the board is drawn with
  assert.match(main, /nameSize: \{ type: 'player', field: 'nameSize'[\s\S]*?get: \(\) => defaults\.nameSize/)
  assert.match(main, /playerSize: \{ type: 'player', field: 'r'[\s\S]*?get: \(\) => defaults\.playerSize/)
  assert.match(main, /textSize: \{ type: 'text', field: 'size'[\s\S]*?get: \(\) => defaults\.text\.size/)
})


test('every pitch remembers its own styles, and only its defaults', () => {
  assert.match(main, /const PITCH_STYLE_KEY = 'tbm-pitch-styles-v1'/)
  assert.match(main, /data-set="styles-save"/)
  assert.match(main, /data-set="styles-reset"/)
  // a saved pitch keeps what was saved; the built-in rule is only for the rest
  assert.match(main, /if \(applyPitchStyle\(style\.id\)\) \{ arrowDefaultsLive = !!style\.live; return \}/)
})

test('carry forward is an action on the shelf, not the first thing in the room', () => {
  assert.match(main, /function carryCell\(\): StyleCell \| null/)
  assert.match(main, /id: 'carry'[\s\S]*?act: true/)
  // it was taking a whole row over the shape shelf on a phone; the desktop
  // strip has room for the chip and keeps it
  assert.match(main, /const carryHtml = deskMode \? carryStripHtml\(\) : ''/)
  // and carrying to chosen boards, the old chevron, is the cell's hold
  assert.match(main, /\[data-style-cell="carry"\][\s\S]*?openCarryMenu\(cell\)/)
})

test('Settings is a room too, with the sheet one row further', () => {
  assert.match(main, /type Room = 'settings' \| 'shapes' \| 'text' \| 'styles'/)
  assert.match(main, /\{ room: 'settings', label: 'Settings' \}/)
  // the few settings worth reaching mid-board, then More for the rest
  assert.match(main, /quickSetRow\('pitch', 'Background', pitch\.label\)/)
  assert.match(main, /quickSetRow\('scoreboard', 'Scoreboard', scoreboard \? 'On' : 'Off', 'value'\)/)
  assert.match(main, /quickSetRow\('more', 'More settings'\)/)
  assert.match(main, /if \(key === 'more'\) \{ openSettings\(\); return \}/)
  // a wide window has no seat for it: the rail's foot button opens the sheet
  assert.match(main, /if \(room === 'styles' \|\| room === 'settings'\) room = 'shapes'/)
})

test('numbers turn off without being forgotten', () => {
  // the flag hides the number; the number itself stays where it was typed
  assert.match(types, /showLabel\?: boolean/)
  assert.match(board, /if \(o\.label && o\.showLabel !== false\)/)
  assert.match(saves, /if \(o\.label && o\.showLabel !== false\)/)
  // and it is a board-wide choice, like the sizes beside it
  assert.match(main, /function setProjectNumbers\(show: boolean\)/)
  assert.match(main, /run: \(\) => setProjectNumbers\(!show\)/)
  // a pill that toggles, not one of the animated track switches
  assert.match(main, /data-style="numbers" aria-pressed=/)
})

test('the colour picker covers the board rather than moving it', () => {
  // publishing the picker's height would inset the stage and refit the pitch,
  // so the guard has to come before anything the function publishes
  assert.match(main, /function syncPanelHeight[\s\S]{0,400}?if \(pickerOpen && !deskMode\) return/)
  const body = main.slice(main.indexOf('function syncPanelHeight'))
  assert.ok(body.indexOf('if (pickerOpen && !deskMode) return') < body.indexOf("setProperty('--panelH'"),
    'the picker guard must precede the inset it would publish')
  assert.ok(body.indexOf('if (pickerOpen && !deskMode) return') < body.indexOf("setProperty('--quickMax'"),
    'and precede the cap the panel is given')
  // and taking the band out of the layout would grow the stage by its height
  assert.match(css, /\.panelDock\.pickerOpen ~ \.toolbar \{ visibility: hidden; \}/)
})

test('the picker opens on its swatches', () => {
  // a kit is nearly always a colour already there; the wheel is one tap away
  assert.match(main, /let pickerTab: 'custom' \| 'swatches' = 'swatches'/)
  assert.match(main, /pickerTab = 'swatches'; selectPickerTab\('swatches'\)/)
  // and the markup starts on the tab that opens, so the first paint matches
  assert.match(main, /data-picker-tab="swatches" aria-selected="true"/)
  assert.match(main, /<div class="pickerCustom" data-picker-custom role="tabpanel" hidden>/)
})

test('a phone puts the toast at the top, and it arrives from there', () => {
  // the panel owns the bottom of a phone, so a toast there covers the controls
  // it is talking about
  assert.match(css, /body:not\(\.deskMode\) \.toastBand \{[\s\S]*?bottom: auto;/)
  assert.match(css, /body:not\(\.deskMode\) \.t-toast \{[\s\S]*?translateY\(calc\(var\(--toast-distance\) \* -1\)\)/)
  // and the lift over an open sheet is for the low toast only
  assert.match(main, /const sheet = deskMode \? document\.querySelector<HTMLElement>\('\.modal:not\(\.hidden\) > \.sheet'\) : null/)
})

test('Styles is only offered when it has one kind to change', () => {
  // nothing picked, or a pick with nothing in common, leaves it nothing to be
  assert.match(main, /function stylesSubject\(\): SceneObj\['type'\] \| null/)
  assert.match(main, /return picked\.every\(o => o\.type === type\) \? type : null/)
  assert.match(main, /const off = r\.room === 'styles' && !stylesHasSubject\(\)/)
  assert.match(main, /if \(btn\.hasAttribute\('disabled'\)\) return/)
  assert.match(css, /\.toolbar button:disabled \{[\s\S]*?pointer-events: none;/)
})

test('a pick of one kind restyles as one', () => {
  assert.match(main, /function styleAll\(mutate: \(o: any\) => void\)/)
  assert.match(main, /for \(const o of selectedObjects\(\)\) if \(!type \|\| o\.type === type\) mutate\(o\)/)
  // and the name row's own controls reach every picked player too
  assert.match(main, /for \(const o of picked\) if \(!type \|\| o\.type === type\) applySelectionOption\(key, v, o\)/)
})

test('while several are picked, a tap adjusts the pick', () => {
  // on one of them it comes out, on anything else it goes in
  assert.match(board, /if \(picked\.length > 1\) \{\n\s*const next = picked\.includes\(hitId\)/)
  assert.match(board, /\? picked\.filter\(id => id !== hitId\)\n\s*: \[\.\.\.picked, hitId\]/)
})

test('a strip with nothing to say does not hold a band of panel open', () => {
  // a ball or a cone has no settings, and the empty strip read as a failure
  assert.match(main, /if \(!deskMode && !carryHtml && !html\.trim\(\)\) optionsEl\.classList\.add\('hidden'\)/)
})

test('player size is the board\'s scale, and the furniture keeps up', () => {
  assert.match(main, /const SCALES_WITH_PLAYERS/)
  // the ball, the cones, the goals, the live markers and the arrows
  assert.match(main, /\{ type: 'ball', field: 'size'[\s\S]*?\{ type: 'arrow', field: 'width'/)
  assert.match(main, /const k = key === 'playerSize' && before > 0 \? size \/ before : 1/)
  // and the next arrow drawn matches the ones already there
  assert.match(main, /defaults\.arrow\.width = Math\.max\(1, Math\.min\(30, Math\.round\(defaults\.arrow\.width \* k \* 100\) \/ 100\)\)/)
})

test('a size row shows what the number does', () => {
  assert.match(main, /function sizeExample\(key: ProjectSizeKey\)/)
  // a dot at the size it sets, and the words at the size they will be
  assert.match(main, /class="sizeEg" aria-hidden="true"><span class="egDot"/)
  // at the size it will be on the board, which is drawn at a scale
  assert.match(main, /const k = board\.screenScale\(\) \|\| 1/)
  assert.match(main, /const d = Math\.max\(6, size \* 2 \* k\)/)
  assert.match(main, /const text = key === 'nameSize' \? 'Vitinha' : 'Half-space'/)
})

test('a new shape opens the room that styles it, players included', () => {
  // a player used to be the exception, on the grounds that they arrive a squad
  // at a time; naming the one you just put down is the more common next move
  assert.doesNotMatch(main, /if \(!board\.picking && sel\.type === 'player'\)/)
  assert.match(main, /players included/)
})

test('a pick of several does not open the room', () => {
  // gathering four players up is a move, a copy or a delete; the room would be
  // covering the board you are picking from
  assert.match(main, /if \(store\.selectedIds\.length > 1\) \{ renderToolbar\(\); return \}/)
  // and it still restyles the lot once you open it yourself
  assert.match(main, /for \(const o of selectedObjects\(\)\) if \(!type \|\| o\.type === type\) mutate\(o\)/)
})

test('a size rail says the number, and takes one', () => {
  assert.match(main, /id: 'text-size'[\s\S]{0,80}?unit: 'px'/)
  assert.match(main, /function editStyleNumber\(id: string\)/)
  assert.match(main, /data-style-num=/)
  // and a drag owns the shelf until it lets go, or writing a project size
  // would redraw the rail out from under the finger on it
  assert.match(main, /function renderStylesShelf\(\) \{[\s\S]{0,200}?if \(styleRailDrag\) return/)
})

test('a zone, an arrow and a label are styled a tab at a time', () => {
  // one tab per property, and the tab the room is on resets with the pick
  assert.match(main, /function styleTabs\(\): StyleTab\[\]/)
  assert.match(main, /let styleTab: string \| null = null/)
  assert.match(main, /styledId = id;[\s\S]{0,120}?styleTab = null/)
  // the rings say what the choice looks like, the rail says how much of it
  assert.match(main, /id: 'fill', label: 'Fill'/)
  assert.match(main, /id: 'border', label: 'Border'/)
  assert.match(main, /id: 'line', label: 'Line'/)
  assert.match(main, /id: 'halo', label: 'Halo'/)
  // the colour rides the tab row, the actions ride the rail they act on
  assert.match(main, /class="styleTabs"><span class="styleTabList"[\s\S]{0,120}?\$\{head\}<\/span>\$\{kit\}/)
  assert.match(main, /class="styleBody"[\s\S]{0,300}?class="styleActs"/)
  assert.match(main, /data-style="kit" data-color-trigger/)
  // an arrow can go back to the one the board draws, from any of its tabs
  assert.match(main, /function resetArrowStyle\(\)/)
  assert.match(main, /title: 'Back to the default arrow'/)
  assert.match(main, /if \(key === 'reset'\) \{ activeStyleTab\(\)\?\.reset\?\.run\(\)/)
  // and the wheel writes whichever tab is open
  assert.match(main, /return activeStyleTab\(\)\?\.color \?\? null/)
  // the body is a fixed height, so switching tabs never moves the panel
  assert.match(css, /\.styleBody \{[\s\S]*?height: 66px/)
  // a tab is square: the app's round-cornered button bent the rule under it
  assert.match(css, /\.styleTab \{[\s\S]*?border-radius: 0;/)
  // the rail is the Appearance slider with the part behind the handle filled
  assert.match(css, /\.styleRail::-webkit-slider-runnable-track \{[\s\S]*?var\(--pct, 0%\)/)
})

test('the round zone is a circle, and stays one', () => {
  // the drag is the diameter, not a box to squash an oval into
  assert.match(board, /if \(c\.obj\.shape === 'ellipse'\) \{[\s\S]{0,300}?const d = Math\.hypot\(dx, dy\)\s*\n\s*c\.obj\.w = d; c\.obj\.h = d/)
  // and the node scales both sides by the one factor, so it cannot go oval
  assert.match(board, /\} else if \(sel\.type === 'box'\) \{[\s\S]{0,300}?sel\.w = Math\.max\(8, sel\.w \* scale\)\s*\n\s*sel\.h = Math\.max\(8, sel\.h \* scale\)/)
  // pulling it into another shape is what the edit nodes are for
  assert.match(main, /title: 'Circle'/)
  assert.doesNotMatch(main, /title: 'Oval'/)
})
