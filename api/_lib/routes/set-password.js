'use strict';
var http = require('../http');
var sql = require('../sql');
var auth = require('../auth');

/* POST /api/auth?action=set-password  { password }

   THE ONE PLACE A RESET FLOW BECOMES ACCOUNT TAKEOVER, so read the shape carefully.

   The account being changed is the SESSION's account. There is deliberately no way to
   name a target: no email, no id, no user_id is read from the request, and
   sql.setUserPassword has no signature that accepts one. If a future edit adds
   `req.body.email` here, it hands anyone with a session the ability to overwrite any
   password by typing an address. The absence of that parameter is the control.

   How a user without a password gets a session in the first place: action=forgot emails
   a 6-digit code, and action=otp-verify exchanges it for a session. So by the time this
   route runs, the caller has proved they read email at that address — the same proof a
   reset link would have provided, by a mechanism that actually works on this instance.

   The password is a bound parameter all the way to Postgres, where crypt() hashes it. It
   is never interpolated into SQL, never logged, and never echoed back. */

var MIN = 6;   /* matches Postbase's own signup minimum; a stricter rule here would let a
                  user set a password at signup that they could not re-set later */

module.exports = http.guard(async function (req, res) {
  if (!http.methodAllowed(req, res, ['POST'])) return;

  /* Throws 401 if there is no valid session. No session, no reset. */
  var user = await auth.requireUser(req, res);

  var b = http.body(req);
  var password = typeof b.password === 'string' ? b.password : '';
  if (password.length < MIN) {
    return http.fail(res, 400, 'Password must be at least ' + MIN + ' characters');
  }
  if (password.length > 200) {
    /* bcrypt silently truncates past 72 bytes; refuse rather than accept a password
       whose tail does nothing. */
    return http.fail(res, 400, 'That password is too long');
  }

  await sql.setUserPassword(user.id, password);

  /* Deliberately does NOT sign the user out. They arrived here through a link, changed
     their password, and are already where they wanted to be; dropping the session would
     bounce them to a login screen to immediately type what they just set. */
  console.log('[api] password set for user ' + user.id);
  http.ok(res, { updated: true });
});
