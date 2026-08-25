/**
 * A small animated-GIF encoder. Each frame gets a palette fitted to its own
 * colours, so both drawn pitches and broadcast photographs survive GIF's
 * 256-colour limit. No dependency, no worker, no upload.
 */

type Colour = { key: number; r: number; g: number; b: number; count: number }
type ColourBox = {
  colours: Colour[]
  ranges: [number, number, number]
  population: number
  score: number
}

function describeBox(colours: Colour[]): ColourBox {
  let minR = 255, minG = 255, minB = 255
  let maxR = 0, maxG = 0, maxB = 0
  let population = 0
  for (const colour of colours) {
    minR = Math.min(minR, colour.r); maxR = Math.max(maxR, colour.r)
    minG = Math.min(minG, colour.g); maxG = Math.max(maxG, colour.g)
    minB = Math.min(minB, colour.b); maxB = Math.max(maxB, colour.b)
    population += colour.count
  }
  const ranges: [number, number, number] = [maxR - minR, maxG - minG, maxB - minB]
  return { colours, ranges, population, score: Math.max(...ranges) * Math.log2(population + 1) }
}

function splitBox(box: ColourBox): [ColourBox, ColourBox] | null {
  if (box.colours.length < 2) return null
  const channel = box.ranges[1] >= box.ranges[0] && box.ranges[1] >= box.ranges[2]
    ? 'g' : box.ranges[0] >= box.ranges[2] ? 'r' : 'b'
  const colours = [...box.colours].sort((a, b) => a[channel] - b[channel])
  const half = box.population / 2
  let count = 0
  let cut = 1
  for (; cut < colours.length; cut++) {
    count += colours[cut - 1].count
    if (count >= half) break
  }
  cut = Math.max(1, Math.min(colours.length - 1, cut))
  return [describeBox(colours.slice(0, cut)), describeBox(colours.slice(cut))]
}

/** Build a local 256-colour palette for one frame instead of forcing a photo through board-art colours. */
export function quantizeGifFrame(data: Uint8ClampedArray, width: number, height: number): { palette: Uint8Array; indices: Uint8Array } {
  const bins = 1 << 15
  const counts = new Uint32Array(bins)
  const reds = new Uint32Array(bins)
  const greens = new Uint32Array(bins)
  const blues = new Uint32Array(bins)
  const pixels = width * height
  for (let i = 0, p = 0; i < pixels; i++, p += 4) {
    const r = data[p], g = data[p + 1], b = data[p + 2]
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3)
    counts[key]++
    reds[key] += r
    greens[key] += g
    blues[key] += b
  }

  const colours: Colour[] = []
  for (let key = 0; key < bins; key++) {
    const count = counts[key]
    if (!count) continue
    colours.push({ key, count, r: reds[key] / count, g: greens[key] / count, b: blues[key] / count })
  }

  const boxes = colours.length ? [describeBox(colours)] : []
  while (boxes.length < 256) {
    let at = -1
    for (let i = 0; i < boxes.length; i++) {
      if (boxes[i].colours.length > 1 && (at < 0 || boxes[i].score > boxes[at].score)) at = i
    }
    if (at < 0) break
    const pair = splitBox(boxes[at])
    if (!pair) break
    boxes.splice(at, 1, ...pair)
  }

  const palette = new Uint8Array(256 * 3)
  const lookup = new Uint8Array(bins)
  boxes.forEach((box, index) => {
    let r = 0, g = 0, b = 0
    for (const colour of box.colours) {
      r += colour.r * colour.count
      g += colour.g * colour.count
      b += colour.b * colour.count
    }
    palette[index * 3] = Math.round(r / box.population)
    palette[index * 3 + 1] = Math.round(g / box.population)
    palette[index * 3 + 2] = Math.round(b / box.population)
  })

  // Assign each occupied 5-bit colour bin to its nearest palette entry once.
  for (const colour of colours) {
    let nearest = 0
    let distance = Number.POSITIVE_INFINITY
    for (let i = 0; i < boxes.length; i++) {
      const p = i * 3
      const dr = colour.r - palette[p]
      const dg = colour.g - palette[p + 1]
      const db = colour.b - palette[p + 2]
      const next = dr * dr + dg * dg + db * db
      if (next < distance) { distance = next; nearest = i }
    }
    lookup[colour.key] = nearest
  }

  const indices = new Uint8Array(pixels)
  for (let i = 0, p = 0; i < pixels; i++, p += 4) {
    indices[i] = lookup[((data[p] >> 3) << 10) | ((data[p + 1] >> 3) << 5) | (data[p + 2] >> 3)]
  }
  return { palette, indices }
}

class Bytes {
  private buf = new Uint8Array(1 << 16)
  private len = 0
  private room(n: number) {
    if (this.len + n <= this.buf.length) return
    let size = this.buf.length * 2
    while (size < this.len + n) size *= 2
    const next = new Uint8Array(size)
    next.set(this.buf.subarray(0, this.len))
    this.buf = next
  }
  byte(v: number) { this.room(1); this.buf[this.len++] = v }
  short(v: number) { this.byte(v); this.byte(v >> 8) }
  ascii(text: string) { for (const ch of text) this.byte(ch.charCodeAt(0)) }
  bytes(values: ArrayLike<number>) { this.room(values.length); this.buf.set(values as any, this.len); this.len += values.length }
  toUint8() { return this.buf.subarray(0, this.len) }
}

/** GIF's variable-width LZW, packed into 255-byte sub-blocks. */
function lzwSubBlocks(indices: Uint8Array, minCodeSize: number, w: Bytes) {
  const clear = 1 << minCodeSize
  const eoi = clear + 1
  let codeSize = minCodeSize + 1
  let next = eoi + 1
  // keyed by prefix code and next byte, so a run never builds a string
  let dict = new Map<number, number>()
  let bits = 0
  let bitCount = 0

  // one sub-block at a time: a length byte, then up to 255 bytes of codes
  const block = new Uint8Array(255)
  let fill = 0
  const flush = () => {
    if (!fill) return
    w.byte(fill)
    w.bytes(block.subarray(0, fill))
    fill = 0
  }
  const emit = (code: number) => {
    bits |= code << bitCount
    bitCount += codeSize
    while (bitCount >= 8) {
      block[fill++] = bits & 0xff
      if (fill === 255) flush()
      bits >>>= 8
      bitCount -= 8
    }
  }
  const reset = () => {
    dict = new Map()
    codeSize = minCodeSize + 1
    next = eoi + 1
  }

  emit(clear)
  reset()
  let prefix = indices[0]
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i]
    const key = prefix * 256 + k
    const found = dict.get(key)
    if (found !== undefined) { prefix = found; continue }
    emit(prefix)
    dict.set(key, next++)
    if (next > (1 << codeSize)) {
      if (codeSize < 12) codeSize++
      else { emit(clear); reset() }
    }
    prefix = k
  }
  emit(prefix)
  emit(eoi)
  if (bitCount > 0) { block[fill++] = bits & 0xff; if (fill === 255) flush() }
  flush()
  w.byte(0)
}

export type GifFrame = { data: Uint8ClampedArray; delayMs: number }

/**
 * A GIF written one frame at a time. Frames are encoded as they arrive, so a
 * long project never holds every frame's pixels at once and the caller can
 * hand the tab back between frames.
 */
export class GifWriter {
  private w = new Bytes()
  private width: number
  private height: number

  constructor(width: number, height: number) {
    this.width = width
    this.height = height
    const w = this.w
    w.ascii('GIF89a')
    w.short(width)
    w.short(height)
    w.byte(0x70)           // no global table; every frame carries a photo-aware palette
    w.byte(0)              // background colour index
    w.byte(0)              // default pixel aspect ratio

    // Netscape looping extension
    w.byte(0x21); w.byte(0xff); w.byte(11)
    w.ascii('NETSCAPE2.0')
    w.byte(3); w.byte(1); w.short(0); w.byte(0)
  }

  /** `delayMs` is rounded to the format's hundredths of a second. */
  add(frame: GifFrame) {
    const w = this.w
    const delay = Math.max(2, Math.round(frame.delayMs / 10))
    w.byte(0x21); w.byte(0xf9); w.byte(4)
    w.byte(0x04)         // no transparency, restore to background
    w.short(delay)
    w.byte(0); w.byte(0)

    w.byte(0x2c)
    w.short(0); w.short(0)
    w.short(this.width); w.short(this.height)
    w.byte(0x87)         // local 256-colour table, not interlaced

    const { palette, indices } = quantizeGifFrame(frame.data, this.width, this.height)
    w.bytes(palette)
    w.byte(8)            // minimum code size
    lzwSubBlocks(indices, 8, w)
  }

  finish(): Blob {
    this.w.byte(0x3b)
    return new Blob([this.w.toUint8()], { type: 'image/gif' })
  }
}

/** Encode RGBA frames, all the same size, into one looping GIF. */
export function encodeGif(width: number, height: number, frames: GifFrame[]): Blob {
  const writer = new GifWriter(width, height)
  for (const frame of frames) writer.add(frame)
  return writer.finish()
}
