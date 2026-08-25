import { BOARD_EXTENSION_PATHS, BOARD_SELF_HOSTED } from './build-mode.ts'

export const SKILLS_EXTENSIONS_KEY = 'tbm-skills-extensions-v1'
export const MAX_SKILLS = 50
export const MAX_EXTENSIONS = 10
export const SKILL_NAME_MAX = 80
export const INSTRUCTIONS_MAX = 20_000
export const EXTENSION_DESCRIPTION_MAX = 240
export const EXTENSION_VERSION_MAX = 40

export type Skill = {
  id: string
  name: string
  instructions: string
  enabled: boolean
  createdAt: string
  updatedAt: string
}
export type ExtensionPermission = 'board:read' | 'board:write'
export type ExtensionSnapshot = {
  id: string
  path: string
  name: string
  description: string
  version: string
  enabled: boolean
  permissions: ExtensionPermission[]
  installedAt: string
}
export type ProjectSkillsState = {
  version: 1
  revision: string | null
  dirty: boolean
  skills: Skill[]
  extensions: ExtensionSnapshot[]
}
export type SyncedSkill = Pick<Skill, 'id' | 'name' | 'instructions' | 'enabled'>

const plainObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)
const text = (value: unknown, max: number) => typeof value === 'string'
  ? value.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, max)
  : ''
const id = (value: unknown) => {
  const valueText = text(value, 100).trim()
  return /^[A-Za-z0-9_-]{1,100}$/.test(valueText) ? valueText : ''
}
const date = (value: unknown, fallback: string) => {
  const valueText = typeof value === 'string' ? value : ''
  return Number.isFinite(Date.parse(valueText)) ? valueText : fallback
}
const newId = (prefix: string) => `${prefix}_${crypto.randomUUID ? crypto.randomUUID().replaceAll('-', '') : Math.random().toString(36).slice(2)}`

/** Accept only a path emitted by this build, never a supplied origin or URL. */
export function validateExtensionPath(value: unknown, paths: readonly string[] = BOARD_EXTENSION_PATHS): string | null {
  return typeof value === 'string' && paths.includes(value) ? value : null
}

function skill(raw: unknown, now: string): Skill | null {
  if (!plainObject(raw) || raw.source === 'extension') return null
  const skillId = id(raw.id)
  const name = text(raw.name, SKILL_NAME_MAX).trim()
  const instructions = text(raw.instructions, INSTRUCTIONS_MAX)
  if (!skillId || !name || !instructions.trim()) return null
  return {
    id: skillId, name, instructions, enabled: raw.enabled !== false,
    createdAt: date(raw.createdAt, now), updatedAt: date(raw.updatedAt, now),
  }
}

function extension(raw: unknown, now: string, paths: readonly string[], selfHosted: boolean): ExtensionSnapshot | null {
  if (!plainObject(raw) || !selfHosted) return null
  const extensionId = id(raw.id)
  const path = validateExtensionPath(raw.path, paths)
  const name = text(raw.name, SKILL_NAME_MAX).trim()
  const description = text(raw.description, EXTENSION_DESCRIPTION_MAX).trim()
  const version = text(raw.version, EXTENSION_VERSION_MAX).trim()
  const permissions = Array.isArray(raw.permissions) && raw.permissions.every(p => p === 'board:read' || p === 'board:write')
    ? Array.from(new Set(raw.permissions)) as ExtensionPermission[]
    : null
  if (!extensionId || !path || !name || !description || !version || !permissions) return null
  return { id: extensionId, path, name, description, version, enabled: raw.enabled !== false, permissions, installedAt: date(raw.installedAt, now) }
}

/** Drop malformed records and all extensions outside a self-host build. */
export function normalizeProjectSkillsState(raw: unknown, now = new Date().toISOString(), paths: readonly string[] = BOARD_EXTENSION_PATHS, selfHosted = BOARD_SELF_HOSTED): ProjectSkillsState {
  const input = plainObject(raw) ? raw : {}
  const skills: Skill[] = []
  const skillIds = new Set<string>()
  for (const value of Array.isArray(input.skills) ? input.skills : []) {
    const next = skill(value, now)
    if (next && !skillIds.has(next.id) && skills.length < MAX_SKILLS) { skills.push(next); skillIds.add(next.id) }
  }
  const extensions: ExtensionSnapshot[] = []
  const extensionIds = new Set<string>()
  for (const value of Array.isArray(input.extensions) ? input.extensions : []) {
    const next = extension(value, now, paths, selfHosted)
    if (next && !extensionIds.has(next.id) && extensions.length < MAX_EXTENSIONS) { extensions.push(next); extensionIds.add(next.id) }
  }
  const revision = typeof input.revision === 'string' && input.revision.length <= 256 ? input.revision : null
  return { version: 1, revision, dirty: input.dirty === true, skills, extensions }
}

const storageKey = (projectId: string) => `${SKILLS_EXTENSIONS_KEY}:${projectId}`
export function loadProjectSkillsState(projectId: string, storage: Storage = localStorage): ProjectSkillsState {
  try { return normalizeProjectSkillsState(JSON.parse(storage.getItem(storageKey(projectId)) || 'null')) } catch { return normalizeProjectSkillsState(null) }
}
export function saveProjectSkillsState(projectId: string, state: ProjectSkillsState, storage: Storage = localStorage): boolean {
  try { storage.setItem(storageKey(projectId), JSON.stringify(normalizeProjectSkillsState(state))); return true } catch { return false }
}

export function newUserSkill(name = 'Untitled skill', instructions = '', now = new Date().toISOString()): Skill {
  return { id: newId('skill'), name: text(name, SKILL_NAME_MAX).trim() || 'Untitled skill', instructions: text(instructions, INSTRUCTIONS_MAX), enabled: true, createdAt: now, updatedAt: now }
}

export function saveSkill(state: ProjectSkillsState, value: Pick<Skill, 'id' | 'name' | 'instructions' | 'enabled'>, now = new Date().toISOString()): ProjectSkillsState | null {
  const index = state.skills.findIndex(item => item.id === value.id)
  if (index < 0) return null
  const name = text(value.name, SKILL_NAME_MAX).trim()
  const instructions = text(value.instructions, INSTRUCTIONS_MAX)
  if (!name || !instructions.trim()) return null
  const skills = state.skills.slice()
  skills[index] = { ...skills[index], name, instructions, enabled: value.enabled === true, updatedAt: now }
  return { ...state, skills, dirty: true }
}

export function addUserSkill(state: ProjectSkillsState, item: Skill): ProjectSkillsState | null {
  const valid = skill(item, item.updatedAt)
  if (!valid || state.skills.length >= MAX_SKILLS || state.skills.some(skill => skill.id === valid.id)) return null
  return { ...state, skills: [...state.skills, valid], dirty: true }
}
export function deleteSkill(state: ProjectSkillsState, skillId: string): ProjectSkillsState {
  return { ...state, skills: state.skills.filter(skill => skill.id !== skillId), dirty: true }
}
export function setExtensionEnabled(state: ProjectSkillsState, extensionId: string, enabled: boolean): ProjectSkillsState {
  return { ...state, extensions: state.extensions.map(extension => extension.id === extensionId ? { ...extension, enabled } : extension) }
}

export function skillsForSync(state: ProjectSkillsState): SyncedSkill[] {
  return state.skills.map(({ id, name, instructions, enabled }) => ({ id, name, instructions, enabled }))
}

/** Merge the owner-controlled server skills while preserving local timestamps. */
export function mergeSyncedSkills(state: ProjectSkillsState, values: unknown, revision: string | null, now = new Date().toISOString()): ProjectSkillsState | null {
  if (!Array.isArray(values) || values.length > MAX_SKILLS) return null
  const existing = new Map(state.skills.map(item => [item.id, item]))
  const skills: Skill[] = []
  const ids = new Set<string>()
  for (const raw of values) {
    if (!plainObject(raw) || !Object.keys(raw).every(key => ['id', 'name', 'instructions', 'enabled'].includes(key)) || Object.keys(raw).length !== 4) return null
    const skillId = id(raw.id)
    const name = text(raw.name, SKILL_NAME_MAX).trim()
    const instructions = text(raw.instructions, INSTRUCTIONS_MAX)
    if (!skillId || !name || !instructions.trim() || typeof raw.enabled !== 'boolean' || ids.has(skillId)) return null
    ids.add(skillId)
    const old = existing.get(skillId)
    skills.push({
      id: skillId, name, instructions, enabled: raw.enabled,
      createdAt: old?.createdAt ?? now,
      updatedAt: old && old.name === name && old.instructions === instructions && old.enabled === raw.enabled ? old.updatedAt : now,
    })
  }
  return { ...state, skills, revision, dirty: false }
}

export function installExtension(state: ProjectSkillsState, manifest: Omit<ExtensionSnapshot, 'id' | 'enabled' | 'installedAt'>, now = new Date().toISOString(), paths: readonly string[] = BOARD_EXTENSION_PATHS, selfHosted = BOARD_SELF_HOSTED): ProjectSkillsState | null {
  if (!selfHosted || state.extensions.length >= MAX_EXTENSIONS) return null
  const snapshot = extension({ id: newId('extension'), ...manifest, enabled: true, installedAt: now }, now, paths, selfHosted)
  if (!snapshot) return null
  return { ...state, extensions: [...state.extensions, snapshot] }
}

export function removeExtension(state: ProjectSkillsState, extensionId: string): ProjectSkillsState {
  return { ...state, extensions: state.extensions.filter(extension => extension.id !== extensionId) }
}
