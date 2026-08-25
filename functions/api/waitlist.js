const UPSTREAM = 'https://tacticsjournal.com/api/subscribe';
const BOARD_ORIGIN = 'https://board.tacticsjournal.com';
const TJ_ORIGIN = 'https://tacticsjournal.com';

function corsHeaders(request) {
  const origin = request.headers.get('Origin') || BOARD_ORIGIN;
  const allowed = origin === BOARD_ORIGIN || origin === 'https://tactics-board-mapper.pages.dev' || origin.endsWith('.tactics-board-mapper.pages.dev');
  return {
    'Access-Control-Allow-Origin': allowed ? origin : BOARD_ORIGIN,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'no-store',
    Vary: 'Origin',
  };
}

function json(request, data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders(request),
      'Content-Type': 'application/json; charset=utf-8',
    },
  });
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

async function readPayload(request) {
  const contentType = request.headers.get('Content-Type') || '';
  if (contentType.includes('application/json')) return request.json();
  const form = await request.formData();
  const payload = {};
  for (const [key, value] of form.entries()) payload[key] = value;
  return payload;
}

export async function onRequestOptions({ request }) {
  return new Response(null, { status: 204, headers: corsHeaders(request) });
}

export async function onRequestPost({ request }) {
  let payload;
  try {
    payload = await readPayload(request);
  } catch {
    return json(request, { error: 'Invalid submission' }, 400);
  }

  if (String(payload.website || payload.url || payload.company || '').trim()) {
    return json(request, { status: 'ok' });
  }

  const email = String(payload.email || '').trim().toLowerCase();
  if (!email || !isValidEmail(email)) {
    return json(request, { error: 'Invalid email' }, 400);
  }

  const tags = new Set(['board-waitlist']);
  const rawTags = Array.isArray(payload.tags) ? payload.tags : [payload.tags, payload.tag];
  for (const tag of rawTags.flat()) {
    const value = String(tag || '').trim();
    if (value) tags.add(value);
  }

  const upstream = await fetch(UPSTREAM, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // tacticsjournal.com/api/subscribe only accepts same-site requests.
      // This same-owner board endpoint is the bridge for board.tacticsjournal.com.
      Origin: TJ_ORIGIN,
      Referer: `${TJ_ORIGIN}/`,
    },
    body: JSON.stringify({ email, tags: [...tags] }),
  });

  const text = await upstream.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = {}; }

  if (!upstream.ok) {
    return json(request, { error: data.error || 'Could not join right now.' }, upstream.status);
  }

  return json(request, {
    status: 'ok',
    message: data.message || 'Check your email to confirm your spot on the list.',
  });
}

export async function onRequest({ request }) {
  return json(request, { error: 'Method not allowed' }, 405);
}
