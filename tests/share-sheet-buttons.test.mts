import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8')
const saves = readFileSync(new URL('../src/saves.ts', import.meta.url), 'utf8')
const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8')

function rule(selector: string): string {
  const start = styles.indexOf(`${selector} {`)
  assert.ok(start >= 0, `missing rule for ${selector}`)
  return styles.slice(start, styles.indexOf('}', start))
}

test('share segments contrast with the light sheet and show their selected state', () => {
  const track = rule('.shareWays')
  assert.doesNotMatch(track, /background:\s*var\(--bg\)/)
  assert.match(track, /background:\s*var\(--bar\)/)

  const selected = rule('.shareWays button[aria-selected="true"],\n.shareWays button[aria-checked="true"]')
  assert.match(selected, /background:\s*var\(--card\)/)
  assert.match(selected, /box-shadow:/)
})

test('copy uses a fixed icon button and a reduced-motion-safe CSS swap', () => {
  const field = rule('.linkField')
  const button = rule('.linkField button')
  assert.match(field, /width:\s*100%/)
  assert.match(field, /min-width:\s*0/)
  assert.match(button, /width:\s*44px/)
  assert.match(button, /min-width:\s*44px/)
  assert.match(button, /height:\s*44px/)
  assert.match(styles, /\.t-icon-swap \{[\s\S]*?display:\s*inline-grid/)
  assert.match(styles, /\.t-icon-swap\[data-state="b"\] \.t-icon\[data-icon="b"\]/)
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\.t-icon-swap \.t-icon \{ transition: none !important; \}/)
  assert.doesNotMatch(main, /from ["']@\/components\/modern-ui\/copy-button["']/)
  assert.match(main, /showCopySuccess\(copy/)
  assert.match(saves, /swap\.dataset\.state = done \? 'b' : 'a'/)
})

test('the invitation submit is a filled button with a full touch target', () => {
  const submit = rule('.shareActions button[type="submit"]')
  assert.match(submit, /background:\s*var\(--action\)/)
  assert.match(submit, /min-height:\s*44px/)
  assert.ok(styles.includes('.shareActions button:disabled { opacity: 0.45; }'))
})

test('the form keeps semantic selection states for assistive technology', () => {
  assert.match(saves, /aria-selected="\$\{index === 0\}"/)
  assert.match(saves, /aria-checked="\$\{index === 0\}"/)
})

test('Classic pitch PNG exports use the Tactics Journal filename', () => {
  assert.match(main, /store\.scene\.pitch === 'classic'[\s\S]*?'Pitch - Board Tactics Journal\.png'/)
  assert.match(main, /new File\(\[dataUrlToBlob\(url\)\], filename/)
  assert.match(main, /download\(filename, url\)/)
})
