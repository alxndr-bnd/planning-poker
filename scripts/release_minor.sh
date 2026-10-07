#!/usr/bin/env bash
# Release helper for planning-poker (adapted from the serbito release_minor.sh).
# CHANGELOG -> gate -> commit -> next minor tag -> push -> GitHub Release. The v*.*.* tag
# triggers the Cloud Run deploy workflow. The test + build gate is zero-tolerance.
# Entries for players go into CHANGELOG.md under "## [Unreleased]" before the release. This
# script turns them into "## [X.Y.0] - date" in the release commit and refuses to release
# without entries (SERBITO-389, format: scripts/changelog.ts).
set -euo pipefail
cd "$(dirname "$0")/.."

msg="${1:-}"
if [[ -z "$msg" ]]; then
  echo "Usage: $0 \"commit message\""
  exit 1
fi

latest_tag="$(git tag --list 'v*.*.*' --sort=-v:refname | head -n 1)"
if [[ -z "$latest_tag" ]]; then
  next_tag="v0.1.0"
else
  version="${latest_tag#v}"
  IFS='.' read -r major minor patch <<<"$version"
  next_minor=$((minor + 1))
  next_tag="v${major}.${next_minor}.0"
fi

# --- CHANGELOG: [Unreleased] -> [X.Y.0] - today. No entries: refuse before the gate, commit and tag ---
echo "==> CHANGELOG.md: ${next_tag#v}"
if ! node scripts/changelog.ts release "${next_tag#v}"; then
  echo "Release $next_tag not made: add what players get to CHANGELOG.md (README -> Releasing)" >&2
  exit 1
fi
notes="$(node scripts/changelog.ts notes "${next_tag#v}")"

# --- sitemap: refresh lastmod for pages changed in this release (committed below) ---
echo "==> npm run sitemap"
npm run sitemap

# --- gate: tests + typecheck + client build must pass before we tag ---
# The tree is staged first, so after the gate we can tell whether it still is what was tested.
git add .
gated_tree="$(git write-tree)"
echo "==> npm test"
npm test
echo "==> npm run typecheck"
npm run typecheck
echo "==> npm run build"
npm run build

# One test run per release (SERBITO-551): the pre-commit hook runs the same tests and typecheck.
# Skip them only when the gate above passed on exactly the tree we commit.
git add .
skip_hooks=""
if [[ "$(git write-tree)" == "$gated_tree" ]]; then
  skip_hooks="vitest,typecheck"
else
  echo "==> the gate changed the tree: the pre-commit hook runs the tests again"
fi
if git diff --cached --quiet && git diff --quiet; then
  SKIP="$skip_hooks" git commit --allow-empty -m "$msg"
else
  SKIP="$skip_hooks" git commit -m "$msg"
fi

git tag "$next_tag"
git push
git push origin "$next_tag"

echo "Released $next_tag"

# --- GitHub Release: the version's entries from CHANGELOG.md. Not fatal: the tag and the deploy
# are already on their way ---
retry="gh release create $next_tag --verify-tag --title $next_tag --notes \"\$(node scripts/changelog.ts notes ${next_tag#v})\""
if ! command -v gh >/dev/null 2>&1; then
  echo "WARNING: gh not found, no GitHub Release for $next_tag. Run: $retry" >&2
elif ! gh release create "$next_tag" --verify-tag --title "$next_tag" --notes "$notes"; then
  echo "WARNING: GitHub Release for $next_tag failed. Retry: $retry" >&2
fi
exit 0
