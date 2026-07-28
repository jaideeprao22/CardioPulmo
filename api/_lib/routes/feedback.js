'use strict';
var http = require('../http');
var pb = require('../postbase');
var auth = require('../auth');
var tables = require('../tables');

/* /api/data?resource=feedback
     GET  &scope=mine|all     own rows, or every row (admin only)
     POST                     insert own
   Former RLS: insert own; read own or admin. */
module.exports = http.guard(async function (req, res) {
  if (!http.methodAllowed(req, res, ['GET', 'POST'])) return;
  var user = await auth.requireUser(req, res);

  if (req.method === 'GET') {
    var filters = [];
    if (http.queryParams(req).get('scope') === 'all') {
      await auth.requireAdmin(user.id);
    } else {
      filters.push({ column: 'user_id', operator: 'eq', value: user.id });
    }
    var rows = await pb.query({
      operation: 'select', table: 'feedback',
      columns: tables.selectable('feedback'), filters: filters, limit: 2000
    });
    if (!Array.isArray(rows)) rows = [];
    rows.sort(function (a, b) {
      return String(b && b.created_at || '').localeCompare(String(a && a.created_at || ''));
    });
    return http.ok(res, rows);
  }

  var data = tables.pick(http.body(req), tables.WRITABLE.feedback);
  data.user_id = user.id;
  await pb.query({ operation: 'insert', table: 'feedback', data: data });
  return http.ok(res, { inserted: true });
});
