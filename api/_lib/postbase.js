'use strict';
/* Postbase transport: auth endpoints and the structured /api/db/query endpoint.
   The raw SQL endpoint deliberately lives elsewhere (./sql.js) and is not reachable
   from here.

   Contract notes that cost previous migrations real time:
     - `Authorization: Bearer <key>` is ALWAYS the SERVICE KEY, never a user JWT.
       A user's identity travels in `X-Postbase-Token`.
     - The `apikey` and `X-API-Key` headers are ignored by this instance (confirmed).
     - Responses are camelCase: accessToken / refreshToken / expiresAt / metadata.
       There is no access_token, no user_metadata.
     - `grant_type` goes in the BODY. As a query parameter it is rejected.
     - GET /session omits refreshToken entirely.
     - Native upsert is ON CONFLICT DO NOTHING, so anything needing update-on-conflict
       is emulated read-then-write by the caller.
     - There is no /magiclink and no /recover, so this instance has no password reset. */

var envMod = require('./env');
var httpError = require('./http').httpError;

var TIMEOUT_MS = 15000;

function authBase() {
  var e = envMod.env();
  return e.url + '/api/auth/v1/' + e.projectId;
}

async function call(path, opts) {
  var e = envMod.env();
  var o = opts || {};
  var headers = {
    'Authorization': 'Bearer ' + e.serviceKey,
    'Accept': 'application/json'
  };
  if (o.body !== undefined) headers['Content-Type'] = 'application/json';
  if (o.projectHeader) headers['X-Project-ID'] = e.projectId;
  /* Only ever attach a user token we obtained ourselves from a cookie. */
  if (o.userToken) headers['X-Postbase-Token'] = o.userToken;

  var ctl = new AbortController();
  var timer = setTimeout(function () { ctl.abort(); }, TIMEOUT_MS);
  var r;
  try {
    r = await fetch(path, {
      method: o.method || 'POST',
      headers: headers,
      body: o.body === undefined ? undefined : JSON.stringify(o.body),
      signal: ctl.signal
    });
  } catch (err) {
    throw httpError(503, 'Could not reach the database', 'fetch failed: ' + ((err && err.message) || err));
  } finally {
    clearTimeout(timer);
  }

  var text = await r.text();
  var parsed = null;
  if (text) {
    try { parsed = JSON.parse(text); } catch (err) { parsed = null; }
  }

  if (!r.ok) {
    var m = (parsed && (parsed.error || parsed.message)) || ('HTTP ' + r.status);
    if (m && typeof m === 'object') m = m.message || JSON.stringify(m);
    var err2 = httpError(r.status === 401 || r.status === 403 ? r.status : 502, String(m),
      'postbase ' + r.status + ': ' + String(m));
    err2.upstreamStatus = r.status;
    throw err2;
  }
  return parsed;
}

/* ---------------------------------------------------------------- auth ---- */

/* Postbase answers in camelCase. Reading the snake_case name would yield undefined and
   deploy cleanly while breaking every sign-in, so read camelCase, tolerate snake_case,
   and throw loudly when a token is genuinely absent rather than returning undefined. */
function readSession(payload, where) {
  var s = payload && payload.session;
  if (!s || typeof s !== 'object') {
    throw httpError(502, 'Sign-in failed', where + ': response contained no session object');
  }
  var accessToken = s.accessToken || s.access_token;
  if (!accessToken || typeof accessToken !== 'string') {
    throw httpError(502, 'Sign-in failed', where + ': session carried no accessToken');
  }
  /* GET /session omits refreshToken. Undefined here means "unchanged", never "clear it" —
     the caller must not overwrite a stored refresh token with undefined. */
  var refreshToken = s.refreshToken || s.refresh_token;
  return {
    accessToken: accessToken,
    refreshToken: (typeof refreshToken === 'string' && refreshToken) ? refreshToken : null,
    expiresAt: s.expiresAt || s.expires_at || null
  };
}

function readUser(payload, where) {
  var u = (payload && (payload.user || (payload.session && payload.session.user))) || null;
  if (!u || typeof u !== 'object' || !u.id) {
    throw httpError(502, 'Sign-in failed', where + ': response contained no user id');
  }
  return {
    id: String(u.id),
    email: u.email || null,
    name: u.name || null,
    emailVerified: u.emailVerified === undefined ? null : u.emailVerified
  };
}

async function signUp(email, password, data) {
  var payload = await call(authBase() + '/signup', {
    body: data ? { email: email, password: password, data: data }
               : { email: email, password: password }
  });
  return { user: readUser(payload, 'signup'), session: readSession(payload, 'signup') };
}

async function signInPassword(email, password) {
  /* grant_type MUST be in the body — as ?grant_type= it is rejected. */
  var payload = await call(authBase() + '/token', {
    body: { grant_type: 'password', email: email, password: password }
  });
  return { user: readUser(payload, 'token/password'), session: readSession(payload, 'token/password') };
}

async function refresh(refreshToken) {
  var payload = await call(authBase() + '/token', {
    body: { grant_type: 'refresh_token', refresh_token: refreshToken, refreshToken: refreshToken }
  });
  return { user: readUser(payload, 'token/refresh'), session: readSession(payload, 'token/refresh') };
}

/* Google: the browser gets an ID token from GSI and posts it to our own route; we
   forward it here with the service key. The browser never receives a Postbase token.
   Postbase links the identity ON CONFLICT (provider, provider_account_id) DO NOTHING,
   so a returning Google user resolves to their existing row. */
async function signInGoogleIdToken(idToken, nonce) {
  var b = { provider: 'google', id_token: idToken };
  if (nonce) b.nonce = nonce;
  var payload = await call(authBase() + '/oauth/id-token', { body: b });
  return { user: readUser(payload, 'oauth/id-token'), session: readSession(payload, 'oauth/id-token') };
}

/* Identity resolution. GET /session on this instance returns 200 {"session":null} with
   no key and with a garbage token — it fails OPEN, so a 200 from it proves nothing.
   GET /user fails closed with 401, so all server-side identity is derived from here. */
async function getUser(userToken) {
  var payload = await call(authBase() + '/user', { method: 'GET', userToken: userToken });
  var u = payload && payload.user;
  if (!u || !u.id) throw httpError(401, 'Not signed in', 'user endpoint returned no id');
  return {
    id: String(u.id),
    email: u.email || null,
    name: u.name || null,
    image: u.image || null,
    emailVerified: u.emailVerified === undefined ? null : u.emailVerified,
    metadata: u.metadata || null,
    createdAt: u.createdAt || null
  };
}

async function signOut(userToken) {
  try {
    await call(authBase() + '/logout', { userToken: userToken });
  } catch (e) {
    /* The cookies are cleared regardless; a failed upstream logout must not leave the
       browser believing it is still signed in. */
    console.error('[api] logout upstream failed: ' + ((e && e.message) || e));
  }
}

/* ------------------------------------------------------------ db/query ---- */

/* Structured query. The filter field is `operator` — `op` returns a generic 400.
   Callers build the descriptor from validated, allowlisted parts only; a request body
   is never forwarded here.

   `columns` is optional: omitting it reads every column of the row. app-settings uses
   that deliberately — see routes/app-settings.js. */
async function query(spec) {
  var e = envMod.env();
  var b = { operation: spec.operation, table: spec.table };
  if (spec.columns && spec.columns.length) b.columns = spec.columns;
  if (spec.filters && spec.filters.length) {
    b.filters = spec.filters.map(function (f) {
      return { column: f.column, operator: f.operator, value: f.value };
    });
  }
  if (spec.data) b.data = spec.data;
  if (spec.limit != null) b.limit = spec.limit;
  if (spec.offset != null) b.offset = spec.offset;

  var payload = await call(e.url + '/api/db/query', { body: b, projectHeader: true, userToken: spec.userToken });
  if (payload && Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload.data)) return payload.data;
  if (payload && payload.data !== undefined && payload.data !== null) return payload.data;
  return [];
}

module.exports = {
  signUp: signUp,
  signInPassword: signInPassword,
  signInGoogleIdToken: signInGoogleIdToken,
  refresh: refresh,
  getUser: getUser,
  signOut: signOut,
  query: query,
  _call: call
};
