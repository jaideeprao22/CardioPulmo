'use strict';
/* PRIVATE raw-SQL module.
   ------------------------------------------------------------------------------
   /api/db/sql bypasses every application-side check, so the runner below is not
   exported and nothing outside this file can reach it. What IS exported is one
   narrowly-typed function per job.

   Rules this file holds itself to:
     - Every function that touches user data takes an ownerUserId (or an adminUserId
       proven against the admins table inside the statement) and binds it into the
       WHERE clause as a parameter. There is deliberately no exported signature that
       can read or write unscoped.
     - Identifiers cannot be parameterised, so table names come only from the frozen
       allowlist below. No identifier is ever interpolated from a request.
     - current_schema() is already the project schema; no schema is ever named here. */

var envMod = require('./env');
var httpError = require('./http').httpError;
var mime = require('./mime');

/* Identifier allowlist. Interpolating anything not from this set is a bug. */
var TABLES = Object.freeze({
  recordings: 'recordings',
  admins: 'admins',
  profiles: 'profiles',
  users: 'users'
});

var TIMEOUT_MS = 20000;

/* --- the runner. Not exported. Not callable from any other module. --- */
async function run(query, params) {
  var e = envMod.env();
  var ctl = new AbortController();
  var timer = setTimeout(function () { ctl.abort(); }, TIMEOUT_MS);
  var r;
  try {
    r = await fetch(e.url + '/api/db/sql', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + e.serviceKey,
        'X-Project-ID': e.projectId,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({ query: query, params: params || [] }),
      signal: ctl.signal
    });
  } catch (err) {
    throw httpError(503, 'Could not reach the database', 'sql fetch failed: ' + ((err && err.message) || err));
  } finally {
    clearTimeout(timer);
  }

  var text = await r.text();
  var parsed = null;
  if (text) { try { parsed = JSON.parse(text); } catch (err) { parsed = null; } }

  if (!r.ok) {
    var m = (parsed && (parsed.error || parsed.message)) || ('HTTP ' + r.status);
    if (m && typeof m === 'object') m = m.message || JSON.stringify(m);
    /* The raw statement is never echoed to the client. */
    throw httpError(502, 'Database request failed', 'sql ' + r.status + ': ' + String(m));
  }

  if (Array.isArray(parsed)) return parsed;
  if (parsed && Array.isArray(parsed.rows)) return parsed.rows;
  if (parsed && Array.isArray(parsed.data)) return parsed.data;
  if (parsed && parsed.data && Array.isArray(parsed.data.rows)) return parsed.data.rows;
  return [];
}

/* ------------------------------------------------------------------ audio ---- */
/* Audio lives in Postgres as bytea. Postbase Storage is a pointer table for an external
   S3-compatible backend and no backend is configured on this instance, so there is no
   object store to write to and no createSignedUrl equivalent to call. */

/* INSERT a recording and its audio in ONE statement.
   Doing this as insert-then-update would leave a window where a dropped connection
   commits the row but not the clip — and a retry from the UI would then insert a
   duplicate. One statement means a retry either finds nothing committed or everything
   committed. The column list is fixed and every value is bound, so nothing is
   interpolated.

   The trap this guards against: passing a base64 STRING through the structured
   /api/db/query endpoint stores the base64 TEXT, not the bytes. The tell is
   octet_length(audio) coming back at exactly 4/3 of the true file size, with the leading
   bytes reading as ASCII instead of the file's magic number. Hence decode($n,'base64')
   here, and the RETURNING clause that re-reads octet_length so a bad write is caught at
   write time rather than at some clinician's playback. */
async function insertRecordingWithAudio(ownerUserId, row, base64, mimeType) {
  if (!ownerUserId) throw httpError(500, 'Server error', 'insertRecordingWithAudio requires an owner');
  var bytes = Buffer.byteLength(base64, 'base64');
  var rows = await run(
    'INSERT INTO ' + TABLES.recordings +
    ' (user_id, app, module, zone, subject_code, audio_path, probability, verdict, extra,' +
    '  audio, audio_bytes, audio_mime)' +
    ' VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,decode($10,\'base64\'),$11,$12)' +
    ' RETURNING id, audio_bytes, octet_length(audio) AS actual_bytes',
    [
      ownerUserId,
      /* Never taken from a request body — the caller sets it from a fixed constant. */
      row.app || null,
      row.module || null,
      row.zone || null,
      row.subject_code || null,
      row.audio_path || null,
      row.probability == null ? null : row.probability,
      row.verdict || null,
      row.extra == null ? null : JSON.stringify(row.extra),
      base64, bytes, mimeType || null
    ]
  );
  if (!rows.length) throw httpError(502, 'Recording could not be saved', 'insert returned no row');

  var declared = Number(rows[0].audio_bytes);
  var actual = Number(rows[0].actual_bytes);
  if (!Number.isFinite(actual) || actual !== declared) {
    /* Remove the row rather than leave a clip that will not decode. */
    try {
      await run('DELETE FROM ' + TABLES.recordings + ' WHERE id = $1 AND user_id = $2', [rows[0].id, ownerUserId]);
    } catch (e) { /* the integrity error below is the one that matters */ }
    throw httpError(500, 'Audio failed to store correctly and was not kept',
      'octet_length mismatch on insert: declared=' + declared + ' actual=' + actual);
  }
  return { id: rows[0].id, bytes: actual };
}

/* Attach audio to a recording that already exists. Same decode() rule, same
   write-time integrity check. */
async function writeRecordingAudio(recordingId, ownerUserId, base64, mimeType) {
  if (!recordingId || !ownerUserId) throw httpError(500, 'Server error', 'writeRecordingAudio requires id and owner');
  var rows = await run(
    'UPDATE ' + TABLES.recordings + ' SET audio = decode($1, \'base64\'), audio_bytes = $2, audio_mime = $3 ' +
    'WHERE id = $4 AND user_id = $5 ' +
    'RETURNING id, audio_bytes, octet_length(audio) AS actual_bytes',
    [base64, Buffer.byteLength(base64, 'base64'), mimeType || null, recordingId, ownerUserId]
  );
  if (!rows.length) {
    throw httpError(404, 'Recording not found', 'audio write matched no row owned by this user');
  }
  var declared = Number(rows[0].audio_bytes);
  var actual = Number(rows[0].actual_bytes);
  if (!Number.isFinite(actual) || actual !== declared) {
    throw httpError(500, 'Audio failed to store correctly and was not kept',
      'octet_length mismatch after write: declared=' + declared + ' actual=' + actual);
  }
  return { bytes: actual };
}

/* READ, owner-scoped. Returns base64 out of Postgres via encode() so the payload is a
   plain JSON string rather than whatever the driver would make of a raw bytea. */
async function readRecordingAudioForOwner(recordingId, ownerUserId) {
  if (!recordingId || !ownerUserId) throw httpError(500, 'Server error', 'readRecordingAudioForOwner requires id and owner');
  var rows = await run(
    'SELECT id, audio_mime, audio_bytes, octet_length(audio) AS actual_bytes, ' +
    'encode(audio, \'base64\') AS audio_b64 ' +
    'FROM ' + TABLES.recordings + ' WHERE id = $1 AND user_id = $2 LIMIT 1',
    [recordingId, ownerUserId]
  );
  return verifyAudioRow(rows);
}

/* READ, admin-scoped. Admin-ness is proven inside the statement against the admins
   table as a bound parameter, so this signature still cannot read unscoped: if $2 is
   not an admin the EXISTS fails and no row comes back. */
async function readRecordingAudioForAdmin(recordingId, adminUserId) {
  if (!recordingId || !adminUserId) throw httpError(500, 'Server error', 'readRecordingAudioForAdmin requires id and admin');
  var rows = await run(
    'SELECT r.id, r.audio_mime, r.audio_bytes, octet_length(r.audio) AS actual_bytes, ' +
    'encode(r.audio, \'base64\') AS audio_b64 ' +
    'FROM ' + TABLES.recordings + ' r ' +
    'WHERE r.id = $1 AND EXISTS (SELECT 1 FROM ' + TABLES.admins + ' a WHERE a.user_id = $2) LIMIT 1',
    [recordingId, adminUserId]
  );
  return verifyAudioRow(rows);
}

/* Refuse to serve on mismatch, so a bad write fails loudly here instead of streaming
   corruption to a clinician.

   The type is then re-derived from the bytes. The stored audio_mime is treated as a
   hint, not as truth: the legacy rows were named and labelled `.wav`/audio/wav by an
   uploader that hardcoded both, and some of those files are WebM. Serving a WebM stream
   as audio/wav is what breaks playback, so where the bytes disagree with the label the
   bytes win. */
function verifyAudioRow(rows) {
  if (!rows.length) return null;
  var row = rows[0];
  if (!row.audio_b64) return null;                 /* row exists, no local audio (legacy) */
  var declared = Number(row.audio_bytes);
  var actual = Number(row.actual_bytes);
  if (!Number.isFinite(actual) || !Number.isFinite(declared) || actual !== declared) {
    throw httpError(500, 'This recording failed its integrity check and was not served',
      'octet_length mismatch on read: declared=' + declared + ' actual=' + actual);
  }
  var buf = Buffer.from(row.audio_b64, 'base64');
  if (buf.length !== actual) {
    throw httpError(500, 'This recording failed its integrity check and was not served',
      'decoded length ' + buf.length + ' != octet_length ' + actual);
  }

  var stored = row.audio_mime || null;
  var sniffed = mime.sniff(buf);
  if (sniffed && stored && sniffed !== stored) {
    console.warn('[api] recording ' + row.id + ': stored mime ' + stored + ' but bytes are ' + sniffed + ' — serving ' + sniffed);
  }
  return {
    buffer: buf,
    mime: sniffed || stored || mime.FALLBACK,
    bytes: actual
  };
}

/* --------------------------------------------------------------- admin ops ---- */

/* Delete every recording and the profile for one user. Admin-only: admin-ness is proven
   inside each statement, so a non-admin caller deletes nothing. */
async function adminDeleteUserData(targetUserId, adminUserId) {
  if (!targetUserId || !adminUserId) throw httpError(500, 'Server error', 'adminDeleteUserData requires both ids');
  var recs = await run(
    'DELETE FROM ' + TABLES.recordings + ' WHERE user_id = $1 ' +
    'AND EXISTS (SELECT 1 FROM ' + TABLES.admins + ' a WHERE a.user_id = $2) RETURNING id',
    [targetUserId, adminUserId]
  );
  var profs = await run(
    'DELETE FROM ' + TABLES.profiles + ' WHERE id = $1 ' +
    'AND EXISTS (SELECT 1 FROM ' + TABLES.admins + ' a WHERE a.user_id = $2) RETURNING id',
    [targetUserId, adminUserId]
  );
  return { recordings: recs.length, profiles: profs.length };
}

/* ----------------------------------------------------------- user lookup ---- */

/* Find an account by address, and return THE ADDRESS AS STORED.

   This gate exists because Postbase's /otp auto-creates a user row for any address it
   has not seen — it selects by email and INSERTs when absent. Calling it from an
   unauthenticated route turns that route into an open account-creation endpoint: POST a
   thousand addresses at "forgot password", get a thousand rows in `users`.

   Two halves, and BOTH are needed:

   1. The lookup is case-INSENSITIVE. An exact match would answer "no such user" for a
      real account stored as `Foo@bar.com` when the owner types `foo@bar.com`, silently
      stopping their reset from ever being sent.

   2. It returns the stored `email` column, and that — never the typed string — is what
      the caller forwards to /otp. Postbase matches EXACTLY. Finding the account
      case-insensitively and then handing Postbase the user's raw input is worse than
      having no gate at all: it locates the real account, then makes Postbase create a
      duplicate row for the differently-cased address and mail the code to the empty one,
      so the person is reset into an account that has none of their data.

   Returning the id alone would make (2) impossible to get right at the call site, which
   is why this returns the row rather than a boolean. */
async function findUserByEmail(email) {
  if (!email) return null;
  var rows = await run(
    'SELECT id, email FROM ' + TABLES.users + ' WHERE lower(email) = lower($1) LIMIT 1',
    [String(email)]
  );
  if (!rows.length) return null;
  if (!rows[0].email) {
    /* A row with no address cannot be mailed, and forwarding the typed string instead is
       the duplicate-creating mistake above. Refuse rather than improvise. */
    console.error('[api] user ' + rows[0].id + ' has no email column value; not forwarding');
    return null;
  }
  return { id: rows[0].id, email: rows[0].email };
}

/* ------------------------------------------------------------- password ---- */

/* Set the password for ONE user, identified only by an id the caller proved out of a
   session. Postbase has no password-reset endpoint — zero occurrences of reset, forgot or
   recover anywhere in its source — so this is the whole mechanism.

   Three things this signature enforces by construction:
     - There is no variant that takes an email, so a reset can never be pointed at an
       account by naming it. The id must come from a verified session.
     - The password is a BOUND PARAMETER. It is never interpolated, never logged, never
       returned. crypt()/gen_salt() run server-side in Postgres, so the plaintext exists
       only in the parameter array for the life of the statement.
     - RETURNING id proves a row was actually updated. Without it, an id that matches
       nothing succeeds silently and the user is told their password changed when it did
       not — which would lock them out of their own account with a cheerful message.

   pgcrypto is already installed on this database; bf/10 matches what Postbase itself
   writes at signup, so a password set here verifies through the normal /token path. */
async function setUserPassword(userId, plaintext) {
  if (!userId) throw httpError(500, 'Server error', 'setUserPassword requires a user id');
  if (typeof plaintext !== 'string' || !plaintext) {
    throw httpError(500, 'Server error', 'setUserPassword requires a password');
  }
  var rows = await run(
    'UPDATE ' + TABLES.users + ' SET password_hash = crypt($1, gen_salt(\'bf\', 10)), ' +
    'updated_at = now() WHERE id = $2 RETURNING id',
    [plaintext, userId]
  );
  if (!rows.length) {
    throw httpError(404, 'Could not update that account', 'password update matched no user row');
  }
  return { id: rows[0].id };
}

module.exports = {
  findUserByEmail: findUserByEmail,
  setUserPassword: setUserPassword,
  insertRecordingWithAudio: insertRecordingWithAudio,
  writeRecordingAudio: writeRecordingAudio,
  readRecordingAudioForOwner: readRecordingAudioForOwner,
  readRecordingAudioForAdmin: readRecordingAudioForAdmin,
  adminDeleteUserData: adminDeleteUserData
};
