'use strict';
/* The address a 6-digit code was sent to, held server-side between request and verify.

   Why a cookie rather than just asking the browser to send the email again with the code:
   the pair (email, code) is what Postbase checks, so if the client supplies both, the
   client chooses which account the code is tested against. Postbase does bind each code
   to its address, so a code minted for A genuinely will not verify for B — but a flow
   where the browser names the target account is the same shape as the account-takeover
   hole the set-password route exists to avoid, and it costs almost nothing to close.

   So the address is written HttpOnly at send time and read back here at verify time. The
   browser never gets to name the account.

   Consequence, stated rather than hidden: the code must be entered in the same browser
   that asked for it. For a 6-digit code typed on a phone that is the normal case, and it
   is the same constraint as the session cookie itself. A user who switches browsers is
   told to request a new code rather than being silently failed. */

var NAME = 'pb_otp_email';
var TTL = 15 * 60;   /* long enough to fetch a code from a slow inbox, short enough to expire */

function set(res, email) {
  var v = NAME + '=' + encodeURIComponent(String(email || '')) +
    '; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=' + TTL;
  var prev = res.getHeader('Set-Cookie');
  if (!prev) res.setHeader('Set-Cookie', [v]);
  else res.setHeader('Set-Cookie', (Array.isArray(prev) ? prev : [prev]).concat([v]));
}

function clear(res) { set(res, ''); }

function read(req) {
  var raw = req.headers && req.headers.cookie;
  if (!raw) return '';
  var found = '';
  raw.split(';').forEach(function (part) {
    var i = part.indexOf('=');
    if (i < 0) return;
    if (part.slice(0, i).trim() !== NAME) return;
    try { found = decodeURIComponent(part.slice(i + 1).trim()); } catch (e) { found = part.slice(i + 1).trim(); }
  });
  return found;
}

module.exports = { set: set, clear: clear, read: read, NAME: NAME, TTL: TTL };
