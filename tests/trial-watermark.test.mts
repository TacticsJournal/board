import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

import { drawTrialWatermark } from '../src/trial-watermark.ts'

test('the trial watermark is drawn visibly on every opted-in GIF frame', async () => {
  const calls: Array<[string, number, number]> = []
  const ctx = {
    save() {},
    restore() {},
    fillText(text: string, x: number, y: number) { calls.push([text, x, y]) },
    font: '', textBaseline: '', textAlign: '', fillStyle: '',
  } as unknown as CanvasRenderingContext2D

  drawTrialWatermark(ctx, 1040, 600)
  assert.equal(calls.length, 2)
  assert.equal(calls[0][0], 'Tactics Journal · Free trial')
  assert.equal(calls[1][0], 'Tactics Journal · Free trial')
  assert.ok(calls.every(([, x, y]) => x > 900 && y > 500))

  const source = await readFile(new URL('../src/animate-export.ts', import.meta.url), 'utf8')
  assert.match(source, /if \(watermark\) drawTrialWatermark\(ctx, width, out\.height\)/)
  assert.match(source, /exportGif[\s\S]*renderFrames[\s\S]*resolveBackground, watermark/)
})
