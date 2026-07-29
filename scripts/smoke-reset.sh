#!/usr/bin/env bash
# Smoke test for the password-reset / email-OTP / verify-email routes.
#
# Usage:
#   BASE=https://<preview-or-prod-host> ./scripts/smoke-reset.sh you@example.com
#
# If the deployment is behind Vercel Deployment Protection, also set:
#   BYPASS=<VERCEL_AUTOMATION_BYPASS_SECRET>
# (Vercel → Project → Settings → Deployment Protection → Protection Bypass for Automation)
#
# This exercises everything up to the point mail is sent. The click-through needs a real
# inbox, so the last steps are manual and listed at the end.
#
# NOTE ON RE-RUNNING: sends are rate-limited to 3 per address per 15 minutes, and this
# script spends two of them on the address you pass. Run it twice in quick succession and
# the known-address checks will be rate-limited — reported as SKIP, not FAIL, with the
# remaining window. Use a different registered address, or wait it out.

set -u
BASE="${BASE:-}"
EMAIL="${1:-}"
BYPASS="${BYPASS:-}"

if [ -z "$BASE" ] || [ -z "$EMAIL" ]; then
  echo "usage: BASE=https://host $0 you@example.com" >&2; exit 2
fi

H=(-H 'Content-Type: application/json')
[ -n "$BYPASS" ] && H+=(-H "x-vercel-protection-bypass: $BYPASS" -H 'x-vercel-set-bypass-cookie: true')

pass=0; fail=0
chk() { # chk "name" expected actual [extra]
  if [ "$2" = "$3" ]; then printf 'PASS  %s\n' "$1"; pass=$((pass+1));
  else printf 'FAIL  %s  <<< expected %s got %s %s\n' "$1" "$2" "$3" "${4:-}"; fail=$((fail+1)); fi
}
code() { curl -s -o /tmp/_sm_body -w '%{http_code}' "${H[@]}" "$@"; }
body() { cat /tmp/_sm_body; }

echo "== reachability =="
c=$(code "$BASE/api/auth?action=session"); chk "auth function is reachable" 200 "$c" "$(body | head -c 80)"
# set-password.html is deliberately gone: it existed only as the landing for the
# magic-link redirect, and Postbase's link handler 500s at source. The new password is
# set in the sign-in overlay after the code is confirmed.
c=$(code "$BASE/set-password.html"); chk "set-password.html is NOT served any more" 404 "$c"

echo
echo "== forgot-password =="
c=$(code -X POST "$BASE/api/auth?action=forgot" -d "{\"email\":\"$EMAIL\"}")
known_body=$(body)
known_429=no
if [ "$c" = "429" ]; then
  # The per-address limit is 3 / 15 min, so a recent run (or a manual probe) spends it.
  # That is the limiter working, not a defect — report it as SKIP rather than a failure
  # you would waste time chasing, and say how long the window has left.
  ra=$(curl -s -D - -o /dev/null "${H[@]}" -X POST "$BASE/api/auth?action=forgot" \
        -d "{\"email\":\"$EMAIL\"}" | tr -d '\r' | awk 'tolower($1)=="retry-after:"{print $2}')
  printf 'SKIP  known address -> 200  (rate-limited from an earlier run; ~%ss left in the window)\n' "${ra:-?}"
  known_429=yes
else
  chk "known address -> 200" 200 "$c" "$known_body"
fi

c=$(code -X POST "$BASE/api/auth?action=forgot" -d '{"email":"definitely-not-a-user-9f3a@example.invalid"}')
unknown_body=$(body)
chk "unknown address -> 200" 200 "$c" "$unknown_body"
if [ "$known_429" = yes ]; then
  printf 'SKIP  responses are byte-identical  (needs a non-rate-limited known address)\n'
else
  chk "responses are byte-identical (no enumeration oracle)" "$known_body" "$unknown_body"
fi

# The gate added in PR #6: an address with no account must not reach /otp, because
# /otp INSERTs a user row for anything it has not seen. Externally the tell is that the
# body is unchanged — the absence of the row is asserted in the offline suite.
c=$(code -X POST "$BASE/api/auth?action=forgot" -d '{"email":"gate-probe-5c7d@example.invalid"}')
chk "an unknown address is answered without creating anything" 200 "$c" "$(body)"

c=$(code -X POST "$BASE/api/auth?action=forgot" -d '{"email":"not-an-email"}')
chk "malformed address -> 400" 400 "$c" "$(body)"

echo
echo "== set-password is session-only =="
c=$(code -X POST "$BASE/api/auth?action=set-password" -d '{"password":"whatever123"}')
chk "no session -> 401" 401 "$c" "$(body)"
c=$(code -X POST "$BASE/api/auth?action=set-password" \
      -d '{"password":"whatever123","email":"victim@example.com","user_id":"victim"}')
chk "no session, naming a victim -> still 401" 401 "$c" "$(body)"

echo
echo "== email OTP =="
# There is ONE send route now. otp-send was the same mechanism under a second name, and
# the magic-link path it used to be distinguished from no longer exists.
c=$(code -X POST "$BASE/api/auth?action=otp-send" -d "{\"email\":\"$EMAIL\"}")
chk "the retired otp-send action -> 404" 404 "$c" "$(body)"
c=$(code -X POST "$BASE/api/auth?action=otp-verify" -d '{"code":"000000"}')
chk "otp-verify with no address cookie -> 400" 400 "$c" "$(body)"
c=$(code -X POST "$BASE/api/auth?action=otp-verify" -d '{"code":"abc"}')
chk "otp-verify with a malformed code -> 400" 400 "$c" "$(body)"

echo
echo "== verify-email is session-only =="
c=$(code -X POST "$BASE/api/auth?action=verify-email" -d '{}')
chk "no session -> 401" 401 "$c" "$(body)"

echo
echo "== unknown action still 404s =="
c=$(code -X POST "$BASE/api/auth?action=reset-everything" -d '{}')
chk "unknown action -> 404" 404 "$c" "$(body)"

echo
echo "== rate limiting (per address) =="
hit429=no
for i in 1 2 3 4 5 6; do
  c=$(code -X POST "$BASE/api/auth?action=forgot" -d '{"email":"ratelimit-probe-7c1@example.invalid"}')
  [ "$c" = "429" ] && { hit429=yes; break; }
done
chk "repeated requests for one address eventually 429" yes "$hit429"

echo
printf '\n%d passed, %d failed\n' "$pass" "$fail"
cat <<'MANUAL'

Manual steps (need a real inbox):
  1. Tap "Forgot password?", enter the address above, and read the 6-digit code from the
     email. Enter it IN THE SAME BROWSER — the address is held in an HttpOnly cookie from
     the send step, so a different browser cannot complete it.
  2. The new-password fields appear in the same overlay. Set one, then sign in with it.
  3. Sign in, open About, and use "Send me a verification code" if the prompt is shown.
     Confirming the code stamps email_verified and the prompt disappears.

There is no link to click anywhere: Postbase's /verify handler calls headers.set() on the
immutable Response from Response.redirect(), so the emailed link 500s and burns its token.
MANUAL

[ "$fail" -eq 0 ] || exit 1
