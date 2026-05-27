---
docType: product-brief
project: planning-poker
date: 2026-05-26
author: Alexanderbondarchuk
analyst: Mary (BMAD)
repo: alxndr-bnd/planning-poker (public)
status: ready
inputDocuments:
  - docs/planning/research/market-planning-poker-research-2026-05-26.md
---

# Product Brief: Planning Poker (poker.serbito.rs)

## 1. Executive Summary

A free, no-registration, open-source Planning Poker (scrum story-point estimation)
web app for the team, hosted at **poker.serbito.rs**. Users join a room by **name
only** and estimate together in real time. The product's identity is **zero
friction and no gates**: no paywall, no sign-up, unlimited sessions — the honest
opposite of competitors who gate integrations or advanced features behind login or
payment. Inspiration: the now-defunct `poker.agilenatives.com` (simple, fun, free).
The only link to the existing serbito project is the shared domain `serbito.rs`.

## 2. Problem & Motivation

**Today the team estimates by typing scores (a 1‑2‑3 scale) into a chat.** This has no
*hidden* voting (early numbers anchor everyone), no simultaneous reveal, no consensus
view, and estimates get lost in the chat history. A purpose-built, self-hosted,
open-source Planning Poker tool replaces this with simultaneous hidden voting, a clean
reveal, and zero friction — permanent, private, free, and fully under the team's control.

## 3. Goals & Success Criteria

- **Adoption:** the team uses it as the default tool for sprint estimation.
- **Zero friction:** start a session and get everyone voting in **< 10 seconds**, no
  signup, no tutorial.
- **Core loop works reliably:** create room → share link → join by name → vote
  (hidden) → reveal → discuss → reset/re-vote.
- **Stable at team scale:** several concurrent rooms, dozens of users, no desync.
- **Free & open forever:** no paywall, public repo, self-hosted.

_Non-goals as success metrics: revenue, sign-ups, market share — this is an internal
team tool, not a commercial product._

## 4. Target Users & Roles

- **Facilitator / host** — creates the room, drives items, triggers reveal/reset; may
  participate as an **observer** (does not vote).
- **Estimator** — joins by name, casts a hidden vote, sees results on reveal.
- **Observer / spectator** — watches without voting (PM, stakeholder, facilitator).

No accounts; identity is a self-declared display name per session.

## 5. Key User Journeys

1. **Start a session:** Host opens poker.serbito.rs → "Create room" → gets a room
   with an unguessable link → shares it.
2. **Join:** Member opens link → enters name → lands in the room, sees participants
   live.
3. **Estimate one item:** (optional item title) → everyone picks a card → votes hidden
   → host reveals → distribution + average/consensus shown → discuss → reset for next
   item.
4. **Observe:** A participant toggles observer mode (or joins as observer) → present
   but excluded from voting and tallies.

## 6. Scope

### MVP (in)
1. Instant room creation + shareable invite link; **no signup**; join by **name only**.
2. **Many independent rooms run concurrently** on one instance — each room is fully
   isolated (own participants, votes, reveal state), addressed by its own unguessable
   link. Group A and Group B estimate in parallel without seeing each other.
3. **Real-time** sync of participants and votes via **WebSocket**.
4. Votes **hidden until reveal**; **reset / re-vote** for the next item.
5. **Fibonacci** deck only (single scale for MVP).
6. **Reveal shows named votes** — who voted what — plus a summary (distribution +
   average/consensus).
7. **Observer/spectator** role.
8. Open by link (unguessable room id); ephemeral rooms.

### Out of scope (MVP) — future considerations
- **Mobile-friendly layout** (desktop-first; user confirmed mobile NOT needed).
- **Additional decks** (T-shirt / custom / simple 1-2-3); Fibonacci only at MVP.
- Jira / Linear integration & story-point writeback.
- Video-conference embeds (Zoom/Teams/Meet).
- Async voting with deadlines.
- Session history / export / persistence across restarts.
- Accounts, optional room password.

## 7. Differentiators (free, by design)
- **No paywall, no sign-up, unlimited sessions** — honest free + open-source.
- **Privacy** — no accounts, minimal/no tracking, ephemeral data.
- **Simplicity** — agilenatives-style zero-friction, no tutorial needed.
- **Self-hosted & open** — full control, code public on GitHub.

## 8. Technical Context & Constraints
- **Hosting:** GCP Cloud Run (separate service in the same GCP account as serbito;
  no code/infra coupling beyond the `serbito.rs` domain → `poker.serbito.rs`).
- **Scaling policy:** `max-instances=1` + `min-instances=0` (**scale-to-zero**). One
  instance while active → no in-memory desync; scales to zero when idle → **no
  always-on cost** (user confirmed shutting down on inactivity is fine). An open
  WebSocket keeps the instance alive during a live session; it scales down only once
  no connections/traffic remain. Cold start on the first request after idle is acceptable.
- **Realtime:** WebSocket; **state is in-memory** (ephemeral rooms, no DB for MVP).
- **Access:** anyone with the room link; room ids must be **unguessable** (random).
- **Scale:** several teams / dozens of concurrent users; light load.
- **Frontend:** a **modern FE** (SPA) is the only hard FE requirement (e.g. React/Vite
  or Svelte). Keep it minimal and OSS-friendly. Reference analog: `jkrumm/free-planning-poker`.
- **Backend:** small WebSocket server (lightweight Node/Bun, single container) holding
  in-memory rooms. (Backend stack left to implementer; FE just needs to be modern.)
- **Repository:** public GitHub repo **`alxndr-bnd/planning-poker`**; separate local folder.
- **Dev & delivery workflow (requirement):** fast **local iteration** (hot-reload dev
  server) and **incremental deploy** to Cloud Run as features land — small, frequent,
  low-risk releases rather than a big-bang launch.

## 9. Risks & Mitigations
| Risk | Impact | Mitigation |
|---|---|---|
| **Cloud Run autoscaling splits in-memory room state across instances** | Participants in the same room land on different instances → desync | **`max-instances=1`** so only one instance ever holds room state; revisit (Redis/pub-sub) only if load forces >1 instance |
| **Scale-to-zero on idle loses in-memory rooms** | A room that goes fully idle is gone when the instance stops | **Accepted by user** (rooms are ephemeral, short-lived). An open WS keeps the instance up during a live session; only fully-idle rooms are lost |
| **Cold start after idle** | First request after scale-to-zero is slower | Acceptable; lightweight image keeps cold start small |
| **Cloud Run ~60-min request timeout on WebSocket** | Long sessions drop the socket | Client **auto-reconnect** + rejoin; ephemeral state tolerates reconnect |
| **Open-by-link → uninvited joins / trolling** | Minor for internal use | Unguessable room ids; (future) optional room password |
| **`max-instances=1` caps concurrency** | Heavy simultaneous load could saturate one instance | Fine at target scale (several teams / dozens of users); scale out later with shared state if needed |

## 10. Resolved Decisions
1. **Frontend:** modern SPA (the only fixed FE requirement); backend = small WS server.
2. **Deck:** Fibonacci only for MVP.
3. **Reveal:** named votes (show who voted what).
4. **Today's method:** team votes 1‑2‑3 typed into chat → this is what we replace.
5. **Repo:** `alxndr-bnd/planning-poker` (public).
6. **Dev workflow:** fast local iteration + incremental Cloud Run deploys.

### Still open (minor)
- Exact backend language/runtime (implementer's choice; must support WebSocket + easy Cloud Run deploy).
- Whether to surface a simple optional room behavior later (password, etc.).

---
_Next: hand off to PRD (PM agent) for detailed requirements, or generate an LLM
distillate of this brief for downstream planning._
