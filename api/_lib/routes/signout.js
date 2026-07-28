'use strict';
var http = require('../http');
var pb = require('../postbase');
var session = require('../auth');

/* POST /api/auth?action=signout
   Cookies are cleared whatever the upstream says — a failed upstream logout must not
   leave the browser believing it is still signed in. */
module.exports = http.guard(async function (req, res) {
  if (!http.methodAllowed(req, res, ['POST'])) return;

  var jar = session.parseCookies(req);
  var at = jar[session.COOKIE_AT];
  session.clearSession(res);
  if (at) await pb.signOut(at);

  http.ok(res, { signedOut: true });
});
