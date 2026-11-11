/**
 * The iOS app.
 *
 * The app runs this same bundle inside Capacitor's WebKit shell. Two things
 * a browser does for free do not work there: an `<a download>` click goes
 * nowhere, and money cannot change hands outside the App Store. This file is
 * where the board asks which world it is in and, in the app, hands files to
 * the native share sheet, which offers Save Image, Save to Files, AirDrop and
 * every other app.
 */

import { Capacitor } from '@capacitor/core'
import { Directory, Filesystem } from '@capacitor/filesystem'
import { Share } from '@capacitor/share'

/** True inside the iOS (or any Capacitor native) app, false in a browser. */
export const IS_NATIVE_APP = Capacitor.isNativePlatform()

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = String(reader.result || '')
      resolve(result.slice(result.indexOf(',') + 1))
    }
    reader.onerror = () => reject(reader.error || new Error('Could not read the file.'))
    reader.readAsDataURL(blob)
  })
}

async function hrefToBlob(href: string): Promise<Blob> {
  const response = await fetch(href)
  return await response.blob()
}

/** A name the filesystem accepts, keeping the extension the share sheet reads. */
function safeName(filename: string): string {
  return filename.replace(/[\\/:*?"<>|]+/g, '-').trim() || 'board-export'
}

/**
 * Writes the files to the app's cache and opens the share sheet on them.
 * Resolves true once the sheet was shown, whether or not the person then
 * picked anything; false when the files could not be handed over.
 */
export async function nativeShareFiles(files: readonly { source: Blob | string; name: string }[], title?: string): Promise<boolean> {
  try {
    const uris: string[] = []
    for (const file of files) {
      const blob = typeof file.source === 'string' ? await hrefToBlob(file.source) : file.source
      const written = await Filesystem.writeFile({
        path: `exports/${safeName(file.name)}`,
        data: await blobToBase64(blob),
        directory: Directory.Cache,
        recursive: true,
      })
      uris.push(written.uri)
    }
    try {
      await Share.share({ files: uris, title })
    } catch (err) {
      // Closing the sheet is a choice, not a failure.
      const message = err instanceof Error ? err.message : String(err)
      if (!/cancel/i.test(message)) throw err
    }
    return true
  } catch {
    return false
  }
}

/** One file through the share sheet. */
export function nativeShareFile(source: Blob | string, filename: string): Promise<boolean> {
  return nativeShareFiles([{ source, name: filename }])
}
