import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import { PITCHES, PITCH_PAPER, pitchArt, pitchById, pitchIsDark } from '../src/pitches.ts'
import { emptyScene, headNeedsLine, migrate, repaperInk, sceneIsDark, sceneLook, type SceneObj } from '../src/types.ts'
import { appearanceDefault, resolveAppearance } from '../src/appearance.ts'
import { addBoardChoices } from '../src/add-board-options.ts'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
const store = read('../src/store.ts')
const board = read('../src/board.ts')
const main = read('../src/main.ts')
const script = read('../scripts/make-dark-pitches.py')

test('every pitch we draw has a dark drawing, and nothing else does', () => {
  for (const style of PITCHES) {
    if (style.live) {
      assert.equal(style.darkSrc, undefined, `${style.id} is a photograph and cannot be inverted`)
      continue
    }
    assert.ok(style.darkSrc, `${style.id} has no dark art`)
    assert.ok(existsSync(fileURLToPath(style.darkSrc!)), `${style.id} dark art is not on disk`)
    assert.notEqual(style.darkSrc, style.src)
    assert.equal(pitchArt(style, true), style.darkSrc)
    assert.equal(pitchArt(style, false), style.src)
    assert.equal(pitchArt(style, undefined), style.src)
  }
  // the paper the board paints behind the art is the paper the art was made on
  const [r, g, b] = [1, 3, 5].map(k => Number.parseInt(PITCH_PAPER.dark.slice(k, k + 2), 16))
  assert.match(script, new RegExp(`PAPER = \\(${r}, ${g}, ${b}\\)`))
})

test('dark is the board asking and the pitch answering', () => {
  assert.equal(pitchIsDark('pitch', true), true)
  assert.equal(pitchIsDark('pitch', false), false)
  assert.equal(pitchIsDark('pitch', undefined), false)
  // a photograph, a broadcast still or a missing background has no dark version
  assert.equal(pitchIsDark('live', true), false)
  assert.equal(pitchIsDark('bg:mine', true), false)
  assert.equal(sceneIsDark({ pitch: 'full-pitch', dark: true }), true)
  assert.equal(sceneIsDark({ pitch: 'bg:mine', dark: true }), false)
  assert.equal(sceneIsDark(undefined), false)
})

test('a dark board survives a save, and a light one carries nothing', () => {
  const dark = migrate({ ...emptyScene('pitch-up'), dark: true })
  assert.equal(dark.dark, true)
  assert.equal(dark.pitch, 'pitch-up')
  assert.equal('dark' in migrate(emptyScene('pitch')), false)
  // only a real true counts: a save cannot talk a board dark with a string
  assert.equal('dark' in migrate({ ...emptyScene('pitch'), dark: 'yes' }), false)
  assert.equal('dark' in migrate({ ...emptyScene('pitch'), dark: false }), false)
})

test('turning a board dark is a board change: it undoes', () => {
  assert.match(store, /pitch: s\.pitch, dark: s\.dark === true, board: s\.board/)
  assert.equal((store.match(/if \(parsed\.dark === true\) this\.scene\.dark = true\n    else delete this\.scene\.dark/g) ?? []).length, 2)
})

test('the defaults chosen for white paper give way on dark, and only there', () => {
  const light = resolveAppearance(undefined)
  const dark = resolveAppearance(undefined, true)
  assert.equal(light['player.nameColor'], appearanceDefault('player.nameColor'))
  assert.equal(light['player.outlineColor'], appearanceDefault('player.outlineColor'))
  assert.equal(dark['player.nameColor'], '#f5f5f7')
  assert.equal(dark['player.outlineColor'], '#f5f5f7')
  // everything else is the same board
  for (const key of Object.keys(light) as (keyof typeof light)[]) {
    if (key === 'player.nameColor' || key === 'player.outlineColor') continue
    assert.equal(dark[key], light[key], key)
  }
  // a colour the author chose is theirs on either paper
  const styled = { player: { nameColor: '#e02020', outlineColor: '#1e2f6f' } }
  assert.equal(resolveAppearance(styled, true)['player.nameColor'], '#e02020')
  assert.equal(resolveAppearance(styled, true)['player.outlineColor'], '#1e2f6f')
  assert.equal(sceneLook({ pitch: 'pitch', dark: true })['player.nameColor'], '#f5f5f7')
  assert.equal(sceneLook({ pitch: 'bg:mine', dark: true })['player.nameColor'], appearanceDefault('player.nameColor'))
  // the board and the editor both read the look for the paper the board is on
  assert.match(board, /private look\(\): ResolvedAppearance \{ return sceneLook\(this\.renderingScene \?\? this\.store\.scene\) \}/)
  assert.match(main, /function boardLook\(\): ResolvedAppearance \{ return sceneLook\(store\.scene\) \}/)
})

test('only the ink that would vanish changes paper', () => {
  const objects = [
    { id: 'a', type: 'arrow', color: '#111111' },
    { id: 'b', type: 'arrow', color: '#e02020' },
    { id: 'c', type: 'text', color: '#111827' },
    { id: 'd', type: 'text', color: '#ffffff' },
    { id: 'p', type: 'player', color: '#111827' },
  ] as unknown as SceneObj[]
  const colours = () => objects.map(o => (o as { color: string }).color)
  repaperInk(objects, true)
  // black ink turns white; a red run, white lettering and a black kit are left alone
  assert.deepEqual(colours(), ['#ffffff', '#e02020', '#ffffff', '#ffffff', '#111827'])
  repaperInk(objects, false)
  assert.deepEqual(colours(), ['#111111', '#e02020', '#111111', '#111111', '#111827'])
})

test('a head needs a line when its kit is the colour of the paper', () => {
  assert.equal(headNeedsLine('#ffffff', false), true)
  assert.equal(headNeedsLine('#111827', false), false)
  assert.equal(headNeedsLine('#ffffff', true), false)
  assert.equal(headNeedsLine('#111827', true), true)
  assert.equal(headNeedsLine('#e02020', true), false)
})

test('a new board is started on the paper the open one is on', () => {
  const input = {
    builtIn: PITCHES, saved: [], currentPitch: pitchById('pitch'), admin: false,
    canPick: () => true, canUpload: true,
  }
  const lightTile = addBoardChoices(input).pitches.find(p => p.id === 'pitch-up')!
  const darkTile = addBoardChoices({ ...input, dark: true }).pitches.find(p => p.id === 'pitch-up')!
  assert.equal(lightTile.art, pitchById('pitch-up').src)
  assert.equal(darkTile.art, pitchById('pitch-up').darkSrc)
  assert.match(main, /function blankSceneLike\(pitchId: string \| undefined\): Scene \{\n  const scene = emptyScene\(pitchId\)\n  if \(store\.scene\.dark === true\) scene\.dark = true/)
})

test('the choice is the board\'s own, in Settings, and never the app theme\'s', () => {
  assert.match(main, /data-set="paper-light"/)
  assert.match(main, /data-set="paper-dark"/)
  assert.match(main, /else if \(k === 'paper-dark'\) choosePaper\(true\)/)
  // the theme only ever paints the mat around the board
  const theme = main.slice(main.indexOf('function setThemeResolved'), main.indexOf('function prefersDark'))
  assert.doesNotMatch(theme, /scene\.dark|applyBoardPaper/)
  // each paper keeps its own saved styles, the light set under the old key
  assert.match(main, /function pitchStyleKey\(id: string, dark: boolean\): string \{ return dark \? `\$\{id\}@dark` : id \}/)
})
