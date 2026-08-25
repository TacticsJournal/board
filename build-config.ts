import { readFileSync, readdirSync, realpathSync, statSync } from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'

export const SAFE_EXTENSION_NAME = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/
const EXTENSION_PATH = /^\/extensions\/([a-z0-9](?:[a-z0-9-]*[a-z0-9])?)\/index\.html$/
const EXTENSION_SOURCE_MAX = 256 * 1024

export function isSelfHostedBuild(value = process.env.BOARD_SELF_HOSTED): boolean {
  return value === 'true'
}

function inside(root: string, candidate: string): boolean {
  const path = relative(root, candidate)
  return path === '' || (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path))
}

/** Find only safe extension directories whose index file stays under the root. */
export function discoverExtensionPaths(root = resolve('public/extensions')): string[] {
  let resolvedRoot: string
  try { resolvedRoot = realpathSync(root) } catch { return [] }

  const paths: string[] = []
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!SAFE_EXTENSION_NAME.test(entry.name) || (!entry.isDirectory() && !entry.isSymbolicLink())) continue
    const directory = join(root, entry.name)
    const index = join(directory, 'index.html')
    try {
      const resolvedDirectory = realpathSync(directory)
      const resolvedIndex = realpathSync(index)
      if (!inside(resolvedRoot, resolvedDirectory) || !inside(resolvedRoot, resolvedIndex) || !statSync(resolvedIndex).isFile()) continue
      paths.push(`/extensions/${entry.name}/index.html`)
    } catch { /* Missing files and escaping links are not extensions. */ }
  }
  return paths.sort()
}

/** Revalidate and read one discovered file at the moment the build packages it. */
export function readExtensionSource(path: string, root = resolve('public/extensions')): string | null {
  const name = EXTENSION_PATH.exec(path)?.[1]
  if (!name || !SAFE_EXTENSION_NAME.test(name)) return null
  try {
    const resolvedRoot = realpathSync(root)
    const resolvedIndex = realpathSync(join(root, name, 'index.html'))
    const stat = statSync(resolvedIndex)
    if (!inside(resolvedRoot, resolvedIndex) || !stat.isFile() || stat.size > EXTENSION_SOURCE_MAX) return null
    return readFileSync(resolvedIndex, 'utf8')
  } catch { return null }
}

const attribute = (value: string) => value
  .replaceAll('&', '&amp;')
  .replaceAll('"', '&quot;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')

/** A script-free wrapper keeps direct navigation away from extension code. */
export function extensionWrapper(source: string): string {
  const policy = "default-src 'none'; base-uri 'none'; object-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; form-action 'none'"
  const document = `<meta http-equiv="Content-Security-Policy" content="${policy}">${source}`
  return `<!doctype html><meta charset="utf-8"><meta name="referrer" content="no-referrer"><style>html,body,iframe{box-sizing:border-box;width:100%;height:100%;margin:0;border:0}</style><iframe data-board-extension title="Extension" sandbox="allow-scripts" referrerpolicy="no-referrer" srcdoc="${attribute(document)}"></iframe>\n`
}
