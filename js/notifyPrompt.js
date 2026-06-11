// js/notifyPrompt.js
import { NOTIFICATIONS_ENABLED } from './features.js';
import { isHintSeen, markHintSeen, addPushToken, removePushToken, getRegisteredPushToken, hasAnyNotifyPrefEnabled } from './prefs.js';
import { detectNotifyCapability, guidanceCopyFor } from './installGuidance.js';
import { getMessagingIfSupported } from './firebase-config.js';
import { getToken } from 'firebase/messaging';

const PROMO_HINT = 'notifyPromo';

// Device-local (NOT synced) dismissal for the "you have notify prefs but this
// device can't deliver" reprompt. Kept out of userPrefs so dismissing on one
// device doesn't suppress the reprompt on another that genuinely needs it.
const REPROMPT_DISMISS_KEY = 'statusapp_notify_reprompt_dismissed';
function isRepromptDismissedOnDevice() {
  try { return localStorage.getItem(REPROMPT_DISMISS_KEY) === '1'; } catch { return false; }
}
function dismissRepromptOnDevice() {
  try { localStorage.setItem(REPROMPT_DISMISS_KEY, '1'); } catch { /* quota */ }
}

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

// Pure: decide whether to RE-prompt because the user has enabled notify prefs
// (synced from another device) but this device has no OS permission/token, so
// the "on" bells silently deliver nothing. Deliberately ignores hintSeen and
// engagement: a concrete unmet intent overrides the passive promo's gating (the
// synced "dismissed forever" from the old device must not suppress this). Held
// back only by a device-local dismissal and the absence of an actionable path.
export function shouldReprompt({ enabled, hasEnabledPrefs, permission, capState, deviceDismissed }) {
  if (!enabled) return false;
  if (permission === 'granted') return false;
  if (deviceDismissed) return false;
  if (!hasEnabledPrefs) return false;
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

// Self-heal the server-side FCM token on app load. Permission/token state drifts
// (especially on iOS), and the client otherwise only registers a token on
// toggle-on — leaving the server with a stale/absent token and no recovery short
// of a reinstall. When permission is already granted, fetch the device's current
// token and reconcile: drop a rotated old token, then (re-)register the current
// one (idempotent — also heals a token the server pruned while still valid).
export async function refreshPushToken() {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  const messaging = await getMessagingIfSupported();
  if (!messaging) return;
  const registration = await navigator.serviceWorker.ready;
  const token = await getToken(messaging, { vapidKey: VAPID_KEY, serviceWorkerRegistration: registration });
  if (!token) return;
  const prev = getRegisteredPushToken();
  if (prev && prev !== token) removePushToken(prev);
  addPushToken(token);
}

// Explicitly show the promo banner for a capability state, bypassing the
// engagement/dismissal gating used by the passive promo — the user just asked
// for notifications, so we always show how to get them.
function showBannerForState(capState) {
  const banner = document.getElementById('notify-promo');
  if (!banner) return;
  renderBanner(banner, capState);
  banner.classList.remove('hidden');
}

// Called when a user turns a per-person bell on. Always gives feedback: prompts
// when push is available, otherwise (or on denial) surfaces the right guidance.
export async function ensureNotificationsReady() {
  const cap = detectNotifyCapability();
  if (cap.state === 'supported') {
    const ok = await requestPermissionAndRegister();
    if (!ok) showBannerForState(detectNotifyCapability().state);
    return;
  }
  showBannerForState(cap.state);
}

let _engaged = false;
export function markEngaged() { _engaged = true; refreshPromoVisibility(); }

let _userId = null;
let _repromptListenerWired = false;
export function initNotifyPrompt(userId) {
  _userId = userId;
  // Engagement = second session onward (avoid first-ever-load nag).
  const k = 'statusapp_session_seen';
  if (localStorage.getItem(k) === '1') _engaged = true; else localStorage.setItem(k, '1');
  // Re-evaluate once the synced notify prefs land — that's when we can tell a
  // restored device has "on" bells it can't yet deliver (no permission/token).
  if (!_repromptListenerWired && typeof document !== 'undefined') {
    document.addEventListener('notify-prefs-synced', maybeRepromptForMissingPermission);
    _repromptListenerWired = true;
  }
  refreshPromoVisibility();
}

// Public entry: re-check whether the promo should surface (called on the
// notify-prefs-synced event, after a restore hydrates the bells).
export function maybeRepromptForMissingPermission() { refreshPromoVisibility(); }

// Single source of truth for the banner's visibility. Shows it for either the
// passive promo (engaged, unseen) OR the reprompt (enabled prefs but no
// permission on this device). When the ONLY reason is the reprompt, Close is a
// device-local dismissal; otherwise it's the synced forever-dismiss.
function refreshPromoVisibility() {
  const banner = document.getElementById('notify-promo');
  if (!banner) return;
  const cap = detectNotifyCapability();
  const permission = (typeof Notification !== 'undefined' && Notification.permission) || 'default';
  const passive = shouldShowPromo({
    enabled: NOTIFICATIONS_ENABLED, hintSeen: isHintSeen(PROMO_HINT),
    engaged: _engaged, capState: cap.state, permission,
  });
  const reprompt = shouldReprompt({
    enabled: NOTIFICATIONS_ENABLED, hasEnabledPrefs: hasAnyNotifyPrefEnabled(),
    permission, capState: cap.state, deviceDismissed: isRepromptDismissedOnDevice(),
  });
  if (!passive && !reprompt) { banner.classList.add('hidden'); return; }
  const onDismiss = (reprompt && !passive)
    ? () => { dismissRepromptOnDevice(); banner.classList.add('hidden'); }
    : () => { dismissPromoForever(); banner.classList.add('hidden'); };
  renderBanner(banner, cap.state, onDismiss);
  banner.classList.remove('hidden');
}

function renderBanner(banner, capState, onDismiss) {
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
  banner.querySelector('#notify-promo-dismiss').onclick = onDismiss
    || (() => { dismissPromoForever(); banner.classList.add('hidden'); });
}
