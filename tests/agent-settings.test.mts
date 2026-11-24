import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8')
const icons = readFileSync(new URL('../src/icons.ts', import.meta.url), 'utf8')

test('Settings keeps Skills and Extensions under Agents', () => {
  const start = main.indexOf('<div class="setGroupHead">Agents</div>')
  const end = main.indexOf('${BOARD_SELF_HOSTED ? `<div class="setGroupHead">Hosting</div>')
  assert.ok(start > -1 && end > start)
  const agents = main.slice(start, end)
  assert.match(agents, /data-goto="skills"[\s\S]*?icon\('skills'\)[\s\S]*?<span class="setItemLabel">Skills and Extensions<\/span>/)
  assert.match(icons, /'skills': `<path d="M0 0h16v16H0z" fill="none"\/><path fill="currentColor" d="M9 1a2 2/)
  assert.match(icons, /name === 'skills' \? '0 0 16 16' : '0 0 24 24'/)
})

test('the server-backed agent connection is gone', () => {
  assert.doesNotMatch(main, /data-goto="agents"/)
  assert.doesNotMatch(main, /AGENT_MCP_URL/)
  assert.doesNotMatch(main, /board\.tacticsjournal\.com\/mcp/)
  assert.doesNotMatch(main, /Connect Claude or ChatGPT/)
  assert.doesNotMatch(main, /Invite an agent/)
  assert.doesNotMatch(main, /data-lock-tag/)
  assert.doesNotMatch(main, /type SetScreen =[^\n]*'agents'/)
})
