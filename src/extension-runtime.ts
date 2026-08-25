import { insertByTier, sanitizeObjects, uid } from './types.ts'
import type { Project } from './projects.ts'
import type { Scene, SceneObj } from './types.ts'
import { EXTENSION_DESCRIPTION_MAX, EXTENSION_VERSION_MAX, SKILL_NAME_MAX, type ExtensionPermission, type ExtensionSnapshot } from './skills-extensions.ts'

export const EXTENSION_PROTOCOL = 'tactics-board-extension/v1'
export const EXTENSION_MESSAGE_MAX = 256 * 1024
export const EXTENSION_OBJECT_MAX = 100

export type ExtensionManifest = {
  name: string
  description: string
  version: string
  permissions: ExtensionPermission[]
}
type Request = { id: string; method: 'project.read' | 'board.read' | 'board.addObjects'; params: unknown }
type RuntimeOptions = {
  url: string
  allowedPaths: readonly string[]
  permissions?: readonly ExtensionPermission[]
  approvedManifest?: ExtensionManifest
  project: () => Project
  board: () => Scene
  addObjects: (objects: SceneObj[]) => void
  manifest: (manifest: ExtensionManifest) => void
  error: (message: string) => void
}

const plainObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const text = (value: unknown, max: number) => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, max) : ''
const messageBytes = (value: unknown) => {
  try { return new TextEncoder().encode(JSON.stringify(value)).byteLength } catch { return Infinity }
}
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T
const only = (value: Record<string, unknown>, keys: readonly string[]) => Object.keys(value).every(key => keys.includes(key))

export function parseManifest(value: unknown): ExtensionManifest | null {
  if (!plainObject(value) || !only(value, ['name', 'description', 'version', 'permissions'])) return null
  const name = text(value.name, SKILL_NAME_MAX).trim()
  const description = text(value.description, EXTENSION_DESCRIPTION_MAX).trim()
  const version = text(value.version, EXTENSION_VERSION_MAX).trim()
  const permissions = Array.isArray(value.permissions) && value.permissions.every(permission => permission === 'board:read' || permission === 'board:write')
    ? Array.from(new Set(value.permissions)) as ExtensionPermission[]
    : null
  if (!name || !description || !version || !permissions) return null
  return { name, description, version, permissions }
}

/** Resolve a compiled extension path only against this deployment's origin. */
export function allowedExtensionUrl(path: unknown, allowedPaths: readonly string[], origin: string): string | null {
  if (typeof path !== 'string' || !allowedPaths.includes(path)) return null
  try {
    const base = new URL(origin)
    const url = new URL(path, base)
    return url.origin === base.origin && url.pathname === path && !url.search && !url.hash ? url.href : null
  } catch { return null }
}

export function manifestsMatch(current: ExtensionManifest, approved: ExtensionManifest): boolean {
  return current.name === approved.name
    && current.description === approved.description
    && current.version === approved.version
    && [...current.permissions].sort().join('\n') === [...approved.permissions].sort().join('\n')
}

/** Parse only messages addressed to this opaque sandbox frame and its token. */
export function parseExtensionMessage(value: unknown, token: string): { type: 'manifest'; manifest: ExtensionManifest } | { type: 'request'; request: Request } | null {
  if (messageBytes(value) > EXTENSION_MESSAGE_MAX || !plainObject(value) || value.protocol !== EXTENSION_PROTOCOL || value.token !== token || typeof value.type !== 'string') return null
  if (value.type === 'manifest') {
    if (!only(value, ['protocol', 'token', 'type', 'manifest'])) return null
    const manifest = parseManifest(value.manifest)
    return manifest ? { type: 'manifest', manifest } : null
  }
  if (value.type === 'request') {
    if (!only(value, ['protocol', 'token', 'type', 'request'])) return null
    const request = value.request
    if (!plainObject(request) || !only(request, ['id', 'method', 'params'])) return null
    const id = text(request.id, 80)
    const method = request.method
    if (!id || (method !== 'project.read' && method !== 'board.read' && method !== 'board.addObjects')) return null
    return { type: 'request', request: { id, method, params: request.params } }
  }
  return null
}

/** Reject unknown object types and assign host ids after the board sanitizer accepts every item. */
export function extensionObjects(value: unknown): SceneObj[] | null {
  if (!Array.isArray(value) || value.length > EXTENSION_OBJECT_MAX || messageBytes(value) > EXTENSION_MESSAGE_MAX) return null
  const supported = new Set(['player', 'ball', 'cone', 'goal', 'image', 'marker', 'arrow', 'box', 'text'])
  if (value.some(item => !plainObject(item) || !supported.has(item.type as string))) return null
  const clean = sanitizeObjects(value)
  if (clean.length !== value.length) return null
  return clean.map(item => ({ ...item, id: uid() }))
}

export class ExtensionRuntime {
  readonly iframe = document.createElement('iframe')
  private readonly token = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2)
  private timer = 0
  private stopped = false
  private extensionWindow: Window | null = null
  private readonly channel = new MessageChannel()
  private portTransferred = false
  private seenManifest = false
  private manifestApproved = false
  private readonly onMessage = (event: MessageEvent) => this.receive(event.data)
  private readonly options: RuntimeOptions

  constructor(options: RuntimeOptions) {
    this.options = options
    this.iframe.setAttribute('referrerpolicy', 'no-referrer')
    this.iframe.referrerPolicy = 'no-referrer'
    const url = allowedExtensionUrl(options.url, options.allowedPaths, location.origin)
    if (!url) throw new Error('Extension is not part of this self-host build.')
    this.iframe.title = 'Extension wrapper'
    this.iframe.addEventListener('load', () => this.connectFrame())
    this.iframe.src = url
  }

  start(host: HTMLElement): void {
    host.replaceChildren(this.iframe)
    this.channel.port1.addEventListener('message', this.onMessage)
    this.channel.port1.start()
    this.timer = window.setTimeout(() => {
      if (!this.seenManifest) this.fail('The extension did not answer within 10 seconds.')
    }, 10_000)
  }

  dispose(): void {
    if (this.stopped) return
    this.stopped = true
    window.clearTimeout(this.timer)
    this.channel.port1.removeEventListener('message', this.onMessage)
    this.channel.port1.close()
    this.channel.port2.close()
    this.iframe.remove()
  }

  private connectFrame(): void {
    const inner = this.iframe.contentDocument?.querySelector<HTMLIFrameElement>('iframe[data-board-extension]')
    if (!inner || inner.sandbox.value !== 'allow-scripts' || !inner.contentWindow) {
      this.fail('The extension wrapper is invalid.')
      return
    }
    this.extensionWindow = inner.contentWindow
    if (this.portTransferred) { this.fail('The extension wrapper reloaded.'); return }
    this.portTransferred = true
    this.extensionWindow.postMessage({ protocol: EXTENSION_PROTOCOL, token: this.token, type: 'init' }, '*', [this.channel.port2])
  }

  private send(payload: Record<string, unknown>): void {
    if (this.stopped || messageBytes(payload) > EXTENSION_MESSAGE_MAX) return
    this.channel.port1.postMessage({ protocol: EXTENSION_PROTOCOL, token: this.token, ...payload })
  }

  private receive(value: unknown): void {
    if (this.stopped) return
    const parsed = parseExtensionMessage(value, this.token)
    if (!parsed) return
    if (parsed.type === 'manifest') {
      if (this.seenManifest) return
      this.seenManifest = true
      window.clearTimeout(this.timer)
      this.options.manifest(parsed.manifest)
      const approved = this.options.approvedManifest
      if (approved && !manifestsMatch(parsed.manifest, approved)) {
        this.fail('This extension changed after approval. Remove it and install it again to review the new manifest.')
        return
      }
      this.manifestApproved = true
      return
    }
    if (!this.seenManifest || !this.manifestApproved) return this.reply(parsed.request.id, false, undefined, 'Send an approved manifest before making requests.')
    this.request(parsed.request)
  }

  private request(request: Request): void {
    const allowed = this.options.permissions || []
    const read = allowed.includes('board:read')
    if ((request.method === 'project.read' || request.method === 'board.read') && !read) return this.reply(request.id, false, undefined, 'Permission denied.')
    if (request.method === 'board.addObjects' && !allowed.includes('board:write')) return this.reply(request.id, false, undefined, 'Permission denied.')
    if (request.method === 'project.read') return this.reply(request.id, true, clone(this.options.project()))
    if (request.method === 'board.read') return this.reply(request.id, true, clone(this.options.board()))
    const params = plainObject(request.params) ? request.params : null
    const objects = extensionObjects(params?.objects)
    if (!objects) return this.reply(request.id, false, undefined, 'Objects must use supported board types and contain no more than 100 items.')
    this.options.addObjects(objects)
    this.reply(request.id, true, { added: objects.length })
  }

  private reply(id: string, ok: boolean, result?: unknown, error?: string): void {
    this.send({ type: 'response', id, ok, ...(ok ? { result } : { error }) })
  }
  private fail(message: string): void { this.options.error(message); this.dispose() }
}

export type { ExtensionSnapshot }
