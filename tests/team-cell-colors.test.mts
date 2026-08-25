import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const main = await readFile(new URL('../src/main.ts', import.meta.url), 'utf8')
const teams = await readFile(new URL('../src/teams.ts', import.meta.url), 'utf8')

test('a second tap on a team cell cycles that team kit', () => {
  assert.match(main, /again: \(\) => teams\.cycleTeamColor\(team\.name\)/)
  // the double-tap window is per cell, so tapping two different cells in
  // quick succession is still two single taps
  assert.match(main, /lastCellTap\?\.id === item\.id && now - lastCellTap\.time < 320/)
})

test('cycling a kit never places a player', () => {
  assert.match(main, /if \(doubled && item\.again\) \{ item\.again\(\); renderPanel\(\); return \}/)
})

test('a one-kit team still has somewhere to cycle to', () => {
  assert.match(teams, /team\.colours\.length > 1 \? team\.colours : \[team\.color, \.\.\.FALLBACK_COLORS/)
})

test('the two sides do not cycle into the same colour', () => {
  assert.match(teams, /const clear = full\.filter\(c => c !== other\)/)
  assert.match(teams, /const palette = clear\.length > 1 \? clear : full/)
})
