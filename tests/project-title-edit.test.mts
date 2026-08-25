import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const view = await readFile(new URL('../src/boards-view.ts', import.meta.url), 'utf8')
const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8')

test('the current project title opens an accessible inline name field', () => {
  assert.match(view, /title\.dataset\.lib = 'rename-current'/)
  assert.match(view, /Rename project, currently \$\{project\.name\}/)
  assert.match(view, /case 'rename-current': this\.renameCurrentProject\(\)/)
  assert.match(view, /input\.setAttribute\('aria-label', 'Project name'\)/)
  assert.match(view, /input\.setAttribute\('enterkeyhint', 'done'\)/)
  assert.match(view, /input\.focus\(\)[\s\S]*?project\.name === UNTITLED[\s\S]*?input\.select\(\)/)
})

test('inline project naming saves, falls back to Untitled, and supports cancel', () => {
  assert.match(view, /input\.value\.trim\(\) \|\| UNTITLED/)
  assert.match(view, /name !== project\.name[\s\S]*?touch\(project\)[\s\S]*?this\.host\.changed\(project\)/)
  assert.match(view, /e\.key === 'Enter'[\s\S]*?restoreFocus = true[\s\S]*?input\.blur\(\)/)
  assert.match(view, /e\.key === 'Escape'[\s\S]*?cancelled = true[\s\S]*?restoreFocus = true[\s\S]*?input\.blur\(\)/)
  assert.match(view, /input\.addEventListener\('blur', finish, \{ once: true \}\)/)
  assert.match(view, /restoreFocus[\s\S]*?querySelector<HTMLElement>\('\.libTitle'\)\?\.focus\(\)/)
})

test('the title field keeps the existing header geometry', () => {
  assert.match(styles, /\.libTitleSlot \{[\s\S]*?flex: 1;[\s\S]*?min-width: 0;/)
  assert.match(styles, /button\.libTitle \{[\s\S]*?height: 40px;/)
  assert.match(styles, /\.libTitleInput \{[\s\S]*?height: 28px;[\s\S]*?text-align: center;[\s\S]*?font-size: 16px;/)
})
