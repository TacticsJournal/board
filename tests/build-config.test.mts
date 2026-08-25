import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { discoverExtensionPaths, extensionWrapper, isSelfHostedBuild, readExtensionSource } from '../build-config.ts'

test('self-host mode requires BOARD_SELF_HOSTED=true exactly', () => {
  assert.equal(isSelfHostedBuild('true'), true)
  for (const value of [undefined, '', 'TRUE', '1', 'false']) assert.equal(isSelfHostedBuild(value), false)
})

test('extension discovery accepts only safe directories with an in-root index.html', () => {
  const root = mkdtempSync(join(tmpdir(), 'board-extensions-'))
  const outside = mkdtempSync(join(tmpdir(), 'board-outside-'))
  try {
    mkdirSync(join(root, 'formation-generator'))
    writeFileSync(join(root, 'formation-generator', 'index.html'), '<!doctype html>')
    mkdirSync(join(root, 'Bad Name'))
    writeFileSync(join(root, 'Bad Name', 'index.html'), 'ignored')
    mkdirSync(join(root, 'only-html'))
    writeFileSync(join(root, 'only-html', 'other.html'), 'ignored')
    mkdirSync(join(outside, 'escape'))
    writeFileSync(join(outside, 'escape', 'index.html'), 'ignored')
    symlinkSync(join(outside, 'escape'), join(root, 'escape'))
    mkdirSync(join(root, 'inside-target'))
    writeFileSync(join(root, 'inside-target', 'index.html'), 'accepted')
    symlinkSync(join(root, 'inside-target'), join(root, 'inside-link'))

    assert.deepEqual(discoverExtensionPaths(root), [
      '/extensions/formation-generator/index.html',
      '/extensions/inside-link/index.html',
      '/extensions/inside-target/index.html',
    ])
    assert.equal(readExtensionSource('/extensions/formation-generator/index.html', root), '<!doctype html>')
    assert.equal(readExtensionSource('/extensions/escape/index.html', root), null)
    assert.equal(readExtensionSource('https://evil.example/index.html', root), null)
  } finally {
    rmSync(root, { recursive: true, force: true })
    rmSync(outside, { recursive: true, force: true })
  }
})

test('the generated wrapper never executes extension source at its own origin', () => {
  const wrapper = extensionWrapper('<button>Run</button><script>top.postMessage("ready", "*")</script>')
  assert.match(wrapper, /<iframe[^>]+sandbox="allow-scripts"/)
  assert.match(wrapper, /srcdoc="[^"]*&lt;script&gt;/)
  assert.doesNotMatch(wrapper, /<script>/)
  assert.match(wrapper, /connect-src 'none'/)
})
