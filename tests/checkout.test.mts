// Buying on the board. The board decides nothing about the purchase: it asks
// Tactics Journal, opens what comes back, and then asks the account what the
// buyer actually holds.

import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../src/checkout.ts', import.meta.url), 'utf8')

test('the checkout is created by the server, against the signed-in account', () => {
  // Credentials, or the session never reaches the endpoint and every buyer
  // looks anonymous.
  assert.match(source, /credentials: 'include'/)
  assert.match(source, /license: '\/api\/billing\/license-checkout'/)
  assert.match(source, /pro_monthly: '\/api\/billing\/pro-checkout'/)
  assert.match(source, /pro_yearly: '\/api\/billing\/pro-yearly-checkout'/)
  assert.match(source, /body: '\{\}'/)
  // The fixed endpoint chooses the offer. No commercial term is sent.
  assert.doesNotMatch(source, /price_id|product_id|amount:|cadence:/)
})

test('every ending is answered, and only the account grants anything', () => {
  assert.match(source, /503.*unavailable/s)
  assert.match(source, /'abandoned'/)
  // The browser saying "success" is not proof of a purchase: the board asks
  // the server what this account holds before anything unlocks.
  assert.match(source, /confirmPurchase/)
  assert.match(source, /\/api\/account\/session/)
})

test('a licence holder buying either Pro offer is a swap, with no second checkout to open', () => {
  assert.match(source, /body\?\.upgraded === true/)
  const upgrade = source.match(/if \(body\?\.upgraded === true\)[\s\S]*?\n  }/)?.[0] ?? ''
  assert.doesNotMatch(upgrade, /openOverlay/)
})

test('the board keeps the board: success never navigates away', () => {
  const overlay = source.match(/async function openOverlay[\s\S]*?\n}/)?.[0] ?? ''
  assert.match(overlay, /event\.preventDefault\(\)/)
  assert.doesNotMatch(overlay, /location\.(href|assign|replace)/)
})

test('buying needs no account, and the purchase makes one', () => {
  // Deciding to pay and then being told to sign up first is where the decision
  // dies. Polar collects an email, and the claim turns it into an account.
  assert.doesNotMatch(source, /signed_out/)
  assert.match(source, /\/api\/billing\/claim/)
  assert.match(source, /claimPurchase/)
  const start = source.match(/export async function startCheckout[\s\S]*?\n}/)?.[0] ?? ''
  assert.match(start, /if \(!signedIn && body\.client_secret\) claimed = await claimPurchase/)
})

test('an email that already has an account is told to check it, not signed in', () => {
  assert.match(source, /claimed === 'code_sent'/)
  assert.match(source, /checkEmail: true/)
  const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8')
  assert.match(main, /outcome\.checkEmail/)
  assert.match(main, /check your inbox for a sign-in code/)
})

test('the page may embed Polar and pay in it, and nothing else new', () => {
  const headers = readFileSync(new URL('../public/_headers', import.meta.url), 'utf8')
  assert.match(headers, /frame-src 'self' https:\/\/polar\.sh https:\/\/sandbox\.polar\.sh https:\/\/buy\.polar\.sh/)
  assert.match(headers, /payment=\(self "https:\/\/polar\.sh"/)
  // Scripts stay first-party: the overlay is bundled, not loaded from a CDN.
  assert.match(headers, /script-src 'self';/)
  assert.doesNotMatch(headers, /unsafe-eval/)
  // Cross-origin isolation would refuse the checkout frame outright.
  assert.doesNotMatch(headers, /Cross-Origin-Embedder-Policy/)
})
