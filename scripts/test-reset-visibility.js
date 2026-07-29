'use strict';
/* Does the password reset survive the SIGNED_IN event it triggers?

   THE MECHANISM, which is what this file exists to pin down:
   pb-client's verifyOtp calls adopt(..., 'SIGNED_IN'), and adopt emits SYNCHRONOUSLY —
   the listener in app.js runs before verifyOtp's promise resolves, i.e. while the handler
   that called it is still mid-flight. That listener calls sbShowApp(), which hides the
   auth overlay. The new-password fields the handler reveals a moment later are inside
   that overlay, so they are shown into a hidden ancestor: present in the DOM, correctly
   styled, unreachable on screen. To the user, "forgot password" just signs them in.

   HOW VISIBILITY IS MEASURED, and why NOT offsetParent:
   offsetParent is a LAYOUT property. jsdom performs no layout and returns null for every
   element, so `offsetParent !== null` would fail on a correctly-shown box and its inverse
   would pass on everything — a check that reports whatever you hoped for. So visibility
   here is computed structurally: walk the ancestor chain looking for display:none. That
   is the rule this bug actually turns on, and it holds in any environment.

   The old style-property assertion is KEPT alongside, asserting "shown". It passes both
   before and after the fix. That is the point: it is the proof that a style check cannot
   tell a working reset from a broken one, which is how this shipped under a green suite.

   Run:  node scripts/test-reset-visibility.js [repoRoot]

   To prove it bites: delete `if(sbUser&&pendingPasswordReset)return;` from app.js, keep
   every other line, and re-run. The visibility assertions must fail. */

var fs = require('fs');
var vm = require('vm');
var path = require('path');

var ROOT = process.argv[2] || path.join(__dirname, '..');
var src = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
var html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

var results = [];
function check(n, c, d) { results.push({ n: n, pass: !!c, d: d || '' }); }

/* ------------------------------------------------------------ tiny DOM ---- */
var els = {};
function mk(id, parent) {
  els[id] = {
    id: id, style: { display: '' }, value: '', textContent: '', disabled: false,
    parentNode: parent || null,
    classList: { add: function () {}, remove: function () {}, toggle: function () {} },
    addEventListener: function () {}, focus: function () {}
  };
  return els[id];
}

/* VISIBILITY, structurally. No layout, no offsetParent. */
function isVisible(id) {
  var n = els[id];
  if (!n) return false;
  while (n) {
    if (n.style && n.style.display === 'none') return false;
    n = n.parentNode;
  }
  return true;
}

/* The real containment, mirroring index.html: everything the reset touches lives inside
   the overlay that sbShowApp() hides. Getting this chain right is the whole test. */
var overlay = mk('authOverlay');
var card = mk('ovlcard', overlay);
['authEmail', 'authPass', 'authLogin', 'authSignup', 'authForgot', 'authMsg'
].forEach(function (id) { mk(id, card); });
var otpBox = mk('authOtpBox', card);
['authOtpCode', 'authOtpVerify', 'authOtpResend'].forEach(function (id) { mk(id, otpBox); });
var pwBox = mk('authNewPwBox', card);
['authNewPw', 'authNewPw2', 'authNewPwGo', 'authSkipPw'].forEach(function (id) { mk(id, pwBox); });
/* Outside the overlay — the app underneath it. */
['authBox', 'notLoggedBox', 'myRecCard', 'outcomeCard', 'verifyBox', 'authWho',
 'profileOverlay', 'pid'].forEach(function (id) { mk(id, null); });

/* --------------------------------------------------------------- context ---- */
var CALLS = [], SET_PASSWORD_ARGS = [], FLAG_DURING_CALL = null;
var ctx = {
  console: { log: function () {}, warn: function () {}, error: function () {} },
  setTimeout: setTimeout, clearTimeout: clearTimeout, Promise: Promise,
  Object: Object, String: String, Array: Array, JSON: JSON, Math: Math, Date: Date,
  $: function (id) { return els[id] || null; },
  document: { getElementById: function (id) { return els[id] || null; } },
  sbUser: null, pendingTab: null,
  sbShowApp: function () { CALLS.push('sbShowApp'); overlay.style.display = 'none'; },
  sbMaybeProfile: function () { CALLS.push('sbMaybeProfile'); },
  topTab: function () {}, cpSyncVerifyBox: function () {}
};
ctx.window = ctx;
vm.createContext(ctx);

function slice(a, b) {
  var i = src.search(a);
  if (i < 0) throw new Error('source not found: ' + a);
  var j = src.slice(i).search(b);
  if (j < 0) throw new Error('end not found for: ' + a);
  return src.slice(i, i + j);
}

/* The real source, lifted out of app.js — not a paraphrase of it. */
vm.runInContext(slice(/^function authMsg\(t,bad\)/m, /\nasync function authSendCode/), ctx);
vm.runInContext('var __verifyHandler = ' +
  slice(/if\(\$\('authOtpVerify'\)\)\$\('authOtpVerify'\)\.onclick=async function\(\)\{/, /\n\};/)
    .replace(/^if\(\$\('authOtpVerify'\)\)\$\('authOtpVerify'\)\.onclick=/, '') + '\n};', ctx);
vm.runInContext(slice(/^async function authSaveNewPassword\(\)\{/m, /\nif\(\$\('authNewPwGo'\)\)/), ctx);
vm.runInContext('var __listener = ' +
  slice(/sb\.auth\.onAuthStateChange\(function/, /\n  \}\);/)
    .replace(/^sb\.auth\.onAuthStateChange\(/, '') + '\n  }', ctx);

/* ---- source-level checks: the patch must have actually APPLIED ----
   A replacement that silently fails to match leaves a flag that is declared but never
   set true. The guard then never fires, the bug is live, and nothing observable at
   runtime distinguishes "never set" from "set and correctly cleared". So assert on the
   source itself. */
check('the guard exists in the listener',
      /if\(sbUser&&pendingPasswordReset\)\s*return;/.test(src), 'guard line missing');
check('the flag is ASSIGNED true, not merely declared',
      /pendingPasswordReset\s*=\s*true/.test(src), 'nothing assigns true anywhere');
check('and it is assigned BEFORE verifyOtp is awaited',
      src.indexOf('pendingPasswordReset=true') > -1 &&
      src.indexOf('pendingPasswordReset=true') < src.indexOf('await sb.auth.verifyOtp'),
      'assignment comes after the await — the listener has already run by then');
check('the Skip escape hatch exists in the markup and is wired',
      /id="authSkipPw"/.test(html) && /\$\('authSkipPw'\)\.onclick/.test(src),
      'markup or handler missing');

/* verifyOtp emits SIGNED_IN synchronously, before resolving. That ordering IS the bug,
   so the stub reproduces it rather than smoothing it over. */
function stub(result) {
  ctx.sb = {
    auth: {
      verifyOtp: async function () {
        FLAG_DURING_CALL = ctx.pendingPasswordReset;   /* the only moment it matters */
        if (!result.error) {
          ctx.sbUser = { id: 'u1', email: 'a@x.com' };
          ctx.__listener('SIGNED_IN', { user: ctx.sbUser });
        }
        return result;
      },
      setPassword: async function (p) { SET_PASSWORD_ARGS.push(p); return { error: null }; },
      signInWithPassword: async function () {
        ctx.sbUser = { id: 'u1', email: 'a@x.com' };
        ctx.__listener('SIGNED_IN', { user: ctx.sbUser });
        return { error: null };
      }
    }
  };
}

function reset() {
  Object.keys(els).forEach(function (k) { els[k].style.display = ''; });
  els.authOtpBox.style.display = 'flex';        /* where the user is when confirming */
  els.authNewPwBox.style.display = 'none';
  ctx.sbUser = null; ctx.pendingPasswordReset = false;
  CALLS.length = 0; SET_PASSWORD_ARGS.length = 0; FLAG_DURING_CALL = null;
}

(async function () {
  /* ---- 1. the reported bug ---- */
  reset(); els.authOtpCode.value = '123456'; stub({ error: null });
  await ctx.__verifyHandler.call(els.authOtpVerify);

  check('the flag was actually TRUE while verifyOtp ran',
        FLAG_DURING_CALL === true, String(FLAG_DURING_CALL));
  check('sbShowApp was NOT called mid-reset',
        CALLS.indexOf('sbShowApp') < 0, JSON.stringify(CALLS));
  check('the new-password fields are VISIBLE (ancestor chain walked for display:none)',
        isVisible('authNewPw') && isVisible('authNewPwGo'), 'an ancestor is display:none');
  check('the Skip escape hatch is reachable too',
        isVisible('authSkipPw'), 'an ancestor is display:none');
  check('the instruction is somewhere the user can actually SEE it',
        isVisible('authMsg') && /new password/i.test(els.authMsg.textContent),
        JSON.stringify(els.authMsg.textContent));
  check('the code step is put away',
        !isVisible('authOtpCode'), 'code box still showing');

  /* The weak check, kept deliberately: it says "shown" whether or not the box is
     reachable, which is exactly why it could not catch this. */
  check('[weak, kept as proof] the style property says flex — true either way',
        els.authNewPwBox.style.display === 'flex', els.authNewPwBox.style.display);

  /* ---- 2. finishing the reset hands over to the app ---- */
  els.authNewPw.value = 'newpassword'; els.authNewPw2.value = 'newpassword';
  CALLS.length = 0;
  await ctx.authSaveNewPassword();
  check('saving sends the password alone — no account is named',
        SET_PASSWORD_ARGS.length === 1 && SET_PASSWORD_ARGS[0] === 'newpassword',
        JSON.stringify(SET_PASSWORD_ARGS));
  check('the confirmation is readable before the overlay goes',
        isVisible('authMsg') && /Password saved/i.test(els.authMsg.textContent),
        JSON.stringify(els.authMsg.textContent));
  ctx.finishPasswordReset();
  check('finishing lowers the flag',
        ctx.pendingPasswordReset === false, String(ctx.pendingPasswordReset));
  check('and hands the user to the app',
        CALLS.indexOf('sbShowApp') >= 0, JSON.stringify(CALLS));

  /* ---- 3. a rejected code must not reveal the password step ---- */
  reset(); els.authOtpCode.value = '999999';
  stub({ error: { message: 'That code is wrong or has expired' } });
  await ctx.__verifyHandler.call(els.authOtpVerify);
  check('a rejected code lowers the flag again',
        ctx.pendingPasswordReset === false, String(ctx.pendingPasswordReset));
  check('a rejected code does NOT reveal the password step',
        !isVisible('authNewPw'), 'password fields visible after a bad code');
  check('and never calls set-password',
        SET_PASSWORD_ARGS.length === 0, JSON.stringify(SET_PASSWORD_ARGS));
  check('the error is visible to the user',
        isVisible('authMsg') && /wrong or has expired/.test(els.authMsg.textContent),
        JSON.stringify(els.authMsg.textContent));

  /* ---- 4. skipping never sets a password ---- */
  reset(); els.authOtpCode.value = '123456'; stub({ error: null });
  await ctx.__verifyHandler.call(els.authOtpVerify);
  CALLS.length = 0; SET_PASSWORD_ARGS.length = 0;
  ctx.finishPasswordReset();                  /* what the Skip link calls */
  check('skipping never calls set-password',
        SET_PASSWORD_ARGS.length === 0, JSON.stringify(SET_PASSWORD_ARGS));
  check('and it leaves the user in the app, still signed in',
        CALLS.indexOf('sbShowApp') >= 0 && ctx.sbUser !== null, JSON.stringify(CALLS));

  /* ---- 5. the flag must not leak into an ordinary sign-in ---- */
  reset(); stub({ error: null });
  await ctx.sb.auth.signInWithPassword({ email: 'a@x.com', password: 'p' });
  check('an ordinary password sign-in still swaps the app in',
        CALLS.indexOf('sbShowApp') >= 0, JSON.stringify(CALLS));
  check('and the overlay is hidden for it, as it should be',
        !isVisible('authEmail'), 'overlay still visible after a normal sign-in');

  /* again straight after a reset, to catch a flag that was never lowered */
  reset(); els.authOtpCode.value = '123456'; stub({ error: null });
  await ctx.__verifyHandler.call(els.authOtpVerify);
  ctx.finishPasswordReset();
  CALLS.length = 0;
  ctx.__listener('SIGNED_IN', { user: { id: 'u1' } });
  check('after a reset ends, SIGNED_IN behaves normally again',
        CALLS.indexOf('sbShowApp') >= 0, JSON.stringify(CALLS));

  var bad = results.filter(function (x) { return !x.pass; });
  results.forEach(function (x) { console.log((x.pass ? 'PASS  ' : 'FAIL  ') + x.n + (x.pass ? '' : '  <<< ' + x.d)); });
  console.log('\n' + (results.length - bad.length) + '/' + results.length + ' passed');
  process.exit(bad.length ? 1 : 0);
})().catch(function (e) { console.error('HARNESS ERROR', e); process.exit(2); });
