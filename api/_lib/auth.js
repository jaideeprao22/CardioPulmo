'use strict';
/* Session handling and authorisation.

   The browser never holds a database credential. The Postbase access and refresh tokens
   live in HttpOnly cookies that JavaScript cannot read, and identity is re-derived
   server-side on every request from GET /user — never from anything the client sent.

   Postbase does not enforce RLS, so this file is where the old Supabase policies now
   live, as explicit checks:
     isAdmin(userId)  ==  a row exists in admins where user_id = userId
     profiles      read/insert/update own (id = userId); admin may read/update/delete any
     recordings    insert/read/delete own (user_id = userId); admin may read/delete any
     feedback      insert own; read own or admin
     af_validation insert own; read own or admin
     app_settings  every signed-in user may READ; only an admin may INSERT or UPDATE
     admins        a user may read only their own row */

var crypto = require('crypto');
var pb = require('./postbase');
var envMod = require('./env');
var httpError = require('./http').httpError;

var AT = 'pb_at';
var RT = 'pb_rt';

/* ------------------------------------------------------------- cookies ---- */

function parseCookies(req) {
  var out = {};
  var raw = req.headers && req.headers.cookie;
  if (!raw) return out;
  raw.split(';').forEach(function (part) {
    var i = part.indexOf('=');
    if (i < 0) return;
    var k = part.slice(0, i).trim();
    var v = part.slice(i + 1).trim();
    if (k) { try { out[k] = decodeURIComponent(v); } catch (e) { out[k] = v; } }
  });
  return out;
}

function cookie(name, value, maxAgeSec) {
  var bits = [
    name + '=' + encodeURIComponent(value),
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Lax'
  ];
  bits.push('Max-Age=' + Math.max(0, Math.floor(maxAgeSec)));
  return bits.join('; ');
}

function append(res, value) {
  var prev = res.getHeader('Set-Cookie');
  if (!prev) res.setHeader('Set-Cookie', [value]);
  else res.setHeader('Set-Cookie', (Array.isArray(prev) ? prev : [prev]).concat([value]));
}

var AT_MAX = 60 * 60 * 12;        /* 12h — refreshed opportunistically below */
var RT_MAX = 60 * 60 * 24 * 30;   /* 30d */

/* A session write must never clear the refresh token by accident: GET /session omits
   refreshToken entirely, so `null` here means "leave what is stored alone". */
function setSession(res, session) {
  if (!session || !session.accessToken) {
    throw httpError(502, 'Sign-in failed', 'setSession called without an accessToken');
  }
  append(res, cookie(AT, session.accessToken, AT_MAX));
  if (session.refreshToken) append(res, cookie(RT, session.refreshToken, RT_MAX));
}

function clearSession(res) {
  append(res, cookie(AT, '', 0));
  append(res, cookie(RT, '', 0));
}

/* ------------------------------------------------------------ identity ---- */

/* Resolve the signed-in user, refreshing once if the access token has expired.
   Anything other than a clean 401 propagates as 503 — an ownership lookup that fails
   for an unexpected reason must stop the request, never fall through to a default. */
async function currentUser(req, res) {
  var jar = parseCookies(req);
  var at = jar[AT];
  var rt = jar[RT];

  if (at) {
    try {
      return await pb.getUser(at);
    } catch (e) {
      var status = e && (e.upstreamStatus || e.httpStatus);
      if (status !== 401 && status !== 403) throw e;   /* fail loudly, do not degrade */
    }
  }

  if (!rt) return null;

  var renewed;
  try {
    renewed = await pb.refresh(rt);
  } catch (e) {
    var s2 = e && (e.upstreamStatus || e.httpStatus);
    if (s2 === 401 || s2 === 403 || s2 === 400) { clearSession(res); return null; }
    throw e;
  }
  setSession(res, renewed.session);
  return await pb.getUser(renewed.session.accessToken);
}

/* Every data route starts here. Returns a user or throws 401 — never null-and-continue. */
async function requireUser(req, res) {
  var u = await currentUser(req, res);
  if (!u || !u.id) throw httpError(401, 'Not signed in');
  return u;
}

/* ----------------------------------------------------------- authorise ---- */

/* Replaces the old is_admin(), which read auth.uid() and cannot exist here.
   A lookup failure throws; it never resolves to false, because a false on an error
   path is a guess about authorisation. */
async function isAdmin(userId) {
  if (!userId) throw httpError(500, 'Server error', 'isAdmin called without a user id');
  var rows;
  try {
    rows = await pb.query({
      operation: 'select',
      table: 'admins',
      columns: ['user_id'],
      filters: [{ column: 'user_id', operator: 'eq', value: userId }],
      limit: 1
    });
  } catch (e) {
    throw httpError(503, 'Could not verify your permissions', 'admins lookup failed: ' + ((e && e.message) || e));
  }
  return Array.isArray(rows) && rows.length > 0;
}

async function requireAdmin(userId) {
  var yes = await isAdmin(userId);
  if (!yes) throw httpError(403, 'Admin only');
  return true;
}

/* --------------------------------------------------- audio access token ---- */

/* There is no createSignedUrl on this instance and inventing a public URL scheme is
   not an option, so playback uses an opaque, expiring, per-recording token bound to the
   user it was issued to. The stream route re-checks ownership on redemption as well —
   the token narrows access, it never grants it. */
function audioToken(recordingId, userId, ttlSec) {
  var exp = Math.floor(Date.now() / 1000) + (ttlSec || 3600);
  var payload = String(recordingId) + '.' + String(userId) + '.' + exp;
  var sig = crypto.createHmac('sha256', envMod.env().serviceKey).update(payload).digest('base64url');
  return Buffer.from(payload, 'utf8').toString('base64url') + '.' + sig;
}

function readAudioToken(token) {
  if (!token || typeof token !== 'string') return null;
  var dot = token.lastIndexOf('.');
  if (dot < 1) return null;
  var body = token.slice(0, dot);
  var sig = token.slice(dot + 1);
  var payload;
  try { payload = Buffer.from(body, 'base64url').toString('utf8'); } catch (e) { return null; }

  var expect = crypto.createHmac('sha256', envMod.env().serviceKey).update(payload).digest('base64url');
  var a = Buffer.from(sig);
  var b = Buffer.from(expect);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  var parts = payload.split('.');
  if (parts.length !== 3) return null;
  var exp = parseInt(parts[2], 10);
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return null;
  return { recordingId: parts[0], userId: parts[1], exp: exp };
}

module.exports = {
  parseCookies: parseCookies,
  setSession: setSession,
  clearSession: clearSession,
  currentUser: currentUser,
  requireUser: requireUser,
  isAdmin: isAdmin,
  requireAdmin: requireAdmin,
  audioToken: audioToken,
  readAudioToken: readAudioToken,
  COOKIE_AT: AT,
  COOKIE_RT: RT
};
