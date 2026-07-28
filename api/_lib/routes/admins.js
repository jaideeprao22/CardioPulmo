'use strict';
var http = require('../http');
var auth = require('../auth');

/* GET /api/data?resource=admins — "am I an admin?"

   Former RLS: a user may read only their own row. So this answers a boolean about the
   caller and never exposes who else is an admin. The admin dashboard uses it to gate
   its UI; every privileged route re-checks server-side regardless, so a tampered
   front end gains nothing from lying about this. */
module.exports = http.guard(async function (req, res) {
  if (!http.methodAllowed(req, res, ['GET'])) return;
  var user = await auth.requireUser(req, res);
  var admin = await auth.isAdmin(user.id);
  http.ok(res, { user_id: admin ? user.id : null, isAdmin: admin });
});
