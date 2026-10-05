# Test suite review (SERBITO-364, 2026-09-29)

Jira: SERBITO-364 (Closed — poker v0.52.0) · optional ideas from "Unsure": [SERBITO-484](https://serbito.atlassian.net/browse/SERBITO-484)

The vitest gate (`npm test`, `server/test/`) was reviewed for tests that repeat each other, check only mocks or source text, or cost time without adding coverage.

## Before / after

| | Before | After |
|---|---|---|
| Tests | 162 | 147 |
| Files | 19 | 19 |
| vitest duration (best of 5; shared machine, runs vary by ±1 s) | 4.1 s | 3.5 s |
| Coverage of `server/src` (lines, excluding the `index.ts`/`instrument.ts` entry points) | 358 / 411 (87.1%) | 357 / 411 (86.9%) |

The one line no longer covered is the body of `reportError` in `sentry.ts`, a one-line pass-through to `Sentry.captureException`. No other covered line changed, per-file coverage is identical, and the suite has no browser or e2e tests.

## Removed or merged, by category

**Duplicate HTTP checks** (another file serves the same path through the real server):
- `seo.test`: the 404, clean-URL and trailing-slash 301 tests were duplicated in `static.test` and in `sitemap.test`'s "every sitemap URL is served". Its three MIME tests (robots, sitemap, og-image) are now one `it.each`.
- `seo.test`: "sitemap.xml is valid" is subsumed by the exact match against the generator.
- `privacy.test`: "served with 200" and "listed in the sitemap" are already checked by `sitemap.test`, which serves every `client/public` page. This also removed a second copy of the dist tree.
- `security.test`: "accepts an allowed Origin" is exercised by every other WebSocket test. "Survives a malformed message" was folded into the PKR-4 test, which now also sends a non-JSON frame.

**Source greps replaced by behaviour already tested:**
- `a11y_perf`: the `immutable` / `no-cache` grep of `static.ts` is gone. `static.test` checks both headers over HTTP; the HTML `no-cache` check was added there.
- `analytics_gate`: the GA ID and static-tag checks on `index.html` folded into the every-page test. The `#/r/<id>` normalisation grep is dropped because `consent.test` runs each page's inline snippet with a room hash.

**Tautologies and mock-only tests:**
- `idle.test`: the "cleanup" test asserted `roomCount() >= 0`; it is now an `afterAll`.
- `reconnect.test`: "rejoining without the role drops observer (the bug)" asserted the pre-fix behaviour through a local copy of `server.ts` logic.
- `reconnect.test`: "reattach on an unknown id" was a duplicate of a `rooms.test` case.
- `sentry.test`: `reportError` forwarding only checked that a mock was called.

**Speed:**
- `sitemap.test`: the lastmod test ran `git status` and `git log` for all 37 pages (~0.8 s, about a fifth of the suite). The committed file already has to equal the generator's output, so the test now checks the git date on one page.

## Kept on purpose

- Every PKR-1..5 and SERBITO-361 test: seat takeover, per-IP limits, Origin, message schema, security headers.
- The billing guards: idle rooms and the `?v=2` WebSocket gate grep.
- The reconnect vote and observer fixes: they are regression tests from real bugs.
- `rooms.test` and `ws.test` both check that votes stay hidden. One is a unit test and the other runs through real sockets; the broadcast path is only covered by the second.
- The consent-banner runtime tests in `consent.test`: they execute `consent.js`, which nothing else does.

## Unsure (listed, not changed)

- `i18n.test`:
  - "offers English plus 8 languages" pins the `LANGS` constant.
  - "defaults to English" only reaches the `catch` path, because Node has no `localStorage`.
- `crosspromo.test` "lists GTD, Javi and Serbito…" pins the marketing copy word for word.
- `reconnect.test`, observer role: the two remaining cases use a local mirror of the server's join branch. A WebSocket-level test would guard the real code.
- `consent`, `privacy`, `analytics_gate` and `crosspromo` each walk and re-read the ~38 HTML pages with their own copy of the walker. A shared loader would make them shorter; the time cost is small.
