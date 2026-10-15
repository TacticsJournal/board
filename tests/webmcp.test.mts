import assert from 'node:assert/strict'
import test from 'node:test'

import {
  WEBMCP_CONTENT_WARNING,
  registerWebMcp,
  type ModelContextTarget,
  type WebMcpAdapter,
} from '../src/webmcp.ts'
import { newProject } from '../src/projects.ts'
import { emptyScene } from '../src/types.ts'

function setup() {
  const project = newProject(emptyScene(), 'Plan')
  project.boards[0].id = 'board-a'
  let revision = 'r1'
  let editable = true
  let activeBoardId = 'board-a'
  let committed = 0
  const adapter: WebMcpAdapter = {
    snapshot: () => project,
    revision: () => revision,
    editable: () => editable,
    activeBoard: () => activeBoardId,
    blankScene: () => emptyScene(project.boards[0].scene.pitch),
    commit: (next, expected) => {
      assert.equal(expected, revision)
      if (!editable) throw new Error('read-only')
      project.name = next.name
      project.boards = next.boards
      project.updated = next.updated
      revision = `r${++committed + 1}`
    },
  }
  const registered: Record<string, any> = {}
  const target: ModelContextTarget = { registerTool: tool => { registered[tool.name] = tool } }
  assert.equal(registerWebMcp(adapter, target), true)
  return { project, adapter, target, registered, setRevision: (value: string) => { revision = value }, setEditable: (value: boolean) => { editable = value } }
}

test('read returns a detached project and marks content as untrusted', async () => {
  const { project, registered } = setup()
  const result = await registered.read_current_project.execute({})
  assert.equal(result.editable, true)
  assert.equal(result.activeBoardId, 'board-a')
  assert.equal(result.contentWarning, WEBMCP_CONTENT_WARNING)
  result.project.name = 'changed outside'
  assert.equal(project.name, 'Plan')
  assert.deepEqual(registered.read_current_project.annotations, { readOnlyHint: true, untrustedContentHint: true })
})

test('a valid batch renames, copies, updates, and adds an object', async () => {
  const { project, registered } = setup()
  const read = await registered.read_current_project.execute({})
  const result = await registered.edit_current_project.execute({
    revision: read.revision,
    edits: [
      { type: 'rename_project', name: '  Match plan  ' },
      { type: 'add_object', boardId: 'board-a', object: { id: 'runner_1', type: 'ball', x: 100, y: 120, size: 20 } },
      { type: 'update_object', boardId: 'board-a', objectId: 'runner_1', patch: { x: 140, size: 24 } },
      { type: 'add_board', copyFromBoardId: 'board-a' },
      { type: 'update_board', boardId: 'board-a', note: 'Press high', view: { x: 5, y: 6, w: 400, h: 200 }, link: { dur: 120, ease: 'linear' } },
    ],
  })
  assert.equal(result.activeBoardId, 'board-a')
  assert.equal(project.name, 'Match plan')
  assert.equal(project.boards.length, 2)
  assert.equal(project.boards[1].scene.objects[0]?.id, 'runner_1')
  assert.equal(project.boards[1].scene.objects[0]?.x, 140)
  assert.equal(project.boards[0].note, 'Press high')
  assert.deepEqual(project.boards[0].view, { x: 5, y: 6, w: 400, h: 200 })
  assert.deepEqual(project.boards[0].link, { dur: 120, ease: 'linear' })
  assert.equal(project.boards[0].scene.objects.find(object => object.id === 'runner_1')?.x, 140)
  assert.equal(result.results[3].boardId, project.boards[1].id)
})

test('stale, read-only, and invalid batches leave the project untouched', async () => {
  const { project, registered, setRevision, setEditable } = setup()
  const read = await registered.read_current_project.execute({})
  const before = JSON.stringify(project)
  await assert.rejects(() => registered.edit_current_project.execute({ revision: 'old', edits: [{ type: 'rename_project', name: 'bad' }] }), /changed/)
  assert.equal(JSON.stringify(project), before)

  setRevision(read.revision)
  setEditable(false)
  await assert.rejects(() => registered.edit_current_project.execute({ revision: read.revision, edits: [{ type: 'rename_project', name: 'bad' }] }), /read-only/)
  assert.equal(JSON.stringify(project), before)

  setEditable(true)
  setRevision(read.revision)
  await assert.rejects(() => registered.edit_current_project.execute({
    revision: read.revision,
    edits: [
      { type: 'rename_project', name: 'would be rolled back' },
      { type: 'update_board', boardId: 'board-a', view: { x: 0, y: 0, w: 0, h: 100 } },
    ],
  }), /positive/)
  assert.equal(JSON.stringify(project), before)
})

test('object validation failures leave an earlier batch edit uncommitted', async () => {
  const { project, registered } = setup()
  project.boards[0].scene.objects.push({
    id: 'existing_ball', type: 'ball', x: 10, y: 20, size: 20,
  })
  const read = await registered.read_current_project.execute({})
  const before = JSON.stringify(project)

  await assert.rejects(() => registered.edit_current_project.execute({
    revision: read.revision,
    edits: [
      { type: 'rename_project', name: 'must not stick' },
      { type: 'add_object', boardId: 'board-a', object: { id: 'existing_ball', type: 'ball', x: 30, y: 40, size: 20 } },
    ],
  }), /already exists/)
  assert.equal(JSON.stringify(project), before)

  await assert.rejects(() => registered.edit_current_project.execute({
    revision: read.revision,
    edits: [
      { type: 'rename_project', name: 'must not stick either' },
      { type: 'update_object', boardId: 'board-a', objectId: 'existing_ball', patch: { id: 'replacement' } },
    ],
  }), /cannot change id or type/)
  assert.equal(JSON.stringify(project), before)

  await assert.rejects(() => registered.edit_current_project.execute({
    revision: read.revision,
    edits: [
      { type: 'rename_project', name: 'still must not stick' },
      { type: 'add_object', boardId: 'board-a', object: { id: 'incomplete_ball', type: 'ball' } },
    ],
  }), /missing required fields/)
  assert.equal(JSON.stringify(project), before)
})

test('registration is once per target and unsupported targets are harmless', () => {
  const { adapter, target } = setup()
  assert.equal(registerWebMcp(adapter, target), true)
  assert.equal(registerWebMcp(adapter, null), false)
})

test('registration handles an earlier rejected promise when a later call throws', async () => {
  const { adapter } = setup()
  let calls = 0
  let unhandled: unknown = null
  const onUnhandled = (reason: unknown) => { unhandled = reason }
  process.on('unhandledRejection', onUnhandled)
  try {
    const target: ModelContextTarget = {
      registerTool: () => {
        calls += 1
        if (calls === 1) return Promise.reject(new Error('first registration failed'))
        throw new Error('second registration failed')
      },
    }
    assert.equal(registerWebMcp(adapter, target), false)
    await new Promise<void>(resolve => setImmediate(resolve))
    assert.equal(unhandled, null)
  } finally {
    process.off('unhandledRejection', onUnhandled)
  }
})

test('default discovery uses Chrome navigator.modelContext', () => {
  const { adapter } = setup()
  const names: string[] = []
  const target: ModelContextTarget = { registerTool: tool => { names.push(tool.name) } }
  Object.defineProperty(globalThis.navigator, 'modelContext', { configurable: true, value: target })
  try {
    assert.equal(registerWebMcp(adapter), true)
    assert.deepEqual(names.sort(), ['edit_current_project', 'read_current_project'])
  } finally {
    delete (globalThis.navigator as Navigator & { modelContext?: ModelContextTarget }).modelContext
  }
})
