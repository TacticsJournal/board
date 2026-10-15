import assert from 'node:assert/strict'
import test from 'node:test'

import { parseChangelog, readChangelog } from '../changelog-source.ts'
import { CHANGELOG_SEEN_KEY, markAllSeen, seenId, unreadEntries } from '../src/changelog.ts'

const store = new Map<string, string>()
;(globalThis as any).localStorage = {
  getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
  setItem: (key: string, value: string) => { store.set(key, String(value)) },
  removeItem: (key: string) => { store.delete(key) },
}

const list = [
  { id: '2026-09-06-third', date: '2026-09-06', title: 'Third', body: '', tag: '', major: false },
  { id: '2026-08-26-second', date: '2026-08-26', title: 'Second', body: '', tag: '', major: true },
  { id: '2026-08-25-first', date: '2026-08-25', title: 'First', body: '', tag: '', major: false },
]

test('a well-formed entry keeps its fields and gets a dated slug id', () => {
  const entries = parseChangelog(`<!-- notes: ## not an entry -->

## 3D View
Date: 2026-09-05
Tag: New
Major: true

Orbit the pitch with a finger and keep editing
the live board while you turn it.

## Plain entry
Date: 2026-09-01
`)
  assert.deepEqual(entries[0], {
    id: '2026-09-05-3d-view',
    date: '2026-09-05',
    title: '3D View',
    body: 'Orbit the pitch with a finger and keep editing the live board while you turn it.',
    tag: 'New',
    major: true,
  })
  assert.deepEqual(entries[1], {
    id: '2026-09-01-plain-entry',
    date: '2026-09-01',
    title: 'Plain entry',
    body: '',
    tag: '',
    major: false,
  })
})

test('entries come back newest first whatever order the file uses', () => {
  const entries = parseChangelog('## Older\nDate: 2026-01-02\n\n## Newer\nDate: 2026-05-06\n')
  assert.deepEqual(entries.map(entry => entry.title), ['Newer', 'Older'])
})

test('malformed entries are dropped and an unreadable file is an empty history', () => {
  const entries = parseChangelog(`## No date

## Bad date
Date: yesterday

## Impossible date
Date: 2026-13-45

## Good
Date: 2026-02-03

Kept.
`)
  assert.deepEqual(entries.map(entry => entry.id), ['2026-02-03-good'])
  assert.deepEqual(parseChangelog(''), [])
  assert.deepEqual(readChangelog('/nonexistent/CHANGELOG.md'), [])
})

test('the shipped changelog parses and leads with a dated entry', () => {
  const entries = readChangelog(new URL('../CHANGELOG.md', import.meta.url).pathname)
  assert.ok(entries.length >= 6)
  assert.match(entries[0].id, /^\d{4}-\d{2}-\d{2}-[a-z0-9-]+$/)
  assert.equal(entries.some(entry => entry.major), true)
})

test('a first visit is silent and records the newest entry', () => {
  store.clear()
  assert.deepEqual(unreadEntries(list), [])
  assert.equal(seenId(), '2026-09-06-third')
  assert.equal(store.get(CHANGELOG_SEEN_KEY), '2026-09-06-third')
})

test('everything above the marker is unread, and marking clears it', () => {
  store.clear()
  store.set(CHANGELOG_SEEN_KEY, '2026-08-25-first')
  assert.deepEqual(unreadEntries(list).map(entry => entry.id), ['2026-09-06-third', '2026-08-26-second'])

  markAllSeen(list)
  assert.deepEqual(unreadEntries(list), [])
})

test('a marker for an entry that no longer exists falls back to its date', () => {
  store.clear()
  store.set(CHANGELOG_SEEN_KEY, '2026-08-26-renamed-since')
  assert.deepEqual(unreadEntries(list).map(entry => entry.id), ['2026-09-06-third'])
})

test('storage that throws leaves the reader unmarked rather than breaking', () => {
  const working = (globalThis as any).localStorage
  ;(globalThis as any).localStorage = {
    getItem() { throw new Error('private mode') },
    setItem() { throw new Error('private mode') },
  }
  try {
    assert.equal(seenId(), null)
    assert.deepEqual(unreadEntries(list), [])
    markAllSeen(list)
  } finally { (globalThis as any).localStorage = working }
})
