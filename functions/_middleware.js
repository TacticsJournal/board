/**
 * Board is offline on its production hosts while Pro and accounts are fixed.
 * Every request there, including the API and MCP endpoints, gets a 503
 * maintenance page. Preview deployments stay up so fixes can be tested.
 * Delete this file to bring Board back.
 */
const OFFLINE_HOSTS = new Set(['board.tacticsjournal.com', 'tactics-board-mapper.pages.dev']);

const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Board is offline</title>
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; font: 16px/1.5 system-ui, -apple-system, sans-serif; background: #f5f5f4; color: #1c1917; }
  @media (prefers-color-scheme: dark) { body { background: #1c1917; color: #f5f5f4; } }
  main { max-width: 32rem; padding: 2rem; text-align: center; }
  h1 { font-size: 1.5rem; margin: 0 0 .5rem; }
  p { margin: 0 0 1rem; opacity: .8; }
  a { color: inherit; }
</style>
</head>
<body>
<main>
  <h1>Board is offline for now</h1>
  <p>We're working on Board and will have it back soon. Projects saved in this browser stay on your device and will be here when Board returns.</p>
  <p>Board is open source. The code is on <a href="https://github.com/TacticsJournal/board">GitHub</a>, where you can also run it yourself.</p>
  <p><a href="https://tacticsjournal.com/">Go to Tactics Journal</a></p>
</main>
</body>
</html>`;

export async function onRequest(context) {
  const host = new URL(context.request.url).hostname;
  if (!OFFLINE_HOSTS.has(host)) return context.next();
  const isPage = (context.request.headers.get('Accept') || '').includes('text/html');
  return new Response(isPage ? PAGE : 'Board is offline for now.', {
    status: 503,
    headers: {
      'Content-Type': isPage ? 'text/html; charset=utf-8' : 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
      'Retry-After': '86400',
      'X-Robots-Tag': 'noindex',
    },
  });
}
