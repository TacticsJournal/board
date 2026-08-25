import { accountOrigin, requestOrigin } from '../../lib/board-origin.js';

const MAX_BODY_BYTES = 4096;
const TOKEN_PATTERN = /^[a-f0-9]{64}$/;
const SAFE_STATUS = new Set([200, 400, 401, 403, 409, 413, 415, 429, 500, 502, 503]);
const CLEAR_SESSION_COOKIE = 'tj_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0';
const COOKIE_VALUE_PATTERN = /^[!#$%&'()*+\-./0-9:<=>?@A-Z[\\\]^_`a-z{|}~]{1,4096}$/;

function statusOf(response) {
  return SAFE_STATUS.has(response.status) ? response.status : 502;
}

function sameOrigin(request, allowMissing = false) {
  const origin = request.headers.get('Origin');
  return origin === requestOrigin(request) || (allowMissing && !origin);
}

function headersFor(request, extra = {}) {
  const headers = new Headers(extra);
  const cookie = request.headers.get('Cookie');
  if (cookie) headers.set('Cookie', cookie);
  headers.set('Origin', requestOrigin(request));
  return headers;
}

function upstreamSessionToken(response) {
  const values = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : [response.headers.get('Set-Cookie')].filter(Boolean);
  for (const value of values) {
    const match = /(?:^|,\s*)tj_session=([^;,\s]+)/.exec(value);
    if (match && COOKIE_VALUE_PATTERN.test(match[1])) return match[1];
  }
  return null;
}

function statusResponse(response, authenticated = response.ok, includeCookie = false, clearCookie = false, accountBinding = null) {
  const headers = new Headers({
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
  });
  // Signout always wins. Otherwise, copy only the token into a new host-only
  // cookie. No upstream attribute is allowed to reach the Board host.
  if (clearCookie) headers.set('Set-Cookie', CLEAR_SESSION_COOKIE);
  else if (includeCookie) {
    const token = upstreamSessionToken(response);
    if (token) headers.set('Set-Cookie', `tj_session=${token}; Path=/; HttpOnly; Secure; SameSite=Lax`);
  }
  const body = { authenticated: authenticated === true };
  // The Board client uses this stable account id to reject a host-only cookie
  // left behind by a different apex account. Never reflect an unvalidated value.
  if (body.authenticated && typeof accountBinding === 'string' && TOKEN_PATTERN.test(accountBinding)) body.account_binding = accountBinding;
  return new Response(JSON.stringify(body), {
    status: statusOf(response), headers,
  });
}

function reject(status = 403, clearCookie = false) {
  const headers = new Headers({ 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' });
  if (clearCookie) headers.set('Set-Cookie', CLEAR_SESSION_COOKIE);
  return new Response(JSON.stringify({ authenticated: false }), { status, headers });
}

async function tokenFrom(request) {
  const contentType = (request.headers.get('Content-Type') || '').split(';', 1)[0].trim().toLowerCase();
  if (contentType !== 'application/json') return null;
  const length = Number(request.headers.get('Content-Length'));
  if (Number.isFinite(length) && length > MAX_BODY_BYTES) return null;
  let text;
  try { text = await request.text(); } catch { return null; }
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) return null;
  let value;
  try { value = JSON.parse(text); } catch { return null; }
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 1 || typeof value.token !== 'string') return null;
  return TOKEN_PATTERN.test(value.token) ? value.token : null;
}

export async function onRequestGet({ request }) {
  // Browsers may omit Origin on a same-origin GET; this endpoint never emits
  // CORS headers, so an off-origin page still cannot read the response.
  if (!sameOrigin(request, true)) return reject();
  let response;
  try {
    response = await fetch(`${accountOrigin(request)}/api/account/session`, { headers: headersFor(request) });
  } catch { return reject(502); }
  let body = null;
  try { body = await response.json(); } catch { /* a status is enough */ }
  return statusResponse(response, response.ok && body?.authenticated === true, false, false, body?.account_binding);
}

export async function onRequestPost({ request }) {
  if (!sameOrigin(request)) return reject();
  const token = await tokenFrom(request);
  if (!token) return reject(400);
  let response;
  try {
    response = await fetch(`${accountOrigin(request)}/api/account/board-session`, {
      method: 'POST',
      headers: headersFor(request, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ action: 'consume', token, audience: requestOrigin(request) }),
    });
  } catch { return reject(502); }
  return statusResponse(response, response.ok, true);
}

export async function onRequestDelete({ request }) {
  if (!sameOrigin(request)) return reject();
  let response;
  try {
    response = await fetch(`${accountOrigin(request)}/api/account/signout`, {
      method: 'POST', headers: headersFor(request),
    });
  } catch { return reject(502, true); }
  return statusResponse(response, false, true, true);
}

export async function onRequest({ request }) {
  return reject(request.method === 'OPTIONS' ? 405 : 405);
}
