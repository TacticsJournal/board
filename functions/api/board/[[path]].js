import { accountOrigin, boardDraftOrigin, boardOrigin } from '../../lib/board-origin.js';

const ALLOWED = new Set(['sync', 'skills', 'assets', 'libraries', 'shares', 'user-search', 'invitations', 'invitation', 'presence', 'transfer', 'agent-links', 'agent', 'live', 'collaboration', 'history', 'import-drafts', 'events']);
const IMPORT_PAYLOAD = /^[A-Za-z0-9_-]+$/;
const IMPORT_PREVIEW = /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/;
const MAX_IMPORT_BODY_BYTES = 512 * 1024;
const MAX_IMPORT_PAYLOAD_CHARS = 4000;
const MAX_STORED_IMPORT_PAYLOAD_CHARS = 350_000;
const MAX_IMPORT_PREVIEW_CHARS = 500_000;
const PROJECT_COPY_SCOPE_HEADER = 'X-Tactics-Board-Link-Scope';
const CAPABILITY_PATTERN = /^[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}$/;

function boardPath(params) {
  const value = params?.path;
  const path = Array.isArray(value) ? value.join('/') : String(value || '');
  return path.replace(/^\/+|\/+$/g, '');
}

/** A capability-authenticated agent request does not rely on browser cookies. */
function hasAgentCapability(request, path) {
  if (path !== 'agent') return false;
  const authorization = request.headers.get('Authorization') || '';
  return CAPABILITY_PATTERN.test(authorization.replace(/^Bearer /, ''));
}

function hasAllowedWriteOrigin(request, path) {
  const method = request.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || hasAgentCapability(request, path)) return true;
  return request.headers.get('Origin') === boardOrigin(request);
}

/** Build the fixed upstream request without ever accepting a target from input. */
export function upstreamRequest(request, params = {}) {
  const path = boardPath(params);
  if (!ALLOWED.has(path) || !hasAllowedWriteOrigin(request, path)) return null;

  const incoming = new URL(request.url);
  // User discovery already has one privacy boundary on the account site: its
  // public Community search. Keep Board on that endpoint rather than adding a
  // second query with subtly different visibility rules.
  const upstreamPath = path === 'user-search' ? '/api/community/user-search' : `/api/board/${path}`;
  // The billing sandbox does not own shared-link storage. Preview builds use
  // the production draft store, whose entries are bounded and expire in 24 hours.
  const upstreamOrigin = path === 'import-drafts' ? boardDraftOrigin() : accountOrigin(request);
  const target = new URL(upstreamPath, upstreamOrigin);
  target.search = incoming.search;
  const headers = new Headers(request.headers);
  headers.delete('Host');
  // Same-origin GETs often omit Origin, but the legacy compatibility handlers
  // still use it to identify the Board product. Never invent an Origin for a
  // write. Agent writes authenticate with their capability instead.
  if (!headers.has('Origin') && (request.method === 'GET' || request.method === 'HEAD')) {
    headers.set('Origin', boardOrigin(request));
  }
  if (path === 'agent') headers.set('User-Agent', 'TacticsBoardAgent/1.0');

  return new Request(target, {
    method: request.method,
    headers,
    body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
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

function importError(message, status) {
  return Response.json({ error: message }, {
    status,
    headers: { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' },
  });
}

async function boundedText(request, limit) {
  const stream = request.clone().body;
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

async function browserImportPayload(request) {
  if ((request.headers.get('Content-Type') || '').split(';', 1)[0].trim().toLowerCase() !== 'application/json') return null;
  const length = Number(request.headers.get('Content-Length'));
  if (Number.isFinite(length) && length > MAX_IMPORT_BODY_BYTES) return null;
  const text = await boundedText(request, MAX_IMPORT_BODY_BYTES);
  if (text === null) return null;
  let body;
  try { body = JSON.parse(text); } catch { return null; }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const keys = Object.keys(body).sort().join(',');
  if (keys === 'payload') {
    const scope = request.headers.get(PROJECT_COPY_SCOPE_HEADER);
    const limit = scope === 'project-copy' ? MAX_STORED_IMPORT_PAYLOAD_CHARS : MAX_IMPORT_PAYLOAD_CHARS;
    if (typeof body.payload !== 'string' || body.payload.length > limit || !IMPORT_PAYLOAD.test(body.payload)) return null;
    return { payload: body.payload };
  }
  if (keys !== 'payload,preview') return null;
  if (typeof body.payload !== 'string' || body.payload.length > MAX_IMPORT_PAYLOAD_CHARS || !IMPORT_PAYLOAD.test(body.payload)) return null;
  if (typeof body.preview !== 'string' || body.preview.length > MAX_IMPORT_PREVIEW_CHARS || !IMPORT_PREVIEW.test(body.preview)) return null;
  return { payload: body.payload, preview: body.preview };
}

async function authorizeBrowserImport(request) {
  if (request.headers.get('Origin') !== boardOrigin(request)) {
    return importError('Request not allowed.', 403);
  }
  const scope = request.headers.get(PROJECT_COPY_SCOPE_HEADER);
  if (scope !== null && scope !== 'project-copy') return importError('Send one bounded project payload.', 400);
  const draft = await browserImportPayload(request);
  if (!draft || (scope === 'project-copy' && 'preview' in draft)) {
    return importError('Send one bounded project payload.', 400);
  }
  return true;
}

export async function onRequest(context) {
  const path = boardPath(context.params);
  if (!ALLOWED.has(path)) return new Response('Not found.', { status: 404, headers: { 'Cache-Control': 'no-store' } });
  if (!hasAllowedWriteOrigin(context.request, path)) {
    return new Response('Request not allowed.', { status: 403, headers: { 'Cache-Control': 'no-store' } });
  }
  const authorization = path === 'import-drafts' && context.request.method === 'POST'
    ? await authorizeBrowserImport(context.request)
    : null;
  if (authorization instanceof Response) return authorization;
  const upstream = upstreamRequest(context.request, context.params);
  if (!upstream) return new Response('Not found.', { status: 404, headers: { 'Cache-Control': 'no-store' } });
  if (authorization) upstream.headers.set('User-Agent', 'TacticsBoardAgent/1.0');
  let response;
  try {
    // Fetch preserves Upgrade and a 101 WebSocket response in the Pages runtime.
    response = await fetch(upstream);
  } catch {
    return unavailable();
  }
  // An upstream Location would turn this fixed proxy into a redirect to TJ.
  if (response.status >= 300 && response.status < 400) return unavailable();
  // A WebSocket handshake cannot be rebuilt without losing its socket. Reject
  // an upstream that tries to attach a cookie instead of forwarding it.
  if (response.status === 101) return response.headers.has('Set-Cookie') ? unavailable() : response;
  // Only the dedicated session handoff may place a cookie on the Board host.
  const headers = new Headers(response.headers);
  headers.delete('Set-Cookie');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
