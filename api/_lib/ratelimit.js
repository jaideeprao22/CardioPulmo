'use strict';
/* Best-effort rate limiting.

   READ THIS BEFORE RELYING ON IT. This is an in-memory sliding window held in the
   module scope of one serverless instance. Vercel runs many instances concurrently and
   recycles them freely, so:
     - a request routed to a cold instance sees an empty window;
     - a distributed caller trivially outruns it.

   It is therefore NOT a defence against a determined attacker. What it does buy is real
   but narrow: it stops one browser, one script, or one stuck retry loop from hammering
   the mail path and burning SMTP quota or filling someone's inbox.

   Doing this properly needs a durable shared store keyed on (email, ip). The database is
   the obvious home, but that means a new table, which is out of scope here. Recorded in
   MIGRATION-PROGRESS.md as a known gap rather than left to look complete. */

var WINDOWS = Object.create(null);

/* Keep the map from growing without bound on a long-lived instance. */
var MAX_KEYS = 5000;

function prune(now) {
  var keys = Object.keys(WINDOWS);
  if (keys.length < MAX_KEYS) return;
  keys.forEach(function (k) {
    var w = WINDOWS[k];
    if (!w || !w.length || w[w.length - 1] < now - 3600000) delete WINDOWS[k];
  });
}

/* Returns { ok, retryAfter } — retryAfter in whole seconds when refused. */
function check(key, limit, windowMs) {
  var now = Date.now();
  prune(now);
  var hits = WINDOWS[key] || [];
  hits = hits.filter(function (t) { return t > now - windowMs; });
  if (hits.length >= limit) {
    var oldest = hits[0];
    WINDOWS[key] = hits;
    return { ok: false, retryAfter: Math.max(1, Math.ceil((oldest + windowMs - now) / 1000)) };
  }
  hits.push(now);
  WINDOWS[key] = hits;
  return { ok: true, retryAfter: 0 };
}

/* The client IP as Vercel reports it. x-forwarded-for is a comma-separated chain and the
   left-most entry is the original client; the platform appends, so the left-most is the
   only one worth keying on — and it is spoofable, which is another reason this is
   best-effort rather than a control. */
function clientIp(req) {
  var h = (req && req.headers) || {};
  var xff = h['x-forwarded-for'] || h['X-Forwarded-For'];
  if (xff) return String(xff).split(',')[0].trim();
  return h['x-real-ip'] || h['x-vercel-forwarded-for'] || 'unknown';
}

/* Two independent windows, and they are deliberately not the same size.

   Per ADDRESS is the tight one (3 / 15 min): it is what actually protects a mailbox from
   being flooded, and nobody legitimately needs a fourth reset link inside a quarter hour.

   Per IP is a loose backstop (30 / 15 min), and it has to be loose. This app runs in
   clinics where every device shares one connection, so an IP is a whole site, not a
   person. A tight per-IP limit does not stop an attacker — they have many addresses to
   come from — it just locks out the second nurse who forgets her password that morning.
   Punishing the shared-NAT case to slow an attacker who is not slowed is a bad trade.

   `scope` keeps unrelated operations in separate buckets, and that matters more than it
   looks. With one shared bucket, typing a 6-digit code wrong three times consumed the
   same budget as sending mail — so a user who fumbled the code could not then request a
   fresh one, and spent fifteen minutes locked out by their own typos. Sends throttle
   sends; verification attempts throttle guessing. */
function checkEmailAndIp(req, email, opts) {
  var o = opts || {};
  var scope = o.scope || 'send';
  var perEmail = check(scope + ':e:' + String(email || '').toLowerCase(),
                       o.emailLimit || 3, o.emailWindowMs || 15 * 60 * 1000);
  if (!perEmail.ok) return perEmail;
  var perIp = check(scope + ':i:' + clientIp(req), o.ipLimit || 30, o.ipWindowMs || 15 * 60 * 1000);
  return perIp;
}

module.exports = { check: check, clientIp: clientIp, checkEmailAndIp: checkEmailAndIp };
