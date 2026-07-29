'use strict';
var http = require('../http');
var pb = require('../postbase');
var auth = require('../auth');
var rl = require('../ratelimit');
var otpCookie = require('../otp-cookie');

/* POST /api/auth?action=verify-email   (no body)

   "Verify your email" for a user who is already signed in. Postbase's /signup sends
   nothing — there is no mail transport in that route — so every account created by
   email and password starts unverified, and this is the only way to clear that.

   The address is the SESSION user's address. It is not read from the request, for the
   same reason set-password does not read one: an address in the body would let a signed-in
   user aim a verification link, and the link mints a session.

   The CODE is the verification now: /email-otp/verify consumes it and runs
     UPDATE users SET email_verified = $1 WHERE id = $2 AND email_verified IS NULL
   on success, confirmed in that route's source. So verification still happens; only the
   delivery changed, from a link to a 6-digit code.

   Why it had to change: Postbase's link handler calls headers.set() on the immutable
   Response returned by Response.redirect(), which throws, so the emailed link 500s at
   db.clinoble.com — and the token is DELETEd before the throw, so each click burns it.
   Nothing about that is reachable from our side. */
module.exports = http.guard(async function (req, res) {
  if (!http.methodAllowed(req, res, ['POST'])) return;

  var user = await auth.requireUser(req, res);
  if (!user.email) return http.fail(res, 400, 'This account has no email address to verify');

  if (user.emailVerified) return http.ok(res, { alreadyVerified: true, sent: false });

  var gate = rl.checkEmailAndIp(req, user.email);
  if (!gate.ok) {
    res.setHeader('Retry-After', String(gate.retryAfter));
    return http.fail(res, 429, 'Too many requests — wait a few minutes and try again');
  }

  try {
    /* A 6-digit code, not a link: Postbase's link handler throws on an immutable
       Response and 500s, burning the token on the way. Verification still happens —
       /email-otp/verify runs
         UPDATE users SET email_verified = $1 WHERE id = $2 AND email_verified IS NULL
       on success, confirmed in that route's source. Only the delivery changed. */
    await pb.sendOtp(user.email);
  } catch (e) {
    var status = e && e.upstreamStatus;
    if (status === 403) {
      console.error('[api] verify-email: email OTP provider disabled — ' + ((e && e.upstreamBody) || ''));
      return http.fail(res, 503, 'Email verification is switched off for this app right now');
    }
    if (status === 500) {
      console.error('[api] verify-email: SMTP not configured for this project — ' + ((e && e.upstreamBody) || ''));
      return http.fail(res, 503, 'This app cannot send email yet');
    }
    console.error('[api] verify-email: upstream status ' + status + ' — ' +
      ((e && e.message) || 'no message') + ' — body: ' + ((e && e.upstreamBody) || '(empty)'));
    /* This one is NOT an enumeration surface — the address is the caller's own and they
       are already signed in — so a failure is reported rather than hidden behind a 200. */
    return http.fail(res, 502, 'Could not send the verification email — try again shortly');
  }

  /* Same address cookie as the reset flow, so otp-verify can exact-match. */
  otpCookie.set(res, user.email);
  http.ok(res, { sent: true });
});
