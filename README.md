# Planning Poker

A free, open-source, no-registration Planning Poker (scrum estimation) app.
Create a room, share the link, everyone joins by **name only** and estimates together
in real time. No paywall, no sign-up, unlimited rooms.

Live: **https://poker.serbito.rs** — also listed on
[AlternativeTo](https://alternativeto.net/software/estimation-poker-serbito/about/).

## Features (MVP)

- Instant room by shareable link — no signup, join by name
- Real-time voting over WebSocket; many independent rooms in parallel
- Votes hidden until **reveal**; reset / re-vote for the next item
- Fibonacci deck (`1 2 3 5 8 13 21 34 55 ? ☕`, plus `89`–`610` behind "More")
- Reveal shows **named votes** + summary (distribution, consensus); no average or
  median by design
- Observer/spectator role (doesn't vote)
- Ephemeral, in-memory rooms — no database, no accounts
- Analytics on poker.serbito.rs: Google Analytics 4 (sets cookies; page views and room
  events, including the card voted) and cookieless Cloudflare Web Analytics; server errors
  go to Sentry. Names and room ids are never sent. All three are optional: a self-hosted
  copy has none of them unless you set them (see "Self-hosting").

## Tech

- **Frontend:** React + Vite + TypeScript (SPA, desktop-first)
- **Backend:** Node + `ws`, in-memory `Map<roomId, Room>` (single process)
- **Shared:** one `shared/protocol.ts` imported by both → the WS contract can't drift
- **Hosting:** one container (Node serves the built SPA *and* `/ws`) on GCP Cloud Run,
  `min-instances=0 / max-instances=1` (scale-to-zero, no always-on cost)

## Develop locally

Requires Node ≥ 20.

```bash
npm install
npx playwright-core install chromium  # once: the browser for server/test/consent_focus.test.ts
pre-commit install   # run tests + typecheck before every commit (needs `pre-commit`)
npm run dev          # server on :8080, client on :5173 (Vite proxies /ws → :8080)
```

Open http://localhost:5173.

```bash
npm test         # Vitest: room logic, WebSocket server, security, static serving,
                 # SEO, i18n, analytics, Sentry, cross-promo
npm run typecheck
npm run sitemap  # regenerate client/public/sitemap.xml after adding/editing a page
```

`sitemap.xml` is generated from the pages (`lastmod` = each page's last commit) and
committed, since the Docker build has no git history; a test fails when it's stale.
Unknown paths return 404 (rooms live in the `#/r/<id>` hash, so no SPA fallback).

## Build & run as one container

```bash
npm run build                  # builds client/dist
docker build -t planning-poker .
docker run -p 8080:8080 planning-poker   # http://localhost:8080
```

## Releasing

1. With every change players notice, add an English line `- ...` under `## [Unreleased]` in
   [CHANGELOG.md](CHANGELOG.md) (`### Added` / `Changed` / `Fixed` / `Security`).
2. `scripts/release_minor.sh "message"` refuses to release when `[Unreleased]` is empty. Otherwise it
   dates the entries as `## [X.Y.0]`, runs the gate, tags, pushes and creates the GitHub Release.
3. The deploy fails for a tag without its `## [X.Y.Z]` section in CHANGELOG.md.
4. Weekly OS refresh (SERBITO-401): every Wednesday 03:00 UTC (or *Run workflow*) the deploy rebuilds the newest
   `vX.Y.Z` tag with fresh Debian packages and redeploys it (same version, image `<sha>-r<YYYYMMDD>`). If the main
   page is not 200 after any deploy, traffic goes back to the previous revision and the run fails.

## Self-hosting

One container, no database. Build it and run it behind your own HTTPS domain:

```bash
docker build -t planning-poker .
docker run -p 8080:8080 -e ALLOWED_ORIGINS=https://poker.example.com planning-poker
```

Or without Docker (Node ≥ 20): `npm ci && npm run build`, then
`NODE_ENV=production ALLOWED_ORIGINS=https://poker.example.com npm start`.

Set at run time:

| Variable | Required | What it does |
|---|---|---|
| `ALLOWED_ORIGINS` | yes | Page origins that may open the WebSocket, comma-separated, e.g. `https://poker.example.com`. Default: `https://poker.serbito.rs` only, so rooms do not connect on another domain until you set it. In production `localhost` is not allowed unless you list it. |
| `PORT` | no | Listen port. Default `8080`. |
| `SENTRY_DSN` | no | Send server errors to your Sentry project. Unset: no error reporting. |

Set at build time (`docker build --build-arg NAME=value`, or env vars for `npm run build`):

| Variable | What it does |
|---|---|
| `GA_MEASUREMENT_ID` | Your GA4 id (`G-…`). Adds gtag.js and the cookie consent banner to every page. Unset: no Google Analytics and no banner. |
| `CF_BEACON_TOKEN` | Your Cloudflare Web Analytics token. Unset: no beacon. |

Notes:

- The WebSocket is refused on `*.run.app` hosts (SERBITO-348). On Cloud Run, map your own domain.
- The guides' canonical links and `/privacy` describe poker.serbito.rs. Edit them for your
  instance if you publish it.

## Deploy

Tag-based via GitHub Actions (`.github/workflows/deploy.yml`): push a `v*.*.*` tag
(with `scripts/release_minor.sh`, see "Releasing").
One-time domain mapping:

```bash
gcloud run domain-mappings create --service planning-poker \
  --domain poker.serbito.rs --region europe-west1
```

Required repo secrets: `GCP_PROJECT_ID`, `GCP_SA_KEY`. The live GA4 id and Cloudflare
beacon token are in `deploy.yml` (`env:`) and reach the image as build args.

## Repo layout

```
shared/   protocol.ts (WS message types + Fibonacci deck)
server/   Node + ws; rooms registry, Room state machine, static serving
client/   React + Vite SPA
```

## License

MIT

## Other projects

- **GTD** — free GTD task manager with a Telegram bot:
  [gtd.serbito.rs](https://gtd.serbito.rs/?utm_source=github&utm_medium=crosspromo&utm_campaign=readme)
  · [source](https://github.com/alxndr-bnd/gtd)
- **Javi** — delivery notifications for small businesses in Serbia:
  [javi.serbito.rs](https://javi.serbito.rs/?utm_source=github&utm_medium=crosspromo&utm_campaign=readme)
  · [source](https://github.com/alxndr-bnd/javi)
- **Serbito** — classifieds in Serbia:
  [serbito.rs](https://serbito.rs/?utm_source=github&utm_medium=crosspromo&utm_campaign=readme)

Made by [No Handoff](https://www.linkedin.com/company/nohandoff/).
