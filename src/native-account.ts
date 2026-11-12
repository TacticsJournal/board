/**
 * Signing in and buying Pro in the iOS app.
 *
 * A browser signs in through the site's account panel and pays through Polar.
 * The app can do neither: the panel's Google button needs a browser window of
 * its own, and Apple requires digital subscriptions bought in an app to go
 * through the App Store. So the app has three sign-ins of its own:
 *
 * - Sign in with Apple, in Apple's native sheet.
 * - Google, in the system sign-in sheet, returning to the app by its URL scheme.
 * - An email code, as on the website.
 *
 * Each ends with the website's ordinary account session, so everything else
 * in Board works unchanged. Pro is an App Store subscription, and Tactics
 * Journal reads every purchase back from Apple before it grants anything.
 *
 * The native half is the `BoardNative` plugin in `ios/App/App/BoardNative.swift`.
 */

import { registerPlugin } from '@capacitor/core'
import { TJ_ORIGIN } from './origin.ts'

export type StoreProduct = {
  id: string
  displayName: string
  displayPrice: string
  /** `month` or `year`. */
  period: string
}

type PurchaseResult =
  | { status: 'purchased'; transactionId: string }
  | { status: 'cancelled' | 'pending' }

interface BoardNativePlugin {
  signInWithApple(options: { nonce: string }): Promise<{ identityToken: string }>
  webAuth(options: { url: string; callbackScheme: string }): Promise<{ url: string }>
  storeProducts(options: { productIds: string[] }): Promise<{ products: StoreProduct[] }>
  storePurchase(options: { productId: string; appAccountToken: string }): Promise<PurchaseResult>
  storeRestore(): Promise<{ transactionIds: string[] }>
  storeEntitlements(): Promise<{ transactionIds: string[] }>
  storeManage(): Promise<void>
  addListener(event: 'storeTransaction', handler: (data: { transactionId: string }) => void): Promise<{ remove: () => Promise<void> }>
}

const BoardNative = registerPlugin<BoardNativePlugin>('BoardNative')

export const PRO_PRODUCTS = {
  monthly: 'com.tacticsjournal.board.pro.monthly',
  yearly: 'com.tacticsjournal.board.pro.yearly',
} as const

/** What a person reads when something did not work. */
export class AccountError extends Error {}

/** True when the person closed a sheet, which is a choice and not an error. */
export function isCancel(error: unknown): boolean {
  // The plugin rejects a closed sheet with the code `cancelled`; Apple's own
  // message for it is localised and need not say so.
  if ((error as { code?: unknown } | null)?.code === 'cancelled') return true
  const message = error instanceof Error ? error.message : String(error)
  return /cancel/i.test(message)
}

async function postJson(path: string, body: unknown): Promise<{ ok: boolean; status: number; data: any }> {
  const response = await fetch(`${TJ_ORIGIN}${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  })
  let data: any = null
  try { data = await response.json() } catch { /* no body */ }
  return { ok: response.ok, status: response.status, data }
}

function base64Url(bytes: Uint8Array): string {
  let binary = ''
  bytes.forEach(byte => { binary += String.fromCharCode(byte) })
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

/** A PKCE verifier and its S256 challenge. */
export async function pkcePair(): Promise<{ verifier: string; challenge: string }> {
  const verifier = base64Url(crypto.getRandomValues(new Uint8Array(48)))
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)))
  return { verifier, challenge: base64Url(digest) }
}

const SIGN_IN_FAILED = 'Sign-in did not finish. Try again.'

export async function signInWithApple(): Promise<void> {
  const started = await postJson('/api/account/app/apple/challenge', {})
  if (!started.ok || typeof started.data?.nonce !== 'string') throw new AccountError(SIGN_IN_FAILED)
  const { identityToken } = await BoardNative.signInWithApple({ nonce: started.data.nonce })
  const done = await postJson('/api/account/app/apple/complete', {
    challenge_id: started.data.challenge_id, identity_token: identityToken,
  })
  if (!done.ok) throw new AccountError(SIGN_IN_FAILED)
}

/** Reads the result the website's Google callback hands back to the app. */
export function googleReturn(url: string): { state: string | null; error: string | null } {
  try {
    const parsed = new URL(url)
    return { state: parsed.searchParams.get('state'), error: parsed.searchParams.get('error') }
  } catch { return { state: null, error: 'failed' } }
}

export async function signInWithGoogle(): Promise<void> {
  const { verifier, challenge } = await pkcePair()
  const started = await postJson('/api/account/app/google/challenge', { code_challenge: challenge })
  if (!started.ok || typeof started.data?.authorization_url !== 'string') throw new AccountError(SIGN_IN_FAILED)
  const { url } = await BoardNative.webAuth({ url: started.data.authorization_url, callbackScheme: started.data.callback_scheme })
  const result = googleReturn(url)
  if (result.error === 'cancelled') throw new Error('cancelled')
  if (result.error) throw new AccountError(SIGN_IN_FAILED)
  const done = await postJson('/api/account/app/google/complete', {
    challenge_id: started.data.challenge_id, code_verifier: verifier,
  })
  if (!done.ok) throw new AccountError(SIGN_IN_FAILED)
}

/** Sends a six-digit code to the address. */
export async function sendEmailCode(email: string): Promise<void> {
  const sent = await postJson('/api/account/start', { email, next: '/' })
  if (!sent.ok) throw new AccountError(typeof sent.data?.error === 'string' ? sent.data.error : 'The code could not be sent. Try again.')
}

export async function verifyEmailCode(email: string, code: string): Promise<void> {
  const done = await postJson('/api/account/verify', { email, code, next: '/' })
  if (!done.ok) throw new AccountError(typeof done.data?.error === 'string' ? done.data.error : 'That code did not work. Try again.')
}

/* ----- App Store ----- */

/** The Pro subscriptions with their prices in the person's own App Store currency. */
export async function loadProducts(): Promise<StoreProduct[]> {
  const { products } = await BoardNative.storeProducts({ productIds: Object.values(PRO_PRODUCTS) })
  return products
}

async function accountToken(): Promise<string> {
  const response = await fetch(`${TJ_ORIGIN}/api/billing/app-store/account-token`, { credentials: 'include' })
  if (response.status === 401) throw new AccountError('Sign in first, so Pro is added to your account.')
  const data = await response.json().catch(() => null)
  if (!response.ok || typeof data?.app_account_token !== 'string') throw new AccountError('The App Store is unavailable right now. Try again.')
  return data.app_account_token
}

/** Tells Tactics Journal about a transaction, which reads it back from Apple. */
export async function reportTransaction(transactionId: string): Promise<boolean> {
  const reported = await postJson('/api/billing/app-store/transactions', { transaction_id: transactionId })
  return reported.ok
}

/** Buys Pro. Resolves true once Pro is on the account, false if the person stopped. */
export async function purchasePro(productId: string): Promise<boolean> {
  const token = await accountToken()
  const result = await BoardNative.storePurchase({ productId, appAccountToken: token })
  if (result.status === 'cancelled') return false
  if (result.status !== 'purchased') {
    throw new AccountError('The purchase is waiting for approval. Pro unlocks once it goes through.')
  }
  if (result.status !== 'purchased' || !await reportTransaction(result.transactionId)) {
    throw new AccountError('The App Store took the payment, but Pro has not reached your account yet. Tap Restore purchases in a moment.')
  }
  return true
}

/** Asks the App Store for this Apple Account's purchases and reports each. */
export async function restorePurchases(): Promise<boolean> {
  const { transactionIds } = await BoardNative.storeRestore()
  let restored = false
  for (const id of transactionIds) restored = (await reportTransaction(id)) || restored
  return restored
}

/** Reports purchases the device already holds, quietly, after sign-in or launch. */
export async function reportCurrentEntitlements(): Promise<void> {
  try {
    const { transactionIds } = await BoardNative.storeEntitlements()
    for (const id of transactionIds) await reportTransaction(id)
  } catch { /* nothing to report, or the store is unreachable */ }
}

/** Opens the App Store's own subscription settings over the app. */
export function manageSubscription(): Promise<void> {
  return BoardNative.storeManage()
}

/** Renewals and purchases finished outside the app arrive here. */
export function onStoreTransaction(handler: (transactionId: string) => void): void {
  void BoardNative.addListener('storeTransaction', ({ transactionId }) => handler(transactionId))
}
