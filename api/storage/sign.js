'use strict';
var http = require('../_lib/http');
var auth = require('../_lib/auth');
var pb = require('../_lib/postbase');

/* POST /api/storage/sign  { id }  ->  { token, url, expiresIn }

   The replacement for createSignedUrl(). There is no signed-URL facility on this
   instance and inventing a public URL scheme is not an option, so this mints a short
   opaque token bound to (recording, user, expiry) and hands back a same-origin URL.

   The token narrows access; it does not grant it. /api/storage/audio re-derives the
   session user and re-checks ownership on redemption, so a leaked token is useless in
   another browser. */

var TTL = 3600;

module.exports = http.guard(async function (req, res) {
  if (!http.methodAllowed(req, res, ['POST'])) return;
  var user = await auth.requireUser(req, res);

  var id = http.body(req).id;
  if (!id) return http.fail(res, 400, 'Missing recording id');
  id = String(id);

  /* Confirm the row is readable by this caller before minting anything. */
  var admin = await auth.isAdmin(user.id);
  var filters = [{ column: 'id', operator: 'eq', value: id }];
  if (!admin) filters.push({ column: 'user_id', operator: 'eq', value: user.id });

  var rows = await pb.query({
    operation: 'select', table: 'recordings',
    columns: ['id', 'audio_bytes'], filters: filters, limit: 1
  });
  if (!Array.isArray(rows) || !rows.length) return http.fail(res, 404, 'Recording not found');
  if (!(Number(rows[0].audio_bytes) > 0)) {
    /* One of the legacy rows: audio_path still points at the old bucket and the bytes
       were never brought across. Say so plainly instead of handing back a token that
       streams nothing. There is deliberately no fallback fetch to the old bucket. */
    return http.fail(res, 404, 'Audio for this recording is not stored in the app');
  }

  var token = auth.audioToken(id, user.id, TTL);
  http.ok(res, {
    token: token,
    url: '/api/storage/audio?token=' + encodeURIComponent(token),
    expiresIn: TTL
  });
});
