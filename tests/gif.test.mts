import assert from 'node:assert/strict'
import test from 'node:test'

import { encodeGif, quantizeGifFrame } from '../src/gif.ts'

function broadcastGradient(width: number, height: number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = (y * width + x) * 4
      data[p] = 30 + Math.round(170 * x / Math.max(1, width - 1))
      data[p + 1] = 45 + Math.round(170 * y / Math.max(1, height - 1))
      data[p + 2] = 20 + Math.round(100 * (x + y) / Math.max(1, width + height - 2))
      data[p + 3] = 255
    }
  }
  return data
}

test('a broadcast frame gets a palette fitted to its own colours', () => {
  const width = 64
  const height = 64
  const data = broadcastGradient(width, height)
  const { palette, indices } = quantizeGifFrame(data, width, height)

  let error = 0
  for (let i = 0, p = 0; i < indices.length; i++, p += 4) {
    const q = indices[i] * 3
    error += Math.abs(data[p] - palette[q])
    error += Math.abs(data[p + 1] - palette[q + 1])
    error += Math.abs(data[p + 2] - palette[q + 2])
  }

  assert.ok(new Set(indices).size > 200, 'the photograph should use the available palette')
  assert.ok(error / (width * height * 3) < 4, 'the fitted palette should keep smooth photographic colour')
})

test('GIF frames carry their fitted local colour table', async () => {
  const width = 8
  const height = 8
  const blob = encodeGif(width, height, [{ data: broadcastGradient(width, height), delayMs: 40 }])
  const bytes = new Uint8Array(await blob.arrayBuffer())

  assert.equal(new TextDecoder().decode(bytes.subarray(0, 6)), 'GIF89a')
  assert.equal(bytes[10] & 0x80, 0, 'the logical screen has no fixed global palette')
  const descriptor = bytes.indexOf(0x2c, 32)
  assert.ok(descriptor >= 0, 'the GIF should contain an image descriptor')
  assert.equal(bytes[descriptor + 9], 0x87, 'the frame should carry a 256-colour local table')
  assert.equal(bytes.at(-1), 0x3b)
})
