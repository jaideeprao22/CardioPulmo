'use strict';
var http = require('../_lib/http');
var auth = require('../_lib/auth');
var sql = require('../_lib/sql');

/* GET /api/storage/audio?token=...&download=1

   Streams one recording's audio out of the bytea column.

   Three independent checks have to pass, and the token is the weakest of them:
     1. the token verifies and has not expired;
     2. the caller still has a valid session (re-derived from the cookie, not the token);
     3. that session user is the user the token was issued to;
     4. the row is then read through an owner-scoped or admin-scoped SQL function, so
        the WHERE clause itself carries the ownership constraint.
   A token lifted out of one browser therefore does nothing in another.

   The read asserts audio_bytes = octet_length(audio) and refuses to serve on mismatch,
   so a bad write surfaces as an error rather than as corruption played to a clinician.

   The Content-Type is whatever the BYTES say — see api/_lib/mime.js. Several legacy
   clips are named .wav and labelled audio/wav but are actually WebM, and serving those
   under the stored label is what breaks playback. The extension is never consulted. */
module.exports = http.guard(async function (req, res) {
  if (!http.methodAllowed(req, res, ['GET'])) return;

  var q = http.queryParams(req);
  var claim = auth.readAudioToken(q.get('token'));
  if (!claim) return http.fail(res, 403, 'This playback link has expired — reload and try again');

  var user = await auth.requireUser(req, res);
  if (claim.userId !== user.id) return http.fail(res, 403, 'This playback link is not yours');

  var admin = await auth.isAdmin(user.id);
  var audio = admin
    ? await sql.readRecordingAudioForAdmin(claim.recordingId, user.id)
    : await sql.readRecordingAudioForOwner(claim.recordingId, user.id);

  /* An admin listening to their own clip: the admin-scoped read only matches when an
     admins row exists, so fall back to the owner-scoped read rather than 404 on a
     technicality. */
  if (!audio && admin) audio = await sql.readRecordingAudioForOwner(claim.recordingId, user.id);

  if (!audio) return http.fail(res, 404, 'Audio for this recording is not stored in the app');

  res.statusCode = 200;
  res.setHeader('Content-Type', audio.mime);
  res.setHeader('Content-Length', String(audio.bytes));
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (q.get('download')) {
    res.setHeader('Content-Disposition',
      'attachment; filename="recording-' + claim.recordingId + extensionFor(audio.mime) + '"');
  }
  res.end(audio.buffer);
});

/* The download filename gets the extension the bytes earned, not the one the row was
   originally saved under. */
function extensionFor(mime) {
  return ({
    'audio/wav': '.wav',
    'audio/webm': '.webm',
    'audio/ogg': '.ogg',
    'audio/flac': '.flac',
    'audio/mp4': '.m4a',
    'audio/mpeg': '.mp3'
  })[mime] || '';
}
