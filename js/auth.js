// js/auth.js
import { signInWithCustomToken } from 'firebase/auth';
import { auth, callValidateRecovery } from './firebase-config.js';

// Ensures a Firebase Auth session exists before any RTDB op. Reuses a cached
// session (persistence is LOCAL by default) so this is a no-op on most loads;
// only a cold start / restored device / lost session mints a fresh token.
// `recoveryCode` is required only when there's no cached session.
export async function ensureSignedIn(recoveryCode) {
  await auth.authStateReady();           // wait for the SDK to restore any session
  if (auth.currentUser) return;
  if (!recoveryCode) throw new Error('No cached session and no recovery code to sign in with.');
  const token = await callValidateRecovery(recoveryCode);
  await signInWithCustomToken(auth, token);
}
