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
# inbox, so the last two steps are manual and listed at the end.

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
c=$(code "$BASE/set-password.html"); chk "set-password.html is served" 200 "$c" "$(body | head -c 80)"

echo
echo "== forgot-password =="
c=$(code -X POST "$BASE/api/auth?action=forgot" -d "{\"email\":\"$EMAIL\"}")
known_body=$(body)
chk "known address -> 200" 200 "$c" "$known_body"

c=$(code -X POST "$BASE/api/auth?action=forgot" -d '{"email":"definitely-not-a-user-9f3a@example.invalid"}')
unknown_body=$(body)
chk "unknown address -> 200" 200 "$c" "$unknown_body"
chk "responses are byte-identical (no enumeration oracle)" "$known_body" "$unknown_body"

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
c=$(code -X POST "$BASE/api/auth?action=otp-send" -d "{\"email\":\"$EMAIL\"}")
chk "otp-send -> 200" 200 "$c" "$(body)"
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
  1. Open the reset link emailed to the address above. It should land on
     /set-password.html already signed in, showing "Setting a new password for <you>".
     Set a password, then sign in with it on the main app.
  2. Sign in, open About, and use "Send me a verification link" if the prompt is shown.
     After clicking that link the prompt should disappear on reload.
  3. For the 6-digit path, request a code and enter it IN THE SAME BROWSER.
MANUAL

[ "$fail" -eq 0 ] || exit 1
