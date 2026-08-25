import { backgrounds } from './background-library'
import { isBackgroundId } from './backgrounds'
import type { ToolDefaults } from './board'
import { OffscreenBoard } from './offscreen-board'
import { boardName, type Project } from './projects'
import { zipFiles, type ZipFile } from './zip'

const EXPORT_WIDTH = 2048

export type ProjectImageFile = {
  name: string
  blob: Blob
}

function safeName(value: string, fallback: string): string {
  const base = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  return base || fallback
}

function canvasPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Could not make a PNG from this board.')), 'image/png')
  })
}

function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.download = filename
  link.href = url
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

export function downloadProjectImage(file: ProjectImageFile): void {
  download(file.blob, file.name)
}

function shareImages(files: readonly ZipFile[], projectName: string): Promise<boolean> {
  const nav = navigator as Navigator & { canShare?: (data: ShareData) => boolean }
  if (!nav.share || !nav.canShare) return Promise.resolve(false)
  const shareFiles = files.map(file => new File([file.data], file.name, { type: 'image/png' }))
  if (!nav.canShare({ files: shareFiles })) return Promise.resolve(false)
  return nav.share({
    title: projectName,
    text: 'Project board images',
    files: shareFiles,
  }).then(() => true).catch((error: unknown) => {
    if (error instanceof Error && error.name === 'AbortError') return true
    throw error
  })
}

async function buildProjectImages(
  project: Project,
  defaults: ToolDefaults,
  onProgress?: (done: number, total: number) => void,
  resolveBackground?: (id: string) => Promise<string | null>,
): Promise<{ files: ZipFile[]; imageFiles: ProjectImageFile[]; filename: string }> {
  if (!project.boards.length) throw new Error('This project has no boards to export.')

  const source = resolveBackground ?? ((id: string) => backgrounds.image(id))
  const backgroundCache = new Map<string, string | null>()
  const cachedBackground = async (id: string) => {
    if (backgroundCache.has(id)) return backgroundCache.get(id) ?? null
    const image = await source(id)
    backgroundCache.set(id, image)
    return image
  }
  const renderer = new OffscreenBoard(defaults, cachedBackground)
  try {
    const digits = String(project.boards.length).length
    const files: ZipFile[] = []
    const imageFiles: ProjectImageFile[] = []
    for (let index = 0; index < project.boards.length; index++) {
      const item = project.boards[index]
      if (isBackgroundId(item.scene.pitch)) await cachedBackground(item.scene.pitch)
      renderer.store.loadScene(item.scene)
      // A cached custom background reaches Board through a resolved promise.
      await Promise.resolve()
      await renderer.board.imagesReady()
      const png = await canvasPng(renderer.board.toFrameCanvas(EXPORT_WIDTH))
      const number = String(index + 1).padStart(digits, '0')
      const name = safeName(boardName(project, index), `board-${number}`)
      const filename = `${number}-${name}.png`
      files.push({ name: filename, data: new Uint8Array(await png.arrayBuffer()) })
      imageFiles.push({ name: filename, blob: png })
      onProgress?.(index + 1, project.boards.length)
      await new Promise(resolve => window.setTimeout(resolve))
    }
    const filename = `${safeName(project.name, 'tactics-board')}-images.zip`
    return { files, imageFiles, filename }
  } finally {
    renderer.destroy()
  }
}

export async function buildProjectImagesZip(
  project: Project,
  defaults: ToolDefaults,
  onProgress?: (done: number, total: number) => void,
  resolveBackground?: (id: string) => Promise<string | null>,
): Promise<{ blob: Blob; filename: string }> {
  const result = await buildProjectImages(project, defaults, onProgress, resolveBackground)
  return { blob: zipFiles(result.files), filename: result.filename }
}

export async function exportProjectImages(
  project: Project,
  defaults: ToolDefaults,
  onProgress?: (done: number, total: number) => void,
  resolveBackground?: (id: string) => Promise<string | null>,
  onUnsupportedShare?: (files: readonly ProjectImageFile[]) => void,
): Promise<void> {
  const result = await buildProjectImages(project, defaults, onProgress, resolveBackground)
  if (await shareImages(result.files, project.name)) return
  if (onUnsupportedShare) {
    onUnsupportedShare(result.imageFiles)
    return
  }
  download(zipFiles(result.files), result.filename)
}
