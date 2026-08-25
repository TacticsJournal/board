import assert from 'node:assert/strict'
import test from 'node:test'

import {
  isAutomaticProEnvironment,
  setServerEntitlement,
  hasServerEntitlement,
  hasBoardAdminAccess,
  resetServerEntitlement,
  resolvePaidBoardAccess,
  canPickPitch,
} from '../src/entitlements.ts'

test('self-host builds unlock local paid board features without granting account capabilities', () => {
  assert.equal(resolvePaidBoardAccess(true, false, false), true)
  assert.equal(resolvePaidBoardAccess(false, false, false), false)
  assert.equal(resolvePaidBoardAccess(false, true, false), true)
  assert.equal(resolvePaidBoardAccess(false, false, true), true)
})

test('production stays free regardless of browser-controlled unlock-like inputs', () => {
  const production = {
    development: false,
    hostname: 'board.tacticsjournal.com',
  }
  const attempts = [
    production,
    { ...production, search: '?pro=dev' },
    { ...production, query: { pro: 'dev' } },
    { ...production, localStorage: { pro: 'dev' } },
    { ...production, cachedEntitlement: { pro: true } },
    { ...production, pro: true },
  ]

  for (const attempt of attempts) {
    assert.equal(isAutomaticProEnvironment(attempt), false)
  }
})

test('development builds and Cloudflare Pages previews unlock Pro', () => {
  assert.equal(isAutomaticProEnvironment({ development: true, hostname: 'board.tacticsjournal.com' }), true)

  for (const hostname of [
    'a1b2c3d4.tactics-board-mapper.pages.dev',
    'feature-hardening.tactics-board-mapper.pages.dev',
  ]) {
    assert.equal(
      isAutomaticProEnvironment({ development: false, hostname }),
      true,
      `${hostname} should be recognized`,
    )
  }
})

test('preview lookalikes and production-build localhost stay free', () => {
  for (const hostname of [
    'localhost',
    '127.0.0.1',
    'board.tacticsjournal.com',
    'tactics-board-mapper.pages.dev',
    'tactics-board-mapper.vercel.app',
    'tactics-board-mapper-a1b2c3-kyleboas.vercel.app',
    'tactics-board-mapper-git-feature-hardening-kyleboas.vercel.app',
    'tactics-board-mapper.pages.dev.example.com',
    'eviltactics-board-mapper.pages.dev',
    'nested.preview.tactics-board-mapper.pages.dev',
    'preview.tactics-board-mapper.pages.dev?pro=dev',
    'preview.tactics-board-mapper.pages.dev.example.com?pro=dev',
    '-preview.tactics-board-mapper.pages.dev',
    'preview-.tactics-board-mapper.pages.dev',
    'PREVIEW.tactics-board-mapper.pages.dev',
    'tactics-board-mapper-preview.pages.dev',
    'tactics-board-mapper.vercel.app.example.com',
    'evil-tactics-board-mapper.vercel.app',
    'tactics-board-mapperx.vercel.app',
    'other-project.vercel.app',
  ]) {
    assert.equal(
      isAutomaticProEnvironment({ development: false, hostname }),
      false,
      `${hostname} should not be recognized`,
    )
  }
})

test('resolution is deterministic and does not mutate its input', () => {
  const environment = Object.freeze({
    development: false,
    hostname: 'board.tacticsjournal.com',
  })

  const results = Array.from({ length: 20 }, () => isAutomaticProEnvironment(environment))
  assert.deepEqual(results, Array(20).fill(false))
  assert.deepEqual(environment, {
    development: false,
    hostname: 'board.tacticsjournal.com',
  })
})

// Server-derived entitlement tests

test('server entitlement starts fail-closed', () => {
  resetServerEntitlement()
  assert.equal(hasServerEntitlement(), false)
})

test('setServerEntitlement(true) grants server Pro', () => {
  resetServerEntitlement()
  setServerEntitlement(true)
  assert.equal(hasServerEntitlement(), true)
})

test('setServerEntitlement(false) revokes server Pro', () => {
  resetServerEntitlement()
  setServerEntitlement(true)
  assert.equal(hasServerEntitlement(), true)
  setServerEntitlement(false)
  assert.equal(hasServerEntitlement(), false)
})

test('setServerEntitlement coerces non-boolean to false', () => {
  resetServerEntitlement()
  // @ts-expect-error testing invalid input
  setServerEntitlement('pro')
  assert.equal(hasServerEntitlement(), false)
  // @ts-expect-error testing invalid input
  setServerEntitlement(1)
  assert.equal(hasServerEntitlement(), false)
  // @ts-expect-error testing invalid input
  setServerEntitlement(undefined)
  assert.equal(hasServerEntitlement(), false)
  // @ts-expect-error testing invalid input
  setServerEntitlement(null)
  assert.equal(hasServerEntitlement(), false)
})

test('resetServerEntitlement returns to fail-closed', () => {
  setServerEntitlement(true)
  assert.equal(hasServerEntitlement(), true)
  resetServerEntitlement()
  assert.equal(hasServerEntitlement(), false)
})

test('only the server board_admin flag can unlock the Classic pitch', () => {
  const classic = {
    id: 'classic', label: 'Classic', src: '/pitch.jpeg', boardH: 418,
    category: 'classic', pro: true, adminOnly: true,
  }

  resetServerEntitlement()
  setServerEntitlement(true)
  assert.equal(hasBoardAdminAccess(), false)
  assert.equal(canPickPitch(classic), false, 'Pro alone must not unlock Classic')

  setServerEntitlement(true, false, true)
  assert.equal(hasBoardAdminAccess(), true)
  assert.equal(canPickPitch(classic), true)

  setServerEntitlement(true, false, false)
  assert.equal(hasBoardAdminAccess(), false)
  assert.equal(canPickPitch(classic), false)

  resetServerEntitlement()
  assert.equal(hasBoardAdminAccess(), false)
  assert.equal(canPickPitch(classic), false)
})

test('automatic environment takes priority even without server entitlement', () => {
  resetServerEntitlement()
  assert.equal(
    isAutomaticProEnvironment({ development: true, hostname: 'board.tacticsjournal.com' }),
    true,
    'dev mode grants Pro regardless of server state',
  )
})

test('server entitlement is independent of automatic environment', () => {
  resetServerEntitlement()
  // Production without server = free
  assert.equal(isAutomaticProEnvironment({ development: false, hostname: 'board.tacticsjournal.com' }), false)
  assert.equal(hasServerEntitlement(), false)

  // Server grants Pro
  setServerEntitlement(true)
  assert.equal(hasServerEntitlement(), true)

  // Automatic environment is still false for production
  assert.equal(isAutomaticProEnvironment({ development: false, hostname: 'board.tacticsjournal.com' }), false)

  // But server entitlement independently makes isPro() true via hasServerEntitlement()
  assert.equal(hasServerEntitlement(), true)

  resetServerEntitlement()
})
