'use strict';
/* Where a magic link is allowed to point.

   The link in the email carries a token that mints a session. If its host came straight
   from the request's Host header, anyone could POST to the forgot-password route with a
   forged Host and cause a real email — to the victim's real address — carrying a link to
   a site they control. The victim clicks their own legitimately-requested reset link and
   hands the token over.

   So the host is never simply trusted. It is read from the request, matched against the
   allowlist below, and replaced with the canonical production origin if it does not
   match. A rejected host is logged, because it should not happen in normal use. */

var CANONICAL = 'https://cardiopulmo.com';

function allowed(host) {
  if (!host) return false;
  var h = String(host).toLowerCase().split(':')[0];
  if (h === 'cardiopulmo.com' || h === 'www.cardiopulmo.com') return true;
  /* Preview deployments, so a reset can be exercised before it reaches production. */
  if (/^[a-z0-9-]+\.vercel\.app$/.test(h)) return true;
  if (h === 'localhost' || h === '127.0.0.1') return true;
  return false;
}

function baseUrl(req) {
  var h = (req && req.headers) || {};
  var host = h['x-forwarded-host'] || h.host || '';
  if (!allowed(host)) {
    if (host) console.warn('[api] refusing to build a link for unexpected host: ' + host);
    return CANONICAL;
  }
  var proto = h['x-forwarded-proto'] || 'https';
  if (String(host).split(':')[0] === 'localhost' || String(host).split(':')[0] === '127.0.0.1') proto = 'http';
  return proto + '://' + host;
}

/* Fixed path with the extension spelled out. Vercel serves /set-password only with
   cleanUrls enabled, and turning that on changes routing for every page in the app —
   not something a password-reset link should quietly depend on. */
function setPasswordUrl(req) { return baseUrl(req) + '/set-password.html'; }

module.exports = { baseUrl: baseUrl, setPasswordUrl: setPasswordUrl, allowed: allowed, CANONICAL: CANONICAL };
