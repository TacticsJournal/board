import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const board = await readFile(new URL('../src/board.ts', import.meta.url), 'utf8')
const types = await readFile(new URL('../src/types.ts', import.meta.url), 'utf8')
const main = await readFile(new URL('../src/main.ts', import.meta.url), 'utf8')
const saves = await readFile(new URL('../src/saves.ts', import.meta.url), 'utf8')

// Every piece carries an angle, so a saved angle has to survive a reload and
// every renderer has to read it back.
test('an angle round-trips through the scene and into every renderer', () => {
  assert.match(types, /type Flippable = \{[\s\S]*rotation\?: number/)
  assert.match(types, /const spin = \{ rotation: finiteNumber\(o\.rotation, 0, -3600, 3600\) \}/)
  for (const piece of ["'ball'", "'cone'", "'marker'"]) {
    const line = types.split('\n').find(l => l.includes(`type: ${piece}`) && l.includes('...spin'))
    assert.ok(line, `${piece} keeps its angle through migrate`)
  }
  // box and text own their rotation field: the shared spread must not clobber it
  assert.doesNotMatch(types, /rotation: finiteNumber\(o\.rotation, 0, -3600, 3600\),[\s\S]{0,200}\.\.\.spin/)

  assert.equal(board.match(/rotation: o\.rotation \?\? 0/g)?.length, 6, 'player, marker, ball, cone, goal and a user asset all draw at their angle')
  assert.match(saves, /function spin\(o: any\): string/)
  for (const shape of ['<ellipse${spin(o)}', '<rect${spin(o)}']) {
    assert.ok(saves.includes(shape), `${shape} is exported at its angle`)
  }
  // the pieces drawn from the board's own art turn and flip about their centre
  assert.match(saves, /function turn\(o: any\): string[\s\S]{0,400}rotate\(/)
  assert.match(saves, /function turn\(o: any\): string[\s\S]{0,400}scale\(\$\{sx\} \$\{sy\}\)/)
  // a still writes the picture; a player that redraws every frame points at it
  assert.ok(saves.includes('<image${turn(o)}'), 'board art is exported at its angle')
  assert.ok(saves.includes('<use${turn(o)}'), 'and pointed at at its angle')
})

// Press and hold the resize node, then drag: the same node that scales an
// object turns it, for whatever is selected.
test('hold-then-drag on the resize node turns any object', () => {
  assert.match(board, /let mode: 'scale' \| 'rotate' = 'scale'/)
  assert.match(board, /holdTimer = window\.setTimeout\([\s\S]{0,200}mode = 'rotate'/)
  // a drag that starts before the hold lands still scales
  assert.match(board, /a\.on\('dragstart', \(\) => \{ clearHold\(\); this\.store\.beginGesture\(\) \}\)/)
  assert.match(board, /private rotateObject\(sel: SceneObj, deg: number, center: Pt\)/)
  // arrows and free-form boxes turn their points, not an angle field
  assert.match(board, /private rotateObject[\s\S]{0,700}sel\.type === 'arrow'[\s\S]{0,300}sel\.x1 = p1\.x/)
  assert.match(board, /private rotateObject[\s\S]{0,1200}sel\.type === 'box' && sel\.corners/)
  // the dashed selection box has to cover the turned shape
  assert.match(board, /private unrotatedRectForObject/)
  // the toolbar's 45-degree turn is no longer limited to arrows, boxes and text
  assert.match(main, /function canRotateSelection\(\): boolean \{\s*return store\.selectedIds\.length > 0/)
})
