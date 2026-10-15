import {
  documentScene, normalizeDocumentArrowLegends, tryNormalizeBoardDocument,
  type BoardDocument,
} from './projects.ts'

export const MAX_AGENT_IMPORT_GZIP_BYTES = 6000
export const MAX_AGENT_IMPORT_JSON_BYTES = 64 * 1024
export const MAX_AGENT_IMPORT_PAYLOAD_CHARS = 8000
export const MAX_STORED_AGENT_IMPORT_GZIP_BYTES = 256 * 1024
export const MAX_STORED_AGENT_IMPORT_JSON_BYTES = 2 * 1024 * 1024
export const MAX_STORED_AGENT_IMPORT_PAYLOAD_CHARS = 350_000
const DRAFT_ID = /^[A-Za-z0-9_-]{24}$/
const STORED_DRAFT_ID = /^[A-Za-z0-9_-]{22}$/
const BASE64_URL = /^[A-Za-z0-9_-]+$/

type DraftEnvelope = {
  v: 1
  draftId: string
  name: string
  document: BoardDocument
}

export type AgentImportDraft = DraftEnvelope & {
  boardCount: number
  previewScene: ReturnType<typeof documentScene>
}

export type AgentImportErrorCode = 'invalid' | 'too-large'

export class AgentImportError extends Error {
  readonly code: AgentImportErrorCode

  constructor(message: string, code: AgentImportErrorCode = 'invalid') {
    super(message)
    this.name = 'AgentImportError'
    this.code = code
  }
}

export function isAgentImportTooLarge(error: unknown): boolean {
  return error instanceof AgentImportError && error.code === 'too-large'
}

export type BoardImportReadyRow = {
  label: string
  detail: string
  action: string
  primary?: boolean
  chevron?: boolean
  destructive?: boolean
}

/**
 * How an import lands: added to a project's boards, created as a new project,
 * or swapped in for a deleted one.
 */
export type BoardImportMode = 'append' | 'new' | 'replace'

const CAPPED_NEW_PROJECT_DETAIL = 'Free keeps three projects. See what you can do'

export function boardImportReadyRows(name: string, destinationCount: number, canCreateProject: boolean): BoardImportReadyRow[] {
  const existing: BoardImportReadyRow = {
    label: 'Existing project',
    detail: destinationCount === 0 ? 'No projects yet' : `Choose from ${destinationCount} project${destinationCount === 1 ? '' : 's'}`,
    action: 'existing',
    primary: !canCreateProject,
    chevron: true,
  }
  const fresh: BoardImportReadyRow = canCreateProject
    ? { label: 'New project', detail: `Creates a project named “${name}”`, action: 'new-project', primary: true }
    : { label: 'New project', detail: 'A new project is not available in this context', action: 'unavailable' }
  return canCreateProject ? [fresh, existing] : [existing, fresh]
}

export function projectImportReadyRows(
  name: string,
  boardCount: number,
  destinationCount: number,
  canCreateProject: boolean,
): BoardImportReadyRow[] {
  const existing: BoardImportReadyRow = {
    label: 'Existing project',
    detail: destinationCount === 0
      ? 'No projects yet'
      : `Adds all ${boardCount} board${boardCount === 1 ? '' : 's'} to ${destinationCount === 1 ? 'your project' : `one of ${destinationCount} projects`}`,
    action: 'existing',
    primary: !canCreateProject,
    chevron: true,
  }
  const fresh: BoardImportReadyRow = canCreateProject
    ? { label: 'New project', detail: `Creates “${name}” with ${boardCount} board${boardCount === 1 ? '' : 's'}`, action: 'new-project', primary: true }
    : { label: 'New project', detail: 'A new project is not available in this context', action: 'unavailable' }
  const rows = canCreateProject ? [fresh] : []
  if (destinationCount > 0) rows.push(existing)
  if (!canCreateProject) rows.push(fresh)
  return rows
}

/**
 * What a capped free account can do about a shared copy that wants a project
 * spot. A licence is one answer, but not the only one, so the dialog offers
 * making room alongside it.
 */
export function projectLimitChoiceRows(destinationCount: number): BoardImportReadyRow[] {
  const many = destinationCount === 1 ? 'your project' : `one of your ${destinationCount} projects`
  return [
    { label: 'Upgrade', detail: 'License or Pro removes the three-project limit', action: 'pro', primary: true },
    { label: 'Remove a project', detail: `Delete ${many}, then add this copy`, action: 'remove-project', chevron: true },
  ]
}

/** The last screen before anything is deleted. It names what goes. */
export function projectLimitConfirmRows(projectName: string, boardCount: number): BoardImportReadyRow[] {
  const boards = `${boardCount} board${boardCount === 1 ? '' : 's'}`
  // The safe way out is first, so a stray Tab and Enter cannot delete a project.
  return [
    { label: 'Choose another project', detail: 'Nothing has changed yet', action: 'destination-back' },
    { label: `Delete “${projectName}”`, detail: `Deletes ${boards}, then adds the copy`, action: 'confirm', primary: true, destructive: true },
  ]
}

export type AgentImportSource = { kind: 'inline' | 'stored' | 'board' | 'stored-board' | 'project-copy' | 'stored-project-copy'; value: string }

export function agentImportSource(location: Pick<Location, 'pathname' | 'search' | 'hash'>): AgentImportSource | null {
  if (location.pathname !== '/import') return null
  const query = new URLSearchParams(location.search)
  const queryKeys = Array.from(query.keys())
  // A Community post links to the board it is about. The id is stored the same
  // way a copy link's is, so the import that opens it is the same import.
  if (!location.hash && queryKeys.length === 1 && (queryKeys[0] === 'board' || queryKeys[0] === 'community')) {
    const id = query.get(queryKeys[0])
    return id && STORED_DRAFT_ID.test(id) ? { kind: 'stored-board', value: id } : null
  }
  if (queryKeys.length) return null
  const params = new URLSearchParams(location.hash.slice(1))
  const keys = Array.from(params.keys())
  if (keys.length !== 1) return null
  if (keys[0] === 'draft') {
    const payload = params.get('draft')
    return payload && /^[A-Za-z0-9_-]+$/.test(payload) ? { kind: 'inline', value: payload } : null
  }
  if (keys[0] === 'project-copy') {
    const value = params.get('project-copy')
    return value && STORED_DRAFT_ID.test(value) ? { kind: 'stored-project-copy', value } : null
  }
  if (keys[0] === 'project') {
    const value = params.get('project')
    if (value && STORED_DRAFT_ID.test(value)) return { kind: 'stored', value }
    return value && BASE64_URL.test(value) ? { kind: 'project-copy', value } : null
  }
  if (keys[0] === 'board') {
    const payload = params.get('board')
    if (payload && STORED_DRAFT_ID.test(payload)) return { kind: 'stored-board', value: payload }
    return payload && /^[A-Za-z0-9_-]+$/.test(payload) ? { kind: 'board', value: payload } : null
  }
  return null
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function freshDraftId(): string {
  const bytes = new Uint8Array(18)
  crypto.getRandomValues(bytes)
  return encodeBase64Url(bytes)
}

type CopyImportScope = 'board' | 'project'

export type AgentImportDecodeLimits = {
  maxPayloadChars: number
  maxGzipBytes: number
  maxJsonBytes: number
}

const INLINE_IMPORT_LIMITS: AgentImportDecodeLimits = {
  maxPayloadChars: MAX_AGENT_IMPORT_PAYLOAD_CHARS,
  maxGzipBytes: MAX_AGENT_IMPORT_GZIP_BYTES,
  maxJsonBytes: MAX_AGENT_IMPORT_JSON_BYTES,
}

const TEMPORARY_IMPORT_LIMITS: AgentImportDecodeLimits = {
  ...INLINE_IMPORT_LIMITS,
  maxPayloadChars: 4000,
}

export const STORED_PROJECT_IMPORT_LIMITS: AgentImportDecodeLimits = {
  maxPayloadChars: MAX_STORED_AGENT_IMPORT_PAYLOAD_CHARS,
  maxGzipBytes: MAX_STORED_AGENT_IMPORT_GZIP_BYTES,
  maxJsonBytes: MAX_STORED_AGENT_IMPORT_JSON_BYTES,
}

function tooLarge(scope: CopyImportScope): AgentImportError {
  return new AgentImportError(`This ${scope} is too large for a reliable link.`, 'too-large')
}

async function createCompressedPayload(
  scope: CopyImportScope,
  name: string,
  document: BoardDocument,
  limits: AgentImportDecodeLimits,
  stableDraft = false,
): Promise<string> {
  const cleanName = name.trim().slice(0, 40)
  const normalized = tryNormalizeBoardDocument(document)
  if (!cleanName || !normalized || !('boards' in normalized)
    || (scope === 'board' && normalized.boards.length !== 1)) {
    throw new AgentImportError(`This ${scope} could not be linked.`)
  }

  let draftId = freshDraftId()
  if (stableDraft) {
    try {
      const source = new TextEncoder().encode(JSON.stringify({ name: cleanName, document: normalized }))
      const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', source))
      draftId = encodeBase64Url(digest.slice(0, 18))
    } catch { throw new AgentImportError('This browser could not create a project link.') }
  }
  const envelope: DraftEnvelope = { v: 1, draftId, name: cleanName, document: normalized }
  const json = JSON.stringify(envelope)
  const bytes = new TextEncoder().encode(json)
  if (bytes.byteLength > limits.maxJsonBytes) throw tooLarge(scope)
  let compressed: Uint8Array
  try {
    const stream = new Blob([json]).stream().pipeThrough(new CompressionStream('gzip'))
    compressed = new Uint8Array(await new Response(stream).arrayBuffer())
  } catch { throw new AgentImportError(`This browser could not create a ${scope} link.`) }
  if (compressed.byteLength > limits.maxGzipBytes) throw tooLarge(scope)
  const payload = encodeBase64Url(compressed)
  if (payload.length > limits.maxPayloadChars) throw tooLarge(scope)
  return payload
}

async function storeTemporaryCopy(
  scope: CopyImportScope,
  name: string,
  document: BoardDocument,
  preview: string | null,
  origin: string,
  fetcher: typeof fetch,
): Promise<string> {
  if (preview !== null && (!/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(preview) || preview.length > 500_000)) {
    throw new AgentImportError('This board preview could not be created.')
  }
  const payload = await createCompressedPayload(scope, name, document, TEMPORARY_IMPORT_LIMITS)
  let response: Response
  try {
    response = await fetcher('/api/board/import-drafts', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(preview === null ? { payload } : { payload, preview }),
    })
  } catch { throw new AgentImportError(`This ${scope} link could not be created. Try again.`) }
  if (response.status === 429) throw new AgentImportError(`Too many ${scope} links have been created. Try again later.`)
  if (!response.ok) throw new AgentImportError(`This ${scope} link could not be created. Try again.`)
  let body: unknown
  try { body = await response.json() } catch { throw new AgentImportError(`This ${scope} link could not be created. Try again.`) }
  if (!isRecord(body) || typeof body.id !== 'string' || !STORED_DRAFT_ID.test(body.id)) {
    throw new AgentImportError(`This ${scope} link could not be created. Try again.`)
  }
  const root = origin.replace(/\/$/, '')
  return scope === 'board' ? `${root}/import?board=${body.id}` : `${root}/import#project-copy=${body.id}`
}

export const MAX_COMMUNITY_POST_CAPTION_CHARS = 5000

export type CommunityPostResult = {
  postId: string
  communityUrl: string
  boardUrl: string
  moderationPending: boolean
  message: string
}

const COMMUNITY_POST_FAILED = 'This board could not be posted. Try again.'

/** Only what the sheet can safely show: a short sentence, never a payload. */
function safeCommunityError(body: unknown): string {
  if (!isRecord(body) || typeof body.error !== 'string') return COMMUNITY_POST_FAILED
  const message = body.error.trim().replace(/\s+/g, ' ')
  return message && message.length <= 300 ? message : COMMUNITY_POST_FAILED
}

function communityPostUrl(value: unknown, postId: string): string | null {
  if (typeof value !== 'string' || value.length > 2000) return null
  let url: URL
  try { url = new URL(value) } catch { return null }
  const keys = Array.from(url.searchParams.keys())
  return url.origin === 'https://tacticsjournal.com' && url.pathname === '/community/' && !url.hash
    && keys.length === 1 && keys[0] === 'post' && url.searchParams.get('post') === postId
    ? url.toString() : null
}

function boardCommunityUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2000) return null
  let url: URL
  try { url = new URL(value) } catch { return null }
  const keys = Array.from(url.searchParams.keys())
  return url.origin === 'https://board.tacticsjournal.com' && url.pathname === '/import' && !url.hash
    && keys.length === 1 && keys[0] === 'community'
    && /^[A-Za-z0-9_-]{22}$/.test(url.searchParams.get('community') || '')
    ? url.toString() : null
}

/**
 * Publish this board as an ordinary Community post. The board travels as the
 * same bounded copy a share link carries, so the post opens as a board.
 */
export async function postBoardToCommunity(
  name: string,
  document: BoardDocument,
  preview: string,
  caption: string,
  origin = window.location.origin,
  fetcher: typeof fetch = fetch,
  // The board copy this post already has, when the board is being sent again.
  // Given, the post is rewritten in place; absent, a post is created.
  shareId: string | null = null,
): Promise<CommunityPostResult> {
  if (caption.length > MAX_COMMUNITY_POST_CAPTION_CHARS) {
    throw new AgentImportError(`A caption can be at most ${MAX_COMMUNITY_POST_CAPTION_CHARS} characters.`)
  }
  if (!/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(preview) || preview.length > 500_000) {
    throw new AgentImportError('This board preview could not be created.')
  }
  if (shareId !== null && !/^[A-Za-z0-9_-]{22}$/.test(shareId)) {
    throw new AgentImportError(COMMUNITY_POST_FAILED)
  }
  const payload = await createCompressedPayload('board', name, document, TEMPORARY_IMPORT_LIMITS)
  let response: Response
  try {
    response = await fetcher(`${origin.replace(/\/$/, '')}/api/board/community-posts`, {
      method: 'POST',
      credentials: 'include',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(shareId ? { id: shareId, payload, preview, caption } : { payload, preview, caption }),
    })
  } catch { throw new AgentImportError(COMMUNITY_POST_FAILED) }
  let body: unknown
  try { body = await response.json() } catch { body = null }
  if (!response.ok) throw new AgentImportError(safeCommunityError(body))
  const postId = isRecord(body) && typeof body.post_id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(body.post_id)
    ? body.post_id : ''
  const communityUrl = isRecord(body) ? communityPostUrl(body.community_url, postId) : null
  const boardUrl = isRecord(body) ? boardCommunityUrl(body.board_url) : null
  if (!isRecord(body) || !postId
    || !communityUrl || !boardUrl || typeof body.moderation_pending !== 'boolean'
    || typeof body.message !== 'string' || body.message.length > 300) {
    throw new AgentImportError(COMMUNITY_POST_FAILED)
  }
  return {
    postId,
    communityUrl,
    boardUrl,
    moderationPending: body.moderation_pending,
    message: body.message.trim().replace(/\s+/g, ' '),
  }
}

/** Store a board copy behind a short-lived id so the share URL stays short. */
export function createBoardImportUrl(
  name: string,
  document: BoardDocument,
  preview: string,
  origin = window.location.origin,
  fetcher: typeof fetch = fetch,
): Promise<string> {
  return storeTemporaryCopy('board', name, document, preview, origin, fetcher)
}

/** Store a project copy behind a short-lived id so free shares also have short URLs. */
export function createProjectImportUrl(
  name: string,
  document: BoardDocument,
  origin = window.location.origin,
  fetcher: typeof fetch = fetch,
): Promise<string> {
  return storeTemporaryCopy('project', name, document, null, origin, fetcher)
}

export async function createStoredProjectImportUrl(
  name: string,
  document: BoardDocument,
  origin = window.location.origin,
  fetcher: typeof fetch = fetch,
): Promise<string> {
  const stableDocument = JSON.parse(JSON.stringify(document)) as BoardDocument
  if ('boards' in stableDocument) stableDocument.updated = 0
  const payload = await createCompressedPayload('project', name, stableDocument, STORED_PROJECT_IMPORT_LIMITS, true)
  let response: Response
  try {
    response = await fetcher('/api/board/import-drafts', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-Tactics-Board-Link-Scope': 'project-copy',
      },
      body: JSON.stringify({ payload }),
    })
  } catch { throw new AgentImportError('This project could not be stored for a reliable link.') }
  if (!response.ok) throw new AgentImportError('This project could not be stored for a reliable link.')
  let body: unknown
  try { body = await response.json() } catch { throw new AgentImportError('This project link is invalid.') }
  if (!isRecord(body) || typeof body.id !== 'string' || !STORED_DRAFT_ID.test(body.id)) {
    throw new AgentImportError('This project link is invalid.')
  }
  return `${origin.replace(/\/$/, '')}/import#project-copy=${body.id}`
}

export async function fetchAgentImport(id: string, fetcher: typeof fetch = fetch): Promise<string> {
  if (!STORED_DRAFT_ID.test(id)) throw new AgentImportError('This project link is invalid.')
  let response: Response
  try {
    response = await fetcher(`/api/board/import-drafts?id=${encodeURIComponent(id)}`, {
      headers: { Accept: 'application/json' },
    })
  } catch { throw new AgentImportError('This project link is temporarily unavailable.') }
  if (response.status === 404) throw new AgentImportError('This project link has expired or is invalid.')
  if (!response.ok) throw new AgentImportError('This project link is temporarily unavailable.')
  let body: unknown
  try { body = await response.json() } catch { throw new AgentImportError('This project link is invalid.') }
  if (!isRecord(body) || Object.keys(body).join(',') !== 'payload'
    || typeof body.payload !== 'string' || body.payload.length > MAX_STORED_AGENT_IMPORT_PAYLOAD_CHARS
    || !BASE64_URL.test(body.payload)) throw new AgentImportError('This project link is invalid.')
  return body.payload
}

function decodeBase64Url(value: string, limits: AgentImportDecodeLimits): Uint8Array {
  if (!value || value.length > limits.maxPayloadChars || !BASE64_URL.test(value)) throw new AgentImportError('This project link is invalid.')
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4)
  let binary: string
  try { binary = atob(padded) } catch { throw new AgentImportError('This project link is invalid.') }
  const bytes = Uint8Array.from(binary, char => char.charCodeAt(0))
  if (bytes.byteLength > limits.maxGzipBytes) throw new AgentImportError('This project link is too large to open.')
  return bytes
}

async function gunzipBounded(bytes: Uint8Array, maxJsonBytes: number): Promise<string> {
  if (typeof DecompressionStream === 'undefined') throw new AgentImportError('Update your browser to open this project link.')
  let reader: ReadableStreamDefaultReader<Uint8Array>
  try {
    reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')).getReader()
  } catch { throw new AgentImportError('This project link is invalid.') }
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxJsonBytes) {
        await reader.cancel()
        throw new AgentImportError('This project link is too large to open.')
      }
      chunks.push(value)
    }
  } catch (error) {
    if (error instanceof AgentImportError) throw error
    throw new AgentImportError('This project link is invalid.')
  }
  const joined = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.byteLength }
  try { return new TextDecoder('utf-8', { fatal: true }).decode(joined) }
  catch { throw new AgentImportError('This project link is invalid.') }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export async function decodeAgentImport(
  payload: string,
  limits: AgentImportDecodeLimits = INLINE_IMPORT_LIMITS,
): Promise<AgentImportDraft> {
  const text = await gunzipBounded(decodeBase64Url(payload, limits), limits.maxJsonBytes)
  let raw: unknown
  try { raw = JSON.parse(text) } catch { throw new AgentImportError('This project link is invalid.') }
  if (!isRecord(raw) || Object.keys(raw).sort().join(',') !== 'document,draftId,name,v'
    || raw.v !== 1 || typeof raw.draftId !== 'string' || !DRAFT_ID.test(raw.draftId)
    || typeof raw.name !== 'string' || raw.name !== raw.name.trim() || !raw.name || raw.name.length > 40
    || !isRecord(raw.document)) throw new AgentImportError('This project link is invalid.')
  const normalized = tryNormalizeBoardDocument(raw.document)
  if (!normalized) throw new AgentImportError('This project uses a format this version cannot open.')
  const document = normalizeDocumentArrowLegends(raw.document as BoardDocument, normalized)
  const boardCount = 'boards' in normalized ? normalized.boards.length : 1
  return { v: 1, draftId: raw.draftId, name: raw.name, document, boardCount, previewScene: documentScene(normalized) }
}

export function agentImportFile(draft: AgentImportDraft, now = new Date().toISOString()): string {
  return JSON.stringify({
    app: 'tactics-board-mapper',
    version: 1,
    exportedAt: now,
    boards: { [draft.name]: { savedAt: now, scene: draft.document, importId: draft.draftId } },
  })
}
