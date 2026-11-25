import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import * as entitlements from '../src/entitlements.ts'
import {
  canExportAnimation,
  canImport,
  canPickPitch,
  canPlaceCone,
  canUploadBackground,
  hasBoardAdminAccess,
  isTrustedBuildEnvironment,
} from '../src/entitlements.ts'
import { PITCHES } from '../src/pitches.ts'

test('every browser-local capability is free', () => {
  assert.equal(canImport(), true)
  assert.equal(canPlaceCone(), true)
  assert.equal(canUploadBackground(), true)
  assert.equal(canExportAnimation(), true)
  for (const pitch of PITCHES.filter(p => !p.adminOnly)) {
    assert.equal(canPickPitch(pitch), true, `${pitch.label} should be free`)
  }
})

test('there are no plans, purchases, trials, or server entitlements left to check', () => {
  const names = Object.keys(entitlements)
  for (const gone of ['isPro', 'hasPaidBoardAccess', 'hasBoardLicense', 'setServerEntitlement', 'hasServerEntitlement', 'resetServerEntitlement', 'proPlansVisible', 'isAutomaticProEnvironment']) {
    assert.equal(names.includes(gone), false, `${gone} should be gone`)
  }
  const source = readFileSync(new URL('../src/entitlements.ts', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
  assert.doesNotMatch(source, /fetch\(|localStorage|sessionStorage|document\.cookie/)
})

test('production and browser-controlled unlock-like inputs are never a trusted build', () => {
  const production = { development: false, hostname: 'board.tacticsjournal.com' }
  const attempts = [
    production,
    { ...production, search: '?pro=dev' },
    { ...production, query: { admin: '1' } },
    { ...production, localStorage: { admin: '1' } },
    { ...production, cachedEntitlement: { board_admin: true } },
  ]
  for (const attempt of attempts) assert.equal(isTrustedBuildEnvironment(attempt), false)
})

test('development builds and Cloudflare Pages previews are trusted builds', () => {
  assert.equal(isTrustedBuildEnvironment({ development: true, hostname: 'board.tacticsjournal.com' }), true)
  for (const hostname of ['a1b2c3d4.tactics-board-mapper.pages.dev', 'feature-hardening.tactics-board-mapper.pages.dev']) {
    assert.equal(isTrustedBuildEnvironment({ development: false, hostname }), true, hostname)
  }
})

test('preview lookalikes and production-build localhost are not trusted', () => {
  for (const hostname of [
    'localhost',
    '127.0.0.1',
    'board.tacticsjournal.com',
    'tactics-board-mapper.pages.dev',
    'tactics-board-mapper.pages.dev.example.com',
    'eviltactics-board-mapper.pages.dev',
    'nested.preview.tactics-board-mapper.pages.dev',
    'preview.tactics-board-mapper.pages.dev?pro=dev',
    '-preview.tactics-board-mapper.pages.dev',
    'preview-.tactics-board-mapper.pages.dev',
    'PREVIEW.tactics-board-mapper.pages.dev',
    'tactics-board-mapper-preview.pages.dev',
    'other-project.vercel.app',
  ]) {
    assert.equal(isTrustedBuildEnvironment({ development: false, hostname }), false, hostname)
  }
})

test('the Classic pitch stays admin-only, and outside a trusted build nobody is an admin', () => {
  const classic = PITCHES.find(p => p.id === 'classic')!
  assert.equal(classic.adminOnly, true)
  // Node has no Vite env and no location: an unknown context grants nothing.
  assert.equal(hasBoardAdminAccess(), false)
  assert.equal(canPickPitch(classic), false)
})
