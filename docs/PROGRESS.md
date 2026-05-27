# Planning Poker — Progress

Status as of 2026-05-26. Live: **https://poker.serbito.rs** · Repo: `alxndr-bnd/planning-poker`
Source requirements: Product Brief (`docs/planning/product-brief-planning-poker-2026-05-26.md`) and Architecture doc (`docs/planning/architecture.md`).

## Releases
| Tag | What |
|---|---|
| v0.1.0 | Scaffold (monorepo, Node+ws server, React+Vite SPA), keyless WIF CI, first Cloud Run deploy |
| v0.2.0 | Poker-table layout: reveal on top, centered players, hand at bottom, green table, observer mic card |
| v0.3.0 | Vote cancel/change (re-click = cancel), Reset button, observer as left card (hides voting cards & hidden from results), dashed "pending" frames, dropped card 0 and host star |
| v0.4.0 | SEO meta (no geo/locale), official GitHub badge, serbito.rs sponsor link (lobby + room), constant table height, home icon |
| v0.5.0 | Felt table background, smaller corner radius, balanced card centering (cards rise on reveal), reveal buttons lower w/ equal spacing, primary "Invite teammates" button, cards 34 & 55 |
| v0.6.0 | Collapsible "How Planning Poker works" block (theory + books + videos) in lobby and room footer |
| _(local, unreleased → v0.7.0)_ | 🃏 emoji favicon (icon removed from `<title>` to avoid double icon); `?`/`☕` cards shown immediately (don't anchor); **dead code removed** (host role, rename, ping/pong, setConnected); server refactored into `createPokerServer()` factory; **WS integration tests** + **client typecheck** added to the gate; `PROGRESS.md` |

## MVP requirements (Product Brief §6) — status
| Requirement | Status |
|---|---|
| Instant room + shareable link; no signup; join by name | ✅ |
| Many independent rooms concurrently (isolated) | ✅ |
| Real-time sync via WebSocket | ✅ |
| Votes hidden until reveal; reset / re-vote | ✅ (+ cancel/change own vote) |
| Fibonacci deck | ✅ `1 2 3 5 8 13 21 34 55 ? ☕` |
| Reveal: named votes + summary (distribution, average, consensus) | ✅ |
| Observer / spectator role | ✅ |
| Open by unguessable link; ephemeral rooms | ✅ |

## Differentiators (Brief §7)
| Item | Status |
|---|---|
| No paywall / no signup / unlimited | ✅ |
| Privacy / no tracking | ⚠️ mostly — see Gap #2 |
| Simplicity / zero-friction | ✅ |

## Infra & delivery
| Item | Status |
|---|---|
| Cloud Run `max-instances=1 / min-instances=0` (scale-to-zero) | ✅ |
| Custom domain `poker.serbito.rs` + managed TLS | ✅ |
| Tag-based CI deploy via Workload Identity (keyless, no SA key) | ✅ |
| `main` branch protection (force-push/deletion blocked) | ✅ |
| pre-commit: tests + typecheck before commit | ✅ |

## Extra (beyond the brief)
SEO meta, GitHub badge, serbito.rs sponsor link, theory/resources info block, felt table background, emoji favicon/title.

## Deviations from the brief (intentional, user-requested)
- **Reveal/Reset available to ALL participants** (brief said host-triggered). The "host" role is now vestigial — the server still computes/sends `hostId`, the client ignores it.

## Gaps — remaining
1. **Item-title input** — Brief journey 3 mentions an optional label for "the item being estimated". The protocol/room support `itemTitle` and the UI *displays* it, but there is still **no UI to set it**. → add an input (e.g. alongside Reset, or a field above the table).
2. **Privacy nuance** — the lobby/room load a **shields.io** GitHub badge (external image request → reveals the visitor to shields.io), slightly at odds with the "no tracking" positioning. → options: self-host a static badge image, or drop the live star-count badge.

## Gaps — resolved
3. ~~Test coverage~~ → ✅ added WebSocket integration tests (`server/test/ws.test.ts`) and client `tsc --noEmit` to the typecheck gate (pre-commit + release).
4. ~~Vestigial host code~~ → ✅ removed (host role, `hostId`, `rename`, `ping/pong`, `setConnected`).

## Out of scope (future, per brief)
Mobile-friendly layout · Jira/Linear integration & writeback · video-conference embeds · async voting with deadlines · session history / export / persistence across restarts · accounts / optional room password.
