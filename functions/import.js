const STORED_BOARD_ID = /^[A-Za-z0-9_-]{22}$/;

function attr(value) {
  return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function replaceMeta(html, property, content) {
  const escaped = attr(content);
  const pattern = new RegExp(`(<meta\\s+(?:property|name)="${property.replace(':', '\\:')}"\\s+content=")[^"]*("\\s*\\/?>)`, 'i');
  return html.replace(pattern, `$1${escaped}$2`);
}

export async function onRequest(context) {
  const url = new URL(context.request.url);
  const id = url.searchParams.get('board');
  if (!id || !STORED_BOARD_ID.test(id) || Array.from(url.searchParams.keys()).length !== 1) {
    return context.next();
  }

  const page = await context.next();
  const contentType = page.headers.get('Content-Type') || '';
  if (!page.ok || !contentType.includes('text/html')) return page;

  const canonical = `${url.origin}/import?board=${encodeURIComponent(id)}`;
  const image = `${url.origin}/api/board/import-drafts?id=${encodeURIComponent(id)}&preview=1`;
  let html = await page.text();
  html = replaceMeta(html, 'og:url', canonical);
  html = replaceMeta(html, 'og:image', image);
  html = replaceMeta(html, 'og:image:secure_url', image);
  html = replaceMeta(html, 'og:image:type', 'image/jpeg');
  html = replaceMeta(html, 'og:image:width', '1200');
  html = replaceMeta(html, 'og:image:height', '630');
  html = replaceMeta(html, 'og:image:alt', 'Shared tactics board');
  html = replaceMeta(html, 'twitter:image', image);
  html = replaceMeta(html, 'twitter:image:alt', 'Shared tactics board');
  html = html.replace(/(<link\s+rel="canonical"\s+href=")[^"]*("\s*\/?>)/i, `$1${attr(canonical)}$2`);

  const headers = new Headers(page.headers);
  headers.delete('Content-Length');
  headers.set('Cache-Control', 'no-store');
  return new Response(html, { status: page.status, statusText: page.statusText, headers });
}
