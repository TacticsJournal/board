import { chromium } from 'playwright-core'
import { chromePath } from './lib/chrome.mjs'

/**
 * Node editing, driven the way a finger drives it. The geometry has unit tests;
 * what this covers is the part that only breaks in a browser — what stays on
 * screen while you are dragging, and where a tap actually lands.
 */
const baseUrl = new URL(process.env.BOARD_URL || 'http://localhost:4173/').href
const headless = process.env.HEADFUL === '1' ? false : true

const browser = await chromium.launch({ executablePath: chromePath, headless })
const ctx = await browser.newContext({ viewport: { width: 900, height: 800 } })
const page = await ctx.newPage()

const errors = []
const check = (ok, msg) => { if (!ok) errors.push(msg) }
page.on('pageerror', e => errors.push(`pageerror: ${e.message}`))

await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 45000 })
await page.waitForFunction(() => window.__tbm?.board && window.__tbm?.store, null, { timeout: 45000 })
await page.waitForTimeout(700)

/** A zone with one curved node, already in node editing with a node selected. */
async function freshZone() {
  return page.evaluate(() => {
    const { board, store } = window.__tbm
    store.apply(s => {
      s.objects = s.objects.filter(o => o.id !== 'verify-zone')
      s.objects.push({
        id: 'verify-zone', type: 'box', shape: 'rect', x: 300, y: 200, w: 200, h: 120, rotation: 0,
        fill: '#9ca3af', opacity: 0.45, label: '', labelPos: 'top',
        corners: [{ x: 200, y: 140 }, { x: 400, y: 140, c: 'round' }, { x: 400, y: 260 }, { x: 200, y: 260 }],
      })
    })
    store.select('verify-zone')
    board.enterNodeEdit('verify-zone')
    board.addNodeNear({ x: 300, y: 140 }, 400)
    return board.selectedNodeIndex()
  })
}

const ui = () => page.evaluate(() => {
  const { board } = window.__tbm
  return {
    squares: board.stage.find('.anchor').filter(n => /anchor-h[12]-/.test(n.name())).length,
    stems: board.stage.find('.anchor-stem').length,
    rounds: board.stage.find('.anchor').filter(n => /anchor-node-/.test(n.name())).length,
    index: board.selectedNodeIndex(),
  }
})

const toScreen = (p) => page.evaluate(({ x, y }) => {
  const st = window.__tbm.board.stage
  const box = st.container().getBoundingClientRect()
  const s = st.scaleX()
  return { x: box.left + st.x() + x * s, y: box.top + st.y() + y * s }
}, p)

const handlePoint = () => page.evaluate(() => {
  const h = window.__tbm.board.stage.find('.anchor').find(n => /anchor-h[12]-/.test(n.name()))
  if (!h) return null
  const p = h.position()
  return { x: p.x + h.width() / 2, y: p.y + h.height() / 2 }
})

// --- every arrow starts node editing with a point at its centre
const arrowNodes = await page.evaluate(() => {
  const { board, store } = window.__tbm
  const out = {}
  for (const existingPoints of [false, true]) {
    const id = existingPoints ? 'verify-two-node-arrow' : 'verify-new-arrow'
    store.apply(scene => {
      scene.objects = scene.objects.filter(obj => obj.id !== id)
      scene.objects.push({
        id, type: 'arrow', x1: 200, y1: 180, mx: 300, my: 180, x2: 400, y2: 180,
        curved: false, dash: 'solid', color: '#111111', width: 4, head: true,
        ...(existingPoints ? { points: [{ x: 200, y: 180 }, { x: 400, y: 180 }] } : {}),
      })
    })
    store.select(id)
    board.enterNodeEdit(id)
    const points = store.obj(id).points
    out[id] = {
      count: board.nodeEditInfo()?.count,
      canRemove: board.nodeEditInfo()?.canRemove,
      anchors: board.stage.find('.anchor').filter(node => /anchor-node-/.test(node.name())).length,
      hasMidAlias: !!board.stage.findOne('.anchor-mid'),
      middle: points?.[1],
    }
    board.exitNodeEdit()
  }
  return out
})
for (const [id, result] of Object.entries(arrowNodes)) {
  check(result.count === 3 && result.anchors === 3, `${id} did not have three nodes: ${JSON.stringify(result)}`)
  check(result.canRemove === false, `${id} allowed its centre node to be removed`)
  check(result.hasMidAlias, `${id} had no middle anchor`)
  check(result.middle?.x === 300 && result.middle?.y === 180, `${id} middle node was not centred: ${JSON.stringify(result.middle)}`)
  check(result.middle?.c === 'round', `${id} middle node did not default to the round curve preset: ${JSON.stringify(result.middle)}`)
}

// --- an arrow bends by its round nodes: squares belong to Free alone
async function selectArrowMid() {
  await page.evaluate(() => {
    const { board, store } = window.__tbm
    if (board.interactionState === 'node-edit') board.exitNodeEdit()
    store.apply(scene => {
      scene.objects = scene.objects.filter(obj => obj.id !== 'verify-curve-arrow')
      scene.objects.push({
        id: 'verify-curve-arrow', type: 'arrow', x1: 200, y1: 300, mx: 300, my: 300, x2: 400, y2: 300,
        curved: false, dash: 'solid', color: '#111111', width: 4, head: true,
      })
    })
    store.select('verify-curve-arrow')
    board.enterNodeEdit('verify-curve-arrow')
  })
  const mid = await page.evaluate(() => {
    const n = window.__tbm.board.stage.findOne('.anchor-mid')
    return n ? n.position() : null
  })
  if (!mid) return null
  const at = await toScreen(mid)
  await page.mouse.click(at.x, at.y)
  await page.waitForTimeout(120)
  return { mid, at }
}

const picked = await selectArrowMid()
check(!!picked, 'a fresh arrow drew no middle node to tap')
const fresh = await ui()
check(fresh.index === 1, `tapping the middle of an arrow did not select it: ${JSON.stringify(fresh)}`)
check(fresh.rounds === 3, `a fresh arrow did not edit as three round nodes: ${JSON.stringify(fresh)}`)
check(fresh.squares === 0 && fresh.stems === 0,
  `the default round arrow node showed Bezier squares: ${JSON.stringify(fresh)}`)

if (picked) {
  // dragging the round middle node is how an ordinary arrow curves
  await page.mouse.move(picked.at.x, picked.at.y)
  await page.mouse.down()
  await page.mouse.move(picked.at.x, picked.at.y - 70, { steps: 6 })
  await page.mouse.up()
  await page.waitForTimeout(140)
  const bent = await page.evaluate(() => {
    const o = window.__tbm.store.obj('verify-curve-arrow')
    return { middle: o.points?.[1], curved: o.curved }
  })
  const afterDrag = await ui()
  check(!!bent.middle && bent.middle.y < 280, `dragging the middle node did not bend the arrow: ${JSON.stringify(bent)}`)
  check(bent.middle?.c === 'round' && !bent.middle?.h1 && !bent.middle?.h2,
    `dragging the middle node changed its automatic curve preset: ${JSON.stringify(bent.middle)}`)
  check(afterDrag.squares === 0, `squares appeared after dragging a round node: ${JSON.stringify(afterDrag)}`)
}

// --- the automatic modes stay square-free; Free is the one that shows them
const curveModes = {}
for (const mode of ['corner', 'smooth', 'round', 'free', 'smooth']) {
  await page.evaluate(v => window.__tbm.board.setSelectedNodeCurve(v), mode)
  await page.waitForTimeout(80)
  const state = await ui()
  const node = await page.evaluate(() => {
    const n = window.__tbm.store.obj('verify-curve-arrow').points[1]
    return { c: n.c, h1: !!n.h1, h2: !!n.h2 }
  })
  curveModes[mode] = { ...state, node }
  if (mode === 'free') {
    check(state.squares > 0 && state.stems > 0, `Free showed no handles: ${JSON.stringify(state)}`)
    check(state.rounds === 3 && state.index === 1, `Free lost the round selected node: ${JSON.stringify(state)}`)
    check(node.c === 'free' && node.h1 && node.h2, `Free stored no handles: ${JSON.stringify(node)}`)
  } else {
    check(state.squares === 0 && state.stems === 0, `${mode} showed Bezier squares: ${JSON.stringify(state)}`)
    check(state.rounds === 3, `${mode} did not keep three round nodes: ${JSON.stringify(state)}`)
    check(node.c === mode && !node.h1 && !node.h2, `${mode} kept hand-bent handles: ${JSON.stringify(node)}`)
  }
}

// A hand-bent neighbour must not leak squares into an automatic selected node.
await page.evaluate(() => {
  const { board, store } = window.__tbm
  store.apply(() => {
    const first = store.obj('verify-curve-arrow').points[0]
    first.c = 'free'
    first.h1 = { x: -30, y: 0 }
    first.h2 = { x: 30, y: 0 }
  })
  board.rebuild()
})
const mixedAutomatic = await ui()
check(mixedAutomatic.index === 1 && mixedAutomatic.squares === 0 && mixedAutomatic.stems === 0,
  `a free neighbour leaked squares into an automatic arrow node: ${JSON.stringify(mixedAutomatic)}`)

// --- an arrow saved with hand-bent nodes still shows its handles, no migration
const legacy = await page.evaluate(() => {
  const { board, store } = window.__tbm
  if (board.interactionState === 'node-edit') board.exitNodeEdit()
  store.apply(scene => {
    scene.objects = scene.objects.filter(obj => obj.id !== 'verify-legacy-arrow')
    scene.objects.push({
      id: 'verify-legacy-arrow', type: 'arrow', x1: 200, y1: 420, mx: 300, my: 360, x2: 400, y2: 420,
      curved: true, dash: 'solid', color: '#111111', width: 4, head: true,
    })
  })
  store.select('verify-legacy-arrow')
  board.enterNodeEdit('verify-legacy-arrow')
  return board.nodeEditInfo()?.count ?? null
})
check(legacy === 3, `a saved curved arrow did not open as three nodes: ${legacy}`)
const legacyMid = await page.evaluate(() => {
  const n = window.__tbm.board.stage.findOne('.anchor-mid')
  return n ? n.position() : null
})
if (legacyMid) {
  const at = await toScreen(legacyMid)
  await page.mouse.click(at.x, at.y)
  await page.waitForTimeout(120)
  const state = await ui()
  check(state.index === 1 && state.squares > 0,
    `a hand-bent saved arrow lost its handles: ${JSON.stringify(state)}`)
}
await page.evaluate(() => {
  const { board, store } = window.__tbm
  if (board.interactionState === 'node-edit') board.exitNodeEdit()
  store.apply(scene => {
    scene.objects = scene.objects.filter(o => o.id !== 'verify-curve-arrow' && o.id !== 'verify-legacy-arrow')
  })
})

// --- a handle stays on screen while it is being dragged
await freshZone()
const before = await ui()
check(before.squares > 0 && before.stems > 0, `a zone node lost its handle squares: ${JSON.stringify(before)}`)

const hp = await handlePoint()
check(!!hp, 'the selected node drew no handle to grab')
if (hp) {
  const s = await toScreen(hp)
  await page.mouse.move(s.x, s.y)
  await page.mouse.down()
  await page.mouse.move(s.x + 45, s.y - 35, { steps: 6 })
  await page.waitForTimeout(60)
  const mid = await ui()
  check(mid.squares > 0 && mid.stems > 0, `handles vanished mid-drag: ${JSON.stringify(mid)}`)
  check(mid.index !== null, 'dragging a handle took the selection off its node')
  await page.mouse.up()
  await page.waitForTimeout(120)
  const after = await ui()
  check(after.squares > 0 && after.index !== null, `handles vanished after the drag: ${JSON.stringify(after)}`)
  const node = await page.evaluate(({ i }) => {
    const n = window.__tbm.store.obj('verify-zone').corners[i]
    return { c: n.c, h1: n.h1, h2: n.h2 }
  }, { i: after.index })
  check(node.c === 'free' && !!node.h1 && !!node.h2, `the drag did not bend the line: ${JSON.stringify(node)}`)
  check(Math.abs(node.h1.x + node.h2.x) < 0.01 && Math.abs(node.h1.y + node.h2.y) < 0.01,
    'the opposite side did not stretch with the one being dragged')
}

// --- a node added to the outline lands on it
await freshZone()
const landed = await page.evaluate(() => {
  const { board, store } = window.__tbm
  const before = store.obj('verify-zone').corners.length
  const added = board.addNodeNear({ x: 250, y: 260 }, 22)
  const i = board.selectedNodeIndex()
  const n = i === null ? null : store.obj('verify-zone').corners[i]
  return { added, before, after: store.obj('verify-zone').corners.length, n }
})
check(landed.added && landed.after === landed.before + 1, `adding a node did not take: ${JSON.stringify(landed)}`)
check(!!landed.n && Math.abs(landed.n.y - 260) < 0.5 && Math.abs(landed.n.x - 250) < 0.5,
  `the new node missed the line: ${JSON.stringify(landed.n)}`)

// --- a zone never falls below a triangle
const floor = await page.evaluate(() => {
  const { board, store } = window.__tbm
  for (let i = 0; i < 6; i++) {
    board.addNodeNear({ x: 200, y: 200 }, 4000)
    board.removeSelectedNode()
  }
  return store.obj('verify-zone').corners.length
})
check(floor >= 3, `a zone was cut below three nodes: ${floor}`)

// --- an oval and a triangle expose their pencil and edit by their nodes
const shapes = {}
for (const [id, shape] of [['verify-oval', 'ellipse'], ['verify-tri', 'triangle']]) {
  const pencil = await page.evaluate(({ id, shape }) => {
    const { board, store } = window.__tbm
    if (board.interactionState === 'node-edit') board.exitNodeEdit()
    store.apply(s => {
      s.objects = s.objects.filter(o => o.id !== id)
      s.objects.push({ id, type: 'box', shape, x: 300, y: 200, w: 150, h: 110, rotation: 0, fill: '#9ca3af', opacity: 0.45, label: '', labelPos: 'top' })
    })
    store.select(id)
    const icon = board.stage.findOne('.edit-icon')
    return icon ? icon.position() : null
  }, { id, shape })
  check(!!pencil, `a selected ${shape} had no node-editor pencil`)
  if (pencil) {
    const target = await toScreen(pencil)
    await page.mouse.click(target.x, target.y)
    await page.waitForTimeout(120)
  }
  shapes[shape] = await page.evaluate(() => ({
    state: window.__tbm.board.interactionState,
    count: window.__tbm.board.nodeEditInfo()?.count ?? null,
  }))
}
check(shapes.ellipse.state === 'node-edit' && shapes.ellipse.count === 4,
  `an oval did not open as four nodes: ${JSON.stringify(shapes.ellipse)}`)
check(shapes.triangle.state === 'node-edit' && shapes.triangle.count === 3,
  `a triangle did not open as three nodes: ${JSON.stringify(shapes.triangle)}`)

await ctx.close()
await browser.close()
if (errors.length) {
  console.log(`BOARD_URL=${baseUrl}`)
  console.log('ERRORS:\n' + errors.join('\n'))
  process.exit(1)
}
console.log(`OK ${baseUrl}`)
