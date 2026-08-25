export function googleSignInUrl(accountOrigin: string, next: string): string {
  return accountOrigin + '/api/account/google/start?next=' + encodeURIComponent(next)
}
