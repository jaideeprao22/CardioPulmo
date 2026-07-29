'use strict';
var http = require('../http');
var pb = require('../postbase');
var sql = require('../sql');
var emails = require('../email');
var rl = require('../ratelimit');
var otpCookie = require('../otp-cookie');

/* POST /api/auth?action=forgot  { email }

   Postbase has no password-reset endpoint, so this is built out of the email-OTP
   primitive: send a 6-digit code, let otp-verify exchange it for a session, and change
   the password against that session. The session IS the proof of address ownership;
   there is no separate reset token to store, expire or leak.

   It used to send a magic link. That is no longer possible — Postbase's link handler is
   broken at source:

     apps/web/src/app/api/auth/v1/[projectId]/verify/route.ts
       141:  const response = Response.redirect(new URL(redirectTo, req.url));
       151:  response.headers.set("Set-Cookie", cookieOpts);

   Response.redirect() returns immutable headers, so headers.set() throws and Next.js
   answers 500 — confirmed live against db.clinoble.com. The token is DELETEd before the
   throw, so every click burns it and the same link cannot be retried.

   This is now the ONLY code-sending route for signed-out users. The separate otp-send
   action is gone: it was the same mechanism under a second name, and offering both is
   what confused people.

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
    otpCookie.set(res, email);
    return http.ok(res, { sent: true });
  }

  if (!account) {
    /* Identical body, cookie still set, no row created, no mail sent — an unknown address
       stays indistinguishable right through to the code-entry screen. */
    otpCookie.set(res, email);
    return http.ok(res, { sent: true });
  }

  try {
    /* account.email, NOT the typed string. Postbase matches exactly, so forwarding what
       the user typed would make it create a duplicate row for the differently-cased
       address and mail the code to the empty one. */
    await pb.sendOtp(account.email);
  } catch (e) {
    var status = e && e.upstreamStatus;
    /* Distinct causes, distinctly reported — both are ours to fix, neither is the
       user's fault, and neither leaks whether the address exists. */
    if (status === 403) {
      console.error('[api] forgot: email OTP provider disabled — ' + ((e && e.upstreamBody) || ''));
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

  /* The CANONICAL address, so otp-verify hands the exact-matching upstream the same
     string the code was minted against. Set regardless of whether the send succeeded:
     setting it only on success would leak existence. */
  otpCookie.set(res, account.email);
  http.ok(res, { sent: true });
});
