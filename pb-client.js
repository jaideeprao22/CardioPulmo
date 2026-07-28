/* CardioPulmo — data client.
   ---------------------------------------------------------------------------
   Replaces the previous vendor browser SDK. This file holds NO database URL and NO
   key, because the browser is no longer trusted with either: Postbase does not enforce
   RLS, so a key in the browser would publish every recording to the internet.

   Everything goes to /api/* on the same origin. The session lives in HttpOnly
   cookies that this script cannot read, and row ownership is derived server-side
   from the session — never from anything sent from here.

   The call shape deliberately mirrors the small slice of the old query builder the
   app used, and every call still resolves to { data, error }, so the existing call
   sites in app.js and admin.html did not have to change shape.

   What is NOT emulated, because the semantics genuinely changed:
     - storage buckets. Audio is a bytea column on the recording row now. Uploads go
       with the row in one request; playback goes through a short-lived opaque token.
   Those call sites were rewritten rather than faked.                              */
(function (global) {
  'use strict';

  /* Every table is served by the single /api/data function, selected by `resource`.
     Fixed paths rather than /api/data/<name> so no platform rewrite sits between the
     browser and the query string the routes read. */
  var RESOURCE = {
    af_validation: 'af-validation',
    app_settings: 'app-settings',
    outcomes: 'outcomes',
    recordings: 'recordings',
    profiles: 'profiles',
    feedback: 'feedback',
    admins: 'admins'
  };

  function dataUrl(resource, params) {
    var q = '/api/data?resource=' + encodeURIComponent(resource);
    if (params) {
      Object.keys(params).forEach(function (k) {
        if (params[k] === undefined || params[k] === null) return;
        q += '&' + k + '=' + encodeURIComponent(params[k]);
      });
    }
    return q;
  }
  function authUrl(action) { return '/api/auth?action=' + encodeURIComponent(action); }

  function err(message) { return { data: null, error: { message: message } }; }

  /* Every response is { data, error }. A network failure becomes an error object
     rather than a rejected promise, so a caller can tell "did not reach the server"
     from "server said no". */
  async function request(url, options) {
    var opts = options || {};
    var init = {
      method: opts.method || 'GET',
      credentials: 'same-origin',
      headers: { 'Accept': 'application/json' }
    };
    if (opts.body !== undefined) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    var r;
    try {
      r = await fetch(url, init);
    } catch (e) {
      return err('No connection');
    }
    var payload = null;
    try { payload = await r.json(); } catch (e) { payload = null; }

    if (!r.ok) {
      var m = (payload && payload.error && payload.error.message) || ('Request failed (' + r.status + ')');
      return { data: null, error: { message: m, status: r.status } };
    }
    if (payload && Object.prototype.hasOwnProperty.call(payload, 'data')) {
      return { data: payload.data, error: null };
    }
    return { data: payload, error: null };
  }

  /* --------------------------------------------------------- query builder -- */

  function Query(table) {
    this.table = table;
    this.resource = RESOURCE[table];
    this.op = 'select';
    this.payload = null;
    this.filters = [];
    this.wantSingle = false;
  }

  /* select() is chainable and does nothing: the column list is decided server-side by
     each route's allowlist. It deliberately does NOT set op back to 'select', because
     the old `.update(...).select()` idiom would otherwise turn a write into a read. */
  Query.prototype.select = function () { return this; };
  Query.prototype.insert = function (data) { this.op = 'insert'; this.payload = data; return this; };
  Query.prototype.update = function (data) { this.op = 'update'; this.payload = data; return this; };
  Query.prototype.upsert = function (data) { this.op = 'upsert'; this.payload = data; return this; };
  Query.prototype['delete'] = function () { this.op = 'delete'; return this; };
  Query.prototype.eq = function (column, value) { this.filters.push({ column: column, value: value }); return this; };
  /* Ordering and paging are applied server-side; kept chainable so call sites are unchanged. */
  Query.prototype.order = function () { return this; };
  Query.prototype.limit = function () { return this; };
  Query.prototype.maybeSingle = function () { this.wantSingle = true; return this; };
  Query.prototype.single = function () { this.wantSingle = true; return this; };

  Query.prototype.find = function (column) {
    for (var i = 0; i < this.filters.length; i++) {
      if (this.filters[i].column === column) return this.filters[i].value;
    }
    return undefined;
  };

  Query.prototype.run = async function () {
    if (!this.resource) return err('Unknown table: ' + this.table);
    var out;

    if (this.op === 'select') {
      /* A select with no row filter is a whole-table read, which only an admin can do.
         The server decides that; asking is not the same as being allowed.
         app_settings is the exception: it is one shared row that every signed-in user
         may read, and its `.eq('id',1)` must not be read as "scope=mine". */
      if (this.table === 'app_settings') {
        return await request(dataUrl(this.resource), { method: 'GET' });
      }
      var scope = this.filters.length ? 'mine' : 'all';
      var params = { scope: scope };
      /* outcomes is the only resource that narrows by subject: the entry form shows what
         is already recorded for a code so the same result is not entered twice. It only
         narrows a scope the caller already has. */
      if (this.table === 'outcomes') {
        var subj = this.find('subject_code');
        if (subj !== undefined) params.subject_code = subj;
      }
      out = await request(dataUrl(this.resource, params), { method: 'GET' });

      if (this.table === 'admins') {
        /* The route answers a boolean about the caller and never lists other admins.
           Collapse it to a row-or-null so `!!data` still reads correctly. */
        if (out.error) return out;
        var d = out.data;
        return { data: (d && d.isAdmin) ? { user_id: d.user_id } : null, error: null };
      }
      if (this.wantSingle && !out.error && Array.isArray(out.data)) {
        return { data: out.data.length ? out.data[0] : null, error: null };
      }
      return out;
    }

    if (this.op === 'insert' || this.op === 'upsert') {
      /* Postbase's native upsert is ON CONFLICT DO NOTHING, so the server emulates
         update-on-conflict read-then-write and reads the row back to prove it landed. */
      return await request(dataUrl(this.resource), { method: 'POST', body: this.payload || {} });
    }

    if (this.op === 'update') {
      /* app_settings has one row and its own admin-only write path. */
      if (this.table === 'app_settings') {
        return await request(dataUrl(this.resource), { method: 'POST', body: this.payload || {} });
      }
      var target = this.find('id');
      return await request(dataUrl(this.resource, { id: target }), { method: 'PATCH', body: this.payload || {} });
    }

    if (this.op === 'delete') {
      var byId = this.find('id');
      if (byId !== undefined) {
        return await request(dataUrl(this.resource, { id: byId }), { method: 'DELETE' });
      }
      /* Purging a user is keyed on their id; the profiles route removes their
         recordings and profile together, admin-only. */
      var byUser = this.find('user_id');
      if (byUser !== undefined && this.table === 'profiles') {
        return await request(dataUrl('profiles', { id: byUser }), { method: 'DELETE' });
      }
      return err('Refusing to delete without a row filter');
    }

    return err('Unsupported operation');
  };

  /* Thenable, so `await pb.from(t).select(...).eq(...)` works exactly as before. */
  Query.prototype.then = function (resolve, reject) { return this.run().then(resolve, reject); };
  Query.prototype['catch'] = function (fn) { return this.run()['catch'](fn); };

  /* ------------------------------------------------------------------ auth -- */

  var listeners = [];
  var currentUser = null;

  function emit(event) {
    var session = currentUser ? { user: currentUser } : null;
    listeners.forEach(function (fn) { try { fn(event, session); } catch (e) { } });
  }

  function adopt(result, event) {
    if (result.error) return result;
    currentUser = (result.data && result.data.user) || null;
    emit(event || (currentUser ? 'SIGNED_IN' : 'SIGNED_OUT'));
    return { data: { user: currentUser, session: currentUser ? { user: currentUser } : null }, error: null };
  }

  var auth = {
    getSession: async function () {
      var r = await request(authUrl('session'), { method: 'GET' });
      if (r.error) return { data: { session: null }, error: r.error };
      currentUser = (r.data && r.data.user) || null;
      return { data: { session: currentUser ? { user: currentUser } : null }, error: null };
    },
    getUser: async function () {
      var r = await request(authUrl('session'), { method: 'GET' });
      if (r.error) return { data: { user: null }, error: r.error };
      currentUser = (r.data && r.data.user) || null;
      return { data: { user: currentUser }, error: null };
    },
    signInWithPassword: async function (creds) {
      return adopt(await request(authUrl('signin'), {
        method: 'POST', body: { email: (creds && creds.email) || '', password: (creds && creds.password) || '' }
      }), 'SIGNED_IN');
    },
    signUp: async function (creds) {
      return adopt(await request(authUrl('signup'), {
        method: 'POST', body: { email: (creds && creds.email) || '', password: (creds && creds.password) || '' }
      }), 'SIGNED_IN');
    },
    /* Google Identity Services still runs in the browser — the client ID is public and
       that is fine. The ID token is posted to our own route, which forwards it to
       Postbase with the service key. No Postbase token ever reaches this script. */
    signInWithIdToken: async function (args) {
      return adopt(await request(authUrl('google'), {
        method: 'POST', body: { credential: (args && args.token) || '', nonce: (args && args.nonce) || undefined }
      }), 'SIGNED_IN');
    },
    /* --- password reset, code sign-in, email verification ---
       Postbase has no reset endpoint; these are built on its magic-link and email-OTP
       primitives, with the actual password write done server-side against the session.
       See api/_lib/routes/set-password.js for why no target account is ever named. */

    /* Always resolves 200 for a well-formed address, whether or not it is registered —
       a different answer would let anyone test which emails have accounts. */
    forgotPassword: async function (email) {
      return await request(authUrl('forgot'), { method: 'POST', body: { email: email || '' } });
    },
    /* Sends a 6-digit code. The address is remembered server-side in an HttpOnly cookie,
       so verifyOtp below takes only the code — the browser never names the account. */
    sendOtp: async function (email) {
      return await request(authUrl('otp-send'), { method: 'POST', body: { email: email || '' } });
    },
    verifyOtp: async function (code) {
      return adopt(await request(authUrl('otp-verify'), {
        method: 'POST', body: { code: code || '' }
      }), 'SIGNED_IN');
    },
    /* Changes the password of whoever the session belongs to. There is deliberately no
       parameter for which account — that absence is what stops this being a takeover. */
    setPassword: async function (password) {
      return await request(authUrl('set-password'), { method: 'POST', body: { password: password || '' } });
    },
    sendVerificationEmail: async function () {
      return await request(authUrl('verify-email'), { method: 'POST', body: {} });
    },

    signOut: async function () {
      var r = await request(authUrl('signout'), { method: 'POST' });
      currentUser = null;
      emit('SIGNED_OUT');
      return { error: r.error || null };
    },
    onAuthStateChange: function (fn) {
      if (typeof fn === 'function') listeners.push(fn);
      return { data: { subscription: { unsubscribe: function () {
        var i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1);
      } } } };
    }
  };

  /* ----------------------------------------------------------------- audio -- */

  /* Audio is a bytea column on the recording, not an object in a bucket: Postbase
     Storage on this instance is a pointer table for an external S3 backend that is not
     configured. So there is no path, no bucket and no signed URL — a recording id and a
     short-lived same-origin token instead. */
  var audio = {
    /* Mints a playback URL. Returns an error for the legacy rows whose audio_path still
       points at the old bucket: those bytes were never brought across, so there is
       nothing to play, and saying so beats a silently broken button. */
    url: async function (recordingId) {
      var r = await request('/api/storage/sign', { method: 'POST', body: { id: recordingId } });
      if (r.error) return r;
      return { data: (r.data && r.data.url) || null, error: null };
    },
    toBase64: function (blob) {
      return new Promise(function (resolve, reject) {
        var fr = new FileReader();
        fr.onload = function () {
          var s = String(fr.result || '');
          var comma = s.indexOf(',');
          resolve(comma >= 0 ? s.slice(comma + 1) : '');
        };
        fr.onerror = function () { reject(fr.error || new Error('Could not read the clip')); };
        fr.readAsDataURL(blob);
      });
    }
  };

  global.pb = {
    from: function (table) { return new Query(table); },
    auth: auth,
    audio: audio
  };
})(window);
