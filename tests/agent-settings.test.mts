import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8')
const icons = readFileSync(new URL('../src/icons.ts', import.meta.url), 'utf8')
const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8')

test('Settings groups Skills and Extensions and the Pro agent connection under Agents', () => {
  const start = main.indexOf('<div class="setGroupHead">Agents</div>')
  const end = main.indexOf('${BOARD_SELF_HOSTED ? `<div class="setGroupHead">Hosting</div>')
  assert.ok(start > -1 && end > start)
  const agents = main.slice(start, end)
  assert.ok(agents.indexOf('data-goto="skills"') < agents.indexOf('data-goto="agents"'))
  assert.match(agents, /data-goto="skills"[\s\S]*?icon\('skills'\)[\s\S]*?<span class="setItemLabel">Skills and Extensions<\/span>/)
  assert.match(icons, /'skills': `<path d="M0 0h16v16H0z" fill="none"\/><path fill="currentColor" d="M9 1a2 2/)
  assert.match(icons, /name === 'skills' \? '0 0 16 16' : '0 0 24 24'/)
  assert.match(agents, /data-goto="agents"[\s\S]*?icon\('prompt'\)[\s\S]*?Connect Claude or ChatGPT/)
  assert.match(agents, /setTag setTagPro" data-lock-tag="agents">Pro/)
  assert.match(main, /type SetScreen =[^\n]*'agents'/)
  assert.match(main, /agents: 'Claude and ChatGPT'/)
})

test('the Pro screen publishes the one canonical server and current provider paths', () => {
  assert.match(main, /const AGENT_MCP_URL = 'https:\/\/board\.tacticsjournal\.com\/mcp'/)
  assert.match(main, /Open Customize, then Connectors\./)
  assert.match(main, /Choose Add custom connector and paste the server URL\./)
  assert.match(main, /Settings, then Security and login\. Turn on Developer mode\./)
  assert.match(main, /Open ChatGPT Plugins, choose \+, and create an app with the server URL\./)
  assert.match(main, /support\.anthropic\.com\/en\/articles\/11175166-getting-started-with-custom-connectors-using-remote-mcp/)
  assert.match(main, /platform\.openai\.com\/docs\/guides\/developer-mode/)
  assert.match(main, /target="_blank" rel="noopener">Claude help/)
  assert.match(main, /target="_blank" rel="noopener">ChatGPT help/)
  assert.match(main, /data-agent-provider="Claude" href="https:\/\/claude\.ai\/settings\/connectors" target="_blank" rel="noopener" aria-label="Copy URL and open Claude\. You finish setup there\."/)
  assert.match(main, /data-agent-provider="ChatGPT" href="https:\/\/chatgpt\.com\/plugins" target="_blank" rel="noopener" aria-label="Copy URL and open ChatGPT\. You finish setup there\."/)
  assert.match(main, /Copy URL and open Claude/)
  assert.match(main, /Copy URL and open ChatGPT/)
})

test('the screen gates setup with Pro and explains the board-scoped link', () => {
  assert.match(main, /if \(!entitlements\.isPro\(\)\) \{[\s\S]*?Connecting Claude or ChatGPT comes with Pro/)
  assert.match(main, /data-lock-tag="agents"[^\n]*entitlements\.isPro\(\)/)
  assert.match(main, /returns an Add to Projects link/)
  assert.match(main, /no agent link is needed/)
  assert.match(main, /choose Share, then Invite an agent/)
  assert.match(main, /link lasts 24 hours and covers only that project/)
  assert.match(main, /Use this same server URL for every board\. It grants no board access on its own\./)
})

test('copy is accessible and falls back without claiming success', () => {
  assert.match(main, /data-agents-copy aria-label="Copy the server URL"/)
  assert.match(main, /navigator\.clipboard\?\.writeText/)
  assert.match(main, /document\.createRange\(\)/)
  assert.match(main, /document\.execCommand\('copy'\)/)
  assert.match(main, /Server URL copied\./)
  assert.match(main, /The server URL is selected\. Copy it with your keyboard\./)
  assert.match(main, /Server URL copied\. Opening \$\{provider\}\./)
  assert.match(main, /Opening \$\{provider\}\. Copy the server URL from this screen and paste it there\./)
  assert.match(main, /label\.innerHTML = `\$\{icon\('check'\)\}Copied`/)
  assert.match(main, /data-set-note role="status" aria-live="polite"/)
})

test('agent setup styles wrap the URL and keep static steps out of the tab order', () => {
  for (const hook of ['.setCode', '.sheet .setItemAction.setCopy', '.sheet .setProviderAction', '.setStepNum', '.setNoteStrong']) {
    assert.ok(styles.includes(hook), `missing ${hook}`)
  }
  assert.match(styles, /\.setCode \{[\s\S]*?min-width: 0;[\s\S]*?overflow-wrap: anywhere;[\s\S]*?user-select: text;/)
  assert.match(main, /setStepNum">1<\/span><span class="setItemLabel">Open Customize/)
  assert.doesNotMatch(main, /<button[^>]*setStepNum/)
  assert.match(styles, /\.sheet \.setProviderAction \{[\s\S]*?padding-left: 45px;[\s\S]*?text-decoration: none;/)
  assert.match(icons, /'external-link'/)
})
