/**
 * Buying on the board.
 *
 * The board cannot take money itself — it is a static app with no server — but
 * it is where someone actually wants Pro, so the purchase happens here rather
 * than by sending them to the site and hoping they come back. Tactics
 * Journal creates the checkout against the signed-in account and Polar's
 * overlay opens over the board. Nothing about the price, the product or the
 * buyer is decided in this file; all three come back from the server.
 */

import { PolarEmbedCheckout } from '@polar-sh/checkout/embed'
import { TJ_ORIGIN } from './origin'

export type CheckoutProduct = 'pro_monthly' | 'pro_yearly'

/** What the button should say it is doing, as the purchase moves through. */
export type CheckoutStage = 'opening' | 'confirming'

export type CheckoutOutcome =
  | { ok: true; upgraded: boolean; checkEmail?: boolean }
  | { ok: false; reason: 'unavailable' | 'failed' | 'abandoned' | 'unconfirmed' }

const ENDPOINT: Record<CheckoutProduct, string> = {
  pro_monthly: '/api/billing/pro-checkout',
  pro_yearly: '/api/billing/pro-yearly-checkout',
}

const CLAIM_ENDPOINT = '/api/billing/claim'

/** How long to wait for the purchase to reach the account after Polar says it succeeded. */
const CONFIRM_ATTEMPTS = 10
const CONFIRM_INTERVAL_MS = 1500

type SessionData = { authenticated?: boolean; site_access?: string; board_license?: boolean }

async function readSession(): Promise<SessionData | null> {
  try {
    const response = await fetch(`${TJ_ORIGIN}/api/account/session`, { credentials: 'include' })
    if (!response.ok) return null
    return await response.json() as SessionData
  } catch {
    return null
  }
}

function announce(session: SessionData): void {
  window.dispatchEvent(new CustomEvent('tacticsjournal:auth-changed', { detail: session }))
}

function holds(session: SessionData | null, _product: CheckoutProduct): boolean {
  return session?.site_access === 'pro'
}

/**
 * Waits for the purchase to show up on the account, then tells the rest of the
 * board about it. Polar confirms the payment to the browser before its webhook
 * has necessarily reached us, so the board asks again rather than trusting the
 * browser's word for what someone owns.
 */
async function confirmPurchase(product: CheckoutProduct): Promise<boolean> {
  for (let attempt = 0; attempt < CONFIRM_ATTEMPTS; attempt += 1) {
    const session = await readSession()
    if (session) announce(session)
    if (holds(session, product)) return true
    await new Promise((resolve) => setTimeout(resolve, CONFIRM_INTERVAL_MS))
  }
  return false
}

/**
 * Turns a purchase made without an account into one. The server reads the
 * result from Polar using this secret, so the browser is proving which checkout
 * it went through rather than asserting anything about who it is.
 *
 * A brand new email comes back signed in. An email that already has an account
 * gets a code by mail instead, because a checkout must never be a way into an
 * account that existed before it.
 */
async function claimPurchase(clientSecret: string): Promise<'signed_in' | 'code_sent' | 'failed'> {
  try {
    const response = await fetch(`${TJ_ORIGIN}${CLAIM_ENDPOINT}`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_secret: clientSecret }),
    })
    if (!response.ok) return 'failed'
    const body = await response.json() as { signed_in?: boolean }
    return body.signed_in === true ? 'signed_in' : 'code_sent'
  } catch {
    return 'failed'
  }
}

async function openOverlay(url: string, theme: 'light' | 'dark'): Promise<'success' | 'abandoned'> {
  const checkout = await PolarEmbedCheckout.create(url, { theme })
  return new Promise((resolve) => {
    let succeeded = false
    checkout.addEventListener('success', (event) => {
      succeeded = true
      // The board stays where it is: a redirect would throw away the board the
      // buyer has open, which is the thing they just paid to keep using.
      event.preventDefault()
      checkout.close()
      resolve('success')
    })
    checkout.addEventListener('close', () => {
      if (!succeeded) resolve('abandoned')
    })
  })
}

export async function startCheckout(
  product: CheckoutProduct,
  theme: 'light' | 'dark' = 'light',
  onStage: (stage: CheckoutStage) => void = () => {},
): Promise<CheckoutOutcome> {
  // Whether there is an account decides what happens after the payment, not
  // whether the payment may happen at all.
  const signedIn = (await readSession())?.authenticated === true
  let response: Response
  try {
    response = await fetch(`${TJ_ORIGIN}${ENDPOINT[product]}`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    })
  } catch {
    return { ok: false, reason: 'failed' }
  }

  if (response.status === 503) return { ok: false, reason: 'unavailable' }
  if (!response.ok) return { ok: false, reason: 'failed' }

  const body = await response.json().catch(() => null) as { url?: string; upgraded?: boolean; client_secret?: string } | null

  // Pro on top of a licence is a swap, not a second purchase: it is already
  // paid for by the time the answer comes back, so there is nothing to open.
  if (body?.upgraded === true) {
    onStage('confirming')
    if (!await confirmPurchase(product)) return { ok: false, reason: 'unconfirmed' }
    return { ok: true, upgraded: true }
  }
  if (!body?.url) return { ok: false, reason: 'failed' }

  const outcome = await openOverlay(body.url, theme)
  if (outcome === 'abandoned') return { ok: false, reason: 'abandoned' }
  // Paid, but not ours until the account says so, and that wait is visible:
  // "opening checkout" would be a lie for the several seconds it can take.
  onStage('confirming')

  // Someone who bought without signing in has no session for the poll to read,
  // so the purchase is claimed first and the session comes back with it.
  let claimed: 'signed_in' | 'code_sent' | 'failed' = 'signed_in'
  if (!signedIn) {
    if (!body.client_secret) return { ok: false, reason: 'unconfirmed' }
    claimed = await claimPurchase(body.client_secret)
  }
  if (claimed === 'code_sent') return { ok: true, upgraded: false, checkEmail: true }
  if (claimed === 'failed') return { ok: false, reason: 'unconfirmed' }

  if (!await confirmPurchase(product)) return { ok: false, reason: 'unconfirmed' }
  return { ok: true, upgraded: false }
}
