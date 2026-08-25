import { chromium } from 'playwright-core'
import { chromePath } from './lib/chrome.mjs'

const baseUrl = new URL(process.env.BOARD_URL || 'http://localhost:4173/').href
const headless = process.env.HEADFUL === '1' ? false : true
const actionTimeout = Number(process.env.BOARD_ACTION_TIMEOUT || 20000)
const navTimeout = Number(process.env.BOARD_NAV_TIMEOUT || 45000)

const browser = await chromium.launch({
  executablePath: chromePath,
  headless,
})

const errors = []
const check = (ok, msg) => { if (!ok) errors.push(msg) }

function benignConsole(text) {
  // The shared TJ header checks account state on load. Anonymous users get a
  // 401; that is expected on both localhost and board.tacticsjournal.com.
  return /status of 401/.test(text)
    || /tacticsjournal\.com\/api\//.test(text)
    || /api\/account\/session/.test(text)
    || /Access to fetch at .*\/api\//.test(text)
    || /Failed to load resource: net::ERR_FAILED/.test(text)
    || /Failed to load resource:.*favicon/.test(text)
}

async function run(name, viewport, isMobile, actions, opts = {}) {
  const ctx = await browser.newContext({ viewport, isMobile, hasTouch: isMobile, deviceScaleFactor: isMobile ? 2 : 1 })
  const page = await ctx.newPage()
  page.setDefaultTimeout(actionTimeout)
  page.on('pageerror', e => errors.push(`[${name}] ${e.message}`))
  page.on('console', m => {
    if (m.type() === 'error' && !benignConsole(m.text())) errors.push(`[${name}] console: ${m.text()}`)
  })
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: navTimeout })
  await page.waitForFunction(() => window.__tbm?.board && window.__tbm?.store, null, { timeout: navTimeout })
  // Localhost fails closed on entitlements, so the licensed paths (match
  // overlay, cones, goals) are unreachable there. Opt in explicitly.
  if (process.env.BOARD_FORCE_PRO === '1') {
    await page.evaluate(() => window.__tbm.entitlements.setServerEntitlement(true))
    await page.waitForTimeout(120)
  }
  if (opts.waitForStage !== false) {
    await page.waitForSelector('#stage', { state: 'attached' })
    await page.waitForFunction(() => {
      const r = document.querySelector('#stage')?.getBoundingClientRect()
      return !!r && r.width > 100 && r.height > 100
    }, null, { timeout: navTimeout })
  }
  await page.waitForTimeout(700)
  try { await actions(page) } catch (e) { errors.push(`[${name}] threw: ${String(e.message || e).split('\n').slice(0, 4).join(' | ')}`) }
  await page.screenshot({ path: `/tmp/tbm-${name}.png` })
  await ctx.close()
}

async function stageBox(page) {
  const box = await page.locator('#stage').boundingBox()
  if (!box) throw new Error('stage is not visible')
  return box
}

async function stageCenter(page) {
  const box = await stageBox(page)
  return { box, cx: box.x + box.width / 2, cy: box.y + box.height / 2 }
}

// A folded desktop panel keeps its shelf mounted and clips it away, so the
// panel's own state is what says whether the shapes are reachable.
const shelfOpen = (page) =>
  page.evaluate(() => !document.querySelector('#shelf')?.classList.contains('hidden')
    && !document.querySelector('#panelDock')?.classList.contains('folded'))

/** Wide windows swap the room band for a rail of tools down the left edge. */
const deskMode = (page) => page.evaluate(() => document.body.classList.contains('deskMode'))

/** Shapes is a toggle: tapping the room you are in collapses the panel. */
async function openShapes(page) {
  if (await shelfOpen(page)) return
  // On a wide window the lit rail tool is the one that unfolds the panel;
  // any other would switch categories on the way.
  const sel = await deskMode(page)
    ? (await page.$('#toolbar .railBtn.active') ? '#toolbar .railBtn.active' : '[data-rail="players"]')
    : '[data-room="shapes"]'
  await page.click(sel)
  if (!(await shelfOpen(page))) await page.click(sel)
  await page.waitForTimeout(60)
}

/** The styles controls are a room on a phone and the bar over the board on a
 *  wide window, where they are always on screen. */
async function openStyles(page) {
  if (await deskMode(page)) return
  await page.click('[data-room="styles"]')
}

async function clickTool(page, tool) {
  // Tools live on the Shapes shelf rail; Text is its own room in the band.
  if (tool !== 'text') await openShapes(page)
  // The rail toggles the panel when you press the tool you are already on.
  const armed = await page.evaluate(t => window.__tbm.board.tool === t, tool)
  if (!(armed && await deskMode(page))) await page.click(`[data-tool="${tool}"]`)
  await page.waitForFunction(t => window.__tbm.board.tool === t, tool)
  await page.waitForTimeout(80)
}

async function addPlayer(page, color = null) {
  await clickTool(page, 'player')
  await page.click('[data-opt="d-add-player"]')
  await page.waitForFunction(() => window.__tbm.store.selected?.type === 'player')
  // Colour is a Styles control now: place first, then restyle the new player.
  if (color) {
    await openStyles(page)
    await page.click(`[data-opt="pcolor"][data-v="${color}"]`)
    await page.waitForFunction(c => window.__tbm.store.selected?.color === c, color)
    await openShapes(page)
  }
}

async function dragMouse(page, from, to, steps = 8) {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(from.x + (to.x - from.x) * i / steps, from.y + (to.y - from.y) * i / steps)
  }
  await page.mouse.up()
  await page.waitForTimeout(180)
}

async function screenOfObject(page, type, index = 0) {
  const pt = await page.evaluate(({ type, index }) => {
    const { store, board } = window.__tbm
    const objs = store.scene.objects.filter(o => o.type === type)
    const obj = objs[index]
    if (!obj) return null
    const center = obj.type === 'arrow'
      ? { x: (obj.x1 + obj.x2) / 2, y: (obj.y1 + obj.y2) / 2 }
      : obj.type === 'box' && obj.corners
        ? { x: obj.corners.reduce((s, c) => s + c.x, 0) / obj.corners.length, y: obj.corners.reduce((s, c) => s + c.y, 0) / obj.corners.length }
        : { x: obj.x, y: obj.y }
    const p = board.boardToScreen(center)
    return { id: obj.id, x: p.x, y: p.y, board: center }
  }, { type, index })
  if (!pt) throw new Error(`no ${type} object at index ${index}`)
  const box = await stageBox(page)
  return { ...pt, x: box.x + pt.x, y: box.y + pt.y }
}

async function screenOfUiNode(page, selector) {
  const pt = await page.evaluate((selector) => {
    const node = window.__tbm.board.uiLayer.findOne(selector)
    if (!node) return null
    const p = node.getAbsolutePosition()
    return { x: p.x, y: p.y }
  }, selector)
  if (!pt) throw new Error(`missing UI node ${selector}`)
  const box = await stageBox(page)
  return { x: box.x + pt.x, y: box.y + pt.y }
}

async function anchorScreenPoints(page) {
  const pts = await page.evaluate(() => window.__tbm.board.uiLayer.find('.anchor').map(n => {
    const name = n.name().split(/\s+/).find(nm => nm.startsWith('anchor-'))
    const p = n.getAbsolutePosition()
    return { name, x: p.x, y: p.y }
  }))
  const box = await stageBox(page)
  return pts.map(p => ({ ...p, x: box.x + p.x, y: box.y + p.y }))
}

async function selectedNodeCount(page) {
  return page.evaluate(() => window.__tbm.board.selectedNodes?.size ?? 0)
}

async function openSettings(page, screen = 'root') {
  await page.click('[data-bar="settings"]')
  await page.waitForSelector('.setSheet')
  if (screen !== 'root') await gotoScreen(page, screen)
  await page.waitForTimeout(120)
}

/** Settings is one list with push screens; step back to root before pushing again. */
async function gotoScreen(page, screen) {
  const atRoot = await page.evaluate(() => !document.querySelector('[data-pane="root"]').classList.contains('hidden'))
  if (!atRoot) {
    await page.click('.setBack')
    await page.waitForTimeout(80)
  }
  await page.locator(`[data-goto="${screen}"]`).first().click()
  await page.waitForTimeout(120)
}

async function closeSettings(page) {
  await page.click('[data-set="close"]')
  await page.waitForTimeout(120)
}

async function exportSize(page) {
  return page.evaluate(() => new Promise(res => {
    const url = window.__tbm.board.exportPng()
    const img = new Image()
    img.onload = () => res({ w: img.width, h: img.height })
    img.onerror = () => res({ w: 0, h: 0 })
    img.src = url
  }))
}

await run('desktop', { width: 1280, height: 800 }, false, async (page) => {
  const { cx, cy } = await stageCenter(page)

  // Settings must be reachable, push to the expected screens, and reset its scroll position.
  await openSettings(page)
  await page.evaluate(() => {
    const sheet = document.querySelector('.setSheet')
    sheet.scrollTop = sheet.scrollHeight
  })
  await gotoScreen(page, 'howto')
  const howTo = await page.evaluate(() => ({
    open: !document.querySelector('[data-pane="howto"]').classList.contains('hidden'),
    scrollTop: document.querySelector('.setSheet').scrollTop,
  }))
  check(howTo.open, 'How to use pane should open from Settings')
  check(howTo.scrollTop === 0, `Settings sub-screen should open at the top, got scrollTop ${howTo.scrollTop}`)
  await gotoScreen(page, 'teams')
  const teamCards = await page.evaluate(() => document.querySelectorAll('.tmCard').length)
  check(teamCards === 2, `expected two team cards, got ${teamCards}`)
  await closeSettings(page)

  // The standalone import button is gone; screenshot import lives in Settings,
  // so there is no toolbar affordance left to check against entitlements here.

  // Add players from the Player tray (current production UX), then add every object type.
  await addPlayer(page)
  await addPlayer(page, '#1e2f6f')
  await page.keyboard.press('Escape')

  await clickTool(page, 'ball')
  await page.mouse.click(cx + 40, cy)
  await page.waitForFunction(() => window.__tbm.store.scene.objects.some(o => o.type === 'ball'))

  await clickTool(page, 'arrow')
  await page.click('[data-opt="d-dash"][data-v="dotted"]')
  await dragMouse(page, { x: cx + 30, y: cy }, { x: cx - 100, y: cy - 40 })
  await page.keyboard.press('Escape')

  await clickTool(page, 'arrow')
  await page.click('[data-opt="d-dash"][data-v="solid"]')
  await dragMouse(page, { x: cx - 50, y: cy - 25 }, { x: cx - 110, y: cy + 30 })
  await page.keyboard.press('Escape')

  await clickTool(page, 'box')
  await dragMouse(page, { x: cx - 160, y: cy - 90 }, { x: cx - 80, y: cy + 40 }, 6)
  await page.keyboard.press('Escape')

  await clickTool(page, 'box')
  await page.click('[data-opt="d-shape"][data-v="ellipse"]')
  await dragMouse(page, { x: cx + 120, y: cy - 120 }, { x: cx + 200, y: cy - 90 }, 6)
  const oval = await page.evaluate(() => {
    const c = window.__tbm.store.scene.objects.filter(o => o.type === 'box').find(o => o.shape === 'ellipse')
    return c ? { w: c.w, h: c.h } : null
  })
  check(!!oval && oval.w > 10 && oval.h > 10, `oval zone was not created: ${JSON.stringify(oval)}`)
  await page.keyboard.press('Escape')

  await clickTool(page, 'text')
  await page.mouse.click(cx + 170, cy + 110)
  await page.waitForTimeout(150)
  await page.keyboard.type('Vitinha')
  await page.keyboard.press('Enter')
  await page.keyboard.press('Escape')

  // When an object is already selected, dragging from over another object
  // should move the selected object, not select/drag the object under pointer.
  await page.evaluate(() => {
    const { store } = window.__tbm
    const players = store.scene.objects.filter(o => o.type === 'player')
    store.select(players[0].id)
  })
  const selectedBefore = await screenOfObject(page, 'player', 0)
  const otherPlayer = await screenOfObject(page, 'player', 1)
  await dragMouse(page, otherPlayer, { x: otherPlayer.x + 28, y: otherPlayer.y + 18 }, 6)
  const selectedAfterDragOverOther = await page.evaluate((id) => {
    const o = window.__tbm.store.obj(id)
    return { x: o.x, y: o.y, selectedId: window.__tbm.store.selectedId }
  }, selectedBefore.id)
  check(Math.hypot(selectedAfterDragOverOther.x - selectedBefore.board.x, selectedAfterDragOverOther.y - selectedBefore.board.y) > 8,
    `drag over another object did not move selected object: ${JSON.stringify({ selectedBefore: selectedBefore.board, selectedAfterDragOverOther })}`)
  check(selectedAfterDragOverOther.selectedId === selectedBefore.id, 'drag over another object should keep current selection')

  // Modifier-click (shift/ctrl/cmd) adds to the existing selection.
  await page.keyboard.press('Escape')
  const pA = await screenOfObject(page, 'player', 0)
  await page.mouse.click(pA.x, pA.y)
  await page.waitForFunction((id) => window.__tbm.store.selectedId === id, pA.id)
  const pB = await screenOfObject(page, 'player', 1)
  await page.keyboard.down('Shift')
  await page.mouse.click(pB.x, pB.y)
  await page.keyboard.up('Shift')
  await page.waitForTimeout(120)
  const multiSel = await page.evaluate(() => [...window.__tbm.store.selectedIds])
  check(multiSel.includes(pA.id) && multiSel.includes(pB.id), `shift-click should add to selection: ${JSON.stringify(multiSel)}`)
  await page.keyboard.down('Shift')
  await page.mouse.click(pB.x, pB.y)
  await page.keyboard.up('Shift')
  await page.waitForTimeout(120)
  const afterToggle = await page.evaluate(() => [...window.__tbm.store.selectedIds])
  check(afterToggle.length === 1 && afterToggle[0] === pA.id, `shift-click again should remove B: ${JSON.stringify(afterToggle)}`)
  await page.keyboard.press('Escape')

  // Direct press-drag on an unselected object should move it, not pan the pitch.
  await page.keyboard.press('Escape')
  const before = await screenOfObject(page, 'player', 0)
  await dragMouse(page, before, { x: before.x - 24, y: before.y - 26 }, 6)
  const moved = await page.evaluate((id) => {
    const o = window.__tbm.store.obj(id)
    return { x: o.x, y: o.y, selected: window.__tbm.store.selectedId === id }
  }, before.id)
  check(Math.hypot(moved.x - before.board.x, moved.y - before.board.y) > 10, `press-drag did not move player: ${JSON.stringify({ before: before.board, moved })}`)
  check(!moved.selected, 'press-drag should not select; selection only happens on tap')
  const movedPlayer = await screenOfObject(page, 'player', 0)
  await page.mouse.click(movedPlayer.x, movedPlayer.y)
  await page.waitForFunction(() => window.__tbm.store.selected?.type === 'player')

  // Selection exposes immediate resize controls; dragging the resize dot grows a player.
  const resize = await screenOfUiNode(page, '.resize-node')
  const r0 = await page.evaluate(() => window.__tbm.store.selected.r)
  await dragMouse(page, resize, { x: resize.x + 18, y: resize.y - 18 }, 6)
  const r1 = await page.evaluate(() => window.__tbm.store.selected.r)
  check(r1 > r0 + 1, `resize node did not grow player (${r0} -> ${r1})`)

  // Default tier order: box < arrow < player < ball < text (insertByTier).
  const zorder = await page.evaluate(() => {
    const { store, board } = window.__tbm
    return board.objLayer.getChildren().map(n => store.scene.objects.find(o => o.id === n.id())?.type)
  })
  check(zorder.lastIndexOf('box') < zorder.indexOf('arrow')
    && zorder.lastIndexOf('arrow') < zorder.indexOf('player')
    && zorder.lastIndexOf('player') < zorder.indexOf('ball')
    && zorder.lastIndexOf('ball') < zorder.indexOf('text'),
    `stacking wrong: ${JSON.stringify(zorder)}`)

  // Layer ordering: bring-forward/send-back move objects across tiers.
  const layerTest = await page.evaluate(() => {
    const { store } = window.__tbm
    const zone = store.scene.objects.find(o => o.type === 'box')
    const player = store.scene.objects.find(o => o.type === 'player')
    if (!zone || !player) return { ok: false, reason: 'missing zone or player' }
    const zi = store.scene.objects.indexOf(zone)
    const pi = store.scene.objects.indexOf(player)
    if (zi >= pi) return { ok: false, reason: `zone (${zi}) should be before player (${pi})` }
    store.select(zone.id)
    return { ok: true, zoneId: zone.id, playerId: player.id, zoneBefore: zi, playerBefore: pi, gap: pi - zi }
  })
  check(layerTest.ok, `layer ordering pre-check: ${layerTest.reason || ''}`)
  // single-step move: click enough times to cross past the first player
  for (let i = 0; i <= layerTest.gap; i++) {
    await page.click('[data-act="front"]')
    await page.waitForTimeout(60)
  }
  const afterFront = await page.evaluate((ids) => {
    const objs = window.__tbm.store.scene.objects
    return { zi: objs.findIndex(o => o.id === ids.zoneId), pi: objs.findIndex(o => o.id === ids.playerId) }
  }, layerTest)
  check(afterFront.zi > afterFront.pi, `bring-forward should move zone past player: zi=${afterFront.zi} pi=${afterFront.pi}`)
  // send it back the same number of steps
  for (let i = 0; i <= layerTest.gap; i++) {
    await page.click('[data-act="back"]')
    await page.waitForTimeout(60)
  }
  const afterBack = await page.evaluate((ids) => {
    const objs = window.__tbm.store.scene.objects
    return { zi: objs.findIndex(o => o.id === ids.zoneId), pi: objs.findIndex(o => o.id === ids.playerId) }
  }, layerTest)
  check(afterBack.zi < afterBack.pi, `send-back should move zone before player: zi=${afterBack.zi} pi=${afterBack.pi}`)
  await page.keyboard.press('Escape')

  // A fresh arrow should be inserted below players (insertByTier).
  await clickTool(page, 'arrow')
  await dragMouse(page, { x: cx + 40, y: cy + 60 }, { x: cx + 100, y: cy + 80 })
  const tierCheck = await page.evaluate(() => {
    const objs = window.__tbm.store.scene.objects
    const lastArrow = [...objs].reverse().find(o => o.type === 'arrow')
    const firstPlayer = objs.find(o => o.type === 'player')
    if (!lastArrow || !firstPlayer) return false
    return objs.indexOf(lastArrow) < objs.indexOf(firstPlayer)
  })
  check(tierCheck, 'a new arrow should be inserted below players via insertByTier')
  await page.keyboard.press('Escape')

  // Undo covers the whole scene: match edits are undoable, and typing
  // multiple characters into a match field produces exactly 1 undo entry.
  const undoBefore = await page.evaluate(() => {
    const { store } = window.__tbm
    return { clock: store.scene.match?.clock || '', depth: store.undoDepth, count: store.scene.objects.length }
  })
  await page.click('[data-top="match"]')
  await page.waitForSelector('.matchSheet')
  await page.fill('[data-match-f="clock"]', '45:00')
  await page.click('[data-match="close"]')
  await page.waitForTimeout(120)
  const undoAfter = await page.evaluate(() => {
    const { store } = window.__tbm
    return { clock: store.scene.match?.clock || '', depth: store.undoDepth }
  })
  check(undoAfter.clock === '45:00', `match clock should be 45:00: ${undoAfter.clock}`)
  check(undoAfter.depth === undoBefore.depth + 1, `typing into match field should produce 1 undo entry: ${undoAfter.depth - undoBefore.depth}`)
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z')
  await page.waitForTimeout(120)
  const undoResult = await page.evaluate(() => {
    const { store } = window.__tbm
    return { clock: store.scene.match?.clock || '', count: store.scene.objects.length }
  })
  check(undoResult.clock === undoBefore.clock, `undo should restore clock: got ${undoResult.clock}, want ${undoBefore.clock}`)
  check(undoResult.count === undoBefore.count, `undo should not change object count: got ${undoResult.count}, want ${undoBefore.count}`)

  // Snap-to-grid: dragging with snap enabled produces grid-aligned coordinates.
  await page.evaluate(() => window.__tbm.board.setSnapEnabled(true))
  const snapPlayer = await screenOfObject(page, 'player', 0)
  await page.mouse.click(snapPlayer.x, snapPlayer.y)
  await page.waitForFunction((id) => window.__tbm.store.selectedId === id, snapPlayer.id)
  await dragMouse(page, snapPlayer, { x: snapPlayer.x + 37, y: snapPlayer.y + 23 }, 8)
  const snapResult = await page.evaluate((id) => {
    const o = window.__tbm.store.obj(id)
    return { x: o.x, y: o.y }
  }, snapPlayer.id)
  check(snapResult.x % 10 === 0 && snapResult.y % 10 === 0, `snap drag should align to grid: ${JSON.stringify(snapResult)}`)
  await page.evaluate(() => window.__tbm.board.setSnapEnabled(false))
  await page.keyboard.press('Escape')

  // In node-edit mode, drag a marquee around anchors to multi-select them,
  // then drag one selected anchor and verify the selected nodes move together.
  await page.evaluate(() => {
    const { store, board } = window.__tbm
    const arrow = store.scene.objects.find(o => o.type === 'arrow' && !o.measure)
    store.select(arrow.id)
    board.attachSelectionUi()
  })
  const editIcon = await screenOfUiNode(page, '.edit-icon')
  await dragMouse(page, editIcon, editIcon, 1)
  await page.waitForFunction(() => window.__tbm.board.interactionState === 'node-edit')
  let mid = await screenOfUiNode(page, '.anchor-mid')
  await dragMouse(page, mid, mid, 1)
  check(await selectedNodeCount(page) === 1, 'tapping one node should single-select it')
  await dragMouse(page, { x: mid.x + 80, y: mid.y + 80 }, { x: mid.x + 106, y: mid.y + 98 }, 8)
  const movedMid = await screenOfUiNode(page, '.anchor-mid')
  check(Math.hypot(movedMid.x - mid.x, movedMid.y - mid.y) > 12, `selected node did not move from empty-space drag: ${JSON.stringify({ mid, movedMid })}`)
  await page.mouse.click(movedMid.x + 80, movedMid.y + 80)
  await page.waitForTimeout(120)
  check(await selectedNodeCount(page) === 0, 'empty tap should clear selected node before marquee')

  let anchors = await anchorScreenPoints(page)
  let minX = Math.min(...anchors.map(p => p.x)), maxX = Math.max(...anchors.map(p => p.x))
  let minY = Math.min(...anchors.map(p => p.y)), maxY = Math.max(...anchors.map(p => p.y))
  await dragMouse(page, { x: minX - 24, y: minY - 24 }, { x: maxX + 24, y: maxY + 24 }, 8)
  const nodeCount = await selectedNodeCount(page)
  check(nodeCount >= 2, `node marquee should select multiple anchors, got ${nodeCount}`)
  anchors = await anchorScreenPoints(page)
  const beforeNodes = Object.fromEntries(anchors.map(p => [p.name, p]))
  await dragMouse(page, anchors[0], { x: anchors[0].x + 26, y: anchors[0].y + 18 }, 8)
  const afterNodes = Object.fromEntries((await anchorScreenPoints(page)).map(p => [p.name, p]))
  const movedTogether = Object.keys(beforeNodes).filter(name => afterNodes[name])
    .every(name => Math.hypot(afterNodes[name].x - beforeNodes[name].x, afterNodes[name].y - beforeNodes[name].y) > 12)
  check(movedTogether, `multi-selected nodes did not move together: ${JSON.stringify({ beforeNodes, afterNodes })}`)
  await page.waitForSelector('[data-node-edit-hint]')
  await page.mouse.dblclick(afterNodes[anchors[0].name].x + 80, afterNodes[anchors[0].name].y + 80)
  await page.waitForFunction(() => window.__tbm.board.interactionState !== 'node-edit')

  const exp = await exportSize(page)
  check(exp.w === 2048 && exp.h > 1000, `export size wrong: ${JSON.stringify(exp)}`)

  // Named save, blank board, reload saved board.
  await openSettings(page, 'boards')
  await page.fill('[data-sv="name"]', 'Smoke board')
  await page.click('[data-sv="save"]')
  await page.waitForSelector('[data-sv="load"][data-name="Smoke board"]')
  await page.click('[data-sv="new-blank"]')
  await page.waitForFunction(() => window.__tbm.store.scene.objects.length === 0)
  await openSettings(page, 'boards')
  await page.click('[data-sv="load"][data-name="Smoke board"]')
  await page.waitForFunction(() => window.__tbm.store.scene.objects.length >= 7)

  const state = await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('tbm-scene-v2'))
    return { count: s.objects.length, types: s.objects.map(o => o.type) }
  })
  check(state.count >= 7, `expected >=7 objects after save/load, got ${JSON.stringify(state)}`)
})

await run('mobile', { width: 390, height: 844 }, true, async (page) => {
  const { cx, cy } = await stageCenter(page)
  const cdp = await page.context().newCDPSession(page)
  const touch = async (type, points) =>
    cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(p => ({ x: p.x, y: p.y })) })
  const tap = async (p) => { await touch('touchStart', [p]); await touch('touchEnd', []); await page.waitForTimeout(160) }
  const drag = async (from, to, steps = 6) => {
    await touch('touchStart', [from])
    for (let i = 1; i <= steps; i++) {
      await touch('touchMove', [{ x: from.x + (to.x - from.x) * i / steps, y: from.y + (to.y - from.y) * i / steps }])
      await page.waitForTimeout(20)
    }
    await touch('touchEnd', [])
    await page.waitForTimeout(220)
  }

  await page.tap('[data-opt="d-add-player"]')
  await page.waitForFunction(() => window.__tbm.store.selected?.type === 'player')

  // Regression: mobile taps on an already-selected player must not be treated
  // as empty-board taps if touchend reports the stage/layer instead of the
  // pointerdown object.
  const player = await screenOfObject(page, 'player', 0)
  for (const p of [player, { x: player.x + 8, y: player.y }, { x: player.x - 8, y: player.y + 6 }, player]) {
    await tap(p)
    const selectedId = await page.evaluate(() => window.__tbm.store.selectedId)
    check(selectedId === player.id, `mobile player tap deselected or switched selection: ${JSON.stringify({ expected: player.id, selectedId, tap: p })}`)
  }
  const box = await stageBox(page)
  await page.mouse.click(box.x + 18, box.y + 18)
  const afterSyntheticMouse = await page.evaluate(() => window.__tbm.store.selectedId)
  check(afterSyntheticMouse === player.id, 'synthetic mouse event after touch should not deselect player')
  await page.waitForTimeout(720)
  await tap({ x: box.x + 18, y: box.y + 18 })
  const cleared = await page.evaluate(() => window.__tbm.store.selectedId === null)
  check(cleared, 'mobile empty-space tap should still deselect player')
  await tap(player)
  const reselected = await page.evaluate((id) => window.__tbm.store.selectedId === id, player.id)
  check(reselected, 'mobile tap on unselected player should select it')

  await page.tap('[data-tool="arrow"]')
  await drag({ x: cx - 60, y: cy }, { x: cx + 70, y: cy - 42 })
  const selectedArrow = await page.evaluate(() => ({
    sel: window.__tbm.store.selected?.type,
    state: window.__tbm.board.interactionState,
    anchors: window.__tbm.board.uiLayer.find('.anchor').length,
    editIcons: window.__tbm.board.uiLayer.find('.edit-icon').length,
  }))
  check(selectedArrow.sel === 'arrow' && selectedArrow.state === 'selected' && selectedArrow.anchors === 0 && selectedArrow.editIcons === 1,
    `expected selected arrow with edit icon: ${JSON.stringify(selectedArrow)}`)

  // Enter arrow node-edit with the visible edit dot, then drag the mid anchor directly.
  const editIcon = await screenOfUiNode(page, '.edit-icon')
  await tap(editIcon)
  await page.waitForFunction(() => window.__tbm.board.interactionState === 'node-edit')
  let mid = await screenOfUiNode(page, '.anchor-mid')
  await drag(mid, { x: mid.x, y: mid.y + 54 })
  const curved = await page.evaluate(() => window.__tbm.store.scene.objects.some(o => o.type === 'arrow' && o.curved))
  check(curved, 'direct mid-anchor drag should curve the arrow')
  check(await selectedNodeCount(page) === 1, 'mobile dragging one node should keep it single-selected')
  mid = await screenOfUiNode(page, '.anchor-mid')
  await drag({ x: mid.x + 70, y: mid.y + 70 }, { x: mid.x + 92, y: mid.y + 88 }, 8)
  const movedMid = await screenOfUiNode(page, '.anchor-mid')
  check(Math.hypot(movedMid.x - mid.x, movedMid.y - mid.y) > 10, `mobile selected node did not move from empty-space drag: ${JSON.stringify({ mid, movedMid })}`)
  await tap({ x: movedMid.x + 70, y: movedMid.y + 70 })
  check(await selectedNodeCount(page) === 0, 'mobile empty tap should clear selected node before marquee')

  let anchors = await anchorScreenPoints(page)
  let minX = Math.min(...anchors.map(p => p.x)), maxX = Math.max(...anchors.map(p => p.x))
  let minY = Math.min(...anchors.map(p => p.y)), maxY = Math.max(...anchors.map(p => p.y))
  await drag({ x: minX - 24, y: minY - 24 }, { x: maxX + 24, y: maxY + 24 }, 8)
  const nodeCount = await selectedNodeCount(page)
  check(nodeCount >= 2, `mobile node marquee should select multiple anchors, got ${nodeCount}`)
  anchors = await anchorScreenPoints(page)
  const beforeNodes = Object.fromEntries(anchors.map(p => [p.name, p]))
  await drag(anchors[0], { x: anchors[0].x + 22, y: anchors[0].y + 18 }, 8)
  const afterNodes = Object.fromEntries((await anchorScreenPoints(page)).map(p => [p.name, p]))
  const movedTogether = Object.keys(beforeNodes).filter(name => afterNodes[name])
    .every(name => Math.hypot(afterNodes[name].x - beforeNodes[name].x, afterNodes[name].y - beforeNodes[name].y) > 10)
  check(movedTogether, `mobile multi-selected nodes did not move together: ${JSON.stringify({ beforeNodes, afterNodes })}`)
  await page.waitForSelector('[data-node-edit-hint]')
  await tap({ x: afterNodes[anchors[0].name].x + 70, y: afterNodes[anchors[0].name].y + 70 })
  await tap({ x: afterNodes[anchors[0].name].x + 70, y: afterNodes[anchors[0].name].y + 70 })
  await page.waitForFunction(() => window.__tbm.board.interactionState !== 'node-edit')

  // Pinch zoom in an empty corner.
  const px = cx + 90, py = cy - 220
  await touch('touchStart', [{ x: px - 40, y: py }, { x: px + 40, y: py }])
  for (let i = 1; i <= 5; i++) {
    await touch('touchMove', [{ x: px - 40 - i * 12, y: py }, { x: px + 40 + i * 12, y: py }])
    await page.waitForTimeout(20)
  }
  await touch('touchEnd', [])
  await page.waitForTimeout(200)
  const zoom = await page.evaluate(() => window.__tbm.board.zoom)
  check(zoom > 1.01, `pinch did not zoom (${zoom})`)

  // Direct press-drag on an unselected player should move it.
  await page.evaluate(() => { window.__tbm.board.resetView(); window.__tbm.store.select(null) })
  await page.waitForTimeout(120)
  const before = await screenOfObject(page, 'player', 0)
  await drag(before, { x: before.x + 44, y: before.y + 34 })
  const after = await page.evaluate((id) => {
    const o = window.__tbm.store.obj(id)
    return { x: o.x, y: o.y, selected: window.__tbm.store.selectedId === id }
  }, before.id)
  check(Math.hypot(after.x - before.board.x, after.y - before.board.y) > 10, `mobile press-drag did not move player: ${JSON.stringify({ before: before.board, after })}`)
  check(!after.selected, 'mobile press-drag should not select; selection only happens on tap')
  await tap(await screenOfObject(page, 'player', 0))
  await page.waitForFunction(() => window.__tbm.store.selected?.type === 'player')

  const resize = await screenOfUiNode(page, '.resize-node')
  const r0 = await page.evaluate(() => window.__tbm.store.selected.r)
  await drag(resize, { x: resize.x + 24, y: resize.y - 24 })
  const r1 = await page.evaluate(() => window.__tbm.store.selected.r)
  check(r1 > r0 + 1, `mobile resize node did not grow player (${r0} -> ${r1})`)

  const exp = await exportSize(page)
  check(exp.w === 2048, `mobile export width ${exp.w}, expected 2048`)
})

await run('tiny', { width: 390, height: 260 }, true, async (page) => {
  const gate = await page.evaluate(() => {
    const el = document.querySelector('.tooSmallScreen')
    return {
      gated: document.body.classList.contains('board-viewport-too-small'),
      display: el ? getComputedStyle(el).display : '',
      text: el?.textContent || '',
    }
  })
  check(gate.gated && gate.display !== 'none' && /View this in browser/.test(gate.text),
    `tiny viewport gate did not show: ${JSON.stringify(gate)}`)
}, { waitForStage: false })

await browser.close()
if (errors.length) {
  console.log(`BOARD_URL=${baseUrl}`)
  console.log('ERRORS:\n' + errors.join('\n'))
  process.exit(1)
}
console.log(`OK ${baseUrl}`)
