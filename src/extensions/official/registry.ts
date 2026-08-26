/* The complete list of bundled, first-party extensions. Self-hosted files use
 * the separate sandboxed extension runtime and never enter this registry. */

import { threeDViewExtension } from './3d-view/index.ts'
import { officialExtensionInfo, type OfficialExtension, type OfficialExtensionInfo } from './types.ts'

export const OFFICIAL_EXTENSIONS: readonly OfficialExtension[] = [threeDViewExtension]
export const OFFICIAL_EXTENSION_IDS: readonly string[] = OFFICIAL_EXTENSIONS.map(extension => extension.id)

export function officialExtension(id: string, extensions: readonly OfficialExtension[] = OFFICIAL_EXTENSIONS): OfficialExtension | null {
  return extensions.find(extension => extension.id === id) || null
}

export function officialExtensionList(extensions: readonly OfficialExtension[] = OFFICIAL_EXTENSIONS): OfficialExtensionInfo[] {
  return extensions.map(officialExtensionInfo)
}
