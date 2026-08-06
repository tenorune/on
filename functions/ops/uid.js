// functions/ops/uid.js — what a uid is allowed to look like, in ONE place.
//
// Every destructive path this panel builds interpolates an operator-typed uid
// into a KEY: `users/{uid}`, `userPrefs/{uid}`, `pushTokens/{uid}`,
// `locations/{uid}` and the six mailboxes. RTDB keys may not contain
// `. $ # [ ] /` — and the SDK does not REJECT a key containing `/`, it splits
// on it and drops the empty segments, so `users//` is a write to `/users`.
//
// A uid of `"/"` therefore turns a one-account purge into a whole-top-level-
// node delete, and it does so invisibly: the builders' "typo'd uid" guard
// reads `users//` back as a populated node and takes it for an account. The
// shape check has to happen before the first read, which is the only moment
// the two readings can still be told apart.
//
// Real uids are 32 hex characters (auth.js `deriveUid`, telegram-auth.js
// `deriveTelegramUid`) and Firebase Auth caps a uid at 128; this pattern is a
// superset of anything the app can mint and a subset of what RTDB accepts as
// a key, which is the direction that has to be safe.
export const UID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

/**
 * @param {unknown} value
 * @param {string} field name to blame in the message — this is operator-facing
 * @returns {string}
 */
export function assertUid(value, field) {
  if (typeof value !== 'string' || !UID_PATTERN.test(value)) {
    throw new Error(`${field} must be a Firebase uid: letters, digits, '-' or '_', 1-128 characters`);
  }
  return value;
}
