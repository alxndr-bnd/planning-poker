# Changelog

What changed in Planning Poker for its players, version by version, newest first.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versions are the release
tags `vX.Y.Z`. `scripts/changelog.ts` parses this file for the release script, and
`server/test/changelog.test.ts` rejects anything else:

- `## [Unreleased]` stays on top. Write new entries there. The release script turns it into
  `## [X.Y.Z] - YYYY-MM-DD` (see "Releasing" in the README) and refuses to release without entries.
- Sections: `### Added`, `### Changed`, `### Fixed`, `### Security`.
- An entry is one line in English: `- What players can now do or what got fixed.`
- Write for players. 1–5 short lines per release, no ticket numbers.

## [Unreleased]

## [0.61.0] - 2026-10-05

### Added
- New pages compare free planning poker tools, show a free alternative to planningpokeronline.com and scrum poker without ads, and explain planning poker vs open estimation meetings.

### Changed
- Every guide and the glossary answer common questions under clear question headings.
- The roadmap on the start page lists only features that are still open for votes.

## [0.60.0] - 2026-10-05

### Added
- Name each round: type the issue key or title in the field next to Reset or New vote. Everybody sees it on the table and in the estimate log.

### Changed
- The "Planning Poker for Jira" guides show how to put the issue key into the room.

## [0.59.0] - 2026-10-05

### Added
- The "Planning Poker for Jira" guide shows step by step, with screenshots, how to estimate Jira issues in a room.
- You can run your own copy of Planning Poker on your own domain. It has no analytics and no cookie banner unless you turn them on.

### Changed
- The start screen says what the app is: free online planning poker, no sign-up.
- The translated "Planning Poker for Jira" guides show the real steps: read the issue key aloud in the call and type the agreed points into Jira.
- Search engines get a shorter page summary, the guides' author and their real update date.

## [0.58.0] - 2026-10-05

### Security
- Planning Poker now runs under its own Google Cloud account with access only to its error reporting, nothing else in the cloud project.

## [0.57.0] - 2026-10-03

### Security
- Real-time voting connections are accepted only through poker.serbito.rs, and every deploy checks that the site sends its security headers.

## [0.56.0] - 2026-10-03

### Security
- The server image gets Debian security fixes every day.
- The deploy checks its security scanner against a fixed checksum and keeps the access token out of the code checkout.

## [0.55.0] - 2026-10-02

### Added
- The room lists observers. Two players with the same name get a suffix.
- The app opens in your browser's language, and the Russian interface is complete.

### Fixed
- The card deck fits on phones. The room shows when it reconnects and keeps votes made offline.
- A mistyped room link says that the room is not found.

## [0.54.0] - 2026-10-02

### Fixed
- When the window gets focus again, the page no longer scrolls under the cookie bar or the footer.

## [0.53.0] - 2026-10-01

### Changed
- The cookie banner shows "Accept" and "Decline" with equal weight. The landing text is below the app.

### Fixed
- The page no longer jumps on load, and the footer never hides the focused element.

## [0.52.0] - 2026-09-30

### Fixed
- The cookie banner never hides the focused element. The name field has a label, and links are underlined.

## [0.51.0] - 2026-09-29

### Security
- Room members cannot take over each other's seat, and one client cannot overload the server.
- Security headers are on, and dependencies are up to date.

[Unreleased]: https://github.com/alxndr-bnd/planning-poker/compare/v0.61.0...HEAD
[0.61.0]: https://github.com/alxndr-bnd/planning-poker/compare/v0.60.0...v0.61.0
[0.60.0]: https://github.com/alxndr-bnd/planning-poker/compare/v0.59.0...v0.60.0
[0.59.0]: https://github.com/alxndr-bnd/planning-poker/compare/v0.58.0...v0.59.0
[0.58.0]: https://github.com/alxndr-bnd/planning-poker/compare/v0.57.0...v0.58.0
[0.57.0]: https://github.com/alxndr-bnd/planning-poker/compare/v0.56.0...v0.57.0
[0.56.0]: https://github.com/alxndr-bnd/planning-poker/compare/v0.55.0...v0.56.0
[0.55.0]: https://github.com/alxndr-bnd/planning-poker/compare/v0.54.0...v0.55.0
[0.54.0]: https://github.com/alxndr-bnd/planning-poker/compare/v0.53.0...v0.54.0
[0.53.0]: https://github.com/alxndr-bnd/planning-poker/compare/v0.52.0...v0.53.0
[0.52.0]: https://github.com/alxndr-bnd/planning-poker/compare/v0.51.0...v0.52.0
[0.51.0]: https://github.com/alxndr-bnd/planning-poker/releases/tag/v0.51.0
