type NumberedPlayer = {
  number: string
}

/** Sort shirt numbers numerically. Players without a number stay at the end. */
export function rosterByNumber<T extends NumberedPlayer>(roster: readonly T[]): T[] {
  return [...roster].sort((a, b) => {
    const aNumber = a.number.trim() === '' ? null : Number(a.number)
    const bNumber = b.number.trim() === '' ? null : Number(b.number)
    const aHasNumber = aNumber !== null && Number.isFinite(aNumber)
    const bHasNumber = bNumber !== null && Number.isFinite(bNumber)

    if (aHasNumber && bHasNumber) return aNumber - bNumber
    if (aHasNumber) return -1
    if (bHasNumber) return 1
    return 0
  })
}
