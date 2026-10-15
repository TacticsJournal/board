import assert from 'node:assert/strict'
import test from 'node:test'

import { createIncrementalTaskQueue } from '../src/project-preview-scheduler.ts'

test('project preview work runs one task per scheduled frame', () => {
  const frames: Array<() => void> = []
  const queue = createIncrementalTaskQueue(run => {
    frames.push(run)
    return frames.length
  }, () => {})
  const done: string[] = []

  queue.enqueue([
    () => done.push('first'),
    () => done.push('second'),
  ])
  assert.deepEqual(done, [])

  frames.shift()!()
  assert.deepEqual(done, ['first'])
  assert.equal(frames.length, 1)

  frames.shift()!()
  assert.deepEqual(done, ['first', 'second'])
  assert.equal(frames.length, 0)
})

test('invalidating project preview work prevents stale tasks from running', () => {
  const frames: Array<() => void> = []
  const cancelled: number[] = []
  const queue = createIncrementalTaskQueue(run => {
    frames.push(run)
    return frames.length
  }, handle => cancelled.push(handle))
  const done: string[] = []

  queue.enqueue([() => done.push('old')])
  const oldFrame = frames[0]
  queue.enqueue([() => done.push('new')])
  oldFrame()

  assert.deepEqual(done, [])
  assert.deepEqual(cancelled, [1])
  frames[1]()
  assert.deepEqual(done, ['new'])
})
