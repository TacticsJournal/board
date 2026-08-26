/* The small contract shared by Board and its bundled extensions. Official
 * modules ship in this bundle and get view controls only. They never receive
 * the scene, store, or document persistence. */

export type OfficialExtensionHost = {
  /** Turn Board's existing live renderer on or off. */
  set3D(on: boolean): void
  /** Read the current view mode for an accessible toolbar control. */
  is3D(): boolean
  /** Return the existing camera to its default position. */
  reset3DCamera(): void
}

export type OfficialToolbarButton = {
  id: string
  /** Complete inline SVG markup for the toolbar icon. */
  icon: string
  label: string
  pressedLabel?: string
  pressed?: () => boolean
  select: () => void
}

export type OfficialExtensionInstance = {
  toolbar?: readonly OfficialToolbarButton[]
  deactivate: () => void
}

export type OfficialExtension = {
  id: string
  name: string
  description: string
  version: string
  author: string
  activate: (host: OfficialExtensionHost) => OfficialExtensionInstance
}

export type OfficialExtensionInfo = Pick<OfficialExtension, 'id' | 'name' | 'description' | 'version' | 'author'>

export function officialExtensionInfo(extension: OfficialExtension): OfficialExtensionInfo {
  const { id, name, description, version, author } = extension
  return { id, name, description, version, author }
}
