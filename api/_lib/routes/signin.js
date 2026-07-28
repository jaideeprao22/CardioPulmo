'use strict';
var http = require('../http');
var pb = require('../postbase');
var session = require('../auth');
var profile = require('../profile');

/* POST /api/auth?action=signin  { email, password }
   grant_type travels in the body; as a query parameter Postbase rejects it. */
module.exports = http.guard(async function (req, res) {
  if (!http.methodAllowed(req, res, ['POST'])) return;

  var b = http.body(req);
  var email = typeof b.email === 'string' ? b.email.trim().toLowerCase() : '';
  var password = typeof b.password === 'string' ? b.password : '';
  if (!email || !password) return http.fail(res, 400, 'Enter your email and password');

  var result;
  try {
    result = await pb.signInPassword(email, password);
  } catch (e) {
    /* Don't distinguish "no such account" from "wrong password". */
    if (e && (e.upstreamStatus === 400 || e.upstreamStatus === 401)) {
      return http.fail(res, 401, 'Wrong email or password');
    }
    throw e;
  }

  session.setSession(res, result.session);
  await profile.ensureProfileSafe(result.user);
  http.ok(res, { user: { id: result.user.id, email: result.user.email, name: result.user.name } });
});
