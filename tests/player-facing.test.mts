import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { resolveNamePos, sanitizeObjects, trackPlayersAtBall } from '../src/types.ts'
import { attackAngle } from '../src/pitch-map.ts'

const main = await readFile(new URL('../src/main.ts', import.meta.url), 'utf8')
const board = await readFile(new URL('../src/board.ts', import.meta.url), 'utf8')
const saves = await readFile(new URL('../src/saves.ts', import.meta.url), 'utf8')
const teams = await readFile(new URL('../src/teams.ts', import.meta.url), 'utf8')
const types = await readFile(new URL('../src/types.ts', import.meta.url), 'utf8')
const iconsSrc = await readFile(new URL('../src/icons.ts', import.meta.url), 'utf8')

const player = (extra: Record<string, unknown> = {}) => ({
  id: 'p1', type: 'player', x: 100, y: 100, r: 13, color: '#e02020',
  label: '', name: '', namePos: 'bottom', nameSize: 18, nameDisplay: 'last', ...extra,
})

test('arms are kept and wrapped the same way a head is', () => {
  const [none] = sanitizeObjects([player()]) as any[]
  assert.equal('arms' in none, false)
  const [set] = sanitizeObjects([player({ arms: 200 })]) as any[]
  assert.equal(set.arms, 200)
  const [wrapped] = sanitizeObjects([player({ arms: -45 })]) as any[]
  assert.equal(wrapped.arms, 315)
})

test('arms are crescents off the token, thick at the ring and tapering away', () => {
  assert.match(board, /if \(typeof o\.arms === 'number'\)/)
  assert.match(types, /export function armPoints\(deg: number, side: 1 \| -1, r: number\): number\[\]/)
  // it leaves behind the shoulder and reaches forward: the free end is in front
  assert.match(types, /const FROM = 100, TO = 46/)
  // the base starts inside the ring, so arm and ring are one shape with no seam
  assert.match(types, /const NEAR = 0\.95, FAR = 1\.66/)
  // one shape, drawn by the board and by the export
  assert.match(board, /points: armPoints\(o\.arms, side, r\)/)
  assert.match(saves, /const pts = armPoints\(Number\(o\.arms\), side, r\)/)
})

test('only a white kit needs a line round its head', () => {
  // a lilac or a keeper's grey is a colour and carries itself on a pale pitch
  assert.match(types, /export function isWhiteish\(hex: string\): boolean/)
  assert.match(types, /return r >= 232 && g >= 232 && b >= 232/)
  assert.match(board, /const pale = isWhiteish\(o\.color\)/)
  assert.match(saves, /const pale = isWhiteish\(String\(o\.color\)\)/)
})

test('one spin turns whatever the player wears, keeping them together', () => {
  assert.match(board, /typeof sel\.facing === 'number' \|\| typeof sel\.arms === 'number'/)
  assert.match(board, /if \(typeof sel\.facing === 'number'\) sel\.facing = turn\(origSnapshot\.facing\)/)
  assert.match(board, /if \(typeof sel\.arms === 'number'\) sel\.arms = turn\(origSnapshot\.arms\)/)
})

test('a facing is kept, wrapped into a turn, and absent when it was never set', () => {
  const [none] = sanitizeObjects([player()]) as any[]
  assert.equal('facing' in none, false)
  const [set] = sanitizeObjects([player({ facing: 45 })]) as any[]
  assert.equal(set.facing, 45)
  // a saved board, or an agent, can hand over any number of turns
  const [wrapped] = sanitizeObjects([player({ facing: -90 })]) as any[]
  assert.equal(wrapped.facing, 270)
  const [round] = sanitizeObjects([player({ facing: 405 })]) as any[]
  assert.equal(round.facing, 45)
  const [junk] = sanitizeObjects([player({ facing: 'sideways' })]) as any[]
  assert.equal('facing' in junk, false)
})

test('the head is drawn behind the token, and stands clear of its ring', () => {
  // the ring's outer edge is r * 1.19; touching it, the two read as one blob
  assert.match(types, /const base = r \* 1\.41, tip = base \+ r \* 0\.9, half = r \* 0\.78/)
  assert.match(board, /\.\.\.\(pale \? \{ stroke: '#0b0b0e', strokeWidth: Math\.max\(0\.75, r \* 0\.12\) \} : \{\}\)/)
  // and behind the dot, so it reads as a direction rather than a bite out of it
  assert.match(board, /if \(typeof o\.facing === 'number'\)[\s\S]{0,1400}?g\.add\(new Konva\.Circle/)
})

test('an export draws it too, or a board would lose it on the way out', () => {
  assert.match(saves, /if \(Number\.isFinite\(o\.facing\)\)/)
})

test('the mark pills carry icons from the set, not words or one-off drawings', () => {
  const icons = ['number', 'users-group']
  for (const name of icons) assert.match(iconsSrc, new RegExp(`'${name}':`))
  // the pill is the number when he has one, and the set's glyph when he does not
  assert.match(main, /sel\.label \? esc\(sel\.label\) : icon\('number', 'ic markIc'\)/)
  // neither mark is an icon: both pills draw the board's own shapes, and take
  // their colour from the pill so one drawing serves lit and bare
  assert.match(main, /facing: \(\) => styleArt\.mark\(\[headPoints\(0, 6\)\], 6\)/)
  assert.match(main, /arms: \(\) => styleArt\.mark\(\[armPoints\(0, 1, 7\), armPoints\(0, -1, 7\)\], 7\)/)
  // a pill is a button, not a readout: it points right and sits in the middle
  assert.match(main, /const box = `\$\{\(x0 \+ \(x1 - x0 - side\) \/ 2\)/)
  assert.match(main, /stroke="currentColor" stroke-width="\$\{\(r \* 0\.38\)\.toFixed\(2\)\}"/)
  assert.match(main, /squad: icon\('users-group', 'ic markIc'\)/)
  // one geometry for the head, drawn by the board, the export and the pill
  assert.match(types, /export function headPoints\(deg: number, r: number\): number\[\]/)
  assert.match(board, /points: headPoints\(o\.facing, r\)/)
  assert.match(saves, /const pts = headPoints\(Number\(o\.facing\), r\)/)
})

test('heads are a way of drawing, so they go on for everybody', () => {
  assert.match(main, /data-style="facing"/)
  assert.match(main, /function setProjectMark\(mark: PlayerMark, show: boolean\)/)
  // the open board and every other board in the project, undone in one step
  assert.match(main, /store\.apply\(s => \{ for \(const o of s\.objects\) if \(o\.type === 'player'\) put\(o\) \}\)/)
  assert.match(main, /data-style="arms"/)
  assert.match(main, /run: \(\) => setProjectMark\(mark, !show\)/)
  // and the next player made joins a board that has them
  assert.match(main, /\.\.\.\(defaults\.showFacing \? \{ facing: startingAngle\(\{ team \}\) \} : \{\}\)/)
  // off takes the mark off the board rather than parking it at zero
  assert.match(main, /delete o\[mark\]/)
})

test('a player\'s node turns him rather than resizing him', () => {
  // Players are all one size, set for the project, so scaling one is not a
  // thing the handle should offer. Every other custom top-right node turns too.
  assert.match(board, /const spins = sel\.type === 'player'/)
  assert.doesNotMatch(board, /private scaleObject\(/)
  // There is no node on a player with nothing visible to turn.
  assert.match(board, /if \(spins && typeof sel\.facing !== 'number' && typeof sel\.arms !== 'number'\) return/)
  // It looks like every other handle. Only its larger offset hit target differs,
  // giving it enough room to be grabbed.
  assert.match(board, /fill: '#ffffff',/)
  assert.match(board, /const hitR = Math\.max\(r \* 1\.5, \(spins \? 22 : 18\) \/ this\.screenScale\(\)\)/)
  // the room is in the empty corner, not over the player
  assert.match(board, /const hitOff = spins \? hitR \* 0\.62 : 0/)
  assert.match(board, /ctx\.arc\(hitOff \* Math\.SQRT1_2, -hitOff \* Math\.SQRT1_2, hitR/)
})

test('the direction is spun on the board, not chosen from a list', () => {
  // holding the top-right node already rotated; for a round token that did
  // nothing you could see, so it turns the head instead
  assert.match(board, /if \(sel\.type === 'player' && \(typeof sel\.facing === 'number' \|\| typeof sel\.arms === 'number'\)\)/)
  assert.doesNotMatch(main, /data-style="face"/)
  assert.doesNotMatch(main, /FACINGS/)
})

test('home starts pointing at the away goal, and away back the other way', () => {
  assert.match(main, /function startingAngle\(o: \{ team\?: string \}\)/)
  assert.match(main, /return attackAngle\(!!\(away && o\.team && o\.team === away\.name\)\)/)
  // an eleven placed for the away side starts turned with it
  assert.match(main, /facing: attackAngle\(isAway\)/)
  // and on a board with the goals at the top and bottom they turn with the board
  assert.equal(attackAngle('horizontal', true), 180)
  assert.equal(attackAngle('vertical-full', false), 270)
  assert.equal(attackAngle('vertical-full', true), 90)
})

test('flipping the board turns the players with it', () => {
  // a head and a pair of arms are directions, so they mirror like everything
  assert.match(teams, /const mirror = \(deg: number\) => \(\(\(\(180 - deg\) % 360\) \+ 360\) % 360\)/)
  assert.match(teams, /if \(typeof o\.facing === 'number'\) o\.facing = mirror\(o\.facing\)/)
  assert.match(teams, /if \(typeof o\.arms === 'number'\) o\.arms = mirror\(o\.arms\)/)
})

test('the number pill is the number, and holding it is the field', () => {
  // one control, rather than a button beside a box that says the same thing
  assert.doesNotMatch(main, /class="in numIn"/)
  assert.match(main, /let editingNumber = false/)
  assert.match(main, /numberHold = window\.setTimeout\([\s\S]{0,200}editingNumber = true/)
  assert.match(main, /class="numToggle numEdit" data-style="label"/)
  // a hold must not also toggle numbers when the finger comes off
  assert.match(main, /if \(editingNumber\) return\n\s*setProjectNumbers/)
  // and picking someone else closes it
  assert.match(main, /rosterFilter = ''; editingNumber = false/)
})

test('a mark switched off and back on comes back the way it was', () => {
  assert.match(main, /const markMemory: Record<PlayerMark, Map<string, number>>/)
  assert.match(main, /if \(typeof o\[mark\] === 'number'\) remembered\.set\(o\.id, o\[mark\]\)/)
  // his own angle first, then what he was remembered at, then his side's way
  assert.match(main, /o\[mark\] = o\[mark\] \?\? remembered\.get\(o\.id\) \?\? startingAngle\(o\)/)
})

test('holding a mark points everybody at the ball', () => {
  assert.match(main, /function pointAtBall\(mark: PlayerMark\)/)
  assert.match(main, /const ball = store\.scene\.objects\.find\(o => o\.type === 'ball'\)/)
  assert.match(main, /Math\.atan2\(ball\.y - o\.y, ball\.x - o\.x\)/)
  // the first tap of the pair has already toggled, so this puts the mark back on
  assert.match(main, /if \(mark === 'facing'\) defaults\.showFacing = true/)
  // it is a hold, not a second tap: a second tap cannot be told apart from
  // switching the mark off and straight back on, which is a thing people do
  assert.match(main, /markHold = window\.setTimeout\([\s\S]{0,160}pointAtBall\(mark\.dataset\.style as PlayerMark\)/)
  assert.match(main, /if \(markHeld\) \{ markHeld = false; return \}/)
  assert.doesNotMatch(main, /lastMarkTap/)
  // no ball is a thing to say, not a thing to guess at
  assert.match(main, /showToast\('Put a ball on the board first\.'\)/)
})

test('players keep tracking when either they or the ball move, until turned by hand', () => {
  const tracked = player({ id: 'tracked', x: 100, y: 100, facing: 0, trackBall: ['facing'] }) as any
  const manual = player({ id: 'manual', x: 200, y: 100, facing: 180 }) as any
  const ball = { id: 'ball', type: 'ball', x: 100, y: 200, size: 20 } as any
  const objects = [tracked, manual, ball]

  assert.deepEqual(trackPlayersAtBall(objects, [ball.id]), [tracked.id])
  assert.equal(tracked.facing, 90)
  assert.equal(manual.facing, 180)

  ball.x = 200
  ball.y = 100
  assert.deepEqual(trackPlayersAtBall(objects, [ball.id]), [tracked.id])
  assert.equal(tracked.facing, 0)

  ball.x = 300
  tracked.x = 200
  tracked.y = 200
  assert.deepEqual(trackPlayersAtBall(objects, [tracked.id, ball.id]), [tracked.id])
  assert.equal(tracked.facing, 315)
  assert.deepEqual(tracked.trackBall, ['facing'])

  // Dragging the rotation handle is the explicit way to leave tracking.
  assert.match(board, /trackPlayersAtBall\(this\.store\.scene\.objects, a\.ids\)/)
  assert.match(board, /delete sel\.trackBall/)
  assert.match(main, /trackPlayersAtBall\(store\.scene\.objects, ids\)/)
})

test('ball tracking survives scene sanitation only for marks that exist', () => {
  const [tracked] = sanitizeObjects([player({ facing: 45, trackBall: ['facing', 'arms', 'junk'] })]) as any[]
  assert.deepEqual(tracked.trackBall, ['facing'])

  const [notTracked] = sanitizeObjects([player({ trackBall: ['facing'] })]) as any[]
  assert.equal(notTracked.trackBall, undefined)
})

test('double-tapping one selected player points only their visible marks at the ball', () => {
  assert.match(board, /if \(dbl && hitObj\?\.type === 'player' && this\.store\.selectedId === hitId\)/)
  assert.match(board, /this\.onPointPlayerAtBall\(hitId\)/)
  assert.match(main, /board\.onPointPlayerAtBall = pointPlayerAtBall/)
  assert.match(main, /function pointPlayerAtBall\(id: string\)/)
  assert.match(main, /\(\['facing', 'arms'\] as PlayerMark\[\]\)\.filter\(mark => typeof player\[mark\] === 'number'\)/)
  assert.match(main, /for \(const mark of marks\) \{\s*player\[mark\] = deg\s*setBallTracking\(player, mark, true\)/)
  assert.match(main, /showToast\('Turn on facing or arms first\.'\)/)
})

test('a name in auto gets out of the way of a head, and comes back down', () => {
  // the head reaches 2.31r past the middle; the name starts r + 5 below, so a
  // player looking down the board was wearing his own name across his face
  assert.equal(resolveNamePos({ namePos: 'auto', r: 13, facing: 90 }), 'top')
  assert.equal(resolveNamePos({ namePos: 'auto', r: 13, facing: 270 }), 'bottom')
  // sideways and up leave the space below empty, so the name stays where it is
  assert.equal(resolveNamePos({ namePos: 'auto', r: 13, facing: 0 }), 'bottom')
  assert.equal(resolveNamePos({ namePos: 'auto', r: 13, facing: 180 }), 'bottom')
  // and a player with nothing on him is a plain token: nothing to dodge
  assert.equal(resolveNamePos({ namePos: 'auto', r: 13 }), 'bottom')
})

test('the name moves at the angle where the mark starts taking the space', () => {
  const at = (facing: number) => resolveNamePos({ namePos: 'auto', r: 13, facing })
  assert.equal(at(20), 'bottom')
  assert.equal(at(21), 'top')
  assert.equal(at(159), 'top')
  assert.equal(at(160), 'bottom')
  // arms are wider than a head, so they claim the space a little sooner
  const arms = (arms: number) => resolveNamePos({ namePos: 'auto', r: 13, arms })
  assert.equal(arms(10), 'bottom')
  assert.equal(arms(11), 'top')
  assert.equal(arms(169), 'top')
  assert.equal(arms(170), 'bottom')
})

test('turning a player moves the name once, not back and forth', () => {
  // arms held straight down splay their ends sideways and reach less far than
  // arms at forty-five, so measuring reach alone made the name hop about
  // mid-turn. One band up, one band down, for either mark.
  for (const mark of ['facing', 'arms'] as const) {
    let side = resolveNamePos({ namePos: 'auto', r: 13, [mark]: 0 })
    let switches = 0
    for (let deg = 0.25; deg <= 360; deg += 0.25) {
      const next = resolveNamePos({ namePos: 'auto', r: 13, [mark]: deg })
      if (next !== side) { switches++; side = next }
    }
    assert.equal(switches, 2, `${mark} changed sides ${switches} times through a full turn`)
  }
})

test('above and below are the player\'s word, and the marks do not argue', () => {
  assert.equal(resolveNamePos({ namePos: 'bottom', r: 13, facing: 90 }), 'bottom')
  assert.equal(resolveNamePos({ namePos: 'top', r: 13, facing: 270, arms: 270 }), 'top')
  // an old board that never heard of auto reads as chosen, so it never moves
  assert.equal(resolveNamePos({ r: 13, facing: 90 }), 'bottom')
})

test('the board and the export put the name on the same side', () => {
  assert.match(board, /y: resolveNamePos\(o\) === 'top' \? -\(r \+ gap \+ fontSize\) : r \+ gap,/)
  assert.match(saves, /const baseline = resolveNamePos\(o\) === 'top' \? y - \(r \+ gap \+ size \* 0\.2\) : y \+ r \+ gap \+ size \* 0\.8/)
  // the canvas rotates the player's whole group, so the export must rotate the
  // mark and its resolved name together too
  assert.match(saves, /if \(o\.type === 'player' && Number\.isFinite\(o\.rotation\) && o\.rotation !== 0\)[\s\S]{0,180}?parts\.push\(`<g\$\{spin\(o\)\}>\$\{inner\}<\/g>`\)/)
  // a marker has no head and no arms, so its name is still simply told where
  assert.match(saves, /const baseline = o\.namePos === 'top' \? y - \(ry \+ gap \+ size \* 0\.2\)/)
})

test('auto survives a save, and anything else lands on bottom', () => {
  const [auto] = sanitizeObjects([player({ namePos: 'auto' })]) as any[]
  assert.equal(auto.namePos, 'auto')
  const [top] = sanitizeObjects([player({ namePos: 'top' })]) as any[]
  assert.equal(top.namePos, 'top')
  const [old] = sanitizeObjects([player({ namePos: 'bottom' })]) as any[]
  assert.equal(old.namePos, 'bottom')
  const [junk] = sanitizeObjects([player({ namePos: 'sideways' })]) as any[]
  assert.equal(junk.namePos, 'bottom')
  // a new player joins with it on, so the fix is the default rather than a setting to find
  assert.match(main, /namePos: 'auto',/)
  assert.match(main, /label, name, namePos: 'auto', nameSize: defaults\.nameSize/)
  // and the row offers the three, with auto first
  assert.match(main, /seg\(\[\['auto', 'Auto'\], \['top', 'Above'\], \['bottom', 'Below'\]\], sel\.namePos, 'namepos'\)/)
})
