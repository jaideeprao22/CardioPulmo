'use strict';
var http = require('../http');
var pb = require('../postbase');
var sql = require('../sql');
var emails = require('../email');
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

  var email = emails.normalize(http.body(req).email);
  /* A malformed address is a client error and reveals nothing about who is registered. */
  if (!emails.looksLikeAddress(email)) return http.fail(res, 400, 'Enter a valid email address');

  var gate = rl.checkEmailAndIp(req, email);
  if (!gate.ok) {
    res.setHeader('Retry-After', String(gate.retryAfter));
    return http.fail(res, 429, 'Too many requests — wait a few minutes and try again');
  }

  /* Postbase's /otp auto-creates a user row for an address it has not seen. Calling it
     straight from here would make this an unauthenticated account-creation endpoint —
     POST a thousand addresses, get a thousand rows. So the account has to exist before
     any mail is attempted.

     The response below is unchanged either way, so this adds no enumeration signal to
     the body. It does add one to the TIMING — a miss returns after one query, a hit
     after a query plus an SMTP round trip. That is a weaker oracle than a body
     difference and strictly better than the account creation it replaces; noted in
     MIGRATION-PROGRESS.md rather than papered over. */
  var account = null;
  try {
    account = await sql.findUserByEmail(email);
  } catch (e) {
    /* Fail towards NOT sending. Guessing "probably exists" and calling /otp anyway is
       exactly the account creation this gate exists to prevent, so a lookup failure must
       not fall through to the send. The cost is that resets stop working while the
       database is unreachable — which is why this is logged loudly rather than swallowed:
       a silent stop here is a user who never gets their email and cannot say why. */
    console.error('[api] forgot: user lookup failed, not sending — ' + ((e && e.message) || e));
    return http.ok(res, { sent: true });
  }

  if (!account) {
    /* Identical body, no row created, no mail sent. */
    return http.ok(res, { sent: true });
  }

  try {
    /* account.email, NOT the typed string. Postbase matches exactly, so forwarding what
       the user typed would make it create a duplicate row for the differently-cased
       address and mail the link to the empty one. */
    await pb.sendOtp(account.email, 'magic_link', origin.setPasswordUrl(req));
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
