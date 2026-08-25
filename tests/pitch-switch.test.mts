import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { planCategorySnapshotRecovery } from '../src/category-recovery.ts'

const main = await readFile(new URL('../src/main.ts', import.meta.url), 'utf8')
const pitchClickHandler = main.slice(main.indexOf('const pitchBtn ='), main.indexOf('const agentCopy ='))

test('picking a pitch transforms the current board in one undoable step', () => {
  assert.match(main, /function applyPitchChoice[\s\S]*?store\.apply\(s => \{\s*\n\s*setPitchPreservingLayout\(s, style\.id, h\)/)
  assert.match(main, /function applyPitchChoice[\s\S]*?if \(current\.id === style\.id && \(store\.scene\.board\?\.h \?\? current\.boardH\) === h\) return false/)
  assert.match(pitchClickHandler, /const changed = applyPitchChoice\(style\)/)
})

test('pitch selection has no browser dialog or hidden board fork', () => {
  assert.doesNotMatch(pitchClickHandler, /confirm\(/)
  assert.doesNotMatch(main, /switchPitchCategory|savedCategoryScene|saveCurrentCategoryScene/)
})

test('custom and built-in backgrounds use the same direct pitch edit', () => {
  const useBackground = main.slice(main.indexOf('function useBackground'), main.indexOf('/** A screenshot from the camera button'))
  assert.match(useBackground, /applyPitchChoice\(style, meta\.boardH\)/)
  assert.doesNotMatch(useBackground, /confirm\(/)
})

test('the pitch screen offers accessible undo feedback', () => {
  assert.match(main, /role="status" aria-live="polite" data-pitch-status-text/)
  assert.match(main, /aria-label="Undo the pitch change"/)
  assert.match(main, /Pitch changed to \$\{style\.label\}/)
  assert.match(main, /function undoPitchChange[\s\S]*?store\.undo\(\)/)
})

const deps = {
  migrateScene: (raw: any) => {
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.objects)) throw new Error('not a scene')
    return { version: 4, board: { w: 800, h: 618 }, pitch: raw.pitch ?? 'pitch', match: {}, objects: raw.objects } as any
  },
  pitchLabel: (pitch: string | undefined) => pitch === 'pitch-up' ? 'Vertical' : 'Pitch',
}
const scene = (pitch: string, ids: string[]) => ({ version: 4, pitch, objects: ids.map(id => ({ id, type: 'ball', x: 1, y: 2 })) })

test('legacy category snapshots become ordinary recovered boards', () => {
  const plan = planCategorySnapshotRecovery({ vertical: scene('pitch-up', ['a']), pitch: scene('pitch', ['b']) }, deps)
  assert.equal(plan.valid, true)
  assert.deepEqual(Object.keys(plan.boards).sort(), ['Recovered Pitch board', 'Recovered Vertical board'])
  assert.equal(plan.boards['Recovered Vertical board'].scene.objects[0].id, 'a')
})

test('matching icons on different pitches remain separate work', () => {
  const plan = planCategorySnapshotRecovery({
    pitch: scene('pitch', ['same']),
    vertical: scene('pitch-up', ['same']),
  }, deps)
  assert.equal(Object.keys(plan.boards).length, 2)
})

test('recovery rejects malformed roots, skips bad scenes and stays bounded', () => {
  for (const raw of [null, undefined, 'bad', 42, []]) {
    const plan = planCategorySnapshotRecovery(raw, deps)
    assert.equal(plan.valid, false)
    assert.deepEqual(plan.boards, {})
  }
  const raw: Record<string, unknown> = { bad: { objects: 'no' }, empty: scene('pitch', []) }
  for (let i = 0; i < 100; i++) raw[`pitch-${i}`] = scene('pitch', [`o${i}`])
  assert.equal(Object.keys(planCategorySnapshotRecovery(raw, deps).boards).length, 10)
})

test('legacy storage is removed only after saved-board import succeeds', () => {
  const recovery = main.slice(main.indexOf('function recoverCategorySnapshots'), main.indexOf('/** A pitch choice'))
  assert.match(recovery, /saves\.importFile[\s\S]*?localStorage\.setItem\(doneKey, '1'\)[\s\S]*?localStorage\.removeItem\(key\)/)
  assert.match(recovery, /catch \{ \/\* keep the legacy snapshots so recovery can retry \*\/ \}/)
})
