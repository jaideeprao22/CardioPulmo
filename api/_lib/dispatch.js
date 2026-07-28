'use strict';
/* Dispatcher.

   Why this exists: Vercel's Hobby plan caps a deployment at 12 serverless functions and
   one file per route came to well over that. Each route still keeps its own module under
   _lib/routes/ with its own authorisation and column allowlist; a single function per
   group forwards to it. This deployment ships four functions in total:
   /api/auth, /api/data, /api/storage/sign, /api/storage/audio.

   Why a query parameter and not /api/data/[resource]: a dynamic segment makes Vercel
   emit a rewrite (`/api/data/[resource]?resource=$1`), and whether the original
   `?scope=` and `?id=` survive that rewrite is a platform detail this migration would
   have to assume rather than know. A fixed path with a normal query parameter has no
   rewrite and no ambiguity — the query string arrives exactly as the browser sent it.
   Getting `scope` wrong would silently downgrade an admin view; getting `id` wrong would
   break deletes. Neither is worth an assumption.

   The name is looked up in a hardcoded table and never used to build a path or a
   require(), so a crafted value cannot reach anything not listed by the caller. */

var http = require('./http');

function make(paramName, table) {
  var allowed = Object.create(null);
  Object.keys(table).forEach(function (k) { allowed[k] = table[k]; });

  return function (req, res) {
    var name = (http.queryParams(req).get(paramName) || '').toLowerCase();
    var handler = Object.prototype.hasOwnProperty.call(allowed, name) ? allowed[name] : null;
    if (typeof handler !== 'function') {
      return http.fail(res, 404, 'Unknown endpoint');
    }
    return handler(req, res);
  };
}

module.exports = { make: make };
