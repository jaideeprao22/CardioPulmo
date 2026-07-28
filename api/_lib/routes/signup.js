'use strict';
var http = require('../http');
var pb = require('../postbase');
var session = require('../auth');
var profile = require('../profile');
var emails = require('../email');

/* POST /api/auth?action=signup  { email, password }
   Postbase requires a password of at least 6 characters.
   Note for the UI: this instance has no /magiclink and no /recover, so there is no
   password reset and no confirmation email. The front end must not promise either. */
module.exports = http.guard(async function (req, res) {
  if (!http.methodAllowed(req, res, ['POST'])) return;

  var b = http.body(req);
  /* Normalised here so every row this creates is stored lowercase and trimmed. */
  var email = emails.normalize(b.email);
  var password = typeof b.password === 'string' ? b.password : '';

  if (!emails.looksLikeAddress(email)) return http.fail(res, 400, 'Enter a valid email address');
  if (password.length < 6) return http.fail(res, 400, 'Password must be at least 6 characters');

  var result = await pb.signUp(email, password);
  session.setSession(res, result.session);

  /* handle_new_user() replacement — the profiles row is ours to create now. */
  await profile.ensureProfileSafe(result.user);

  http.ok(res, { user: { id: result.user.id, email: result.user.email, name: result.user.name } });
});
