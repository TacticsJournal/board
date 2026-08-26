/* Perspective mapping between the board's own pixels and the screen.
 *
 * In 3D mode the Konva content element is tilted with a CSS perspective
 * transform, so its four corners land on the screen as a trapezoid rather than
 * a rectangle. Konva registers pointers by dividing the element's bounding box
 * into even X and Y steps, which is only true for a rectangle: on a trapezoid
 * every tap lands somewhere other than where the finger is.
 *
 * A projective transform - a 3x3 homography - is the exact map from a
 * rectangle to a trapezoid, so it is what this module builds. The board asks
 * for the forward map (board pixels to screen) to check its own work, and for
 * the inverse (screen to board pixels) to register pointers. Nothing here
 * touches the DOM, so it can be tested on its own. */

export type Pt = { x: number; y: number }
/** A 3x3 projective matrix in row-major order. */
export type Homography = readonly [number, number, number, number, number, number, number, number, number]

/** Corner order used everywhere here: top-left, top-right, bottom-right, bottom-left. */
export type Quad = readonly [Pt, Pt, Pt, Pt]

const EPSILON = 1e-9

function isFinitePt(p: Pt | undefined): p is Pt {
  return !!p && Number.isFinite(p.x) && Number.isFinite(p.y)
}

/**
 * Solve a small dense linear system by Gaussian elimination with partial
 * pivoting. Returns null when the system is singular, which is how every
 * degenerate quad in this module fails: safely, with no answer at all.
 */
function solve(matrix: number[][], rhs: number[]): number[] | null {
  const n = rhs.length
  const a = matrix.map((row, i) => [...row, rhs[i]])
  for (let col = 0; col < n; col++) {
    let pivot = col
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row
    }
    if (Math.abs(a[pivot][col]) < EPSILON) return null
    if (pivot !== col) { const t = a[pivot]; a[pivot] = a[col]; a[col] = t }
    const p = a[col][col]
    for (let row = 0; row < n; row++) {
      if (row === col) continue
      const f = a[row][col] / p
      if (!f) continue
      for (let k = col; k <= n; k++) a[row][k] -= f * a[col][k]
    }
  }
  const out = new Array<number>(n)
  for (let i = 0; i < n; i++) {
    const v = a[i][n] / a[i][i]
    if (!Number.isFinite(v)) return null
    out[i] = v
  }
  return out
}

/**
 * The homography carrying four source points onto four destination points.
 * The bottom-right entry is fixed at 1, leaving eight unknowns and eight
 * equations - two per corner. Collinear or repeated corners make the system
 * singular and return null rather than a matrix that quietly misplaces taps.
 */
export function homographyFromCorners(src: Quad, dst: Quad): Homography | null {
  if (src.length !== 4 || dst.length !== 4) return null
  for (let i = 0; i < 4; i++) {
    if (!isFinitePt(src[i]) || !isFinitePt(dst[i])) return null
  }
  const rows: number[][] = []
  const rhs: number[] = []
  for (let i = 0; i < 4; i++) {
    const s = src[i], d = dst[i]
    rows.push([s.x, s.y, 1, 0, 0, 0, -s.x * d.x, -s.y * d.x])
    rhs.push(d.x)
    rows.push([0, 0, 0, s.x, s.y, 1, -s.x * d.y, -s.y * d.y])
    rhs.push(d.y)
  }
  const h = solve(rows, rhs)
  if (!h) return null
  const m: Homography = [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1]
  return m.every(Number.isFinite) ? m : null
}

/**
 * The homography from an untransformed w-by-h box onto the quad its corners
 * now occupy on screen. This is the forward direction: board pixel to screen.
 */
export function homographyFromBox(w: number, h: number, dst: Quad): Homography | null {
  if (!(w > EPSILON) || !(h > EPSILON)) return null
  const src: Quad = [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }]
  return homographyFromCorners(src, dst)
}

/** The matrix that undoes this one, or null when it has no inverse. */
export function invertHomography(m: Homography): Homography | null {
  const [a, b, c, d, e, f, g, h, i] = m
  const A = e * i - f * h
  const B = f * g - d * i
  const C = d * h - e * g
  const det = a * A + b * B + c * C
  if (!Number.isFinite(det) || Math.abs(det) < EPSILON) return null
  const inv: number[] = [
    A, c * h - b * i, b * f - c * e,
    B, a * i - c * g, c * d - a * f,
    C, b * g - a * h, a * e - b * d,
  ].map(v => v / det)
  // Scale so the bottom-right entry is 1 again, which keeps the numbers in the
  // same range as the forward matrix and makes comparisons in tests readable.
  const s = inv[8]
  const out = (Math.abs(s) > EPSILON ? inv.map(v => v / s) : inv) as unknown as Homography
  return out.every(Number.isFinite) ? out : null
}

/**
 * Push one point through the matrix. Returns null when the point lands on or
 * behind the horizon, where the projective divide has no finite answer - a
 * caller should ignore that pointer rather than act on a wild coordinate.
 */
export function applyHomography(m: Homography, p: Pt): Pt | null {
  if (!isFinitePt(p)) return null
  const [a, b, c, d, e, f, g, h, i] = m
  const w = g * p.x + h * p.y + i
  if (!Number.isFinite(w) || Math.abs(w) < EPSILON) return null
  const x = (a * p.x + b * p.y + c) / w
  const y = (d * p.x + e * p.y + f) / w
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null
}
