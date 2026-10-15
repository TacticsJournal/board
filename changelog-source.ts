import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

export type ChangelogEntry = {
  id: string
  date: string
  title: string
  body: string
  tag: string
  major: boolean
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const FIELD = /^([A-Za-z]+):\s*(.*)$/

function slug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function entryFrom(block: string[]): ChangelogEntry | null {
  const title = (block[0] ?? '').replace(/^##\s*/, '').trim()
  if (!title) return null

  const fields = new Map<string, string>()
  let cursor = 1
  for (; cursor < block.length; cursor++) {
    const line = block[cursor].trim()
    if (!line) { cursor++; break }
    const field = FIELD.exec(line)
    if (!field) break
    fields.set(field[1].toLowerCase(), field[2].trim())
  }

  const date = fields.get('date') ?? ''
  if (!ISO_DATE.test(date) || Number.isNaN(Date.parse(date))) return null

  const body = block.slice(cursor).join('\n').trim().replace(/\s*\n\s*/g, ' ')
  const id = `${date}-${slug(title)}`
  if (id === `${date}-`) return null

  return { id, date, title, body, tag: fields.get('tag') ?? '', major: fields.get('major') === 'true' }
}

/** Newest first, so the board can treat the head of the list as the latest. */
export function parseChangelog(source: string): ChangelogEntry[] {
  const lines = source.replace(/<!--[\s\S]*?-->/g, '').split(/\r?\n/)
  const blocks: string[][] = []
  for (const line of lines) {
    if (line.startsWith('## ')) blocks.push([line])
    else if (blocks.length) blocks[blocks.length - 1].push(line)
  }

  const entries: ChangelogEntry[] = []
  const seen = new Set<string>()
  for (const block of blocks) {
    const entry = entryFrom(block)
    // A repeated id would make one entry impossible to mark as seen.
    if (!entry || seen.has(entry.id)) continue
    seen.add(entry.id)
    entries.push(entry)
  }
  return entries.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
}

/** A changelog the build cannot read is an empty list, never a failed build. */
export function readChangelog(path = resolve('CHANGELOG.md')): ChangelogEntry[] {
  try {
    return parseChangelog(readFileSync(path, 'utf8'))
  } catch { return [] }
}
