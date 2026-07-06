// js/firebase-config.js
import { initializeApp } from 'firebase/app';
import { getDatabase } from 'firebase/database';
import { getMessaging, isSupported } from 'firebase/messaging';
import { getAuth } from 'firebase/auth';
import { getFunctions, httpsCallable } from 'firebase/functions';

const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY,
  authDomain: process.env.FIREBASE_AUTH_DOMAIN,
  databaseURL: process.env.FIREBASE_DATABASE_URL,
  projectId: process.env.FIREBASE_PROJECT_ID,
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.FIREBASE_APP_ID,
};

export const app = initializeApp(firebaseConfig);
export const db = getDatabase(app);
export const auth = getAuth(app);

// Functions are pinned to europe-west1 (functions/index.js setGlobalOptions).
const _functions = getFunctions(app, 'europe-west1');
const _validateRecovery = httpsCallable(_functions, 'validateRecovery');
const _resolveInvitePreview = httpsCallable(_functions, 'resolveInvitePreview');

// Calls the validateRecovery callable; returns the Firebase custom token string.
export async function callValidateRecovery(code) {
  const { data } = await _validateRecovery({ code });
  return data.token;
}

// Calls the resolveInvitePreview callable; returns the preview object (or null).
// Unauthenticated: the welcome screen needs invite framing before sign-in.
export async function callResolveInvitePreview(token) {
  const { data } = await _resolveInvitePreview({ token });
  return data?.preview ?? null;
}

const _validateTelegram = httpsCallable(_functions, 'validateTelegram');
const _linkTelegram = httpsCallable(_functions, 'linkTelegram');
const _unlinkTelegram = httpsCallable(_functions, 'unlinkTelegram');
const _graduateTelegram = httpsCallable(_functions, 'graduateTelegram');

// Telegram Mini App auth (experimental — spec 2026-07-02). initData is the raw
// signed string from Telegram.WebApp; the server verifies it and mints a token.
export async function callValidateTelegram(initData) {
  const { data } = await _validateTelegram({ initData });
  return data; // { token, uid, linked, created }
}
export async function callLinkTelegram(initData, code) {
  const { data } = await _linkTelegram({ initData, code });
  return data; // { token }
}
export async function callUnlinkTelegram(initData) {
  const { data } = await _unlinkTelegram({ initData });
  return data; // { ok: true }
}
// Graduation: migrate the current unlinked derived account to the phrase-derived
// uid (spec §7). Throws `already-exists` on a target-uid collision so the caller
// can regenerate the phrase and retry.
export async function callGraduateTelegram(initData, code) {
  const { data } = await _graduateTelegram({ initData, code });
  return data; // { ok: true, uid }
}

let _messaging = null;
// Returns a Messaging instance, or null where unsupported (e.g. iOS Safari tab).
export async function getMessagingIfSupported() {
  try {
    if (_messaging) return _messaging;
    if (!(await isSupported())) return null;
    _messaging = getMessaging(app);
    return _messaging;
  } catch { return null; }
}
