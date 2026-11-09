import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createTabPresence, type TabChannel, type TabMessage } from '../src/tab-presence.ts'

/** A synchronous stand-in for BroadcastChannel: never echoes to the sender. */
function bus() {
  const members = new Set<TabChannel>()
  const sent: TabMessage[] = []
  const join = (): TabChannel => {
    const channel: TabChannel = {
      onmessage: null,
      postMessage(message) {
        sent.push(message)
        for (const peer of members) if (peer !== channel) peer.onmessage?.({ data: structuredClone(message) })
      },
      close() { members.delete(channel) },
    }
    members.add(channel)
    return channel
  }
  return { join, sent }
}

function tab(b: ReturnType<typeof bus>, id: string) {
  const changes: boolean[] = []
  const presence = createTabPresence({ tabId: id, channel: b.join(), onChange: value => changes.push(value) })
  return { presence, changes }
}

test('a second tab on the same board warns both tabs', () => {
  const b = bus()
  const one = tab(b, 'tab-one')
  one.presence.setBoard('board-a')
  assert.equal(one.presence.duplicate, false)
  const two = tab(b, 'tab-two')
  two.presence.setBoard('board-a')
  assert.equal(one.presence.duplicate, true)
  assert.equal(two.presence.duplicate, true)
  assert.deepEqual(one.changes, [true])
  assert.deepEqual(two.changes, [true])
})

test('tabs on different boards never warn, and switching onto the same board does', () => {
  const b = bus()
  const one = tab(b, 'tab-one')
  const two = tab(b, 'tab-two')
  one.presence.setBoard('board-a')
  two.presence.setBoard('board-b')
  assert.equal(one.presence.duplicate, false)
  assert.equal(two.presence.duplicate, false)
  two.presence.setBoard('board-a')
  assert.equal(one.presence.duplicate, true)
  assert.equal(two.presence.duplicate, true)
  two.presence.setBoard('board-b')
  assert.equal(one.presence.duplicate, false)
  assert.equal(two.presence.duplicate, false)
})

test('closing the other tab clears the warning', () => {
  const b = bus()
  const one = tab(b, 'tab-one')
  const two = tab(b, 'tab-two')
  one.presence.setBoard('board-a')
  two.presence.setBoard('board-a')
  two.presence.leave()
  assert.equal(one.presence.duplicate, false)
  assert.deepEqual(one.changes, [true, false])
  assert.equal(two.presence.duplicate, false)
})

test('a tab restored from the back/forward cache rejoins', () => {
  const b = bus()
  const one = tab(b, 'tab-one')
  const two = tab(b, 'tab-two')
  one.presence.setBoard('board-a')
  two.presence.setBoard('board-a')
  two.presence.leave()
  two.presence.setBoard('board-a')
  assert.equal(one.presence.duplicate, true)
  assert.equal(two.presence.duplicate, true)
})

test('answers are never answered, so tabs cannot ping-pong', () => {
  const b = bus()
  tab(b, 'tab-one').presence.setBoard('board-a')
  tab(b, 'tab-two').presence.setBoard('board-a')
  tab(b, 'tab-three').presence.setBoard('board-a')
  // one open each, one answer from every tab already there: 3 + 1 + 2.
  assert.equal(b.sent.length, 6)
})

test('no board, malformed messages, and a missing BroadcastChannel are all quiet', () => {
  const b = bus()
  const one = tab(b, 'tab-one')
  const two = tab(b, 'tab-two')
  one.presence.setBoard(null)
  two.presence.setBoard(null)
  assert.equal(one.presence.duplicate, false)
  const raw = b.join()
  raw.postMessage({ type: 'open', tab: '', board: null } as TabMessage)
  raw.postMessage({ type: 'nonsense', tab: 'x' } as unknown as TabMessage)
  raw.postMessage({ type: 'open', tab: 'x', board: 7 } as unknown as TabMessage)
  assert.equal(one.presence.duplicate, false)
  const lonely = createTabPresence({ tabId: 'tab-alone', channel: null, onChange: () => assert.fail('no channel, no change') })
  lonely.setBoard('board-a')
  lonely.leave()
  assert.equal(lonely.duplicate, false)
})

test('the board page shows and clears its own banner, and still uses the shared device for the room', () => {
  const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8')
  assert.match(main, /const collaborationDevice = sync\.deviceId\(\)/)
  assert.match(main, /Close the other tab/)
  assert.match(main, /addEventListener\('pagehide', \(\) => tabPresence\.leave\(\)\)/)
  assert.match(main, /announceTab\(\)\n  queueMicrotask/)
})
