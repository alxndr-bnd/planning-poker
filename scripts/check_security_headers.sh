#!/usr/bin/env bash
# SERBITO-348: after a deploy, check that a page sends the security headers.
# Usage: scripts/check_security_headers.sh <url>
# Reads the response headers of <url> (one request, redirects are NOT followed) and requires:
#   strict-transport-security; x-content-type-options: nosniff; x-frame-options, or
#   frame-ancestors in content-security-policy; referrer-policy; content-security-policy or
#   content-security-policy-report-only.
# Prints the missing names and exits 1 if any is missing; exit 2 if the request fails.
set -euo pipefail

url="${1:?usage: check_security_headers.sh <url>}"
if ! raw="$(curl -sS -D - -o /dev/null --max-time 30 "$url")"; then
  echo "Cannot read the headers of $url" >&2
  exit 2
fi
# Lower-case names and values, drop CR. With several header blocks (1xx), all are kept;
# that does no harm, because a 1xx block has none of these headers.
headers="$(printf '%s\n' "$raw" | tr -d '\r' | tr '[:upper:]' '[:lower:]')"

has() { printf '%s\n' "$headers" | grep -Eq "^$1:"; }
value_has() { printf '%s\n' "$headers" | grep -E "^$1:" | grep -Fq "$2"; }

missing=()
has "strict-transport-security" || missing+=("strict-transport-security")
value_has "x-content-type-options" "nosniff" || missing+=("x-content-type-options: nosniff")
if ! has "x-frame-options" && ! value_has "content-security-policy" "frame-ancestors"; then
  missing+=("x-frame-options or frame-ancestors")
fi
has "referrer-policy" || missing+=("referrer-policy")
has "content-security-policy(-report-only)?" || missing+=("content-security-policy")

if [ "${#missing[@]}" -gt 0 ]; then
  echo "Missing security headers on $url:"
  printf '  - %s\n' "${missing[@]}"
  exit 1
fi
echo "Security headers OK on $url"
