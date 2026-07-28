'use strict';
/* /api/auth?action=<name> — one function, one module per action.
   See api/_lib/routes/. Anything not named here 404s. */
module.exports = require('./_lib/dispatch').make('action', {
  'signup':  require('./_lib/routes/signup'),
  'signin':  require('./_lib/routes/signin'),
  'google':  require('./_lib/routes/google'),
  'session': require('./_lib/routes/session'),
  'signout': require('./_lib/routes/signout')
});
