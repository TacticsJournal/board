const discoveryHeaders = {
  'Cache-Control': 'no-store',
  'Content-Type': 'application/json; charset=utf-8',
}

const securityTxt = `Contact: mailto:kyle@tacticsjournal.com
Canonical: https://board.tacticsjournal.com/.well-known/security.txt
Preferred-Languages: en
Expires: 2027-08-27T23:59:59Z
`

/**
 * The Board MCP is intentionally unauthenticated. Board access comes from the
 * per-board capability supplied to a tool, not from transport OAuth.
 *
 * Pages would otherwise serve index.html for unknown discovery paths. MCP
 * clients read that 200 HTML response as broken OAuth metadata and try to
 * register with a sign-in service that does not exist.
 */
export function onRequest(context = {}) {
  const pathname = context.request
    ? new URL(context.request.url).pathname
    : context.params?.path === 'security.txt' ? '/.well-known/security.txt' : ''
  if (pathname === '/.well-known/security.txt') {
    return new Response(securityTxt, {
      headers: {
        'Cache-Control': 'public, max-age=3600',
        'Content-Type': 'text/plain; charset=utf-8',
      },
    })
  }

  return new Response(JSON.stringify({ error: 'OAuth is not configured for this MCP server.' }), {
    status: 404,
    headers: discoveryHeaders,
  })
}
