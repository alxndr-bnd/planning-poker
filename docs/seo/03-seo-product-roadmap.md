# SEO + Product Roadmap — "world-class free planning poker" (2026-06-21)

Plan to take `poker.serbito.rs` from "just shipped basic SEO" to a top-ranking, world-class,
free/open-source planning poker. Inputs: `01-competitor-analysis-2026-06-21.md`,
`02-keyword-strategy.md`. Phased by impact/effort; check items off as shipped.

Jira: implemented by SERBITO-305 (sitemap), SERBITO-435 (Search Console access) · tracked by SERBITO-434 (SEO epic, all products) · open: [SERBITO-482](https://serbito.atlassian.net/browse/SERBITO-482) (content, comparison pages, launch), [SERBITO-463](https://serbito.atlassian.net/browse/SERBITO-463) (Search Console baseline), [SERBITO-484](https://serbito.atlassian.net/browse/SERBITO-484) (low value). Boxes checked against the code on 2026-10-05.

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
      *2026-10-05: property is in SERBITO-435; sitemap last fetched in June — SERBITO-463.*
- [x] **OG image** 1200×630 PNG (`/og-image.png`) + `og:image`/`twitter:image` and switch
      `twitter:card` to `summary_large_image`. (Needs a designed asset — competitors all have one.)
- [x] **Prerender the public pages** (Vite SSG / `vite-plugin-prerender` / a build step) so the
      rendered DOM — not just the raw shell — carries content. Today React replaces `#root`;
      first-wave crawl sees content, but prerender makes it bulletproof and unlocks per-page
      meta for cluster pages. *Done: static prerendered pages under `client/public` — v0.14.0 (263f385).*
- [x] **Add schema:** `BreadcrumbList` + `Organization` (and `AggregateRating` once we have
      reviews). The SEO leader has all of these; 2/3 web rivals have none.
      *Done: Organization on the home page; BreadcrumbList + Article on guides — v0.33.0 (353e542). `AggregateRating` — blocked until reviews exist, SERBITO-484.*
- [x] **Core Web Vitals:** the `table-felt.jpg` background is **1.26 MB** — compress to WebP
      (<150 KB) + `loading=lazy`/responsive; it's an LCP/bandwidth liability. Audit with Lighthouse.
      *Done: compressed to a 285 KB JPEG — v0.10.0 (30f5bdf); now `table-felt.webp`, 142 KB, no JPEG fallback (the CSS minifier breaks an image-set() fallback) — branch `poker-484`, SERBITO-484.*
- [x] **Per-page `<title>`/meta/canonical** once cluster pages exist (needs prerender or SSR).
- [x] Update `sitemap.xml` `lastmod` on each release; add new pages as they ship. *Sitemap is generated from the pages — v0.48.0 (SERBITO-305).*

## Phase 1 — Product features (prioritized by user votes) — HIGH impact (rank + retention)

**Priority is decided by user votes, not guesswork** (see "Feature voting" below). Build the
top-voted gaps first. Status reflects the current app.

Already in the app (don't re-build): single Fibonacci deck (1…610, `?`, ☕), **observer role**,
hidden simultaneous vote → reveal (reveal "star"), basic **round history** (`RoundLog`),
~~**average**~~ (removed, SERBITO-355) + distribution + consensus flag, shareable room URLs, no sign-up.

Candidate gaps (each a GitHub `feature-vote` issue — ship by votes). *Item title per round shipped in v0.60.0 (SERBITO-464); it is not an import.*
- [ ] **Multiple / custom card decks** (#3; owner decision by votes — SERBITO-482) — T-shirt (XS–XXL), powers-of-two, sequential, custom
      values (currently Fibonacci-only). Render deck names as indexable text.
- [ ] ~~**Median** (and min/max) added to round stats (currently average only).~~ Dropped: no average or median, owner decision 2026-10-02 (SERBITO-355). Issue #4 closed as not planned on 2026-10-07 — SERBITO-482.
- [ ] **Export round results** (CSV / JSON). (#5 — SERBITO-482)
- [ ] **Invite by QR code** (alongside the link). (#6 — SERBITO-482)
- [ ] **Issue/story import** — CSV + GitHub issues first; later Jira / Linear / Trello. (#7 — SERBITO-482)
- [x] **More UI languages** (i18n + hreflang) — serbito already does i18n; EN + Serbian first. *8 languages — v0.16.0 (e192946), v0.17.0 (ee24e33). Issue #8 closed as completed on 2026-10-07 — SERBITO-482.*
- [ ] **Persistent / named rooms** (rooms are currently swept after idle). (#9 — SERBITO-482)
- [ ] (host controls, async voting, etc. — add as issues if users ask)

> **Timer is explicitly NOT planned for now.** Other features above are possible but
> deliberately gated on demonstrated user demand (votes), so we build what people actually want.

### Feature voting (ship this first)
- [x] GitHub `feature-vote` label + one issue per candidate feature; users 👍 to vote
      (sort issues by reactions). Discussions can be enabled later if needed.
- [x] Landing-page section "**Help shape the roadmap — vote on features →**" linking to the
      `feature-vote` issues. This drives engagement, backlinks (open-source), and real priority
      signal before we invest in any feature. *Done: issues #3–#9 and landing links — v0.9.0 (8fe70d7).*

## Phase 2 — Content & i18n (the real ranking engine) — HIGH impact, MED effort

- [x] **Deep "What is Planning Poker?" guide** (~1,200+ words: how to play, when to re-vote,
      live vs async, roles) — beats rivals' thin ~300w cornerstone pages. *~1,640 words — v0.14.0 (263f385).*
- [x] **Keyword-cluster landing pages** (copy the winners, but ship with FAQ + SoftwareApplication
      schema they lack): `/planning-poker-for-jira`, `/planning-poker-for-remote-teams`,
      `/planning-poker-vs-estimation-meetings`, `/best-planning-poker-tools`.
      *Jira and remote-teams pages — v0.14.0 (263f385). The other two — v0.61.0, SERBITO-482 (English only).*
- [x] **Glossary** (`/glossary`): story points, velocity, Fibonacci, T-shirt sizing, anchoring,
      consensus, sprint planning — internal-link hub none of the rivals have.
- [ ] **Blog topic cluster** (start ~5 posts, grow): "Why Fibonacci in estimation", "Agile story
      points: a practical guide", "Agile estimation techniques", "Planning poker vs T-shirt
      sizing", "Run better sprint planning". Each links to the tool. *Owner decision — SERBITO-482.*
- [x] **hreflang multilingual** — EN + Serbian first (serbito already does i18n), then RU/DE/ES/FR;
      per-language URLs + `x-default`. Only the SEO leader does this — clear wedge. *8 languages — v0.16.0, v0.17.0.*
- [x] **FAQ on every landing page.** *SERBITO-482: all 36 guides have a `<section id="faq">` with question `<h3>`s and short answers — v0.61.0. `FAQPage` JSON-LD on every page with a FAQ (36 guides + 3 comparison pages) — branch `poker-482b`, not released. `npm run sitemap` writes it from the visible FAQ; a test keeps the two equal. Google shows no FAQ rich result for this site; the markup is for Bing and AI answer engines. The home page keeps its hand-written block.*

## Phase 3 — Trust & distribution (off-page authority) — HIGH impact, owner-driven

- [ ] **Open-source as backlink magnet:** polish the GitHub repo (README, description, topics
      `planning-poker scrum agile estimation`, screenshots, "self-host" guide); chase stars. *Description and topics are set (2026-10-05).*
- [ ] **Launch posts:** Product Hunt, Reddit (r/scrum, r/agile, r/projectmanagement), Hacker News
      ("Show HN"), dev.to, Indie Hackers. *No trace yet; owner decision — SERBITO-482.*
- [ ] **Get listed:** awesome-lists (awesome-scrum/agile), alternativeto.net, SaaS directories,
      "best free planning poker" roundups (e.g. Ludi) — these rank and link. *AlternativeTo link is on the landing; the rest — SERBITO-482.*
- [x] **Comparison/alternative pages** targeting rival brand + "free / no-ads / open-source"
      (e.g. "free PlanningPokerOnline alternative", "Scrum Poker Online without ads").
      *SERBITO-482, v0.61.0: `/planningpokeronline-alternative`, `/scrum-poker-online-without-ads`, `/best-planning-poker-tools`. English only; competitor facts dated 2026-10-05 with links to the vendors' pages. Re-check the facts every 6 months.*
- [ ] **Reviews/ratings** → add `AggregateRating` schema once legitimately earned (benchmark
      planningpoker.live = 4.5★/1000+). *Blocked — SERBITO-484.*
- [x] **Trust signals on-site:** GitHub stars badge, "privacy-first — no data stored/sold",
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

---

## SERBITO-482: status and owner actions (2026-10-05, updated 2026-10-07)

Released in v0.61.0: FAQ sections on all 36 guides, 4 English comparison pages, links from the home page, the English guide footers and `/llms.txt`, and the home-page roadmap text without median and languages. Branch `poker-482b` (not released): `FAQPage` JSON-LD from the visible FAQs.

### Stale GitHub issues

Reaction counts read on 2026-10-05. #8 and #4 closed with a comment on 2026-10-07.

| Issue | 👍 | State in the app | Suggested action |
|---|---|---|---|
| #8 More UI languages (i18n) | 1 | Shipped: 9 languages (v0.16.0, v0.17.0), browser language (v0.55.0) | ✅ Closed as completed (2026-10-07) |
| #4 Median (and min/max) in round stats | 0 | Contradicts SERBITO-355: no average or median by design | ✅ Closed as not planned (2026-10-07) |
| #3 Custom & multiple card decks | 1 | Not built | Keep open |
| #5 Export round results | 0 | Not built | Keep open |
| #6 Join a room by QR code | 0 | Not built; the remote-teams guide says "not yet" | Keep open |
| #7 Import issues/stories | 0 | Not built. v0.60.0 adds a manual item title, not an import | Keep open; mention the item title in a comment |
| #9 Persistent / named rooms | 0 | Not built | Keep open |

No candidate has more than one vote, so the vote gate holds: build none of them yet.

### Launch (owner)

Drafts and the target list are in `05-outreach-drafts-2026-10-05.md`. Order:

1. ~~Release `poker-482`~~ (v0.61.0). In Search Console, re-submit `sitemap.xml` and request indexing for the 4 new URLs (with SERBITO-463).
2. Fix the AlternativeTo listing: the title says "Panning", and two claims are wrong (§1 of the drafts).
3. Submit the listings in §3 (kollabe, freetier.co, SaaSHub, PeerPush, Scrum Expert follow-up). Link `/best-planning-poker-tools` where a form asks for a comparison page.
4. Product Hunt with the kit in §4, on a weekday, from the owner's account.
5. Show HN and Reddit (r/scrum, r/agile) only with the open-source and self-hosting story. Follow each subreddit's self-promotion rules.
6. After 4 weeks, check the GSC Links report. Target: 3 or more new referring domains.

### Owner decisions still open

- **Blog cluster (~5 posts):** suggest to defer. The 2026-10-05 audit says that authority, not content, holds the site back. Decide after the new pages are indexed.
- **Translations of the comparison pages:** suggest no, until the English pages are indexed (audit finding 2).
