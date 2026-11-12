/**
 * The Board's public web address.
 *
 * In a browser that is simply where the page is. The iOS app's page lives at
 * `capacitor://localhost`, which is no use in a link someone else opens or as
 * a server to call, so in the app every link and every API call names the
 * Board host instead. Capacitor sets `window.Capacitor` before the bundle runs,
 * so this needs no import and stays safe to load in tests.
 */

export const BOARD_HOST = 'https://board.tacticsjournal.com'

export function inNativeApp(): boolean {
  try {
    const cap = (globalThis as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor
    return cap?.isNativePlatform?.() === true
  } catch { return false }
}

/** Where links point and Board APIs live: the page's own origin, or the Board host in the app. */
export function webOrigin(): string {
  if (inNativeApp()) return BOARD_HOST
  try { return location.origin } catch { return BOARD_HOST }
}
