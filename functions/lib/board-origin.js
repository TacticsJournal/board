const PRODUCTION = 'https://tacticsjournal.com';
const SANDBOX = 'https://billing-sandbox.tacticsjournal.pages.dev';
const STABLE_PAGES_HOST = 'tactics-board-mapper.pages.dev';
const BRANCH_PREVIEW_HOST = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.tactics-board-mapper\.pages\.dev$/;

/** The account origin is selected by this deployment, never by a caller. */
export function accountOrigin(request) {
  try {
    return BRANCH_PREVIEW_HOST.test(new URL(request.url).hostname) ? SANDBOX : PRODUCTION;
  } catch {
    return PRODUCTION;
  }
}

/** The only board origins an MCP request may use for its same-origin API call. */
export function boardOrigin(request) {
  try {
    const url = new URL(request.url);
    if (url.hostname === 'board.tacticsjournal.com') return 'https://board.tacticsjournal.com';
    if (url.hostname === STABLE_PAGES_HOST || BRANCH_PREVIEW_HOST.test(url.hostname)) return url.origin;
  } catch { /* use production below */ }
  return 'https://board.tacticsjournal.com';
}

export function requestOrigin(request) {
  return new URL(request.url).origin;
}
