'use strict';
var http = require('../http');
var pb = require('../postbase');
var sql = require('../sql');
var auth = require('../auth');
var tables = require('../tables');
var mime = require('../mime');

/* /api/data?resource=recordings
     GET    &scope=mine|all         list (all = admin only)
     POST                           insert one, optionally with its audio
     DELETE &id=<id>                delete own; admin may delete any

   Former RLS: insert/read/delete own (user_id = userId); admin may read/delete any.
   user_id is always the session user — a user_id in the request body is ignored.

   Audio is a bytea column on this row, written in the same statement as the insert.
   Postbase Storage is a pointer table for an external S3 backend that is not configured
   on this instance, so there is no bucket and no signed URL. Playback goes through
   /api/storage/audio with a short-lived opaque token.

   Clip size ceiling: base64 inflates by 4/3 and the platform caps a request body at
   roughly 4.5 MB, so the limit below is deliberately conservative. CardioPulmo's clips
   are 16-bit mono at 2 kHz (heart) or 4 kHz (lung), so a normal recording is a few
   hundred kilobytes and nowhere near it. */

var MAX_AUDIO_BYTES = 3 * 1024 * 1024;

module.exports = http.guard(async function (req, res) {
  if (!http.methodAllowed(req, res, ['GET', 'POST', 'DELETE'])) return;
  var user = await auth.requireUser(req, res);
  var q = http.queryParams(req);

  /* ------------------------------------------------------------------ GET -- */
  if (req.method === 'GET') {
    var wantAll = q.get('scope') === 'all';
    var filters = [];
    if (wantAll) {
      await auth.requireAdmin(user.id);          /* throws 403; never degrades to own-rows */
    } else {
      filters.push({ column: 'user_id', operator: 'eq', value: user.id });
    }
    var rows = await pb.query({
      operation: 'select',
      table: 'recordings',
      columns: tables.selectable('recordings'),
      filters: filters,
      limit: 5000
    });
    return http.ok(res, sortByCreatedDesc(rows).map(shapeRow));
  }

  /* ----------------------------------------------------------------- POST -- */
  if (req.method === 'POST') {
    var b = http.body(req);
    var row = tables.pick(b, tables.WRITABLE.recordings);

    var audioB64 = typeof b.audio_base64 === 'string' ? b.audio_base64 : '';

    if (audioB64) {
      if (!/^[A-Za-z0-9+/=\r\n]+$/.test(audioB64)) {
        return http.fail(res, 400, 'Audio was not valid base64 and was not saved');
      }
      var bytes = Buffer.byteLength(audioB64, 'base64');
      if (bytes <= 0) return http.fail(res, 400, 'Audio was empty and was not saved');
      if (bytes > MAX_AUDIO_BYTES) {
        return http.fail(res, 413, 'Clip too large to upload (' + Math.round(bytes / 1024) + ' KB). Record a shorter clip.');
      }

      /* The type comes from the leading bytes, never from the client and never from a
         file name. The old uploader hardcoded `.wav` and contentType:'audio/wav' for
         every clip whatever the recorder produced, which is how WebM files ended up
         named .wav in the legacy set. Any audio_mime in the request body is ignored. */
      var sniffed = mime.sniffBase64(audioB64);
      if (!sniffed) {
        console.warn('[api] recordings: unrecognised audio container from user ' + user.id);
      }

      var made = await sql.insertRecordingWithAudio(user.id, row, audioB64, sniffed || mime.FALLBACK);
      return http.ok(res, { id: made.id, audio_bytes: made.bytes, audio_mime: sniffed || mime.FALLBACK });
    }

    /* Metadata-only rows go through the structured endpoint — no raw SQL where none
       is needed. */
    row.user_id = user.id;
    var inserted = await pb.query({ operation: 'insert', table: 'recordings', data: row });
    var first = Array.isArray(inserted) ? inserted[0] : inserted;
    return http.ok(res, { id: (first && first.id) || null, audio_bytes: 0 });
  }

  /* --------------------------------------------------------------- DELETE -- */
  var id = q.get('id');
  if (!id) return http.fail(res, 400, 'Missing recording id');

  var del = [{ column: 'id', operator: 'eq', value: id }];
  var admin = await auth.isAdmin(user.id);
  if (!admin) del.push({ column: 'user_id', operator: 'eq', value: user.id });

  await pb.query({ operation: 'delete', table: 'recordings', filters: del });
  return http.ok(res, { deleted: true });
});

/* The bytea column is never sent in a listing. `has_audio` tells the UI whether a play
   button is worth showing, which is what distinguishes a clip stored in the app from one
   of the legacy rows whose audio_path still points at the retired bucket.

   audio_mime IS returned: the admin export names each file, and naming a WebM clip
   `.wav` is the exact mistake this migration is undoing. */
function shapeRow(r) {
  var out = {};
  tables.SELECTABLE.recordings.forEach(function (c) {
    if (c === 'audio_bytes') return;
    out[c] = r[c] === undefined ? null : r[c];
  });
  out.has_audio = Number(r.audio_bytes) > 0;
  return out;
}

/* Postbase's structured endpoint has no order clause, so ordering happens here.
   The lists involved are small (hundreds of rows per user, capped above). */
function sortByCreatedDesc(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.slice().sort(function (a, b) {
    return String(b && b.created_at || '').localeCompare(String(a && a.created_at || ''));
  });
}
