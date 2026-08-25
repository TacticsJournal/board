export function formatElapsedSince(savedAt: string | number, now = Date.now(), compact = false): string | null {
  const savedTime = typeof savedAt === 'number' ? savedAt : Date.parse(savedAt)
  if (!Number.isFinite(savedTime) || !Number.isFinite(now)) return null

  const seconds = Math.max(0, Math.floor((now - savedTime) / 1000))
  if (seconds < 60) {
    if (compact) return `${seconds}s`
    return `${seconds} ${seconds === 1 ? 'second' : 'seconds'}`
  }
  if (seconds < 60 * 60) return `${Math.floor(seconds / 60)}m`
  if (seconds < 24 * 60 * 60) return `${Math.floor(seconds / (60 * 60))}h`
  return `${Math.floor(seconds / (24 * 60 * 60))}d`
}
