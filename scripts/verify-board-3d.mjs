/* The 3D view, checked the only way that means anything: by pressing the real
   toggle in a real browser and then working on the board with the gestures a
   mouse and a finger actually produce.
 *
 * Two failures matter here and neither one shows up in a static read of the
 * source. The first is silent: a turned board still draws, still accepts
 * clicks and still looks right in a screenshot while every tap lands somewhere
 * other than where it was aimed. The second is the one the phone screenshot
 * caught: the board drifts off the usable area and the pitch is half gone. So
 * every check below either compares what the board did against where the
 * pointer really was, or measures the four projected pitch corners against the
 * board area itself. */
import { chromium } from 'playwright-core'
import { chromePath } from './lib/chrome.mjs'

const baseUrl = new URL(process.env.BOARD_URL || 'http://localhost:4173/').href
const errors = []
const notes = []
const check = (ok, msg) => { if (!ok) errors.push(msg); else notes.push(`ok: ${msg}`) }

const browser = await chromium.launch({ executablePath: chromePath, headless: true })

const benign = (t) => /status of 401|tacticsjournal\.com\/api\/|Access to fetch|net::ERR_FAILED|favicon/.test(t)

/** Board coordinates of the one object on the stage. */
const onlyObject = (page) => page.evaluate(() => {
  const objs = window.__tbm.store.scene.objects
  return objs.length === 1 ? { id: objs[0].id, x: objs[0].x, y: objs[0].y } : null
})

/** Where a board point sits on screen right now, straight from the DOM. */
const projectBoardPoint = (page, p) => page.evaluate((pt) => {
  const content = document.querySelector('#stage .konvajs-content')
  const stage = window.__tbm.board.stage ?? null
  const s = window.__tbm.board.screenScale()
  const el = document.createElement('div')
  // A zero-size probe reports its projected position under the CSS transform,
  // which is the whole trick the pointer mapping relies on.
  el.style.cssText = `position:absolute;left:${pt.x * s + (stage ? stage.x() : 0)}px;top:${pt.y * s + (stage ? stage.y() : 0)}px;width:0;height:0;`
  content.appendChild(el)
  const r = el.getBoundingClientRect()
  el.remove()
  return { x: r.left, y: r.top }
}, p)

/**
 * The four real pitch corners, measured through the live CSS camera, against
 * the board area they are promised to stay inside. This is the invariant the
 * whole camera exists to keep, so it is measured and not inferred.
 */
const cornerFit = (page) => page.evaluate(() => {
  const board = window.__tbm.board
  const content = document.querySelector('#stage .konvajs-content')
  const s = board.screenScale(), st = board.stage
  const pts = [[0, 0], [800, 0], [800, board.boardH], [0, board.boardH]].map(([bx, by]) => {
    const el = document.createElement('div')
    el.style.cssText = `position:absolute;left:${bx * s + st.x()}px;top:${by * s + st.y()}px;width:0;height:0;`
    content.appendChild(el)
    const r = el.getBoundingClientRect()
    el.remove()
    return { x: r.left, y: r.top }
  })
  const area = document.querySelector('.boardArea').getBoundingClientRect()
  const bottom = area.bottom - board.bottomInset
  let worst = 0
  for (const p of pts) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return { inside: false, worst: Infinity }
    worst = Math.max(worst, area.left - p.x, p.x - area.right, area.top - p.y, p.y - bottom)
  }
  const w = Math.max(...pts.map(p => p.x)) - Math.min(...pts.map(p => p.x))
  const h = Math.max(...pts.map(p => p.y)) - Math.min(...pts.map(p => p.y))
  return { inside: worst <= 1, worst: Math.round(worst), w: Math.round(w), h: Math.round(h) }
})

const TILT_BUTTON = '[data-ext-action="3d-view:tilt"]'
const camera = (page) => page.evaluate(() => window.__tbm.board.get3DCamera())

async function run(name, viewport, isMobile, actions) {
  const ctx = await browser.newContext({ viewport, isMobile, hasTouch: isMobile, deviceScaleFactor: isMobile ? 2 : 1 })
  const page = await ctx.newPage()
  page.setDefaultTimeout(20000)
  page.on('pageerror', e => errors.push(`[${name}] ${e.message}`))
  page.on('console', m => { if (m.type() === 'error' && !benign(m.text())) errors.push(`[${name}] console: ${m.text()}`) })
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 45000 })
  await page.waitForFunction(() => window.__tbm?.board && window.__tbm?.store)
  await page.waitForFunction(() => {
    const r = document.querySelector('#stage')?.getBoundingClientRect()
    return !!r && r.width > 100 && r.height > 100
  })
  await page.waitForTimeout(700)
  try { await actions(page) } catch (e) { errors.push(`[${name}] threw: ${String(e.message || e).split('\n').slice(0, 3).join(' | ')}`) }
  await ctx.close()
}

const enter3D = async (page, label) => {
  await page.click(TILT_BUTTON)
  await page.waitForTimeout(450)
  check(await page.getAttribute(TILT_BUTTON, 'aria-pressed') === 'true', `${label}: the toggle reports pressed in 3D`)
  check(await page.evaluate(() => document.querySelector('#stage').classList.contains('is3d')), `${label}: the stage carries the camera`)
  check(await page.evaluate(() => document.querySelector('.boardArea').classList.contains('is3d')), `${label}: the board area carries the contrasting mat`)
  check(await page.evaluate(() => window.__tbm.board.is3D() === true), `${label}: the board agrees it is in 3D`)
  const transformed = await page.evaluate(() => {
    const t = getComputedStyle(document.querySelector('#stage .konvajs-content')).transform
    return t && t !== 'none' && t.startsWith('matrix3d')
  })
  check(transformed, `${label}: the live Konva content is what got turned`)
  // Only a reset and a hint sit over the board, and neither may reach the
  // bottom controls or grow into a control panel.
  check(await page.evaluate(() => {
    const b = document.querySelector('#boardReset').getBoundingClientRect()
    const area = document.querySelector('.boardArea').getBoundingClientRect()
    const stage = document.querySelector('#stage')
    return b.width >= 44 && b.height >= 44
      && b.bottom <= area.bottom - window.__tbm.board.bottomInset
      && !stage.contains(document.querySelector('#boardReset'))
  }), `${label}: one 44px reset sits outside the stage and clear of the bottom controls`)
  check(await page.evaluate(() => getComputedStyle(document.querySelector('#boardHint')).pointerEvents === 'none'), `${label}: the hint never takes a tap`)
  check(await page.evaluate(() => /orbit/i.test(document.querySelector('#boardHint').textContent || '')), `${label}: the hint names the gesture`)
  const fit = await cornerFit(page)
  check(fit.inside, `${label}: the whole pitch is inside the board area on entry (worst overshoot ${fit.worst}px)`)
  const copies = await page.evaluate(() => document.querySelectorAll('#stage canvas').length)
  check(copies > 0 && copies < 12, `${label}: no second renderer appeared (${copies} canvases)`)
}

const leave3D = async (page, label) => {
  await page.click(TILT_BUTTON)
  await page.waitForTimeout(450)
  check(await page.getAttribute(TILT_BUTTON, 'aria-pressed') === 'false', `${label}: the toggle reports unpressed in 2D`)
  check(await page.evaluate(() => !document.querySelector('#stage').classList.contains('is3d')), `${label}: the camera class is gone`)
  check(await page.evaluate(() => !document.querySelector('.boardArea').classList.contains('is3d')), `${label}: the mat is gone`)
  const flatT = await page.evaluate(() => getComputedStyle(document.querySelector('#stage .konvajs-content')).transform)
  check(flatT === 'none' || flatT === 'matrix(1, 0, 0, 1, 0, 0)', `${label}: the content is flat again (${flatT})`)
  check(await page.evaluate(() => window.__tbm.board.isFitView()), `${label}: 2D comes back at its ordinary fit`)
}

/** Drop one player in the middle of the pitch and clear anything else. */
async function seedPlayer(page) {
  await page.evaluate(() => {
    const store = window.__tbm.store
    store.apply(s => {
      s.objects.length = 0
      s.objects.push({
        id: 'probe', type: 'player', x: 400, y: 300, r: 20, color: '#e02020',
        label: '9', name: 'Probe', namePos: 'bottom', nameSize: 12, nameDisplay: 'first',
      })
    })
    store.select(null)
  })
  await page.waitForTimeout(280)
}

/* ---------- desktop, mouse ---------- */
await run('desktop', { width: 1280, height: 900 }, false, async (page) => {
  check(await page.evaluate(() => !window.__tbm.board.is3D()), 'desktop: 2D is the default')
  check(await page.evaluate(() => window.__tbm.officialExtensions.isEnabled('3d-view') === false), 'desktop: 3D View is disabled by default')
  check(await page.locator(TILT_BUTTON).count() === 0, 'desktop: a disabled extension adds no top tool')
  await page.evaluate(() => window.__tbm.officialExtensions.setEnabled('3d-view', true))
  check(await page.evaluate(() => {
    const b = document.querySelector('[data-ext-action="3d-view:tilt"]')
    return !!b && b.getAttribute('aria-label')?.includes('3D') && !!b.title
  }), 'desktop: enabling adds the labelled top tool')

  await seedPlayer(page)
  await enter3D(page, 'desktop')

  /* --- the camera moves, and only from gestures --- */
  await page.evaluate(() => window.__tbm.store.select(null))
  const empty = await projectBoardPoint(page, { x: 120, y: 120 })
  const camStart = await camera(page)
  await page.mouse.move(empty.x, empty.y)
  await page.mouse.down()
  await page.mouse.move(empty.x + 140, empty.y, { steps: 10 })
  await page.mouse.up()
  await page.waitForTimeout(220)
  const camYaw = await camera(page)
  check(Math.abs(camYaw.yaw - camStart.yaw) > 8, `desktop 3D: a horizontal empty drag orbits the yaw (${camStart.yaw} -> ${camYaw.yaw.toFixed(1)})`)
  check(Math.abs(camYaw.tilt - camStart.tilt) < 1, 'desktop 3D: a horizontal drag leaves the tilt alone')

  await page.mouse.move(empty.x, empty.y)
  await page.mouse.down()
  await page.mouse.move(empty.x, empty.y - 120, { steps: 10 })
  await page.mouse.up()
  await page.waitForTimeout(220)
  const camTilt = await camera(page)
  check(Math.abs(camTilt.tilt - camYaw.tilt) > 8, `desktop 3D: a vertical empty drag orbits the tilt (${camYaw.tilt.toFixed(1)} -> ${camTilt.tilt.toFixed(1)})`)
  check(await page.evaluate(() => document.querySelector('#boardHint').classList.contains('used')), 'desktop 3D: the first gesture puts the hint away')
  check(await page.evaluate(() => window.__tbm.store.scene.objects.length === 1), 'desktop 3D: orbiting changed nothing in the scene')

  /* --- the wheel is camera zoom, not stage pan and not page scroll --- */
  const stageBefore = await page.evaluate(() => ({ x: window.__tbm.board.stage.x(), y: window.__tbm.board.stage.y(), s: window.__tbm.board.screenScale() }))
  await page.mouse.move(empty.x, empty.y)
  await page.mouse.wheel(0, 240)
  await page.waitForTimeout(250)
  const camZoomOut = await camera(page)
  check(camZoomOut.zoom < camTilt.zoom - 0.02, `desktop 3D: a wheel changes the camera zoom (${camTilt.zoom.toFixed(3)} -> ${camZoomOut.zoom.toFixed(3)})`)
  const stageAfterWheel = await page.evaluate(() => ({ x: window.__tbm.board.stage.x(), y: window.__tbm.board.stage.y(), s: window.__tbm.board.screenScale() }))
  check(Math.abs(stageAfterWheel.s - stageBefore.s) < 1e-6, 'desktop 3D: the wheel is camera zoom, not Konva stage zoom')
  await page.mouse.wheel(0, -240)
  await page.waitForTimeout(250)
  check((await camera(page)).zoom > camZoomOut.zoom, 'desktop 3D: the wheel zooms back in as well')

  /* --- no camera the gestures can reach loses a corner --- */
  // Clear the board first. A screen point that was empty pitch before an orbit
  // may be sitting over a player after it, and that drag would be an edit.
  await page.evaluate(() => { window.__tbm.store.apply(s => { s.objects.length = 0 }); window.__tbm.store.select(null) })
  await page.waitForTimeout(200)
  const orbitYaws = []
  for (const [dx, dy] of [[900, -700], [-1800, 900], [900, -900], [1400, 1400]]) {
    const from = await projectBoardPoint(page, { x: 400, y: 300 })
    await page.mouse.move(from.x, from.y)
    await page.mouse.down()
    await page.mouse.move(from.x + dx / 2, from.y + dy / 2, { steps: 8 })
    await page.mouse.move(from.x + dx, from.y + dy, { steps: 8 })
    await page.mouse.up()
    await page.waitForTimeout(200)
    orbitYaws.push((await camera(page)).yaw)
    const fit = await cornerFit(page)
    check(fit.inside, `desktop 3D: the pitch stays whole after an aggressive orbit ${dx}/${dy} (worst ${fit.worst}px)`)
  }
  check(orbitYaws.some(yaw => Math.abs(yaw) > 60), `desktop 3D: orbit passes the old 60° stop (${orbitYaws.map(yaw => yaw.toFixed(1)).join(', ')})`)
  const camClamped = await camera(page)
  check(camClamped.yaw >= -180 && camClamped.yaw < 180 && camClamped.tilt >= 0 && camClamped.tilt <= 66, `desktop 3D: bounded fields stay inside their range (${JSON.stringify(camClamped)})`)

  const fullTurn = []
  let fullTurnFits = true
  for (const heading of [0, 90, 180, 270, 360]) {
    await page.evaluate(yaw => window.__tbm.board.set3DCamera({ yaw }), heading)
    await page.waitForTimeout(60)
    fullTurn.push((await camera(page)).yaw)
    fullTurnFits &&= (await cornerFit(page)).inside
  }
  check(JSON.stringify(fullTurn) === JSON.stringify([0, 90, -180, -90, 0]), `desktop 3D: camera completes a full 360° orbit (${fullTurn.join(', ')})`)
  check(fullTurnFits, 'desktop 3D: the whole pitch stays visible through the full turn')

  await page.click('#boardReset')
  await page.waitForTimeout(320)
  const camReset = await camera(page)
  check(camReset.yaw === 0 && camReset.tilt === 38, `desktop 3D: reset puts the camera back (${JSON.stringify(camReset)})`)

  /* --- editing is still exact after the camera has moved --- */
  await seedPlayer(page)
  const nudge = await projectBoardPoint(page, { x: 120, y: 120 })
  await page.mouse.move(nudge.x, nudge.y)
  await page.mouse.down()
  await page.mouse.move(nudge.x + 90, nudge.y - 60, { steps: 8 })
  await page.mouse.up()
  await page.waitForTimeout(250)

  const at = await projectBoardPoint(page, { x: 400, y: 300 })
  await page.mouse.click(at.x, at.y)
  await page.waitForTimeout(220)
  const selAfterOrbit = await page.evaluate((at) => {
    const stage = window.__tbm.board.stage
    stage.setPointersPositions({ clientX: at.x, clientY: at.y, pointerId: 999 })
    const pointer = stage.getPointerPosition()
    const hit = pointer ? stage.getIntersection(pointer) : null
    return {
      sel: window.__tbm.store.selectedId,
      objs: window.__tbm.store.scene.objects.map(o => `${o.type}@${Math.round(o.x)},${Math.round(o.y)}`),
      target: document.elementFromPoint(at.x, at.y)?.tagName,
      pointer,
      hit: hit?.getParent()?.id() || hit?.id() || null,
    }
  }, at)
  check(selAfterOrbit.sel === 'probe', `desktop 3D: a click on the player selects the player after an orbit (${JSON.stringify(selAfterOrbit)})`)

  await seedPlayer(page)
  const camBeforeDrag = await camera(page)
  const dragAt = await projectBoardPoint(page, { x: 400, y: 300 })
  const target = { x: 250, y: 430 }
  const to = await projectBoardPoint(page, target)
  await page.mouse.move(dragAt.x, dragAt.y)
  await page.mouse.down()
  await page.mouse.move((dragAt.x + to.x) / 2, (dragAt.y + to.y) / 2, { steps: 6 })
  await page.mouse.move(to.x, to.y, { steps: 6 })
  await page.mouse.up()
  await page.waitForTimeout(250)
  const moved = await onlyObject(page)
  const off = moved ? Math.hypot(moved.x - target.x, moved.y - target.y) : Infinity
  check(off < 14, `desktop 3D: the drag lands on the intended board point (off by ${off.toFixed(1)} board px)`)
  const camAfterDrag = await camera(page)
  check(camAfterDrag.yaw === camBeforeDrag.yaw && camAfterDrag.tilt === camBeforeDrag.tilt && camAfterDrag.zoom === camBeforeDrag.zoom,
    'desktop 3D: dragging an object edits the object and never moves the camera')

  // Empty-pitch placement uses the intended point too.
  await page.evaluate(() => window.__tbm.store.select(null))
  await page.evaluate(() => window.__tbm.board.setTool('ball'))
  await page.waitForTimeout(160)
  const spot = { x: 560, y: 200 }
  const place = await projectBoardPoint(page, spot)
  const before = await page.evaluate(() => window.__tbm.store.scene.objects.length)
  await page.mouse.click(place.x, place.y)
  await page.waitForTimeout(250)
  const after = await page.evaluate(() => window.__tbm.store.scene.objects)
  check(after.length > before, 'desktop 3D: an empty-board tap places an object')
  if (after.length > before) {
    const added = after[after.length - 1]
    const d = Math.hypot(added.x - spot.x, added.y - spot.y)
    check(d < 16, `desktop 3D: a placed object lands where it was aimed (off by ${d.toFixed(1)} board px)`)
  }

  /* --- an armed draw tool still draws on empty space, it does not orbit --- */
  await page.evaluate(() => window.__tbm.board.setTool('arrow'))
  await page.waitForTimeout(160)
  const lineStart = await projectBoardPoint(page, { x: 620, y: 220 })
  const lineEnd = await projectBoardPoint(page, { x: 720, y: 300 })
  const arrowsBefore = await page.evaluate(() => window.__tbm.store.scene.objects.filter(o => o.type === 'arrow').length)
  await page.mouse.move(lineStart.x, lineStart.y)
  await page.mouse.down()
  await page.mouse.move(lineEnd.x, lineEnd.y, { steps: 8 })
  await page.mouse.up()
  await page.waitForTimeout(250)
  const arrowsAfter = await page.evaluate(() => window.__tbm.store.scene.objects.filter(o => o.type === 'arrow').length)
  check(arrowsAfter > arrowsBefore, 'desktop 3D: an armed arrow tool draws on empty space instead of orbiting')
  const camAfterDraw = await camera(page)
  check(camAfterDraw.yaw === camAfterDrag.yaw && camAfterDraw.tilt === camAfterDrag.tilt, 'desktop 3D: drawing left the camera exactly where it was')

  // Zones are the other armed draw tool on empty space.
  await page.evaluate(() => window.__tbm.board.setTool('box'))
  await page.waitForTimeout(160)
  const zoneA = await projectBoardPoint(page, { x: 200, y: 200 })
  const zoneB = await projectBoardPoint(page, { x: 340, y: 330 })
  const boxesBefore = await page.evaluate(() => window.__tbm.store.scene.objects.filter(o => o.type === 'box').length)
  await page.mouse.move(zoneA.x, zoneA.y)
  await page.mouse.down()
  await page.mouse.move(zoneB.x, zoneB.y, { steps: 8 })
  await page.mouse.up()
  await page.waitForTimeout(250)
  const boxesAfter = await page.evaluate(() => window.__tbm.store.scene.objects.filter(o => o.type === 'box').length)
  check(boxesAfter > boxesBefore, 'desktop 3D: an armed zone tool still draws a zone')

  /* --- a resize refits rather than cropping --- */
  await page.setViewportSize({ width: 900, height: 620 })
  // Crossing the 1024px layout query moves the desktop rail into the mobile
  // toolbar before Board gets its final container size.
  await page.waitForTimeout(1000)
  const fitResized = await cornerFit(page)
  check(fitResized.inside, `desktop 3D: the pitch survives a resize (worst ${fitResized.worst}px)`)
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.waitForTimeout(1000)

  await page.evaluate(() => { window.__tbm.store.apply(s => { s.objects.length = 0 }); window.__tbm.store.select(null) })
  await page.evaluate(() => window.__tbm.board.setTool('player'))
  await page.waitForTimeout(250)
  await page.screenshot({ path: '/tmp/tbm-3d-desktop.png' })
  await leave3D(page, 'desktop')

  // 2D must behave exactly as before: a click selects, a drag moves.
  await page.evaluate(() => window.__tbm.board.setTool('player'))
  await seedPlayer(page)
  const flatAt = await projectBoardPoint(page, { x: 400, y: 300 })
  await page.mouse.click(flatAt.x, flatAt.y)
  await page.waitForTimeout(220)
  check(await page.evaluate(() => window.__tbm.store.selectedId) === 'probe', 'desktop 2D: a click still selects after the round trip')
  await seedPlayer(page)
  const flatTo = await projectBoardPoint(page, { x: 520, y: 380 })
  await page.mouse.move(flatAt.x, flatAt.y)
  await page.mouse.down()
  await page.mouse.move(flatTo.x, flatTo.y, { steps: 10 })
  await page.mouse.up()
  await page.waitForTimeout(250)
  const flatMoved = await onlyObject(page)
  const flatOff = flatMoved ? Math.hypot(flatMoved.x - 520, flatMoved.y - 380) : Infinity
  check(flatOff < 6, `desktop 2D: a drag still lands exactly where aimed (off by ${flatOff.toFixed(1)} board px)`)

  // 2D pan is untouched: an empty drag still moves a zoomed stage.
  await page.evaluate(() => { window.__tbm.store.select(null); window.__tbm.board.zoomBy(1.6) })
  await page.waitForTimeout(250)
  const panBefore = await page.evaluate(() => ({ x: window.__tbm.board.stage.x(), y: window.__tbm.board.stage.y() }))
  const panAt = await projectBoardPoint(page, { x: 120, y: 120 })
  await page.mouse.move(panAt.x, panAt.y)
  await page.mouse.down()
  await page.mouse.move(panAt.x + 60, panAt.y + 40, { steps: 8 })
  await page.mouse.up()
  await page.waitForTimeout(250)
  const panAfter = await page.evaluate(() => ({ x: window.__tbm.board.stage.x(), y: window.__tbm.board.stage.y() }))
  check(Math.hypot(panAfter.x - panBefore.x, panAfter.y - panBefore.y) > 4, 'desktop 2D: empty-space drag still pans a zoomed stage')
  await page.evaluate(() => window.__tbm.board.resetView())
  await page.waitForTimeout(250)
  await page.screenshot({ path: '/tmp/tbm-3d-desktop-back-to-2d.png' })
})

/* ---------- phone, touch ---------- */
await run('phone', { width: 390, height: 844 }, true, async (page) => {
  check(await page.locator(TILT_BUTTON).count() === 0, 'phone: 3D View is disabled by default')
  await page.evaluate(() => window.__tbm.officialExtensions.setEnabled('3d-view', true))
  check(await page.locator(TILT_BUTTON).count() === 1, 'phone: enabling adds the top tool')
  await seedPlayer(page)
  await enter3D(page, 'phone')

  // One CDP session drives every finger in this run. Mixing it with
  // Playwright's own touch input leaves the browser holding a stale contact,
  // and the next drag arrives as a second finger instead of a first.
  const cdp = await page.context().newCDPSession(page)
  const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', {
    type,
    touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }],
  })
  const pinch = (type, a, b) => cdp.send('Input.dispatchTouchEvent', {
    type,
    touchPoints: type === 'touchEnd' ? [] : [{ x: a.x, y: a.y, id: 1 }, { x: b.x, y: b.y, id: 2 }],
  })
  const tap = async (x, y) => {
    await touch('touchStart', x, y)
    await page.waitForTimeout(40)
    await touch('touchEnd', x, y)
    await page.waitForTimeout(220)
  }
  const drag = async (from, dx, dy, steps = 8) => {
    await touch('touchStart', from.x, from.y)
    await page.waitForTimeout(40)
    for (let i = 1; i <= steps; i++) {
      await touch('touchMove', from.x + (dx * i) / steps, from.y + (dy * i) / steps)
      await page.waitForTimeout(22)
    }
    await touch('touchEnd', from.x + dx, from.y + dy)
    await page.waitForTimeout(220)
  }

  /* --- one finger on empty pitch orbits --- */
  await page.evaluate(() => window.__tbm.store.select(null))
  const empty = await projectBoardPoint(page, { x: 90, y: 90 })
  const camStart = await camera(page)
  await drag(empty, 90, 0)
  const camYaw = await camera(page)
  check(Math.abs(camYaw.yaw - camStart.yaw) > 8, `phone 3D: a one-finger empty drag orbits the yaw (${camStart.yaw} -> ${camYaw.yaw.toFixed(1)})`)
  await drag(empty, 0, -70)
  const camTilt = await camera(page)
  check(Math.abs(camTilt.tilt - camYaw.tilt) > 8, `phone 3D: a one-finger empty drag orbits the tilt (${camYaw.tilt.toFixed(1)} -> ${camTilt.tilt.toFixed(1)})`)
  check(await page.evaluate(() => window.__tbm.store.scene.objects.length === 1), 'phone 3D: orbiting changed nothing in the scene')

  /* --- pinch is camera zoom around the centred board --- */
  const centre = await projectBoardPoint(page, { x: 400, y: 300 })
  const zoomBefore = (await camera(page)).zoom
  await pinch('touchStart', { x: centre.x - 70, y: centre.y }, { x: centre.x + 70, y: centre.y })
  for (let i = 1; i <= 6; i++) {
    await pinch('touchMove', { x: centre.x - 70 + i * 9, y: centre.y }, { x: centre.x + 70 - i * 9, y: centre.y })
    await page.waitForTimeout(26)
  }
  await pinch('touchEnd', { x: centre.x, y: centre.y }, { x: centre.x, y: centre.y })
  await page.waitForTimeout(280)
  const zoomOut = (await camera(page)).zoom
  check(zoomOut < zoomBefore - 0.02, `phone 3D: a pinch in zooms the camera out (${zoomBefore.toFixed(3)} -> ${zoomOut.toFixed(3)})`)
  const fitPinch = await cornerFit(page)
  check(fitPinch.inside, `phone 3D: the pitch is still whole after a pinch (worst ${fitPinch.worst}px)`)

  await pinch('touchStart', { x: centre.x - 20, y: centre.y }, { x: centre.x + 20, y: centre.y })
  for (let i = 1; i <= 6; i++) {
    await pinch('touchMove', { x: centre.x - 20 - i * 12, y: centre.y }, { x: centre.x + 20 + i * 12, y: centre.y })
    await page.waitForTimeout(26)
  }
  await pinch('touchEnd', { x: centre.x, y: centre.y }, { x: centre.x, y: centre.y })
  await page.waitForTimeout(280)
  check((await camera(page)).zoom > zoomOut, 'phone 3D: a pinch out zooms the camera back in')

  /* --- no gesture, however hard, loses a corner --- */
  await page.evaluate(() => { window.__tbm.store.apply(s => { s.objects.length = 0 }); window.__tbm.store.select(null) })
  await page.waitForTimeout(200)
  for (const [dx, dy] of [[300, -300], [-600, 300], [300, 300], [-300, -300]]) {
    const from = await projectBoardPoint(page, { x: 400, y: 300 })
    await drag(from, dx, dy, 10)
    const fit = await cornerFit(page)
    check(fit.inside, `phone 3D: the pitch stays whole after an aggressive orbit ${dx}/${dy} (worst ${fit.worst}px)`)
  }

  /* --- editing is still exact after the camera has moved --- */
  await seedPlayer(page)
  const at = await projectBoardPoint(page, { x: 400, y: 300 })
  await tap(at.x, at.y)
  check(await page.evaluate(() => window.__tbm.store.selectedId) === 'probe', 'phone 3D: a tap on the player selects the player after an orbit')

  await seedPlayer(page)
  const camBeforeDrag = await camera(page)
  const target = { x: 300, y: 420 }
  const dragAt = await projectBoardPoint(page, { x: 400, y: 300 })
  const to = await projectBoardPoint(page, target)
  await drag(dragAt, to.x - dragAt.x, to.y - dragAt.y, 8)
  const moved = await onlyObject(page)
  const off = moved ? Math.hypot(moved.x - target.x, moved.y - target.y) : Infinity
  check(off < 16, `phone 3D: the touch drag lands on the intended board point (off by ${off.toFixed(1)} board px)`)
  const camAfterDrag = await camera(page)
  check(camAfterDrag.yaw === camBeforeDrag.yaw && camAfterDrag.tilt === camBeforeDrag.tilt,
    'phone 3D: dragging an object edits the object and never moves the camera')

  /* --- Transformer handles stay grabbable and accurate --- */
  await seedPlayer(page)
  const anchor = await page.evaluate(() => {
    window.__tbm.store.select('probe')
    return window.__tbm.store.scene.objects[0].r
  })
  await page.waitForTimeout(250)
  // store.select above is enough to attach the handle. Do not tap the object
  // first, because that starts the ordinary move gesture on some touch builds.
  // The custom resize handle is just beyond the selection's top-right corner.
  const grab = await projectBoardPoint(page, { x: 400 + anchor + 5, y: 300 - anchor - 5 })
  const pull = await projectBoardPoint(page, { x: 400 + anchor * 4 + 5, y: 300 - anchor * 4 - 5 })
  await drag(grab, pull.x - grab.x, pull.y - grab.y, 8)
  const resized = await page.evaluate(() => window.__tbm.store.scene.objects[0].r)
  check(resized > anchor + 2, `phone 3D: a Transformer handle still resizes (r ${anchor} -> ${resized.toFixed(1)})`)

  /* --- an armed draw tool still draws rather than orbiting --- */
  await page.evaluate(() => window.__tbm.store.select(null))
  await page.evaluate(() => window.__tbm.board.setTool('arrow'))
  await page.waitForTimeout(200)
  const lineStart = await projectBoardPoint(page, { x: 620, y: 220 })
  const lineEnd = await projectBoardPoint(page, { x: 700, y: 300 })
  const arrowsBefore = await page.evaluate(() => window.__tbm.store.scene.objects.filter(o => o.type === 'arrow').length)
  await drag(lineStart, lineEnd.x - lineStart.x, lineEnd.y - lineStart.y, 8)
  const arrowsAfter = await page.evaluate(() => window.__tbm.store.scene.objects.filter(o => o.type === 'arrow').length)
  check(arrowsAfter > arrowsBefore, 'phone 3D: an armed arrow tool draws on empty space instead of orbiting')

  await page.evaluate(() => window.__tbm.board.setTool('box'))
  await page.waitForTimeout(200)
  const zoneA = await projectBoardPoint(page, { x: 200, y: 200 })
  const zoneB = await projectBoardPoint(page, { x: 340, y: 340 })
  const boxesBefore = await page.evaluate(() => window.__tbm.store.scene.objects.filter(o => o.type === 'box').length)
  await drag(zoneA, zoneB.x - zoneA.x, zoneB.y - zoneA.y, 8)
  const boxesAfter = await page.evaluate(() => window.__tbm.store.scene.objects.filter(o => o.type === 'box').length)
  check(boxesAfter > boxesBefore, 'phone 3D: an armed zone tool still draws a zone')

  /* --- an orientation change refits rather than cropping --- */
  await page.setViewportSize({ width: 844, height: 390 })
  await page.waitForTimeout(700)
  const fitLandscape = await cornerFit(page)
  check(fitLandscape.inside, `phone 3D: the pitch survives turning the phone landscape (worst ${fitLandscape.worst}px)`)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.waitForTimeout(700)
  const fitPortrait = await cornerFit(page)
  check(fitPortrait.inside, `phone 3D: and turning it back to portrait (worst ${fitPortrait.worst}px)`)
  // The board must still be worth using, not a compressed strip.
  const area = await page.evaluate(() => {
    const r = document.querySelector('.boardArea').getBoundingClientRect()
    return { w: r.width, h: r.height - window.__tbm.board.bottomInset }
  })
  check(fitPortrait.w > area.w * 0.75, `phone 3D: the board still fills the width it can (${fitPortrait.w} of ${Math.round(area.w)}px)`)
  check(fitPortrait.h > 120, `phone 3D: the board is not a compressed strip (${fitPortrait.h}px tall)`)

  await page.click('#boardReset')
  await page.waitForTimeout(320)
  const camReset = await camera(page)
  check(camReset.yaw === 0 && camReset.tilt === 38, `phone 3D: reset puts the camera back (${JSON.stringify(camReset)})`)

  await page.evaluate(() => { window.__tbm.store.apply(s => { s.objects.length = 0 }); window.__tbm.store.select(null); window.__tbm.board.setTool('player') })
  await seedPlayer(page)
  await page.screenshot({ path: '/tmp/tbm-3d-phone.png' })
  await leave3D(page, 'phone')

  // Touch must return to the ordinary rectangle mapping as well.
  await seedPlayer(page)
  const flatAt = await projectBoardPoint(page, { x: 400, y: 300 })
  await tap(flatAt.x, flatAt.y)
  check(await page.evaluate(() => window.__tbm.store.selectedId) === 'probe', 'phone 2D: a tap still selects after the round trip')
  await seedPlayer(page)
  const flatTarget = { x: 520, y: 380 }
  const flatDragAt = await projectBoardPoint(page, { x: 400, y: 300 })
  const flatTo = await projectBoardPoint(page, flatTarget)
  await drag(flatDragAt, flatTo.x - flatDragAt.x, flatTo.y - flatDragAt.y, 8)
  const flatMoved = await onlyObject(page)
  const flatOff = flatMoved ? Math.hypot(flatMoved.x - flatTarget.x, flatMoved.y - flatTarget.y) : Infinity
  check(flatOff < 6, `phone 2D: a drag still lands exactly where aimed (off by ${flatOff.toFixed(1)} board px)`)
  await page.screenshot({ path: '/tmp/tbm-3d-phone-back-to-2d.png' })
})

await browser.close()

for (const n of notes) console.log(n)
if (errors.length) {
  console.error('\nFAILED:')
  for (const e of errors) console.error(' - ' + e)
  process.exit(1)
}
console.log('\n3D board view: all checks passed')
