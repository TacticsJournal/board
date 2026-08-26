import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { boardSkillsUrl } from '../src/board-api.ts'
import { upstreamRequest } from '../functions/api/board/[[path]].js'
import { EXTENSION_PROTOCOL, allowedExtensionUrl, extensionObjects, manifestsMatch, parseExtensionMessage } from '../src/extension-runtime.ts'
import { MAX_EXTENSIONS, MAX_SKILLS, addUserSkill, installExtension, mergeSyncedSkills, newUserSkill, normalizeProjectSkillsState, skillsForSync, validateExtensionPath } from '../src/skills-extensions.ts'

const now = '2026-01-01T00:00:00.000Z'
const paths = ['/extensions/formation-generator/index.html']

test('skills stay valid while hosted mode drops extensions and bundled skills', () => {
  const skill = { id: 'skill_1', name: 'Defensive runs', instructions: 'Use dashed arrows.', enabled: true, source: 'user', createdAt: now, updatedAt: now }
  const bundled = { id: 'skill_2', name: 'Old bundled', instructions: 'Ignore this.', enabled: true, source: 'extension', extensionId: 'extension_1', createdAt: now, updatedAt: now }
  const extension = { id: 'extension_1', path: paths[0], name: 'Shapes', description: 'Adds shapes.', version: '1.0.0', enabled: true, permissions: ['board:read'], installedAt: now }
  const state = normalizeProjectSkillsState({
    revision: 'r1', dirty: true,
    skills: [skill, bundled, ...Array.from({ length: MAX_SKILLS }, (_, index) => ({ ...skill, id: `skill_${index + 3}` }))],
    extensions: [extension, ...Array.from({ length: MAX_EXTENSIONS }, (_, index) => ({ ...extension, id: `extension_${index + 2}` }))],
  }, now, paths, false)
  assert.equal(state.skills.length, MAX_SKILLS)
  assert.equal(state.skills.some(item => item.name === 'Old bundled'), false)
  assert.deepEqual(state.extensions, [])
})

test('self-host extensions use the compiled path allowlist only', () => {
  assert.equal(validateExtensionPath(paths[0], paths), paths[0])
  for (const value of ['https://extensions.example/demo', '/extensions/other/index.html', '/extensions/formation-generator/index.html#x']) {
    assert.equal(validateExtensionPath(value, paths), null)
  }
  const state = normalizeProjectSkillsState(null, now, paths, true)
  const installed = installExtension(state, { path: paths[0], name: 'Formation', description: 'Makes a formation.', version: '1', permissions: ['board:write'] }, now, paths, true)
  assert.equal(installed?.extensions[0].path, paths[0])
  assert.equal(installed?.skills.length, 0)
  assert.equal(installExtension(state, { path: 'https://example.test/ext.html', name: 'Bad', description: 'Bad.', version: '1', permissions: [] }, now, paths, true), null)
  assert.equal(installExtension(state, { path: paths[0], name: 'No host', description: 'Bad.', version: '1', permissions: [] }, now, paths, false), null)
})

test('same-origin frame URLs must come from the compiled allowlist', () => {
  assert.equal(allowedExtensionUrl(paths[0], paths, 'https://board.example'), 'https://board.example/extensions/formation-generator/index.html')
  for (const value of ['https://evil.example/ext.html', '//evil.example/ext.html', '/extensions/formation-generator/index.html?x=1', '/extensions/other/index.html']) {
    assert.equal(allowedExtensionUrl(value, paths, 'https://board.example'), null)
  }
})

test('skill sync uses the strict server shape', () => {
  const local = normalizeProjectSkillsState({ skills: [{ id: 'skill_1', name: 'Formation rules', instructions: 'Keep player ids.', enabled: false, createdAt: now, updatedAt: now }] }, now)
  assert.deepEqual(skillsForSync(local), [{ id: 'skill_1', name: 'Formation rules', instructions: 'Keep player ids.', enabled: false }])
  const merged = mergeSyncedSkills(local, [{ id: 'skill_1', name: 'Updated rules', instructions: 'Keep player ids.', enabled: true }], 'r2', now)
  assert.equal(merged?.skills[0].enabled, true)
  assert.equal(merged?.revision, 'r2')
  assert.equal(mergeSyncedSkills(local, [{ id: 'skill_1', name: 'Bad', instructions: '', enabled: true }], 'r3', now), null)
  assert.equal(addUserSkill({ ...local, skills: Array.from({ length: MAX_SKILLS }, () => newUserSkill()) }, newUserSkill()), null)
})

test('extension protocol requires the frame token, has no bundled skills, and grants only approved permissions', () => {
  const manifest = { name: 'Formation', description: 'Adds players.', version: '1', permissions: ['board:write'] as const }
  assert.equal(parseExtensionMessage({ protocol: EXTENSION_PROTOCOL, token: 'wrong', type: 'manifest', manifest }, 'right'), null)
  assert.deepEqual(parseExtensionMessage({ protocol: EXTENSION_PROTOCOL, token: 'right', type: 'manifest', manifest }, 'right'), { type: 'manifest', manifest })
  assert.equal(parseExtensionMessage({ protocol: EXTENSION_PROTOCOL, token: 'right', type: 'manifest', manifest: { ...manifest, bundledSkill: 'no' } }, 'right'), null)
  assert.equal(manifestsMatch(manifest, manifest), true)
  assert.equal(manifestsMatch({ ...manifest, version: '2' }, manifest), false)
  assert.equal(manifestsMatch({ ...manifest, permissions: [] }, manifest), false)
  assert.equal(extensionObjects([{ type: 'unknown' }]), null)
  assert.equal(extensionObjects([{ type: 'ball', x: 1, y: 2, size: 20 }])?.length, 1)
})

test('hosted mode keeps official and self-hosted extensions separate', () => {
  const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8')
  const runtime = readFileSync(new URL('../src/extension-runtime.ts', import.meta.url), 'utf8')
  assert.match(main, /<span class="setItemLabel">Skills and Extensions<\/span>/)
  assert.match(main, /<h3 class="skillsHeading">Official extensions<\/h3>/)
  assert.match(main, /data-official-list/)
  assert.match(main, /BOARD_SELF_HOSTED \? `<div class="skillsSection">/)
  assert.match(main, /skillsSectionUnavailable" aria-disabled="true"/)
  assert.match(main, /<span class="setItemValue">Self-hosted only<\/span>/)
  assert.doesNotMatch(main, /data-extension-url-form|validateExtensionUrl|Add an extension from a URL/)
  assert.match(main, /if \(!BOARD_SELF_HOSTED\) return/)
  assert.match(main, /BOARD_SELF_HOSTED \? `<div class="setGroupHead">Hosting<\/div>/)
  assert.match(main, /if \(sync && !BOARD_SELF_HOSTED\) void syncCurrentSkills/)
  assert.match(main, /if \(BOARD_SELF_HOSTED\) return \[/)
  assert.match(main, /if \(!BOARD_SELF_HOSTED\) startAgentImport/)
  assert.match(main, /approvedManifest/)
  assert.match(runtime, /iframe\[data-board-extension\]/)
  assert.match(runtime, /inner\.sandbox\.value !== 'allow-scripts'/)
  assert.match(runtime, /new MessageChannel\(\)/)
  assert.match(runtime, /\[this\.channel\.port2\]/)
  assert.doesNotMatch(runtime, /window\.addEventListener\('message'/)
  assert.match(runtime, /allowedExtensionUrl\(options\.url, options\.allowedPaths, location\.origin\)/)
  assert.equal(boardSkillsUrl(), '/api/board/skills')
  assert.equal(upstreamRequest(new Request('https://board.tacticsjournal.com/api/board/skills?board_id=board-1'), { path: 'skills' })?.url, 'https://tacticsjournal.com/api/board/skills?board_id=board-1')
})
