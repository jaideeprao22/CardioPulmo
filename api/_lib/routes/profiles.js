'use strict';
var http = require('../http');
var pb = require('../postbase');
var sql = require('../sql');
var auth = require('../auth');
var tables = require('../tables');

/* /api/data?resource=profiles
     GET    &scope=mine|all              own row, or every row (admin only)
     PATCH  [&id=<id>]                   update own; admin may update any
     DELETE &id=<id>                     admin only — removes recordings + profile

   Former RLS: read/insert/update own row (id = userId); admin may read/update/delete any.
   The row key is always the session user unless an admin explicitly targets another id. */
module.exports = http.guard(async function (req, res) {
  if (!http.methodAllowed(req, res, ['GET', 'PATCH', 'POST', 'DELETE'])) return;
  var user = await auth.requireUser(req, res);
  var q = http.queryParams(req);

  if (req.method === 'GET') {
    if (q.get('scope') === 'all') {
      await auth.requireAdmin(user.id);
      var all = await pb.query({
        operation: 'select', table: 'profiles',
        columns: tables.selectable('profiles'), limit: 5000
      });
      return http.ok(res, Array.isArray(all) ? all : []);
    }
    var mine = await pb.query({
      operation: 'select', table: 'profiles',
      columns: tables.selectable('profiles'),
      filters: [{ column: 'id', operator: 'eq', value: user.id }],
      limit: 1
    });
    /* maybeSingle() semantics: one row or null, never an error for "not found". */
    return http.ok(res, (Array.isArray(mine) && mine.length) ? mine[0] : null);
  }

  if (req.method === 'PATCH' || req.method === 'POST') {
    var b = http.body(req);
    var targetId = q.get('id');
    var data;

    if (targetId && targetId !== user.id) {
      /* Editing someone else is an admin action, and is restricted to the four fields
         the admin dashboard actually edits. */
      await auth.requireAdmin(user.id);
      data = tables.pick(b, tables.ADMIN_PROFILE_FIELDS);
    } else {
      targetId = user.id;
      data = tables.pick(b, tables.WRITABLE.profiles);
    }
    if (!Object.keys(data).length) return http.fail(res, 400, 'Nothing to update');

    await pb.query({
      operation: 'update', table: 'profiles', data: data,
      filters: [{ column: 'id', operator: 'eq', value: targetId }]
    });
    return http.ok(res, { updated: true });
  }

  /* DELETE — the admin dashboard's "Delete data": every recording plus the profile.
     The login account itself is not touched; Postbase never lets us write auth.users. */
  var id = q.get('id');
  if (!id) return http.fail(res, 400, 'Missing profile id');
  await auth.requireAdmin(user.id);
  var counts = await sql.adminDeleteUserData(id, user.id);
  return http.ok(res, counts);
});
