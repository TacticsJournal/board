import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { boardUserSearchUrl } from '../src/board-api.ts'

const saves = readFileSync(new URL('../src/saves.ts', import.meta.url), 'utf8')
const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8')

test('username sharing searches through the fixed same-origin Board route', () => {
  assert.equal(boardUserSearchUrl(), '/api/board/user-search')
  assert.match(saves, /fetch\(`\$\{boardUserSearchUrl\(\)\}\?q=\$\{encodeURIComponent\(query\)\}`/)
  assert.match(saves, /credentials: 'include', signal: controller\.signal/)
  assert.match(saves, /setTimeout\(async \(\) => \{[\s\S]*\}, 200\)/)
  assert.match(saves, /userSearchController\?\.abort\(\)/)
})

test('the username field is an accessible free-text combobox', () => {
  assert.match(saves, /role="combobox" aria-autocomplete="list" aria-haspopup="listbox"/)
  assert.match(saves, /role="listbox" aria-label="User suggestions"/)
  assert.match(saves, /option\.setAttribute\('role', 'option'\)/)
  assert.match(saves, /aria-activedescendant/)
  assert.match(saves, /event\.key === 'ArrowDown' \|\| event\.key === 'ArrowUp'/)
  assert.match(saves, /event\.key === 'Enter' && activeUser >= 0/)
  assert.match(saves, /event\.key === 'Escape' && !userPanel\.hidden/)
  assert.doesNotMatch(saves, />Community members</)
  assert.doesNotMatch(saves, />Suggested from Community</)
})

test('autocomplete keeps exact manual username invitations working', () => {
  assert.match(saves, /const username = input\('username'\)\.value\.trim\(\)\.replace\(\/\^@\//)
  assert.match(saves, /request\(boardSharesUrl\(\), 'POST', \{ board_id: shareId, username, role: role\(\) \}\)/)
  assert.doesNotMatch(saves, /if \(!picked\)|Choose a Community member first/)
})

test('the attached results panel fits the share sheet and exposes active rows', () => {
  assert.match(styles, /\.shareUserCombo\.is-open input \{[\s\S]*border-radius: 9px 9px 0 0;/)
  assert.match(styles, /\.shareUserPanel \{[\s\S]*border-radius: 0 0 9px 9px;/)
  assert.match(styles, /\.shareUserOptions \{ display: block; max-height: 216px; overflow-y: auto; \}/)
  assert.match(styles, /\.shareUserPanel \.shareUserOption \{[\s\S]*min-height: 48px;/)
  assert.match(styles, /\.shareUserIdentity strong \{[^}]*text-overflow: ellipsis;/)
  assert.match(styles, /\.shareUserOption\.is-active/)
})
