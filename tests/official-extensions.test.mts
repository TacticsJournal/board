import assert from 'node:assert/strict'
import test from 'node:test'

import {
  OFFICIAL_EXTENSIONS,
  OFFICIAL_EXTENSION_IDS,
  officialExtension,
  officialExtensionList,
} from '../src/extensions/official/registry.ts'
import {
  OFFICIAL_EXTENSIONS_KEY,
  defaultOfficialExtensionState,
  loadOfficialExtensionState,
  normalizeOfficialExtensionState,
  saveOfficialExtensionState,
  setOfficialExtensionEnabled,
} from '../src/extensions/official/state.ts'
import { THREE_D_VIEW_ID, threeDViewExtension } from '../src/extensions/official/3d-view/index.ts'
import type { OfficialExtensionHost } from '../src/extensions/official/types.ts'

function hostRecorder() {
  const calls: boolean[] = []
  let on = false
  const host: OfficialExtensionHost = {
    set3D(value) { on = value; calls.push(value) },
    is3D: () => on,
    reset3DCamera() {},
  }
  return { host, calls, get on() { return on } }
}

test('3D View is registered as a bundled official extension', () => {
  assert.deepEqual(OFFICIAL_EXTENSION_IDS, [THREE_D_VIEW_ID])
  assert.equal(OFFICIAL_EXTENSIONS[0], threeDViewExtension)
  assert.equal(officialExtension(THREE_D_VIEW_ID)?.name, '3D View')
  assert.deepEqual(officialExtensionList().map(item => item.name), ['3D View'])
  assert.equal('activate' in officialExtensionList()[0], false)
})

test('a device with no official state enables every bundled extension', () => {
  const values = new Map<string, string>()
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
  } as unknown as Storage
  assert.deepEqual(defaultOfficialExtensionState(OFFICIAL_EXTENSION_IDS).enabled, [THREE_D_VIEW_ID])
  assert.deepEqual(loadOfficialExtensionState(OFFICIAL_EXTENSION_IDS, storage).enabled, [THREE_D_VIEW_ID])
  values.set(OFFICIAL_EXTENSIONS_KEY, JSON.stringify({ version: 1, enabled: [] }))
  assert.deepEqual(loadOfficialExtensionState(OFFICIAL_EXTENSION_IDS, storage).enabled, [])
})

test('official state is device-only and ignores unknown ids', () => {
  const known = ['3d-view', 'other']
  assert.deepEqual(normalizeOfficialExtensionState({ enabled: ['gone', 'other', 'other', 7] }, known).enabled, ['other'])
  const on = setOfficialExtensionEnabled({ version: 1, enabled: [] }, '3d-view', true, known)
  assert.deepEqual(on.enabled, ['3d-view'])
  assert.deepEqual(setOfficialExtensionEnabled(on, '3d-view', false, known).enabled, [])

  const values = new Map<string, string>()
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
  } as unknown as Storage
  assert.equal(saveOfficialExtensionState(on, known, storage), true)
  assert.match(values.get(OFFICIAL_EXTENSIONS_KEY) || '', /3d-view/)
})

test('3D View toggles Board through the narrow host and deactivates flat', () => {
  const board = hostRecorder()
  const instance = threeDViewExtension.activate(board.host)
  const button = instance.toolbar?.[0]
  assert.ok(button)
  assert.equal(button.label, '3D view')
  assert.equal(button.pressed?.(), false)
  assert.match(button.icon, /viewBox="0 0 24 24"/)
  assert.match(button.icon, /fill="currentColor"/)

  button.select()
  assert.equal(board.on, true)
  assert.equal(button.pressed?.(), true)
  button.select()
  assert.equal(board.on, false)
  instance.deactivate()
  assert.equal(board.on, false)
  assert.deepEqual(board.calls, [true, false, false])
})
