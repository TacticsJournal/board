import { boardOrigin, upstreamOrigin } from '../../lib/board-origin.js';

/**
 * The fixed Board proxy to tacticsjournal.com. Board has no accounts, so only
 * two paths remain:
 *
 * - `import-drafts`: the anonymous Copy link. A browser stores one board (with
 *   a JPEG preview) or one project, and anyone with the link reads it back.
 *   tacticsjournal.com keeps each draft for 24 hours.
 * - `events`: aggregate product counters.
 *
 * Upstream headers are built from an allowlist. Cookies and Authorization are
 * never forwarded. Import drafts forward the client IP so tacticsjournal.com
 * can rate-limit link creation; events carry no IP and a fixed User-Agent.
 */
const ALLOWED = new Set(['import-drafts', 'events']);
const IMPORT_PAYLOAD = /^[A-Za-z0-9_-]+$/;
const IMPORT_PREVIEW = /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/;
const MAX_IMPORT_BODY_BYTES = 512 * 1024;
const MAX_BOARD_PAYLOAD_CHARS = 4000;
const MAX_PROJECT_PAYLOAD_CHARS = 350_000;
const MAX_IMPORT_PREVIEW_CHARS = 500_000;
const MAX_EVENT_BODY_BYTES = 2048;
const DRAFT_USER_AGENT = 'TacticsBoardAgent/1.0';
const EVENTS_USER_AGENT = 'TacticsBoard/1.0';

function boardPath(params) {
  const value = params?.path;
  const path = Array.isArray(value) ? value.join('/') : String(value || '');
  return path.replace(/^\/+|\/+$/g, '');
}

function isRead(request) {
  const method = request.method.toUpperCase();
  return method === 'GET' || method === 'HEAD';
}

function hasAllowedWriteOrigin(request) {
  return isRead(request) || request.headers.get('Origin') === boardOrigin(request);
}

/** Only these request headers ever reach tacticsjournal.com. */
function upstreamHeaders(request, path) {
  const headers = new Headers();
  for (const name of ['Accept', 'Content-Type']) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  headers.set('Origin', boardOrigin(request));
  if (path === 'import-drafts') {
    // tacticsjournal.com rate-limits link creation and reads by client IP.
    const ip = request.headers.get('CF-Connecting-IP');
    if (ip) headers.set('CF-Connecting-IP', ip);
    headers.set('User-Agent', DRAFT_USER_AGENT);
  } else {
    headers.set('User-Agent', EVENTS_USER_AGENT);
  }
  return headers;
}

/**
 * Build the fixed upstream request without ever accepting a target from input.
 * `body` replaces the incoming body when the proxy has already read and
 * validated it.
 */
export function upstreamRequest(request, params = {}, body = undefined) {
  const path = boardPath(params);
  if (!ALLOWED.has(path) || !hasAllowedWriteOrigin(request)) return null;
  if (path === 'events' && request.method.toUpperCase() !== 'POST') return null;

  const incoming = new URL(request.url);
  const target = new URL(`/api/board/${path}`, upstreamOrigin());
  target.search = incoming.search;
  const read = isRead(request);
  return new Request(target, {
    method: request.method,
    headers: upstreamHeaders(request, path),
    body: read ? undefined : body !== undefined ? body : request.body,
    // Required by Node's Request implementation; ignored by the Workers runtime.
    duplex: 'half',
    redirect: 'manual',
  });
}

function unavailable() {
  return new Response('Upstream unavailable.', {
    status: 502,
    headers: { 'Cache-Control': 'no-store' },
  });
}

function jsonError(message, status) {
  return Response.json({ error: message }, {
    status,
    headers: { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function isJson(request) {
  return (request.headers.get('Content-Type') || '').split(';', 1)[0].trim().toLowerCase() === 'application/json';
}

async function boundedText(request, limit) {
  const length = Number(request.headers.get('Content-Length'));
  if (Number.isFinite(length) && length > limit) return null;
  const stream = request.body;
  if (!stream) return '';
  const reader = stream.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } catch { return null; }
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.byteLength; }
  try { return new TextDecoder('utf-8', { fatal: true }).decode(joined); }
  catch { return null; }
}

/**
 * Two exact shapes: one board with its preview, or one project without one.
 * Returns the body to forward, or null.
 */
async function importDraftBody(request) {
  if (!isJson(request)) return null;
  const text = await boundedText(request, MAX_IMPORT_BODY_BYTES);
  if (text === null) return null;
  let body;
  try { body = JSON.parse(text); } catch { return null; }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const keys = Object.keys(body).sort().join(',');
  if (typeof body.payload !== 'string' || !IMPORT_PAYLOAD.test(body.payload)) return null;
  if (keys === 'payload') {
    if (body.payload.length > MAX_PROJECT_PAYLOAD_CHARS) return null;
    return JSON.stringify({ payload: body.payload });
  }
  if (keys !== 'payload,preview') return null;
  if (body.payload.length > MAX_BOARD_PAYLOAD_CHARS) return null;
  if (typeof body.preview !== 'string' || body.preview.length > MAX_IMPORT_PREVIEW_CHARS || !IMPORT_PREVIEW.test(body.preview)) return null;
  return JSON.stringify({ payload: body.payload, preview: body.preview });
}

async function eventBody(request) {
  if (!isJson(request)) return null;
  const text = await boundedText(request, MAX_EVENT_BODY_BYTES);
  if (text === null) return null;
  try {
    const body = JSON.parse(text);
    return body && typeof body === 'object' && !Array.isArray(body) ? JSON.stringify(body) : null;
  } catch { return null; }
}

export async function onRequest(context) {
  const request = context.request;
  const path = boardPath(context.params);
  if (!ALLOWED.has(path)) return new Response('Not found.', { status: 404, headers: { 'Cache-Control': 'no-store' } });
  if (!hasAllowedWriteOrigin(request)) {
    return new Response('Request not allowed.', { status: 403, headers: { 'Cache-Control': 'no-store' } });
  }
  const method = request.method.toUpperCase();
  let body;
  if (path === 'import-drafts' && method === 'POST') {
    body = await importDraftBody(request);
    if (body === null) return jsonError('Send one bounded board or project payload.', 400);
  } else if (path === 'events') {
    if (method !== 'POST') return new Response('Method not allowed.', { status: 405, headers: { 'Cache-Control': 'no-store', Allow: 'POST' } });
    body = await eventBody(request);
    if (body === null) return jsonError('Send one event.', 400);
  } else if (!isRead(request)) {
    return new Response('Method not allowed.', { status: 405, headers: { 'Cache-Control': 'no-store', Allow: 'GET, HEAD, POST' } });
  }
  const upstream = upstreamRequest(request, context.params, body);
  if (!upstream) return new Response('Not found.', { status: 404, headers: { 'Cache-Control': 'no-store' } });
  let response;
  try {
    response = await fetch(upstream);
  } catch {
    return unavailable();
  }
  // An upstream Location would turn this fixed proxy into a redirect to TJ.
  // Nothing here upgrades to a WebSocket, so a 1xx answer is never valid.
  if (response.status < 200 || (response.status >= 300 && response.status < 400)) return unavailable();
  // Board never sets a cookie, whatever the upstream sends.
  const headers = new Headers(response.headers);
  headers.delete('Set-Cookie');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
