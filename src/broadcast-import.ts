/* ---------- broadcast stills picked from the camera button ----------
   One image changes the board you are on, the way the button always has.
   Several become boards of their own, in the order the picker gave them, so a
   folder of stills opens as boards to flick through rather than one image that
   overwrites the last. The saving is here, away from the screen, so the order
   and what happens to a file that will not decode can be tested. */

/** Just enough of the browser to turn a picked file into a decoded image. */
export type ImageDecoder<Img> = {
  create(file: Blob): string
  revoke(url: string): void
  load(url: string): Promise<Img>
}

/** Decode one picked file, handing its object URL back either way. */
export async function decodeImageFile<Img>(file: Blob, decoder: ImageDecoder<Img>): Promise<Img> {
  const url = decoder.create(file)
  try {
    return await decoder.load(url)
  } finally {
    decoder.revoke(url)
  }
}

export type SavedShot<Meta> = { name: string; meta: Meta }
export type ShotImport<Meta> = { saved: SavedShot<Meta>[]; failed: string[] }

/**
 * Save every picked image as a broadcast background, in picker order.
 *
 * One file that will not decode or will not fit is counted and stepped over:
 * the rest of the pick is still worth having, and the caller says so.
 */
export async function importBroadcastShots<File extends Blob, Img, Meta>(
  files: readonly File[],
  deps: {
    decode(file: File): Promise<Img>
    save(img: Img, name: string): Promise<Meta>
    name(file: File): string
  },
): Promise<ShotImport<Meta>> {
  const saved: SavedShot<Meta>[] = []
  const failed: string[] = []
  for (const file of files) {
    const name = deps.name(file)
    try {
      saved.push({ name, meta: await deps.save(await deps.decode(file), name) })
    } catch {
      failed.push(name)
    }
  }
  return { saved, failed }
}

/** What to tell someone after a pick, in the fewest words that are true. */
export function shotImportMessage(result: ShotImport<unknown>): string {
  const added = result.saved.length
  const failed = result.failed.length
  if (!added) {
    return failed === 1
      ? `${result.failed[0]} could not be added on this device.`
      : 'Those images could not be added on this device.'
  }
  const boards = `${added} board${added === 1 ? '' : 's'}`
  if (!failed) return `Added ${boards} from your images.`
  return `Added ${boards}. ${failed} image${failed === 1 ? '' : 's'} could not be added.`
}
