import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

test('the editor offers no account backup or sync', async () => {
  const main = await readFile(new URL('../src/main.ts', import.meta.url), 'utf8')
  assert.doesNotMatch(main, /free-backup|requestFreeBackup|Back up one project/)
  assert.doesNotMatch(main, /from '\.\/sync'/)
})
