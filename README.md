# Board

Board is a mobile-friendly editor for football tactics diagrams. Add players, balls, arrows, zones, labels, and a pitch, then export a PNG, GIF, or video.

```bash
docker run --rm -p 8080:8080 ghcr.io/tacticsjournal/board:latest
```

Open <http://localhost:8080> in a browser.

## Run locally

Docker is the easiest local install. The container listens as an unprivileged user on port 8080.

From a checkout that includes `compose.yaml`, run:

```bash
docker compose up
```

Then open <http://localhost:8080>. Stop it with `Ctrl-C`.

The self-hosted app keeps boards and uploaded files in the browser's local storage and IndexedDB. They stay in that browser profile. A container restart does not create a server-side backup.

A self-hosted copy does not include Tactics Journal accounts, Pro entitlements, cloud sync, collaboration, agent links, billing, or the hosted service APIs. Team search can still contact TheSportsDB and Wikipedia from the browser. Those services can be blocked by a network or change their terms.

## Prebuilt archive

Download the latest `.zip` or `.tar.gz` archive from [GitHub releases](https://github.com/TacticsJournal/board/releases). Extract it and serve the extracted directory with a web server that falls back to `index.html` for application routes. Keep the included `LICENSE`, `TRADEMARKS.md`, `THIRD_PARTY_NOTICES.md`, and `README.md` files with the site.

For a quick local check only, extract the archive and serve the files with Python:

```bash
mkdir extracted-board
tar -xzf tacticsjournal-board-0.1.1.tar.gz -C extracted-board
python3 -m http.server 8080 --directory extracted-board
```

A production deployment should use HTTPS and the security settings of its web server. Do not add HSTS unless the site is always served over HTTPS.

## Build from source

Use Node 24. The repository records this in [.nvmrc](.nvmrc).

```bash
nvm install
nvm use
npm ci
npm run build:self-hosted
```

The self-host bundle is in `dist/`. Check it with:

```bash
npm run preview
```

The Vite preview server listens on all interfaces. Do not expose it to an untrusted network.

For the full test suite and both production bundles:

```bash
npm test
npm run build
npm run build:self-hosted
```

To create release archives and checksums after installing `zip` and `tar`:

```bash
bash scripts/package-release.sh
```

The archives are written to `release/` and use the version from `package.json`.

## License boundary

The source code and the original, non-trademark Board artwork in this release are available under the [MIT License](LICENSE). MIT does not grant rights to use Tactics Journal or Tactics Board names, logos, or other reserved marks. Read [TRADEMARKS.md](TRADEMARKS.md) before publishing a modified copy.

Some files and data have separate terms. [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) lists them. In particular:

- `scripts/fixtures/match-real.jpg` is a CC BY-SA 2.0 fixture by Bill Boaden.
- `public/LICENSE-icons` covers the Tabler icons used by the interface.
- `public/teams-index.json` contains data copied and modified from TheSportsDB API responses. It includes source credit. Squad data from Wikipedia is requested at runtime and is not bundled.

The release source does not include the unlicensed model, copied runtime files, or broadcast screenshots from earlier private development. Screenshot import uses browser heuristics plus manual mark and corner mapping.

## Documentation

- [Self-hosting](docs/self-hosting.md)
- [Configuration](docs/configuration.md)
- [Extensions](docs/extensions.md)
- [Third-party notices](THIRD_PARTY_NOTICES.md)
- [Contributing](CONTRIBUTING.md)
- [Security](SECURITY.md)
- [Support](SUPPORT.md)
- [Citation](CITATION.cff)
- [Changelog](CHANGELOG.md)
- [Code of conduct](CODE_OF_CONDUCT.md)
