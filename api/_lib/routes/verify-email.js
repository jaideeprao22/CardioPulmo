'use strict';
var http = require('../http');
var pb = require('../postbase');
var auth = require('../auth');
var rl = require('../ratelimit');
var origin = require('../origin');

/* POST /api/auth?action=verify-email   (no body)

   "Verify your email" for a user who is already signed in. Postbase's /signup sends
   nothing — there is no mail transport in that route — so every account created by
   email and password starts unverified, and this is the only way to clear that.

   The address is the SESSION user's address. It is not read from the request, for the
   same reason set-password does not read one: an address in the body would let a signed-in
   user aim a verification link, and the link mints a session.

   The magic link IS the verification: Postbase's /verify consumes the token and stamps
   email_verified before redirecting. So this sends the user home rather than to
   set-password — they are not changing anything, just proving the address. */
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
    await pb.sendOtp(user.email, 'magic_link', origin.baseUrl(req) + '/');
  } catch (e) {
    var status = e && e.upstreamStatus;
    if (status === 403) {
      console.error('[api] verify-email: magic link provider disabled — ' + ((e && e.upstreamBody) || ''));
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

  http.ok(res, { sent: true });
});
