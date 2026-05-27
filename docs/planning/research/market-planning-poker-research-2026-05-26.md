---
stepsCompleted: [1, 2]
inputDocuments: []
workflowType: 'research'
lastStep: 2
research_type: 'market'
research_topic: 'Planning Poker tools — competitive & feature landscape'
research_goals: 'Identify table-stakes features, common differentiators, access/pricing models, and gaps/opportunities for a small open-source self-hosted Planning Poker app (poker.serbito.rs); feed into a Product Brief.'
user_name: 'Alexanderbondarchuk'
date: '2026-05-26'
web_research_enabled: true
source_verification: true
---

# Research Report: market

**Date:** 2026-05-26
**Author:** Alexanderbondarchuk
**Research Type:** Market Research (competitive & feature landscape)

---

## Research Overview

Competitive/feature scan of existing Planning Poker (scrum estimation) tools to inform
requirements for a new, separate, open-source, self-hosted app at poker.serbito.rs.
NOT a market-sizing study — this is an internal team tool. Focus: table-stakes vs.
differentiators, access/pricing models, open-source alternatives, and gaps/opportunities.

## Research Scope (confirmed)

- Targets: PlanningPokerOnline, PlanITPoker, Pointing Poker, Scrum Poker for Jira, Hatjitsu, and OSS alternatives.
- Dimensions: realtime session mechanics, deck/scales, observers/roles, integrations (Jira/Linear), auth/anonymity, pricing/free limits, OSS licensing & self-hosting.
- Output feeds: Product Brief (next).

---

<!-- Findings appended by subsequent steps -->

---

## Findings (web research, 2026-05-26)

### Positioning (confirmed with user)
Fully free, **no paywall**, **no registration** (name only), **unlimited sessions**, **open-source & self-hosted** at poker.serbito.rs. Inspiration: `poker.agilenatives.com` (liked, simple/old-school look, currently down). AgileNatives' AgilePoker positioned as "All the fun, on all devices, now for free".

### Competitive landscape (scan)
| Tool | Free / no-signup | Decks | Integrations | Notes |
|---|---|---|---|---|
| PlanningPoker.live | Free, no signup | Fibonacci / T-shirt / custom | **Jira + Linear (writeback), free**; Zoom/Teams/Meet/Webex embeds | Most generous free integrations |
| Kollabe | Free, no signup (117K+ teams) | Fibonacci / T-shirt / custom | Jira | **Async voting** (reveal when all in) |
| Planning Poker Online (planningpokeronline.com) | Freemium | Fib / T-shirt / custom | Jira (paid marketplace), Linear, GitHub, Azure DevOps | Sub-second realtime; integrations gated |
| PlanITPoker | Free quick play, signup for more | Custom decks | Jira | Room settings |
| Pointing Poker | Free, no signup | Standard | — | Minimalist, instant |
| Scrum Poker Online (scrumpoker-online.org) | Free, no signup/email | Story points | — | Privacy-light |
| Scrum Jam | Free, no signup | — | — | One-click; Poker + Retro |
| Agile Poker for Jira (Atlassian) | Paid app | Multiple modes | Deep Jira | Enterprise/async modes |

### Closest analog — `jkrumm/free-planning-poker` (OSS, our model)
"Free forever — no limits, no premium tiers", "no sign-up", "privacy-first — no tracking, no IP stored", GDPR, unlimited rooms/participants, mobile-friendly, **open source**, "hundreds of daily users". Stack: Next.js + tRPC + Mantine (Vercel) · Bun/Elysia **WebSocket** server (VPS) · Drizzle + MariaDB · votes in browser localStorage. **Validates that our exact positioning is viable and has a real (small) niche.**

### Other OSS/self-hosted references
axeleroy/self-host-planning-poker (Docker, Socket.IO) · inovex/planning-poker (node + WS) · yarosla/poker (self-contained, intranet) · qJake/planning-poker (.NET + WS).

### Table-stakes (must-have — present across ~all tools)
1. Instant room creation + shareable link, **no signup**; join with **name only**.
2. Real-time sync (WebSocket) of participants & votes.
3. Hidden votes until **reveal**; **reset/re-vote** for next item.
4. Decks: **Fibonacci** (+ ideally T-shirt / custom).
5. Result summary on reveal (distribution, average/consensus).
6. Mobile-friendly.

### Common differentiators (often gated/paid elsewhere — our chance to include free)
- **Observer/spectator** role (e.g. facilitator/PM doesn't vote).
- **Jira/Linear integration** with story-point writeback (biggest paid lever; heavy to build).
- Video-conf embeds; **async voting with deadline**; timer; session history/export; custom decks; emoji/fun reactions.

### Gaps / opportunities for us
- Genuinely **no-paywall + no-signup + OSS + self-hosted** is rare — essentially only jkrumm. Clear, honest niche.
- **Privacy/no-tracking** is a credible differentiator (no accounts, minimal data).
- **Simplicity** (agilenatives-style, zero-friction, no tutorial) over feature bloat.
- Integrations (Jira/Linear) are the main thing paid tools sell — we can defer (team-internal use) and add later if needed.

### Sources
- https://www.agilenatives.com/agilepoker
- https://planningpoker.live/ , https://planningpoker.live/features
- https://kollabe.com/planning-poker , https://kollabe.com/posts/best-free-planning-poker-tools
- https://planningpokeronline.com/ , https://planningpokeronline.com/planning-poker-for-jira/
- https://planitpoker.com/ , https://pointingpoker.com/ , https://www.scrumpoker-online.org/en/ , https://www.scrumjam.app/
- https://github.com/jkrumm/free-planning-poker , https://github.com/axeleroy/self-host-planning-poker , https://github.com/inovex/planning-poker , https://github.com/yarosla/poker
- https://ludi.co/blog/best-planning-poker-tools , https://marketplace.atlassian.com/apps/700473/agile-poker-for-jira-planning-estimation

### Scoping decisions (user, 2026-05-26)
- **Mobile-friendly layout: OUT of scope** — desktop-first; mobile not a priority for the team tool. (Removes item 6 from table-stakes for OUR MVP.)
- All other synthesis (table-stakes 1–5, no-paywall/no-signup/unlimited positioning, deferred integrations) confirmed.
