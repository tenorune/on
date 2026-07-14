// js/auth.js
import { signInWithCustomToken, signOut } from 'firebase/auth';
import { ref, get } from 'firebase/database';
import { auth, db, callValidateRecovery } from './firebase-config.js';
import { deriveUserIdFromRecoveryCode } from './identity.js';
import { clearGraduatedPhrases } from './graduationPhrase.js';

// After signInWithCustomToken resolves, the RTDB connection re-authenticates
// ASYNCHRONOUSLY — reads/listeners attached in that window get permission_denied,
// and onValue listeners are then CANCELLED (not retried), silently stranding data
// (e.g. a group member's override on a fresh restore, or the knock inbox). Gate on
// a tiny own auth-required read (`users/{uid}/presence` → rule: auth != null) that
// retries until the token has propagated, so every read/watcher set up after
// sign-in attaches post-handshake. Bounded so a genuine network failure can't hang.
export async function whenRtdbAuthReady() {
  const uid = auth.currentUser?.uid;
  if (!uid) return;
  for (let attempt = 0; attempt < 15; attempt += 1) {
    try { await get(ref(db, `users/${uid}/presence/lastSeen`)); return; }
    catch { await new Promise((resolve) => setTimeout(resolve, 150)); }
  }
}

// Ensures a Firebase Auth session exists before any RTDB op. Reuses a cached
// session (persistence is LOCAL by default) so this is a no-op on most loads;
// only a cold start / restored device / lost session mints a fresh token.
// `recoveryCode` is required only when there's no cached session.
export async function ensureSignedIn(recoveryCode?: string) {
  await auth.authStateReady();           // wait for the SDK to restore any session
  if (auth.currentUser) {
    // A cached session is reusable only if it belongs to THIS recovery code's
    // account (auth.uid === the code's derived userId). A prior failed restore
    // — a mistyped phrase still mints a token for a dead uid — can leave us
    // signed in as the wrong account; reusing it would deny the real account's
    // owner-scoped reads. With no code to compare against, trust the session.
    if (!recoveryCode) return;
    const wantUid = await deriveUserIdFromRecoveryCode(recoveryCode);
    if (auth.currentUser.uid === wantUid) return;
    await signOut(auth);
    // Switching identities: the outgoing account's stashed graduation phrase
    // (its credential) must not survive into the incoming one (F5 #287).
    clearGraduatedPhrases();
  } else if (!recoveryCode) {
    throw new Error('No cached session and no recovery code to sign in with.');
  }
  const token = await callValidateRecovery(recoveryCode);
  await signInWithCustomToken(auth, token);
  // Don't return until the RTDB connection actually carries the new token, so
  // the watchers main() attaches next don't race the auth handshake (and get
  // cancelled by a transient permission_denied).
  await whenRtdbAuthReady();
}
