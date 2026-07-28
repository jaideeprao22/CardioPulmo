'use strict';
var http = require('../http');
var pb = require('../postbase');
var rl = require('../ratelimit');
var otpCookie = require('../otp-cookie');

/* POST /api/auth?action=otp-send  { email }

   "Email me a code instead" — the same address-ownership proof as the magic link, but a
   6-digit code the user types. On a phone this is the better path: the link opens in
   whatever the mail app decides is the browser, which is frequently not the one holding
   the session, and the user ends up signed in somewhere they were not looking.

   The address is remembered in a short-lived HttpOnly cookie rather than being asked for
   again at verify time — see ../otp-cookie.js for why.

   Same enumeration rule as forgot: ALWAYS 200 unless the request itself is malformed or
   rate-limited. */
module.exports = http.guard(async function (req, res) {
  if (!http.methodAllowed(req, res, ['POST'])) return;

  var email = String(http.body(req).email || '').trim().toLowerCase();
  if (!email || email.indexOf('@') < 1) return http.fail(res, 400, 'Enter a valid email address');

  var gate = rl.checkEmailAndIp(req, email);
  if (!gate.ok) {
    res.setHeader('Retry-After', String(gate.retryAfter));
    return http.fail(res, 429, 'Too many requests — wait a few minutes and try again');
  }

  try {
    await pb.sendOtp(email, 'otp');
  } catch (e) {
    var status = e && e.upstreamStatus;
    if (status === 403) {
      console.error('[api] otp-send: email OTP provider disabled — ' + ((e && e.upstreamBody) || ''));
      return http.fail(res, 503, 'Sign-in by code is switched off for this app right now');
    }
    if (status === 500) {
      console.error('[api] otp-send: SMTP not configured for this project — ' + ((e && e.upstreamBody) || ''));
      return http.fail(res, 503, 'This app cannot send email yet — use your password, or ask an administrator');
    }
    console.error('[api] otp-send: upstream status ' + status + ' — ' +
      ((e && e.message) || 'no message') + ' — body: ' + ((e && e.upstreamBody) || '(empty)'));
  }

  /* Set regardless of whether the send succeeded: the cookie says which address a code
     WOULD have gone to, and setting it only on success would leak existence. */
  otpCookie.set(res, email);
  http.ok(res, { sent: true });
});
