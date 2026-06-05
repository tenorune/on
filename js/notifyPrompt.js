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

let _engaged = false;
export function markEngaged() { _engaged = true; maybeShowBanner(); }

let _userId = null;
export function initNotifyPrompt(userId) {
  _userId = userId;
  // Engagement = second session onward (avoid first-ever-load nag).
  const k = 'statusapp_session_seen';
  if (localStorage.getItem(k) === '1') _engaged = true; else localStorage.setItem(k, '1');
  maybeShowBanner();
}

function maybeShowBanner() {
  const cap = detectNotifyCapability();
  const permission = (typeof Notification !== 'undefined' && Notification.permission) || 'default';
  const show = shouldShowPromo({
    enabled: NOTIFICATIONS_ENABLED, hintSeen: isHintSeen(PROMO_HINT),
    engaged: _engaged, capState: cap.state, permission,
  });
  const banner = document.getElementById('notify-promo');
  if (!banner) return;
  if (!show) { banner.classList.add('hidden'); return; }
  renderBanner(banner, cap.state);
  banner.classList.remove('hidden');
}

function renderBanner(banner, capState) {
  const textEl = banner.querySelector('#notify-promo-text');
  const actionEl = banner.querySelector('#notify-promo-action');
  if (capState === 'supported') {
    textEl.textContent = 'Get notified about knocks, calls, and people coming online.';
    actionEl.textContent = 'Enable';
    actionEl.classList.remove('hidden');
    actionEl.onclick = async () => {
      const ok = await requestPermissionAndRegister();
      if (ok) banner.classList.add('hidden');
    };
  } else {
    const copy = guidanceCopyFor(capState);
    textEl.textContent = copy.body;
    actionEl.classList.add('hidden');
  }
  banner.querySelector('#notify-promo-dismiss').onclick = () => {
    dismissPromoForever();
    banner.classList.add('hidden');
  };
}
