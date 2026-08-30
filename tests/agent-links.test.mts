import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const saves = await readFile(new URL('../src/saves.ts', import.meta.url), 'utf8')
const main = await readFile(new URL('../src/main.ts', import.meta.url), 'utf8')
const instructions = await readFile(new URL('../public/agent/v1.md', import.meta.url), 'utf8')
const sceneSchema = JSON.parse(await readFile(new URL('../public/agent/v1.scene.schema.json', import.meta.url), 'utf8'))
const projectSchema = JSON.parse(await readFile(new URL('../public/agent/v1.project.schema.json', import.meta.url), 'utf8'))
const entitlements = await readFile(new URL('../src/entitlements.ts', import.meta.url), 'utf8')

test('agent-link controls are Pro-only and limited to editable saved rows', () => {
  // the two may share one import statement; what matters is that both are read
  // from entitlements rather than re-derived
  assert.match(saves, /import \{[^}]*\bhasPaidBoardAccess\b[^}]*\} from '\.\/entitlements'/)
  assert.match(saves, /import \{[^}]*\bcanCreateAgentLink\b[^}]*\} from '\.\/entitlements'/)
  assert.match(saves, /!locked && canCreateAgentLink\(\) && (all\[n\]|project)\.id/)
  assert.match(saves, /data-sv="agent-link"/)
  assert.match(saves, />Copy agent link<\/button>/)
  assert.match(saves, /k === 'agent-link'.*createAgentLink/s)
  assert.match(entitlements, /return _serverPro && location\.hostname === 'board\.tacticsjournal\.com'/)
})

test('person and agent sharing sync the saved board before issuing requests', () => {
  assert.match(saves, /onPrepareShare: \(boardId: string\) => Promise<string>/)
  assert.match(saves, /onCreateAgentLink: \(boardId: string, mode: AgentAccessMode\) => Promise<string>/)

  const request = saves.match(/const request = async[\s\S]*?const roleLabel/)?.[0] ?? ''
  assert.match(request, /await prepareShare\(\)/)
  assert.ok(request.indexOf('await prepareShare()') < request.indexOf('fetch('))
  assert.match(saves, /preparingShare = this\.onPrepareShare\(shareId\)/)
  assert.match(saves, /\.finally\(\(\) => \{ preparingShare = null \}\)/)

  const prepare = main.match(/async function prepareSavedBoardsForSharing[\s\S]*?\n}/)?.[0] ?? ''
  assert.match(prepare, /const requestedGeneration = syncGeneration/)
  assert.match(prepare, /const requestedBinding = accountBinding/)
  assert.match(prepare, /documentChangeGeneration/)
  assert.match(prepare, /serializeProjectSync/)
  assert.match(prepare, /runTargetedSyncPass\(currentId, requestedGeneration, requestedBinding\)/)
  assert.match(prepare, /result\.reason === 'board_not_accessible'/)
  assert.match(prepare, /let reidentified = false/)
  assert.match(prepare, /saves\.reidentifySavedBoard\(currentId\)/)
  assert.match(prepare, /return currentId/)
  assert.match(main, /if \(requestedGeneration !== syncGeneration \|\| requestedBinding !== accountBinding\)/)
  assert.match(main, /targetId: boardId/)
  assert.match(main, /advanceMarkers: false/)
  assert.match(main, /shareTarget: true/)
  assert.match(main, /stillCurrent: \(\) => requestedGeneration === syncGeneration && requestedBinding === accountBinding/)
  assert.match(main, /saves\.onPrepareShare = \(boardId: string\) => prepareSavedBoardsForSharing\(boardId\)/)

  const callback = main.match(/saves\.onCreateAgentLink = async[\s\S]*?return data\.url\n}/)?.[0] ?? ''
  assert.match(callback, /await prepareSavedBoardsForSharing\(boardId\)/)
  assert.match(callback, /await flushSkillsForAgentLink\(finalBoardId\)/)
  assert.match(callback, /boardAgentLinksUrl\(\)/)
  assert.match(callback, /credentials: 'include'/)
  assert.match(callback, /JSON\.stringify\(\{ board_id: finalBoardId, access_mode: mode \}\)/)
  assert.ok(callback.indexOf('await prepareSavedBoardsForSharing()') < callback.indexOf('fetch('))
})

test('agent-link instructions contain the scoped credential and concurrency rules', () => {
  for (const phrase of [
    '#access=',
    'https://board.tacticsjournal.com/mcp',
    '`read_board`',
    '`replace_board`',
    'Never echo the token',
    'GET https://board.tacticsjournal.com/api/board/agent',
    'Authorization: Bearer <token>',
    'project_skills',
    'skills_revision',
    'owner-approved instruction',
    'untrusted data',
    'sequence',
    'Markdown notes',
    'views',
    'timings',
    'stable `id`',
    'Preserve unknown fields',
    'PUT https://board.tacticsjournal.com/api/board/agent',
    'If-Match',
    '409 Conflict',
    'cannot list other boards',
    'delete or',
    'share this board',
    'account or billing',
  ]) assert.match(instructions, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  assert.match(instructions, /GET https:\/\/board\.tacticsjournal\.com\/api\/board\/agent\n[ \t]*Authorization: Bearer <token>\n[ \t]*User-Agent: TacticsBoardAgent\/1\.0/)
  assert.match(instructions, /PUT https:\/\/board\.tacticsjournal\.com\/api\/board\/agent\n[ \t]*Authorization: Bearer <token>\n[ \t]*User-Agent: TacticsBoardAgent\/1\.0/)
  assert.doesNotMatch(instructions, /access=[^<\s`]+/) // no example token in the document
})

test('agent instructions publish the complete scene and ordered-project schemas', () => {
  assert.match(instructions, /https:\/\/board\.tacticsjournal\.com\/agent\/v1\.scene\.schema\.json/)
  assert.match(instructions, /https:\/\/board\.tacticsjournal\.com\/agent\/v1\.project\.schema\.json/)
  assert.match(instructions, /same object `id` in consecutive scenes/)
  assert.match(instructions, /complete existing scene in the first board without changing it/)
  assert.equal(projectSchema.$schema, 'https://json-schema.org/draft/2020-12/schema')
  assert.equal(projectSchema.$id, 'https://board.tacticsjournal.com/agent/v1.project.schema.json')
  assert.deepEqual(projectSchema.required, ['id', 'name', 'boards', 'updated'])
  assert.deepEqual(projectSchema.$defs.board.required, ['id', 'title', 'view', 'scene', 'note', 'link'])
  assert.equal(projectSchema.$defs.board.properties.scene.$ref, 'https://board.tacticsjournal.com/agent/v1.scene.schema.json')
  assert.deepEqual(projectSchema.$defs.link.properties.ease.enum, ['in-out', 'linear', 'out'])
  assert.equal(projectSchema.additionalProperties, true)
  assert.match(instructions, /Repository access is not required\./)
  assert.match(instructions, /Third-man run: A passes to B, B sets C/)
  assert.match(instructions, /point the curve passes through/)
  assert.match(instructions, /fields or object types from a newer producer\. Preserve/)
  for (const [pitch, height] of [['pitch', 618], ['pitch-up', 640], ['training', 418], ['sidebyside', 533]]) {
    assert.match(instructions, new RegExp(`${pitch}\\s+height ${height}`))
  }
  assert.match(instructions, /live\s+height supplied by the scene, from 100 to 4000/)
  assert.match(instructions, /agent API cannot upload image bytes or create a\ncustom asset/)
  assert.match(instructions, /movement toward that goal goes up, toward decreasing\n`y`/)
  assert.match(instructions, /open\/front side faces down, toward increasing `y`, at\n`0`; left at `90`; up at `180`; and right at `270`/)
  assert.match(instructions, /custom asset's tactical front/)
  assert.match(instructions, /direction runs from `x1,y1` to `x2,y2`/)
  assert.match(instructions, /dotted arrows\nmean ball movement, dashed arrows mean defensive movement, and solid arrows mean\noffensive movement/)
  assert.match(instructions, /user may configure a different legend through their agent/)
  assert.match(instructions, /zones and arrows always stay behind players and\nother assets/)

  assert.equal(sceneSchema.$schema, 'https://json-schema.org/draft/2020-12/schema')
  assert.equal(sceneSchema.$id, 'https://board.tacticsjournal.com/agent/v1.scene.schema.json')
  assert.equal(sceneSchema.properties.version.const, 4)
  assert.equal(sceneSchema.properties.board.properties.w.const, 800)
  assert.equal(sceneSchema.additionalProperties, true)
  assert.deepEqual(sceneSchema['x-tacticsjournal'].arrowDashSemantics, {
    dotted: 'ball movement', dashed: 'defensive movement', solid: 'offensive movement',
  })
  assert.equal(sceneSchema['x-tacticsjournal'].arrowDashSemanticsAreDefaults, true)
  assert.equal(sceneSchema['x-tacticsjournal'].arrowDashSemanticsMayBeOverriddenByUser, true)
  assert.deepEqual(sceneSchema['x-tacticsjournal'].rotationSemantics.nativeTopByRotation, {
    0: 'up (-y)', 90: 'right (+x)', 180: 'down (+y)', 270: 'left (-x)',
  })
  assert.equal(sceneSchema['x-tacticsjournal'].assetFacingAtZero.goal, 'front/open side faces down (+y)')
  assert.equal(sceneSchema['x-tacticsjournal'].assetFacingAtZero.image, 'native image top points up (-y); semantic forward is not encoded')
  assert.deepEqual(sceneSchema['x-tacticsjournal'].goalFrontByRotationWithoutFlips, {
    0: 'down (+y)', 90: 'left (-x)', 180: 'up (-y)', 270: 'right (+x)',
  })
  assert.deepEqual(sceneSchema['x-tacticsjournal'].drawOrder, ['box', 'arrow', 'goal', 'marker', 'cone', 'image', 'player', 'ball', 'text'])
  assert.equal(sceneSchema.properties.arrowLegend.$ref, '#/$defs/arrowLegend')
  assert.deepEqual(Object.keys(sceneSchema.$defs.arrowLegend.properties), ['solid', 'dashed', 'dotted'])
  assert.equal(sceneSchema.$defs.arrowLegend.additionalProperties, false)
  assert.match(instructions, /Record overrides in the scene's optional `arrowLegend` object/)
  assert.match(instructions, /Omitted keys retain their default meanings/)
  assert.match(sceneSchema.properties.objects.description, /Zones \(box\) and arrows always render behind players/)
  assert.match(sceneSchema.$defs.arrow.properties.dash.description, /dotted is ball movement, dashed is defensive movement, and solid is offensive movement/)
  assert.match(sceneSchema.$defs.goal.properties.rotation.description, /front\/open side faces down \(\+y\) at 0, left \(-x\) at 90/)
  assert.match(sceneSchema.$defs.image.properties.rotation.description, /does not encode which part of a custom image means forward/)
  assert.match(sceneSchema.$defs.cone.properties.rotation.description, /narrow tip points up \(-y\)/)
  const pitchHeights = Object.fromEntries(sceneSchema.allOf.map((rule: any) => [
    rule.if.properties.pitch.const,
    rule.then.properties.board.properties.h.const,
  ]))
  assert.deepEqual(pitchHeights, { pitch: 618, 'pitch-up': 640, training: 418, sidebyside: 533, classic: 418 })

  const objectTypes = ['player', 'ball', 'cone', 'goal', 'image', 'marker', 'arrow', 'box', 'text']
  assert.deepEqual(
    sceneSchema.properties.objects.items.oneOf.map((entry: { $ref: string }) => entry.$ref.replace('#/$defs/', '')),
    objectTypes,
  )
  for (const type of objectTypes) {
    assert.equal(sceneSchema.$defs[type].properties.type.const, type)
    assert.ok(sceneSchema.$defs[type].required.includes('id'))
    assert.equal(sceneSchema.$defs[type].additionalProperties, true)
  }

  const exampleBlock = instructions.match(/```json\n([\s\S]*?)\n```/)?.[1]
  assert.ok(exampleBlock)
  const example = JSON.parse(exampleBlock)
  assert.equal(example.pitch, 'training')
  assert.equal(example.board.h, pitchHeights.training)
  for (const arrow of example.objects.filter((object: any) => object.type === 'arrow' && !object.curved)) {
    assert.equal(arrow.mx, (arrow.x1 + arrow.x2) / 2)
    assert.equal(arrow.my, (arrow.y1 + arrow.y2) / 2)
  }
  assert.ok(example.objects.filter((object: any) => object.id.startsWith('run_pass_')).every((object: any) => object.dash === 'dotted'))
  assert.equal(example.objects.find((object: any) => object.id === 'run_move_3').dash, 'solid')
})
