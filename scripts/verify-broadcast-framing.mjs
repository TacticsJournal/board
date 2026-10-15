// A held board is the shape of the board, and its controls sit under it.
//  - board one is a tall broadcast, board two is a 16:9 one with a named player
//  - at rest on 2 / 2 the stage ends at the photograph, the bar begins there
//  - stage and viewBox agree at every moment, so nothing is ever stretched
import { writeFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'
import { chromium } from 'playwright-core'
import { chromePath } from './lib/chrome.mjs'

/** A 16:9 picture no pitch art could be mistaken for. */
function stripes(path, w, h) {
  const rows = Buffer.alloc((w * 3 + 1) * h)
  let at = 0
  for (let y = 0; y < h; y++) {
    rows[at++] = 0
    for (let x = 0; x < w; x++) {
      const band = Math.floor(x / 100) % 2
      rows[at++] = 30 + band * 20
      rows[at++] = 110 + band * 30
      rows[at++] = 40 + band * 20
    }
  }
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data])
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
    const crcTable = chunk.table ??= [...Array(256).keys()].map(n => {
      for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1
      return n >>> 0
    })
    let crc = 0xffffffff
    for (const byte of body) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8)
    const tail = Buffer.alloc(4); tail.writeUInt32BE((crc ^ 0xffffffff) >>> 0)
    return Buffer.concat([len, body, tail])
  }
  const head = Buffer.alloc(13)
  head.writeUInt32BE(w, 0); head.writeUInt32BE(h, 4)
  head[8] = 8; head[9] = 2
  writeFileSync(path, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', head), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0)),
  ]))
  return path
}

const tallShot = new URL('../assets/pitch/pitch_up_marked.jpeg', import.meta.url).pathname  // 0.80 tall
const wideShot = stripes('/tmp/tbm-wide-169.png', 1600, 900)                               // 16:9

const browser = await chromium.launch({ executablePath: chromePath, headless: true })
const errors = []
const check = (ok, msg) => { if (!ok) errors.push(msg) }

const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
const page = await ctx.newPage()
page.on('pageerror', e => errors.push(`pageerror: ${e.message}`))
page.on('dialog', d => d.accept())
await page.goto(process.env.BOARD_URL ?? 'http://localhost:4173/')
await page.waitForFunction(() => window.__tbm?.board && window.__tbm?.store, null, { timeout: 20000 })
// localhost fails closed on entitlements, and an upload is a licensed path
await page.evaluate(() => window.__tbm.entitlements.setServerEntitlement(true))
await page.waitForTimeout(600)

const pushScreen = async (screen) => {
  const atRoot = await page.evaluate(() => {
    const root = document.querySelector('[data-pane="root"]')
    return !!root && !root.classList.contains('hidden')
  })
  if (!atRoot) { await page.click('.setBack'); await page.waitForTimeout(80) }
  await page.locator(`[data-goto="${screen}"]`).first().click()
  await page.waitForTimeout(200)
}

async function addBackground(kind, file) {
  await page.click('[data-bar="settings"]')
  await pushScreen('pitch')
  await page.click('[data-bg-add]')
  await page.waitForTimeout(250)
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser', { timeout: 5000 }),
    page.click(`[data-kind="${kind}"]`),
  ])
  await chooser.setFiles(file)
  await page.waitForTimeout(2200)
  const id = await page.evaluate(() => window.__tbm.store.scene.pitch)
  await page.click('[data-set="close"]').catch(() => {})
  await page.waitForTimeout(250)
  return id
}

const putPlayer = (name, x, y) => page.evaluate(({ name, x, y }) => {
  window.__tbm.store.apply(s => {
    s.objects.push({
      id: `p-${name}`, type: 'player', x, y, r: 13, color: '#f2f2f2',
      label: '', name, namePos: 'bottom', nameSize: 18, nameDisplay: 'last',
      flipX: false, flipY: false,
    })
  })
}, { name, x, y })

/** A live marker: the photograph of a player, hung on its ground ellipse. */
const putMarker = (name, x, y, w) => page.evaluate(({ name, x, y, w }) => {
  window.__tbm.store.apply(s => {
    s.objects.push({
      id: `m-${name}`, type: 'marker', x, y, w, name, namePos: 'bottom',
      flipX: false, flipY: false, rotation: 0,
    })
  })
}, { name, x, y, w })

const openBoards = async () => {
  const open = await page.evaluate(() => !document.querySelector('#libRoot').hidden)
  if (!open) await page.click('[data-top="boards"]')
  await page.waitForTimeout(400)
}

// board one: a tall broadcast. board two: the 16:9 broadcast, with a name on it.
const tallId = await addBackground('broadcast', tallShot)
check(tallId?.startsWith('bg:'), `board one on an uploaded broadcast (${tallId})`)
await putPlayer('Rogers', 400, 300)
await putMarker('Rogers', 400, 430, 120)
await page.waitForTimeout(400)
await openBoards()
await page.click('.libFoot [data-act="add"]')
await page.waitForTimeout(250)
await page.click('[data-add="copy"]')
await page.waitForTimeout(500)
const wideId = await addBackground('broadcast', wideShot)
check(wideId?.startsWith('bg:') && wideId !== tallId, `board two on the 16:9 broadcast (${wideId})`)
await page.waitForTimeout(400)

// the film is one size of picture: each frame is captured through a crop of
// its own view, so the canvas that comes back is already the film's shape and
// is drawn at one scale in both directions
const capture = await page.evaluate(() => {
  const scene = window.__tbm.store.scene
  const view = { x: 0, y: 0, w: 800, h: scene.board.h }
  const aspect = 0.8                                   // the taller board's shape
  const w = Math.min(view.w, view.h / aspect)
  const h = Math.min(view.h, view.w * aspect)
  const crop = { x: view.x + (view.w - w) / 2, y: view.y + (view.h - h) / 2, w, h }
  const shot = window.__tbm.board.toFrameCanvas(600, crop)
  return { crop, canvas: { w: shot.width, h: shot.height }, boardH: scene.board.h }
})
check(Math.abs(capture.canvas.h / capture.canvas.w - capture.crop.h / capture.crop.w) < 0.01,
  `a captured frame should come back at the crop's shape (${JSON.stringify(capture)})`)
check(Math.abs(600 / capture.canvas.w - Math.round(600 * 0.8) / capture.canvas.h) < 0.01,
  `the two scales that draw it into the film should match (${JSON.stringify(capture)})`)

await openBoards()
await page.click('.libFoot [data-act="play"]')
await page.waitForTimeout(900)

const measure = () => page.evaluate(() => {
  const stage = document.querySelector('[data-play="stage"]')
  const bar = document.querySelector('.seqPlayer__bar')
  const svg = document.querySelector('[data-play="svg"]')
  const s = stage.getBoundingClientRect()
  const b = bar.getBoundingClientRect()
  const box = (svg.getAttribute('viewBox') || '').split(' ').map(Number)
  return {
    stage: { w: +s.width.toFixed(2), h: +s.height.toFixed(2), top: +s.top.toFixed(2), bottom: +s.bottom.toFixed(2) },
    barTop: +b.top.toFixed(2),
    viewBox: box,
    ground: document.querySelector('[data-play="ground"] image')?.getAttribute('href')?.slice(0, 24) ?? '',
    marks: document.querySelectorAll('[data-play="shapes"] > *').length,
    count: document.querySelector('[data-play="count"]').textContent.trim(),
  }
})
const agrees = (m) => Math.abs((m.viewBox[3] / m.viewBox[2]) - (m.stage.h / m.stage.w)) < 0.01

const start = await measure()
await page.screenshot({ path: '/tmp/tbm-framing-board1.png' })
check(Math.abs(start.stage.h / start.stage.w - 0.8) < 0.03,
  `board one should be its own tall shape, was ${(start.stage.h / start.stage.w).toFixed(4)}`)
check(agrees(start), 'the stage and the viewBox should agree on board one')

// through a move between the two shapes: the box the picture is drawn in must
// hold the same shape as the picture in it, or the photograph is stretched
// count how many <image> elements the ground goes through: one per board is
// the cut between two photographs, one per frame is a picture being decoded
// again sixty times a second
await page.evaluate(() => {
  window.__tbmGround = null
  window.__tbmGrounds = 0
  window.__tbmWatch = setInterval(() => {
    const node = document.querySelector('[data-play="ground"] image')
    if (node && node !== window.__tbmGround) { window.__tbmGround = node; window.__tbmGrounds++ }
  }, 16)
})
await page.click('[data-play="toggle"]')
const during = []
for (let i = 0; i < 12; i++) { during.push(await measure()); await page.waitForTimeout(90) }
const stretched = during.filter(m => !agrees(m))
check(stretched.length === 0, `no frame should stretch the picture (${stretched.length} of ${during.length} did)`)
check(during.some(m => Math.abs(m.stage.h / m.stage.w - 0.8) > 0.02),
  'the shape should travel during the move rather than snap')
await page.waitForTimeout(2600)
const grounds = await page.evaluate(() => { clearInterval(window.__tbmWatch); return window.__tbmGrounds })
check(grounds <= 2, `the photograph should be written once per board, not per frame (${grounds} times)`)

// and at rest on 2 / 2 the stage ends at the photograph
// playback ends holding the last board; step only if it stopped short
if (await page.evaluate(() => !document.querySelector('[data-play="next"]').disabled)) {
  await page.click('[data-play="next"]')
}
await page.waitForTimeout(1400)
const held = await measure()
await page.screenshot({ path: '/tmp/tbm-framing-board2.png' })
console.log(JSON.stringify({ start, held }, null, 2))

check(held.count === '2 / 2', `expected to be holding board 2 / 2 (${held.count})`)
check(Math.abs(held.stage.h / held.stage.w - 9 / 16) < 0.02,
  `the stage should be 16:9 at rest, was ${(held.stage.h / held.stage.w).toFixed(4)}`)
check(agrees(held), 'the stage and the viewBox should agree on board two')
check(held.barTop - held.stage.bottom < 2,
  `the controls should follow the picture, not a band of empty page (${(held.barTop - held.stage.bottom).toFixed(1)}px)`)
check(held.ground.startsWith('data:image/'), 'the photograph should be drawn on the held board')
check(held.marks > 0, `the named player should be drawn over the photograph (${held.marks} marks)`)

/* the marker is the board's photograph of a player, not a white puck: in
   playback it is one <use> of a symbol that carries the crop, hung so that the
   object's own point is the centre of the ground ellipse inside the art */
const marker = await page.evaluate(() => {
  const svg = document.querySelector('[data-play="svg"]')
  const node = svg.querySelector('[data-play="shapes"] use')
  const box = node && {
    href: node.getAttribute('href'),
    x: +node.getAttribute('x'), y: +node.getAttribute('y'),
    w: +node.getAttribute('width'), h: +node.getAttribute('height'),
  }
  const symbol = node && svg.querySelector(`${node.getAttribute('href')}`)
  const art = symbol?.querySelector('image')
  const label = svg.querySelector('[data-play="shapes"] text')
  const obj = window.__tbm.store.scene.objects.find(o => o.type === 'marker')
  return {
    box,
    viewBox: symbol?.getAttribute('viewBox') ?? '',
    art: art && { href: art.getAttribute('href').slice(0, 12), x: +art.getAttribute('x'), y: +art.getAttribute('y'), w: +art.getAttribute('width') },
    label: label && { text: label.textContent, x: +label.getAttribute('x'), y: +label.getAttribute('y'), size: +label.getAttribute('font-size') },
    obj: obj && { x: obj.x, y: obj.y, w: obj.w },
    bbox: node && (({ x, y, width, height }) => ({ x, y, width, height }))(node.getBBox()),
  }
})
console.log(JSON.stringify({ marker }, null, 2))

// the numbers the editor draws it at (board.ts buildMarker, LIVE_MARKER_ELLIPSE)
const CROP = { x: 752, y: 1486, width: 2844, height: 1563 }
const ELLIPSE = { cx: 1300 / 2844, cy: 561 / 1563, rx: 1013 / 2844, ry: 314.5 / 1563 }
const near = (a, b, slack = 0.51) => Math.abs(a - b) <= slack

check(!!marker.box, 'the marker should be drawn as a <use> of the preloaded art')
if (marker.box) {
  const w = marker.obj.w
  const h = w * (CROP.height / CROP.width)
  check(marker.box.href === '#tbmArtMarker', `the marker points at the live player symbol (${marker.box.href})`)
  check(near(marker.box.w, w) && near(marker.box.h, h),
    `the marker is the crop's own shape (${marker.box.w}x${marker.box.h}, expected ${w}x${h.toFixed(2)})`)
  check(near(marker.box.x, marker.obj.x - w * ELLIPSE.cx) && near(marker.box.y, marker.obj.y - h * ELLIPSE.cy),
    `the object's point is the ground ellipse's centre (${marker.box.x},${marker.box.y})`)
  check(marker.viewBox === `0 0 ${CROP.width} ${CROP.height}`,
    `the symbol is the 4096 sheet's own window (${marker.viewBox})`)
  check(marker.art && marker.art.x === -CROP.x && marker.art.y === -CROP.y && marker.art.w === 4096,
    `the sheet is placed so the window shows the player (${JSON.stringify(marker.art)})`)
  check(marker.bbox && marker.bbox.width > 1 && marker.bbox.height > 1,
    `the art actually paints (${JSON.stringify(marker.bbox)})`)
  const ry = h * ELLIPSE.ry
  check(marker.label && marker.label.text === 'Rogers' && near(marker.label.x, marker.obj.x)
    && near(marker.label.y, marker.obj.y + ry + 7 + 15 * 0.8),
    `the name sits under the ellipse in the board's own type (${JSON.stringify(marker.label)})`)
}

// one symbol, pointed at across the whole move: no picture is cut per frame
await page.evaluate(() => {
  window.__tbmUse = document.querySelector('[data-play="shapes"] use')
  window.__tbmUses = 0
  window.__tbmUseWatch = setInterval(() => {
    const node = document.querySelector('[data-play="shapes"] use')
    if (node && node !== window.__tbmUse) { window.__tbmUse = node; window.__tbmUses++ }
    window.__tbmImages = document.querySelectorAll('[data-play="shapes"] image').length
  }, 16)
})
await page.click('[data-play="prev"]')
await page.waitForTimeout(1200)
const churn = await page.evaluate(() => {
  clearInterval(window.__tbmUseWatch)
  return { uses: window.__tbmUses, images: window.__tbmImages }
})
check(churn.uses === 0, `the marker should be the same element through a move (rebuilt ${churn.uses} times)`)
check(churn.images === 0, `and never a raster written into the layer (${churn.images} images)`)
await page.waitForTimeout(600)
await page.screenshot({ path: '/tmp/tbm-framing-marker.png' })


/* The handover: an asset that only board two has must never be seen fading up
   over board one's photograph, and never left over board two's. The player and
   the export both take their frames from the same model, so this is the frame
   the film is made of too. */
await page.click('[data-play="close"]')
await page.waitForTimeout(400)

// edit board two, and give it an object board one does not have
await openBoards()
const cards = page.locator('.boardCard')
await cards.nth(await cards.count() - 1).click()
await page.waitForTimeout(800)
check(await page.evaluate(() => window.__tbm.store.scene.pitch) === wideId,
  'the editor should be holding board two before its own object is added')
await page.evaluate(() => {
  window.__tbm.store.apply(s => {
    s.objects.push({
      id: 't-arriving', type: 'text', x: 120, y: 90, text: 'ARRIVING',
      size: 44, bold: true, color: '#ff0000', rotation: 0, flipX: false, flipY: false,
    })
    s.objects.push({
      id: 'm-arriving', type: 'marker', x: 200, y: 320, w: 120, name: 'Arriver',
      namePos: 'bottom', flipX: false, flipY: false, rotation: 0,
    })
  })
})
await page.waitForTimeout(600)

// a longer link gives the move enough frames to catch the cut in the act
await openBoards()
for (let i = 0; i < 6; i++) {
  if ((await page.locator('[data-act="dur"]').first().textContent()).trim() === '3.0s') break
  await page.click('[data-act="dur"]')
  await page.waitForTimeout(150)
}
const linkDur = await page.evaluate(() => document.querySelector('[data-act="dur"]').textContent.trim())
await page.click('.libFoot [data-act="play"]')
await page.waitForTimeout(1200)

/* one sample per painted frame: the ground the photograph is, and how visible
   board two's own object is on top of it */
const startSampling = () => page.evaluate(() => {
  window.__tbmSamples = []
  const svg = document.querySelector('[data-play="svg"]')
  const shapes = svg.querySelector('[data-play="shapes"]')
  const sample = () => {
    const image = document.querySelector('[data-play="ground"] image')
    const href = image?.getAttribute('href') ?? ''
    let seen = null
    for (const node of shapes.querySelectorAll('text')) {
      if (node.textContent !== 'ARRIVING') continue
      let alpha = 1
      for (let el = node; el && el !== shapes; el = el.parentElement) {
        const own = el.getAttribute?.('opacity')
        if (own !== null && own !== undefined) alpha *= Number(own)
      }
      seen = alpha
    }
    window.__tbmSamples.push({
      t: Math.round(performance.now()),
      ground: `${href.slice(0, 32)}:${href.length}`,
      alpha: seen,
      count: document.querySelector('[data-play="count"]').textContent.trim(),
    })
    window.__tbmSampleRaf = requestAnimationFrame(sample)
  }
  window.__tbmSampleRaf = requestAnimationFrame(sample)
})
const stopSampling = () => page.evaluate(() => {
  cancelAnimationFrame(window.__tbmSampleRaf)
  return window.__tbmSamples
})

/** Every frame that showed board two's own object stood on board two's ground. */
const judge = (samples, groundTwo, what) => {
  const wrong = samples.filter(s => s.alpha !== null && s.alpha > 0.004 && s.ground !== groundTwo)
  check(wrong.length === 0,
    `${what}: board two's object was visible over board one's photograph in ${wrong.length} of ${samples.length} frames`
    + (wrong[0] ? ` (first at alpha ${wrong[0].alpha.toFixed(3)})` : ''))
  const cutAt = samples.findIndex((s, i) => i > 0 && s.ground !== samples[i - 1].ground)
  const cuts = samples.filter((s, i) => i > 0 && s.ground !== samples[i - 1].ground).length
  check(cuts === 1, `${what}: the photograph should be cut once, not ${cuts} times in ${samples.length} frames`)
  const fading = samples.filter(s => s.alpha !== null && s.alpha > 0.004 && s.alpha < 0.996).length
  check(fading > 0, `${what}: the sampling should have caught the object part way in (${samples.length} frames)`)
  return { frames: samples.length, cuts, cutMs: cutAt > 0 ? samples[cutAt].t - samples[0].t : null, fading, wrong: wrong.length }
}

// board one, then forward into board two: nothing of board two arrives early
if (!(await measure()).count.startsWith('1 /')) {
  await page.click('[data-play="prev"]')
  await page.waitForTimeout(1400)
}
const onOne = await measure()
check(onOne.count === '1 / 2', `expected to be holding board 1 / 2 (${onOne.count})`)
await page.screenshot({ path: '/tmp/tbm-handoff-before.png' })
await startSampling()
await page.click('[data-play="toggle"]')   // played, so the link's own 3s governs the move
await page.waitForTimeout(4600)
const forward = await stopSampling()
await page.screenshot({ path: '/tmp/tbm-handoff-after.png' })
const groundTwo = forward[forward.length - 1].ground
const groundOne = forward[0].ground
check(groundOne !== groundTwo, `the two boards should be different photographs (${groundOne} / ${groundTwo})`)
const into = judge(forward, groundTwo, 'moving into board two')

// and back out again: nothing of board two is left over board one's photograph
await startSampling()
await page.click('[data-play="prev"]')
await page.waitForTimeout(2600)
const back = await stopSampling()
const outOf = judge(back, groundTwo, 'moving back out of board two')
console.log(JSON.stringify({ linkDur, groundOne, groundTwo, into, outOf }, null, 2))

/* and the cut itself, in pictures: a page screenshot takes longer than a frame
   lasts, so the two frames either side of the cut are caught in the player as
   markup and drawn again in a page of their own */
await page.evaluate(() => {
  const svg = document.querySelector('[data-play="svg"]')
  const sign = () => (document.querySelector('[data-play="ground"] image')?.getAttribute('href') ?? '').length
  window.__tbmCut = null
  let previous = { ground: sign(), markup: svg.outerHTML }
  const watch = () => {
    const ground = sign()
    const markup = svg.outerHTML
    if (!window.__tbmCut && ground !== previous.ground) window.__tbmCut = { before: previous, after: { ground, markup } }
    previous = { ground, markup }
    window.__tbmCutRaf = requestAnimationFrame(watch)
  }
  window.__tbmCutRaf = requestAnimationFrame(watch)
})
if ((await measure()).count.startsWith('2 /')) { await page.click('[data-play="prev"]'); await page.waitForTimeout(1400) }
await page.click('[data-play="toggle"]')
await page.waitForTimeout(4600)
const cut = await page.evaluate(() => { cancelAnimationFrame(window.__tbmCutRaf); return window.__tbmCut })
check(!!cut, 'the photograph should be cut once while the move plays')

/** How visible board two's own object is in a frame of captured markup. */
const arrivingIn = (markup) => {
  const at = markup.indexOf('>ARRIVING<')
  if (at < 0) return null
  const wrap = markup.lastIndexOf('<g opacity="', at)
  if (wrap < 0 || markup.indexOf('</g>', wrap) < at) return 1
  return Number(markup.slice(wrap + 12, markup.indexOf('"', wrap + 12)))
}
if (cut) {
  const shot = await ctx.newPage()
  for (const [what, frame] of [['before', cut.before], ['after', cut.after]]) {
    await shot.setContent(`<body style="margin:0;background:#fff">${frame.markup.replace('<svg', '<svg width="780"')}</body>`)
    await shot.waitForTimeout(400)
    await shot.screenshot({ path: `/tmp/tbm-handoff-cut-${what}.png` })
  }
  await shot.close()
  const before = arrivingIn(cut.before.markup)
  const after = arrivingIn(cut.after.markup)
  console.log(JSON.stringify({ cut: { grounds: [cut.before.ground, cut.after.ground], before, after } }, null, 2))
  check(before === null || before <= 0.004,
    `the last frame on board one's photograph still shows board two's object (opacity ${before})`)
  // the object may begin to fade up on the new photograph, but the cut itself
  // must not be a pop: it starts from nothing, a frame's worth at most
  check(after === null || after <= 0.15,
    `board two's object pops in at the cut rather than fading up from it (opacity ${after})`)
}

await browser.close()
if (errors.length) { console.error(errors.map(e => `✖ ${e}`).join('\n')); process.exit(1) }
console.log('✔ a held board fills the player at its own shape, with the controls under it')
