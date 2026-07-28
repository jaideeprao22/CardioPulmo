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
api/auth.js            → /api/auth?action=signup|signin|google|session|signout
api/data.js            → /api/data?resource=recordings|profiles|feedback|af-validation|app-settings|admins
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
  token. Until the provider is configured, Postbase answers 401 and the route reports
  that as a configuration state, not a generic failure.
- **There is no password reset.** `/magiclink` and `/recover` do not exist. The signup
  message no longer promises a confirmation email, says the password cannot be reset from
  the app, and the admin dashboard's "Add user" text says the same.

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
