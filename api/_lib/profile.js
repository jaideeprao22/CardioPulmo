'use strict';
/* Replacement for handle_new_user().

   That trigger sat on auth.users and seeded a profiles row. Postbase never writes to
   auth.users, so it can never fire again — the row has to be created by us.

   It is created at signup, and re-checked on every session read, so a signup whose
   profile insert failed (or an account created before this migration) is repaired on the
   user's next visit rather than leaving them permanently without a profile row.

   There are deliberately no foreign keys to auth.users, and existing rows carry orphaned
   user_id values from the old Supabase users. That is expected; nothing here tries to
   repair it. */

var pb = require('./postbase');

async function ensureProfile(user) {
  if (!user || !user.id) return false;
  var rows = await pb.query({
    operation: 'select',
    table: 'profiles',
    columns: ['id'],
    filters: [{ column: 'id', operator: 'eq', value: user.id }],
    limit: 1
  });
  if (Array.isArray(rows) && rows.length) return false;

  var data = { id: user.id };
  if (user.email) data.email = user.email;
  if (user.name) data.full_name = user.name;

  await pb.query({ operation: 'insert', table: 'profiles', data: data });
  return true;
}

/* Never let a profile problem block sign-in — the account itself is fine, and the next
   session read retries. Failures are logged, not swallowed silently. */
async function ensureProfileSafe(user) {
  try {
    return await ensureProfile(user);
  } catch (e) {
    console.error('[api] profile seed failed for ' + (user && user.id) + ': ' + ((e && e.message) || e));
    return false;
  }
}

module.exports = { ensureProfile: ensureProfile, ensureProfileSafe: ensureProfileSafe };
