# SEO + Product Roadmap — "world-class free planning poker" (2026-06-21)

Plan to take `poker.serbito.rs` from "just shipped basic SEO" to a top-ranking, world-class,
free/open-source planning poker. Inputs: `01-competitor-analysis-2026-06-21.md`,
`02-keyword-strategy.md`. Phased by impact/effort; check items off as shipped.

## Already shipped (v0.8.0, 2026-06-21)
- ✅ Static crawlable landing inside `#root` (H1 + hero + how-it-works + FAQ, keyword-rich).
- ✅ `FAQPage` + `WebApplication` JSON-LD.
- ✅ Real `robots.txt` + `sitemap.xml`; `.txt`/`.xml` MIME in `serveStatic`.
- ✅ Strong base meta (title/description/keywords/OG/Twitter/canonical), `lang=en`.
- ✅ 6 vitest guards (`server/test/seo.test.ts`).

---

## Phase 0 — Technical SEO foundations (finish the basics) — HIGH impact, LOW effort

- [ ] **Submit to Google Search Console** (property added) → submit `sitemap.xml`, Request
      Indexing for `/`. (Owner action; verification TXT can go via Cloudflare.)
- [ ] **OG image** 1200×630 PNG (`/og-image.png`) + `og:image`/`twitter:image` and switch
      `twitter:card` to `summary_large_image`. (Needs a designed asset — competitors all have one.)
- [ ] **Prerender the public pages** (Vite SSG / `vite-plugin-prerender` / a build step) so the
      rendered DOM — not just the raw shell — carries content. Today React replaces `#root`;
      first-wave crawl sees content, but prerender makes it bulletproof and unlocks per-page
      meta for cluster pages.
- [ ] **Add schema:** `BreadcrumbList` + `Organization` (and `AggregateRating` once we have
      reviews). The SEO leader has all of these; 2/3 web rivals have none.
- [ ] **Core Web Vitals:** the `table-felt.jpg` background is **1.26 MB** — compress to WebP
      (<150 KB) + `loading=lazy`/responsive; it's an LCP/bandwidth liability. Audit with Lighthouse.
- [ ] **Per-page `<title>`/meta/canonical** once cluster pages exist (needs prerender or SSR).
- [ ] Update `sitemap.xml` `lastmod` on each release; add new pages as they ship.

## Phase 1 — Product features (prioritized by user votes) — HIGH impact (rank + retention)

**Priority is decided by user votes, not guesswork** (see "Feature voting" below). Build the
top-voted gaps first. Status reflects the current app.

Already in the app (don't re-build): single Fibonacci deck (1…610, `?`, ☕), **observer role**,
hidden simultaneous vote → reveal (reveal "star"), basic **round history** (`RoundLog`),
**average** + distribution + consensus flag, shareable room URLs, no sign-up.

Candidate gaps (each a GitHub `feature-vote` issue — ship by votes):
- [ ] **Multiple / custom card decks** — T-shirt (XS–XXL), powers-of-two, sequential, custom
      values (currently Fibonacci-only). Render deck names as indexable text.
- [ ] **Median** (and min/max) added to round stats (currently average only).
- [ ] **Export round results** (CSV / JSON).
- [ ] **Invite by QR code** (alongside the link).
- [ ] **Issue/story import** — CSV + GitHub issues first; later Jira / Linear / Trello.
- [ ] **More UI languages** (i18n + hreflang) — serbito already does i18n; EN + Serbian first.
- [ ] **Persistent / named rooms** (rooms are currently swept after idle).
- [ ] (host controls, async voting, etc. — add as issues if users ask)

> **Timer is explicitly NOT planned for now.** Other features above are possible but
> deliberately gated on demonstrated user demand (votes), so we build what people actually want.

### Feature voting (ship this first)
- [ ] GitHub `feature-vote` label + one issue per candidate feature; users 👍 to vote
      (sort issues by reactions). Discussions can be enabled later if needed.
- [ ] Landing-page section "**Help shape the roadmap — vote on features →**" linking to the
      `feature-vote` issues. This drives engagement, backlinks (open-source), and real priority
      signal before we invest in any feature.

## Phase 2 — Content & i18n (the real ranking engine) — HIGH impact, MED effort

- [ ] **Deep "What is Planning Poker?" guide** (~1,200+ words: how to play, when to re-vote,
      live vs async, roles) — beats rivals' thin ~300w cornerstone pages.
- [ ] **Keyword-cluster landing pages** (copy the winners, but ship with FAQ + SoftwareApplication
      schema they lack): `/planning-poker-for-jira`, `/planning-poker-for-remote-teams`,
      `/planning-poker-vs-estimation-meetings`, `/best-planning-poker-tools`.
- [ ] **Glossary** (`/glossary`): story points, velocity, Fibonacci, T-shirt sizing, anchoring,
      consensus, sprint planning — internal-link hub none of the rivals have.
- [ ] **Blog topic cluster** (start ~5 posts, grow): "Why Fibonacci in estimation", "Agile story
      points: a practical guide", "Agile estimation techniques", "Planning poker vs T-shirt
      sizing", "Run better sprint planning". Each links to the tool.
- [ ] **hreflang multilingual** — EN + Serbian first (serbito already does i18n), then RU/DE/ES/FR;
      per-language URLs + `x-default`. Only the SEO leader does this — clear wedge.
- [ ] **FAQ on every landing page** (each with `FAQPage` JSON-LD).

## Phase 3 — Trust & distribution (off-page authority) — HIGH impact, owner-driven

- [ ] **Open-source as backlink magnet:** polish the GitHub repo (README, description, topics
      `planning-poker scrum agile estimation`, screenshots, "self-host" guide); chase stars.
- [ ] **Launch posts:** Product Hunt, Reddit (r/scrum, r/agile, r/projectmanagement), Hacker News
      ("Show HN"), dev.to, Indie Hackers.
- [ ] **Get listed:** awesome-lists (awesome-scrum/agile), alternativeto.net, SaaS directories,
      "best free planning poker" roundups (e.g. Ludi) — these rank and link.
- [ ] **Comparison/alternative pages** targeting rival brand + "free / no-ads / open-source"
      (e.g. "free PlanningPokerOnline alternative", "Scrum Poker Online without ads").
- [ ] **Reviews/ratings** → add `AggregateRating` schema once legitimately earned (benchmark
      planningpoker.live = 4.5★/1000+).
- [ ] **Trust signals on-site:** GitHub stars badge, "privacy-first — no data stored/sold",
      self-host option, open-source license.

---

## Differentiation north star (lead with these everywhere)

> **A free, open-source planning poker — no ads, no sign-up, unlimited core. New features are
> built in the open and prioritized by user votes — never paywalled, never ad-gated.**

We do NOT promise "every premium feature free forever" (unsustainable, and e.g. a timer is not
currently planned). Instead the promise is: the core is free and unlimited, and **what we build
next is decided by user votes** (see "Feature voting" below).

This is defensible against all five competitors at once:
- vs scrumpoker-online.org → **no ads**, premium features free.
- vs planningpokeronline.com → **unlimited free** (no 9-vote/6-week cap), no per-seat pricing.
- vs scrumpoker.online → same open-source/free, but **real SEO + modern stack + i18n**.
- vs app-store apps → **no install, instant shared room, real-time, browser-based**.

## Suggested execution order (next 5 concrete steps)

1. **Ship feature voting first** (GitHub `feature-vote` label + issues + landing "vote" link) so
   priority is driven by real demand.
2. **Phase 0:** OG image + compress felt background + submit sitemap to GSC + Request Indexing.
3. **Phase 1:** build the top-voted gaps (likely custom decks / median / export / QR), not a
   fixed list — let votes decide.
4. **Phase 2:** write the deep "What is Planning Poker?" page + glossary (biggest content gap).
4. **Phase 2:** prerender + per-page meta, then add the 4 cluster landing pages with schema.
5. **Phase 3:** polish GitHub repo + Product Hunt/Reddit/HN launch for backlinks.
