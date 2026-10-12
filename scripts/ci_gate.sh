#!/usr/bin/env bash
# SERBITO-613: the release gate. A red pipeline stops the line: no tag until CI on main
# is green for the commit that is released.
#
# - HEAD must be origin/main: GitHub CI has run (or runs) for exactly this commit.
# - Every push run on main for HEAD must end success / skipped / neutral, and the
#   workflow CI_GATE_WORKFLOW (default "CI") must be among them.
# - Runs in progress: wait, poll every CI_GATE_INTERVAL s, up to CI_GATE_TIMEOUT s (20 min).
# - Red, cancelled, no run, or timeout: a clear message and exit 1.
# Needs gh (authenticated) and jq.
set -euo pipefail

workflow="${CI_GATE_WORKFLOW:-CI}"
timeout="${CI_GATE_TIMEOUT:-1200}"
interval="${CI_GATE_INTERVAL:-20}"
no_run_grace="${CI_GATE_NO_RUN_GRACE:-180}"

fail() {
  printf 'CI gate: %s\n' "$@" >&2
  echo "CI gate: release refused (SERBITO-613). Fix main, wait for green CI, then release again." >&2
  exit 1
}

command -v gh >/dev/null 2>&1 || fail "gh is not installed (brew install gh; gh auth login)."
command -v jq >/dev/null 2>&1 || fail "jq is not installed (brew install jq)."

git fetch -q origin main || fail "git fetch origin main failed."
sha="$(git rev-parse HEAD)"
main_sha="$(git rev-parse origin/main)"
if [[ "$sha" != "$main_sha" ]]; then
  fail "HEAD ${sha:0:12} is not origin/main ${main_sha:0:12}." \
    "Merge the work into main (PR), pull it, wait for CI on main, then release."
fi

start=$SECONDS
echo "==> CI gate: GitHub runs on main for ${sha:0:12}"
while :; do
  runs="$(gh run list --branch main --commit "$sha" --event push --limit 100 \
    --json workflowName,status,conclusion,createdAt,url)" || fail "gh run list failed (gh auth status?)."
  # A re-push of the same commit makes a second run: the newest run per workflow counts.
  latest="$(jq -c 'group_by(.workflowName) | map(max_by(.createdAt))' <<<"$runs")"
  red="$(jq -r '.[] | select(.status == "completed"
      and (.conclusion | IN("success", "skipped", "neutral") | not))
    | "  \(.workflowName): \(.conclusion) \(.url)"' <<<"$latest")"
  [[ -z "$red" ]] || fail "red run on main for ${sha:0:12}:" "$red"
  pending="$(jq -r '.[] | select(.status != "completed") | "\(.workflowName) (\(.status))"' <<<"$latest")"
  has_ci="$(jq --arg w "$workflow" 'any(.[]; .workflowName == $w)' <<<"$latest")"
  waited=$((SECONDS - start))
  if [[ "$has_ci" == true && -z "$pending" ]]; then
    jq -r '.[] | "    \(.workflowName): \(.conclusion)"' <<<"$latest"
    echo "==> CI gate: green"
    exit 0
  fi
  if [[ "$has_ci" != true ]] && (( waited >= no_run_grace )); then
    fail "no \"$workflow\" run on main for ${sha:0:12} after ${waited}s." \
      "Push main and check .github/workflows (push: branches: [main])."
  fi
  (( waited < timeout )) || fail "CI still running after ${waited}s: ${pending//$'\n'/, }"
  echo "    waiting ${interval}s: ${pending:-no \"$workflow\" run yet}" | tr '\n' ' '
  echo
  sleep "$interval"
done
