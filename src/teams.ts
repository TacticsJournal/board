import { Store } from './store'
import { ToolDefaults } from './board'
import { PlayerObj, SceneObj, BOARD_W, emptyMatch, normalizeHex, uid, insertByTier } from './types'
import { icon } from './icons'
import { rosterByNumber } from './roster'
import type { PathNode } from './path-nodes'
import type { LibrarySyncStore, SyncedLibraryRecord } from './library-sync.ts'

/** Mirror one node across the halfway line, handles and all. */
function flipNodeX(n: PathNode) {
  n.x = BOARD_W - n.x
  if (n.h1) n.h1.x = -n.h1.x
  if (n.h2) n.h2.x = -n.h2.x
}

// TheSportsDB free/open API (test key "3", CORS-enabled) for club search
// and kit colors; squads come from Wikipedia, which stays current
const API = 'https://www.thesportsdb.com/api/v1/json/3'
const WIKI = 'https://en.wikipedia.org/w/api.php'

type TeamHit = { idTeam: string; strTeam: string; strTeamShort: string; strLeague: string; colours: string[]; loved?: number }
type RosterPlayer = { name: string; number: string; position: string }
type RosterPickItem = { team: string } & RosterPlayer
export type TeamSide = 'home' | 'away'
export type LoadedTeam = { name: string; short?: string; color: string; colours: string[]; roster: RosterPlayer[]; side?: TeamSide; slots?: { x: number; y: number; role?: string }[] }

// "Chelsea" -> CHE when the API has no short code; skip filler like FC/AFC
const CODE_FILLER = /^(a?fc|cf|sc|ac|as|ss|ssc|rc|cd|sv|de|club|real)$/i
export function teamCode(team: LoadedTeam): string {
  const short = team.short?.trim()
  if (short) return short.toUpperCase().slice(0, 4)
  const words = team.name.replace(/[^A-Za-z\s]/g, ' ').trim().split(/\s+/).filter(w => !CODE_FILLER.test(w))
  return (words[0] ?? team.name).slice(0, 3).toUpperCase()
}
export type TeamPanelOptions = {
  /** Optional localStorage key override. */
  storageKey?: string
  /** Optional teams to seed when no stored teams exist, or every time resetToSeed is true. */
  seedTeams?: LoadedTeam[]
  /** Replace the storage key with seedTeams on construction. */
  resetToSeed?: boolean
}

const TEAM_SIDES: TeamSide[] = ['home', 'away']
const MAX_LOADED_TEAMS = TEAM_SIDES.length

const TEAMS_KEY = 'tbm-teams-v1'
const TEAMS_SYNC_KEY = 'tbm-teams-sync-v1'
type TeamSyncMeta = { updatedAt: string; syncAccount?: string }
const INDEX_KEY = 'tbm-team-index-v2'
/** A month: club lists move at the pace of promotions, not of sessions. */
const INDEX_TTL = 30 * 24 * 60 * 60 * 1000
/**
 * The search endpoint matches a name, not a prefix: "ar" finds nothing and
 * "arsenal" finds one club. So the leagues most of this audience works in are
 * pulled once and kept, and typing filters them here — a letter is enough, and
 * several clubs come back. The endpoint still runs alongside for everything
 * these lists do not carry.
 */
const INDEX_LEAGUES = [
  'English Premier League', 'English League Championship', 'Spanish La Liga', 'German Bundesliga',
  'Italian Serie A', 'French Ligue 1', 'Dutch Eredivisie', 'Portuguese Primeira Liga',
  'Scottish Premiership', 'Belgian First Division A', 'Turkish Super Lig', 'Greek Superleague',
  'Brazilian Serie A', 'Argentinian Primera División', 'American Major League Soccer',
  'Mexican Primera League', 'Japanese J League', 'Saudi Pro League', 'Danish Superliga',
  'Norwegian Eliteserien', 'Swedish Allsvenskan', 'Australian A-League',
]
const FALLBACK_COLORS = ['#e02020', '#1e2f6f', '#16a34a', '#facc15']

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
const sideLabel = (side: TeamSide) => side === 'home' ? 'Home' : 'Away'

function positionRank(pos: string) {
  const p = pos.toLowerCase()
  if (/^(fw|fwd|forward|striker|winger|attacker)|\b(st|cf|lw|rw)\b/.test(p)) return 0
  if (/^(mf|mid|midfielder)|\b(cm|dm|am|lm|rm)\b/.test(p)) return 1
  if (/^(df|def|defender|back)|\b(cb|lb|rb|lwb|rwb)\b/.test(p)) return 2
  if (/^(gk|goalkeeper|keeper)\b/.test(p)) return 3
  return 1
}

function rosterAttackersFirst(roster: RosterPlayer[]) {
  return [...roster].sort((a, b) => positionRank(a.position) - positionRank(b.position))
}

async function wikiGet(params: Record<string, string>): Promise<any> {
  const qs = new URLSearchParams({ format: 'json', origin: '*', ...params })
  const res = await fetch(`${WIKI}?${qs}`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

/** Pull `{{fs player|...}}` / `{{nat fs g player|...}}` entries out of squad wikitext. */
function parseSquadWikitext(wt: string): RosterPlayer[] {
  const out: RosterPlayer[] = []
  const re = /\{\{\s*(?:fs player|football squad player|nat fs g player|nat fs player)\s*\|/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(wt))) {
    let depth = 1, i = re.lastIndex
    while (i < wt.length && depth > 0) {
      if (wt.startsWith('{{', i)) { depth++; i += 2 }
      else if (wt.startsWith('}}', i)) { depth--; i += 2 }
      else i++
    }
    let body = wt.slice(re.lastIndex, i - 2)
    re.lastIndex = i
    body = body.replace(/<ref[\s\S]*?(?:\/>|<\/ref>)/gi, '')
    while (/\{\{[^{}]*\}\}/.test(body)) body = body.replace(/\{\{[^{}]*\}\}/g, '')
    body = body.replace(/\[\[(?:[^\]|]*\|)?([^\]|]*)\]\]/g, '$1')
    const fields: Record<string, string> = {}
    for (const part of body.split('|')) {
      const eq = part.indexOf('=')
      if (eq < 0) continue
      fields[part.slice(0, eq).trim().toLowerCase()] = part.slice(eq + 1).trim()
    }
    const name = (fields.name ?? '').replace(/<[^>]*>/g, '').trim()
    if (!name) continue
    out.push({ name, number: (fields.no ?? '').trim(), position: (fields.pos ?? '').trim() })
  }
  return out
}

/** Current squad from the team's Wikipedia article (clubs and national teams). */
async function wikiSquad(team: string): Promise<RosterPlayer[] | null> {
  const search = await wikiGet({ action: 'query', list: 'search', srsearch: `${team} football`, srlimit: '6' })
  const titles: string[] = (search.query?.search ?? [])
    .map((s: any) => s.title as string)
    .filter(t => !/season|list of|w\.f\.c|women|under-\d|records|history/i.test(t))
    .slice(0, 3)
  for (const title of titles) {
    try {
      const sec = await wikiGet({ action: 'parse', page: title, prop: 'sections' })
      const sections: any[] = sec.parse?.sections ?? []
      const hit = sections.find(s => /^current squad/i.test(s.line))
        ?? sections.find(s => /first[ -]team squad/i.test(s.line))
        ?? sections.find(s => /^(squad|players)$/i.test(s.line))
      if (!hit) continue
      const wt = await wikiGet({ action: 'parse', page: title, prop: 'wikitext', section: String(hit.index) })
      const roster = parseSquadWikitext(wt.parse?.wikitext?.['*'] ?? '')
      if (roster.length >= 5) return roster
    } catch { /* try the next candidate page */ }
  }
  return null
}

export class TeamPanel {
  el: HTMLDivElement
  /** Home/Away teams loaded on this device; rendered as quick chips in the Player menu. */
  loaded: LoadedTeam[] = []
  /** Set by main: drops a starting XI for the named team onto the board. */
  onAddLineup: (name: string) => void = () => {}
  /** Set by main: the panel lives in the Settings sheet (Configure > Teams),
      so open/close delegate to the sheet's tab navigation. */
  onOpen: () => void = () => {}
  onClose: () => void = () => {}
  /** Set by main: the Settings root list mirrors each side, so it re-reads on change. */
  onChangedSides: () => void = () => {}
  private teams: TeamHit[] = []
  private roster: RosterPlayer[] = []
  private teamName = ''
  private placed = 0
  private editingSide: TeamSide = 'home'
  private storageKey: string
  private syncKey: string
  private readonly baseStorageKey: string
  private readonly baseSyncKey: string
  private libraryAccount: string | null = null
  private syncMeta: TeamSyncMeta
  private syncInitialized = false
  private libraryListeners = new Set<() => void>()
  private searchTimer: number | null = null
  private searchSeq = 0
  private loadSeq = 0
  /** Clubs from the big leagues, kept so a single letter can answer. */
  private index: TeamHit[] = []
  private indexing: Promise<void> | null = null

  constructor(
    private store: Store,
    private defaults: ToolDefaults,
    host: HTMLElement,
    private onChanged: () => void,
    options: TeamPanelOptions = {},
  ) {
    this.storageKey = options.storageKey ?? TEAMS_KEY
    this.syncKey = this.storageKey === TEAMS_KEY ? TEAMS_SYNC_KEY : `${this.storageKey}-sync`
    this.baseStorageKey = this.storageKey
    this.baseSyncKey = this.syncKey
    this.syncMeta = this.readSyncMeta()
    if (options.seedTeams && (options.resetToSeed || !localStorage.getItem(this.storageKey))) {
      try { localStorage.setItem(this.storageKey, JSON.stringify(options.seedTeams)) } catch { /* private mode */ }
    }
    try {
      const raw = JSON.parse(localStorage.getItem(this.storageKey) ?? '[]')
      this.loaded = this.hydrateLoaded(raw)
    } catch { this.loaded = options.seedTeams ? this.hydrateLoaded(options.seedTeams) : [] }
    this.el = document.createElement('div')
    this.el.className = 'tmPane'
    this.el.innerHTML = `
      <div class="tmSides" data-tm="sides"></div>
      <div class="setGroupHead">Board</div>
      <div class="setGroup">
        <button class="setItem" data-tm="swap">${icon('arrows-exchange')}<span class="setItemLabel">Swap home and away</span><span class="setItemValue" data-tm="swapHint"></span></button>
        <button class="setItem" data-tm="flip-board">${icon('flip-horizontal')}<span class="setItemLabel">Flip board</span></button>
      </div>
      <div class="tmStatus setNote" data-tm="status"></div>
      <div data-tm="rosterHead" hidden></div>
      <div data-tm="roster" hidden></div>`
    host.appendChild(this.el)
    this.bind()
    this.setEditingSide('home', false)
    // teams loaded in an earlier session: fill in any missing corner codes
    if (this.loaded.length) this.fillMatchCodes()
  }

  open() { this.onOpen() }
  close() { this.onClose() }
  /** Open the sheet with one side highlighted for configuration. */
  openSide(side: TeamSide) {
    this.open()
    this.focusSide(side)
  }

  /** Put the caret in one side's own search field; used when Settings pushes here. */
  focusSide(side: TeamSide) {
    this.setEditingSide(side)
    this.queryFor(side)?.focus()
  }

  private q(k: string) { return this.el.querySelector(`[data-tm="${k}"]`) as HTMLElement }
  private status(s: string) { this.q('status').textContent = s }

  getTeamForSide(side: TeamSide) {
    return this.loaded.find(t => t.side === side)
  }

  activeTeamName() { return this.teamName || null }

  getTeam(name: string) { return this.loaded.find(t => t.name === name) }

  /** Local setup writes wake account sync; remote applications intentionally do not. */
  subscribeLibrary(fn: () => void) { this.libraryListeners.add(fn); return () => this.libraryListeners.delete(fn) }

  /** Keep fixed-id team setup rows separate when different accounts use one browser. */
  activateLibraryAccount(account: string | null) {
    if (!account || account === this.libraryAccount) return
    const storageKey = `${this.baseStorageKey}:${account}`
    const syncKey = `${this.baseSyncKey}:${account}`
    let stored: string | null = null
    try { stored = localStorage.getItem(storageKey) } catch { /* private mode */ }
    if (stored === null) {
      const baseState = this.readSyncMetaAt(this.baseSyncKey)
      const canClaim = !baseState.meta.syncAccount || baseState.meta.syncAccount === account
      const hasLegacyRecord = this.loaded.length > 0 || baseState.initialized
      if (canClaim && hasLegacyRecord) {
        const claimed = { ...baseState.meta, syncAccount: account }
        try {
          localStorage.setItem(storageKey, JSON.stringify(this.loaded))
          localStorage.setItem(syncKey, JSON.stringify(claimed))
          localStorage.setItem(this.baseSyncKey, JSON.stringify(claimed))
        } catch { /* private mode */ }
      }
    }
    this.storageKey = storageKey
    this.syncKey = syncKey
    this.libraryAccount = account
    this.syncInitialized = false
    this.syncMeta = this.readSyncMeta()
    try { this.loaded = this.hydrateLoaded(JSON.parse(localStorage.getItem(this.storageKey) ?? '[]')) } catch { this.loaded = [] }
    this.teams = []
    this.roster = []
    this.clearResults()
    this.setEditingSide('home')
  }

  librarySyncStore(): LibrarySyncStore {
    return {
      // A fresh device with no setup has no record to push. This lets an
      // existing account setup pull instead of tying an empty 2000 revision.
      list: () => !this.syncInitialized && !this.loaded.length ? [] : [{
        id: 'team-setup', kind: 'team_setup' as const, name: 'Team setup', payload: { teams: this.loaded },
        updatedAt: this.syncMeta.updatedAt, ...(this.syncMeta.syncAccount ? { syncAccount: this.syncMeta.syncAccount } : {}),
      }],
      apply: (record) => this.applyLibraryRecord(record),
      bind: (ids, account) => {
        if (!ids.includes('team-setup') || (this.syncMeta.syncAccount && this.syncMeta.syncAccount !== account)) return
        this.syncInitialized = true
        this.syncMeta = { ...this.syncMeta, syncAccount: account }
        this.persistSyncMeta()
      },
    }
  }

  private readSyncMetaAt(key: string): { meta: TeamSyncMeta; initialized: boolean } {
    try {
      const raw = JSON.parse(localStorage.getItem(key) ?? '{}')
      if (typeof raw.updatedAt === 'string' && Number.isFinite(Date.parse(raw.updatedAt))) {
        return {
          initialized: true,
          meta: { updatedAt: raw.updatedAt, ...(typeof raw.syncAccount === 'string' && raw.syncAccount ? { syncAccount: raw.syncAccount } : {}) },
        }
      }
    } catch { /* legacy setup gets an old but valid revision */ }
    return { initialized: false, meta: { updatedAt: new Date(Date.UTC(2000, 0, 1)).toISOString() } }
  }

  private readSyncMeta(): TeamSyncMeta {
    const state = this.readSyncMetaAt(this.syncKey)
    this.syncInitialized = state.initialized
    return state.meta
  }

  private persistSyncMeta() {
    try { localStorage.setItem(this.syncKey, JSON.stringify(this.syncMeta)) } catch { /* private mode */ }
  }

  private markLibraryChanged() {
    const prior = Date.parse(this.syncMeta.updatedAt)
    this.syncInitialized = true
    this.syncMeta = { ...this.syncMeta, updatedAt: new Date(Math.max(Date.now(), Number.isFinite(prior) ? prior + 1 : 0)).toISOString() }
    this.persistSyncMeta()
    for (const fn of this.libraryListeners) fn()
  }

  private applyLibraryRecord(record: SyncedLibraryRecord) {
    if (record.kind !== 'team_setup' || record.id !== 'team-setup') return
    if (record.syncAccount && record.syncAccount !== this.libraryAccount) return
    if (this.syncInitialized && Date.parse(this.syncMeta.updatedAt) >= Date.parse(record.updatedAt)) return
    const teams = record.deleted ? [] : record.payload && typeof record.payload === 'object'
      ? (record.payload as Record<string, unknown>).teams : []
    this.loaded = this.hydrateLoaded(teams)
    try { localStorage.setItem(this.storageKey, JSON.stringify(this.loaded)) } catch { /* private mode */ }
    this.syncInitialized = true
    this.syncMeta = { updatedAt: record.updatedAt, ...(record.syncAccount ? { syncAccount: record.syncAccount } : {}) }
    this.persistSyncMeta()
    this.teams = []
    this.roster = []
    this.clearResults()
    // This only rerenders the reusable setup. It never calls syncMatchCodes,
    // so a pulled setup cannot rewrite the Project currently being edited.
    this.setEditingSide('home')
  }

  /**
   * Point the roster and dot defaults at one side without touching the side
   * markup. Focusing a side's search field runs through here: re-rendering
   * would replace the very input being typed into and drop the keystroke.
   */
  private setActiveSide(side: TeamSide, notify = true) {
    this.editingSide = side
    const team = this.getTeamForSide(side)
    this.teamName = team?.name ?? ''
    this.roster = team?.roster ? rosterAttackersFirst(team.roster) : []
    this.placed = 0
    if (team) this.defaults.playerColor = team.color
    this.renderRoster()
    this.q('rosterHead').textContent = team ? `${team.name} squad` : ''
    this.status(this.sideStatus(side))
    if (notify) this.onChanged()
  }

  private setEditingSide(side: TeamSide, notify = true) {
    if (side !== this.editingSide) {
      this.searchSeq++
      this.loadSeq++
    }
    this.setActiveSide(side, false)
    this.renderSides()
    this.onChangedSides()
    if (notify) this.onChanged()
  }

  /* ---------- home/away picker ---------- */

  /** The one editor always belongs to the selected side. */
  private editorBody(side: TeamSide) {
    const team = this.getTeamForSide(side)
    const label = sideLabel(side)
    if (!team) return `<div class="tmEmpty">No ${label.toLowerCase()} team yet.<br>Search above to set one.</div>`

    const kit = team.colours.map(c =>
      `<button class="sw ${c === team.color ? 'active' : ''}" data-tm="color" data-side="${side}" data-v="${c}" style="background:${c}" aria-pressed="${c === team.color}" aria-label="Kit color ${c}"></button>`).join('')
    const players = this.store.scene.objects.filter((o): o is PlayerObj => o.type === 'player')
    const expected = team.slots?.length || 11
    const lineupAdded = this.teamPlayers(players, team).length >= expected
    const lineup = lineupAdded
      ? `<div class="setItem setItemStatic">
          ${icon('users')}
          <span class="setItemLabel">Starting XI</span>
          <span class="setItemValue">Added</span>
          ${icon('check', 'ic tmAddedTick')}
        </div>`
      : `<button class="setItem" data-tm="add-xi" data-side="${side}">
          ${icon('users')}
          <span class="setItemLabel">Add starting XI</span>
          <span class="setItemValue">11 players</span>
        </button>`
    return `<div class="setItem setItemStatic">
        <span class="setItemLabel">Dots use</span>
        <span class="tmCardKit" role="group" aria-label="${label} kit color">${kit}</span>
      </div>
      ${lineup}
      <button class="setItem tmClear" data-tm="clear" data-side="${side}" type="button">
        ${icon('x')}
        <span class="setItemLabel">Clear ${label.toLowerCase()} team</span>
      </button>`
  }

  private renderSides() {
    const oldQuery = this.el.querySelector<HTMLInputElement>('[data-tm="query"]')
    const previous = oldQuery?.dataset.side === this.editingSide ? oldQuery.value : ''
    const cards = TEAM_SIDES.map(side => {
      const team = this.getTeamForSide(side)
      const label = sideLabel(side)
      return `<button class="tmSideCard" data-tm="pick-side" data-side="${side}" type="button"
          role="radio" aria-checked="${side === this.editingSide}" tabindex="${side === this.editingSide ? 0 : -1}">
        <span class="tmSideTag">${label}</span>
        <span class="tmSideBody">
          <span class="setDot ${team ? '' : 'setDotEmpty'}"${team ? ` style="background:${team.color}"` : ''}></span>
          <span class="tmSideName ${team ? '' : 'muted'}">${team ? esc(team.name) : 'Not set'}</span>
        </span>
        <span class="tmSideMeta">${team ? `${team.roster.length} players` : 'Tap to set'}</span>
      </button>`
    }).join('')
    const team = this.getTeamForSide(this.editingSide)
    const label = sideLabel(this.editingSide)
    this.q('sides').innerHTML = `
      <div class="tmSideSwitch" role="radiogroup" aria-label="Side being edited">${cards}</div>
      <div class="setGroupHead">${label} team</div>
      <div class="setGroup tmEditor">
        <label class="setItem setSearchItem">
          ${icon('search')}
          <input class="setSearch" data-tm="query" data-side="${this.editingSide}" maxlength="40" enterkeyhint="search"
                 aria-label="Search teams for the ${label.toLowerCase()} side"
                 placeholder="${team ? `Search to change the ${label.toLowerCase()} team` : 'Search a club or national team'}">
          <span class="tmSearchSide" aria-hidden="true">${label}</span>
        </label>
        <div class="tmResults tmEditorBody" data-tm="results" data-side="${this.editingSide}">${this.editorBody(this.editingSide)}</div>
      </div>`
    const input = this.queryFor(this.editingSide)
    if (input) input.value = previous

    const canSwap = TEAM_SIDES.every(s => this.getTeamForSide(s))
    const swap = this.q('swap') as HTMLButtonElement | null
    if (swap) {
      swap.disabled = !canSwap
      swap.classList.toggle('setItemMuted', !canSwap)
      ;(this.q('swapHint') as HTMLElement).textContent = canSwap ? '' : 'Set both teams first'
    }
  }

  private queryFor(side: TeamSide) {
    return this.el.querySelector<HTMLInputElement>(`[data-tm="query"][data-side="${side}"]`)
  }

  private resultsFor(side: TeamSide) {
    return this.el.querySelector<HTMLElement>(`[data-tm="results"][data-side="${side}"]`)
  }

  private clearResults() {
    this.teams = []
    const box = this.resultsFor(this.editingSide)
    if (box) box.innerHTML = this.editorBody(this.editingSide)
    const input = this.queryFor(this.editingSide)
    if (input) input.value = ''
  }

  /** Players belonging to a team. Untagged legacy dots count only when no
      other loaded team owns the same color. */
  private teamPlayers(objects: PlayerObj[], team: LoadedTeam) {
    const colorShared = this.loaded.some(t => t.name !== team.name && t.color === team.color)
    return objects.filter(o => o.team === team.name || (!colorShared && !o.team && o.color === team.color))
  }

  /** When a side is replaced, keep the existing board shape but move those dots to the new team/color. */
  private retagReplacedTeam(previous: LoadedTeam | null, next: LoadedTeam) {
    if (!previous || previous.name === next.name) return
    const players = this.store.scene.objects.filter((o): o is PlayerObj => o.type === 'player')
    const affected = this.teamPlayers(players, previous)
    if (!affected.length) return
    const oldColor = previous.color
    this.store.apply(() => {
      for (const o of affected) {
        const wasTagged = o.team === previous.name
        const wasKitColor = o.color === oldColor
        if (wasTagged || (!o.team && wasKitColor)) o.team = next.name
        // Preserve goalkeepers and deliberately custom-colored dots.
        if (wasKitColor) o.color = next.color
      }
    })
  }

  setTeamColor(name: string, color: string) {
    const team = this.getTeam(name)
    if (!team || team.color === color) return
    const old = team.color
    team.color = color
    if (!team.colours.includes(color)) team.colours = [color, ...team.colours]
    this.persistLoaded()
    this.store.apply(s => {
      const players = s.objects.filter((o): o is PlayerObj => o.type === 'player')
      // only dots still wearing the old kit color change, so goalkeepers
      // and custom-colored dots keep theirs
      for (const o of this.teamPlayers(players, { ...team, color: old })) {
        if (o.color === old) o.color = color
      }
    })
    if (this.teamName === name) this.defaults.playerColor = color
    this.renderSides()
    this.onChanged()
  }

  /** Mirror every object across the halfway line: both teams, ball, arrows, zones, text. */
  private mirrorObjects(objects: SceneObj[]) {
    for (const o of objects) {
      if (o.type === 'arrow') {
        o.x1 = BOARD_W - o.x1
        o.x2 = BOARD_W - o.x2
        o.mx = BOARD_W - o.mx
        if (o.points) for (const n of o.points) flipNodeX(n)
      } else if (o.type === 'text') {
        // text anchors at its left edge; mirror the whole box, not the anchor
        const estWidth = o.text.length * o.size * 0.62
        o.x = BOARD_W - o.x - estWidth
        o.rotation = -(o.rotation ?? 0)
      } else if (o.type === 'box') {
        o.x = BOARD_W - o.x
        o.rotation = -(o.rotation ?? 0)
        // the nodes are the zone: mirroring its centre alone would leave the
        // shape sitting where it was
        if (o.corners) for (const n of o.corners) flipNodeX(n)
      } else {
        o.x = BOARD_W - o.x
      }
    }
  }

  flipBoard() {
    this.store.apply(s => {
      this.mirrorObjects(s.objects)
      if (s.match) {
        const m = { ...emptyMatch(), ...s.match }
        ;[m.home, m.away] = [m.away, m.home]
        ;[m.homeScore, m.awayScore] = [m.awayScore, m.homeScore]
        s.match = m
      }
    })
  }

  /** Swap which team is home/away and mirror the whole board with them. */
  swapSides() {
    const home = this.getTeamForSide('home')
    const away = this.getTeamForSide('away')
    if (!home || !away) return
    home.side = 'away'
    away.side = 'home'
    this.persistLoaded()
    this.store.apply(s => {
      this.mirrorObjects(s.objects)
      if (s.match) {
        const m = { ...emptyMatch(), ...s.match }
        ;[m.home, m.away] = [m.away, m.home]
        ;[m.homeScore, m.awayScore] = [m.awayScore, m.homeScore]
        s.match = m
      }
    })
    this.setEditingSide(this.editingSide)
  }

  /* ---------- persistence ---------- */

  private normalizeTeamSide(v: unknown): TeamSide | null {
    return v === 'home' || v === 'away' ? v : null
  }

  private normalizeTeam(raw: any): LoadedTeam | null {
    if (!raw || typeof raw !== 'object' || typeof raw.name !== 'string' || !raw.name.trim()) return null
    const side = this.normalizeTeamSide(raw.side)
    const rosterRaw = Array.isArray(raw.roster) ? raw.roster : []
    const roster: RosterPlayer[] = rosterRaw
      .map((p: any) => ({
        name: typeof p?.name === 'string' ? p.name : '',
        number: typeof p?.number === 'string' ? p.number : '',
        position: typeof p?.position === 'string' ? p.position : '',
      }))
      .filter(p => !!p.name)
    const colorsRaw = Array.isArray(raw.colours) ? raw.colours : []
    const colours = colorsRaw
      .map((c: any) => normalizeHex(typeof c === 'string' ? c : ''))
      .filter((c: string | null): c is string => Boolean(c))

    const slotsRaw = Array.isArray(raw.slots) ? raw.slots : []
    const slots: { x: number; y: number; role?: string }[] | undefined = slotsRaw.length
      ? slotsRaw
          .filter((s: any) => s && typeof s.x === 'number' && typeof s.y === 'number')
          .map((s: any) => ({ x: s.x as number, y: s.y as number, ...(typeof s.role === 'string' ? { role: s.role } : {}) }))
      : undefined

    return {
      name: raw.name.trim(),
      short: typeof raw.short === 'string' ? raw.short.trim() : '',
      color: normalizeHex(typeof raw.color === 'string' ? raw.color : '') || colours[0] || FALLBACK_COLORS[0],
      colours,
      roster,
      side,
      ...(slots ? { slots } : {}),
    }
  }

  private hydrateLoaded(raw: unknown): LoadedTeam[] {
    if (!Array.isArray(raw)) return []
    const seen = new Set<string>()
    const buckets: Record<TeamSide, LoadedTeam | null> = { home: null, away: null }
    const leftovers: LoadedTeam[] = []
    for (const item of raw) {
      const team = this.normalizeTeam(item)
      if (!team) continue
      const key = team.name.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)

      if (team.side) {
        const slot = buckets[team.side]
        if (!slot) buckets[team.side] = team
        else leftovers.push(team)
      } else {
        leftovers.push(team)
      }
    }

    const out: LoadedTeam[] = [buckets.home, buckets.away].filter(Boolean) as LoadedTeam[]
    for (const side of TEAM_SIDES) {
      if (out.find(t => t.side === side)) continue
      const team = leftovers.shift()
      if (!team) break
      team.side = side
      out.push(team)
    }
    return out.slice(0, MAX_LOADED_TEAMS)
  }

  private persistLoaded() {
    try { localStorage.setItem(this.storageKey, JSON.stringify(this.loaded)) } catch { /* storage full */ }
    this.markLibraryChanged()
  }

  /** Fill blank match names from the loaded sides with the team's code, the
      way a scoreboard writes them: ARS, not Arsenal. A slot still holding the
      full name is shortened to match; a name typed by hand is left alone. */
  private fillMatchCodes() {
    const home = this.getTeamForSide('home')
    const away = this.getTeamForSide('away')
    const m0 = this.store.scene.match
    const resolve = (current: string | undefined, team: LoadedTeam | undefined) => {
      if (!team) return null
      const code = teamCode(team)
      // blank slot, or a slot still holding this team's full name -> the code
      if (!current || current === team.name) {
        return current === code ? null : code
      }
      return null
    }
    const nextHome = resolve(m0?.home, home)
    const nextAway = resolve(m0?.away, away)
    if (nextHome == null && nextAway == null) return
    this.store.apply(s => {
      const m = { ...emptyMatch(), ...s.match }
      if (nextHome != null) m.home = nextHome
      if (nextAway != null) m.away = nextAway
      m.showTeams = true
      s.match = m
    })
  }

  /** Team codes follow the loaded sides into the bottom corners of the board. */
  private syncMatchCodes() {
    const home = this.getTeamForSide('home')
    const away = this.getTeamForSide('away')
    this.store.apply(s => {
      const m = { ...emptyMatch(), ...s.match }
      m.home = home ? teamCode(home) : ''
      m.away = away ? teamCode(away) : ''
      if (home || away) m.showTeams = true
      s.match = m
    })
  }

  resetTeams(teams: LoadedTeam[]) {
    this.loaded = this.hydrateLoaded(teams)
    this.persistLoaded()
    this.teams = []
    this.roster = []
    this.clearResults()
    this.setEditingSide('home')
  }

  private clearSide(side: TeamSide) {
    this.loaded = this.loaded.filter(t => t.side !== side)
    this.persistLoaded()
    this.syncMatchCodes()
    this.teams = []
    this.clearResults()
    this.setEditingSide(side)
  }

  private remember(team: LoadedTeam) {
    const current = this.loaded.find(t => t.name === team.name)
    const incoming = { ...current, ...team, side: team.side ?? current?.side }
    incoming.side = incoming.side || (this.loaded.some(t => t.side === 'home') ? 'away' : 'home')
    const replaced = this.loaded.find(t => t.side === incoming.side && t.name !== incoming.name) ?? null

    // exactly one team per side, with the incoming team owning its side.
    this.loaded = [
      ...this.loaded.filter(t => t.name !== incoming.name && t.side !== incoming.side),
      incoming,
    ]
    const ordered: LoadedTeam[] = []
    for (const side of TEAM_SIDES) {
      const found = this.loaded.find(t => t.side === side)
      if (found && !ordered.includes(found)) ordered.push(found)
    }
    this.loaded = ordered.slice(0, MAX_LOADED_TEAMS)
    this.persistLoaded()
    this.syncMatchCodes()
    this.retagReplacedTeam(replaced, incoming)
  }

  /* ---------- search + load ---------- */

  private bind() {
    this.el.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest('[data-tm]') as HTMLElement | null
      if (!btn) return
      const k = btn.dataset.tm
      const side = this.normalizeTeamSide(btn.dataset.side)
      if (k === 'pick-side' && side) {
        const changed = side !== this.editingSide
        if (changed) this.setEditingSide(side)
        if (!this.getTeamForSide(side)) this.queryFor(side)?.focus()
        else if (changed) this.el.querySelector<HTMLElement>(`[data-tm="pick-side"][data-side="${side}"]`)?.focus()
      }
      else if (k === 'add-xi' && side) {
        const team = this.getTeamForSide(side)
        if (!team) return
        this.setEditingSide(side)
        this.onAddLineup(team.name)
        this.close()
      }
      else if (k === 'flip-board') { this.flipBoard(); this.close() }
      else if (k === 'swap') this.swapSides()
      else if (k === 'color' && side) {
        const team = this.getTeamForSide(side)
        if (team) this.setTeamColor(team.name, btn.dataset.v!)
      }
      else if (k === 'clear' && side) this.clearSide(side)
      else if (k === 'search') this.search()
      else if (k === 'team') this.loadTeam(btn.dataset.id!, btn.dataset.name!, this.sideOf(btn) ?? this.editingSide)
      else if (k === 'pick') this.pick(Number(btn.dataset.i))
    })
    // The radio cards use arrow keys; the one search field keeps Enter.
    this.el.addEventListener('keydown', (e) => {
      const card = (e.target as HTMLElement).closest('[data-tm="pick-side"]') as HTMLElement | null
      if (card && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
        const side: TeamSide = card.dataset.side === 'home' ? 'away' : 'home'
        e.preventDefault()
        this.setEditingSide(side)
        this.el.querySelector<HTMLElement>(`[data-tm="pick-side"][data-side="${side}"]`)?.focus()
        e.stopPropagation()
        return
      }
      const input = (e.target as HTMLElement).closest('[data-tm="query"]') as HTMLInputElement | null
      if (!input) return
      if (e.key === 'Enter') this.search()
      e.stopPropagation()
    })
    this.el.addEventListener('focusin', (e) => {
      const query = (e.target as HTMLElement).closest('[data-tm="query"]') as HTMLElement | null
      if (query) void this.ensureIndex()
      const side = this.normalizeTeamSide(query?.dataset.side)
      if (side && side !== this.editingSide) this.setActiveSide(side)
    })
    this.el.addEventListener('input', (e) => {
      const input = (e.target as HTMLElement).closest('[data-tm="query"]') as HTMLInputElement | null
      if (!input) return
      const side = this.normalizeTeamSide(input.dataset.side) ?? this.editingSide
      if (side !== this.editingSide) this.setActiveSide(side)
      this.searchSeq++
      if (this.searchTimer) window.clearTimeout(this.searchTimer)
      const typed = input.value.trim()
      if (!typed) {
        this.teams = []
        const box = this.resultsFor(side)
        if (box) box.innerHTML = this.editorBody(side)
        this.status(this.sideStatus(side))
        return
      }
      // the index answers the first letter at once; the endpoint follows
      this.showMatches(side, this.indexMatches(typed), true)
      this.searchTimer = window.setTimeout(() => this.search(true), 200)
    })
  }

  /** Which side a clicked control belongs to, walking up to its side group. */
  private sideOf(el: HTMLElement) {
    return this.normalizeTeamSide((el.closest('[data-side]') as HTMLElement | null)?.dataset.side)
  }

  private sideStatus(side: TeamSide) {
    const team = this.getTeamForSide(side)
    return team
      ? `${team.name} is ${sideLabel(side).toLowerCase()}. Choose a kit color or search to replace it.`
      : `${sideLabel(side)} team is not set. Search a club or national team to load it.`
  }

  /**
   * Draw whatever has been found so far. The index and the endpoint both feed
   * this, in that order, so the list fills in rather than flashing empty.
   */
  private showMatches(side: TeamSide, hits: TeamHit[], provisional: boolean) {
    const seen = new Set<string>()
    const list = hits.filter(t => !seen.has(t.idTeam) && seen.add(t.idTeam)).slice(0, 8)
    this.teams = list
    const results = this.resultsFor(side)
    if (!list.length) {
      if (!provisional) this.status('No clubs found for that name.')
      if (results && !provisional) {
        results.innerHTML = '<div class="tmEmpty">No clubs or national teams match that search.</div>'
        this.revealResults(side)
      }
      return
    }
    this.status(`Pick the ${sideLabel(side).toLowerCase()} team:`)
    if (results) results.innerHTML = list.map(t => `
      <button class="tmTeam" data-tm="team" data-id="${t.idTeam}" data-name="${esc(t.strTeam)}">
        <span class="setDot tmTeamPlayer" style="background:${t.colours[0] ?? FALLBACK_COLORS[side === 'home' ? 0 : 1]}"></span>
        <span class="tmTeamName">${esc(t.strTeam)}</span>
        <span class="tmTeamLeague">${esc(t.strLeague)}</span>
      </button>`).join('')
    this.revealResults(side)
  }

  /**
   * Results arrive after the field was scrolled into place, so on a phone with
   * the keyboard up they land below the fold. Lift the field to the top of
   * what is visible so the first rows sit right under the query. Nothing is
   * focused or re-rendered here: the caret and the typed text stay put, and a
   * list that already has room is left alone so the sheet does not fight a
   * scroll the reader started.
   */
  private revealResults(side: TeamSide) {
    const input = this.queryFor(side)
    const results = this.resultsFor(side)
    if (!input || !results || document.activeElement !== input) return
    const vv = window.visualViewport
    const visibleBottom = (vv?.offsetTop ?? 0) + (vv?.height ?? window.innerHeight)
    // one row plus its border: less than that below the field is not a list
    if (results.getBoundingClientRect().top <= visibleBottom - 64) return
    const target = input.closest('.setSearchItem') ?? input
    target.scrollIntoView({
      block: 'start',
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    })
  }

  /**
   * The clubs to filter against: the list shipped with the board first, since
   * it costs no request and cannot be rate limited, then what was cached, and
   * only then the endpoint league by league.
   */
  private ensureIndex(): Promise<void> {
    if (this.indexing) return this.indexing
    try {
      const raw = JSON.parse(localStorage.getItem(INDEX_KEY) ?? 'null')
      if (raw && Date.now() - raw.at < INDEX_TTL && Array.isArray(raw.teams) && raw.teams.length) {
        this.index = raw.teams
        this.indexing = Promise.resolve()
        return this.indexing
      }
    } catch { /* a bad cache is the same as no cache */ }
    this.indexing = (async () => {
      try {
        const res = await fetch('teams-index.json')
        if (res.ok) {
          const data = await res.json()
          if (Array.isArray(data.teams) && data.teams.length) {
            this.index = data.teams
            return
          }
        }
      } catch { /* shipped file missing: fall through to the endpoint */ }
      const seen = new Map<string, TeamHit>()
      // one league at a time: this is a background courtesy, and a burst is
      // what trips the shared key's rate limit
      let limited = false
      for (const league of INDEX_LEAGUES) {
        if (limited) break
        {
          try {
            const res = await fetch(`${API}/search_all_teams.php?l=${encodeURIComponent(league)}`)
            if (res.status === 429) { limited = true; break }
            if (!res.ok) continue
            const data = await res.json()
            for (const t of data.teams ?? []) {
              if (t.strSport !== 'Soccer' || seen.has(t.idTeam)) continue
              seen.set(t.idTeam, {
                idTeam: t.idTeam,
                strTeam: t.strTeam,
                strTeamShort: t.strTeamShort ?? '',
                strLeague: t.strLeague ?? league,
                colours: [t.strColour1, t.strColour2, t.strColour3].map((c: string) => normalizeHex(c ?? '')).filter(Boolean) as string[],
                loved: Number(t.intLoved) || 0,
              })
            }
          } catch { /* one league missing is not a failure */ }
        }
      }
      this.index = [...seen.values()].sort((a, b) => a.strTeam.localeCompare(b.strTeam))
      // a partial index is worth keeping, but not for a month
      if (this.index.length) {
        const at = limited ? Date.now() - INDEX_TTL + 60 * 60 * 1000 : Date.now()
        try { localStorage.setItem(INDEX_KEY, JSON.stringify({ at, teams: this.index })) } catch { /* full is fine */ }
      }
      if (limited) this.indexing = null
    })()
    return this.indexing
  }

  /**
   * What the index knows: names that start with the query first, and inside
   * each group the better-known clubs first, so one letter answers with sides
   * somebody might actually be drawing.
   */
  private indexMatches(q: string): TeamHit[] {
    const needle = q.toLowerCase()
    const starts: TeamHit[] = []
    const holds: TeamHit[] = []
    for (const team of this.index) {
      const name = team.strTeam.toLowerCase()
      if (name.startsWith(needle)) starts.push(team)
      else if (name.includes(needle)) holds.push(team)
    }
    const known = (a: TeamHit, b: TeamHit) => (b.loved ?? 0) - (a.loved ?? 0) || a.strTeam.localeCompare(b.strTeam)
    return [...starts.sort(known), ...holds.sort(known)]
  }

  private async search(isAutocomplete = false) {
    const side = this.editingSide
    const q = this.queryFor(side)?.value.trim() ?? ''
    if (!q) return
    void this.ensureIndex().then(() => {
      if (side === this.editingSide && this.queryFor(side)?.value.trim() === q) this.showMatches(side, this.indexMatches(q), true)
    })
    const seq = ++this.searchSeq
    this.status(`${isAutocomplete ? 'Searching' : 'Searching for the ' + sideLabel(side).toLowerCase() + ' team'} ...`)
    const results = this.resultsFor(side)
    if (results) results.innerHTML = ''
    try {
      const res = await fetch(`${API}/searchteams.php?t=${encodeURIComponent(q)}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      if (seq !== this.searchSeq || side !== this.editingSide) return
      this.teams = (data.teams ?? [])
        .filter((t: any) => t.strSport === 'Soccer')
        .map((t: any) => ({
          idTeam: t.idTeam,
          strTeam: t.strTeam,
          strTeamShort: t.strTeamShort ?? '',
          strLeague: t.strLeague ?? '',
          colours: [t.strColour1, t.strColour2, t.strColour3].map((c: string) => normalizeHex(c ?? '')).filter(Boolean) as string[],
        }))
      this.showMatches(side, [...this.indexMatches(q), ...this.teams], false)
    } catch (err) {
      if (seq !== this.searchSeq || side !== this.editingSide) return
      this.status(`Search failed (offline?). ${err}`)
      const results = this.resultsFor(side)
      if (results) results.innerHTML = '<div class="tmEmpty">Could not search teams. Check your connection and try again.</div>'
      this.revealResults(side)
    }
  }

  private async loadTeam(id: string, name: string, side: TeamSide = this.editingSide) {
    const seq = ++this.loadSeq
    this.status(`Loading ${name} squad ...`)
    const loading = this.resultsFor(side)
    if (loading) loading.innerHTML = `<div class="tmEmpty">Loading ${esc(name)} squad ...</div>`
    try {
      // current squad from Wikipedia; TheSportsDB roster only as a fallback
      // (its free-tier squads are often years out of date)
      let source = 'Wikipedia (current squad)'
      let roster = await wikiSquad(name).catch(() => null)
      if (seq !== this.loadSeq || side !== this.editingSide) return
      if (!roster) {
        source = 'TheSportsDB (may be outdated)'
        const res = await fetch(`${API}/lookup_all_players.php?id=${id}`)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json()
        if (seq !== this.loadSeq || side !== this.editingSide) return
        const staff = /coach|manager|director|physio|analyst|scout|president/i
        roster = (data.player ?? [])
          .filter((p: any) => p.strPlayer && !staff.test(p.strPosition ?? ''))
          .map((p: any) => ({ name: p.strPlayer, number: p.strNumber ?? '', position: p.strPosition ?? '' }))
      }
      const hit = this.teams.find(t => t.idTeam === id)
      let colours = hit?.colours ?? []
      const color = colours[0] ?? FALLBACK_COLORS[side === 'home' ? 0 : 1]
      if (!colours.length) colours = [color]
      const previous = this.getTeamForSide(side)
      const players = this.store.scene.objects.filter((o): o is PlayerObj => o.type === 'player')
      const hadTeamPlayers = previous ? this.teamPlayers(players, previous).length > 0 : false
      if (roster?.length) {
        this.remember({ name, short: hit?.strTeamShort ?? '', color, colours, roster: rosterAttackersFirst(roster), side })
        if (!hadTeamPlayers) this.onAddLineup(name)
      }
      const otherSide: TeamSide = side === 'home' ? 'away' : 'home'
      const nextSide = roster?.length && !this.getTeamForSide(otherSide) ? otherSide : side
      this.clearResults()
      this.setEditingSide(nextSide)
      this.status(roster?.length
        ? `${name} loaded as ${sideLabel(side)} from ${source}. ${hadTeamPlayers ? 'Existing dots updated.' : 'Starting XI added.'}${nextSide !== side ? ` Now choose ${sideLabel(nextSide)}.` : ''}`
        : `${name}: no squad list available for this club.`)
      if (nextSide !== side) this.queryFor(nextSide)?.focus()
    } catch (err) {
      if (seq !== this.loadSeq || side !== this.editingSide) return
      this.status(`Could not load the squad. ${err}`)
      const results = this.resultsFor(side)
      if (results) results.innerHTML = '<div class="tmEmpty">Could not load that squad. Check your connection and try again.</div>'
    }
  }

  /** Roster list used by the selected player name dropdown in the options panel. */
  getRosterForPicker(teamName?: string | null): RosterPickItem[] {
    const trimmed = typeof teamName === 'string' ? teamName.trim() : ''
    if (trimmed) {
      const team = this.loaded.find(t => t.name === trimmed)
      if (team) return rosterByNumber(team.roster).map(p => ({ ...p, team: team.name }))
    }
    if (this.roster.length) return rosterByNumber(this.roster).map(p => ({ ...p, team: this.teamName || 'Team' }))
    return this.loaded.flatMap(t => rosterByNumber(t.roster).map(p => ({ ...p, team: t.name })))
  }

  /** Quick-switch from the Player menu chips: makes that team's color the default. */
  activate(name: string) {
    const team = this.getTeam(name)
    if (!team) return
    this.setEditingSide(team.side === 'away' ? 'away' : 'home')
  }

  cycleTeamColor(name: string) {
    const team = this.getTeam(name)
    if (!team) return
    // A team that came back with a single kit still has somewhere to go, so
    // the double tap is never a dead end.
    const full = team.colours.length > 1 ? team.colours : [team.color, ...FALLBACK_COLORS.filter(c => c !== team.color)]
    // Skip whatever the other side is wearing, unless that leaves nothing.
    const other = this.loaded.find(t => t !== team && t.side && t.side !== team.side)?.color
    const clear = full.filter(c => c !== other)
    const palette = clear.length > 1 ? clear : full
    const idx = palette.indexOf(team.color)
    this.setTeamColor(name, palette[(idx + 1 + palette.length) % palette.length])
  }

  private renderRoster() {
    this.q('roster').innerHTML = this.roster.map((p, i) => `
      <button class="tmPlayer" data-tm="pick" data-i="${i}">
        <span class="tmNum">${esc(p.number || '')}</span>
        <span class="tmName">${esc(p.name)}</span>
        <span class="tmPos">${esc(p.position)}</span>
      </button>`).join('')
  }

  private pick(i: number) {
    const normalizeName = (name: string) => name.replace(/\s+#?\d+\s*$/, '').trim()
    const p = this.roster[i]
    if (!p) return
    const sel = this.store.selected
    if (sel?.type === 'player') {
      this.store.apply(() => {
        const o = sel as PlayerObj
        o.name = normalizeName(p.name)
        if (p.number) o.label = p.number
      })
      this.status(`Applied ${p.name} to the selected player.`)
      return
    }
    // no player selected: drop a new dot, cascading from the left
    const col = Math.floor(this.placed / 4), row = this.placed % 4
    const obj: PlayerObj = {
      id: uid(), type: 'player',
      x: BOARD_W * 0.2 + col * 56, y: this.store.scene.board.h * 0.25 + row * 56,
      r: 13, color: this.defaults.playerColor,
      label: p.number || '', name: normalizeName(p.name), namePos: 'bottom', nameSize: 18, nameDisplay: 'last',
      team: this.teamName || undefined,
      flipX: false,
      flipY: false,
    }
    this.placed++
    this.store.apply(s => insertByTier(s.objects, obj))
    this.status(`Added ${p.name} to the board. Drag the dot into position.`)
  }
}
