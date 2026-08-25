// Resolve the newest installed Playwright Chromium so suites survive browser
// updates (the build number changes under ~/.cache/ms-playwright). CHROME_PATH
// remains available for CI images that provide a system browser instead.
import { existsSync, readdirSync } from 'node:fs'

const root = `${process.env.HOME}/.cache/ms-playwright`
const explicit = process.env.CHROME_PATH || process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || ''
const dir = existsSync(root)
  ? readdirSync(root)
    .filter(d => /^chromium-\d+$/.test(d))
    .sort((a, b) => Number(a.slice(9)) - Number(b.slice(9)))
    .at(-1)
  : ''

export const chromePath = explicit || (dir ? `${root}/${dir}/chrome-linux64/chrome` : '')

if (!chromePath) throw new Error(`no Chromium executable found; run: npx playwright-core install chromium or set CHROME_PATH`)
