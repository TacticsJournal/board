import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { rosterByNumber } from '../src/roster.ts'

const teams = await readFile(new URL('../src/teams.ts', import.meta.url), 'utf8')
const main = await readFile(new URL('../src/main.ts', import.meta.url), 'utf8')
const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8')
const icons = await readFile(new URL('../src/icons.ts', import.meta.url), 'utf8')

const picker = teams.slice(
  teams.indexOf('private editorBody'),
  teams.indexOf('private queryFor'),
)

test('the selected-player roster is sorted by shirt number', () => {
  const roster = [
    { name: 'Ten', number: '10' },
    { name: 'Unassigned', number: '' },
    { name: 'Two', number: '2' },
    { name: 'Invalid', number: 'TBD' },
    { name: 'One', number: '1' },
  ]

  assert.deepEqual(rosterByNumber(roster).map(player => player.name), [
    'One',
    'Two',
    'Ten',
    'Unassigned',
    'Invalid',
  ])
  assert.deepEqual(roster.map(player => player.name), ['Ten', 'Unassigned', 'Two', 'Invalid', 'One'])
  assert.match(teams, /getRosterForPicker[\s\S]*rosterByNumber\(team\.roster\)/)
})

test('teams use one side selector and one shared editor', () => {
  assert.match(picker, /class="tmSideSwitch" role="radiogroup"/)
  assert.match(picker, /class="tmSideCard"[\s\S]*role="radio" aria-checked=/)
  assert.equal((picker.match(/<input class="setSearch" data-tm="query"/g) ?? []).length, 1)
  assert.equal((picker.match(/class="setGroup tmEditor"/g) ?? []).length, 1)
  assert.doesNotMatch(picker, /tmCard empty|data-tm="card"/)
})

test('the selected side editor owns search, kits, lineup state, and clear', () => {
  assert.match(picker, /Search teams for the \$\{label\.toLowerCase\(\)\} side/)
  assert.match(picker, /role="group" aria-label="\$\{label\} kit color"/)
  assert.match(picker, /Starting XI[\s\S]*Added/)
  assert.match(picker, /Clear \$\{label\.toLowerCase\(\)\} team/)
})

test('loading a new side adds its starting XI and advances to the empty side', () => {
  assert.match(teams, /if \(!hadTeamPlayers\) this\.onAddLineup\(name\)/)
  assert.match(teams, /const nextSide = roster\?\.length && !this\.getTeamForSide\(otherSide\) \? otherSide : side/)
  assert.match(teams, /if \(nextSide !== side\) this\.queryFor\(nextSide\)\?\.focus\(\)/)
})

test('side changes invalidate stale searches and squad loads', () => {
  assert.match(teams, /this\.searchSeq\+\+[\s\S]*this\.loadSeq\+\+/)
  assert.match(teams, /seq !== this\.searchSeq \|\| side !== this\.editingSide/)
  assert.match(teams, /seq !== this\.loadSeq \|\| side !== this\.editingSide/)
})

test('same-colored sides do not claim each other’s untagged dots', () => {
  assert.match(teams, /const colorShared = this\.loaded\.some\(t => t\.name !== team\.name && t\.color === team\.color\)/)
  assert.match(teams, /!colorShared && !o\.team && o\.color === team\.color/)
})

test('empty and failed searches keep visible feedback in the editor', () => {
  assert.match(teams, /No clubs or national teams match that search/)
  assert.match(teams, /Could not search teams\. Check your connection and try again/)
  assert.match(teams, /Could not load that squad\. Check your connection and try again/)
})

test('team results use the board player dot instead of initials', () => {
  assert.match(teams, /class="setDot tmTeamPlayer"/)
  assert.doesNotMatch(teams, /tmCrest/)
  assert.match(styles, /\.tmTeamPlayer \{ width: 25px; height: 25px; \}/)
})

test('Home and Away stay title case without all-caps styling', () => {
  assert.match(teams, /<span class="tmSideTag">\$\{label\}<\/span>/)
  const tagRule = styles.match(/\.tmSideTag \{[^}]+\}/)?.[0] ?? ''
  assert.doesNotMatch(tagRule, /text-transform\s*:\s*uppercase/)
})

test('the editor ends at Clear without reserved blank height', () => {
  assert.match(styles, /\.tmEditorBody \{ min-height: 0; \}/)
  assert.doesNotMatch(styles, /\.tmEditorBody \{[^}]*min-height:\s*(?!0(?:px)?[;\s])\d+/)
})

test('Flip board uses a side-to-side icon', () => {
  assert.match(teams, /icon\('flip-horizontal'\)/)
  assert.match(icons, /'flip-horizontal':/)
})

test('side cards support radio arrow-key navigation', () => {
  assert.match(teams, /\['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'\]\.includes\(e\.key\)/)
  assert.match(teams, /data-tm="pick-side"\]\[data-side="\$\{side\}"\]/)
})

test('a keyboard-shortened viewport condenses the picker instead of hiding it', () => {
  // the board publishes the state; the picker gives its height to the results
  assert.match(main, /classList\.toggle\('kb-open', short && \(editing \|\| held\)\)/)
  assert.match(main, /const short = inset > 120 \|\| height < 520/)
  assert.match(styles, /body\.kb-open \.tmResults \{ max-height: none; overflow: visible; \}/)
  assert.match(styles, /body\.kb-open \.tmSideMeta \{ display: none; \}/)
  assert.match(styles, /body\.kb-open \.tmPane \{ padding-bottom:/)
})

test('the search field goes to the top of a short screen, not its middle', () => {
  assert.match(main, /block: searching \? 'start' : 'center'/)
  assert.match(main, /matchMedia\('\(prefers-reduced-motion: reduce\)'\)\.matches \? 'auto' : 'smooth'/)
})

test('results that land below the fold lift the field without taking focus', () => {
  assert.match(teams, /private revealResults\(side: TeamSide\)/)
  assert.match(teams, /if \(!input \|\| !results \|\| document\.activeElement !== input\) return/)
  assert.match(teams, /if \(results\.getBoundingClientRect\(\)\.top <= visibleBottom - 64\) return/)
  assert.match(teams, /behavior: window\.matchMedia\('\(prefers-reduced-motion: reduce\)'\)\.matches \? 'auto' : 'smooth'/)
  // every rendered state gets the same treatment: hits, no matches, offline
  assert.equal((teams.match(/this\.revealResults\(side\)/g) ?? []).length, 3)
})

test('the field says which side it fills, for when the cards scroll off', () => {
  assert.match(teams, /<span class="tmSearchSide" aria-hidden="true">\$\{label\}<\/span>/)
  assert.match(styles, /body\.kb-open \.tmSearchSide \{ display: inline-flex; \}/)
})

test('the keyboard does not count as a screen too small for the board', () => {
  assert.match(main, /const keyboard = window\.innerHeight - height > 120 \|\| document\.body\.classList\.contains\('kb-open'\)/)
  assert.match(main, /const room = keyboard \? window\.innerHeight : height/)
  assert.match(main, /room < 300/)
})

test('the mobile sheet covers the translucent edge above the iOS keyboard', () => {
  assert.match(main, /style\.setProperty\('--vvBottom', `\$\{Math\.max\(0, window\.innerHeight - top - height\)\}px`\)/)
  assert.match(main, /settingsEl\.className = 'modal hidden settingsModal'/)
  assert.match(styles, /body\.kb-open \.settingsModal:not\(\.hidden\)::after/)
  assert.match(styles, /height: var\(--vvBottom, 0px\)/)
  assert.match(styles, /background: var\(--settings-bg\)/)
  assert.match(styles, /--bg: var\(--settings-bg\)/)
})
