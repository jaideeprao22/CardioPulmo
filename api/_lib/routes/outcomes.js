'use strict';
var http = require('../http');
var pb = require('../postbase');
var auth = require('../auth');
var tables = require('../tables');

/* /api/data?resource=outcomes
     GET    &scope=mine|all     own rows, or every row (admin only)
     POST                       insert own
     PATCH  &id=<id>            update own; admin may update any
     DELETE &id=<id>            delete own; admin may delete any

   Ground truth. A recording carries what the app thought; a row here carries what a
   reference test actually found. The join between them is the only thing that makes any
   of the stored audio trainable, so this route is deliberately stricter than the others
   about what it will accept.

   Policy shape matches af_validation — insert own, read own or admin — extended with
   update and delete, because an outcome gets corrected when a lab result is revised, and
   a mistyped one has to be removable. user_id is the session user and is never read from
   the body.

   NOTHING here backfills. The existing clips stay unlabelled until a human enters a real
   result; an invented outcome is worse than an absent one. */

/* `result` is the label a model would eventually train against, so it is a closed
   vocabulary enforced here rather than trusted from the browser. A free-text label
   column is how a corpus quietly becomes unusable. */
var RESULTS = Object.freeze(['positive', 'negative', 'indeterminate']);

/* `reference_test` is descriptive metadata, not the label. The UI offers a fixed list so
   the common cases stay canonical, but it is NOT enforced as a closed set: a test this
   list has not heard of turning up in the field should not need a deploy to record.
   Trimmed and length-capped, nothing more. */
var MAX_TEST = 80;
var MAX_DETAIL = 500;
var MAX_NOTES = 1000;
var MAX_SUBJECT = 60;

function clean(v, max) {
  if (typeof v !== 'string') return '';
  return v.trim().slice(0, max);
}

/* tested_on is a DATE column. A malformed string would surface as an opaque upstream
   error, so it is checked here and reported in terms the person typing it can act on. */
function validDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  var d = new Date(s + 'T00:00:00Z');
  if (!(d instanceof Date) || isNaN(d.getTime())) return false;
  return d.toISOString().slice(0, 10) === s;   /* rejects 2026-02-31 and friends */
}

module.exports = http.guard(async function (req, res) {
  if (!http.methodAllowed(req, res, ['GET', 'POST', 'PATCH', 'DELETE'])) return;
  var user = await auth.requireUser(req, res);
  var q = http.queryParams(req);

  /* ------------------------------------------------------------------ GET -- */
  if (req.method === 'GET') {
    var filters = [];
    if (q.get('scope') === 'all') {
      await auth.requireAdmin(user.id);
    } else {
      filters.push({ column: 'user_id', operator: 'eq', value: user.id });
    }
    /* Narrowing to one subject is a convenience for the entry form, which shows what is
       already recorded so the same result is not entered twice. It only ever narrows a
       scope the caller was already entitled to. */
    var subject = clean(q.get('subject_code'), MAX_SUBJECT);
    if (subject) filters.push({ column: 'subject_code', operator: 'eq', value: subject });

    var rows = await pb.query({
      operation: 'select', table: 'outcomes',
      columns: tables.selectable('outcomes'), filters: filters, limit: 5000
    });
    if (!Array.isArray(rows)) rows = [];
    rows.sort(function (a, b) {
      return String(b && b.created_at || '').localeCompare(String(a && a.created_at || ''));
    });
    return http.ok(res, rows);
  }

  /* --------------------------------------------------------------- DELETE -- */
  if (req.method === 'DELETE') {
    var delId = q.get('id');
    if (!delId) return http.fail(res, 400, 'Missing outcome id');
    var del = [{ column: 'id', operator: 'eq', value: delId }];
    if (!(await auth.isAdmin(user.id))) del.push({ column: 'user_id', operator: 'eq', value: user.id });
    await pb.query({ operation: 'delete', table: 'outcomes', filters: del });
    return http.ok(res, { deleted: true });
  }

  /* -------------------------------------------------------- POST / PATCH -- */
  var b = http.body(req);
  var data = tables.pick(b, tables.WRITABLE.outcomes);

  /* Normalise before validating, so trailing whitespace never creates a second
     "U001 " that will not join to anything. */
  if (data.subject_code !== undefined) data.subject_code = clean(data.subject_code, MAX_SUBJECT);
  if (data.reference_test !== undefined) data.reference_test = clean(data.reference_test, MAX_TEST);
  if (data.result !== undefined) data.result = clean(data.result, 40).toLowerCase();
  if (data.result_detail !== undefined) data.result_detail = clean(data.result_detail, MAX_DETAIL) || null;
  if (data.notes !== undefined) data.notes = clean(data.notes, MAX_NOTES) || null;
  if (data.module !== undefined) data.module = clean(data.module, 60) || null;
  if (data.tested_on !== undefined) {
    var td = clean(data.tested_on, 10);
    if (!td) data.tested_on = null;
    else if (!validDate(td)) return http.fail(res, 400, 'Enter the test date as YYYY-MM-DD');
    else data.tested_on = td;
  }

  if (data.result !== undefined && RESULTS.indexOf(data.result) < 0) {
    return http.fail(res, 400, 'Result must be one of: ' + RESULTS.join(', '));
  }

  if (req.method === 'POST') {
    /* All three are NOT NULL in the schema. Checking here turns an opaque upstream
       constraint error into something the person entering the result can fix. */
    if (!data.subject_code) return http.fail(res, 400, 'Enter the subject code this result belongs to');
    if (!data.reference_test) return http.fail(res, 400, 'Choose which reference test was done');
    if (!data.result) return http.fail(res, 400, 'Choose the result');

    data.user_id = user.id;
    await pb.query({ operation: 'insert', table: 'outcomes', data: data });
    return http.ok(res, { inserted: true });
  }

  /* PATCH */
  var id = q.get('id');
  if (!id) return http.fail(res, 400, 'Missing outcome id');
  if (!Object.keys(data).length) return http.fail(res, 400, 'Nothing to update');
  /* An empty string would violate NOT NULL; treat clearing a required field as an error
     rather than letting the update fail upstream. */
  if (data.subject_code === '') return http.fail(res, 400, 'Subject code cannot be blank');
  if (data.reference_test === '') return http.fail(res, 400, 'Reference test cannot be blank');
  if (data.result === '') return http.fail(res, 400, 'Result cannot be blank');

  data.updated_at = new Date().toISOString();

  var upd = [{ column: 'id', operator: 'eq', value: id }];
  if (!(await auth.isAdmin(user.id))) upd.push({ column: 'user_id', operator: 'eq', value: user.id });
  await pb.query({ operation: 'update', table: 'outcomes', data: data, filters: upd });
  return http.ok(res, { updated: true });
});

module.exports.RESULTS = RESULTS;
