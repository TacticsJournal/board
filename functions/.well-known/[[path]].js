const securityTxt = `Contact: mailto:kyle@tacticsjournal.com
Canonical: https://board.tacticsjournal.com/.well-known/security.txt
Preferred-Languages: en
Expires: 2027-08-27T23:59:59Z
`

/**
 * Serve security.txt. Every other well-known path is a plain 404 rather than
 * falling through to the Board app's index.html.
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

  return new Response('Not found.', {
    status: 404,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'text/plain; charset=utf-8',
    },
  })
}
