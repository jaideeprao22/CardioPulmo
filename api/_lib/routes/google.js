'use strict';
var http = require('../http');
var pb = require('../postbase');
var session = require('../auth');
var profile = require('../profile');

/* POST /api/auth?action=google  { credential, nonce? }

   Google Identity Services runs in the browser (the client ID is public, which is fine)
   and hands us an ID token. That token comes here, and only this route forwards it to
   Postbase with the service key. The browser never receives a Postbase token.

   Postbase links the identity into the project's `accounts` table
   ON CONFLICT (provider, provider_account_id) DO NOTHING, so a returning Google user
   resolves to their existing row instead of creating a duplicate.

   There is NO environment variable behind this route. The Google client ID is a public
   constant in the browser (app.js), and the client ID Postbase verifies against lives in
   its own provider_configs. Nothing server-side reads GOOGLE_CLIENT_ID, so setting one
   changes nothing here.

   On the error message below — this cost real time, so it is worth writing down.
   This route used to answer a 401 from Postbase with "Google sign-in is not enabled for
   this app yet", asserting a configuration cause. A 401 has at least two causes, and the
   far more common one is simply a bad or expired credential: posting `invalid.token.here`
   produced exactly that message, which reads as "the provider is misconfigured" and sends
   whoever is debugging into Vercel env vars and provider_configs for a system that was
   working. It also returned 503, claiming the server was broken, which it was not.

   So: no cause is asserted. The upstream status is passed through, the message says only
   what is known, and the upstream status and body are LOGGED — the old branch swallowed
   them entirely, which is why the failure left no trace to diagnose from. Once a real log
   line shows how Postbase distinguishes the two cases, this can say something sharper. */
module.exports = http.guard(async function (req, res) {
  if (!http.methodAllowed(req, res, ['POST'])) return;

  var b = http.body(req);
  var credential = typeof b.credential === 'string' ? b.credential.trim() : '';
  var nonce = typeof b.nonce === 'string' && b.nonce ? b.nonce : null;
  if (!credential) return http.fail(res, 400, 'Google sign-in did not return a credential');

  var result;
  try {
    result = await pb.signInGoogleIdToken(credential, nonce);
  } catch (e) {
    var status = e && e.upstreamStatus;
    if (status === 401 || status === 403) {
      /* The credential itself is deliberately NOT logged — it is a user's Google ID
         token. The upstream status and body are what identify the failure. */
      console.error('[api] google sign-in rejected by postbase — status ' + status +
        ' — ' + ((e && e.message) || 'no message') +
        ' — body: ' + ((e && e.upstreamBody) || '(empty)'));
      return http.fail(res, status, 'Google sign-in failed — try again, or use email and password');
    }
    throw e;
  }

  session.setSession(res, result.session);
  await profile.ensureProfileSafe(result.user);
  http.ok(res, { user: { id: result.user.id, email: result.user.email, name: result.user.name } });
});
