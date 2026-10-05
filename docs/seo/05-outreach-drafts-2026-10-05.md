> Outreach drafts for SERBITO-503, 2026-10-05. Nothing was posted. Owner decides and posts.

# SERBITO-503 — poker outreach drafts

Drafts only. Nothing was posted, submitted or signed up. Research date: 2026-10-05.
Audit: `~/Documents/planning-poker/docs/seo/04-seo-audit-2026-10-05.md` (finding 4, ticket 3).

## 0. Read first: facts and two blockers

**Verified product facts** (repo `alxndr-bnd/planning-poker` at v0.58.0 + live site):

| Fact | Source |
|---|---|
| Free, no sign-up, join by name only, unlimited rooms | README, live `<title>`, JSON-LD Offer price 0 |
| MIT license | `LICENSE`, GitHub license field |
| Real-time voting, cards hidden until reveal, re-vote | README, `shared/protocol.ts` |
| Reveal shows **named votes** + distribution/consensus; no average or median by design | README |
| Observer role; observers are listed in the room | README, CHANGELOG 0.55.0 |
| Optional item title per round + round log for the session | `protocol.ts` `RoundLog`, `App.tsx` `EstimateLog` |
| Fibonacci deck only (`1 2 3 5 8 13 21 34 55 ? ☕`, `89`–`610` behind "More") | README. **No** T-shirt or custom decks. |
| 9 UI languages: en, es, de, fr, pt, ru, sr, ja, zh; opens in browser language | `client/src/i18n.ts`, CHANGELOG 0.55.0 |
| No database, no accounts; rooms live in memory | README |
| No ads. GA4 (cookies, after consent banner) + cookieless Cloudflare analytics + Sentry | README, `client/index.html` |
| No Jira integration (only a "planning poker for Jira" how-to page) | code |
| First tag v0.1.0: 2026-05-26. GitHub Releases exist only from v0.56.0 (2026-10-03) | `git tag`, `gh release list` |

**Blocker A — "self-hostable" is not true today.** The Docker image sets `NODE_ENV=production`.
In production, `originAllowed()` (`server/src/server.ts:107`) accepts the WebSocket only from
`https://poker.serbito.rs`. A self-hosted copy on any other host (also `localhost` in Docker) cannot connect.
Also `client/index.html` hardcodes the owner's GA4 id `G-B5CQC4JJV0`, so a self-hoster would send data to the owner's GA.
→ All drafts below avoid the word "self-hostable". Lines marked **[after fix]** can go back in once
the allowed origin (and analytics ids) come from env vars and the README says how to set them.

**Blocker B — the AlternativeTo listing has a false claim.** Its feature list says
"privacy-focused (no database/tracking)" and "self-hostable". GA4 is tracking. Fix both in §1.

---

## 1. AlternativeTo fix

Listing: `alternativeto.net/software/estimation-poker-serbito/about/`. Current title: "Panning Poker Serbito".

- **Title:** `Serbito Planning Poker`
  (matches the site's Organization JSON-LD name and footer text. Minimal alternative: `Planning Poker Serbito`.)
- **Tagline:** `Free, open-source planning poker. No sign-up, no ads.`
- **Description** (no links):

  > Serbito Planning Poker is a free, open-source (MIT) tool for story-point estimation.
  > Create a room and share the link. Your team joins by name only. There are no accounts and no paywall.
  > Everyone votes at the same time. Cards stay hidden until the reveal.
  > The reveal shows who voted what and how the votes spread. It does not show an average, so the team talks about the outliers.
  > You can add an item title to each round. The room keeps a log of rounds for the session.
  > Observers can watch without voting. The interface is in 9 languages.
  > Rooms live in memory only. There is no database.

- **Features to keep:** No registration required, Real-time collaboration, Fibonacci deck, Observer mode, Round history, Multilingual, Ad-free.
- **Features to remove:** "privacy-focused (no database/tracking)" → replace with "No database". Remove "Self-hostable" until Blocker A is fixed.
- **Tags:** `planning-poker`, `scrum-poker`, `story-points`, `agile-estimation`, `sprint-planning`, `scrum`, `agile`, `real-time-collaboration`, `no-registration`. Drop `poker` (it matches casino apps).
- **Platforms / license:** Online; Free; Open Source (MIT). Add "Self-Hosted" only after the fix.
- **Mark as alternative to** (now: ScrumVote, Point Taken, Vote Scrum). Add the high-traffic entries that the SERPs show:
  Planning Poker (planningpoker.com), Pointing Poker, PlanITpoker, Scrumpoker Online, Planning Poker Online, Kollabe, Parabol Sprint Poker.
  Select the exact entries from the AlternativeTo picker; names there can differ.
- **Link policy:** AlternativeTo returns 403 to scripts; I could not see `rel`. Treat as nofollow. Value is the SERP slot, not link equity.

---

## 2. Target list

| # | Target | URL | How to submit | Paid? | Link (visible) | Why it fits |
|---|---|---|---|---|---|---|
| 1 | AlternativeTo | alternativeto.net/software/estimation-poker-serbito/ | Edit own listing (logged in) | Free | Unknown (403), assume nofollow | Already ranks for "free planning poker" and "no sign up" — with the typo |
| 2 | Scrum Expert — "Open source planning poker tools" | scrumexpert.com/tools/open-source-planning-poker-tools/ | Contact form `scrumexpert.com/mail/` (name, email, subject, message). Follow-up of the 2026-07-06 submission | Free | Plain `<a>` to GitHub, no `rel` → dofollow | 21 OSS tools, updated 2026-05-27, text says "contact us" for missing tools. We are not in it yet |
| 3 | freetier.co — planning-poker category | freetier.co/directory/categories/planning-poker | Contact form `freetier.co/contact` (FAQ: "Send us anything we missed") | Free | `rel="noopener noreferrer"`, no nofollow → dofollow | Only 5 tools listed; criterion "always free" fits us exactly |
| 4 | Product Hunt | producthunt.com | Self-post from a personal account; schedule for 00:01 PT | Free | Nofollow (known PH policy) | Shows in SERP for "free planning poker" and "no sign up". Kit in §4 |
| 5 | SaaSHub | saashub.com (add product flow) | Add website URL, categories, competitors; verify with an email on the product domain for priority | Free (paid "Feature" upsell optional) | Not stated | Has pages for PlanITpoker, Scrumpoker Online, Chpokify alternatives; we can appear on them |
| 6 | PeerPush | peerpush.com/submit | Free queue ("wait in line behind paid users") or Standard Launch | **Free queue; $39 to skip** | Product link is JS-rendered; not visible | `peerpush.com/alternatives/free-online-planning-poker` lists only 1 alternative and ranks for "no sign up" |
| 7 | Kollabe — "best free planning poker tools" | kollabe.com/posts/best-free-planning-poker-tools | Contact page `kollabe.com/contact-us` (no submission process) | Free | Plain styled `<a>`, no `rel` → dofollow | #1 listicle for "free planning poker", updated 2026-07-19. **Low odds:** Kollabe wrote it and is a competitor |
| 8 | opensourcealternative.to | opensourcealternative.to/submit | Form: email, OSS site, repo, proprietary product name/site | **Free waitlist 6+ months, or $29 for 48 h review** | Not stated | Requires "self-hosted" → **only after Blocker A fix** |
| 9 | awesome-selfhosted | github.com/awesome-selfhosted/awesome-selfhosted-data | Issue or PR with a YAML file in `software/` | Free | GitHub README links are nofollow | No planning-poker tool listed yet. **Not eligible now** (see §3.9) |
| 10 | Indie Hackers products | indiehackers.com/products | Product page from own account | Free | Unknown (403 to fetch) | `indiehackers.com/product/pokor` shows in the "free planning poker" SERP. Details not verified |

**Checked and dropped:** `lorabv/awesome-agile` (1.5k stars, last push 2024-08, PRs left unmerged, no tools section);
openalternative.co (submission terms not readable); planningpoker.live knowledge base (competitor-owned "alternatives" page).

---

## 3. Submission texts (English, ≤ 120 words each)

### 3.1 AlternativeTo
Use §1. If AlternativeTo needs a reason for the name change: "Fix a typo: the product name is Serbito Planning Poker."

### 3.2 Scrum Expert (follow-up via /mail/)
**Subject:** Missing tool for "Open source planning poker tools": Serbito Planning Poker

> Hello,
>
> On 6 July I suggested an addition to your article "Open source planning poker tools". I send it again in short form.
>
> Serbito Planning Poker is a free planning poker app under the MIT license.
> Source: github.com/alxndr-bnd/planning-poker. Live app: poker.serbito.rs.
>
> - Join a room by link and name only. No accounts.
> - Cards stay hidden until the reveal. The reveal shows named votes and the spread, not an average.
> - Observer role, an optional item title per round, and a round log.
> - Interface in 9 languages. No ads.
>
> It is written in TypeScript (React, Node, WebSocket). [after fix: It runs from one Docker container.]
>
> Thank you for keeping the list current.
> Alexander Bondarchuk

### 3.3 freetier.co (contact form)
**Subject:** New tool for the Planning Poker category

> Hello,
>
> Please consider Serbito Planning Poker for your Planning Poker category: poker.serbito.rs.
>
> Free tier: everything is free. There is no paid plan and no ads.
> - Unlimited rooms. No limit on players or rounds.
> - Players join by link and name. No sign-up.
> - Hidden votes until the reveal; named votes and spread after it.
> - Observer role and a round log for the session.
> - 9 interface languages.
>
> The code is open source under MIT: github.com/alxndr-bnd/planning-poker.
>
> Limits to know: one Fibonacci deck only, and rooms are not saved after the session ends.
>
> Thank you,
> Alexander Bondarchuk

### 3.4 Product Hunt
See §4.

### 3.5 SaaSHub (add-product form)
- **URL:** https://poker.serbito.rs
- **Name:** Serbito Planning Poker
- **Categories:** Planning Poker, Agile Project Management, Scrum
- **Competitors:** PlanITpoker, Scrumpoker Online, Pointing Poker, Planning Poker (planningpoker.com), Sprint Poker by Parabol
- **Short description:**

> Free, open-source (MIT) planning poker for agile teams. Create a room, share the link, and join by name only. No accounts, no ads, no paid plan. Votes stay hidden until the reveal. The reveal shows who voted what and how the votes spread. Observer role, round log, 9 interface languages.

### 3.6 PeerPush (free queue)
- **Name:** Serbito Planning Poker
- **Tagline:** Free, open-source planning poker. No sign-up, no ads.
- **Description:**

> Serbito Planning Poker helps scrum teams estimate stories together.
> Create a room, send the link, and everyone joins by name. Nobody needs an account.
> Votes stay hidden until the reveal. Then you see who voted what and how far apart the votes are. There is no average on purpose: the team talks about the outliers.
> Observers can watch without voting. The room keeps a log of the rounds.
> The app is in 9 languages, has no ads and no paid plan. The code is open source under the MIT license.

### 3.7 Kollabe (contact-us)
**Subject:** Suggestion for "Best free planning poker tools"

> Hi Matt,
>
> I read your list of free planning poker tools. It is useful because it compares the free-plan limits.
>
> I build Serbito Planning Poker: poker.serbito.rs. If you update the list, it may fit as a fully free, open-source option.
> - No accounts. Players join by link and name.
> - No limit on rooms, players or rounds. No ads, no paid plan.
> - MIT license: github.com/alxndr-bnd/planning-poker.
> - Named votes after the reveal, observer role, 9 languages.
>
> It has fewer features than Kollabe: one Fibonacci deck, no Jira sync, no saved history.
>
> Thank you for considering it.
> Alexander Bondarchuk

### 3.8 opensourcealternative.to (only after Blocker A fix)
- **Name of open source alternative:** Serbito Planning Poker
- **Website:** https://poker.serbito.rs
- **Repository:** https://github.com/alxndr-bnd/planning-poker
- **Name of proprietary software:** Planning Poker (Mountain Goat Software) — **Website:** https://www.planningpoker.com
- Choose free waitlist or $29 (owner decision).

### 3.9 awesome-selfhosted — not eligible now

Rules checked (`awesome-selfhosted-data` CONTRIBUTING + templates, 2026-10-05):

| Rule | Status |
|---|---|
| First released more than 4 months ago | Tag v0.1.0 is 2026-05-26 (passes since 2026-09-26). **Risk:** GitHub Releases start only at v0.56.0 (2026-10-03); reviewers may read that as the first release |
| Actively maintained | Yes (58 tags, commits this week) |
| Working installation instructions | **No** — Docker run works only on `poker.serbito.rs` (Blocker A) |
| Not dependent on a third party outside the user's control | GA4 id, Cloudflare beacon and Sentry are wired in; needs env config or `depends_3rdparty: true` |
| "The submission was done by a human, not a machine/LLM" | **The owner must write and open the PR personally.** Use the YAML below only as a reference |
| One item per PR; file name kebab-case | `software/serbito-planning-poker.yml` |

Reference YAML (after the fix):

```yaml
name: Serbito Planning Poker
website_url: https://poker.serbito.rs
source_code_url: https://github.com/alxndr-bnd/planning-poker
description: Real-time planning poker for agile teams. Players join a room by link and name, without accounts.
licenses:
  - MIT
platforms:
  - Nodejs
  - Docker
tags:
  - Software Development - Project Management
demo_url: https://poker.serbito.rs
```

Resulting README line (the generator renders it like this):

```
- [Serbito Planning Poker](https://poker.serbito.rs) - Real-time planning poker for agile teams. Players join a room by link and name, without accounts. ([Demo](https://poker.serbito.rs), [Source Code](https://github.com/alxndr-bnd/planning-poker)) `MIT` `Nodejs/Docker`
```

PR title: `Add Serbito Planning Poker`.

### 3.10 Indie Hackers (product page)

> Serbito Planning Poker is a free, open-source planning poker app: poker.serbito.rs.
> I built it because our team wanted estimation without accounts, ads or player limits.
> Create a room, share the link, and vote. Cards stay hidden until the reveal. Then you see named votes and the spread, not an average.
> Observer role, round log, 9 languages. MIT license.
> Revenue: none. It is a side project of No Handoff.

(Check the "why I built it" sentence with the owner before posting; it is a guess.)

---

## 4. Product Hunt launch kit

- **Name:** Serbito Planning Poker
- **Tagline (53 chars):** `Free, open-source planning poker. No sign-up, no ads.`
- **Description (≤ 260 chars):**

  > Create a room, share the link, and your team votes by name. No accounts, no paid plan. Cards stay hidden until the reveal; then you see who voted what and the spread, not an average. Observer role, round log, 9 languages. MIT license.

- **First comment (maker, ≤ 150 words):**

  > Hi Product Hunt! I'm Alexander, the maker.
  >
  > Most planning poker tools I tried had one of three catches: an account, ads, or a free plan with a player limit. I wanted none of them, so I built this one.
  >
  > How it works: open poker.serbito.rs, create a room, share the link. People type a name and vote. Nobody sees a card until the reveal.
  >
  > One choice you may disagree with: the reveal shows named votes and the spread, but no average. The average hides the outliers, and the outliers are the discussion.
  >
  > What it does not do (yet): only a Fibonacci deck, no Jira sync, rooms are not saved after the session.
  >
  > It is MIT-licensed on GitHub. The site uses Google Analytics after cookie consent; there are no ads.
  >
  > What should I build next? Tell me what your team misses.

- **Gallery (1270×760, min. 2 images):**
  1. Lobby: name field, "Create room", language switcher open on 9 languages. Caption: "One click to a room. Join by name."
  2. Room during voting: 5 players, 3 cards face-down, one observer in the list, item title on top. Caption: "Votes stay hidden until the reveal."
  3. After reveal: named votes, distribution, consensus mark, round log below. Caption: "See who voted what. No average on purpose."
  (Optional 4th: same room on a phone — the deck fits since v0.55.0.)
- **Topics:** Open Source, Productivity, Developer Tools, Remote Work.
- **Launch day/time:** Saturday or Sunday, scheduled for **00:01 PT = 09:01 Belgrade** (PDT is UTC−7 until 2026-11-01; CEST until 2026-10-25).
  Rationale: a launch without a hunter network and with 5 GitHub stars gets buried Tue–Thu, when funded launches compete.
  On weekends fewer products compete for the daily list, and 09:01 local time lets the owner answer comments for the whole PT day.
  Trade-off: scrum masters browse less on weekends. If the goal is the listing page and backlink, not the daily rank, the weekend wins.
- **Before launch:** fix Blocker A if "self-hosted" is the angle (the audit proposed it). Without the fix, launch on "open source, no ads, no limits" only.

---

## 5. Positioning vs planningpoker.com / pointingpoker.com

Planningpoker.com (Mountain Goat Software, owner of the "Planning Poker®" trademark) asks every team to register, and it adds value with Jira import and export.
Pointing Poker needs no sign-up and stays free because it shows ads.
Serbito Planning Poker sits in a third place: no account, no ads, no paid plan, and the full source code is public under the MIT license, so a team can read exactly what the app does with its data.
It also takes a stance on the reveal: it shows who voted what and how the votes spread, but no average, so the team discusses the outliers instead of settling on a mean.
It is smaller than both: one Fibonacci deck, no Jira sync, and rooms end with the session.
Choose it when you want to start a vote at once and never think about plans or ads.

(Do not add "self-hostable" here until Blocker A is fixed.)
