import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8')
const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8')
const icons = readFileSync(new URL('../src/icons.ts', import.meta.url), 'utf8')

test('Settings Help opens a complete feedback form', () => {
  const helpGroup = main.slice(main.indexOf('<div class="setGroupHead">Help</div>'), main.indexOf('data-pane="howto"'))
  assert.ok(helpGroup.indexOf('Data, copyright and terms') < helpGroup.indexOf('data-goto="feedback"'))
  assert.match(helpGroup, /data-goto="feedback"[\s\S]*?>Feedback</)

  const pane = main.slice(main.indexOf('data-pane="feedback"'), main.indexOf('data-pane="teams"'))
  for (const field of ['name', 'email', 'issue', 'device', 'browser', 'website']) {
    assert.match(pane, new RegExp(`name="${field}"`), field)
  }
  assert.match(pane, /<label[^>]+for="fb-name"/)
  assert.match(pane, /<label[^>]+for="fb-email"/)
  assert.match(pane, /<label[^>]+for="fb-issue"/)
  assert.match(pane, /<label[^>]+for="fb-device"/)
  assert.match(pane, /<label[^>]+for="fb-browser"/)
  assert.match(pane, /data-feedback-status role="status" aria-live="polite"/)

  for (const [id, placeholder] of [['fb-name', 'Your name'], ['fb-email', 'you@example.com']] as const) {
    const control = pane.match(new RegExp(`<input[^>]+id="${id}"[^>]*>`))
    assert.ok(control, id)
    assert.match(control[0], new RegExp(`placeholder="${placeholder.replace('.', '\\.')}"`), id)
  }
  // every visible control carries a placeholder; the honeypot stays bare
  for (const control of pane.match(/<(?:input|textarea)\b[^>]*>/g) ?? []) {
    if (control.includes('feedbackHoneypot')) { assert.ok(!control.includes('placeholder='), 'honeypot'); continue }
    assert.match(control, /placeholder="/, control)
  }
})

test('the feedback row icon is the Iconify tabler:message-report body', () => {
  const expected = '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18 4a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3h-5l-5 3v-3H6a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3zm-6 4v3m0 3v.01"/>'
  assert.ok(icons.includes(`'message-report': \`${expected}\``))
  assert.match(main, /icon\('message-report'\)/)
  // icon bodies are inlined, never fetched at runtime
  assert.ok(!icons.includes('api.iconify.design'))
})

test('feedback submits to the site API and session details only fill blank controls', () => {
  assert.match(main, /`\$\{TJ_ORIGIN\}\/api\/feedback`/)
  assert.match(main, /credentials: 'include'/)
  assert.match(main, /if \(name && !name\.value && accountName\) name\.value = accountName/)
  assert.match(main, /if \(email && !email\.value && accountEmail\) email\.value = accountEmail/)
  assert.match(main, /typeof data\.name === 'string'/)
  assert.match(main, /target === 'feedback'/)
  assert.match(main, /Thank you for the feedback! We'll send you an email soon if we have questions or make any changes\./)
})

test('feedback fields and error status have visible keyboard focus styles', () => {
  assert.match(styles, /\.feedbackInput:focus-visible/)
  assert.match(styles, /\.feedbackSubmit:focus-visible/)
  assert.match(styles, /\.feedbackStatus:focus-visible/)
  assert.match(styles, /\.feedbackHoneypot[\s\S]*left: -9999px/)
})
