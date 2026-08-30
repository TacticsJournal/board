import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { addBoardChoices } from '../src/add-board-options.ts'
import type { PitchStyle } from '../src/pitches.ts'

const style = (over: Partial<PitchStyle> & { id: string }): PitchStyle => ({
  label: over.id, src: '', boardH: 418, category: 'pitch', pro: false, ...over,
})

const builtIn: PitchStyle[] = [
  style({ id: 'pitch', label: 'Pitch', src: 'pitch.jpeg', boardH: 618 }),
  style({ id: 'pitch-up', label: 'Vertical', src: 'up.jpeg', boardH: 640, pro: true }),
  style({ id: 'live', label: 'Live', pro: true, hidden: true }),
  style({ id: 'classic', label: 'Classic', src: 'classic.jpeg', pro: true, adminOnly: true }),
]
const saved: PitchStyle[] = [
  style({ id: 'bg:1', label: 'Half space', boardH: 500, pro: true, custom: true }),
  style({ id: 'bg:gone', label: 'Missing background', pro: true, custom: true, missing: true }),
]

const paid = (input: Partial<Parameters<typeof addBoardChoices>[0]> = {}) => addBoardChoices({
  builtIn, saved,
  currentPitch: builtIn[0],
  admin: false,
  canPick: (s: PitchStyle) => !s.adminOnly,
  canUpload: true,
  thumb: (id: string) => (id === 'bg:1' ? 'thumb-1' : ''),
  ...input,
})

test('the chooser offers every pitch a board may be drawn on', () => {
  const choices = paid()
  assert.deepEqual(choices.pitches.map(p => p.id), ['pitch', 'pitch-up'])
  assert.equal(choices.pitches.find(p => p.id === 'pitch-up')!.boardH, 640)
})

test('hidden art is never offered and the clean pitch waits for the admin', () => {
  assert.equal(paid().pitches.some(p => p.id === 'live'), false)
  assert.equal(paid({ admin: true, canPick: () => true }).pitches.some(p => p.id === 'classic'), true)
})

test('saved backgrounds come with their thumbnails, minus the ones not on this device', () => {
  const choices = paid()
  assert.deepEqual(choices.backgrounds.map(b => b.id), ['bg:1'])
  assert.equal(choices.backgrounds[0].art, 'thumb-1')
  assert.equal(choices.backgrounds[0].boardH, 500)
  assert.equal(choices.backgrounds[0].custom, true)
})

test('Free can choose local pitches and upload local backgrounds', () => {
  const free = paid({ canPick: () => true, canUpload: true })
  assert.deepEqual(free.pitches.map(p => [p.id, p.locked]), [['pitch', false], ['pitch-up', false]])
  assert.equal(free.backgrounds[0].locked, false)
  assert.equal(free.uploadLocked, false)
})

test('the board on screen is the fast path and is marked in the grid', () => {
  const choices = paid({ currentPitch: builtIn[1] })
  assert.equal(choices.current.id, 'pitch-up')
  assert.equal(choices.current.current, true)
  assert.equal(choices.current.locked, false)
  assert.deepEqual(choices.pitches.filter(p => p.current).map(p => p.id), ['pitch-up'])
})

test('a paid pitch already on screen stays offered as the fast path', () => {
  const choices = paid({ currentPitch: builtIn[3], canPick: () => false })
  assert.equal(choices.current.locked, false)
  assert.equal(choices.current.label, 'Classic')
})

const view = await readFile(new URL('../src/boards-view.ts', import.meta.url), 'utf8')
const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8')
const main = await readFile(new URL('../src/main.ts', import.meta.url), 'utf8')

test('Add board opens a chooser sheet, not the old two-row menu', () => {
  assert.doesNotMatch(view, /libMenu/)
  assert.match(view, /class="sheet addBoardSheet" role="dialog" aria-modal="true" aria-label="Add a board"/)
  assert.match(view, /data-add="copy"[\s\S]*?Copy this board/)
  assert.match(view, /data-add="same"/)
  assert.match(view, /data-add="upload"/)
  // an empty shelf is not called "Your backgrounds"
  assert.match(view, /choices\.backgrounds\.length \? 'Your backgrounds' : 'Your own image'/)
})

test('the chooser closes on Escape, on an outside click and on leaving the list', () => {
  assert.match(view, /if \(e\.key === 'Escape'\) \{ e\.preventDefault\(\); this\.closeAddSheet\(\); return \}/)
  assert.match(view, /if \(e\.target === sheet\) \{ this\.closeAddSheet\(\); return \}/)
  assert.match(view, /open\(screen: Screen \| null\) \{\s*\n\s*this\.closeAddSheet\(false\)/)
  assert.match(view, /if \(restoreFocus && trigger\?\.isConnected\) trigger\.focus\(\)/)
})

test('every choice inserts at the asked-for index, opens the board and saves', () => {
  const create = view.slice(view.indexOf('private addBoardHere'), view.indexOf('private closeAddSheet'))
  assert.match(create, /const scene = pitchId \? this\.host\.blankSceneOn\(pitchId\) : this\.host\.blankScene\(\)/)
  assert.match(create, /addBoard\(project, index, copy, scene\)/)
  assert.match(create, /this\.commit\(\)[\s\S]*this\.host\.openBoard\(index \+ 1\)[\s\S]*this\.open\(null\)/)
})

test('all local choices stay available without a purchase', () => {
  assert.doesNotMatch(view, /wantLicense|comes with the License/)
})

test('the upload opens the native picker inside the tap and resets the input', () => {
  const pick = main.slice(main.indexOf('function pickBackgroundForNewBoard'), main.indexOf('// a board saved without anyone naming it'))
  assert.match(pick, /newBoardFile\.value = ''\s*\n\s*newBoardFile\.click\(\)/)
  assert.match(pick, /newBoardFile\.value = ''\s*\n\s*if \(!file\)/)
  assert.match(pick, /addBackgroundFromFile\(file, 'broadcast'\)/)
  assert.match(pick, /then\(meta => done\(\{ pitchId: meta\.id \}\)\)/)
  assert.doesNotMatch(view.slice(view.indexOf('private async uploadForNewBoard'), view.indexOf('private addBoardHere')), /await[\s\S]*?host\.uploadBackground[\s\S]*?await/)
})

test('a board started on a chosen pitch takes that pitch and its height', () => {
  const blank = main.slice(main.indexOf('function blankSceneOnPitch'), main.indexOf('/* The chooser'))
  // emptyScene reads the height off the style, so an unknown id cannot make a
  // board with no art and no shape.
  assert.match(blank, /return emptyScene\(pitchById\(pitchId\)\.id\)/)
})

test('a short phone viewport scrolls the sheet instead of squeezing its rows', () => {
  // the sheet is a flex column: without this the rows and the tiles are pressed
  // below the height of their own words on a phone with the browser bars showing
  assert.match(css, /\.sheet \.kindOpt \{ flex: none; \}/)
  assert.match(css, /\.addBoardSheet > \* \{ flex: none; \}/)
})
