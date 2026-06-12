// js/auth.js
import { signInWithCustomToken, signOut } from 'firebase/auth';
import { auth, callValidateRecovery } from './firebase-config.js';
import { deriveUserIdFromRecoveryCode } from './identity.js';

// Ensures a Firebase Auth session exists before any RTDB op. Reuses a cached
// session (persistence is LOCAL by default) so this is a no-op on most loads;
// only a cold start / restored device / lost session mints a fresh token.
// `recoveryCode` is required only when there's no cached session.
export async function ensureSignedIn(recoveryCode) {
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
  } else if (!recoveryCode) {
    throw new Error('No cached session and no recovery code to sign in with.');
  }
  const token = await callValidateRecovery(recoveryCode);
  await signInWithCustomToken(auth, token);
}
