# Self-host extensions

Extensions are available only in a self-host build. The hosted board at board.tacticsjournal.com supports Skills, not third-party extensions.

An administrator adds a static extension at `public/extensions/<safe-name>/index.html` and rebuilds. Names use lowercase letters, numbers, and single hyphens. The build ignores other names, files without `index.html`, and links that resolve outside `public/extensions`.

The build compiles the discovered files into script-free wrapper pages. It does not publish the raw extension files. Users can install only the compiled paths. There is no URL installer, registry, upload flow, package manager, or remote extension origin.

Each wrapper contains an inner iframe with `sandbox="allow-scripts"` and `referrerpolicy="no-referrer"`. The extension has an opaque origin and a restrictive embedded content policy. It cannot access Board cookies, storage, DOM, or tokens. Before first install, the user sees the deployment path and requested permission in plain language and must approve it.

## Messages

Board sends `init` with a private `MessagePort`. Keep that port and use it for every later message. Navigation destroys the port, so a different document cannot inherit approved permissions.

```js
let board
let token

addEventListener('message', event => {
  const message = event.data
  if (message?.protocol !== 'tactics-board-extension/v1' || message.type !== 'init' || !event.ports[0]) return
  token = message.token
  board = event.ports[0]
  board.start()
}, { once: true })

const send = message => board?.postMessage({
  protocol: 'tactics-board-extension/v1', token, ...message
})
```

Messages are limited to 256 KB.

After receiving `init`, send:

```js
{
  protocol: 'tactics-board-extension/v1',
  token,
  type: 'manifest',
  manifest: {
    name: 'Formation generator',
    description: 'Adds a 4-3-3 shape to the board.',
    version: '1.0.0',
    permissions: ['board:write']
  }
}
```

`board:read` lets the extension read the current project and board. `board:write` lets it add up to 100 supported objects to the current board. The host sanitizes every object, assigns new ids, and uses normal undo and autosave.

Extensions stay local to the project and device. Self-hosted Skills stay local too; the official hosted service provides owner-controlled Skill sync for agent links.

See [`examples/extensions/formation-generator/index.html`](../examples/extensions/formation-generator/index.html) for a static extension.
