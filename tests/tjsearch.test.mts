import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const search = readFileSync(new URL('../src/tjsearch.ts', import.meta.url), 'utf8')
const header = readFileSync(new URL('../src/tjheader.ts', import.meta.url), 'utf8')

test('site search sends the query only, with no cookies or referrer', () => {
  const calls = [...search.matchAll(/fetch\(([^\n]*)\)/g)].map(match => match[1])
  assert.equal(calls.length, 1)
  assert.match(calls[0], /`\$\{TJ\}\/api\/search\?q=\$\{encodeURIComponent\(query\)\}&limit=30`/)
  assert.match(calls[0], /credentials: 'omit'/)
  assert.match(calls[0], /referrerPolicy: 'no-referrer'/)
  assert.match(search, /const TJ = 'https:\/\/tacticsjournal\.com'/)
  assert.doesNotMatch(search, /credentials: 'include'|document\.cookie|localStorage/)
})

test('the site header makes no network requests', () => {
  assert.doesNotMatch(header, /fetch\(|XMLHttpRequest|sendBeacon|credentials/)
})
