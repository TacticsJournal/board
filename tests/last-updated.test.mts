import assert from 'node:assert/strict'
import test from 'node:test'

import { formatElapsedSince } from '../src/last-updated.ts'

const savedAt = '2026-08-23T12:00:00.000Z'
const after = (seconds: number) => Date.parse(savedAt) + seconds * 1000

test('last-updated text counts seconds live and compacts larger units', () => {
  assert.equal(formatElapsedSince(savedAt, after(0)), '0 seconds')
  assert.equal(formatElapsedSince(savedAt, after(1)), '1 second')
  assert.equal(formatElapsedSince(savedAt, after(10)), '10 seconds')
  assert.equal(formatElapsedSince(Date.parse(savedAt), after(10)), '10 seconds')
  assert.equal(formatElapsedSince(savedAt, after(59)), '59 seconds')
  assert.equal(formatElapsedSince(savedAt, after(60)), '1m')
  assert.equal(formatElapsedSince(savedAt, after(3599)), '59m')
  assert.equal(formatElapsedSince(savedAt, after(3600)), '1h')
  assert.equal(formatElapsedSince(savedAt, after(86399)), '23h')
  assert.equal(formatElapsedSince(savedAt, after(86400)), '1d')
  assert.equal(formatElapsedSince(savedAt, after(2 * 86400)), '2d')
})

test('compact text uses seconds suffix and future timestamps clamp to zero', () => {
  assert.equal(formatElapsedSince(savedAt, after(10), true), '10s')
  assert.equal(formatElapsedSince(savedAt, after(60), true), '1m')
  assert.equal(formatElapsedSince(savedAt, after(-10)), '0 seconds')
})

test('invalid timestamps are omitted', () => {
  assert.equal(formatElapsedSince('not-a-date'), null)
  assert.equal(formatElapsedSince(savedAt, Number.NaN), null)
})
