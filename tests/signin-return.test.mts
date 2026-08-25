import assert from 'node:assert/strict'
import test from 'node:test'

import { googleSignInUrl } from '../src/signin-return.ts'

test('Google sign-in keeps the exact board page as its return target', () => {
  const boardPage = 'https://board.tacticsjournal.com/?project=project-1&board=board-2#selection'
  const start = new URL(googleSignInUrl('https://tacticsjournal.com', boardPage))

  assert.equal(start.origin, 'https://tacticsjournal.com')
  assert.equal(start.pathname, '/api/account/google/start')
  assert.equal(start.searchParams.get('next'), boardPage)
})
