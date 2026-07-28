'use strict';
var http = require('../http');
var pb = require('../postbase');
var auth = require('../auth');
var tables = require('../tables');

/* /api/data?resource=app-settings
     GET    read the single settings row — every signed-in user
     POST   write it — admin only

   Former RLS: EVERY signed-in user may READ. Only an admin may INSERT or UPDATE.

   The write is an EMULATED upsert. Postbase's native upsert is ON CONFLICT DO NOTHING,
   not DO UPDATE, so porting the front end's .upsert() to it would turn every threshold
   change into a silent no-op that errors nowhere. Read first, then update or insert.

   The read deliberately does NOT name its columns. This one row carries thresholds for
   both apps sharing this lineage, and naming a column that this project's table does not
   have would fail the entire SELECT — taking every threshold down, not just the missing
   one. So: read the row whole, then project it onto the allowlist, keeping only the keys
   that came back. A write is filtered the same way against the row that exists, so a
   threshold this deployment has no column for is dropped instead of failing the save. */

var ROW_ID = 1;

async function readRow() {
  var rows = await pb.query({
    operation: 'select', table: 'app_settings',
    filters: [{ column: 'id', operator: 'eq', value: ROW_ID }],
    limit: 1
  });
  return (Array.isArray(rows) && rows.length) ? rows[0] : null;
}

module.exports = http.guard(async function (req, res) {
  if (!http.methodAllowed(req, res, ['GET', 'POST'])) return;
  var user = await auth.requireUser(req, res);

  if (req.method === 'GET') {
    var row = await readRow();
    return http.ok(res, row ? tables.project(row, tables.SELECTABLE.app_settings) : null);
  }

  await auth.requireAdmin(user.id);

  var data = tables.pick(http.body(req), tables.WRITABLE.app_settings);
  if (!Object.keys(data).length) return http.fail(res, 400, 'Nothing to save');

  var existing = await readRow();

  if (existing) {
    /* Only write columns the row demonstrably has. A key the table lacks would otherwise
       reject the whole UPDATE and lose every other threshold in the same save. */
    var dropped = [];
    Object.keys(data).forEach(function (k) {
      if (!Object.prototype.hasOwnProperty.call(existing, k)) { delete data[k]; dropped.push(k); }
    });
    if (dropped.length) {
      console.warn('[api] app_settings: ignoring column(s) not present in this project: ' + dropped.join(', '));
    }
    if (!Object.keys(data).length) return http.fail(res, 400, 'None of those settings exist in this deployment');
    if (Object.prototype.hasOwnProperty.call(existing, 'updated_at')) {
      data.updated_at = new Date().toISOString();
    }
    await pb.query({
      operation: 'update', table: 'app_settings', data: data,
      filters: [{ column: 'id', operator: 'eq', value: ROW_ID }]
    });
  } else {
    data.id = ROW_ID;
    data.updated_at = new Date().toISOString();
    await pb.query({ operation: 'insert', table: 'app_settings', data: data });
  }

  /* Read back, so the caller sees what was actually stored rather than what it sent.
     If the emulated upsert ever silently does nothing, it shows up here. */
  var after = await readRow();
  if (!after) return http.fail(res, 502, 'Settings did not save — nothing was written');
  return http.ok(res, tables.project(after, tables.SELECTABLE.app_settings));
});
