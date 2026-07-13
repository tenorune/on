// js/graduationPhrase.ts — J#11: a small local vault for the secret phrase a
// Telegram account reveals when it graduates ("use the app outside Telegram").
//
// The phrase isn't stored server-side (it's hashed into the uid) and the
// Telegram identity boots from initData with recoveryCode: null, so without
// this the phrase is a one-shot reveal. We stash it at graduation time (the
// only moment the client holds it) so the drawer can re-show it later.
//
// Keyed by the phrase-derived uid, so a later account switch reads its own
// (absent) key — no cross-account display. Deliberately OUTSIDE cacheOwner's
// wipe list so it survives the graduation reload (itself a uid change); a
// plaintext phrase in localStorage matches the existing web posture, which
// already persists it in statusapp_identity.

const KEY_PREFIX = 'statusapp_grad_phrase_';

// Remove every stored graduation phrase (all accounts). Called internally before
// a store (only the current account's phrase lingers) and exported for the
// identity-teardown points — unlink and sign-out (F5 #287) — so the phrase, which
// is the account credential, never survives into a different account.
export function clearGraduatedPhrases() {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key && key.startsWith(KEY_PREFIX)) localStorage.removeItem(key);
    }
  } catch { /* private mode / quota */ }
}

export function storeGraduatedPhrase(uid: string | null | undefined, recoveryCode: string | null | undefined) {
  if (!uid || !recoveryCode) return;
  clearGraduatedPhrases();
  try { localStorage.setItem(KEY_PREFIX + uid, recoveryCode); } catch { /* private mode / quota */ }
}

export function loadGraduatedPhrase(uid: string | null | undefined) {
  if (!uid) return null;
  try { return localStorage.getItem(KEY_PREFIX + uid); } catch { return null; }
}
