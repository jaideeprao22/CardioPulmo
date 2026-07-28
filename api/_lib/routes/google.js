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

   Until the Google provider is configured for this project in provider_configs,
   Postbase answers 401 here. That is a configuration state, not a bug in this route,
   so it is reported to the user as such. */
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
    if (e && (e.upstreamStatus === 401 || e.upstreamStatus === 403)) {
      return http.fail(res, 503, 'Google sign-in is not enabled for this app yet — use email and password');
    }
    throw e;
  }

  session.setSession(res, result.session);
  await profile.ensureProfileSafe(result.user);
  http.ok(res, { user: { id: result.user.id, email: result.user.email, name: result.user.name } });
});
