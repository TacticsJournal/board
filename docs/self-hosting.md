# Self-hosting

Tactics Journal Board can run as a static site. The self-host build removes the hosted account header and enables local extension packaging.

## Build it

Install Node 24, then run:

```bash
nvm install
nvm use
npm ci
npm run build:self-hosted
```

The output is in `dist/`. For a local check, use the repository's Vite preview command:

```bash
npm run preview
```

For a real deployment, serve `dist/` with an HTTPS web server. Configure the server to fall back to `dist/index.html` for application routes. Preserve the response headers in `public/_headers` when your host supports that file. The repository does not include a deployment configuration for every web server.

## Extensions

Put an extension at `public/extensions/<safe-name>/index.html` before building. Names may contain lowercase letters, numbers, and single hyphens. Build again after changing an extension:

```bash
npm run build:self-hosted
```

Only the packaged wrapper is copied into `dist/extensions/`. The build ignores unsafe directory names, missing `index.html` files, and paths that leave `public/extensions`. Read [docs/extensions.md](extensions.md) before adding an extension.

## What a static copy does not include

A static copy has no Tactics Journal account or server. It does not provide cloud sync, collaboration, billing, Pro entitlements, hosted agent links, or the hosted service APIs. Local boards and uploaded assets belong to the browser profile that created them.

The app can call external team data services from the browser. `public/teams-index.json` is a generated team index, while current squad data is fetched from Wikipedia at runtime. Those services can be unavailable or can change their terms.

Screenshot import supports browser heuristics, manual player marks, manual pitch corners, and browser homography mapping.

## Branding and notices

A self-hosted copy is operated by its owner, not by Tactics Journal. Keep the MIT notice with the code, follow [TRADEMARKS.md](../TRADEMARKS.md), and review [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md) before redistributing it.
