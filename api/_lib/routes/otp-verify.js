'use strict';
var http = require('../http');
var pb = require('../postbase');
var session = require('../auth');
var profile = require('../profile');
var rl = require('../ratelimit');
var otpCookie = require('../otp-cookie');

/* POST /api/auth?action=otp-verify  { code }

   Redeems the 6-digit code and signs the user in. The address comes from the HttpOnly
   cookie set by otp-send, never from the request body — see ../otp-cookie.js.

   Upstream contract (POST /email-otp/verify): body { email, code, remember_me? } with
   `code` exactly 6 characters, answering { user, session } like /token. Confirmed from
   the Postbase source, not from a live call — so a wrong guess would show up as a 400,
   and the upstream body is logged to make that immediately obvious rather than a mystery.

   Rate-limited on the code path too: without it, six digits is a million guesses and an
   unthrottled endpoint is a brute-force target. */
module.exports = http.guard(async function (req, res) {
  if (!http.methodAllowed(req, res, ['POST'])) return;

  var email = otpCookie.read(req);
  if (!email) {
    return http.fail(res, 400, 'That code has expired, or was requested in a different browser — send a new one');
  }

  var code = String(http.body(req).code || '').replace(/\s+/g, '');
  if (!/^[0-9]{6}$/.test(code)) return http.fail(res, 400, 'Enter the 6-digit code from the email');

  /* Tighter than the send limit: this one guards guessing, not mail volume. */
  var gate = rl.checkEmailAndIp(req, email, {
    scope: 'verify',                       /* its own bucket — see ../ratelimit.js */
    emailLimit: 6, emailWindowMs: 15 * 60 * 1000,
    ipLimit: 40, ipWindowMs: 15 * 60 * 1000
  });
  if (!gate.ok) {
    res.setHeader('Retry-After', String(gate.retryAfter));
    return http.fail(res, 429, 'Too many attempts — wait a few minutes and try again');
  }

  var result;
  try {
    result = await pb.verifyEmailOtp(email, code);
  } catch (e) {
    var status = e && e.upstreamStatus;
    console.error('[api] otp-verify: upstream status ' + status + ' — ' +
      ((e && e.message) || 'no message') + ' — body: ' + ((e && e.upstreamBody) || '(empty)'));
    /* 400 is "invalid or expired code", 404 is "user not found". Both are reported the
       same way to the person typing: telling them the address is unknown would answer a
       question they did not have to prove they were entitled to ask. */
    if (status === 400 || status === 404) {
      return http.fail(res, 400, 'That code is wrong or has expired — send a new one');
    }
    throw e;
  }

  session.setSession(res, result.session);
  otpCookie.clear(res);
  await profile.ensureProfileSafe(result.user);
  http.ok(res, { user: { id: result.user.id, email: result.user.email, name: result.user.name } });
});
