export function drawTrialWatermark(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  const text = 'Tactics Journal · Free trial'
  ctx.save()
  ctx.font = `bold ${Math.round(width * 0.032)}px -apple-system, "Helvetica Neue", Arial, sans-serif`
  ctx.textBaseline = 'bottom'
  ctx.textAlign = 'right'
  const margin = Math.round(width * 0.024)
  const x = width - margin
  const y = height - margin
  ctx.fillStyle = 'rgba(0, 0, 0, 0.55)'
  ctx.fillText(text, x + 1, y + 1)
  ctx.fillStyle = 'rgba(255, 255, 255, 0.92)'
  ctx.fillText(text, x, y)
  ctx.restore()
}
