# Security Review — planning-poker (2026-06-21)

Scope: repo `alxndr-bnd/planning-poker` (public), the Node WS+SPA server, CI/CD, container,
GitHub settings. Reviewed by Claude. No live exploitation — static review + config checks.

## Summary

| Area | Result |
|---|---|
| npm dependencies | ✅ `npm audit` = 0 vulnerabilities; Dependabot = 0 open alerts |
| Secret leakage | ✅ gitleaks: no leaks; `.gitignore` excludes `.env`, `.env.*` |
| GitHub hardening | ✅ secret scanning + push protection + Dependabot enabled. ⚠️ no branch protection on `main`; no CodeQL code-scanning |
| Input validation | ⚠️ room id / name / itemTitle validated; **vote value NOT validated** |
| DoS resilience | 🔴 **no WS payload cap, no room/connection/rate limits, no try/catch around message handling** |
| Container | ⚠️ runs as root, `npm install` (not `npm ci`), ships dev deps + tsx in prod |
| Auth model | ✅ none needed (public, no accounts/data); ⚠️ no WS Origin check (CSWSH — low impact) |

The app stores no user data and has no auth, so confidentiality risk is low. The real exposure
is **availability (DoS) on a single Cloud Run instance** (`max-instances=1`) — an attacker can
exhaust memory/CPU or rack up cost (cf. the earlier WebSocket cost-spike incident).

## Findings (prioritized)

### 🔴 HIGH-1 — No WebSocket payload limit (memory DoS)
`new WebSocketServer({ noServer: true })` doesn't set `maxPayload`; the `ws` default is **100 MB**.
A single client can send a 100 MB frame → memory spike / OOM on the one instance.
**Fix:** `new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 })` (messages are tiny).

### 🔴 HIGH-2 — No room / participant / connection / rate caps (resource exhaustion)
`getOrCreateRoom` creates a room for any valid id; no cap on total rooms, participants per room,
connections per IP, or messages/sec. On `max-instances=1` an attacker can OOM the instance and
keep it billable.
**Fix:** cap total rooms (e.g. 5,000) and participants/room (e.g. 100); reject `join` past the
cap; add a simple per-connection message rate limit (e.g. token bucket, ~20 msg/s); optionally
cap concurrent connections. Idle sweep already exists (good) — keep it.

### 🟠 MED-1 — No try/catch around message handling (crash DoS)
The `ws.on("message")` switch calls `room.*` directly; an exception on crafted input propagates
as an unhandled error in the callback → can crash the process (Node `uncaughtException`).
**Fix:** wrap the handler body in try/catch (send an `error` message, don't throw); add
`ws.on("error", …)` and a top-level `process.on("uncaughtException"/"unhandledRejection")` logger.

### 🟠 MED-2 — Vote value not validated against the deck
`room.vote(conn.id, msg.value)` trusts `msg.value`. At runtime a client can send any string;
it pollutes the distribution/stats (and is only saved from XSS by React's auto-escaping).
**Fix:** validate `msg.value ∈ FIBONACCI_DECK` server-side before `room.vote`; reject otherwise.

### 🟠 MED-3 — No Origin check on WS upgrade (CSWSH)
Any website can open `wss://poker.serbito.rs/ws`. Impact is **low** (no auth/cookies/session to
hijack, no private data), but it enables cross-site abuse/spam of rooms.
**Fix (optional):** on `upgrade`, allow only known Origins (poker.serbito.rs, localhost dev) or
no Origin (native clients) — combined with the rate/room caps above.

### 🟡 LOW — Container hardening
- Runs as **root** → add a non-root `USER` in the runtime stage.
- `npm install` → use **`npm ci`** (reproducible, lockfile-pinned).
- Runtime ships full `/app` incl. dev deps + runs via `tsx` → prefer compiling to JS and
  installing prod-only deps (`npm ci --omit=dev`) to shrink image + attack surface.
- Consider pinning `node:22-slim` by digest (supply-chain).

### 🟡 LOW — GitHub repo hardening
- No **branch protection** on `main` (direct pushes, no required PR/review). For a solo OSS repo
  this is a choice, but enabling "require PR" + status checks reduces foot-guns.
- No **CodeQL** code scanning — add the default CodeQL workflow (free for public repos) for
  continuous JS/TS SAST.

## Recommended fix order
1. HIGH-1 `maxPayload` (one line) + MED-1 try/catch — cheapest, biggest DoS reduction.
2. HIGH-2 room/participant caps + simple rate limit.
3. MED-2 vote validation; MED-3 Origin allowlist.
4. LOW: `npm ci` + non-root + prod-only deps in Dockerfile; CodeQL workflow; branch protection.

> NB: `server.ts`, `room.ts`, `rooms.ts` are currently under uncommitted WIP — coordinate before
> editing so security fixes don't tangle with the in-progress feature.
