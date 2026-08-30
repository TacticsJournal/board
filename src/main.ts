import './styles.css'
import './tj-panels.css'
import { initTjHeader } from './tjheader'
import { initTjSearch } from './tjsearch'
import { Store } from './store'
import Konva from 'konva'
import {
  Board, Tool, ToolDefaults, makeArrowShape, arrowHeadSize,
  ballSrc, coneSrc, goalFullSrc, goalSmallSrc, livePlayerSrc,
  CONE_ASPECT, GOAL_ASPECT, LIVE_PLAYER_CROP,
} from './board'
import { ArrowObj, BallObj, BoxObj, GoalObj, ImageObj, MarkerObj, PlayerObj, Scene, SceneObj, TextObj, PLAYER_PALETTE, BOARD_W, emptyMatch, emptyScene, migrate, normalizeHex, uid, insertByTier, TYPE_Z, boxHasCorners, cornersFromRect, nodesForShape, rectFromCorners, isLight } from './types'
import type { NodeCurve, PathNode } from './path-nodes'
import { ImportPanel } from './importer'
import { SavesPanel } from './saves'
import { formatElapsedSince } from './last-updated'
import { mountSlidingPills } from './sliding-pill'
import { TeamPanel, teamCode, type TeamSide } from './teams'
import {
  DEFAULT_PITCH, PITCHES, clearActiveSharedPitches, customPitches, pitchById,
  setActiveSharedPitch, setActiveSharedPitches, sharedPitchPlaceholder,
} from './pitches'
import { addBoardChoices } from './add-board-options'
import { backgrounds } from './background-library.ts'
import {
  addBackgroundFromFile, addBackgroundFromImage, loadBackgrounds, loadImage, migrateLegacyBackgrounds, nameFromFile,
} from './background-library.ts'
import { isBackgroundId, type BackgroundKind, type BackgroundMeta } from './backgrounds.ts'
import { decodeImageFile, importBroadcastShots, shotImportMessage } from './broadcast-import.ts'
import * as sync from './sync'
import * as assetSync from './asset-sync'
import * as librarySync from './library-sync'
import type { LibrarySyncStore, SyncedLibraryRecord } from './library-sync'
import {
  createSharedBackgroundResolver, sharedBackgroundPitchStyle,
  type SharedBackgroundResolver,
} from './shared-backgrounds.ts'
import * as live from './live'
import * as collaboration from './collaboration'
import { TJ_ORIGIN, usingBillingSandbox } from './origin'
import { boardAgentLinksUrl, boardInvitationUrl, boardPresenceUrl, boardSkillsUrl, ensureBoardSession, resetBoardSession } from './board-api'
import { startCheckout, type CheckoutProduct } from './checkout'
import * as entitlements from './entitlements'
import {
  AssetQuotaError, ASSET_BUDGET_BYTES, ASSET_CATEGORIES, AssetCategory, UserAsset,
  addAsset, assetSyncStore, getAsset, listAssets, readImageFile, removeAsset, subscribe as subscribeAssets, updateAsset, usedBytes,
} from './assets'
import {
  MAX_CAT_LENGTH, MAX_STAMP_OBJECTS, Stamp, StampQuotaError,
  addStamp, customCats, listStamps, normalizeCat, removeStamp, updateStamp, stampLibrarySyncStore, subscribe as subscribeStamps,
} from './stamps'
import { sceneShapesSvg } from './saves'
import { icon } from './icons'
import { ExtensionRuntime, type ExtensionManifest } from './extension-runtime'
import { OfficialExtensions } from './extensions/official/manager.ts'
import { BOARD_EXTENSION_PATHS, BOARD_SELF_HOSTED } from './build-mode.ts'
import { addUserSkill, deleteSkill, installExtension, loadProjectSkillsState, mergeSyncedSkills, newUserSkill, removeExtension, saveProjectSkillsState, saveSkill, setExtensionEnabled, skillsForSync, type ProjectSkillsState, type Skill } from './skills-extensions'
import { BoardsView, type AddBoardUpload } from './boards-view'
import { openComposer } from './composer'
import { CATEGORY_SCENES_RECOVERED_SUFFIX, planCategorySnapshotRecovery } from './category-recovery'
import { exportAnimation } from './animate-export'
import { recordProductEvent } from './product-events'
import { saveFreeBackupIntent, selectedFreeBackup, setSelectedFreeBackup, takeFreeBackupIntent, type FreeBackupSource } from './free-backup'
import { downloadProjectImage, exportProjectImages, type ProjectImageFile } from './project-image-export'
import { startAgentImport, type BoardImportResult } from './agent-import-ui'
import { createBoardImportUrl, createProjectImportUrl, createStoredProjectImportUrl, isAgentImportTooLarge, type AgentImportDraft } from './agent-import'
import {
  addBoard, appendBoardCopy, appendProjectCopy, boardName, canAnimate, canCreateProject, currentProject, documentScene, freshDeviceDestination, loadLibrary, migrateProject, newProject, newProjectFromBoard, newProjectFromProjectCopy, orderedProjects, reconcileProjectLibrary, rememberBoard, saveLibrary, storedBoardIndex, touch,
  type BoardDocument, type Library, type Project,
} from './projects'

let extensionRuntime: ExtensionRuntime | null = null
let authenticated = false
let accountBinding: string | null = null

// same image the tacticsjournal.com header uses (site avatar IMG_5503.png),
// downscaled from 4096px for the 24px logo slot
const tjLogoSrc = new URL('../assets/brand/tj-logo.png', import.meta.url).href

const svg = (path: string, vb = '0 0 24 24') =>
  `<svg viewBox="${vb}" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`
const OPPOSED_ARROWS_PATH = '<path d="M1 5h16l-4-4m4 4-4 4M21 13H5l4 4m-4-4 4-4"/>'
const opposedArrows = () =>
  `<svg viewBox="0 0 22 18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${OPPOSED_ARROWS_PATH}</svg>`
const nodeIcon = (path: string) =>
  `<svg viewBox="0 0 26 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`
const ICONS = {
  plus: svg('<path d="M12 5v14M5 12h14" stroke-width="2.2"/>'),
  minus: svg('<path d="M5 12h14" stroke-width="2.2"/>'),
  /* Node curves, drawn rather than named: a corner, a smooth pass, a rounder
     one, and the free node whose two handles have been dragged by hand. */
  nodeCorner: nodeIcon('<path d="M4 12h9V4h9"/>'),
  nodeSmooth: nodeIcon('<path d="M4 12c5 0 4-8 9-8s4 8 9 8"/>'),
  nodeRound: nodeIcon('<path d="M4 13C4 5 8 3 13 3s9 2 9 10"/>'),
  nodeFree: nodeIcon('<path d="M4 14c0-9 5-11 10-11s8 4 8 11"/><path d="M9 3h8"/><rect x="6.6" y="1.4" width="3.2" height="3.2" fill="currentColor" stroke="none"/><rect x="16.2" y="1.4" width="3.2" height="3.2" fill="currentColor" stroke="none"/>'),
  undo: svg('<path d="M8 7L4 11l4 4"/><path d="M4 11h9a6 6 0 0 1 6 6v1"/>'),
  redo: svg('<path d="M16 7l4 4-4 4"/><path d="M20 11h-9a6 6 0 0 0-6 6v1"/>'),
  /* Selection tools. A solid mark is the piece being acted on; the layer
     the piece moves past is drawn as a dashed line. */
  front: svg('<path d="M12 15V4"/><path d="M8 8l4-4 4 4"/><path d="M4 20h3M10.5 20h3M17 20h3" stroke-dasharray="2.5 3"/>'),
  back: svg('<path d="M4 4h3M10.5 4h3M17 4h3" stroke-dasharray="2.5 3"/><path d="M12 9v11"/><path d="M8 16l4 4 4-4"/>'),
  dup: svg('<rect x="4" y="4" width="12" height="12" rx="2.2"/><rect x="9" y="9" width="11" height="11" rx="2.2" fill="var(--fab-bg)"/><rect x="9" y="9" width="11" height="11" rx="2.2"/><path d="M14.5 12.2v4.6M12.2 14.5h4.6"/>'),
  trash: svg('<path d="M5 7h14"/><path d="M9.5 7V5.4A1.4 1.4 0 0 1 10.9 4h2.2a1.4 1.4 0 0 1 1.4 1.4V7"/><path d="M7 7.6l.7 11.1A1.6 1.6 0 0 0 9.3 20.2h5.4a1.6 1.6 0 0 0 1.6-1.5l.7-11.1"/><path d="M10.6 11v5.4M13.4 11v5.4"/>'),
  wrench: svg('<path d="M14.5 6.5a4 4 0 0 0-5.7 4.6L4 16l-1 3 3-1 4.9-4.8a4 4 0 0 0 4.6-5.7l-2.7 2.7-2.5-.5-.5-2.5z"/>'),
  flipH: svg('<path d="M10.3 5.4v13.2L3.6 12z" fill="currentColor" stroke="none"/><path d="M13.7 5.4v13.2L20.4 12z"/>'),
  rotate: svg('<path d="M17.6 7.4A7 7 0 1 1 13.2 5.2"/><path d="M12.4 2.7l4.2 2.5-4.2 2.5z" fill="currentColor" stroke="none"/>'),
  export: svg('<path d="M12 14V3"/><path d="M8.5 6.5L12 3l3.5 3.5"/><path d="M8 9H6a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-9a1 1 0 0 0-1-1h-2"/>'),
  fit: svg('<path d="M9 4H6a2 2 0 0 0-2 2v3"/><path d="M15 4h3a2 2 0 0 1 2 2v3"/><path d="M9 20H6a2 2 0 0 1-2-2v-3"/><path d="M15 20h3a2 2 0 0 0 2-2v-3"/>'),
  newBoard: svg('<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M12 9v6M9 12h6"/>'),
  import: svg('<rect x="3.5" y="5" width="17" height="14" rx="2"/><circle cx="8.7" cy="9.7" r="1.6"/><path d="M20.5 15.5l-4.5-4.5-8 8"/>'),
  camera: svg('<path d="M4 8h3l1.5-2.5h7L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13" r="3.4"/>'),
  cog: svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>'),
  magnet: svg('<g transform="scale(1,-1) translate(0,-24)"><path d="M4 13v-8a2 2 0 0 1 2-2h1a2 2 0 0 1 2 2v8a2 2 0 0 0 6 0v-8a2 2 0 0 1 2-2h1a2 2 0 0 1 2 2v8a8 8 0 0 1-16 0"/><path d="M4 8h5M15 8h4"/></g>'),
}

const ARROW_COLORS = ['#111111', '#ffffff', '#facc15', '#e02020', '#1e2f6f']
// Two ladders, because a medium arrow is not the same line on grass as it is
// over video: a drawn pitch keeps the heavier weights the board has always
// used, a broadcast still keeps the finer ones that read over a photograph.
const ARROW_WIDTH_OPTIONS: [string, string][] = [['3', 'S'], ['4.5', 'M'], ['6.5', 'L']]
const ARROW_WIDTH_OPTIONS_LIVE: [string, string][] = [['2', 'S'], ['3', 'M'], ['4.5', 'L']]
const arrowWidthOptions = (live: boolean): [string, string][] => live ? ARROW_WIDTH_OPTIONS_LIVE : ARROW_WIDTH_OPTIONS
// A measuring line carries no head, so it is on neither arrow ladder: it keeps
// the one weight list it has always had, on every pitch.
const MEASURE_WIDTH_OPTIONS: [string, string][] = [['3', 'S'], ['4.5', 'M'], ['6.5', 'L']]
const BOX_FILLS = ['#9ca3af', '#fde047', '#ef4444', '#3b82f6']
const TEXT_COLORS = ['#111111', '#ffffff', '#e02020', '#1e2f6f']

const defaults: ToolDefaults = {
  playerColor: '#e02020',
  arrow: { dash: 'solid', color: '#111111', width: 4.5, head: true },
  measure: { color: '#111827', width: 3 },
  box: { shape: 'rect', fill: '#9ca3af', opacity: 0.25 },
  text: { bold: true, size: 22, color: '#111111' },
  place: 'ball',
  goal: { variant: 'small' },
}

const store = new Store()

/** Whether the board on screen draws arrows at the broadcast weights. */
const liveArrows = () => !!pitchById(store.scene.pitch).live
/** The width ladder the board on screen is drawing with. */
const sceneArrowWidths = () => arrowWidthOptions(liveArrows())

/**
 * Moving between the two ladders keeps the rung, not the number: a medium
 * stays medium across the move. A width that is on neither ladder - one typed
 * into a saved board, say - lands on medium rather than pretending to be a
 * rung it is not.
 */
function retuneArrowWidth(width: number, live: boolean): number {
  const rung = arrowWidthOptions(!live).findIndex(([v]) => Number(v) === width)
  return Number(arrowWidthOptions(live)[rung >= 0 ? rung : 1][0])
}

/** Which ladder the new-arrow defaults currently sit on. */
let arrowDefaultsLive = false

function applyPitchArrowDefault(style: ReturnType<typeof pitchById>) {
  if (style.live && defaults.arrow.color === '#111111') defaults.arrow.color = '#ffffff'
  else if (!style.live && defaults.arrow.color === '#ffffff') defaults.arrow.color = '#111111'
  const live = !!style.live
  if (live === arrowDefaultsLive) return
  arrowDefaultsLive = live
  defaults.arrow.width = retuneArrowWidth(defaults.arrow.width, live)
}

// A saved board, an undo or a collaborator's scene can change the pitch without
// anyone touching the pitch picker, so the defaults follow the scene itself.
let arrowDefaultPitch = store.scene.pitch
store.subscribe(() => {
  if (store.scene.pitch === arrowDefaultPitch) return
  arrowDefaultPitch = store.scene.pitch
  applyPitchArrowDefault(pitchById(store.scene.pitch))
})
applyPitchArrowDefault(pitchById(store.scene.pitch))

/** Board height follows the scene's pitch style; width is fixed. */
const boardH = () => store.scene.board.h

type PitchLayout = 'horizontal' | 'vertical-half' | 'sidebyside'

const pitchLayout = (id: string | undefined): PitchLayout => {
  // pitch-up is one attacking half: goal at the top, halfway line at the bottom.
  if (id === 'pitch-up') return 'vertical-half'
  if (id === 'sidebyside') return 'sidebyside'
  return 'horizontal'
}
const clamp01 = (n: number) => Math.max(0, Math.min(1, n))
const isVerticalLayout = (layout: PitchLayout) => layout !== 'horizontal'

function mapPitchPoint(x: number, y: number, from: PitchLayout, fromH: number, to: PitchLayout, toH: number, side: 0 | 1 = 0) {
  const srcW = from === 'sidebyside' ? BOARD_W / 2 : BOARD_W
  const srcX = from === 'sidebyside' ? x % srcW : x
  let u: number
  let v: number
  if (from === 'horizontal') {
    u = srcX / srcW
    v = y / fromH
  } else if (from === 'vertical-half') {
    // Half-pitch vertical boards cover only the attacking half of the full pitch:
    // y=0 is the goal line, y=boardH is the halfway line (u=0.5).
    u = 1 - (y / (fromH * 2))
    v = srcX / srcW
  } else {
    u = 1 - (y / fromH)
    v = srcX / srcW
  }

  if (to === 'horizontal') return { x: u * BOARD_W, y: v * toH }
  const dstW = to === 'sidebyside' ? BOARD_W / 2 : BOARD_W
  const dstX = side * dstW + v * dstW
  if (to === 'vertical-half') return { x: dstX, y: clamp01((1 - u) * 2) * toH }
  return { x: dstX, y: (1 - u) * toH }
}

function remapObjectToPitch<T extends SceneObj>(obj: T, from: PitchLayout, fromH: number, to: PitchLayout, toH: number, side: 0 | 1 = 0): T {
  const o = JSON.parse(JSON.stringify(obj)) as T
  if (side) o.id = uid()
  const p = (x: number, y: number) => mapPitchPoint(x, y, from, fromH, to, toH, side)
  if (o.type === 'arrow') {
    const a = o
    ;({ x: a.x1, y: a.y1 } = p(a.x1, a.y1))
    ;({ x: a.mx, y: a.my } = p(a.mx, a.my))
    ;({ x: a.x2, y: a.y2 } = p(a.x2, a.y2))
  } else {
    const xy = p(o.x, o.y)
    o.x = xy.x; o.y = xy.y
    if (o.type === 'box') {
      if (isVerticalLayout(from) !== isVerticalLayout(to)) {
        const dstW = to === 'sidebyside' ? BOARD_W / 2 : BOARD_W
        const srcW = from === 'sidebyside' ? BOARD_W / 2 : BOARD_W
        const sx = dstW / srcW
        const sy = toH / fromH
        ;[o.w, o.h] = [o.h * sx, o.w * sy]
      }
      if (o.corners) {
        for (const c of o.corners) {
          const mapped = p(c.x, c.y)
          c.x = mapped.x; c.y = mapped.y
        }
      }
    }
  }
  return o
}

function setPitchPreservingLayout(scene: typeof store.scene, pitch: string, h: number) {
  const fromPitch = pitchById(scene.pitch)
  const fromH = scene.board?.h || fromPitch.boardH
  const from = pitchLayout(fromPitch.id)
  const to = pitchLayout(pitch)
  const one = scene.objects.map(o => remapObjectToPitch(o, from, fromH, to, h, 0))
  scene.objects = to === 'sidebyside' && from !== 'sidebyside'
    ? [...one, ...scene.objects.map(o => remapObjectToPitch(o, from, fromH, to, h, 1))]
    : one
  scene.pitch = pitch
  scene.board = { w: BOARD_W, h }
}

const CATEGORY_SCENES_KEY = 'tbm-category-scenes-v1'
const CATEGORY_SCENES_SYNC_KEY = 'tbm-category-scenes-sync-v1'
let activeCategoryScenesKey = CATEGORY_SCENES_KEY
let activeCategoryScenesSyncKey = CATEGORY_SCENES_SYNC_KEY
let categoryScenesAccount: string | null = null
type CategoryScenes = Record<string, Scene>
type CategoryScenesMeta = { updatedAt: string; syncAccount?: string }
const categorySceneListeners = new Set<() => void>()
const EMPTY_CATEGORY_META: CategoryScenesMeta = { updatedAt: new Date(Date.UTC(2000, 0, 1)).toISOString() }

function categoryScenesMetaAt(key: string): { meta: CategoryScenesMeta; initialized: boolean } {
  try {
    const raw = JSON.parse(localStorage.getItem(key) ?? '{}')
    if (typeof raw.updatedAt === 'string' && Number.isFinite(Date.parse(raw.updatedAt))) {
      return {
        initialized: true,
        meta: { updatedAt: raw.updatedAt, ...(typeof raw.syncAccount === 'string' && raw.syncAccount ? { syncAccount: raw.syncAccount } : {}) },
      }
    }
  } catch { /* old local setup */ }
  return { meta: EMPTY_CATEGORY_META, initialized: false }
}
function categoryScenesMeta(): CategoryScenesMeta { return categoryScenesMetaAt(activeCategoryScenesSyncKey).meta }
function hasCategoryScenesMeta(): boolean { return categoryScenesMetaAt(activeCategoryScenesSyncKey).initialized }
function saveCategoryScenesMeta(meta: CategoryScenesMeta) {
  try { localStorage.setItem(activeCategoryScenesSyncKey, JSON.stringify(meta)) } catch { /* private mode */ }
}
function readCategoryScenes(): CategoryScenes {
  try {
    const raw = JSON.parse(localStorage.getItem(activeCategoryScenesKey) ?? '{}')
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
    return raw as CategoryScenes
  } catch { return {} }
}
function writeCategoryScenes(all: CategoryScenes, source: 'local' | 'remote' = 'local', meta?: CategoryScenesMeta) {
  try { localStorage.setItem(activeCategoryScenesKey, JSON.stringify(all)) } catch { return }
  if (source === 'local') {
    const previous = categoryScenesMeta()
    const prior = Date.parse(previous.updatedAt)
    saveCategoryScenesMeta({ ...previous, updatedAt: new Date(Math.max(Date.now(), Number.isFinite(prior) ? prior + 1 : 0)).toISOString() })
    for (const fn of categorySceneListeners) fn()
  } else if (meta) saveCategoryScenesMeta(meta)
}

/** Keep the fixed category-scenes record separate for each account on this browser. */
function activateCategoryScenesAccount(account: string | null) {
  if (!account || account === categoryScenesAccount) return
  const dataKey = `${CATEGORY_SCENES_KEY}:${account}`
  const syncKey = `${CATEGORY_SCENES_SYNC_KEY}:${account}`
  let scopedExists = false
  try { scopedExists = localStorage.getItem(dataKey) !== null } catch { /* private mode */ }
  if (!scopedExists) {
    const baseState = categoryScenesMetaAt(CATEGORY_SCENES_SYNC_KEY)
    const baseScenes = (() => {
      try {
        const raw = JSON.parse(localStorage.getItem(CATEGORY_SCENES_KEY) ?? '{}')
        return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as CategoryScenes : {}
      } catch { return {} }
    })()
    const canClaim = !baseState.meta.syncAccount || baseState.meta.syncAccount === account
    if (canClaim && (baseState.initialized || Object.keys(baseScenes).length > 0)) {
      const claimed = { ...baseState.meta, syncAccount: account }
      try {
        localStorage.setItem(dataKey, JSON.stringify(baseScenes))
        localStorage.setItem(syncKey, JSON.stringify(claimed))
        localStorage.setItem(CATEGORY_SCENES_SYNC_KEY, JSON.stringify(claimed))
      } catch { /* private mode */ }
    }
  }
  activeCategoryScenesKey = dataKey
  activeCategoryScenesSyncKey = syncKey
  categoryScenesAccount = account
  recoverCategorySnapshots(dataKey)
}

const categoryScenesLibraryStore: LibrarySyncStore = {
  list() {
    const scenes: CategoryScenes = {}
    for (const [category, scene] of Object.entries(readCategoryScenes())) {
      try { scenes[category] = migrate(scene) } catch { /* corrupt scene stays local, never uploads */ }
    }
    if (!Object.keys(scenes).length && !hasCategoryScenesMeta()) return []
    const meta = categoryScenesMeta()
    return [{ id: 'category-scenes', kind: 'category_scenes', name: 'Category scenes', payload: { scenes }, updatedAt: meta.updatedAt,
      ...(meta.syncAccount ? { syncAccount: meta.syncAccount } : {}) }]
  },
  apply(record: SyncedLibraryRecord) {
    if (record.kind !== 'category_scenes' || record.id !== 'category-scenes') return
    const current = categoryScenesMeta()
    if (hasCategoryScenesMeta() && Date.parse(current.updatedAt) >= Date.parse(record.updatedAt)) return
    const raw = record.deleted ? {} : record.payload && typeof record.payload === 'object'
      ? (record.payload as Record<string, unknown>).scenes : null
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return
    const scenes: CategoryScenes = {}
    for (const [category, scene] of Object.entries(raw as Record<string, unknown>)) {
      try { scenes[category] = migrate(scene) } catch { /* one bad category cannot poison the rest */ }
    }
    writeCategoryScenes(scenes, 'remote', { updatedAt: record.updatedAt, ...(record.syncAccount ? { syncAccount: record.syncAccount } : {}) })
    recoverCategorySnapshots(activeCategoryScenesKey)
  },
  bind(ids, account) {
    const meta = categoryScenesMeta()
    if (ids.includes('category-scenes') && (!meta.syncAccount || meta.syncAccount === account)) saveCategoryScenesMeta({ ...meta, syncAccount: account })
  },
}
function recoverCategorySnapshots(key = activeCategoryScenesKey) {
  const doneKey = `${key}${CATEGORY_SCENES_RECOVERED_SUFFIX}`
  let stored: string | null
  try {
    if (localStorage.getItem(doneKey) === '1') return
    stored = localStorage.getItem(key)
  } catch { return }
  if (stored === null) {
    try { localStorage.setItem(doneKey, '1') } catch { /* private mode */ }
    return
  }

  let raw: unknown
  try { raw = JSON.parse(stored) } catch {
    try { localStorage.setItem(doneKey, '1') } catch { /* private mode */ }
    return
  }
  const plan = planCategorySnapshotRecovery(raw, {
    migrateScene: migrate,
    pitchLabel: pitch => pitchById(pitch).label,
  })
  if (!plan.valid) {
    try { localStorage.setItem(doneKey, '1') } catch { /* private mode */ }
    return
  }

  try {
    saves.importFile(JSON.stringify({ app: 'tactics-board-mapper', version: 1, boards: plan.boards }))
    localStorage.setItem(doneKey, '1')
    localStorage.removeItem(key)
  } catch { /* keep the legacy snapshots so recovery can retry */ }
}

/** A pitch choice edits the board on screen in one undoable step. */
function applyPitchChoice(style: ReturnType<typeof pitchById>, h = style.boardH): boolean {
  const current = pitchById(store.scene.pitch)
  if (current.id === style.id && (store.scene.board?.h ?? current.boardH) === h) return false
  applyPitchArrowDefault(style)
  store.apply(s => {
    setPitchPreservingLayout(s, style.id, h)
    if (style.live) s.match = { ...emptyMatch(), ...s.match, showTeams: false }
  })
  return true
}

type TeamFormationRole = 'gk' | 'def' | 'mid' | 'fwd'

type TeamFormationSlot = { role: TeamFormationRole; x: number; y: number }

const TEAM_FORMATION_442: TeamFormationSlot[] = [
  // GK, 4-4-2 shape rendered left→right
  { role: 'gk', x: 0.12, y: 0.5 },
  { role: 'def', x: 0.29, y: 0.16 },
  { role: 'def', x: 0.29, y: 0.38 },
  { role: 'def', x: 0.29, y: 0.62 },
  { role: 'def', x: 0.29, y: 0.84 },
  { role: 'mid', x: 0.54, y: 0.16 },
  { role: 'mid', x: 0.54, y: 0.38 },
  { role: 'mid', x: 0.54, y: 0.62 },
  { role: 'mid', x: 0.54, y: 0.84 },
  { role: 'fwd', x: 0.86, y: 0.35 },
  { role: 'fwd', x: 0.86, y: 0.65 },
]

const PLAYER_MENU_DROP_X = BOARD_W * 0.2
const PLAYER_MENU_DROP_STEP = 56
const PLAYER_MENU_DROP_COLUMNS = 4

const nextPlayerSpot = () => {
  const idx = store.scene.objects.filter((o): o is PlayerObj => o.type === 'player').length
  const col = Math.floor(idx / PLAYER_MENU_DROP_COLUMNS)
  const row = idx % PLAYER_MENU_DROP_COLUMNS
  return {
    x: PLAYER_MENU_DROP_X + col * PLAYER_MENU_DROP_STEP,
    y: boardH() * 0.25 + row * PLAYER_MENU_DROP_STEP,
  }
}

const FORMATION_X_MIN = Math.min(...TEAM_FORMATION_442.map(s => s.x))
const FORMATION_X_MAX = Math.max(...TEAM_FORMATION_442.map(s => s.x))
const FORMATION_HALF_START = 0.06
// Leave a center-channel gap when both home and away XIs are added.
const FORMATION_HALF_END = 0.46

function formationX(slotX: number, isAway: boolean) {
  const span = FORMATION_X_MAX - FORMATION_X_MIN || 1
  const t = (slotX - FORMATION_X_MIN) / span
  const homeX = FORMATION_HALF_START + t * (FORMATION_HALF_END - FORMATION_HALF_START)
  const xNorm = isAway ? 1 - homeX : homeX
  return xNorm * BOARD_W
}

function buildLineupObjects(teamName: string): PlayerObj[] {
  // plain dots in formation: names and numbers are added per dot from the
  // roster dropdown when wanted
  const team = teams.getTeam(teamName)
  const isAway = team?.side === 'away'
  const playerTeam = team?.name || teamName || undefined
  const gkColor = isAway ? '#d1d5db' : '#6b7280'
  const teamColor = team?.color ?? defaults.playerColor
  const slotsToUse: TeamFormationSlot[] = (team?.slots as TeamFormationSlot[] | undefined) ?? TEAM_FORMATION_442

  return slotsToUse.map((slot, i) => {
    const x = formationX(slot.x, isAway)
    const color = (slot.role === 'gk' || i === 0) ? gkColor : teamColor
    return {
      id: uid(), type: 'player',
      x,
      y: slot.y * boardH(),
      r: 13,
      color,
      label: '',
      name: '',
      namePos: 'bottom',
      nameSize: 18,
      nameDisplay: 'last',
      team: playerTeam,
      flipX: false,
      flipY: false,
    } as PlayerObj
  })
}

function addTeamFromPlayerMenu(teamName: string) {
  const objects = buildLineupObjects(teamName)
  store.apply((s) => {
    for (const obj of objects) insertByTier(s.objects, obj)
  })
  if (objects.length) store.select(objects[0].id)
}

/**
 * New-board flows (topbar New and the Saves sheet): blank, or a home-vs-away
 * kickoff. Never replace a canvas whose current changes could not be saved
 * unless the user explicitly chooses to discard them.
 */
function newBoard(kind: 'blank' | 'teams'): boolean {
  if (kind === 'teams') {
    const home = teams.getTeamForSide('home')
    const away = teams.getTeamForSide('away')
    if (!home || !away) {
      teams.openSide(home ? 'away' : 'home')
      return false
    }
  }
  if (!saves.autosaveCurrent() && !confirm('This canvas has unsaved changes that could not be saved. Discard them and start a new board?')) {
    return false
  }

  const scene = migrate(JSON.parse(JSON.stringify(store.scene)))
  if (kind === 'blank') {
    scene.objects = []
    scene.match = { ...emptyMatch(), ...scene.match, home: '', away: '', showTeams: false }
    teams.resetTeams([])
  } else {
    const home = teams.getTeamForSide('home')!
    const away = teams.getTeamForSide('away')!
    const objects: SceneObj[] = []
    for (const obj of [...buildLineupObjects(home.name), ...buildLineupObjects(away.name)]) insertByTier(objects, obj)
    insertByTier(objects, { id: uid(), type: 'ball', x: BOARD_W / 2, y: boardH() / 2, size: 20, flipX: false, flipY: false } as BallObj)
    scene.objects = objects
    scene.match = { ...emptyMatch(), ...scene.match, home: home.name, away: away.name, showTeams: true }
  }

  openNewProject(scene)
  saves.registerNew()
  return true
}

function addPlayerFromPlayerMenu(name = '', label = '', teamName?: string | null) {
  const pos = nextPlayerSpot()
  const team = teamName === undefined ? teams.activeTeamName() : teamName
  const obj: PlayerObj = {
    id: uid(), type: 'player',
    x: pos.x, y: pos.y, r: 13,
    color: defaults.playerColor,
    label, name, namePos: 'bottom', nameSize: 18, nameDisplay: 'last',
    team,
    flipX: false,
    flipY: false,
  }
  store.apply(s => { insertByTier(s.objects, obj) })
  store.select(obj.id)
}

// shortcut hints shown in desktop tooltips
const IS_MAC = /Mac|iP(hone|ad|od)/.test(navigator.platform)
const HINT_UNDO = IS_MAC ? '⌘Z' : 'Ctrl+Z'
const HINT_REDO = IS_MAC ? '⇧⌘Z' : 'Ctrl+Shift+Z'
const HINT_DUP = IS_MAC ? '⌘D' : 'Ctrl+D'

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
<div class="tooSmallScreen" data-viewport-gate role="status" aria-live="polite">
  <div class="tooSmallCard">
    <strong>View this in browser</strong>
    <p>Tactics Board needs more room than this preview window. Open the link in Safari or Chrome for the full board.</p>
    <a href="https://board.tacticsjournal.com/" target="_blank" rel="noopener">Open board</a>
  </div>
</div>
<div class="app">
  <div class="appBanner hidden" id="appBanner" role="status" aria-live="polite"></div>
  <header class="site-header"${BOARD_SELF_HOSTED ? ' hidden' : ''}>
    <a href="https://tacticsjournal.com/" class="site-logo" aria-label="Tactics Journal home">
      <img src="${tjLogoSrc}" alt="Tactics Journal" />
    </a>
    <nav class="site-nav" aria-label="Primary">
      <a href="https://tacticsjournal.com/opinion/">Opinion</a>
      <a href="https://tacticsjournal.com/research/">Research</a>
      <a href="https://tacticsjournal.com/community/">Community</a>
      <span class="site-nav-divider"></span>
      <a href="https://tacticsjournal.com/about/">About</a>
      <a href="https://tacticsjournal.com/archive/">Archive</a>
      <a href="https://tacticsjournal.com/follow/">Follow</a>
      <a href="https://tacticsjournal.com/contact/">Contact</a>
      <a href="https://tacticsjournal.com/key/">Key</a>
    </nav>
    <div class="site-actions">
      <div id="site-search-panel" class="site-overlay-panel site-search-panel" hidden>
        <div class="search-page search-chat-page site-search-content">
          <div class="search-header site-panel-animate" data-search-initial-header>
            <h1 class="search-title">Search</h1>
            <p class="search-intro">What would you like to know?</p>
            <p class="search-disclaimer">Disclaimer: Search is in development. Things may not work properly. If you encounter an issue, contact us.</p>
          </div>
          <div class="search-answer search-chat" data-search-answer hidden></div>
          <div class="search-sources" data-search-sources hidden></div>
          <div class="search-status" data-search-status role="status" aria-live="polite"></div>
          <form class="search-form search-chat-form site-panel-animate" data-search-form>
            <label class="sr-only">Ask a question</label>
            <textarea class="search-question" data-search-question rows="1" placeholder="Ask Tactics Journal" required></textarea>
            <button class="search-submit" data-search-submit type="submit" aria-label="Send">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 4L12 20M12 4L5 11M12 4L19 11" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </button>
          </form>
        </div>
      </div>
      <div id="site-account-panel" class="site-overlay-panel site-account-panel" hidden>
        <div class="site-account-loading" hidden></div>
        <div class="site-account-logged-out signin-card" hidden>
          <div class="signin-card__header site-panel-animate">
            <h2 class="post-title signin-card__title">Sign in</h2>
            <p class="signin-card__subtitle">Continue to your Tactics Journal account.</p>
          </div>
          <div class="site-account-error account-message account-message--error site-panel-animate" hidden></div>
          <div class="site-account-notice account-message site-panel-animate" role="status" aria-live="polite" hidden></div>
          <div class="site-account-google signin-google site-panel-animate">
            <a href="${TJ_ORIGIN}/api/account/google/start?next=/account/" class="signin-google-button">
              <span class="signin-google-button__logo" aria-hidden="true">
                <svg viewBox="0 0 18 18" focusable="false"><path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z"/><path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.33-1.58-5.04-3.71H.94v2.33A9 9 0 0 0 9 18z"/><path fill="#FBBC05" d="M3.96 10.71A5.41 5.41 0 0 1 3.68 9c0-.59.1-1.16.28-1.71V4.96H.94A9 9 0 0 0 0 9c0 1.45.34 2.82.94 4.04l3.02-2.33z"/><path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.9 11.43 0 9 0A9 9 0 0 0 .94 4.96l3.02 2.33C4.67 5.16 6.66 3.58 9 3.58z"/></svg>
              </span>
              <span>Continue with Google</span>
            </a>
          </div>
          <div class="signin-divider site-panel-animate" aria-hidden="true"><span>or</span></div>
          <form class="email-form site-account-start-form site-panel-animate">
            <input type="email" name="email" placeholder="Enter your email..." aria-label="Email address" autocomplete="email" required />
            <button type="submit">Send code</button>
          </form>
          <p class="research-gate-note research-gate-legal signin-card__hint site-panel-animate site-account-start-hint">No credit card required. By continuing, you agree to our <a href="https://tacticsjournal.com/privacy/">Privacy Policy</a> and <a href="https://tacticsjournal.com/terms/">Terms of Service</a>.</p>
          <button type="button" class="site-account-change-email site-panel-animate" hidden>Use a different email</button>
          <form class="email-form site-account-verify-form site-panel-animate" hidden>
            <input type="text" name="code" inputmode="numeric" pattern="[0-9]*" maxlength="6" placeholder="6-digit code" aria-label="6-digit sign-in code" autocomplete="one-time-code" required />
            <button type="submit">Sign in</button>
          </form>
          <a href="https://dash.tacticsjournal.com/?signin=board" class="site-account-dashboard-signin site-panel-animate">Sign in as @kyleboas via dashboard</a>
        </div>
        <div class="site-account-logged-in" hidden>
          <div class="notif-header site-panel-animate">
            <h2 class="notif-title">Notifications</h2>
            <div class="notif-header-actions">
              <a href="${TJ_ORIGIN}/account/" class="notif-header-icon" aria-label="Your account">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="3.5"/><path d="M5 20c1.5-3.5 4.1-5.25 7-5.25S17.5 16.5 19 20"/></svg>
              </a>
              <button type="button" class="notif-header-icon site-notif-settings-toggle" aria-label="Notification settings" aria-expanded="false">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
              </button>
            </div>
          </div>
          <div class="notif-settings site-notif-settings" hidden>
            <label class="notif-settings-row">
              <svg class="notif-settings-icon notif-settings-icon--upvote" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 4l-8 8h5v8h6v-8h5z"/></svg>
              <span class="notif-settings-label">
                <strong>Upvotes</strong>
                <span class="notif-settings-desc">When someone upvotes your post</span>
              </span>
              <input type="checkbox" class="notif-settings-toggle" data-notif-pref="upvotes" checked />
            </label>
            <label class="notif-settings-row">
              <svg class="notif-settings-icon notif-settings-icon--downvote" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 20l8-8h-5V4H9v8H4z"/></svg>
              <span class="notif-settings-label">
                <strong>Downvotes</strong>
                <span class="notif-settings-desc">When someone downvotes your post</span>
              </span>
              <input type="checkbox" class="notif-settings-toggle" data-notif-pref="downvotes" checked />
            </label>
            <label class="notif-settings-row">
              <svg class="notif-settings-icon notif-settings-icon--reply" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
              <span class="notif-settings-label">
                <strong>Replies</strong>
                <span class="notif-settings-desc">When someone replies to your post</span>
              </span>
              <input type="checkbox" class="notif-settings-toggle" data-notif-pref="replies" checked />
            </label>
            <label class="notif-settings-row">
              <svg class="notif-settings-icon notif-settings-icon--following" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9Z"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
              <span class="notif-settings-label">
                <strong>Posts you follow</strong>
                <span class="notif-settings-desc">Activity on posts you're following</span>
              </span>
              <input type="checkbox" class="notif-settings-toggle" data-notif-pref="following" checked />
            </label>
            <label class="notif-settings-row">
              <img class="notif-settings-icon notif-settings-icon--avatar" src="${BOARD_SELF_HOSTED ? tjLogoSrc : `${TJ_ORIGIN}/assets/kyleboas.jpeg`}" alt="" aria-hidden="true" />
              <span class="notif-settings-label">
                <strong>Opinion</strong>
                <span class="notif-settings-desc">New opinion posts</span>
              </span>
              <input type="checkbox" class="notif-settings-toggle" data-notif-pref="opinion" checked />
            </label>
            <label class="notif-settings-row">
              <img class="notif-settings-icon notif-settings-icon--avatar" src="${BOARD_SELF_HOSTED ? tjLogoSrc : `${TJ_ORIGIN}/assets/IMG_5503.png`}" alt="" aria-hidden="true" />
              <span class="notif-settings-label">
                <strong>Research</strong>
                <span class="notif-settings-desc">New research reports</span>
              </span>
              <input type="checkbox" class="notif-settings-toggle" data-notif-pref="research" checked />
            </label>
          </div>
          <div class="notif-feed site-account-notif-feed site-panel-animate">
            <div class="notif-empty site-account-notif-empty">
              <svg class="notif-empty-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                <path d="M13.73 21a2 2 0 0 1-3.46 0" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
              <p class="notif-empty-text">No notifications yet</p>
            </div>
          </div>
        </div>
        <div class="account-theme-section site-panel-animate">
          <div class="theme-setting" data-theme-setting>
            <label class="theme-setting-label" for="account-panel-theme-select">Theme</label>
            <select id="account-panel-theme-select" class="theme-setting-select" data-theme-select aria-label="Theme">
              <option value="system">System</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </div>
        </div>
      </div>
      <a href="https://tacticsjournal.com/search/" class="site-action site-action-toggle" data-inline-toggle="search" aria-label="Search" aria-expanded="false" aria-controls="site-search-panel">
        <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"/><path d="M16 16L21 21"/></svg>
      </a>
      <a href="https://tacticsjournal.com/account/" class="site-action site-action-toggle site-action-account-toggle" data-inline-toggle="account" aria-label="Account" aria-expanded="false" aria-controls="site-account-panel">
        <svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="3.5"/><path d="M5 20c1.5-3.5 4.1-5.25 7-5.25S17.5 16.5 19 20"/></svg>
      </a>
      <details class="site-menu">
        <summary class="site-action" aria-label="Menu">
          <svg class="menu-icon" viewBox="0 0 24 24"><path class="menu-top" d="M4 8h16"/><path class="menu-bottom" d="M4 16h16"/></svg>
        </summary>
        <div class="site-menu-overlay"></div>
        <div class="site-menu-panel">
          <div class="site-menu-primary">
            <a href="https://tacticsjournal.com/opinion/">Opinion</a>
            <a href="https://tacticsjournal.com/research/">Research</a>
            <a href="https://tacticsjournal.com/community/">Community</a>
          </div>
          <div class="site-menu-divider" aria-hidden="true"></div>
          <div class="site-menu-secondary">
            <a href="https://tacticsjournal.com/about/">About</a>
            <a href="https://tacticsjournal.com/ama/">AMA</a>
            <a href="https://board.tacticsjournal.com/" class="active" aria-current="page">Tactics Board</a>
            <a href="https://tacticsjournal.com/search/" class="site-menu-search-link">Search</a>
            <a href="https://tacticsjournal.com/archive/">Archive</a>
            <a href="https://tacticsjournal.com/follow/">Follow</a>
            <a href="https://tacticsjournal.com/contact/">Contact</a>
            <a href="https://tacticsjournal.com/key/">Key</a>
          </div>
          <div class="site-menu-theme">
            <div class="theme-setting" data-theme-setting>
              <label class="theme-setting-label" for="menu-theme-select">Theme</label>
              <select id="menu-theme-select" class="theme-setting-select" data-theme-select aria-label="Theme">
                <option value="system">System</option>
                <option value="light">Light</option>
                <option value="dark">Dark</option>
              </select>
            </div>
          </div>
        </div>
      </details>
    </div>
  </header>
  <div class="actionRow">
    <span class="actGroup" data-ext-toolbar>
      <button class="iconBtn" data-top="snap" id="snapBtn" aria-label="Snap to grid" title="Snap to grid">${ICONS.magnet}</button>
      <button class="iconBtn" data-top="export" aria-label="Share" title="Share and export" aria-haspopup="dialog" aria-expanded="false" aria-controls="shareMenu">${ICONS.export}</button>
      <button class="iconBtn" data-top="fit" aria-label="Fit view" title="Fit view (F)">${ICONS.fit}</button>
    </span>
    <span class="actGroup">
      <button class="iconBtn" data-top="undo" aria-label="Undo" title="Undo (${HINT_UNDO})">${ICONS.undo}</button>
      <button class="iconBtn" data-top="redo" aria-label="Redo" title="Redo (${HINT_REDO})">${ICONS.redo}</button>
    </span>
    <span class="actGroup">
      <button class="iconBtn" data-top="boards" aria-label="Boards" title="Boards in this project">${icon('stack')}</button>
      <button class="iconBtn" data-top="match" aria-label="Match settings" title="Match settings">${ICONS.cog}</button>
      <button class="iconBtn" data-top="note" aria-label="Note" title="This board's note">${icon('note')}</button>
      <button class="iconBtn hidden" data-top="live-shot" aria-label="Import live screenshot" title="Change live screenshot">${ICONS.camera}</button>
    </span>
    <input data-live-file type="file" accept="image/*" multiple style="display:none">
    <input data-asset-file type="file" accept="image/png,image/jpeg,image/webp" style="display:none">
  </div>
  <div class="modal hidden shareModal" id="shareMenu" role="dialog" aria-modal="true" aria-label="Share and export">
    <div class="sheet shareSheet" data-share-sheet></div>
  </div>
  <div class="workArea" id="workArea">
    <main class="stageWrap">
      <div class="ctxDock" id="ctxDock"></div>
      <div class="boardArea">
        <div id="stage"></div>
        <button class="boardReset" id="boardReset" type="button" aria-label="Reset 3D camera" title="Reset 3D camera">Reset</button>
        <p class="boardHint" id="boardHint" role="status" aria-live="polite"></p>
        <div class="liveEditChip" role="status" aria-live="polite" aria-atomic="true"></div>
      </div>
      <div class="fabCol hidden" id="fabCol">
        <span class="fabPair">
          <button class="fab" data-act="front" aria-label="Move forward" title="Move forward">${ICONS.front}</button>
          <button class="fab" data-act="back" aria-label="Move back" title="Move back">${ICONS.back}</button>
        </span>
        <button class="fab" data-act="flip-h" id="flipHBtn" aria-label="Flip" title="Flip">${ICONS.flipH}</button>
        <button class="fab" data-act="dup" aria-label="Duplicate" title="Duplicate (${HINT_DUP})">${ICONS.dup}</button>
        <button class="fab" data-act="rotate" id="rotateBtn" aria-label="Rotate 45 degrees" title="Rotate 45 degrees">${ICONS.rotate}</button>
        <button class="fab muted" data-act="del" aria-label="Delete" title="Delete (Backspace)">${ICONS.trash}</button>
      </div>
      <div class="fabBL hidden" id="fabBL">
        <div class="linkMenu t-dropdown" data-origin="bottom-left" id="linkMenu" role="menu">
          <button data-act="group" role="menuitem"><span class="linkIc">${icon('link')}</span><span>Group</span></button>
          <button data-act="save-stamp" role="menuitem"><span class="linkIc">${icon('stack')}</span><span>Save</span></button>
        </div>
        <button class="fab" data-act="link-menu" aria-label="Group or save" title="Group or save" aria-haspopup="menu" aria-expanded="false">${icon('link')}</button>
      </div>
      <button class="backBtn hidden" id="backBtn" data-act="back-node-edit">&larr; Back</button>
    </main>
    <section id="libRoot"></section>
    <div class="panelDock" id="panelDock">
      <section class="colorPicker" id="colorPicker" role="dialog" aria-label="Color picker" aria-modal="false">
        <div class="pickerHeader">
          <button class="pickerEye hidden" type="button" data-picker-eye aria-label="Pick color from board">${svg('<path d="M13.4 3.6a2.6 2.6 0 0 1 3.7 3.7l-1.6 1.6-3.7-3.7 1.6-1.6Z"/><path d="M11.2 5.8 4 13v3.6h3.6l7.2-7.2"/>')}</button>
          <div class="pickerTabs" role="tablist" aria-label="Color picker views"><button type="button" role="tab" data-picker-tab="custom" aria-selected="true">Custom</button><button type="button" role="tab" data-picker-tab="swatches" aria-selected="false">Swatches</button></div>
        </div>
        <div class="pickerSwatches" data-picker-swatches role="tabpanel" hidden></div>
        <div class="pickerCustom" data-picker-custom role="tabpanel"><div class="pickerWheel"><div class="pickerHue" aria-hidden="true"></div><button class="pickerHueHit" type="button" data-picker-hue aria-label="Hue ring"></button><svg class="pickerTriangle" viewBox="0 0 100 100" aria-hidden="true"><defs><linearGradient id="pickerWhite" gradientUnits="userSpaceOnUse" x1="84" y1="70" x2="33" y2="40"><stop stop-color="#fff"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient><linearGradient id="pickerBlack" gradientUnits="userSpaceOnUse" x1="16" y1="70" x2="67" y2="40"><stop/><stop offset="1" stop-opacity="0"/></linearGradient></defs><g data-picker-triangle-group><polygon data-picker-triangle points="50,11 83.77,69.5 16.23,69.5" fill="#e02020"/><polygon points="50,11 83.77,69.5 16.23,69.5" fill="url(#pickerWhite)"/><polygon points="50,11 83.77,69.5 16.23,69.5" fill="url(#pickerBlack)"/></g></svg><span class="pickerRingHandle" data-picker-ring></span><span class="pickerTriHandle" data-picker-triangle-handle></span></div></div>
        <footer class="pickerFooter"><button type="button" data-picker-hex aria-expanded="false">#E02020</button><input data-picker-input type="text" inputmode="text" maxlength="7" spellcheck="false" autocomplete="off" aria-label="Hex color" hidden></footer>
      </section>
      <span class="pickerCurrentDot" data-color-floating-dot aria-hidden="true"></span>
      <div class="colorDock" data-color-dock><span class="colorDockCurrent" data-color-dock-dot aria-hidden="true"></span><button class="colorDockChip" type="button" disabled aria-label="Unavailable color"><span></span></button><button class="colorDockChip" type="button" disabled aria-label="Unavailable color"><span></span></button><button class="colorDockClose" type="button" data-color-close aria-label="Close color picker">${icon('chevron-down')}</button></div>
      <div class="shelf hidden" id="shelf"></div>
      <button class="panelFold hidden" id="panelFold" data-act="fold-panel" aria-label="Hide panel">${icon('chevron-left')}<span>Hide panel</span></button>
      <div class="options" id="options"></div>
    </div>
    <nav class="toolbar" id="toolbar"></nav>
  </div>
</div>`

const viewportGateEl = document.querySelector<HTMLElement>('[data-viewport-gate]')!
function updateViewportGate() {
  const vv = window.visualViewport
  const width = vv?.width ?? window.innerWidth
  const height = vv?.height ?? window.innerHeight
  const active = document.activeElement as HTMLElement | null
  const editing = !!active && /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName)
  // A keyboard is not a small screen. Tapping a result blurs the field for a
  // moment while the keys are still up, and measuring the visual viewport
  // then would hide the whole board under "screen too small" mid-tap.
  const keyboard = window.innerHeight - height > 120 || document.body.classList.contains('kb-open')
  const room = keyboard ? window.innerHeight : height
  document.body.classList.toggle('board-viewport-too-small', !editing && room < 300)
}
window.addEventListener('resize', updateViewportGate)
window.addEventListener('orientationchange', updateViewportGate)
window.visualViewport?.addEventListener('resize', updateViewportGate)
document.addEventListener('focusin', updateViewportGate)
document.addEventListener('focusout', () => window.setTimeout(updateViewportGate, 120))
updateViewportGate()
void viewportGateEl

/**
 * The sheets are framed by the visual viewport rather than the page. iOS
 * keeps a fixed element on the layout viewport and scrolls the page beneath
 * the keyboard, so a full-height sheet loses its top and the field you tapped
 * ends up behind the keys. Publishing what is visible keeps the sheet inside
 * it, and the sheet's own scrolling does the rest.
 */
function syncSheetViewport() {
  const vv = window.visualViewport
  const top = Math.round(vv?.offsetTop ?? 0)
  const height = Math.round(vv?.height ?? window.innerHeight)
  const style = document.documentElement.style
  style.setProperty('--vvTop', `${top}px`)
  style.setProperty('--vvLeft', `${Math.round(vv?.offsetLeft ?? 0)}px`)
  style.setProperty('--vvW', `${Math.round(vv?.width ?? window.innerWidth)}px`)
  style.setProperty('--vvH', `${height}px`)
  // The iOS keyboard toolbar is translucent around its rounded top edge. Fill
  // the covered part of the layout viewport so the board cannot show through.
  style.setProperty('--vvBottom', `${Math.max(0, window.innerHeight - top - height)}px`)
  // Typing with only a sliver of screen left: the keyboard either ate the
  // visual viewport or the window is simply short. Both leave a sheet with
  // no room under the field, so the panels that care condense themselves.
  const active = document.activeElement as HTMLElement | null
  const editing = !!active && /^(INPUT|TEXTAREA)$/.test(active.tagName)
  const inset = Math.max(0, window.innerHeight - height)
  const short = inset > 120 || height < 520
  // It stays on until the screen comes back: dropping it the moment the field
  // blurs would reflow the list out from under the finger that is tapping it.
  const held = document.body.classList.contains('kb-open')
  document.body.classList.toggle('kb-open', short && (editing || held))
}
window.visualViewport?.addEventListener('resize', syncSheetViewport)
window.visualViewport?.addEventListener('scroll', syncSheetViewport)
window.addEventListener('resize', syncSheetViewport)
document.addEventListener('focusin', syncSheetViewport)
document.addEventListener('focusout', () => window.setTimeout(syncSheetViewport, 120))
window.addEventListener('orientationchange', () => window.setTimeout(syncSheetViewport, 120))
syncSheetViewport()

/**
 * Bring the field you tapped back into the sheet's view once the keyboard has
 * taken its half of the screen. The keyboard animates in, so the scroll waits
 * for the viewport to settle rather than measuring the old height.
 */
document.addEventListener('focusin', (e) => {
  const field = (e.target as HTMLElement | null)?.closest?.('input, textarea, select') as HTMLElement | null
  if (!field || !field.closest('.sheet')) return
  window.setTimeout(() => {
    if (document.activeElement !== field) return
    // A search field answers underneath itself, so on a keyboard-shortened
    // screen it goes to the top of what is left rather than the middle:
    // centring it leaves the first result under the keys.
    const searching = field.classList.contains('setSearch') && document.body.classList.contains('kb-open')
    const target = (searching && field.closest('.setSearchItem')) || field
    target.scrollIntoView({
      block: searching ? 'start' : 'center',
      behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    })
  }, 300)
})

const stageEl = document.querySelector<HTMLDivElement>('#stage')!
const liveEditChipEl = document.querySelector<HTMLElement>('.liveEditChip')!
const stageWrap = document.querySelector<HTMLDivElement>('.stageWrap')!
const optionsEl = document.querySelector<HTMLDivElement>('#options')!
const toolbarEl = document.querySelector<HTMLDivElement>('#toolbar')!
const shelfEl = document.querySelector<HTMLDivElement>('#shelf')!
const panelDockEl = document.querySelector<HTMLDivElement>('#panelDock')!
const ctxDockEl = document.querySelector<HTMLDivElement>('#ctxDock')!
const fabColEl = document.querySelector<HTMLElement>('#fabCol')!
const fabBLEl = document.querySelector<HTMLElement>('#fabBL')!
const panelFoldEl = document.querySelector<HTMLButtonElement>('#panelFold')!
const colorPickerEl = document.querySelector<HTMLElement>('#colorPicker')!
const colorDockEl = document.querySelector<HTMLElement>('[data-color-dock]')!

if ('ontouchstart' in window || navigator.maxTouchPoints > 0) {
  document.addEventListener('contextmenu', (e) => {
    const target = e.target as HTMLElement | null
    if (!target) return
    const tag = target.tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.closest('.textEdit')) return
    e.preventDefault()
  })

  // iOS Safari can still interpret two quick taps on the board as page zoom.
  // Only cancel that gesture on the drawing canvas; never cancel control-bar
  // touches, because preventDefault on touchend suppresses their click events.
  let lastBoardTouch: { time: number; x: number; y: number } | null = null
  document.addEventListener('touchend', (e) => {
    const target = e.target as HTMLElement | null
    const tag = target?.tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.closest('.textEdit')) return
    const onBoard = !!target?.closest('#stage')
    if (!onBoard) { lastBoardTouch = null; return }
    const touch = e.changedTouches[0]
    if (!touch) return
    const now = Date.now()
    const closeToLast = lastBoardTouch
      && now - lastBoardTouch.time < 320
      && Math.hypot(touch.clientX - lastBoardTouch.x, touch.clientY - lastBoardTouch.y) < 32
    if (closeToLast) e.preventDefault()
    lastBoardTouch = { time: now, x: touch.clientX, y: touch.clientY }
  }, { passive: false })
}

const board = new Board(store, stageEl, defaults)
/** Installed after saved-board/session setup; keeping these no-ops makes board switches safe during boot. */
let collaborationBoardChanged = () => {}
let clearCollaborationPreview = () => {}
const importer = new ImportPanel(store, document.body)
const saves = new SavesPanel(store, document.body)
recoverCategorySnapshots()
const teams = new TeamPanel(store, defaults, document.body, () => renderPanel())

// One pass reconciles each durable personal library while Project sync remains
// the sole owner of the current editor scene.
const librarySyncStore: LibrarySyncStore = {
  async list() {
    return [
      ...await backgrounds.librarySyncStore().list(),
      ...await stampLibrarySyncStore().list(),
      ...await teams.librarySyncStore().list(),
      ...await categoryScenesLibraryStore.list(),
    ]
  },
  async apply(record) {
    if (record.syncAccount && record.syncAccount !== accountBinding) return
    if (record.kind === 'background') await backgrounds.librarySyncStore().apply(record)
    else if (record.kind === 'stamp') await stampLibrarySyncStore().apply(record)
    else if (record.kind === 'team_setup') await teams.librarySyncStore().apply(record)
    else if (record.kind === 'category_scenes') await categoryScenesLibraryStore.apply(record)
  },
  async bind(ids, account) {
    if (account !== accountBinding) return
    await backgrounds.librarySyncStore().bind(ids, account)
    await stampLibrarySyncStore().bind(ids, account)
    await teams.librarySyncStore().bind(ids, account)
    await categoryScenesLibraryStore.bind(ids, account)
  },
}

/**
 * Apply one tool-default control. Shared by the options strip and the shapes
 * shelf, which offer the same defaults through different affordances.
 */
function applyDefaultOption(key: string, v?: string) {
  {
    if (key === 'd-team') {
      if (v) {
        const now = Date.now()
        if (lastTeamChipTap?.name === v && now - lastTeamChipTap.time < 400) {
          teams.cycleTeamColor(v)
          lastTeamChipTap = null
        } else {
          teams.activate(v)
          lastTeamChipTap = { name: v, time: now }
        }
      }
    } else if (key === 'd-team-setup') {
      if (v === 'home' || v === 'away') teams.openSide(v)
      return
    } else if (key === 'd-add-player') {
      addPlayerFromPlayerMenu()
    } else if (key === 'd-add-marker') {
      addMarkerFromPlayerMenu()
    } else if (key === 'd-add-xi') {
      const name = teams.activeTeamName()
      if (name) addTeamFromPlayerMenu(name)
    } else if (key === 'd-flip-board') {
      teams.flipBoard()
    } else if (key === 'd-team-color') {
      const name = teams.activeTeamName()
      if (name && v) teams.setTeamColor(name, v)
    } else if (key === 'd-pcolor') {
      defaults.playerColor = v!
    } else if (key === 'd-dash') defaults.arrow.dash = v as ArrowObj['dash']
    else if (key === 'd-head') defaults.arrow.head = v === 'head'
    else if (key === 'd-color') defaults.arrow.color = v!
    else if (key === 'd-width') defaults.arrow.width = Number(v)
    else if (key === 'd-shape') defaults.box.shape = v as BoxObj['shape']
    else if (key === 'd-fill') defaults.box.fill = v!
    else if (key === 'd-opacity') defaults.box.opacity = Number(v)
    else if (key === 'd-bold') defaults.text.bold = v === 'bold'
    else if (key === 'd-tcolor') defaults.text.color = v!
    else if (key === 'd-size') defaults.text.size = Number(v)
    else if (key === 'd-place') defaults.place = v as ToolDefaults['place']
    else if (key === 'd-goal-variant') defaults.goal.variant = v as GoalObj['variant']
    else if (key === 'd-measure-color') defaults.measure.color = v!
    else if (key === 'd-measure-width') defaults.measure.width = Number(v)
    renderPanel()
  }
}

/* ---------- bottom rooms and the shapes shelf ---------- */

/**
 * The bottom band names rooms, not tools: Settings, Shapes, Text, Styles.
 * Shapes holds everything placeable as a two-row shelf that scrolls sideways;
 * Styles holds whatever the selection can be changed by; Text is its own room
 * because its one useful action is making a new one.
 */
type Room = 'shapes' | 'text' | 'styles'
let room: Room = 'shapes'
let panelOpen = true
let shelfCat = 'players'
let shelfScrollX = 0
let shelfScrollY = 0
let pendingCatScroll: string | null = null
let shelfSpyLocked = false
let shelfSpyFrame = 0
let pickerOpen = false
let pickerFocus: HTMLElement | null = null

/** Number-key shortcuts kept from the tool tabs: 1-5 still reach every tool. */
const TOOL_KEYS: { tool: Tool; cat: string }[] = [
  { tool: 'player', cat: 'players' },
  { tool: 'ball', cat: 'equipment' },
  { tool: 'arrow', cat: 'arrows' },
  { tool: 'box', cat: 'zones' },
  { tool: 'text', cat: 'players' },
]

const ROOMS: { room: Room; label: string; tool?: Tool }[] = [
  { room: 'shapes', label: 'Shapes' },
  { room: 'text', label: 'Text', tool: 'text' },
  { room: 'styles', label: 'Styles' },
]

/** The tool each shelf category arms. */
const CAT_TOOL: Record<string, Tool> = { players: 'player', arrows: 'arrow', zones: 'box', equipment: 'ball' }

/**
 * Shelf art is the board's own drawing, not a redrawn lookalike: the image
 * assets the pitch uses, and arrows rendered by makeArrowShape so dash, cap
 * and head are the shapes you get when you drag one.
 */
const arrowPreviewCache = new Map<string, string>()
function arrowPreview(dash: ArrowObj['dash'], head: boolean, color: string, width: number, measure = false, live = false) {
  const key = `${dash}|${head}|${color}|${width}|${measure}|${live}`
  const hit = arrowPreviewCache.get(key)
  if (hit) return hit
  const W = 72, H = 30
  const holder = document.createElement('div')
  const stage = new Konva.Stage({ container: holder, width: W, height: H })
  const layer = new Konva.Layer({ listening: false })
  stage.add(layer)
  // On the pitch a white arrow reads against grass; the shelf is pale in both
  // themes, so a light one brings a dark plate with it rather than vanishing.
  if (isLight(color)) layer.add(new Konva.Rect({ width: W, height: H, cornerRadius: 7, fill: '#4b5058' }))
  layer.add(makeArrowShape({
    id: 'preview', type: 'arrow',
    x1: 6, y1: H / 2, x2: W - 6, y2: H / 2, mx: W / 2, my: H / 2,
    curved: false, dash, color, width, head, measure, headSize: arrowHeadSize(width, live),
  } as ArrowObj, 1, live))
  layer.draw()
  const url = stage.toDataURL({ pixelRatio: 2 })
  stage.destroy()
  arrowPreviewCache.set(key, url)
  return url
}

/**
 * A broadcast board turns the new-arrow default white so it reads over video.
 * The deck is pale in both themes, so showing that white would put every arrow
 * choice on a dark plate; the deck is a shape picker, so it draws the dash,
 * head and the pitch's own line weight in the shelf's own ink instead. The
 * arrow you then drag onto the board is still white.
 */
const shelfArrowColor = () =>
  liveArrows() && defaults.arrow.color === '#ffffff' ? '#111111' : defaults.arrow.color

const img = (src: string, w: number, h: number) =>
  `<img src="${src}" width="${w}" height="${h}" alt="" draggable="false">`

const shelfArt = {
  /** Konva fills the circle and strokes it at 0.38r in near-black. */
  player: (color: string) =>
    `<svg viewBox="0 0 34 34" style="filter:drop-shadow(1.2px 1.8px 3.5px rgba(0,0,0,.3))"><circle cx="17" cy="17" r="10" fill="${color}" stroke="#0b0b0e" stroke-width="3.8"/></svg>`,
  /** A keeper is the same token in the keeper's colour - nothing else differs. */
  keeper: (color: string) =>
    `<svg viewBox="0 0 34 34" style="filter:drop-shadow(1.2px 1.8px 3.5px rgba(0,0,0,.3))"><circle cx="17" cy="17" r="10" fill="${color}" stroke="#0b0b0e" stroke-width="3.8"/></svg>`,
  eleven: (color: string) => {
    const dot = (x: number, y: number) => `<circle cx="${x}" cy="${y}" r="4" fill="${color}" stroke="#0b0b0e" stroke-width="1.5"/>`
    return `<svg viewBox="0 0 34 34">${dot(7, 8)}${dot(17, 8)}${dot(27, 8)}${dot(7, 17)}${dot(17, 17)}${dot(27, 17)}${dot(12, 26)}${dot(22, 26)}</svg>`
  },
  /** Side picker: the kit token the board draws, plus that team's code. */
  teamPick: (color: string, code: string) =>
    `<span class="cellTeamInner"><svg viewBox="0 0 34 34" style="filter:drop-shadow(1px 1.4px 2.6px rgba(0,0,0,.3))"><circle cx="17" cy="17" r="10" fill="${color}" stroke="#0b0b0e" stroke-width="3.8"/></svg><span class="cellCode">${esc(code)}</span></span>`,
  teamEmpty: (label: string) =>
    `<span class="cellTeamInner"><svg viewBox="0 0 34 34" fill="none"><circle cx="17" cy="17" r="9" stroke="currentColor" stroke-width="2" stroke-dasharray="3 3"/></svg><span class="cellCode cellCodeGhost">${esc(label)}</span></span>`,
  /** Board actions, drawn in the sheet's own line weight rather than as tokens. */
  flip: opposedArrows(),
  swap: `<span class="swapArt">${opposedArrows()}</span>`,
  addAsset: `<svg viewBox="0 0 34 34" fill="none"><path d="M17 9v16M9 17h16" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>`,
  setTeams: `<svg viewBox="0 0 34 34" fill="none"><circle cx="12" cy="14" r="6" stroke="currentColor" stroke-width="2" stroke-dasharray="3 3"/><circle cx="23" cy="21" r="6" stroke="currentColor" stroke-width="2" stroke-dasharray="3 3"/></svg>`,
  /** The live marker is the same crop of the same screenshot the board uses. */
  marker: `<span class="cellCrop" style="background-image:url(${livePlayerSrc});
    background-size:${(4096 / LIVE_PLAYER_CROP.width) * 100}% ${(4096 / LIVE_PLAYER_CROP.height) * 100}%;
    background-position:${(LIVE_PLAYER_CROP.x / (4096 - LIVE_PLAYER_CROP.width)) * 100}% ${(LIVE_PLAYER_CROP.y / (4096 - LIVE_PLAYER_CROP.height)) * 100}%;"></span>`,
  arrow: (dash: ArrowObj['dash'], head: boolean) =>
    `<img class="cellWide" src="${arrowPreview(dash, head, shelfArrowColor(), defaults.arrow.width, false, liveArrows())}" alt="" draggable="false">`,
  measure: () =>
    `<img class="cellWide" src="${arrowPreview('solid', false, defaults.measure.color, defaults.measure.width, true)}" alt="" draggable="false">`,
  box: (fill: string, opacity: number) =>
    `<svg viewBox="0 0 34 34"><rect x="4" y="10" width="26" height="15" rx="1" fill="${fill}" opacity="${opacity}"/></svg>`,
  ellipse: (fill: string, opacity: number) =>
    `<svg viewBox="0 0 34 34"><ellipse cx="17" cy="17" rx="13" ry="8" fill="${fill}" opacity="${opacity}"/></svg>`,
  triangle: (fill: string, opacity: number) =>
    `<svg viewBox="0 0 34 34"><polygon points="17,8 30,25 4,25" fill="${fill}" opacity="${opacity}"/></svg>`,
  outline: (fill: string) =>
    `<svg viewBox="0 0 34 34"><rect x="5" y="11" width="24" height="13" fill="none" stroke="${fill}" stroke-width="3"/></svg>`,
  ball: img(ballSrc, 26, 26),
  cone: img(coneSrc, 26, Math.round(26 * CONE_ASPECT)),
  goalSmall: img(goalSmallSrc, 30, Math.round(30 * GOAL_ASPECT.small)),
  goalFull: img(goalFullSrc, 30, Math.round(30 * GOAL_ASPECT.normal)),
}

type ShelfItem = {
  id: string
  title: string
  art: string
  tool?: Tool
  /** Tool-default controls this cell sets, in order. */
  opts?: [string, string?][]
  /** Anything the cell does that is not a tool default. */
  run?: () => void
  /** Second tap within the double-tap window, instead of running the cell again. */
  again?: () => void
  active?: () => boolean
  /** Holds a side's place in the grid so the columns after it stay in their rows. */
  spacer?: boolean
  /** A board action rather than something placeable: quieter, and off the tool rhythm. */
  util?: boolean
  /** A rule between the utility column and the tokens, not a cell. */
  divider?: boolean
  disabled?: () => boolean
}

/**
 * The kit each side's tokens wear. A side that has a team wears its colour;
 * before any team is set the two still have to read apart, so away falls back
 * to navy - or to red, if red is what home is already wearing.
 */
const AWAY_FALLBACK = '#1e2f6f'
function sidePlayerColor(side: TeamSide) {
  const team = teams.getTeamForSide(side)
  if (team) return team.color
  if (side === 'home') return defaults.playerColor
  return normalizeHex(defaults.playerColor) === AWAY_FALLBACK ? '#e02020' : AWAY_FALLBACK
}

/** The keeper stands out from both kits, and from the other keeper. */
const keeperColor = (side: TeamSide) => (side === 'away' ? '#d1d5db' : '#6b7280')

function shelfCategories(): { cat: string; label: string; items: ShelfItem[] }[] {
  const live = pitchById(store.scene.pitch).live
  const home = teams.getTeamForSide('home')
  const away = teams.getTeamForSide('away')
  const activeName = teams.activeTeamName()
  const players: ShelfItem[] = []
  if (live) {
    players.push({ id: 'marker', title: 'Live player', art: shelfArt.marker, tool: 'player', opts: [['d-add-marker']] })
  } else {
    // The shelf is two rows of sides: home along the top, away along the
    // bottom. Every column is the same thing for each side, so a token is
    // placed by reaching for its row rather than by first saying which side
    // you are on.
    const SIDES = ['home', 'away'] as const
    // Flip and swap act on the whole board, not on a side, so they lead the
    // shelf as their own column: flip over the home row, swap over the away
    // one, with a rule keeping them out of the token grid.
    players.push(
      { id: 'flip-board', title: 'Switch sides on board', art: shelfArt.flip, util: true, run: () => teams.flipBoard() },
      { id: 'swap-sides', title: 'Switch home and away', art: shelfArt.swap, util: true, run: () => teams.swapSides(), disabled: () => !home || !away },
      { id: 'lead-rule', title: '', art: '', divider: true },
    )
    for (const side of SIDES) {
      const team = side === 'home' ? home : away
      players.push(team
        ? {
            id: `team-${side}`, title: `${team.name} (${side})`, tool: 'player',
            art: shelfArt.teamPick(team.color, teamCode(team)),
            run: () => teams.activate(team.name),
            again: () => teams.cycleTeamColor(team.name),
            active: () => activeName === team.name,
          }
        : {
            id: `team-${side}`, title: `Set the ${side} team`, tool: 'player',
            art: shelfArt.teamEmpty(side === 'home' ? 'Home' : 'Away'),
            run: () => teams.openSide(side),
          })
    }
    for (const side of SIDES) {
      players.push({
        id: `player-${side}`, title: `${side === 'home' ? 'Home' : 'Away'} player`, tool: 'player',
        art: shelfArt.player(sidePlayerColor(side)),
        run: () => addPlayerForSide(side),
      })
    }
    for (const side of SIDES) {
      players.push({
        id: `keeper-${side}`, title: `${side === 'home' ? 'Home' : 'Away'} keeper`, tool: 'player',
        art: shelfArt.keeper(keeperColor(side)),
        run: () => addPlayerForSide(side, true),
      })
    }
    // A whole eleven needs a team to fill it. One side having one still keeps
    // its row: the other side holds its place rather than letting the columns
    // after it slide up.
    if (home || away) {
      for (const side of SIDES) {
        const team = side === 'home' ? home : away
        players.push(team
          ? {
              id: `xi-${side}`, title: `${team.name} eleven`, tool: 'player',
              art: shelfArt.eleven(team.color),
              run: () => addTeamFromPlayerMenu(team.name),
            }
          : { id: `xi-${side}`, title: '', art: '', spacer: true })
      }
    }
  }

  const equipment: ShelfItem[] = [
    { id: 'ball', title: 'Ball', art: shelfArt.ball, tool: 'ball', opts: [['d-place', 'ball']], active: () => defaults.place === 'ball' },
  ]
  if (entitlements.canPlaceCone()) {
    equipment.push(
      { id: 'cone', title: 'Cone', art: shelfArt.cone, tool: 'ball', opts: [['d-place', 'cone']], active: () => defaults.place === 'cone' },
      { id: 'goal-small', title: 'Small goal', art: shelfArt.goalSmall, tool: 'ball', opts: [['d-place', 'goal'], ['d-goal-variant', 'small']], active: () => defaults.place === 'goal' && defaults.goal.variant === 'small' },
      { id: 'goal-full', title: 'Full goal', art: shelfArt.goalFull, tool: 'ball', opts: [['d-place', 'goal'], ['d-goal-variant', 'normal']], active: () => defaults.place === 'goal' && defaults.goal.variant === 'normal' },
    )
  }
  equipment.push({ id: 'measure', title: 'Measure', art: shelfArt.measure(), tool: 'ball', opts: [['d-place', 'measure']], active: () => defaults.place === 'measure' })

  const rows: { cat: string; label: string; items: ShelfItem[] }[] = [
    { cat: 'players', label: 'Players', items: [...players, ...stampItems('players'), ...assetItems('players')] },
    {
      cat: 'arrows',
      label: 'Arrows',
      items: [
        { id: 'solid', title: 'Solid arrow', art: shelfArt.arrow('solid', true), tool: 'arrow', opts: [['d-dash', 'solid'], ['d-head', 'head']], active: () => defaults.arrow.dash === 'solid' && defaults.arrow.head },
        { id: 'dashed', title: 'Dashed arrow', art: shelfArt.arrow('dashed', true), tool: 'arrow', opts: [['d-dash', 'dashed'], ['d-head', 'head']], active: () => defaults.arrow.dash === 'dashed' && defaults.arrow.head },
        { id: 'dotted', title: 'Dotted arrow', art: shelfArt.arrow('dotted', true), tool: 'arrow', opts: [['d-dash', 'dotted'], ['d-head', 'head']], active: () => defaults.arrow.dash === 'dotted' && defaults.arrow.head },
        { id: 'line', title: 'Line', art: shelfArt.arrow(defaults.arrow.dash, false), tool: 'arrow', opts: [['d-head', 'nohead']], active: () => !defaults.arrow.head },
        ...stampItems('arrows'),
        ...assetItems('arrows'),
      ],
    },
    {
      cat: 'zones',
      label: 'Zones',
      items: [
        { id: 'rect', title: 'Box', art: shelfArt.box(defaults.box.fill, defaults.box.opacity), tool: 'box', opts: [['d-shape', 'rect']], active: () => defaults.box.shape === 'rect' },
        { id: 'ellipse', title: 'Oval', art: shelfArt.ellipse(defaults.box.fill, defaults.box.opacity), tool: 'box', opts: [['d-shape', 'ellipse']], active: () => defaults.box.shape === 'ellipse' },
        { id: 'triangle', title: 'Triangle', art: shelfArt.triangle(defaults.box.fill, defaults.box.opacity), tool: 'box', opts: [['d-shape', 'triangle']], active: () => defaults.box.shape === 'triangle' },
        { id: 'outline', title: 'Outline', art: shelfArt.outline(defaults.box.fill), tool: 'box', opts: [['d-shape', 'outline']], active: () => defaults.box.shape === 'outline' },
        ...stampItems('zones'),
        ...assetItems('zones'),
      ],
    },
    { cat: 'equipment', label: 'Equipment', items: [...equipment, ...stampItems('equipment'), ...assetItems('equipment')] },
  ]
  // rows the user invented by saving a combination into a name of their own
  for (const cat of customCats(ASSET_CATEGORIES)) rows.push({ cat, label: cat, items: stampItems(cat) })
  return rows
}

/** True while the shapes shelf is on screen and owns the placement controls. */
function shelfShowing() { return panelOpen && room === 'shapes' && board.interactionState !== 'node-edit' }

/**
 * Whether the shelf holds anything, which is not the same as whether you can
 * see it. A folded desktop panel keeps its shapes and is clipped away, so the
 * fold reads as one thing collapsing rather than the contents blinking out
 * first. It goes inert with the fold, so nothing in there takes a tab stop.
 */
function shelfHasContent() {
  return room === 'shapes' && board.interactionState !== 'node-edit' && (panelOpen || deskMode)
}

/* ---------- the user's own assets ---------- */

/** Which asset the shelf is currently managing, if any. */
let managingAssetId: string | null = null
/** Same press-and-hold, for a saved combination rather than an uploaded file. */
let managingStampId: string | null = null
/** The category an upload should land in, set when the picker opens. */
let uploadCat: AssetCategory = 'players'

const canUseAssets = () => entitlements.canPlaceCone()

const assetFileEl = document.querySelector<HTMLInputElement>('[data-asset-file]')!

function assetArt(a: UserAsset) {
  return `<img class="cellAsset" src="${a.src}" alt="" draggable="false">`
}

/** Drop an asset on the board, stepping each new one clear of the last. */
function placeAsset(a: UserAsset) {
  const placed = store.scene.objects.filter(o => o.type === 'image').length
  const obj: ImageObj = {
    id: uid(), type: 'image',
    x: BOARD_W / 2 + (placed % 4) * 26 - 39,
    y: boardH() / 2 + Math.floor(placed / 4) * 26 - 26,
    size: 90,
    aspect: a.h / a.w,
    assetId: a.id,
    flipX: false, flipY: false,
  }
  store.apply(s => { insertByTier(s.objects, obj) })
  store.select(obj.id)
}

/** Cells for this category: the user's own assets, then the way to add one. */
function assetItems(cat: AssetCategory): ShelfItem[] {
  const mine = listAssets(cat).map(a => ({
    id: `asset-${a.id}`,
    title: a.name,
    art: assetArt(a),
    run: () => placeAsset(a),
  }))
  return [...mine, { id: 'asset-add', title: 'Add your own', art: shelfArt.addAsset, run: () => openAssetPicker(cat) }]
}

function openAssetPicker(cat: AssetCategory) {
  uploadCat = cat
  assetFileEl.value = ''
  assetFileEl.click()
}

function showAssetNote(text: string) {
  showBanner(`<p>${esc(text)}</p><span class="appBannerActions"><button data-banner="dismiss">Dismiss</button></span>`, 'warn')
}

assetFileEl.addEventListener('change', async () => {
  const file = assetFileEl.files?.[0]
  if (!file) return
  try {
    const { src, w, h } = await readImageFile(file)
    addAsset({ name: file.name.replace(/\.[a-z0-9]+$/i, '').slice(0, 40) || 'Asset', cat: uploadCat, src, w, h })
  } catch (err) {
    showAssetNote(err instanceof AssetQuotaError
      ? 'There is no room for another asset. Remove one in Settings first.'
      : (err as Error).message || 'That file could not be added.')
  }
  assetFileEl.value = ''
  board.rebuild()
  renderPanel()
  renderAssetList()
})

/** The bar under the shelf while one asset is being managed. */
function renderAssetManageBar(): string {
  const a = managingAssetId ? getAsset(managingAssetId) : undefined
  if (!a) return ''
  const options = ASSET_CATS.map(([cat, label]) =>
    `<option value="${cat}" ${cat === a.cat ? 'selected' : ''}>${label}</option>`).join('')
  return `<div class="assetBar">
    <label class="labelIn assetName"><input data-asset="name" maxlength="40" value="${esc(a.name)}" aria-label="Asset name"></label>
    <select class="assetMove" data-asset="move" aria-label="Asset category">${options}</select>
    <button type="button" class="assetDelete" data-asset="delete" aria-label="Delete asset" title="Delete asset">${icon('trash')}</button>
    <button type="button" class="assetDone" data-asset="done" aria-label="Save asset" title="Save asset">${icon('check')}</button>
  </div>`
}

const ASSET_CATS: [AssetCategory, string][] = [
  ['players', 'Players'], ['arrows', 'Arrows'], ['zones', 'Zones'], ['equipment', 'Equipment'],
]

/** Typing a row name rather than picking one of the existing rows. */
let namingRow = false

/** The bar under the shelf while one saved combination is being managed. */
function renderStampManageBar(): string {
  const st = managingStampId ? listStamps().find(s => s.id === managingStampId) : undefined
  if (!st) return ''
  const rows = [...ASSET_CATEGORIES, ...customCats(ASSET_CATEGORIES)]
  const picker = namingRow
    ? `<input class="labelIn assetMove stampRowNew" data-stamp-manage="new-cat" maxlength="${MAX_CAT_LENGTH}" placeholder="Row name" autofocus>`
    : `<select class="assetMove" data-stamp-manage="move">`
        + rows.map(c => `<option value="${esc(c)}" ${c === st.cat ? 'selected' : ''}>${esc(catLabel(c))}</option>`).join('')
        + `<option value="">New row\u2026</option>`
      + `</select>`
  return `<div class="assetBar">
    <label class="labelIn assetName"><input data-stamp-manage="name" maxlength="40" value="${esc(st.name)}"></label>
    <label class="lbl">${picker}</label>
    <button class="addChip assetDelete" data-stamp-manage="delete">Delete</button>
    <button class="addChip assetDone" data-stamp-manage="done">Done</button>
  </div>`
}

/** Press and hold one of your own cells to manage it. */
let holdTimer: number | undefined
let holdStart: { x: number; y: number } | null = null
shelfEl.addEventListener('pointerdown', (e) => {
  holdStart = { x: e.clientX, y: e.clientY }
  const held = (e.target as HTMLElement).closest('[data-shelf^="asset-"], [data-shelf^="stamp-"]') as HTMLElement | null
  const key = held?.dataset.shelf ?? ''
  const stamp = key.startsWith('stamp-')
  const id = key.slice(stamp ? 'stamp-'.length : 'asset-'.length)
  if (!id || id === 'add' || !canUseAssets()) return
  holdTimer = window.setTimeout(() => {
    holdTimer = undefined
    if (stamp) managingStampId = id
    else managingAssetId = id
    renderPanel()
  }, 500)
})

shelfEl.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest('[data-stamp-manage]') as HTMLElement | null
  if (!btn || !managingStampId) return
  const act = btn.dataset.stampManage
  if (act === 'delete') removeStamp(managingStampId)
  else if (act !== 'done') return
  managingStampId = null
  namingRow = false
  renderPanel()
})

shelfEl.addEventListener('change', (e) => {
  const target = e.target as HTMLInputElement | HTMLSelectElement
  const act = target.dataset.stampManage
  if (!managingStampId || !act) return
  if (act === 'name') {
    updateStamp(managingStampId, { name: target.value.trim().slice(0, 40) || 'Combination' })
  } else if (act === 'move') {
    // the empty option is "New row", which swaps the picker for a field
    if (!target.value) { namingRow = true; renderPanel(); return }
    updateStamp(managingStampId, { cat: target.value })
    shelfCat = target.value
  } else if (act === 'new-cat') {
    const cat = normalizeCat(target.value)
    if (!cat) { showAssetNote('Give the new row a name first.'); return }
    updateStamp(managingStampId, { cat })
    namingRow = false
    shelfCat = cat
  } else return
  renderPanel()
})
shelfEl.addEventListener('pointermove', (e) => {
  if (holdStart && Math.hypot(e.clientX - holdStart.x, e.clientY - holdStart.y) > 8 && holdTimer) {
    clearTimeout(holdTimer); holdTimer = undefined
  }
})
for (const ev of ['pointerup', 'pointercancel', 'pointerleave'] as const) {
  shelfEl.addEventListener(ev, () => { holdStart = null; if (holdTimer) { clearTimeout(holdTimer); holdTimer = undefined } })
}

shelfEl.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest('[data-asset]') as HTMLElement | null
  if (!btn || !managingAssetId) return
  const act = btn.dataset.asset
  if (act === 'done') {
    // Safari can deliver a button click before the field's change event. Read
    // both visible values here so saving never depends on blur ordering.
    const name = shelfEl.querySelector<HTMLInputElement>('[data-asset="name"]')?.value
    const cat = shelfEl.querySelector<HTMLSelectElement>('[data-asset="move"]')?.value as AssetCategory | undefined
    try { updateAsset(managingAssetId, { name: name?.trim().slice(0, 40) || 'Asset', ...(cat ? { cat } : {}) }) }
    catch { showAssetNote('That change did not fit in the space left.'); return }
    managingAssetId = null
  } else if (act === 'delete') {
    removeAsset(managingAssetId)
    managingAssetId = null
    board.rebuild()
    renderAssetList()
  } else return
  renderPanel()
})

shelfEl.addEventListener('change', (e) => {
  const target = e.target as HTMLInputElement | HTMLSelectElement
  if (!managingAssetId || !target.dataset.asset) return
  try {
    if (target.dataset.asset === 'name') updateAsset(managingAssetId, { name: target.value.trim().slice(0, 40) || 'Asset' })
    if (target.dataset.asset === 'move') updateAsset(managingAssetId, { cat: target.value as AssetCategory })
  } catch { showAssetNote('That change did not fit in the space left.') }
  renderPanel()
  renderAssetList()
})

function shelfCells(items: ShelfItem[]) {
  return items.map(it => {
    if (it.spacer) return `<span class="cell cellSpacer" aria-hidden="true"></span>`
    if (it.divider) return `<span class="shelfRule" aria-hidden="true"></span>`
    const on = !!it.active?.() && board.tool === it.tool
    const wide = it.id.startsWith('team-')
    const mine = (it.id.startsWith('asset-') && it.id !== 'asset-add') || it.id.startsWith('stamp-')
    const isAdd = it.id === 'asset-add'
    const managing = managingAssetId !== null || managingStampId !== null
    const classes = ['cell', wide ? 'cellTeam' : '', it.util ? 'cellUtil' : '', isAdd ? 'cellAdd' : '', isAdd && !canUseAssets() ? 'cellLocked' : '', on ? 'active' : '', managing && !mine ? 'cellDim' : '', managing && mine && (`asset-${managingAssetId}` === it.id || `stamp-${managingStampId}` === it.id) ? 'cellHeld' : '', `stamp-${justSavedId}` === it.id ? 'cellLanded' : ''].filter(Boolean).join(' ')
    const [primary, primaryV] = it.opts?.[0] ?? []
    const optAttrs = primary ? `data-opt="${primary}"${primaryV ? ` data-v="${primaryV}"` : ''}` : ''
    const badge = mine ? (managing ? '<span class="cellRm">&minus;</span>' : '<span class="cellMine"></span>') : ''
    return `<button class="${classes}" data-shelf="${it.id}" ${optAttrs} title="${esc(it.title)}" aria-label="${esc(it.title)}"${it.disabled?.() ? ' disabled' : ''}>${it.art}${badge}</button>`
  }).join('')
}

function syncCurrentColorDots(hex: string) {
  document.querySelectorAll<HTMLElement>('[data-color-dot], [data-color-dock-dot], [data-color-floating-dot]').forEach(dot => { dot.style.background = hex })
}
function markShelfCat(cat: string) {
  shelfCat = cat
  shelfEl.querySelectorAll<HTMLButtonElement>('[data-shelf-cat]').forEach(tab => {
    const active = tab.dataset.shelfCat === cat
    tab.classList.toggle('active', active)
    tab.setAttribute('aria-selected', String(active))
  })
  toolbarEl.querySelectorAll<HTMLButtonElement>('[data-rail]').forEach(button => {
    const active = button.dataset.rail === cat && room === 'shapes'
    button.classList.toggle('active', active)
    button.setAttribute('aria-pressed', String(active))
  })
  syncCurrentColorDots(currentPickerColor())
}
function focusShelfTab(cat: string) {
  requestAnimationFrame(() => shelfEl.querySelector<HTMLButtonElement>(`[data-shelf-cat="${CSS.escape(cat)}"]`)?.focus())
}
function activateShelfCat(cat: string, focus = false) {
  markShelfCat(cat)
  pendingCatScroll = cat
  const tool = CAT_TOOL[cat]
  if (tool && board.tool !== tool) board.setTool(tool)
  renderPanel()
  if (focus) focusShelfTab(cat)
}
function reducedMotion() { return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches }
function scrollShelfTo(cat: string) {
  const scroll = shelfEl.querySelector<HTMLElement>('[data-shelf-scroll]')
  const sec = shelfEl.querySelector<HTMLElement>(`.shelfSec[data-cat="${CSS.escape(cat)}"]`)
  if (!scroll || !sec || !scroll.clientWidth || !scroll.clientHeight) { pendingCatScroll = cat; return }
  shelfSpyLocked = true
  const behavior = reducedMotion() ? 'auto' : 'smooth'
  scroll.scrollTo(deskMode ? { top: sec.offsetTop, behavior } : { left: sec.offsetLeft, behavior })
  window.setTimeout(() => { shelfSpyLocked = false }, reducedMotion() ? 0 : 700)
  pendingCatScroll = null
}
function renderShelf() {
  const oldScroll = shelfEl.querySelector<HTMLElement>('[data-shelf-scroll]')
  if (oldScroll && !(pickerOpen && !deskMode)) { shelfScrollX = oldScroll.scrollLeft; shelfScrollY = oldScroll.scrollTop }
  if (!shelfHasContent()) { shelfEl.classList.add('hidden'); shelfEl.innerHTML = ''; return }
  shelfEl.classList.remove('hidden')
  shelfEl.classList.toggle('pickerHidden', pickerOpen && !deskMode)
  const cats = shelfCategories()
  const current = cats.find(c => c.cat === shelfCat) ?? cats[0]
  shelfCat = current.cat
  shelfEl.innerHTML = `<div class="shelfScroll" data-shelf-scroll><div class="shelfTrack">${cats.map((c, index) => {
    const title = c.cat === 'players' && teams.activeTeamName() ? teams.activeTeamName()! : c.label
    const rule = index < cats.length - 1 ? '<span class="shelfSecRule" aria-hidden="true"></span>' : ''
    return `<section class="shelfSec" id="shelf-section-${index}" data-cat="${esc(c.cat)}"><div class="shelfHead"><span class="shelfName">${esc(title)}</span></div><div class="shelfGrid" data-cat="${esc(c.cat)}">${shelfCells(c.items)}</div></section>${rule}`
  }).join('')}</div></div>${renderAssetManageBar()}${renderStampManageBar()}${renderSaveHint()}${deskMode ? '' :
    `<div class="shelfRail">` +
    `<div class="shelfRailList" role="tablist" aria-label="Shape categories">${cats.map((c, index) => { const tool = CAT_TOOL[c.cat], active = c.cat === current.cat; return `<button type="button" role="tab" data-shelf-cat="${esc(c.cat)}"${tool ? ` data-tool="${tool}"` : ''} class="${active ? 'active' : ''}" aria-controls="shelf-section-${index}" aria-selected="${active}">${esc(c.label)}</button>` }).join('')}</div><button class="shelfRailRight" data-color-trigger aria-expanded="${pickerOpen}" aria-controls="colorPicker" aria-label="Open color picker"><span data-color-dot></span><svg viewBox="0 0 16 10" aria-hidden="true"><path d="M1 8.5 8 2l7 6.5"/></svg></button></div>`}`
  const scroll = shelfEl.querySelector<HTMLElement>('[data-shelf-scroll]')!
  const restoreX = shelfScrollX, restoreY = shelfScrollY
  scroll.scrollLeft = restoreX
  scroll.scrollTop = restoreY
  requestAnimationFrame(() => {
    if (pendingCatScroll) scrollShelfTo(pendingCatScroll)
    else { scroll.scrollLeft = restoreX; scroll.scrollTop = restoreY }
  })
}

let lastCellTap: { id: string; time: number } | null = null

shelfEl.addEventListener('click', (e) => {
  const target = e.target as HTMLElement
  const cat = target.closest('[data-shelf-cat]') as HTMLElement | null
  if (cat) {
    activateShelfCat(cat.dataset.shelfCat!)
    return
  }
  const cell = target.closest('[data-shelf]') as HTMLElement | null
  if (!cell) return
  const section = cell.closest('.shelfSec') as HTMLElement | null
  if (section?.dataset.cat) markShelfCat(section.dataset.cat)
  const currentItems = shelfCategories().find(c => c.cat === shelfCat)?.items ?? []
  const item = currentItems.find(i => i.id === cell.dataset.shelf)
  if (!item) return
  if (managingAssetId || managingStampId) {
    // In manage mode a tap on one of your own cells removes it; anything else
    // leaves the mode rather than placing something by accident.
    const key = cell.dataset.shelf!
    const assetId = key.startsWith('asset-') && key !== 'asset-add' ? key.slice('asset-'.length) : null
    const stampId = key.startsWith('stamp-') ? key.slice('stamp-'.length) : null
    if (assetId) { removeAsset(assetId); board.rebuild(); renderAssetList() }
    else if (stampId) removeStamp(stampId)
    managingAssetId = null
    managingStampId = null
    renderPanel()
    return
  }
  // A team cell answers its own second tap by cycling that team's kit colour.
  const now = Date.now()
  const doubled = lastCellTap?.id === item.id && now - lastCellTap.time < 320
  lastCellTap = { id: item.id, time: now }
  if (item.tool && board.tool !== item.tool) board.setTool(item.tool)
  if (doubled && item.again) { item.again(); renderPanel(); return }
  item.run?.()
  for (const [key, v] of item.opts ?? []) applyDefaultOption(key, v)
  renderPanel()
})

shelfEl.addEventListener('keydown', (e) => {
  const tab = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-shelf-cat]')
  if (!tab || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return
  const cats = shelfCategories()
  const index = Math.max(0, cats.findIndex(c => c.cat === tab.dataset.shelfCat))
  const nextIndex = e.key === 'Home' ? 0 : e.key === 'End' ? cats.length - 1 : Math.max(0, Math.min(cats.length - 1, index + (e.key === 'ArrowRight' ? 1 : -1)))
  e.preventDefault()
  e.stopPropagation()
  activateShelfCat(cats[nextIndex].cat, true)
})
shelfEl.addEventListener('scroll', (e) => {
  const scroll = e.target as HTMLElement
  if (!scroll.matches('[data-shelf-scroll]')) return
  shelfScrollX = scroll.scrollLeft
  shelfScrollY = scroll.scrollTop
  if (shelfSpyLocked || shelfSpyFrame) return
  shelfSpyFrame = requestAnimationFrame(() => {
    shelfSpyFrame = 0
    if (shelfSpyLocked) return
    const sections = [...shelfEl.querySelectorAll<HTMLElement>('.shelfSec')]
    if (!sections.length) return
    const axisOffset = (section: HTMLElement) => deskMode ? section.offsetTop : section.offsetLeft
    const probe = (deskMode ? scroll.scrollTop + scroll.clientHeight * 0.28 : scroll.scrollLeft + scroll.clientWidth * 0.28)
    const active = probe <= axisOffset(sections[0]) ? sections[0] : probe >= axisOffset(sections[sections.length - 1]) ? sections[sections.length - 1] : sections.reduce((last, section) => axisOffset(section) <= probe ? section : last, sections[0])
    if (active.dataset.cat) markShelfCat(active.dataset.cat)
  })
}, true)
for (const event of ['pointerdown', 'touchstart', 'wheel'] as const) shelfEl.addEventListener(event, () => { shelfSpyLocked = false }, { passive: true })

const PICKER_BLOCKS = [
  [0, 34, [['#8c1111', 'Dark red'], ['#d1442a', 'Vermilion'], ['#d1832a', 'Ochre'], ['#e2bc3c', 'Mustard']]], [1, 49, [['#ef2b23', 'Red'], ['#ef913f', 'Orange'], ['#eddb52', 'Yellow'], ['#f5f193', 'Pale yellow']]],
  [0, 224, [['#0d1170', 'Navy'], ['#d9b3f2', 'Light lilac'], ['#e8a0ef', 'Orchid'], ['#6d2f9c', 'Deep purple'], ['#b12aa5', 'Magenta purple']]], [1, 239, [['#4a6ee0', 'Cornflower'], ['#efaebb', 'Rose'], ['#8f2fb0', 'Purple'], ['#f03bd1', 'Magenta']]],
  [2, 34, [['#d9f2a6', 'Pale lime'], ['#93b756', 'Olive'], ['#2f6b36', 'Forest green'], ['#4f9490', 'Teal'], ['#b3e6f5', 'Sky']]], [3, 49, [['#b5e63d', 'Lime'], ['#47ab5c', 'Green'], ['#93f2c2', 'Mint'], ['#4aa6cf', 'Cerulean'], ['#8d93f2', 'Periwinkle']]],
  [2, 224, [['#000000', 'Black'], ['#ffffff', 'White'], ['#e2d3c2', 'Cream'], ['#c2a184', 'Tan'], ['#9a7558', 'Walnut']]], [3, 239, [['#a8a8a8', 'Grey'], ['#c99f74', 'Sand'], ['#8a5c34', 'Brown'], ['#666666', 'Dark grey']]],
] as const
const pickerSwatchesEl = colorPickerEl.querySelector<HTMLElement>('[data-picker-swatches]')!
for (const [row, x, cells] of PICKER_BLOCKS) for (const [hex, name] of cells) {
  const i = cells.findIndex(cell => cell[0] === hex)
  pickerSwatchesEl.insertAdjacentHTML('beforeend', `<button class="pickerSwatch" type="button" data-picker-swatch="${hex}" aria-label="${name}" aria-pressed="false" style="--c:${hex};left:${x + i * 30}px;top:${[21, 67, 125, 171][row]}px"></button>`)
}
let pickerColor = '#e02020'
let pickerPreview = pickerColor
let pickerTab: 'custom' | 'swatches' = 'custom'
function pickerTarget() {
  if (room === 'text' || board.tool === 'text') return 'd-tcolor'
  if (shelfCat === 'players') return teams.activeTeamName() ? 'd-team-color' : 'd-pcolor'
  return ({ arrows: 'd-color', zones: 'd-fill', equipment: 'd-measure-color', text: 'd-tcolor' } as Record<string, string>)[shelfCat] ?? 'd-pcolor'
}
function currentPickerColor() {
  if (room === 'text' || board.tool === 'text') return defaults.text.color
  if (shelfCat === 'players') return teams.activeTeamName() ? teams.getTeamForSide('home')?.name === teams.activeTeamName() ? teams.getTeamForSide('home')!.color : teams.getTeamForSide('away')?.color ?? defaults.playerColor : defaults.playerColor
  if (shelfCat === 'arrows') return defaults.arrow.color
  if (shelfCat === 'zones') return defaults.box.fill
  if (shelfCat === 'equipment') return defaults.measure.color
  if (shelfCat === 'text') return defaults.text.color
  return defaults.playerColor
}
function hueOf(hex: string) {
  const color = normalizeHex(hex)
  if (!color) return 0
  const [r, g, b] = [1, 3, 5].map(i => Number.parseInt(color.slice(i, i + 2), 16) / 255)
  const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min
  if (!delta) return 0
  const hue = max === r ? ((g - b) / delta) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4
  return (hue * 60 + 360) % 360
}
function hsvOf(hex: string) {
  const color = normalizeHex(hex)
  if (!color) return { saturation: 0, value: 0 }
  const rgb = [1, 3, 5].map(i => Number.parseInt(color.slice(i, i + 2), 16) / 255)
  const value = Math.max(...rgb), min = Math.min(...rgb)
  return { saturation: value ? (value - min) / value : 0, value }
}
function hexAtHue(hue: number) {
  const x = 1 - Math.abs((hue / 60) % 2 - 1)
  const [r, g, b] = hue < 60 ? [1, x, 0] : hue < 120 ? [x, 1, 0] : hue < 180 ? [0, 1, x] : hue < 240 ? [0, x, 1] : hue < 300 ? [x, 0, 1] : [1, 0, x]
  return `#${[r, g, b].map(value => Math.round(value * 255).toString(16).padStart(2, '0')).join('')}`
}
function setPickerVisual(hex: string) {
  const color = normalizeHex(hex) ?? pickerColor
  const hue = hueOf(color), radians = hue * Math.PI / 180
  const { saturation, value } = hsvOf(color)
  const hueFill = colorPickerEl.querySelector<SVGElement>('[data-picker-triangle]')!
  const triangleGroup = colorPickerEl.querySelector<SVGGElement>('[data-picker-triangle-group]')!
  const ring = colorPickerEl.querySelector<HTMLElement>('[data-picker-ring]')!
  const triangleHandle = colorPickerEl.querySelector<HTMLElement>('[data-picker-triangle-handle]')!
  const localX = 16.23 + value * ((1 - saturation) * 83.77 + saturation * 50 - 16.23)
  const localY = 69.5 + value * ((1 - saturation) * 69.5 + saturation * 11 - 69.5)
  const dx = localX - 50, dy = localY - 50
  pickerPreview = color
  hueFill.style.fill = hexAtHue(hue)
  triangleGroup.setAttribute('transform', `rotate(${-hue} 50 50)`)
  ring.style.left = `${50 - 44.8 * Math.sin(radians)}%`
  ring.style.top = `${50 - 44.8 * Math.cos(radians)}%`
  triangleHandle.style.left = `${50 + dx * Math.cos(radians) + dy * Math.sin(radians)}%`
  triangleHandle.style.top = `${50 - dx * Math.sin(radians) + dy * Math.cos(radians)}%`
  triangleHandle.style.transform = `translate(-50%, -50%) rotate(${-hue}deg)`
  syncCurrentColorDots(color)
  colorPickerEl.querySelector<HTMLElement>('[data-picker-hex]')!.textContent = color.toUpperCase()
  colorPickerEl.querySelector<HTMLInputElement>('[data-picker-input]')!.value = color.toUpperCase()
  colorPickerEl.querySelectorAll<HTMLButtonElement>('[data-picker-swatch]').forEach(swatch => swatch.setAttribute('aria-pressed', String(swatch.dataset.pickerSwatch === color)))
}
function commitPickerColor(hex = pickerPreview) {
  const color = normalizeHex(hex)
  if (!color) return
  pickerColor = color
  setPickerVisual(color)
  applyDefaultOption(pickerTarget(), color)
}
function syncPicker() { pickerColor = currentPickerColor(); setPickerVisual(pickerColor) }
function setPickerOpen(open: boolean, restoreFocus = true) {
  if (deskMode && open) return
  pickerOpen = open
  colorPickerEl.classList.toggle('open', open)
  colorDockEl.classList.toggle('open', open)
  panelDockEl.classList.toggle('pickerOpen', open)
  shelfEl.classList.toggle('pickerHidden', open)
  shelfEl.querySelector<HTMLElement>('.shelfRail')?.classList.toggle('pickerHidden', open)
  shelfEl.querySelectorAll<HTMLButtonElement>('[data-color-trigger]').forEach(btn => btn.setAttribute('aria-expanded', String(open)))
  if (open) { pickerFocus = document.activeElement as HTMLElement; pickerTab = 'custom'; selectPickerTab('custom'); syncPicker() }
  else {
    const scroll = shelfEl.querySelector<HTMLElement>('[data-shelf-scroll]')
    if (scroll) { scroll.scrollLeft = shelfScrollX; scroll.scrollTop = shelfScrollY }
    if (restoreFocus) (pickerFocus?.isConnected ? pickerFocus : shelfEl.querySelector<HTMLElement>('[data-color-trigger]'))?.focus()
  }
  syncPanelHeight()
}
function selectPickerTab(tab: 'custom' | 'swatches') {
  pickerTab = tab
  colorPickerEl.querySelectorAll<HTMLButtonElement>('[data-picker-tab]').forEach(btn => btn.setAttribute('aria-selected', String(btn.dataset.pickerTab === tab)))
  colorPickerEl.querySelector<HTMLElement>('[data-picker-custom]')!.hidden = tab !== 'custom'
  pickerSwatchesEl.hidden = tab !== 'swatches'
}
function parsePickerHex(value: string) {
  let raw = value.trim().replace(/^#/, '')
  if (/^[0-9a-f]{3}$/i.test(raw)) raw = raw.split('').map(c => c + c).join('')
  return /^[0-9a-f]{6}$/i.test(raw) ? `#${raw.toLowerCase()}` : null
}
colorPickerEl.addEventListener('click', async e => {
  const target = e.target as HTMLElement
  const tab = target.closest<HTMLButtonElement>('[data-picker-tab]')?.dataset.pickerTab as 'custom' | 'swatches' | undefined
  if (tab) { selectPickerTab(tab); return }
  const swatch = target.closest<HTMLButtonElement>('[data-picker-swatch]')
  if (swatch) { commitPickerColor(swatch.dataset.pickerSwatch!); return }
  if (target.closest('[data-picker-hex]')) { const input = colorPickerEl.querySelector<HTMLInputElement>('[data-picker-input]')!; input.hidden = false; target.closest<HTMLElement>('[data-picker-hex]')!.hidden = true; input.focus(); input.select(); return }
  if (target.closest('[data-picker-eye]') && 'EyeDropper' in window) {
    try {
      const result = await new (window as Window & { EyeDropper: new () => { open: () => Promise<{ sRGBHex: string }> } }).EyeDropper().open()
      commitPickerColor(result.sRGBHex)
    } catch { /* The browser reports cancellation as a rejected promise. */ }
  }
})
colorPickerEl.querySelector<HTMLInputElement>('[data-picker-input]')!.addEventListener('input', e => { const hex = parsePickerHex((e.target as HTMLInputElement).value); if (hex) setPickerVisual(hex) })
function closePickerEditor(commit: boolean) {
  const input = colorPickerEl.querySelector<HTMLInputElement>('[data-picker-input]')!
  const hex = parsePickerHex(input.value)
  if (commit && hex) commitPickerColor(hex)
  else setPickerVisual(pickerColor)
  input.hidden = true
  colorPickerEl.querySelector<HTMLElement>('[data-picker-hex]')!.hidden = pickerTab !== 'custom'
}
colorPickerEl.querySelector<HTMLInputElement>('[data-picker-input]')!.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closePickerEditor(e.key === 'Enter'); colorPickerEl.querySelector<HTMLElement>('[data-picker-hex]')!.focus() } })
colorPickerEl.querySelector<HTMLInputElement>('[data-picker-input]')!.addEventListener('blur', () => closePickerEditor(true))
const hueFromPointer = (e: PointerEvent) => {
  const hit = colorPickerEl.querySelector<HTMLElement>('[data-picker-hue]')!, box = hit.getBoundingClientRect()
  let hue = Math.atan2(-(e.clientX - box.left - box.width / 2), -(e.clientY - box.top - box.height / 2)) * 180 / Math.PI
  if (hue < 0) hue += 360
  return hexAtHue(hue)
}
const hueHit = colorPickerEl.querySelector<HTMLElement>('[data-picker-hue]')!
let huePointer: number | null = null
function endHuePreview(pointerId: number, commit: boolean) {
  if (huePointer !== pointerId) return
  if (hueHit.hasPointerCapture(pointerId)) hueHit.releasePointerCapture(pointerId)
  huePointer = null
  if (commit) commitPickerColor()
  else setPickerVisual(pickerColor)
}
hueHit.addEventListener('pointerdown', e => { huePointer = e.pointerId; hueHit.setPointerCapture(e.pointerId); setPickerVisual(hueFromPointer(e)) })
hueHit.addEventListener('pointermove', e => { if (huePointer === e.pointerId) setPickerVisual(hueFromPointer(e)) })
hueHit.addEventListener('pointerup', e => endHuePreview(e.pointerId, true))
hueHit.addEventListener('pointercancel', e => endHuePreview(e.pointerId, false))
const triHit = colorPickerEl.querySelector<SVGElement>('.pickerTriangle')!
let trianglePointer: number | null = null
function endTrianglePreview(pointerId: number, commit: boolean) {
  if (trianglePointer !== pointerId) return
  if (triHit.hasPointerCapture(pointerId)) triHit.releasePointerCapture(pointerId)
  trianglePointer = null
  if (commit) commitPickerColor()
  else setPickerVisual(pickerColor)
}
triHit.addEventListener('pointerdown', e => { trianglePointer = e.pointerId; triHit.setPointerCapture(e.pointerId) })
triHit.addEventListener('pointerup', e => endTrianglePreview(e.pointerId, true))
triHit.addEventListener('pointercancel', e => endTrianglePreview(e.pointerId, false))
shelfEl.addEventListener('click', e => { if ((e.target as HTMLElement).closest('[data-color-trigger]')) setPickerOpen(!pickerOpen) })
colorDockEl.addEventListener('click', e => { if ((e.target as HTMLElement).closest('[data-color-close]')) setPickerOpen(false) })
document.addEventListener('pointerdown', e => { if (pickerOpen && !panelDockEl.contains(e.target as Node)) setPickerOpen(false) })
document.addEventListener('keydown', e => { if (e.key === 'Escape' && pickerOpen) { e.preventDefault(); e.stopImmediatePropagation(); setPickerOpen(false) } })
if ('EyeDropper' in window) colorPickerEl.querySelector('[data-picker-eye]')?.classList.remove('hidden')

/* ---------- desktop: rail, panel, context bar ----------
 * A phone stacks: board on top, panel under it, rooms along the bottom. A wide
 * window has width to spare and no height, so the same three things stand up
 * beside the board instead - a rail of tools, the panel of that tool's shapes,
 * and one bar over the board for whatever the tool or the selection can change.
 * Nothing floats over the pitch here, and nothing about the phone changes.
 */
const DESK_QUERY = '(min-width: 1024px)'
const DESK_PANEL_KEY = 'tbm-desk-panel-v1'
const deskQuery = window.matchMedia(DESK_QUERY)
let deskMode = false

/** The rail's tools, in the order they sit down the left edge. */
const RAIL_ICONS: Record<string, string> = {
  players: svg('<circle cx="12" cy="12" r="7.4"/>'),
  arrows: svg('<path d="M4 17.4C7.6 8.6 13.2 6 19.4 6"/><path d="M15 4.8L19.6 6l-1.2 4.6"/>'),
  zones: svg('<rect x="4" y="5.6" width="16" height="12.8" rx="1.8" stroke-dasharray="3 2.6"/>'),
  equipment: svg('<path d="M12 4.4l5.6 13.2H6.4z"/><path d="M4.2 19.8h15.6"/>'),
  text: svg('<path d="M6 6.4h12"/><path d="M12 6.4V18"/>'),
}

/** Was the panel left open last time? Folded is the desktop default. */
function deskPanelPref(): boolean {
  try { return localStorage.getItem(DESK_PANEL_KEY) === '1' } catch { return false }
}
function setDeskPanelPref(open: boolean) {
  try { localStorage.setItem(DESK_PANEL_KEY, open ? '1' : '0') } catch { /* private mode */ }
}

/**
 * Move the three pieces that change places between the layouts. Everything
 * else - the shelf, the options strip, the selection buttons - is the same
 * element rendered by the same function, so nothing has two implementations.
 */
function applyLayout() {
  const on = deskQuery.matches
  if (on === deskMode) return
  deskMode = on
  document.body.classList.toggle('deskMode', on)
  if (on) {
    if (pickerOpen) setPickerOpen(false, false)
    ctxDockEl.append(fabColEl, fabBLEl, optionsEl)
    // Styles is a room the rail has no seat for: its controls are the bar.
    if (room === 'styles') room = 'shapes'
    panelOpen = deskPanelPref()
  } else {
    stageWrap.append(fabColEl, fabBLEl)
    panelDockEl.append(optionsEl)
    panelOpen = true
  }
  closeLinkMenu()
  renderPanel()
  board.fit()
}

function renderRail() {
  const cats = shelfCategories()
  const items = cats.map(c => {
    const on = room === 'shapes' && c.cat === shelfCat
    const art = RAIL_ICONS[c.cat] ?? icon('stack')
    const tool = CAT_TOOL[c.cat]
    return `<button class="railBtn${on ? ' active' : ''}${on && !panelOpen ? ' collapsed' : ''}" data-rail="${esc(c.cat)}"` +
      `${tool ? ` data-tool="${tool}"` : ''} title="${esc(c.label)}" aria-label="${esc(c.label)}"` +
      ` aria-pressed="${on}">${art}</button>`
  }).join('')
  const textOn = room === 'text'
  toolbarEl.innerHTML =
    items +
    `<button class="railBtn${textOn ? ' active' : ''}" data-rail="text" data-tool="text" title="Text" aria-label="Text" aria-pressed="${textOn}">${RAIL_ICONS.text}</button>` +
    `<button class="railBtn railFoot" data-bar="settings" title="Settings" aria-label="Settings">${ICONS.wrench}</button>`
}

function renderToolbar() {
  if (deskMode) { renderRail(); return }
  toolbarEl.innerHTML =
    `<button data-bar="settings" title="Settings"><span class="tlabel">Settings</span></button>` +
    ROOMS.map(r => {
      // A put-away drawer leaves no room open, so nothing in the band stays lit.
      const on = room === r.room && panelOpen
      const cls = on ? 'active' : ''
      return `<button data-room="${r.room}" ${r.tool ? `data-tool="${r.tool}"` : ''} title="${r.label}" class="${cls}" aria-expanded="${on && panelOpen}"><span class="tlabel">${r.label}</span></button>`
    }).join('')
}

/** One render for the whole bottom panel: band, shelf, and the options strip. */
function renderPanel() {
  renderToolbar()
  renderShelf()
  syncPicker()
  renderOptions()
  panelFoldEl.classList.toggle('hidden', !deskMode || !shelfHasContent())
  const folded = deskMode && !shelfShowing()
  panelDockEl.classList.toggle('folded', folded)
  panelDockEl.inert = folded
  syncPanelHeight()
}

// Pitch boards and broadcast boards have different player and arrow shelves.
// A scene load does not otherwise rebuild the shelf, so project switches must
// follow the scene's mode rather than leave the previous project's cells up.
let renderedPanelLive = liveArrows()
function syncPanelPitchMode(): boolean {
  const live = liveArrows()
  if (live === renderedPanelLive) return false
  renderedPanelLive = live
  renderPanel()
  return true
}

/**
 * The panel floats over the stage, so nothing it does resizes the board. Its
 * height is published for the controls that sit above it, and handed to the
 * board so the next fit centres the pitch in the space left visible.
 *
 * On a wide window it does not float: the rail, the panel and the bar are all
 * laid out beside the board, so the stage is already the size it can have and
 * there is nothing to inset.
 */
function syncPanelHeight() {
  const h = deskMode ? 0 : Math.round(panelDockEl.getBoundingClientRect().height)
  document.documentElement.style.setProperty('--panelH', `${h}px`)
  board.bottomInset = h
}

// Turning the phone changes how much of the panel the board loses without
// re-rendering it, so the inset has to be re-measured or the next fit centres
// the pitch in a space that no longer exists.
window.addEventListener('resize', syncPanelHeight)
window.addEventListener('orientationchange', () => window.setTimeout(syncPanelHeight, 120))

/**
 * Styles follows the selection. Picking something on the board opens the room
 * that restyles it, and letting it go puts the panel away and gives the room
 * back to whatever was open before. A wide window is left alone: the styling
 * bar is beside the board already, so nothing has to move.
 */
let roomBeforeStyles: Room = 'shapes'

/**
 * The types Styles has controls for. A ball or a cone has nothing to change,
 * so picking one is not worth a room: the panel stays as it was rather than
 * opening on "Nothing to change on this one."
 */
const RESTYLABLE = new Set<SceneObj['type']>(['player', 'arrow', 'box', 'text', 'goal', 'marker'])

function syncRoomToSelection() {
  if (deskMode) return
  if (store.selectedIds.length) {
    const sel = store.selected
    if (!sel || !RESTYLABLE.has(sel.type)) return
    // A new shape opens Styles the way a picked one does - it is the thing you
    // just made, and restyling it is the next move. A new player is the
    // exception: they arrive a squad at a time, so the shelf stays put.
    if (!board.picking && sel.type === 'player') return
    if (room !== 'styles') roomBeforeStyles = room
    room = 'styles'
    panelOpen = true
    // Styles keeps the selection, so the tool goes back by hand: setTool would
    // deselect the very thing that opened the room.
    if (board.tool === 'text') board.tool = 'player'
    renderPanel()
    return
  }
  // Node edit runs on its own selection; it puts the room back when it ends.
  if (room !== 'styles' || board.interactionState === 'node-edit') return
  room = roomBeforeStyles
  panelOpen = false
  renderPanel()
}

/** Fold the desktop panel away, leaving the rail and the bar. */
function setDeskPanel(open: boolean) {
  panelOpen = open
  setDeskPanelPref(open)
  renderPanel()
}
panelFoldEl.addEventListener('click', () => setDeskPanel(false))

toolbarEl.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest('button')
  if (!btn) return
  if (btn.dataset.bar === 'settings') {
    // Settings is a sheet, so its tab toggles too.
    if (settingsEl.classList.contains('hidden')) openSettings()
    else closeSettings()
    return
  }
  const rail = btn.dataset.rail
  if (rail) {
    if (rail === 'text') {
      room = 'text'
      board.setTool('text')
      store.select(null)
      renderPanel()
      return
    }
    const tool = CAT_TOOL[rail]
    // The tool you are already on folds the panel away, and brings it back -
    // unless the board has drifted off that tool since, in which case the
    // press means arm it again.
    if (room === 'shapes' && rail === shelfCat) {
      if (tool && board.tool !== tool) { board.setTool(tool); renderPanel(); return }
      setDeskPanel(!panelOpen)
      return
    }
    // Switching tools leaves the panel as you had it: someone working with it
    // folded picks their variants off the bar and should keep the room.
    room = 'shapes'
    shelfCat = rail
    pendingCatScroll = rail
    if (tool && board.tool !== tool) board.setTool(tool)
    else if (board.tool === 'text') board.setTool('player')
    renderPanel()
    return
  }
  const next = btn.dataset.room as Room | undefined
  if (!next) return
  // Tapping the room you are already in puts the panel away, and brings it back.
  // Putting it away closes the room with it: Text stops writing until it is
  // opened again, so a tap on the board does not still make text.
  if (next === room) {
    panelOpen = !panelOpen
    if (room === 'text') board.setTool(panelOpen ? 'text' : 'player')
    renderPanel()
    return
  }
  room = next
  panelOpen = true
  if (next === 'text') board.setTool('text')
  else if (board.tool === 'text') {
    // Leaving Text disarms it: a tap on the board should not still write.
    // Styles keeps whatever is selected, so it puts the tool back by hand
    // rather than through setTool, which deselects.
    if (next === 'styles') board.tool = 'player'
    else board.setTool('player')
  }
  if (next !== 'styles') store.select(null)
  renderPanel()
})

/* ---------- options strip ---------- */

function esc(s: string) {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
}
function sw(colors: string[], active: string, key: string) {
  return colors.map(c =>
    `<button class="sw ${c === active ? 'active' : ''}" data-opt="${key}" data-v="${c}" style="background:${c}"></button>`
  ).join('')
}
/** The curve through the selected node, drawn rather than named. */
function nodeCurveSeg(active: NodeCurve | null) {
  const items: [NodeCurve, string][] = [
    ['corner', ICONS.nodeCorner],
    ['smooth', ICONS.nodeSmooth],
    ['round', ICONS.nodeRound],
    ['free', ICONS.nodeFree],
  ]
  return `<span class="seg pic" role="group" aria-label="Node curve">` + items.map(([v, icon]) =>
    `<button class="${v === active ? 'active' : ''}" data-opt="node-curve" data-v="${v}" aria-label="${v} node"${active ? '' : ' disabled'}>${icon}</button>`
  ).join('') + `</span>`
}

function nodeEditHint(info: ReturnType<Board['nodeEditInfo']>) {
  const tap = tapVerb().toLowerCase()
  if (!info) return `Double ${tap} to exit edit mode.`
  if (board.addNodeArmed) return `${tapVerb()} the outline to place the node.`
  if (info.index === null) return `${tapVerb()} a node, or double ${tap} the line to add one.`
  return `Node ${info.index + 1} of ${info.count} · drag anywhere to move it.`
}

function seg(items: [string, string][], active: string, key: string) {
  return `<span class="seg">` + items.map(([v, label]) =>
    `<button class="${v === active ? 'active' : ''}" data-opt="${key}" data-v="${v}">${label}</button>`
  ).join('') + `</span>`
}

/**
 * Flip tool: mirrors the geometry of the selection around its center.
 * A lone arrow or zone mirrors in place; a multi-selection mirrors the
 * whole arrangement. Text and captions always stay upright and readable.
 */
/** Mirror one node: its point about the axis, and its handles with it. */
function mirrorNode(n: PathNode, axis: 'x' | 'y', cx: number, cy: number) {
  if (axis === 'x') {
    n.x = 2 * cx - n.x
    if (n.h1) n.h1.x = -n.h1.x
    if (n.h2) n.h2.x = -n.h2.x
  } else {
    n.y = 2 * cy - n.y
    if (n.h1) n.h1.y = -n.h1.y
    if (n.h2) n.h2.y = -n.h2.y
  }
}

function mirrorSelection(axis: 'x' | 'y') {
  const objs = store.selectedIds.map(id => store.obj(id)).filter(Boolean) as SceneObj[]
  if (!objs.length) return
  const textW = (o: TextObj) => o.text.length * o.size * 0.62
  const center = (o: SceneObj) => {
    if (o.type === 'arrow') return { x: (o.x1 + o.x2) / 2, y: (o.y1 + o.y2) / 2 }
    if (o.type === 'text') return { x: o.x + textW(o) / 2, y: o.y + o.size / 2 }
    return { x: o.x, y: o.y }
  }
  const centers = objs.map(center)
  const cx = (Math.min(...centers.map(c => c.x)) + Math.max(...centers.map(c => c.x))) / 2
  const cy = (Math.min(...centers.map(c => c.y)) + Math.max(...centers.map(c => c.y))) / 2

  store.apply(() => {
    for (const o of objs) {
      if (o.type === 'arrow') {
        if (axis === 'x') { o.x1 = 2 * cx - o.x1; o.x2 = 2 * cx - o.x2; o.mx = 2 * cx - o.mx }
        else { o.y1 = 2 * cy - o.y1; o.y2 = 2 * cy - o.y2; o.my = 2 * cy - o.my }
        if (o.points) for (const n of o.points) mirrorNode(n, axis, cx, cy)
      } else if (o.type === 'text') {
        if (axis === 'x') o.x = 2 * cx - o.x - textW(o)
        else o.y = 2 * cy - o.y - o.size
        o.rotation = -(o.rotation ?? 0)
      } else if (o.type === 'box') {
        if (axis === 'x') o.x = 2 * cx - o.x
        else o.y = 2 * cy - o.y
        o.rotation = -(o.rotation ?? 0)
        if (o.corners) for (const c of o.corners) mirrorNode(c, axis, cx, cy)
      } else {
        if (axis === 'x') o.x = 2 * cx - o.x
        else o.y = 2 * cy - o.y
      }
    }
  })
}

/** Flipping a lone symmetric dot or text does nothing visible - hide the tool then. */
function canFlipSelection(): boolean {
  const ids = store.selectedIds
  if (ids.length > 1) return true
  const sel = store.selected
  return sel?.type === 'arrow' || sel?.type === 'box'
}

/** Every piece now carries an angle, so anything selected can be turned. */
function canRotateSelection(): boolean {
  return store.selectedIds.length > 0
}

function rotateSelection(stepDeg = 45) {
  const objs = store.selectedIds.map(id => store.obj(id)).filter(Boolean) as SceneObj[]
  if (!objs.length) return
  const textW = (o: TextObj) => o.text.length * o.size * 0.62
  const center = (o: SceneObj) => {
    if (o.type === 'arrow') return { x: (o.x1 + o.x2) / 2, y: (o.y1 + o.y2) / 2 }
    if (o.type === 'text') return { x: o.x + textW(o) / 2, y: o.y + o.size / 2 }
    return { x: o.x, y: o.y }
  }
  const centers = objs.map(center)
  const cx = (Math.min(...centers.map(c => c.x)) + Math.max(...centers.map(c => c.x))) / 2
  const cy = (Math.min(...centers.map(c => c.y)) + Math.max(...centers.map(c => c.y))) / 2
  const a = stepDeg * Math.PI / 180
  const rot = (x: number, y: number) => ({
    x: cx + (x - cx) * Math.cos(a) - (y - cy) * Math.sin(a),
    y: cy + (x - cx) * Math.sin(a) + (y - cy) * Math.cos(a),
  })

  store.apply(() => {
    for (const o of objs) {
      if (o.type === 'arrow') {
        const p1 = rot(o.x1, o.y1), pm = rot(o.mx, o.my), p2 = rot(o.x2, o.y2)
        o.x1 = p1.x; o.y1 = p1.y; o.mx = pm.x; o.my = pm.y; o.x2 = p2.x; o.y2 = p2.y
      } else if (o.type === 'text') {
        const p = rot(o.x + textW(o) / 2, o.y + o.size / 2)
        o.x = p.x - textW(o) / 2; o.y = p.y - o.size / 2
        o.rotation = ((o.rotation ?? 0) + stepDeg) % 360
      } else if (o.type === 'box') {
        const p = rot(o.x, o.y)
        o.x = p.x; o.y = p.y; o.rotation = ((o.rotation ?? 0) + stepDeg) % 360
        if (o.corners) {
          for (const c of o.corners) {
            const pc = rot(c.x, c.y)
            c.x = pc.x; c.y = pc.y
          }
        }
      } else {
        const p = rot(o.x, o.y)
        o.x = p.x; o.y = p.y
        o.rotation = (((o.rotation ?? 0) + stepDeg) % 360 + 360) % 360
      }
    }
  })
  const turned = objs.find(o => typeof (o as any).rotation === 'number') as { rotation: number } | undefined
  flashRotation(turned ? ((Math.round(turned.rotation) % 360) + 360) % 360 : ((stepDeg % 360) + 360) % 360)
}

function renderTeamMenu() {
  if (pitchById(store.scene.pitch).live) {
    const add = shelfShowing() ? '' : `<button class="addChip" data-opt="d-add-marker">+ Live player</button>`
    return `${add}<button class="addChip" data-opt="d-flip-board">Flip board</button>`
  }
  // one chip per side: tap to make that team active (kit colors, flips and
  // replacement live in the Teams sheet); adding is explicit via + buttons
  let html = ''
  for (const side of ['home', 'away'] as const) {
    const tm = teams.getTeamForSide(side)
    const label = side === 'home' ? 'Home' : 'Away'
    if (tm) {
      html += `<button class="teamChip ${tm.name === teams.activeTeamName() ? 'active' : ''}" data-opt="d-team" data-v="${esc(tm.name)}">
        <span class="chipDot" style="background:${tm.color}"></span><span>${esc(tm.name)}</span>
      </button>`
    } else {
      html += `<button class="teamChip ghost" data-opt="d-team-setup" data-v="${side}">Set ${label.toLowerCase()} team</button>`
    }
  }
  if (!shelfShowing()) {
    html += `<button class="addChip" data-opt="d-add-player">+ Player</button>`
    if (teams.activeTeamName()) html += `<button class="addChip" data-opt="d-add-xi">+ XI</button>`
  }
  if (!shelfShowing()) html += `<button class="addChip" data-opt="d-flip-board">Flip board</button>`
  return html
}

/**
 * A token off one of the side rows: it places into that side, kit and all, and
 * hands the side the board is placing into over with it, so the next tap on
 * the pitch belongs to the same team.
 */
function addPlayerForSide(side: TeamSide, keeper = false) {
  const team = teams.getTeamForSide(side)
  if (team && teams.activeTeamName() !== team.name) teams.activate(team.name)
  const was = defaults.playerColor
  defaults.playerColor = keeper ? keeperColor(side) : sidePlayerColor(side)
  addPlayerFromPlayerMenu('', '', team?.name ?? null)
  defaults.playerColor = was
}

/** Place a player in a colour that is not the active kit (keepers). */
function addPlayerWithColor(color: string) {
  const was = defaults.playerColor
  defaults.playerColor = color
  addPlayerFromPlayerMenu()
  defaults.playerColor = was
}

function addMarkerFromPlayerMenu() {
  const pos = nextPlayerSpot()
  const obj: MarkerObj = { id: uid(), type: 'marker', x: pos.x, y: pos.y, w: 54, name: '', namePos: 'bottom' }
  store.apply(s => { insertByTier(s.objects, obj) })
  store.select(obj.id)
}

function normalizePlayerName(name: string) {
  return name.replace(/\s+#?\d+\s*$/, '').trim()
}

function renderPlayerNameSelect(sel: PlayerObj) {
  const picks = teams.getRosterForPicker(sel.team)
  if (!picks.length) return ''
  // group by team, number as a prefix; the placeholder reads as the action
  const matchedIdx = picks.findIndex(p => normalizePlayerName(p.name) === sel.name)
  const groups = new Map<string, string[]>()
  picks.forEach((p, i) => {
    const label = `${p.number ? `${esc(p.number)}  ` : ''}${esc(normalizePlayerName(p.name))}`
    const list = groups.get(p.team) ?? []
    list.push(`<option value="${i}" ${i === matchedIdx ? 'selected' : ''}>${label}</option>`)
    groups.set(p.team, list)
  })
  const body = [...groups].map(([team, options]) =>
    `<optgroup label="${esc(team)}">${options.join('')}</optgroup>`).join('')
  return `<label class="lbl playerNamePick"><select class="playerNameSelect" data-opt="name-pick">
    <option value="" ${matchedIdx < 0 ? 'selected' : ''}>${matchedIdx < 0 ? 'Add name from roster' : 'Clear name'}</option>
    ${body}
  </select></label>`
}

/** A mouse clicks; a finger taps. The hints in the strip say which. */
const tapVerb = () => (deskMode ? 'Click' : 'Tap')

function renderOptions() {
  // In Shapes the shelf is the whole panel; restyling lives one tab over. A
  // collapsed panel leaves nothing but the band, so the pitch gets the room.
  // On a wide window this strip is the bar over the board and always shows:
  // it sits beside the shelf rather than taking its turn.
  const collapsed = !panelOpen && board.interactionState !== 'node-edit'
  const hide = !deskMode && (shelfShowing() || collapsed)
  optionsEl.classList.toggle('hidden', hide)
  if (hide) { optionsEl.innerHTML = ''; return }
  const sel = store.selected
  let html = ''
  // node-edit mode: the nodes themselves, then the line's own settings
  if (board.interactionState === 'node-edit' && sel) {
    const info = board.nodeEditInfo()
    if (info) {
      html += nodeCurveSeg(info.curve)
      html += `<span class="trayDiv"></span>`
      html += `<button class="nodeBtn${board.addNodeArmed ? ' armed' : ''}" data-opt="node-add" aria-label="Add node" title="Add node"${info.canAdd ? '' : ' disabled'}>${ICONS.plus}</button>`
      html += `<button class="nodeBtn" data-opt="node-remove" aria-label="Remove node" title="Remove node"${info.canRemove ? '' : ' disabled'}>${ICONS.minus}</button>`
    }
    if (sel.type === 'arrow') {
      html += seg([['solid', 'Solid'], ['dashed', 'Dashed'], ['dotted', 'Dotted']], sel.dash, 'dash')
      html += seg([['head', 'Arrow'], ['nohead', 'Line']], sel.head ? 'head' : 'nohead', 'head')
      html += sw(ARROW_COLORS, sel.color, 'color')
    }
    html += `<span class="hint" data-node-edit-hint>${nodeEditHint(info)}</span>`
    optionsEl.innerHTML = html
    return
  }
  if (sel) {
    if (sel.type === 'player') {
      html += renderPlayerNameSelect(sel)
      html += `<label class="lbl">Name <input class="labelIn nameIn" data-opt="name" maxlength="24" value="${esc(sel.name)}" placeholder="Vitinha"></label>`
      html += seg([['first', 'First'], ['last', 'Last'], ['full', 'Full name']], sel.nameDisplay ?? 'last', 'namedisplay')
      html += `<label class="lbl">No. <input class="labelIn" data-opt="label" maxlength="4" value="${esc(sel.label)}"></label>`
      html += seg([['top', 'Top'], ['bottom', 'Bottom']], sel.namePos, 'namepos')
      html += seg([['14', 'S'], ['16', 'M'], ['18', 'L']], String(sel.nameSize ?? 18), 'namesize')
      html += sw(PLAYER_PALETTE, sel.color, 'pcolor')
      html += `<label class="lbl">Hex <input class="labelIn hexIn" data-opt="hex" maxlength="7" value="${esc(sel.color)}"></label>`
    } else if (sel.type === 'arrow') {
      if (sel.measure) {
        html += sw(ARROW_COLORS, sel.color, 'color')
        html += seg(MEASURE_WIDTH_OPTIONS, String(sel.width), 'width')
      } else {
        html += seg([['solid', 'Solid'], ['dashed', 'Dashed'], ['dotted', 'Dotted']], sel.dash, 'dash')
        html += seg([['head', 'Arrow'], ['nohead', 'Line']], sel.head ? 'head' : 'nohead', 'head')
        html += sw(ARROW_COLORS, sel.color, 'color')
        html += seg(sceneArrowWidths(), String(sel.width), 'width')
        if (sel.curved) html += `<button data-opt="straighten">Straighten</button>`
      }
    } else if (sel.type === 'box') {
      html += seg([['rect', 'Box'], ['ellipse', 'Oval'], ['triangle', 'Triangle'], ['outline', 'Outline']], sel.shape, 'shape')
      if (sel.shape === 'outline') {
        html += `<label class="lbl">Text <input class="labelIn nameIn" data-opt="box-label" maxlength="24" value="${esc(sel.label || '')}" placeholder="Label"></label>`
        html += seg([['top', 'Top'], ['right', 'Right'], ['bottom', 'Bottom'], ['left', 'Left']], sel.labelPos || 'top', 'box-label-pos')
      }
      html += sw(BOX_FILLS, sel.fill, 'fill')
      if (sel.shape !== 'outline') html += seg([['0.25', '25%'], ['0.45', '45%'], ['0.65', '65%']], String(sel.opacity), 'opacity')
    } else if (sel.type === 'text') {
      html += seg([['bold', 'Bold'], ['light', 'Light']], sel.bold ? 'bold' : 'light', 'bold')
      html += sw(TEXT_COLORS, sel.color, 'tcolor')
      html += `<button data-opt="editText">Edit text</button>`
    } else if (sel.type === 'goal') {
      html += seg([['small', 'Small'], ['normal', 'Normal']], sel.variant, 'goal-variant')
    } else if (sel.type === 'marker') {
      html += `<label class="lbl">Name <input class="labelIn nameIn" data-opt="mname" maxlength="24" value="${esc(sel.name)}" placeholder="Mbeumo"></label>`
      html += seg([['top', 'Top'], ['bottom', 'Bottom']], sel.namePos, 'namepos')
    }
  } else {
    const t = board.tool
    const styling = room === 'styles'
    if (t === 'player') {
      if (!styling) html += renderTeamMenu()
      const activeTeam = pitchById(store.scene.pitch).live ? null : (teams.activeTeamName() ? teams.getTeam(teams.activeTeamName()!) : null)
      if (activeTeam) {
        const colors = Array.from(new Set([...activeTeam.colours, ...PLAYER_PALETTE]))
        html += sw(colors, activeTeam.color, 'd-team-color')
        html += `<label class="lbl">Hex <input class="labelIn hexIn" data-opt="d-team-hex" maxlength="7" value="${esc(activeTeam.color)}"></label>`
      } else {
        html += sw(PLAYER_PALETTE, defaults.playerColor, 'd-pcolor')
        html += `<label class="lbl">Hex <input class="labelIn hexIn" data-opt="d-hex" maxlength="7" value="${esc(defaults.playerColor)}"></label>`
      }
    }
    else if (t === 'arrow') {
      // dash and head live on the shapes shelf when it is open
      if (!shelfShowing()) {
        html += seg([['solid', 'Solid'], ['dashed', 'Dashed'], ['dotted', 'Dotted']], defaults.arrow.dash, 'd-dash')
        html += seg([['head', 'Arrow'], ['nohead', 'Line']], defaults.arrow.head ? 'head' : 'nohead', 'd-head')
      }
      html += sw(ARROW_COLORS, defaults.arrow.color, 'd-color')
      html += seg(sceneArrowWidths(), String(defaults.arrow.width), 'd-width')
    } else if (t === 'box') {
      if (!shelfShowing()) html += seg([['rect', 'Box'], ['ellipse', 'Oval'], ['triangle', 'Triangle'], ['outline', 'Outline']], defaults.box.shape, 'd-shape')
      html += sw(BOX_FILLS, defaults.box.fill, 'd-fill')
      if (defaults.box.shape !== 'outline') html += seg([['0.25', '25%'], ['0.45', '45%'], ['0.65', '65%']], String(defaults.box.opacity), 'd-opacity')
    } else if (t === 'text') {
      html += seg([['bold', 'Bold'], ['light', 'Light']], defaults.text.bold ? 'bold' : 'light', 'd-bold')
      html += sw(TEXT_COLORS, defaults.text.color, 'd-tcolor')
      html += seg([['16', 'S'], ['22', 'M'], ['30', 'L']], String(defaults.text.size), 'd-size')
      if (!styling) html += `<span class="hint">${tapVerb()} the board to write.</span>`
    } else if (t === 'ball') {
      const place = defaults.place === 'marker' ? 'ball' : defaults.place
      const placeOptions: [string, string][] = [['ball', 'Ball'], ['cone', 'Cone'], ['goal', 'Goal'], ['measure', 'Measure']]
      if (!shelfShowing()) {
        html += seg(placeOptions, place, 'd-place')
        if (place === 'goal') html += seg([['small', 'Small'], ['normal', 'Normal']], defaults.goal.variant, 'd-goal-variant')
      }
      if (place === 'measure') {
        html += sw(ARROW_COLORS, defaults.measure.color, 'd-measure-color')
        html += seg(MEASURE_WIDTH_OPTIONS, String(defaults.measure.width), 'd-measure-width')
        if (!styling) html += `<span class="hint">Drag anywhere to measure with a straight line.</span>`
      } else if (!styling) {
        const what = place === 'cone' ? 'a cone'
          : place === 'goal' ? (defaults.goal.variant === 'normal' ? 'a full-size goal' : 'a small goal')
          : 'the ball'
        html += `<span class="hint">${tapVerb()} the board to place ${what}.</span>`
      }
    }
  }
  // Styles has nothing to offer until something is picked; say so rather than
  // leaving an empty strip under an active tab.
  if (!html && (room === 'styles' || deskMode)) {
    html = store.selected
      ? `<span class="hint">Nothing to change on this one.</span>`
      : `<span class="hint">Pick something on the board, or set how the next shape looks.</span>`
  }
  optionsEl.innerHTML = html
}

let lastTeamChipTap: { name: string; time: number } | null = null
optionsEl.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest('[data-opt]') as HTMLElement | null
  if (!btn || btn.tagName === 'INPUT' || btn.tagName === 'SELECT') return
  const key = btn.dataset.opt!
  const v = btn.dataset.v
  const sel = store.selected

  // tool defaults
  if (key.startsWith('d-')) {
    applyDefaultOption(key, v)
    return
  }

  if (!sel) return
  if (key === 'node-curve' && v) { board.setSelectedNodeCurve(v as NodeCurve); board.addNodeArmed = false; renderOptions(); return }
  if (key === 'node-add') { board.addNodeArmed = !board.addNodeArmed; renderOptions(); return }
  if (key === 'node-remove') { board.removeSelectedNode(); renderOptions(); return }
  if (key === 'editText' && sel.type === 'text') { openTextEditor(sel.id, { x: sel.x, y: sel.y }); return }
  if (key === 'straighten' && sel.type === 'arrow') {
    store.apply(() => { sel.curved = false; sel.mx = (sel.x1 + sel.x2) / 2; sel.my = (sel.y1 + sel.y2) / 2 })
    return
  }

  store.apply(() => {
    const o: any = sel
    if (key === 'pcolor') o.color = v
    else if (key === 'namepos') o.namePos = v
    else if (key === 'namesize') o.nameSize = Number(v)
    else if (key === 'namedisplay') o.nameDisplay = v
    else if (key === 'dash') o.dash = v
    else if (key === 'head') o.head = v === 'head'
    else if (key === 'color') o.color = v
    else if (key === 'width') o.width = Number(v)
    else if (key === 'shape') {
      // Picking a shape is picking a starting set of nodes: the zone is measured
      // back to the w/h box it stands for and the new shape drawn into it, so
      // choosing Oval after moving nodes about gives a clean oval rather than
      // the old outline renamed. A box and an outline are the same shape either
      // filled or stroked, so switching between those two keeps the nodes.
      const sameFamily = boxHasCorners(o.shape) && boxHasCorners(v as BoxObj['shape'])
      if (o.corners && !sameFamily) {
        Object.assign(o, rectFromCorners(o.corners, o.rotation))
        o.corners = nodesForShape(v as BoxObj['shape'], o.x, o.y, o.w, o.h, o.rotation)
      } else if (!o.corners && boxHasCorners(v as BoxObj['shape'])) {
        o.corners = cornersFromRect(o.x, o.y, o.w, o.h, o.rotation)
      }
      o.shape = v
    }
    else if (key === 'box-label-pos') o.labelPos = v
    else if (key === 'fill') o.fill = v
    else if (key === 'opacity') o.opacity = Number(v)
    else if (key === 'bold') o.bold = v === 'bold'
    else if (key === 'tcolor') o.color = v
    else if (key === 'goal-variant') o.variant = v
  })
})
optionsEl.addEventListener('change', (e) => {
  const target = e.target as HTMLInputElement | HTMLSelectElement
  const key = target.dataset.opt
  if (key === 'd-team-hex') {
    const hex = normalizeHex((target as HTMLInputElement).value)
    const name = teams.activeTeamName()
    if (hex && name) teams.setTeamColor(name, hex)
    else renderOptions()
    return
  }
  if (key === 'd-hex') {
    const hex = normalizeHex((target as HTMLInputElement).value)
    if (hex) defaults.playerColor = hex
    renderOptions()
    return
  }
  const sel = store.selected
  if (!sel) return
  if (key === 'name-pick' && sel.type === 'player') {
    const select = target as HTMLSelectElement
    const raw = select.value
    if (raw === '') {
      store.apply(() => { (sel as PlayerObj).name = '' })
      return
    }
    const idx = Number(raw)
    if (!Number.isInteger(idx)) return
    const pick = teams.getRosterForPicker(sel.team)[idx]
    if (!pick) return
    store.apply(() => {
      const o = sel as PlayerObj
      o.name = normalizePlayerName(pick.name)
    })
    return
  }
  if (key === 'mname' && sel.type === 'marker') {
    store.apply(() => { (sel as MarkerObj).name = (target as HTMLInputElement).value.trim() })
    return
  }
  if (key === 'box-label' && sel.type === 'box') {
    store.apply(() => { (sel as BoxObj).label = (target as HTMLInputElement).value.trim() })
    return
  }
  if (key !== 'label' && key !== 'name' && key !== 'hex') return
  if (sel?.type !== 'player') return
  const input = target as HTMLInputElement
  if (key === 'hex') {
    const hex = normalizeHex(input.value)
    if (hex) store.apply(() => { (sel as PlayerObj).color = hex })
    else renderOptions()
    return
  }
  store.apply(() => {
    const o = sel as PlayerObj
    if (key === 'label') o.label = input.value.trim()
    else o.name = input.value.trim()
  })
})

/* ---------- selection actions (floating buttons) ---------- */

function deleteSelected() {
  const ids = store.selectedIds
  if (!ids.length) return
  const set = new Set(ids)
  store.apply(s => { s.objects = s.objects.filter(o => !set.has(o.id)) })
  store.selectMany([])
}
function duplicateSelected() {
  const originals = store.selectedIds.map(id => store.obj(id)).filter(Boolean)
  if (!originals.length) return
  // a copy of a group is its own group, so the two do not move as one
  const regroup = new Map<string, string>()
  const copies = originals.map((orig: any) => {
    const copy: any = JSON.parse(JSON.stringify(orig))
    copy.id = uid()
    if (copy.group) {
      if (!regroup.has(copy.group)) regroup.set(copy.group, uid('g'))
      copy.group = regroup.get(copy.group)
    }
    moveObject(copy, 16, 16)
    return copy
  })
  store.apply(s => {
    // insert each copy immediately after its original so it sits just above
    for (let i = 0; i < originals.length; i++) {
      const idx = s.objects.indexOf(originals[i] as SceneObj)
      if (idx >= 0) s.objects.splice(idx + 1, 0, copies[i])
      else s.objects.push(copies[i])
    }
  })
  store.selectMany(copies.map(c => c.id))
}
function bringForward() {
  const ids = store.selectedIds
  if (!ids.length) return
  const set = new Set(ids)
  store.apply(s => {
    const indices = s.objects.map((o, i) => set.has(o.id) ? i : -1).filter(i => i >= 0)
    const top = Math.max(...indices)
    if (top >= s.objects.length - 1) return
    // swap block with the next non-selected neighbor above
    const neighbor = s.objects[top + 1]
    s.objects.splice(top + 1, 1)
    s.objects.splice(Math.min(...indices), 0, neighbor)
  })
}
function sendBack() {
  const ids = store.selectedIds
  if (!ids.length) return
  const set = new Set(ids)
  store.apply(s => {
    const indices = s.objects.map((o, i) => set.has(o.id) ? i : -1).filter(i => i >= 0)
    const bottom = Math.min(...indices)
    if (bottom <= 0) return
    // swap block with the next non-selected neighbor below
    const neighbor = s.objects[bottom - 1]
    s.objects.splice(bottom - 1, 1)
    s.objects.splice(Math.max(...indices), 0, neighbor)
  })
}
/** Shift one object across the board. Arrows and free-form boxes carry points. */
function moveObject(obj: SceneObj, dx: number, dy: number) {
  const o: any = obj
  if (o.type === 'arrow') {
    o.x1 += dx; o.y1 += dy; o.mx += dx; o.my += dy; o.x2 += dx; o.y2 += dy
    if (o.points) for (const p of o.points) { p.x += dx; p.y += dy }
  } else {
    o.x += dx; o.y += dy
    if (o.type === 'box' && o.corners) {
      for (const c of o.corners) { c.x += dx; c.y += dy }
    }
  }
}

function nudgeSelected(dx: number, dy: number) {
  const ids = store.selectedIds
  if (!ids.length) return
  store.apply(() => {
    for (const sel of ids.map(id => store.obj(id)).filter(Boolean)) moveObject(sel as SceneObj, dx, dy)
  })
}

/* ---------- groups and saved combinations ----------
   Two things you can do with several objects at once. Group ties them
   together on this board, so a tap on one takes all of them. Save lifts the
   arrangement off the board entirely and puts it on the shapes shelf, where
   it can be stamped down again on any board. */

function selectedObjects(): SceneObj[] {
  return store.selectedIds.map(id => store.obj(id)).filter(Boolean) as SceneObj[]
}

/** The group id when the selection is exactly one whole group, else null. */
function selectionGroup(): string | null {
  const objs = selectedObjects()
  if (objs.length < 2) return null
  const g = objs[0].group
  return g && objs.every(o => o.group === g) ? g : null
}

function groupSelection() {
  const ids = new Set(store.selectedIds)
  if (ids.size < 2) return
  const g = uid('g')
  store.apply(s => { for (const o of s.objects) if (ids.has(o.id)) o.group = g })
}

function ungroupSelection() {
  const ids = new Set(store.selectedIds)
  if (!ids.size) return
  store.apply(s => { for (const o of s.objects) if (ids.has(o.id)) delete o.group })
}

/** Board-space box around everything selected. */
function selectionBounds() {
  const objs = selectedObjects()
  if (!objs.length) return null
  const rects = objs.map(o => board.rectFor(o))
  const x = Math.min(...rects.map(r => r.x))
  const y = Math.min(...rects.map(r => r.y))
  const w = Math.max(...rects.map(r => r.x + r.width)) - x
  const h = Math.max(...rects.map(r => r.y + r.height)) - y
  return { x, y, w: Math.max(1, w), h: Math.max(1, h) }
}

/* ---------- the link button and its little menu ----------
   Both of the board's anchored menus (this one and a background tile's) use
   the transitions.dev dropdown: they grow out of the button they belong to,
   and animate out again on the shorter close clock. */

/** The close duration, read from the stylesheet so the two stay in step.
    The build minifies `150ms` to `.15s`, so both units have to be read. */
function dropdownCloseMs() {
  const value = getComputedStyle(document.documentElement).getPropertyValue('--dropdown-close-dur').trim()
  const amount = parseFloat(value)
  if (!Number.isFinite(amount)) return 150
  return value.endsWith('ms') ? amount : amount * 1000
}


const linkMenuEl = document.querySelector<HTMLElement>('#linkMenu')!
let linkMenuCloseTimer = 0

function linkMenuOpen() { return linkMenuEl.classList.contains('is-open') }

function closeLinkMenu() {
  if (!linkMenuOpen()) return
  linkMenuEl.classList.remove('is-open')
  linkMenuEl.classList.add('is-closing')
  // The closing state has to come off again, or the next open starts from the
  // scale it closed at instead of its resting one.
  window.clearTimeout(linkMenuCloseTimer)
  linkMenuCloseTimer = window.setTimeout(() => linkMenuEl.classList.remove('is-closing'), dropdownCloseMs())
  fabBLEl.querySelector('[data-act="link-menu"]')!.setAttribute('aria-expanded', 'false')
}

function toggleLinkMenu() {
  if (linkMenuOpen()) { closeLinkMenu(); return }
  const grouped = !!selectionGroup()
  const first = linkMenuEl.querySelector<HTMLElement>('[data-act="group"]')!
  first.innerHTML = `<span class="linkIc">${icon(grouped ? 'unlink' : 'link')}</span><span>${grouped ? 'Ungroup' : 'Group'}</span>`
  window.clearTimeout(linkMenuCloseTimer)
  linkMenuEl.classList.remove('is-closing')
  linkMenuEl.classList.add('is-open')
  fabBLEl.querySelector('[data-act="link-menu"]')!.setAttribute('aria-expanded', 'true')
}

document.addEventListener('pointerdown', (e) => {
  if (!linkMenuOpen()) return
  if (!(e.target as HTMLElement).closest('#fabBL')) closeLinkMenu()
}, true)

/* ---------- saving a combination ----------
   No sheet. Save drops the arrangement into the row you are standing in and
   flashes the new cell, because the cell appearing is the confirmation. A
   name is not asked for: you know a combination by its picture, the same way
   you know every other cell on the shelf. Press and hold one to rename it,
   move it to another row, or start a row of your own. */

/** The cell that has just landed, lit for a beat so you can see where it went. */
let justSavedId: string | null = null
let justSavedTimer: number | undefined

const SAVE_HINT_KEY = 'tbm-stamp-hint-v1'
let saveHintShown = (() => {
  try { return localStorage.getItem(SAVE_HINT_KEY) === '1' } catch { return true }
})()

/** Numbered rather than blank, so Settings and the tooltip have something to say. */
function nextStampName(): string {
  const used = new Set(listStamps().map(s => s.name))
  for (let i = 1; ; i++) {
    const name = `Combination ${i}`
    if (!used.has(name)) return name
  }
}

function saveSelectionToShelf() {
  const objs = selectedObjects()
  const box = selectionBounds()
  if (objs.length < 2 || !box) return
  if (objs.length > MAX_STAMP_OBJECTS) {
    showAssetNote(`A saved combination holds up to ${MAX_STAMP_OBJECTS} shapes.`)
    return
  }
  // objects are stored with the arrangement's own corner at 0,0, so a stamp
  // lands the same way wherever it is dropped
  const objects = objs.map(o => {
    const copy = JSON.parse(JSON.stringify(o)) as SceneObj
    delete copy.group
    moveObject(copy, -box.x, -box.y)
    return copy
  })
  const cat = shelfCat || 'players'
  let saved: Stamp
  try {
    saved = addStamp({ name: nextStampName(), cat, objects, w: box.w, h: box.h })
  } catch (err) {
    showAssetNote(err instanceof StampQuotaError
      ? 'There is no room for another saved combination. Remove one from the shelf first.'
      : (err as Error).message || 'That could not be saved.')
    return
  }
  justSavedId = saved.id
  window.clearTimeout(justSavedTimer)
  justSavedTimer = window.setTimeout(() => { justSavedId = null; markSaveHintSeen(); renderPanel() }, 1600)
  room = 'shapes'
  panelOpen = true
  renderPanel()
}

/** Said once, the first time something is saved, then never again. */
function renderSaveHint(): string {
  if (saveHintShown || !justSavedId) return ''
  return '<p class="shelfHint">Saved. Hold it to rename it or move it to another row.</p>'
}

function markSaveHintSeen() {
  if (saveHintShown) return
  saveHintShown = true
  try { localStorage.setItem(SAVE_HINT_KEY, '1') } catch { /* private mode */ }
}

/* ---------- stamps on the shelf ---------- */

const CAT_LABELS: Record<string, string> = { players: 'Players', arrows: 'Arrows', zones: 'Zones', equipment: 'Equipment' }
function catLabel(cat: string) { return CAT_LABELS[cat] ?? cat }

/** A stamp draws itself from its own objects, the way the board would. */
function stampArt(st: Stamp) {
  const pad = Math.max(st.w, st.h) * 0.08
  const shapes = sceneShapesSvg({ version: 4, objects: st.objects } as any)
  return `<svg class="cellStamp" viewBox="${-pad} ${-pad} ${st.w + pad * 2} ${st.h + pad * 2}" preserveAspectRatio="xMidYMid meet">${shapes}</svg>`
}

/** Stamp the combination down in the middle of the board, selected and grouped. */
function placeStamp(st: Stamp) {
  const g = uid('g')
  const dx = BOARD_W / 2 - st.w / 2
  const dy = boardH() / 2 - st.h / 2
  const copies = st.objects.map(o => {
    const copy = JSON.parse(JSON.stringify(o)) as SceneObj
    copy.id = uid()
    copy.group = g
    moveObject(copy, dx, dy)
    return copy
  })
  store.apply(s => { for (const c of copies) insertByTier(s.objects, c) })
  store.selectMany(copies.map(c => c.id))
}

function stampItems(cat: string): ShelfItem[] {
  return listStamps(cat).map(st => ({
    id: `stamp-${st.id}`,
    title: st.name,
    art: stampArt(st),
    run: () => placeStamp(st),
  }))
}

const NUDGE = 3
document.querySelector('.stageWrap')!.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest('[data-act]') as HTMLElement | null
  if (!btn) return
  const k = btn.dataset.act
  if (k === 'del') deleteSelected()
  else if (k === 'dup') duplicateSelected()
  else if (k === 'front') bringForward()
  else if (k === 'back') sendBack()
  else if (k === 'flip-h') mirrorSelection('x')
  else if (k === 'rotate') rotateSelection(45)
  else if (k === 'link-menu') { toggleLinkMenu(); return }
  else if (k === 'group') {
    closeLinkMenu()
    if (selectionGroup()) ungroupSelection()
    else groupSelection()
  }
  else if (k === 'save-stamp') { closeLinkMenu(); saveSelectionToShelf(); return }
  else if (k === 'back-node-edit') {
    board.exitNodeEdit()
  }
})

function renderFabs() {
  const nodeEdit = board.interactionState === 'node-edit'
  const show = !!store.selected && !nodeEdit
  document.querySelector('#fabCol')!.classList.toggle('hidden', !show)
  // the link button only means something with more than one thing selected
  const linkable = show && store.selectedIds.length > 1
  document.querySelector('#fabBL')!.classList.toggle('hidden', !linkable)
  if (!linkable) closeLinkMenu()
  document.querySelector('#backBtn')!.classList.toggle('hidden', !nodeEdit)
  const canFlip = canFlipSelection()
  document.querySelector('#flipHBtn')!.classList.toggle('hidden', !canFlip)
  document.querySelector('#rotateBtn')!.classList.toggle('hidden', !canRotateSelection())
}

/* ---------- inline text editor ---------- */

let textEditor: HTMLInputElement | null = null
function closeTextEditor(commit: boolean) {
  if (!textEditor) return
  const ed = textEditor
  textEditor = null
  const id = ed.dataset.id || null
  const x = Number(ed.dataset.x), y = Number(ed.dataset.y)
  const value = ed.value.trim()
  ed.remove()
  if (!commit) return
  if (id) {
    store.apply(s => {
      const o = s.objects.find(ob => ob.id === id) as TextObj | undefined
      if (!o) return
      if (value) o.text = value
      else s.objects = s.objects.filter(ob => ob.id !== id)
    })
  } else if (value) {
    const d = defaults.text
    const obj: TextObj = { id: uid(), type: 'text', x, y, text: value, size: d.size, bold: d.bold, color: d.color, rotation: 0, flipX: false, flipY: false }
    store.apply(s => insertByTier(s.objects, obj))
    store.select(obj.id)
  }
}

function openTextEditor(id: string | null, boardPos: { x: number; y: number }) {
  closeTextEditor(true)
  const existing = id ? (store.obj(id) as TextObj | undefined) : undefined
  const scale = board.screenScale()
  const screen = board.boardToScreen(boardPos)
  const ed = document.createElement('input')
  ed.className = 'textEdit'
  ed.value = existing?.text ?? ''
  ed.dataset.id = id ?? ''
  ed.dataset.x = String(boardPos.x)
  ed.dataset.y = String(boardPos.y)
  const size = (existing?.size ?? defaults.text.size) * scale
  ed.style.left = `${screen.x}px`
  ed.style.top = `${screen.y - 4}px`
  ed.style.fontSize = `${size}px`
  ed.style.fontWeight = (existing?.bold ?? defaults.text.bold) ? '700' : '400'
  ed.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') closeTextEditor(true)
    else if (e.key === 'Escape') closeTextEditor(false)
    e.stopPropagation()
  })
  ed.addEventListener('blur', () => closeTextEditor(true))
  stageWrap.appendChild(ed)
  textEditor = ed
  ed.focus()
}
board.onRequestTextEdit = openTextEditor
board.onInteractionStateChange = () => {
  if (board.interactionState === 'node-edit') { room = 'styles'; panelOpen = true }
  renderFabs()
  renderPanel()
}
teams.onAddLineup = addTeamFromPlayerMenu
saves.onNewBoard = newBoard
// one ball/cone is enough: placing it hands the toolbar back to Player
board.onBallPlaced = () => {
  board.setTool('player')
  renderPanel()
}
// arrows and zones are one-shot too, but the new shape stays selected
// (setTool would deselect it), ready to drag or restyle
board.onShapeDrawn = () => {
  board.tool = 'player'
  renderPanel()
}

/* ---------- topbar actions ---------- */

function download(name: string, href: string) {
  const a = document.createElement('a')
  a.download = name
  a.href = href
  a.click()
}

// data URL -> Blob without awaiting: Safari drops the user gesture across an
// await, and navigator.share() then throws NotAllowedError instead of opening
// the share sheet
function dataUrlToBlob(url: string): Blob {
  const [head, data] = url.split(',')
  const type = head.match(/:(.*?);/)?.[1] || 'image/png'
  const bin = atob(data)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new Blob([bytes], { type })
}

function exportPng() {
  const url = board.exportPng()
  void recordProductEvent('board_exported', 'png')
  const filename = store.scene.pitch === 'classic'
    ? 'Pitch - Board Tactics Journal.png'
    : 'tactics-board.png'
  // share sheet on devices that support it (iOS/Android); only fall back
  // to a download when sharing is unavailable or refused - never after a cancel
  if (navigator.share && (navigator as any).canShare) {
    try {
      const file = new File([dataUrlToBlob(url)], filename, { type: 'image/png' })
      if ((navigator as any).canShare({ files: [file] })) {
        navigator.share({ files: [file] }).catch((err: unknown) => {
          const name = err instanceof Error ? err.name : ''
          if (name !== 'AbortError') download(filename, url)
        })
        return
      }
    } catch { /* could not build the file - fall through to download */ }
  }
  download(filename, url)
}

/* ---------- the 3D view host ----------
   Board keeps the camera, renderer and editing code. The official extension
   gets only these view calls, and owns the preference and toolbar control. */
const boardResetBtn = document.querySelector<HTMLButtonElement>('#boardReset')!
const boardHintEl = document.querySelector<HTMLParagraphElement>('#boardHint')!
const coarsePointer = window.matchMedia('(pointer: coarse)').matches
boardHintEl.textContent = coarsePointer ? 'Drag to orbit · pinch to zoom' : 'Drag to orbit · scroll to zoom'
board.onCameraGesture = () => { boardHintEl.classList.add('used') }
boardResetBtn.addEventListener('click', () => {
  board.reset3DCamera()
  boardHintEl.classList.add('used')
})

const officialExtensions = new OfficialExtensions({
  host: {
    set3D: on => board.set3D(on),
    is3D: () => board.is3D(),
    reset3DCamera: () => board.reset3DCamera(),
  },
  toolbar: document.querySelector<HTMLElement>('[data-ext-toolbar]')!,
})
officialExtensions.start()

document.querySelector('.actionRow')!.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest('button')
  if (!btn) return
  const k = btn.dataset.top
  if (k === 'undo') store.undo()
  else if (k === 'redo') store.redo()
  else if (k === 'snap') {
    board.setSnapEnabled(!board.snapEnabled)
    document.querySelector('#snapBtn')!.classList.toggle('active', board.snapEnabled)
  }
  else if (k === 'export') toggleShareMenu()
  else if (k === 'fit') board.resetView()
  else if (k === 'boards') boardsView.toggleBoards()
  else if (k === 'note') editBoardNote()
  else if (k === 'match') openMatchSheet()
  else if (k === 'live-shot') void openLiveShotPicker()
})

/* ---------- projects and boards ----------
   Projects is the library, Boards is one project's contents, and this screen
   is the board. The editor always holds one board of the current project, and
   everything it does is written straight back into it. */

const loadedProjectLibrary = loadLibrary()
let library: Library = loadedProjectLibrary ?? { version: 2, currentId: '', projects: [] }
if (!library.projects.length) {
  const first = newProject(store.scene)
  library = { version: 2, currentId: first.id, projects: [first] }
}
// A clean browser needs a temporary canvas, not a durable account record. If
// account Projects arrive before it is edited, they replace this placeholder.
let freshStarter = loadedProjectLibrary ? null : { id: library.currentId, updated: currentProject(library).updated }
/** Board the editor is holding. */
let editingBoard = Math.max(0, storedBoardIndex(library, currentProject(library)))
/** True while a scene is being swapped in, so the write-back stays quiet. */
let swappingScene = false
let projectAutosaveTimer = 0

function scheduleProjectAutosave() {
  window.clearTimeout(projectAutosaveTimer)
  projectAutosaveTimer = window.setTimeout(() => { saves.autosaveCurrent(true) }, 900)
}

function saveProjectChanges(project: Project = currentProject(library)) {
  documentChangeGeneration += 1
  saveLibrary(library)
  boardsView.refresh()
  // The editor autosaves the open Project through its document adapter. A
  // rename in the Projects screen can affect another Project, so write that
  // one directly instead of accidentally saving the open one.
  if (project.id === library.currentId) scheduleProjectAutosave()
  else saves.persistProjectDocuments([project])
}

const boardsView = new BoardsView(document.querySelector<HTMLElement>('#libRoot')!, {
  changed: saveProjectChanges,
  deleteProject: (id) => { saves.removeDocument(id) },
  blankScene: () => emptyScene(store.scene.pitch),
  blankSceneOn: (pitchId) => blankSceneOnPitch(pitchId),
  addBoardChoices: (changed) => newBoardChoices(changed),
  uploadBackground: () => pickBackgroundForNewBoard(),
  currentIndex: () => editingBoard,
  paid: () => entitlements.hasPaidBoardAccess(),
  openPro: () => openSettings('pro'),
  // A shared Project's backgrounds come off the server through its own scope;
  // every other Project's come out of this device's shelf.
  resolveBackground: (id, projectId) => (
    sharedBackgroundScope && projectId === sharedBackgroundProjectId
      ? sharedBackgroundScope(id)
      : backgrounds.image(id)
  ),
  openBoard: (index) => {
    const project = currentProject(library)
    const board = project.boards[index]
    if (!board) return
    stashEditedBoard()
    editingBoard = index
    rememberBoard(library, project.id, board.id)
    saveLibrary(library)
    loadBoardIntoEditor(board.scene)
  },
  openProject: openLibraryProject,
})
boardsView.setLibrary(library)

/**
 * A board started on a chosen pitch or saved background. The style is resolved
 * first, so an id nothing on this device answers to falls back to our pitch
 * rather than making a board with no art, and the scene takes that style's
 * board height. An empty scene shows no team overlay, which is what a
 * broadcast frame wants too.
 */
function blankSceneOnPitch(pitchId: string): Scene {
  return emptyScene(pitchById(pitchId).id)
}

/** What the Add board chooser offers, with the same gates the pitch shelf uses. */
function newBoardChoices(thumbLoaded: () => void) {
  for (const meta of backgrounds.list()) {
    if (bgThumbs.has(meta.id)) continue
    bgThumbs.set(meta.id, '')
    void backgrounds.thumb(meta.id).then(src => {
      if (!src || bgThumbs.get(meta.id) === src) return
      bgThumbs.set(meta.id, src)
      thumbLoaded()
    })
  }
  return addBoardChoices({
    builtIn: PITCHES,
    saved: customPitches(),
    currentPitch: pitchById(store.scene.pitch),
    admin: entitlements.hasBoardAdminAccess(),
    canPick: style => entitlements.canPickPitch(style),
    canUpload: entitlements.canUploadBackground(),
    thumb: id => bgThumbs.get(id) ?? '',
  })
}

/* The chooser's own file input. Mobile Safari only opens the native picker
   inside the tap that asked for it, so the click happens here and the caller
   waits on what comes back. The input is cleared before and after, so picking
   the same file twice in a row still counts as a change. */
const newBoardFile = document.createElement('input')
newBoardFile.type = 'file'
newBoardFile.accept = 'image/*'
newBoardFile.hidden = true
document.body.appendChild(newBoardFile)

function pickBackgroundForNewBoard(): Promise<AddBoardUpload> {
  return new Promise<AddBoardUpload>(resolve => {
    const done = (result: AddBoardUpload) => {
      newBoardFile.removeEventListener('change', onChange)
      newBoardFile.removeEventListener('cancel', onCancel)
      resolve(result)
    }
    const onCancel = () => done(null)
    const onChange = () => {
      const file = newBoardFile.files?.[0]
      newBoardFile.value = ''
      if (!file) { done(null); return }
      // A still from the camera roll is a broadcast frame; the tile's menu on
      // the pitch shelf is where a background becomes a pitch instead.
      addBackgroundFromFile(file, 'broadcast')
        .then(meta => done({ pitchId: meta.id }))
        .catch(() => done({ error: 'Could not save that image. It may be too large for this browser to store.' }))
    }
    newBoardFile.addEventListener('change', onChange)
    newBoardFile.addEventListener('cancel', onCancel)
    newBoardFile.value = ''
    newBoardFile.click()
  })
}

function openLibraryProject(id: string, preferredBoardId?: string) {
  if (!library.projects.some(p => p.id === id)) return
  disposeExtensionRuntime()
  const currentStillExists = library.projects.some(p => p.id === library.currentId)
  if (currentStillExists) {
    // the project being left keeps the board it was left on
    rememberBoard(library, library.currentId, currentProject(library).boards[editingBoard]?.id)
    stashEditedBoard()
    saves.autosaveCurrent(true)
  }
  window.clearTimeout(projectAutosaveTimer)
  library.currentId = id
  editingBoard = Math.max(0, storedBoardIndex(library, currentProject(library)))
  saveLibrary(library)
  if (!saves.activateDocument(id)) {
    loadBoardIntoEditor(currentProject(library).boards[editingBoard].scene)
    saves.registerNew()
  }
  if (preferredBoardId) {
    const preferred = currentProject(library).boards.findIndex(board => board.id === preferredBoardId)
    if (preferred >= 0) {
      editingBoard = preferred
      loadBoardIntoEditor(currentProject(library).boards[preferred].scene)
    }
  }
  rememberBoard(library, library.currentId, currentProject(library).boards[editingBoard]?.id)
  saveLibrary(library)
}

// a board saved without anyone naming it takes the name it already has here
saves.defaultBoardName = () => {
  const project = currentProject(library)
  return `${project.name} \u2014 ${boardName(project, editingBoard)}`
}

let sharedBackgroundScope: SharedBackgroundResolver | null = null
let sharedBackgroundRowId: string | null = null
/** The Project the shared scope belongs to, for views that show several. */
let sharedBackgroundProjectId: string | null = null
const invitationPreviewTokens = new Map<string, string>()

function selectProjectBackgroundResolver(project: Project): void {
  const activeRowId = saves.currentBoardId()
  const row = activeRowId
    ? saves.projectDocuments().find(item => item.rowId === activeRowId && item.project.id === project.id && item.access === 'shared')
    : undefined
  if (!row) {
    sharedBackgroundScope?.clear()
    sharedBackgroundScope = null
    sharedBackgroundRowId = null
    sharedBackgroundProjectId = null
    clearActiveSharedPitches()
    board.setBackgroundResolver(id => backgrounds.image(id))
    return
  }

  if (!sharedBackgroundScope || sharedBackgroundRowId !== row.rowId) {
    sharedBackgroundScope?.clear()
    sharedBackgroundRowId = row.rowId
    let scope: SharedBackgroundResolver
    scope = createSharedBackgroundResolver(row.rowId, {
      invitationToken: invitationPreviewTokens.get(row.rowId),
      onResolved: background => {
        if (scope !== sharedBackgroundScope) return
        setActiveSharedPitch(sharedBackgroundPitchStyle(background))
        board.rebuild()
        syncPanelPitchMode()
      },
      onMissing: id => {
        if (scope !== sharedBackgroundScope) return
        setActiveSharedPitch(sharedPitchPlaceholder(id, pitchById(id).boardH))
        board.rebuild()
        syncPanelPitchMode()
      },
    })
    sharedBackgroundScope = scope
    sharedBackgroundProjectId = row.project.id
    // the Boards and Projects views hold bytes read through the old scope
    boardsView.clearBackgroundCache()
    const ids = row.project.boards
      .map(item => item.scene.pitch)
      .filter((id): id is string => isBackgroundId(id))
    setActiveSharedPitches(ids.map(id => sharedPitchPlaceholder(id, row.project.boards.find(item => item.scene.pitch === id)?.scene.board.h)))
  }
  board.setBackgroundResolver(sharedBackgroundScope)
}

function loadBoardIntoEditor(scene: Scene) {
  selectProjectBackgroundResolver(currentProject(library))
  clearCollaborationPreview()
  swappingScene = true
  store.loadScene(migrate(JSON.parse(JSON.stringify(scene))))
  swappingScene = false
  renderBoardNote()
  collaborationBoardChanged()
}

function installProject(project: Project, preferredBoardId?: string) {
  disposeExtensionRuntime()
  const existing = library.projects.findIndex(item => item.id === project.id)
  if (existing >= 0) library.projects[existing] = project
  else library.projects.push(project)
  library.currentId = project.id
  const preferred = preferredBoardId ? project.boards.findIndex(item => item.id === preferredBoardId) : -1
  // an explicit board wins; otherwise come back to the one this project was left on
  editingBoard = preferred >= 0 ? preferred : Math.max(0, storedBoardIndex(library, project))
  rememberBoard(library, project.id, project.boards[editingBoard]?.id)
  saveLibrary(library)
  boardsView.setLibrary(library)
  loadBoardIntoEditor(project.boards[editingBoard].scene)
}

function openNewProject(scene: Scene) {
  window.clearTimeout(projectAutosaveTimer)
  const project = newProject(scene)
  installProject(project)
  saves.activateDocument(project.id)
}

function loadSavedDocument(document: BoardDocument, saved: { name: string; id: string | null }) {
  window.clearTimeout(projectAutosaveTimer)
  const preferredBoardId = currentBoard()?.id
  const migrated = migrateProject(document)
  const project = migrated ?? newProject(documentScene(document), saved.name)
  // A legacy single-scene row has no project identity. Its durable row id is
  // stable across devices, so use it until the row is saved as a Project.
  if (!migrated && saved.id) project.id = saved.id
  installProject(project, preferredBoardId)
}

saves.setDocumentAdapter(() => currentProject(library), loadSavedDocument)

/** Rejoin the visible library and full Project rows without touching scenes. */
function reconcileLibraryProjectDocuments(options: {
  seedMissing?: boolean
  removeProjectIds?: readonly string[]
  skipCurrent?: boolean
} = {}): void {
  const result = reconcileProjectLibrary(library, saves.projectDocuments(), options)
  if (result.persist.length) saves.persistProjectDocuments(result.persist)
  if (result.library !== library) {
    library = result.library
    saveLibrary(library)
    boardsView.setLibrary(library)
  }
}

/** The one way into Projects, so every entry point shows the same screen. */
function openProjectsScreen(): void {
  reconcileLibraryProjectDocuments()
  closeSettings()
  boardsView.open('projects')
  document.querySelector<HTMLElement>('#libRoot .libClose')?.focus()
}

// Existing libraries predate account sync. Seed all full Projects once, so a
// later Pro pass sees durable rows even though no project is currently open.
reconcileLibraryProjectDocuments({ seedMissing: !freshStarter })

// Bind the editor to the current durable row. Without this, the first edit
// after startup creates a duplicate sync row instead of updating the one just
// seeded above.
if (!saves.activateDocument(library.currentId)) {
  loadBoardIntoEditor(currentProject(library).boards[Math.min(editingBoard, currentProject(library).boards.length - 1)].scene)
  if (!freshStarter) saves.registerNew()
}

/* Everything the editor does lands in the board it is holding. Boards is
   rebuilt a beat later so a drag redraws once, not on every frame of it. */
let writeBackTimer = 0
store.subscribe(() => {
  if (swappingScene) return
  const project = currentProject(library)
  const board = project.boards[editingBoard]
  if (!board) return
  board.scene = migrate(JSON.parse(JSON.stringify(store.scene)))
  touch(project)
  window.clearTimeout(writeBackTimer)
  writeBackTimer = window.setTimeout(() => {
    saveLibrary(library)
    boardsView.refresh()
  }, 200)
  /* The saved board is what sync and sharing act on, so it keeps up with the
     canvas by itself: no Save button, and nothing that tells you to save
     before inviting someone. It settles a beat later than the project write
     above, and does nothing at all when the scene has not changed, so a drag
     never pays for it. */
  scheduleProjectAutosave()
})

/** Bank what the editor holds back into the board it is holding. */
function stashEditedBoard() {
  const project = currentProject(library)
  const board = project.boards[editingBoard]
  if (!board) return
  board.scene = migrate(JSON.parse(JSON.stringify(store.scene)))
  touch(project)
  documentChangeGeneration += 1
  saveLibrary(library)
  scheduleProjectAutosave()
}

/* ---------- the board's note ----------
   One note per board, written in the composer and drawn on the board itself,
   in a band under the pitch. It is part of the board rather than part of the
   screen, so it pans and zooms with the play instead of sitting over it. */

function currentBoard() {
  return currentProject(library).boards[editingBoard]
}

function renderBoardNote() {
  const note = (currentBoard()?.note ?? '').trim()
  board.setNote(note)
  // the icon says whether this board has been written about
  document.querySelector('[data-top="note"]')!.classList.toggle('active', !!note)
}

function editBoardNote() {
  const board = currentBoard()
  if (!board) return
  openComposer(board.note, (next) => {
    board.note = next
    touch(currentProject(library))
    saveProjectChanges()
    renderBoardNote()
  })
}
board.onNoteTap = editBoardNote
renderBoardNote()

/* ---------- export ----------
   Three things to export: this board as an image, or the project as a GIF or
   a video. Notes are a switch on all three. */

/* The share icon is where a board leaves this device: to a person, to an
   agent, or as a file. Each entry is listed only when the build can honour it,
   so the menu never offers something that answers with an apology. */

const shareButton = document.querySelector<HTMLButtonElement>('[data-top="export"]')!
const shareMenu = document.querySelector<HTMLElement>('#shareMenu')!
const shareSheet = shareMenu.querySelector<HTMLElement>('[data-share-sheet]')!

const UPGRADE_TOAST = 'Go to settings to upgrade to a Pro subscription.'

type ShareEntry = {
  key: string
  label: string
  note: string
  ic: Parameters<typeof icon>[0]
  /** Why this row cannot be used, and what to say when it is tapped. Every
      locked row is marked, and every locked row answers. */
  locked?: { tag: string; toast: string }
  run: () => void
}

function shareEntries(): ShareEntry[] {
  if (BOARD_SELF_HOSTED) return [
    { key: 'export', label: 'Export\u2026', note: 'This board or the project as images, a GIF, or a video', ic: 'download', run: openExportSheet },
  ]
  // Everything the sheet can do is listed, including what this account cannot
  // reach yet: a row nobody can see is a feature nobody knows they could buy.
  // The two invitations first, then the export.
  const pro = entitlements.isPro()
  return [
    {
      key: 'board-link', label: 'Copy link', ic: 'link',
      note: 'A copy of this board, or of the whole project',
      run: () => shareStep('Copy link', (body) => {
        makeCopyLink(body)
        return true
      }),
    },
    {
      key: 'agent', label: 'Invite an agent', ic: 'prompt',
      // a preview build shares the billing sandbox and must never mint a real
      // credential, so a Pro account here is told why rather than sold to
      note: 'A link that can read and draw on this board for 24 hours',
      // a preview build shares the billing sandbox and grants Pro to everyone
      // on it, so it must never mint a real credential: that is a different
      // reason from not having bought Pro, and it gets a different answer
      locked: entitlements.canCreateAgentLink()
        ? undefined
        : pro
          ? { tag: 'Board', toast: 'Agent links are issued only from board.tacticsjournal.com.' }
          : { tag: 'Pro', toast: UPGRADE_TOAST },
      run: () => shareStep('Invite an agent', (body) => {
        void makeAgentLink(body)
        return true
      }),
    },
    {
      key: 'username', label: 'Invite a person', note: 'By email, by @username, or with a link you can paste', ic: 'at',
      locked: pro ? undefined : { tag: 'Pro', toast: UPGRADE_TOAST },
      run: () => shareStep('Share this board', (body) => {
        const outcome = saves.embedShareForm(body)
        if (outcome === 'ok') return true
        body.innerHTML = `<p class="shareStatus">${outcome === 'save-first'
          ? 'This board could not be saved on this device, so there is nothing to share yet.'
          : 'Only the board owner can invite someone.'}</p>`
        return true
      }),
    },
    { key: 'export', label: 'Export\u2026', note: 'This board or the project as images, a GIF, or a video', ic: 'download', run: openExportSheet },
  ]
}

type CopyLinkScope = 'board' | 'project'

const copyButtonTimers = new WeakMap<HTMLButtonElement, number>()

function copyButtonIcons(): string {
  return `<span class="t-icon-swap" data-state="a" aria-hidden="true">
    <span class="t-icon" data-icon="a">${icon('copy')}</span>
    <span class="t-icon" data-icon="b">${icon('check')}</span>
  </span>`
}

function resetCopyButton(button: HTMLButtonElement, label: string) {
  const timer = copyButtonTimers.get(button)
  if (timer !== undefined) window.clearTimeout(timer)
  button.querySelector<HTMLElement>('.t-icon-swap')!.dataset.state = 'a'
  button.setAttribute('aria-label', label)
}

function showCopySuccess(button: HTMLButtonElement, resetLabel: string) {
  button.querySelector<HTMLElement>('.t-icon-swap')!.dataset.state = 'b'
  button.setAttribute('aria-label', 'Copied')
  const timer = window.setTimeout(() => {
    if (button.isConnected) resetCopyButton(button, resetLabel)
  }, 2000)
  copyButtonTimers.set(button, timer)
}

function boardLinkPreview(): string {
  const source = board.toFrameCanvas(1200)
  const canvas = document.createElement('canvas')
  canvas.width = 1200
  canvas.height = 630
  const context = canvas.getContext('2d')
  if (!context) throw new Error('This board preview could not be created.')
  context.fillStyle = '#f2f1ed'
  context.fillRect(0, 0, canvas.width, canvas.height)
  const scale = Math.min(canvas.width / source.width, canvas.height / source.height)
  const width = source.width * scale
  const height = source.height * scale
  context.drawImage(source, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height)
  for (const quality of [0.72, 0.5, 0.32]) {
    const preview = canvas.toDataURL('image/jpeg', quality)
    if (preview.length <= 500_000) return preview
  }
  throw new Error('This board preview could not be created.')
}

function makeCopyLink(body: HTMLElement) {
  stashEditedBoard()
  const project = currentProject(library)
  const source = currentBoard()
  if (!source) {
    body.innerHTML = '<p class="shareStatus">This board could not be linked.</p>'
    return
  }
  const boardTitle = boardName(project, editingBoard)
  const boardLinkName = (project.name === 'Untitled project' ? boardTitle : `${project.name} — ${boardTitle}`).slice(0, 40)
  const projectName = project.name.trim().slice(0, 40) || 'Untitled project'
  const projectCopy = migrateProject(JSON.parse(JSON.stringify(project)))!
  let generation = 0

  body.innerHTML = `<div class="shareWays copyLinkScope" role="radiogroup" aria-label="What to copy">
      <button type="button" role="radio" aria-checked="true" tabindex="0" data-link-scope="board">This board</button>
      <button type="button" role="radio" aria-checked="false" tabindex="-1" data-link-scope="project">Whole project</button>
    </div>
    <p class="shareStatus" data-copy-link-status role="status" aria-live="polite"></p>
    <span class="linkField" data-copy-link-field hidden>
      <input type="text" readonly data-copy-link>
      <button type="button" class="copyIconButton" data-copy-link-copy aria-label="Copy board link">${copyButtonIcons()}</button>
    </span>`

  mountSlidingPills(body)
  const choices = Array.from(body.querySelectorAll<HTMLButtonElement>('[data-link-scope]'))
  const status = body.querySelector<HTMLElement>('[data-copy-link-status]')!
  const field = body.querySelector<HTMLElement>('[data-copy-link-field]')!
  const input = body.querySelector<HTMLInputElement>('[data-copy-link]')!
  const copy = body.querySelector<HTMLButtonElement>('[data-copy-link-copy]')!
  let currentUrl = ''

  const generate = async (scope: CopyLinkScope) => {
    const request = ++generation
    choices.forEach(choice => {
      const selected = choice.dataset.linkScope === scope
      choice.setAttribute('aria-checked', String(selected))
      choice.tabIndex = selected ? 0 : -1
    })
    field.hidden = true
    currentUrl = ''
    resetCopyButton(copy, scope === 'board' ? 'Copy board link' : 'Copy project link')
    status.textContent = scope === 'board' ? `Making a link for “${boardTitle}”…` : `Making a link for all ${project.boards.length} boards…`
    try {
      let url: string
      const permanentProjectLink = scope === 'project'
        && window.location.hostname === 'board.tacticsjournal.com'
        && entitlements.isPro()
      try {
        if (scope === 'board') {
          await board.imagesReady()
          url = await createBoardImportUrl(boardLinkName, newProjectFromBoard(source, boardLinkName), boardLinkPreview())
        } else {
          url = permanentProjectLink
            ? await createStoredProjectImportUrl(projectName, projectCopy)
            : await createProjectImportUrl(projectName, projectCopy)
        }
      } catch (error) {
        if (scope !== 'project' || permanentProjectLink || !isAgentImportTooLarge(error)) throw error
        if (request === generation) status.textContent = 'Large whole-project links require Pro.'
        return
      }
      if (request !== generation) return
      currentUrl = url
      input.value = url
      input.setAttribute('aria-label', scope === 'board' ? 'Board link' : 'Project link')
      status.textContent = scope === 'board'
        ? `Copies “${boardTitle}” only. It can be added to a new or existing project. The link expires after 24 hours.`
        : `Copies all ${project.boards.length} board${project.boards.length === 1 ? '' : 's'} in “${projectName}” as a new project. ${permanentProjectLink ? 'The link does not expire.' : 'The link expires after 24 hours.'}`
      field.hidden = false
    } catch (error) {
      if (request !== generation) return
      status.textContent = error instanceof Error ? error.message : `This ${scope} could not be linked.`
    }
  }

  const choose = (choice: HTMLButtonElement, focus: boolean) => {
    const scope = choice.dataset.linkScope as CopyLinkScope
    if (focus) choice.focus()
    void generate(scope)
  }
  choices.forEach(choice => choice.addEventListener('click', () => choose(choice, false)))
  body.querySelector<HTMLElement>('.copyLinkScope')!.addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return
    event.preventDefault()
    const selected = choices.findIndex(choice => choice.getAttribute('aria-checked') === 'true')
    const direction = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : -1
    choose(choices[(selected + direction + choices.length) % choices.length], true)
  })
  copy.addEventListener('click', async () => {
    if (!currentUrl) return
    try {
      await navigator.clipboard.writeText(currentUrl)
      showCopySuccess(copy, input.getAttribute('aria-label') === 'Project link' ? 'Copy project link' : 'Copy board link')
    } catch {
      input.focus()
      input.select()
      copy.setAttribute('aria-label', 'Copy the selected link with your keyboard')
      status.textContent = 'The link is selected. Copy it with your keyboard.'
    }
  })
  void generate('board')
}

async function makeAgentLink(body: HTMLElement) {
  body.innerHTML = '<p class="shareStatus">Saving and creating agent link…</p>'
  try {
    const result = await saves.currentAgentLink()
    if (result.status !== 'ok') {
      body.innerHTML = `<p class="shareStatus">${result.status === 'save-first'
        ? 'This board could not be saved on this device, so there is nothing to give an agent yet.'
        : 'Agent links are a Pro feature.'}</p>`
      return
    }
    const url = result.url
    body.innerHTML = `<p class="shareStatus">Paste this link into your coding agent. It expires after 24 hours and can only read and draw on this project.</p>
      <span class="linkField">
        <input type="text" readonly data-agent-link aria-label="Agent link">
        <button type="button" class="copyIconButton" data-agent-link-copy aria-label="Copy agent link">${copyButtonIcons()}</button>
      </span>`
    const input = body.querySelector<HTMLInputElement>('[data-agent-link]')!
    const copy = body.querySelector<HTMLButtonElement>('[data-agent-link-copy]')!
    input.value = url
    copy.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(url)
        showCopySuccess(copy, 'Copy agent link')
      } catch {
        input.focus()
        input.select()
        copy.setAttribute('aria-label', 'Copy the selected link with your keyboard')
      }
    })
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'The request failed.'
    body.innerHTML = `<p class="shareStatus">Could not create agent link: ${esc(reason)} Your saved work was kept locally.</p>`
  }
}

/* A choice made in the sheet is answered in the sheet. The rows are replaced
   by the step, Back brings them back, and the sheet keeps its own dismissal. */
function shareStep(title: string, fill: (body: HTMLElement) => boolean) {
  shareSheet.innerHTML = `<div class="sheetHead">
      <button data-share="back">${icon('chevron-left')}Back</button>
      <strong>${title}</strong>
      <button data-share="close">Close</button>
    </div>
    <div class="shareBody" data-share-body></div>`
  const body = shareSheet.querySelector<HTMLElement>('[data-share-body]')!
  if (!fill(body)) closeShareMenu()
}

function closeShareMenu() {
  shareMenu.classList.add('hidden')
  shareButton.setAttribute('aria-expanded', 'false')
  shareButton.focus()
}

function drawShareRows() {
  shareSheet.innerHTML = `<div class="sheetHead"><strong>Share</strong><button data-share="close">Close</button></div>`
    + shareEntries().map(e =>
      `<button type="button" class="shareRow${e.locked ? ' is-locked' : ''}" data-share="${e.key}">
        ${icon(e.ic)}
        <span><b>${e.label}</b><small>${e.note}</small></span>
        ${e.locked ? `<span class="setTag ${e.locked.tag === 'Pro' ? 'setTagPro' : 'setTagLicense'}">${e.locked.tag}</span>` : ''}
      </button>`).join('')
}

function toggleShareMenu() {
  if (!shareMenu.classList.contains('hidden')) { closeShareMenu(); return }
  drawShareRows()
  shareMenu.classList.remove('hidden')
  shareButton.setAttribute('aria-expanded', 'true')
  shareSheet.querySelector<HTMLElement>('.shareRow')?.focus()
}

shareMenu.addEventListener('click', (e) => {
  const target = e.target as HTMLElement
  // the ground around the sheet dismisses it, the way every other sheet does
  if (target === shareMenu) { closeShareMenu(); return }
  const key = target.closest<HTMLElement>('[data-share]')?.dataset.share
  if (!key) return
  if (key === 'close') { closeShareMenu(); return }
  if (key === 'back') { drawShareRows(); return }
  const entry = shareEntries().find(item => item.key === key)
  if (!entry) return
  // a locked row says where to go rather than moving the reader somewhere
  // they did not ask to be
  if (entry.locked) { showToast(entry.locked.toast); return }
  // a step stays in the sheet; anything else is finished with it
  if (entry.key !== 'username' && entry.key !== 'board-link' && entry.key !== 'agent') closeShareMenu()
  entry.run()
})

type ExportKind = 'board' | 'images' | 'gif' | 'video'

/** Some devices cannot share a set of files, so each image is offered on its own. */
function openProjectImageSheet(files: readonly ProjectImageFile[]) {
  const sheet = document.createElement('div')
  sheet.className = 'expSheet'
  sheet.setAttribute('role', 'dialog')
  sheet.setAttribute('aria-modal', 'true')
  sheet.setAttribute('aria-labelledby', 'projectImageSheetTitle')
  sheet.innerHTML = `
    <div class="expSheet__head">
      <span id="projectImageSheetTitle">Download project images</span>
      <button data-img="done">Done</button>
    </div>
    <div class="expSheet__body">
      <p class="expHint">This device cannot share multiple files at once. Download the images you need below.</p>
      <div class="expFiles">
        ${files.map((file, i) => `<div class="expFile"><span class="expFile__name">${esc(file.name)}</span><button class="expFile__go" data-img-file="${i}">Download</button></div>`).join('')}
      </div>
      <p class="expStatus" data-img-status role="status" aria-live="polite"></p>
    </div>`
  document.body.appendChild(sheet)
  document.body.classList.add('composer-open')

  const status = sheet.querySelector<HTMLElement>('[data-img-status]')!
  const close = () => {
    sheet.remove()
    document.body.classList.remove('composer-open')
    document.removeEventListener('keydown', onKey)
  }
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); close() } }
  document.addEventListener('keydown', onKey)

  sheet.addEventListener('click', (e) => {
    const target = e.target as HTMLElement
    if (target.closest('[data-img="done"]')) { close(); return }
    const go = target.closest<HTMLButtonElement>('[data-img-file]')
    if (!go) return
    const file = files[Number(go.dataset.imgFile)]
    if (!file) return
    downloadProjectImage(file)
    go.textContent = 'Downloaded'
    go.classList.add('done')
    status.textContent = `Downloaded ${file.name}`
  })

  const first = sheet.querySelector<HTMLElement>('[data-img-file]') ?? sheet.querySelector<HTMLElement>('[data-img="done"]')
  first?.focus()
}

async function openExportSheet() {
  const project = currentProject(library)
  const many = canAnimate(project)
  let kind: ExportKind = 'board'
  let withNotes = true

  const sheet = document.createElement('div')
  sheet.className = 'expSheet'
  sheet.setAttribute('role', 'dialog')
  sheet.setAttribute('aria-modal', 'true')
  sheet.setAttribute('aria-labelledby', 'exportSheetTitle')
  sheet.innerHTML = `
    <div class="expSheet__head">
      <button data-exp="cancel">Cancel</button>
      <span id="exportSheetTitle">Export</span>
      <button data-exp="go">Export</button>
    </div>
    <div class="expSheet__body">
      <div class="expOpts" data-exp-opts role="group" aria-label="Export format"></div>
      <label class="expNotes"><input type="checkbox" data-exp-notes checked><span>Include the note on each board</span></label>
      <p class="expHint">${!many
        ? 'This project has one board, so there is nothing to animate yet.'
        : 'The GIF and the video follow the timing on each link.'}</p>
      <p class="expStatus" data-exp-status role="status" aria-live="polite"></p>
    </div>`
  document.body.appendChild(sheet)
  document.body.classList.add('composer-open')

  const opts = sheet.querySelector<HTMLElement>('[data-exp-opts]')!
  const notes = sheet.querySelector<HTMLElement>('.expNotes')!
  const status = sheet.querySelector<HTMLElement>('[data-exp-status]')!
  const KINDS: { k: ExportKind; label: string; note: string; ic: string }[] = [
    { k: 'board', label: 'This board', note: 'A PNG of the pitch you have open.', ic: 'photo' },
    { k: 'images', label: 'All project images', note: `${project.boards.length} PNG${project.boards.length === 1 ? '' : 's'}, one for every board.`, ic: 'stack' },
    { k: 'gif', label: 'The project as a GIF', note: 'Loops the whole move. Drops into a message or a post.', ic: 'gif' },
    { k: 'video', label: 'The project as a video', note: 'Full quality, for slides or a longer edit.', ic: 'movie' },
  ]
  const drawOpts = () => {
    notes.hidden = kind === 'board' || kind === 'images'
    opts.innerHTML = KINDS.map(o => {
      const animation = o.k === 'gif' || o.k === 'video'
      const off = animation && !many
      const note = o.note
      return `<button class="expOpt${o.k === kind ? ' active' : ''}" data-kind="${o.k}" aria-pressed="${o.k === kind}"${off ? ' disabled' : ''}>
        ${icon(o.ic as Parameters<typeof icon>[0])}
        <span><b>${o.label}</b><small>${note}</small></span>
        <span class="expTick">${icon('check')}</span>
      </button>`
    }).join('')
  }
  drawOpts()
  opts.querySelector<HTMLElement>('[aria-pressed="true"]')?.focus()
  let exporting = false
  const setBusy = (busy: boolean) => {
    exporting = busy
    sheet.setAttribute('aria-busy', String(busy))
    sheet.querySelectorAll<HTMLButtonElement | HTMLInputElement>('button, input').forEach(control => { control.disabled = busy })
    if (!busy) {
      drawOpts()
      opts.querySelector<HTMLElement>('[aria-pressed="true"]')?.focus()
    }
  }

  const close = () => {
    sheet.remove()
    document.body.classList.remove('composer-open')
    document.removeEventListener('keydown', onKey)
  }
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !exporting) { e.stopPropagation(); close() } }
  document.addEventListener('keydown', onKey)

  sheet.addEventListener('change', (e) => {
    if ((e.target as HTMLElement).matches('[data-exp-notes]')) {
      withNotes = (e.target as HTMLInputElement).checked
    }
  })
  sheet.addEventListener('click', async (e) => {
    const pick = (e.target as HTMLElement).closest<HTMLElement>('[data-kind]')
    if (pick && !exporting) {
      kind = pick.dataset.kind as ExportKind
      drawOpts()
      opts.querySelector<HTMLElement>('[aria-pressed="true"]')?.focus()
      return
    }
    const act = (e.target as HTMLElement).closest<HTMLElement>('[data-exp]')?.dataset.exp
    if (act === 'cancel') { close(); return }
    if (act !== 'go') return
    if (kind === 'board') { close(); exportPng(); return }
    if (kind === 'images') {
      setBusy(true)
      status.textContent = 'Building the project images\u2026'
      let fellBack = false
      const individualFallback = project.boards.length < 10
        ? (files: readonly ProjectImageFile[]) => {
            fellBack = true
            close()
            openProjectImageSheet(files)
          }
        : undefined
      try {
        await exportProjectImages(currentProject(library), defaults, (done, total) => {
          status.textContent = `Building the project images\u2026 ${done} of ${total}`
        }, sharedBackgroundScope ?? undefined, individualFallback)
        void recordProductEvent('board_exported', 'png')
        if (!fellBack) close()
      } catch (err) {
        setBusy(false)
        status.textContent = err instanceof Error ? err.message : 'That export did not work on this device.'
      }
      return
    }
    setBusy(true)
    status.textContent = kind === 'gif' ? 'Building the GIF\u2026' : 'Recording the video\u2026'
    try {
      await exportAnimation(kind, currentProject(library), defaults, withNotes, (done, total) => {
        const pct = Math.round(done * 100 / total)
        status.textContent = kind === 'gif' ? `Building the GIF\u2026 ${pct}%` : `Recording the video\u2026 ${pct}%`
      }, sharedBackgroundScope ?? undefined)
      void recordProductEvent('board_exported', kind)
      close()
    } catch (err) {
      setBusy(false)
      status.textContent = err instanceof Error ? err.message : 'That export did not work on this device.'
    }
  })
}

/* ---------- background images: the board on a photograph ---------- */

// the camera button only appears while a photograph is behind the board
function syncLiveButton() {
  const live = !!pitchById(store.scene.pitch).live
  document.querySelector('[data-top="live-shot"]')!.classList.toggle('hidden', !live)
}
store.subscribe(syncLiveButton)
syncLiveButton()

/** Put a saved background behind the board, at the size its image makes. */
function useBackground(meta: BackgroundMeta) {
  const style = pitchById(meta.id)
  const changed = applyPitchChoice(style, meta.boardH)
  board.refreshBackground()
  renderPitchSeg()
  if (changed) announcePitchChange(style)
}

/** The browser side of decoding a picked file, kept in one place. */
const liveShotDecoder = {
  create: (file: Blob) => URL.createObjectURL(file),
  revoke: (url: string) => URL.revokeObjectURL(url),
  load: (url: string) => loadImage(url),
}

/** A screenshot from the camera button is saved like any other background. */
async function applyLiveShot(img: HTMLImageElement, name: string): Promise<boolean> {
  try {
    // The camera button is a broadcast still by definition; it only exists on
    // a broadcast board in the first place.
    useBackground(await addBackgroundFromImage(img, name, 'broadcast'))
    setNote('Screenshot saved to your backgrounds.')
    showToast('Screenshot saved to your backgrounds.')
    return true
  } catch {
    setNote('That screenshot could not be saved on this device.')
    showToast('That screenshot could not be saved on this device.')
    return false
  }
}

/** A blank board showing one broadcast still, at the size its image makes. */
function broadcastShotScene(meta: BackgroundMeta): Scene {
  const style = pitchById(meta.id)
  const scene = emptyScene(style.id)
  scene.board = { ...scene.board, h: meta.boardH }
  // a still carries the match the project is already showing, like a pitch change does
  if (style.live) scene.match = { ...emptyMatch(), ...store.scene.match, showTeams: false }
  return scene
}

/**
 * Several stills at once: one board each, in the order they were picked,
 * added after the board being edited. The editor lands on the first of them,
 * which is the one the user is looking for.
 */
async function importLiveShots(files: readonly File[]): Promise<boolean> {
  const result = await importBroadcastShots(files, {
    decode: file => decodeImageFile(file, liveShotDecoder),
    save: (img, name) => addBackgroundFromImage(img, name, 'broadcast'),
    name: file => nameFromFile(file.name),
  })
  if (result.saved.length) {
    stashEditedBoard()
    const project = currentProject(library)
    const first = editingBoard + 1
    let at = editingBoard
    for (const shot of result.saved) {
      addBoard(project, at, false, broadcastShotScene(shot.meta)).title = shot.name
      at += 1
    }
    editingBoard = first
    const opened = project.boards[editingBoard]
    touch(project)
    rememberBoard(library, project.id, opened.id)
    saveProjectChanges(project)
    loadBoardIntoEditor(opened.scene)
  }
  showToast(shotImportMessage(result))
  return result.saved.length > 0
}

async function openLiveShotPicker(): Promise<void> {
  ;(document.querySelector('[data-live-file]') as HTMLInputElement).click()
}

document.querySelector('[data-live-file]')!.addEventListener('change', (e) => {
  const input = e.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  input.value = ''
  if (!files.length) return
  // one image still changes the board in front of you; several become boards
  if (files.length > 1) { void importLiveShots(files); return }
  const file = files[0]
  decodeImageFile(file, liveShotDecoder)
    .then(img => applyLiveShot(img, nameFromFile(file.name)))
    .catch(() => { showToast('That image could not be read.') })
})

/* ---------- match settings (cog): scoreboard + team codes overlay ---------- */

const matchEl = document.createElement('div')
matchEl.className = 'modal hidden'
matchEl.innerHTML = `
  <div class="sheet matchSheet">
    <div class="sheetHead">
      <strong>Match</strong>
      <button data-match="close">Close</button>
    </div>
    <label class="mField">
      <span class="mLabel">Teams</span>
      <span class="mPair">
        <input class="labelIn mGrow" data-match-f="home" maxlength="20" placeholder="Home">
        <input class="labelIn mGrow" data-match-f="away" maxlength="20" placeholder="Away">
      </span>
    </label>
    <div class="mField">
      <span class="mLabel">Score</span>
      <div class="mScore">
        <span class="stepper">
          <button data-match-step="homeScore:-1" aria-label="Home score down">−</button>
          <input class="labelIn mStepIn" data-match-f="homeScore" maxlength="2" inputmode="numeric">
          <button data-match-step="homeScore:1" aria-label="Home score up">+</button>
        </span>
        <span class="mDash">–</span>
        <span class="stepper">
          <button data-match-step="awayScore:-1" aria-label="Away score down">−</button>
          <input class="labelIn mStepIn" data-match-f="awayScore" maxlength="2" inputmode="numeric">
          <button data-match-step="awayScore:1" aria-label="Away score up">+</button>
        </span>
      </div>
    </div>
    <label class="mField">
      <span class="mLabel">Clock</span>
      <input class="labelIn mGrow" data-match-f="clock" maxlength="8" placeholder="24:19">
    </label>
    <label class="mField">
      <span class="mLabel">Date</span>
      <input class="labelIn mGrow" type="date" data-match-date>
    </label>
    <div class="mSwitches">
      <button class="mSwitch" role="switch" aria-checked="false" data-match="toggle-scoreboard"><span>Scoreboard</span><span class="mTrack t-toggle" data-on="false"><span class="mThumb t-toggle-thumb"></span></span></button>
      <button class="mSwitch" role="switch" aria-checked="false" data-match="toggle-teams"><span>Team names</span><span class="mTrack t-toggle" data-on="false"><span class="mThumb t-toggle-thumb"></span></span></button>
    </div>
  </div>`
document.body.appendChild(matchEl)

// coalesce match-field typing into one undo entry per editing session
matchEl.addEventListener('focusin', (e) => {
  if ((e.target as HTMLElement).matches('[data-match-f]')) store.beginGesture()
})
matchEl.addEventListener('focusout', (e) => {
  if ((e.target as HTMLElement).matches('[data-match-f]')) store.endGesture()
})

// the scoreboard stores the date as a display string ("15 Sep 2024"); the
// native picker speaks ISO, so convert at the boundary without Date parsing
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const pad2 = (n: number) => String(n).padStart(2, '0')
function dateDisplayToIso(s: string): string {
  const m = /^(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{4})$/.exec(s.trim())
  if (!m) return ''
  const mi = MONTHS.findIndex(x => x.toLowerCase() === m[2].slice(0, 3).toLowerCase())
  return mi < 0 ? '' : `${m[3]}-${pad2(mi + 1)}-${pad2(Number(m[1]))}`
}
function dateIsoToDisplay(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : ''
}

function matchInfo() {
  if (!store.scene.match) store.scene.match = emptyMatch()
  return store.scene.match
}

/** One switch: the button carries the semantics, the track carries the motion. */
function setSwitch(key: string, on: boolean) {
  const button = matchEl.querySelector<HTMLElement>(`[data-match="${key}"]`)!
  button.classList.toggle('on', on)
  button.setAttribute('aria-checked', String(on))
  button.querySelector<HTMLElement>('.mTrack')!.dataset.on = String(on)
}

function syncSwitches(m = matchInfo()) {
  setSwitch('toggle-scoreboard', m.showScoreboard)
  setSwitch('toggle-teams', m.showTeams)
}

function syncMatchSheet() {
  const m = matchInfo()
  matchEl.querySelectorAll<HTMLInputElement>('[data-match-f]').forEach(i => {
    i.value = String((m as any)[i.dataset.matchF!] ?? '')
  })
  matchEl.querySelector<HTMLInputElement>('[data-match-date]')!.value = dateDisplayToIso(m.date)
  syncSwitches(m)
}

function openMatchSheet() {
  // Each opening starts inert: the switches show where they stand, they do
  // not perform getting there.
  matchEl.querySelectorAll('.mTrack').forEach(track => track.classList.remove('is-init'))
  syncMatchSheet()
  matchEl.classList.remove('hidden')
}

matchEl.addEventListener('click', (e) => {
  if (e.target === matchEl) { matchEl.classList.add('hidden'); return }
  const target = e.target as HTMLElement
  const step = target.closest<HTMLElement>('[data-match-step]')
  if (step) {
    const [field, delta] = step.dataset.matchStep!.split(':')
    store.apply(s => {
      const m = { ...emptyMatch(), ...s.match }
      const next = Math.max(0, Math.min(99, (Number((m as any)[field]) || 0) + Number(delta)))
      ;(m as any)[field] = String(next)
      m.showScoreboard = true
      s.match = m
    })
    syncMatchSheet()
    return
  }
  const btn = target.closest('[data-match]') as HTMLElement | null
  if (!btn) return
  const k = btn.dataset.match
  // The thumb only animates once the switch has been used: a sheet opening on
  // a set of switches should not play two bounces on first paint.
  btn.querySelector<HTMLElement>('.mTrack')?.classList.add('is-init')
  if (k === 'close') matchEl.classList.add('hidden')
  else if (k === 'toggle-scoreboard') {
    store.apply(s => { s.match = { ...emptyMatch(), ...s.match, showScoreboard: !s.match?.showScoreboard } })
    syncSwitches()
  } else if (k === 'toggle-teams') {
    store.apply(s => { s.match = { ...emptyMatch(), ...s.match, showTeams: !s.match?.showTeams } })
    syncSwitches()
  }
})

// native date picker -> the scoreboard's display string
matchEl.addEventListener('change', (e) => {
  const input = e.target as HTMLInputElement
  if (input.dataset.matchDate === undefined) return
  store.apply(s => {
    const m = { ...emptyMatch(), ...s.match, date: dateIsoToDisplay(input.value) }
    if (input.value) m.showScoreboard = true
    s.match = m
  })
  syncSwitches()
})

// live while typing, and typing a value implies the user wants it shown
matchEl.addEventListener('input', (e) => {
  const input = e.target as HTMLInputElement
  const f = input.dataset.matchF
  if (!f) return
  store.apply(s => {
    const m = { ...emptyMatch(), ...s.match, [f]: input.value.trim() }
    if (f === 'home' || f === 'away') m.showTeams = !pitchById(s.pitch).live
    else m.showScoreboard = true
    s.match = m
  })
  // refresh the toggle states only; rewriting the inputs would fight the caret
  syncSwitches()
})

// The managed service uses the Tactics Journal account header. A self-host
// build stays local and does not contact or advertise the hosted account API.
const tjHeader = BOARD_SELF_HOSTED ? null : initTjHeader()
const closeSiteMenu = () => tjHeader?.closeMenu()
if (!BOARD_SELF_HOSTED) initTjSearch()

/* ---------- settings sheet ---------- */

const THEME_KEY = 'tbm-theme-v1'

/* The build steps from the repository README, kept as one block so the copy
   button hands over exactly what the reader sees. */
const SELF_HOST_REPO = 'https://github.com/kyleboas/board'
const SELF_HOST_COMMANDS = `git clone ${SELF_HOST_REPO}.git
cd board
npm install
npm run build:self-hosted`

const settingsEl = document.createElement('div')
settingsEl.className = 'modal hidden settingsModal'
settingsEl.innerHTML = `
  <div class="sheet setSheet">
    <div class="setNav">
      <button class="setBack" data-set="back" hidden aria-label="Back">${icon('chevron-left', 'ic setBackIc')}</button>
      <strong class="setTitle" data-set-title>Settings</strong>
      <button class="setDone" data-set="close">Done</button>
    </div>
    <div class="setPane" data-pane="root">
      <div class="setGroupHead">Board</div>
      <div class="setGroup">
        <button class="setItem" data-goto="teams" data-side-row="home">
          <span class="setDot" data-side-dot="home"></span>
          <span class="setItemLabel">Home</span>
          <span class="setItemValue" data-side-name="home">Not set</span>
          ${icon('chevron-right', 'ic setChev')}
        </button>
        <button class="setItem" data-goto="teams" data-side-row="away">
          <span class="setDot" data-side-dot="away"></span>
          <span class="setItemLabel">Away</span>
          <span class="setItemValue" data-side-name="away">Not set</span>
          ${icon('chevron-right', 'ic setChev')}
        </button>
        <button class="setItem" data-goto="pitch">
          ${icon('soccer-field')}
          <span class="setItemLabel">Pitch and background</span>
          <span class="setItemValue setPitchSummary"><span data-pitch-name>Pitch</span><span data-bg-count></span></span>
          ${icon('chevron-right', 'ic setChev')}
        </button>
        ${BOARD_SELF_HOSTED ? `<button class="setItem" data-goto="assets">
          ${icon('file-plus')}
          <span class="setItemLabel">My assets</span>
          <span class="setItemValue" data-assets-count></span>
          ${icon('chevron-right', 'ic setChev')}
        </button>` : ''}
        <div class="setItem setItemStatic">
          ${icon('sun-moon')}
          <span class="setItemLabel">Theme</span>
          <span class="setSeg" role="group" aria-label="Theme">
            <button data-set="theme-system" aria-pressed="false">System</button>
            <button data-set="theme-light" aria-pressed="false">Light</button>
            <button data-set="theme-dark" aria-pressed="false">Dark</button>
          </span>
        </div>
      </div>

      <div class="setGroupHead">Projects</div>
      <div class="setGroup">
        <button class="setItem" data-set="projects" data-projects-row>
          ${icon('layout-grid')}
          <span class="setItemLabel">Saved projects</span>
          <span class="setItemValue projectsSummary" aria-hidden="true">
            <span class="projectsCountFull" data-projects-count></span>
            <span class="projectsCountCompact" data-projects-count-compact></span>
            <span class="projectsUpdatedFull" data-projects-updated-full hidden> · Last updated <time data-projects-updated-time></time> ago</span>
            <span class="projectsUpdatedCompact" data-projects-updated-compact hidden> · <time data-projects-updated-time-compact></time></span>
          </span>
          ${icon('chevron-right', 'ic setChev')}
        </button>
        ${BOARD_SELF_HOSTED ? '' : `<button class="setItem" data-set="free-backup">
          ${icon('arrows-exchange')}
          <span class="setItemLabel" data-free-backup-label>Back up one project free</span>
          <span class="setItemValue" data-free-backup-value></span>
        </button>`}
        <button class="setItem" data-goto="boards">
          ${icon('arrows-exchange')}
          <span class="setItemLabel">Move to another device</span>
          ${icon('chevron-right', 'ic setChev')}
        </button>
      </div>

      <div class="setGroupHead">Agents</div>
      <div class="setGroup">
        <button class="setItem" data-goto="skills">
          ${icon('skills')}
          <span class="setItemLabel">Skills and Extensions</span>
          ${icon('chevron-right', 'ic setChev')}
        </button>
        ${BOARD_SELF_HOSTED ? '' : `<button class="setItem" data-goto="agents">
          ${icon('prompt')}
          <span class="setItemLabel">Connect Claude or ChatGPT</span>
          <span class="setTag setTagPro" data-lock-tag="agents">Pro</span>
          ${icon('chevron-right', 'ic setChev')}
        </button>`}
      </div>

      ${BOARD_SELF_HOSTED ? `<div class="setGroupHead">Hosting</div>
      <div class="setGroup">
        <div class="setItem">
          ${icon('external-link')}
          <span class="setItemLabel">Self-hosted</span>
          <span class="setItemValue">Local features enabled</span>
        </div>
      </div>` : `<div class="setGroupHead">Account</div>
      <div class="setGroup">
        <button class="setItem" data-set="signin">
          ${icon('user-circle')}
          <span class="setItemLabel" data-account-label>Sign in to Tactics Journal</span>
          <span class="setItemValue" data-account-email></span>
          ${icon('chevron-right', 'ic setChev')}
        </button>
        <button class="setItem" data-set="signout" data-account-signout hidden>
          ${icon('logout')}
          <span class="setItemLabel">Sign out</span>
        </button>
        <button class="setItem" data-goto="pro">
          ${icon('license')}
          <span class="setItemLabel">Plans</span>
          <span class="setItemValue" data-plan-name>Free</span>
          ${icon('chevron-right', 'ic setChev')}
        </button>
        <button class="setItem" data-goto="assets">
          ${icon('file-plus')}
          <span class="setItemLabel">My assets</span>
          <span class="setItemValue" data-assets-count></span>
          ${icon('chevron-right', 'ic setChev')}
        </button>
      </div>`}

      <div class="setGroupHead">Help</div>
      <div class="setGroup">
        <button class="setItem" data-goto="howto">
          ${icon('help-circle')}
          <span class="setItemLabel">How to use</span>
          ${icon('chevron-right', 'ic setChev')}
        </button>
        <button class="setItem" data-goto="about">
          ${icon('copyright')}
          <span class="setItemLabel">Privacy, data and terms</span>
          ${icon('chevron-right', 'ic setChev')}
        </button>
        <button class="setItem" data-goto="self-host">
          ${icon('stack')}
          <span class="setItemLabel">Self-host</span>
          ${icon('chevron-right', 'ic setChev')}
        </button>
        ${BOARD_SELF_HOSTED ? '' : `<button class="setItem" data-goto="feedback">
          ${icon('message-report')}
          <span class="setItemLabel">Feedback</span>
          ${icon('chevron-right', 'ic setChev')}
        </button>`}
      </div>
    </div>
    <div class="setPane hidden" data-pane="howto">
      <div class="mobileHomeHint">
        <strong>Add to Home Screen</strong>
        <p>For the best mobile experience, add Tactics Board to your Home Screen. In Safari, tap Share, then Add to Home Screen. In your browser, open the menu, then tap Add to Home screen.</p>
      </div>
      <div class="setTutorial">
        <strong>How to use</strong>
        <p><b>Players.</b> Open Players in the bottom menu, then tap + Player for a single dot or + XI for a full lineup. Set your clubs under Teams in Settings to load real squads and kit colors.</p>
        <p><b>Edit a dot.</b> Tap a player to pick a name from the roster, set the shirt number, and change its color. Drag any piece to move it; select it for resize handles.</p>
        <p><b>Icons, arrows, zones, text.</b> Pick the tool in the bottom menu, then tap or drag on the board. Use Icons → Measure for a straight measuring line anywhere; it has no middle bend handle.</p>
        <p><b>View.</b> Pinch or scroll to zoom, drag the empty pitch to pan. The icon row above has export, fit view, undo, redo and new board. Use the camera button to bring a broadcast screenshot onto the live board.</p>
        <p><b>Boards.</b> Keep unlimited projects and saved boards on this device. Open Boards in Settings to name, load, delete, or move them to another device.</p>
      </div>
    </div>
    <div class="setPane hidden" data-pane="about">
      <div class="setTutorial">
        <strong>Privacy, data, copyright and use</strong>
        ${BOARD_SELF_HOSTED ? '' : '<p><b>Privacy.</b> Board sends first-party aggregate counters for editor opens, exports, pricing, checkout starts, and free backup. These counters contain no IP address, account ID, visitor ID, URL, referrer, cookies, or arbitrary text and are kept for 14 months. We use no advertising, third-party analytics, or cross-site tracking cookies.</p>'}
        <p><b>Data sources.</b> Team search and kit colors use TheSportsDB public API. Squad names, shirt numbers and positions are read from current squad sections on Wikipedia through the Wikipedia API. Third-party data may be incomplete, delayed or inaccurate; verify it before publishing.</p>
        <p><b>Copyright.</b> Except for identified third-party materials, the software and bundled assets are available under the MIT license. Club names, player names, colors and other source data remain the property of their respective owners and data providers. Tactics Journal and Tactics Board names and logos are reserved trademarks.</p>
        <p><b>Interface icons.</b> The icons in Settings and the menus are <a href="https://tabler.io/icons" target="_blank" rel="noopener">Tabler Icons</a>, copyright Paweł Kuna, used under the MIT license. The full license text is served at <a href="/LICENSE-icons" target="_blank" rel="noopener">/LICENSE-icons</a>.</p>
        ${BOARD_SELF_HOSTED ? '<p><b>Self-hosting.</b> This installation is operated by its owner, not Tactics Journal. See the repository license and trademark policy for the terms that apply.</p>' : '<p><b>Hosted service.</b> You may use exported board images for editorial, educational, social, internal and commercial work. Where an export uses Tactics Journal pitch artwork, the Tactics Journal watermark must remain visible. An export built on your own uploaded background or imported screenshot carries no Tactics Journal branding and no such condition. Use of the official hosted service is subject to the <a href="https://tacticsjournal.com/terms/" target="_blank" rel="noopener">Terms of Service</a>, <a href="https://tacticsjournal.com/privacy/" target="_blank" rel="noopener">Privacy Policy</a> and <a href="https://tacticsjournal.com/cookies/" target="_blank" rel="noopener">Cookie Policy</a>.</p>'}
      </div>
    </div>
    <div class="setPane hidden" data-pane="self-host">
      <div class="selfHostSection">
        <h3 class="skillsHeading">Run Board yourself</h3>
        <p class="skillsIntro">Board is open source. Except for identified third-party materials, the software and bundled non-trademark assets are MIT licensed, so you can build the board and serve it from your own machine or domain.</p>
      </div>

      <div class="setGroupHead">Build it</div>
      <div class="setGroup">
        <div class="setItem setItemStatic selfHostCode">
          <code class="setCode setCodeBlock" data-self-host-command>${SELF_HOST_COMMANDS}</code>
          <button class="setItemAction setCopy" data-self-host-copy aria-label="Copy the self-host commands">${icon('copy')}Copy</button>
        </div>
      </div>
      <p class="setNote">Then serve the <code>dist</code> folder on localhost or your own HTTPS domain. To work on the board with Vite instead, run <code>BOARD_SELF_HOSTED=true npm run dev</code>.</p>
      ${BOARD_SELF_HOSTED ? '<p class="setNote setNoteStrong">This installation is already a self-host build.</p>' : ''}

      <div class="setGroupHead">What self-hosting changes</div>
      <div class="setGroup">
        <div class="setItem setItemStatic selfHostFact">
          ${icon('check')}
          <span class="setItemLabel">Local editing and export features are free on hosted and self-hosted Board.</span>
        </div>
        <div class="setItem setItemStatic selfHostFact">
          ${icon('puzzle')}
          <span class="setItemLabel">Extensions you place in <code>public/extensions</code> run in your build. The official hosted board does not run third-party extensions.</span>
        </div>
        <div class="setItem setItemStatic selfHostFact">
          ${icon('lock')}
          <span class="setItemLabel">Cloud sync, collaboration and agent links need Tactics Journal-operated services, so a self-host build does not provide them.</span>
        </div>
        <div class="setItem setItemStatic selfHostFact">
          ${icon('copyright')}
          <span class="setItemLabel">The installation is operated by whoever runs it, not by Tactics Journal. The Tactics Journal and Tactics Board names and logos stay reserved.</span>
        </div>
      </div>

      <div class="setGroupHead">Project</div>
      <div class="setGroup">
        <a class="setItem selfHostLink" href="${SELF_HOST_REPO}" target="_blank" rel="noopener">
          <span class="setItemLabel">Source code and README</span>${icon('external-link')}
        </a>
        <a class="setItem selfHostLink" href="${SELF_HOST_REPO}/blob/main/LICENSE" target="_blank" rel="noopener">
          <span class="setItemLabel">MIT license</span>${icon('external-link')}
        </a>
        <a class="setItem selfHostLink" href="${SELF_HOST_REPO}/blob/main/TRADEMARKS.md" target="_blank" rel="noopener">
          <span class="setItemLabel">Trademark policy</span>${icon('external-link')}
        </a>
      </div>

      <div class="setGroup selfHostBack">
        <button class="setItem" data-goto="root">
          ${icon('chevron-left', 'ic setChev')}
          <span class="setItemLabel">Back to Settings</span>
        </button>
      </div>
    </div>
    <div class="setPane hidden" data-pane="pro">
      <div class="proHero">
        <h2 class="proTagline">Think it. Draw it. Share it.</h2>
        <p class="proLede">Every local editing and export feature is free. Pro adds automatic cloud sync, collaboration, sharing controls, and agent access.</p>
        <div class="proHeroCta" data-lic-area></div>
      </div>
      <h3 class="proChoose">Choose how you work</h3>
      <div class="proTiers">
        <div class="proCard">
          <div class="proCardHead"><span class="proCardName">Free</span><span class="proCardPrice">Always</span></div>
          <ul>
            <li>Use every drawing tool and pitch style</li>
            <li>Keep unlimited local projects and saved boards</li>
            <li>Import screenshots, backgrounds, and custom assets</li>
            <li>Export PNG, GIF, and video</li>
            <li>Back up one project to a free account</li>
            <li>Move every project with one file</li>
          </ul>
        </div>
        <div class="proCard proCardAccent">
          <div class="proCardHead proCardHeadRow">
            <span class="proCardName">Pro</span>
            <div class="proBilling" role="group" aria-label="Billing period">
              <button type="button" data-period="yearly" aria-pressed="true">Yearly</button>
              <button type="button" data-period="monthly" aria-pressed="false">Monthly</button>
            </div>
          </div>
          <p class="proCardAmount"><span data-pro-amount>$12.42</span><span class="proCardPer">/month</span></p>
          <p class="proCardBilled"><span data-pro-billed>Billed yearly at $149</span><span class="proSavePill" data-pro-save>Save $30.88 versus monthly</span></p>
          <ul>
            <li>Back up and sync every project across devices</li>
            <li>See edits appear in real time for people you invite</li>
            <li>Control hosted project sharing and invitations</li>
            <li>Give ChatGPT, Claude, or another AI agent 24-hour access by link</li>
            <li>Use MCP and WebMCP account access</li>
          </ul>
          <div data-pro-card-cta></div>
          <p class="proCardNote">Existing Hosted Board License holders keep their access and can upgrade to Pro.</p>
          <p class="proCardNote">Full refund within 14 days of your first payment or of an automatic yearly renewal.</p>
        </div>

      </div>
    </div>
    <div class="setPane hidden" data-pane="agents"></div>
    <div class="setPane hidden" data-pane="skills">
      <div class="skillsSection">
        <h3 class="skillsHeading">Skills</h3>
        <p class="skillsIntro">Instructions your agent follows when creating or editing this project.</p>
        <div class="setGroup" data-skills-list></div>
        <button class="skillsButton" type="button" data-skills-action="create">Create a skill</button>
        <p class="setNote">For example, a skill can tell an agent to always use dashed arrows for defensive runs.</p>
      </div>
      <div class="skillsSection">
        <h3 class="skillsHeading">Official extensions</h3>
        <p class="skillsIntro">Bundled with Board and available on hosted and self-hosted builds. These controls stay on this device.</p>
        <div class="setGroup" data-official-list></div>
      </div>
      ${BOARD_SELF_HOSTED ? `<div class="skillsSection">
        <h3 class="skillsHeading">Self-hosted extensions</h3>
        <p class="skillsIntro">Your own extensions run in a sandbox and stay on this device and project.</p>
        <div class="setGroup" data-extensions-list></div>
        <div class="setGroup" data-extension-paths-list></div>
      </div>` : `<div class="skillsSection skillsSectionUnavailable" aria-disabled="true">
        <h3 class="skillsHeading">Self-hosted extensions</h3>
        <p class="skillsIntro">Your own sandboxed extensions are available only when you self-host Board.</p>
        <div class="setGroup">
          <div class="setItem setItemStatic">
            ${icon('puzzle')}
            <span class="setItemLabel">Self-hosted extensions</span>
            <span class="setItemValue">Self-hosted only</span>
          </div>
        </div>
      </div>`}
    </div>
    <div class="setPane hidden" data-pane="skill"></div>
    <div class="setPane hidden" data-pane="official"></div>
    ${BOARD_SELF_HOSTED ? '<div class="setPane hidden" data-pane="extension"></div>' : ''}
    <div class="setPane hidden" data-pane="feedback">
      <div class="feedbackIntro">
        <h3>Tell me what happened</h3>
        <p>Describe the problem and what you expected to happen.</p>
      </div>
      <form class="feedbackForm" data-feedback-form novalidate>
        <div class="feedbackField">
          <label class="feedbackLabel" for="fb-name">Name</label>
          <input class="feedbackInput" id="fb-name" type="text" name="name" data-feedback-name autocomplete="name" maxlength="120" required placeholder="Your name">
        </div>
        <div class="feedbackField">
          <label class="feedbackLabel" for="fb-email">Email</label>
          <input class="feedbackInput" id="fb-email" type="email" name="email" data-feedback-email autocomplete="email" inputmode="email" maxlength="254" required placeholder="you@example.com">
        </div>
        <div class="feedbackField">
          <label class="feedbackLabel" for="fb-issue">What's the issue?</label>
          <textarea class="feedbackInput feedbackTextarea" id="fb-issue" name="issue" data-feedback-issue maxlength="4000" rows="6" required placeholder="What happened? What did you expect?"></textarea>
        </div>
        <div class="feedbackRow">
          <div class="feedbackField">
            <label class="feedbackLabel" for="fb-device">Device</label>
            <input class="feedbackInput" id="fb-device" type="text" name="device" maxlength="120" required placeholder="For example, iPhone 15 or MacBook Pro">
          </div>
          <div class="feedbackField">
            <label class="feedbackLabel" for="fb-browser">Browser</label>
            <input class="feedbackInput" id="fb-browser" type="text" name="browser" maxlength="120" required placeholder="For example, Safari 18 or Chrome 131">
          </div>
        </div>
        <input class="feedbackHoneypot" type="text" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">
        <button class="feedbackSubmit" type="submit">Send feedback</button>
        <p class="feedbackStatus" data-feedback-status role="status" aria-live="polite"></p>
      </form>
    </div>
    <div class="setPane hidden" data-pane="teams"></div>
    <div class="setPane hidden" data-pane="pitch">
      <div class="setGroupHead">Pitch styles</div>
      <div class="pitchGrid" data-pitch-seg></div>
      <div class="setStatusRow" data-pitch-status hidden>
        <span class="setStatusText" role="status" aria-live="polite" data-pitch-status-text></span>
        <button class="setStatusUndo" data-set="pitch-undo" aria-label="Undo the pitch change" hidden>Undo</button>
      </div>
      <p class="setNote">Every pitch style, screenshot import, cone, goal, and custom background is free.</p>
      <div class="setGroupHead">Your backgrounds<span class="setGroupCount" data-bg-usage></span></div>
      <div class="pitchGrid" data-bg-grid></div>
      <p class="setNote" data-bg-note></p>
      <label class="bgAddInput" hidden>
        <input data-set-file type="file" accept="image/*">
      </label>
    </div>
    <div class="setPane hidden" data-pane="assets">
      <div class="setGroup" data-assets-list></div>
      <p class="setNote" data-assets-note></p>
    </div>
    <div class="setPane hidden" data-pane="boards">
      <div class="setGroup">
        <button class="setItem" data-set="boards-export">
          ${icon('upload')}
          <span class="setItemLabel">Export all boards</span>
        </button>
        <label class="setItem setUpload">
          ${icon('download')}
          <span class="setItemLabel">Import from a file</span>
          <input data-boards-file type="file" accept="application/json,.json">
        </label>
      </div>
      <p class="setNote">Export the file here, then import it from this screen on the other device.</p>
      <div class="setGroupHead">Boards on this device</div>
      <div data-saves-host></div>
    </div>
    <div class="impStatus" data-set-note role="status" aria-live="polite"></div>
  </div>`
document.body.appendChild(settingsEl)
// Theme and the Pro billing period are segmented controls: give them the pill.
mountSlidingPills(settingsEl)

// the Teams and Saves panels render inside their own screens
settingsEl.querySelector('[data-pane="teams"]')!.appendChild(teams.el)
settingsEl.querySelector('[data-saves-host]')!.appendChild(saves.el)

/** Settings is one list plus push screens; every screen but root has a back arrow. */
type SetScreen = 'root' | 'teams' | 'pitch' | 'boards' | 'pro' | 'agents' | 'skills' | 'skill' | 'official' | 'extension' | 'howto' | 'about' | 'feedback' | 'assets' | 'self-host'

const SCREEN_TITLES: Record<SetScreen, string> = {
  root: 'Settings',
  teams: 'Teams',
  pitch: 'Pitch',
  boards: 'Move to another device',
  assets: 'My assets',
  pro: 'Plans',
  agents: 'Claude and ChatGPT',
  skills: 'Skills',
  skill: 'Skill',
  official: 'Official extension',
  extension: 'Extension',
  howto: 'How to use',
  about: 'Privacy and data',
  feedback: 'Feedback',
  'self-host': 'Self-host',
}

let screen: SetScreen = 'root'
let pitchUndoDepth: number | null = null
let editingSkillId: string | null = null
let editingSkillDraft: Skill | null = null
let openOfficialId: string | null = null
let editingExtensionId: string | null = null
let pendingExtensionPath: string | null = null
let pendingExtensionManifest: ExtensionManifest | null = null
function projectSkills(): ProjectSkillsState { return loadProjectSkillsState(currentProject(library).id) }
function saveSkills(next: ProjectSkillsState, sync = true): void {
  saveProjectSkillsState(currentProject(library).id, next)
  if (sync && !BOARD_SELF_HOSTED) void syncCurrentSkills().catch(() => { setNote('Skills stay on this device until the project can sync.') })
}
function disposeExtensionRuntime(): void { extensionRuntime?.dispose(); extensionRuntime = null }

function renderSkillsScreen(): void {
  const state = projectSkills()
  const skills = settingsEl.querySelector<HTMLElement>('[data-skills-list]')!
  skills.innerHTML = state.skills.length ? state.skills.map(skill => `<button class="setItem" data-skills-open="${esc(skill.id)}"><span class="setItemLabel">${esc(skill.name)}</span><span class="setItemValue">${skill.enabled ? 'On' : 'Off'}</span>${icon('chevron-right', 'ic setChev')}</button>`).join('') : '<div class="skillsEmpty">No skills yet.</div>'
  renderOfficialList()
  if (BOARD_SELF_HOSTED) {
    const extensions = settingsEl.querySelector<HTMLElement>('[data-extensions-list]')!
    const paths = settingsEl.querySelector<HTMLElement>('[data-extension-paths-list]')!
    extensions.innerHTML = state.extensions.length ? state.extensions.map(extension => `<button class="setItem" data-extension-open="${esc(extension.id)}"><span class="setItemLabel">${esc(extension.name)}</span><span class="setItemValue">${extension.enabled ? 'On' : 'Off'}</span>${icon('chevron-right', 'ic setChev')}</button>`).join('') : '<div class="skillsEmpty">No extensions installed.</div>'
    const installed = new Set(state.extensions.map(extension => extension.path))
    const available = BOARD_EXTENSION_PATHS.filter(path => !installed.has(path))
    paths.innerHTML = available.length ? `<p class="skillsIntro">Available on this deployment</p>${available.map(path => `<button class="setItem" data-extension-path="${esc(path)}"><span class="setItemLabel">${esc(path)}</span>${icon('chevron-right', 'ic setChev')}</button>`).join('')}` : '<div class="skillsEmpty">No extension directories in this build.</div>'
  }
  void pullCurrentSkills().then(changed => { if (changed && screen === 'skills') renderSkillsScreen() })
}

function renderOfficialList(): void {
  const host = settingsEl.querySelector<HTMLElement>('[data-official-list]')
  if (!host) return
  host.innerHTML = officialExtensions.list().map(extension =>
    `<button class="setItem" data-official-open="${esc(extension.id)}"><span class="setItemLabel">${esc(extension.name)}</span><span class="setItemValue">${officialExtensions.isEnabled(extension.id) ? 'On' : 'Off'}</span>${icon('chevron-right', 'ic setChev')}</button>`,
  ).join('')
}

function renderOfficialDetail(): void {
  const extension = openOfficialId ? officialExtensions.info(openOfficialId) : null
  if (!extension) { showScreen('skills'); return }
  const enabled = officialExtensions.isEnabled(extension.id)
  const pane = settingsEl.querySelector<HTMLElement>('[data-pane="official"]')!
  pane.innerHTML = `<div class="extensionDetail">
    <p class="officialName"><strong>${esc(extension.name)}</strong> <span class="officialVersion">${esc(extension.version)}</span></p>
    <p class="setNote officialBy">Official extension · by ${esc(extension.author)}</p>
    <p>${esc(extension.description)}</p>
    <label class="skillsToggle">Use on this device<input type="checkbox" data-official-enabled ${enabled ? 'checked' : ''}></label>
    <p class="setNote">${enabled ? 'Its control is on the board now. Turning it off removes it and returns the board to 2D.' : 'Turn it on to add its control to the board.'}</p>
  </div>`
}

function openOfficialDetail(id: string): void {
  if (!officialExtensions.info(id)) return
  openOfficialId = id
  renderOfficialDetail()
  showScreen('official')
}

function renderSkillDetail(): void {
  const skill = editingSkillDraft?.id === editingSkillId
    ? editingSkillDraft
    : projectSkills().skills.find(item => item.id === editingSkillId)
  if (!skill) { showScreen('skills'); return }
  const pane = settingsEl.querySelector<HTMLElement>('[data-pane="skill"]')!
  pane.innerHTML = `<form class="skillsForm" data-skill-form>
    <label>Name<input class="skillsInput" data-skill-name maxlength="80" value="${esc(skill.name)}" required></label>
    <label>Instructions<textarea class="skillsInput skillsTextarea" data-skill-instructions maxlength="20000" rows="10" required>${esc(skill.instructions)}</textarea></label>
    <div class="skillsSubheading">This project</div>
    <div class="skillsToggle"><span>Use this skill</span><span class="setSeg" role="group" aria-label="Use this skill"><button type="button" data-skill-toggle="off" class="${skill.enabled ? '' : 'active'}">Off</button><button type="button" data-skill-toggle="on" class="${skill.enabled ? 'active' : ''}">On</button></span><input type="checkbox" data-skill-enabled ${skill.enabled ? 'checked' : ''} hidden></div>
    <button class="skillsButton" type="submit">Save skill</button>
    <button class="skillsDelete" type="button" data-skills-action="delete-skill">Delete skill</button>
  </form>`
  mountSlidingPills(pane)
}

function extensionFrameHost(): HTMLElement | null { return settingsEl.querySelector<HTMLElement>('[data-extension-frame]') }
function permissionText(permissions: readonly ('board:read' | 'board:write')[]): string {
  if (!permissions.length) return 'No board access.'
  return permissions.map(permission => permission === 'board:read'
    ? 'Read this project and board.'
    : 'Add objects to this board.').join(' ')
}
function extensionIdentity(path: string): string {
  try { return `${location.origin}${path}` } catch { return path }
}
function renderExtensionManifest(message = ''): void {
  const host = settingsEl.querySelector<HTMLElement>('[data-extension-manifest]')
  if (!host) return
  const manifest = pendingExtensionManifest
  const installed = !!editingExtensionId
  const path = projectSkills().extensions.find(item => item.id === editingExtensionId)?.path || pendingExtensionPath || ''
  host.innerHTML = manifest ? `<p><strong>${esc(manifest.name)}</strong> ${esc(manifest.version)}</p><p>${esc(manifest.description)}</p><p class="setNote">${esc(permissionText(manifest.permissions))}</p><p class="setNote">Loaded from ${esc(extensionIdentity(path))}</p>${installed ? `<p class="setNote">${esc(message || 'Extension connected.')}</p>` : '<button class="skillsButton" type="button" data-skills-action="install-extension">Install extension</button>'}` : message ? `<p class="setNote">${esc(message)}</p>` : '<p class="setNote">Loading extension…</p>'
}
function renderExtensionDetail(): void {
  if (!BOARD_SELF_HOSTED) { showScreen('skills'); return }
  const installed = projectSkills().extensions.find(item => item.id === editingExtensionId)
  const pane = settingsEl.querySelector<HTMLElement>('[data-pane="extension"]')!
  const path = installed?.path || pendingExtensionPath
  if (!path) { showScreen('skills'); return }
  const name = installed?.name || pendingExtensionManifest?.name || path
  pane.innerHTML = `<div class="extensionDetail"><div data-extension-manifest></div><div class="extensionFrame" data-extension-frame aria-label="${esc(name)} extension"></div>${installed ? `<label class="skillsToggle">On for this project<input type="checkbox" data-extension-enabled ${installed.enabled ? 'checked' : ''}></label><button class="skillsDelete" type="button" data-skills-action="remove-extension">Remove extension</button>` : ''}</div>`
  if (installed) {
    pendingExtensionManifest = { name: installed.name, description: installed.description, version: installed.version, permissions: installed.permissions }
    renderExtensionManifest(installed.enabled ? 'Connecting extension…' : 'This extension is off for this project.')
    if (installed.enabled) launchExtension(installed.path, installed.permissions, pendingExtensionManifest)
  } else {
    renderExtensionManifest()
    launchExtension(path, [])
  }
}
function launchExtension(path: string, permissions: readonly ('board:read' | 'board:write')[], approvedManifest?: ExtensionManifest): void {
  if (!BOARD_SELF_HOSTED) return
  disposeExtensionRuntime()
  const host = extensionFrameHost()
  if (!host) return
  extensionRuntime = new ExtensionRuntime({
    url: path, allowedPaths: BOARD_EXTENSION_PATHS, permissions, approvedManifest,
    project: () => currentProject(library), board: () => store.scene,
    addObjects: (objects) => store.apply(scene => { objects.forEach(object => insertByTier(scene.objects, object)) }),
    manifest: (manifest) => { pendingExtensionManifest = manifest; renderExtensionManifest('Extension connected.') },
    error: (message) => setNote(message),
  })
  extensionRuntime.start(host)
}
function openExtensionDetail(extensionId: string | null = null, path: string | null = null): void {
  if (!BOARD_SELF_HOSTED) return
  disposeExtensionRuntime()
  editingExtensionId = extensionId
  pendingExtensionPath = path
  pendingExtensionManifest = null
  renderExtensionDetail()
  showScreen('extension')
}

function remoteSkillsResponse(value: unknown): value is { skills: unknown[]; revision: string | null } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const response = value as { skills?: unknown; revision?: unknown }
  return Array.isArray(response.skills)
    && (response.revision === null || typeof response.revision === 'string')
}

async function pullCurrentSkills(): Promise<boolean> {
  if (BOARD_SELF_HOSTED) return false
  const boardId = saves.currentBoardId()
  const local = projectSkills()
  if (!boardId || local.dirty || saves.isCurrentShared() || !await ensureBoardSession(accountBinding)) return false
  const response = await fetch(`${boardSkillsUrl()}?board_id=${encodeURIComponent(boardId)}`, { credentials: 'include' })
  if (!response.ok) return false
  const remote: unknown = await response.json()
  if (!remoteSkillsResponse(remote)) return false
  const next = mergeSyncedSkills(local, remote.skills, remote.revision)
  if (!next || JSON.stringify(next) === JSON.stringify(local)) return false
  saveProjectSkillsState(currentProject(library).id, next)
  return true
}

async function syncProjectSkills(projectId: string, boardId: string): Promise<boolean> {
  const row = saves.projectDocuments().find(item => item.rowId === boardId && item.project.id === projectId)
  if (!row || row.access === 'shared') return false
  const local = loadProjectSkillsState(projectId)
  if (!local.dirty) return true
  if (!await ensureBoardSession(accountBinding)) return false
  let revision = local.revision
  if (revision === null) {
    const current = await fetch(`${boardSkillsUrl()}?board_id=${encodeURIComponent(boardId)}`, { credentials: 'include' })
    if (!current.ok) return false
    const remote: unknown = await current.json()
    if (!remoteSkillsResponse(remote)) return false
    if (remote.revision !== null
      && !window.confirm('Skills already exist for this project on another device. Replace them with the skills on this device?')) return false
    revision = remote.revision
  }
  const put = async (freshRevision: string | null) => fetch(boardSkillsUrl(), {
    method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ board_id: boardId, revision: freshRevision, skills: skillsForSync(local) }),
  })
  let response = await put(revision)
  if (response.status === 409) {
    const latest = await fetch(`${boardSkillsUrl()}?board_id=${encodeURIComponent(boardId)}`, { credentials: 'include' })
    if (!latest.ok) return false
    const fresh: unknown = await latest.json()
    if (!remoteSkillsResponse(fresh)) return false
    if (!window.confirm('Skills changed on another device. Replace them with the skills on this device?')) return false
    response = await put(fresh.revision)
  }
  if (!response.ok) return false
  const saved: unknown = await response.json()
  if (!remoteSkillsResponse(saved) || typeof saved.revision !== 'string') return false
  const next = mergeSyncedSkills(local, saved.skills, saved.revision)
  if (!next) return false
  saveProjectSkillsState(projectId, next)
  return true
}
async function syncCurrentSkills(): Promise<boolean> {
  const boardId = saves.currentBoardId()
  return boardId ? syncProjectSkills(currentProject(library).id, boardId) : false
}
async function flushSkillsForAgentLink(boardId: string): Promise<void> {
  const row = saves.projectDocuments().find(item => item.rowId === boardId)
  if (!row) throw new Error('Save this project before creating an agent link so its skills can sync.')
  if (!loadProjectSkillsState(row.project.id).dirty) return
  if (!await syncProjectSkills(row.project.id, boardId)) throw new Error('Could not sync this project\'s skills. Your skills remain on this device.')
}

function showScreen(next: SetScreen) {
  const prev = screen
  screen = next
  if (next === 'pro' && prev !== 'pro') void recordProductEvent('pricing_opened')
  clearPitchStatus()
  const titleEl = settingsEl.querySelector('[data-set-title]') as HTMLElement
  const incoming = settingsEl.querySelector<HTMLElement>(`[data-pane="${next}"]`)
  /* Travel only when the sheet is already open and the screen actually changes.
     Opening the sheet is its own animation and should not carry a second one
     underneath it. */
  const travel = prev !== next && incoming !== null && !settingsEl.classList.contains('hidden')

  settingsEl.querySelectorAll<HTMLElement>('[data-pane]').forEach(p => p.classList.toggle('hidden', p.dataset.pane !== next))

  if (travel) {
    /* 'root' sits above every other screen, so leaving it travels forward and
       returning to it travels back. */
    const from = next === 'root' ? 'setEnterPop' : 'setEnterPush'
    incoming!.classList.add(from)
    void incoming!.offsetWidth // commit the start position before releasing it
    incoming!.classList.remove(from)
    titleEl.classList.add('setTitleSwap')
    window.setTimeout(() => {
      /* a faster tap may have moved on already; that navigation owns the title */
      if (screen !== next) return
      titleEl.textContent = SCREEN_TITLES[next]
      titleEl.classList.remove('setTitleSwap')
    }, 100)
  } else {
    /* also clears a swap left mid-flight by closing the sheet during one */
    titleEl.classList.remove('setTitleSwap')
    titleEl.textContent = SCREEN_TITLES[next]
  }

  ;(settingsEl.querySelector('.setBack') as HTMLElement).hidden = next === 'root'
  settingsEl.querySelector<HTMLElement>('.setSheet')!.scrollTop = 0
  if (next === 'boards') saves.refresh()
  if (next === 'pitch') { renderPitchSeg(); syncLockTags() }
  if (next === 'root') {
    renderRootValues()
    startProjectsSummaryTimer()
  } else {
    stopProjectsSummaryTimer()
  }
  if (next === 'agents') renderAgentSettings()
  if (next === 'skills') renderSkillsScreen()
  if (next === 'official') renderOfficialDetail()
  if (next === 'skill') renderSkillDetail()
  if (next === 'feedback') prefillFeedback()
}

let projectsSummaryTimer: number | null = null

function projectCountLabels() {
  const count = String(library.projects.length)
  return { full: count, compact: count }
}

function stopProjectsSummaryTimer() {
  if (projectsSummaryTimer === null) return
  window.clearInterval(projectsSummaryTimer)
  projectsSummaryTimer = null
}

function renderProjectsLastUpdated() {
  const full = settingsEl.querySelector<HTMLElement>('[data-projects-updated-full]')!
  const compact = settingsEl.querySelector<HTMLElement>('[data-projects-updated-compact]')!
  const row = settingsEl.querySelector<HTMLElement>('[data-projects-row]')!
  const latestUpdated = orderedProjects(library)[0]?.updated
  const now = Date.now()
  const elapsed = latestUpdated === undefined ? null : formatElapsedSince(latestUpdated, now)
  const elapsedCompact = latestUpdated === undefined ? null : formatElapsedSince(latestUpdated, now, true)
  const count = projectCountLabels()

  full.hidden = !elapsed
  compact.hidden = !elapsedCompact
  if (!elapsed || !elapsedCompact || latestUpdated === undefined) {
    row.setAttribute('aria-label', `Saved projects, ${count.full}`)
    return
  }

  const fullTime = full.querySelector('time') as HTMLTimeElement
  const compactTime = compact.querySelector('time') as HTMLTimeElement
  const dateTime = new Date(latestUpdated).toISOString()
  fullTime.textContent = elapsed
  fullTime.dateTime = dateTime
  compactTime.textContent = elapsedCompact
  compactTime.dateTime = dateTime
  row.setAttribute('aria-label', `Saved projects, ${count.full}, last updated ${elapsed} ago`)
}

function renderProjectsSummary() {
  const count = projectCountLabels()
  ;(settingsEl.querySelector('[data-projects-count]') as HTMLElement).textContent = count.full
  ;(settingsEl.querySelector('[data-projects-count-compact]') as HTMLElement).textContent = count.compact
  renderProjectsLastUpdated()
}

function startProjectsSummaryTimer() {
  stopProjectsSummaryTimer()
  renderProjectsLastUpdated()
  if (screen !== 'root' || settingsEl.classList.contains('hidden') || document.visibilityState === 'hidden') return
  projectsSummaryTimer = window.setInterval(renderProjectsLastUpdated, 1000)
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') stopProjectsSummaryTimer()
  else if (screen === 'root' && !settingsEl.classList.contains('hidden')) startProjectsSummaryTimer()
})

/** Root rows carry the current answer, so the list reads without opening anything. */
function renderRootValues() {
  for (const side of ['home', 'away'] as const) {
    const team = teams.getTeamForSide(side)
    const nameEl = settingsEl.querySelector(`[data-side-name="${side}"]`) as HTMLElement
    const dotEl = settingsEl.querySelector(`[data-side-dot="${side}"]`) as HTMLElement
    nameEl.textContent = team?.name ?? 'Not set'
    dotEl.style.background = team?.color ?? 'transparent'
    dotEl.classList.toggle('setDotEmpty', !team)
  }
  ;(settingsEl.querySelector('[data-pitch-name]') as HTMLElement).textContent = pitchById(store.scene.pitch).label
  const bgCount = backgrounds.count()
  ;(settingsEl.querySelector('[data-bg-count]') as HTMLElement).textContent = bgCount ? ` · ${bgCount} saved` : ''
  const planName = settingsEl.querySelector<HTMLElement>('[data-plan-name]')
  if (planName) planName.textContent = entitlements.isPro() ? 'Pro' : entitlements.hasBoardLicense() ? 'License' : 'Free'
  const backupButton = settingsEl.querySelector<HTMLButtonElement>('[data-set="free-backup"]')
  const backupLabel = settingsEl.querySelector<HTMLElement>('[data-free-backup-label]')
  const backupValue = settingsEl.querySelector<HTMLElement>('[data-free-backup-value]')
  if (backupButton && backupLabel && backupValue) {
    const backupId = selectedFreeBackup(localStorage, accountBinding)
    const backedUp = saves.projectDocuments().find(row => row.rowId === backupId)
    backupButton.disabled = entitlements.isPro()
    backupLabel.textContent = entitlements.isPro() ? 'All projects sync with Pro' : 'Back up one project free'
    backupValue.textContent = entitlements.isPro() ? 'Active' : backedUp ? backedUp.name : authenticated ? 'Choose current' : 'Sign in'
  }
  renderAccountRow()
  renderProjectsSummary()
  syncLockTags()
  renderAssetList()
}

/** Update the remaining Pro-only service tags. */
function syncLockTags() {
  settingsEl.querySelectorAll<HTMLElement>('[data-lock-tag="agents"]').forEach(tag => { tag.hidden = entitlements.isPro() })
  renderAgentSettings()
}

const AGENT_MCP_URL = 'https://board.tacticsjournal.com/mcp'

function renderAgentSettings() {
  const pane = settingsEl.querySelector<HTMLElement>('[data-pane="agents"]')
  if (!pane) return
  if (!entitlements.isPro()) {
    pane.innerHTML = `
      <p class="setNote">Connecting Claude or ChatGPT comes with Pro. An agent can read and draw on the boards you choose.</p>
      <div class="setGroup">
        <button class="setItem" data-goto="pro">
          ${icon('license')}
          <span class="setItemLabel">See plans</span>
          ${icon('chevron-right', 'ic setChev')}
        </button>
      </div>`
    return
  }
  pane.innerHTML = `
    <div class="setGroupHead">Server</div>
    <div class="setGroup">
      <div class="setItem setItemStatic">
        <code class="setCode" data-agents-url>${AGENT_MCP_URL}</code>
        <button class="setItemAction setCopy" data-agents-copy aria-label="Copy the server URL">${icon('copy')}Copy</button>
      </div>
    </div>
    <p class="setNote">Use this same server URL for every board. It grants no board access on its own.</p>

    <div class="setGroupHead">Claude</div>
    <div class="setGroup">
      <div class="setItem setItemStatic"><span class="setStepNum">1</span><span class="setItemLabel">Open Customize, then Connectors.</span></div>
      <div class="setItem setItemStatic"><span class="setStepNum">2</span><span class="setItemLabel">Choose Add custom connector and paste the server URL.</span></div>
      <div class="setItem setItemStatic"><span class="setStepNum">3</span><span class="setItemLabel">Add it, then enable it in a conversation from +, then Connectors.</span></div>
      <a class="setItem setProviderAction" data-agent-provider="Claude" href="https://claude.ai/settings/connectors" target="_blank" rel="noopener" aria-label="Copy URL and open Claude. You finish setup there.">
        <span class="setItemLabel" data-provider-label>Copy URL and open Claude</span>${icon('external-link')}
      </a>
    </div>

    <div class="setGroupHead">ChatGPT</div>
    <div class="setGroup">
      <div class="setItem setItemStatic"><span class="setStepNum">1</span><span class="setItemLabel">Open Settings, then Security and login. Turn on Developer mode.</span></div>
      <div class="setItem setItemStatic"><span class="setStepNum">2</span><span class="setItemLabel">Open ChatGPT Plugins, choose +, and create an app with the server URL.</span></div>
      <div class="setItem setItemStatic"><span class="setStepNum">3</span><span class="setItemLabel">In a conversation, choose +, then Developer mode, and select the app.</span></div>
      <a class="setItem setProviderAction" data-agent-provider="ChatGPT" href="https://chatgpt.com/plugins" target="_blank" rel="noopener" aria-label="Copy URL and open ChatGPT. You finish setup there.">
        <span class="setItemLabel" data-provider-label>Copy URL and open ChatGPT</span>${icon('external-link')}
      </a>
    </div>
    <p class="setNote">Menus may move. See <a href="https://support.anthropic.com/en/articles/11175166-getting-started-with-custom-connectors-using-remote-mcp" target="_blank" rel="noopener">Claude help</a> and <a href="https://platform.openai.com/docs/guides/developer-mode" target="_blank" rel="noopener">ChatGPT help</a>.</p>

    <div class="setGroupHead">Create a new project</div>
    <p class="setNote setNoteStrong">Ask Claude or ChatGPT to make the session. It returns an Add to Projects link. Open that link to review and save the project; no agent link is needed.</p>

    <div class="setGroupHead">Edit an existing project</div>
    <p class="setNote">Open the project, choose Share, then Invite an agent, and paste that link into the conversation. The link lasts 24 hours and covers only that project.</p>`
}

async function copyAgentMcpText(): Promise<boolean> {
  const code = settingsEl.querySelector<HTMLElement>('[data-agents-url]')
  if (!code) return false
  try {
    if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable')
    await navigator.clipboard.writeText(AGENT_MCP_URL)
    return true
  } catch { /* fall through to selection-based copy */ }

  const selection = window.getSelection()
  if (!selection) return false
  const range = document.createRange()
  range.selectNodeContents(code)
  selection.removeAllRanges()
  selection.addRange(range)
  try { return document.execCommand('copy') } catch { return false }
}

async function copyAgentMcpUrl(button: HTMLButtonElement) {
  if (!await copyAgentMcpText()) {
    setNote('The server URL is selected. Copy it with your keyboard.')
    return
  }
  button.innerHTML = `${icon('check')}Copied`
  setNote('Server URL copied.')
  window.setTimeout(() => {
    if (button.isConnected) button.innerHTML = `${icon('copy')}Copy`
  }, 2000)
}

/** The build steps are several lines, so a selection fallback still hands over all of them. */
async function copySelfHostCommands(button: HTMLButtonElement) {
  const code = settingsEl.querySelector<HTMLElement>('[data-self-host-command]')
  if (!code) return
  let copied = false
  try {
    if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable')
    await navigator.clipboard.writeText(SELF_HOST_COMMANDS)
    copied = true
  } catch {
    const selection = window.getSelection()
    if (selection) {
      const range = document.createRange()
      range.selectNodeContents(code)
      selection.removeAllRanges()
      selection.addRange(range)
      try { copied = document.execCommand('copy') } catch { copied = false }
    }
  }
  if (!copied) {
    setNote('The commands are selected. Copy them with your keyboard.')
    return
  }
  button.innerHTML = `${icon('check')}Copied`
  setNote('Self-host commands copied.')
  window.setTimeout(() => {
    if (button.isConnected) button.innerHTML = `${icon('copy')}Copy`
  }, 2000)
}

async function copyAgentMcpForProvider(link: HTMLAnchorElement) {
  const provider = link.dataset.agentProvider === 'ChatGPT' ? 'ChatGPT' : 'Claude'
  const label = link.querySelector<HTMLElement>('[data-provider-label]')
  const original = `Copy URL and open ${provider}`
  if (!await copyAgentMcpText()) {
    setNote(`Opening ${provider}. Copy the server URL from this screen and paste it there.`)
    return
  }
  if (label) label.innerHTML = `${icon('check')}Copied`
  setNote(`Server URL copied. Opening ${provider}.`)
  window.setTimeout(() => {
    if (label?.isConnected) label.textContent = original
  }, 2000)
}

/* ---------- Settings: every asset at once ---------- */

const KB = (bytes: number) => `${Math.max(1, Math.round(bytes / 1024))} KB`

/**
 * The whole shelf in one list. It is the only place with room to say what the
 * assets cost, which matters while the bytes live on the device.
 */
function renderAssetList() {
  const host = settingsEl.querySelector<HTMLElement>('[data-assets-list]')
  const note = settingsEl.querySelector<HTMLElement>('[data-assets-note]')
  const count = settingsEl.querySelector<HTMLElement>('[data-assets-count]')
  if (!host || !note || !count) return
  const all = listAssets()
  count.textContent = all.length + listStamps().length ? String(all.length + listStamps().length) : ''
  const label: Record<AssetCategory, string> = { players: 'Players', arrows: 'Arrows', zones: 'Zones', equipment: 'Equipment' }
  const saved = listStamps()
  host.innerHTML = all.map(a => `
    <div class="setItem setItemStatic assetRow">
      <span class="assetThumb"><img src="${a.src}" alt="" draggable="false"></span>
      <span class="setItemLabel">${esc(a.name)}</span>
      <span class="setItemValue">${label[a.cat]} &middot; ${KB(a.src.length)}</span>
      <button class="assetRowDel" data-asset-del="${a.id}" aria-label="Remove ${esc(a.name)}">${icon('trash')}</button>
    </div>`).join('') +
    saved.map(st => `
    <div class="setItem setItemStatic assetRow">
      <span class="assetThumb">${stampArt(st)}</span>
      <span class="setItemLabel">${esc(st.name)}</span>
      <span class="setItemValue">${esc(catLabel(st.cat))} &middot; ${st.objects.length} shapes</span>
      <button class="assetRowDel" data-stamp-del="${st.id}" aria-label="Remove ${esc(st.name)}">${icon('trash')}</button>
    </div>`).join('') +
    `<button class="setItem" data-asset-add>${icon('file-plus')}<span class="setItemLabel">Add an asset</span></button>`
  note.textContent = all.length || saved.length
    ? `${KB(usedBytes())} of ${Math.round(ASSET_BUDGET_BYTES / 1024 / 1024)} MB used. Assets stay on this device, and a board only stores which asset it uses.`
    : 'Nothing here yet. Add one from the plus at the end of any row in the Shapes shelf, or here. Select several shapes on the board and the link button saves them as one.'
}

settingsEl.addEventListener('click', (e) => {
  const target = e.target as HTMLElement
  const delStamp = target.closest('[data-stamp-del]') as HTMLElement | null
  if (delStamp) {
    removeStamp(delStamp.dataset.stampDel!)
    renderAssetList()
    renderPanel()
    return
  }
  const del = target.closest('[data-asset-del]') as HTMLElement | null
  if (del) {
    removeAsset(del.dataset.assetDel!)
    board.rebuild()
    renderAssetList()
    renderPanel()
    return
  }
  if (target.closest('[data-asset-add]')) openAssetPicker(shelfCat as AssetCategory)
})

/**
 * The account row. Someone already signed in is shown who they are signed in
 * as, not invited to sign in again.
 */
let accountEmail: string | null = null
let accountName: string | null = null

function renderAccountRow() {
  const label = settingsEl.querySelector('[data-account-label]') as HTMLElement | null
  const value = settingsEl.querySelector('[data-account-email]') as HTMLElement | null
  if (!label || !value) return
  const signout = settingsEl.querySelector('[data-account-signout]') as HTMLElement | null
  if (signout) signout.hidden = !accountEmail
  if (accountEmail) {
    label.textContent = 'Tactics Journal account'
    value.textContent = accountEmail
    return
  }
  label.textContent = 'Sign in to Tactics Journal'
  value.textContent = ''
}

/* ----- feedback -----
 *
 * One plain form posted to tacticsjournal.com. Name and email are prefilled
 * from the signed-in session when there is one, and stay editable; a later
 * session event never overwrites something already typed. */
const FEEDBACK_ENDPOINT = `${TJ_ORIGIN}/api/feedback`
let feedbackSending = false

function feedbackForm() {
  return settingsEl.querySelector<HTMLFormElement>('[data-feedback-form]')
}

/** Fill blanks only, so a session arriving mid-typing cannot erase an edit. */
function prefillFeedback() {
  const form = feedbackForm()
  if (!form) return
  const name = form.querySelector<HTMLInputElement>('[data-feedback-name]')
  const email = form.querySelector<HTMLInputElement>('[data-feedback-email]')
  if (name && !name.value && accountName) name.value = accountName
  if (email && !email.value && accountEmail) email.value = accountEmail
}

function setFeedbackStatus(text: string, isError: boolean) {
  const status = settingsEl.querySelector<HTMLElement>('[data-feedback-status]')
  if (!status) return
  status.textContent = text
  status.classList.toggle('feedbackStatusError', isError)
  if (isError) {
    status.tabIndex = -1
    status.focus()
  } else {
    status.removeAttribute('tabindex')
  }
}

/** The sheet stays open after a send; only the form body becomes the receipt. */
function showFeedbackSent(form: HTMLFormElement) {
  form.textContent = ''
  const sent = document.createElement('div')
  sent.className = 'feedbackSent'
  const head = document.createElement('h3')
  head.textContent = 'Feedback sent'
  const text = document.createElement('p')
  text.textContent = "Thank you for the feedback! We'll send you an email soon if we have questions or make any changes."
  sent.appendChild(head)
  sent.appendChild(text)
  form.appendChild(sent)
}

settingsEl.addEventListener('submit', (e) => {
  const form = (e.target as HTMLElement).closest('[data-feedback-form]') as HTMLFormElement | null
  if (!form) return
  e.preventDefault()
  if (feedbackSending) return
  if (!form.reportValidity()) return
  const button = form.querySelector<HTMLButtonElement>('button[type="submit"]')
  const values = new FormData(form)
  const payload = {
    name: String(values.get('name') ?? ''),
    email: String(values.get('email') ?? ''),
    issue: String(values.get('issue') ?? ''),
    device: String(values.get('device') ?? ''),
    browser: String(values.get('browser') ?? ''),
    website: String(values.get('website') ?? ''),
    page_url: window.location.href,
  }
  feedbackSending = true
  if (button) { button.disabled = true; button.textContent = 'Sending...' }
  setFeedbackStatus('Sending...', false)
  fetch(FEEDBACK_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(payload),
  })
    .then(async (res) => {
      const data = await res.json().catch(() => null) as { error?: string; detail?: string } | null
      if (!res.ok) throw new Error((data && (data.error || data.detail)) || `Could not send feedback (${res.status}).`)
      showFeedbackSent(form)
    })
    .catch((err: unknown) => {
      const raw = err instanceof Error ? err.message : String(err)
      // a network failure reads as "Failed to fetch", which explains nothing
      const message = /failed to fetch/i.test(raw)
        ? 'Could not send feedback. Check your connection and try again.'
        : raw
      if (button) { button.disabled = false; button.textContent = 'Send feedback' }
      setFeedbackStatus(message, true)
    })
    .finally(() => { feedbackSending = false })
})

function openSettings(target: SetScreen = 'root') {
  renderPitchSeg()
  setNote('')
  renderRootValues()
  settingsEl.classList.remove('hidden')
  showScreen(target)
  if (target === 'root') startProjectsSummaryTimer()
}
function closeSettings() {
  stopProjectsSummaryTimer()
  disposeExtensionRuntime()
  settingsEl.classList.add('hidden')
}
function setNote(s: string) { (settingsEl.querySelector('[data-set-note]') as HTMLElement).textContent = s }

/* ---------- holding a place on a shared project ----------
   A project open on this device claims a place every half minute, and gives it
   back when the project is closed or the tab goes away. The claim is what the
   ten-editors-at-once limit is counted from; being refused one turns the board
   read-only here rather than disconnecting anything. */

const PRESENCE_HEARTBEAT_MS = 30_000
let presenceBoardId: string | null = null
let presenceTimer: number | null = null
let presenceCrowded = false

async function claimPresence(boardId: string): Promise<void> {
  try {
    const response = await fetch(boardPresenceUrl(), {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ board_id: boardId, action: 'claim' }),
    })
    if (presenceBoardId !== boardId) return
    const crowded = response.status === 409
    if (crowded && !presenceCrowded) {
      const data = await response.json().catch(() => null)
      showBanner(`
        <p>${esc(data?.error || 'This project already has too many people editing it. It is read-only until one of them closes it.')}</p>
        <span class="appBannerActions"><button data-banner="dismiss">Dismiss</button></span>`, 'warn')
    }
    presenceCrowded = crowded
  } catch {
    // A heartbeat that cannot be sent is not a refusal. The next one decides.
  }
}

function releasePresence(boardId: string): void {
  const body = JSON.stringify({ board_id: boardId, action: 'release' })
  // A tab being closed will not wait for fetch, so hand it to the browser to
  // send on its own; the place expires by itself if even that does not land.
  if (navigator.sendBeacon?.(boardPresenceUrl(), new Blob([body], { type: 'application/json' }))) return
  void fetch(boardPresenceUrl(), {
    method: 'POST', credentials: 'include', keepalive: true,
    headers: { 'Content-Type': 'application/json' }, body,
  }).catch(() => {})
}

/** Follow the open project: claim the new one, give back the old one. */
function updatePresence(): void {
  const board = saves.currentBoardId()
  const shared = board ? saves.isCurrentShared() : false
  const wanted = shared && (authenticated || entitlements.isPro()) ? board : null
  if (wanted === presenceBoardId) return
  if (presenceBoardId) releasePresence(presenceBoardId)
  presenceBoardId = wanted
  presenceCrowded = false
  if (presenceTimer !== null) { window.clearInterval(presenceTimer); presenceTimer = null }
  if (!wanted) return
  void claimPresence(wanted)
  presenceTimer = window.setInterval(() => {
    if (presenceBoardId) void claimPresence(presenceBoardId)
  }, PRESENCE_HEARTBEAT_MS)
}

window.addEventListener('pagehide', () => { if (presenceBoardId) releasePresence(presenceBoardId) })

/**
 * A link someone was sent. Reading it never spends it. The bearer can view a
 * read-only local copy, and the token is claimed only if they join the project.
 */
async function openInvitationFromLink(): Promise<void> {
  const params = new URLSearchParams(window.location.search)
  const token = params.get('invite')
  if (!token) return
  // Take it out of the address bar straight away: a reload must not look like
  // a second invitation, and the token has no business sitting in history.
  const clean = new URL(window.location.href)
  clean.searchParams.delete('invite')
  window.history.replaceState(null, '', clean.toString())

  let invitation: {
    board_id?: string
    board_name?: string
    owner_username?: string | null
    role?: string
    updated_at?: string
    document?: BoardDocument
  } | null = null
  try {
    const response = await fetch(`${boardInvitationUrl()}?token=${encodeURIComponent(token)}`, { credentials: 'include' })
    const data = await response.json()
    if (!response.ok) { showToast(data?.error || 'That invitation is no longer valid.'); return }
    invitation = data?.invitation || null
  } catch {
    showToast('That invitation could not be read.')
    return
  }

  if (!invitation?.board_id || !invitation.document) {
    showToast('That invitation could not be opened.')
    return
  }
  invitationPreviewTokens.set(invitation.board_id, token)
  if (!saves.openInvitationPreview({
    id: invitation.board_id,
    name: invitation.board_name || 'Shared project',
    document: invitation.document,
    ownerUsername: invitation.owner_username,
    updatedAt: invitation.updated_at,
  })) {
    invitationPreviewTokens.delete(invitation.board_id)
    showToast('That invitation could not be opened.')
    return
  }

  const invitedBoardId = invitation.board_id
  const project = invitation.board_name ? `"${esc(invitation.board_name)}"` : 'a project'
  const from = invitation.owner_username ? `@${esc(invitation.owner_username)}` : 'Someone'
  const reading = invitation.role === 'read'
  const accept = async () => {
    // Preview changes never belong to the shared project. Restore the exact
    // bearer copy before account sync decides whether the server or device is newer.
    saves.restoreInvitationPreview(invitedBoardId)
    if (!await ensureBoardSession()) {
      // Signing in happens at the account, and comes back here holding the
      // same invitation, so the reader never has to find the link again.
      const back = new URL(window.location.href)
      back.searchParams.set('invite', token)
      window.location.href = `${TJ_ORIGIN}/api/account/google/start?next=${encodeURIComponent(back.toString())}`
      return
    }
    try {
      const response = await fetch(boardInvitationUrl(), {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      })
      const data = await response.json()
      if (!response.ok) { showToast(data?.error || 'That invitation could not be accepted.'); return }
      showToast(`${data?.board_name || 'The project'} is now in your saved boards.`)
      await runSync()
      invitationPreviewTokens.delete(invitedBoardId)
      sharedBackgroundScope?.clear()
      sharedBackgroundScope = null
      sharedBackgroundRowId = null
      sharedBackgroundProjectId = null
      boardsView.clearBackgroundCache()
      selectProjectBackgroundResolver(currentProject(library))
      board.refreshBackground()
      saves.refresh()
    } catch {
      showToast('That invitation could not be accepted.')
    }
  }

  showBanner(`
    <p>${from} ${reading ? 'shared' : 'invited you to edit'} ${project}. It is open read-only now, without a login. ${reading
      ? 'Sign in only if you want to keep it in your boards and receive updates.'
      : 'Join the project to draw on it with everyone else.'}</p>
    <span class="appBannerActions">
      <button data-banner="accept-invite">${reading ? 'Keep in my boards' : 'Join and edit'}</button>
      <button data-banner="dismiss">Not now</button>
    </span>`)
  document.querySelector('[data-banner="accept-invite"]')?.addEventListener('click', () => { void accept() })
}

function openDeepLinkedPanel() {
  const params = new URLSearchParams(window.location.search)
  const target = (params.get('pro') || params.get('panel') || params.get('tab') || window.location.hash.slice(1)).toLowerCase()
  // 'waitlist' is kept as an alias so links printed before the licence went
  // on sale still land on the same panel.
  if (target === 'waitlist' || target === 'pro') openSettings('pro')
  else if (target === 'feedback') openSettings('feedback')
}

teams.onOpen = () => openSettings('teams')
teams.onClose = closeSettings
teams.onChangedSides = renderRootValues
saves.onOpen = () => { updatePresence(); openSettings('boards') }
saves.onClose = closeSettings

function setThemeResolved(dark: boolean, selected: 'system' | 'light' | 'dark') {
  // same attribute tacticsjournal.com uses, so the palettes stay in sync
  document.documentElement.setAttribute('data-theme-resolved', dark ? 'dark' : 'light')
  board.setDarkSurround(dark)
  for (const choice of ['system', 'light', 'dark'] as const) {
    const button = settingsEl.querySelector(`[data-set="theme-${choice}"]`)!
    button.classList.toggle('active', selected === choice)
    button.setAttribute('aria-pressed', String(selected === choice))
  }
  const menuSelect = document.querySelector<HTMLSelectElement>('#menu-theme-select')
  if (menuSelect) menuSelect.value = selected
  const accountSelect = document.querySelector<HTMLSelectElement>('#account-panel-theme-select')
  if (accountSelect) accountSelect.value = selected
}
function prefersDark() { return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches }
function applyThemeChoice(selected: 'system' | 'light' | 'dark') {
  try { localStorage.setItem(THEME_KEY, selected) } catch { /* private mode */ }
  setThemeResolved(selected === 'system' ? prefersDark() : selected === 'dark', selected)
}
function applyTheme(dark: boolean) { applyThemeChoice(dark ? 'dark' : 'light') }

for (const id of ['#menu-theme-select', '#account-panel-theme-select']) {
  document.querySelector<HTMLSelectElement>(id)?.addEventListener('change', (e) => {
    const value = (e.target as HTMLSelectElement).value
    applyThemeChoice(value === 'dark' ? 'dark' : value === 'light' ? 'light' : 'system')
  })
}
window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', () => {
  const saved = (() => { try { return localStorage.getItem(THEME_KEY) } catch { return null } })()
  if (saved === 'system') setThemeResolved(prefersDark(), 'system')
})

/* ----- Pro checkout and grandfathered License status -----
 *
 * Tactics Journal creates the Pro checkout and Polar opens it over the board.
 * Existing License holders keep a status and management link, but the retired
 * product is not offered to new customers.
 */

const LICENSE_MANAGE_URL = `${TJ_ORIGIN}/settings/`

/**
 * Pro is live. Preview and development builds keep its purchase surface
 * available for review. Opening the sale also requires server configuration.
 */
const PRO_CHECKOUT_OPEN = true

function proCheckoutOpen(): boolean {
  return PRO_CHECKOUT_OPEN || entitlements.isTrustedPreviewBuild()
}

function comingSoon(what: string): string {
  return `<p class="proHeroNote"><strong>${what} is coming soon.</strong> The board is free to use in the meantime, and the paid features will unlock here the moment it opens.</p>`
}

function buyButton(label: string, product: CheckoutProduct): string {
  return `<button type="button" class="proBuyBtn" data-buy="${product}">${label}</button>`
}

function manageLink(): string {
  return `<a class="proManageLink" href="${LICENSE_MANAGE_URL}" target="_blank" rel="noopener">Manage or cancel on Tactics Journal</a>`
}

function renderLicenseCta() {
  const area = settingsEl.querySelector('[data-lic-area]') as HTMLElement | null
  if (!area) return

  if (entitlements.isPro()) {
    area.innerHTML = `<p class="proHeroNote">Pro is active.</p>${manageLink()}`
    return
  }
  if (entitlements.hasBoardLicense()) {
    area.innerHTML = `
      <p class="proHeroNote" data-buy-note>Your grandfathered Hosted Board License is active. You keep the access you bought and can upgrade to Pro.</p>
      ${manageLink()}`
    return
  }

  area.innerHTML = `<p class="proHeroNote" data-buy-note>${usingBillingSandbox()
    ? 'This build is pointed at the Polar sandbox. Nothing here charges a real card, and the account it signs into is the sandbox one, not your real Tactics Journal account.'
    : 'Pro belongs to your Tactics Journal account and unlocks as soon as checkout finishes.'}</p>`
}

/**
 * A License holder sees the same Pro upgrade button. The backend preserves the
 * existing in-place upgrade rather than starting a second subscription.
 */
/** Yearly is the price the card leads with, and the toggle switches it. */
let proBillingPeriod: 'yearly' | 'monthly' = 'yearly'

function renderProCta() {
  const cta = settingsEl.querySelector('[data-pro-card-cta]') as HTMLElement | null
  if (!cta) return
  if (entitlements.isPro()) {
    cta.innerHTML = `
      <p class="proHeroNote">Pro is active.</p>
      ${manageLink()}`
    return
  }
  if (!proCheckoutOpen()) {
    cta.innerHTML = `<p class="proHeroNote">Pro is coming soon.</p>`
    return
  }
  cta.innerHTML = proBillingPeriod === 'yearly'
    ? buyButton('Get Pro', 'pro_yearly')
    : buyButton('Get Pro', 'pro_monthly')
}

/** The Pro card names one price at a time; the toggle says which one. */
function renderProBilling() {
  const yearly = proBillingPeriod === 'yearly'
  const amount = settingsEl.querySelector('[data-pro-amount]')
  const billed = settingsEl.querySelector('[data-pro-billed]')
  const save = settingsEl.querySelector('[data-pro-save]') as HTMLElement | null
  if (amount) amount.textContent = yearly ? '$12.42' : '$14.99'
  if (billed) billed.textContent = yearly ? 'Billed yearly at $149' : 'Billed monthly at $14.99'
  if (save) save.hidden = !yearly
  for (const button of settingsEl.querySelectorAll('[data-period]')) {
    button.setAttribute('aria-pressed', String(button.getAttribute('data-period') === proBillingPeriod))
  }
  renderProCta()
}

settingsEl.addEventListener('click', (e) => {
  const toggle = (e.target as HTMLElement).closest('[data-period]') as HTMLButtonElement | null
  if (!toggle) return
  proBillingPeriod = toggle.getAttribute('data-period') === 'monthly' ? 'monthly' : 'yearly'
  renderProBilling()
})

/**
 * The account panel matches the site's, which signs out from its account page.
 * The board keeps a cookie of its own, so the control lives here instead.
 */
async function signOutFromSettings(): Promise<void> {
  try {
    await tjHeader.signOut()
    showToast('Signed out.')
  } catch {
    showToast('Could not sign out. Try again.')
  }
}

/** Opens the site account panel in the board header, closing settings first. */
function openSignIn() {
  closeSettings()
  // Not a synthetic click on the header icon: that icon is an anchor to the
  // site's account page, and a click on it at desktop width used to navigate
  // away from the board - unsaved-work prompt and all - instead of signing in.
  tjHeader.openAccount()
}

/**
 * One buy button, wherever it is. The button is disabled while the overlay is
 * open so a second click cannot start a second checkout, and every ending —
 * bought, abandoned, signed out, closed — says what happened in the same place.
 */
async function buy(button: HTMLButtonElement): Promise<void> {
  const product = button.dataset.buy as CheckoutProduct
  const note = settingsEl.querySelector('[data-buy-note]') as HTMLElement | null
  const say = (message: string) => { if (note) note.textContent = message }
  const label = button.textContent || ''

  button.disabled = true
  button.textContent = 'Opening checkout...'
  void recordProductEvent('checkout_opened', product)
  try {
    const theme = document.documentElement.getAttribute('data-theme-resolved') === 'dark' ? 'dark' : 'light'
    const outcome = await startCheckout(product, theme, (stage) => {
      button.textContent = stage === 'confirming' ? 'Confirming purchase...' : 'Opening checkout...'
    })
    if (outcome.ok) {
      // The board hears about the purchase from the account session, so the
      // buttons are redrawn from what the server says, not from this result.
      renderLicenseCta()
      renderProCta()
      // Paying with an address that already has an account cannot sign anyone
      // in, because typing someone else's address would then be a way into
      // their account. The code in their inbox is.
      if (outcome.checkEmail) {
        say('Paid. That email already has a Tactics Journal account, so check your inbox for a sign-in code and the purchase is waiting.')
      }
      return
    }
    if (outcome.reason === 'unavailable') {
      say('Checkout is not open yet. Nothing was charged.')
    } else if (outcome.reason === 'failed') {
      say('Checkout could not be opened. Nothing was charged.')
    } else if (outcome.reason === 'unconfirmed') {
      say('Checkout finished, but Pro could not be confirmed yet. Check your Tactics Journal account or email before trying again.')
    } else {
      say('Checkout closed. Nothing was charged.')
    }
  } finally {
    button.disabled = false
    if (button.isConnected) button.textContent = label
  }
}

settingsEl.addEventListener('click', (e) => {
  const button = (e.target as HTMLElement).closest('[data-buy]') as HTMLButtonElement | null
  if (button) void buy(button)
})

renderLicenseCta()
renderProCta()
openDeepLinkedPanel()
void openInvitationFromLink()

/* ----- pitch style picker ----- */

/* ----- the pitch picker: our art, then the user's own backgrounds ----- */

/**
 * What an image is decides what you get to draw on it, so it is asked before
 * the file chooser rather than guessed from the picture.
 */
const kindEl = document.createElement('div')
kindEl.className = 'modal hidden'
kindEl.innerHTML = `
  <div class="sheet kindSheet">
    <div class="sheetHead">
      <strong>What is this image?</strong>
      <button data-kind="close">Close</button>
    </div>
    <button class="kindOpt" data-kind="pitch">
      <span class="kindName">A pitch</span>
      <span class="kindWhat">Drawn on like our own pitch art: both teams, an XI, cones and goals, dark arrows.</span>
    </button>
    <button class="kindOpt" data-kind="broadcast">
      <span class="kindName">A broadcast</span>
      <span class="kindWhat">A camera frame: single live players, flip the board, light arrows, no team overlay.</span>
    </button>
    <p class="kindNote">You can change this later from the tile.</p>
  </div>`
document.body.appendChild(kindEl)

/** The kind the next chosen file will be saved as. */
let pendingKind: BackgroundKind = 'pitch'

function openKindChooser() {
  kindEl.classList.remove('hidden')
}

kindEl.addEventListener('click', (e) => {
  const target = e.target as HTMLElement
  if (target === kindEl) { kindEl.classList.add('hidden'); return }
  const btn = target.closest('[data-kind]') as HTMLElement | null
  if (!btn) return
  const value = btn.dataset.kind
  kindEl.classList.add('hidden')
  if (value !== 'pitch' && value !== 'broadcast') return
  pendingKind = value
  ;(settingsEl.querySelector('[data-set-file]') as HTMLInputElement).click()
})

/**
 * A background that changed kind changes what the board offers, so the board
 * on screen has to be told. The scene keeps its id and its icons; only the
 * tools around them move.
 */
function applyBackgroundKind(id: string) {
  if (pitchById(store.scene.pitch).id !== id) return
  applyPitchArrowDefault(pitchById(id))
  store.apply(s => { s.pitch = id })
  renderPanel()
}

/** Thumbnails come out of the database one at a time; keep the ones we have. */
const bgThumbs = new Map<string, string>()
const bgMenuFor = { id: '' }

const KIND_LABEL: Record<BackgroundKind, string> = { pitch: 'Pitch', broadcast: 'Broadcast' }

function pitchTile(id: string, label: string, boardH: number, art: string, opts: { locked?: boolean; own?: boolean; kind?: BackgroundKind } = {}) {
  const current = pitchById(store.scene.pitch).id === id
  const shot = art
    ? `<img class="pitchShotImg" src="${art}" alt="">`
    : '<span class="pitchShotEmpty"></span>'
  const tag = opts.locked ? '<span class="setTag pitchTag">Unavailable</span>' : ''
  const tick = current && !opts.locked ? `<span class="pitchTick">${icon('check', 'ic')}</span>` : ''
  const more = opts.own
    ? `<span class="pitchMore" role="button" tabindex="0" data-bg-menu="${id}" aria-label="More options for ${esc(label)}">${icon('dots')}</span>`
    : ''
  return `<button class="pitchTile${current ? ' on' : ''}" data-pitch="${id}">
    <span class="pitchShot">${shot}${tick}${tag}${more}</span>
    <span class="pitchTileName">${esc(label)}</span>
    <span class="pitchTileSub">${opts.kind ? `${KIND_LABEL[opts.kind]} &middot; ` : ''}${BOARD_W} &times; ${boardH}</span>
  </button>`
}

function pitchStatusEls() {
  return {
    row: settingsEl.querySelector('[data-pitch-status]') as HTMLElement,
    text: settingsEl.querySelector('[data-pitch-status-text]') as HTMLElement,
    undo: settingsEl.querySelector('[data-set="pitch-undo"]') as HTMLElement,
  }
}

function clearPitchStatus() {
  const { row, text, undo } = pitchStatusEls()
  pitchUndoDepth = null
  row.hidden = true
  undo.hidden = true
  text.textContent = ''
}

function setPitchStatus(message: string, undoable: boolean) {
  const { row, text, undo } = pitchStatusEls()
  row.hidden = false
  undo.hidden = !undoable
  requestAnimationFrame(() => { text.textContent = message })
}

function announcePitchChange(style: ReturnType<typeof pitchById>) {
  if (settingsEl.classList.contains('hidden') || screen !== 'pitch') return
  pitchUndoDepth = store.undoDepth
  setPitchStatus(`Pitch changed to ${style.label}`, true)
}

function undoPitchChange() {
  if (pitchUndoDepth === null || store.undoDepth !== pitchUndoDepth) return
  pitchUndoDepth = null
  store.undo()
  renderPitchSeg()
  setPitchStatus('Pitch change undone', false)
}

store.subscribe(() => {
  if (pitchUndoDepth !== null && store.undoDepth !== pitchUndoDepth) clearPitchStatus()
})

function renderPitchSeg() {
  const segEl = settingsEl.querySelector('[data-pitch-seg]') as HTMLElement
  segEl.innerHTML = PITCHES
    .filter(p => !p.hidden && (!p.adminOnly || entitlements.hasBoardAdminAccess()))
    .map(p => pitchTile(p.id, p.label, p.boardH, p.src, { locked: !entitlements.canPickPitch(p) }))
    .join('')
  renderBackgroundGrid()
}

function renderBackgroundGrid() {
  const grid = settingsEl.querySelector('[data-bg-grid]') as HTMLElement
  const locked = !entitlements.canUploadBackground()
  const saved = backgrounds.list()
  grid.innerHTML = saved
    .map(meta => pitchTile(meta.id, meta.name, meta.boardH, bgThumbs.get(meta.id) ?? '', { locked, own: true, kind: meta.kind }))
    .join('') + `<button class="pitchTile pitchAdd" data-bg-add>
      <span class="pitchShot pitchAddShot">${icon('plus')}</span>
      <span class="pitchTileName">Add background</span>
      <span class="pitchTileSub">Photo or screenshot</span>
    </button>`
  if (bgMenuFor.id) drawBackgroundMenu(bgMenuFor.id)

  const usage = settingsEl.querySelector('[data-bg-usage]') as HTMLElement
  usage.textContent = saved.length
    ? `${saved.length} saved, ${(backgrounds.bytes() / 1048576).toFixed(1)} MB`
    : ''
  const note = settingsEl.querySelector('[data-bg-note]') as HTMLElement
  note.textContent = saved.length
    ? 'Pro syncs your backgrounds between devices. Sharing a Project never shares your private background library.'
    : 'Add a photo, a broadcast still or a training-ground shot. Each one is saved here, and the board takes its shape.'

  // Fill in the tiles whose thumbnail has not been read yet. The answer lands
  // in the cache and the grid draws again, so a tile that was replaced while
  // its picture was being read still gets it.
  for (const meta of saved) {
    if (bgThumbs.has(meta.id)) continue
    bgThumbs.set(meta.id, '')
    void backgrounds.thumb(meta.id).then(src => {
      if (!src || bgThumbs.get(meta.id) === src) return
      bgThumbs.set(meta.id, src)
      renderBackgroundGrid()
    })
  }
}

/** `animate: false` is for the moment another menu is about to take its place. */
function closeBackgroundMenu(animate = true) {
  bgMenuFor.id = ''
  const menus = Array.from(settingsEl.querySelectorAll<HTMLElement>('.pitchMenu'))
  if (!animate) {
    menus.forEach(el => el.remove())
    settingsEl.querySelectorAll('.menuOpen').forEach(el => el.classList.remove('menuOpen'))
    return
  }
  // The tile keeps its raised z-index until the menu has finished leaving, so
  // the menu is never clipped by the tile next to it on the way out.
  menus.forEach(el => {
    const host = el.parentElement
    el.classList.remove('is-open')
    el.classList.add('is-closing')
    window.setTimeout(() => { el.remove(); host?.classList.remove('menuOpen') }, dropdownCloseMs())
  })
}

function drawBackgroundMenu(id: string) {
  closeBackgroundMenu(false)
  // On the tile rather than inside its picture: the picture is clipped, and a
  // menu that opens upward has to be able to leave it.
  const host = settingsEl.querySelector(`[data-pitch="${id}"]`)
  if (!host) return
  bgMenuFor.id = id
  host.classList.add('menuOpen')
  const kind = backgrounds.get(id)?.kind ?? 'broadcast'
  const kindRow = (want: BackgroundKind) =>
    `<button data-bg-act="kind" data-bg-kind="${want}" data-bg-id="${id}"${kind === want ? ' class="on"' : ''}>Use as ${KIND_LABEL[want].toLowerCase()}</button>`
  host.insertAdjacentHTML('beforeend', `<span class="pitchMenu t-dropdown" data-origin="bottom-right">
    ${kindRow('pitch')}
    ${kindRow('broadcast')}
    <span class="pitchMenuRule"></span>
    <button data-bg-act="rename" data-bg-id="${id}">Rename</button>
    <button data-bg-act="duplicate" data-bg-id="${id}">Duplicate</button>
    <button data-bg-act="delete" data-bg-id="${id}" class="danger">Delete</button>
  </span>`)
  // One frame on the resting state first, so the menu has something to grow from.
  const menu = host.querySelector<HTMLElement>('.pitchMenu')!
  requestAnimationFrame(() => menu.classList.add('is-open'))
}

/** Deleting the background on screen leaves the board on our own pitch art. */
async function deleteBackground(meta: BackgroundMeta) {
  const showing = pitchById(store.scene.pitch).id === meta.id
  await backgrounds.remove(meta.id)
  bgThumbs.delete(meta.id)
  if (showing) applyPitchChoice(pitchById(DEFAULT_PITCH))
  renderPitchSeg()
  setNote(`Deleted "${meta.name}". Your other backgrounds are untouched.`)
}

function exportBoardsFile() {
  saves.autosaveCurrent() // include the board on screen
  const payload = saves.exportFile()
  download('tactics-boards.json', 'data:application/json;charset=utf-8,' + encodeURIComponent(payload))
  setNote('Boards exported. On your other device, open Settings, then Move to another device, and tap Import from a file.')
}

settingsEl.addEventListener('click', (e) => {
  if (e.target === settingsEl) { closeSettings(); return }
  const gotoBtn = (e.target as HTMLElement).closest('[data-goto]') as HTMLElement | null
  if (gotoBtn) {
    const target = gotoBtn.dataset.goto as SetScreen
    setNote('')
    // opening Teams from a side row starts on that side
    const side = gotoBtn.dataset.sideRow
    showScreen(target)
    if (target === 'teams' && (side === 'home' || side === 'away')) teams.focusSide(side)
    return
  }
  const skillOpen = (e.target as HTMLElement).closest<HTMLElement>('[data-skills-open]')
  if (skillOpen) { editingSkillDraft = null; editingSkillId = skillOpen.dataset.skillsOpen || null; renderSkillDetail(); showScreen('skill'); return }
  const officialOpen = (e.target as HTMLElement).closest<HTMLElement>('[data-official-open]')
  if (officialOpen?.dataset.officialOpen) { openOfficialDetail(officialOpen.dataset.officialOpen); return }
  const extensionOpen = (e.target as HTMLElement).closest<HTMLElement>('[data-extension-open]')
  if (BOARD_SELF_HOSTED && extensionOpen) { openExtensionDetail(extensionOpen.dataset.extensionOpen || null); return }
  const extensionPath = (e.target as HTMLElement).closest<HTMLElement>('[data-extension-path]')
  if (BOARD_SELF_HOSTED && extensionPath) { openExtensionDetail(null, extensionPath.dataset.extensionPath || null); return }
  const skillToggle = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-skill-toggle]')
  if (skillToggle) {
    const enabled = skillToggle.dataset.skillToggle === 'on'
    const form = skillToggle.closest<HTMLFormElement>('[data-skill-form]')
    const input = form?.querySelector<HTMLInputElement>('[data-skill-enabled]')
    if (input) input.checked = enabled
    form?.querySelectorAll<HTMLElement>('[data-skill-toggle]').forEach(button => button.classList.toggle('active', button === skillToggle))
    return
  }
  const skillsAction = (e.target as HTMLElement).closest<HTMLElement>('[data-skills-action]')?.dataset.skillsAction
  if (skillsAction === 'create') {
    const state = projectSkills()
    if (state.skills.length >= 50) { setNote('You can keep up to 50 skills.'); return }
    editingSkillDraft = newUserSkill('Untitled skill')
    editingSkillId = editingSkillDraft.id
    renderSkillDetail(); showScreen('skill'); return
  }
  if (skillsAction === 'delete-skill' && editingSkillId) {
    if (editingSkillDraft?.id === editingSkillId) { editingSkillDraft = null; editingSkillId = null; showScreen('skills'); return }
    if (window.confirm('Delete this skill?')) { saveSkills(deleteSkill(projectSkills(), editingSkillId)); editingSkillId = null; showScreen('skills') }
    return
  }
  if (BOARD_SELF_HOSTED && skillsAction === 'install-extension' && pendingExtensionPath && pendingExtensionManifest) {
    const manifest = pendingExtensionManifest
    if (!window.confirm(`${manifest.name} can ${permissionText(manifest.permissions).toLowerCase()} Install it for this project?`)) return
    const next = installExtension(projectSkills(), { path: pendingExtensionPath, name: manifest.name, description: manifest.description, version: manifest.version, permissions: manifest.permissions })
    if (!next) { setNote('Could not install this extension. Check the extension limit.'); return }
    saveSkills(next)
    const installed = next.extensions[next.extensions.length - 1]
    openExtensionDetail(installed.id)
    return
  }
  if (BOARD_SELF_HOSTED && skillsAction === 'remove-extension' && editingExtensionId) {
    if (window.confirm('Remove this extension from this project?')) { saveSkills(removeExtension(projectSkills(), editingExtensionId), false); disposeExtensionRuntime(); editingExtensionId = null; showScreen('skills') }
    return
  }
  const bgMenu = (e.target as HTMLElement).closest('[data-bg-menu]') as HTMLElement | null
  if (bgMenu) {
    e.preventDefault()
    e.stopPropagation()
    const id = bgMenu.dataset.bgMenu!
    if (bgMenuFor.id === id) closeBackgroundMenu()
    else drawBackgroundMenu(id)
    return
  }
  const bgAct = (e.target as HTMLElement).closest('[data-bg-act]') as HTMLElement | null
  if (bgAct) {
    e.preventDefault()
    e.stopPropagation()
    const meta = backgrounds.get(bgAct.dataset.bgId!)
    const act = bgAct.dataset.bgAct
    closeBackgroundMenu()
    if (!meta) { renderPitchSeg(); return }
    if (act === 'kind') {
      const want = bgAct.dataset.bgKind as BackgroundKind
      void backgrounds.setKind(meta.id, want).then(() => {
        applyBackgroundKind(meta.id)
        renderPitchSeg()
        setNote(want === 'pitch'
          ? `"${meta.name}" is a pitch now: teams, an XI, cones and goals.`
          : `"${meta.name}" is a broadcast now: single live players and a flip.`)
      })
    } else if (act === 'rename') {
      const name = window.prompt('Name this background:', meta.name)
      if (name !== null) void backgrounds.rename(meta.id, name).then(() => { renderPitchSeg(); renderRootValues() })
    } else if (act === 'duplicate') {
      void backgrounds.duplicate(meta.id).then(() => { renderPitchSeg(); setNote(`Duplicated "${meta.name}".`) })
    } else if (act === 'delete') {
      if (window.confirm(`Delete "${meta.name}"? Boards drawn on it keep their icons and move to the pitch.`)) {
        void deleteBackground(meta)
      }
    }
    return
  }
  const bgAdd = (e.target as HTMLElement).closest('[data-bg-add]') as HTMLElement | null
  if (bgAdd) {
    closeBackgroundMenu()
    openKindChooser()
    return
  }
  const pitchBtn = (e.target as HTMLElement).closest('[data-pitch]') as HTMLElement | null
  if (pitchBtn) {
    closeBackgroundMenu()
    const style = pitchById(pitchBtn.dataset.pitch)
    if (!entitlements.canPickPitch(style)) return
    const saved = style.custom ? backgrounds.get(style.id) : null
    if (saved) useBackground(saved)
    else if (style.custom) setNote('That background is not saved on this device.')
    else {
      const changed = applyPitchChoice(style)
      renderPitchSeg()
      if (changed) announcePitchChange(style)
    }
    return
  }
  const selfHostCopy = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-self-host-copy]')
  if (selfHostCopy) { void copySelfHostCommands(selfHostCopy); return }
  const agentCopy = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-agents-copy]')
  if (agentCopy) { void copyAgentMcpUrl(agentCopy); return }
  const providerLink = (e.target as HTMLElement).closest<HTMLAnchorElement>('[data-agent-provider]')
  if (providerLink) { void copyAgentMcpForProvider(providerLink); return }
  const btn = (e.target as HTMLElement).closest('[data-set]') as HTMLElement | null
  if (!btn) return
  const k = btn.dataset.set
  if (k === 'close') closeSettings()
  else if (k === 'back') {
    setNote('')
    disposeExtensionRuntime()
    if (screen === 'skill') editingSkillDraft = null
    showScreen(screen === 'skill' || screen === 'extension' || screen === 'official' ? 'skills' : 'root')
  }
  else if (k === 'theme-system') applyThemeChoice('system')
  else if (k === 'theme-light') applyTheme(false)
  else if (k === 'theme-dark') applyTheme(true)
  else if (k === 'pitch-undo') undoPitchChange()
  else if (k === 'boards-export') exportBoardsFile()
  else if (k === 'projects') openProjectsScreen()
  else if (k === 'free-backup') void requestFreeBackup('settings')
  else if (k === 'signin') openSignIn()
  else if (k === 'signout') void signOutFromSettings()
})

settingsEl.addEventListener('submit', (e) => {
  const form = e.target as HTMLFormElement
  if (form.matches('[data-skill-form]')) {
    e.preventDefault()
    if (!editingSkillId) return
    const name = form.querySelector<HTMLInputElement>('[data-skill-name]')!.value
    const instructions = form.querySelector<HTMLTextAreaElement>('[data-skill-instructions]')!.value
    const enabled = form.querySelector<HTMLInputElement>('[data-skill-enabled]')!.checked
    const state = projectSkills()
    const next = editingSkillDraft?.id === editingSkillId
      ? addUserSkill(state, { ...editingSkillDraft, name, instructions, enabled, updatedAt: new Date().toISOString() })
      : saveSkill(state, { id: editingSkillId, name, instructions, enabled })
    if (!next) { setNote('Give the skill a name and instructions.'); return }
    editingSkillDraft = null
    saveSkills(next); showScreen('skills')
  }
})
settingsEl.addEventListener('change', (e) => {
  const input = e.target as HTMLInputElement
  if (input.matches('[data-official-enabled]') && openOfficialId) {
    officialExtensions.setEnabled(openOfficialId, input.checked)
    renderOfficialDetail()
    renderOfficialList()
    return
  }
  if (input.matches('[data-extension-enabled]') && editingExtensionId) {
    saveSkills(setExtensionEnabled(projectSkills(), editingExtensionId, input.checked), false)
    if (!input.checked) disposeExtensionRuntime()
  }
})

settingsEl.querySelector('[data-boards-file]')!.addEventListener('change', (e) => {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  file.text().then(text => {
    const added = saves.importFile(text)
    setNote(added
      ? `Imported ${added} board${added === 1 ? '' : 's'}. You can find them in Projects.`
      : 'Nothing new to import - those boards are already saved here.')
  }).catch((error) => setNote(error instanceof Error && error.message === 'board storage write failed'
    ? 'Could not store those boards. Free some browser storage and try again; your saved boards were not changed.'
    : 'Could not read that file. Export it from Settings on your other device.'))
})

settingsEl.querySelector('[data-set-file]')!.addEventListener('change', (e) => {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  addBackgroundFromFile(file, pendingKind)
    .then(meta => {
      useBackground(meta)
      setNote(`Background applied and saved as "${meta.name}".`)
    })
    .catch(() => setNote('Could not save that image. It may be too large for this browser to store.'))
})

// restore the theme from the last visit
{
  const savedTheme = (() => { try { return localStorage.getItem(THEME_KEY) } catch { return null } })()
  applyThemeChoice(savedTheme === 'dark' ? 'dark' : savedTheme === 'light' ? 'light' : 'system')
}

/* The shelf opens after the first paint: the board already knows its height
   from the index mirror, so nothing waits on the database. The old single
   background slot moves onto the shelf the first time, and the board it was
   applied to keeps showing it. */
void loadBackgrounds()
  .then(() => migrateLegacyBackgrounds())
  .then(moved => {
    if (moved) useBackground(moved)
    board.refreshBackground()
    renderPitchSeg()
  })
  .catch(() => { /* no database on this device: the shelf stays empty */ })
backgrounds.subscribe(() => { renderRootValues(); syncPanelPitchMode() })

/* ---------- keyboard ---------- */

window.addEventListener('keydown', (e) => {
  const t = e.target as HTMLElement
  const inField = !!t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.isContentEditable)
  if (inField) return
  const openSheet = document.querySelector<HTMLElement>('.modal:not(.hidden)')
  if (e.key === 'Escape') {
    // same path as tapping the backdrop: the sheet's own click handler closes it
    if (openSheet) { openSheet.dispatchEvent(new MouseEvent('click', { bubbles: true })); return }
    closeSiteMenu()
    if (board.interactionState === 'node-edit') { board.exitNodeEdit(); return }
    store.select(null)
    return
  }
  if (openSheet) return
  // Keyboard edits and view commands are board-directed local control too.
  hideRemotePreview()
  const mod = e.metaKey || e.ctrlKey
  if (mod && e.key.toLowerCase() === 'z') {
    e.preventDefault()
    e.shiftKey ? store.redo() : store.undo()
  } else if (mod && e.key.toLowerCase() === 'y') {
    e.preventDefault(); store.redo()
  } else if (mod && e.key.toLowerCase() === 'd' && store.selectedIds.length) {
    e.preventDefault()
    duplicateSelected()
  } else if ((e.key === 'Delete' || e.key === 'Backspace') && store.selectedIds.length) {
    e.preventDefault()
    deleteSelected()
  } else if (e.key.startsWith('Arrow') && store.selectedIds.length) {
    e.preventDefault()
    const step = e.shiftKey ? 10 : NUDGE
    nudgeSelected(
      e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0,
      e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0,
    )
  } else if (!mod && !e.altKey && /^[1-5]$/.test(e.key)) {
    const pick = TOOL_KEYS[Number(e.key) - 1]
    board.setTool(pick.tool)
    room = pick.tool === 'text' ? 'text' : 'shapes'
    // the shortcut arms a tool; on a wide window it leaves the panel as it was
    if (!deskMode) panelOpen = true
    shelfCat = pick.cat
    pendingCatScroll = pick.cat
    renderPanel()
  } else if (!mod && !e.altKey && (e.key === 'f' || e.key === 'F' || e.key === '0')) {
    e.preventDefault()
    board.resetView()
  } else if (e.key === '=' || e.key === '+') {
    e.preventDefault()
    board.zoomBy(1.25)
  } else if (e.key === '-' || e.key === '_') {
    e.preventDefault()
    board.zoomBy(0.8)
  }
})

/* ---------- sync ---------- */

function syncTop() {
  ;(document.querySelector('[data-top="undo"]') as HTMLButtonElement).disabled = !store.canUndo
  ;(document.querySelector('[data-top="redo"]') as HTMLButtonElement).disabled = !store.canRedo
  // nothing to fit when the board is already sitting where it started
  ;(document.querySelector('[data-top="fit"]') as HTMLButtonElement).disabled = board.isFitView()
}
board.onViewChange = syncTop
store.subscribe(() => {
  if (!syncPanelPitchMode()) renderOptions()
  syncTop()
  renderFabs()
})

// edits flow into the board's saves entry (debounced; created in newBoard)
let liveSaveTimer: number | undefined
let documentChangeGeneration = 0
store.subscribe(() => {
  documentChangeGeneration += 1
  if (liveSaveTimer) clearTimeout(liveSaveTimer)
  liveSaveTimer = window.setTimeout(() => saves.autosaveLive(), 400)
})
store.onSelect(() => { syncRoomToSelection(); renderOptions(); syncTop(); renderFabs() })
// Pick the layout before the first render, so a wide window never paints the
// phone's bottom panel and then swaps it out.
applyLayout()
deskQuery.addEventListener('change', () => { applyLayout(); renderFabs() })
renderPanel()
// The first fit can run before the panel has a measured height, which would
// centre the pitch behind it. Re-fit once now that the inset is known.
requestAnimationFrame(() => { syncPanelHeight(); board.fit() })
syncTop()
renderFabs()

// World Cup dashboard deep-link: ?wc=<JSON> pre-seeds teams and opens a new board.
{
  const wcParam = new URLSearchParams(window.location.search).get('wc')
  if (wcParam) {
    try {
      const data: { home?: any; away?: any } = JSON.parse(wcParam)
      const seed: any[] = []
      if (data.home) seed.push({ ...data.home, side: 'home' as const })
      if (data.away) seed.push({ ...data.away, side: 'away' as const })
      if (seed.length) {
        teams.resetTeams(seed)
        newBoard('teams')
        history.replaceState(null, '', window.location.pathname)
      }
    } catch { /* malformed param — ignore */ }
  }
}

/* ---------- app-wide banner (open-board conflicts, access-loss notices) ---------- */

const appBanner = document.getElementById('appBanner') as HTMLDivElement

function hideBanner() {
  appBanner.className = 'appBanner hidden'
  appBanner.innerHTML = ''
}

/* A toast: one line, no buttons, gone on its own. For telling someone what
   just happened or where to go, when interrupting them with a banner they have
   to dismiss would be too much. */
const toastBandEl = document.createElement('div')
toastBandEl.className = 'toastBand'
const toastEl = document.createElement('div')
toastEl.className = 'toast t-toast'
toastEl.setAttribute('role', 'status')
toastEl.setAttribute('aria-live', 'polite')
toastBandEl.appendChild(toastEl)
document.body.appendChild(toastBandEl)
let toastTimer = 0

function showToast(message: string) {
  toastEl.textContent = message
  // a sheet owns the bottom of the screen while it is open, so stand above it
  const sheet = document.querySelector<HTMLElement>('.modal:not(.hidden) > .sheet')
  const clear = sheet ? Math.round(sheet.getBoundingClientRect().height) + 12 : 0
  toastBandEl.style.bottom = clear ? `${clear}px` : ''
  // A second message while one is up keeps the toast where it is and only
  // resets the clock; the class is idempotent, so nothing replays.
  toastEl.classList.add('is-open')
  window.clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => toastEl.classList.remove('is-open'), 3200)
}

/* The angle a turn is passing through, held at the top of the board for as
   long as the turn lasts. It reads out and never acts, so it takes no pointer
   and sits inside the board area rather than over the page. */
const angleEl = document.createElement('div')
angleEl.className = 'angleReadout'
angleEl.setAttribute('role', 'status')
angleEl.setAttribute('aria-live', 'polite')
stageWrap.appendChild(angleEl)
let angleTimer = 0

function showRotation(deg: number | null, linger = 700) {
  window.clearTimeout(angleTimer)
  if (deg === null) {
    // the last angle stays readable for a moment after the finger lifts
    angleTimer = window.setTimeout(() => angleEl.classList.remove('is-up'), linger)
    return
  }
  angleEl.textContent = `${deg}\u00b0`
  angleEl.classList.add('is-up')
}
board.onRotation = (deg) => showRotation(deg)

/** The button turns in one step, so its angle shows itself and then leaves. */
function flashRotation(deg: number) {
  showRotation(deg)
  showRotation(null, 900)
}

function showBanner(html: string, variant: 'warn' | '' = '') {
  appBanner.className = `appBanner${variant ? ' appBannerWarn' : ''}`
  appBanner.innerHTML = html
}

appBanner.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest('[data-banner]') as HTMLElement | null
  if (!btn) return
  const action = btn.dataset.banner
  if (action === 'dismiss') hideBanner()
  else if (action === 'conflict-backup') {
    download('tactics-board-backup.json', 'data:application/json;charset=utf-8,' + encodeURIComponent(saves.exportCurrentScene()))
  } else if (action === 'conflict-load') {
    saves.reloadCurrentFromStorage()
    hideBanner()
  } else if (action === 'conflict-keep') {
    saves.keepCurrentConflict()
    hideBanner()
  } else if (action === 'free-backup') {
    hideBanner()
    void requestFreeBackup('fourth_save')
  }
})

saves.onFreeLimit = () => {
  if (BOARD_SELF_HOSTED || entitlements.isPro()) return
  void recordProductEvent('free_backup_prompted', 'fourth_save')
  showBanner(`
    <p>Local projects are unlimited. Back up one project to your Tactics Journal account free, or use Pro to sync every project.</p>
    <span class="appBannerActions">
      <button data-banner="dismiss">Not now</button>
      <button data-banner="free-backup">Back up one project</button>
    </span>`)
}

// Multi-tab conflict: another tab saved a newer version of the board this
// tab has open. Let the user grab a backup of their local copy before
// choosing to load the newer version or keep working on theirs.
saves.onExternalConflict = (_name, state) => {
  const deleted = state === 'conflict-delete'
  showBanner(`
    <p>${deleted
      ? 'This board was deleted on another device. Keep this canvas as a new saved copy, or accept the deletion?'
      : 'This board was changed in another tab. Load the newer version or keep yours as a new saved copy?'}</p>
    <span class="appBannerActions">
      <button data-banner="conflict-backup">Download backup</button>
      <button data-banner="conflict-load">${deleted ? 'Accept deletion' : 'Load newer version'}</button>
      <button data-banner="conflict-keep">Keep mine</button>
    </span>`, 'warn')
}

// Server-derived paid access: the TJ header fetches the session from
// tacticsjournal.com and dispatches auth-changed. Wire that into the
// entitlements module so the board reflects the server's answer. The two
// products are read separately: `site_access` for the Pro subscription and
// `board_license` for a grandfathered License.
let wasPro = entitlements.isPro()
/** Authentication permits shared-board sync even without a Pro entitlement. */
let boardSessionReady = false
let syncGeneration = 0
window.addEventListener('tacticsjournal:auth-changed', ((event: CustomEvent) => {
  // Authentication changes are a collaboration boundary, even when the
  // account binding happens to remain null.
  clearCollaborationPreview()
  const data = event.detail
  const previousAuthenticated = authenticated
  authenticated = data?.authenticated === true
  const authBoundary = authenticated !== previousAuthenticated
  if (!authenticated) boardSessionReady = false
  const nextBinding = authenticated && typeof data?.account_binding === 'string' ? data.account_binding : null
  const accountChanged = nextBinding !== accountBinding
  if (accountChanged || authBoundary) {
    accountBinding = nextBinding
    teams.activateLibraryAccount(accountBinding)
    activateCategoryScenesAccount(accountBinding)
    resetBoardSession()
    boardSessionReady = false
    syncGeneration += 1
    if (syncTimer !== null) { clearTimeout(syncTimer); syncTimer = null }
    syncStore = sync.createLocalSyncStore(accountBinding)
    liveChannel.stop()
    collaborationChannel.stop()
    sharedBackgroundScope?.clear()
    sharedBackgroundScope = null
    sharedBackgroundRowId = null
    sharedBackgroundProjectId = null
    clearActiveSharedPitches()
    boardsView.clearBackgroundCache()
    board.setBackgroundResolver(id => backgrounds.image(id))
    board.refreshBackground()
    selectProjectBackgroundResolver(currentProject(library))
    board.refreshBackground()
    clearRemotePreview()
  }
  const serverPro = Boolean(data && data.site_access === 'pro')
  const serverLicense = Boolean(data && data.board_license === true)
  const serverBoardAdmin = Boolean(data && data.authenticated === true && data.board_admin === true)
  accountEmail = data && data.authenticated === true && typeof data.email === 'string' ? data.email : null
  accountName = data && data.authenticated === true && typeof data.name === 'string' && data.name.trim() !== '' ? data.name : null
  renderAccountRow()
  // fills blanks only, so a session landing later never clobbers an edit
  prefillFeedback()
  entitlements.setServerEntitlement(serverPro, serverLicense, serverBoardAdmin)
  if (authenticated && !previousAuthenticated) {
    const intent = takeFreeBackupIntent(sessionStorage)
    if (intent) queueMicrotask(() => { void requestFreeBackup(intent.source, intent.boardId) })
  }
  renderPitchSeg()
  // the tags say what is still to buy, so they answer to the new access at once
  syncLockTags()
  // Pro loss only. Local work remains fully editable; only hosted account
  // services stop when Pro ends.
  const isPro = entitlements.isPro()
  if (wasPro && !isPro) {
    showBanner(`
      <p>Pro access has ended. Local projects remain editable and exportable; all-project sync, collaboration, sharing controls, and agent access are paused.</p>
      <span class="appBannerActions"><button data-banner="dismiss">Dismiss</button></span>`, 'warn')
  }
  wasPro = isPro
  // Auth can change while entitlement flags remain false. It still starts or
  // stops shared-board sync and its live nudge channel immediately.
  void runSync()
  void updateLiveChannel()
  void updateCollaborationChannel()
}) as EventListener)

/* ----- board sync -----
 *
 * Pro syncs personal and shared boards; a signed-in free member syncs only
 * boards shared with them. Failures
 * are silent by design — a device that cannot reach the server has lost
 * nothing, and a banner on every flaky connection would be noise.
 *
 * Sync is immediate in both directions. A local save pushes as it happens, and
 * a live channel says when another device has pushed, so the two sides meet in
 * about as long as the round trip takes. The old triggers are kept as the
 * fallback: a device with no socket still converges when the tab comes back.
 */
let syncStore = sync.createLocalSyncStore(accountBinding)
const syncApi = sync.createSyncApi()
const assetSyncApi = assetSync.createAssetSyncApi()
const librarySyncApi = librarySync.createLibrarySyncApi()
let syncTimer: number | null = null

async function syncPersonalLibraries(generation: number, binding: string | null): Promise<void> {
  if (!authenticated || !entitlements.isPro()) return
  const [assets, libraries] = await Promise.all([
    assetSync.syncAssetsOnce(assetSyncStore(), assetSyncApi, binding),
    librarySync.syncLibrariesOnce(librarySyncStore, librarySyncApi, binding),
  ])
  if (generation !== syncGeneration) return
  if (assets.pulled > 0) { board.rebuild(); renderPanel(); renderAssetList() }
  if (libraries.pulled > 0) {
    // Remote library applications suppress local-change signals. Refresh the
    // picker and shelves here, after all pulled background JPEGs are stored.
    board.refreshBackground(); board.rebuild(); renderPanel(); renderAssetList(); renderPitchSeg(); renderRootValues()
  }
}

function reconcileProjectSync(rowsBeforeSync: ReturnType<typeof saves.projectDocuments>, result: sync.SyncResult): boolean {
  // localStorage does not notify its own writer. Explicitly load a remote
  // update into a clean open canvas, or use the existing conflict choices if
  // the person edited while the request was in flight.
  // A later page can fail after valid pages changed local storage. Reconcile
  // those pages too; only the network failure itself stays silent.
  const openConflict = saves.applyRemoteCurrent(result.remoteIds, saves.currentBoardId())
  const rowsAfterSync = saves.projectDocuments()
  const remainingRows = new Set(rowsAfterSync.map(row => row.rowId))
  const remoteRows = new Set(result.remoteIds)
  const remotelyDeletedProjects = rowsBeforeSync
    .filter(row => remoteRows.has(row.rowId) && !remainingRows.has(row.rowId))
    .map(row => row.project.id)
  // applyRemoteCurrent alone owns replacement or deletion of the Project on
  // screen. All other full Project rows become visible library entries here.
  reconcileLibraryProjectDocuments({ removeProjectIds: remotelyDeletedProjects, skipCurrent: true })
  const remoteProjectIds = new Set(rowsAfterSync
    .filter(row => remoteRows.has(row.rowId))
    .map(row => row.project.id))
  const destination = freshDeviceDestination(library, freshStarter, remoteProjectIds)
  if (destination && freshStarter) {
    library = {
      ...library,
      currentId: destination.id,
      projects: library.projects.filter(project => project.id !== freshStarter!.id),
    }
    freshStarter = null
    saveLibrary(library)
    boardsView.setLibrary(library)
    saves.activateDocument(destination.id)
  }
  if (result.pulled > 0 || result.conflicts > 0 || result.remoteIds.length > 0) {
    saves.refresh()
    // A revoked open share leaves its canvas detached. Drop its scoped image
    // before that canvas can keep showing bytes this account may no longer read.
    selectProjectBackgroundResolver(currentProject(library))
    board.refreshBackground()
  }
  return openConflict
}

async function runSyncPass(): Promise<void> {
  if (!(authenticated || entitlements.isPro())) return
  // The board host has its own host-only cookie. Establish it before every
  // pass so expiry is repaired once, not by a retry loop of failed syncs.
  const requestedGeneration = syncGeneration
  const requestedBinding = accountBinding
  boardSessionReady = await ensureBoardSession(requestedBinding)
  if (!boardSessionReady || requestedGeneration !== syncGeneration || !(authenticated || entitlements.isPro())) return
  // Personal libraries share the Board session, but not the Project store.
  // Start them independently so a dirty/conflicted Project or a failed Project
  // request cannot prevent a clean device from restoring account data.
  const personalSync = syncPersonalLibraries(requestedGeneration, requestedBinding)
  // Do this before starting the Project request. A failed local write must
  // never let a pull replace a dirty saved board; an unnamed canvas has no
  // sync record. Personal libraries are safe to finish either way.
  if (!saves.flushCurrentForSync()) { await personalSync; return }
  // Remember which visible Project each durable row represented before sync.
  // A missing row after a remote tombstone must remove that Project, not seed
  // it back into account sync on this or the next pass.
  const rowsBeforeSync = saves.projectDocuments()
  const passGeneration = requestedGeneration
  const passStore = syncStore
  const freeBackupId = !entitlements.isPro() ? selectedFreeBackup(localStorage, requestedBinding) : null
  const result = await sync.syncOnce(passStore, syncApi, new Date().toISOString(), undefined, {
    includeOwned: entitlements.isPro() || !!freeBackupId,
    ...(freeBackupId ? { ownedId: freeBackupId, freeBackupId } : {}),
    stillCurrent: () => passGeneration === syncGeneration && requestedBinding === accountBinding,
  })
  // A response started under another account may update its account-scoped
  // local records, but it must not replace the board now on screen.
  if (passGeneration !== syncGeneration) return
  const openConflict = reconcileProjectSync(rowsBeforeSync, result)
  if (!entitlements.isPro() && !freeBackupId && requestedBinding) {
    const restored = saves.projectDocuments().find(row => row.access !== 'shared' && result.remoteIds.includes(row.rowId))
    if (restored) setSelectedFreeBackup(localStorage, requestedBinding, restored.rowId)
  }
  await personalSync
  if (passGeneration !== syncGeneration) return
  // Only speak up for an accepted server conflict, never a network failure.
  if (result.status === 'ok' && result.conflicts > 0) {
    if (!openConflict) {
      showBanner(`
        <p>A board was edited on another device as well. Both versions are saved; the copy from this device is named "(this device)".</p>
        <span class="appBannerActions"><button data-banner="dismiss">Dismiss</button></span>`, 'warn')
    }
  }
  // A successful push/pull elsewhere is not authoritative for the board
  // being watched. Only its durable replacement may dismiss this frame.
  if (result.status === 'ok' && result.remoteIds.includes(saves.currentBoardId() ?? '')) clearRemotePreview()
  // A pass can bring in a share, or take one away, so the place this
  // device holds is re-checked against whatever is open now.
  updatePresence()
}

let projectSyncQueue: Promise<void> = Promise.resolve()
function serializeProjectSync<T>(work: () => Promise<T>): Promise<T> {
  const run = projectSyncQueue.then(() => work(), () => work())
  projectSyncQueue = run.then(() => undefined, () => undefined)
  return run
}

function freeBackupCandidate(requestedId?: string) {
  const rows = saves.projectDocuments().filter(row => row.access !== 'shared')
  if (requestedId) return rows.find(row => row.rowId === requestedId) ?? null
  const currentId = saves.currentBoardId()
  return rows.find(row => row.rowId === currentId)
    ?? rows.sort((a, b) => Date.parse(b.savedAt) - Date.parse(a.savedAt))[0]
    ?? null
}

async function requestFreeBackup(source: FreeBackupSource, requestedId?: string): Promise<void> {
  if (BOARD_SELF_HOSTED) return
  if (entitlements.isPro()) { showToast('Pro already backs up every project.'); return }
  const row = freeBackupCandidate(requestedId)
  if (!row) { showToast('Save a project on this device before turning on backup.'); return }
  if (source === 'settings') void recordProductEvent('free_backup_prompted', source)
  if (!authenticated || !accountBinding) {
    if (!saveFreeBackupIntent(sessionStorage, { boardId: row.rowId, source })) {
      showToast('This browser could not preserve the backup request. Sign in, then try again.')
      return
    }
    showToast('Sign in to back up this project free.')
    openSignIn()
    return
  }
  const previous = selectedFreeBackup(localStorage, accountBinding)
  if (previous && previous !== row.rowId) {
    const old = freeBackupCandidate(previous)
    if (!window.confirm(`Replace ${old?.name || 'your current free backup'} with ${row.name}? The old project stays on this device.`)) return
  }
  await serializeProjectSync(() => syncFreeBackupProject(row.rowId, source))
}

async function syncFreeBackupProject(boardId: string, source: FreeBackupSource): Promise<void> {
  const requestedGeneration = syncGeneration
  const requestedBinding = accountBinding
  if (!authenticated || !requestedBinding || entitlements.isPro()) return
  boardSessionReady = await ensureBoardSession(requestedBinding)
  if (!boardSessionReady || requestedGeneration !== syncGeneration || requestedBinding !== accountBinding) {
    showToast('Could not connect this backup to your account. Try again.')
    return
  }
  if (!saves.flushCurrentForSync()) {
    showToast('Could not save the current project on this device. Nothing was uploaded.')
    return
  }
  const row = freeBackupCandidate(boardId)
  if (!row) { showToast('That project is no longer saved on this device.'); return }
  const rowsBeforeSync = saves.projectDocuments()
  const result = await sync.syncOnce(syncStore, syncApi, new Date().toISOString(), undefined, {
    includeOwned: true,
    ownedId: boardId,
    targetId: boardId,
    freeBackupId: boardId,
    advanceMarkers: false,
    stillCurrent: () => requestedGeneration === syncGeneration && requestedBinding === accountBinding,
  })
  if (requestedGeneration !== syncGeneration || requestedBinding !== accountBinding) return
  reconcileProjectSync(rowsBeforeSync, result)
  if (result.status === 'ok' && result.conflicts > 0) {
    showToast('Another version was already backed up. Both versions stay on this device; choose the project again after reviewing them.')
    return
  }
  if (result.status !== 'ok') {
    if (result.reason === 'free_backup_creation_cap') {
      showToast('This account has used its three free backup records. Pro backs up every project; your local work is unchanged.')
      openSettings('pro')
    } else showToast('The project stayed on this device, but backup did not finish. Try again.')
    return
  }
  if (!setSelectedFreeBackup(localStorage, requestedBinding, boardId)) {
    showToast('Backup finished, but this browser could not remember the selection.')
    return
  }
  void recordProductEvent('free_backup_enabled', source)
  renderRootValues()
  showToast(`${row.name} is backed up to your account.`)
}

async function runTargetedSyncPass(
  boardId: string,
  requestedGeneration: number,
  requestedBinding: string | null,
): Promise<sync.SyncResult> {
  if (requestedGeneration !== syncGeneration || requestedBinding !== accountBinding) {
    return { status: 'failed', pushed: 0, pulled: 0, conflicts: 0, remoteIds: [], reason: 'the account changed while preparing the Project' }
  }
  if (!(authenticated || entitlements.isPro())) {
    return { status: 'failed', pushed: 0, pulled: 0, conflicts: 0, remoteIds: [], reason: 'an active account is required' }
  }
  boardSessionReady = await ensureBoardSession(requestedBinding)
  if (!boardSessionReady) {
    return { status: 'failed', pushed: 0, pulled: 0, conflicts: 0, remoteIds: [], reason: 'could not establish the Board session' }
  }
  if (requestedGeneration !== syncGeneration || requestedBinding !== accountBinding || !(authenticated || entitlements.isPro())) {
    return { status: 'failed', pushed: 0, pulled: 0, conflicts: 0, remoteIds: [], reason: 'the account changed while preparing the Project' }
  }
  // Flush only after the session check, and never let the targeted pass turn a
  // failed local write into a remote overwrite.
  if (!saves.flushCurrentForSync()) {
    return { status: 'failed', pushed: 0, pulled: 0, conflicts: 0, remoteIds: [], reason: 'could not save the current Project on this device' }
  }
  const targetRow = saves.projectDocuments().find(row => row.rowId === boardId)
  if (!targetRow || targetRow.access === 'shared') {
    return { status: 'failed', pushed: 0, pulled: 0, conflicts: 0, remoteIds: [], reason: 'the Project is not locally owned' }
  }
  try {
    await librarySync.pushReferencedBackgrounds(targetRow.project, librarySyncStore, librarySyncApi, requestedBinding, {
      stillCurrent: () => requestedGeneration === syncGeneration && requestedBinding === accountBinding,
    })
  } catch (error) {
    return {
      status: 'failed', pushed: 0, pulled: 0, conflicts: 0, remoteIds: [],
      reason: error instanceof Error ? error.message : 'could not upload the Project backgrounds',
    }
  }
  if (requestedGeneration !== syncGeneration || requestedBinding !== accountBinding) {
    return { status: 'failed', pushed: 0, pulled: 0, conflicts: 0, remoteIds: [], reason: 'the account changed while preparing the Project' }
  }
  const rowsBeforeSync = saves.projectDocuments()
  const passStore = syncStore
  const result = await sync.syncOnce(passStore, syncApi, new Date().toISOString(), undefined, {
    includeOwned: entitlements.isPro(), targetId: boardId, advanceMarkers: false, shareTarget: true,
    stillCurrent: () => requestedGeneration === syncGeneration && requestedBinding === accountBinding,
  })
  if (requestedGeneration !== syncGeneration || requestedBinding !== accountBinding) {
    return { ...result, status: 'failed', reason: 'the account changed while preparing the Project' }
  }
  const openConflict = reconcileProjectSync(rowsBeforeSync, result)
  if (result.status === 'ok' && result.conflicts > 0 && !openConflict) {
    showBanner(`
      <p>A board was edited on another device as well. Both versions are saved; the copy from this device is named "(this device)".</p>
      <span class="appBannerActions"><button data-banner="dismiss">Dismiss</button></span>`, 'warn')
  }
  if (result.status === 'ok' && result.remoteIds.includes(saves.currentBoardId() ?? '')) clearRemotePreview()
  updatePresence()
  return result
}

const requestSync = sync.createSyncRunner(() => serializeProjectSync(runSyncPass))
function runSync(): Promise<void> {
  if (!(authenticated || entitlements.isPro())) return Promise.resolve()
  return requestSync()
}

// Sharing pushes only the saved Project being shared. A large or malformed
// unrelated Project must not block the invitation, and this pass never moves
// the full-sync markers.
async function prepareSavedBoardsForSharing(boardId: string): Promise<string> {
  // Bind the queued request to the account that pressed Share. A Project with
  // no prior account binding must never be claimed by an account selected
  // while this request waits behind another sync.
  const requestedGeneration = syncGeneration
  const requestedBinding = accountBinding
  let currentId = boardId
  let reidentified = false
  let stable = false
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const generation = documentChangeGeneration
    const result = await serializeProjectSync(() => runTargetedSyncPass(currentId, requestedGeneration, requestedBinding))
    if (result.status !== 'ok') {
      if (result.reason === 'board_not_accessible' && !reidentified) {
        currentId = await serializeProjectSync(async () => {
          if (requestedGeneration !== syncGeneration || requestedBinding !== accountBinding) {
            throw new Error('The account changed while preparing the Project')
          }
          return saves.reidentifySavedBoard(currentId)
        })
        reidentified = true
        continue
      }
      throw new Error(`Could not prepare this Project for sharing: ${result.reason || 'sync failed'}`)
    }
    if (generation === documentChangeGeneration) { stable = true; break }
  }
  if (!stable) throw new Error('The board kept changing. Stop editing for a moment and try again.')
  return currentId
}

saves.onPrepareShare = (boardId: string) => prepareSavedBoardsForSharing(boardId)
saves.onCreateAgentLink = async (boardId: string): Promise<string> => {
  const finalBoardId = await prepareSavedBoardsForSharing(boardId)
  await flushSkillsForAgentLink(finalBoardId)
  const response = await fetch(boardAgentLinksUrl(), {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ board_id: finalBoardId }),
  })
  if (!response.ok) throw new Error(`The server returned ${response.status}.`)
  const data = await response.json() as { url?: unknown }
  if (typeof data.url !== 'string' || !data.url) throw new Error('The server returned no agent link.')
  return data.url
}

/**
 * Sync shortly, not repeatedly.
 *
 * Dragging a player writes the board on every autosave, and each of those is a
 * change worth sending — but sending each one separately would be a request per
 * gesture. A short wait collapses a flurry into one push and still reads as
 * immediate.
 */
const SYNC_DEBOUNCE = 700
function scheduleSync(delay = SYNC_DEBOUNCE, change: { shared: boolean } = { shared: false }): void {
  if (!(authenticated || entitlements.isPro())) return
  // A signed-in Free user pushes shared edits and, when chosen, one personal
  // backup. Other owned projects never leave the device.
  if (authenticated && !entitlements.isPro() && !change.shared
    && !selectedFreeBackup(localStorage, accountBinding)) return
  if (syncTimer !== null) clearTimeout(syncTimer)
  syncTimer = window.setTimeout(() => { syncTimer = null; void runSync() }, delay)
}

// Every write to the saved-boards record — save, rename, delete, autosave.
saves.onLocalChange = (change) => {
  updatePresence()
  scheduleSync(SYNC_DEBOUNCE, change ?? { shared: false })
  queueMicrotask(() => { void updateCollaborationChannel() })
}
// Asset storage has no project write to wake the normal sync path. Remote
// applications suppress this notification, so a pull cannot schedule a loop.
subscribeAssets(() => scheduleSync())
backgrounds.subscribe(source => { if (source !== 'remote') scheduleSync() })
subscribeStamps(() => scheduleSync())
teams.subscribeLibrary(() => scheduleSync())
categorySceneListeners.add(() => scheduleSync())

/* ----- the live channel -----
 *
 * The socket only ever says "changed", which this device answers with the same
 * sync it would have run anyway. Nothing is trusted from it and nothing is lost
 * without it.
 */
const liveChannel = live.createLiveChannel({
  deviceId: sync.deviceId(),
  enabled: () => authenticated || entitlements.isPro(),
  // A nudge means another device has already pushed, so there is nothing to
  // collapse: pull now.
  onChanged: () => { void runSync() },
})

/* ----- visual collaboration previews -----
 *
 * These frames are paint only. Durable Store events still take the existing
 * autosave/D1 route, so a lost preview simply falls back to normal sync.
 */
const collaborationDevice = sync.deviceId()
let remotePreviewTimer: number | null = null
let remoteRenderTimer: number | null = null
let remoteRenderScene: Scene | null = null
let remoteRenderedAt = 0
let localPointerActive = false
let localPreviewEndPending = false
let localPreviewGesture: string | null = null
const remoteOrder = collaboration.createPreviewOrder()

function setLiveEditStatus(visible: boolean) {
  if (liveEditChipEl.classList.contains('isVisible') === visible) return
  liveEditChipEl.classList.toggle('isVisible', visible)
  liveEditChipEl.textContent = visible ? 'Live edit' : ''
}

/** Hide paint only. Sequence/end ordering survives local control and expiry. */
function hideRemotePreview() {
  if (remotePreviewTimer !== null) { clearTimeout(remotePreviewTimer); remotePreviewTimer = null }
  if (remoteRenderTimer !== null) { clearTimeout(remoteRenderTimer); remoteRenderTimer = null }
  remoteRenderScene = null
  board.clearRemotePreview()
  setLiveEditStatus(false)
}

/** Reset ordering only when the room or authoritative durable state changes. */
function clearRemotePreview() {
  hideRemotePreview()
  remoteOrder.clear()
}

/** Sender and receiver are both capped at 30 visual renders per second. */
function renderRemotePreview(scene: Scene) {
  remoteRenderScene = scene
  const wait = Math.max(0, collaboration.PREVIEW_INTERVAL - (Date.now() - remoteRenderedAt))
  if (remoteRenderTimer !== null) return
  const render = () => {
    remoteRenderTimer = null
    const next = remoteRenderScene
    remoteRenderScene = null
    if (!next || localPointerActive) return
    remoteRenderedAt = Date.now()
    board.renderRemotePreview(next)
  }
  if (wait === 0) render()
  else remoteRenderTimer = window.setTimeout(render, wait)
}

function expireRemotePreview(phase: collaboration.PreviewPhase) {
  if (remotePreviewTimer !== null) clearTimeout(remotePreviewTimer)
  // An abandoned drag should disappear quickly. An end frame is useful until
  // the live nudge/pull has had a fair chance to replace it durably.
  remotePreviewTimer = window.setTimeout(hideRemotePreview, phase === 'end' ? 10_000 : 2_000)
}

const collaborationChannel = collaboration.createCollaborationChannel({
  deviceId: collaborationDevice,
  enabled: () => authenticated || entitlements.isPro(),
  // A socket drop is a room/disconnect boundary, so its ordering is no longer useful.
  onExpired: clearRemotePreview,
  onPreview: (message) => {
    const page = currentBoard()?.id
    if (!page || message.page !== page) return
    // Sequence numbers may reset on reconnect and are meaningful only within
    // one source's gesture. The order helper also suppresses ended gestures
    // and bounds both maps, including frames ignored during local control.
    if (!remoteOrder.accept(message)) return
    expireRemotePreview(message.phase)
    if (localPointerActive) return
    renderRemotePreview(message.scene)
  },
})

board.onPointerActivity = (active) => {
  localPointerActive = active
  if (active) hideRemotePreview()
}
board.onRemotePreviewVisibilityChange = setLiveEditStatus
board.onLivePreview = (phase, scene) => {
  if (saves.isCurrentReadOnly()) return
  const page = currentBoard()?.id
  if (!page) return
  localPreviewGesture ??= `preview-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`
  if (phase === 'end') {
    // Store.endGesture emits synchronously just after this callback. Do not
    // send that durable event twice; clear the marker for a no-op gesture.
    localPreviewEndPending = true
    queueMicrotask(() => { localPreviewEndPending = false })
  }
  collaborationChannel.preview(page, localPreviewGesture, phase, scene)
  if (phase === 'end') localPreviewGesture = null
}

/** Store emits once for a completed gesture and once for each discrete edit. */
store.subscribe(() => {
  if (swappingScene) return
  if (saves.isCurrentReadOnly()) return
  if (localPreviewEndPending) {
    localPreviewEndPending = false
    return
  }
  hideRemotePreview()
  const page = currentBoard()?.id
  if (!page) return
  const gesture = `preview-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`
  collaborationChannel.preview(page, gesture, 'end', () => store.scene)
})

async function updateCollaborationChannel(): Promise<void> {
  if (!(authenticated || entitlements.isPro())) {
    collaborationChannel.stop()
    return
  }
  const requestedGeneration = syncGeneration
  const requestedBinding = accountBinding
  const ready = await ensureBoardSession(requestedBinding)
  if (ready && requestedGeneration === syncGeneration && (authenticated || entitlements.isPro())) {
    collaborationChannel.start(saves.currentBoardId())
  } else collaborationChannel.stop()
}

collaborationBoardChanged = () => {
  clearRemotePreview()
  queueMicrotask(() => { void updateCollaborationChannel() })
}
clearCollaborationPreview = clearRemotePreview

async function updateLiveChannel(): Promise<void> {
  if (!(authenticated || entitlements.isPro())) {
    boardSessionReady = false
    liveChannel.stop()
    return
  }
  const requestedGeneration = syncGeneration
  const requestedBinding = accountBinding
  boardSessionReady = await ensureBoardSession(requestedBinding)
  if (boardSessionReady && requestedGeneration === syncGeneration && (authenticated || entitlements.isPro())) liveChannel.start()
  else liveChannel.stop()
}

// When entitlements change after session load, update UI elements that
// were rendered with the initial (fail-closed) state.
window.addEventListener('tbm:entitlements-changed', ((event: CustomEvent) => {
  // The Plans pane renders fail-closed on load, before the session answers,
  // so it has to be redrawn once the answer arrives.
  renderLicenseCta()
  renderProCta()
  saves.refresh()
  // Pro just resolved, which is the first moment sync is allowed to run.
  void runSync()
  void updateLiveChannel()
  void updateCollaborationChannel()
}) as EventListener)

// Development and preview builds already have automatic Pro. A session answer
// of false does not change entitlement state or emit an event, so initialize
// once after the listeners above are wired as well.
void updateCollaborationChannel()
void runSync()
void updateLiveChannel()

// Coming back to the tab is when another device's edits are most likely to be
// waiting, and it is also the cheapest moment to ask. With a live channel this
// is a fallback rather than the main path: a socket dropped while the tab was
// in the background is reconnected here.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return
  void runSync()
  liveChannel.poke()
  void updateCollaborationChannel()
})

// A network that has come back is worth one attempt straight away rather than
// at the end of whatever backoff step the channel had reached.
window.addEventListener('online', () => {
  void runSync()
  liveChannel.poke()
  void updateCollaborationChannel()
})

// Protect unsaved work: save the current board before the page unloads
// (tab close, navigation, refresh). The beforeunload handler persists
// the board synchronously via localStorage; the prompt only fires when
// there is genuinely unsaved work.
window.addEventListener('beforeunload', (event) => {
  saves.autosaveLive()
  // Only prompt if the board has objects that might be lost
  if (store.scene.objects.length > 0 && !saves.isCurrentSaved()) {
    event.preventDefault()
  }
})

// On visibility change (tab switch, app switch), silently persist the
// current board state. This covers mobile browsers that may kill the
// tab without firing beforeunload.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') saves.autosaveLive()
})

// When the tab comes back online after a network loss, re-check the
// TJ session. The header's session fetch will fire auth-changed which
// updates entitlements. This covers access-loss during offline periods.
window.addEventListener('online', () => {
  // The TJ header re-fetches session on visibility. Trigger a manual
  // session check to catch access changes that happened while offline.
  const header = document.querySelector('.site-header')
  if (header) {
    header.dispatchEvent(new CustomEvent('tj:refresh-session'))
  }
})

function addSharedProject(draft: AgentImportDraft, projectId: string | null): BoardImportResult {
  const source = migrateProject(draft.document)
  if (!source) return { status: 'failed', message: 'This project link is invalid.' }

  if (projectId) {
    const index = library.projects.findIndex(project => project.id === projectId)
    if (index < 0) return { status: 'failed', message: 'That project is no longer available.' }
    if (projectId === library.currentId) stashEditedBoard()
    const project = migrateProject(JSON.parse(JSON.stringify(library.projects[index])))!
    const firstBoardId = appendProjectCopy(project, source)[0]?.id ?? ''
    if (!saves.persistProjectDocuments([project])) {
      return { status: 'failed', message: 'The project could not be saved on this device.' }
    }
    library.projects[index] = project
    saveLibrary(library)
    boardsView.setLibrary(library)
    return { status: 'added', projectId: project.id, projectName: project.name, boardId: firstBoardId }
  }

  const project = newProjectFromProjectCopy(source, draft.name)
  if (!saves.persistProjectDocuments([project])) {
    return { status: 'failed', message: 'The project could not be saved on this device.' }
  }
  library.projects.push(project)
  saveLibrary(library)
  boardsView.setLibrary(library)
  return { status: 'added', projectId: project.id, projectName: project.name, boardId: project.boards[0].id }
}

function addSharedBoard(draft: AgentImportDraft, projectId: string | null): BoardImportResult {
  const imported = migrateProject(draft.document)
  if (!imported || imported.boards.length !== 1) return { status: 'failed', message: 'This board link is invalid.' }
  const source = imported.boards[0]

  if (projectId) {
    const index = library.projects.findIndex(project => project.id === projectId)
    if (index < 0) return { status: 'failed', message: 'That project is no longer available.' }
    if (projectId === library.currentId) stashEditedBoard()
    const project = migrateProject(JSON.parse(JSON.stringify(library.projects[index])))!
    const added = appendBoardCopy(project, source)
    if (!saves.persistProjectDocuments([project])) {
      return { status: 'failed', message: 'The board could not be saved on this device.' }
    }
    library.projects[index] = project
    saveLibrary(library)
    boardsView.setLibrary(library)
    return { status: 'added', projectId: project.id, projectName: project.name, boardId: added.id }
  }

  const project = newProjectFromBoard(source, draft.name)
  if (!saves.persistProjectDocuments([project])) {
    return { status: 'failed', message: 'The board could not be saved on this device.' }
  }
  library.projects.push(project)
  saveLibrary(library)
  boardsView.setLibrary(library)
  return { status: 'added', projectId: project.id, projectName: project.name, boardId: project.boards[0].id }
}

if (!BOARD_SELF_HOSTED) startAgentImport({
  saves,
  isPro: () => entitlements.isPro(),
  openSignIn,
  openPro: () => openSettings('pro'),
  openProjects: () => openProjectsScreen(),
  boardDestinations: () => {
    const readOnly = new Set(saves.projectDocuments().filter(row => row.readOnly).map(row => row.project.id))
    return orderedProjects(library).filter(project => !readOnly.has(project.id)).map(project => ({
      id: project.id,
      name: project.name,
      boardCount: project.boards.length,
    }))
  },
  canCreateProject: () => canCreateProject(library, entitlements.hasPaidBoardAccess()),
  addBoard: addSharedBoard,
  addProject: addSharedProject,
  openProject: openLibraryProject,
})

if (!BOARD_SELF_HOSTED) void recordProductEvent('editor_opened')

// debugging/testing handle
;(window as any).__tbm = { store, board, importer, saves, entitlements, backgrounds, pitchById, officialExtensions }
