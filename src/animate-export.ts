import { backgrounds } from './background-library'
import { isBackgroundId } from './backgrounds'
import { ToolDefaults } from './board'
import { GifWriter } from './gif'
import { OffscreenBoard } from './offscreen-board'
import { BOARD_W } from './types'
import { Project, boardName, frameAt, projectDuration } from './projects'

/**
 * Exporting a project as an animation. Frames come from a second, off-screen
 * board rather than the one on screen, so the export never disturbs what the
 * editor is holding and never lands in undo history.
 */

const GIF_FPS = 30
const VIDEO_FPS = 30
const GIF_WIDTH = 1040
const VIDEO_WIDTH = 1040
const CAPTION_PAD = 18

export type AnimationKind = 'gif' | 'video'
export type Progress = (done: number, total: number) => void
export type BackgroundResolver = (id: string) => Promise<string | null>

function pickVideoType(): string | null {
  const types = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm']
  return types.find(t => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t)) ?? null
}

/** Plain text from a note, for a caption burnt into the frame. */
function captionText(note: string): string {
  return note
    .split('\n')
    .map(line => line.replace(/^#{1,6}\s*/, '').replace(/^[-*]\s+/, '• ').replace(/[*_`>]/g, '').trim())
    .filter(Boolean)
    .join('  ')
    .slice(0, 240)
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/)
  const lines: string[] = []
  let line = ''
  for (const word of words) {
    const next = line ? `${line} ${word}` : word
    if (ctx.measureText(next).width > maxWidth && line) { lines.push(line); line = word }
    else line = next
  }
  if (line) lines.push(line)
  return lines.slice(0, 3)
}

/**
 * Draw every frame of `project` into `onFrame`, at `fps`. The caption band is
 * drawn under the pitch when notes are included, so nothing covers the play.
 */
async function renderFrames(
  project: Project,
  defaults: ToolDefaults,
  width: number,
  fps: number,
  withNotes: boolean,
  onFrame: (canvas: HTMLCanvasElement, index: number, total: number) => void | Promise<void>,
  resolveBackground?: BackgroundResolver,
) {
  const source = resolveBackground ?? ((id: string) => backgrounds.image(id))
  const backgroundCache = new Map<string, string | null>()
  const cachedBackground = async (id: string) => {
    if (backgroundCache.has(id)) return backgroundCache.get(id) ?? null
    const image = await source(id)
    backgroundCache.set(id, image)
    return image
  }
  // Load each photograph before the frame loop. Otherwise the off-screen board
  // can take its first frame while the custom background still has no src.
  const backgroundIds = [...new Set(project.boards
    .map(item => item.scene.pitch)
    .filter((id): id is string => isBackgroundId(id)))]
  await Promise.all(backgroundIds.map(cachedBackground))

  const offscreen = new OffscreenBoard(defaults, cachedBackground)
  try {
    const total = projectDuration(project)
    const step = 1000 / fps
    const count = Math.max(2, Math.ceil(total / step))
    const first = frameAt(project, 0)
    const aspect = first.view.h / first.view.w
    const boardH = Math.round(width * aspect)
    const captionH = withNotes ? Math.round(width * 0.13) : 0

    const out = document.createElement('canvas')
    out.width = width
    out.height = boardH + captionH
    const ctx = out.getContext('2d')!

    for (let i = 0; i < count; i++) {
      const frame = frameAt(project, Math.min(i * step, total))
      offscreen.store.loadScene(frame.scene)
      // A cached custom background reaches Board through a resolved promise.
      // Let that callback assign src before waiting for the image to decode.
      await Promise.resolve()
      await offscreen.board.imagesReady()
      /* the scene still carries an object the next board drops, and already
         carries one it adds; the frame's alphas are what take them in and out,
         so the export dims them exactly as the player does */
      const alpha = new Map<string, number>()
      frame.fading.forEach(id => alpha.set(id, frame.exitAlpha))
      frame.arriving.forEach(id => alpha.set(id, frame.enterAlpha))
      frame.riding.forEach(id => alpha.set(id, frame.rideAlpha))
      const shot = offscreen.board.toFrameCanvas(width, frame.view, alpha)
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, out.width, out.height)
      ctx.drawImage(shot, 0, 0, width, boardH)
      if (captionH) {
        ctx.fillStyle = '#f7f3ec'
        ctx.fillRect(0, boardH, width, captionH)
        ctx.fillStyle = '#5f574a'
        ctx.font = `${Math.round(width * 0.028)}px -apple-system, "Helvetica Neue", Arial, sans-serif`
        ctx.textBaseline = 'top'
        ctx.globalAlpha = Math.max(0, Math.min(1, frame.noteAlpha))
        const note = captionText(project.boards[frame.current].note)
        const lines = note ? wrap(ctx, note, width - CAPTION_PAD * 2) : [boardName(project, frame.current)]
        lines.forEach((line, n) => {
          ctx.fillText(line, CAPTION_PAD, boardH + CAPTION_PAD * 0.6 + n * width * 0.036)
        })
        ctx.globalAlpha = 1
      }
      await onFrame(out, i, count)
    }
  } finally {
    offscreen.destroy()
  }
}

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.download = filename
  a.href = url
  a.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/**
 * Hand the file to the share sheet, which is where iOS offers Save Image and
 * Save Video. Encoding takes long enough that Safari may have forgotten the
 * tap that started it and refuse to open the sheet, so anything other than the
 * user closing it falls back to a download.
 */
function share(blob: Blob, filename: string) {
  const file = new File([blob], filename, { type: blob.type })
  const nav = navigator as Navigator & { canShare?: (data: ShareData) => boolean }
  if (nav.share && nav.canShare?.({ files: [file] })) {
    void nav.share({ files: [file] }).catch((err: unknown) => {
      const name = err instanceof Error ? err.name : ''
      if (name !== 'AbortError') download(blob, filename)
    })
    return
  }
  download(blob, filename)
}

function safeName(project: Project): string {
  const base = project.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  return base || 'tactics-board'
}

export async function exportGif(project: Project, defaults: ToolDefaults, withNotes: boolean, onProgress?: Progress, resolveBackground?: BackgroundResolver) {
  const gif: { writer?: GifWriter } = {}
  await renderFrames(project, defaults, GIF_WIDTH, GIF_FPS, withNotes, async (canvas, index, total) => {
    const ctx = canvas.getContext('2d')!
    gif.writer ??= new GifWriter(canvas.width, canvas.height)
    // GIF delays use hundredths of a second. Alternate 30 ms and 40 ms delays
    // so every three frames take 100 ms, which keeps the export at 30 fps.
    const elapsed = Math.round(index * 100 / GIF_FPS)
    const nextElapsed = Math.round((index + 1) * 100 / GIF_FPS)
    gif.writer.add({
      data: ctx.getImageData(0, 0, canvas.width, canvas.height).data,
      delayMs: (nextElapsed - elapsed) * 10,
    })
    onProgress?.(index + 1, total)
    // encoding a frame is the slow part, so hand the tab back between frames
    await new Promise(r => setTimeout(r))
  }, resolveBackground)
  if (!gif.writer) throw new Error('Nothing to animate.')
  share(gif.writer.finish(), `${safeName(project)}.gif`)
}

export async function exportVideo(project: Project, defaults: ToolDefaults, withNotes: boolean, onProgress?: Progress, resolveBackground?: BackgroundResolver) {
  const mimeType = pickVideoType()
  if (!mimeType) throw new Error('This browser cannot record video. The GIF works everywhere.')

  const stage = document.createElement('canvas')
  const ctx = stage.getContext('2d')!
  let started = false
  let recorder: MediaRecorder | null = null
  const chunks: BlobPart[] = []
  const done = new Promise<Blob>((resolve, reject) => {
    const begin = () => {
      const stream = stage.captureStream(VIDEO_FPS)
      recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 6_000_000 })
      recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data) }
      recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType }))
      recorder.onerror = () => reject(new Error('The recording stopped early.'))
      recorder.start()
    }
    void renderFrames(project, defaults, VIDEO_WIDTH, VIDEO_FPS, withNotes, async (canvas, index, total) => {
      if (!started) {
        stage.width = canvas.width
        stage.height = canvas.height
        started = true
        begin()
      }
      ctx.drawImage(canvas, 0, 0)
      onProgress?.(index + 1, total)
      // let the capture stream take this frame before the next one lands
      await new Promise(r => requestAnimationFrame(r))
    }, resolveBackground).then(() => {
      window.setTimeout(() => recorder?.stop(), 120)
    }).catch(reject)
  })

  const blob = await done
  const ext = mimeType.startsWith('video/mp4') ? 'mp4' : 'webm'
  share(blob, `${safeName(project)}.${ext}`)
}

export async function exportAnimation(kind: AnimationKind, project: Project, defaults: ToolDefaults, withNotes: boolean, onProgress?: Progress, resolveBackground?: BackgroundResolver) {
  if (project.boards.length < 2) throw new Error('A project needs two boards to animate.')
  if (kind === 'gif') await exportGif(project, defaults, withNotes, onProgress, resolveBackground)
  else await exportVideo(project, defaults, withNotes, onProgress, resolveBackground)
}

export { BOARD_W }
