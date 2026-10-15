/**
 * The bundled families and the URLs a family's files live at.
 *
 * Plain JavaScript rather than TypeScript because the download script runs it
 * in node and the app imports it through vite: one list, so a font can never
 * be offered by the picker and missing from `public/fonts/`.
 */

/**
 * The sixteen families the board ships with. They lean condensed on purpose —
 * the job most type on a board has is fitting a surname under a token at
 * twenty pixels, which is a job wide faces are bad at. The rest of Google's
 * library is a search away.
 *
 * `regular` and `bold` are only given where a family has no 400 or no 700.
 */
export const BUNDLED_FONTS = [
  { id: 'barlow-condensed', family: 'Barlow Condensed', category: 'sans-serif' },
  { id: 'roboto-condensed', family: 'Roboto Condensed', category: 'sans-serif' },
  { id: 'fira-sans-condensed', family: 'Fira Sans Condensed', category: 'sans-serif' },
  { id: 'oswald', family: 'Oswald', category: 'sans-serif' },
  { id: 'teko', family: 'Teko', category: 'sans-serif' },
  { id: 'anton', family: 'Anton', category: 'sans-serif', bold: 400 },
  { id: 'bebas-neue', family: 'Bebas Neue', category: 'sans-serif', bold: 400 },
  { id: 'archivo', family: 'Archivo', category: 'sans-serif' },
  { id: 'inter-tight', family: 'Inter Tight', category: 'sans-serif' },
  { id: 'work-sans', family: 'Work Sans', category: 'sans-serif' },
  { id: 'ibm-plex-sans', family: 'IBM Plex Sans', category: 'sans-serif' },
  { id: 'space-grotesk', family: 'Space Grotesk', category: 'sans-serif' },
  { id: 'rubik', family: 'Rubik', category: 'sans-serif' },
  { id: 'source-serif-4', family: 'Source Serif 4', category: 'serif' },
  { id: 'playfair-display', family: 'Playfair Display', category: 'serif' },
  { id: 'jetbrains-mono', family: 'JetBrains Mono', category: 'monospace' },
]

/** The file the board asks for: one subset, one weight, one style. */
export function fontFileName(id, weight) {
  return `${id}-${weight}.woff2`
}

/** Same file at Fontsource, which is where anything not bundled comes from. */
export function fontCdnUrl(id, weight) {
  return `https://cdn.jsdelivr.net/npm/@fontsource/${id}/files/${id}-latin-${weight}-normal.woff2`
}

/** Same file on our own origin, which is where a bundled family comes from. */
export function fontLocalUrl(id, weight) {
  return `/fonts/${fontFileName(id, weight)}`
}

/** A family id is a Fontsource package name and nothing else may reach a URL. */
export function isFontId(value) {
  return typeof value === 'string' && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(value) && value.length <= 64
}
