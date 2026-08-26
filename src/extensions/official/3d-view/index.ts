/* 3D View is a bundled extension. Board owns the live Konva camera and all
 * editing behavior. This module owns activation, the device preferences, and
 * the toolbar control that calls Board's narrow view API. */

import type { OfficialExtension, OfficialExtensionHost, OfficialExtensionInstance } from '../types.ts'

export const THREE_D_VIEW_ID = '3d-view'
const TILT_KEY = 'tbm-board-3d-v1'

/** The supplied top-tools icon. Its paths use currentColor so themes carry through. */
const ICON = '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24"><path d="M0 0h24v24H0z" fill="none"/><path fill="currentColor" d="M3 16c0 .34.18.67.47.85l8 5a1.01 1.01 0 0 0 1.06 0l8-5c.29-.18.47-.5.47-.85V8c0-.34-.18-.67-.47-.85l-8-5c-.32-.2-.74-.2-1.06 0l-8 5c-.29.18-.47.5-.47.85zm10 3.2v-6.13l6-3.6v5.98zM12 4.18l5.84 3.65l-5.84 3.5l-5.84-3.5z"/></svg>'

function storage(): Storage | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage } catch { return null }
}

function readPreference(): boolean {
  try { return storage()?.getItem(TILT_KEY) === '1' } catch { return false }
}

function writePreference(on: boolean): void {
  try { storage()?.setItem(TILT_KEY, on ? '1' : '0') } catch { /* private mode */ }
}

export const threeDViewExtension: OfficialExtension = {
  id: THREE_D_VIEW_ID,
  name: '3D View',
  description: 'Lean the board back into perspective and keep editing it. The live board keeps its full orbit, zoom, and pointer mapping.',
  version: '1.0.0',
  author: 'Mi',

  activate(host: OfficialExtensionHost): OfficialExtensionInstance {
    const set3D = (on: boolean) => {
      host.set3D(on)
      writePreference(on)
    }
    if (readPreference()) host.set3D(true)

    return {
      toolbar: [{
        id: 'tilt',
        icon: ICON,
        label: '3D view',
        pressedLabel: 'Back to 2D view',
        pressed: () => host.is3D(),
        select: () => set3D(!host.is3D()),
      }],
      deactivate: () => {
        host.set3D(false)
        writePreference(false)
      },
    }
  },
}
