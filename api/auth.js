'use strict';
/* /api/auth?action=<name> — one function, one module per action.
   See api/_lib/routes/. Anything not named here 404s. */
module.exports = require('./_lib/dispatch').make('action', {
  'signup':       require('./_lib/routes/signup'),
  'signin':       require('./_lib/routes/signin'),
  'google':       require('./_lib/routes/google'),
  'session':      require('./_lib/routes/session'),
  'signout':      require('./_lib/routes/signout'),
  /* Password reset, code sign-in and email verification are ACTIONS, not new files.
     Vercel Hobby caps a deployment at 12 serverless functions and a 13th fails the
     build outright; adding these here keeps the deployment at four. */
  'forgot':       require('./_lib/routes/forgot'),
  'otp-send':     require('./_lib/routes/otp-send'),
  'otp-verify':   require('./_lib/routes/otp-verify'),
  'set-password': require('./_lib/routes/set-password'),
  'verify-email': require('./_lib/routes/verify-email')
});
