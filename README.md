# Planning Poker

A free, open-source, no-registration Planning Poker (scrum estimation) app.
Create a room, share the link, everyone joins by **name only** and estimates together
in real time. No paywall, no sign-up, unlimited rooms.

Live: **https://poker.serbito.rs**

## Features (MVP)

- Instant room by shareable link — no signup, join by name
- Real-time voting over WebSocket; many independent rooms in parallel
- Votes hidden until **reveal**; reset / re-vote for the next item
- Fibonacci deck (`0 1 2 3 5 8 13 21 ? ☕`)
- Reveal shows **named votes** + summary (distribution, average, consensus)
- Observer/spectator role (doesn't vote)
- Ephemeral, in-memory rooms — no database, no tracking

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
pre-commit install   # run tests + typecheck before every commit (needs `pre-commit`)
npm run dev          # server on :8080, client on :5173 (Vite proxies /ws → :8080)
```

Open http://localhost:5173.

```bash
npm test         # server room-logic unit tests (Vitest)
npm run typecheck
```

## Build & run as one container

```bash
npm run build                  # builds client/dist
docker build -t planning-poker .
docker run -p 8080:8080 planning-poker   # http://localhost:8080
```

## Deploy

Tag-based via GitHub Actions (`.github/workflows/deploy.yml`): push a `v*.*.*` tag.
One-time domain mapping:

```bash
gcloud run domain-mappings create --service planning-poker \
  --domain poker.serbito.rs --region europe-west1
```

Required repo secrets: `GCP_PROJECT_ID`, `GCP_SA_KEY`.

## Repo layout

```
shared/   protocol.ts (WS message types + Fibonacci deck)
server/   Node + ws; rooms registry, Room state machine, static serving
client/   React + Vite SPA
```

## License

MIT
