# CardioPulmo — Supabase → Postbase migration

Postbase project `95926c3a-ff76-4a9c-91af-a1fbf0443124`, schema
`proj_95926c3aff764a9c91afa1fbf0443124`. The database was migrated and verified
separately; nothing in this change touches schema or data.

The app is still a static PWA. No framework, no build step, no bundler — `index.html`
and `admin.html` load plain scripts, exactly as before.

---

## The one thing that changed everything

**Postbase does not enforce RLS.** Under Supabase, the anon key in `app.js` was safe
because every table carried a policy. Here it would not be: a key in the browser reads
all 107 recordings and all 8 profiles from anyone's dev tools.

So the browser now holds **no database credential at all**. `pb-client.js` contains no
URL and no key. Every call goes to `/api/*` on this origin, the session lives in
HttpOnly cookies the page cannot read, and each former RLS policy is re-implemented as
an explicit server-side check.

Where the old policy lived → where it lives now (`api/_lib/auth.js` header lists all):

| Table | Former RLS | Now |
|---|---|---|
| `profiles` | read/insert/update own; admin any | `routes/profiles.js` — key is the session user unless an admin targets another id |
| `recordings` | insert/read/delete own; admin read/delete any | `routes/recordings.js` — `scope=all` calls `requireAdmin` |
| `feedback` | insert own; read own or admin | `routes/feedback.js` |
| `af_validation` | insert own; read own or admin | `routes/af-validation.js` |
| `outcomes` | (new table) | `routes/outcomes.js` — insert own; read own or admin; update/delete own or admin |
| `app_settings` | any signed-in user reads; admin writes | `routes/app-settings.js` |
| `admins` | read only own row | `routes/admins.js` — answers a boolean about the caller, never lists admins |
| `is_admin()` | SQL function on `auth.uid()` | `auth.isAdmin()` — a lookup against `admins`; throws on failure, never returns `false` on an error path |
| `handle_new_user()` | trigger on `auth.users` | `profile.ensureProfile()` — runs at signup and again on every session read, so a pre-migration account is repaired on next visit |

There are no foreign keys to `auth.users` and existing rows carry orphaned `user_id`
values from the old Supabase users. That is expected and nothing tries to repair it.

## Four serverless functions

Vercel Hobby caps a deployment at 12. One file per route came to well over that, so
routes are dispatched by query parameter from four entry points:

```
api/auth.js            → /api/auth?action=signup|signin|google|session|signout|
                                          forgot|otp-send|otp-verify|set-password|verify-email
api/data.js            → /api/data?resource=recordings|profiles|feedback|af-validation|
                                          outcomes|app-settings|admins
api/storage/sign.js    → mints a playback token
api/storage/audio.js   → streams the bytes
```

`api/_lib/**` is not a function (Vercel skips underscore-prefixed paths). Each route
keeps its own module with its own authorisation and column allowlist.

Fixed paths, not `/api/data/[resource]`: a dynamic segment makes Vercel emit a rewrite,
and whether `?scope=` and `?id=` survive it is a platform detail this migration would
have to assume. Getting `scope` wrong silently downgrades an admin view; getting `id`
wrong breaks deletes. `vercel.json` keeps `{"regions": ["bom1"]}` — the file did not
exist in this repo and was added.

## Audio

Postbase Storage is a pointer table for an external S3 backend, and no backend is
configured on this instance — there is no bucket to write to and no `createSignedUrl`
to call. Audio is a `bytea` column on the recording row (`audio`, `audio_bytes`,
`audio_mime`, all already present).

- **Write** goes through `/api/db/sql` with `decode($10,'base64')`. Writing base64
  through the structured `/api/db/query` endpoint stores the base64 **text**; the tell
  is `octet_length` at exactly 4/3 of the true size. The insert's `RETURNING` clause
  re-reads `octet_length` and deletes the row if it disagrees, so a bad write fails at
  write time rather than at a clinician's playback.
- **Row and clip are written in one statement**, so a dropped connection cannot commit
  the row without the audio and a retry cannot produce a duplicate.
- **Read** asserts `audio_bytes = octet_length(audio)` and refuses to serve on mismatch.
- **Playback** is a short-lived opaque HMAC token bound to (recording, user, expiry).
  The token narrows access, it does not grant it: `/api/storage/audio` re-derives the
  session from the cookie, checks it matches the token's user, and then reads through an
  owner-scoped or admin-scoped statement whose `WHERE` clause carries the constraint. A
  token lifted into another browser does nothing.

### MIME comes from the bytes, never the file name

The old uploader hardcoded `path + '.wav'` and `contentType:'audio/wav'` for every clip
regardless of what the recorder produced. That is how, in the sibling app's files, two
recordings named `*.wav` turned out to hold `1a45dfa3` — WebM.

Checked since: **this app's own 107 files are all genuine WAV**, so the mislabel does not
appear in this dataset. That does not make the rule optional. The uploader that produced
it was this one, the sibling app's clips were made by the same code, and the admin ZIP
export here was still naming every file `.wav` on the way out — so the mechanism was
live in this repo even though the symptom happened to land in the other dataset.

`api/_lib/mime.js` sniffs magic bytes (`1a45dfa3` → `audio/webm`, `RIFF` → `audio/wav`,
plus Ogg / FLAC / MP4 / MPEG). It is applied in three places:

1. **On write** — the client's `audio_mime` is not in the writable allowlist at all and
   is ignored; the type is derived from the leading bytes.
2. **On read** — the stored `audio_mime` is treated as a hint. Where the bytes disagree,
   the bytes win and the mismatch is logged. This is what makes a legacy row imported
   as `audio/wav` but holding WebM actually play.
3. **On download and export** — the filename extension comes from the sniffed type. The
   admin ZIP export used to name every file `.wav`, which is the mistake being undone.

The 107 legacy files were loaded into `bytea` separately, before this change. Verified
state of that load: **107/107 with `audio_bytes = octet_length(audio)`, 107/107 with a
RIFF header matching `audio/wav`, 0 rows missing bytes.** So CardioPulmo's own files are
all genuine WAV — the `.wav`-named-but-actually-WebM clips are in the sibling app's set,
not this one.

The read-path rule still earns its keep for that cross-app case, and more importantly the
export fix removes the mechanism rather than the symptom. `audio_path` is left intact,
rows with no bytes are treated as audio-unavailable (`has_audio: false` — they still
list, they just carry "no audio" instead of a broken play button; there are none today,
but the path is exercised by the test suite), and there is **no fallback fetch to the old
Supabase bucket**.

## Cough acoustic (`tbcough`) — the module that never saved

Separate from the migration, found while tracing a reported bug and fixed here.

CardioPulmo's `tbStopRec()` had **no save call at all**. The WAV it built had one
consumer — the `FormData` posted to the Hugging Face inference endpoint — and once the
result card rendered, the function returned and the audio was discarded. That is why
`recordings` holds zero rows with `module='tbcough'` across the app's entire history,
Supabase era included: not a migration regression, not a mislabel, not an API or auth
problem. The browser never had code that could issue the write.

For comparison, in the same file `pcStopRec` reaches `uploadRecording('cardioscope',…)`
and `lgStopRec` reaches `uploadRecording('pulmoscope',…)`. Those were the only two
modules wired to the save path; cough acoustic is now the third.

The sibling app's equivalent routes through an offline queue (`cpStoreOpus` →
`cpQueueUpload`). **None of that infrastructure exists here** — CardioPulmo has no
offline queue — so the fix uses this repo's own path, `uploadRecording`, exactly as the
heart and lung modules do.

Three decisions carried across from the sibling implementation, each for a reason:

- **Stored before inference, and independently of it.** The HF Space going to sleep is a
  routine state in this module — there is a wake link in the UI for it. A sleeping Space
  must not cost a clip. This also matches what `pcUploadSafe` already does for
  cardioscope, which saves even on `processing_error` with a null probability.
- **16 kHz (`TBC_SR`, the model's native rate) and NOT peak-normalised** —
  `makeSmallWav`, not `makeSmallWavNorm`. Normalising at capture destroys device-gain
  information irreversibly; it can be done at train time, but it cannot be undone.
- **No probability and no verdict are written.** Those are the model's own output. A
  pseudo-label stored in the column that means "the answer" is how a model gets retrained
  on its own bias. `extra` carries provenance only — `dur_sec`, `sr`, `codec`,
  `normalised` — never a prediction.

### Resolved: ground truth now has a home

That gap is closed by the `outcomes` table and `/api/data?resource=outcomes`. See
**Ground truth (`outcomes`)** below. Cough clips are still saved without a pseudo-label;
the label now comes from a human entering a real reference-test result.

### Deliberately not saving audio — do not "fix" these

Percussion and the measurement modules (cough counter, resp rate, FET, breath count, MPT)
do not save audio. **This is a product decision, not an oversight**: they keep a scalar —
a rate, a count, a number of seconds — and the audio is an intermediate. Storing it would
cost storage for no analytical gain.

`lungtype` (`ltStopRec`) is **also deliberately left not saving**, and this one is worth
spelling out because it does not look like the others. It is structurally identical to
cough acoustic — an acoustic classifier with a probability, an offline TF.js fallback and
a threshold verdict — so a reader comparing the two will reasonably conclude that
`ltStopRec` is the same bug that `tbStopRec` was. It is not. It was reviewed alongside the
cough fix and deliberately left as is.

If lung-type clips are ever wanted, wiring them up is the same one-call change made for
cough acoustic. Until someone asks for that, leave it alone.


## Ground truth (`outcomes`)

A recording stores what the app thought. An `outcomes` row stores what a reference test
actually found. The join between them is the only thing that makes any of the stored
audio trainable.

Route: `/api/data?resource=outcomes` — GET (`scope=mine|all`), POST, PATCH, DELETE.
Policy shape follows `af_validation` — insert own, read own or admin — extended with
update and delete (own or admin), because a lab result gets revised and a mistyped entry
has to be removable. `user_id` is the session user and is not in the writable allowlist,
the same rule as `app` on recordings.

Two validation decisions, deliberately asymmetric:

- **`result` is a closed vocabulary** — `positive` / `negative` / `indeterminate` —
  enforced server-side, not merely offered as a `<select>`. This is the column a model
  would eventually train against, and a free-text label column is how a corpus quietly
  becomes unusable.
- **`reference_test` is NOT a closed set.** The entry form offers a fixed list so the
  common cases stay canonical, but the server only trims and length-caps it. A reference
  test this list has not heard of turning up in the field should not need a deploy to
  record.

`subject_code`, `reference_test` and `result` are `NOT NULL` in the schema and are checked
in the route as well, so a missing one reads as "Choose which reference test was done"
rather than an opaque upstream constraint error. `tested_on` is validated as a real
calendar date — `2026-02-31` is refused.

### The join key is (user_id, subject_code) — never subject_code alone

Subject codes are generated from a **per-device counter** (`cp_pid_counter` in
localStorage → `U001`, `U002`, …). `U001` therefore exists for every user who has ever run
the app. Joining on the code by itself would attach one clinician's lab result to another
clinician's recording — silently, and in the direction that produces a confidently wrong
training label.

So `admin.html` indexes outcomes on `user_id + subject_code`, and the CSV export joins on
that pair. Where a subject has several outcomes, an outcome recorded against the
recording's own `module` wins; otherwise the most recent module-agnostic one is used, and
`outcomes_on_record` reports how many exist so a reader can tell when a single column is
hiding several results. A recording with no outcome for **its own** user gets empty
outcome columns, never a stranger's.

The dashboard shows a "With a confirmed result" count, so how much of the corpus is
actually labelled is visible without exporting anything.

### Entry UI

In the About tab, under "Record a confirmed result", next to the recordings dashboard.
The subject code is **prefilled from the code currently on screen** and follows the "new
patient" button — hand-typing the code is the easiest way to orphan a result from the
recordings it belongs to, so the prefill is the main correctness feature. Reference test,
result and module are `<select>`s; the date defaults to today. Saving clears only the
answer fields and keeps the subject and date, because entering several reference tests for
one person in a sitting is the normal case. What is already recorded for that code is
listed underneath so the same result is not entered twice.

### Nothing is backfilled

The 107 existing clips stay unlabelled. No outcome is inferred, defaulted, or created for
them. A row appears in `outcomes` only because a person typed a real result.

## Known and accepted: thresholds fall back silently

`loadThresholds()` wraps its read in `try{}catch(e){}` and only assigns when a row comes
back. If `/api/data?resource=app-settings` fails — say the transient upstream 404s that
surfaced as 502s around 19:13 on 2026-07-28 — the device keeps its compiled-in defaults
(`PC_THR` 0.25, `TBC_THR` 0.40, …) **with no message and nothing in the console**. Any
device that started up in that window scored with default thresholds rather than the
admin's configured values, and nothing said so.

`postbase.call()` and `sql.run()` also have **no retry** — a single fetch with a timeout —
so one transient upstream blip becomes a user-visible failure.

**Both are known and accepted.** They were reviewed, the trade-off was understood, and the
decision was to leave them. Recorded here so a future reader does not mistake either for
an oversight and "fix" it without knowing it was a choice. If that decision is ever
revisited, the shape would be: bounded retry with jitter on idempotent reads only, never
on writes (a timeout is ambiguous about whether an insert landed), plus surfacing the
threshold-read failure instead of swallowing it.

## Fixed in passing: the CSV export was never line-separated

`buildCsv()` ended with `lines.join('\\n')` — a literal backslash-n, not a newline. Every
"Metadata CSV" download and every `labels.csv` inside the training ZIP was therefore a
**single line** with two-character `\n` sequences between rows.

This is present in the first commit of `admin.html` and predates the migration entirely.
It was found while testing the outcome join, and fixed here because the CSV is precisely
the artefact that now carries that join — an export that cannot be parsed does not deliver
ground truth to anything. The same double-escape in the dialog strings (users saw a literal
`\n` in confirm/alert boxes) is fixed with it; same cause, cosmetic rather than data loss.

## Other contract differences handled

- Responses are camelCase — `accessToken` / `refreshToken` / `expiresAt` / `metadata`.
  Reading `access_token` would yield `undefined`, deploy cleanly, and break every
  sign-in. `postbase.js` reads camelCase and throws loudly when a token is truly absent.
- `grant_type` goes in the **body**; as a query parameter it is rejected.
- `Authorization: Bearer` is always the **service key**; a user's identity travels in
  `X-Postbase-Token`. `apikey` / `X-API-Key` are ignored by this instance.
- Filter field is `operator`, not `op`.
- Native upsert is `ON CONFLICT DO NOTHING`, not `DO UPDATE`. Porting the admin
  dashboard's `.upsert()` to it would have made every threshold change a silent no-op.
  `routes/app-settings.js` emulates it read-then-write and reads the row back.
- `GET /session` **fails open** on this instance — 200 `{"session":null}` with no key and
  with a garbage token. Nothing derives identity from it; `GET /user` fails closed with
  401 and is the only source.
- `GET /session` omits `refreshToken`, so `null` means "leave the stored one alone",
  never "clear it".
- Google sign-in posts the GSI credential to `/api/auth?action=google`, which forwards it
  to `/oauth/id-token` with the service key. Same client ID
  `533637534015-8eob9q94fecugvf6d4rm41hnc1fd6f4u`. The browser never receives a Postbase
  token. **There is no environment variable behind this route** — the client ID is a
  public constant in `app.js`, and the one Postbase verifies against lives in its own
  `provider_configs`. Nothing server-side reads `GOOGLE_CLIENT_ID`; setting one has no
  effect. See "Do not assert a cause you have not established" below.
- **Password reset now exists** — built, not found. See "Password reset, code sign-in
  and email verification" below. The signup message still says nothing about a
  confirmation email, because `/signup` still sends none; it no longer says the password
  cannot be reset from
  the app, and the admin dashboard's "Add user" text says the same.

## Do not assert a cause you have not established

The Google route used to answer any 401 or 403 from Postbase's `/oauth/id-token` with:

> Google sign-in is not enabled for this app yet — use email and password

and a **503**. Both halves were wrong, and the combination cost hours of production
debugging.

A 401 there has at least two causes, and the far more common one is a bad or expired
credential. Posting `{"credential":"invalid.token.here"}` — a string that is not even a
JWT — produced that exact message. Read literally it says the provider is misconfigured,
so the natural response is to go checking `provider_configs`, Vercel environment
variables, and redeploys with the build cache off. None of which could have helped,
because nothing was broken: a real browser sign-in with a genuine ID token had succeeded
earlier the same day, on the same deployment, with no `GOOGLE_CLIENT_ID` set anywhere.
Valid token → 200. Garbage token → 401 upstream → misleading message.

The 503 compounded it by claiming the server was unavailable, a claim the code had no
basis for.

Worse, the branch `return`ed without logging, so `http.guard`'s `console.error` never ran
and the upstream status and body were discarded. **The failure left no trace at all**,
which is why there was nothing to diagnose from and the search moved to configuration.

What it does now:

- **Logs** the upstream status, the parsed message, and the raw body
  (`err.upstreamBody`, added to `postbase.js` for exactly this — the parsed message
  degrades to `"HTTP 401"` when the body is not JSON in the shape expected, and that is
  precisely the case where the real reason matters). The credential is deliberately not
  logged: it is a user's Google ID token.
- **Passes the upstream status through** — 401 stays 401.
- **Asserts no cause**: "Google sign-in failed — try again, or use email and password."

A sharper message is deliberately deferred until a real log line shows whether Postbase
distinguishes "provider disabled" from "credential rejected" in its response body. Until
that is known, the honest message is the vague one.

The general rule, worth keeping: an error message that names a cause is a claim. If the
code cannot tell two causes apart it must not pick one — it should log what it saw and say
only what it knows. A confidently wrong error message is more expensive than a vague one,
because it is trusted.

## Password reset, code sign-in and email verification

Postbase has **no** password-reset endpoint — no reset, forgot or recover anywhere in its
source. So this is built out of the two primitives it does have, and the password write is
ours.

Five new **actions on the existing `/api/auth` function**, not new files. Vercel Hobby caps
a deployment at 12 serverless functions and a 13th fails the build outright with no useful
error; the deployment stays at **4**.

| Action | Does |
|---|---|
| `forgot` | `POST /otp {type:"magic_link", redirectTo:.../set-password.html}` |
| `otp-send` | `POST /otp {type:"otp"}` — 6-digit code |
| `otp-verify` | `POST /email-otp/verify {email, code}` → session |
| `set-password` | the password write, scoped to the session |
| `verify-email` | `POST /otp {type:"magic_link"}` for a signed-in user |

The magic link **is** the email verification: Postbase's `/verify` consumes the token,
stamps `email_verified`, issues a session and redirects. So a password reset verifies the
address as a side effect, and `verify-email` is the same call pointed at `/`.

### Where this becomes account takeover, and what stops it

`set-password` changes **the session's** account. There is no email, no id, no user_id read
from the request, and `sql.setUserPassword(userId, plaintext)` has no signature that
accepts one. If a later edit adds `req.body.email` here, anyone with a session can
overwrite any password by typing an address. **The absence of that parameter is the
control**, which is why the route and the SQL helper both say so in comments and the test
suite posts `email`, `user_id`, `id` and `userId` at it and asserts none reach the
statement.

The password is a bound parameter to `crypt($1, gen_salt('bf',10))`. Never interpolated,
never logged, never echoed. `RETURNING id` proves a row was updated — without it an id
matching nothing succeeds silently and the user is told their password changed when it did
not, locking them out with a cheerful message.

### Enumeration

`forgot` and `otp-send` return a byte-identical 200 whether or not the address is
registered. An upstream "user not found" is swallowed into that 200 and logged. The UI
copy matches: "if that address has an account, a link is on its way" — never "sent".

The two *configuration* failures are not hidden and not merged: 403 means that provider row
is disabled, 500 means SMTP is unset. Different fixes, different messages, logged
distinctly. Neither reveals anything about who is registered. (Collapsing two causes into
one message is the mistake documented in "Do not assert a cause you have not established".)

### The magic link's host is not taken from the request

A link that mints a session must not point wherever a forged `Host` header says. The host
is matched against an allowlist — `cardiopulmo.com`, `*.vercel.app` for previews,
localhost — and anything else falls back to the canonical origin, logged. Without this,
anyone could trigger a real email to a victim's real address carrying a link to a site they
control.

`redirectTo` names `/set-password.html` explicitly rather than `/set-password`, because the
clean URL would depend on Vercel's `cleanUrls`, and turning that on changes routing for
every page in the app. Not something a reset link should quietly rest on.

### The 6-digit code path keeps the address server-side

`otp-send` writes the address to a short-lived HttpOnly cookie; `otp-verify` reads it from
there and takes only the code from the browser. Postbase does bind each code to its
address, so this is belt-and-braces — but a flow where the client names the target account
is the same shape as the takeover hole above, and closing it costs nothing.

The consequence is stated rather than hidden: the code must be entered in the browser that
requested it. For a code typed on a phone that is the normal case, and it is the same
constraint the session cookie already has. A user who switches browsers is told to request
a new code.

### Rate limiting is best-effort, and here is exactly how

In-memory, per serverless instance. Vercel runs many instances and recycles them, so a cold
instance starts empty and a distributed caller outruns it. It stops one browser, one
script, or one stuck retry loop from burning SMTP quota — it is **not** a control against a
determined attacker. Doing it properly needs a durable shared store, which means a table,
which is out of scope here. **Known gap, deliberately not papered over.**

Two design points the test suite forced out, both real:

- **Per-IP has to be loose** (30 / 15 min) while per-address is tight (3 / 15 min). This
  app runs in clinics where every device shares one connection, so an IP is a site, not a
  person. A tight per-IP limit does not stop an attacker — they have many source addresses
  — it just locks out the second nurse who forgets her password that morning.
- **Sends and verification attempts need separate buckets.** Sharing one meant three
  mistyped codes consumed the mail budget, so a user who fumbled the code could not request
  a fresh one and sat locked out for fifteen minutes by their own typos.

### Confirmed from source, not from a live probe

`POST /email-otp/verify` takes `{ email, code, remember_me? }` with `code` exactly 6
characters, answering `{ user, session }` like `/token`. That is read from the Postbase
source (`apps/web/src/app/api/auth/v1/[projectId]/email-otp/verify/route.ts`), **not** from
a call against the live instance — no credentials were available where this was written.
If the deployed build differs, it surfaces as a 400 with the upstream body logged, which is
why `otp-verify` logs `err.upstreamBody`.

## Grep report

Run over the whole repo, excluding `.git`:

| Pattern | Whole repo | Front end |
|---|---|---|
| `supabase` | 2 | **0** |
| `service_role` | 0 | 0 |
| `pb_anon` | 0 | 0 |
| `pb_service` | 0 | 0 |
| `db.clinoble.com` | 0 | 0 |
| `createClient` | 0 | 0 |
| `SB_ANON` / `SB_URL` | 0 | 0 |

The two remaining `supabase` hits are both server-side comments explaining what the
migration replaced (`api/_lib/auth.js`, `api/_lib/profile.js`). The anon JWT and project
URL are gone from `app.js` and `admin.html`.

## Verified

Harness of 53 assertions against a stubbed Postbase (authorisation, ownership, token
replay, integrity, MIME):

- unauthenticated → 401; unknown resource → 404
- `scope=all` → 403 for a non-admin on recordings, af_validation, profiles
- `scope=mine` returns only the caller's rows
- `user_id` and `id` in a request body are ignored; the session user is bound instead
- insert uses `decode($10,'base64')` and declares the true byte length
- both insert paths stamp `app='cardiopulmo'`, and a client-supplied `app` is ignored
- a 4/3 `octet_length` mismatch refuses to serve
- a row labelled `audio/wav` holding WebM bytes is served as `audio/webm`
- a playback token replayed by another user → 403; a tampered token → 403
- `sign` refuses a legacy row with no stored bytes rather than handing back a dead token
- non-admin `app_settings` read → 200, write → 403, and the row is unchanged after
- an `app_settings` column a deployment does not have is dropped, and the rest of the
  save still lands
- `tb-track` and `v_tb_training_set` do not exist as routes

Syntax-checked: all 24 `api/**` modules, `pb-client.js`, `app.js`, and every inline
`<script>` in `index.html` and `admin.html`.

## Where the brief and the repo disagreed — repo won

Four things, flagged rather than coded around. All four were since checked against the
live schema; two were errors in the brief, and the two that were real are now fixed.

1. **`vercel.json` did not exist here.** The brief said to keep
   `{"regions":["bom1"]}`; there was no such file in this repo. Created with exactly
   that content.

2. **`app_settings` columns — resolved: all six exist, nothing removed.** The repo
   reads and writes `cough_delta`, `fet_cutoff`, `sbct_cutoff`, `mpt_cutoff`,
   `tbcough_thr` and `tb_thr` in addition to the cardio-side thresholds. Checked against
   the live schema: **all six are present and the id=1 row has real values in every one**
   (`cough_delta` 0.15, `fet_cutoff` 6, `sbct_cutoff` 25, `mpt_cutoff` 10,
   `tbcough_thr` 0.6, `tb_thr` 0.5, `af_validation` false). `app_settings` is a shared
   row carrying both apps' thresholds. Nothing is writing into the void; every admin
   input stays.

   `routes/app-settings.js` still **reads the row without naming any columns** and
   projects onto the allowlist, and still drops absent columns on write. That is not
   load-bearing today, but naming a column the table lacks would fail the whole `SELECT`
   and take every threshold down rather than just the missing one — a failure mode worth
   designing out and keeping designed out.

3. **`app_settings.af_validation` is not wired to anything in this app** (confirmed,
   left as is). The brief says
   CardioPulmo reads it. It does not: the AF validation toggle in `admin.html` writes
   `cp_valmode` to **localStorage**, and `cpValOn()` in `app.js` reads it back from
   localStorage. So the switch is per-device, not global — an admin turning it on does
   not turn it on for field users. The column stays in the allowlist so it can be wired
   up, but I did not change the behaviour, since that is a product decision.

4. **`recordings` columns — resolved: `app` is now stamped.** All three of `app`,
   `subject_age` and `subject_sex` exist. All 107 existing rows carry
   `app = 'cardiopulmo'`; `subject_age` and `subject_sex` are populated on **zero** of
   them.

   So new rows are stamped `app = 'cardiopulmo'` on both insert paths (with audio and
   metadata-only), from the `tables.APP` constant. `app` is deliberately **not** in the
   writable allowlist, so a client cannot stamp a row as the sibling app's — the value is
   assigned server-side after the body is filtered. `subject_age` and `subject_sex` are
   left alone: nothing has ever written them, and inventing a writer for them is not this
   migration's job.

## Files

New: `pb-client.js`, `vercel.json`, `api/auth.js`, `api/data.js`,
`api/storage/{sign,audio}.js`,
`api/_lib/{env,http,dispatch,postbase,sql,auth,profile,tables,mime}.js`,
`api/_lib/routes/{recordings,profiles,feedback,af-validation,app-settings,admins,signup,signin,google,session,signout}.js`

Changed: `index.html` (script tag, logout button), `admin.html` (client, storage calls,
`has_audio`, ZIP extensions, copy), `app.js` (client, upload, playback, delete, signup
copy, `user_id` no longer sent from the browser).

## Environment variables (server-side only)

`POSTBASE_URL`, `POSTBASE_PROJECT_ID`, `POSTBASE_SERVICE_KEY`. None of these are
readable from the browser, and `api/_lib/env.js` throws on the first request if any is
missing rather than failing intermittently deep in a data path.
