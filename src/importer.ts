import { Store } from './store'
import { TEAM_COLORS, BOARD_W, uid, insertByTier } from './types'
const CW = 800, CH = 450

type Pt = { x: number; y: number }
type Det = { kind: 'player' | 'ball'; x: number; y: number; color?: string }
type Line = { a: number; b: number; c: number }

const hex = (r: number, g: number, b: number) => `#${[r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`

function dist2(a: number[], b: number[]) {
  return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2
}

function clusterTeamColors(items: { x: number; y: number; rgb: number[] }[]): Det[] {
  if (!items.length) return []
  if (items.length < 4) return items.map(p => ({ kind: 'player', x: p.x, y: p.y, color: hex(p.rgb[0], p.rgb[1], p.rgb[2]) }))
  let c1 = items.reduce((a, b) => b.rgb[0] + b.rgb[1] + b.rgb[2] < a.rgb[0] + a.rgb[1] + a.rgb[2] ? b : a).rgb.slice()
  let c2 = items.reduce((a, b) => b.rgb[0] + b.rgb[1] + b.rgb[2] > a.rgb[0] + a.rgb[1] + a.rgb[2] ? b : a).rgb.slice()
  let assign = new Array(items.length).fill(0)
  for (let iter = 0; iter < 8; iter++) {
    assign = items.map(p => dist2(p.rgb, c1) <= dist2(p.rgb, c2) ? 0 : 1)
    for (const k of [0, 1]) {
      const group = items.filter((_, i) => assign[i] === k)
      if (!group.length) continue
      const mean = [0, 0, 0]
      for (const p of group) { mean[0] += p.rgb[0]; mean[1] += p.rgb[1]; mean[2] += p.rgb[2] }
      mean[0] /= group.length; mean[1] /= group.length; mean[2] /= group.length
      if (k === 0) c1 = mean; else c2 = mean
    }
  }
  const colors = [hex(c1[0], c1[1], c1[2]), hex(c2[0], c2[1], c2[2])]
  return items.map((p, i) => ({ kind: 'player', x: p.x, y: p.y, color: colors[assign[i]] }))
}

function fitLine(points: Pt[]): Line | null {
  if (points.length < 2) return null
  const mean = points.reduce((p, q) => ({ x: p.x + q.x, y: p.y + q.y }), { x: 0, y: 0 })
  mean.x /= points.length; mean.y /= points.length
  let sxx = 0, syy = 0, sxy = 0
  for (const p of points) {
    const dx = p.x - mean.x, dy = p.y - mean.y
    sxx += dx * dx; syy += dy * dy; sxy += dx * dy
  }
  if (sxx + syy < 1e-6) return null
  const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy)
  const vx = Math.cos(angle), vy = Math.sin(angle)
  const a = -vy, b = vx, c = -(a * mean.x + b * mean.y)
  return { a, b, c }
}

function intersectLines(l1: Line | null, l2: Line | null): Pt | null {
  if (!l1 || !l2) return null
  const det = l1.a * l2.b - l2.a * l1.b
  if (Math.abs(det) < 1e-6) return null
  return {
    x: (l1.b * l2.c - l2.b * l1.c) / det,
    y: (l1.c * l2.a - l2.c * l1.a) / det,
  }
}

function polyArea(pts: Pt[]) {
  let sum = 0
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length]
    sum += a.x * b.y - b.x * a.y
  }
  return Math.abs(sum) / 2
}

function pointInPoly(p: Pt, poly: Pt[]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j]
    const crosses = (a.y > p.y) !== (b.y > p.y)
      && p.x < ((b.x - a.x) * (p.y - a.y)) / ((b.y - a.y) || 1e-9) + a.x
    if (crosses) inside = !inside
  }
  return inside
}

function pointToSegmentDistance(p: Pt, a: Pt, b: Pt): number {
  const vx = b.x - a.x, vy = b.y - a.y
  const wx = p.x - a.x, wy = p.y - a.y
  const len2 = vx * vx + vy * vy || 1
  const t = Math.max(0, Math.min(1, (wx * vx + wy * vy) / len2))
  const x = a.x + t * vx, y = a.y + t * vy
  return Math.hypot(p.x - x, p.y - y)
}

function pointInPolyLoose(p: Pt, poly: Pt[], margin = 2): boolean {
  if (pointInPoly(p, poly)) return true
  for (let i = 0; i < poly.length; i++) {
    if (pointToSegmentDistance(p, poly[i], poly[(i + 1) % poly.length]) <= margin) return true
  }
  return false
}

function validQuad(pts: (Pt | null)[], w: number, h: number): pts is Pt[] {
  if (pts.length !== 4 || pts.some(p => !p || !Number.isFinite(p.x) || !Number.isFinite(p.y))) return false
  const q = pts as Pt[]
  if (polyArea(q) < w * h * 0.08) return false
  return q.every((p, i) => {
    const n = q[(i + 1) % q.length]
    return Math.hypot(p.x - n.x, p.y - n.y) > Math.min(w, h) * 0.12
  })
}

function clampPt(p: Pt, w: number, h: number): Pt {
  return { x: Math.min(w - 1, Math.max(0, p.x)), y: Math.min(h - 1, Math.max(0, p.y)) }
}

function largestConnectedMask(mask: Uint8Array, w: number, h: number): Uint8Array {
  const seen = new Uint8Array(w * h)
  const stack: number[] = []
  let best: number[] = []
  for (let i = 0; i < w * h; i++) {
    if (!mask[i] || seen[i]) continue
    const comp: number[] = []
    stack.length = 0
    stack.push(i)
    seen[i] = 1
    while (stack.length) {
      const p = stack.pop()!
      comp.push(p)
      const x = p % w
      const ns = [p - 1, p + 1, p - w, p + w]
      for (const n of ns) {
        if (n < 0 || n >= w * h || seen[n] || !mask[n]) continue
        const nx = n % w
        if (Math.abs(nx - x) > 1) continue
        seen[n] = 1
        stack.push(n)
      }
    }
    if (comp.length > best.length) best = comp
  }
  const out = new Uint8Array(w * h)
  for (const i of best) out[i] = 1
  return out
}

function dilateMask(mask: Uint8Array, w: number, h: number, radius: number): Uint8Array {
  const out = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!mask[y * w + x]) continue
    for (let yy = Math.max(0, y - radius); yy <= Math.min(h - 1, y + radius); yy++) {
      for (let xx = Math.max(0, x - radius); xx <= Math.min(w - 1, x + radius); xx++) out[yy * w + xx] = 1
    }
  }
  return out
}

/**
 * Homography from 4 point correspondences, solved in the browser so the
 * corner mapping needs no server. Returns a function applying the
 * perspective transform, or null when the corners are degenerate.
 */
function homography(src: Pt[], dst: Pt[]): ((p: Pt) => Pt) | null {
  // 8 unknowns a..h: X = (ax+by+c)/(gx+hy+1), Y = (dx+ey+f)/(gx+hy+1)
  const A: number[][] = []
  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i]
    const { x: X, y: Y } = dst[i]
    A.push([x, y, 1, 0, 0, 0, -x * X, -y * X, X])
    A.push([0, 0, 0, x, y, 1, -x * Y, -y * Y, Y])
  }
  // gaussian elimination with partial pivoting on the 8x9 system
  for (let col = 0; col < 8; col++) {
    let pivot = col
    for (let r = col + 1; r < 8; r++) if (Math.abs(A[r][col]) > Math.abs(A[pivot][col])) pivot = r
    if (Math.abs(A[pivot][col]) < 1e-10) return null
    ;[A[col], A[pivot]] = [A[pivot], A[col]]
    for (let r = 0; r < 8; r++) {
      if (r === col) continue
      const f = A[r][col] / A[col][col]
      for (let c = col; c < 9; c++) A[r][c] -= f * A[col][c]
    }
  }
  const h = A.map((row, i) => row[8] / row[i])
  return (p: Pt) => {
    const w = h[6] * p.x + h[7] * p.y + 1
    return { x: (h[0] * p.x + h[1] * p.y + h[2]) / w, y: (h[3] * p.x + h[4] * p.y + h[5]) / w }
  }
}

export class ImportPanel {
  el: HTMLDivElement
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private img: HTMLImageElement | null = null
  private file: File | null = null
  private dets: Det[] = []
  private refs: Pt[] = []
  private mode: 'mark' | 'corner' = 'mark'
  private markKind: 'player' | 'ball' = 'player'
  private color: string | null = null
  private detecting = false

  constructor(private store: Store, host: HTMLElement) {
    this.el = document.createElement('div')
    this.el.className = 'modal hidden'
    this.el.innerHTML = `
      <div class="sheet">
        <div class="sheetHead">
          <strong>Import from screenshot</strong>
          <button data-imp="close" class="ghost">Close</button>
        </div>
        <label class="fileBtn">Choose screenshot<input data-imp="file" type="file" accept="image/*" hidden></label>
        <canvas width="${CW}" height="${CH}"></canvas>
        <div class="impRow">
          <button data-imp="detect">Auto-detect all</button>
          <button data-imp="mark" class="active">Tap marks: player</button>
          <button data-imp="corner">Tap corners</button>
          <button data-imp="undo">Undo tap</button>
          <button data-imp="reset">Reset</button>
        </div>
        <div class="impRow">
          <label>Import as
            <select data-imp="team">
              <option value="auto" selected>auto team colors</option>
              <option value="grey">grey</option>
              <option value="red">red</option>
              <option value="blue">blue</option>
            </select>
          </label>
          <button data-imp="map" disabled>Map to board</button>
        </div>
        <div class="impStatus" data-imp="status">Choose a screenshot. Auto-detect finds players and pitch corners automatically; use manual taps only to fix misses.</div>
      </div>`
    host.appendChild(this.el)
    this.canvas = this.el.querySelector('canvas')!
    this.ctx = this.canvas.getContext('2d')!
    this.bind()
  }

  open() { this.el.classList.remove('hidden'); this.draw() }
  close() { this.el.classList.add('hidden') }

  private q(sel: string) { return this.el.querySelector(`[data-imp="${sel}"]`) as HTMLElement }
  private status(s: string) { this.q('status').textContent = s }

  private bind() {
    this.el.addEventListener('click', (e) => {
      if (e.target === this.el) this.close()
      const btn = (e.target as HTMLElement).closest('[data-imp]') as HTMLElement | null
      if (!btn) return
      const k = btn.dataset.imp
      if (k === 'close') this.close()
      else if (k === 'detect') this.detect()
      else if (k === 'mark') {
        if (this.mode === 'mark') this.markKind = this.markKind === 'player' ? 'ball' : 'player'
        this.mode = 'mark'
        this.syncButtons()
      }
      else if (k === 'corner') { this.mode = 'corner'; this.syncButtons() }
      else if (k === 'undo') {
        if (this.mode === 'corner') this.refs.pop()
        else this.dets.pop()
        this.update()
      }
      else if (k === 'reset') { this.dets = []; this.refs = []; this.update() }
      else if (k === 'map') this.map()
    })
    ;(this.q('file') as HTMLInputElement).addEventListener('change', (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]
      if (!file) return
      this.file = file
      const img = new Image()
      img.onload = () => {
        this.img = img
        this.dets = []; this.refs = []
        this.status(`Loaded ${file.name}. Detecting players and pitch corners ...`)
        this.update()
        window.setTimeout(() => this.detect(), 0)
      }
      img.src = URL.createObjectURL(file)
    })
    ;(this.q('team') as HTMLSelectElement).addEventListener('change', (e) => {
      const v = (e.target as HTMLSelectElement).value
      this.color = v === 'auto' ? null : (TEAM_COLORS[v] ?? TEAM_COLORS.grey)
    })
    this.canvas.addEventListener('pointerdown', (e) => {
      if (!this.img) return
      const r = this.canvas.getBoundingClientRect()
      const p = this.toImg({ x: (e.clientX - r.left) * CW / r.width, y: (e.clientY - r.top) * CH / r.height })
      if (this.mode === 'corner') {
        if (this.refs.length < 4) this.refs.push(p)
        if (this.refs.length === 4) this.status('4 corners set. Map to board when ready.')
      } else {
        this.dets.push({ kind: this.markKind, x: p.x, y: p.y })
      }
      this.update()
    })
  }

  private syncButtons() {
    const mark = this.q('mark'), corner = this.q('corner')
    mark.textContent = `Tap marks: ${this.markKind}`
    mark.classList.toggle('active', this.mode === 'mark')
    corner.classList.toggle('active', this.mode === 'corner')
  }

  private update() {
    ;(this.q('map') as HTMLButtonElement).disabled = this.refs.length < 4 || this.dets.length === 0
    this.syncButtons()
    this.draw()
  }

  private fitTransform() {
    const img = this.img!
    const scale = Math.min(CW / img.naturalWidth, CH / img.naturalHeight)
    return { scale, ox: (CW - img.naturalWidth * scale) / 2, oy: (CH - img.naturalHeight * scale) / 2 }
  }
  private toImg(p: Pt): Pt {
    if (!this.img) return p
    const { scale, ox, oy } = this.fitTransform()
    return { x: (p.x - ox) / scale, y: (p.y - oy) / scale }
  }
  private toCanvas(p: Pt): Pt {
    if (!this.img) return p
    const { scale, ox, oy } = this.fitTransform()
    return { x: p.x * scale + ox, y: p.y * scale + oy }
  }

  private draw() {
    const ctx = this.ctx
    ctx.fillStyle = '#0b1220'
    ctx.fillRect(0, 0, CW, CH)
    if (!this.img) {
      ctx.fillStyle = '#94a3b8'
      ctx.font = '16px system-ui'
      ctx.fillText('No screenshot loaded.', 24, 36)
      return
    }
    const { scale, ox, oy } = this.fitTransform()
    ctx.drawImage(this.img, ox, oy, this.img.naturalWidth * scale, this.img.naturalHeight * scale)
    this.dets.forEach((d, i) => {
      const p = this.toCanvas(d)
      ctx.beginPath()
      ctx.arc(p.x, p.y, d.kind === 'ball' ? 8 : 7, 0, Math.PI * 2)
      ctx.fillStyle = d.kind === 'ball' ? '#ffffff' : (d.color || '#22c55e')
      ctx.fill()
      ctx.strokeStyle = '#111827'
      ctx.stroke()
      ctx.fillStyle = '#ffffff'
      ctx.font = '12px system-ui'
      ctx.fillText(String(i + 1), p.x + 9, p.y - 9)
    })
    this.refs.forEach((r, i) => {
      const p = this.toCanvas(r)
      ctx.fillStyle = '#facc15'
      ctx.beginPath()
      ctx.arc(p.x, p.y, 9, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = '#111827'
      ctx.font = 'bold 12px system-ui'
      ctx.fillText(String(i + 1), p.x - 3, p.y + 4)
    })
  }

  private detectPitchCorners(green: Uint8Array, rowGreen: number[], colGreen: number[], w: number, h: number): Pt[] | null {
    const pts: Pt[] = []
    const rowMin = new Array<number>(h).fill(Infinity)
    const rowMax = new Array<number>(h).fill(-Infinity)
    const colMin = new Array<number>(w).fill(Infinity)
    const colMax = new Array<number>(w).fill(-Infinity)
    let minX = w, minY = h, maxX = 0, maxY = 0
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (!green[y * w + x]) continue
      if (x < minX) minX = x; if (x > maxX) maxX = x
      if (y < minY) minY = y; if (y > maxY) maxY = y
      if (x < rowMin[y]) rowMin[y] = x
      if (x > rowMax[y]) rowMax[y] = x
      if (y < colMin[x]) colMin[x] = y
      if (y > colMax[x]) colMax[x] = y
      pts.push({ x, y })
    }
    if (pts.length < w * h * 0.08 || maxX - minX < w * 0.35 || maxY - minY < h * 0.25) return null

    const left: Pt[] = [], right: Pt[] = [], top: Pt[] = [], bottom: Pt[] = []
    const minRow = Math.max(8, w * 0.08)
    const minCol = Math.max(8, h * 0.08)
    for (let y = 0; y < h; y++) {
      if (rowGreen[y] < minRow || rowMax[y] - rowMin[y] < w * 0.15) continue
      left.push({ x: rowMin[y], y })
      right.push({ x: rowMax[y], y })
    }
    for (let x = 0; x < w; x++) {
      if (colGreen[x] < minCol || colMax[x] - colMin[x] < h * 0.15) continue
      top.push({ x, y: colMin[x] })
      bottom.push({ x, y: colMax[x] })
    }

    // Prefer the actual green-mask extrema: these stay on the visible pitch
    // crop and avoid line-fit extrapolations into the crowd on broadcast stills.
    let tl = pts[0], tr = pts[0], br = pts[0], bl = pts[0]
    for (const p of pts) {
      if (p.x + p.y < tl.x + tl.y) tl = p
      if (p.x - p.y > tr.x - tr.y) tr = p
      if (p.x + p.y > br.x + br.y) br = p
      if (p.x - p.y < bl.x - bl.y) bl = p
    }
    const fallback = [tl, tr, br, bl]
    if (validQuad(fallback, w, h)) return fallback

    const lineQuad = [
      intersectLines(fitLine(top), fitLine(left)),
      intersectLines(fitLine(top), fitLine(right)),
      intersectLines(fitLine(bottom), fitLine(right)),
      intersectLines(fitLine(bottom), fitLine(left)),
    ].map(p => p && clampPt(p, w, h))
    return validQuad(lineQuad, w, h) ? lineQuad : null
  }

  /** Detect player marks and pitch corners with canvas heuristics.
   * Marks and corners can still be fixed by hand afterwards.
   */
  private async detect() {
    if (!this.img) { this.status('Choose a screenshot first.'); return }
    if (this.detecting) return
    this.detecting = true
    this.status('Detecting players and pitch corners ...')
    const img = this.img
    const w = 480
    const h = Math.max(1, Math.round(img.naturalHeight * w / img.naturalWidth))
    const off = document.createElement('canvas')
    off.width = w; off.height = h
    const octx = off.getContext('2d', { willReadFrequently: true })!
    octx.drawImage(img, 0, 0, w, h)
    const px = octx.getImageData(0, 0, w, h).data

    // Green-pitch mask. Keep only the largest connected green area so crowd,
    // scorebug, and logo colors cannot pull the automatic corners away from
    // the actual field.
    const rawGreen = new Uint8Array(w * h)
    for (let i = 0; i < w * h; i++) {
      const r = px[i * 4], g = px[i * 4 + 1], b = px[i * 4 + 2]
      if (g > 45 && g > r * 1.05 && g > b * 1.05 && g - r > 8 && g - b > 5) rawGreen[i] = 1
    }
    const green = largestConnectedMask(rawGreen, w, h)
    const rowGreen = new Array(h).fill(0)
    const colGreen = new Array(w).fill(0)
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (green[y * w + x]) { rowGreen[y]++; colGreen[x]++ }
    }
    const pitchArea = dilateMask(green, w, h, 7)
    const onPitch = (x: number, y: number) => pitchArea[y * w + x] === 1
    const corners = this.detectPitchCorners(green, rowGreen, colGreen, w, h)
    const inVisiblePitch = (p: Pt) => !corners || pointInPolyLoose(p, corners, 2)

    // connected components of non-green pixels on the pitch
    const seen = new Uint8Array(w * h)
    const found: { x: number; y: number; rgb: number[] }[] = []
    const stack: number[] = []
    const greenNear = (cx: number, cy: number) => {
      let count = 0
      for (let yy = Math.max(0, cy - 3); yy <= Math.min(h - 1, cy + 5); yy++) {
        for (let xx = Math.max(0, cx - 5); xx <= Math.min(w - 1, cx + 5); xx++) if (green[yy * w + xx]) count++
      }
      return count >= 5
    }
    const addCandidate = (pixels: number[]) => {
      if (pixels.length < 10 || pixels.length > 2200) return
      let minX = w, maxX = 0, minY = h, maxY = 0, sumX = 0, sumR = 0, sumG = 0, sumB = 0, body = 0
      for (const i of pixels) {
        const ix = i % w, iy = (i / w) | 0
        const r = px[i * 4], g = px[i * 4 + 1], b = px[i * 4 + 2]
        sumX += ix; sumR += r; sumG += g; sumB += b
        if (Math.max(r, g, b) - Math.min(r, g, b) > 24 || r + g + b < 560) body++
        if (ix < minX) minX = ix; if (ix > maxX) maxX = ix
        if (iy < minY) minY = iy; if (iy > maxY) maxY = iy
      }
      const area = pixels.length
      const bw = maxX - minX + 1, bh = maxY - minY + 1
      // player-sized upright blob: tall-ish, not a pitch line, text label, or banner
      if (bh < 5 || bh > h * 0.35 || bw < 3 || bw > w * 0.12) return
      const aspect = bh / bw
      if (aspect < 0.55 || aspect > 6) return
      if (area / (bw * bh) < 0.18) return
      // colorless blobs are usually pitch-line fragments, but a solidly
      // filled one is a white kit: line pieces fill little of their box
      if (body < Math.max(2, area * 0.08) && area / (bw * bh) < 0.45) return
      const cx = Math.round(sumX / area)
      const foot = { x: cx, y: maxY }
      const middle = { x: cx, y: (minY + maxY) / 2 }
      if (!inVisiblePitch(foot) && !inVisiblePitch(middle)) return
      if (!greenNear(cx, maxY)) return
      const avgR = sumR / area, avgG = sumG / area, avgB = sumB / area
      const brightness = avgR + avgG + avgB
      const chroma = Math.max(avgR, avgG, avgB) - Math.min(avgR, avgG, avgB)
      // Broadcast graphics, dotted arrows, and ad chevrons are often small,
      // bright, colorless blobs. White kits are kept by their vertical shape.
      if (brightness > 610 && chroma < 35 && aspect < 1.25 && area < 90) return
      found.push({ x: sumX / area, y: maxY, rgb: [avgR, avgG, avgB] })
    }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i0 = y * w + x
      if (seen[i0] || green[i0] || !onPitch(x, y)) continue
      let area = 0, minX = x, maxX = x, minY = y, maxY = y
      const pixels: number[] = []
      stack.length = 0
      stack.push(i0)
      seen[i0] = 1
      while (stack.length) {
        const i = stack.pop()!
        const ix = i % w, iy = (i / w) | 0
        area++
        pixels.push(i)
        if (ix < minX) minX = ix; if (ix > maxX) maxX = ix
        if (iy < minY) minY = iy; if (iy > maxY) maxY = iy
        if (area > 4000) break
        for (const j of [i - 1, i + 1, i - w, i + w]) {
          if (j < 0 || j >= w * h || seen[j] || green[j] || !pitchArea[j]) continue
          const jx = j % w
          if (Math.abs(jx - ix) > 1) continue
          seen[j] = 1
          stack.push(j)
        }
      }
      const bw = maxX - minX + 1, bh = maxY - minY + 1
      if (bw > bh * 1.1 && bw > 18 && area > 90) {
        const n = Math.min(4, Math.max(2, Math.round(bw / Math.max(7, bh * 0.42))))
        const bins: number[][] = Array.from({ length: n }, () => [])
        for (const i of pixels) {
          const ix = i % w
          const bi = Math.min(n - 1, Math.max(0, Math.floor((ix - minX) * n / bw)))
          bins[bi].push(i)
        }
        for (const bin of bins) addCandidate(bin)
      } else {
        addCandidate(pixels)
      }
    }

    // back to natural image coords; feet at the blob's bottom
    const sx = img.naturalWidth / w
    const sy = img.naturalHeight / h
    this.dets = clusterTeamColors(found).map(d => ({ ...d, x: d.x * sx, y: d.y * sy }))
    this.refs = corners ? corners.map(p => ({ x: p.x * sx, y: p.y * sy })) : []
    if (this.dets.length && this.refs.length === 4) {
      this.status(`Detected ${this.dets.length} players and 4 pitch reference corners. Tap Map to board, or adjust marks/corners first.`)
    } else if (this.dets.length) {
      this.status(`Detected ${this.dets.length} player marks but not the pitch reference corners. Tap corners to fix.`)
    } else if (this.refs.length === 4) {
      this.status('Detected 4 pitch reference corners but no players. Tap player marks to fix.')
    } else {
      this.status('Could not auto-detect this screenshot. Tap player marks and corners by hand.')
    }
    this.update()
    this.detecting = false
  }

  private map() {
    if (this.refs.length < 4 || this.dets.length === 0) return
    const boardH = this.store.scene.board.h
    const corners = [{ x: 0, y: 0 }, { x: BOARD_W, y: 0 }, { x: BOARD_W, y: boardH }, { x: 0, y: boardH }]
    const transform = homography(this.refs.slice(0, 4), corners)
    if (!transform) {
      this.status('Those corners do not form a usable quadrilateral. Re-tap them: top-left, top-right, bottom-right, bottom-left.')
      return
    }
    const color = this.color
    let added = 0
    this.store.apply(s => {
      for (const d of this.dets) {
        const p = transform({ x: d.x, y: d.y })
        const x = Math.min(BOARD_W, Math.max(0, p.x))
        const y = Math.min(boardH, Math.max(0, p.y))
        if (d.kind === 'ball') insertByTier(s.objects, { id: uid(), type: 'ball', x, y, size: 20, flipX: false, flipY: false })
        else insertByTier(s.objects, { id: uid(), type: 'player', x, y, r: 13, color: color || d.color || TEAM_COLORS.grey, label: '', name: '', namePos: 'bottom', nameSize: 18, nameDisplay: 'last', flipX: false, flipY: false })
        added++
      }
    })
    this.status(`Mapped ${added} objects onto the board.`)
    this.close()
  }
}
