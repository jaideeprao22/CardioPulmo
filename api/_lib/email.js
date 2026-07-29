'use strict';
/* One place that normalises a client-supplied email address.

   Every route that accepts an address from the browser runs it through here — signup,
   signin, forgot — so a row created today is always stored lowercase and
   trimmed, and the case-mismatch problem below stops arising for anything new.

   IMPORTANT, and the reason this is a named helper rather than an inline .toLowerCase():
   this is for ADDRESSES THE USER TYPED. It must never be applied to an address read back
   out of the database. Postbase matches exactly, so a legacy row stored as `Foo@bar.com`
   has to be forwarded as `Foo@bar.com`; lowercasing it on the way out would miss the
   account and cause a duplicate to be created. Normalise input, preserve stored. */

function normalize(v) {
  if (typeof v !== 'string') return '';
  return v.trim().toLowerCase();
}

/* Deliberately shallow: enough to reject an obvious typo before spending a round trip,
   not an attempt to validate deliverability. The mail either arrives or it does not. */
function looksLikeAddress(v) {
  return typeof v === 'string' && v.indexOf('@') > 0 && v.indexOf('@') < v.length - 1;
}

module.exports = { normalize: normalize, looksLikeAddress: looksLikeAddress };
