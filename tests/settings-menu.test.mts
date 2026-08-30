import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8')
const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8')
const rootStart = main.indexOf('data-pane="root"')
const rootEnd = main.indexOf('data-pane="howto"')
assert.ok(rootStart > -1 && rootEnd > rootStart)
const root = main.slice(rootStart, rootEnd)

function occurrences(source: string, value: string): number {
  return source.split(value).length - 1
}

function sliceBetween(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker)
  const end = source.indexOf(endMarker)
  assert.ok(start > -1 && end > start, `${startMarker} must precede ${endMarker}`)
  return source.slice(start, end)
}

test('Settings uses the flat deduplicated menu', () => {
  const heads = ['Board', 'Projects', 'Agents', 'Account', 'Help']
  let previous = -1
  for (const label of heads) {
    const at = root.indexOf(`<div class="setGroupHead">${label}</div>`)
    assert.ok(at > previous, `${label} group is missing or out of order`)
    previous = at
  }

  for (const oldLabel of ['Teams', 'Pitch', 'Appearance', 'Extend']) {
    assert.ok(!root.includes(`<div class="setGroupHead">${oldLabel}</div>`), `${oldLabel} should not be a root group`)
  }
  assert.ok(!root.includes('data-set="match"'), 'scoreboard belongs in the board toolbar, not Settings')
})

test('Board contains teams, the merged pitch route, and theme', () => {
  const board = sliceBetween(
    root,
    '<div class="setGroupHead">Board</div>',
    '<div class="setGroupHead">Projects</div>',
  )
  assert.match(board, /data-side-row="home"[\s\S]*?>Home</)
  assert.match(board, /data-side-row="away"[\s\S]*?>Away</)
  assert.match(board, /data-goto="pitch"[\s\S]*?>Pitch and background</)
  assert.match(board, /setPitchSummary[\s\S]*?data-pitch-name[\s\S]*?data-bg-count/)
  assert.match(board, /role="group" aria-label="Theme"[\s\S]*?data-set="theme-system" aria-pressed="false"[\s\S]*?data-set="theme-light" aria-pressed="false"[\s\S]*?data-set="theme-dark" aria-pressed="false"/)
  assert.match(board, /\$\{BOARD_SELF_HOSTED \? `<button class="setItem" data-goto="assets">/)
  assert.equal(occurrences(board, 'data-goto="pitch"'), 1)
  assert.match(styles, /\.setPitchSummary \{ min-width: 0; overflow: hidden; text-overflow: ellipsis; \}/)
  assert.match(styles, /\.setPitchSummary \[data-bg-count\] \{ display: none; \}/)
  assert.match(main, /button\.setAttribute\('aria-pressed', String\(selected === choice\)\)/)
})

test('Agents, Account, and Help keep every existing destination discoverable', () => {
  const agents = sliceBetween(
    root,
    '<div class="setGroupHead">Agents</div>',
    '${BOARD_SELF_HOSTED ? `<div class="setGroupHead">Hosting</div>',
  )
  assert.match(agents, /data-goto="skills"[\s\S]*?>Skills and Extensions</)
  assert.match(agents, /BOARD_SELF_HOSTED \? '' : `<button class="setItem" data-goto="agents">[\s\S]*?>Connect Claude or ChatGPT</)

  const account = sliceBetween(
    root,
    '<div class="setGroupHead">Account</div>',
    '<div class="setGroupHead">Help</div>',
  )
  assert.match(account, /data-set="signin"[\s\S]*?Sign in to Tactics Journal/)
  assert.match(account, /data-goto="pro"[\s\S]*?>Plans</)
  assert.match(account, /data-goto="assets"[\s\S]*?>My assets</)

  const helpStart = root.indexOf('<div class="setGroupHead">Help</div>')
  assert.ok(helpStart > -1)
  const help = root.slice(helpStart)
  assert.match(help, /data-goto="howto"[\s\S]*?>How to use</)
  assert.match(help, /data-goto="about"[\s\S]*?>Privacy, data and terms</)
  assert.match(help, /BOARD_SELF_HOSTED \? '' : `<button class="setItem" data-goto="feedback">[\s\S]*?>Feedback</)
  assert.equal(occurrences(help, 'data-goto="howto"'), 1)
  assert.equal(occurrences(help, 'data-goto="about"'), 1)
})

test('the hosted privacy page describes tracking and personal data accurately', () => {
  const about = sliceBetween(main, 'data-pane="about"', 'data-pane="self-host"')
  assert.match(about, /<strong>Privacy, data, copyright and use<\/strong>/)
  assert.match(about, /Board sends first-party aggregate counters/)
  assert.match(about, /no IP address, account ID, visitor ID, URL, referrer, cookies, or arbitrary text/)
  assert.match(about, /kept for 14 months/)
  assert.match(about, /no advertising, third-party analytics, or cross-site tracking cookies/)
})
