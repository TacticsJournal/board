# Board

The minimal tactics board that is yours.

Board is a mobile-friendly football tactics editor. Plan a training session, make a graphic for an article, or import a broadcast screenshot and draw over it. Use the [hosted Board](https://board.tacticsjournal.com/), self-host it, or change the code to fit how you work.

Board is free and open source. Read [Introducing Board](https://tacticsjournal.com/board/2026/08/26/introducing-board/) for the full tour.

## Use the hosted Board

Open [board.tacticsjournal.com](https://board.tacticsjournal.com/). There are no accounts and nothing to buy.

Every feature is free: every pitch style, custom backgrounds and assets, reusable groups, animation, screenshot import, PNG, GIF, and video export, and unlimited projects and saved boards. Projects, images, fonts, and other files stay in your browser. Use Move to another device to carry a project file to another browser.

The hosted Board talks to Tactics Journal only when you ask it to, and never with cookies:

- **Copy link** sends the board or project you chose, with a preview image for a single board, to Tactics Journal. The copy is kept for 24 hours so the link can open, then it expires.
- **Feedback** sends the name, email, issue, device, browser, and page (origin and path only) you submit.
- **Site search** in the header sends the words you search for.
- **Aggregate counters** record editor opens and exports by format. They carry no IP address, visitor ID, URL, referrer, cookies, or free text.

Board sets no cookies, uses no third-party analytics, and sells nothing.

## Self-host Board

A self-host build has every local editing and export feature. Boards, backgrounds, and uploaded assets stay in that browser profile. Board does not send them to a server.

Self-hosting does not include Copy link, Feedback, site search, or the aggregate counters, because those use Tactics Journal-operated services. Team search can still contact TheSportsDB and Wikipedia from the browser.

### Run the Docker image

```bash
docker run --rm -p 8080:8080 ghcr.io/tacticsjournal/board:latest
```

Open <http://localhost:8080>. The container runs nginx as an unprivileged user on port 8080.

A checkout also includes a hardened Compose configuration:

```bash
docker compose up
```

Compose binds Board to `127.0.0.1:8080`. Stop it with `Ctrl-C`.

### Serve a release archive

Download the latest `.zip` or `.tar.gz` from [GitHub releases](https://github.com/TacticsJournal/board/releases). Verify it against `SHA256SUMS`, extract it, and serve the extracted directory with any static web server.

The server must fall back to `index.html` for application routes. Use HTTPS for a public deployment. Keep the included `LICENSE`, `TRADEMARKS.md`, `THIRD_PARTY_NOTICES.md`, and `README.md` files with a redistributed copy.

For a local check:

```bash
mkdir extracted-board
tar -xzf tacticsjournal-board-0.1.1.tar.gz -C extracted-board
python3 -m http.server 8080 --directory extracted-board
```

### Build from source

Use Node 24. The repository records the version in [.nvmrc](.nvmrc).

```bash
git clone https://github.com/TacticsJournal/board.git
cd board
npm install
npm run build:self-hosted
```

Serve the generated `dist/` directory on localhost or your own HTTPS domain. For local development with Vite:

```bash
BOARD_SELF_HOSTED=true npm run dev
```

The Vite development and preview servers listen on all interfaces. Do not expose them to an untrusted network.

## Features

- Add players, the ball, arrows, zones, text, cones, goals, icons, a score, a clock, a date, and team details.
- Load a real squad with its kit colors or start from a blank pitch.
- Use horizontal, vertical, live, training, and two-pitch layouts, or draw over your own background.
- Group objects, save reusable selections, add custom assets, and keep notes with each board.
- Copy boards into a sequence, set the time between them, and export the project as separate images, a GIF, or a video.
- Import a match screenshot, detect or mark player positions, set the four pitch corners, and map the positions onto a clean board.
- Edit with touch, mouse, or keyboard controls in light or dark mode.
- Use the bundled 3D View extension to orbit the live editable board through 360 degrees.

## Skills and extensions

A Skill is a set of project instructions for an agent. It can define your terminology, the meaning of an arrow style, or how you structure a training session.

Official extensions are reviewed, bundled with Board, and available in hosted and self-hosted builds. Third-party extensions run only in self-host builds. They use a sandbox and ask for `board:read` or `board:write` access before they can work on a project.

To try the included formation generator:

```bash
mkdir -p public/extensions/formation-generator
cp examples/extensions/formation-generator/index.html public/extensions/formation-generator/index.html
npm run build:self-hosted
```

Each extension is one `index.html` file under `public/extensions/<safe-name>/`. A project can enable up to ten extensions. Read [the extension guide](docs/extensions.md) before writing one.

## How it works

Board is a browser-first TypeScript application. Konva renders and edits the board on an HTML canvas. Plain TypeScript, HTML, and CSS make up the interface, and Vite compiles the hosted and self-hosted builds.

```text
Browser
├── Editor and project library
├── Konva canvas renderer
├── Screenshot import and media export
├── localStorage for project data and settings
└── IndexedDB for uploaded images
         │
         ├── TheSportsDB and Wikipedia for optional team data
         └── Tactics Journal APIs in the hosted build only
             (24-hour copy links, feedback, site search, aggregate counters)

Vite self-host build → static dist/ → nginx, Docker, or another static server
```

A self-host installation needs no application server or database. `backend/main.py` is an optional FastAPI homography experiment. The browser already performs the same pitch mapping itself.

The main code lives under `src/`. `board.ts` owns canvas interaction and rendering, `main.ts` assembles the interface and workflows, and `store.ts` manages editor state. Separate modules handle import, export, local persistence, and extensions.

## Develop

```bash
npm ci
npm test
npm run build
npm run build:self-hosted
```

Node's built-in test runner covers application logic. Playwright scripts cover browser flows. To build versioned release archives and checksums after installing `zip` and `tar`:

```bash
bash scripts/package-release.sh
```

The script writes the archives to `release/` and reads the version from `package.json`.

## License and trademarks

Except for identified third-party material, the source code and bundled non-trademark assets are available under the [MIT License](LICENSE). The license does not grant rights to the Tactics Journal or Tactics Board names and logos. Read [TRADEMARKS.md](TRADEMARKS.md) before publishing a modified copy.

[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) lists files and data with separate terms. A self-hosted installation is operated by its owner, not by Tactics Journal.

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
