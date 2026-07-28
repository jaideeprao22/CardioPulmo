'use strict';
/* Tiny HTTP helpers. Every response the browser sees is shaped { data, error } so the
   front end keeps the call shape it already had, with no call-site changes. */

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function ok(res, data) {
  json(res, 200, { data: data === undefined ? null : data, error: null });
}

/* Error bodies carry a message and nothing else. Upstream detail is logged server-side
   but never echoed, so an internal identifier can't leak through an error path. */
function fail(res, status, message) {
  json(res, status, { data: null, error: { message: message, status: status } });
}

function methodAllowed(req, res, allowed) {
  if (allowed.indexOf(req.method) >= 0) return true;
  res.setHeader('Allow', allowed.join(', '));
  fail(res, 405, 'Method not allowed');
  return false;
}

/* Vercel's Node runtime parses JSON bodies for us, but never trust that it did.
   Anything that isn't a plain object becomes an empty object, so a route can only
   ever read named fields it explicitly asks for. */
function body(req) {
  var b = req.body;
  if (b && typeof b === 'object' && !Array.isArray(b)) return b;
  if (typeof b === 'string' && b) {
    try {
      var p = JSON.parse(b);
      if (p && typeof p === 'object' && !Array.isArray(p)) return p;
    } catch (e) { /* fall through to {} */ }
  }
  return {};
}

/* Query parameters, read from the URL rather than trusting a pre-parsed helper. */
function queryParams(req) {
  try {
    return new URL(req.url, 'http://localhost').searchParams;
  } catch (e) {
    return new URLSearchParams();
  }
}

/* An unexpected throw must never degrade into a permissive path. Every route body runs
   inside this, so a failed ownership lookup surfaces as 503 and stops. */
function guard(handler) {
  return async function (req, res) {
    try {
      await handler(req, res);
    } catch (e) {
      var msg = (e && e.message) || 'Unknown server error';
      console.error('[api] ' + (req.url || '') + ' — ' + msg);
      if (!res.headersSent) {
        var status = (e && e.httpStatus) || 503;
        fail(res, status, (e && e.safeMessage) || 'Server could not complete the request');
      }
    }
  };
}

function httpError(status, safeMessage, internalMessage) {
  var e = new Error(internalMessage || safeMessage);
  e.httpStatus = status;
  e.safeMessage = safeMessage;
  return e;
}

module.exports = {
  json: json,
  ok: ok,
  fail: fail,
  methodAllowed: methodAllowed,
  body: body,
  queryParams: queryParams,
  guard: guard,
  httpError: httpError
};
