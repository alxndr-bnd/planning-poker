# Competitor Analysis — Planning Poker (2026-06-21)

Goal: make `poker.serbito.rs` a world-class, free, open-source, no-signup planning poker
that ranks alongside the top Google results. This doc analyzes the current top players;
keyword strategy is in `02-keyword-strategy.md`, the build plan in `03-seo-product-roadmap.md`.

## TL;DR — the landscape

| Competitor | SEO strength | Free tier | Monetization | Biggest weakness we can beat |
|---|---|---|---|---|
| **scrumpoker-online.org** | ⭐⭐⭐⭐ (best) | Full-featured | Ads + $40/yr Premium | **Ad-funded**; Premium gates timer/median/attendance |
| **planningpokeronline.com** (We Agile You) | ⭐⭐⭐ | Crippled (9 votes, 5 issues, 6-wk expiry) | $30/facilitator/mo | No schema, no hreflang, thin "what is" page, gated everything |
| **scrumpoker.online** | ⭐ (weak) | Fully free, open-source | None | No SEO at all (bare title, no robots/sitemap/schema/SSR, dead analytics) |
| **Apple App Store** (Scrum Poker Planning) | n/a | Free, no ads | None | Single-device, offline, no rooms |
| **MS Teams "ScrumPoker"** | n/a | Free | None | Teams-only, no web/SEO |
| _Benchmark:_ **planningpoker.live** | — | — | — | 4.5★ / 1000+ reviews (the bar for trust signals) |

**Our wedge:** free + open-source + **no ads** + **no sign-up** + unlimited core (rooms/players,
no expiry) + self-hostable + multilingual + **roadmap driven by user votes** (no paywalls, no
ads). We don't promise "every premium feature free forever" — we build what users vote for.

---

## 1. scrumpoker-online.org — the SEO leader (copy this playbook)

- **Title:** `Planning Poker — Story Points Estimation Online | Scrumpoker`
- **Meta:** "Estimate story points with your agile team in seconds. Instant rooms, no signup, no email — free planning poker for distributed Scrum teams."
- **Content:** ~2,300-word landing page = live tool widget + genuine explainer (what is planning poker vs scrum poker, why Fibonacci, decks/values/custom scales, free-vs-premium, comparison table, 10-question FAQ).
- **Blog cluster:** ~19 posts (glossary + comparison bait): "Agile Story Points Guide", "What is Pointing Poker", "Why the Fibonacci Series", "Agile Estimation Techniques", "Best Free Scrum Master Tools 2026", "Planning Poker for Jira: alternative to the plugin tax".
- **Structured data:** `FAQPage` (10 Q), `BreadcrumbList`, `Organization`, `Person`.
- **i18n:** full hreflang — de/en/es/fr/it/pt + x-default, each with its own `/planning-poker/` URL.
- **Features:** instant room (auto-assigned on load), invite by link **+ QR**, real-time simultaneous reveal, deck `0,½,1,2,3,5,8,13,20,40,100,?,☕`, custom decks (free account), host controls. Premium ($40/yr): ad removal, timer, average **+ median**, attendance, custom room ID.
- **Weaknesses:** ad-funded (had an ad-penalty incident); core QoL features (timer/median/attendance) paywalled; no Jira/export/history (states this openly).

## 2. planningpokeronline.com (We Agile You) — quality-over-volume + enterprise trust

- **Title:** `Planning poker online | Scrum poker | We Agile You`
- **Meta:** "Make estimates with your remote teammates with this simple and powerful app. Play in realtime, Jira integration and more. Get started in seconds."
- **H1:** "Scrum Poker for agile teams"
- **Content:** NO blog. ~5 long-form (~1,000–1,200w) keyword landing pages, each with its own FAQ + a shared "Run Better Sprint Planning Meetings" CTA:
  `/planning-poker-for-jira`, `/planning-poker-for-remote-teams`,
  `/planning-poker-vs-estimation-meetings`, `/best-planning-poker-tools` (ranks itself #1),
  `/what-is-planning-poker` (thin, ~300w — a gap to beat). 8 indexable pages total.
- **Structured data:** **NONE** (no FAQPage/SoftwareApplication/Review schema) — a clear miss given they have FAQ content + a Trustpilot ~4★.
- **i18n:** none.
- **Features:** real-time voting, visual results, in-game issue management, integrations (Linear, GitHub, Azure DevOps; Jira via paid Marketplace plugin — web Jira discontinued), CSV import, game history (Premium), multiple facilitators (Premium), permanent URLs. Trust: ISO 27001 + GDPR badges.
- **Free tier:** crippled — 9 votings/game, 5 issues/game, 6-week access. **Premium $30/facilitator/mo or $300/yr.**
- **Weaknesses:** no schema, no hreflang, thin cornerstone content, aggressively gated free tier.

## 3. scrumpoker.online — our closest analog (free + open-source) but SEO-invisible

- **Title:** `Scrumpoker Online` (bare brand — no keywords). **Meta** mentions open-source + Redmine/GitHub/GitLab.
- **SEO:** weak/absent — same title site-wide (SPA), **no real robots.txt/sitemap** (soft-404 to SPA shell), **no JSON-LD**, no blog, no hreflang, **AngularJS SPA with no SSR** (crawl risk), dead Universal Analytics.
- **Content:** ~1,500 words but mostly how-to instructions; one good "What is Scrumpoker Online" paragraph.
- **Features (strong):** 8 hardcoded decks (Fibonacci, Fib+?, powers-of-two `0,1,2,4,8,16,32,64`, T-shirt, sequential, coffee card), hidden simultaneous vote → flip, master view (TV) + member view (phone), per-poll **timer/stopwatch**, **consensus highlighting** (green) + high/low flags (red), statistics table, vote retraction, create/join + optional password, join via ID/URL/**QR**, GitHub + JIRA issue import (credentials never stored), **self-hostable** (live GitHub repo).
- **Positioning:** "my open source planning poker, free for everyone", no-signup, privacy-forward — muted solo-dev tone, zero social proof.
- **Lesson:** they have the product + open-source story we want, but **lose entirely on SEO**. We win by doing the SEO they neglect (SSR/prerender, schema, content, sitemap, i18n) on an equally-free open-source base.

## 4. App stores (keyword + positioning signal)

- **Apple "Scrum Poker Planning (cards)"** — free, no ads, **4.3★/7**. Offline single-device card sim; named decks Standard/Fibonacci/T-Shirt; touch/shake to flip. Top review praise: *"I love how it doesn't have ad"* + *"Finally, a proper planning poker"*; complaint = wrong sequence value. → users value **no ads, smoothness, correct sequences**.
- **MS Teams "ScrumPoker"** — free Teams add-on; sells the **collaboration workflow**: "private votes → reveal → discuss", anti–cognitive-bias, time-framed rooms, roles (PO/SM/dev), invite by URL.
- **Benchmark planningpoker.live:** 4.5★ from 1000+ reviewers — the trust bar.

---

## What the winners have in common (the rank table-stakes)

1. **A content-rich landing page** (live tool + 1,000–2,300 words of real explainer), not a bare tool.
2. **On-page FAQ** (and the leader marks it up as `FAQPage`).
3. **Keyword-cluster pages / blog** targeting informational + comparison intent.
4. **Dual head-term targeting**: "planning poker" AND "scrum poker", plus deck/Fibonacci/story-points long-tail.
5. **Zero-friction product**: instant room, invite by link + QR, real-time reveal, multiple decks.
6. **Trust signals**: reviews/ratings, security/compliance, or open-source/GitHub credibility.

## Where every competitor is beatable (our opening)

- **Ads:** the SEO leader is ad-funded → "free, no ads, forever" is a real differentiator (app-store reviews prove users care).
- **Paywalled QoL:** timer, average+median, attendance, history, export, custom decks are gated by rivals → make them **all free**.
- **Schema gaps:** 2 of 3 web rivals have **no JSON-LD** → easy rich-result win.
- **i18n gaps:** only the leader does hreflang → serbito already does i18n; multilingual is a wedge.
- **Open-source + privacy + self-host:** only the SEO-invisible rival offers it → we pair it with real SEO.
- **Thin cornerstone content:** rivals' "what is planning poker" pages are thin → a deep guide + glossary wins informational traffic.
