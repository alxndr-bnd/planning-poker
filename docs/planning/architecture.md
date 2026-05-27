---
stepsCompleted: [1]
inputDocuments:
  - docs/planning/product-brief-planning-poker-2026-05-26.md
  - docs/planning/research/market-planning-poker-research-2026-05-26.md
workflowType: 'architecture'
project_name: 'planning-poker'
user_name: 'Alexanderbondarchuk'
architect: 'Winston (BMAD)'
date: '2026-05-26'
repo: 'alxndr-bnd/planning-poker (public)'
prd: 'none — built directly from Product Brief by user decision'
status: draft
---

# Architecture Decision Document — Planning Poker

Source of truth: the Product Brief. This document makes the technical decisions an
implementer (human or AI agent) needs to build consistently. Guiding principles:
**boring technology, single deployable, developer productivity.**

## 1. Architecture at a glance

```
Browser (SPA)  ──HTTPS──►  Cloud Run service (poker.serbito.rs)
   React+Vite      ──WSS──►   single Node container:
   (static)                     • serves built static SPA
                                • /ws WebSocket endpoint
                                • in-memory Map<roomId, Room>
   max-instances=1, min-instances=0 (scale-to-zero). No DB.
```

**One container does everything** — serves the built SPA *and* the WebSocket server.
This is the key decision: it yields one Cloud Run service, one Dockerfile, one deploy,
and no CORS/cross-origin WS config. With `max-instances=1` all rooms live in one
process, so in-memory state is always consistent without Redis/pub-sub.

## 2. Stack decision (with trade-offs)

| Layer | Choice | Why / trade-off |
|---|---|---|
| Language | **TypeScript** end-to-end | One language, shared types for the WS protocol (client+server import the same message types). |
| Frontend | **React + Vite** | Boring, huge ecosystem, sub-second HMR for fast local iteration. *Alt:* Svelte (leaner) — rejected only to favor familiarity/ecosystem; revisit if bundle size matters. Desktop-first, so no RN/mobile concerns. |
| State (FE) | Local component state + a thin WS client store (e.g. Zustand) | No need for Redux; room state is pushed from server, client is mostly a renderer. |
| Backend | **Node + `ws`** library | Rock-solid, minimal, native to Cloud Run. *Alt:* Bun+Elysia (faster dev, used by the jkrumm analog) — rejected for MVP: newer, less boring; revisit later. |
| HTTP/static | Node `http` + a tiny static handler (or `sirv`) serving `client/dist` | Avoids a second service/CDN. SPA fallback to `index.html`. |
| Room id | **`nanoid`** (e.g. 10 chars, URL-safe) | Unguessable, short, dependency-light. |
| Shared types | `/shared` package (or a single `protocol.ts` imported by both) | Single definition of WS messages → no drift. |
| Tests | **Vitest** (server room-logic unit tests first) | Room state machine is the risk area; cover it. |
| Lint/format | ESLint + Prettier | Boring baseline. |

**No database, no auth, no sessions store** — ephemeral in-memory only, per brief.

## 3. Repository structure (`alxndr-bnd/planning-poker`)

```
planning-poker/
├── client/                 # React + Vite SPA
│   ├── src/
│   │   ├── App.tsx
│   │   ├── ws.ts           # WS client: connect, auto-reconnect, send/recv
│   │   ├── store.ts        # room state from server
│   │   └── components/     # Lobby, Room, Card, Participants, Results
│   ├── index.html
│   └── vite.config.ts      # dev proxy /ws → localhost:8080
├── server/                 # Node + ws
│   ├── src/
│   │   ├── index.ts        # http server: static + /ws upgrade
│   │   ├── rooms.ts        # Map<roomId, Room>, create/join/vote/reveal/reset/cleanup
│   │   ├── room.ts         # Room state machine + types
│   │   └── static.ts       # serve client/dist with SPA fallback
│   └── test/rooms.test.ts  # Vitest unit tests for room logic
├── shared/
│   └── protocol.ts         # WS message types + Fibonacci deck constant
├── Dockerfile              # multi-stage: build client + server → run node
├── .dockerignore
├── .github/workflows/deploy.yml
├── package.json            # workspaces: client, server, shared
├── README.md               # what it is, run locally, deploy
└── LICENSE                 # MIT (open source)
```

Monorepo via npm/pnpm workspaces. `shared` is imported by both client and server so
the protocol can never drift.

## 4. Domain model (in-memory)

```ts
type Phase = 'voting' | 'revealed';
type CardValue = '0'|'1'|'2'|'3'|'5'|'8'|'13'|'21'|'?'|'☕'; // Fibonacci + skip/coffee

interface Participant {
  id: string;          // server-assigned connection id
  name: string;        // self-declared, required
  isObserver: boolean;
  vote: CardValue | null;  // server keeps it; only exposed on reveal
  connected: boolean;
}

interface Room {
  id: string;
  phase: Phase;
  itemTitle: string | null;   // optional current item label
  participants: Map<string, Participant>;
  hostId: string;             // first joiner; can reveal/reset (soft role)
  createdAt: number;
  lastActivityAt: number;     // for TTL cleanup
}
```

Rooms are created on first join (open-by-link): visiting `/r/<roomId>` and sending
`join` creates the room if it doesn't exist. No separate "create" persistence needed.

## 5. WebSocket protocol

Single endpoint `wss://poker.serbito.rs/ws`. JSON messages, discriminated by `type`.
Defined once in `shared/protocol.ts`.

**Client → Server**
| type | payload | notes |
|---|---|---|
| `join` | `{ roomId, name, asObserver }` | creates room if absent; (re)attaches on reconnect |
| `vote` | `{ value }` | only in `voting` phase; ignored for observers |
| `reveal` | `{}` | host action → phase `revealed` |
| `reset` | `{ itemTitle? }` | host action → clears votes, phase `voting` |
| `setObserver` | `{ isObserver }` | toggle own role |
| `rename` | `{ name }` | optional |
| (ping) | — | heartbeat (or rely on WS ping frames) |

**Server → Client**
| type | payload | notes |
|---|---|---|
| `joined` | `{ youId, roomId }` | ack with your connection id |
| `state` | `{ phase, itemTitle, participants:[{id,name,isObserver,connected,hasVoted, vote?}] }` | broadcast on every change. `vote` present **only** when `phase=revealed`; during `voting` only `hasVoted:boolean` is sent (votes stay hidden server-side) |
| `summary` | `{ distribution, average, consensus }` | sent with/after reveal |
| `error` | `{ code, message }` | e.g. invalid action for phase |

**Key rule:** during `voting`, the server never sends actual vote values — only
`hasVoted` flags. Hidden-until-reveal is enforced **server-side**, not in the UI.

## 6. Room state machine

```
        join/vote/leave (rebroadcast state)
        ┌───────────────┐
        ▼               │
   ┌─────────┐  reveal   ┌──────────┐
   │ voting  │ ────────► │ revealed │
   └─────────┘           └──────────┘
        ▲     reset (clear votes,     │
        └──────── new itemTitle?) ◄───┘
```

- **voting:** estimators pick a card (`hasVoted` shown, value hidden). Host can `reveal`.
- **revealed:** named votes + `summary` exposed. Host can `reset` → back to voting.
- Observers never contribute votes and are excluded from `summary`.
- Host = first joiner; if host leaves, host role transfers to the next connected
  participant (soft, no auth — internal tool).

## 7. Lifecycle, reconnect & cleanup

- **Reconnect:** Cloud Run drops a WS at ~60 min. Client auto-reconnects with backoff
  and re-sends `join` (same name) → server re-attaches/re-creates the participant.
  Because state is server-held and rebroadcast, the UI heals on reconnect.
- **Disconnect:** mark participant `connected=false`, keep briefly (grace for reconnect),
  remove after a short timeout; broadcast state.
- **Empty room TTL:** when the last participant leaves (or all disconnected > N min),
  delete the room from the Map. Drives the room to nothing → instance can scale to zero.
- **Cleanup mechanism:** event-driven on disconnect + a light interval sweep. (Note:
  Cloud Run allocates CPU during request processing; an open WS keeps CPU, so the sweep
  runs while anyone is connected — which is exactly when cleanup matters.)

## 8. Deployment (GCP Cloud Run)

- **Service:** new Cloud Run service (e.g. `planning-poker`), separate from `django-app`.
- **Scaling:** `--max-instances=1 --min-instances=0` (scale-to-zero; no always-on cost).
- **Concurrency:** high (e.g. `--concurrency=250`) — many WS connections per instance.
- **CPU:** request-based (default) is fine — WS connection = active request = CPU.
- **Domain mapping:** map `poker.serbito.rs` to the service (Cloud Run domain mapping
  or via the existing load balancer). DNS `poker` CNAME/A per GCP instructions.
- **Image:** multi-stage Dockerfile → (1) build `client` (Vite) and `server` (tsc),
  (2) runtime stage = slim Node running the server, which serves `client/dist` + `/ws`.
- **CI/CD:** `.github/workflows/deploy.yml` — build & push image to Artifact Registry,
  deploy to Cloud Run. Trigger on tag or `main` (decide per the incremental-deploy
  preference; tag-based mirrors the serbito habit and gives clean rollbacks).
- **Secrets:** none required for MVP (no DB, no API keys).

## 9. Local dev (fast iteration)

- `pnpm --filter client dev` → Vite dev server (HMR) on :5173, **proxies `/ws` to
  localhost:8080**.
- `pnpm --filter server dev` → `tsx watch server/src/index.ts` on :8080 (auto-restart).
- Two terminals (or a single `pnpm dev` running both via a tiny concurrently script).
- Shared `protocol.ts` gives instant type errors on both sides when the contract changes.
- `pnpm --filter server test` → Vitest on room logic.

## 10. Incremental build sequence (deploy-as-you-go)

1. **Skeleton + deploy:** monorepo, "hello" SPA + Node serving it, Dockerfile, Cloud
   Run service live at poker.serbito.rs (proves the pipe end-to-end).
2. **WS echo + presence:** `join` + `state` broadcast → see participants appear live.
3. **Voting + hidden + reveal:** cards, `hasVoted`, `reveal` shows named votes.
4. **Summary + reset:** distribution/average/consensus; re-vote loop.
5. **Observer role + host transfer + reconnect/cleanup polish.**
6. **Polish:** copy-link UX, empty/edge states, simple styling (agilenatives-simple).

Each step is independently deployable — matches the "small, frequent releases" requirement.

## 11. Out of scope (architectural placeholders)

No DB layer, no auth provider, no horizontal scale (single instance). If/when needed:
introduce a shared room store (Redis) + sticky routing to lift `max-instances=1`; add a
persistence adapter behind the `rooms` module (kept deliberately swappable).

## 12. Open items
- Build trigger: tag-based vs `main`-push (lean tag-based for rollbacks).
- Domain mapping path: Cloud Run direct mapping vs existing GCP load balancer.
- Styling approach (plain CSS / Tailwind / a tiny UI kit) — defer to scaffold.
