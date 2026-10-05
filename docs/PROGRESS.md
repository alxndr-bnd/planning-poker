# Planning Poker — Progress

Status as of 2026-05-26; checked against the code on 2026-10-05 (docs audit). Live: **https://poker.serbito.rs** · Repo: `alxndr-bnd/planning-poker`
Source requirements: Product Brief (`docs/planning/product-brief-planning-poker-2026-05-26.md`) and Architecture doc (`docs/planning/architecture.md`).
Jira: implemented by SERBITO-307, 320, 355, 361 · tracked by SERBITO-332 · open: [SERBITO-464](https://serbito.atlassian.net/browse/SERBITO-464) (Gap 1) · Gap 2 fixed on branch `poker-484` (SERBITO-484)

## Releases
| Tag | What |
|---|---|
| v0.1.0 | Scaffold (monorepo, Node+ws server, React+Vite SPA), keyless WIF CI, first Cloud Run deploy |
| v0.2.0 | Poker-table layout: reveal on top, centered players, hand at bottom, green table, observer mic card |
| v0.3.0 | Vote cancel/change (re-click = cancel), Reset button, observer as left card (hides voting cards & hidden from results), dashed "pending" frames, dropped card 0 and host star |
| v0.4.0 | SEO meta (no geo/locale), official GitHub badge, serbito.rs sponsor link (lobby + room), constant table height, home icon |
| v0.5.0 | Felt table background, smaller corner radius, balanced card centering (cards rise on reveal), reveal buttons lower w/ equal spacing, primary "Invite teammates" button, cards 34 & 55 |
| v0.6.0 | Collapsible "How Planning Poker works" block (theory + books + videos) in lobby and room footer |
| v0.7.0 | 🃏 emoji favicon (icon removed from `<title>` to avoid double icon); `?`/`☕` cards shown immediately (don't anchor); **dead code removed** (host role, rename, ping/pong, setConnected); server refactored into `createPokerServer()` factory; **WS integration tests** + **client typecheck** added to the gate; `PROGRESS.md` |
| v0.8.0 … v0.58.0 | Later releases (SEO pages, 8 languages, mobile layout, security fixes, consent): see the git tags; `CHANGELOG.md` starts at v0.51.0 |

## MVP requirements (Product Brief §6) — status
| Requirement | Status |
|---|---|
| Instant room + shareable link; no signup; join by name | ✅ |
| Many independent rooms concurrently (isolated) | ✅ |
| Real-time sync via WebSocket | ✅ |
| Votes hidden until reveal; reset / re-vote | ✅ (+ cancel/change own vote) |
| Fibonacci deck | ✅ `1 2 3 5 8 13 21 34 55 ? ☕` |
| Reveal: named votes + summary (distribution, consensus; no average or median, owner decision 2026-10-02, SERBITO-355) | ✅ |
| Observer / spectator role | ✅ |
| Open by unguessable link; ephemeral rooms | ✅ |

## Differentiators (Brief §7)
| Item | Status |
|---|---|
| No paywall / no signup / unlimited | ✅ |
| Privacy / no tracking | ⚠️ not tracking-free: GA4 (Consent Mode v2: `_ga` cookies only after Accept in the banner, cookieless pings otherwise; SERBITO-320) + cookieless Cloudflare Web Analytics on every page, server-side Sentry; no accounts, room data in memory only. All disclosed on [/privacy](https://poker.serbito.rs/privacy) (SERBITO-307). See Gap #2 |
| Simplicity / zero-friction | ✅ |

## Infra & delivery
| Item | Status |
|---|---|
| Cloud Run `max-instances=1 / min-instances=0` (scale-to-zero) | ✅ |
| Custom domain `poker.serbito.rs` + managed TLS | ✅ |
| Tag-based CI deploy via Workload Identity (keyless, no SA key) | ✅ |
| `main` branch protection (force-push/deletion blocked) | ✅ |
| pre-commit: tests + typecheck before commit | ✅ |
| Security review SERBITO-332 fixes (SERBITO-361): secret rejoin key, per-IP connection / room-creation limits, join timeout, Origin required, message schema, security headers (CSP report-only) | ✅ |

## Extra (beyond the brief)
SEO meta, GitHub badge, serbito.rs sponsor link, theory/resources info block, felt table background, emoji favicon/title.

## Deviations from the brief (intentional, user-requested)
- **Reveal/Reset available to ALL participants** (brief said host-triggered). The host role and `hostId` are removed from the code (resolved gap 4).
- **No average or median** on reveal (owner decision 2026-10-02, SERBITO-355).

## Gaps — remaining
1. **Item-title input** — Brief journey 3 mentions an optional label for "the item being estimated". The protocol/room support `itemTitle` and the UI *displays* it, but there is still **no UI to set it**. → add an input (e.g. alongside Reset, or a field above the table). Fixed on branch `poker-464` (2026-10-05, not released yet): a title field next to Reset / New vote sends `reset.itemTitle`; the server cleans it (`normalizeItemTitle`). → [SERBITO-464](https://serbito.atlassian.net/browse/SERBITO-464)
2. **Privacy nuance** — the lobby/room loaded a **shields.io** GitHub badge (external image request → reveals the visitor to shields.io), disclosed on /privacy (SERBITO-307). Fixed on branch `poker-484` (2026-10-05, not released yet): a plain text link "★ Star on GitHub" replaces the image; shields.io is gone from the CSP and /privacy. → [SERBITO-484](https://serbito.atlassian.net/browse/SERBITO-484)

## Gaps — resolved
3. ~~Test coverage~~ → ✅ added WebSocket integration tests (`server/test/ws.test.ts`) and client `tsc --noEmit` to the typecheck gate (pre-commit + release).
4. ~~Vestigial host code~~ → ✅ removed (host role, `hostId`, `rename`, `ping/pong`, `setConnected`).

## Out of scope (future, per brief)
Mobile-friendly layout (shipped later, SERBITO-355) · Jira/Linear integration & writeback · video-conference embeds · async voting with deadlines · session history / export / persistence across restarts · accounts / optional room password.
