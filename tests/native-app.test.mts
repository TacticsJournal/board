import assert from 'node:assert/strict'
import test from 'node:test'
import { nativeTarget } from '../src/app-net.ts'
import { googleReturn, pkcePair, isCancel } from '../src/native-account.ts'

test('Board and Tactics Journal calls go native, everything else stays in the web view', () => {
  assert.equal(nativeTarget('/api/board/session'), 'https://board.tacticsjournal.com/api/board/session')
  assert.equal(nativeTarget('https://tacticsjournal.com/api/account/session'), 'https://tacticsjournal.com/api/account/session')
  assert.equal(nativeTarget('capacitor://localhost/api/boards?x=1'), 'https://board.tacticsjournal.com/api/boards?x=1')
  assert.equal(nativeTarget('capacitor://localhost/assets/app.js'), null)
  assert.equal(nativeTarget('http://tacticsjournal.com/api/x'), null)
  assert.equal(nativeTarget('https://evil.example/api/x'), null)
  assert.equal(nativeTarget('blob:capacitor://localhost/1'), null)
})

test('the Google return reads its state and error', () => {
  assert.deepEqual(googleReturn('com.tacticsjournal.board://auth/google?state=nab_1'), { state: 'nab_1', error: null })
  assert.deepEqual(googleReturn('com.tacticsjournal.board://auth/google?error=cancelled'), { state: null, error: 'cancelled' })
  assert.deepEqual(googleReturn('not a url'), { state: null, error: 'failed' })
})

test('PKCE challenge is the S256 of the verifier', async () => {
  const { verifier, challenge } = await pkcePair()
  assert.match(verifier, /^[A-Za-z0-9_-]{64}$/)
  const digest = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))).toString('base64url')
  assert.equal(challenge, digest)
})

test('closing a sheet is a cancel, not an error', () => {
  assert.equal(isCancel(new Error('cancelled')), true)
  assert.equal(isCancel(Object.assign(new Error('The operation couldn’t be completed.'), { code: 'cancelled' })), true)
  assert.equal(isCancel(new Error('The operation couldn’t be completed. (com.apple.AuthenticationServices.AuthorizationError error 1001.)')), false)
})
