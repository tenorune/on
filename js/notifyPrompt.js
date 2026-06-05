// js/notifyPrompt.js
import { NOTIFICATIONS_ENABLED } from './features.js';
import { isHintSeen, markHintSeen, addPushToken } from './prefs.js';
import { detectNotifyCapability, guidanceCopyFor } from './installGuidance.js';
import { getMessagingIfSupported } from './firebase-config.js';
import { getToken } from 'firebase/messaging';

const PROMO_HINT = 'notifyPromo';

// Pure: decide whether the promo banner should be shown.
export function shouldShowPromo({ enabled, hintSeen, engaged, capState, permission }) {
  if (!enabled) return false;
  if (hintSeen) return false;
  if (!engaged) return false;
  if (permission === 'granted') return false;
  if (capState === 'denied') return false;
  if (capState === 'unsupported') return false;
  return true; // 'supported' | 'needs-install-ios' | 'ios-use-safari'
}

const VAPID_KEY = process.env.FIREBASE_VAPID_KEY;

// Requests OS permission, obtains an FCM token against the existing SW, registers it.
// Returns true on success.
export async function requestPermissionAndRegister() {
  if (typeof Notification === 'undefined') return false;
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return false;
  const messaging = await getMessagingIfSupported();
  if (!messaging) return false;
  const registration = await navigator.serviceWorker.ready;
  const token = await getToken(messaging, { vapidKey: VAPID_KEY, serviceWorkerRegistration: registration });
  if (!token) return false;
  addPushToken(token);
  return true;
}

export function dismissPromoForever() { markHintSeen(PROMO_HINT); }
