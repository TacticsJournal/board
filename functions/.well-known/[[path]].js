const headers = {
  'Cache-Control': 'no-store',
  'Content-Type': 'application/json; charset=utf-8',
}

/**
 * The Board MCP is intentionally unauthenticated. Board access comes from the
 * per-board capability supplied to a tool, not from transport OAuth.
 *
 * Pages would otherwise serve index.html for unknown discovery paths. MCP
 * clients read that 200 HTML response as broken OAuth metadata and try to
 * register with a sign-in service that does not exist.
 */
export function onRequest() {
  return new Response(JSON.stringify({ error: 'OAuth is not configured for this MCP server.' }), {
    status: 404,
    headers,
  })
}
