#!/usr/bin/env bash
# Release helper for planning-poker (adapted from the serbito release_minor.sh).
# Commits, bumps the minor version tag, and pushes — the v*.*.* tag triggers the
# Cloud Run deploy workflow. Runs the test + build gate first (zero-tolerance).
set -euo pipefail

msg="${1:-}"
if [[ -z "$msg" ]]; then
  echo "Usage: $0 \"commit message\""
  exit 1
fi

# --- gate: tests + typecheck + client build must pass before we tag ---
echo "==> npm test"
npm test
echo "==> npm run typecheck"
npm run typecheck
echo "==> npm run build"
npm run build

git add .
if git diff --cached --quiet && git diff --quiet; then
  git commit --allow-empty -m "$msg"
else
  git commit -m "$msg"
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

git tag "$next_tag"
git push
git push origin "$next_tag"

echo "Released $next_tag"
