'use strict';
/* /api/data?resource=<name> — one function, one module per table.
   Each handler owns its own authorisation and column allowlist; see api/_lib/routes/.
   Anything not named here 404s. */
module.exports = require('./_lib/dispatch').make('resource', {
  'recordings':    require('./_lib/routes/recordings'),
  'profiles':      require('./_lib/routes/profiles'),
  'feedback':      require('./_lib/routes/feedback'),
  'af-validation': require('./_lib/routes/af-validation'),
  'outcomes':      require('./_lib/routes/outcomes'),
  'app-settings':  require('./_lib/routes/app-settings'),
  'admins':        require('./_lib/routes/admins')
});
