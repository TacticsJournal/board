# Configuration

The normal build needs no environment file.

## Build modes

Use the hosted-mode build for the ordinary bundle:

```bash
npm run build
```

Use the self-host build for a local static installation and local extensions:

```bash
npm run build:self-hosted
```

The build flag is exact. `BOARD_SELF_HOSTED=true` enables self-host mode. Other values do not.

For extension work with the development server:

```bash
BOARD_SELF_HOSTED=true npm run dev
```

## Optional FastAPI service

`backend/main.py` is an optional experiment service. The static app does not require it or configure its URL. The service exposes:

- `GET /api/health`
- `POST /api/map-points` for four-corner homography mapping

The browser performs the homography calculation itself, so most self-hosted installations do not need this service.

Start the supported part locally with:

```bash
python3 -m venv .venv
. .venv/bin/activate
python -m pip install -r requirements.txt
npm run api
```

`npm run api` starts Uvicorn on `0.0.0.0:8000` with reload enabled. Do not expose this development process directly to the public internet. Put authentication, rate limiting, HTTPS, and a suitable reverse proxy in front of any service you operate.

The backend has no required environment variables. Its CORS allowlist is set in `backend/main.py`; change that list before serving the API from another origin.

## External data

Team search uses TheSportsDB endpoints and the checked-in `public/teams-index.json` index. Squad data is fetched from Wikipedia at runtime and is not bundled. See [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md) for source and licensing notes.
