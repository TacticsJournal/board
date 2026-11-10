import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import { ART_PAPERS, BOARD_PAPERS, DARK_PAPERS, PITCHES, PITCH_PAPER, pitchArt, pitchById, pitchPaper } from '../src/pitches.ts'
import { emptyScene, headNeedsLine, migrate, repaperInk, sceneIsDark, sceneLook, scenePaper, setScenePaper, type SceneObj } from '../src/types.ts'
import { appearanceDefault, resolveAppearance } from '../src/appearance.ts'
import { addBoardChoices } from '../src/add-board-options.ts'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
const store = read('../src/store.ts')
const board = read('../src/board.ts')
const main = read('../src/main.ts')
const script = read('../scripts/make-dark-pitches.py')

test('six backgrounds are offered, light first, and none is called inverted', () => {
  assert.deepEqual(BOARD_PAPERS.map(p => p.id), ['white', 'cream', 'steel', 'slate', 'dark', 'grass'])
  assert.deepEqual(BOARD_PAPERS.map(p => p.label), ['White', 'Cream', 'Steel', 'Slate', 'Dark', 'Floodlit grass'])
  assert.equal(PITCH_PAPER.steel, '#4a525a')
  assert.equal(PITCH_PAPER.cream, '#fff5e3')
  assert.doesNotMatch(main, /Inverted/)
})

test('every pitch we draw has every background, and nothing else does', () => {
  for (const style of PITCHES) {
    if (style.live) {
      assert.equal(style.papers, undefined, `${style.id} is a photograph and has no other paper`)
      continue
    }
    for (const paper of ART_PAPERS) {
      const src = style.papers?.[paper]
      assert.ok(src, `${style.id} has no ${paper} art`)
      assert.ok(existsSync(fileURLToPath(src!)), `${style.id} ${paper} art is not on disk`)
      assert.equal(pitchArt(style, paper), src)
    }
    assert.equal(pitchArt(style, 'white'), style.src)
    assert.equal(pitchArt(style, undefined), style.src)
  }
})

test('the colour painted behind the art is the paper the art was made on', () => {
  for (const paper of ART_PAPERS) {
    const [r, g, b] = [1, 3, 5].map(k => Number.parseInt(PITCH_PAPER[paper].slice(k, k + 2), 16))
    assert.match(script, new RegExp(`'${paper}': \\(${r}, ${g}, ${b}\\)`), paper)
  }
})

test('the mark is drawn as tacticsjournal.com shows it, never as a negative', () => {
  // the book filled white inside its own outline, the wordmark white, and the
  // board's own logo is the one file it always was
  assert.match(script, /fill = np\.where\(pages\[\.\.\., None\], WHITE, under\)/)
  assert.match(script, /under \* \(1 - word_alpha\) \+ WHITE \* word_alpha/)
  assert.doesNotMatch(board, /tj-logo-light|logoLightImg/)
  assert.match(board, /const logo = this\.logoImg/)
  assert.equal(existsSync(new URL('../assets/brand/tj-logo-light.png', import.meta.url)), false)
})

test('the background is the board asking and the pitch answering', () => {
  assert.equal(pitchPaper('pitch', 'grass'), 'grass')
  assert.equal(pitchPaper('pitch', undefined), 'white')
  assert.equal(pitchPaper('live', 'slate'), 'white')
  assert.equal(pitchPaper('bg:mine', 'dark'), 'white')
  assert.equal(scenePaper({ pitch: 'full-pitch', paper: 'slate' }), 'slate')
  assert.equal(sceneIsDark({ pitch: 'full-pitch', paper: 'slate' }), true)
  assert.equal(sceneIsDark({ pitch: 'bg:mine', paper: 'grass' }), false)
  assert.equal(sceneIsDark(undefined), false)
})

test('Cream is a light paper and Steel a dark one', () => {
  assert.equal(sceneIsDark({ pitch: 'pitch', paper: 'cream' }), false)
  assert.equal(sceneIsDark({ pitch: 'pitch', paper: 'steel' }), true)
  assert.equal(sceneLook({ pitch: 'pitch', paper: 'cream' })['player.nameColor'], appearanceDefault('player.nameColor'))
  assert.equal(sceneLook({ pitch: 'pitch', paper: 'steel' })['player.nameColor'], '#f5f5f7')
  // white to cream is light to light: nobody's ink moves
  const scene = { ...emptyScene('pitch'), objects: [{ id: 'a', type: 'arrow', color: '#111111' }] as unknown as SceneObj[] }
  setScenePaper(scene, 'cream')
  assert.equal(scene.paper, 'cream')
  assert.equal((scene.objects[0] as { color: string }).color, '#111111')
  setScenePaper(scene, 'steel')
  assert.equal((scene.objects[0] as { color: string }).color, '#ffffff')
  // the cream drawing keeps the mark black, as it is on white
  assert.match(script, /if paper == 'cream':/)
})

test('a background survives a save, and a board saved dark before reads as Dark', () => {
  assert.equal(migrate({ ...emptyScene('pitch-up'), paper: 'grass' }).paper, 'grass')
  assert.equal(migrate({ ...emptyScene('pitch'), paper: 'cream' }).paper, 'cream')
  assert.equal(migrate({ ...emptyScene('pitch'), paper: 'steel' }).paper, 'steel')
  assert.equal(migrate({ ...emptyScene('pitch'), dark: true }).paper, 'dark')
  assert.equal('paper' in migrate(emptyScene('pitch')), false)
  assert.equal('dark' in migrate({ ...emptyScene('pitch'), dark: true }), false)
  // a save cannot talk a board onto a paper that does not exist
  assert.equal('paper' in migrate({ ...emptyScene('pitch'), paper: 'neon' }), false)
  assert.equal('paper' in migrate({ ...emptyScene('pitch'), paper: 'white' }), false)
})

test('a change of background is a board change: it undoes', () => {
  assert.match(store, /paper: s\.paper \?\? null, board: s\.board/)
  assert.equal((store.match(/if \(parsed\.paper\) this\.scene\.paper = parsed\.paper\n    else delete this\.scene\.paper/g) ?? []).length, 2)
})

test('players keep a black ring on every background; only the names go light', () => {
  const white = resolveAppearance(undefined)
  const dark = resolveAppearance(undefined, true)
  assert.equal(dark['player.outlineColor'], appearanceDefault('player.outlineColor'))
  assert.equal(dark['player.outlineColor'], '#0b0b0e')
  assert.equal(white['player.nameColor'], appearanceDefault('player.nameColor'))
  assert.equal(dark['player.nameColor'], '#f5f5f7')
  for (const key of Object.keys(white) as (keyof typeof white)[]) {
    if (key === 'player.nameColor') continue
    assert.equal(dark[key], white[key], key)
  }
  // a colour the author chose is theirs on any paper
  assert.equal(resolveAppearance({ player: { nameColor: '#e02020' } }, true)['player.nameColor'], '#e02020')
  for (const paper of DARK_PAPERS) {
    assert.equal(sceneLook({ pitch: 'pitch', paper })['player.outlineColor'], '#0b0b0e', paper)
    assert.equal(sceneLook({ pitch: 'pitch', paper })['player.nameColor'], '#f5f5f7', paper)
  }
  // arms are the ring's own ink
  assert.match(board, /closed: true,\n          fill: '#0b0b0e',/)
  assert.match(board, /private look\(\): ResolvedAppearance \{ return sceneLook\(this\.renderingScene \?\? this\.store\.scene\) \}/)
})

test('ink moves between white and dark, and stays put from one dark to another', () => {
  const objects = [
    { id: 'a', type: 'arrow', color: '#111111' },
    { id: 'b', type: 'arrow', color: '#e02020' },
    { id: 't', type: 'text', color: '#111827' },
    { id: 'p', type: 'player', color: '#111827' },
  ] as unknown as SceneObj[]
  const scene = { ...emptyScene('pitch'), objects }
  const colours = () => scene.objects.map(o => (o as { color: string }).color)
  setScenePaper(scene, 'grass')
  assert.deepEqual(colours(), ['#ffffff', '#e02020', '#ffffff', '#111827'])
  setScenePaper(scene, 'slate')
  assert.equal(scene.paper, 'slate')
  assert.deepEqual(colours(), ['#ffffff', '#e02020', '#ffffff', '#111827'])
  setScenePaper(scene, 'white')
  assert.equal('paper' in scene, false)
  assert.deepEqual(colours(), ['#111111', '#e02020', '#111111', '#111827'])
  // the same rule, on its own
  repaperInk(objects, true)
  assert.equal((objects[0] as { color: string }).color, '#ffffff')
})

test('a head needs a line when its kit is the colour of the paper', () => {
  assert.equal(headNeedsLine('#ffffff', false), true)
  assert.equal(headNeedsLine('#111827', false), false)
  assert.equal(headNeedsLine('#ffffff', true), false)
  assert.equal(headNeedsLine('#111827', true), true)
})

test('a new board is started on the background the open one is on', () => {
  const input = {
    builtIn: PITCHES, saved: [], currentPitch: pitchById('pitch'), admin: false,
    canPick: () => true, canUpload: true,
  }
  assert.equal(addBoardChoices(input).pitches.find(p => p.id === 'pitch-up')!.art, pitchById('pitch-up').src)
  assert.equal(addBoardChoices({ ...input, paper: 'grass' }).pitches.find(p => p.id === 'pitch-up')!.art, pitchById('pitch-up').papers!.grass)
  assert.match(main, /function blankSceneLike\(pitchId: string \| undefined\): Scene \{\n  const scene = emptyScene\(pitchId\)\n  if \(store\.scene\.paper\) scene\.paper = store\.scene\.paper/)
})

test('the choice is the board\'s own, in Settings, and never the app theme\'s', () => {
  assert.match(main, /data-paper-seg/)
  assert.match(main, /data-set="paper-\$\{p\.id\}"/)
  assert.match(main, /choosePaper\(k\.slice\(6\) as BoardPaper\)/)
  const theme = main.slice(main.indexOf('function setThemeResolved'), main.indexOf('function prefersDark'))
  assert.doesNotMatch(theme, /scene\.paper|applyBoardPaper/)
  // each paper family keeps its own saved styles, white under the old key
  assert.match(main, /function pitchStyleKey\(id: string, dark: boolean\): string \{ return dark \? `\$\{id\}@dark` : id \}/)
})
