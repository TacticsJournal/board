import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import {
  AgentImportError, agentImportFile, agentImportSource, boardImportReadyRows, createBoardImportUrl, createProjectImportUrl,
  createStoredProjectImportUrl, decodeAgentImport, fetchAgentImport, MAX_AGENT_IMPORT_PAYLOAD_CHARS,
  STORED_PROJECT_IMPORT_LIMITS,
} from '../src/agent-import.ts'
import { addBoard, newProject } from '../src/projects.ts'

function base64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url')
}

function deterministicBase64(size: number): string {
  let state = 0x12345678
  const bytes = new Uint8Array(size)
  for (let index = 0; index < size; index++) {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    bytes[index] = state >>> 24
  }
  return base64Url(bytes)
}

function patternedNote(lineCount: number): string {
  return Array.from({ length: lineCount }, (_, index) =>
    `Pattern ${String(index).padStart(4, '0')}: ${index % 997} ${'abcdefghij'[index % 10]}`,
  ).join('\n')
}

async function encoded(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(value))
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'))
  return base64Url(new Uint8Array(await new Response(stream).arrayBuffer()))
}

const scene = { version: 4, board: { w: 800, h: 418 }, pitch: 'training', objects: [] }
const draftId = 'abcdefghijklmnopqrstuvwx'

test('a generated draft decodes to one bounded import record', async () => {
  const payload = await encoded({ v: 1, draftId, name: 'Third-man run', document: scene })
  const draft = await decodeAgentImport(payload)
  assert.equal(draft.name, 'Third-man run')
  assert.equal(draft.boardCount, 1)
  assert.equal(draft.draftId, draftId)
  const transfer = JSON.parse(agentImportFile(draft, '2026-08-21T00:00:00.000Z'))
  assert.equal(transfer.boards['Third-man run'].importId, draftId)
  assert.deepEqual(transfer.boards['Third-man run'].scene.objects, [])
})

test('import locations accept short board queries and legacy fragments and nothing else', () => {
  assert.deepEqual(agentImportSource({ pathname: '/import', search: '', hash: '#draft=abc_123' } as Location), { kind: 'inline', value: 'abc_123' })
  assert.deepEqual(agentImportSource({ pathname: '/import', search: '', hash: `#project=${'a'.repeat(22)}` } as Location), { kind: 'stored', value: 'a'.repeat(22) })
  assert.deepEqual(agentImportSource({ pathname: '/import', search: '', hash: `#project-copy=${'c'.repeat(22)}` } as Location), { kind: 'stored-project-copy', value: 'c'.repeat(22) })
  assert.deepEqual(agentImportSource({ pathname: '/import', search: '', hash: '#project=inline_abc_123' } as Location), { kind: 'project-copy', value: 'inline_abc_123' })
  assert.equal(agentImportSource({ pathname: '/import', search: '', hash: '#project-copy=inline_abc_123' } as Location), null)
  assert.deepEqual(agentImportSource({ pathname: '/import', search: '', hash: '#board=abc_123' } as Location), { kind: 'board', value: 'abc_123' })
  assert.deepEqual(agentImportSource({ pathname: '/import', search: '', hash: `#board=${'b'.repeat(22)}` } as Location), { kind: 'stored-board', value: 'b'.repeat(22) })
  assert.deepEqual(agentImportSource({ pathname: '/import', search: `?board=${'b'.repeat(22)}`, hash: '' } as Location), { kind: 'stored-board', value: 'b'.repeat(22) })
  assert.equal(agentImportSource({ pathname: '/', search: '', hash: '#draft=abc_123' } as Location), null)
  assert.equal(agentImportSource({ pathname: '/import', search: '?board=short', hash: '' } as Location), null)
  assert.equal(agentImportSource({ pathname: '/import', search: `?board=${'b'.repeat(22)}&extra=1`, hash: '' } as Location), null)
  assert.equal(agentImportSource({ pathname: '/import', search: '', hash: '#draft=abc&extra=1' } as Location), null)
  assert.equal(agentImportSource({ pathname: '/import', search: '', hash: '#project=not.valid' } as Location), null)
  assert.equal(agentImportSource({ pathname: '/import', search: '', hash: '#draft=not.valid' } as Location), null)
})

test('a board link carries an immutable copy in its fragment without granting source access', async () => {
  const project = newProject(scene as never, 'Pressing trigger')
  project.boards[0].title = 'Jump to the full-back'
  const url = new URL(await createBoardImportUrl('Pressing trigger', project, 'https://board.tacticsjournal.com'))
  assert.equal(url.pathname, '/import')
  assert.equal(url.search, '')
  assert.match(url.hash, /^#board=[A-Za-z0-9_-]+$/)
  assert.ok(url.href.length < 4300)
  const source = agentImportSource({ pathname: url.pathname, search: url.search, hash: url.hash } as Location)
  assert.equal(source?.kind, 'board')
  const draft = await decodeAgentImport(source!.value)
  assert.equal(draft.name, 'Pressing trigger')
  assert.equal(draft.boardCount, 1)
  assert.ok('boards' in draft.document)
  assert.equal(draft.document.boards[0].title, 'Jump to the full-back')
})

test('a generated inline link can exceed the old payload cap and still round-trip', async () => {
  const project = newProject(scene as never, 'Large board')
  project.boards[0].note = patternedNote(700)
  const url = new URL(await createBoardImportUrl(project.name, project, 'https://board.tacticsjournal.com'))
  const source = agentImportSource({ pathname: url.pathname, search: url.search, hash: url.hash } as Location)
  assert.equal(source?.kind, 'board')
  assert.ok(source!.value.length > 4000)
  assert.ok(source!.value.length <= MAX_AGENT_IMPORT_PAYLOAD_CHARS)
  assert.ok(url.href.length < 8200)
  const draft = await decodeAgentImport(source!.value)
  assert.ok('boards' in draft.document)
  assert.equal(draft.document.boards[0].note, project.boards[0].note)
})

test('a project copy link preserves every board while remaining distinct from stored project links', async () => {
  const project = newProject(scene as never, 'Pressing patterns')
  project.boards[0].title = 'High press'
  project.boards[0].note = 'Lock play outside.'
  const second = addBoard(project, 0, true)
  second.title = 'Mid-block'
  second.note = 'Protect the centre.'
  second.link = { dur: 1800, ease: 'linear' }

  const url = new URL(await createProjectImportUrl(project.name, project, 'https://board.tacticsjournal.com'))
  assert.match(url.hash, /^#project=[A-Za-z0-9_-]+$/)
  const source = agentImportSource({ pathname: url.pathname, search: url.search, hash: url.hash } as Location)
  assert.equal(source?.kind, 'project-copy')
  const draft = await decodeAgentImport(source!.value)
  assert.equal(draft.boardCount, 2)
  assert.ok('boards' in draft.document)
  assert.deepEqual(draft.document.boards.map(board => board.title), ['High press', 'Mid-block'])
  assert.deepEqual(draft.document.boards.map(board => board.note), ['Lock play outside.', 'Protect the centre.'])
  assert.deepEqual(draft.document.boards[1].link, { dur: 1800, ease: 'linear' })

  await assert.rejects(
    () => createBoardImportUrl(project.name, project, 'https://board.tacticsjournal.com'),
    /board could not be linked/,
  )
})

test('a capped free user is led to an existing project instead of a failing new one', () => {
  assert.deepEqual(boardImportReadyRows('Pressing trigger', 3, false), [
    {
      label: 'Existing project', detail: 'Choose from 3 projects', action: 'existing', primary: true, chevron: true,
    },
    {
      label: 'New project', detail: 'Free keeps three projects. Take a licence for more', action: 'pro',
    },
  ])

  const available = boardImportReadyRows('Pressing trigger', 2, true)
  assert.equal(available[0].action, 'new-project')
  assert.equal(available[0].primary, true)
  assert.equal(available[1].action, 'existing')
  assert.equal(available[1].primary, false)
})

test('a board link rejects a payload too large for reliable URLs', async () => {
  const project = newProject(scene as never, 'Oversized board')
  project.boards[0].note = deterministicBase64(6000)
  await assert.rejects(
    () => createBoardImportUrl('Oversized board', project, 'https://board.tacticsjournal.com'),
    /too large for a reliable link/,
  )
})

test('large stored project imports use the paid bounds and exact POST shape', async () => {
  const project = newProject(scene as never, 'Stored project')
  project.boards[0].note = randomBytes(40 * 1024).toString('base64')
  await assert.rejects(
    () => createProjectImportUrl(project.name, project, 'https://board.tacticsjournal.com'),
    /too large for a reliable link/,
  )

  let request: Request | null = null
  const url = await createStoredProjectImportUrl(project.name, project, 'https://board.tacticsjournal.com', (async (input, init) => {
    request = input instanceof Request ? input : new Request(new URL(String(input), 'https://board.tacticsjournal.com'), init)
    return Response.json({ id: 'i'.repeat(22), expires_at: null }, { status: 201 })
  }) as typeof fetch)
  assert.equal(url, 'https://board.tacticsjournal.com/import#project-copy=' + 'i'.repeat(22))
  assert.equal(request!.method, 'POST')
  assert.equal(request!.headers.get('X-Tactics-Board-Link-Scope'), 'project-copy')
  assert.deepEqual(Object.keys(await request!.clone().json()), ['payload'])
  const storedPayload = (await request!.json() as { payload: string }).payload
  assert.ok(storedPayload.length <= STORED_PROJECT_IMPORT_LIMITS.maxPayloadChars)
  const decoded = await decodeAgentImport(storedPayload, STORED_PROJECT_IMPORT_LIMITS)
  assert.equal(decoded.name, 'Stored project')
  assert.equal(decoded.document.boards[0].note, project.boards[0].note)
  let repeatedPayload = ''
  project.updated += 1000
  await createStoredProjectImportUrl(project.name, project, 'https://board.tacticsjournal.com', (async (_input, init) => {
    repeatedPayload = (JSON.parse(String(init?.body)) as { payload: string }).payload
    return Response.json({ id: 'i'.repeat(22) })
  }) as typeof fetch)
  assert.equal(repeatedPayload, storedPayload)
  await assert.rejects(
    () => createStoredProjectImportUrl(project.name, project, 'https://board.tacticsjournal.com', async () => Response.json({ id: 'bad' })),
    /invalid/,
  )
})

test('stored imports fetch one bounded payload from the board endpoint', async () => {
  const id = 'a'.repeat(22)
  let requested = ''
  const payload = await fetchAgentImport(id, (async (input) => {
    requested = String(input)
    return Response.json({ payload: 'H4sIA_payload' })
  }) as typeof fetch)
  assert.equal(requested, `/api/board/import-drafts?id=${id}`)
  assert.equal(payload, 'H4sIA_payload')
  await assert.rejects(() => fetchAgentImport('short', (async () => Response.json({})) as typeof fetch), /invalid/)
  await assert.rejects(() => fetchAgentImport(id, (async () => Response.json({}, { status: 404 })) as typeof fetch), /expired or is invalid/)
  await assert.rejects(() => fetchAgentImport(id, (async () => Response.json({ payload: 'x', extra: true })) as typeof fetch), /invalid/)
})

test('malformed, extra-field, and expanding payloads fail closed', async () => {
  const large = await encoded({ v: 1, draftId, name: 'Stored', document: { ...scene, note: randomBytes(40 * 1024).toString('base64') } })
  await assert.rejects(() => decodeAgentImport(large), AgentImportError)
  const stored = await decodeAgentImport(large, STORED_PROJECT_IMPORT_LIMITS)
  assert.equal(stored.name, 'Stored')
  await assert.rejects(() => decodeAgentImport('not-gzip'), AgentImportError)
  await assert.rejects(() => decodeAgentImport('a'.repeat(MAX_AGENT_IMPORT_PAYLOAD_CHARS + 1)), /invalid/)
  await assert.rejects(() => encoded({ v: 1, draftId, name: 'Draft', document: scene, extra: true }).then(decodeAgentImport), /invalid/)
  const bomb = await encoded({ v: 1, draftId, name: 'Draft', document: { ...scene, note: 'x'.repeat(65 * 1024) } })
  assert.ok(bomb.length < MAX_AGENT_IMPORT_PAYLOAD_CHARS)
  await assert.rejects(() => decodeAgentImport(bomb), /too large/)
})

test('the import prompt preserves its fragment for browser handoff, then clears it on close', () => {
  const ui = readFileSync(new URL('../src/agent-import-ui.ts', import.meta.url), 'utf8')
  const saves = readFileSync(new URL('../src/saves.ts', import.meta.url), 'utf8')
  const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8')
  const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8')
  const destroy = ui.indexOf('function destroy()')
  assert.ok(destroy > 0)
  assert.doesNotMatch(ui.slice(0, destroy), /history\.replaceState/)
  assert.match(ui.slice(destroy), /history\.replaceState\(null, '', window\.location\.pathname\)/)
  assert.match(ui, /fetchAgentImport\(source\.value\)/)
  assert.match(ui, /options\.isPro\(\) \|\| detail\?\.site_access === 'pro'/)
  assert.match(ui, /Add to Projects/)
  assert.match(ui, /agentImportBoard/)
  assert.match(ui, /Add a copy to your boards/)
  assert.match(ui, /The original stays with whoever shared it\./)
  assert.match(ui, /boardImportReadyRows\(draft\.name, destinations\.length, options\.canCreateProject\(\)\)/)
  assert.match(ui, /const projectCopyLink = source\?\.kind === 'project-copy'/)
  assert.match(ui, /copyLink \? 'ready'/)
  assert.match(ui, /options\.canCreateProject\(\)[\s\S]*This shared project has not been added\.[\s\S]*Delete a project to make room/)
  assert.match(ui, /projectCopyLink \? options\.addProject\(draft\) : options\.addBoard\(draft, projectId\)/)
  assert.match(ui, /projectCopyLink && !\('boards' in value\.document\)/)
  assert.match(ui, /stored-project-copy/)
  assert.match(ui, /STORED_PROJECT_IMPORT_LIMITS/)
  assert.match(ui, /Add “\$\{draft\.name\}” to…/)
  assert.match(ui, /agentImportBack/)
  assert.match(ui, /agentImportChev/)
  assert.match(ui, /preview\.hidden = !!error \|\| picking/)
  assert.match(ui, /Keep browsing/)
  assert.doesNotMatch(ui, /'Add board'/)
  assert.match(ui, /Your current board stays open/)
  assert.match(ui, /Sign in to Tactics Journal/)
  assert.match(ui, /comes with Pro/)
  assert.match(ui, /options\.saves\.hasImport\(draft\.draftId\)/)
  assert.match(main, /createStoredProjectImportUrl/)
  assert.match(main, /isAgentImportTooLarge/)
  assert.match(main, /Large whole-project links require a License/)
  assert.match(saves, /saved\.importId === importId/)
  assert.match(styles, /\.agentImportDialog/)
  assert.match(styles, /\.agentImportPreview svg/)
  assert.match(styles, /--agent-preview-h:\s*clamp\(150px, 30dvh, 190px\)/)
  assert.equal(styles.match(/height: var\(--agent-preview-h\)/g)?.length, 1)
  assert.match(styles, /\.agentImportBoard \{[^}]*overflow: hidden/s)
  assert.match(styles, /\.agentImportBoard \.agentImportProjects \{[^}]*overflow-y: auto/s)
  assert.match(styles, /\.agentImportClose \{[^}]*width: 44px;[^}]*height: 44px/s)
  assert.match(styles, /\.agentImportRow \{[^}]*min-height: 56px/s)
  // cards sit in a single grid column that may shrink: without minmax(0, 1fr)
  // the nowrap detail line stretches the track and the card runs off the modal
  assert.match(styles, /\.agentImportRows \{[^}]*grid-template-columns: minmax\(0, 1fr\)/s)
  assert.match(styles, /\.agentImportProjects \{[^}]*grid-template-columns: minmax\(0, 1fr\)/s)
  assert.match(styles, /\.agentImportRow \{[^}]*min-width: 0/s)
  assert.match(styles, /\.agentImportBoard\[open\] \{[^}]*display: flex[^}]*flex-direction: column/s)
  assert.match(styles, /\.agentImportStep \{[^}]*overflow-y: auto/s)
})
