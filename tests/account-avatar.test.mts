// The header account control shows the signed-in reader's Tactics Journal
// profile picture instead of the outline icon. These tests drive the avatar
// module against a stub DOM (there is no jsdom here) and hold the header
// wiring, markup and CSS that make it work to a source contract.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { createAccountAvatar, profileImageUrl } from '../src/account-avatar.ts'

const tjheader = readFileSync(new URL('../src/tjheader.ts', import.meta.url), 'utf8')
const mainSource = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8')
const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8')

function element(tagName: string) {
  const classes = new Set<string>()
  const listeners: Record<string, Array<() => void>> = {}
  return {
    tagName,
    src: '',
    alt: undefined as string | undefined,
    className: '',
    width: 0,
    height: 0,
    attributes: {} as Record<string, string>,
    children: [] as any[],
    parentNode: null as any,
    classList: {
      add(name: string) { classes.add(name) },
      remove(name: string) { classes.delete(name) },
      contains(name: string) { return classes.has(name) },
    },
    addEventListener(type: string, fn: () => void) { (listeners[type] = listeners[type] || []).push(fn) },
    setAttribute(name: string, value: string) { this.attributes[name] = value },
    appendChild(child: any) { child.parentNode = this; this.children.push(child); return child },
    removeChild(child: any) { this.children = this.children.filter((c: any) => c !== child); child.parentNode = null; return child },
    fire(type: string) { (listeners[type] || []).forEach((fn) => fn()) },
  }
}

function harness(accountOrigin = 'https://tacticsjournal.com') {
  const toggle = element('a')
  const created: any[] = []
  const doc = { createElement(tag: string) { const el = element(tag); created.push(el); return el } }
  return { toggle, created, avatar: createAccountAvatar(toggle, accountOrigin, doc) }
}

test('an authenticated avatar only replaces the outline icon once the image has loaded', () => {
  const ui = harness()
  ui.avatar.update({ authenticated: true, avatar_url: '/avatars/user-1/photo.jpg' })

  const img = ui.created[0]
  assert.equal(img.src, 'https://tacticsjournal.com/avatars/user-1/photo.jpg')
  assert.equal(ui.toggle.children.length, 0, 'no image is attached before it loads')
  assert.equal(ui.toggle.classList.contains('has-avatar'), false)

  img.fire('load')
  assert.deepEqual(ui.toggle.children, [img])
  assert.equal(ui.toggle.classList.contains('has-avatar'), true)
  // Decorative: the control itself already carries the "Account" label.
  assert.equal(img.className, 'site-action-avatar')
  assert.equal(img.alt, '')
  assert.equal(img.attributes['aria-hidden'], 'true')
  assert.equal(img.width, 24)
  assert.equal(img.height, 24)
})

test('a failed avatar falls back to the outline icon', () => {
  const ui = harness()
  ui.avatar.update({ authenticated: true, avatar_url: '/avatars/user-1/photo.jpg' })
  ui.created[0].fire('error')

  assert.equal(ui.toggle.children.length, 0)
  assert.equal(ui.toggle.classList.contains('has-avatar'), false)

  // A later good picture still works after a failure.
  ui.avatar.update({ authenticated: true, avatar_url: '/avatars/user-1/photo.jpg' })
  ui.created[1].fire('load')
  assert.equal(ui.toggle.classList.contains('has-avatar'), true)
})

test('unresolved, signed out, blank and placeholder states keep the outline icon', () => {
  const states = [
    null,
    { authenticated: false },
    { authenticated: false, avatar_url: '/avatars/user-1/photo.jpg' },
    { authenticated: true, avatar_url: '' },
    { authenticated: true, avatar_url: '   ' },
    { authenticated: true, avatar_url: null },
    { authenticated: true },
    { authenticated: true, avatar_url: '/assets/default-avatar.svg' },
  ]
  for (const data of states) {
    const ui = harness()
    ui.avatar.update(data)
    assert.equal(ui.created.length, 0, JSON.stringify(data))
    assert.equal(ui.toggle.children.length, 0, JSON.stringify(data))
    assert.equal(ui.toggle.classList.contains('has-avatar'), false, JSON.stringify(data))
  }
  assert.equal(profileImageUrl({ authenticated: true, avatar_url: '/assets/default-avatar.svg' }, 'https://tacticsjournal.com'), '')
  assert.equal(profileImageUrl({ authenticated: true, avatar_url: ' /a/b.jpg ' }, 'https://tacticsjournal.com'), 'https://tacticsjournal.com/a/b.jpg')
  assert.equal(profileImageUrl({ authenticated: true, avatar_url: 'javascript:alert(1)' }, 'https://tacticsjournal.com'), '')
})

test('relative pictures use the account origin, including Board preview builds', () => {
  const ui = harness('https://billing-sandbox.tacticsjournal.pages.dev')
  ui.avatar.update({ authenticated: true, avatar_url: '/avatars/user-1/photo.jpg' })
  assert.equal(ui.created[0].src, 'https://billing-sandbox.tacticsjournal.pages.dev/avatars/user-1/photo.jpg')

  assert.equal(
    profileImageUrl({ authenticated: true, avatar_url: 'https://images.tacticsjournal.com/avatar.jpg' }, 'https://tacticsjournal.com'),
    'https://images.tacticsjournal.com/avatar.jpg',
  )
})

test('signing out removes a shown avatar and an unchanged session does not rebuild it', () => {
  const ui = harness()
  ui.avatar.update({ authenticated: true, avatar_url: '/avatars/user-1/photo.jpg' })
  ui.created[0].fire('load')

  ui.avatar.update({ authenticated: true, avatar_url: '/avatars/user-1/photo.jpg' })
  assert.equal(ui.created.length, 1, 'the same avatar is not re-created on every refresh')
  assert.equal(ui.toggle.children.length, 1)

  ui.avatar.update({ authenticated: false })
  assert.equal(ui.toggle.children.length, 0)
  assert.equal(ui.toggle.classList.contains('has-avatar'), false)
})

test('a changed avatar url swaps the picture and a stale load is ignored', () => {
  const ui = harness()
  ui.avatar.update({ authenticated: true, avatar_url: '/avatars/user-1/old.jpg' })
  const first = ui.created[0]
  first.fire('load')

  ui.avatar.update({ authenticated: true, avatar_url: '/avatars/user-1/new.jpg' })
  const second = ui.created[1]
  assert.equal(second.src, 'https://tacticsjournal.com/avatars/user-1/new.jpg')
  // The old picture is still on screen until the new one decodes.
  assert.deepEqual(ui.toggle.children, [first])

  second.fire('load')
  assert.deepEqual(ui.toggle.children, [second])

  // The superseded image resolving late must not put the old picture back.
  first.fire('load')
  assert.deepEqual(ui.toggle.children, [second])
})

test('the account toggle keeps its Account label and outline icon markup', () => {
  const toggle = mainSource.match(/<a[^>]*class="site-action site-action-toggle site-action-account-toggle"[^>]*>\s*<svg[\s\S]*?<\/svg>/)?.[0]
  assert.ok(toggle, 'the account toggle should still render the outline SVG')
  assert.match(toggle!, /aria-label="Account"/)
  assert.match(toggle!, /data-inline-toggle="account"/)
  assert.match(toggle!, /aria-controls="site-account-panel"/)
  assert.doesNotMatch(toggle!, /<img/)
})

test('the avatar is fed by the single existing session snapshot, with no extra fetch', () => {
  assert.equal((tjheader.match(/\/api\/account\/session/g) || []).length, 1)
  assert.match(tjheader, /createAccountAvatar\(header\.querySelector<HTMLElement>\('\.site-action-account-toggle'\), TJ\)/)
  // Initial load, popup sign-in and every refresh all resolve through
  // fetchAccountSession, including its failure path.
  const fetchBlock = tjheader.slice(tjheader.indexOf('function fetchAccountSession()'), tjheader.indexOf('async function loadCanonicalAccountSessionAfterSignIn'))
  assert.equal((fetchBlock.match(/accountAvatar\.update\(accountSessionData\)/g) || []).length, 2)
  // Externally announced authentication.
  assert.match(tjheader, /function setAuthenticatedEverywhere\([\s\S]*?accountAvatar\.update\(accountSessionData\)/)
  // Board sign-out.
  assert.match(tjheader, /async function signOut\(\)[\s\S]*?accountAvatar\.update\(accountSessionData\)/)
})

test('the circular avatar keeps the header control at a stable size', () => {
  const start = styles.indexOf('.site-action-account-toggle {')
  const block = styles.slice(start, styles.indexOf('.site-menu {', start))
  assert.match(block, /\.site-action-account-toggle \{\s*width: 24px;\s*height: 24px;/)
  assert.match(block, /\.site-action-account-toggle\.has-avatar svg \{ display: none; \}/)
  assert.match(block, /\.site-action-avatar \{[\s\S]*?width: 24px;[\s\S]*?height: 24px;[\s\S]*?border-radius: 50%;[\s\S]*?object-fit: cover;/)
  assert.match(block, /box-shadow: 0 0 0 1px rgba\(0, 0, 0, 0\.1\)/)
  assert.match(styles, /html\[data-theme-resolved="dark"\] \.site-action-avatar \{\s*box-shadow: 0 0 0 1px rgba\(255, 255, 255, 0\.18\)/)
})
