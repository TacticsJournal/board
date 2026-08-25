# Self-hosting

Tactics Journal Board is a static site. The self-host build removes the hosted account header and enables local extension packaging. It stores boards and uploaded assets in the browser, not on the web server.

## Docker

Run the published image on localhost:

```bash
docker run --rm -p 8080:8080 ghcr.io/tacticsjournal/board:latest
```

Open <http://localhost:8080>. The image uses an unprivileged nginx process and listens on container port 8080. It includes the release notices at the site root.

To build the image from a checkout instead:

```bash
docker build -t tacticsjournal-board:local .
docker run --rm -p 8080:8080 tacticsjournal-board:local
```

The image contains only the built self-host bundle and release notices. The Dockerfile pins the nginx runtime image by digest.

## Compose

The repository's `compose.yaml` runs the published image with a localhost-only port binding:

```bash
docker compose up
```

It uses a read-only root filesystem, temporary filesystems for nginx's runtime directories, and drops Linux capabilities. Stop it with `Ctrl-C`. Update the image with `docker compose pull` when a new release is available.

## Prebuilt archive

Download a `.zip` or `.tar.gz` file from [GitHub releases](https://github.com/TacticsJournal/board/releases). Verify it with the matching line in `SHA256SUMS`, then extract it into the document root of a static web server.

The server must return `index.html` for application routes while serving generated files directly. The archive contains `index.html`, the self-host bundle, and `LICENSE`, `TRADEMARKS.md`, `THIRD_PARTY_NOTICES.md`, and `README.md`. Keep those notices with a redistributed copy.

For a local-only check, extract the archive and serve its files with Python:

```bash
mkdir extracted-board
tar -xzf tacticsjournal-board-0.1.1.tar.gz -C extracted-board
python3 -m http.server 8080 --directory extracted-board
```

Use HTTPS for a public deployment. Do not enable HSTS for a localhost-only deployment or a site that can still be reached over HTTP.

## Build from source

Install Node 24 and build the self-host bundle:

```bash
nvm install
nvm use
npm ci
npm run build:self-hosted
```

The output is in `dist/`. For a local check, use:

```bash
npm run preview
```

For production, serve `dist/` with a static web server and configure its SPA fallback to `dist/index.html`. Copy the response headers in `public/_headers` only when they match the deployment. In particular, the hosted HSTS policy is not suitable for every local deployment.

The release packaging script builds the same bundle and writes versioned archives and checksums to `release/`:

```bash
bash scripts/package-release.sh
```

It needs `node`, `npm`, `zip`, `tar`, and `sha256sum`.

## Extensions

Put an extension at `public/extensions/<safe-name>/index.html` before building. Names may contain lowercase letters, numbers, and single hyphens. Build again after changing an extension:

```bash
npm run build:self-hosted
```

Only the packaged wrapper is copied into `dist/extensions/`. The build ignores unsafe directory names, missing `index.html` files, and paths that leave `public/extensions`. Read [extensions.md](extensions.md) before adding an extension.

## What a static copy does not include

A static copy has no Tactics Journal account or server. It does not provide cloud sync, collaboration, billing, Pro entitlements, hosted agent links, or hosted service APIs. Local boards and uploaded assets belong to the browser profile that created them. A container restart cannot recover them.

The app can call external team data services from the browser. `public/teams-index.json` is a generated team index, while current squad data is fetched from Wikipedia at runtime. Those services can be unavailable or can change their terms.

Screenshot import supports browser heuristics, manual player marks, manual pitch corners, and browser homography mapping.

## Branding and notices

A self-hosted copy is operated by its owner, not by Tactics Journal. Keep the MIT notice with the code, follow [TRADEMARKS.md](../TRADEMARKS.md), and review [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md) before redistributing it.
