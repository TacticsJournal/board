const PRODUCTION = 'https://tacticsjournal.com';
const STABLE_PAGES_HOST = 'tactics-board-mapper.pages.dev';
const BRANCH_PREVIEW_HOST = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.tactics-board-mapper\.pages\.dev$/;

/**
 * The one Tactics Journal origin the Board proxy talks to. It is fixed by this
 * deployment, never chosen by a caller. Board has no accounts, so preview
 * builds no longer point at a separate billing sandbox.
 */
export function upstreamOrigin() {
  return PRODUCTION;
}

/** The only Board origins a browser write may come from. */
export function boardOrigin(request) {
  try {
    const url = new URL(request.url);
    if (url.hostname === 'board.tacticsjournal.com') return 'https://board.tacticsjournal.com';
    if (url.hostname === STABLE_PAGES_HOST || BRANCH_PREVIEW_HOST.test(url.hostname)) return url.origin;
  } catch { /* use production below */ }
  return 'https://board.tacticsjournal.com';
}
