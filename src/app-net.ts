/**
 * Network calls from the iOS app.
 *
 * The app's page is `capacitor://localhost`. A browser request from there to
 * the Board or Tactics Journal would be cross-site: no cookies, and the
 * servers' write guards refuse its Origin. So in the app, calls to those hosts
 * leave through the native HTTP stack instead. It keeps one cookie jar for both
 * hosts, as a browser does for a first-party page, and sends the Board's own
 * Origin, which is the truth about what is calling.
 *
 * Relative `/api/` paths are Board APIs and resolve against the Board host.
 * Everything else, the bundle's own files, `blob:` and `data:` URLs, goes to
 * the web view's fetch untouched.
 */

import { CapacitorHttp } from '@capacitor/core'
import { BOARD_HOST, inNativeApp } from './app-origin.ts'

const API_HOSTS = new Set([
  'board.tacticsjournal.com',
  'tacticsjournal.com',
  'www.tacticsjournal.com',
])

/** The absolute URL a request should go to natively, or null to leave it to the web view. */
export function nativeTarget(url: string): string | null {
  if (url.startsWith('/api/')) return BOARD_HOST + url
  try {
    const parsed = new URL(url)
    if (parsed.protocol === 'https:' && API_HOSTS.has(parsed.hostname)) return parsed.href
    // The bundle's own origin: a relative `/api/` path resolved against it.
    if (parsed.protocol === 'capacitor:' && parsed.pathname.startsWith('/api/')) return BOARD_HOST + parsed.pathname + parsed.search
  } catch { /* not a URL we route */ }
  return null
}

function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64)
  const bytes = new Uint8Array(new ArrayBuffer(binary.length))
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

async function bodyText(body: BodyInit | null | undefined): Promise<string | undefined> {
  if (body == null) return undefined
  if (typeof body === 'string') return body
  if (body instanceof URLSearchParams) return body.toString()
  if (body instanceof Blob) return await body.text()
  // Board only sends JSON and text. Anything else is a mistake to surface,
  // not something to send mangled.
  throw new TypeError('This request body cannot be sent from the app.')
}

/** Sends one request natively and gives it back as a web `Response`. */
export async function nativeFetch(url: string, init: RequestInit = {}, request?: Request): Promise<Response> {
  const headers: Record<string, string> = {}
  new Headers(request?.headers).forEach((value, key) => { headers[key] = value })
  new Headers(init.headers).forEach((value, key) => { headers[key] = value })
  headers.origin = BOARD_HOST
  const method = (init.method || request?.method || 'GET').toUpperCase()
  const data = init.body !== undefined ? await bodyText(init.body) : request && method !== 'GET' && method !== 'HEAD' ? await request.text() : undefined
  if (data !== undefined && !headers['content-type']) headers['content-type'] = 'text/plain;charset=UTF-8'
  const reply = await CapacitorHttp.request({
    url, method, headers, data, responseType: 'arraybuffer',
  })
  const type = String(reply.headers?.['content-type'] || reply.headers?.['Content-Type'] || '')
  let body: BodyInit | null = null
  if (reply.status !== 204 && reply.status !== 304 && method !== 'HEAD') {
    if (/application\/json/i.test(type)) body = typeof reply.data === 'string' ? reply.data : JSON.stringify(reply.data)
    else if (typeof reply.data === 'string') body = new Blob([base64ToBytes(reply.data) as Uint8Array<ArrayBuffer>])
  }
  const response = new Response(body, { status: reply.status, headers: reply.headers })
  Object.defineProperty(response, 'url', { value: reply.url || url })
  return response
}

let installed = false

/** In the app, sends Board and account calls natively. Does nothing in a browser. */
export function installAppFetch(): void {
  if (installed || !inNativeApp() || typeof window === 'undefined') return
  installed = true
  const webFetch = window.fetch.bind(window)
  window.fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = input instanceof Request ? input : undefined
    const href = request ? request.url : String(input)
    const target = nativeTarget(href)
    if (!target) return webFetch(input, init)
    return nativeFetch(target, init, request)
  }
  // `sendBeacon` would leave from the web view's origin; send it natively too.
  if (navigator.sendBeacon) {
    const webBeacon = navigator.sendBeacon.bind(navigator)
    navigator.sendBeacon = (url: string | URL, data?: BodyInit | null) => {
      const target = nativeTarget(String(url))
      if (!target) return webBeacon(url, data)
      const type = data instanceof Blob ? data.type : 'text/plain;charset=UTF-8'
      void nativeFetch(target, { method: 'POST', body: data ?? undefined, headers: { 'Content-Type': type } }).catch(() => {})
      return true
    }
  }
}
