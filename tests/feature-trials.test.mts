import assert from 'node:assert/strict'
import test, { afterEach, beforeEach } from 'node:test'

import { createFeatureTrials, type FeatureTrialStorage, type TrialFeature } from '../src/feature-trials.ts'
import { resetServerEntitlement, setServerEntitlement } from '../src/entitlements.ts'

class MemoryStorage implements FeatureTrialStorage {
  private values = new Map<string, string>()

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }

  has(feature: TrialFeature): boolean {
    return this.values.has(`tbm:trial:v1:${feature}`)
  }
}

beforeEach(() => resetServerEntitlement())
afterEach(() => resetServerEntitlement())

test('a fresh Free user is eligible for both trials', async () => {
  const storage = new MemoryStorage()
  const trials = createFeatureTrials(storage)
  assert.equal(await trials.canTry('screenshot_import'), true)
  assert.equal(await trials.canTry('gif_export'), true)
})

test('checking eligibility does not consume a trial', async () => {
  const storage = new MemoryStorage()
  const trials = createFeatureTrials(storage)
  await trials.canTry('screenshot_import')
  assert.equal(storage.has('screenshot_import'), false)
})

test('consuming a trial marks it used and blocks later use', async () => {
  const storage = new MemoryStorage()
  const trials = createFeatureTrials(storage)
  assert.equal(await trials.consume('screenshot_import'), true)
  assert.equal(storage.has('screenshot_import'), true)
  assert.equal(await trials.canTry('screenshot_import'), false)
  assert.equal(await trials.consume('screenshot_import'), false)
})

test('each trial is independent', async () => {
  const storage = new MemoryStorage()
  const trials = createFeatureTrials(storage)
  assert.equal(await trials.consume('screenshot_import'), true)
  assert.equal(await trials.canTry('gif_export'), true)
  assert.equal(await trials.consume('gif_export'), true)
  assert.equal(await trials.canTry('screenshot_import'), false)
})

test('server Pro bypasses trials without touching storage', async () => {
  setServerEntitlement(true)
  const storage = new MemoryStorage()
  const trials = createFeatureTrials(storage)
  assert.equal(await trials.canTry('screenshot_import'), false)
  assert.equal(await trials.consume('screenshot_import'), true)
  assert.equal(storage.has('screenshot_import'), false)
})

test('a Board license bypasses trials without touching storage', async () => {
  setServerEntitlement(false, true)
  const storage = new MemoryStorage()
  const trials = createFeatureTrials(storage)
  assert.equal(await trials.canTry('gif_export'), false)
  assert.equal(await trials.consume('gif_export'), true)
  assert.equal(storage.has('gif_export'), false)
})

test('a storage read failure fails closed for Free', async () => {
  const storage: FeatureTrialStorage = {
    getItem: () => { throw new Error('read error') },
    setItem: () => {},
  }
  const trials = createFeatureTrials(storage)
  assert.equal(await trials.canTry('screenshot_import'), false)
  assert.equal(await trials.consume('screenshot_import'), false)
  assert.equal(await trials.used('screenshot_import'), true)
})

test('a storage write failure fails closed for Free', async () => {
  const storage: FeatureTrialStorage = {
    getItem: () => null,
    setItem: () => { throw new Error('write error') },
  }
  const trials = createFeatureTrials(storage)
  assert.equal(await trials.canTry('screenshot_import'), true)
  assert.equal(await trials.consume('screenshot_import'), false)
})

test('a used value other than "used" is treated as consumed', async () => {
  const storage = new MemoryStorage()
  storage.setItem('tbm:trial:v1:gif_export', 'yes')
  const trials = createFeatureTrials(storage)
  assert.equal(await trials.canTry('gif_export'), false)
})
