'use strict';
/* Column allowlists.

   A request body is never forwarded to Postbase. Each route rebuilds its payload from
   scratch out of these lists, so an unexpected field in a request is dropped rather than
   reaching the database — including user_id, which is always taken from the server-side
   session and never from the client.

   The bytea `audio` column is deliberately absent from every SELECTABLE list: audio is
   served only by the streaming route, never inlined into a JSON row listing.

   These lists were built from what this repository actually reads and writes, not from
   the schema. Where they disagree, see MIGRATION-PROGRESS.md — a column named here that
   does not exist would fail a whole SELECT, so nothing speculative is listed. */

function freeze(o) {
  Object.keys(o).forEach(function (k) { Object.freeze(o[k]); });
  return Object.freeze(o);
}

/* Which app a recording belongs to. `recordings` shares its lineage with a sibling app
   and `app` is the column the two were split on; every existing row here carries this
   value. Deliberately a server-side constant, never a client-supplied field. */
var APP = 'cardiopulmo';

var SELECTABLE = freeze({
  profiles: ['id', 'full_name', 'age', 'sex', 'phone', 'role', 'email', 'height', 'weight',
             'smoker', 'condition', 'symptoms', 'consent', 'consent_at', 'created_at'],
  recordings: ['id', 'user_id', 'app', 'module', 'zone', 'subject_code', 'audio_path',
               'probability', 'verdict', 'extra', 'created_at', 'audio_bytes', 'audio_mime'],
  feedback: ['id', 'user_id', 'module', 'rating', 'comment', 'context', 'subject_code', 'created_at'],
  af_validation: ['id', 'user_id', 'subject_code', 'app_af', 'rmssd_mean', 'shannon_entropy',
                  'heart_rate', 'ecg_truth', 'created_at'],
  outcomes: ['id', 'user_id', 'subject_code', 'module', 'reference_test', 'result',
             'result_detail', 'tested_on', 'notes', 'created_at', 'updated_at'],
  /* app_settings is read WITHOUT a column list — see routes/app-settings.js. This list
     is the projection applied to the row that comes back, not a request for columns. */
  app_settings: ['id', 'cardio_thr', 'murmur_thr', 'lung_thr', 'crackle_thr', 'wheeze_thr',
                 'cough_delta', 'fet_cutoff', 'sbct_cutoff', 'mpt_cutoff', 'tbcough_thr',
                 'tb_thr', 'card_thr', 'eff_thr', 'pneu_thr', 'cons_thr', 'nod_thr',
                 'ptx_thr', 'fib_thr', 'pth_thr', 'af_validation', 'beep_vol', 'updated_at'],
  admins: ['user_id']
});

/* Fields a client may supply. user_id / id ownership columns are never in these lists. */
var WRITABLE = freeze({
  profiles: ['full_name', 'age', 'sex', 'phone', 'role', 'email', 'height', 'weight',
             'smoker', 'condition', 'symptoms', 'consent', 'consent_at'],
  /* `app`, `user_id` and `audio_mime` are all absent by design: the first two are server
     constants and the third is derived from the bytes. audio_path is kept writable only
     so the legacy column can still be set; new rows leave it null because there is no
     bucket to point at. */
  recordings: ['module', 'zone', 'subject_code', 'audio_path', 'probability', 'verdict', 'extra'],
  feedback: ['module', 'rating', 'comment', 'context', 'subject_code'],
  af_validation: ['subject_code', 'app_af', 'rmssd_mean', 'shannon_entropy', 'heart_rate', 'ecg_truth'],
  /* user_id is absent by design — it is the session user, never the body. */
  outcomes: ['subject_code', 'module', 'reference_test', 'result', 'result_detail',
             'tested_on', 'notes'],
  app_settings: ['cardio_thr', 'murmur_thr', 'lung_thr', 'crackle_thr', 'wheeze_thr',
                 'cough_delta', 'fet_cutoff', 'sbct_cutoff', 'mpt_cutoff', 'tbcough_thr',
                 'tb_thr', 'card_thr', 'eff_thr', 'pneu_thr', 'cons_thr', 'nod_thr',
                 'ptx_thr', 'fib_thr', 'pth_thr', 'af_validation', 'beep_vol']
});

/* An admin editing someone else's profile may touch only these. */
var ADMIN_PROFILE_FIELDS = Object.freeze(['full_name', 'age', 'sex', 'role']);

/* Keep only allowlisted keys, and only JSON-safe scalar/object values. Anything else is
   dropped silently — the point is that nothing unreviewed can reach the database. */
function pick(source, allowed) {
  var out = {};
  if (!source || typeof source !== 'object') return out;
  allowed.forEach(function (k) {
    if (!Object.prototype.hasOwnProperty.call(source, k)) return;
    var v = source[k];
    if (v === undefined) return;
    if (v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
      out[k] = v;
      return;
    }
    /* `extra` and `context` are jsonb; accept plain objects and arrays, nothing exotic. */
    if (typeof v === 'object') {
      try { out[k] = JSON.parse(JSON.stringify(v)); } catch (e) { /* drop */ }
    }
  });
  return out;
}

function selectable(table) {
  var cols = SELECTABLE[table];
  if (!cols) throw new Error('No column allowlist for table ' + table);
  return cols.slice();
}

/* Project a row down to an allowlist, keeping only keys the row actually carries.
   Used where the read did not name its columns. */
function project(row, allowed) {
  var out = {};
  if (!row || typeof row !== 'object') return out;
  allowed.forEach(function (k) {
    if (Object.prototype.hasOwnProperty.call(row, k)) out[k] = row[k];
  });
  return out;
}

module.exports = {
  APP: APP,
  SELECTABLE: SELECTABLE,
  WRITABLE: WRITABLE,
  ADMIN_PROFILE_FIELDS: ADMIN_PROFILE_FIELDS,
  pick: pick,
  project: project,
  selectable: selectable
};
