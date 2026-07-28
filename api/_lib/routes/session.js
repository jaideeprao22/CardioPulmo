'use strict';
var http = require('../http');
var session = require('../auth');
var profile = require('../profile');

/* GET /api/auth?action=session -> { data: { user: {...} | null }, error: null }

   Deliberately does NOT proxy Postbase's GET /session. That endpoint fails OPEN on this
   instance: with no API key, and with a garbage X-Postbase-Token, it still answers
   200 {"session":null}. A 200 from it proves nothing. Identity here comes from
   GET /user, which fails closed with 401.

   A missing session is a normal, expected state and answers 200 with user:null — the
   front end treats it as "signed out", not as an error. */
module.exports = http.guard(async function (req, res) {
  if (!http.methodAllowed(req, res, ['GET'])) return;

  var user = await session.currentUser(req, res);
  if (!user) return http.ok(res, { user: null });

  /* Repairs an account whose profile row was never created — including accounts made
     before this migration, when the auth.users trigger still existed. */
  await profile.ensureProfileSafe(user);

  http.ok(res, {
    user: { id: user.id, email: user.email, name: user.name }
  });
});
