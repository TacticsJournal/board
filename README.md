# Tactics Journal Board

Tactics Journal Board is a mobile-friendly editor for football tactics diagrams. Add players, balls, arrows, zones, labels, and a pitch, then export a PNG, GIF, or video.

- Version: `0.1.0`
- Release date: 2026-08-26
- Repository: [github.com/TacticsJournal/board](https://github.com/TacticsJournal/board)
- Hosted app: [board.tacticsjournal.com](https://board.tacticsjournal.com)

## License boundary

The source code and the original, non-trademark Board artwork in this release are available under the [MIT License](LICENSE). MIT does not grant rights to use Tactics Journal or Tactics Board names, logos, or other reserved marks. Read [TRADEMARKS.md](TRADEMARKS.md) before publishing a modified copy.

Some files and data have separate terms. [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) lists them. In particular:

- `scripts/fixtures/match-real.jpg` is a CC BY-SA 2.0 fixture by Bill Boaden.
- `public/LICENSE-icons` covers the Tabler icons used by the interface.
- `public/teams-index.json` contains data copied and modified from TheSportsDB API responses. It includes source credit. Squad data from Wikipedia is requested at runtime and is not bundled.
The release source does not include the unlicensed model, copied runtime files, or broadcast screenshots from earlier private development. Screenshot import uses browser heuristics plus manual mark and corner mapping.

## Install and develop

Use Node 24. The repository records this in [.nvmrc](.nvmrc).

```bash
nvm install
nvm use
npm ci
npm run dev
```

Open <http://localhost:5173>. The development server listens on all interfaces, so do not expose it to an untrusted network.

Run the focused test suite and the two production builds with these exact commands:

```bash
npm test
npm run build
npm run build:self-hosted
```

`npm run build` creates the hosted-mode bundle in `dist/`. `npm run build:self-hosted` sets `BOARD_SELF_HOSTED=true` and includes approved local extensions. Neither command deploys anything.

## Self-hosting

The self-host build is a static site. Build it, then serve `dist/` from an HTTPS site or a local static server:

```bash
npm run build:self-hosted
npm run preview
```

For a production deployment, configure the web server to serve `dist/index.html` for the application route and to pass through the generated asset files. See [docs/self-hosting.md](docs/self-hosting.md).

A static self-host does not provide Tactics Journal accounts, Pro entitlements, cloud sync, collaboration, agent links, billing, or the hosted service's other APIs. Boards and uploaded files stay in the browser's local storage and IndexedDB. Team search still contacts TheSportsDB and Wikipedia unless those calls are blocked by the browser or network. The release does not include the optional detection model or copied runtime.

Extensions are local files packaged at build time. To develop them with Vite:

```bash
BOARD_SELF_HOSTED=true npm run dev
```

See [docs/extensions.md](docs/extensions.md) and [docs/configuration.md](docs/configuration.md).

## Optional backend

The repository contains a small FastAPI backend for experiments around screenshot mapping. The browser already performs the four-corner homography mapping, so the backend is not required by the static app and the app does not connect to it automatically.

Install its ordinary dependencies and start it with:

```bash
python3 -m venv .venv
. .venv/bin/activate
python -m pip install -r requirements.txt
npm run api
```

The optional service listens on `http://localhost:8000` and provides health and point-mapping endpoints. See [docs/configuration.md](docs/configuration.md).

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
