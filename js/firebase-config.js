// js/firebase-config.js
import { initializeApp } from 'firebase/app';
import { getDatabase } from 'firebase/database';
import { getMessaging, isSupported } from 'firebase/messaging';

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
