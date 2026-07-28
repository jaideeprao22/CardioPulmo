'use strict';
var http = require('../http');
var pb = require('../postbase');
var rl = require('../ratelimit');
var origin = require('../origin');

/* POST /api/auth?action=forgot  { email }

   Postbase has no password-reset endpoint, so this is built out of the magic-link
   primitive: send a link, let /verify consume the token and mint a session, land the
   browser on the set-password page, and change the password there against that session.
   The session IS the proof of address ownership; there is no separate reset token to
   store, expire or leak.

   ALWAYS 200. Answering differently for a known and an unknown address turns this into
   an account-enumeration oracle — anyone could test a list of emails against it. So the
   response is identical either way, and it deliberately does not say "we sent you an
   email", only that one will arrive if the address is registered.

   The two upstream configuration failures are NOT collapsed. 403 means that provider row
   is disabled; 500 means SMTP is unset for the project. They need different fixes, and a
   single vague message for both is exactly the mistake routes/google.js documents. */
module.exports = http.guard(async function (req, res) {
  if (!http.methodAllowed(req, res, ['POST'])) return;

  var email = String(http.body(req).email || '').trim().toLowerCase();
  /* A malformed address is a client error and reveals nothing about who is registered. */
  if (!email || email.indexOf('@') < 1) return http.fail(res, 400, 'Enter a valid email address');

  var gate = rl.checkEmailAndIp(req, email);
  if (!gate.ok) {
    res.setHeader('Retry-After', String(gate.retryAfter));
    return http.fail(res, 429, 'Too many requests — wait a few minutes and try again');
  }

  try {
    await pb.sendOtp(email, 'magic_link', origin.setPasswordUrl(req));
  } catch (e) {
    var status = e && e.upstreamStatus;
    /* Distinct causes, distinctly reported — both are ours to fix, neither is the
       user's fault, and neither leaks whether the address exists. */
    if (status === 403) {
      console.error('[api] forgot: magic link provider disabled — ' + ((e && e.upstreamBody) || ''));
      return http.fail(res, 503, 'Password reset by email is switched off for this app right now');
    }
    if (status === 500) {
      console.error('[api] forgot: SMTP not configured for this project — ' + ((e && e.upstreamBody) || ''));
      return http.fail(res, 503, 'This app cannot send email yet — ask an administrator to reset your password');
    }
    /* Anything else — including "no such user" in whatever form Postbase expresses it —
       is swallowed into the standard 200 so the response cannot be used to probe.
       It is logged in full, because a silent failure here is a user who never gets
       their email and cannot tell anyone why. */
    console.error('[api] forgot: upstream status ' + status + ' — ' +
      ((e && e.message) || 'no message') + ' — body: ' + ((e && e.upstreamBody) || '(empty)'));
  }

  http.ok(res, { sent: true });
});
